"""First-run data: roles, amenity catalogue, subscription plans and (optionally) a demo dataset.

Everything is idempotent - running it twice never duplicates anything.
"""
import json
import random
from datetime import date, timedelta

from flask import current_app
from flask_security import hash_password

from . import availability, utils
from .database import db
from .models import (Amenity, BookingEvent, Driver, DriverAvailability, DriverKYC, DriverRating, DriverVehicle,
                     LotAmenity, ParkingLot, PaymentTransaction, Reservation, ReservationAddon, Ride, RideFare,
                     Role, Subscription, SubscriptionPlan, User, ValetRequest, VehicleHandover)

# 1x1 px PNG, used as a stand-in "photo"/"document" everywhere this file needs one - there is no
# real file storage in this app (see FIXES.md), so a demo profile photo/licence/handover shot is
# just this same tiny data: URI, same as a real upload would be after the browser base64-encodes it.
_DUMMY_PHOTO = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
               "+A8AAQUBAScY42YAAAAASUVORK5CYII=")

AMENITIES = [
    # code, name, icon, category, description, price, unit, order
    ("ev_charging", "EV Charging", "bi-ev-station", "bookable", "Fast-charging bay next to your slot (billed per hour parked).", 50, "per_hour", 1),
    ("car_wash", "Car Wash", "bi-droplet-half", "bookable", "Foam wash while you are away - your car is ready when you return.", 250, "per_booking", 2),
    ("valet", "Valet Service", "bi-key", "bookable", "Hand over the keys at the gate; we park and fetch your car.", 100, "per_booking", 3),
    ("fuel", "Fuel Station", "bi-fuel-pump", "onsite", "Petrol, diesel and CNG on the premises. Pay at the pump.", 0, "pay_at_counter", 4),
    ("garage", "Garage & Service Bay", "bi-tools", "onsite", "Quick repairs, tyre & battery service. Pay at the workshop.", 0, "pay_at_counter", 5),
    ("car_gadgets", "Car Gadgets Shop", "bi-camera-video", "onsite", "Dash-cams, phone mounts, chargers, seat covers and more.", 0, "pay_at_counter", 6),
    ("convenience", "Convenience Store", "bi-shop", "onsite", "Water, snacks and everyday essentials.", 0, "pay_at_counter", 7),
    ("cafe", "Cafe", "bi-cup-hot", "onsite", "Coffee and quick bites while you wait.", 0, "pay_at_counter", 8),
    ("restroom", "Restrooms", "bi-people", "onsite", "Clean restrooms on every level.", 0, "free", 9),
    ("air_pump", "Air & Tyre Pump", "bi-wind", "onsite", "Free tyre inflation.", 0, "free", 10),
    ("atm", "ATM", "bi-cash-coin", "onsite", "24x7 ATM in the lobby.", 0, "free", 11),
    ("security", "24x7 Security & CCTV", "bi-shield-check", "onsite", "Guarded, camera-covered premises.", 0, "free", 12),
]

USER_PLANS = [
    dict(name="Free Roam", plan_type="user", billing_interval="monthly", duration_days=30, price=1299,
         free_parkings=2, free_washes=0, badge=None,
         description="Two free parkings a month. Perfect for occasional trips.",
         features=["2 free parkings (first 4 h each)", "Priority support"]),
    dict(name="Commuter Pro", plan_type="user", billing_interval="monthly", duration_days=180, price=4499,
         free_parkings=15, free_washes=3, badge="Popular",
         description="Your daily commute, sorted. 15 free parkings and 3 free car washes.",
         features=["15 free parkings (first 4 h each)", "3 free car washes", "6-month validity"]),
    dict(name="Elite Parker", plan_type="user", billing_interval="annually", duration_days=365, price=9599,
         free_parkings=31, free_washes=10, badge="Best value",
         description="A year of stress-free parking with 31 free parkings and 10 washes.",
         features=["31 free parkings (first 4 h each)", "10 free car washes", "12-month validity"]),
]
ADMIN_PLANS = [
    dict(name="Admin Basic", plan_type="admin", billing_interval="monthly", duration_days=30, price=1999,
         max_lots=5, description="Run up to 5 parking lots.", features=["Up to 5 lots", "Live operations console"]),
    dict(name="Admin Pro", plan_type="admin", billing_interval="monthly", duration_days=30, price=4999,
         max_lots=20, badge="Popular", description="Run up to 20 parking lots.",
         features=["Up to 20 lots", "Live operations console", "Revenue analytics"]),
    dict(name="Admin Unlimited", plan_type="admin", billing_interval="annually", duration_days=365, price=14999,
         max_lots=None, description="Unlimited lots for a year.", features=["Unlimited lots", "Everything in Pro"]),
]

