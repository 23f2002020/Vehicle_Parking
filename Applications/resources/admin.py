"""Lot-owner (admin) API: lots, slots, live bookings, users, transactions, plans, overview, system."""
import glob
import os
from collections import Counter, defaultdict
from datetime import timedelta

from flask import current_app, request
from flask_security import current_user

from .. import availability
from .. import booking_service as bs
from .. import driver_service as ds
from .. import insights
from .. import task as task_mod
from .. import utils
from ..database import db
from ..mailer import mail_mode
from ..models import (Amenity, Driver, DriverVehicle, LotAmenity, ParkingLot, ParkingSpot, PaymentTransaction,
                      Reservation, Ride, RideFare, SubscriptionPlan, User, ValetRequest)
from ..serializers import lot_dict, slot_map, txn_dict, user_dict
from ..subscriptions import SubscriptionService, plan_dict
from .base import AdminResource, json_body


# ------------------------------------------------------------------------------------ helpers
def is_platform_admin(user):
    return user.email.lower() == current_app.config.get("PLATFORM_ADMIN_EMAIL", "user@admin.com").lower()


def owned_lots():
    return ParkingLot.query.filter_by(admin_id=current_user.id, deleted_at=None).order_by(ParkingLot.id).all()


def get_owned_lot(lot_id):
    lot = db.session.get(ParkingLot, lot_id)
    if not lot or lot.deleted_at or lot.admin_id != current_user.id:
        raise utils.ApiError("Parking lot not found.", 404, "not_found")
    return lot


def _tz():
    return current_app.config["APP_TIMEZONE"]


# Max slices the "Revenue by lot" donut shows before folding the rest into "Other lots" -
# keeps the chart's fixed colour palette from running out and colliding/repeating, and
# keeps the legend from being cluttered with lots that have not earned anything yet.
TOP_LOTS_LIMIT = 5


def _top_lots_chart(lots, rev_by_lot):
    ranked = sorted([{"lot": l.name, "revenue": utils.money(rev_by_lot.get(l.id, 0))} for l in lots],
                     key=lambda x: -x["revenue"])
    earning = [t for t in ranked if t["revenue"] > 0]
    if len(earning) <= TOP_LOTS_LIMIT:
        return earning
    head, tail = earning[:TOP_LOTS_LIMIT], earning[TOP_LOTS_LIMIT:]
    head.append({"lot": f"Other lots ({len(tail)})", "revenue": utils.money(sum(t["revenue"] for t in tail))})
    return head


def _clean_str(v, field, required=False, maxlen=255):
    v = (v or "").strip() if isinstance(v, str) or v is None else str(v).strip()
    if required and not v:
        raise utils.ApiError(f"'{field}' is required.", 400)
    return v[:maxlen] or None


def _apply_lot_fields(lot, data, creating):
    cfg = current_app.config
    if creating:
        for f in ("rows", "columns", "price_per_hour"):
            if data.get(f) in (None, ""):
                raise utils.ApiError(f"'{f}' is required.", 400)
    if creating or "name" in data:
        lot.name = _clean_str(data.get("name"), "name", required=True, maxlen=100)
    if creating or "address" in data:
        lot.address = _clean_str(data.get("address"), "address", required=True)
    if creating or "pin_code" in data:
        pin = _clean_str(data.get("pin_code"), "pin_code", required=True, maxlen=10)
        if not pin.isalnum() or len(pin) < 4:
            raise utils.ApiError("Enter a valid PIN code.", 400)
        lot.pin_code = pin
    for f, ml in (("city", 60), ("description", 500), ("phone", 20), ("supervisor_name", 100)):
        if f in data:
            setattr(lot, f, _clean_str(data.get(f), f, maxlen=ml))
    for f in ("latitude", "longitude"):
        if f in data:
            v = data.get(f)
            setattr(lot, f, None if v in (None, "") else utils.as_float(v, f, -180, 180))
    if creating or "price_per_hour" in data:
        lot.price_per_hour = utils.as_float(data.get("price_per_hour"), "price_per_hour", 1, 5000)
    if creating or "buffer_minutes" in data:
        lot.buffer_minutes = utils.as_int(data.get("buffer_minutes"), "buffer_minutes", 0, 240,
                                          default=cfg["BUFFER_MINUTES_DEFAULT"])
    if "is_active" in data:
        lot.is_active = bool(data["is_active"])
    rows = utils.as_int(data.get("rows", lot.rows), "rows", 1, 26)
    cols = utils.as_int(data.get("columns", lot.columns), "columns", 1, 30)
    floors = utils.as_int(data.get("floors", lot.floors or 1), "floors", 1, 10)
    if rows * cols * floors > cfg["MAX_SLOTS_PER_LOT"]:
        raise utils.ApiError(f"A lot can have at most {cfg['MAX_SLOTS_PER_LOT']} slots "
                             f"(rows x columns x floors = {rows * cols * floors}).", 400, "too_many_slots")
    return rows, cols, floors


