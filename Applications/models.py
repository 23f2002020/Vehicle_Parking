"""Database models.

Design notes
------------
* ONE identity table (User) + Role. The old project also had a separate `Admin` table which the
  login code never looked at, so the seeded admin could not sign in. Admins are now Users that
  hold the `admin` role.
* All datetimes are naive UTC (see utils.py).
* Reservation keeps price *snapshots* (hourly_rate, buffer_minutes) so later price edits never
  rewrite history.
"""
import json
import uuid
from datetime import timedelta

from flask_security import RoleMixin, UserMixin

from . import utils
from .database import db


def _uid():
    return uuid.uuid4().hex


# ============================================================================ identity
class Role(db.Model, RoleMixin):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True)
    description = db.Column(db.String(255))


class UserRoles(db.Model):
    __tablename__ = "user_roles"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"))
    role_id = db.Column(db.Integer, db.ForeignKey("role.id", ondelete="CASCADE"))


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    fs_uniquifier = db.Column(db.String(64), unique=True, nullable=False, default=_uid)
    active = db.Column(db.Boolean, default=True)
    phone = db.Column(db.String(20))
    address = db.Column(db.String(255))
    ban_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utils.now_utc)
    # one-time "welcome" free parking allowance (minutes)
    free_minutes_allowed = db.Column(db.Integer, default=60)
    free_minutes_used = db.Column(db.Integer, default=0)

    roles = db.relationship("Role", secondary="user_roles", backref=db.backref("users", lazy="dynamic"))

    @property
    def is_admin(self):
        return any(r.name == "admin" for r in self.roles)

    @property
    def free_minutes_remaining(self):
        return max(0, (self.free_minutes_allowed or 0) - (self.free_minutes_used or 0))

    def __repr__(self):
        return f"<User {self.username}>"


# ============================================================================ lots & slots
class Amenity(db.Model):
    """Catalogue of things a lot can offer (EV charging, car wash, fuel, garage ...)."""
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(30), unique=True, nullable=False)
    name = db.Column(db.String(60), nullable=False)
    icon = db.Column(db.String(40), default="bi-star")
    category = db.Column(db.String(10), default="onsite")        # 'bookable' (pay in app) | 'onsite'
    description = db.Column(db.String(255))
    default_price = db.Column(db.Float, default=0.0)
    price_unit = db.Column(db.String(20), default="per_booking")  # per_booking | per_hour | pay_at_counter | free
    sort_order = db.Column(db.Integer, default=100)


