"""Driver domain: ride-captain rides + valet jobs, on top of the existing User/Reservation/
PaymentTransaction models (see models.py for why nothing there is duplicated).

Life-cycles (mirrors booking_service.py's style - the REST layer stays thin, this is where
every rule lives so it is exercised the same way from the API and from tests):

    Ride:  REQUESTED -> ACCEPTED -> DRIVER_ARRIVING -> DRIVER_ARRIVED -> RIDE_STARTED -> RIDE_COMPLETED
                      \\-> (reject, back to REQUESTED)                 \\-> CANCELLED (any point before RIDE_STARTED)

    Valet: REQUESTED -> DRIVER_ASSIGNED -> DRIVER_GOING_TO_PICKUP -> VEHICLE_PICKED_UP
                      \\-> (reject, back to REQUESTED)     -> VEHICLE_IN_TRANSIT -> VEHICLE_DROPPED -> COMPLETED
                                                             \\-> CANCELLED (any point before COMPLETED)

A ride/valet request starts UNASSIGNED (driver_id is NULL) and sits in a pool that every
verified, AVAILABLE driver of the right type can see and accept (business rule 4: captains only
see rides, valet drivers only see valet jobs). Whoever accepts first gets it - guarded by the same
kind of lock booking_service.py uses for slot booking, so two drivers can't double-accept.

Money: rides/valet jobs are charged to the RIDER only after the job ends (the exact fare needs the
real elapsed time, so it can't be known upfront) via `Applications.payments.charge` - the same
dummy gateway and PaymentTransaction table parking bookings use, never a second payment system.
"""
import threading
from datetime import date, datetime, timedelta

from flask import current_app

from . import payments, utils
from .database import db
from .models import (Driver, DriverAvailability, DriverKYC, DriverNotification, DriverRating, DriverVehicle,
                     ParkingLot, PaymentTransaction, Reservation, Ride, RideFare, RideStatusHistory, ValetRequest,
                     ValetStatusHistory, VehicleHandover)

# One process-wide lock per domain - same reasoning as booking_service.BOOKING_LOCK: SQLite has a
# single writer, this just closes the "check -> accept" race between two drivers' requests.
JOB_LOCK = threading.RLock()

