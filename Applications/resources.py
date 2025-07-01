from flask_restful import Api, Resource, reqparse
from .models import *
from flask import jsonify, request, current_app
from flask_security import auth_required, roles_required, current_user, roles_accepted
from Applications.task import send_reservation_email
from datetime import datetime, timedelta, time
import math
from sqlalchemy import event
import os

api = Api()


    
class ParkingLotResource(Resource):
    @auth_required('token')
    @roles_accepted('admin', 'user')
    def get(self):
        lots = ParkingLot.query.all()
        if not lots:
            return {"message": "No parking lots available at the moment"}, 404

        lots_json = []
        for lot in lots:
            lot_data = {
                "id": lot.id,
                "name": lot.name,
                "address": lot.address,
                "pin_code": lot.pin_code,
                "min_gap_minutes": lot.min_gap_minutes,
                "price_per_hour": lot.price_per_hour,
                "Total_number_of_slots": lot.number_of_spots,
                "created_at": lot.created_at.strftime('%Y-%m-%d %H:%M:%S') if lot.created_at else None,
                #"available_slots": len([s for s in lot.slots if s.status == 'A'])
        } 
            lots_json.append(lot_data)
        return lots_json, 200
    
    @auth_required('token')
    @roles_required('admin')
    def post(self):
        data = request.json
        try:
            lot = ParkingLot(
                name=data['name'],
                address=data['address'],
                pin_code=data['pin_code'],
                price_per_hour=data['price_per_hour'],
                number_of_spots=data['number_of_spots']
            )
            db.session.add(lot)
            db.session.commit()
            return {"message": "Parking lot created successfully"}, 201
        except:
            return {"message": "Error creating parking lot as one or more field is missing."}, 400

    @auth_required('token')
    @roles_required('admin')
    def put(self, lot_id=None):
        # Get lot_id from URL if not provided in JSON
        if lot_id is None:
            data = request.get_json()
            if not data:
                return {"message": "No input data provided"}, 400
            lot_id = data.get('id')
        
        if not lot_id:
            return {"message": "Parking lot ID is required"}, 400

        lot = ParkingLot.query.get(lot_id)
        if not lot:
            return {"message": "Parking lot not found"}, 404

        data = request.get_json()
        if not data:
            return {"message": "No update data provided"}, 400

        lot.name = data.get('name', lot.name)
        lot.address = data.get('address', lot.address)
        lot.pin_code = data.get('pin_code', lot.pin_code)
        lot.price_per_hour = data.get('price_per_hour', lot.price_per_hour)
        lot.number_of_spots = data.get('number_of_spots', lot.number_of_spots)
        
        db.session.commit()
        return {"message": "Parking lot updated successfully"}, 200

    @auth_required('token')
    @roles_required('admin')
    
    def delete(self):
        lot_id = request.args.get('id')
        lot = ParkingLot.query.get(lot_id)
        if not lot:
            return {"message": "Parking lot not found"}, 404

        db.session.delete(lot)
        db.session.commit()
        return {"message": "Parking lot deleted successfully"}, 200
    
class UserReservationResource(Resource):
    @auth_required('token')
    @roles_required('user')
    def post(self):
        user_id = current_user.id
        data = request.json
        lot_id = data.get('lot_id')
        hours_needed = data.get('hours_needed')

        available_spot = ParkingSpot.query.filter_by(lot_id=lot_id, status='A').first()
        if not available_spot:
            return {"message": "No available parking spots in selected lot."}, 404

        lot = ParkingLot.query.get(lot_id)
        available_spot.status = 'O'
        db.session.add(available_spot)

        reservation = Reservation(
            spot_id=available_spot.id,
            user_id=user_id,
            parking_timestamp=datetime.utcnow(),
            parking_cost=0.0,
            hours_needed=hours_needed
        )
        db.session.add(reservation)
        db.session.commit()

        subject = "Parking Spot Reserved"
        body = f"Dear {current_user.username},\n\nYour parking spot at '{lot.name}' is reserved.\nReservation ID: {reservation.id}\nLot Address: {lot.address}\nSpot ID: {available_spot.id}\nStart Time: {reservation.parking_timestamp}\nHours Needed: {hours_needed} hour(s)\n\nThank you."
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
            lot = ParkingLot.query.get(reservation.spot.lot_id)
            hours_parked = math.ceil((reservation.leaving_timestamp - reservation.parking_timestamp).total_seconds() / 3600)
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

        spot = ParkingSpot.query.get(reservation.spot_id)
        if spot:
            spot.status = 'A'
            db.session.add(spot)

        db.session.delete(reservation)
        db.session.commit()
        return {"message": "Reservation deleted successfully"}, 200