def _set_amenities(lot, items):
    """items: [{code, price, location}] - replaces the lot's amenity list."""
    by_code = {a.code: a for a in Amenity.query.all()}
    wanted = {}
    for it in items or []:
        code = it.get("code") if isinstance(it, dict) else it
        if code not in by_code:
            raise utils.ApiError(f"Unknown amenity '{code}'.", 400)
        wanted[code] = it if isinstance(it, dict) else {}
    existing = {la.amenity.code: la for la in lot.amenities}
    for code, la in list(existing.items()):
        if code not in wanted:
            lot.amenities.remove(la)
    for code, it in wanted.items():
        am = by_code[code]
        price = it.get("price")
        price = am.default_price if price in (None, "") else utils.as_float(price, "amenity price", 0, 100000)
        la = existing.get(code)
        if la is None:
            la = LotAmenity(amenity_id=am.id, price=price)
            lot.amenities.append(la)
        la.price = price
        la.location_hint = _clean_str(it.get("location"), "location", maxlen=120)
    db.session.flush()


def _sync_ev_slots(lot):
    has_ev = "ev_charging" in {la.amenity.code for la in lot.amenities}
    live = lot.live_slots()
    if has_ev and not any(s.slot_type == "ev" for s in live):
        for s in live:
            if s.col_idx == lot.columns - 1:
                s.slot_type = "ev"
    if not has_ev:
        for s in live:
            if s.slot_type == "ev":
                s.slot_type = "standard"


def _assert_resize_safe(lot, rows, cols, floors, now):
    q = Reservation.query.filter(Reservation.lot_id == lot.id, Reservation.state == "confirmed",
                                 Reservation.checked_out_at.is_(None), Reservation.end_time > now)
    for r in q.all():
        s = r.slot
        if s.floor > floors or s.row_idx >= rows or s.col_idx >= cols:
            raise utils.ApiError(
                f"Can't shrink the layout: booking {r.code} uses slot {s.full_label}. "
                "Cancel or wait for it to finish first.", 409, "resize_blocked")


def _lot_admin_dict(lot, now):
    d = lot_dict(lot, now)
    codes = {la.amenity.code: la for la in lot.amenities}
    d["amenity_config"] = [{"code": a.code, "enabled": a.code in codes,
                            "price": codes[a.code].price if a.code in codes else a.default_price,
                            "location": (codes[a.code].location_hint or "") if a.code in codes else ""}
                           for a in Amenity.query.order_by(Amenity.sort_order).all()]
    parked = Reservation.query.filter(Reservation.lot_id == lot.id, Reservation.state == "confirmed",
                                      Reservation.checked_in_at.isnot(None),
                                      Reservation.checked_out_at.is_(None)).count()
    d["parked_now"] = parked
    d["bookings_total"] = Reservation.query.filter(Reservation.lot_id == lot.id, Reservation.state != "cancelled").count()
    return d


# ------------------------------------------------------------------------------------ lots
class AdminLotsResource(AdminResource):
    def get(self):
        now = utils.now_utc()
        limit, plan = SubscriptionService.admin_lot_limit(current_user, now)
        return {"lots": [_lot_admin_dict(l, now) for l in owned_lots()],
                "limit": {"limit": limit, "used": SubscriptionService.admin_lots_used(current_user), "plan": plan},
                "amenity_catalog": [{"code": a.code, "name": a.name, "icon": a.icon, "category": a.category,
                                     "default_price": a.default_price, "price_unit": a.price_unit}
                                    for a in Amenity.query.order_by(Amenity.sort_order).all()]}

    def post(self):
        data = json_body()
        now = utils.now_utc()
        limit, plan = SubscriptionService.admin_lot_limit(current_user, now)
        used = SubscriptionService.admin_lots_used(current_user)
        if limit is not None and used >= limit:
            raise utils.ApiError(f"Your {plan} allows {limit} parking lots. Upgrade your plan to add more.", 403,
                                 "lot_limit", limit=limit, used=used)
        lot = ParkingLot(admin_id=current_user.id, number_of_spots=0, rows=1, columns=1, floors=1)
        rows, cols, floors = _apply_lot_fields(lot, data, creating=True)
        lot.rows, lot.columns, lot.floors = rows, cols, floors
        db.session.add(lot)
        db.session.flush()
        _set_amenities(lot, data.get("amenities"))
        lot.sync_slots()
        db.session.flush()
        _sync_ev_slots(lot)
        db.session.commit()
        return {"message": "Parking lot created successfully", "lot": _lot_admin_dict(lot, now)}, 201


class AdminLotResource(AdminResource):
    def get(self, lot_id):
        return _lot_admin_dict(get_owned_lot(lot_id), utils.now_utc())

    def put(self, lot_id):
        lot = get_owned_lot(lot_id)
        data = json_body()
        now = utils.now_utc()
        rows, cols, floors = _apply_lot_fields(lot, data, creating=False)
        if (rows, cols, floors) != (lot.rows, lot.columns, lot.floors):
            _assert_resize_safe(lot, rows, cols, floors, now)
            lot.rows, lot.columns, lot.floors = rows, cols, floors
            lot.sync_slots()
        if "amenities" in data:
            _set_amenities(lot, data.get("amenities"))
            _sync_ev_slots(lot)
        db.session.commit()
        return {"message": "Parking lot updated successfully", "lot": _lot_admin_dict(lot, now)}

    def delete(self, lot_id):
        lot = get_owned_lot(lot_id)
        now = utils.now_utc()
        live = Reservation.query.filter(Reservation.lot_id == lot.id, Reservation.state == "confirmed",
                                        Reservation.checked_out_at.is_(None), Reservation.end_time > now).count()
        if live:
            raise utils.ApiError(f"This lot has {live} upcoming or active booking(s). Cancel them or wait until "
                                 "they finish before deleting the lot.", 409, "lot_busy")
        lot.deleted_at = now
        lot.is_active = False
        db.session.commit()
        return {"message": "Parking lot deleted successfully"}


