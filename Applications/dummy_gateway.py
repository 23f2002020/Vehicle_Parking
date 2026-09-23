"""Simulated payment gateway (no real money moves).

Deterministic rules so every scenario can be tested by hand:

    card  ....0002   -> declined (issuer)
    card  ....9995   -> declined (insufficient funds)
    UPI   fail@xxx   -> declined
    anything else    -> success

Test cards that pass validation (Luhn):  4111 1111 1111 1111 , 5555 5555 5555 4444
Test card that is declined:              4000 0000 0000 0002
"""
import uuid


class DummyPaymentGateway:
    @staticmethod
    def process_payment(amount, currency="INR", method="card", card_number="", upi_id=""):
        txn_id = "TXN" + uuid.uuid4().hex[:14].upper()
        status, message = "success", "Payment successful."

        if method == "card":
            digits = "".join(ch for ch in (card_number or "") if ch.isdigit())
            if digits.endswith("0002"):
                status, message = "failed", "Card declined by the issuing bank."
            elif digits.endswith("9995"):
                status, message = "failed", "Insufficient funds."
        elif method == "upi":
            if (upi_id or "").lower().startswith("fail"):
                status, message = "failed", "UPI request declined."

        return {"status": status, "transaction_id": txn_id, "message": message,
                "amount": amount, "currency": currency}

    @staticmethod
    def get_test_card_numbers():
        return {"success": "4111111111111111", "success_mastercard": "5555555555554444",
                "declined": "4000000000000002", "insufficient_funds": "4000000000009995"}
