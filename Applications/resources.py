from flask_restful import Api, Resource, reqparse
from .models import *
from flask import jsonify, request, current_app
from flask_security import auth_required, roles_required, current_user, roles_accepted
from Applications.task import send_reservation_email # Assuming this is correctly set up
from datetime import datetime, timedelta, time
import math
from sqlalchemy import event, and_, func
import os

api = Api()

# Dummy payment gateway for local testing (if you don't have a real one)
class DummyPaymentGateway:
    def process_payment(self, amount):
        # Simulate a successful payment
        return {'status': 'success', 'transaction_id': f"dummy_txn_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"}


class ParkingLotResource(Resource):
    @auth_required('token')
    @roles_accepted('admin', 'user')
    @roles_accepted('admin', 'user')
    def get(self, lot_id=None):
        if lot_id:
            lot = ParkingLot.query.get_or_404(lot_id)
            # FIX: Corrected the double curly braces syntax error
            return jsonify({
                "id": lot.id,
                "name": lot.name,
                "address": lot.address,
                "pin_code": lot.pin_code,
                "supervisor_name": lot.supervisor_name,
                "rows": lot.rows,
                "columns": lot.columns,
                "floors": lot.floors,
                "number_of_spots": lot.number_of_spots,
                "available_spots": lot.available_spots_count, # Use the property
                "price_per_hour": float(lot.price_per_hour),
                "charging_available": lot.charging_available,
                "water_wash_available": lot.water_wash_available,
                "other_services": lot.other_services
            })
        else:
            lots = ParkingLot.query.all()
            lots_data = []
            for lot in lots:
                # FIX: Expanded the data to include all fields needed for the edit modal
                lots_data.append({
                    "id": lot.id,
                    "name": lot.name,
                    "address": lot.address,
                    "pin_code": lot.pin_code,
                    "supervisor_name": lot.supervisor_name,
                    "rows": lot.rows,
                    "columns": lot.columns,
                    "floors": lot.floors,
                    "number_of_spots": lot.number_of_spots,
                    "price_per_hour": float(lot.price_per_hour),
                    "available_spots": lot.available_spots_count, # Use the property
                    "charging_available": lot.charging_available,
                    "water_wash_available": lot.water_wash_available,
                    "other_services": lot.other_services
                })
            return jsonify(lots_data)

    @auth_required('token')
    @roles_required('admin')
    def post(self):
        admin_id = current_user.id

        # Count lots created by this admin
        existing_lots = ParkingLot.query.filter_by(admin_id=admin_id).count()

        # Enforce limit unless subscription is active
        if existing_lots >= 2:
            # Check for an active admin subscription
            subscription = AdminSubscription.query.filter_by(admin_id=admin_id, status='active').first()
            if not subscription:
                return {"message": "Upgrade subscription to add more than 2 parking lots"}, 403

        data = request.get_json()
        required_fields = ['name', 'address', 'pin_code', 'rows', 'columns', 'price_per_hour', 'supervisor_name']
        if not all(field in data for field in required_fields):
            return {"message": f"Missing required fields: {', '.join(f for f in required_fields if f not in data)}"}, 400

        floors = int(data.get('floors', 1))
        rows = int(data['rows'])
        columns = int(data['columns'])
        total_spots = rows * columns * floors
        
        try:
            lot = ParkingLot(
                name=data['name'],
                address=data['address'],
                pin_code=data['pin_code'],
                rows=rows,
                columns=columns,
                floors=floors,
                number_of_spots=total_spots,
                price_per_hour=float(data['price_per_hour']),
                supervisor_name=data['supervisor_name'],
                charging_available=bool(data.get('charging_available', False)),
                water_wash_available=bool(data.get('water_wash_available', False)),
                other_services=data.get('other_services', ''),
                admin_id=admin_id,
                min_gap_minutes=data.get('min_gap_minutes', 15)
            )

            db.session.add(lot)
            db.session.commit()
            lot.initialize_slots()
            return {"message": "Parking lot created successfully"}, 201

        except Exception as e:
            db.session.rollback()
            return {"message": f"Error creating lot: {str(e)}"}, 500

    # In resources.py, update the put method in ParkingLotResource

    @auth_required('token')
    @roles_required('admin')
    def put(self, lot_id):
        lot = ParkingLot.query.get_or_404(lot_id)
        if lot.admin_id != current_user.id:
            return {"message": "You do not have permission to edit this lot."}, 403
            
        data = request.get_json()

        # Check if the dimensions are changing before updating the object
        dimensions_changed = (
            lot.rows != int(data.get('rows', lot.rows)) or
            lot.columns != int(data.get('columns', lot.columns)) or
            lot.floors != int(data.get('floors', lot.floors))
        )

        lot.name = data.get('name', lot.name)
        lot.address = data.get('address', lot.address)
        lot.pin_code = data.get('pin_code', lot.pin_code)
        lot.supervisor_name = data.get('supervisor_name', lot.supervisor_name)
        lot.price_per_hour = data.get('price_per_hour', lot.price_per_hour)
        lot.rows = int(data.get('rows', lot.rows))
        lot.columns = int(data.get('columns', lot.columns))
        lot.floors = int(data.get('floors', lot.floors))
        lot.number_of_spots = lot.rows * lot.columns * lot.floors
        lot.charging_available = data.get('charging_available', lot.charging_available)
        lot.water_wash_available = data.get('water_wash_available', lot.water_wash_available)
        lot.other_services = data.get('other_services', lot.other_services)

        # If dimensions have changed, regenerate the spots
        if dimensions_changed:
            lot.reinitialize_slots()

        db.session.commit()
        return jsonify({"message": "Parking lot updated successfully"})

    @auth_required('token')
    @roles_required('admin')
    # FIX: Changed signature and logic to use URL parameter instead of query args
    def delete(self, lot_id):
        lot = ParkingLot.query.get(lot_id)
        if not lot:
            return {"message": "Parking lot not found"}, 404
        
        if lot.admin_id != current_user.id:
            return {"message": "You do not have permission to delete this lot."}, 403

        db.session.delete(lot)
        db.session.commit()
        return {"message": "Parking lot deleted successfully"}, 200

