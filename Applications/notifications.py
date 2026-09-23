"""Builds the text of every e-mail the system sends. Times are shown in APP_TIMEZONE."""
from flask import current_app

from . import mailer, pricing, utils
from .database import db
from .models import Reservation


def _t(dt):
    return utils.fmt_local(dt, current_app.config["APP_TIMEZONE"])


def _inr(x):
    return f"₹{utils.money(x):,.2f}"


def _summary(res):
    lot, slot = res.lot, res.slot
    lines = [
        f"Booking code : {res.code}",
        f"Location     : {lot.name}, {lot.address}" + (f", {lot.city}" if lot.city else ""),
        f"Your slot    : {slot.full_label}  ({slot.location_text()})",
        f"Vehicle      : {res.vehicle_number}",
        f"From         : {_t(res.start_time)}",
        f"Until        : {_t(res.end_time)}",
    ]
    if res.addons:
        lines.append("Add-ons      : " + ", ".join(a.name for a in res.addons))
    return "\n".join(lines)


def _policy(res):
    rate = pricing.fine_rate_per_block(res.hourly_rate)
    return (f"Good to know\n"
            f" - Need more time? Extend from the app before your time ends (subject to availability).\n"
            f" - Leaving late? Overstaying is charged {_inr(rate)} per started 15 minutes.\n"
            f" - Each slot is kept free for {res.buffer_minutes} minutes between two bookings so the next driver "
            f"never finds it occupied.")


def build(res, kind, extra=None):
    """Return (subject, body) for the given notification kind."""
    extra = extra or {}
    name = res.user.username
    sig = "\n\nSafe parking,\nTeam VParkEasy"
    if kind == "confirmed":
        return (f"Parking confirmed · {res.lot.name} · {res.code}",
                f"Hi {name},\n\nYour parking is confirmed and paid ({_inr(res.paid_for_booking)}).\n\n"
                f"{_summary(res)}\n\n{_policy(res)}{sig}")
    if kind == "extended":
        return (f"Booking extended · {res.code}",
                f"Hi {name},\n\nYour booking has been extended. Extra charge: {_inr(extra.get('amount', 0))}.\n\n"
                f"{_summary(res)}{sig}")
    if kind == "cancelled":
        return (f"Booking cancelled · {res.code}",
                f"Hi {name},\n\nYour booking {res.code} at {res.lot.name} has been cancelled.\n"
                f"Refund: {_inr(res.refund_amount)} to your original payment method.{sig}")
    if kind == "reminder_start":
        return (f"Your parking starts soon · {res.lot.name}",
                f"Hi {name},\n\nYour parking begins at {_t(res.start_time)}.\n\n{_summary(res)}\n\n"
                f"Tip: open the booking in the app to see the slot map and walk straight to {res.slot.full_label}.{sig}")
    if kind == "reminder_end":
        return (f"Your parking time ends soon · {res.code}",
                f"Hi {name},\n\nYour parking at {res.lot.name} ends at {_t(res.end_time)}.\n\n"
                f"Extend in the app to stay longer, or drive out before then. After {_t(res.end_time)} an overstay "
                f"fine of {_inr(pricing.fine_rate_per_block(res.hourly_rate))} per 15 minutes applies.{sig}")
    if kind == "overstay":
        return (f"You have overstayed · {res.code}",
                f"Hi {name},\n\nYour parking time at {res.lot.name} ended at {_t(res.end_time)} and your vehicle "
                f"({res.vehicle_number}) is still in slot {res.slot.full_label}.\n\n"
                f"An overstay fine of {_inr(pricing.fine_rate_per_block(res.hourly_rate))} per started 15 minutes is "
                f"accruing. Please leave as soon as possible - the next booking needs this slot.{sig}")
    if kind == "checked_out":
        fine = res.fine_amount or 0
        txt = (f"Hi {name},\n\nThanks for parking with us. You left at {_t(res.checked_out_at)}.\n\n"
               f"{_summary(res)}\n\nParking paid: {_inr(res.paid_for_booking)}")
        if fine > 0:
            txt += (f"\nOverstay: {res.overstay_minutes} min -> fine {_inr(fine)} "
                    f"({'PAID' if res.fine_status == 'paid' else 'DUE - please pay it in the app'})")
        return (f"Receipt · {res.code}", txt + sig)
    if kind == "fine_paid":
        return (f"Fine payment received · {res.code}",
                f"Hi {name},\n\nWe received your overstay fine of {_inr(res.fine_amount)} for booking {res.code}. "
                f"Thank you.{sig}")
    return (f"Update on booking {res.code}", f"Hi {name},\n\nYour booking {res.code} was updated.{sig}")


def send_booking_email(reservation_id, kind, extra=None):
    res = db.session.get(Reservation, reservation_id)
    if not res or not res.user:
        return {"sent": False, "reason": "reservation not found"}
    subject, body = build(res, kind, extra)
    result = mailer.send_email_now(res.user.email, subject, body)
    return {"sent": True, **result}