class AdminSlotsResource(AdminResource):
    """Live slot board for one lot (what is happening in every bay right now)."""

    def get(self, lot_id):
        lot = get_owned_lot(lot_id)
        now = utils.now_utc()
        sm = slot_map(lot, now, now + timedelta(minutes=1), now)
        buf = lot.buffer_minutes or 0
        occ = {}
        for r in availability.candidates([s.id for s in lot.live_slots()], now, now + timedelta(minutes=1), buf):
            if availability.relation(r, now, now + timedelta(minutes=1), buf, now) == "direct":
                occ[r.slot_id] = r
        for f in sm["floors"]:
            for s in f["slots"]:
                r = occ.get(s["id"])
                s["occupant"] = None
                if r:
                    st = r.display_status(now)
                    s["occupant"] = {"booking_id": r.id, "code": r.code, "vehicle": r.vehicle_number, "status": st,
                                     "user": r.user.username, "start_time": utils.to_iso(r.start_time),
                                     "end_time": utils.to_iso(r.end_time)}
                    s["status"] = "occupied" if st in ("parked", "overstay") else "reserved"
        sm["counts"] = dict(Counter(s["status"] for f in sm["floors"] for s in f["slots"]))
        sm["counts"]["total"] = sum(v for k, v in sm["counts"].items() if k != "total")
        return sm


class AdminSlotResource(AdminResource):
    def patch(self, slot_id):
        slot = db.session.get(ParkingSpot, slot_id)
        if not slot or slot.retired or slot.lot.admin_id != current_user.id:
            raise utils.ApiError("Slot not found.", 404, "not_found")
        data = json_body()
        now = utils.now_utc()
        if "slot_type" in data:
            if data["slot_type"] not in ("standard", "ev", "accessible", "compact"):
                raise utils.ApiError("Unknown slot type.", 400)
            slot.slot_type = data["slot_type"]
        if "is_active" in data:
            active = bool(data["is_active"])
            if not active:
                busy = Reservation.query.filter(Reservation.slot_id == slot.id, Reservation.state == "confirmed",
                                                Reservation.checked_out_at.is_(None), Reservation.end_time > now).first()
                if busy:
                    raise utils.ApiError(f"Booking {busy.code} still needs this slot. Cancel it before closing the slot.",
                                         409, "slot_busy")
            slot.is_active = active
        db.session.commit()
        return {"message": "Slot updated", "slot": {"id": slot.id, "type": slot.slot_type, "is_active": slot.is_active}}


# ------------------------------------------------------------------------------------ bookings
class AdminBookingsResource(AdminResource):
    def get(self):
        now = utils.now_utc()
        lot_ids = [l.id for l in owned_lots()]
        q = Reservation.query.filter(Reservation.lot_id.in_(lot_ids)) if lot_ids else Reservation.query.filter(False)
        lot_id = request.args.get("lot_id", type=int)
        if lot_id:
            q = q.filter(Reservation.lot_id == lot_id)
        rows = q.order_by(Reservation.start_time.desc()).limit(600).all()
        items = [bs.serialize(r, now, viewer=current_user) for r in rows]

        counts = Counter(i["status"] for i in items)
        counts["fine_due"] = sum(1 for i in items if i["amounts"]["fine_status"] == "due")
        status = (request.args.get("status") or "").lower()
        text = (request.args.get("q") or "").strip().lower()
        if status == "fine_due":
            items = [i for i in items if i["amounts"]["fine_status"] == "due"]
        elif status and status != "all":
            items = [i for i in items if i["status"] == status]
        if text:
            items = [i for i in items if text in " ".join([i["code"], i["vehicle_number"], i["lot"]["name"],
                                                           i["slot"]["full_label"], i["user"]["username"],
                                                           i["user"]["email"]]).lower()]
        return {"bookings": items[:300], "counts": dict(counts), "server_time": utils.to_iso(now)}


class AdminBookingActionResource(AdminResource):
    def post(self, booking_id, action):
        res = bs.get_reservation(booking_id, current_user, allow_admin_of_lot=True)
        if res.lot.admin_id != current_user.id:
            raise utils.ApiError("Booking not found.", 404, "not_found")
        if action == "check-in":
            bs.check_in(res, actor_is_admin=True)
        elif action == "check-out":
            bs.check_out(res, actor_is_admin=True)
        elif action == "collect-fine":
            bs.admin_collect_fine(res)
        elif action == "waive-fine":
            bs.admin_waive_fine(res)
        elif action == "cancel":
            bs.cancel_booking(res, by_admin=True)
        else:
            raise utils.ApiError("Unknown action.", 404, "unknown_action")
        return {"message": "Done", "booking": bs.serialize(res, viewer=current_user, detail=True)}


