"""Subscription plans: list (role aware), my subscription, purchase."""
from flask_security import current_user

from .. import utils
from ..database import db
from ..models import SubscriptionPlan
from ..subscriptions import SubscriptionService, plan_dict
from .base import AuthResource, json_body


def _my_type():
    return "admin" if current_user.is_admin and not any(r.name == "user" for r in current_user.roles) else "user"


class PlansResource(AuthResource):
    def get(self):
        ptype = _my_type()
        plans = (SubscriptionPlan.query.filter_by(plan_type=ptype, is_active=True)
                 .order_by(SubscriptionPlan.price).all())
        return {"plan_type": ptype, "plans": [plan_dict(p) for p in plans]}


class MySubscriptionResource(AuthResource):
    def get(self):
        ptype = _my_type()
        now = utils.now_utc()
        sub = SubscriptionService.active(current_user, ptype, now)
        out = {"plan_type": ptype, "subscription": SubscriptionService.serialize(sub, now)}
        if ptype == "admin":
            limit, name = SubscriptionService.admin_lot_limit(current_user, now)
            out["lot_limit"] = {"limit": limit, "used": SubscriptionService.admin_lots_used(current_user), "plan": name}
        else:
            out["welcome_minutes_remaining"] = current_user.free_minutes_remaining
        return out

    def post(self):
        data = json_body()
        plan = db.session.get(SubscriptionPlan, utils.as_int(data.get("plan_id"), "plan_id"))
        if not plan:
            raise utils.ApiError("Plan not found.", 404, "not_found")
        sub, txn = SubscriptionService.purchase(current_user, plan, data.get("payment"))
        return {"message": f"You are now on {plan.name}.", "subscription": SubscriptionService.serialize(sub),
                "transaction_id": txn.txn_ref}, 201
