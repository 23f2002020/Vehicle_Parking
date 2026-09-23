"""Driver-partner API: registration, profile/KYC/vehicle, availability, rides, valet jobs,
earnings, ratings, notifications. Registration lives here (not auth.py's RegisterResource)
because a driver partner needs a lot more fields (DOB, address, licence, driver type ...) than
an ordinary driver/admin sign-up - see Applications/driver_service.py for the business rules."""
import re

from flask import current_app, request
from flask_restful import Resource
from flask_security import current_user, hash_password

from .. import driver_service as ds
from .. import utils
from ..database import db
from ..models import Ride, User, ValetRequest
from .base import DriverResource, json_body

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DriverRegisterResource(Resource):
    def post(self):
        data = json_body()
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        phone = (data.get("phone") or "").strip()
        if len(username) < 3:
            raise utils.ApiError("Username must be at least 3 characters.", 400, "bad_username")
        if not _EMAIL_RE.match(email):
            raise utils.ApiError("Enter a valid email address.", 400, "bad_email")
        if len(password) < 6:
            raise utils.ApiError("Password must be at least 6 characters.", 400, "weak_password")
        if User.query.filter_by(email=email).first():
            raise utils.ApiError("An account with this email already exists.", 409, "email_taken")
        if User.query.filter(db.func.lower(User.username) == username.lower()).first():
            raise utils.ApiError("That username is taken.", 409, "username_taken")

        user = current_app.security.datastore.create_user(
            email=email, username=username, password=hash_password(password), active=True, roles=["driver"],
            phone=phone or None, free_minutes_allowed=0)
        db.session.commit()
        driver = ds.register_driver(user, data)
        payload = {"id": user.id, "username": user.username, "email": user.email, "roles": ["driver"],
                  "auth_token": user.get_auth_token(), "server_time": utils.to_iso(utils.now_utc()),
                  "demo_mode": bool(current_app.config["DEMO_MODE"])}
        return {"message": "Driver partner account created.", "user": payload,
               "driver": ds.serialize_driver(driver, detail=True)}, 201


class DriverMeResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        return ds.serialize_driver(driver, detail=True)

    def put(self):
        driver = ds.require_driver_profile(current_user)
        driver = ds.update_profile(driver, json_body())
        return {"message": "Profile updated.", "driver": ds.serialize_driver(driver, detail=True)}


class DriverKycResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        return {"kyc_status": driver.kyc_status,
               "history": [{"status": k.status, "submitted_at": utils.to_iso(k.submitted_at),
                           "reviewed_at": utils.to_iso(k.reviewed_at), "reject_reason": k.reject_reason}
                          for k in reversed(driver.kyc_records)]}

    def post(self):
        driver = ds.require_driver_profile(current_user)
        driver = ds.submit_kyc(driver, json_body())
        return {"message": "KYC submitted for review.", "driver": ds.serialize_driver(driver, detail=True)}


class DriverVehicleResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        return {"vehicles": [ds.serialize_vehicle(v) for v in driver.vehicles]}

    def post(self):
        driver = ds.require_driver_profile(current_user)
        vehicle = ds.register_vehicle(driver, json_body())
        return {"message": "Vehicle submitted for approval.", "vehicle": ds.serialize_vehicle(vehicle)}, 201


class DriverAvailabilityResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        return {"status": driver.availability.status if driver.availability else "OFFLINE",
               "can_go_online": driver.can_go_online}

    def post(self):
        driver = ds.require_driver_profile(current_user)
        avail = ds.set_availability(driver, json_body().get("status"))
        label = "online" if avail.status == "AVAILABLE" and driver.driver_type == "ride_captain" else avail.status.lower()
        return {"message": f"You are now {label}.", "status": avail.status}


class DriverRidesResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        if driver.driver_type != "ride_captain":
            return {"rides": []}
        scope = (request.args.get("scope") or "mine").lower()
        if scope == "available":
            rides = ds.available_rides(driver) if driver.can_go_online else []
        else:
            q = Ride.query.filter_by(driver_id=driver.id)
            status = request.args.get("status")
            if status:
                q = q.filter_by(status=status.upper())
            rides = q.order_by(Ride.requested_at.desc()).all()
        return {"rides": [ds.serialize_ride(r, include_rider=True) for r in rides]}