@event.listens_for(Reservation, 'after_insert')
@event.listens_for(Reservation, 'after_update')
def update_spot_on_booking(mapper, connection, target):
    if target.status in ['upcoming', 'active']:
        connection.execute(
            ParkingSpot.__table__.update().
            where(ParkingSpot.id == target.slot_id).
            values(vehicle_number=target.vehicle_number, status='O')
        )

@event.listens_for(Reservation, 'after_delete')
def clear_spot_on_cancellation(mapper, connection, target):
    now = datetime.utcnow()
    other_booking_exists = connection.execute(
        Reservation.__table__.select().where(
            and_(
                Reservation.slot_id == target.slot_id,
                Reservation.id != target.id,
                Reservation.end_datetime > now,
                Reservation.status.in_(['upcoming', 'active'])
            )
        )
    ).first()
    if not other_booking_exists:
        connection.execute(
            ParkingSpot.__table__.update().
            where(ParkingSpot.id == target.slot_id).
            values(vehicle_number=None, status='A')
        )

class UserReservationResource(Resource):
    @auth_required('token')
    @roles_required('user')
    def post(self):
        user_id = current_user.id
        data = request.json
        lot_id = data.get('lot_id')
        vehicle_number = data.get('vehicle_number', 'UNKNOWN') 
        vehicle_number = data.get('vehicle_number')
        valet = data.get('valet')  # new
        payment_method = data.get('payment_method')# Added vehicle_number

        available_spot = ParkingSpot.query.filter_by(lot_id=lot_id, status='A').first()
        if not available_spot:
            return {"message": "No available parking spots in selected lot."}, 404

        lot = ParkingLot.query.get(lot_id)
        # available_spot.status = 'O' # Status update handled by ReservationResource and event listener
        # db.session.add(available_spot)

        # For quick reservation, assume a default 2-hour duration from now
        start_time = datetime.utcnow()
        end_time = start_time + timedelta(hours=2)
        hours_needed = 2

        reservation = Reservation(
            slot_id=available_spot.id,
            user_id=user_id,
            start_datetime=start_time,
            end_datetime=end_time,
            parking_cost=0.0, # Will be calculated upon completion or fixed for quick booking
            hours_needed=hours_needed,
            vehicle_number=vehicle_number,
            valet = valet,  # new
            payment_method = payment_method
        )
        db.session.add(reservation)
        db.session.commit()

        subject = "Parking Spot Reserved"
        body = f"Dear {current_user.username},\n\nYour parking spot at '{lot.name}' is reserved.\nReservation ID: {reservation.id}\nLot Address: {lot.address}\nSpot ID: {available_spot.slot_number}\nVehicle: {vehicle_number}\nStart Time: {reservation.start_datetime.strftime('%Y-%m-%d %H:%M')}\nHours Needed: {hours_needed} hour(s)\n\nThank you."
        send_reservation_email.delay(current_user.email, subject, body)

        return {"message": "Spot reserved successfully", "reservation_id": reservation.id}, 201

    @auth_required('token')
    @roles_required('user')
    def put(self):
        user_id = current_user.id
        data = request.json
        reservation_id = data.get('id')
        reservation = Reservation.query.filter_by(id=reservation_id, user_id=user_id).first()
        if not reservation:
            return {"message": "Reservation not found"}, 404

        if data.get('leaving_timestamp'):
            try:
                reservation.leaving_timestamp = datetime.fromisoformat(data.get('leaving_timestamp'))
            except ValueError:
                return {"message": "Invalid date format"}, 400

            # Calculate cost
            lot = ParkingLot.query.get(reservation.slot.lot_id) # Access lot through spot
            hours_parked = math.ceil((reservation.leaving_timestamp - reservation.start_datetime).total_seconds() / 3600)
            expected_hours = reservation.hours_needed or 0
            fine_hours = max(0, hours_parked - expected_hours)
            reservation.parking_cost = (lot.price_per_hour * expected_hours) + (fine_hours * lot.price_per_hour * 1.5)  # 50% fine rate

        db.session.commit()
        return {"message": "Reservation updated successfully", "cost": reservation.parking_cost}, 200

    @auth_required('token')
    @roles_required('user')
    def delete(self):
        user_id = current_user.id
        reservation_id = request.args.get('id')
        reservation = Reservation.query.filter_by(id=reservation_id, user_id=user_id).first()
        if not reservation:
            return {"message": "Reservation not found"}, 404

        # The slot status will be automatically updated by the event listener after deletion
        db.session.delete(reservation)
        db.session.commit()
        return {"message": "Reservation deleted successfully"}, 200