class LotAmenity(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    lot_id = db.Column(db.Integer, db.ForeignKey("parking_lot.id", ondelete="CASCADE"), nullable=False)
    amenity_id = db.Column(db.Integer, db.ForeignKey("amenity.id"), nullable=False)
    price = db.Column(db.Float, default=0.0)
    location_hint = db.Column(db.String(120))                     # "Ground floor, next to exit gate"
    amenity = db.relationship("Amenity")
    __table_args__ = (db.UniqueConstraint("lot_id", "amenity_id", name="uq_lot_amenity"),)


class ParkingLot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(500))
    address = db.Column(db.String(255), nullable=False)
    city = db.Column(db.String(60))
    pin_code = db.Column(db.String(10), nullable=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    phone = db.Column(db.String(20))
    supervisor_name = db.Column(db.String(100))

    rows = db.Column(db.Integer, nullable=False)
    columns = db.Column(db.Integer, nullable=False)
    floors = db.Column(db.Integer, default=1)
    number_of_spots = db.Column(db.Integer, nullable=False)

    price_per_hour = db.Column(db.Float, nullable=False)
    buffer_minutes = db.Column(db.Integer, default=45)            # gap kept free between two bookings

    is_active = db.Column(db.Boolean, default=True)
    deleted_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utils.now_utc)
    updated_at = db.Column(db.DateTime, onupdate=utils.now_utc)

    owner = db.relationship("User", backref="parking_lots")
    slots = db.relationship("ParkingSpot", backref="lot", lazy=True,
                            order_by="(ParkingSpot.floor, ParkingSpot.row_idx, ParkingSpot.col_idx)")
    amenities = db.relationship("LotAmenity", backref="lot", lazy=True, cascade="all, delete-orphan")

    def live_slots(self):
        return [s for s in self.slots if not s.retired]

    def sync_slots(self):
        """Create any missing slots for the current rows/columns/floors and retire the ones that
        fell outside. Never deletes rows, so booking history is preserved."""
        existing = {(s.floor, s.row_idx, s.col_idx): s for s in self.slots}
        wanted = set()
        n = 0
        ev_col = self.columns - 1
        has_ev = any(a.amenity.code == "ev_charging" for a in self.amenities)
        for f in range(1, self.floors + 1):
            for r in range(self.rows):
                for c in range(self.columns):
                    n += 1
                    key = (f, r, c)
                    wanted.add(key)
                    slot = existing.get(key)
                    if slot is None:
                        slot = ParkingSpot(
                            lot_id=self.id, floor=f, row_idx=r, col_idx=c,
                            label=f"{utils.row_letter(r)}{c + 1}",
                            slot_type="ev" if (has_ev and c == ev_col) else "standard")
                        db.session.add(slot)
                    slot.retired = False
                    slot.slot_number = n
        for key, slot in existing.items():
            if key not in wanted:
                slot.retired = True
                slot.is_active = False
        self.number_of_spots = n

    def amenity_codes(self):
        return {a.amenity.code for a in self.amenities}


class ParkingSpot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    lot_id = db.Column(db.Integer, db.ForeignKey("parking_lot.id", ondelete="CASCADE"), nullable=False, index=True)
    floor = db.Column(db.Integer, default=1, nullable=False)
    row_idx = db.Column(db.Integer, default=0, nullable=False)
    col_idx = db.Column(db.Integer, default=0, nullable=False)
    label = db.Column(db.String(10), nullable=False)               # "B4" (unique per floor)
    slot_number = db.Column(db.Integer, nullable=False)            # 1..N across the lot
    slot_type = db.Column(db.String(12), default="standard")       # standard | ev | accessible | compact
    is_active = db.Column(db.Boolean, default=True)                # False = closed for maintenance
    retired = db.Column(db.Boolean, default=False)                 # fell outside a resized layout
    __table_args__ = (db.UniqueConstraint("lot_id", "floor", "row_idx", "col_idx", name="uq_slot_position"),)

    @property
    def full_label(self):
        return f"L{self.floor}-{self.label}"

    @property
    def row_name(self):
        return utils.row_letter(self.row_idx)

    def location_text(self):
        return f"Level {self.floor} · Row {self.row_name} · Bay {self.col_idx + 1}"