# ------------------------------------------------------------------------------------ users / money
class AdminUsersResource(AdminResource):
    def get(self):
        lot_ids = [l.id for l in owned_lots()]
        if is_platform_admin(current_user):
            users = User.query.order_by(User.id).all()
        else:
            ids = {r.user_id for r in Reservation.query.filter(Reservation.lot_id.in_(lot_ids)).all()} if lot_ids else set()
            users = User.query.filter(User.id.in_(ids)).all() if ids else []
        out = []
        for u in users:
            if u.id == current_user.id:
                continue
            d = user_dict(u)
            rs = Reservation.query.filter(Reservation.user_id == u.id, Reservation.lot_id.in_(lot_ids)).all() if lot_ids else []
            d["bookings"] = len(rs)
            d["spent"] = utils.money(sum(r.paid_for_booking + (r.fine_amount if r.fine_status == "paid" else 0)
                                         - (r.refund_amount or 0) for r in rs))
            d["fines_due"] = utils.money(sum(r.fine_amount for r in rs if r.fine_status == "due"))
            out.append(d)
        return {"users": out, "can_manage": is_platform_admin(current_user)}


class AdminUserResource(AdminResource):
    def patch(self, user_id):
        if not is_platform_admin(current_user):
            raise utils.ApiError("Only the platform administrator can suspend accounts.", 403, "forbidden")
        u = db.session.get(User, user_id)
        if not u or u.id == current_user.id or u.is_admin:
            raise utils.ApiError("User not found.", 404, "not_found")
        data = json_body()
        if "active" in data:
            u.active = bool(data["active"])
            u.ban_reason = None if u.active else _clean_str(data.get("ban_reason"), "ban_reason") or "Policy violation"
            # a new fs_uniquifier invalidates the suspended user's existing tokens
            if not u.active:
                current_app.security.datastore.set_uniquifier(u)
        db.session.commit()
        return {"message": "Account " + ("reactivated" if u.active else "suspended"), "user": user_dict(u)}


class AdminTransactionsResource(AdminResource):
    def get(self):
        lot_ids = [l.id for l in owned_lots()]
        if not lot_ids:
            return {"transactions": [], "totals": {"collected": 0, "refunded": 0, "net": 0}}
        rows = (PaymentTransaction.query.filter(PaymentTransaction.lot_id.in_(lot_ids))
                .order_by(PaymentTransaction.created_at.desc(), PaymentTransaction.id.desc()).limit(500).all())
        ok = [t for t in rows if t.status == "success"]
        coll = sum(t.amount for t in ok if t.purpose != "refund")
        ref = sum(t.amount for t in ok if t.purpose == "refund")
        return {"transactions": [txn_dict(t) for t in rows],
                "totals": {"collected": utils.money(coll), "refunded": utils.money(ref), "net": utils.money(coll - ref)}}


class AdminPlansResource(AdminResource):
    def get(self):
        plans = SubscriptionPlan.query.order_by(SubscriptionPlan.plan_type, SubscriptionPlan.price).all()
        return {"plans": [plan_dict(p) for p in plans], "can_manage": is_platform_admin(current_user)}

    def post(self):
        if not is_platform_admin(current_user):
            raise utils.ApiError("Only the platform administrator can manage plans.", 403, "forbidden")
        d = json_body()
        p = SubscriptionPlan(plan_type="user")
        _fill_plan(p, d, creating=True)
        db.session.add(p)
        db.session.commit()
        return {"message": "Plan created", "plan": plan_dict(p)}, 201


class AdminPlanResource(AdminResource):
    def put(self, plan_id):
        if not is_platform_admin(current_user):
            raise utils.ApiError("Only the platform administrator can manage plans.", 403, "forbidden")
        p = db.session.get(SubscriptionPlan, plan_id)
        if not p:
            raise utils.ApiError("Plan not found.", 404)
        _fill_plan(p, json_body(), creating=False)
        db.session.commit()
        return {"message": "Plan updated", "plan": plan_dict(p)}

    def delete(self, plan_id):
        if not is_platform_admin(current_user):
            raise utils.ApiError("Only the platform administrator can manage plans.", 403, "forbidden")
        p = db.session.get(SubscriptionPlan, plan_id)
        if not p:
            raise utils.ApiError("Plan not found.", 404)
        p.is_active = False          # never hard-delete: subscribers keep what they paid for
        db.session.commit()
        return {"message": "Plan retired (existing subscribers keep it until it expires)"}


def _fill_plan(p, d, creating):
    import json
    if creating or "name" in d:
        name = _clean_str(d.get("name"), "name", required=True, maxlen=64)
        clash = SubscriptionPlan.query.filter(SubscriptionPlan.name == name, SubscriptionPlan.id != (p.id or 0)).first()
        if clash:
            raise utils.ApiError("A plan with this name already exists.", 409)
        p.name = name
    if creating or "price" in d:
        p.price = utils.as_float(d.get("price"), "price", 0, 1000000)
    if creating or "duration_days" in d:
        p.duration_days = utils.as_int(d.get("duration_days"), "duration_days", 1, 3650)
    for f in ("free_parkings", "free_washes"):
        if f in d or creating:
            setattr(p, f, utils.as_int(d.get(f), f, 0, 10000, default=0))
    if "description" in d:
        p.description = _clean_str(d.get("description"), "description", maxlen=500)
    if "badge" in d:
        p.badge = _clean_str(d.get("badge"), "badge", maxlen=30)
    if "features" in d and isinstance(d["features"], list):
        p.features_json = json.dumps([str(x)[:80] for x in d["features"]][:8])
    if "is_active" in d:
        p.is_active = bool(d["is_active"])
    p.billing_interval = "annually" if (p.duration_days or 30) >= 300 else "monthly"