class SubscriptionResource(Resource):
    @auth_required('token')
    @roles_accepted('user', 'admin')
    def get(self):
        from Applications.models import Admin
        # This checks if the current user's email matches an Admin in the DB
        is_admin = Admin.query.filter_by(email=current_user.email).first() is not None

        if is_admin:
            plans = SubscriptionPlan.query.filter_by(plan_type='admin').all()
        else:
            plans = SubscriptionPlan.query.filter_by(plan_type='user').all()

        return jsonify([{
            "id": plan.id,
            "name": plan.name,
            "duration": plan.duration_days,
            "price": float(plan.price),
            "free_parkings": plan.free_parkings,
            "free_washes": plan.free_washes,
            "description": plan.description,
            "plan_type": plan.plan_type
        } for plan in plans])

    @auth_required('token')
    @roles_required('admin')
    def put(self, plan_id):
        data = request.get_json()
        plan = SubscriptionPlan.query.get(plan_id)

        if not plan:
            return {"message": "Subscription plan not found"}, 404

        plan.name = data.get('name', plan.name)
        plan.duration_days = data.get('duration_days', plan.duration_days)
        plan.price = data.get('price', plan.price)
        plan.free_parkings = data.get('free_parkings', plan.free_parkings)
        plan.free_washes = data.get('free_washes', plan.free_washes)
        plan.description = data.get('description', plan.description)
        plan.plan_type = data.get('plan_type', plan.plan_type)

        db.session.commit()

        return {
            "message": "Subscription plan updated successfully",
            "plan": {
                "id": plan.id,
                "name": plan.name,
                "duration": plan.duration_days,
                "price": float(plan.price),
                "free_parkings": plan.free_parkings,
                "free_washes": plan.free_washes,
                "description": plan.description,
                "plan_type": plan.plan_type
            }
        }, 200

