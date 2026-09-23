"""Driver bookings: quote, create, list, detail, extend, check-in/out, pay fine, cancel, payments."""
from flask import request
from flask_security import current_user

from .. import booking_service as bs
from .. import pricing, utils
from ..models import PaymentTransaction, Reservation
from ..serializers import txn_dict
from .base import UserResource, json_body

GROUPS = {
    "upcoming": ("upcoming", "ready"),
    "active": ("parked", "overstay"),
    "past": ("completed", "no_show"),
    "cancelled": ("cancelled",),
}


def user_spend(user_id):
    rows = PaymentTransaction.query.filter_by(user_id=user_id, status="success").all()
    paid = sum(t.amount for t in rows if t.purpose in ("booking", "extension", "fine"))
    refunded = sum(t.amount for t in rows if t.purpose == "refund")
    return utils.money(paid - refunded)


class QuoteResource(UserResource):
    def post(self):
        lot, slot, start, end, quote, now = bs.quote_new(current_user, json_body())
        out = pricing.public_quote(quote)
        out["lot"] = {"id": lot.id, "name": lot.name}
        out["slot"] = {"id": slot.id, "label": slot.full_label, "location": slot.location_text()} if slot else None
        out["start"], out["end"] = utils.to_iso(start), utils.to_iso(end)
        out["free_minutes_remaining"] = current_user.free_minutes_remaining
        return out


class BookingsResource(UserResource):
    def get(self):
        now = utils.now_utc()
        rows = Reservation.query.filter_by(user_id=current_user.id).order_by(Reservation.start_time.desc()).all()
        status = (request.args.get("status") or "").lower()
        q = (request.args.get("q") or "").strip().lower()
        sort = request.args.get("sort") or "start_desc"

        items = [bs.serialize(r, now) for r in rows]
        summary = {"total": len(items), "upcoming": 0, "active": 0, "past": 0, "cancelled": 0,
                   "fines_due": utils.money(sum(r.fine_amount for r in rows if r.fine_status == "due")),
                   "total_spent": user_spend(current_user.id)}
        for it in items:
            for g, sts in GROUPS.items():
                if it["status"] in sts:
                    summary[g] += 1
        if status in GROUPS:
            items = [i for i in items if i["status"] in GROUPS[status]]
        elif status and status != "all":
            items = [i for i in items if i["status"] == status]
        if q:
            items = [i for i in items if q in (i["code"] + " " + i["vehicle_number"] + " " + i["lot"]["name"] + " "
                                               + i["slot"]["full_label"]).lower()]
        if sort == "start_asc":
            items.sort(key=lambda i: i["start_time"])
        elif sort == "amount_desc":
            items.sort(key=lambda i: -i["amounts"]["total_paid"])
        return {"bookings": items, "summary": summary, "server_time": utils.to_iso(now)}

    def post(self):
        res = bs.create_booking(current_user, json_body())
        return {"message": "Booking confirmed", "booking": bs.serialize(res, detail=True)}, 201


class BookingResource(UserResource):
    def get(self, booking_id):
        res = bs.get_reservation(booking_id, current_user)
        return bs.serialize(res, detail=True)


class BookingActionResource(UserResource):
    def post(self, booking_id, action):
        res = bs.get_reservation(booking_id, current_user)
        data = json_body()
        if action == "extend-quote":
            return bs.quote_extension(res, data.get("extra_minutes"))
        if action == "extend":
            res, q = bs.extend_booking(current_user, res, data.get("extra_minutes"), data.get("payment"))
            return {"message": f"Extended by {pricing.fmt_duration(q['extra_minutes'])}", "charged": q["amount"],
                    "booking": bs.serialize(res, detail=True)}
        if action == "check-in":
            res = bs.check_in(res)
            return {"message": "Checked in. Enjoy your stay!", "booking": bs.serialize(res, detail=True)}
        if action == "check-out":
            res = bs.check_out(res)
            msg = "Checked out. Safe drive!"
            if res.fine_status == "due":
                msg = f"Checked out. You overstayed - a fine of ₹{res.fine_amount:,.2f} is due."
            return {"message": msg, "booking": bs.serialize(res, detail=True)}
        if action == "pay-fine":
            res = bs.pay_fine(current_user, res, data.get("payment"))
            return {"message": "Fine paid. Thank you!", "booking": bs.serialize(res, detail=True)}
        if action == "cancel":
            res = bs.cancel_booking(res)
            return {"message": f"Booking cancelled. Refund: ₹{res.refund_amount:,.2f}",
                    "booking": bs.serialize(res, detail=True)}
        raise utils.ApiError("Unknown action.", 404, "unknown_action")


class PaymentsResource(UserResource):
    def get(self):
        rows = (PaymentTransaction.query.filter_by(user_id=current_user.id)
                .order_by(PaymentTransaction.created_at.desc(), PaymentTransaction.id.desc()).all())
        return {"payments": [txn_dict(t) for t in rows], "total_spent": user_spend(current_user.id)}
