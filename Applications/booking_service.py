"""Booking life-cycle: create -> (extend) -> check-in -> check-out -> (pay fine) | cancel.

All rules live here so the REST layer stays thin and the same logic serves users, admins and Celery.

Life-cycle (Reservation.display_status):
    upcoming  -> ready (check-in window open) -> parked -> overstay (time is up, still parked)
                                                 \\-> completed (checked out)  [+ fine if it overstayed]
    upcoming/ready without arrival after the end -> no_show
    cancelled
"""
import threading
from datetime import timedelta

from flask import current_app

from . import availability, payments, pricing, utils
from .database import db
from .models import (BookingEvent, ParkingLot, ParkingSpot, PaymentTransaction, Reservation,
                     ReservationAddon, Subscription, User)
from .task import dispatch, notify_booking_task

# SQLite has a single writer; this lock closes the "check availability -> insert" race between two
# requests in one process. (On PostgreSQL use SELECT ... FOR UPDATE / an exclusion constraint.)
BOOKING_LOCK = threading.RLock()


def cfg(name):
    return current_app.config[name]


def _event(res, kind, message, amount=None):
    db.session.add(BookingEvent(reservation_id=res.id, kind=kind, message=message, amount=amount,
                                created_at=utils.now_utc()))


def notify(res, kind, extra=None):
    try:
        dispatch(notify_booking_task, res.id, kind, extra)
    except Exception:                                   # a notification must never fail a booking
        current_app.logger.exception("could not dispatch %s notification", kind)


# =============================================================================== lookups
def get_bookable_lot(lot_id):
    lot = db.session.get(ParkingLot, lot_id)
    if not lot or lot.deleted_at or not lot.is_active:
        raise utils.ApiError("This parking lot is not available.", 404, "lot_not_found")
    return lot


def get_slot_in_lot(lot, slot_id):
    slot = db.session.get(ParkingSpot, slot_id)
    if not slot or slot.lot_id != lot.id or slot.retired:
        raise utils.ApiError("That slot does not belong to this lot.", 400, "bad_slot")
    return slot


def get_reservation(res_id, user=None, allow_admin_of_lot=False):
    res = db.session.get(Reservation, res_id)
    if not res:
        raise utils.ApiError("Booking not found.", 404, "not_found")
    if user is not None and res.user_id != user.id:
        if not (allow_admin_of_lot and user.is_admin and res.lot.admin_id == user.id):
            raise utils.ApiError("Booking not found.", 404, "not_found")
    return res


def assert_can_book(user):
    if not user.active:
        raise utils.ApiError("Your account is suspended. Contact support.", 403, "suspended")
    unpaid = Reservation.query.filter_by(user_id=user.id, fine_status="due").first()
    if unpaid:
        raise utils.ApiError(
            f"Please pay the overstay fine of ₹{unpaid.fine_amount:,.2f} on booking {unpaid.code} before booking again.",
            402, "fine_due", reservation_id=unpaid.id, fine=unpaid.fine_amount)


# =============================================================================== create
def quote_new(user, data):
    now = utils.now_utc()
    lot = get_bookable_lot(utils.as_int(data.get("lot_id"), "lot_id"))
    start = utils.parse_iso(data.get("start"), "start")
    end = utils.parse_iso(data.get("end"), "end")
    quote = pricing.build_quote(user, lot, start, end, data.get("addons") or [], now)
    slot = None
    if data.get("slot_id"):
        slot = get_slot_in_lot(lot, utils.as_int(data.get("slot_id"), "slot_id"))
        availability.assert_slot_free(slot, start, end, now)
    return lot, slot, start, end, quote, now