DRIVER_TYPES = ("ride_captain", "valet_driver")
VALET_REQUEST_TYPES = ("home_to_lot", "lot_to_home", "location_to_lot", "lot_to_location")
RIDE_ACTIVE = ("REQUESTED", "ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "RIDE_STARTED")
VALET_ACTIVE = ("REQUESTED", "DRIVER_ASSIGNED", "DRIVER_GOING_TO_PICKUP", "VEHICLE_PICKED_UP", "VEHICLE_IN_TRANSIT",
               "VEHICLE_DROPPED")


def cfg(name):
    return current_app.config[name]


# =============================================================================== small helpers
def _gen_code(prefix):
    for _ in range(8):
        code = utils.gen_code(prefix)
        if prefix == "RD" and not Ride.query.filter_by(code=code).first():
            return code
        if prefix == "VL" and not ValetRequest.query.filter_by(code=code).first():
            return code
    return utils.gen_code(prefix, 10)


def _photo_field(data, field):
    """A dummy 'upload': the frontend base64-encodes the picked file and sends it as a normal
    JSON string (data: URI). No real file storage/CDN - see FIXES.md. Capped so a demo doesn't
    bloat the SQLite file."""
    v = data.get(field)
    if v is None:
        return None
    v = str(v)
    if len(v) > cfg("DRIVER_MAX_PHOTO_CHARS"):
        raise utils.ApiError(f"'{field}' is too large.", 400, "photo_too_large")
    return v or None


def _parse_date(value, field):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        raise utils.ApiError(f"'{field}' must be a valid date (YYYY-MM-DD).", 400, "bad_date")


def notify(driver, kind, title, message, ride=None, valet=None):
    db.session.add(DriverNotification(driver_id=driver.id, kind=kind, title=title, message=message,
                                      ride_id=ride.id if ride else None, valet_id=valet.id if valet else None))


# =============================================================================== registration / profile
def get_driver_for_user(user):
    return Driver.query.filter_by(user_id=user.id).first()


def require_driver_profile(user):
    d = get_driver_for_user(user)
    if not d:
        raise utils.ApiError("Driver profile not found.", 404, "not_found")
    return d


def register_driver(user, data):
    """Creates the Driver profile for a freshly-created User(role='driver'). Called right after
    RegisterResource makes the base account (see resources/driver.py)."""
    driver_type = (data.get("driver_type") or "").strip().lower()
    if driver_type not in DRIVER_TYPES:
        raise utils.ApiError("Choose 'ride_captain' or 'valet_driver'.", 400, "bad_driver_type")
    full_name = (data.get("full_name") or "").strip()
    if len(full_name) < 2:
        raise utils.ApiError("Enter your full name.", 400, "bad_name")
    licence_number = (data.get("licence_number") or "").strip().upper()
    if len(licence_number) < 4:
        raise utils.ApiError("Enter a valid driving licence number.", 400, "bad_licence")

    driver = Driver(
        user_id=user.id, driver_type=driver_type, full_name=full_name[:120],
        dob=_parse_date(data.get("dob"), "dob"), address=(data.get("address") or "").strip()[:255] or None,
        profile_photo=_photo_field(data, "profile_photo"), licence_number=licence_number[:40],
        licence_document=_photo_field(data, "licence_document"),
        licence_expiry=_parse_date(data.get("licence_expiry"), "licence_expiry"))
    db.session.add(driver)
    db.session.flush()
    db.session.add(DriverAvailability(driver_id=driver.id, status="OFFLINE"))
    if data.get("licence_document") or data.get("dob"):     # enough info to submit KYC right away
        db.session.add(DriverKYC(driver_id=driver.id, status="PENDING"))
    db.session.commit()
    return driver


def update_profile(driver, data):
    if "full_name" in data:
        name = (data["full_name"] or "").strip()
        if len(name) < 2:
            raise utils.ApiError("Enter your full name.", 400, "bad_name")
        driver.full_name = name[:120]
    if "address" in data:
        driver.address = (data["address"] or "").strip()[:255] or None
    if "dob" in data:
        driver.dob = _parse_date(data["dob"], "dob")
    if "profile_photo" in data:
        driver.profile_photo = _photo_field(data, "profile_photo")
    db.session.commit()
    return driver


# =============================================================================== KYC (dummy - see FIXES.md)
def submit_kyc(driver, data):
    if driver.kyc_status == "APPROVED":
        raise utils.ApiError("Your KYC is already approved.", 409, "already_approved")
    licence_number = (data.get("licence_number") or driver.licence_number or "").strip().upper()
    if len(licence_number) < 4:
        raise utils.ApiError("Enter a valid driving licence number.", 400, "bad_licence")
    licence_doc = _photo_field(data, "licence_document")
    if not licence_doc and not driver.licence_document:
        raise utils.ApiError("Upload your licence document/photo to submit KYC.", 400, "licence_doc_required")
    driver.licence_number = licence_number[:40]
    if licence_doc:
        driver.licence_document = licence_doc
    if data.get("licence_expiry"):
        driver.licence_expiry = _parse_date(data.get("licence_expiry"), "licence_expiry")
    db.session.add(DriverKYC(driver_id=driver.id, status="PENDING"))
    db.session.commit()
    return driver


def admin_review_kyc(driver, decision, reason, admin_user):
    decision = (decision or "").upper()
    if decision not in ("APPROVED", "REJECTED", "EXPIRED"):
        raise utils.ApiError("decision must be APPROVED, REJECTED or EXPIRED.", 400, "bad_decision")
    kyc = driver.latest_kyc
    if not kyc or kyc.status != "PENDING":
        if decision != "EXPIRED":
            raise utils.ApiError("There is no pending KYC submission to review.", 409, "no_pending_kyc")
        kyc = driver.latest_kyc
        if not kyc:
            raise utils.ApiError("This driver has no KYC record yet.", 404, "not_found")
    kyc.status = decision
    kyc.reviewed_at = utils.now_utc()
    kyc.reviewed_by_id = admin_user.id
    kyc.reject_reason = (reason or "").strip()[:255] if decision in ("REJECTED", "EXPIRED") else None
    db.session.commit()
    label = {"APPROVED": "approved", "REJECTED": "rejected", "EXPIRED": "marked expired"}[decision]
    notify(driver, "kyc_" + decision.lower(), f"KYC {label}",
          (f"Your KYC was {label}." + (f" Reason: {kyc.reject_reason}" if kyc.reject_reason else "")))
    db.session.commit()
    return driver


# =============================================================================== vehicle (ride captains only)
def register_vehicle(driver, data):
    if driver.driver_type != "ride_captain":
        raise utils.ApiError("Only ride captains register a vehicle - valet drivers use the rider's own car.",
                             400, "not_a_captain")
    reg = utils.normalize_vehicle(data.get("reg_number"))
    vtype = (data.get("vehicle_type") or "car").lower()
    if vtype not in ("car", "suv", "auto", "bike"):
        vtype = "car"
    vehicle = DriverVehicle(
        driver_id=driver.id, reg_number=reg, manufacturer=(data.get("manufacturer") or "").strip()[:60],
        model=(data.get("model") or "").strip()[:60], vehicle_type=vtype,
        colour=(data.get("colour") or "").strip()[:30] or None,
        year=utils.as_int(data.get("year"), "year", 1980, date.today().year + 1) if data.get("year") else None,
        seating_capacity=utils.as_int(data.get("seating_capacity"), "seating_capacity", 1, 60, default=4),
        photo=_photo_field(data, "photo"),
        registration_expiry=_parse_date(data.get("registration_expiry"), "registration_expiry"),
        insurance_expiry=_parse_date(data.get("insurance_expiry"), "insurance_expiry"), status="PENDING")
    db.session.add(vehicle)
    db.session.commit()
    return vehicle


def admin_review_vehicle(vehicle, decision, reason):
    decision = (decision or "").upper()
    if decision not in ("APPROVED", "REJECTED"):
        raise utils.ApiError("decision must be APPROVED or REJECTED.", 400, "bad_decision")
    vehicle.status = decision
    vehicle.reject_reason = (reason or "").strip()[:255] if decision == "REJECTED" else None
    db.session.commit()
    driver = vehicle.driver
    label = "approved" if decision == "APPROVED" else "rejected"
    notify(driver, "vehicle_" + decision.lower(), f"Vehicle {label}",
          (f"Your vehicle {vehicle.reg_number} was {label}."
           + (f" Reason: {vehicle.reject_reason}" if vehicle.reject_reason else "")))
    db.session.commit()
    return vehicle


# =============================================================================== availability
def set_availability(driver, status):
    status = (status or "").upper()
    if status not in ("AVAILABLE", "OFFLINE"):     # a driver can never *set* BUSY - the system does that
        raise utils.ApiError("status must be AVAILABLE or OFFLINE.", 400, "bad_status")
    if status == "AVAILABLE" and not driver.can_go_online:
        if driver.account_status != "active":
            raise utils.ApiError("Your account is suspended." + (f" Reason: {driver.suspend_reason}" if driver.suspend_reason else ""),
                                 403, "account_suspended")
        if driver.kyc_status != "APPROVED":
            raise utils.ApiError("Your KYC must be approved before you can go online.", 403, "kyc_not_approved")
        raise utils.ApiError("You need an approved vehicle before you can go online.", 403, "vehicle_not_approved")
    avail = driver.availability
    if avail.status == "BUSY" and status == "AVAILABLE":
        raise utils.ApiError("You still have an active job - finish or cancel it first.", 409, "busy")
    avail.status = status
    avail.updated_at = utils.now_utc()
    db.session.commit()
    return avail


def _set_busy(driver):
    driver.availability.status, driver.availability.updated_at = "BUSY", utils.now_utc()


def _set_free(driver):
    if driver.availability.status == "BUSY":
        driver.availability.status, driver.availability.updated_at = "AVAILABLE", utils.now_utc()


def has_active_job(driver):
    if Ride.query.filter(Ride.driver_id == driver.id, Ride.status.in_(RIDE_ACTIVE[1:])).first():
        return True
    if ValetRequest.query.filter(ValetRequest.driver_id == driver.id, ValetRequest.status.in_(VALET_ACTIVE[1:])).first():
        return True
    return False


# =============================================================================== lookups
def get_ride(ride_id, rider=None, driver=None):
    r = db.session.get(Ride, ride_id)
    if not r:
        raise utils.ApiError("Ride not found.", 404, "not_found")
    if rider is not None and r.rider_id != rider.id:
        raise utils.ApiError("Ride not found.", 404, "not_found")
    if driver is not None and r.driver_id != driver.id:
        raise utils.ApiError("Ride not found.", 404, "not_found")
    return r


def get_valet(valet_id, rider=None, driver=None):
    v = db.session.get(ValetRequest, valet_id)
    if not v:
        raise utils.ApiError("Valet request not found.", 404, "not_found")
    if rider is not None and v.rider_id != rider.id:
        raise utils.ApiError("Valet request not found.", 404, "not_found")
    if driver is not None and v.driver_id != driver.id:
        raise utils.ApiError("Valet request not found.", 404, "not_found")
    return v


def _parse_latlng(data, prefix):
    """Optional real lat/lng from the rider's OpenStreetMap pin-drop (keys '<prefix>_lat'/'_lng').
    Returns (None, None) when absent so older/mapless clients (or the manual-distance fallback)
    keep working exactly as before."""
    lat, lng = data.get(prefix + "_lat"), data.get(prefix + "_lng")
    if lat in (None, "") or lng in (None, ""):
        return None, None
    return utils.as_float(lat, prefix + "_lat", -90, 90), utils.as_float(lng, prefix + "_lng", -180, 180)


def _resolve_distance(data):
    """Real map pins present on both ends -> measure the real straight-line distance ourselves
    (never trust a client-sent number once we can measure it) and pad it by ROAD_DISTANCE_FACTOR,
    a dummy "roads aren't a straight line" allowance - there is still no real routing/turn-by-turn
    service. No pins (older client, or the map couldn't be used) -> fall back to the rider-entered
    'distance_km' exactly as this app has always worked. Returns (distance_km, pickup_lat, pickup_lng,
    drop_lat, drop_lng) - the lat/lng are None/None when there were no pins to measure from."""
    pickup_lat, pickup_lng = _parse_latlng(data, "pickup")
    drop_lat, drop_lng = _parse_latlng(data, "drop")
    if pickup_lat is not None and drop_lat is not None:
        raw_km = utils.haversine_km(pickup_lat, pickup_lng, drop_lat, drop_lng) * cfg("ROAD_DISTANCE_FACTOR")
        distance = max(0.1, min(raw_km, cfg("RIDE_MAX_DISTANCE_KM")))
    else:
        distance = utils.as_float(data.get("distance_km"), "distance_km", 0.1, cfg("RIDE_MAX_DISTANCE_KM"))
    return distance, pickup_lat, pickup_lng, drop_lat, drop_lng


# =============================================================================== upfront fare estimate
# Shown on the request form itself, BEFORE the rider taps "Request ride"/"Request valet" - not just
# after the trip ends. Still an ESTIMATE: the real fare/fee is only known once the trip actually
# happens (wait time, exact surge at the moment a captain accepts, ...), which is why the ride fare
# estimate below is a low-high band rather than one exact number, and why the numbers here are never
# written to the database - they're recomputed fresh every time this is called.
def estimate_ride_fare(data):
    distance, pickup_lat, pickup_lng, drop_lat, drop_lng = _resolve_distance(data)
    minutes = (distance / cfg("RIDE_AVG_SPEED_KMPH")) * 60.0
    hour = utils.local_hour(utils.now_utc(), cfg("APP_TIMEZONE"))
    surge = cfg("PEAK_SURGE_MULTIPLIER") if hour in cfg("PEAK_SURGE_HOURS") else 1.0
    base = cfg("RIDE_BASE_FARE")
    dist_fare = distance * cfg("RIDE_PER_KM_RATE")
    time_fare = minutes * cfg("RIDE_PER_MIN_RATE")
    estimate = utils.money((base + dist_fare + time_fare) * surge)
    return {
        "distance_km": round(distance, 1), "estimated_minutes": round(minutes),
        "has_map_points": pickup_lat is not None and drop_lat is not None,
        "surge_multiplier": surge, "is_peak_now": surge > 1.0,
        "estimated_fare": estimate,
        "estimated_low": utils.money(estimate * cfg("RIDE_ESTIMATE_LOW_FACTOR")),
        "estimated_high": utils.money(estimate * cfg("RIDE_ESTIMATE_HIGH_FACTOR")),
        "breakdown": {"base_fare": utils.money(base), "distance_fare": utils.money(dist_fare),
                      "time_fare": utils.money(time_fare)},
        "note": "Estimate only - the exact fare still depends on wait time and traffic on the day.",
    }


def estimate_valet_fee(data):
    distance, pickup_lat, pickup_lng, drop_lat, drop_lng = _resolve_distance(data)
    base = cfg("VALET_BASE_FEE")
    dist_fee = distance * cfg("VALET_PER_KM_RATE")
    fee = utils.money(base + dist_fee)
    return {
        "distance_km": round(distance, 1),
        "has_map_points": pickup_lat is not None and drop_lat is not None,
        "estimated_fee": fee,
        "breakdown": {"base_fee": utils.money(base), "distance_fee": utils.money(dist_fee)},
        "note": "Estimate only - the exact fee is confirmed once the vehicle is dropped off.",
    }


def _active_reservation_for(rider, reservation_id):
    if not reservation_id:
        return None
    res = db.session.get(Reservation, reservation_id)
    if not res or res.user_id != rider.id:
        raise utils.ApiError("That parking reservation was not found.", 404, "reservation_not_found")
    if res.state != "confirmed" or res.checked_out_at:
        raise utils.ApiError("Only an active parking reservation can be linked to a ride/valet request.",
                             409, "reservation_not_active")
    return res


# =============================================================================== ride flow (rider side)
def request_ride(rider, data):
    pending_fare = RideFare.query.join(Ride).filter(Ride.rider_id == rider.id, RideFare.paid.is_(False),
                                                     RideFare.total > 0).first()
    if pending_fare:
        raise utils.ApiError(f"Please pay the outstanding fare of ₹{pending_fare.total:,.2f} on ride "
                             f"{pending_fare.ride.code} before requesting another ride.", 402, "fare_due",
                             ride_id=pending_fare.ride_id)
    reservation = _active_reservation_for(rider, data.get("reservation_id"))
    pickup = (data.get("pickup_label") or "").strip()
    drop = (data.get("drop_label") or "").strip()
    if reservation and not pickup:
        pickup = f"{reservation.lot.name} ({reservation.slot.full_label})"
    if not pickup or not drop:
        raise utils.ApiError("Enter both a pickup and a drop-off location.", 400, "locations_required")
    distance, pickup_lat, pickup_lng, drop_lat, drop_lng = _resolve_distance(data)

    ride = Ride(code=_gen_code("RD"), rider_id=rider.id, reservation_id=reservation.id if reservation else None,
               pickup_label=pickup[:160], drop_label=drop[:160], distance_km=round(distance, 1),
               pickup_lat=pickup_lat, pickup_lng=pickup_lng, drop_lat=drop_lat, drop_lng=drop_lng,
               status="REQUESTED")
    db.session.add(ride)
    db.session.flush()
    db.session.add(RideStatusHistory(ride_id=ride.id, status="REQUESTED", note="Ride requested"))
    db.session.commit()
    return ride


def cancel_ride_by_rider(rider, ride, reason):
    ride = get_ride(ride.id, rider=rider)
    return _cancel_ride(ride, "rider", reason)


def cancel_ride_by_driver(driver, ride, reason):
    ride = get_ride(ride.id, driver=driver)
    return _cancel_ride(ride, "driver", reason)


def _cancel_ride(ride, by, reason):
    if ride.status not in RIDE_ACTIVE:
        raise utils.ApiError("This ride can no longer be cancelled.", 409, "bad_state")
    fee = 0.0
    if by == "rider" and ride.status in ("DRIVER_ARRIVING", "DRIVER_ARRIVED"):
        fee = cfg("RIDE_CANCEL_FEE")
    ride.status, ride.cancelled_at = "CANCELLED", utils.now_utc()
    ride.cancelled_by, ride.cancel_reason = by, (reason or "").strip()[:255] or None
    db.session.add(RideStatusHistory(ride_id=ride.id, status="CANCELLED", note=f"Cancelled by {by}"))
    if ride.driver:
        _set_free(ride.driver)
        if by == "rider":
            notify(ride.driver, "ride_cancelled", "Ride cancelled",
                  f"The rider cancelled ride {ride.code}." + (f" Reason: {reason}" if reason else ""), ride=ride)
    if fee > 0:
        db.session.add(RideFare(ride_id=ride.id, cancellation_fee=fee, total=fee,
                               platform_fee=utils.money(fee * cfg("PLATFORM_COMMISSION_PERCENT") / 100.0),
                               driver_earning=utils.money(fee * (100 - cfg("PLATFORM_COMMISSION_PERCENT")) / 100.0)))
    db.session.commit()
    return ride


# =============================================================================== ride flow (driver side)
def available_rides(driver):
    if driver.driver_type != "ride_captain":
        return []
    return Ride.query.filter_by(status="REQUESTED", driver_id=None).order_by(Ride.requested_at).all()


def accept_ride(driver, ride_id):
    if driver.driver_type != "ride_captain":
        raise utils.ApiError("Only ride captains accept rides.", 403, "not_a_captain")
    if not driver.can_go_online:
        raise utils.ApiError("You need an approved KYC and vehicle before accepting rides.", 403, "not_eligible")
    with JOB_LOCK:
        ride = db.session.get(Ride, ride_id)
        if not ride or ride.status != "REQUESTED" or ride.driver_id is not None:
            raise utils.ApiError("This ride is no longer available.", 409, "already_taken")
        if driver.availability.status == "BUSY" or has_active_job(driver):
            raise utils.ApiError("You already have an active job.", 409, "busy")
        ride.driver_id, ride.status, ride.accepted_at = driver.id, "ACCEPTED", utils.now_utc()
        db.session.add(RideStatusHistory(ride_id=ride.id, status="ACCEPTED"))
        _set_busy(driver)
        db.session.commit()
    return ride


def reject_ride(driver, ride):
    ride = get_ride(ride.id, driver=driver)
    if ride.status not in ("ACCEPTED", "DRIVER_ARRIVING"):
        raise utils.ApiError("You can only back out before you've reached the rider.", 409, "bad_state")
    ride.driver_id, ride.status = None, "REQUESTED"
    ride.accepted_at = ride.arriving_at = None
    db.session.add(RideStatusHistory(ride_id=ride.id, status="REQUESTED", note="Driver backed out - back in the pool"))
    _set_free(driver)
    db.session.commit()
    return ride


def advance_ride(driver, ride, action):
    ride = get_ride(ride.id, driver=driver)
    if action == "arriving":
        _require(ride.status == "ACCEPTED", "The ride must be accepted first.")
        ride.status, ride.arriving_at = "DRIVER_ARRIVING", utils.now_utc()
    elif action == "arrived":
        _require(ride.status == "DRIVER_ARRIVING", "Mark yourself as arriving first.")
        ride.status, ride.arrived_at = "DRIVER_ARRIVED", utils.now_utc()
    elif action == "start":
        _require(ride.status == "DRIVER_ARRIVED", "You must arrive before starting the ride.")
        ride.status, ride.started_at = "RIDE_STARTED", utils.now_utc()
    else:
        raise utils.ApiError("Unknown action.", 404, "unknown_action")
    db.session.add(RideStatusHistory(ride_id=ride.id, status=ride.status))
    db.session.commit()
    return ride


def _require(cond, message):
    if not cond:
        raise utils.ApiError(message, 409, "bad_state")


def complete_ride(driver, ride):
    ride = get_ride(ride.id, driver=driver)
    _require(ride.status == "RIDE_STARTED", "The ride must be started before it can be completed.")
    now = utils.now_utc()
    minutes = max(0.0, (now - ride.started_at).total_seconds() / 60.0)
    wait_min = max(0.0, (ride.started_at - ride.arrived_at).total_seconds() / 60.0) if ride.arrived_at else 0.0
    waiting_fee = utils.money(max(0.0, wait_min - cfg("RIDE_FREE_WAIT_MINUTES")) * cfg("RIDE_WAIT_RATE_PER_MIN"))
    hour = utils.local_hour(ride.requested_at, cfg("APP_TIMEZONE"))
    surge = cfg("PEAK_SURGE_MULTIPLIER") if hour in cfg("PEAK_SURGE_HOURS") else 1.0

    base, dist_fare, time_fare = cfg("RIDE_BASE_FARE"), ride.distance_km * cfg("RIDE_PER_KM_RATE"), minutes * cfg("RIDE_PER_MIN_RATE")
    total = utils.money((base + dist_fare + time_fare + waiting_fee) * surge)
    platform_fee = utils.money(total * cfg("PLATFORM_COMMISSION_PERCENT") / 100.0)

    ride.status, ride.completed_at = "RIDE_COMPLETED", now
    db.session.add(RideStatusHistory(ride_id=ride.id, status="RIDE_COMPLETED"))
    db.session.add(RideFare(ride_id=ride.id, base_fare=utils.money(base), distance_fare=utils.money(dist_fare),
                            time_fare=utils.money(time_fare), waiting_fee=waiting_fee, surge_multiplier=surge,
                            total=total, platform_fee=platform_fee, driver_earning=utils.money(total - platform_fee)))
    _set_free(driver)
    db.session.commit()
    return ride


def pay_ride_fare(rider, ride, payment):
    ride = get_ride(ride.id, rider=rider)
    fare = ride.fare
    if not fare or fare.paid:
        raise utils.ApiError("There is nothing to pay on this ride.", 409, "no_fare_due")
    if fare.total <= 0:
        fare.paid = True
        db.session.commit()
        return ride
    txn = payments.charge(rider, fare.total, payment, "ride_fare", lot_id=None)
    txn.ride_id = ride.id
    fare.paid = True
    db.session.commit()
    return ride


# =============================================================================== valet flow (rider side)
def _vehicle_has_active_valet(vehicle_number):
    return ValetRequest.query.filter(ValetRequest.vehicle_number == vehicle_number,
                                     ValetRequest.status.in_(VALET_ACTIVE)).first() is not None


def request_valet(rider, data):
    pending = ValetRequest.query.filter_by(rider_id=rider.id, paid=False).filter(ValetRequest.fee > 0).filter(
        ValetRequest.status.in_(("COMPLETED", "CANCELLED"))).first()
    if pending:
        raise utils.ApiError(f"Please pay the outstanding valet charge of ₹{pending.fee:,.2f} on request "
                             f"{pending.code} before making a new one.", 402, "fee_due", valet_id=pending.id)
    req_type = (data.get("request_type") or "").strip().lower()
    if req_type not in VALET_REQUEST_TYPES:
        raise utils.ApiError("request_type must be one of: " + ", ".join(VALET_REQUEST_TYPES), 400, "bad_request_type")
    vehicle = utils.normalize_vehicle(data.get("vehicle_number"))
    if _vehicle_has_active_valet(vehicle):
        raise utils.ApiError("This vehicle already has an active valet request.", 409, "vehicle_busy")
    reservation = _active_reservation_for(rider, data.get("reservation_id"))
    lot = reservation.lot if reservation else None
    if data.get("lot_id") and not lot:
        lot = db.session.get(ParkingLot, utils.as_int(data.get("lot_id"), "lot_id"))
    pickup = (data.get("pickup_label") or "").strip()
    drop = (data.get("drop_label") or "").strip()
    if lot:
        if req_type in ("lot_to_home", "lot_to_location") and not pickup:
            pickup = lot.name
        if req_type in ("home_to_lot", "location_to_lot") and not drop:
            drop = lot.name
    if not pickup or not drop:
        raise utils.ApiError("Enter both a pickup and a drop-off location.", 400, "locations_required")
    distance, pickup_lat, pickup_lng, drop_lat, drop_lng = _resolve_distance(data)

    req = ValetRequest(code=_gen_code("VL"), rider_id=rider.id, reservation_id=reservation.id if reservation else None,
                       lot_id=lot.id if lot else None, request_type=req_type, vehicle_number=vehicle,
                       pickup_label=pickup[:160], drop_label=drop[:160], distance_km=round(distance, 1),
                       pickup_lat=pickup_lat, pickup_lng=pickup_lng, drop_lat=drop_lat, drop_lng=drop_lng,
                       status="REQUESTED")
    db.session.add(req)
    db.session.flush()
    db.session.add(ValetStatusHistory(valet_id=req.id, status="REQUESTED", note="Valet requested"))
    db.session.commit()
    return req


def cancel_valet_by_rider(rider, req, reason):
    req = get_valet(req.id, rider=rider)
    return _cancel_valet(req, "rider", reason)


def cancel_valet_by_driver(driver, req, reason):
    req = get_valet(req.id, driver=driver)
    return _cancel_valet(req, "driver", reason)


def _cancel_valet(req, by, reason):
    if req.status not in VALET_ACTIVE:
        raise utils.ApiError("This valet request can no longer be cancelled.", 409, "bad_state")
    fee = cfg("VALET_CANCEL_FEE") if req.status in ("VEHICLE_PICKED_UP", "VEHICLE_IN_TRANSIT") else 0.0
    req.status, req.cancelled_at = "CANCELLED", utils.now_utc()
    req.cancelled_by, req.cancel_reason = by, (reason or "").strip()[:255] or None
    db.session.add(ValetStatusHistory(valet_id=req.id, status="CANCELLED", note=f"Cancelled by {by}"))
    if req.driver:
        _set_free(req.driver)
        if by == "rider":
            notify(req.driver, "valet_cancelled", "Valet request cancelled",
                  f"The rider cancelled valet request {req.code}." + (f" Reason: {reason}" if reason else ""), valet=req)
    if fee > 0:
        req.cancellation_fee = fee
        req.fee = utils.money((req.fee or 0) + fee)
        req.platform_fee = utils.money(req.fee * cfg("PLATFORM_COMMISSION_PERCENT") / 100.0)
        req.driver_earning = utils.money(req.fee - req.platform_fee)
        req.paid = False
    db.session.commit()
    return req


# =============================================================================== valet flow (driver side)
def available_valet_jobs(driver):
    if driver.driver_type != "valet_driver":
        return []
    return ValetRequest.query.filter_by(status="REQUESTED", driver_id=None).order_by(ValetRequest.requested_at).all()


def accept_valet(driver, valet_id):
    if driver.driver_type != "valet_driver":
        raise utils.ApiError("Only valet drivers accept valet requests.", 403, "not_a_valet_driver")
    if not driver.can_go_online:
        raise utils.ApiError("Your KYC must be approved before accepting jobs.", 403, "not_eligible")
    with JOB_LOCK:
        req = db.session.get(ValetRequest, valet_id)
        if not req or req.status != "REQUESTED" or req.driver_id is not None:
            raise utils.ApiError("This valet request is no longer available.", 409, "already_taken")
        if driver.availability.status == "BUSY" or has_active_job(driver):
            raise utils.ApiError("You already have an active job.", 409, "busy")
        req.driver_id, req.status, req.assigned_at = driver.id, "DRIVER_ASSIGNED", utils.now_utc()
        db.session.add(ValetStatusHistory(valet_id=req.id, status="DRIVER_ASSIGNED"))
        _set_busy(driver)
        db.session.commit()
    return req


def reject_valet(driver, req):
    req = get_valet(req.id, driver=driver)
    if req.status != "DRIVER_ASSIGNED":
        raise utils.ApiError("You can only back out before heading to pickup.", 409, "bad_state")
    req.driver_id, req.status, req.assigned_at = None, "REQUESTED", None
    db.session.add(ValetStatusHistory(valet_id=req.id, status="REQUESTED", note="Driver backed out - back in the pool"))
    _set_free(driver)
    db.session.commit()
    return req


def advance_valet(driver, req, action):
    req = get_valet(req.id, driver=driver)
    if action == "going-to-pickup":
        _require(req.status == "DRIVER_ASSIGNED", "Accept the job first.")
        req.status, req.going_to_pickup_at = "DRIVER_GOING_TO_PICKUP", utils.now_utc()
        db.session.add(ValetStatusHistory(valet_id=req.id, status=req.status))
    elif action == "in-transit":
        _require(req.status == "VEHICLE_PICKED_UP", "Record the pickup handover first.")
        req.status, req.in_transit_at = "VEHICLE_IN_TRANSIT", utils.now_utc()
        db.session.add(ValetStatusHistory(valet_id=req.id, status=req.status))
    else:
        raise utils.ApiError("Unknown action.", 404, "unknown_action")
    db.session.commit()
    return req


def record_handover(driver, req, stage, data):
    """stage: 'pickup' (DRIVER_GOING_TO_PICKUP -> VEHICLE_PICKED_UP) or
    'dropoff' (VEHICLE_IN_TRANSIT -> VEHICLE_DROPPED). This doubles as the "handover upload"
    endpoint the spec asks for - proof is captured exactly at the transition it belongs to."""
    req = get_valet(req.id, driver=driver)
    if stage == "pickup":
        _require(req.status == "DRIVER_GOING_TO_PICKUP", "Mark yourself as heading to pickup first.")
        req.status, req.picked_up_at = "VEHICLE_PICKED_UP", utils.now_utc()
    elif stage == "dropoff":
        _require(req.status == "VEHICLE_IN_TRANSIT", "Mark the vehicle in transit first.")
        req.status, req.dropped_at = "VEHICLE_DROPPED", utils.now_utc()
    else:
        raise utils.ApiError("Unknown handover stage.", 404, "unknown_action")
    handover = VehicleHandover(
        valet_id=req.id, stage=stage, photo=_photo_field(data, "photo"),
        vehicle_number=req.vehicle_number, condition_notes=(data.get("condition_notes") or "").strip()[:500] or None,
        fuel_level_percent=(utils.as_int(data.get("fuel_level_percent"), "fuel_level_percent", 0, 100)
                            if stage == "pickup" and data.get("fuel_level_percent") is not None else None),
        location_label=(data.get("location_label") or "").strip()[:160] or None)
    db.session.add(handover)
    db.session.add(ValetStatusHistory(valet_id=req.id, status=req.status, note=f"{stage} handover recorded"))
    db.session.commit()
    return req


def complete_valet(driver, req):
    req = get_valet(req.id, driver=driver)
    _require(req.status == "VEHICLE_DROPPED", "The vehicle must be dropped off before completing.")
    fee = utils.money(cfg("VALET_BASE_FEE") + req.distance_km * cfg("VALET_PER_KM_RATE"))
    req.fee, req.status, req.completed_at = fee, "COMPLETED", utils.now_utc()
    req.platform_fee = utils.money(fee * cfg("PLATFORM_COMMISSION_PERCENT") / 100.0)
    req.driver_earning = utils.money(fee - req.platform_fee)
    db.session.add(ValetStatusHistory(valet_id=req.id, status="COMPLETED"))
    _set_free(driver)
    db.session.commit()
    return req


def pay_valet_fee(rider, req, payment):
    req = get_valet(req.id, rider=rider)
    if req.paid or req.fee <= 0:
        raise utils.ApiError("There is nothing to pay on this valet request.", 409, "no_fee_due")
    txn = payments.charge(rider, req.fee, payment, "valet_fee", lot_id=req.lot_id)
    txn.valet_id = req.id
    req.paid = True
    db.session.commit()
    return req


# =============================================================================== ratings
def rate_driver(rider, driver_id, ride_id=None, valet_id=None, stars=0, review=None):
    stars = utils.as_int(stars, "stars", 1, 5)
    ride = valet = None
    if ride_id:
        ride = get_ride(ride_id, rider=rider)
        if ride.status != "RIDE_COMPLETED":
            raise utils.ApiError("You can only rate a completed ride.", 409, "not_completed")
        if ride.rating:
            raise utils.ApiError("You already rated this ride.", 409, "already_rated")
        driver_id = ride.driver_id
    elif valet_id:
        valet = get_valet(valet_id, rider=rider)
        if valet.status != "COMPLETED":
            raise utils.ApiError("You can only rate a completed valet job.", 409, "not_completed")
        if valet.rating:
            raise utils.ApiError("You already rated this valet job.", 409, "already_rated")
        driver_id = valet.driver_id
    else:
        raise utils.ApiError("ride_id or valet_id is required.", 400, "missing_target")
    rating = DriverRating(driver_id=driver_id, ride_id=ride.id if ride else None, valet_id=valet.id if valet else None,
                          rider_id=rider.id, stars=stars, review=(review or "").strip()[:500] or None)
    db.session.add(rating)
    db.session.commit()
    driver = db.session.get(Driver, driver_id)
    if driver:
        notify(driver, "new_rating", "New rating received", f"You received {stars}★" + (f' - "{rating.review}"' if rating.review else ""))
        db.session.commit()
    return rating


# =============================================================================== earnings / notifications
def earnings_summary(driver):
    now = utils.now_utc()
    today = utils.local_date(now, cfg("APP_TIMEZONE"))

    ride_fares = (RideFare.query.join(Ride).filter(Ride.driver_id == driver.id, RideFare.paid.is_(True)).all())
    valet_jobs = ValetRequest.query.filter_by(driver_id=driver.id, paid=True).filter(ValetRequest.fee > 0).all()

    def is_today(dt):
        return dt is not None and utils.local_date(dt, cfg("APP_TIMEZONE")) == today

    ride_earn = utils.money(sum(f.driver_earning for f in ride_fares))
    valet_earn = utils.money(sum(v.driver_earning for v in valet_jobs))
    ride_today = utils.money(sum(f.driver_earning for f in ride_fares if is_today(f.ride.completed_at)))
    valet_today = utils.money(sum(v.driver_earning for v in valet_jobs if is_today(v.completed_at)))
    cancel_earn = utils.money(sum(f.driver_earning for f in ride_fares if f.cancellation_fee > 0)
                              + sum(v.driver_earning for v in valet_jobs if v.cancellation_fee > 0))

    completed_rides = Ride.query.filter_by(driver_id=driver.id, status="RIDE_COMPLETED").count()
    completed_valet = ValetRequest.query.filter_by(driver_id=driver.id, status="COMPLETED").count()
    cancelled_rides = Ride.query.filter_by(driver_id=driver.id, status="CANCELLED").count()
    cancelled_valet = ValetRequest.query.filter_by(driver_id=driver.id, status="CANCELLED").count()

    txns = (PaymentTransaction.query.filter(db.or_(
        PaymentTransaction.ride_id.in_([f.ride_id for f in ride_fares] or [-1]),
        PaymentTransaction.valet_id.in_([v.id for v in valet_jobs] or [-1])))
        .order_by(PaymentTransaction.created_at.desc()).limit(50).all())

    return {
        "total_earnings": utils.money(ride_earn + valet_earn), "today_earnings": utils.money(ride_today + valet_today),
        "ride_earnings": ride_earn, "valet_earnings": valet_earn, "cancellation_earnings": cancel_earn,
        "completed_rides": completed_rides, "completed_valet_jobs": completed_valet,
        "cancelled_rides": cancelled_rides, "cancelled_valet_jobs": cancelled_valet,
        "transactions": [{"ref": t.txn_ref, "amount": t.amount, "purpose": t.purpose, "at": utils.to_iso(t.created_at),
                          "ride_id": t.ride_id, "valet_id": t.valet_id} for t in txns],
    }


def rating_summary(driver):
    ratings = driver.ratings
    n = len(ratings)
    avg = round(sum(r.stars for r in ratings) / n, 2) if n else None
    recent = sorted(ratings, key=lambda r: r.id, reverse=True)[:10]
    return {"average": avg, "count": n,
            "recent": [{"stars": r.stars, "review": r.review, "at": utils.to_iso(r.created_at)} for r in recent]}


def list_notifications(driver, unread_only=False):
    q = DriverNotification.query.filter_by(driver_id=driver.id)
    if unread_only:
        q = q.filter(DriverNotification.read_at.is_(None))
    return q.order_by(DriverNotification.created_at.desc()).limit(100).all()


def mark_notifications_read(driver, notif_id=None):
    q = DriverNotification.query.filter_by(driver_id=driver.id, read_at=None)
    if notif_id:
        q = q.filter_by(id=notif_id)
    now = utils.now_utc()
    n = q.update({"read_at": now}, synchronize_session=False)
    db.session.commit()
    return n


# =============================================================================== serialization
def serialize_vehicle(v):
    return {"id": v.id, "reg_number": v.reg_number, "manufacturer": v.manufacturer, "model": v.model,
            "vehicle_type": v.vehicle_type, "colour": v.colour, "year": v.year,
            "seating_capacity": v.seating_capacity, "photo": v.photo,
            "registration_expiry": utils.to_iso(datetime.combine(v.registration_expiry, datetime.min.time())) if v.registration_expiry else None,
            "insurance_expiry": utils.to_iso(datetime.combine(v.insurance_expiry, datetime.min.time())) if v.insurance_expiry else None,
            "status": v.status, "reject_reason": v.reject_reason, "created_at": utils.to_iso(v.created_at)}


def serialize_driver(driver, detail=False, for_admin=False):
    d = {
        "id": driver.id, "user_id": driver.user_id, "driver_type": driver.driver_type,
        "full_name": driver.full_name, "email": driver.user.email, "phone": driver.user.phone,
        "kyc_status": driver.kyc_status, "account_status": driver.account_status,
        "is_verified": driver.is_verified, "can_go_online": driver.can_go_online,
        "availability": driver.availability.status if driver.availability else "OFFLINE",
        "created_at": utils.to_iso(driver.created_at),
    }
    if detail or for_admin:
        d.update({
            "dob": utils.to_iso(datetime.combine(driver.dob, datetime.min.time())) if driver.dob else None,
            "address": driver.address, "profile_photo": driver.profile_photo,
            "licence_number": driver.licence_number, "licence_document": driver.licence_document,
            "licence_expiry": utils.to_iso(datetime.combine(driver.licence_expiry, datetime.min.time())) if driver.licence_expiry else None,
            "suspend_reason": driver.suspend_reason,
            "vehicles": [serialize_vehicle(v) for v in driver.vehicles],
        })
    if for_admin:
        rs = rating_summary(driver)
        d.update({"rating_average": rs["average"], "rating_count": rs["count"],
                  "kyc_reject_reason": (driver.latest_kyc.reject_reason if driver.latest_kyc else None)})
    return d


def _lot_brief(lot):
    return {"id": lot.id, "name": lot.name, "address": lot.address, "city": lot.city} if lot else None


def serialize_ride(ride, include_rider=False, include_driver=True):
    fare = ride.fare
    data = {
        "id": ride.id, "code": ride.code, "status": ride.status,
        "pickup_label": ride.pickup_label, "drop_label": ride.drop_label, "distance_km": ride.distance_km,
        "pickup_lat": ride.pickup_lat, "pickup_lng": ride.pickup_lng,
        "drop_lat": ride.drop_lat, "drop_lng": ride.drop_lng,
        "reservation_id": ride.reservation_id, "requested_at": utils.to_iso(ride.requested_at),
        "accepted_at": utils.to_iso(ride.accepted_at), "arriving_at": utils.to_iso(ride.arriving_at),
        "arrived_at": utils.to_iso(ride.arrived_at), "started_at": utils.to_iso(ride.started_at),
        "completed_at": utils.to_iso(ride.completed_at), "cancelled_at": utils.to_iso(ride.cancelled_at),
        "cancelled_by": ride.cancelled_by, "cancel_reason": ride.cancel_reason,
        "rated": bool(ride.rating),
        "fare": ({"base_fare": fare.base_fare, "distance_fare": fare.distance_fare, "time_fare": fare.time_fare,
                  "waiting_fee": fare.waiting_fee, "cancellation_fee": fare.cancellation_fee,
                  "surge_multiplier": fare.surge_multiplier, "total": fare.total, "paid": fare.paid}
                if fare else None),
        "actions": {
            "can_accept": ride.status == "REQUESTED" and ride.driver_id is None,
            "can_reject": ride.status in ("ACCEPTED", "DRIVER_ARRIVING"),
            "can_arriving": ride.status == "ACCEPTED", "can_arrived": ride.status == "DRIVER_ARRIVING",
            "can_start": ride.status == "DRIVER_ARRIVED", "can_complete": ride.status == "RIDE_STARTED",
            "can_cancel": ride.status in RIDE_ACTIVE,
            "can_pay": bool(fare and not fare.paid and fare.total > 0),
            "can_rate": ride.status == "RIDE_COMPLETED" and not ride.rating,
        },
    }
    if include_rider:
        data["rider"] = {"id": ride.rider.id, "username": ride.rider.username, "phone": ride.rider.phone}
    if include_driver:
        data["driver"] = ({"id": ride.driver.id, "full_name": ride.driver.full_name,
                           "phone": ride.driver.user.phone,
                           "vehicle": serialize_vehicle(ride.driver.approved_vehicle) if ride.driver.approved_vehicle else None}
                          if ride.driver else None)
    return data


def serialize_handover(h):
    return {"stage": h.stage, "photo": h.photo, "vehicle_number": h.vehicle_number,
            "condition_notes": h.condition_notes, "fuel_level_percent": h.fuel_level_percent,
            "location_label": h.location_label, "at": utils.to_iso(h.created_at)}


def serialize_valet(req, include_rider=False, include_driver=True):
    data = {
        "id": req.id, "code": req.code, "status": req.status, "request_type": req.request_type,
        "vehicle_number": req.vehicle_number, "pickup_label": req.pickup_label, "drop_label": req.drop_label,
        "distance_km": req.distance_km,
        "pickup_lat": req.pickup_lat, "pickup_lng": req.pickup_lng,
        "drop_lat": req.drop_lat, "drop_lng": req.drop_lng,
        "lot": _lot_brief(req.lot), "reservation_id": req.reservation_id,
        "requested_at": utils.to_iso(req.requested_at), "assigned_at": utils.to_iso(req.assigned_at),
        "going_to_pickup_at": utils.to_iso(req.going_to_pickup_at), "picked_up_at": utils.to_iso(req.picked_up_at),
        "in_transit_at": utils.to_iso(req.in_transit_at), "dropped_at": utils.to_iso(req.dropped_at),
        "completed_at": utils.to_iso(req.completed_at), "cancelled_at": utils.to_iso(req.cancelled_at),
        "cancelled_by": req.cancelled_by, "cancel_reason": req.cancel_reason,
        "fee": req.fee, "cancellation_fee": req.cancellation_fee, "paid": req.paid, "rated": bool(req.rating),
        "handovers": [serialize_handover(h) for h in req.handovers],
        "actions": {
            "can_accept": req.status == "REQUESTED" and req.driver_id is None,
            "can_reject": req.status == "DRIVER_ASSIGNED",
            "can_go_to_pickup": req.status == "DRIVER_ASSIGNED",
            "can_record_pickup": req.status == "DRIVER_GOING_TO_PICKUP",
            "can_in_transit": req.status == "VEHICLE_PICKED_UP",
            "can_record_dropoff": req.status == "VEHICLE_IN_TRANSIT",
            "can_complete": req.status == "VEHICLE_DROPPED",
            "can_cancel": req.status in VALET_ACTIVE,
            "can_pay": bool(not req.paid and req.fee > 0 and req.status in ("COMPLETED", "CANCELLED")),
            "can_rate": req.status == "COMPLETED" and not req.rating,
        },
    }
    if include_rider:
        data["rider"] = {"id": req.rider.id, "username": req.rider.username, "phone": req.rider.phone}
    if include_driver:
        data["driver"] = ({"id": req.driver.id, "full_name": req.driver.full_name, "phone": req.driver.user.phone}
                          if req.driver else None)
    return data


def serialize_notification(n):
    return {"id": n.id, "kind": n.kind, "title": n.title, "message": n.message, "ride_id": n.ride_id,
            "valet_id": n.valet_id, "read": n.read_at is not None, "at": utils.to_iso(n.created_at)}