# ============================================================================ reservations
class Reservation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(16), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    lot_id = db.Column(db.Integer, db.ForeignKey("parking_lot.id"), nullable=False, index=True)
    slot_id = db.Column(db.Integer, db.ForeignKey("parking_spot.id"), nullable=False, index=True)
    vehicle_number = db.Column(db.String(15), nullable=False)
    vehicle_type = db.Column(db.String(12), default="car")

    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime, nullable=False)              # current end (includes extensions)
    original_end_time = db.Column(db.DateTime, nullable=False)
    hourly_rate = db.Column(db.Float, nullable=False)
    buffer_minutes = db.Column(db.Integer, default=45)

    state = db.Column(db.String(12), default="confirmed")          # confirmed | cancelled | completed
    checked_in_at = db.Column(db.DateTime)
    checked_out_at = db.Column(db.DateTime)
    cancelled_at = db.Column(db.DateTime)

    base_amount = db.Column(db.Float, default=0.0)
    discount_amount = db.Column(db.Float, default=0.0)
    addons_amount = db.Column(db.Float, default=0.0)
    extension_amount = db.Column(db.Float, default=0.0)
    fine_amount = db.Column(db.Float, default=0.0)
    fine_status = db.Column(db.String(10), default="none")         # none | due | paid | waived
    overstay_minutes = db.Column(db.Integer, default=0)
    refund_amount = db.Column(db.Float, default=0.0)
    extension_count = db.Column(db.Integer, default=0)

    used_subscription_id = db.Column(db.Integer)                   # entitlements consumed (restored on free cancel)
    parking_credit_used = db.Column(db.Boolean, default=False)
    free_minutes_applied = db.Column(db.Integer, default=0)
    wash_credit_used = db.Column(db.Boolean, default=False)
    payment_method = db.Column(db.String(60))

    start_reminder_sent_at = db.Column(db.DateTime)
    end_reminder_sent_at = db.Column(db.DateTime)
    overstay_alert_sent_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utils.now_utc)

    user = db.relationship("User", backref="reservations")
    lot = db.relationship("ParkingLot", backref="reservations")
    slot = db.relationship("ParkingSpot", backref="reservations")
    addons = db.relationship("ReservationAddon", backref="reservation", cascade="all, delete-orphan")
    events = db.relationship("BookingEvent", backref="reservation", cascade="all, delete-orphan",
                             order_by="BookingEvent.id")

    __table_args__ = (db.Index("idx_res_slot_time", "slot_id", "start_time", "end_time"),)

    # -- derived values ------------------------------------------------------------------
    @property
    def paid_for_booking(self):
        """Money actually collected for the booking itself (excludes fines)."""
        return utils.money((self.base_amount or 0) - (self.discount_amount or 0)
                           + (self.addons_amount or 0) + (self.extension_amount or 0))

    def effective_end(self, now):
        """When the slot really stops being occupied (used for conflict / buffer checks)."""
        if self.checked_out_at:
            return self.checked_out_at
        if self.checked_in_at and now > self.end_time:
            return now                                   # still parked past the end
        return self.end_time

    def display_status(self, now, early_minutes=15):
        if self.state == "cancelled":
            return "cancelled"
        if self.checked_out_at:
            return "completed"
        if self.state == "completed":
            return "no_show"
        if self.checked_in_at:
            return "overstay" if now > self.end_time else "parked"
        if now > self.end_time:
            return "no_show"
        if now >= self.start_time - timedelta(minutes=early_minutes):
            return "ready"
        return "upcoming"


class ReservationAddon(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    reservation_id = db.Column(db.Integer, db.ForeignKey("reservation.id"), nullable=False)
    amenity_id = db.Column(db.Integer, db.ForeignKey("amenity.id"))
    code = db.Column(db.String(30))
    name = db.Column(db.String(60))
    unit_price = db.Column(db.Float, default=0.0)
    quantity = db.Column(db.Integer, default=1)
    total = db.Column(db.Float, default=0.0)


class BookingEvent(db.Model):
    """Audit trail shown as a timeline on the booking page."""
    id = db.Column(db.Integer, primary_key=True)
    reservation_id = db.Column(db.Integer, db.ForeignKey("reservation.id"), nullable=False, index=True)
    kind = db.Column(db.String(20), nullable=False)
    message = db.Column(db.String(255))
    amount = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=utils.now_utc)