class UserSubscriptionResource(Resource):
    @auth_required('token')
    @roles_accepted('user', 'admin') # FIX: Allow both roles to access
    def get(self):
        is_admin = 'admin' in [role.name for role in current_user.roles]
        
        # FIX: Query the correct table based on user's role
        if is_admin:
            subscriptions = AdminSubscription.query.filter_by(admin_id=current_user.id).all()
        else:
            subscriptions = UserSubscription.query.filter_by(user_id=current_user.id).all()

        # FIX: Return a consistent structure with the nested plan object for the frontend
        return jsonify([{
            "id": sub.id,
            "plan_name": sub.plan.name,
            "start_date": sub.start_date.strftime('%Y-%m-%d'),
            "end_date": sub.end_date.strftime('%Y-%m-%d') if sub.end_date else None,
            "remaining_parkings": getattr(sub, 'remaining_parkings', 0),
            "remaining_washes": getattr(sub, 'remaining_washes', 0),
            "is_active": sub.status == 'active',
            "plan": {
                "id": sub.plan.id,
                "name": sub.plan.name,
                "type": sub.plan.plan_type
            }
        } for sub in subscriptions])

class PaymentResource(Resource):
    @auth_required('token')
    @roles_accepted('user', 'admin') # Allow both user and admin to make payments
    def post(self):
        data = request.get_json()

        # ... (validation checks) ...

        plan = SubscriptionPlan.query.get(data['plan_id'])
        if not plan:
            return {"message": "Invalid subscription plan"}, 400

        end_date = datetime.utcnow() + timedelta(days=plan.duration_days)

        # FIX: Create AdminSubscription for admin plans, UserSubscription for user plans
        is_admin = 'admin' in [r.name for r in current_user.roles]
        payment_method = data.get("payment_method")
        upi_id = data.get("upi_id", "")
        card_number = data.get("card_number", "")
        if plan.plan_type == 'admin' and is_admin:
            subscription = AdminSubscription(
                admin_id=current_user.id,
                plan_id=plan.id,
                start_date=datetime.utcnow(),
                end_date=end_date,
                status='active'
            )
        elif plan.plan_type == 'user':
             subscription = UserSubscription(
                user_id=current_user.id,
                plan_id=plan.id,
                start_date=datetime.utcnow(),
                end_date=end_date,
                remaining_parkings=plan.free_parkings,
                remaining_washes=plan.free_washes,
                status='active'
            )
        else:
            return {"message": "Plan type does not match user role."}, 400

        transaction = PaymentTransaction(
            user_id=current_user.id,
            amount=data.get('amount'),
            payment_method=data['payment_method'],
            status='completed',
            payment_type='subscription'
        )
        if upi_id:
            transaction.payment_method += f" (UPI: {upi_id})"
        if card_number:
            transaction.payment_method += f" (Card: {card_number})"
        db.session.add(transaction)
        db.session.add(subscription)
        db.session.commit()

        return {
            "message": "Payment successful and subscription activated",
            "transaction_id": transaction.transaction_id,
            "subscription_id": subscription.id
        }, 201

    @auth_required('token')
    @roles_required('admin')
    def put(self, lot_id):
        lot = ParkingLot.query.get_or_404(lot_id)
        if lot.admin_id != current_user.id:
            return {"message": "You do not have permission to edit this lot."}, 403
            
        data = request.get_json()

        # Check if the lot's dimensions are being changed
        dimensions_changed = (
            lot.rows != int(data.get('rows', lot.rows)) or
            lot.columns != int(data.get('columns', lot.columns)) or
            lot.floors != int(data.get('floors', lot.floors))
        )

        # Update the lot object with all data from the form
        lot.name = data.get('name', lot.name)
        lot.address = data.get('address', lot.address)
        lot.pin_code = data.get('pin_code', lot.pin_code)
        lot.supervisor_name = data.get('supervisor_name', lot.supervisor_name)
        lot.price_per_hour = data.get('price_per_hour', lot.price_per_hour)
        lot.rows = int(data.get('rows', lot.rows))
        lot.columns = int(data.get('columns', lot.columns))
        lot.floors = int(data.get('floors', lot.floors))
        lot.number_of_spots = lot.rows * lot.columns * lot.floors
        lot.charging_available = data.get('charging_available', lot.charging_available)
        lot.water_wash_available = data.get('water_wash_available', lot.water_wash_available)
        lot.other_services = data.get('other_services', lot.other_services)

        # If dimensions changed, regenerate the spots
        if dimensions_changed:
            # Delete all existing spots for this lot.
            # The 'ondelete=CASCADE' on the Reservation model will automatically
            # instruct the database to delete any reservations tied to these spots.
            ParkingSpot.query.filter_by(lot_id=lot_id).delete()
            
            # Create the new set of spots
            for number in range(1, lot.number_of_spots + 1):
                new_spot = ParkingSpot(lot_id=lot_id, slot_number=number, status='A')
                db.session.add(new_spot)

        # Commit all changes to the database
        db.session.commit()
        
        return jsonify({"message": "Parking lot updated successfully"})

