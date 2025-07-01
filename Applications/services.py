from .database import db
from .models import ParkingSession, User, Admin, ParkingSpot
from datetime import datetime
from .subscriptions import SubscriptionService # To check entitlements

class ParkingService:
    @staticmethod
    def start_parking_session(user_or_admin_id, user_type, spot_id, license_plate):
        """Initiates a parking session and checks entitlements."""
        parking_spot = ParkingSpot.query.get(spot_id)
        if not parking_spot or parking_spot.is_occupied:
            return {'success': False, 'message': 'Spot not available.'}

        if user_type == 'user':
            entity = User.query.get(user_or_admin_id)
            entitlement = SubscriptionService.check_user_entitlement(entity)
            if not entitlement['is_paid'] and entitlement['allowed_minutes'] <= 0:
                return {'success': False, 'message': 'Free parking allowance exhausted. Please subscribe to a plan.'}
        elif user_type == 'admin':
            entity = Admin.query.get(user_or_admin_id)
            entitlement = SubscriptionService.check_admin_spot_entitlement(entity)
            if not entitlement['is_paid'] and entitlement['allowed_spots'] <= 0:
                return {'success': False, 'message': 'Free spot allowance exhausted. Please subscribe to a plan.'}
            
            # If admin is on free tier, increment free_spots_used
            if not entitlement['is_paid']:
                SubscriptionService.update_free_allowance_for_admin(entity, 1) # Increment one spot used

        parking_spot.is_occupied = True
        db.session.add(parking_spot)

        new_session = ParkingSession(
            user_id=entity.id if user_type == 'user' else None,
            admin_id=entity.id if user_type == 'admin' else None,
            spot_id=spot_id,
            vehicle_license_plate=license_plate,
            start_time=datetime.utcnow(),
            is_free_session=not entitlement['is_paid']
        )
        db.session.add(new_session)
        db.session.commit()
        return {'success': True, 'message': 'Parking session started.', 'session_id': new_session.id}

    @staticmethod
    def end_parking_session(session_id):
        """Ends a parking session, calculates duration and cost, updates usage."""
        session = ParkingSession.query.get(session_id)
        if not session or session.status!= 'active':
            return {'success': False, 'message': 'Invalid or inactive session.'}

        session.end_time = datetime.utcnow()
        duration = (session.end_time - session.start_time).total_seconds() / 60 # Duration in minutes
        session.duration_minutes = int(duration)

        parking_spot = ParkingSpot.query.get(session.spot_id)
        if parking_spot:
            parking_spot.is_occupied = False
            db.session.add(parking_spot)

        cost = 0
        if session.is_free_session:
            user = User.query.get(session.user_id)
            # Apply 1-hour grace period for free users (4 hours total, 3 hours parking)
            actual_parking_minutes = max(0, session.duration_minutes - 60) # Deduct 1 hour grace
            
            # Ensure not to deduct more than allowed or remaining free minutes
            minutes_to_deduct = min(actual_parking_minutes, user.free_parking_minutes_allowed - user.free_parking_minutes_used)
            
            session.free_minutes_consumed = minutes_to_deduct
            SubscriptionService.update_free_allowance_for_user(user, minutes_to_deduct)

            # If usage exceeds free allowance after grace, calculate cost for overflow
            if actual_parking_minutes > (user.free_parking_minutes_allowed - user.free_parking_minutes_used + minutes_to_deduct):
                # This part would typically be handled by a "pay-as-you-go" override or a prompt to subscribe
                # For simplicity, we'll just say no cost if within free, else a dummy cost
                overflow_minutes = actual_parking_minutes - (user.free_parking_minutes_allowed - user.free_parking_minutes_used + minutes_to_deduct)
                cost = overflow_minutes * 0.10 # Example: $0.10 per minute for overflow
                session.cost = cost
                # In a real system, this would trigger a payment for the overflow or force subscription
        else:
            # Calculate cost based on paid plan rates or standard hourly rates
            cost = session.duration_minutes * 0.05 # Example: $0.05 per minute for paid users
            session.cost = cost
            # This would trigger actual billing for paid users

        session.status = 'completed'
        db.session.add(session)
        db.session.commit()
        return {'success': True, 'message': 'Parking session ended.', 'cost': cost}

    @staticmethod
    def get_parking_status(spot_id):
        """Retrieves current status of a parking spot."""
        spot = ParkingSpot.query.get(spot_id)
        if spot:
            return {'is_occupied': spot.is_occupied}
        return {'error': 'Spot not found.'}