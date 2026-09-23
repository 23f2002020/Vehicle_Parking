import glob
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Applications import utils                                   # noqa: E402
from Applications.config import TestingConfig                    # noqa: E402
from Applications.factory import create_app                      # noqa: E402
from Applications.seed import seed_demo                          # noqa: E402


@pytest.fixture()
def app():
    utils.reset_clock()
    a = create_app(TestingConfig)
    for f in glob.glob(os.path.join(a.config["OUTBOX_DIR"], "*.txt")):
        os.remove(f)
    with a.app_context():
        seed_demo()
    yield a
    utils.reset_clock()


@pytest.fixture()
def client(app):
    return app.test_client()


def _login(client, email, role):
    r = client.post("/api/login", json={"email": email, "password": "password", "login_as": role})
    assert r.status_code == 200, r.get_json()
    return {"Authentication-Token": r.get_json()["user"]["auth_token"]}


@pytest.fixture()
def admin_h(client):
    return _login(client, "user@admin.com", "admin")


@pytest.fixture()
def user_h(client):
    return _login(client, "user@user.com", "user")


@pytest.fixture()
def user2_h(client):
    return _login(client, "rahul@example.com", "user")


@pytest.fixture()
def captain_h(client):
    """Demo ride-captain seeded by seed_demo() - already KYC/vehicle-approved and AVAILABLE,
    see Applications/seed.py's _ensure_driver_partner()."""
    return _login(client, "captain@driver.com", "driver")


@pytest.fixture()
def valet_h(client):
    """Demo valet-driver seeded by seed_demo() - already KYC-approved and AVAILABLE."""
    return _login(client, "valet@driver.com", "driver")


CARD = {"method": "card", "card_number": "4111 1111 1111 1111", "expiry": "12/30", "cvv": "123", "name": "T"}
UPI = {"method": "upi", "upi_id": "demo@upi"}