class AdminSubscriptionResource(Resource):
    @auth_required('token')
    @roles_required('admin')
    def get(self):
        subscriptions = UserSubscription.query.all()
        return jsonify([{
            "id": sub.id,
            "user_email": sub.user.email,
            "plan_name": sub.plan.name,
            "start_date": sub.start_date.strftime('%Y-%m-%d'),
            "end_date": sub.end_date.strftime('%Y-%m-%d') if sub.end_date else None,
            "is_active": sub.status == 'active'
        } for sub in subscriptions])

def check_availability(slot_id, requested_start, requested_end):
    """
    Check slot availability with gap policy (24/7 operation)
    Returns tuple: (is_available, error_dict, suggestion_dict)
    """
    slot = ParkingSpot.query.get(slot_id)
    if not slot:
        return False, {"message": "Slot not found"}, None

    # Get min_gap_minutes from the lot associated with the slot
    gap_minutes = slot.lot.min_gap_minutes if slot.lot and slot.lot.min_gap_minutes is not None else 0
    gap = timedelta(minutes=gap_minutes)

    # Check for conflicts with existing confirmed reservations, considering the gap
    # A conflict occurs if an existing reservation's period (including its gaps) overlaps
    # with the requested period (including its gaps).
    conflicts = Reservation.query.filter(
        Reservation.slot_id == slot_id,
        Reservation.status == 'confirmed',
        # Check if existing reservation's end + gap is after requested start - gap
        and_(
            (Reservation.end_datetime + gap) > (requested_start - gap),
            # Check if existing reservation's start - gap is before requested end + gap
            (Reservation.start_datetime - gap) < (requested_end + gap)
        )
    ).order_by(Reservation.start_datetime).all()

    if not conflicts:
        return True, None, None  # Available

    # If there are conflicts, the slot is not available for the exact requested period.
    # The suggestion logic can be complex and depends on desired behavior.
    # For now, if conflicts exist, we simply state it's unavailable for the requested time.
    # More sophisticated logic would identify the largest available window.
    # But for a direct check, any overlap means unavailable.
    return False, {"message": "Time slot unavailable due to existing bookings or gap policy."}, None


# Automatically update slot status when reservations change
@event.listens_for(Reservation, 'after_insert')
@event.listens_for(Reservation, 'after_update')
@event.listens_for(Reservation, 'after_delete')
def update_slot_status(mapper, connection, target):
    slot = db.session.get(ParkingSpot, target.slot_id)
    if slot:
        # It's crucial to ensure the transaction for Reservation has completed before
        # slot.update_status tries to query the database, otherwise it might not see
        # the latest reservation changes.
        # This approach might cause a transient state or require careful transaction management.
        # For simplicity, if this is called in the same request, db.session.commit()
        # for the reservation should have already happened.
        slot.update_status()
       


class SlotResource(Resource):
    @auth_required('token')
    def get(self, lot_id):
        slots = ParkingSpot.query.filter_by(lot_id=lot_id).order_by(ParkingSpot.slot_number).all()
        return jsonify([{"id": s.id, "slot_number": s.slot_number} for s in slots])