class DriverRideActionResource(DriverResource):
    def post(self, ride_id, action):
        driver = ds.require_driver_profile(current_user)
        data = json_body()
        if action == "accept":
            ride = ds.accept_ride(driver, ride_id)
            return {"message": "Ride accepted - head to the pickup point.",
                   "ride": ds.serialize_ride(ride, include_rider=True)}
        ride = ds.get_ride(ride_id)
        if action == "reject":
            ride = ds.reject_ride(driver, ride)
            return {"message": "Ride returned to the pool.", "ride": ds.serialize_ride(ride, include_rider=True)}
        if action in ("arriving", "arrived", "start"):
            ride = ds.advance_ride(driver, ride, action)
            msg = {"arriving": "On your way.", "arrived": "Marked as arrived.", "start": "Ride started."}[action]
            return {"message": msg, "ride": ds.serialize_ride(ride, include_rider=True)}
        if action == "complete":
            ride = ds.complete_ride(driver, ride)
            fare = ride.fare
            return {"message": f"Ride completed. Fare: ₹{fare.total:,.2f}" if fare else "Ride completed.",
                   "ride": ds.serialize_ride(ride, include_rider=True)}
        if action == "cancel":
            ride = ds.cancel_ride_by_driver(driver, ride, data.get("reason"))
            return {"message": "Ride cancelled.", "ride": ds.serialize_ride(ride, include_rider=True)}
        raise utils.ApiError("Unknown action.", 404, "unknown_action")


class DriverValetResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        if driver.driver_type != "valet_driver":
            return {"valet_requests": []}
        scope = (request.args.get("scope") or "mine").lower()
        if scope == "available":
            reqs = ds.available_valet_jobs(driver) if driver.can_go_online else []
        else:
            q = ValetRequest.query.filter_by(driver_id=driver.id)
            status = request.args.get("status")
            if status:
                q = q.filter_by(status=status.upper())
            reqs = q.order_by(ValetRequest.requested_at.desc()).all()
        return {"valet_requests": [ds.serialize_valet(r, include_rider=True) for r in reqs]}


class DriverValetActionResource(DriverResource):
    def post(self, valet_id, action):
        driver = ds.require_driver_profile(current_user)
        data = json_body()
        if action == "accept":
            req = ds.accept_valet(driver, valet_id)
            return {"message": "Valet job accepted.", "valet_request": ds.serialize_valet(req, include_rider=True)}
        req = ds.get_valet(valet_id)
        if action == "reject":
            req = ds.reject_valet(driver, req)
            return {"message": "Job returned to the pool.", "valet_request": ds.serialize_valet(req, include_rider=True)}
        if action == "going-to-pickup":
            req = ds.advance_valet(driver, req, action)
            return {"message": "Heading to pickup.", "valet_request": ds.serialize_valet(req, include_rider=True)}
        if action == "picked-up":
            req = ds.record_handover(driver, req, "pickup", data)
            return {"message": "Pickup handover recorded.", "valet_request": ds.serialize_valet(req, include_rider=True)}
        if action == "in-transit":
            req = ds.advance_valet(driver, req, action)
            return {"message": "Vehicle in transit.", "valet_request": ds.serialize_valet(req, include_rider=True)}
        if action == "dropped":
            req = ds.record_handover(driver, req, "dropoff", data)
            return {"message": "Drop-off handover recorded.", "valet_request": ds.serialize_valet(req, include_rider=True)}
        if action == "complete":
            req = ds.complete_valet(driver, req)
            return {"message": f"Job completed. Fee: ₹{req.fee:,.2f}",
                   "valet_request": ds.serialize_valet(req, include_rider=True)}
        if action == "cancel":
            req = ds.cancel_valet_by_driver(driver, req, data.get("reason"))
            return {"message": "Valet request cancelled.", "valet_request": ds.serialize_valet(req, include_rider=True)}
        raise utils.ApiError("Unknown action.", 404, "unknown_action")


class DriverEarningsResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        return ds.earnings_summary(driver)


class DriverRatingsResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        return ds.rating_summary(driver)


class DriverNotificationsResource(DriverResource):
    def get(self):
        driver = ds.require_driver_profile(current_user)
        unread_only = request.args.get("unread") == "1"
        return {"notifications": [ds.serialize_notification(n) for n in ds.list_notifications(driver, unread_only)]}

    def post(self):
        driver = ds.require_driver_profile(current_user)
        n = ds.mark_notifications_read(driver, json_body().get("id"))
        return {"message": f"Marked {n} notification(s) as read."}