# ============================================================================ payments & plans
class PaymentTransaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    txn_ref = db.Column(db.String(64), unique=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    reservation_id = db.Column(db.Integer, db.ForeignKey("reservation.id"))
    subscription_id = db.Column(db.Integer, db.ForeignKey("subscription.id"))
    lot_id = db.Column(db.Integer, db.ForeignKey("parking_lot.id"))   # for per-owner revenue reports
    amount = db.Column(db.Float, nullable=False)                      # always positive
    currency = db.Column(db.String(3), default="INR")
    method = db.Column(db.String(20))                                 # card | upi
    method_detail = db.Column(db.String(60))                          # "•••• 4444" / "name@upi" (never a full card number)
    purpose = db.Column(db.String(20))                                # booking | extension | fine | subscription | refund | ride_fare | valet_fee
    status = db.Column(db.String(12), default="success")              # success | failed
    message = db.Column(db.String(160))
    created_at = db.Column(db.DateTime, default=utils.now_utc, index=True)
    # additive links for the driver (ride/valet) domain - reuses this same transaction table/gateway
    # instead of a second payments model; both stay NULL for ordinary parking transactions.
    ride_id = db.Column(db.Integer, db.ForeignKey("ride.id"))
    valet_id = db.Column(db.Integer, db.ForeignKey("valet_request.id"))

    user = db.relationship("User", backref="payment_transactions")
    reservation = db.relationship("Reservation", backref="transactions")


class SubscriptionPlan(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)
    plan_type = db.Column(db.String(10), nullable=False)          # user | admin
    description = db.Column(db.Text)
    price = db.Column(db.Float, nullable=False)
    currency = db.Column(db.String(3), default="INR")
    billing_interval = db.Column(db.String(10), default="monthly")
    duration_days = db.Column(db.Integer, nullable=False, default=30)
    free_parkings = db.Column(db.Integer, default=0)              # user plans: bookings whose slot fee is waived
    free_washes = db.Column(db.Integer, default=0)                # user plans: free car-wash add-ons
    max_lots = db.Column(db.Integer)                              # admin plans: lots allowed (None = unlimited)
    features_json = db.Column(db.Text)
    badge = db.Column(db.String(30))
    is_active = db.Column(db.Boolean, default=True)

    @property
    def features(self):
        try:
            return json.loads(self.features_json) if self.features_json else []
        except ValueError:
            return []


class Subscription(db.Model):
    """A purchased plan (for both users and lot-owner admins)."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("subscription_plan.id"), nullable=False)
    status = db.Column(db.String(12), default="active")           # active | replaced | expired
    start_date = db.Column(db.DateTime, default=utils.now_utc)
    end_date = db.Column(db.DateTime, nullable=False)
    remaining_parkings = db.Column(db.Integer, default=0)
    remaining_washes = db.Column(db.Integer, default=0)
    auto_renew = db.Column(db.Boolean, default=False)

    user = db.relationship("User", backref="subscriptions")
    plan = db.relationship("SubscriptionPlan", backref="subscriptions")

    def is_current(self, now):
        return self.status == "active" and self.end_date > now


# ============================================================================ driver domain (rides + valet)
# Built on top of the existing User/Role/Reservation/PaymentTransaction models above - nothing here
# duplicates them. A "Driver" is a User with the 'driver' role plus this extra profile; a parking
# customer keeps being called "driver" in the existing UI copy (see README/nav), so this domain's own
# UI text says "driver partner" / "ride captain" / "valet driver" to keep the two apart for people
# reading the screen, even though the model class here is named `Driver` per the spec.
#
# Everything is a dummy simulation (no real KYC/document verification, no real GPS, no real payout
# rails) in the same spirit as the existing dummy payment gateway - see FIXES.md.
class Driver(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    driver_type = db.Column(db.String(15), nullable=False)        # ride_captain | valet_driver
    full_name = db.Column(db.String(120), nullable=False)
    dob = db.Column(db.Date)
    address = db.Column(db.String(255))
    profile_photo = db.Column(db.Text)             # data: URI (dummy "upload" - see FIXES.md)
    licence_number = db.Column(db.String(40), nullable=False)
    licence_document = db.Column(db.Text)          # data: URI
    licence_expiry = db.Column(db.Date)
    account_status = db.Column(db.String(12), default="active")   # active | suspended
    suspend_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utils.now_utc)
    updated_at = db.Column(db.DateTime, onupdate=utils.now_utc)

    user = db.relationship("User", backref=db.backref("driver_profile", uselist=False))
    kyc_records = db.relationship("DriverKYC", backref="driver", cascade="all, delete-orphan",
                                  order_by="DriverKYC.id")
    vehicles = db.relationship("DriverVehicle", backref="driver", cascade="all, delete-orphan",
                               order_by="DriverVehicle.id")

    @property
    def latest_kyc(self):
        return self.kyc_records[-1] if self.kyc_records else None

    @property
    def kyc_status(self):
        k = self.latest_kyc
        return k.status if k else "PENDING"

    @property
    def is_verified(self):
        return self.kyc_status == "APPROVED" and self.account_status == "active"

    @property
    def approved_vehicle(self):
        return next((v for v in self.vehicles if v.status == "APPROVED"), None)

    @property
    def can_go_online(self):
        """Ride captains additionally need an approved vehicle; valet drivers drive the
        rider's own car, so they don't need one (business rules 3-4)."""
        if not self.is_verified:
            return False
        if self.driver_type == "ride_captain" and not self.approved_vehicle:
            return False
        return True


class DriverKYC(db.Model):
    """One row per KYC submission/decision. `driver.latest_kyc` is the current one - admins never
    edit history in place, a re-submission or a decision just appends a new row."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey("driver.id"), nullable=False, index=True)
    status = db.Column(db.String(10), default="PENDING")     # PENDING | APPROVED | REJECTED | EXPIRED
    submitted_at = db.Column(db.DateTime, default=utils.now_utc)
    reviewed_at = db.Column(db.DateTime)
    reviewed_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    reject_reason = db.Column(db.String(255))
    notes = db.Column(db.String(255))

    reviewed_by = db.relationship("User")


class DriverVehicle(db.Model):
    """Ride-captain vehicle registration (business rule: valet drivers use the rider's own
    vehicle, so they never need one of these)."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey("driver.id"), nullable=False, index=True)
    reg_number = db.Column(db.String(20), nullable=False)
    manufacturer = db.Column(db.String(60))
    model = db.Column(db.String(60))
    vehicle_type = db.Column(db.String(12), default="car")     # car | suv | auto | bike
    colour = db.Column(db.String(30))
    year = db.Column(db.Integer)
    seating_capacity = db.Column(db.Integer, default=4)
    photo = db.Column(db.Text)
    registration_expiry = db.Column(db.Date)
    insurance_expiry = db.Column(db.Date)
    status = db.Column(db.String(10), default="PENDING")       # PENDING | APPROVED | REJECTED
    reject_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utils.now_utc)


class DriverAvailability(db.Model):
    """One row per driver. Status is stored using one shared vocabulary (AVAILABLE/OFFLINE/BUSY) -
    the UI labels AVAILABLE as "Online" for ride captains and "Available" for valet drivers
    (business rule: a driver that is BUSY cannot be offered another job)."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey("driver.id"), unique=True, nullable=False)
    status = db.Column(db.String(10), default="OFFLINE")        # AVAILABLE | OFFLINE | BUSY
    updated_at = db.Column(db.DateTime, default=utils.now_utc)

    driver = db.relationship("Driver", backref=db.backref("availability", uselist=False))


class Ride(db.Model):
    """Ride Captain trip: REQUESTED -> ACCEPTED -> DRIVER_ARRIVING -> DRIVER_ARRIVED ->
    RIDE_STARTED -> RIDE_COMPLETED (or CANCELLED at any point before completion)."""
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(16), unique=True, nullable=False)
    rider_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    driver_id = db.Column(db.Integer, db.ForeignKey("driver.id"), index=True)
    reservation_id = db.Column(db.Integer, db.ForeignKey("reservation.id"))   # optional Lot<->Destination link

    pickup_label = db.Column(db.String(160), nullable=False)
    drop_label = db.Column(db.String(160), nullable=False)
    distance_km = db.Column(db.Float, default=0.0)          # straight-line map distance x ROAD_DISTANCE_FACTOR
    # Real lat/lng from the rider's OpenStreetMap pin-drop (see FIXES.md) - optional/nullable so a
    # ride requested without the map (or from an older client) still works with just the text labels.
    pickup_lat = db.Column(db.Float)
    pickup_lng = db.Column(db.Float)
    drop_lat = db.Column(db.Float)
    drop_lng = db.Column(db.Float)

    status = db.Column(db.String(20), default="REQUESTED")
    requested_at = db.Column(db.DateTime, default=utils.now_utc)
    accepted_at = db.Column(db.DateTime)
    arriving_at = db.Column(db.DateTime)
    arrived_at = db.Column(db.DateTime)
    started_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)
    cancelled_at = db.Column(db.DateTime)
    cancel_reason = db.Column(db.String(255))
    cancelled_by = db.Column(db.String(10))                  # rider | driver

    rider = db.relationship("User", foreign_keys=[rider_id])
    driver = db.relationship("Driver", backref="rides")
    reservation = db.relationship("Reservation", backref="rides")
    status_history = db.relationship("RideStatusHistory", backref="ride", cascade="all, delete-orphan",
                                     order_by="RideStatusHistory.id")
    fare = db.relationship("RideFare", backref="ride", uselist=False, cascade="all, delete-orphan")


class RideStatusHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    ride_id = db.Column(db.Integer, db.ForeignKey("ride.id"), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False)
    note = db.Column(db.String(255))
    at = db.Column(db.DateTime, default=utils.now_utc)


class RideFare(db.Model):
    """Dummy fare = base + distance x rate + time x rate (+ waiting / cancellation / surge).
    Kept fully separate from parking charges (a different table from Reservation amounts) but the
    actual money movement reuses PaymentTransaction/DummyPaymentGateway via `Applications.payments`."""
    id = db.Column(db.Integer, primary_key=True)
    ride_id = db.Column(db.Integer, db.ForeignKey("ride.id"), unique=True, nullable=False)
    base_fare = db.Column(db.Float, default=0.0)
    distance_fare = db.Column(db.Float, default=0.0)
    time_fare = db.Column(db.Float, default=0.0)
    waiting_fee = db.Column(db.Float, default=0.0)
    cancellation_fee = db.Column(db.Float, default=0.0)
    surge_multiplier = db.Column(db.Float, default=1.0)
    total = db.Column(db.Float, default=0.0)
    platform_fee = db.Column(db.Float, default=0.0)
    driver_earning = db.Column(db.Float, default=0.0)
    paid = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utils.now_utc)


class ValetRequest(db.Model):
    """Valet job: REQUESTED -> DRIVER_ASSIGNED -> DRIVER_GOING_TO_PICKUP -> VEHICLE_PICKED_UP ->
    VEHICLE_IN_TRANSIT -> VEHICLE_DROPPED -> COMPLETED (or CANCELLED before completion).
    request_type is one of the 4 Home<->Lot / Location<->Lot moves."""
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(16), unique=True, nullable=False)
    rider_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    driver_id = db.Column(db.Integer, db.ForeignKey("driver.id"), index=True)
    reservation_id = db.Column(db.Integer, db.ForeignKey("reservation.id"))
    lot_id = db.Column(db.Integer, db.ForeignKey("parking_lot.id"))

    request_type = db.Column(db.String(20), nullable=False)   # home_to_lot | lot_to_home | location_to_lot | lot_to_location
    vehicle_number = db.Column(db.String(15), nullable=False)
    pickup_label = db.Column(db.String(160), nullable=False)
    drop_label = db.Column(db.String(160), nullable=False)
    distance_km = db.Column(db.Float, default=0.0)
    # Real lat/lng from the rider's OpenStreetMap pin-drop (see FIXES.md) - optional/nullable, same
    # reasoning as Ride above.
    pickup_lat = db.Column(db.Float)
    pickup_lng = db.Column(db.Float)
    drop_lat = db.Column(db.Float)
    drop_lng = db.Column(db.Float)

    status = db.Column(db.String(24), default="REQUESTED")
    requested_at = db.Column(db.DateTime, default=utils.now_utc)
    assigned_at = db.Column(db.DateTime)
    going_to_pickup_at = db.Column(db.DateTime)
    picked_up_at = db.Column(db.DateTime)
    in_transit_at = db.Column(db.DateTime)
    dropped_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)
    cancelled_at = db.Column(db.DateTime)
    cancel_reason = db.Column(db.String(255))
    cancelled_by = db.Column(db.String(10))

    fee = db.Column(db.Float, default=0.0)
    cancellation_fee = db.Column(db.Float, default=0.0)
    platform_fee = db.Column(db.Float, default=0.0)
    driver_earning = db.Column(db.Float, default=0.0)
    paid = db.Column(db.Boolean, default=False)

    rider = db.relationship("User", foreign_keys=[rider_id])
    driver = db.relationship("Driver", backref="valet_jobs")
    reservation = db.relationship("Reservation", backref="valet_requests")
    lot = db.relationship("ParkingLot")
    status_history = db.relationship("ValetStatusHistory", backref="valet", cascade="all, delete-orphan",
                                     order_by="ValetStatusHistory.id")
    handovers = db.relationship("VehicleHandover", backref="valet", cascade="all, delete-orphan",
                                order_by="VehicleHandover.id")


class ValetStatusHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    valet_id = db.Column(db.Integer, db.ForeignKey("valet_request.id"), nullable=False, index=True)
    status = db.Column(db.String(24), nullable=False)
    note = db.Column(db.String(255))
    at = db.Column(db.DateTime, default=utils.now_utc)


class VehicleHandover(db.Model):
    """Proof-of-handover at pickup and drop-off. The rider views these from their existing User
    Dashboard (My Valet Requests) - that page is not redesigned, just extended to show this."""
    id = db.Column(db.Integer, primary_key=True)
    valet_id = db.Column(db.Integer, db.ForeignKey("valet_request.id"), nullable=False, index=True)
    stage = db.Column(db.String(10), nullable=False)          # pickup | dropoff
    photo = db.Column(db.Text)
    vehicle_number = db.Column(db.String(15))
    condition_notes = db.Column(db.String(500))
    fuel_level_percent = db.Column(db.Integer)                # only meaningful at pickup
    location_label = db.Column(db.String(160))
    created_at = db.Column(db.DateTime, default=utils.now_utc)


class DriverRating(db.Model):
    """1-5 stars + optional review, given by the rider after a completed ride OR valet job
    (never both on the same row)."""
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey("driver.id"), nullable=False, index=True)
    ride_id = db.Column(db.Integer, db.ForeignKey("ride.id"), unique=True)
    valet_id = db.Column(db.Integer, db.ForeignKey("valet_request.id"), unique=True)
    rider_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    stars = db.Column(db.Integer, nullable=False)
    review = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=utils.now_utc)

    driver = db.relationship("Driver", backref="ratings")
    rider = db.relationship("User")
    ride = db.relationship("Ride", backref=db.backref("rating", uselist=False))
    valet = db.relationship("ValetRequest", backref=db.backref("rating", uselist=False))


class DriverNotification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    driver_id = db.Column(db.Integer, db.ForeignKey("driver.id"), nullable=False, index=True)
    kind = db.Column(db.String(30))
    title = db.Column(db.String(120))
    message = db.Column(db.String(255))
    ride_id = db.Column(db.Integer, db.ForeignKey("ride.id"))
    valet_id = db.Column(db.Integer, db.ForeignKey("valet_request.id"))
    read_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utils.now_utc)

    driver = db.relationship("Driver", backref="notifications")
