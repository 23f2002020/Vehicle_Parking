"""Pricing: parking fee, add-ons, free-allowance discounts, extension cost and overstay fine."""
import math
from datetime import timedelta

from flask import current_app

from . import utils
from .models import Subscription, SubscriptionPlan


def cfg(name):
    return current_app.config[name]


# ----------------------------------------------------------------------------- basic fees
def blocks(minutes):
    return max(1, math.ceil(minutes / cfg("BILLING_BLOCK_MINUTES")))


def time_fee(rate_per_hour, minutes):
    """Parking is billed in started blocks (default 15 min): 1h10m at Rs40/h -> 5 blocks -> Rs50."""
    if minutes <= 0:
        return 0.0
    return utils.money(rate_per_hour * blocks(minutes) * cfg("BILLING_BLOCK_MINUTES") / 60.0)


def fmt_duration(minutes):
    minutes = int(round(minutes))
    h, m = divmod(minutes, 60)
    if h and m:
        return f"{h}h {m}m"
    return f"{h}h" if h else f"{m}m"


def fine_for(reservation, at):
    """Fine (minutes over, amount) if the vehicle leaves at `at`.

    Fine = FINE_MULTIPLIER x hourly rate, billed in started 15-minute blocks, capped at FINE_CAP_HOURS.
    """
    over = (at - reservation.end_time).total_seconds() / 60.0
    if over <= cfg("FINE_GRACE_MINUTES") or over <= 0:
        return 0, 0.0
    over_min = int(math.ceil(over))
    capped = min(over_min, cfg("FINE_CAP_HOURS") * 60)
    amount = time_fee(reservation.hourly_rate * cfg("FINE_MULTIPLIER"), capped)
    return over_min, amount


def fine_rate_per_block(rate):
    return utils.money(rate * cfg("FINE_MULTIPLIER") * cfg("BILLING_BLOCK_MINUTES") / 60.0)


# ----------------------------------------------------------------------------- entitlements
def current_user_subscription(user, now):
    q = (Subscription.query.join(SubscriptionPlan, Subscription.plan_id == SubscriptionPlan.id)
         .filter(Subscription.user_id == user.id, Subscription.status == "active",
                 Subscription.end_date > now, SubscriptionPlan.plan_type == "user")
         .order_by(Subscription.end_date.desc()))
    return q.first()


def validate_window(start, end, now):
    if end <= start:
        raise utils.ApiError("The end time must be after the start time.", 400, "bad_window")
    minutes = (end - start).total_seconds() / 60.0
    if minutes < cfg("MIN_BOOKING_MINUTES"):
        raise utils.ApiError(f"The minimum booking is {cfg('MIN_BOOKING_MINUTES')} minutes.", 400, "too_short")
    if minutes > cfg("MAX_BOOKING_HOURS") * 60:
        raise utils.ApiError(f"The maximum booking is {cfg('MAX_BOOKING_HOURS')} hours.", 400, "too_long")
    if start < now - timedelta(minutes=3):
        raise utils.ApiError("The start time is in the past. Please pick a later time.", 400, "in_past")
    if start > now + timedelta(days=cfg("MAX_ADVANCE_DAYS")):
        raise utils.ApiError(f"You can book at most {cfg('MAX_ADVANCE_DAYS')} days ahead.", 400, "too_far")
    return minutes


# ----------------------------------------------------------------------------- quote
def build_quote(user, lot, start, end, addon_codes, now):
    """Full price breakdown for a new booking. Pure calculation - writes nothing."""
    minutes = validate_window(start, end, now)
    rate = lot.price_per_hour
    base = time_fee(rate, minutes)
    items = [{"kind": "parking", "label": f"Parking · {fmt_duration(minutes)} @ ₹{rate:g}/hr", "amount": base}]

    by_code = {la.amenity.code: la for la in lot.amenities}
    addons = []
    for code in dict.fromkeys(addon_codes or []):           # de-duplicate, keep order
        la = by_code.get(code)
        if la is None or la.amenity.category != "bookable":
            raise utils.ApiError(f"'{code}' is not available as an add-on at this lot.", 400, "bad_addon")
        price = la.price if la.price is not None else la.amenity.default_price
        total = utils.money(price * math.ceil(minutes / 60.0)) if la.amenity.price_unit == "per_hour" else utils.money(price)
        addons.append({"amenity_id": la.amenity_id, "code": code, "name": la.amenity.name,
                       "unit_price": price, "quantity": 1, "total": total})
        items.append({"kind": "addon", "label": la.amenity.name, "amount": total})

    subtotal = utils.money(base + sum(a["total"] for a in addons))
    discount, entitlement = 0.0, None

    sub = current_user_subscription(user, now)
    if sub and sub.remaining_parkings > 0:
        covered = min(minutes, cfg("SUBSCRIPTION_FREE_MINUTES_PER_PARKING"))
        d = min(time_fee(rate, covered), base)
        discount += d
        entitlement = {"type": "subscription", "subscription_id": sub.id, "plan": sub.plan.name,
                       "covered_minutes": int(covered), "wash_credit": False}
        items.append({"kind": "discount", "label": f"{sub.plan.name}: free parking (first {fmt_duration(covered)})",
                      "amount": -d})
    elif user.free_minutes_remaining > 0:
        covered = min(minutes, user.free_minutes_remaining)
        d = min(time_fee(rate, covered), base)
        discount += d
        entitlement = {"type": "welcome", "subscription_id": None, "plan": "Welcome allowance",
                       "covered_minutes": int(covered), "wash_credit": False}
        items.append({"kind": "discount", "label": f"Welcome allowance: {fmt_duration(covered)} free", "amount": -d})

    if sub and sub.remaining_washes > 0 and "car_wash" in {a["code"] for a in addons}:
        wash = next(a for a in addons if a["code"] == "car_wash")["total"]
        discount += wash
        if entitlement is None:
            entitlement = {"type": "subscription", "subscription_id": sub.id, "plan": sub.plan.name,
                           "covered_minutes": 0, "wash_credit": True}
        entitlement["wash_credit"] = True
        entitlement["subscription_id"] = sub.id
        items.append({"kind": "discount", "label": f"{sub.plan.name}: free car wash", "amount": -wash})

    discount = utils.money(discount)
    total = utils.money(max(0.0, subtotal - discount))
    return {
        "minutes": int(minutes), "hours": round(minutes / 60.0, 2), "rate": rate,
        "line_items": items, "subtotal": subtotal, "discount": discount, "total": total,
        "entitlement": entitlement, "addons": addons, "base": base,
        "buffer_minutes": lot.buffer_minutes,
        "fine_rate_per_block": fine_rate_per_block(rate),
        "currency": cfg("CURRENCY"),
    }


def public_quote(q):
    out = {k: v for k, v in q.items() if k != "addons"}
    out["addons"] = [{"code": a["code"], "name": a["name"], "total": a["total"]} for a in q["addons"]]
    return out
