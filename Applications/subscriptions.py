from .database import db
from .models import User, Admin, SubscriptionPlan, UserSubscription, AdminSubscription, PaymentTransaction

from datetime import datetime, timedelta
from .dummy_gateway import DummyPaymentGateway # Import dummy gateway

class SubscriptionService:
    @staticmethod
    def process_subscription(entity, plan):
        """
        Processes a subscription for a given user/admin and plan.
        Handles dummy transaction and updates subscription status.
        """
        # Simulate payment
        transaction_amount = plan.price
        transaction_currency = plan.currency
        transaction_status = DummyPaymentGateway.process_payment(transaction_amount, transaction_currency)

        new_transaction =  PaymentTransaction(
            amount=transaction_amount,
            currency=transaction_currency,
            transaction_date=datetime.utcnow(),
            status=transaction_status['status'],
            payment_gateway_ref=transaction_status['transaction_id']
        )

        if isinstance(entity, User):
            new_transaction.user_id = entity.id
        elif isinstance(entity, Admin):
            new_transaction.admin_id = entity.id

        db.session.add(new_transaction)
        db.session.commit()

        if transaction_status['status'] == 'success':
            # Calculate next billing date based on interval
            if plan.billing_interval == 'monthly':
                next_billing_date = datetime.utcnow() + timedelta(days=30)
            elif plan.billing_interval == 'annually':
                next_billing_date = datetime.utcnow() + timedelta(days=365)
            else:
                next_billing_date = None # Handle other intervals or errors

            if isinstance(entity, User):
                # Deactivate old subscription if any
                old_sub = UserSubscription.query.filter_by(user_id=entity.id, status='active').first()
                if old_sub:
                    old_sub.status = 'expired' # Or 'cancelled' if explicitly cancelled for upgrade
                    old_sub.end_date = datetime.utcnow()
                
                # Create new subscription
                new_sub = UserSubscription(
                    user_id=entity.id,
                    plan_id=plan.id,
                    start_date=datetime.utcnow(),
                    status='active',
                    last_payment_date=datetime.utcnow(),
                    next_billing_date=next_billing_date,
                    # In a real app, these would come from the gateway response
                    stripe_customer_id='dummy_cust_id',
                    stripe_subscription_id='dummy_sub_id'
                )
                db.session.add(new_sub)
                entity.current_user_subscription_id = new_sub.id
                # Reset free allowance upon paid subscription
                entity.free_parking_minutes_used = 0
                entity.free_parking_last_reset_date = datetime.utcnow()

            elif isinstance(entity, Admin):
                # Deactivate old subscription if any
                old_sub = AdminSubscription.query.filter_by(admin_id=entity.id, status='active').first()
                if old_sub:
                    old_sub.status = 'expired'
                    old_sub.end_date = datetime.utcnow()

                # Create new subscription
                new_sub = AdminSubscription(
                    admin_id=entity.id,
                    plan_id=plan.id,
                    start_date=datetime.utcnow(),
                    status='active',
                    last_payment_date=datetime.utcnow(),
                    next_billing_date=next_billing_date,
                    stripe_customer_id='dummy_cust_id',
                    stripe_subscription_id='dummy_sub_id'
                )
                db.session.add(new_sub)
                entity.current_admin_subscription_id = new_sub.id
                entity.is_on_free_tier = False # Admin is now on a paid plan
                entity.free_spots_used = 0 # Reset free spots used, now managed by paid plan's limits

            db.session.commit()
            return True
        return False

    @staticmethod
    def check_user_entitlement(user):
        """Checks user's parking entitlement (free vs. paid)."""
        if user.current_user_subscription_id:
            sub = UserSubscription.query.get(user.current_user_subscription_id)
            if sub and sub.status == 'active':
                plan = SubscriptionPlan.query.get(sub.plan_id)
                return {'allowed_minutes': plan.max_parking_hours_monthly * 60 if plan.max_parking_hours_monthly else float('inf'), 'is_paid': True}
        # If no active paid subscription, check free allowance
        remaining_free = user.free_parking_minutes_allowed - user.free_parking_minutes_used
        return {'allowed_minutes': max(0, remaining_free), 'is_paid': False}

    @staticmethod
    def check_admin_spot_entitlement(admin):
        """Checks admin's spot creation entitlement (free vs. paid)."""
        if not admin.is_on_free_tier and admin.current_admin_subscription_id:
            sub = AdminSubscription.query.get(admin.current_admin_subscription_id)
            if sub and sub.status == 'active':
                plan = SubscriptionPlan.query.get(sub.plan_id)
                return {'allowed_spots': plan.max_spots if plan.max_spots else float('inf'), 'is_paid': True}
        # If on free tier
        remaining_free_spots = admin.free_spots_allowed - admin.free_spots_used
        return {'allowed_spots': max(0, remaining_free_spots), 'is_paid': False}

    @staticmethod
    def update_free_allowance_for_admin(admin, spots_to_add):
        """Updates free spots used for an admin."""
        if admin.is_on_free_tier:
            admin.free_spots_used += spots_to_add
            db.session.commit()
            return True
        return False # Not on free tier, spots managed by paid plan

    @staticmethod
    def update_free_allowance_for_user(user, minutes_consumed):
        """Updates free parking minutes used for a user."""
        if not SubscriptionService.check_user_entitlement(user)['is_paid']:
            user.free_parking_minutes_used += minutes_consumed
            db.session.commit()
            return True
        return False # User is on a paid plan, free allowance not applicable