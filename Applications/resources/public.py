"""Public (no login) data for the landing page."""
from flask_restful import Resource

from .. import utils
from ..models import Amenity, ParkingLot, ParkingSpot, Reservation, SubscriptionPlan
from ..serializers import lot_dict
from ..subscriptions import plan_dict


class PublicOverviewResource(Resource):
    def get(self):
        now = utils.now_utc()
        lots = ParkingLot.query.filter_by(deleted_at=None, is_active=True).order_by(ParkingLot.id).all()
        plans = SubscriptionPlan.query.filter_by(plan_type="user", is_active=True).order_by(SubscriptionPlan.price).all()
        amenities = Amenity.query.order_by(Amenity.sort_order).all()
        return {
            "stats": {"lots": len(lots), "slots": sum(l.number_of_spots for l in lots),
                      "cities": len({l.city for l in lots if l.city}),
                      "bookings": Reservation.query.filter(Reservation.state != "cancelled").count()},
            "lots": [lot_dict(l, now) for l in lots],
            "plans": [plan_dict(p) for p in plans],
            "amenities": [{"code": a.code, "name": a.name, "icon": a.icon, "category": a.category,
                           "description": a.description} for a in amenities],
            "rules": {"buffer_minutes": lots[0].buffer_minutes if lots else 45},
            "server_time": utils.to_iso(now),
        }