class ReservationResource(Resource):
    
    # In ReservationResource class

    @auth_required('token')
    @roles_required('user')
    def post(self):
        """Creates a new reservation."""
        data = request.get_json()
        try:
            start_datetime = datetime.fromisoformat(data['start_datetime'].replace('Z', ''))
            end_datetime = datetime.fromisoformat(data['end_datetime'].replace('Z', ''))
            lot_id = data['lot_id']
            slot_id = data['slot_id']
            vehicle_number = data['vehicle_number']
            hours_needed = math.ceil((end_datetime - start_datetime).total_seconds() / 3600)
        except (KeyError, ValueError) as e:
            return {"message": f"Invalid request data: {str(e)}"}, 400

        lot = ParkingLot.query.get_or_404(lot_id)
        parking_cost = lot.price_per_hour * hours_needed

        reservation = Reservation(
            slot_id=slot_id,
            user_id=current_user.id,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            vehicle_number=vehicle_number,
            hours_needed=hours_needed,
            parking_cost=parking_cost,
            status='upcoming' # <-- FIX IS HERE
        )
        db.session.add(reservation)
        db.session.commit()
        return {"message": "Reservation successful", "reservation_id": reservation.id}, 201

    @auth_required('token')
    def get(self):
        """Fetches all of a user's reservations, correctly handling timezones."""
        reservations = Reservation.query.filter_by(user_id=current_user.id).order_by(Reservation.start_datetime.desc()).all()
        reservations_data = []
        
        # FIX: Use a naive UTC datetime for comparison to prevent a server crash
        now_utc = datetime.utcnow()

        for r in reservations:
            if not r.spot or not r.spot.lot: continue
            
            status = r.status
            # Compare naive datetime with naive datetime
            if status not in ['completed', 'cancelled']:
                if now_utc >= r.end_datetime: status = 'completed'
                elif now_utc >= r.start_datetime: status = 'active'
                else: status = 'upcoming'
            
            reservations_data.append({
                "id": r.id, "slot_number": r.spot.slot_number, "lot_name": r.spot.lot.name,
                "start_time": r.start_datetime.isoformat() + 'Z', 
                "end_time": r.end_datetime.isoformat() + 'Z',
                "vehicle_number": r.vehicle_number, "status": status,
                "total_amount": round((r.parking_cost or 0) + (r.penalty_applied or 0), 2),
                "payment_method": r.payment_method
            })
        return jsonify(reservations_data)
    
    @auth_required('token')
    @roles_required('user')
    def put(self, reservation_id):
        """Updates (Edits) an upcoming reservation."""
        data = request.get_json()
        reservation = Reservation.query.get_or_404(reservation_id)
        if reservation.user_id != current_user.id:
            return {"message": "Unauthorized"}, 403
        if reservation.status not in ['upcoming', 'confirmed']:
            return {"message": "Cannot modify an active or past booking."}, 400

        # FIX: Use a naive UTC datetime for the 24-hour check
        now_utc = datetime.utcnow()
        new_start = datetime.fromisoformat(data['start_datetime'].replace('Z', ''))
        duration = reservation.end_datetime - reservation.start_datetime
        new_end = new_start + duration
        time_to_booking = (reservation.start_datetime - now_utc).total_seconds()

        penalty = 0
        if time_to_booking < 24 * 3600: # Less than 24 hours
            penalty = (reservation.parking_cost or 0) * 0.4 

        reservation.start_datetime = new_start
        reservation.end_datetime = new_end
        reservation.penalty_applied = penalty
        db.session.commit()
        return {"message": f"Booking updated. Penalty applied: ₹{penalty}"}, 200

    @auth_required('token')
    def delete(self, reservation_id):
        """Cancels an upcoming reservation."""
        reservation = Reservation.query.get_or_404(reservation_id)
        if reservation.user_id != current_user.id:
            return {"message": "Unauthorized"}, 403
        if reservation.status not in ['upcoming', 'confirmed']:
            return {"message": "Cannot cancel an active or past booking."}, 400

        # FIX: Use a naive UTC datetime for comparison to prevent a server crash
        now_utc = datetime.utcnow()
        time_to_booking = (reservation.start_datetime - now_utc).total_seconds()

        if time_to_booking < 0:
             return {"message": "Cannot cancel a booking that has already started."}, 400
        
        reservation.status = 'cancelled'
        db.session.commit()
        return {"message": "Booking cancelled successfully."}, 200