DEMO_LOTS = [
    dict(name="Central Mall Parking", address="12 MG Road", city="Bengaluru", pin_code="560001", rows=4, columns=6,
         floors=2, price=40, lat=12.9756, lng=77.6068, phone="+91 80 4000 1100", supervisor="Ravi Kumar",
         description="Covered multi-level parking in the heart of the city, connected to the mall's main entrance.",
         amenities={"ev_charging": (50, "Level 1, right-hand column"), "car_wash": (250, "Level 1, wash bay near exit"),
                    "valet": (100, "Main entrance drop-off"), "fuel": (0, "Petrol pump opposite the exit gate"),
                    "garage": (0, "Ground level, behind the ramp"), "car_gadgets": (0, "Ground floor, next to the lift"),
                    "convenience": (0, "Ground floor lobby"), "cafe": (0, "Ground floor lobby"),
                    "restroom": (0, "Every level near the lift"), "air_pump": (0, "Near the entry ramp"),
                    "atm": (0, "Lobby"), "security": (0, "Whole premises")}),
    dict(name="Tech Park Tower P2", address="Whitefield Main Road", city="Bengaluru", pin_code="560066", rows=3,
         columns=6, floors=3, price=30, lat=12.9698, lng=77.7500, phone="+91 80 4000 2200", supervisor="Anita Rao",
         description="Office-hours friendly parking with EV bays and same-day car wash.",
         amenities={"ev_charging": (50, "Level 1, end of each row"), "car_wash": (200, "Basement wash bay"),
                    "car_gadgets": (0, "Level 1 kiosk"), "cafe": (0, "Food court, ground floor"),
                    "restroom": (0, "Every level"), "air_pump": (0, "Entry ramp"), "security": (0, "Whole premises")}),
    dict(name="Central Station Basement", address="Poonamallee High Road", city="Chennai", pin_code="600003",
         rows=5, columns=8, floors=1, price=20, lat=13.0827, lng=80.2707, phone="+91 44 4000 3300",
         supervisor="Suresh Babu", description="Budget parking a two-minute walk from the railway station.",
         amenities={"fuel": (0, "Fuel station across the road"), "garage": (0, "Adjacent service bay"),
                    "convenience": (0, "Station forecourt"), "restroom": (0, "Near the stairs"),
                    "atm": (0, "Station entrance"), "security": (0, "Whole premises")}),
]


def seed_core():
    ds = current_app.security.datastore
    ds.find_or_create_role(name="admin", description="Parking lot owner / administrator")
    ds.find_or_create_role(name="user", description="Driver")
    # NOTE ON NAMING: the role above ('user') is what the rest of this app's UI calls "Driver" -
    # the person who parks a vehicle (see README/nav "Drivers"). The role below is a different,
    # new persona: a ride-captain/valet driver *partner* who drives people or their cars around.
    # To keep the two apart on screen, this project's own UI copy always says "driver partner"
    # for this one - the role name itself still matches the spec ('driver').
    ds.find_or_create_role(name="driver", description="Ride captain / valet driver partner")
    db.session.commit()

    for code, name, icon, cat, desc, price, unit, order in AMENITIES:
        if not Amenity.query.filter_by(code=code).first():
            db.session.add(Amenity(code=code, name=name, icon=icon, category=cat, description=desc,
                                   default_price=price, price_unit=unit, sort_order=order))
    for p in USER_PLANS + ADMIN_PLANS:
        if not SubscriptionPlan.query.filter_by(name=p["name"]).first():
            feats = p.pop("features", [])
            db.session.add(SubscriptionPlan(features_json=json.dumps(feats), **p))
            p["features"] = feats
    db.session.commit()


def _ensure_user(email, username, role, welcome_used=0):
    ds = current_app.security.datastore
    u = ds.find_user(email=email)
    if not u:
        u = ds.create_user(email=email, username=username, password=hash_password("password"), active=True,
                           roles=[role], free_minutes_allowed=current_app.config["WELCOME_FREE_MINUTES"],
                           free_minutes_used=welcome_used)
        db.session.commit()
    return u