def create_booking(user, data):
    assert_can_book(user)
    lot, slot, start, end, quote, now = quote_new(user, data)
    if slot is None:
        raise utils.ApiError("Please choose a parking slot.", 400, "slot_required")
    vehicle = utils.normalize_vehicle(data.get("vehicle_number"))
    vtype = (data.get("vehicle_type") or "car").lower()
    if vtype not in ("car", "suv", "ev", "bike"):
        vtype = "car"

    with BOOKING_LOCK:
        now = utils.now_utc()
        availability.assert_slot_free(slot, start, end, now)          # re-check inside the lock
        availability.assert_vehicle_free(vehicle, start, end)

        # Charge FIRST: if the card is declined, charge() records the failed attempt and raises - and no
        # reservation exists yet, so nothing half-created can be committed.
        total = quote["total"]
        txn, payment_method = None, "free_allowance"
        if total > 0:
            txn = payments.charge(user, total, data.get("payment"), "booking", lot_id=lot.id)
            payment_method = f"{txn.method}: {txn.method_detail}"

        res = Reservation(
            code=_unique_code(), user_id=user.id, lot_id=lot.id, slot_id=slot.id,
            vehicle_number=vehicle, vehicle_type=vtype, start_time=start, end_time=end, original_end_time=end,
            hourly_rate=lot.price_per_hour, buffer_minutes=lot.buffer_minutes, state="confirmed",
            base_amount=quote["base"], discount_amount=quote["discount"],
            addons_amount=sum(a["total"] for a in quote["addons"]), payment_method=payment_method, created_at=now)
        db.session.add(res)
        db.session.flush()
        if txn is not None:
            txn.reservation_id = res.id

        for a in quote["addons"]:
            db.session.add(ReservationAddon(reservation_id=res.id, amenity_id=a["amenity_id"], code=a["code"],
                                            name=a["name"], unit_price=a["unit_price"], quantity=1, total=a["total"]))
        _consume_entitlements(user, res, quote)
        _event(res, "created", f"Booked slot {slot.full_label} at {lot.name}", total)
        if quote["discount"] > 0:
            _event(res, "discount", "Free allowance applied", -quote["discount"])
        db.session.commit()

    notify(res, "confirmed")
    return res


def _unique_code():
    for _ in range(8):
        code = utils.gen_code("VP")
        if not Reservation.query.filter_by(code=code).first():
            return code
    return utils.gen_code("VP", 10)


def _consume_entitlements(user, res, quote):
    ent = quote.get("entitlement")
    if not ent:
        return
    if ent["type"] == "subscription" and ent["covered_minutes"] > 0:
        sub = db.session.get(Subscription, ent["subscription_id"])
        if sub and sub.remaining_parkings > 0:
            sub.remaining_parkings -= 1
            res.parking_credit_used = True
            res.used_subscription_id = sub.id
    elif ent["type"] == "welcome":
        user.free_minutes_used = (user.free_minutes_used or 0) + ent["covered_minutes"]
        res.free_minutes_applied = ent["covered_minutes"]
    if ent.get("wash_credit") and ent.get("subscription_id"):
        sub = db.session.get(Subscription, ent["subscription_id"])
        if sub and sub.remaining_washes > 0:
            sub.remaining_washes -= 1
            res.wash_credit_used = True
            res.used_subscription_id = sub.id


def _restore_entitlements(res):
    """Give back free allowances when a booking is cancelled inside the free-cancellation window."""
    sub = db.session.get(Subscription, res.used_subscription_id) if res.used_subscription_id else None
    if sub and res.parking_credit_used:
        sub.remaining_parkings += 1
    if sub and res.wash_credit_used:
        sub.remaining_washes += 1
    if res.free_minutes_applied:
        res.user.free_minutes_used = max(0, (res.user.free_minutes_used or 0) - res.free_minutes_applied)


# =============================================================================== extend
def quote_extension(res, extra_minutes, now=None):
    now = now or utils.now_utc()
    block = cfg("BILLING_BLOCK_MINUTES")
    if res.state != "confirmed" or res.checked_out_at:
        raise utils.ApiError("Only a live booking can be extended.", 409, "not_extendable")
    if now > res.end_time:
        raise utils.ApiError("This booking has already run out. Extensions must be made before your time ends - "
                             "please check out (overstay fines apply).", 409, "expired")
    extra = utils.as_int(extra_minutes, "extra_minutes", minimum=block)
    if extra % block:
        raise utils.ApiError(f"Extend in multiples of {block} minutes.", 400, "bad_extension")
    max_extra = availability.max_extension_minutes(res, now)
    if extra > max_extra:
        if max_extra < block:
            raise utils.ApiError(
                f"This slot is reserved right after your booking (a {res.lot.buffer_minutes}-minute turnaround gap "
                "is kept between bookings), so it can't be extended.", 409, "extension_blocked",
                max_extra_minutes=0)
        raise utils.ApiError(
            f"You can extend by at most {pricing.fmt_duration(max_extra)} - the slot is booked after that "
            f"(plus a {res.lot.buffer_minutes}-minute turnaround gap).", 409, "extension_blocked",
            max_extra_minutes=max_extra)
    cost = pricing.time_fee(res.hourly_rate, extra)
    return {"extra_minutes": extra, "amount": cost, "new_end": utils.to_iso(res.end_time + timedelta(minutes=extra)),
            "max_extra_minutes": max_extra, "rate": res.hourly_rate}