from datetime import datetime, timedelta, time
# Make sure pytz is installed (`pip install pytz`) and imported
import pytz 

class AvailabilityResource(Resource):
    @auth_required('token')
    def get(self, lot_id):
        # 1. SETUP AND VALIDATION
        date_str = request.args.get('date')
        try:
            duration_hours = float(request.args.get('duration', 1))
            # Create a naive date object from the request string (e.g., 2025-07-31)
            selected_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            return {"message": "Invalid date or duration parameter."}, 400

        # 2. DEFINE THE DAY'S BOUNDARIES IN THE SERVER'S LOCAL TIMEZONE (IST)
        ist = pytz.timezone('Asia/Kolkata')
        day_start_ist = ist.localize(datetime.combine(selected_date, time.min))
        day_end_ist = ist.localize(datetime.combine(selected_date, time.max))

        # 3. GET ALL RESERVATIONS FOR THE DAY IN UTC
        # Convert the day's boundaries to UTC once for the database query
        day_start_utc = day_start_ist.astimezone(pytz.utc)
        day_end_utc = day_end_ist.astimezone(pytz.utc)

        lot = ParkingLot.query.get_or_404(lot_id)
        reservations_utc = Reservation.query.filter(
            Reservation.slot_id.in_([s.id for s in lot.slots]),
            Reservation.end_datetime > day_start_utc,
            Reservation.start_datetime < day_end_utc,
            Reservation.status != 'cancelled'
        ).all()
        
        # Organize reservations by slot for efficient lookup
        reservations_by_slot = {s.id: [] for s in lot.slots}
        for res in reservations_utc:
            # Store start and end times as aware UTC objects
            reservations_by_slot[res.slot_id].append((res.start_datetime, res.end_datetime))

        # 4. GENERATE AND CHECK 30-MINUTE TIME WINDOWS FOR THE SELECTED DAY
        time_windows = []
        current_slot_start_ist = day_start_ist
        while current_slot_start_ist < day_end_ist:
            window_start_ist = current_slot_start_ist
            window_end_ist = window_start_ist + timedelta(hours=duration_hours)

            # Skip windows that end after the current day
            if window_end_ist > day_end_ist:
                break
            
            # Skip windows in the past
            if window_start_ist < datetime.now(ist):
                current_slot_start_ist += timedelta(minutes=30)
                continue

            # Convert the specific window to UTC to check for conflicts
            window_start_utc = window_start_ist.astimezone(pytz.utc)
            window_end_utc = window_end_ist.astimezone(pytz.utc)
            
            available_slots_in_window = []
            for slot in lot.slots:
                is_occupied = False
                for occ_start_utc, occ_end_utc in reservations_by_slot[slot.id]:
                    # Standard overlap check: max(start1, start2) < min(end1, end2)
                    if max(window_start_utc, occ_start_utc) < min(window_end_utc, occ_end_utc):
                        is_occupied = True
                        break
                if not is_occupied:
                    available_slots_in_window.append({"slot_id": slot.id, "slot_number": slot.slot_number})
            
            # Only add the time window if there is at least one slot available
            if available_slots_in_window:
                time_windows.append({
                    "start": window_start_ist.isoformat(),
                    "end": window_end_ist.isoformat(),
                    "available_slots_count": len(available_slots_in_window),
                    "available_slots": available_slots_in_window
                })
            
            current_slot_start_ist += timedelta(minutes=30) # Move to the next 30-min interval

        return jsonify(time_windows)


class UserProfileResource(Resource):
    method_decorators = [auth_required('token')]

    @roles_accepted('user', 'admin')
    def get(self):
        user = current_user
        return jsonify({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "phone": user.phone,
            "address": user.address if hasattr(user, 'address') else None,
            "roles": [role.name for role in user.roles]
        })

    @roles_accepted('user', 'admin')
    def put(self):
        data = request.get_json()
        user = current_user

        if 'username' in data:
            user.username = data['username']
        if 'email' in data:
            existing_user = User.query.filter(User.email == data['email'], User.id != user.id).first()
            if existing_user:
                return {"message": "Email already in use"}, 400
            user.email = data['email']
        if 'phone' in data:
            user.phone = data['phone']
        if 'password' in data and data['password']:
            from werkzeug.security import generate_password_hash # Import locally if needed
            user.password = generate_password_hash(data['password'])

        user_roles_names = [role.name for role in current_user.roles]
        if 'admin' not in user_roles_names and 'address' in data:
            user.address = data['address']


        db.session.commit()
        return {"message": "Profile updated successfully"}, 200