def _ensure_driver_partner(email, username, full_name, driver_type, phone, vehicle=None):
    """Demo ride-captain / valet-driver account - pre-verified (KYC + vehicle already APPROVED,
    availability AVAILABLE) so a fresh demo walkthrough can request/accept a ride or valet job
    immediately, without first walking through the KYC/vehicle approval steps by hand (those are
    covered on their own by the registration/approval flows - this is just a ready-to-use demo
    login, matching the credentials PartnerLogin.js's "demo driver partner accounts" box offers).
    Idempotent like _ensure_user - safe to call on every startup."""
    ds = current_app.security.datastore
    u = ds.find_user(email=email)
    if u:
        return u.driver_profile
    u = ds.create_user(email=email, username=username, password=hash_password("password"), active=True,
                       roles=["driver"], phone=phone, free_minutes_allowed=0)
    db.session.commit()

    driver = Driver(user_id=u.id, driver_type=driver_type, full_name=full_name, dob=date(1994, 6, 12),
                    address="Bengaluru, Karnataka", profile_photo=_DUMMY_PHOTO,
                    licence_number=utils.gen_code("DL", 8).replace("-", ""), licence_document=_DUMMY_PHOTO,
                    licence_expiry=date.today() + timedelta(days=900), account_status="active")
    db.session.add(driver)
    db.session.flush()
    db.session.add(DriverKYC(driver_id=driver.id, status="APPROVED", reviewed_at=utils.now_utc()))
    db.session.add(DriverAvailability(driver_id=driver.id, status="AVAILABLE"))
    if vehicle:
        db.session.add(DriverVehicle(driver_id=driver.id, status="APPROVED", photo=_DUMMY_PHOTO,
                                     registration_expiry=date.today() + timedelta(days=400),
                                     insurance_expiry=date.today() + timedelta(days=300), **vehicle))
    db.session.commit()
    return driver


def seed_demo():
    """Demo owner, demo drivers, 3 lots and two weeks of booking history for the charts."""
    admin = _ensure_user("user@admin.com", "admin", "admin")
    driver = _ensure_user("user@user.com", "user1", "user", welcome_used=current_app.config["WELCOME_FREE_MINUTES"])
    extra = [_ensure_user("rahul@example.com", "rahul", "user", 60), _ensure_user("priya@example.com", "priya", "user", 60),
             _ensure_user("amit@example.com", "amit", "user", 60)]
    driver.phone = driver.phone or "+91 98450 12345"
    admin.phone = admin.phone or "+91 98860 00000"

    # Demo driver PARTNERS (ride captain / valet driver) - already KYC/vehicle-approved and online,
    # matching the credentials PartnerLogin.js/PartnerRegister.js's demo box offers. Created every
    # startup like admin/driver above (idempotent), independent of the "lots already seeded" guard
    # below so they exist even if this ran once before lots did.
    captain = _ensure_driver_partner(
        "captain@driver.com", "rajeshcaptain", "Rajesh Kumar", "ride_captain", "+91 98450 55501",
        vehicle=dict(reg_number="KA05RC1234", manufacturer="Toyota", model="Etios", vehicle_type="car",
                    colour="White", year=2021, seating_capacity=4))
    valet_driver = _ensure_driver_partner(
        "valet@driver.com", "meenavalet", "Meena Iyer", "valet_driver", "+91 98450 55502")

    now = utils.now_utc()
    if not Subscription.query.filter_by(user_id=admin.id).first():
        plan = SubscriptionPlan.query.filter_by(name="Admin Basic").first()
        db.session.add(Subscription(user_id=admin.id, plan_id=plan.id, status="active", start_date=now,
                                    end_date=now + timedelta(days=30)))
    db.session.commit()

    if ParkingLot.query.count():
        return
    by_code = {a.code: a for a in Amenity.query.all()}
    for spec in DEMO_LOTS:
        lot = ParkingLot(admin_id=admin.id, name=spec["name"], description=spec["description"],
                         address=spec["address"], city=spec["city"], pin_code=spec["pin_code"],
                         latitude=spec["lat"], longitude=spec["lng"], phone=spec["phone"],
                         supervisor_name=spec["supervisor"], rows=spec["rows"], columns=spec["columns"],
                         floors=spec["floors"], number_of_spots=0, price_per_hour=spec["price"],
                         buffer_minutes=current_app.config["BUFFER_MINUTES_DEFAULT"])
        db.session.add(lot)
        db.session.flush()
        for code, (price, hint) in spec["amenities"].items():
            lot.amenities.append(LotAmenity(amenity_id=by_code[code].id, price=price or by_code[code].default_price,
                                            location_hint=hint))
        db.session.flush()
        lot.sync_slots()
    db.session.commit()

    _seed_history([driver] + extra, now)
    _seed_driver_history(captain, valet_driver, [driver] + extra, now)