def extend_booking(user, res, extra_minutes, payment):
    with BOOKING_LOCK:
        now = utils.now_utc()
        q = quote_extension(res, extra_minutes, now)
        new_end = res.end_time + timedelta(minutes=q["extra_minutes"])
        availability.assert_slot_free(res.slot, res.start_time, new_end, now, exclude_id=res.id)
        txn = payments.charge(user, q["amount"], payment, "extension", reservation=res, lot_id=res.lot_id)
        res.end_time = new_end
        res.extension_amount = utils.money((res.extension_amount or 0) + q["amount"])
        res.extension_count = (res.extension_count or 0) + 1
        res.end_reminder_sent_at = None
        res.overstay_alert_sent_at = None
        _event(res, "extended", f"Extended by {pricing.fmt_duration(q['extra_minutes'])}", q["amount"])
        db.session.commit()
    notify(res, "extended", {"amount": q["amount"]})
    return res, q


# =============================================================================== check-in / out
def check_in(res, actor_is_admin=False):
    now = utils.now_utc()
    if res.state != "confirmed" or res.checked_out_at:
        raise utils.ApiError("This booking is not active.", 409, "bad_state")
    if res.checked_in_at:
        raise utils.ApiError("Already checked in.", 409, "already_checked_in")
    early = timedelta(minutes=cfg("CHECKIN_EARLY_MINUTES"))
    if not actor_is_admin and now < res.start_time - early:
        raise utils.ApiError(
            f"Check-in opens {cfg('CHECKIN_EARLY_MINUTES')} minutes before your start time.", 409, "too_early")
    if now > res.end_time:
        raise utils.ApiError("This booking has already ended.", 409, "expired")
    res.checked_in_at = now
    _event(res, "checked_in", "Vehicle arrived")
    db.session.commit()
    return res


def check_out(res, actor_is_admin=False):
    now = utils.now_utc()
    if res.state != "confirmed" or res.checked_out_at:
        raise utils.ApiError("This booking is not active.", 409, "bad_state")
    early = timedelta(minutes=cfg("CHECKIN_EARLY_MINUTES"))
    if not res.checked_in_at:
        window_open = res.start_time - early <= now <= res.end_time
        if not (window_open or actor_is_admin):
            raise utils.ApiError("There is nothing to check out - this booking has not started or has ended.",
                                 409, "bad_state")
        res.checked_in_at = now if now > res.start_time else res.start_time
    res.checked_out_at = now
    res.state = "completed"
    over, fine = pricing.fine_for(res, now)
    res.overstay_minutes = over
    res.fine_amount = fine
    res.fine_status = "due" if fine > 0 else "none"
    _event(res, "checked_out", "Vehicle left")
    if fine > 0:
        _event(res, "fine", f"Overstayed {pricing.fmt_duration(over)} - fine due", fine)
    db.session.commit()
    notify(res, "checked_out")
    return res


def pay_fine(user, res, payment):
    if res.fine_status != "due":
        raise utils.ApiError("There is no fine to pay on this booking.", 409, "no_fine")
    with BOOKING_LOCK:
        payments.charge(user, res.fine_amount, payment, "fine", reservation=res, lot_id=res.lot_id)
        res.fine_status = "paid"
        _event(res, "fine_paid", "Overstay fine paid", res.fine_amount)
        db.session.commit()
    notify(res, "fine_paid")
    return res


def admin_collect_fine(res):
    """Fine collected at the counter (cash/manual)."""
    if res.fine_status != "due":
        raise utils.ApiError("There is no fine to collect on this booking.", 409, "no_fine")
    db.session.add(PaymentTransaction(
        txn_ref="CSH" + utils.gen_code("", 10).lstrip("-"), user_id=res.user_id, reservation_id=res.id,
        lot_id=res.lot_id, amount=res.fine_amount, currency="INR", method="counter", method_detail="Collected at counter",
        purpose="fine", status="success", message="Collected by lot staff"))
    res.fine_status = "paid"
    _event(res, "fine_paid", "Fine collected at counter", res.fine_amount)
    db.session.commit()
    return res


def admin_waive_fine(res):
    if res.fine_status != "due":
        raise utils.ApiError("There is no fine to waive on this booking.", 409, "no_fine")
    res.fine_status = "waived"
    _event(res, "fine_waived", "Fine waived by lot owner", res.fine_amount)
    db.session.commit()
    return res


