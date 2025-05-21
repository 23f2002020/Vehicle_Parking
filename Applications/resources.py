from flask_restful import Api, Resource, reqparse
from .models import *
from flask import jsonify, request, current_app
from flask_security import auth_required, roles_required, current_user, roles_accepted
from Applications.task import send_reservation_email
from datetime import datetime, timedelta
import math

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
                "price_per_hour": lot.price_per_hour,
                "number_of_spots": lot.number_of_spots,
                "created_at": lot.created_at.strftime('%Y-%m-%d %H:%M:%S') if lot.created_at else None
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

# Add these resources to your API
api.add_resource(SubscriptionResource, '/api/subscriptions',"/api/subscriptions/<int:plan_id>")
api.add_resource(UserSubscriptionResource, '/api/user/subscriptions')
api.add_resource(AdminSubscriptionResource, '/api/admin/subscriptions')  # New admin endpoint
api.add_resource(PaymentResource, '/api/payments')
api.add_resource(ValetResource, '/api/valet')

api.add_resource(ParkingLotResource, 
    '/api/parking_lot',  # For POST and GET all
    '/api/parking_lot/<int:lot_id>',  # For GET single, PUT, DELETE
    endpoint='parking_lot')
api.add_resource(UserReservationResource, '/api/reservations')