def _seed_history(drivers, now):
    rnd = random.Random(42)
    lots = ParkingLot.query.all()
    made = 0
    for day in range(14, 0, -1):
        for _ in range(rnd.randint(3, 7)):
            lot = rnd.choice(lots)
            slot = rnd.choice(lot.live_slots())
            user = rnd.choice(drivers)
            start = (now - timedelta(days=day)).replace(hour=rnd.randint(3, 14), minute=rnd.choice([0, 15, 30, 45]),
                                                        second=0, microsecond=0)
            minutes = rnd.choice([60, 90, 120, 180, 240])
            end = start + timedelta(minutes=minutes)
            try:
                availability.assert_slot_free(slot, start, end, now)
            except utils.ApiError:
                continue
            vehicle = "KA0%dAB%04d" % (rnd.randint(1, 9), rnd.randint(1000, 9999))
            fee = utils.money(lot.price_per_hour * minutes / 60.0)
            addon_total = 0.0
            over = rnd.choice([0, 0, 0, 0, 20, 35]) if rnd.random() < 0.9 else 0
            out = end + timedelta(minutes=over)
            res = Reservation(
                code=utils.gen_code("VP"), user_id=user.id, lot_id=lot.id, slot_id=slot.id, vehicle_number=vehicle,
                start_time=start, end_time=end, original_end_time=end, hourly_rate=lot.price_per_hour,
                buffer_minutes=lot.buffer_minutes, state="completed", checked_in_at=start,
                checked_out_at=out if over else end - timedelta(minutes=rnd.choice([0, 5, 10])),
                base_amount=fee, addons_amount=addon_total, payment_method="card: •••• 4444", created_at=start - timedelta(hours=3))
            if over:
                from . import pricing
                o, f = pricing.fine_for(res, out)
                res.overstay_minutes, res.fine_amount, res.fine_status = o, f, "paid"
            db.session.add(res)
            db.session.flush()
            db.session.add(PaymentTransaction(txn_ref="TXN" + utils.gen_code("", 12).lstrip("-"), user_id=user.id,
                                              reservation_id=res.id, lot_id=lot.id, amount=fee, method="card",
                                              method_detail="•••• 4444", purpose="booking", status="success",
                                              created_at=start - timedelta(hours=3)))
            if res.fine_amount:
                db.session.add(PaymentTransaction(txn_ref="TXN" + utils.gen_code("", 12).lstrip("-"), user_id=user.id,
                                                  reservation_id=res.id, lot_id=lot.id, amount=res.fine_amount,
                                                  method="card", method_detail="•••• 4444", purpose="fine",
                                                  status="success", created_at=out))
            db.session.add(BookingEvent(reservation_id=res.id, kind="created", message="Booked", amount=fee,
                                        created_at=start - timedelta(hours=3)))
            made += 1
    db.session.commit()
    return made


_RIDE_ROUTES = [
    ("Koramangala 5th Block", "Kempegowda International Airport", 32.0),
    ("Indiranagar 100ft Road", "Whitefield ITPL", 14.5),
    ("MG Road Metro Station", "Electronic City Phase 1", 18.0),
    ("HSR Layout Sector 2", "Central Mall Parking", 6.5),
    ("Jayanagar 4th Block", "Cubbon Park", 9.0),
    ("Marathahalli Bridge", "Tech Park Tower P2", 5.0),
]
_VALET_ROUTES = [   # request_type, pickup (None = the lot), drop (None = the lot), distance_km
    ("home_to_lot", "My home, Koramangala", None, 4.0),
    ("lot_to_home", None, "My home, Indiranagar", 6.0),
    ("location_to_lot", "Client office, Whitefield", None, 11.0),
    ("lot_to_location", None, "Forum Mall, Koramangala", 5.5),
]
_REVIEWS = ["Smooth ride, right on time.", "Very polite and careful driver.", "Great experience, would book again.",
           "Car handed back in perfect condition.", "Quick and professional.", None]