# =============================================================================== cancel
def cancel_booking(res, by_admin=False):
    now = utils.now_utc()
    if res.state != "confirmed" or res.checked_out_at:
        raise utils.ApiError("This booking can no longer be cancelled.", 409, "bad_state")
    if res.checked_in_at:
        raise utils.ApiError("The vehicle has already checked in - please check out instead.", 409, "bad_state")
    if now >= res.start_time and not by_admin:
        raise utils.ApiError("A booking that has already started can't be cancelled.", 409, "started")

    lead = (res.start_time - now).total_seconds() / 60.0
    pct = 100 if (by_admin or lead >= cfg("FREE_CANCEL_MINUTES_BEFORE")) else cfg("LATE_CANCEL_REFUND_PERCENT")
    refund = utils.money(res.paid_for_booking * pct / 100.0)

    if refund > 0:
        original = (PaymentTransaction.query.filter_by(reservation_id=res.id, status="success")
                    .filter(PaymentTransaction.purpose.in_(["booking", "extension"])).first())
        payments.record_refund(res.user, refund, res, original.method if original else "card",
                               original.method_detail if original else "original method", res.lot_id)
    if pct == 100:
        _restore_entitlements(res)
    res.state = "cancelled"
    res.cancelled_at = now
    res.refund_amount = refund
    _event(res, "cancelled", f"Cancelled ({pct}% refund)", refund)
    db.session.commit()
    notify(res, "cancelled")
    return res