# Add these new resources to resources.py

class SubscriptionResource(Resource):
    @auth_required('token')
    @roles_accepted('user', 'admin')  # Both users and admins can view plans
    def get(self):
        plans = SubscriptionPlan.query.all()
        return jsonify([{
            "id": plan.id,
            "name": plan.name,
            "duration": plan.duration_days,
            "price": plan.price,
            "free_parkings": plan.free_parkings,
            "free_washes": plan.free_washes,
            "description": plan.description
        } for plan in plans])
    @auth_required('token')
    @roles_required('admin')
    def put(self, plan_id):
        data = request.get_json()
        plan = SubscriptionPlan.query.get(plan_id)
        
        if not plan:
            return {"message": "Subscription plan not found"}, 404
            
        # Update plan fields
        plan.name = data.get('name', plan.name)
        plan.duration_days = data.get('duration_days', plan.duration_days)
        plan.price = data.get('price', plan.price)
        plan.free_parkings = data.get('free_parkings', plan.free_parkings)
        plan.free_washes = data.get('free_washes', plan.free_washes)
        plan.description = data.get('description', plan.description)
        
        db.session.commit()
        
        return {
            "message": "Subscription plan updated successfully",
            "plan": {
                "id": plan.id,
                "name": plan.name,
                "duration": plan.duration_days,
                "price": plan.price,
                "free_parkings": plan.free_parkings,
                "free_washes": plan.free_washes,
                "description": plan.description
            }
        }, 200

class UserSubscriptionResource(Resource):
    @auth_required('token')
    @roles_required('user')  # Only regular users can view their own subscriptions
    def get(self):
        subscriptions = UserSubscription.query.filter_by(user_id=current_user.id).all()
        return jsonify([{
            "id": sub.id,
            "plan_name": sub.plan.name,
            "start_date": sub.start_date.strftime('%Y-%m-%d'),
            "end_date": sub.end_date.strftime('%Y-%m-%d') if sub.end_date else None,
            "remaining_parkings": sub.remaining_parkings,
            "remaining_washes": sub.remaining_washes,
            "is_active": sub.is_active
        } for sub in subscriptions])

