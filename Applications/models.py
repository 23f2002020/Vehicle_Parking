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
    
    # Free allowance for users
    free_parking_minutes_allowed = db.Column(db.Integer, default=240) # 4 hours * 60 minutes
    free_parking_minutes_used = db.Column(db.Integer, default=0)
    free_parking_last_reset_date = db.Column(db.DateTime, default=datetime.utcnow)
    current_user_subscription_id = db.Column(db.Integer, db.ForeignKey('user_subscription.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    valet_requests = db.relationship('ValetRequest', backref='user', lazy=True)
    
    def __repr__(self):
        return f'<User {self.username}>'

class Admin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128))
    
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

class ParkingSpot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    lot_id = db.Column(db.Integer, db.ForeignKey('parking_lot.id', ondelete='CASCADE'))
    status = db.Column(db.String(1), default='A')  # A - Available, O - Occupied
    slot_number = db.Column(db.Integer, nullable=False)
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
        
        self.status = 'O' if active_reservation else 'A'
        db.session.commit()
        return self.status

class Reservation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    slot_id = db.Column(db.Integer, db.ForeignKey('parking_spot.id', ondelete='CASCADE'))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    status = db.Column(db.String(20), default='confirmed')
    start_datetime = db.Column(db.DateTime, nullable=False)
    end_datetime = db.Column(db.DateTime, nullable=False)
    parking_timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    hours_needed = db.Column(db.Integer, nullable=False)
    leaving_timestamp = db.Column(db.DateTime, nullable=True)
    parking_cost = db.Column(db.Float, nullable=True)
    
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

    # Explicit relationship with foreign_keys specified
    user = db.relationship('User', foreign_keys=[user_id], backref=db.backref('subscriptions', lazy=True))
    plan = db.relationship('SubscriptionPlan', backref='user_subscriptions', lazy=True)

    def __repr__(self):
        return f'<UserSubscription User:{self.user_id} Plan:{self.plan_id} Status:{self.status}>'

class AdminSubscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admin.id', name='fk_admin_subscription_admin'), nullable=False)
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
    admin = db.relationship('Admin', foreign_keys=[admin_id], backref=db.backref('subscriptions', lazy=True))
    plan = db.relationship('SubscriptionPlan', backref='admin_subscriptions', lazy=True)

    def __repr__(self):
        return f'<AdminSubscription Admin:{self.admin_id} Plan:{self.plan_id} Status:{self.status}>'

class ParkingSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admin.id'), nullable=True)
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
    admin = db.relationship('Admin', backref='managed_parking_sessions', lazy=True)
    parking_spot = db.relationship('ParkingSpot', backref='parking_sessions', lazy=True)

    def __repr__(self):
        return f'<ParkingSession {self.id} Spot:{self.spot_id} Status:{self.status}>'

class PaymentTransaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    amount = db.Column(db.Float, nullable=False)
    transaction_id = db.Column(db.String(100), unique=True)
    payment_method = db.Column(db.String(50))
    status = db.Column(db.String(20), default='pending')
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    subscription_id = db.Column(db.Integer, db.ForeignKey('user_subscription.id'))

class ValetRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    reservation_id = db.Column(db.Integer, db.ForeignKey('reservation.id'))
    request_type = db.Column(db.String(20))
    status = db.Column(db.String(20), default='pending')
    vehicle_location = db.Column(db.String(255))
    requested_time = db.Column(db.DateTime, default=datetime.utcnow)
    completed_time = db.Column(db.DateTime, nullable=True)
    notes = db.Column(db.Text, nullable=True)