# =============================================================================== serialisation
def serialize(res, now=None, detail=False, viewer=None):
    now = now or utils.now_utc()
    status = res.display_status(now, cfg("CHECKIN_EARLY_MINUTES"))
    lot, slot = res.lot, res.slot

    minutes_left = None
    overstay_now = 0
    live_fine = 0.0
    if status in ("parked", "ready", "upcoming"):
        minutes_left = max(0, int((res.end_time - now).total_seconds() // 60))
    if status == "overstay":
        overstay_now, live_fine = pricing.fine_for(res, now)

    max_ext = 0
    if res.state == "confirmed" and not res.checked_out_at and now <= res.end_time:
        max_ext = availability.max_extension_minutes(res, now)

    actions = {
        "can_check_in": status == "ready",
        "can_check_out": status in ("parked", "overstay", "ready"),
        "can_extend": status in ("parked", "ready", "upcoming") and max_ext >= cfg("BILLING_BLOCK_MINUTES"),
        "extend_blocked_reason": None,
        "can_cancel": status in ("upcoming", "ready") and not res.checked_in_at and now < res.start_time,
        "can_pay_fine": res.fine_status == "due",
    }
    if status in ("parked", "ready", "upcoming") and not actions["can_extend"]:
        actions["extend_blocked_reason"] = (
            f"The slot is booked right after yours (a {res.buffer_minutes}-minute gap is kept between bookings).")

    lead = (res.start_time - now).total_seconds() / 60.0
    refund_pct = 100 if lead >= cfg("FREE_CANCEL_MINUTES_BEFORE") else cfg("LATE_CANCEL_REFUND_PERCENT")

    data = {
        "id": res.id, "code": res.code, "status": status,
        "lot": {"id": lot.id, "name": lot.name, "address": lot.address, "city": lot.city, "pin_code": lot.pin_code,
                "latitude": lot.latitude, "longitude": lot.longitude, "phone": lot.phone},
        "slot": {"id": slot.id, "label": slot.label, "full_label": slot.full_label, "floor": slot.floor,
                 "row": slot.row_name, "bay": slot.col_idx + 1, "row_idx": slot.row_idx, "col_idx": slot.col_idx,
                 "type": slot.slot_type, "location": slot.location_text()},
        "vehicle_number": res.vehicle_number, "vehicle_type": res.vehicle_type,
        "start_time": utils.to_iso(res.start_time), "end_time": utils.to_iso(res.end_time),
        "original_end_time": utils.to_iso(res.original_end_time),
        "checked_in_at": utils.to_iso(res.checked_in_at), "checked_out_at": utils.to_iso(res.checked_out_at),
        "cancelled_at": utils.to_iso(res.cancelled_at), "created_at": utils.to_iso(res.created_at),
        "duration_minutes": int((res.end_time - res.start_time).total_seconds() // 60),
        "minutes_left": minutes_left, "overstay_minutes_now": overstay_now,
        "hourly_rate": res.hourly_rate, "buffer_minutes": res.buffer_minutes,
        "slot_free_for_next_from": utils.to_iso(res.effective_end(now) + timedelta(minutes=res.buffer_minutes or 0)),
        "amounts": {
            "base": res.base_amount, "discount": res.discount_amount, "addons": res.addons_amount,
            "extension": res.extension_amount, "paid_for_booking": res.paid_for_booking,
            "fine": res.fine_amount if res.checked_out_at else live_fine, "fine_status": res.fine_status,
            "fine_is_live": status == "overstay", "refund": res.refund_amount,
            "total_paid": utils.money(res.paid_for_booking + (res.fine_amount if res.fine_status == "paid" else 0)
                                      - (res.refund_amount or 0)),
        },
        "fine_rate_per_block": pricing.fine_rate_per_block(res.hourly_rate),
        "overstay_minutes": res.overstay_minutes if res.checked_out_at else overstay_now,
        "extension_count": res.extension_count, "payment_method": res.payment_method,
        "addons": [{"name": a.name, "code": a.code, "total": a.total} for a in res.addons],
        "actions": actions, "max_extend_minutes": max_ext,
        "refund_percent_if_cancelled": refund_pct if actions["can_cancel"] else None,
    }
    if viewer is not None and viewer.is_admin:
        data["user"] = {"id": res.user.id, "username": res.user.username, "email": res.user.email,
                        "phone": res.user.phone}
    if detail:
        data["events"] = [{"kind": e.kind, "message": e.message, "amount": e.amount,
                           "at": utils.to_iso(e.created_at)} for e in res.events]
        data["transactions"] = [{"ref": t.txn_ref, "amount": t.amount, "purpose": t.purpose, "status": t.status,
                                 "method": t.method, "detail": t.method_detail, "at": utils.to_iso(t.created_at)}
                                for t in sorted(res.transactions, key=lambda t: t.id)]
        data["lot"]["amenities"] = [amenity_dict(la) for la in lot.amenities]
    return data


def amenity_dict(la):
    a = la.amenity
    return {"id": a.id, "code": a.code, "name": a.name, "icon": a.icon, "category": a.category,
            "description": a.description, "price": la.price, "price_unit": a.price_unit,
            "location": la.location_hint}


# =============================================================================== scheduled jobs
def scan_bookings():
    """Reminders + overstay alerts. Idempotent: each notice is sent once (flag columns)."""
    from . import notifications
    now = utils.now_utc()
    counts = {"start_reminders": 0, "end_reminders": 0, "overstay_alerts": 0}

    win = timedelta(minutes=cfg("REMINDER_BEFORE_START_MINUTES"))
    for r in Reservation.query.filter(Reservation.state == "confirmed", Reservation.checked_in_at.is_(None),
                                      Reservation.start_reminder_sent_at.is_(None),
                                      Reservation.start_time > now, Reservation.start_time <= now + win).all():
        notifications.send_booking_email(r.id, "reminder_start")
        r.start_reminder_sent_at = now
        counts["start_reminders"] += 1

    ewin = timedelta(minutes=cfg("REMINDER_BEFORE_END_MINUTES"))
    for r in Reservation.query.filter(Reservation.state == "confirmed", Reservation.checked_in_at.isnot(None),
                                      Reservation.checked_out_at.is_(None), Reservation.end_reminder_sent_at.is_(None),
                                      Reservation.end_time > now, Reservation.end_time <= now + ewin).all():
        notifications.send_booking_email(r.id, "reminder_end")
        r.end_reminder_sent_at = now
        counts["end_reminders"] += 1

    for r in Reservation.query.filter(Reservation.state == "confirmed", Reservation.checked_in_at.isnot(None),
                                      Reservation.checked_out_at.is_(None), Reservation.overstay_alert_sent_at.is_(None),
                                      Reservation.end_time < now).all():
        notifications.send_booking_email(r.id, "overstay")
        r.overstay_alert_sent_at = now
        counts["overstay_alerts"] += 1
    db.session.commit()
    return counts


def housekeeping():
    """Close bookings nobody showed up for and expire finished subscriptions."""
    now = utils.now_utc()
    closed = 0
    for r in Reservation.query.filter(Reservation.state == "confirmed", Reservation.checked_in_at.is_(None),
                                      Reservation.end_time < now).all():
        if now > r.end_time + timedelta(minutes=r.buffer_minutes or 0):
            r.state = "completed"
            _event(r, "no_show", "Closed automatically - vehicle never arrived")
            closed += 1
    expired = 0
    for s in Subscription.query.filter(Subscription.status == "active", Subscription.end_date <= now).all():
        s.status = "expired"
        expired += 1
    db.session.commit()
    return {"no_shows_closed": closed, "subscriptions_expired": expired}