# ------------------------------------------------------------------------------------ overview
class AdminOverviewResource(AdminResource):
    def get(self):
        now = utils.now_utc()
        tz = _tz()
        days = request.args.get("days", 14, type=int)
        days = max(3, min(days, 60))
        lots = owned_lots()
        lot_ids = [l.id for l in lots]
        empty = {"kpis": {}, "revenue": {"labels": [], "data": []}, "bookings": {"labels": [], "data": []},
                 "occupancy": [], "peak_hours": {"labels": [], "data": []}, "overstays": [], "arrivals": [],
                 "top_lots": [], "lots": 0}
        if not lot_ids:
            return empty

        today = utils.local_date(now, tz)
        day_list = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
        since = now - timedelta(days=days + 1)

        txns = PaymentTransaction.query.filter(PaymentTransaction.lot_id.in_(lot_ids),
                                               PaymentTransaction.status == "success",
                                               PaymentTransaction.created_at >= since).all()
        rev_by_day, rev_by_lot = defaultdict(float), defaultdict(float)
        for t in txns:
            sign = -1 if t.purpose == "refund" else 1
            rev_by_day[utils.local_date(t.created_at, tz)] += sign * t.amount
            rev_by_lot[t.lot_id] += sign * t.amount

        rows = Reservation.query.filter(Reservation.lot_id.in_(lot_ids), Reservation.state != "cancelled",
                                        Reservation.start_time >= since).all()
        book_by_day = Counter(utils.local_date(r.start_time, tz) for r in rows)
        peak = Counter(utils.local_hour(r.start_time, tz) for r in rows)

        live = Reservation.query.filter(Reservation.lot_id.in_(lot_ids), Reservation.state == "confirmed",
                                        Reservation.checked_in_at.isnot(None),
                                        Reservation.checked_out_at.is_(None)).all()
        overstays = [r for r in live if now > r.end_time]
        arrivals = Reservation.query.filter(
            Reservation.lot_id.in_(lot_ids), Reservation.state == "confirmed", Reservation.checked_in_at.is_(None),
            Reservation.start_time <= now + timedelta(hours=3), Reservation.end_time > now
        ).order_by(Reservation.start_time).limit(10).all()

        slots_total = sum(1 for l in lots for s in l.live_slots() if s.is_active)
        parked_by_lot = Counter(r.lot_id for r in live)
        occupancy = [{"lot": l.name, "lot_id": l.id, "parked": parked_by_lot.get(l.id, 0),
                      "total": sum(1 for s in l.live_slots() if s.is_active)} for l in lots]
        for o in occupancy:
            o["pct"] = round(100.0 * o["parked"] / o["total"], 1) if o["total"] else 0

        fines_due = sum(r.fine_amount for r in Reservation.query.filter(
            Reservation.lot_id.in_(lot_ids), Reservation.fine_status == "due").all())
        week = [today - timedelta(days=i) for i in range(7)]
        kpis = {
            "revenue_today": utils.money(rev_by_day.get(today, 0)),
            "revenue_7d": utils.money(sum(rev_by_day.get(d, 0) for d in week)),
            "revenue_period": utils.money(sum(rev_by_day.get(d, 0) for d in day_list)),
            "bookings_today": book_by_day.get(today, 0),
            "parked_now": len(live), "overstay_now": len(overstays),
            "occupancy_pct": round(100.0 * len(live) / slots_total, 1) if slots_total else 0,
            "slots_total": slots_total, "fines_due": utils.money(fines_due),
        }
        return {
            "kpis": kpis, "days": days,
            "revenue": {"labels": [d.strftime("%d %b") for d in day_list],
                        "data": [utils.money(rev_by_day.get(d, 0)) for d in day_list]},
            "bookings": {"labels": [d.strftime("%d %b") for d in day_list],
                         "data": [book_by_day.get(d, 0) for d in day_list]},
            "occupancy": occupancy,
            "peak_hours": {"labels": [f"{h:02d}:00" for h in range(24)], "data": [peak.get(h, 0) for h in range(24)]},
            "overstays": [bs.serialize(r, now, viewer=current_user) for r in overstays],
            "arrivals": [bs.serialize(r, now, viewer=current_user) for r in arrivals],
            "top_lots": _top_lots_chart(lots, rev_by_lot),
            "lots": len(lots), "server_time": utils.to_iso(now),
        }


def _overlap_hours(a_start, a_end, b_start, b_end):
    start = max(a_start, b_start)
    end = min(a_end, b_end)
    delta = (end - start).total_seconds() / 3600.0
    return delta if delta > 0 else 0.0


