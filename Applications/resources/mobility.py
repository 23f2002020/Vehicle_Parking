"""Rider-facing ride/valet API - the minimal User Dashboard additions from the spec (Book a Ride,
Request Valet, My Rides, My Valet Requests). Deliberately a separate module from bookings.py: the
existing parking-booking endpoints there are not touched at all, this only adds new ones."""
from flask import request
from flask_security import current_user

from .. import driver_service as ds
from .. import utils
from ..models import Ride, ValetRequest
from .base import UserResource, json_body


class RideQuoteResource(UserResource):
    """Upfront fare estimate for the request form, shown BEFORE the rider taps "Request ride" -
    never creates anything, purely a calculation (same idea as bookings.py's QuoteResource for
    parking). Accepts either pickup_lat/pickup_lng/drop_lat/drop_lng (from the real map - preferred)
    or a plain distance_km (manual fallback)."""
    def post(self):
        return ds.estimate_ride_fare(json_body())


class ValetQuoteResource(UserResource):
    def post(self):
        return ds.estimate_valet_fee(json_body())


class RidesResource(UserResource):
    def get(self):
        q = Ride.query.filter_by(rider_id=current_user.id)
        status = request.args.get("status")
        if status:
            q = q.filter_by(status=status.upper())
        rides = q.order_by(Ride.requested_at.desc()).all()
        return {"rides": [ds.serialize_ride(r, include_driver=True) for r in rides]}

    def post(self):
        ride = ds.request_ride(current_user, json_body())
        return {"message": "Ride requested - looking for a nearby captain.",
               "ride": ds.serialize_ride(ride, include_driver=True)}, 201


class RideResource(UserResource):
    def get(self, ride_id):
        ride = ds.get_ride(ride_id, rider=current_user)
        return ds.serialize_ride(ride, include_driver=True)


class RideActionResource(UserResource):
    def post(self, ride_id, action):
        ride = ds.get_ride(ride_id, rider=current_user)
        data = json_body()
        if action == "cancel":
            ride = ds.cancel_ride_by_rider(current_user, ride, data.get("reason"))
            return {"message": "Ride cancelled.", "ride": ds.serialize_ride(ride, include_driver=True)}
        if action == "pay":
            ride = ds.pay_ride_fare(current_user, ride, data.get("payment"))
            return {"message": "Fare paid. Thanks for riding with us!", "ride": ds.serialize_ride(ride, include_driver=True)}
        if action == "rate":
            ds.rate_driver(current_user, None, ride_id=ride.id, stars=data.get("stars"), review=data.get("review"))
            return {"message": "Thanks for the feedback!", "ride": ds.serialize_ride(ride, include_driver=True)}
        raise utils.ApiError("Unknown action.", 404, "unknown_action")


class ValetRequestsResource(UserResource):
    def get(self):
        q = ValetRequest.query.filter_by(rider_id=current_user.id)
        status = request.args.get("status")
        if status:
            q = q.filter_by(status=status.upper())
        reqs = q.order_by(ValetRequest.requested_at.desc()).all()
        return {"valet_requests": [ds.serialize_valet(r, include_driver=True) for r in reqs]}

    def post(self):
        req = ds.request_valet(current_user, json_body())
        return {"message": "Valet requested - looking for a nearby driver.",
               "valet_request": ds.serialize_valet(req, include_driver=True)}, 201


class ValetRequestResource(UserResource):
    def get(self, valet_id):
        req = ds.get_valet(valet_id, rider=current_user)
        return ds.serialize_valet(req, include_driver=True)


class ValetActionResource(UserResource):
    def post(self, valet_id, action):
        req = ds.get_valet(valet_id, rider=current_user)
        data = json_body()
        if action == "cancel":
            req = ds.cancel_valet_by_rider(current_user, req, data.get("reason"))
            return {"message": "Valet request cancelled.", "valet_request": ds.serialize_valet(req, include_driver=True)}
        if action == "pay":
            req = ds.pay_valet_fee(current_user, req, data.get("payment"))
            return {"message": "Payment complete. Thanks!", "valet_request": ds.serialize_valet(req, include_driver=True)}
        if action == "rate":
            ds.rate_driver(current_user, None, valet_id=req.id, stars=data.get("stars"), review=data.get("review"))
            return {"message": "Thanks for the feedback!", "valet_request": ds.serialize_valet(req, include_driver=True)}
        raise utils.ApiError("Unknown action.", 404, "unknown_action")
