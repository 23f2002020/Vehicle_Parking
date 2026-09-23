"""Subscription plans for drivers (free parkings / washes) and lot-owner admins (number of lots)."""
from datetime import timedelta

from flask import current_app

from . import payments, utils
from .database import db
from .models import ParkingLot, Subscription, SubscriptionPlan


class SubscriptionService:
    @staticmethod
    def active(user, plan_type, now=None):
        now = now or utils.now_utc()
        return (Subscription.query.join(SubscriptionPlan, Subscription.plan_id == SubscriptionPlan.id)
                .filter(Subscription.user_id == user.id, Subscription.status == "active",
                        Subscription.end_date > now, SubscriptionPlan.plan_type == plan_type)
                .order_by(Subscription.end_date.desc()).first())

    @staticmethod
    def admin_lot_limit(user, now=None):
        """(limit, plan_name). limit None = unlimited."""
        sub = SubscriptionService.active(user, "admin", now)
        if sub:
            return sub.plan.max_lots, sub.plan.name
        return current_app.config["FREE_ADMIN_LOTS"], "Free tier"

    @staticmethod
    def admin_lots_used(user):
        return ParkingLot.query.filter_by(admin_id=user.id, deleted_at=None).count()

    @staticmethod
    def purchase(user, plan, payment):
        if not plan.is_active:
            raise utils.ApiError("This plan is no longer available.", 400, "plan_inactive")
        needed_role = "admin" if plan.plan_type == "admin" else "user"
        if needed_role == "admin" and not user.is_admin:
            raise utils.ApiError("Lot-owner plans can only be bought by lot-owner (admin) accounts.", 403, "wrong_role")
        if needed_role == "user" and user.is_admin and not any(r.name == "user" for r in user.roles):
            raise utils.ApiError("Driver plans are for driver accounts.", 403, "wrong_role")

        now = utils.now_utc()
        txn = payments.charge(user, plan.price, payment, "subscription")
        for old in Subscription.query.join(SubscriptionPlan).filter(
                Subscription.user_id == user.id, Subscription.status == "active",
                SubscriptionPlan.plan_type == plan.plan_type).all():
            old.status = "replaced"
        sub = Subscription(user_id=user.id, plan_id=plan.id, status="active", start_date=now,
                           end_date=now + timedelta(days=plan.duration_days),
                           remaining_parkings=plan.free_parkings or 0, remaining_washes=plan.free_washes or 0)
        db.session.add(sub)
        db.session.flush()
        txn.subscription_id = sub.id
        db.session.commit()
        return sub, txn

    @staticmethod
    def serialize(sub, now=None):
        now = now or utils.now_utc()
        if not sub:
            return None
        return {"id": sub.id, "plan": plan_dict(sub.plan), "status": sub.status,
                "start_date": utils.to_iso(sub.start_date), "end_date": utils.to_iso(sub.end_date),
                "remaining_parkings": sub.remaining_parkings, "remaining_washes": sub.remaining_washes,
                "is_current": sub.is_current(now),
                "days_left": max(0, (sub.end_date - now).days)}


def plan_dict(p):
    return {"id": p.id, "name": p.name, "plan_type": p.plan_type, "description": p.description, "price": p.price,
            "currency": p.currency, "billing_interval": p.billing_interval, "duration_days": p.duration_days,
            "free_parkings": p.free_parkings, "free_washes": p.free_washes, "max_lots": p.max_lots,
            "features": p.features, "badge": p.badge, "is_active": p.is_active}
