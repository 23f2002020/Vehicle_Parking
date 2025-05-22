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
    roles = db.relationship('Role', backref='bearer', secondary='user_roles')
    reservations = db.relationship('Reservation', backref='user', lazy=True)
    subscriptions = db.relationship('UserSubscription', backref='user', lazy=True)
    payments = db.relationship('PaymentTransaction', backref='user', lazy=True)
    valet_requests = db.relationship('ValetRequest', backref='user', lazy=True)

class UserRoles(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    role_id = db.Column(db.Integer, db.ForeignKey('role.id', ondelete='CASCADE'))

class ParkingLot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(255), nullable=False)
    pin_code = db.Column(db.String(6), nullable=False)
    price_per_hour = db.Column(db.Float, nullable=False)
    min_gap_minutes = db.Column(db.Integer, default=60)
    number_of_spots = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    spots = db.relationship('ParkingSpot', backref='lot', lazy=True)

    @property
    def available_spots_count(self):
        return ParkingSpot.query.filter_by(lot_id=self.id, status='A').count()
    
    @property
    def occupied_spots_count(self):
        return self.total_spots - self.available_spots_count

    def initialize_slots(self):
        """Create numbered slots when lot is created"""
        for number in range(1, self.total_slots + 1):
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
    name = db.Column(db.String(50), nullable=False)
    duration_days = db.Column(db.Integer, nullable=False)
    price = db.Column(db.Float, nullable=False)
    free_parkings = db.Column(db.Integer, nullable=False)
    free_washes = db.Column(db.Integer, default=0)
    description = db.Column(db.String(255))

class UserSubscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'))
    plan_id = db.Column(db.Integer, db.ForeignKey('subscription_plan.id', ondelete='CASCADE'))
    start_date = db.Column(db.DateTime, default=datetime.utcnow)
    end_date = db.Column(db.DateTime)
    remaining_parkings = db.Column(db.Integer)
    remaining_washes = db.Column(db.Integer, default=0)
    is_active = db.Column(db.Boolean, default=True)

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