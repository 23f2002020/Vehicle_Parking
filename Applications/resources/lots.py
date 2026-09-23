"""Driver-facing lot browsing, availability and slot map."""
from datetime import timedelta

from flask import request
from flask_restful import Resource

from .. import booking_service as bs
from .. import utils
from ..models import ParkingLot
from ..serializers import lot_dict, slot_map
from .base import AuthResource


def _window(lot):
    """?start=&end= (ISO with timezone). Defaults to 'the next hour'."""
    now = utils.now_utc()
    s, e = request.args.get("start"), request.args.get("end")
    if s and e:
        start, end = utils.parse_iso(s, "start"), utils.parse_iso(e, "end")
        if end <= start:
            raise utils.ApiError("The end time must be after the start time.", 400, "bad_window")
        if (end - start) > timedelta(hours=72):
            raise utils.ApiError("That window is too long.", 400, "too_long")
    else:
        start = now
        end = now + timedelta(hours=1)
    return now, start, end


class PublicLotsResource(Resource):
    """Landing-page teaser: no login needed."""

    def get(self):
        now = utils.now_utc()
        lots = ParkingLot.query.filter_by(deleted_at=None, is_active=True).order_by(ParkingLot.id).all()
        return {"lots": [lot_dict(l, now) for l in lots]}


class LotsResource(AuthResource):
    def get(self):
        now = utils.now_utc()
        q = (request.args.get("q") or "").strip().lower()
        want = [c for c in (request.args.get("amenity") or "").split(",") if c]
        sort = request.args.get("sort") or "name"

        lots = ParkingLot.query.filter_by(deleted_at=None, is_active=True).all()
        out = []
        for lot in lots:
            hay = " ".join(filter(None, [lot.name, lot.address, lot.city, lot.pin_code])).lower()
            if q and q not in hay:
                continue
            if want and not set(want) <= lot.amenity_codes():
                continue
            out.append(lot_dict(lot, now))
        keyf = {"price": lambda d: d["price_per_hour"], "availability": lambda d: -d["free_now"],
                "name": lambda d: d["name"].lower()}.get(sort, lambda d: d["name"].lower())
        out.sort(key=keyf)
        return {"lots": out, "server_time": utils.to_iso(now)}


class LotResource(AuthResource):
    def get(self, lot_id):
        lot = bs.get_bookable_lot(lot_id)
        return lot_dict(lot, utils.now_utc(), detail=True)


class SlotMapResource(AuthResource):
    def get(self, lot_id):
        from flask_security import current_user
        lot = bs.get_bookable_lot(lot_id)
        now, start, end = _window(lot)
        exclude = request.args.get("exclude_booking", type=int)
        return slot_map(lot, start, end, now, user_id=current_user.id, exclude_id=exclude)
