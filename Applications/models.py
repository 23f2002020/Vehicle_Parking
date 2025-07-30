from .database import db
from datetime import datetime
from flask_security import RoleMixin, UserMixin

class Role(db.Model, RoleMixin):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True)
    description = db.Column(db.String(255))

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String, unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String, nullable=False)
    fs_uniquifier = db.Column(db.String, unique=True, nullable=False)
    active = db.Column(db.Boolean, default=True)
    roles = db.relationship('Role', secondary='user_roles', backref='users')
    ban_reason = db.Column(db.String(255), nullable=True)
    # Free allowance for users
    free_parking_minutes_allowed = db.Column(db.Integer, default=240) # 4 hours * 60 minutes
    free_parking_minutes_used = db.Column(db.Integer, default=0)
    free_parking_last_reset_date = db.Column(db.DateTime, default=datetime.utcnow)
    current_user_subscription_id = db.Column(db.Integer, db.ForeignKey('user_subscription.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    phone = db.Column(db.String(15), nullable=True)
    address = db.Column(db.String(255), nullable=True)
    valet_requests = db.relationship('ValetRequest', backref='user', lazy=True)

    def __repr__(self):
        return f'<User {self.username}>'

class Admin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128)) # Note: Flask-Security uses 'password' directly on User model
    phone = db.Column(db.String(15), nullable=True)
    age = db.Column((db.Integer), nullable=True)
    # Free allowance for admins
    free_spots_allowed = db.Column(db.Integer, default=2)
    free_spots_used = db.Column(db.Integer, default=0)
    is_on_free_tier = db.Column(db.Boolean, default=True)
    current_admin_subscription_id = db.Column(db.Integer, db.ForeignKey('admin_subscription.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<Admin {self.username}>'

class UserRoles(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    role_id = db.Column(db.Integer, db.ForeignKey('role.id', ondelete='CASCADE'))

class ParkingLot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(255), nullable=False)
    pin_code = db.Column(db.String(6), nullable=False)

    # Admin and Supervisor
    admin_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    supervisor_name = db.Column(db.String(100), nullable=True)

    # Dimensions
    rows = db.Column(db.Integer, nullable=False)
    columns = db.Column(db.Integer, nullable=False)
    floors = db.Column(db.Integer, default=1)

    # Derived attributes
    number_of_spots = db.Column(db.Integer, nullable=False)
    price_per_hour = db.Column(db.Float, nullable=False)

    # Optional features
    charging_available = db.Column(db.Boolean, default=False)
    water_wash_available = db.Column(db.Boolean, default=False)
    other_services = db.Column(db.String(255), nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    # Relationships
    admin = db.relationship('User', backref='parking_lots')
    slots = db.relationship('ParkingSpot', backref='lot', lazy=True)
    # Added min_gap_minutes to ParkingLot, as it's used in check_availability
    min_gap_minutes = db.Column(db.Integer, default=15) # Default to 15 minutes gap

    @property
    def available_spots_count(self):
        return ParkingSpot.query.filter_by(lot_id=self.id, status='A').count()

    @property
    def occupied_spots_count(self):
        return self.number_of_spots - self.available_spots_count

    def initialize_slots(self):
        """Create numbered slots when lot is created"""
        existing = ParkingSpot.query.filter_by(lot_id=self.id).count()
        if existing > 0:
            return  # Don't re-initialize if slots already exist

        for number in range(1, self.number_of_spots + 1):
            slot = ParkingSpot(
                lot_id=self.id,
                slot_number=number,
                status='A'
            )
            db.session.add(slot)
        db.session.commit()
    
    def reinitialize_slots(self):
        """Deletes all existing spots and creates new ones based on current dimensions."""

        # Delete existing reservations for this lot's spots if any
        spot_ids = [s.id for s in self.slots]
        if spot_ids:
            Reservation.query.filter(Reservation.slot_id.in_(spot_ids)).delete(synchronize_session=False)

        # Delete spots of this lot
        ParkingSpot.query.filter_by(lot_id=self.id).delete()

        # Create new spots
        for number in range(1, self.number_of_spots + 1):
            slot = ParkingSpot(
                lot_id=self.id,
                slot_number=number,
                status='A'
            )
            db.session.add(slot)
        db.session.commit()  

class ParkingSpot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    lot_id = db.Column(db.Integer, db.ForeignKey('parking_lot.id', ondelete='CASCADE'))
    status = db.Column(db.String(1), default='A')  # A - Available, O - Occupied
    slot_number = db.Column(db.Integer, nullable=False)
    # vehicle_number is typically on Reservation, not on ParkingSpot itself
    vehicle_number = db.Column(db.String(15), nullable=True)
    reservations = db.relationship('Reservation', backref='spot', lazy=True)

    def update_status(self):
        """Update status based on current reservations"""
        now = datetime.utcnow()
        active_reservation = Reservation.query.filter(
            Reservation.slot_id == self.id,
            Reservation.start_datetime <= now,
            Reservation.end_datetime >= now,
            Reservation.status == 'confirmed'
        ).first()

        if active_reservation:
            self.status = 'O'
            self.vehicle_number = active_reservation.vehicle_number
        else:
            self.status = 'A'
            self.vehicle_number = None
        return self.status
    
    # In models.py, add this method inside the ParkingLot class

    

class Reservation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    slot_id = db.Column(db.Integer, db.ForeignKey('parking_spot.id', ondelete='CASCADE'))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    status = db.Column(db.String(20), default='confirmed')
    start_datetime = db.Column(db.DateTime, nullable=False)
    end_datetime = db.Column(db.DateTime, nullable=False)
    # Removed parking_timestamp, as start_datetime serves the same purpose
    # parking_timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    hours_needed = db.Column(db.Integer, nullable=True) # Made nullable as it can be derived
    leaving_timestamp = db.Column(db.DateTime, nullable=True)
    parking_cost = db.Column(db.Float, nullable=True)
    vehicle_number = db.Column(db.String(15), nullable=False) # Added vehicle_number to Reservation
    valet = db.Column(db.String(20), nullable=True) # Added for valet service type
    payment_method = db.Column(db.String(50), nullable=True) # Added for payment method
    penalty_applied = db.Column(db.Float, default=0.0)
    user = db.relationship('User', backref='reservations')
    __table_args__ = (
        db.Index('idx_reservation_slot_datetime', 'slot_id', 'start_datetime', 'end_datetime'),
    )


class SubscriptionPlan(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)
    plan_type = db.Column(db.String(10), nullable=False)  # 'user' or 'admin'
    description = db.Column(db.Text)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    currency = db.Column(db.String(3), default='INR')
    billing_interval = db.Column(db.String(10), nullable=False)  # 'monthly', 'annually'

    # Add these fields to support your new logic
    duration_days = db.Column(db.Integer, nullable=False, default=30)
    free_parkings = db.Column(db.Integer, default=0)
    free_washes = db.Column(db.Integer, default=0)

    max_spots = db.Column(db.Integer)  # Nullable for user plans or unlimited admin plans
    max_parking_hours_monthly = db.Column(db.Integer)  # Nullable for admin plans or unlimited user plans
    features_json = db.Column(db.Text)  # Optional: JSON for future extensibility
    is_active = db.Column(db.Boolean, default=True)
    

    def __repr__(self):
        return f'<SubscriptionPlan {self.name}>'


class UserSubscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', name='fk_user_subscription_user'), nullable=False)
    plan_id = db.Column(db.Integer, db.ForeignKey('subscription_plan.id'), nullable=False)
    start_date = db.Column(db.DateTime, default=datetime.utcnow)
    end_date = db.Column(db.DateTime)
    status = db.Column(db.String(20), default='active')
    auto_renew = db.Column(db.Boolean, default=True)
    last_payment_date = db.Column(db.DateTime)
    next_billing_date = db.Column(db.DateTime)
    stripe_customer_id = db.Column(db.String(100))
    stripe_subscription_id = db.Column(db.String(100))

    # Add remaining allowances here
    remaining_parkings = db.Column(db.Integer, default=0)
    remaining_washes = db.Column(db.Integer, default=0)


    # Explicit relationship with foreign_keys specified
    user = db.relationship('User', foreign_keys=[user_id], backref=db.backref('subscriptions', lazy=True))
    plan = db.relationship('SubscriptionPlan', backref='user_subscriptions', lazy=True)

    def __repr__(self):
        return f'<UserSubscription User:{self.user_id} Plan:{self.plan_id} Status:{self.status}>'

class AdminSubscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    # Admin is not a UserMixin, so current_user might not directly map to admin.id
    # Ensure consistency in how admins are handled, typically they are also Users with an 'admin' role.
    # For now, assuming admin_id links to User.id.
    admin_id = db.Column(db.Integer, db.ForeignKey('user.id', name='fk_admin_subscription_admin'), nullable=False)
    plan_id = db.Column(db.Integer, db.ForeignKey('subscription_plan.id'), nullable=False)
    start_date = db.Column(db.DateTime, default=datetime.utcnow)
    end_date = db.Column(db.DateTime)
    status = db.Column(db.String(20), default='active')
    auto_renew = db.Column(db.Boolean, default=True)
    last_payment_date = db.Column(db.DateTime)
    next_billing_date = db.Column(db.DateTime)
    stripe_customer_id = db.Column(db.String(100))
    stripe_subscription_id = db.Column(db.String(100))

    # Explicit relationship with foreign_keys specified
    admin = db.relationship('User', foreign_keys=[admin_id], backref=db.backref('admin_subscriptions', lazy=True))
    plan = db.relationship('SubscriptionPlan', backref='admin_subscriptions', lazy=True)

    def __repr__(self):
        return f'<AdminSubscription Admin:{self.admin_id} Plan:{self.plan_id} Status:{self.status}>'

class ParkingSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    # admin_id is likely for management, not direct session. If admin manages, use user_id from User model
    # admin_id = db.Column(db.Integer, db.ForeignKey('admin.id'), nullable=True)
    spot_id = db.Column(db.Integer, db.ForeignKey('parking_spot.id'), nullable=False)
    vehicle_license_plate = db.Column(db.String(20), nullable=False)
    start_time = db.Column(db.DateTime, default=datetime.utcnow)
    end_time = db.Column(db.DateTime)
    duration_minutes = db.Column(db.Integer)
    cost = db.Column(db.Numeric(10, 2))
    is_free_session = db.Column(db.Boolean, default=False)
    free_minutes_consumed = db.Column(db.Integer, default=0)
    status = db.Column(db.String(20), default='active')

    user = db.relationship('User', backref='parking_sessions', lazy=True)
    # parking_spot is already defined through Reservation relationship indirectly
    parking_spot = db.relationship('ParkingSpot', backref='parking_sessions', lazy=True)

    def __repr__(self):
        return f'<ParkingSession {self.id} Spot:{self.spot_id} Status:{self.status}>'

class PaymentTransaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    reservation_id = db.Column(db.Integer, db.ForeignKey('reservation.id'), nullable=True) # Added this line
    # --- FIX ENDS HERE ---
    amount = db.Column(db.Float, nullable=False)
    transaction_id = db.Column(db.String(100), unique=True)
    payment_method = db.Column(db.String(50))
    payment_type = db.Column(db.String(20))
    status = db.Column(db.String(20), default='pending')
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    subscription_id = db.Column(db.Integer, db.ForeignKey('user_subscription.id'), nullable=True) # Made nullable
    user = db.relationship('User', backref='payment_transactions')
    reservation = db.relationship('Reservation', backref='payment_transactions')

class ValetRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    reservation_id = db.Column(db.Integer, db.ForeignKey('reservation.id'), nullable=True) # Made nullable
    request_type = db.Column(db.String(20))
    status = db.Column(db.String(20), default='pending')
    vehicle_location = db.Column(db.String(255))
    requested_time = db.Column(db.DateTime, default=datetime.utcnow) # Renamed from request_time
    completed_time = db.Column(db.DateTime, nullable=True)
    notes = db.Column(db.Text, nullable=True)

    # NEW: Model to handle refund requests, separating concerns.
class RefundRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    reservation_id = db.Column(db.Integer, db.ForeignKey('reservation.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    bank_details = db.Column(db.Text, nullable=False) # Encrypt this in a real app
    status = db.Column(db.String(20), default='pending') # pending, processed, failed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    processed_at = db.Column(db.DateTime, nullable=True)