"""Slot availability, including the turnaround BUFFER between two bookings on the same slot.

Rule: for any two bookings A and B on one slot, the free gap between them must be at least
`buffer_minutes` (45 by default).  Formally, they conflict when

        A.start < B.end + buffer   AND   B.start < A.end + buffer

A booking's "end" is its *effective* end: the scheduled end, or the real departure time if the car left
early, or "now" if the car is still parked after its time ran out (overstay).

Slot status inside a requested window:
    available - free
    booked    - another booking overlaps the window
    buffer    - no overlap, but it would break the 45-minute turnaround gap
    blocked   - closed by the lot owner (maintenance)
"""
import math
from collections import defaultdict
from datetime import timedelta

from flask import current_app
from sqlalchemy import and_, func, or_

from . import utils
from .database import db
from .models import ParkingSpot, Reservation


def relation(res, start, end, buffer_min, now):
    """'direct' | 'buffer' | None : how does `res` interfere with the window [start, end)?"""
    eff = res.effective_end(now)
    if res.start_time < end and start < eff:
        return "direct"
    b = timedelta(minutes=buffer_min)
    if res.start_time < end + b and start < eff + b:
        return "buffer"
    return None


def candidates(slot_ids, start, end, buffer_min, exclude_id=None):
    """Coarse SQL filter; exact rules are applied in Python by relation()."""
    if not slot_ids:
        return []
    b = timedelta(minutes=buffer_min)
    q = Reservation.query.filter(
        Reservation.slot_id.in_(slot_ids),
        Reservation.state != "cancelled",
        Reservation.start_time < end + b,
        or_(func.coalesce(Reservation.checked_out_at, Reservation.end_time) > start - b,
            and_(Reservation.checked_in_at.isnot(None), Reservation.checked_out_at.is_(None))))
    if exclude_id:
        q = q.filter(Reservation.id != exclude_id)
    return q.all()


def slot_states(lot, start, end, now, user_id=None, exclude_id=None):
    """{slot_id: {'status': ..., 'mine': bool, 'free_from': iso|None}} for every live slot of a lot."""
    slots = lot.live_slots()
    buf = lot.buffer_minutes if lot.buffer_minutes is not None else 45
    by_slot = defaultdict(list)
    for r in candidates([s.id for s in slots], start, end, buf, exclude_id):
        by_slot[r.slot_id].append(r)

    out = {}
    for s in slots:
        if not s.is_active:
            out[s.id] = {"status": "blocked", "mine": False, "free_from": None}
            continue
        status, mine, free_from = "available", False, None
        for r in by_slot.get(s.id, []):
            rel = relation(r, start, end, buf, now)
            if rel == "direct":
                status = "booked"
                mine = mine or (user_id is not None and r.user_id == user_id)
            elif rel == "buffer" and status != "booked":
                status = "buffer"
            if rel:
                # earliest moment this slot could be booked again after this reservation
                ff = r.effective_end(now) + timedelta(minutes=buf)
                if free_from is None or ff > free_from:
                    free_from = ff
        out[s.id] = {"status": status, "mine": mine,
                     "free_from": utils.to_iso(free_from) if status in ("booked", "buffer") else None}
    return out


def assert_slot_free(slot, start, end, now, exclude_id=None):
    """Raise ApiError(409) unless `slot` can host [start, end) without breaking the buffer rule."""
    lot = slot.lot
    buf = lot.buffer_minutes if lot.buffer_minutes is not None else 45
    if not slot.is_active or slot.retired:
        raise utils.ApiError("This slot is closed for maintenance. Please choose another one.", 409,
                             "slot_unavailable", reason="blocked")
    for r in candidates([slot.id], start, end, buf, exclude_id):
        rel = relation(r, start, end, buf, now)
        if rel == "direct":
            raise utils.ApiError("Someone just booked this slot for that time. Please pick another slot.", 409,
                                 "slot_unavailable", reason="booked")
        if rel == "buffer":
            raise utils.ApiError(
                f"This slot needs a {buf}-minute turnaround gap between bookings. "
                "Please choose another slot or shift your time.", 409, "slot_unavailable", reason="buffer")


def assert_vehicle_free(vehicle_number, start, end, exclude_id=None):
    """One vehicle cannot hold two overlapping reservations (in any lot)."""
    q = Reservation.query.filter(
        Reservation.vehicle_number == vehicle_number, Reservation.state != "cancelled",
        Reservation.start_time < end,
        func.coalesce(Reservation.checked_out_at, Reservation.end_time) > start)
    if exclude_id:
        q = q.filter(Reservation.id != exclude_id)
    if q.first():
        raise utils.ApiError(f"Vehicle {vehicle_number} already has a booking that overlaps this time.", 409,
                             "vehicle_busy")


def max_extension_minutes(res, now):
    """How many more minutes the booking may be extended, honouring the buffer before the next booking."""
    slot, lot = res.slot, res.lot
    if not slot.is_active or slot.retired or lot.deleted_at or not lot.is_active:
        return 0
    block = current_app.config["BILLING_BLOCK_MINUTES"]
    buf = lot.buffer_minutes if lot.buffer_minutes is not None else 45
    cap = current_app.config["MAX_BOOKING_HOURS"] * 60 - (res.end_time - res.start_time).total_seconds() / 60.0
    nxt = (Reservation.query.filter(Reservation.slot_id == res.slot_id, Reservation.id != res.id,
                                    Reservation.state != "cancelled", Reservation.start_time >= res.start_time)
           .order_by(Reservation.start_time).all())
    limit = cap
    for r in nxt:
        if r.start_time > res.start_time:               # the next booking on this slot
            limit = min(limit, (r.start_time - res.end_time).total_seconds() / 60.0 - buf)
            break
    return max(0, int(math.floor(limit / block) * block))