# ------------------------------------------------------------------------------------ reports
class AdminReportsResource(AdminResource):
    """Profitability / underperformance report: which lots (and slots) earn the most, which
    ones are lagging, overall + per-slot utilization, and a set of rule-based suggestions
    (see Applications/insights.py) on what to do about it."""

    def get(self):
        now = utils.now_utc()
        tz = _tz()
        days = request.args.get("days", 30, type=int)
        days = max(7, min(days, 90))
        lot_filter = request.args.get("lot_id", type=int)
        lots = owned_lots()
        lot_ids = [l.id for l in lots]
        empty = {"days": days, "lots": 0, "kpis": {}, "lot_performance": [],
                 "occupancy_trend": {"labels": [], "data": []},
                 "slot_performance": {"lot_id": lot_filter, "top": [], "bottom": [], "total_slots": 0},
                 "suggestions": [], "server_time": utils.to_iso(now)}
        if not lot_ids:
            return empty

        since = now - timedelta(days=days)
        period_hours = max((now - since).total_seconds() / 3600.0, 0.001)
        today = utils.local_date(now, tz)
        day_list = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]

        txns = PaymentTransaction.query.filter(PaymentTransaction.lot_id.in_(lot_ids),
                                               PaymentTransaction.status == "success",
                                               PaymentTransaction.created_at >= since).all()
        rev_by_lot = defaultdict(float)
        for t in txns:
            sign = -1 if t.purpose == "refund" else 1
            rev_by_lot[t.lot_id] += sign * t.amount

        # a day of slack so a booking that started just before the window but overlaps it still counts
        rows = Reservation.query.filter(Reservation.lot_id.in_(lot_ids),
                                        Reservation.start_time >= since - timedelta(days=1),
                                        Reservation.start_time <= now).all()

        bookings_by_lot, cancelled_by_lot, noshow_by_lot = Counter(), Counter(), Counter()
        bookings_by_slot, hours_by_lot, hours_by_slot = Counter(), defaultdict(float), defaultdict(float)
        revenue_by_slot = defaultdict(float)
        day_hours = defaultdict(float)
        total_bookings = total_cancelled = total_noshow = 0

        for r in rows:
            in_window = r.start_time >= since
            if in_window:
                total_bookings += 1
                bookings_by_lot[r.lot_id] += 1
                bookings_by_slot[r.slot_id] += 1
                if r.state == "cancelled":
                    total_cancelled += 1
                    cancelled_by_lot[r.lot_id] += 1
                elif r.display_status(now) == "no_show":
                    total_noshow += 1
                    noshow_by_lot[r.lot_id] += 1
            if r.state == "cancelled":
                continue
            end = r.checked_out_at or min(r.end_time, now)
            if end <= r.start_time:
                continue
            ov = _overlap_hours(r.start_time, end, since, now)
            if ov <= 0:
                continue
            hours_by_lot[r.lot_id] += ov
            hours_by_slot[r.slot_id] += ov
            if in_window:
                revenue_by_slot[r.slot_id] += r.paid_for_booking
            d = utils.local_date(r.start_time, tz)
            if day_list and day_list[0] <= d <= day_list[-1]:
                day_hours[d] += ov

        slots_total_all = sum(1 for l in lots for s in l.live_slots() if s.is_active)
        lot_perf = []
        for l in lots:
            slots_n = sum(1 for s in l.live_slots() if s.is_active)
            occ_pct = round(min(100.0, 100.0 * hours_by_lot.get(l.id, 0) / (slots_n * period_hours)), 1) if slots_n else 0
            revenue = utils.money(rev_by_lot.get(l.id, 0))
            bookings_n = bookings_by_lot.get(l.id, 0)
            cancel_n = cancelled_by_lot.get(l.id, 0)
            lot_perf.append({
                "lot_id": l.id, "lot": l.name, "slots": slots_n, "revenue": revenue, "bookings": bookings_n,
                "occupancy_pct": occ_pct, "revenue_per_slot": utils.money(revenue / slots_n) if slots_n else 0,
                "cancellation_pct": round(100.0 * cancel_n / bookings_n, 1) if bookings_n else 0,
                "no_shows": noshow_by_lot.get(l.id, 0),
            })
        lot_perf.sort(key=lambda x: -x["revenue"])
        if lot_perf:
            best = max((x["revenue"] for x in lot_perf), default=0)
            avg_occ = sum(x["occupancy_pct"] for x in lot_perf) / len(lot_perf)
            for x in lot_perf:
                if x["bookings"] == 0 or (avg_occ > 0 and x["occupancy_pct"] < avg_occ * 0.5):
                    x["status"] = "underperforming"
                elif best > 0 and x["revenue"] == best:
                    x["status"] = "top"
                else:
                    x["status"] = "steady"

        occ_data = [round(min(100.0, 100.0 * day_hours.get(d, 0) / (slots_total_all * 24)), 1) if slots_total_all else 0
                    for d in day_list]

        slot_meta = {}
        for l in lots:
            if lot_filter and l.id != lot_filter:
                continue
            for s in l.live_slots():
                if s.is_active:
                    slot_meta[s.id] = (s.full_label, l.name, l.id)
        slot_rows = []
        for sid, (label, lot_name, lid) in slot_meta.items():
            hrs = hours_by_slot.get(sid, 0)
            slot_rows.append({
                "slot_id": sid, "label": label, "lot": lot_name, "lot_id": lid,
                "bookings": bookings_by_slot.get(sid, 0), "hours_used": round(hrs, 1),
                "utilization_pct": round(min(100.0, 100.0 * hrs / period_hours), 1),
                "revenue": utils.money(revenue_by_slot.get(sid, 0)),
            })
        slot_rows.sort(key=lambda x: -x["utilization_pct"])
        top_slots = slot_rows[:8]
        top_ids = {x["slot_id"] for x in top_slots}
        bottom_slots = sorted((x for x in slot_rows if x["slot_id"] not in top_ids),
                              key=lambda x: x["utilization_pct"])[:8]

        kpis = {
            "revenue_total": utils.money(sum(rev_by_lot.values())),
            "bookings_total": total_bookings, "cancelled_total": total_cancelled, "no_show_total": total_noshow,
            "cancellation_pct": round(100.0 * total_cancelled / total_bookings, 1) if total_bookings else 0,
            "no_show_pct": round(100.0 * total_noshow / total_bookings, 1) if total_bookings else 0,
            "avg_occupancy_pct": round(sum(x["occupancy_pct"] for x in lot_perf) / len(lot_perf), 1) if lot_perf else 0,
        }
        suggestions = insights.generate_suggestions(lot_perf, slot_rows, kpis)

        return {
            "days": days, "lots": len(lots), "kpis": kpis, "lot_performance": lot_perf,
            "occupancy_trend": {"labels": [d.strftime("%d %b") for d in day_list], "data": occ_data},
            "slot_performance": {"lot_id": lot_filter, "top": top_slots, "bottom": bottom_slots,
                                 "total_slots": len(slot_rows)},
            "suggestions": suggestions, "server_time": utils.to_iso(now),
        }