class UserPayments(Resource):
    @auth_required('token')
    @roles_required('user')
    def get(self):
        payments = PaymentTransaction.query.filter_by(user_id=current_user.id).all()
        return jsonify([{
            "amount": p.amount,
            "method": p.payment_method,
            "type": p.payment_type,
            "timestamp": p.timestamp.strftime('%Y-%m-%d %H:%M'),
            "transaction_id": p.transaction_id
        } for p in payments])

class AdminTransactionResource(Resource):
    @auth_required('token')
    @roles_required('admin')
    def get(self):
        pending_txns = PaymentTransaction.query.filter_by(status='pending', payment_method='offline').all()
        return jsonify([{"id": t.id, "user_email": t.user.email, "amount": t.amount} for t in pending_txns])

    @auth_required('token')
    @roles_required('admin')
    def put(self, transaction_id):
        transaction = PaymentTransaction.query.get_or_404(transaction_id)
        transaction.status = 'completed'
        db.session.commit()
        return {"message": "Transaction marked as complete."}, 200

class AdminStatsResource(Resource):
    @auth_required('token')
    @roles_required('admin')
    def get(self):
        # Revenue Chart Data (Last 7 Days)
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        daily_revenue = db.session.query(
            func.date(Reservation.start_datetime),
            func.sum(Reservation.parking_cost + Reservation.penalty_applied)
        ).filter(
            Reservation.start_datetime >= seven_days_ago,
            Reservation.status.in_(['completed', 'active'])
        ).group_by(func.date(Reservation.start_datetime)).order_by(func.date(Reservation.start_datetime)).all()

        revenue_labels = [(seven_days_ago.date() + timedelta(days=i)).strftime('%a') for i in range(8)]
        revenue_data = [0] * 8
        for date, total in daily_revenue:
            day_index = (date - seven_days_ago.date()).days
            if 0 <= day_index < 8:
                revenue_data[day_index] = float(total or 0)

        # Most Booked Lots
        lot_demand = db.session.query(
            ParkingLot.name,
            func.count(Reservation.id)
        ).join(ParkingSpot).join(Reservation).group_by(ParkingLot.name).order_by(func.count(Reservation.id).desc()).limit(5).all()

        return jsonify({
            "revenue": {
                "labels": revenue_labels,
                "data": revenue_data
            },
            "demand": {
                "labels": [row[0] for row in lot_demand],
                "data": [row[1] for row in lot_demand]
            }
        })

# --- Register all API resources ---

api.add_resource(ParkingLotResource, '/api/parking_lot', '/api/parking_lot/<int:lot_id>')
api.add_resource(SlotResource, '/api/lots/<int:lot_id>/slots')
api.add_resource(ReservationResource, '/api/reservations', '/api/reservations/<int:reservation_id>')
api.add_resource(AvailabilityResource, '/api/lots/<int:lot_id>/availability')
api.add_resource(UserReservationResource, '/api/user/reservations')
api.add_resource(UserSubscriptionResource, '/api/user/subscriptions')
api.add_resource(PaymentResource, '/api/payments')
# api.add_resource(ValetResource, '/api/valet')
api.add_resource(UserProfileResource, '/api/user/profile')
api.add_resource(UserPayments, '/api/user/payments')
api.add_resource(SubscriptionResource, '/api/subscriptions', "/api/subscriptions/<int:plan_id>")
api.add_resource(AdminSubscriptionResource, '/api/admin/subscriptions')
# api.add_resource(AvailableSlotsResource, '/api/lot/<int:lot_id>/available_slots')
api.add_resource(AdminTransactionResource, '/api/admin/transactions', '/api/admin/transactions/<int:transaction_id>')
api.add_resource(AdminStatsResource, '/api/admin/stats')