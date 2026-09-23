"""End-to-end tests for the driver-PARTNER domain (ride captains / valet drivers) added on top of
the existing booking system: registration + KYC + vehicle approval, the ride and valet job state
machines (accept/advance/complete/cancel), dummy fare/fee calculation and the platform-commission
split, handover photo capture, ratings, the rider-side "Book a Ride"/"Request Valet" endpoints, the
reservation<->ride/valet link, and the admin permission boundaries (platform-admin-only vs. any
lot-owner). Mirrors test_booking_flow.py's style: plain functions, the shared `client`/`app`
fixtures, direct assertions on status code and JSON body/code.

`captain_h`/`valet_h` (conftest.py) log in as the demo driver partners seed_demo() always creates
already KYC/vehicle-approved and AVAILABLE (Applications/seed.py's _ensure_driver_partner) - so most
tests can accept/advance a job immediately without first walking the approval flow by hand. The
approval flow itself (PENDING -> admin decision) is covered separately with a freshly-registered
driver, since the demo captain/valet skip straight past it.
"""
from datetime import timedelta

import pytest

from Applications import utils
from conftest import CARD, UPI


def close(a, b, tol=0.02):
    return abs(float(a) - float(b)) <= tol


def register_driver(client, email, driver_type, username=None, phone="+91 90000 00000"):
    r = client.post("/api/driver/register", json={
        "username": username or email.split("@")[0], "email": email, "password": "password", "phone": phone,
        "driver_type": driver_type, "full_name": "Test " + driver_type.title(), "dob": "1995-01-01",
        "licence_number": "DLTEST" + email[:4].upper(),
        "licence_document": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
                            "+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    })
    return r


def h_for(token):
    return {"Authentication-Token": token}


def register_second_admin(client, email, username):
    r = client.post("/api/register", json={"username": username, "email": email, "password": "password", "role": "admin"})
    assert r.status_code == 201, r.get_json()
    r = client.post("/api/login", json={"email": email, "password": "password", "login_as": "admin"})
    assert r.status_code == 200, r.get_json()
    return h_for(r.get_json()["user"]["auth_token"])


def register_and_login_driver(client, email, driver_type, **kw):
    r = register_driver(client, email, driver_type, **kw)
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    return h_for(body["user"]["auth_token"]), body["driver"]["id"]


def request_ride(client, h, pickup="A Street", drop="B Street", distance=5.0, reservation_id=None):
    body = {"pickup_label": pickup, "drop_label": drop, "distance_km": distance}
    if reservation_id:
        body["reservation_id"] = reservation_id
    return client.post("/api/rides", headers=h, json=body)


def request_valet(client, h, request_type="home_to_lot", vehicle="KA01AB1234", pickup="Home",
                  drop="Central Mall Parking", distance=4.0, reservation_id=None, lot_id=None):
    body = {"request_type": request_type, "vehicle_number": vehicle, "pickup_label": pickup,
           "drop_label": drop, "distance_km": distance}
    if reservation_id:
        body["reservation_id"] = reservation_id
    if lot_id:
        body["lot_id"] = lot_id
    return client.post("/api/valet", headers=h, json=body)


# ================================================================== registration + KYC + vehicle
def test_driver_register_creates_pending_kyc(client):
    r = register_driver(client, "newcaptain@test.com", "ride_captain")
    assert r.status_code == 201, r.get_json()
    d = r.get_json()["driver"]
    assert d["driver_type"] == "ride_captain" and d["kyc_status"] == "PENDING" and d["can_go_online"] is False


def test_driver_register_bad_type_rejected(client):
    r = register_driver(client, "badtype@test.com", "chauffeur")
    assert r.status_code == 400 and r.get_json()["code"] == "bad_driver_type"


def test_driver_register_short_name_rejected(client):
    r = client.post("/api/driver/register", json={
        "username": "shorty", "email": "shorty@test.com", "password": "password", "driver_type": "ride_captain",
        "full_name": "X", "licence_number": "DL12345"})
    assert r.status_code == 400 and r.get_json()["code"] == "bad_name"


def test_cannot_go_online_before_kyc_approved(client):
    h, _ = register_and_login_driver(client, "pending1@test.com", "ride_captain")
    r = client.post("/api/driver/availability", headers=h, json={"status": "AVAILABLE"})
    assert r.status_code == 403 and r.get_json()["code"] == "kyc_not_approved"


def test_ride_captain_needs_approved_vehicle_too(client, admin_h):
    h, driver_id = register_and_login_driver(client, "pending2@test.com", "ride_captain")
    r = client.post(f"/api/admin/drivers/{driver_id}/kyc", headers=admin_h, json={"decision": "APPROVED"})
    assert r.status_code == 200 and r.get_json()["driver"]["kyc_status"] == "APPROVED"
    # KYC approved but no vehicle yet
    r = client.post("/api/driver/availability", headers=h, json={"status": "AVAILABLE"})
    assert r.status_code == 403 and r.get_json()["code"] == "vehicle_not_approved"
    r = client.post("/api/driver/vehicle", headers=h, json={"reg_number": "KA02ZZ0001", "manufacturer": "Tata"})
    assert r.status_code == 201
    vehicle_id = r.get_json()["vehicle"]["id"]
    r = client.post(f"/api/admin/driver-vehicles/{vehicle_id}/review", headers=admin_h, json={"decision": "APPROVED"})
    assert r.status_code == 200 and r.get_json()["vehicle"]["status"] == "APPROVED"
    r = client.post("/api/driver/availability", headers=h, json={"status": "AVAILABLE"})
    assert r.status_code == 200 and r.get_json()["status"] == "AVAILABLE"


def test_valet_driver_does_not_need_a_vehicle(client, admin_h):
    h, driver_id = register_and_login_driver(client, "pendingvalet@test.com", "valet_driver")
    client.post(f"/api/admin/drivers/{driver_id}/kyc", headers=admin_h, json={"decision": "APPROVED"})
    r = client.post("/api/driver/availability", headers=h, json={"status": "AVAILABLE"})
    assert r.status_code == 200 and r.get_json()["status"] == "AVAILABLE"


def test_only_platform_admin_can_review_kyc_or_vehicle(client, admin_h):
    # a second, non-platform admin (lot owner) must not be able to approve KYC/vehicles
    other_admin_h = register_second_admin(client, "otherowner@test.com", "otherowner")
    h, driver_id = register_and_login_driver(client, "guardedkyc@test.com", "ride_captain")
    r = client.post(f"/api/admin/drivers/{driver_id}/kyc", headers=other_admin_h, json={"decision": "APPROVED"})
    assert r.status_code == 403
    r = client.post(f"/api/admin/drivers/{driver_id}/status", headers=other_admin_h, json={"status": "suspended"})
    assert r.status_code == 403
    # but the read-only directory/detail views are open to any lot admin
    assert client.get("/api/admin/drivers", headers=other_admin_h).status_code == 200
    assert client.get(f"/api/admin/drivers/{driver_id}", headers=other_admin_h).status_code == 200


def test_admin_kyc_reject_records_reason(client, admin_h):
    h, driver_id = register_and_login_driver(client, "rejectme@test.com", "ride_captain")
    r = client.post(f"/api/admin/drivers/{driver_id}/kyc", headers=admin_h,
                    json={"decision": "REJECTED", "reason": "Blurry licence photo"})
    assert r.status_code == 200
    d = r.get_json()["driver"]
    assert d["kyc_status"] == "REJECTED" and d["kyc_reject_reason"] == "Blurry licence photo"
    r = client.post("/api/driver/availability", headers=h, json={"status": "AVAILABLE"})
    assert r.status_code == 403 and r.get_json()["code"] == "kyc_not_approved"


def test_admin_suspend_forces_driver_offline_and_blocks_relogin_online(client, admin_h, captain_h):
    # captain_h is already AVAILABLE via seed_demo(); confirm suspension knocks it offline
    me = client.get("/api/driver/me", headers=captain_h).get_json()
    driver_id = me["id"]
    r = client.post(f"/api/admin/drivers/{driver_id}/status", headers=admin_h,
                    json={"status": "suspended", "reason": "Multiple complaints"})
    assert r.status_code == 200 and r.get_json()["driver"]["account_status"] == "suspended"
    me2 = client.get("/api/driver/me", headers=captain_h).get_json()
    assert me2["availability"] == "OFFLINE"
    r = client.post("/api/driver/availability", headers=captain_h, json={"status": "AVAILABLE"})
    assert r.status_code == 403 and r.get_json()["code"] == "account_suspended"
    # reactivate so later tests (same app instance) using captain_h are unaffected... (each test gets a fresh app)
    client.post(f"/api/admin/drivers/{driver_id}/status", headers=admin_h, json={"status": "active"})


# ================================================================== ride lifecycle
def test_request_ride_requires_pickup_and_drop(client, user_h):
    r = request_ride(client, user_h, pickup="", drop="")
    assert r.status_code == 400 and r.get_json()["code"] == "locations_required"


def test_ride_pool_only_visible_to_ride_captains(client, captain_h, valet_h, user_h):
    request_ride(client, user_h)
    pool_captain = client.get("/api/driver/rides", headers=captain_h, query_string={"scope": "available"}).get_json()
    assert len(pool_captain["rides"]) >= 1
    pool_valet = client.get("/api/driver/valet", headers=valet_h, query_string={"scope": "available"}).get_json()
    # a valet driver's ride list scope is always empty (rides are captain-only)
    pool_valet_rides = client.get("/api/driver/rides", headers=valet_h, query_string={"scope": "available"}).get_json()
    assert pool_valet_rides["rides"] == []


def test_valet_driver_cannot_accept_a_ride(client, valet_h, user_h):
    r = request_ride(client, user_h)
    ride_id = r.get_json()["ride"]["id"]
    r = client.post(f"/api/driver/rides/{ride_id}/accept", headers=valet_h)
    assert r.status_code == 403 and r.get_json()["code"] == "not_a_captain"


def test_second_captain_cannot_accept_an_already_taken_ride(client, admin_h, captain_h, user_h):
    other_h, other_id = register_and_login_driver(client, "othercaptain@test.com", "ride_captain")
    client.post(f"/api/admin/drivers/{other_id}/kyc", headers=admin_h, json={"decision": "APPROVED"})
    v = client.post("/api/driver/vehicle", headers=other_h, json={"reg_number": "KA03YY0002"}).get_json()["vehicle"]
    client.post(f"/api/admin/driver-vehicles/{v['id']}/review", headers=admin_h, json={"decision": "APPROVED"})
    client.post("/api/driver/availability", headers=other_h, json={"status": "AVAILABLE"})

    r = request_ride(client, user_h)
    ride_id = r.get_json()["ride"]["id"]
    r1 = client.post(f"/api/driver/rides/{ride_id}/accept", headers=captain_h)
    assert r1.status_code == 200 and r1.get_json()["ride"]["status"] == "ACCEPTED"
    r2 = client.post(f"/api/driver/rides/{ride_id}/accept", headers=other_h)
    assert r2.status_code == 409 and r2.get_json()["code"] == "already_taken"


def test_full_ride_lifecycle_fare_split_and_rating(client, captain_h, user_h):
    r = request_ride(client, user_h, pickup="Koramangala", drop="Airport", distance=20.0)
    assert r.status_code == 201
    ride = r.get_json()["ride"]
    assert ride["status"] == "REQUESTED" and ride["actions"]["can_accept"] is True
    ride_id = ride["id"]

    r = client.post(f"/api/driver/rides/{ride_id}/accept", headers=captain_h)
    assert r.status_code == 200 and r.get_json()["ride"]["status"] == "ACCEPTED"
    for action, status in (("arriving", "DRIVER_ARRIVING"), ("arrived", "DRIVER_ARRIVED"), ("start", "RIDE_STARTED")):
        r = client.post(f"/api/driver/rides/{ride_id}/{action}", headers=captain_h)
        assert r.status_code == 200 and r.get_json()["ride"]["status"] == status

    r = client.post(f"/api/driver/rides/{ride_id}/complete", headers=captain_h)
    assert r.status_code == 200
    fare = r.get_json()["ride"]["fare"]
    assert fare["total"] > 0 and fare["paid"] is False
    assert close(fare["total"], fare["base_fare"] + fare["distance_fare"] + fare["time_fare"]
                + fare["waiting_fee"] + fare["cancellation_fee"])

    # rider sees it too, with the driver + vehicle attached, and can both pay and rate now
    seen = client.get(f"/api/rides/{ride_id}", headers=user_h).get_json()
    assert seen["driver"]["full_name"] and seen["driver"]["vehicle"]["reg_number"]
    assert seen["actions"]["can_pay"] is True and seen["actions"]["can_rate"] is True

    r = client.post(f"/api/rides/{ride_id}/pay", headers=user_h, json={"payment": CARD})
    assert r.status_code == 200 and r.get_json()["ride"]["fare"]["paid"] is True

    # commission split: platform_fee + driver_earning == total, at the configured percentage -
    # not exposed to the rider, so read the row straight from the DB (same app the client is using).
    with client.application.app_context():
        from Applications.models import RideFare
        rf = RideFare.query.filter_by(ride_id=ride_id).one()
        commission_pct = client.application.config["PLATFORM_COMMISSION_PERCENT"]
        assert close(rf.platform_fee, round(rf.total * commission_pct / 100.0, 2))
        assert close(rf.platform_fee + rf.driver_earning, rf.total)

    r = client.get(f"/api/driver/earnings", headers=captain_h).get_json()
    assert r["completed_rides"] >= 1

    r = client.post(f"/api/rides/{ride_id}/rate", headers=user_h, json={"stars": 5, "review": "Great ride!"})
    assert r.status_code == 200 and r.get_json()["ride"]["rated"] is True
    r = client.post(f"/api/rides/{ride_id}/rate", headers=user_h, json={"stars": 4})
    assert r.status_code == 409 and r.get_json()["code"] == "already_rated"


def test_cannot_request_new_ride_while_fare_is_due(client, captain_h, user_h):
    r = request_ride(client, user_h)
    ride_id = r.get_json()["ride"]["id"]
    client.post(f"/api/driver/rides/{ride_id}/accept", headers=captain_h)
    for action in ("arriving", "arrived", "start"):
        client.post(f"/api/driver/rides/{ride_id}/{action}", headers=captain_h)
    client.post(f"/api/driver/rides/{ride_id}/complete", headers=captain_h)

    r = request_ride(client, user_h, pickup="Somewhere", drop="Else")
    assert r.status_code == 402 and r.get_json()["code"] == "fare_due" and r.get_json()["ride_id"] == ride_id

    client.post(f"/api/rides/{ride_id}/pay", headers=user_h, json={"payment": UPI})
    r = request_ride(client, user_h, pickup="Somewhere", drop="Else")
    assert r.status_code == 201


def test_cancel_ride_before_arrival_is_free_after_arrival_has_fee(client, captain_h, user_h):
    r = request_ride(client, user_h)
    ride_id = r.get_json()["ride"]["id"]
    r = client.post(f"/api/rides/{ride_id}/cancel", headers=user_h, json={"reason": "changed my mind"})
    assert r.status_code == 200
    body = r.get_json()["ride"]
    assert body["status"] == "CANCELLED" and body["cancelled_by"] == "rider" and body["fare"] is None

    r = request_ride(client, user_h)
    ride_id = r.get_json()["ride"]["id"]
    client.post(f"/api/driver/rides/{ride_id}/accept", headers=captain_h)
    client.post(f"/api/driver/rides/{ride_id}/arriving", headers=captain_h)
    client.post(f"/api/driver/rides/{ride_id}/arrived", headers=captain_h)
    r = client.post(f"/api/rides/{ride_id}/cancel", headers=user_h, json={})
    assert r.status_code == 200
    fare = r.get_json()["ride"]["fare"]
    assert fare is not None and close(fare["total"], client.application.config["RIDE_CANCEL_FEE"])


def test_captain_cannot_hold_two_active_jobs(client, captain_h, user_h):
    r1 = request_ride(client, user_h, pickup="First", drop="Trip")
    client.post(f"/api/driver/rides/{r1.get_json()['ride']['id']}/accept", headers=captain_h)
    r2 = request_ride(client, user_h, pickup="Second", drop="Trip")
    r = client.post(f"/api/driver/rides/{r2.get_json()['ride']['id']}/accept", headers=captain_h)
    assert r.status_code == 409 and r.get_json()["code"] == "busy"


def test_captain_can_back_out_returns_ride_to_pool(client, captain_h, user_h):
    r = request_ride(client, user_h)
    ride_id = r.get_json()["ride"]["id"]
    client.post(f"/api/driver/rides/{ride_id}/accept", headers=captain_h)
    r = client.post(f"/api/driver/rides/{ride_id}/reject", headers=captain_h)
    assert r.status_code == 200
    body = r.get_json()["ride"]
    assert body["status"] == "REQUESTED" and body["driver"] is None


# ================================================================== valet lifecycle
def test_request_valet_bad_request_type_rejected(client, user_h):
    r = request_valet(client, user_h, request_type="teleport")
    assert r.status_code == 400 and r.get_json()["code"] == "bad_request_type"


def test_same_vehicle_cannot_have_two_active_valet_requests(client, user_h, user2_h):
    r1 = request_valet(client, user_h, vehicle="KA09QQ9999")
    assert r1.status_code == 201
    r2 = request_valet(client, user2_h, vehicle="KA09QQ9999")
    assert r2.status_code == 409 and r2.get_json()["code"] == "vehicle_busy"


def test_ride_captain_cannot_accept_a_valet_job(client, captain_h, user_h):
    r = request_valet(client, user_h)
    valet_id = r.get_json()["valet_request"]["id"]
    r = client.post(f"/api/driver/valet/{valet_id}/accept", headers=captain_h)
    assert r.status_code == 403 and r.get_json()["code"] == "not_a_valet_driver"


def test_full_valet_lifecycle_with_handover_photos_fee_and_rating(client, valet_h, user_h):
    r = request_valet(client, user_h, request_type="home_to_lot", vehicle="KA07HH1234",
                      pickup="My home", drop="Central Mall Parking", distance=6.0)
    assert r.status_code == 201
    valet_id = r.get_json()["valet_request"]["id"]

    r = client.post(f"/api/driver/valet/{valet_id}/accept", headers=valet_h)
    assert r.status_code == 200 and r.get_json()["valet_request"]["status"] == "DRIVER_ASSIGNED"
    r = client.post(f"/api/driver/valet/{valet_id}/going-to-pickup", headers=valet_h)
    assert r.status_code == 200 and r.get_json()["valet_request"]["status"] == "DRIVER_GOING_TO_PICKUP"

    r = client.post(f"/api/driver/valet/{valet_id}/picked-up", headers=valet_h,
                    json={"photo": "data:image/png;base64,AAAA", "fuel_level_percent": 65,
                          "condition_notes": "Small scratch on the bumper"})
    assert r.status_code == 200 and r.get_json()["valet_request"]["status"] == "VEHICLE_PICKED_UP"
    r = client.post(f"/api/driver/valet/{valet_id}/in-transit", headers=valet_h)
    assert r.status_code == 200 and r.get_json()["valet_request"]["status"] == "VEHICLE_IN_TRANSIT"
    r = client.post(f"/api/driver/valet/{valet_id}/dropped", headers=valet_h,
                    json={"photo": "data:image/png;base64,BBBB", "condition_notes": "Delivered clean"})
    assert r.status_code == 200 and r.get_json()["valet_request"]["status"] == "VEHICLE_DROPPED"

    r = client.post(f"/api/driver/valet/{valet_id}/complete", headers=valet_h)
    assert r.status_code == 200
    body = r.get_json()["valet_request"]
    cfg = client.application.config
    expected_fee = round(cfg["VALET_BASE_FEE"] + 6.0 * cfg["VALET_PER_KM_RATE"], 2)
    assert close(body["fee"], expected_fee)
    assert len(body["handovers"]) == 2
    assert body["handovers"][0]["stage"] == "pickup" and body["handovers"][0]["fuel_level_percent"] == 65
    assert body["handovers"][1]["stage"] == "dropoff"

    seen = client.get(f"/api/valet/{valet_id}", headers=user_h).get_json()
    assert seen["actions"]["can_pay"] is True and len(seen["handovers"]) == 2

    r = client.post(f"/api/valet/{valet_id}/pay", headers=user_h, json={"payment": UPI})
    assert r.status_code == 200 and r.get_json()["valet_request"]["paid"] is True

    r = client.post(f"/api/valet/{valet_id}/rate", headers=user_h, json={"stars": 5})
    assert r.status_code == 200 and r.get_json()["valet_request"]["rated"] is True


def test_valet_back_out_before_pickup_returns_to_pool(client, valet_h, user_h):
    r = request_valet(client, user_h)
    valet_id = r.get_json()["valet_request"]["id"]
    client.post(f"/api/driver/valet/{valet_id}/accept", headers=valet_h)
    r = client.post(f"/api/driver/valet/{valet_id}/reject", headers=valet_h)
    assert r.status_code == 200
    body = r.get_json()["valet_request"]
    assert body["status"] == "REQUESTED" and body["driver"] is None


def test_valet_cancellation_fee_only_after_pickup(client, valet_h, user_h):
    r = request_valet(client, user_h, vehicle="KA08KK4321")
    valet_id = r.get_json()["valet_request"]["id"]
    r = client.post(f"/api/valet/{valet_id}/cancel", headers=user_h, json={})
    assert r.status_code == 200 and r.get_json()["valet_request"]["cancellation_fee"] == 0

    r = request_valet(client, user_h, vehicle="KA08KK4321")
    valet_id = r.get_json()["valet_request"]["id"]
    client.post(f"/api/driver/valet/{valet_id}/accept", headers=valet_h)
    client.post(f"/api/driver/valet/{valet_id}/going-to-pickup", headers=valet_h)
    client.post(f"/api/driver/valet/{valet_id}/picked-up", headers=valet_h, json={})
    r = client.post(f"/api/valet/{valet_id}/cancel", headers=user_h, json={})
    assert r.status_code == 200
    assert close(r.get_json()["valet_request"]["cancellation_fee"], client.application.config["VALET_CANCEL_FEE"])


# ================================================================== reservation <-> ride/valet link
def _make_booking(client, user_h):
    slots = client.get("/api/lots/1/slot-map", headers=user_h).get_json()
    slot_id = next(s["id"] for f in slots["floors"] for s in f["slots"] if s["status"] == "available")
    start = utils.now_utc() + timedelta(hours=2)
    end = start + timedelta(hours=2)
    r = client.post("/api/bookings", headers=user_h, json={
        "lot_id": 1, "slot_id": slot_id, "start": utils.to_iso(start), "end": utils.to_iso(end),
        "vehicle_number": "KA01LK9999", "payment": CARD})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["booking"]


def test_ride_linked_to_active_reservation_autofills_pickup(client, user_h):
    booking = _make_booking(client, user_h)
    r = request_ride(client, user_h, pickup="", drop="Airport", reservation_id=booking["id"])
    assert r.status_code == 201, r.get_json()
    ride = r.get_json()["ride"]
    assert ride["reservation_id"] == booking["id"]
    assert booking["lot"]["name"] in ride["pickup_label"]


def test_cannot_link_a_cancelled_reservation(client, user_h):
    booking = _make_booking(client, user_h)
    client.post(f"/api/bookings/{booking['id']}/cancel", headers=user_h)
    r = request_valet(client, user_h, request_type="lot_to_home", drop="Home", reservation_id=booking["id"])
    assert r.status_code == 409 and r.get_json()["code"] == "reservation_not_active"


def test_cannot_link_another_riders_reservation(client, user_h, user2_h):
    booking = _make_booking(client, user_h)
    r = request_ride(client, user2_h, pickup="X", drop="Y", reservation_id=booking["id"])
    assert r.status_code == 404 and r.get_json()["code"] == "reservation_not_found"


# ================================================================== admin permission boundaries
def test_rides_valet_and_revenue_are_platform_admin_only(client, admin_h):
    other_admin_h = register_second_admin(client, "readonlyowner@test.com", "readonlyowner")
    for path in ("/api/admin/rides", "/api/admin/valet", "/api/admin/driver-revenue"):
        assert client.get(path, headers=other_admin_h).status_code == 403
        assert client.get(path, headers=admin_h).status_code == 200
    # the directory itself stays open to any lot admin (read-only)
    assert client.get("/api/admin/drivers", headers=other_admin_h).status_code == 200


def test_driver_endpoints_require_driver_role(client, user_h, admin_h):
    assert client.get("/api/driver/me", headers=user_h).status_code == 403
    assert client.get("/api/driver/me", headers=admin_h).status_code == 403


def test_rider_endpoints_reject_unauthenticated(client):
    assert client.get("/api/rides").status_code == 401
    assert client.post("/api/valet", json={}).status_code == 401


# ================================================================== real-map upfront fare/fee quote
# The rider now picks real pickup/drop pins on a real OpenStreetMap map, and the request form shows
# a cost estimate BEFORE requesting - not only after the ride/valet job ends (see FIXES.md). These
# cover the new /api/rides/quote, /api/valet/quote endpoints, and that requesting with map pins
# stores the real measured distance (never trusting a client-sent distance_km once pins are given).

KORAMANGALA = {"pickup_lat": 12.9716, "pickup_lng": 77.5946}
HEBBAL = {"drop_lat": 13.0827, "drop_lng": 77.5877}
MAP_POINTS = {**KORAMANGALA, **HEBBAL}          # ~16.1 km padded straight-line distance (see close())


def test_ride_quote_requires_login(client):
    assert client.post("/api/rides/quote", json={"distance_km": 5}).status_code == 401


def test_ride_quote_from_manual_distance(client, user_h):
    r = client.post("/api/rides/quote", headers=user_h, json={"distance_km": 5})
    assert r.status_code == 200, r.get_json()
    q = r.get_json()
    assert q["has_map_points"] is False
    assert close(q["distance_km"], 5.0)
    # 40 base + 5*12 distance + (5/25*60)*2 time = 40 + 60 + 24 = 124, no surge outside peak hours
    assert close(q["estimated_fare"], 124.0)
    assert q["estimated_low"] < q["estimated_fare"] < q["estimated_high"]


def test_ride_quote_from_real_map_points_measures_its_own_distance(client, user_h):
    r = client.post("/api/rides/quote", headers=user_h, json=MAP_POINTS)
    assert r.status_code == 200, r.get_json()
    q = r.get_json()
    assert q["has_map_points"] is True
    assert close(q["distance_km"], 16.1, tol=0.5)


def test_ride_quote_missing_everything_is_a_400_not_a_500(client, user_h):
    r = client.post("/api/rides/quote", headers=user_h, json={})
    assert r.status_code == 400


def test_valet_quote_from_manual_distance(client, user_h):
    r = client.post("/api/valet/quote", headers=user_h, json={"distance_km": 3})
    assert r.status_code == 200, r.get_json()
    q = r.get_json()
    # 80 base + 3*15 = 125
    assert close(q["estimated_fee"], 125.0)
    assert q["has_map_points"] is False


def test_request_ride_with_map_points_stores_coordinates_and_measures_real_distance(client, user_h):
    body = {"pickup_label": "Koramangala", "drop_label": "Hebbal", "distance_km": 999, **MAP_POINTS}
    r = client.post("/api/rides", headers=user_h, json=body)
    assert r.status_code == 201, r.get_json()
    ride = r.get_json()["ride"]
    # the server measures its own distance from the pins - it never trusts the bogus 999 sent above
    assert close(ride["distance_km"], 16.1, tol=0.5)
    assert close(ride["pickup_lat"], KORAMANGALA["pickup_lat"])
    assert close(ride["drop_lng"], HEBBAL["drop_lng"])


def test_request_ride_without_map_points_still_works_like_before(client, user_h):
    r = request_ride(client, user_h, distance=7.5)
    assert r.status_code == 201, r.get_json()
    ride = r.get_json()["ride"]
    assert close(ride["distance_km"], 7.5)
    assert ride["pickup_lat"] is None and ride["drop_lat"] is None


def test_request_valet_with_map_points_stores_coordinates(client, user_h):
    body = {"request_type": "home_to_lot", "vehicle_number": "KA02CD5678", "pickup_label": "Home",
           "drop_label": "Mall", "distance_km": 1, **MAP_POINTS}
    r = client.post("/api/valet", headers=user_h, json=body)
    assert r.status_code == 201, r.get_json()
    req = r.get_json()["valet_request"]
    assert close(req["distance_km"], 16.1, tol=0.5)
    assert close(req["pickup_lat"], KORAMANGALA["pickup_lat"])