def _seed_driver_history(captain, valet_driver, riders, now):
    """A handful of completed, paid, rated rides (captain) and valet jobs (valet driver) spread
    over the last two weeks - so Earnings/Ratings on the driver-partner side, and Rides & valet
    jobs/Driver partner revenue on the admin side, have something to show right after a fresh
    install instead of an empty state. Same spirit as _seed_history() above, for this domain."""
    if Ride.query.count() or ValetRequest.query.count():
        return
    rnd = random.Random(7)
    lot = ParkingLot.query.first()
    base_fare, per_km, per_min = (current_app.config["RIDE_BASE_FARE"], current_app.config["RIDE_PER_KM_RATE"],
                                  current_app.config["RIDE_PER_MIN_RATE"])
    commission = current_app.config["PLATFORM_COMMISSION_PERCENT"]
    valet_base, valet_per_km = current_app.config["VALET_BASE_FEE"], current_app.config["VALET_PER_KM_RATE"]

    for i, (pickup, drop, dist) in enumerate(_RIDE_ROUTES):
        rider = rnd.choice(riders)
        requested = now - timedelta(days=13 - i * 2, hours=rnd.randint(1, 10))
        minutes = rnd.randint(12, 40)
        accepted = requested + timedelta(minutes=1)
        arrived = accepted + timedelta(minutes=rnd.randint(3, 8))
        started = arrived + timedelta(minutes=1)
        completed = started + timedelta(minutes=minutes)
        ride = Ride(code=utils.gen_code("RD"), rider_id=rider.id, driver_id=captain.id, pickup_label=pickup,
                   drop_label=drop, distance_km=dist, status="RIDE_COMPLETED", requested_at=requested,
                   accepted_at=accepted, arriving_at=accepted, arrived_at=arrived, started_at=started,
                   completed_at=completed)
        db.session.add(ride)
        db.session.flush()
        total = utils.money(base_fare + dist * per_km + minutes * per_min)
        platform_fee = utils.money(total * commission / 100.0)
        db.session.add(RideFare(ride_id=ride.id, base_fare=base_fare, distance_fare=utils.money(dist * per_km),
                                time_fare=utils.money(minutes * per_min), total=total, platform_fee=platform_fee,
                                driver_earning=utils.money(total - platform_fee), paid=True))
        db.session.add(PaymentTransaction(txn_ref="TXN" + utils.gen_code("", 12).lstrip("-"), user_id=rider.id,
                                          ride_id=ride.id, amount=total, method="card", method_detail="•••• 4444",
                                          purpose="ride_fare", status="success", created_at=completed))
        db.session.add(DriverRating(driver_id=captain.id, ride_id=ride.id, rider_id=rider.id,
                                    stars=rnd.choice([4, 4, 5, 5, 5]), review=rnd.choice(_REVIEWS),
                                    created_at=completed))

    for i, (req_type, pickup, drop, dist) in enumerate(_VALET_ROUTES):
        rider = rnd.choice(riders)
        requested = now - timedelta(days=12 - i * 3, hours=rnd.randint(1, 10))
        assigned = requested + timedelta(minutes=1)
        going = assigned + timedelta(minutes=1)
        picked = going + timedelta(minutes=rnd.randint(4, 9))
        transit = picked + timedelta(minutes=1)
        dropped = transit + timedelta(minutes=rnd.randint(8, 20))
        completed = dropped + timedelta(minutes=1)
        fee = utils.money(valet_base + dist * valet_per_km)
        platform_fee = utils.money(fee * commission / 100.0)
        req = ValetRequest(code=utils.gen_code("VL"), rider_id=rider.id, driver_id=valet_driver.id,
                           lot_id=lot.id if lot else None, request_type=req_type,
                           vehicle_number="KA0%dAB%04d" % (rnd.randint(1, 9), rnd.randint(1000, 9999)),
                           pickup_label=pickup or (lot.name if lot else "Parking lot"),
                           drop_label=drop or (lot.name if lot else "Parking lot"), distance_km=dist,
                           status="COMPLETED", requested_at=requested, assigned_at=assigned,
                           going_to_pickup_at=going, picked_up_at=picked, in_transit_at=transit,
                           dropped_at=dropped, completed_at=completed, fee=fee, platform_fee=platform_fee,
                           driver_earning=utils.money(fee - platform_fee), paid=True)
        db.session.add(req)
        db.session.flush()
        db.session.add(VehicleHandover(valet_id=req.id, stage="pickup", photo=_DUMMY_PHOTO,
                                       vehicle_number=req.vehicle_number, fuel_level_percent=rnd.randint(40, 90),
                                       condition_notes="No visible damage.", location_label=req.pickup_label,
                                       created_at=picked))
        db.session.add(VehicleHandover(valet_id=req.id, stage="dropoff", photo=_DUMMY_PHOTO,
                                       vehicle_number=req.vehicle_number, condition_notes="Delivered clean.",
                                       location_label=req.drop_label, created_at=dropped))
        db.session.add(PaymentTransaction(txn_ref="TXN" + utils.gen_code("", 12).lstrip("-"), user_id=rider.id,
                                          valet_id=req.id, lot_id=lot.id if lot else None, amount=fee, method="upi",
                                          method_detail="demo@upi", purpose="valet_fee", status="success",
                                          created_at=completed))
        db.session.add(DriverRating(driver_id=valet_driver.id, valet_id=req.id, rider_id=rider.id,
                                    stars=rnd.choice([4, 5, 5, 5]), review=rnd.choice(_REVIEWS),
                                    created_at=completed))
    db.session.commit()
