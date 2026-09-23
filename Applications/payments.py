"""Payment helper: validates card/UPI details, calls the dummy gateway and records the transaction.

Only the last 4 digits of a card are ever stored. (The old code concatenated the full card number
into a database column.)
"""
import re
from datetime import datetime

from flask import current_app

from . import utils
from .database import db
from .dummy_gateway import DummyPaymentGateway
from .models import PaymentTransaction

_UPI_RE = re.compile(r"^[A-Za-z0-9._\-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$")


def _luhn_ok(digits):
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def validate_payment(payload):
    """Return a cleaned dict {method, card_number, upi_id, detail} or raise ApiError(400)."""
    if not isinstance(payload, dict):
        raise utils.ApiError("Payment details are required.", 400, "payment_required")
    method = (payload.get("method") or "").lower()
    if method == "card":
        number = re.sub(r"[\s-]", "", str(payload.get("card_number") or ""))
        if not number.isdigit() or not 13 <= len(number) <= 19 or not _luhn_ok(number):
            raise utils.ApiError("Enter a valid card number.", 400, "bad_card")
        exp = str(payload.get("expiry") or "")
        m = re.match(r"^(\d{2})\s*/\s*(\d{2})$", exp)
        if not m or not 1 <= int(m.group(1)) <= 12:
            raise utils.ApiError("Card expiry must be in MM/YY format.", 400, "bad_expiry")
        year, month = 2000 + int(m.group(2)), int(m.group(1))
        now = utils.now_utc()
        if (year, month) < (now.year, now.month):
            raise utils.ApiError("This card has expired.", 400, "bad_expiry")
        if not re.match(r"^\d{3,4}$", str(payload.get("cvv") or "")):
            raise utils.ApiError("Enter the 3 or 4 digit CVV.", 400, "bad_cvv")
        return {"method": "card", "card_number": number, "upi_id": "", "detail": "•••• " + number[-4:]}
    if method == "upi":
        upi = str(payload.get("upi_id") or "").strip()
        if not _UPI_RE.match(upi):
            raise utils.ApiError("Enter a valid UPI ID, for example name@bank.", 400, "bad_upi")
        return {"method": "upi", "card_number": "", "upi_id": upi, "detail": upi}
    raise utils.ApiError("Choose a payment method (card or UPI).", 400, "payment_required")


def charge(user, amount, payload, purpose, reservation=None, lot_id=None, subscription=None):
    """Charge `amount`. On success returns the (uncommitted) PaymentTransaction; on failure records a
    failed transaction, commits it and raises ApiError(402)."""
    amount = utils.money(amount)
    cleaned = validate_payment(payload)
    result = DummyPaymentGateway.process_payment(
        amount, current_app.config.get("CURRENCY", "INR"), cleaned["method"],
        cleaned["card_number"], cleaned["upi_id"])

    txn = PaymentTransaction(
        txn_ref=result["transaction_id"], user_id=user.id,
        reservation_id=reservation.id if reservation is not None and reservation.id else None,
        subscription_id=subscription.id if subscription is not None and subscription.id else None,
        lot_id=lot_id, amount=amount, currency=result["currency"],
        method=cleaned["method"], method_detail=cleaned["detail"],
        purpose=purpose, status=result["status"], message=result["message"])
    db.session.add(txn)
    if result["status"] != "success":
        db.session.commit()
        raise utils.ApiError(result["message"] + " You have not been charged.", 402, "payment_failed",
                             transaction_id=result["transaction_id"])
    return txn


def record_refund(user, amount, reservation, method, detail, lot_id):
    txn = PaymentTransaction(
        txn_ref="RFD" + utils.gen_code("", 10).lstrip("-"), user_id=user.id, reservation_id=reservation.id,
        lot_id=lot_id, amount=utils.money(amount), currency="INR", method=method or "card",
        method_detail=detail, purpose="refund", status="success", message="Refund processed to original method")
    db.session.add(txn)
    return txn