class PaymentResource(Resource):
    @auth_required('token')
    @roles_required('user')  # Only users can make payments
    def post(self):
        data = request.get_json()
        
        # Validate payment details
        if not all(key in data for key in ['plan_id', 'payment_method']):
            return {"message": "Missing payment details"}, 400
            
        # Create transaction record
        transaction = PaymentTransaction(
            user_id=current_user.id,
            amount=data.get('amount'),
            payment_method=data['payment_method'],
            status='completed',
            transaction_id=f"txn_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        )
        
        # Create subscription if payment succeeds
        if data['payment_method'] in ['credit_card', 'debit_card', 'upi']:
            plan = SubscriptionPlan.query.get(data['plan_id'])
            if not plan:
                return {"message": "Invalid subscription plan"}, 400
                
            end_date = datetime.utcnow() + timedelta(days=plan.duration_days)
            
            subscription = UserSubscription(
                user_id=current_user.id,
                plan_id=plan.id,
                start_date=datetime.utcnow(),
                end_date=end_date,
                remaining_parkings=plan.free_parkings,
                remaining_washes=plan.free_washes,
                is_active=True
            )
            
            db.session.add(transaction)
            db.session.add(subscription)
            db.session.commit()
            
            return {
                "message": "Payment successful and subscription activated",
                "transaction_id": transaction.transaction_id,
                "subscription_id": subscription.id
            }, 201
        
        return {"message": "Payment failed"}, 400

class ValetResource(Resource):
    @auth_required('token')
    @roles_required('user')  # Only users can request valet services
    def post(self):
        data = request.get_json()
        
        if not all(key in data for key in ['request_type', 'vehicle_location']):
            return {"message": "Missing required fields"}, 400
            
        # Check if user has active subscription for valet services
        active_sub = UserSubscription.query.filter_by(
            user_id=current_user.id,
            is_active=True
        ).first()
        
        if not active_sub:
            return {"message": "Active subscription required for valet services"}, 403
            
        valet_request = ValetRequest(
            user_id=current_user.id,
            request_type=data['request_type'],
            vehicle_location=data['vehicle_location'],
            notes=data.get('notes'),
            reservation_id=data.get('reservation_id')
        )
        
        db.session.add(valet_request)
        db.session.commit()
        
        return {
            "message": "Valet request submitted successfully",
            "request_id": valet_request.id,
            "estimated_time": "15 minutes"
        }, 201

# Admin-only endpoints could be added like this:
class AdminSubscriptionResource(Resource):
    @auth_required('token')
    @roles_required('admin')  # Only admins can manage all subscriptions
    def get(self):
        subscriptions = UserSubscription.query.all()
        return jsonify([{
            "id": sub.id,
            "user_email": sub.user.email,
            "plan_name": sub.plan.name,
            "start_date": sub.start_date.strftime('%Y-%m-%d'),
            "end_date": sub.end_date.strftime('%Y-%m-%d') if sub.end_date else None,
            "is_active": sub.is_active
        } for sub in subscriptions])
    
def check_availability(slot_id, requested_start, requested_end):
    """
    Check slot availability with gap policy (24/7 operation)
    Returns tuple: (is_available, error_dict, suggestion_dict)
    """
    slot = ParkingSpot.query.get(slot_id)
    if not slot:
        return False, {"message": "Slot not found"}, None

    gap = timedelta(minutes=slot.lot.min_gap_minutes)
    
    # Check for conflicts with gap (no operating hours check)
    conflicts = Reservation.query.filter(
        Reservation.slot_id == slot_id,
        Reservation.status == 'confirmed',
        Reservation.start_datetime < (requested_end + gap),
        Reservation.end_datetime > (requested_start - gap)
    ).order_by(Reservation.start_datetime).all()

    if not conflicts:
        return True, None, None  # Available

    # Find suggestion before first conflict
    first_conflict = conflicts[0]
    available_end = first_conflict.start_datetime - gap
    if requested_start < available_end:
        suggestion = {
            'start': requested_start,
            'end': min(available_end, requested_end),
            'reason': f"Available before reservation at {first_conflict.start_datetime}",
            'conflict_time': first_conflict.start_datetime
        }
        if (suggestion['end'] - suggestion['start']) >= timedelta(hours=1):
            return False, {
                'message': 'Time slot unavailable with gap policy',
                'conflict_time': first_conflict.start_datetime,
                'type': 'before'
            }, suggestion

    # Find suggestion after last conflict
    last_conflict = conflicts[-1]
    available_start = last_conflict.end_datetime + gap
    if available_start < requested_end:
        suggestion = {
            'start': max(available_start, requested_start),
            'end': requested_end,
            'reason': f"Available after reservation at {last_conflict.end_datetime}",
            'conflict_time': last_conflict.end_datetime
        }
        if (suggestion['end'] - suggestion['start']) >= timedelta(hours=1):
            return False, {
                'message': 'Time slot unavailable with gap policy',
                'conflict_time': last_conflict.end_datetime,
                'type': 'after'
            }, suggestion

    return False, {"message": "No available slots with gap policy"}, None


# Automatically update slot status when reservations change
@event.listens_for(Reservation, 'after_insert')
@event.listens_for(Reservation, 'after_update')
@event.listens_for(Reservation, 'after_delete')
def update_slot_status(mapper, connection, target):
    slot = ParkingSpot.query.get(target.slot_id)
    if slot:
        slot.update_status()



class SlotResource(Resource):
    @auth_required('token')
    def get(self, lot_id):
        """Get all slots with availability for a lot"""
        slots = ParkingSpot.query.filter_by(lot_id=lot_id).order_by(ParkingSpot.slot_number).all()
        
        return jsonify([{
            "slot_number": s.slot_number,
            "status": s.status,
            "reservations": [{
                "start": r.start_datetime.isoformat(),
                "end": r.end_datetime.isoformat(),
                "user": r.user.username
            } for r in s.reservations if r.status == 'confirmed']
        } for s in slots])

class ReservationResource(Resource):
    @auth_required('token')
    @roles_required('user')
    def post(self):
        """Create a new reservation with time validation"""
        data = request.get_json()
        
        try:
            lot_id = data['lot_id']
            slot_number = data['slot_number']
            start_datetime = datetime.fromisoformat(data['start_datetime'])
            end_datetime = datetime.fromisoformat(data['end_datetime'])
            vehicle_number = data['vehicle_number']
        except (KeyError, ValueError) as e:
            return {"message": f"Invalid request data: {str(e)}"}, 400

        # Get the specific slot
        slot = ParkingSpot.query.filter_by(
            lot_id=lot_id,
            slot_number=slot_number
        ).first()
        
        if not slot:
            return {"message": "Slot not found"}, 404
            
        # Check current availability
        if slot.status == 'O':
            return {"message": f"Slot {slot_number} is currently occupied"}, 400

        # Check time availability with gap policy
        is_available, error, suggestion = check_availability(
            slot.id, start_datetime, end_datetime
        )

        if not is_available:
            if suggestion:
                return {
                    "code": "TIME_CONFLICT",
                    "message": error['message'],
                    "suggestion": {
                        "start": suggestion['start'].isoformat(),
                        "end": suggestion['end'].isoformat(),
                        "reason": suggestion['reason']
                    }
                }, 409
            return {"message": error['message']}, 400

        # Create reservation
        reservation = Reservation(
            slot_id=slot.id,
            user_id=current_user.id,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            vehicle_number=vehicle_number
        )

        db.session.add(reservation)
        db.session.commit()

        # Send confirmation email
        send_reservation_email(
            to_email=current_user.email,
            subject="Parking Reservation Confirmed",
            body=f"""
            Your parking reservation for Slot {slot_number} is confirmed.
            Time: {start_datetime} to {end_datetime}
            Vehicle: {vehicle_number}
            """
        )

        return {
            "message": f"Reservation for Slot {slot_number} created successfully",
            "reservation_id": reservation.id,
            "slot_status": slot.status
        }, 201

    @auth_required('token')
    def get(self):
        """Get user's reservations"""
        reservations = Reservation.query.filter_by(
            user_id=current_user.id
        ).order_by(Reservation.start_datetime).all()

        return jsonify([{
            "id": r.id,
            "slot_number": r.slot.slot_number,
            "lot_name": r.slot.lot.name,
            "start": r.start_datetime.isoformat(),
            "end": r.end_datetime.isoformat(),
            "vehicle_number": r.vehicle_number,
            "status": r.status
        } for r in reservations])

class AvailabilityResource(Resource):
    @auth_required('token')
    def get(self, lot_id):
        """Get available time slots (24/7 operation)"""
        date_str = request.args.get('date')
        duration_hours = float(request.args.get('duration', 1))
        
        try:
            date = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else datetime.now().date()
        except ValueError:
            return {"message": "Invalid date format. Use YYYY-MM-DD"}, 400

        slots = ParkingSpot.query.filter_by(lot_id=lot_id).all()
        available_slots = []

        for slot in slots:
            # Get existing reservations for the day
            reservations = Reservation.query.filter(
                Reservation.slot_id == slot.id,
                db.func.date(Reservation.start_datetime) == date,
                Reservation.status == 'confirmed'
            ).order_by(Reservation.start_datetime).all()

            # Generate available time windows (24 hours)
            current_time = datetime.combine(date, time(0, 0))  # Start at midnight
            end_of_day = datetime.combine(date, time(23, 59, 59))  # End at midnight
            gap = timedelta(minutes=slot.lot.min_gap_minutes)
            duration = timedelta(hours=duration_hours)

            for res in reservations:
                available_end = res.start_datetime - gap
                if current_time < available_end and (available_end - current_time) >= duration:
                    available_slots.append({
                        "slot_number": slot.slot_number,
                        "start": current_time,
                        "end": available_end
                    })
                current_time = res.end_datetime + gap

            # Add remaining time after last reservation
            if current_time < end_of_day and (end_of_day - current_time) >= duration:
                available_slots.append({
                    "slot_number": slot.slot_number,
                    "start": current_time,
                    "end": end_of_day
                })

        return jsonify([{
            "slot_number": s['slot_number'],
            "start": s['start'].isoformat(),
            "end": s['end'].isoformat(),
            "duration_hours": duration_hours
        } for s in available_slots])


class ParkingLotResource(Resource):
    @auth_required('token')
    @roles_required('admin')
    def post(self):
        admin_id = current_user.id

        # Count lots created by this admin
        existing_lots = ParkingLot.query.filter_by(admin_id=admin_id).count()

        # Enforce limit unless subscription is active
        if existing_lots >= 2:
            subscription = UserSubscription.query.filter_by(user_id=admin_id, is_active=True).first()
            if not subscription:
                return {"message": "Upgrade subscription to add more than 2 parking lots"}, 403

        # Get JSON safely
        data = request.get_json()
        print("Incoming data:", data)

        # Validate required fields
        required_fields = ['name', 'address', 'pin_code', 'rows', 'columns', 'price_per_hour', 'supervisor']
        missing_fields = [field for field in required_fields if not data.get(field)]
        if missing_fields:
            return {"message": f"Missing fields: {', '.join(missing_fields)}"}, 400

        # Get values with fallback
        floors = int(data.get('floors', 1))
        rows = int(data['rows'])
        columns = int(data['columns'])

        # Calculations
        total_spots = rows * columns * floors
        base_price = float(data['price_per_hour'])
        cost_with_markup = round(base_price * (1 + 0.15 * (floors - 1)), 2)

        try:
            lot = ParkingLot(
                name=data['name'],
                address=data['address'],
                pin_code=data['pin_code'],
                rows=rows,
                columns=columns,
                floors=floors,
                number_of_spots=total_spots,
                price_per_hour=cost_with_markup,
                supervisor_name=data['supervisor'],
                charging_available=bool(data.get('charging_available', False)),
                water_wash_available=bool(data.get('water_wash_available', False)),
                other_services=data.get('other_services', ''),
                admin_id=admin_id
            )

            db.session.add(lot)
            db.session.commit()

            lot.initialize_slots()

            return {"message": "Parking lot created successfully"}, 201

        except Exception as e:
            db.session.rollback()
            return {"message": f"Error creating lot: {str(e)}"}, 500

    @auth_required('token')
    @roles_required('admin')
    def put(self):
        lot_id = request.args.get('lot_id')
        if not lot_id:
            return {"message": "Parking lot ID is required"}, 400

        lot = ParkingLot.query.get(lot_id)
        if not lot:
            return {"message": "Parking lot not found"}, 404

        data = request.get_json()
        if not data:
            return {"message": "No update data provided"}, 400

        # Update only metadata, not slots
        lot.name = data.get('name', lot.name)
        lot.address = data.get('address', lot.address)
        lot.pin_code = data.get('pin_code', lot.pin_code)
        lot.price_per_hour = data.get('price_per_hour', lot.price_per_hour)
        lot.supervisor_name = data.get('supervisor_name', lot.supervisor_name)
        lot.rows = data.get('rows', lot.rows)
        lot.columns = data.get('columns', lot.columns)
        lot.floors = data.get('floors', lot.floors)
        lot.charging_available = data.get('charging_available', lot.charging_available)
        lot.water_wash_available = data.get('water_wash_available', lot.water_wash_available)
        lot.other_services = data.get('other_services', lot.other_services)

        # Calculate and update spot count only if user explicitly sends it
        if 'number_of_spots' in data:
            lot.number_of_spots = data['number_of_spots']

        db.session.commit()
        return {"message": "Parking lot updated successfully"}, 200

    @auth_required('token')
    @roles_required('admin')
    def delete(self):
        lot_id = request.args.get('id')
        lot = ParkingLot.query.get(lot_id)
        if not lot:
            return {"message": "Parking lot not found"}, 404

        db.session.delete(lot)
        db.session.commit()
        return {"message": "Parking lot deleted successfully"}, 200
    
    @auth_required('token')
    @roles_accepted('admin', 'user')
    def get(self, lot_id=None):
        if lot_id:
            # Single parking lot request
            lot = ParkingLot.query.get(lot_id)
            if not lot:
                return {"message": "Parking lot not found"}, 404
            
            # Check admin access if needed
            if 'admin' in [role.name for role in current_user.roles] and lot.admin_id != current_user.id:
                return {"message": "Unauthorized access to this parking lot"}, 403
            
            # Calculate availability
            total_spots = lot.number_of_spots or (lot.rows * lot.columns * lot.floors)
            booked_spots = ParkingSpot.query.filter_by(lot_id=lot.id, status='O').count()
            available_spots = total_spots - booked_spots
            
            return {
                "id": lot.id,
                "name": lot.name,
                "address": lot.address,
                "pin_code": lot.pin_code,
                "price_per_hour": lot.price_per_hour,
                "rows": lot.rows,
                "columns": lot.columns,
                "floors": lot.floors,
                "supervisor_name": lot.supervisor_name,
                "charging_available": lot.charging_available,
                "water_wash_available": lot.water_wash_available,
                "other_services": lot.other_services,
                "total_spots": total_spots,
                "booked_spots": booked_spots,
                "available_spots": available_spots,
                "image_url": f"/static/uploads/{lot.id}.jpg" if os.path.exists(f"static/uploads/{lot.id}.jpg") else None,
                "admin_id": lot.admin_id
            }, 200
        else:
            # Multiple parking lots request
            if 'admin' in [role.name for role in current_user.roles]:
                # Return only admin's lots
                lots = ParkingLot.query.filter_by(admin_id=current_user.id).all()
            else:
                # Return all active lots for users
                lots = ParkingLot.query.all()

            if not lots:
                return {"message": "No parking lots available at the moment"}, 404

            lots_json = []
            for lot in lots:
                total_spots = lot.number_of_spots or (lot.rows * lot.columns * lot.floors)
                booked_spots = ParkingSpot.query.filter_by(lot_id=lot.id, status='O').count()
                available_spots = total_spots - booked_spots
                
                lots_json.append({
                    "id": lot.id,
                    "name": lot.name,
                    "address": lot.address,
                    "pin_code": lot.pin_code,
                    "price_per_hour": lot.price_per_hour,
                    "rows": lot.rows,
                    "columns": lot.columns,
                    "floors": lot.floors,
                    "supervisor_name": lot.supervisor_name,
                    "total_spots": total_spots,
                    "booked_spots": booked_spots,
                    "available_spots": available_spots,
                    "image_url": f"/static/uploads/{lot.id}.jpg" if os.path.exists(f"static/uploads/{lot.id}.jpg") else None,
                    "charging_available": lot.charging_available,
                    "water_wash_available": lot.water_wash_available
                })
            
            return lots_json, 200

UPLOAD_FOLDER = 'static/uploads'

from flask import Flask

app = Flask(__name__)

@app.route('/api/parking_lot/upload_image/<int:lot_id>', methods=['POST'])
@auth_required('token')
@roles_required('admin')
def upload_image(lot_id):
    if 'file' not in request.files:
        return {"message": "No file uploaded"}, 400
    file = request.files['file']
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    path = os.path.join(UPLOAD_FOLDER, f"{lot_id}.jpg")
    file.save(path)
    return {"message": "Image uploaded successfully", "url": f"/{path}"}, 200

from werkzeug.security import generate_password_hash
class UserProfileResource(Resource):
    method_decorators = [auth_required('token')]  # apply decorator to all methods
    @roles_accepted('user', 'admin')
    def get(self):
        user = current_user
        return jsonify({
            "id": user.id,
            "username": user.username,
            "email": user.email,
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
        if 'password' in data and data['password']:
            user.password = generate_password_hash(data['password'])

        db.session.commit()
        return {"message": "Profile updated successfully"}, 200

# --- Routes for Admin and User ---
api.add_resource(ParkingLotResource, '/api/parking_lot', '/api/parking_lot/<int:lot_id>')
api.add_resource(SlotResource, '/api/lots/<int:lot_id>/slots')
api.add_resource(ReservationResource, '/api/reservations')
api.add_resource(AvailabilityResource, '/api/lots/<int:lot_id>/availability')

# --- User Features ---
api.add_resource(UserReservationResource, '/api/user/reservations')
api.add_resource(UserSubscriptionResource, '/api/user/subscriptions')
api.add_resource(PaymentResource, '/api/payments')
api.add_resource(ValetResource, '/api/valet')
api.add_resource(UserProfileResource, '/api/user/profile')

# --- Subscription Plans ---
api.add_resource(SubscriptionResource, '/api/subscriptions', "/api/subscriptions/<int:plan_id>")
api.add_resource(AdminSubscriptionResource, '/api/admin/subscriptions')



    # Register resources with the API instance
# api.add_resource(ParkingLotResource, '/api/parking_lot', '/api/parking_lot/<int:lot_id>')
# api.add_resource(SlotResource, '/api/lots/<int:lot_id>/slots')
# api.add_resource(ReservationResource, '/api/reservations')
# api.add_resource(AvailabilityResource, '/api/lots/<int:lot_id>/availability')
# api.add_resource(UserReservationResource, '/api/user/reservations')
# api.add_resource(UserSubscriptionResource, '/api/user/subscriptions')
# api.add_resource(PaymentResource, '/api/payments')
# api.add_resource(ValetResource, '/api/valet')
# api.add_resource(SubscriptionResource, '/api/subscriptions', "/api/subscriptions/<int:plan_id>")
# api.add_resource(AdminSubscriptionResource, '/api/admin/subscriptions')


