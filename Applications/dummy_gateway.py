import uuid
import random

class DummyPaymentGateway:
    """
    A simulated payment gateway for development and testing.
    Mimics success and failure scenarios based on amount.
    """
    @staticmethod
    def process_payment(amount, currency="USD", card_number=""):
        """
        Simulates a payment transaction.
        - Amounts ending in.00 or.01 simulate success.
        - Amounts ending in.02 simulate failure (e.g., card declined).
        - Other amounts can be configured for different scenarios.
        """
        transaction_id = str(uuid.uuid4())
        status = 'failed'
        message = 'Payment failed.'

        # Simple logic to simulate success/failure for testing
        if amount % 1 == 0 or amount % 1 == 0.01: # Amounts like 10.00, 15.01
            status = 'success'
            message = 'Payment successful.'
        elif amount % 1 == 0.02: # Amounts like 20.02
            status = 'failed'
            message = 'Card declined.'
        else: # Random failures for other amounts
            if random.random() < 0.8: # 80% success rate for other amounts
                status = 'success'
                message = 'Payment successful.'
            else:
                status = 'failed'
                message = 'Transaction error.'

        return {
            'status': status,
            'transaction_id': transaction_id,
            'message': message,
            'amount': amount,
            'currency': currency
        }

    @staticmethod
    def get_test_card_numbers():
        """Provides dummy card numbers for testing different scenarios."""
        return {
            'success_card': '4111222233334444', # Simulates success with specific amount logic
            'declined_card': '4000111122223333', # Simulates decline with specific amount logic
            'generic_card': '4555666677778888' # Simulates random success/failure
        }