class AdminSystemResource(AdminResource):
    def get(self):
        redis_ok = task_mod.redis_available(force=True)
        workers = task_mod.celery_worker_count() if redis_ok else 0
        outbox = []
        folder = current_app.config["OUTBOX_DIR"]
        for path in sorted(glob.glob(os.path.join(folder, "*.txt")), reverse=True)[:12]:
            try:
                with open(path, encoding="utf-8") as fh:
                    head = {}
                    for line in fh:
                        if not line.strip():
                            break
                        k, _, v = line.partition(":")
                        head[k.strip().lower()] = v.strip()
                    body = fh.read().strip()
                outbox.append({"file": os.path.basename(path), "to": head.get("to"), "subject": head.get("subject"),
                               "body": body[:1200]})
            except OSError:
                continue
        return {"redis": redis_ok, "celery_workers": workers, "task_mode": current_app.config["TASK_MODE"],
                "mail_mode": mail_mode(), "demo_mode": bool(current_app.config["DEMO_MODE"]),
                "clock_offset_minutes": utils.get_clock_offset_minutes(), "server_time": utils.to_iso(utils.now_utc()),
                "timezone": current_app.config["APP_TIMEZONE"], "outbox": outbox,
                "rules": {k: current_app.config[k] for k in (
                    "BUFFER_MINUTES_DEFAULT", "FINE_MULTIPLIER", "FINE_GRACE_MINUTES", "BILLING_BLOCK_MINUTES",
                    "MIN_BOOKING_MINUTES", "MAX_BOOKING_HOURS", "FREE_CANCEL_MINUTES_BEFORE",
                    "LATE_CANCEL_REFUND_PERCENT", "WELCOME_FREE_MINUTES", "FREE_ADMIN_LOTS")}}


# ------------------------------------------------------------------------------------ driver partners
# Drivers (ride captains + valet drivers) are platform-wide, not owned by one lot - same as
# subscription plans above, any admin can VIEW this directory but only the platform admin can
# approve/reject/suspend/activate. "Do not rebuild the existing admin dashboard": this whole
# section is additive, nothing above it was touched.
def _require_platform_admin():
    if not is_platform_admin(current_user):
        raise utils.ApiError("Only the platform administrator can manage driver partners.", 403, "forbidden")


def get_any_driver(driver_id):
    driver = db.session.get(Driver, driver_id)
    if not driver:
        raise utils.ApiError("Driver partner not found.", 404, "not_found")
    return driver


class AdminDriversResource(AdminResource):
    def get(self):
        q = Driver.query
        driver_type = (request.args.get("driver_type") or "").strip().lower()
        if driver_type in ds.DRIVER_TYPES:
            q = q.filter_by(driver_type=driver_type)
        account_status = (request.args.get("account_status") or "").strip().lower()
        if account_status in ("active", "suspended"):
            q = q.filter_by(account_status=account_status)
        drivers = q.order_by(Driver.id.desc()).all()
        kyc_status = (request.args.get("kyc_status") or "").strip().upper()
        if kyc_status:
            drivers = [d for d in drivers if d.kyc_status == kyc_status]
        search = (request.args.get("q") or "").strip().lower()
        if search:
            drivers = [d for d in drivers if search in f"{d.full_name} {d.user.email} {d.user.username}".lower()]
        return {"drivers": [ds.serialize_driver(d, for_admin=True) for d in drivers],
                "can_manage": is_platform_admin(current_user)}


