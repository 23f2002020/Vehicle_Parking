"""Turn model objects into JSON-friendly dicts."""
from datetime import timedelta

from . import availability, utils
from .booking_service import amenity_dict
from .models import Reservation

LEVEL = "Level"


def user_dict(u):
    return {"id": u.id, "username": u.username, "email": u.email, "phone": u.phone, "address": u.address,
            "roles": [r.name for r in u.roles], "active": u.active, "created_at": utils.to_iso(u.created_at),
            "free_minutes_remaining": u.free_minutes_remaining}


def lot_dict(lot, now, with_availability=True, detail=False):
    d = {
        "id": lot.id, "name": lot.name, "description": lot.description, "address": lot.address, "city": lot.city,
        "pin_code": lot.pin_code, "latitude": lot.latitude, "longitude": lot.longitude, "phone": lot.phone,
        "supervisor_name": lot.supervisor_name, "price_per_hour": lot.price_per_hour,
        "buffer_minutes": lot.buffer_minutes, "rows": lot.rows, "columns": lot.columns, "floors": lot.floors,
        "number_of_spots": lot.number_of_spots, "is_active": lot.is_active,
        "amenities": [amenity_dict(la) for la in sorted(lot.amenities, key=lambda x: x.amenity.sort_order)],
    }
    if with_availability:
        states = availability.slot_states(lot, now, now + timedelta(minutes=60), now)
        counts = _count(states)
        d["availability"] = {"free_next_hour": counts["available"], "total": counts["total"], **counts}
        d["free_now"] = counts["available"]
    return d


def _count(states):
    c = {"available": 0, "booked": 0, "buffer": 0, "blocked": 0}
    for s in states.values():
        c[s["status"]] += 1
    c["total"] = sum(c.values())
    return c


def slot_map(lot, start, end, now, user_id=None, exclude_id=None):
    states = availability.slot_states(lot, start, end, now, user_id, exclude_id)
    floors = {}
    for s in lot.live_slots():
        f = floors.setdefault(s.floor, {"floor": s.floor, "name": f"Level {s.floor}", "rows": lot.rows,
                                        "cols": lot.columns, "slots": []})
        st = states.get(s.id, {"status": "blocked", "mine": False, "free_from": None})
        f["slots"].append({"id": s.id, "label": s.label, "full_label": s.full_label, "row": s.row_idx,
                           "col": s.col_idx, "row_name": s.row_name, "type": s.slot_type, "number": s.slot_number,
                           "status": st["status"], "mine": st["mine"], "free_from": st["free_from"]})
    return {"lot_id": lot.id, "window": {"start": utils.to_iso(start), "end": utils.to_iso(end)},
            "counts": _count(states), "floors": [floors[k] for k in sorted(floors)],
            "buffer_minutes": lot.buffer_minutes}


def txn_dict(t):
    return {"id": t.id, "ref": t.txn_ref, "amount": t.amount, "currency": t.currency, "method": t.method,
            "detail": t.method_detail, "purpose": t.purpose, "status": t.status, "message": t.message,
            "created_at": utils.to_iso(t.created_at),
            "booking_code": t.reservation.code if t.reservation else None,
            "lot": t.reservation.lot.name if t.reservation else None,
            "user": ({"id": t.user.id, "username": t.user.username, "email": t.user.email} if t.user else None)}