class AdminDriverResource(AdminResource):
    def get(self, driver_id):
        driver = get_any_driver(driver_id)
        d = ds.serialize_driver(driver, detail=True, for_admin=True)
        d["recent_rides"] = [ds.serialize_ride(r, include_rider=True) for r in
                             Ride.query.filter_by(driver_id=driver.id).order_by(Ride.requested_at.desc()).limit(20).all()]
        d["recent_valet"] = [ds.serialize_valet(v, include_rider=True) for v in
                             ValetRequest.query.filter_by(driver_id=driver.id).order_by(ValetRequest.requested_at.desc()).limit(20).all()]
        d["earnings"] = ds.earnings_summary(driver)
        d["can_manage"] = is_platform_admin(current_user)
        return d


class AdminDriverKycResource(AdminResource):
    def post(self, driver_id):
        _require_platform_admin()
        driver = get_any_driver(driver_id)
        d = json_body()
        driver = ds.admin_review_kyc(driver, d.get("decision"), d.get("reason"), current_user)
        return {"message": f"KYC {driver.kyc_status.lower()}.", "driver": ds.serialize_driver(driver, detail=True, for_admin=True)}


class AdminDriverStatusResource(AdminResource):
    def post(self, driver_id):
        _require_platform_admin()
        driver = get_any_driver(driver_id)
        d = json_body()
        status = (d.get("status") or "").strip().lower()
        if status not in ("active", "suspended"):
            raise utils.ApiError("status must be 'active' or 'suspended'.", 400, "bad_status")
        driver.account_status = status
        driver.suspend_reason = (d.get("reason") or "").strip()[:255] or None if status == "suspended" else None
        if status == "suspended" and driver.availability:
            driver.availability.status = "OFFLINE"
        db.session.commit()
        return {"message": f"Driver partner {status}.", "driver": ds.serialize_driver(driver, detail=True, for_admin=True)}


class AdminDriverVehicleReviewResource(AdminResource):
    def post(self, vehicle_id):
        _require_platform_admin()
        vehicle = db.session.get(DriverVehicle, vehicle_id)
        if not vehicle:
            raise utils.ApiError("Vehicle not found.", 404, "not_found")
        d = json_body()
        vehicle = ds.admin_review_vehicle(vehicle, d.get("decision"), d.get("reason"))
        return {"message": f"Vehicle {vehicle.status.lower()}.", "vehicle": ds.serialize_vehicle(vehicle)}


class AdminRidesResource(AdminResource):
    def get(self):
        _require_platform_admin()
        q = Ride.query
        status = (request.args.get("status") or "").strip().upper()
        if status:
            q = q.filter_by(status=status)
        rides = q.order_by(Ride.requested_at.desc()).limit(200).all()
        active = sum(1 for r in rides if r.status in ds.RIDE_ACTIVE)
        return {"rides": [ds.serialize_ride(r, include_rider=True) for r in rides], "active_count": active}


class AdminValetJobsResource(AdminResource):
    def get(self):
        _require_platform_admin()
        q = ValetRequest.query
        status = (request.args.get("status") or "").strip().upper()
        if status:
            q = q.filter_by(status=status)
        reqs = q.order_by(ValetRequest.requested_at.desc()).limit(200).all()
        active = sum(1 for r in reqs if r.status in ds.VALET_ACTIVE)
        return {"valet_requests": [ds.serialize_valet(r, include_rider=True) for r in reqs], "active_count": active}


class AdminDriverRevenueResource(AdminResource):
    """Platform commission earned from rides + valet jobs - kept separate from parking-lot
    revenue (AdminOverviewResource/AdminReportsResource above), since it isn't a lot owner's money."""

    def get(self):
        _require_platform_admin()
        days = max(7, min(request.args.get("days", 30, type=int), 90))
        tz = current_app.config["APP_TIMEZONE"]
        now = utils.now_utc()
        since = now - timedelta(days=days)
        today = utils.local_date(now, tz)
        day_list = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]

        ride_fares = RideFare.query.join(Ride).filter(RideFare.paid.is_(True), Ride.completed_at >= since).all()
        valet_jobs = ValetRequest.query.filter(ValetRequest.paid.is_(True), ValetRequest.completed_at >= since).all()

        commission_by_day, payout_by_day = Counter(), Counter()
        for f in ride_fares:
            d = utils.local_date(f.ride.completed_at, tz)
            commission_by_day[d] += f.platform_fee
            payout_by_day[d] += f.driver_earning
        for v in valet_jobs:
            d = utils.local_date(v.completed_at, tz)
            commission_by_day[d] += v.platform_fee
            payout_by_day[d] += v.driver_earning

        return {
            "days": days,
            "kpis": {
                "platform_commission": utils.money(sum(commission_by_day.values())),
                "driver_payouts": utils.money(sum(payout_by_day.values())),
                "completed_rides": Ride.query.filter_by(status="RIDE_COMPLETED").count(),
                "completed_valet_jobs": ValetRequest.query.filter_by(status="COMPLETED").count(),
                "active_drivers": Driver.query.filter_by(account_status="active").count(),
            },
            "trend": {"labels": [d.strftime("%d %b") for d in day_list],
                      "commission": [utils.money(commission_by_day.get(d, 0)) for d in day_list],
                      "payouts": [utils.money(payout_by_day.get(d, 0)) for d in day_list]},
            "server_time": utils.to_iso(now),
        }
