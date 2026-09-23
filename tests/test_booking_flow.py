"""End-to-end tests of the booking rules: time handling, payment, 45-minute buffer, extension, overstay fine."""
import glob
import os
import time
from datetime import timedelta

import pytest

from Applications import task as task_mod
from Applications import utils
from Applications.models import ParkingSpot
from conftest import CARD


def iso(dt):
    return utils.to_iso(dt)


def slot_ids(client, headers, lot_id=1):
    r = client.get(f"/api/lots/{lot_id}/slot-map", headers=headers)
    assert r.status_code == 200
    return [s["id"] for f in r.get_json()["floors"] for s in f["slots"]]


def book(client, h, slot_id, start, end, vehicle="KA01AB1234", lot_id=1, addons=None, payment=CARD):
    return client.post("/api/bookings", headers=h, json={
        "lot_id": lot_id, "slot_id": slot_id, "start": iso(start), "end": iso(end), "vehicle_number": vehicle,
        "addons": addons or [], "payment": payment})


# ---------------------------------------------------------------- auth / errors
def test_unauthenticated_api_returns_json_401_not_html_redirect(client):
    r = client.get("/api/bookings")
    assert r.status_code == 401 and r.is_json


def test_roles_are_enforced(client, user_h, admin_h):
    assert client.get("/api/admin/overview", headers=user_h).status_code == 403
    assert client.get("/api/bookings", headers=admin_h).status_code == 403
    assert client.get("/api/admin/overview", headers=admin_h).status_code == 200


def test_register_and_login(client):
    r = client.post("/api/register", json={"username": "newbie", "email": "n@x.com", "password": "secret1"})
    assert r.status_code == 201
    r = client.post("/api/login", json={"email": "n@x.com", "password": "secret1", "login_as": "user"})
    assert r.status_code == 200 and r.get_json()["user"]["auth_token"]
    assert client.post("/api/register", json={"username": "x", "email": "n@x.com", "password": "secret1"}).status_code in (400, 409)


def test_spa_routes_serve_index(client):
    for path in ("/", "/login", "/app/bookings", "/admin/lots"):
        r = client.get(path)
        assert r.status_code == 200 and b"<div id=\"app\"" in r.data
    assert client.get("/api/does-not-exist").status_code == 404


# ---------------------------------------------------------------- time handling
def test_naive_datetime_is_rejected_not_guessed(client, user_h):
    r = client.post("/api/bookings/quote", headers=user_h, json={
        "lot_id": 1, "start": "2030-01-01T10:00:00", "end": "2030-01-01T11:00:00"})
    assert r.status_code == 400 and r.get_json()["code"] == "missing_timezone"


def test_timezone_offsets_are_converted_to_utc(client, user_h):
    now = utils.now_utc() + timedelta(hours=3)
    # same instant expressed in IST (+05:30) must be priced/stored identically to the UTC form
    start_ist = (now + timedelta(hours=5, minutes=30)).replace(microsecond=0).isoformat() + "+05:30"
    end_ist = (now + timedelta(hours=7, minutes=30)).replace(microsecond=0).isoformat() + "+05:30"
    r = client.post("/api/bookings/quote", headers=user_h, json={"lot_id": 1, "start": start_ist, "end": end_ist})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["start"] == iso(now.replace(microsecond=0))


def test_cannot_book_in_the_past(client, user_h):
    now = utils.now_utc()
    r = client.post("/api/bookings/quote", headers=user_h,
                    json={"lot_id": 1, "start": iso(now - timedelta(hours=2)), "end": iso(now - timedelta(hours=1))})
    assert r.status_code == 400 and r.get_json()["code"] == "in_past"


def test_min_and_max_duration(client, user_h):
    now = utils.now_utc() + timedelta(hours=1)
    r = client.post("/api/bookings/quote", headers=user_h, json={"lot_id": 1, "start": iso(now), "end": iso(now + timedelta(minutes=10))})
    assert r.get_json()["code"] == "too_short"
    r = client.post("/api/bookings/quote", headers=user_h, json={"lot_id": 1, "start": iso(now), "end": iso(now + timedelta(hours=100))})
    assert r.get_json()["code"] == "too_long"


# ---------------------------------------------------------------- booking + payment
def test_booking_price_payment_and_email(client, app, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[5]
    r = book(client, user_h, s, now + timedelta(hours=1), now + timedelta(hours=3))
    assert r.status_code == 201, r.get_json()
    b = r.get_json()["booking"]
    assert b["amounts"]["paid_for_booking"] == 80.0            # 2h x Rs40
    assert b["status"] == "upcoming"
    assert b["slot"]["location"].startswith("Level")
    files = glob.glob(os.path.join(app.config["OUTBOX_DIR"], "*.txt"))
    assert files, "confirmation e-mail should have been written to the outbox"
    assert "Parking confirmed" in open(files[0], encoding="utf-8").read()


def test_declined_card_creates_no_booking(client, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[0]
    bad = dict(CARD, card_number="4000 0000 0000 0002")
    before = client.get("/api/bookings", headers=user_h).get_json()["summary"]["total"]
    r = book(client, user_h, s, now + timedelta(hours=1), now + timedelta(hours=2), payment=bad)
    assert r.status_code == 402 and r.get_json()["code"] == "payment_failed"
    assert client.get("/api/bookings", headers=user_h).get_json()["summary"]["total"] == before
    # the slot is still free for the same time
    assert book(client, user_h, s, now + timedelta(hours=1), now + timedelta(hours=2)).status_code == 201


def test_invalid_card_and_missing_payment_rejected(client, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[0]
    assert book(client, user_h, s, now + timedelta(hours=1), now + timedelta(hours=2), payment=None).status_code == 400
    assert book(client, user_h, s, now + timedelta(hours=1), now + timedelta(hours=2),
                payment=dict(CARD, card_number="1234 5678 9012 3456")).status_code == 400


def test_welcome_allowance_and_addons(client):
    r = client.post("/api/register", json={"username": "fresh", "email": "fresh@x.com", "password": "secret1"})
    h = {"Authentication-Token": client.post("/api/login", json={"email": "fresh@x.com", "password": "secret1", "login_as": "user"}).get_json()["user"]["auth_token"]}
    now = utils.now_utc()
    s = slot_ids(client, h)[1]
    q = client.post("/api/bookings/quote", headers=h, json={
        "lot_id": 1, "slot_id": s, "start": iso(now + timedelta(hours=1)), "end": iso(now + timedelta(hours=3)),
        "addons": ["car_wash"]}).get_json()
    assert q["discount"] == 40.0                    # first hour free
    assert q["total"] == 80 + 250 - 40
    r = client.post("/api/bookings/quote", headers=h, json={
        "lot_id": 1, "start": iso(now + timedelta(hours=1)), "end": iso(now + timedelta(hours=3)), "addons": ["fuel"]})
    assert r.status_code == 400 and r.get_json()["code"] == "bad_addon"      # on-site amenities are not bookable


# ---------------------------------------------------------------- the 45 minute buffer
def test_buffer_between_bookings(client, user_h, user2_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[10]
    a_start, a_end = now + timedelta(hours=3), now + timedelta(hours=4)
    assert book(client, user_h, s, a_start, a_end).status_code == 201

    # 30 min after A ends  -> violates the 45 min gap
    r = book(client, user2_h, s, a_end + timedelta(minutes=30), a_end + timedelta(minutes=90), vehicle="KA02CD5678")
    assert r.status_code == 409 and r.get_json()["reason"] == "buffer"
    # exactly 45 min after A ends -> allowed
    r = book(client, user2_h, s, a_end + timedelta(minutes=45), a_end + timedelta(minutes=105), vehicle="KA02CD5678")
    assert r.status_code == 201, r.get_json()
    # a booking that would END 30 min before A starts -> also blocked (gap applies on both sides)
    r = book(client, user2_h, s, a_start - timedelta(minutes=90), a_start - timedelta(minutes=30), vehicle="KA03EF9999")
    assert r.status_code == 409 and r.get_json()["reason"] == "buffer"
    # ending exactly 45 min before -> allowed
    assert book(client, user2_h, s, a_start - timedelta(minutes=105), a_start - timedelta(minutes=45), vehicle="KA03EF9999").status_code == 201
    # overlapping -> 'booked'
    r = book(client, user2_h, s, a_start + timedelta(minutes=10), a_start + timedelta(minutes=50), vehicle="KA04GH1111")
    assert r.status_code == 409 and r.get_json()["reason"] == "booked"


def test_slot_map_shows_available_booked_and_buffer(client, user_h):
    now = utils.now_utc()
    ids = slot_ids(client, user_h)
    s = ids[3]
    a_end = now + timedelta(hours=4)
    assert book(client, user_h, s, now + timedelta(hours=3), a_end).status_code == 201

    def status_for(start, end):
        r = client.get(f"/api/lots/1/slot-map?start={iso(start)}&end={iso(end)}", headers=user_h).get_json()
        return {sl["id"]: sl for f in r["floors"] for sl in f["slots"]}[s]

    assert status_for(now + timedelta(hours=3, minutes=30), now + timedelta(hours=5))["status"] == "booked"
    buf = status_for(a_end + timedelta(minutes=20), a_end + timedelta(minutes=80))
    assert buf["status"] == "buffer" and buf["free_from"]
    assert status_for(a_end + timedelta(minutes=45), a_end + timedelta(minutes=105))["status"] == "available"
    assert status_for(now + timedelta(hours=3, minutes=30), now + timedelta(hours=5))["mine"] is True


def test_same_vehicle_cannot_hold_two_overlapping_bookings(client, user_h):
    now = utils.now_utc()
    ids = slot_ids(client, user_h)
    assert book(client, user_h, ids[0], now + timedelta(hours=2), now + timedelta(hours=4)).status_code == 201
    r = book(client, user_h, ids[1], now + timedelta(hours=3), now + timedelta(hours=5))
    assert r.status_code == 409 and r.get_json()["code"] == "vehicle_busy"


# ---------------------------------------------------------------- extension
def test_extension_charges_extra_and_moves_end(client, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[7]
    b = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]
    q = client.post(f"/api/bookings/{b['id']}/extend-quote", headers=user_h, json={"extra_minutes": 60}).get_json()
    assert q["amount"] == 40.0
    r = client.post(f"/api/bookings/{b['id']}/extend", headers=user_h, json={"extra_minutes": 60, "payment": CARD})
    assert r.status_code == 200, r.get_json()
    nb = r.get_json()["booking"]
    assert nb["end_time"] == iso((now + timedelta(hours=2)).replace(microsecond=0)) or nb["duration_minutes"] == 120
    assert nb["amounts"]["extension"] == 40.0 and nb["amounts"]["paid_for_booking"] == 80.0
    assert nb["extension_count"] == 1


def test_extension_blocked_by_next_booking_plus_buffer(client, user_h, user2_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[8]
    b = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]
    # next booking starts 45 + 30 min after A ends -> only 30 min of extension is possible
    nxt = now + timedelta(hours=1, minutes=75)
    assert book(client, user2_h, s, nxt, nxt + timedelta(hours=1), vehicle="KA09ZZ0001").status_code == 201
    r = client.post(f"/api/bookings/{b['id']}/extend-quote", headers=user_h, json={"extra_minutes": 60})
    assert r.status_code == 409 and r.get_json()["max_extra_minutes"] == 30
    ok = client.post(f"/api/bookings/{b['id']}/extend", headers=user_h, json={"extra_minutes": 30, "payment": CARD})
    assert ok.status_code == 200
    # now nothing more can be added
    again = client.post(f"/api/bookings/{b['id']}/extend-quote", headers=user_h, json={"extra_minutes": 15})
    assert again.status_code == 409 and again.get_json()["max_extra_minutes"] == 0


def test_cannot_extend_after_time_ran_out(client, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[9]
    b = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]
    client.post(f"/api/bookings/{b['id']}/check-in", headers=user_h)
    utils.advance_clock(70)
    r = client.post(f"/api/bookings/{b['id']}/extend-quote", headers=user_h, json={"extra_minutes": 30})
    assert r.status_code == 409 and r.get_json()["code"] == "expired"


# ---------------------------------------------------------------- overstay fine
def test_overstay_fine_lifecycle(client, user_h):
    now = utils.now_utc()
    ids = slot_ids(client, user_h)
    b = book(client, user_h, ids[2], now, now + timedelta(hours=1)).get_json()["booking"]
    bid = b["id"]
    assert client.post(f"/api/bookings/{bid}/check-in", headers=user_h).status_code == 200
    assert client.get(f"/api/bookings/{bid}", headers=user_h).get_json()["status"] == "parked"

    utils.advance_clock(60 + 32)                    # 32 minutes late
    live = client.get(f"/api/bookings/{bid}", headers=user_h).get_json()
    assert live["status"] == "overstay" and live["amounts"]["fine_is_live"]
    # Rs40/h x 1.5 = Rs60/h = Rs15 per 15 min ; 32 min -> 3 started blocks = Rs45
    assert live["amounts"]["fine"] == 45.0

    out = client.post(f"/api/bookings/{bid}/check-out", headers=user_h).get_json()["booking"]
    assert out["status"] == "completed" and out["amounts"]["fine_status"] == "due" and out["amounts"]["fine"] == 45.0

    # unpaid fine blocks any new booking
    later = utils.now_utc() + timedelta(hours=2)
    r = book(client, user_h, ids[4], later, later + timedelta(hours=1), vehicle="KA05XY0002")
    assert r.status_code == 402 and r.get_json()["code"] == "fine_due"

    assert client.post(f"/api/bookings/{bid}/pay-fine", headers=user_h, json={"payment": CARD}).status_code == 200
    assert client.get(f"/api/bookings/{bid}", headers=user_h).get_json()["amounts"]["fine_status"] == "paid"
    assert book(client, user_h, ids[4], later, later + timedelta(hours=1), vehicle="KA05XY0002").status_code == 201


def test_leaving_on_time_has_no_fine(client, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[12]
    bid = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]["id"]
    client.post(f"/api/bookings/{bid}/check-in", headers=user_h)
    utils.advance_clock(50)
    out = client.post(f"/api/bookings/{bid}/check-out", headers=user_h).get_json()["booking"]
    assert out["amounts"]["fine"] == 0 and out["amounts"]["fine_status"] == "none"


def test_overstaying_car_keeps_slot_blocked_for_buffer(client, user_h, user2_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[14]
    bid = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]["id"]
    client.post(f"/api/bookings/{bid}/check-in", headers=user_h)
    utils.advance_clock(75)                          # car is 15 minutes over and still there
    n = utils.now_utc()
    r = book(client, user2_h, s, n + timedelta(minutes=10), n + timedelta(minutes=70), vehicle="KA07QQ7777")
    assert r.status_code == 409                       # slot occupied right now (+45 min buffer)
    r = book(client, user2_h, s, n + timedelta(minutes=50), n + timedelta(minutes=110), vehicle="KA07QQ7777")
    assert r.status_code == 201


def test_early_departure_releases_slot_sooner(client, user_h, user2_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[15]
    bid = book(client, user_h, s, now, now + timedelta(hours=3)).get_json()["booking"]["id"]
    client.post(f"/api/bookings/{bid}/check-in", headers=user_h)
    utils.advance_clock(30)
    client.post(f"/api/bookings/{bid}/check-out", headers=user_h)
    n = utils.now_utc()
    assert book(client, user2_h, s, n + timedelta(minutes=50), n + timedelta(minutes=110), vehicle="KA08RR8888").status_code == 201


def test_checkin_window(client, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[16]
    bid = book(client, user_h, s, now + timedelta(hours=2), now + timedelta(hours=3)).get_json()["booking"]["id"]
    r = client.post(f"/api/bookings/{bid}/check-in", headers=user_h)
    assert r.status_code == 409 and r.get_json()["code"] == "too_early"
    utils.advance_clock(110)                          # 10 minutes before start -> inside the 15-minute window
    assert client.post(f"/api/bookings/{bid}/check-in", headers=user_h).status_code == 200


# ---------------------------------------------------------------- cancellation / refund
def test_cancel_refund_rules(client, user_h):
    now = utils.now_utc()
    ids = slot_ids(client, user_h)
    spent0 = client.get("/api/payments", headers=user_h).get_json()["total_spent"]
    early = book(client, user_h, ids[0], now + timedelta(hours=5), now + timedelta(hours=7), vehicle="KA11AA1111").get_json()["booking"]
    r = client.post(f"/api/bookings/{early['id']}/cancel", headers=user_h)
    assert r.status_code == 200 and r.get_json()["booking"]["amounts"]["refund"] == 80.0      # > 60 min ahead: 100 %
    assert client.get("/api/payments", headers=user_h).get_json()["total_spent"] == spent0

    late = book(client, user_h, ids[1], now + timedelta(minutes=30), now + timedelta(hours=2, minutes=30), vehicle="KA11AA2222").get_json()["booking"]
    r = client.post(f"/api/bookings/{late['id']}/cancel", headers=user_h)
    assert r.get_json()["booking"]["amounts"]["refund"] == 40.0                                 # < 60 min ahead: 50 %
    assert client.get("/api/payments", headers=user_h).get_json()["total_spent"] == spent0 + 40.0


def test_cancelled_slot_becomes_free_again(client, user_h, user2_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[20]
    b = book(client, user_h, s, now + timedelta(hours=5), now + timedelta(hours=6)).get_json()["booking"]
    client.post(f"/api/bookings/{b['id']}/cancel", headers=user_h)
    assert book(client, user2_h, s, now + timedelta(hours=5), now + timedelta(hours=6), vehicle="KA12BB3333").status_code == 201


def test_one_user_cannot_touch_anothers_booking(client, user_h, user2_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[21]
    bid = book(client, user_h, s, now + timedelta(hours=5), now + timedelta(hours=6)).get_json()["booking"]["id"]
    assert client.get(f"/api/bookings/{bid}", headers=user2_h).status_code == 404
    assert client.post(f"/api/bookings/{bid}/cancel", headers=user2_h).status_code == 404


# ---------------------------------------------------------------- subscriptions
def test_subscription_covers_parking(client, user_h):
    plans = client.get("/api/plans", headers=user_h).get_json()["plans"]
    free_roam = next(p for p in plans if p["name"] == "Free Roam")
    r = client.post("/api/subscription", headers=user_h, json={"plan_id": free_roam["id"], "payment": CARD})
    assert r.status_code == 201
    now = utils.now_utc()
    s = slot_ids(client, user_h)[22]
    b = book(client, user_h, s, now + timedelta(hours=2), now + timedelta(hours=4)).get_json()["booking"]
    assert b["amounts"]["discount"] == 80.0 and b["amounts"]["paid_for_booking"] == 0.0
    assert client.get("/api/subscription", headers=user_h).get_json()["subscription"]["remaining_parkings"] == 1
    client.post(f"/api/bookings/{b['id']}/cancel", headers=user_h)               # free-cancel restores the credit
    assert client.get("/api/subscription", headers=user_h).get_json()["subscription"]["remaining_parkings"] == 2


def test_admin_plan_only_for_admins(client, user_h, admin_h):
    admin_plan = next(p for p in client.get("/api/plans", headers=admin_h).get_json()["plans"])
    r = client.post("/api/subscription", headers=user_h, json={"plan_id": admin_plan["id"], "payment": CARD})
    assert r.status_code == 403


# ---------------------------------------------------------------- admin
NEW_LOT = {"name": "Test Lot", "address": "1 Test St", "city": "Pune", "pin_code": "411001", "rows": 2, "columns": 3,
           "floors": 1, "price_per_hour": 25, "amenities": [{"code": "ev_charging", "price": 60, "location": "Row A"}]}


def test_admin_creates_lot_slots_and_plan_limit(client, admin_h, user_h):
    r = client.post("/api/admin/lots", headers=admin_h, json=NEW_LOT)
    assert r.status_code == 201, r.get_json()
    lot = r.get_json()["lot"]
    assert lot["number_of_spots"] == 6 and lot["buffer_minutes"] == 45
    board = client.get(f"/api/admin/lots/{lot['id']}/slots", headers=admin_h).get_json()
    slots = board["floors"][0]["slots"]
    assert len(slots) == 6 and sum(1 for s in slots if s["type"] == "ev") == 2       # last column = EV bays
    # visible to drivers immediately
    assert any(l["id"] == lot["id"] for l in client.get("/api/lots", headers=user_h).get_json()["lots"])
    # demo owner is on Admin Basic (5 lots): 3 seeded + this one = 4, one more fits, the next is refused
    assert client.post("/api/admin/lots", headers=admin_h, json=dict(NEW_LOT, name="Fifth")).status_code == 201
    r = client.post("/api/admin/lots", headers=admin_h, json=dict(NEW_LOT, name="Sixth"))
    assert r.status_code == 403 and r.get_json()["code"] == "lot_limit"


def test_admin_validation(client, admin_h):
    assert client.post("/api/admin/lots", headers=admin_h, json={"name": "x"}).status_code == 400
    assert client.post("/api/admin/lots", headers=admin_h, json=dict(NEW_LOT, rows=99)).status_code == 400
    assert client.post("/api/admin/lots", headers=admin_h, json=dict(NEW_LOT, rows=26, columns=30, floors=2)).get_json()["code"] == "too_many_slots"


def test_resize_and_delete_are_blocked_while_bookings_exist(client, admin_h, user_h):
    lot = client.post("/api/admin/lots", headers=admin_h, json=NEW_LOT).get_json()["lot"]
    smap = client.get(f"/api/lots/{lot['id']}/slot-map", headers=user_h).get_json()
    last = max(smap["floors"][0]["slots"], key=lambda s: (s["row"], s["col"]))
    now = utils.now_utc()
    b = book(client, user_h, last["id"], now + timedelta(hours=2), now + timedelta(hours=3), lot_id=lot["id"]).get_json()["booking"]
    r = client.put(f"/api/admin/lots/{lot['id']}", headers=admin_h, json={"rows": 1})
    assert r.status_code == 409 and r.get_json()["code"] == "resize_blocked"
    assert client.delete(f"/api/admin/lots/{lot['id']}", headers=admin_h).status_code == 409
    client.post(f"/api/bookings/{b['id']}/cancel", headers=user_h)
    r = client.put(f"/api/admin/lots/{lot['id']}", headers=admin_h, json={"rows": 1})
    assert r.status_code == 200 and r.get_json()["lot"]["number_of_spots"] == 3
    assert client.delete(f"/api/admin/lots/{lot['id']}", headers=admin_h).status_code == 200
    assert all(l["id"] != lot["id"] for l in client.get("/api/lots", headers=user_h).get_json()["lots"])


def test_closed_slot_cannot_be_booked(client, admin_h, user_h):
    ids = slot_ids(client, user_h)
    assert client.patch(f"/api/admin/slots/{ids[0]}", headers=admin_h, json={"is_active": False}).status_code == 200
    now = utils.now_utc()
    r = book(client, user_h, ids[0], now + timedelta(hours=1), now + timedelta(hours=2))
    assert r.status_code == 409 and r.get_json()["reason"] == "blocked"


def test_admin_operations_console(client, admin_h, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[30]
    bid = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]["id"]
    # admin checks the vehicle in and later force-checks it out after an overstay, then collects the fine
    assert client.post(f"/api/admin/bookings/{bid}/check-in", headers=admin_h).status_code == 200
    ov = client.get("/api/admin/overview", headers=admin_h).get_json()
    assert ov["kpis"]["parked_now"] == 1 and ov["kpis"]["overstay_now"] == 0
    utils.advance_clock(80)
    ov = client.get("/api/admin/overview", headers=admin_h).get_json()
    assert ov["kpis"]["overstay_now"] == 1 and ov["overstays"][0]["amounts"]["fine"] == 30.0
    out = client.post(f"/api/admin/bookings/{bid}/check-out", headers=admin_h).get_json()["booking"]
    assert out["amounts"]["fine_status"] == "due"
    lst = client.get("/api/admin/bookings?status=fine_due", headers=admin_h).get_json()
    assert any(b["id"] == bid for b in lst["bookings"])
    assert client.post(f"/api/admin/bookings/{bid}/collect-fine", headers=admin_h).get_json()["booking"]["amounts"]["fine_status"] == "paid"
    assert client.get("/api/admin/transactions", headers=admin_h).status_code == 200


def test_admin_can_waive_fine(client, admin_h, user_h):
    now = utils.now_utc()
    s = slot_ids(client, user_h)[31]
    bid = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]["id"]
    client.post(f"/api/bookings/{bid}/check-in", headers=user_h)
    utils.advance_clock(75)
    client.post(f"/api/bookings/{bid}/check-out", headers=user_h)
    assert client.post(f"/api/admin/bookings/{bid}/waive-fine", headers=admin_h).get_json()["booking"]["amounts"]["fine_status"] == "waived"


def test_only_platform_admin_manages_users(client, admin_h):
    users = client.get("/api/admin/users", headers=admin_h).get_json()
    assert users["can_manage"] and users["users"]
    uid = users["users"][0]["id"]
    assert client.patch(f"/api/admin/users/{uid}", headers=admin_h, json={"active": False, "ban_reason": "test"}).status_code == 200
    r = client.post("/api/login", json={"email": users["users"][0]["email"], "password": "password", "login_as": "user"})
    assert r.status_code == 403 and r.get_json()["code"] == "suspended"


# ---------------------------------------------------------------- background jobs / Redis
def test_dispatch_never_blocks_or_fails_when_redis_is_down(app, client, user_h):
    """The original code hung ~19 s and then raised when Redis was down. Now it must fall back instantly."""
    app.config["TASK_MODE"] = "auto"
    app.config["REDIS_URL"] = "redis://127.0.0.1:6399/0"               # nothing listens here
    task_mod._redis_cache.update(ok=None, at=0.0)
    now = utils.now_utc()
    s = slot_ids(client, user_h)[40]
    t0 = time.time()
    r = book(client, user_h, s, now + timedelta(hours=1), now + timedelta(hours=2))
    elapsed = time.time() - t0
    assert r.status_code == 201, r.get_json()
    assert elapsed < 3, f"booking took {elapsed:.1f}s - Redis fallback is not immediate"
    for _ in range(40):                                                 # thread fallback still delivers the e-mail
        if glob.glob(os.path.join(app.config["OUTBOX_DIR"], "*.txt")):
            break
        time.sleep(0.1)
    assert glob.glob(os.path.join(app.config["OUTBOX_DIR"], "*.txt"))


def test_scan_job_sends_reminders_once(app, client, user_h):
    from Applications.booking_service import scan_bookings
    now = utils.now_utc()
    s = slot_ids(client, user_h)[41]
    bid = book(client, user_h, s, now, now + timedelta(hours=1)).get_json()["booking"]["id"]
    client.post(f"/api/bookings/{bid}/check-in", headers=user_h)
    utils.advance_clock(50)                                             # 10 min before the end
    with app.app_context():
        first = scan_bookings()
        second = scan_bookings()
    assert first["end_reminders"] == 1 and second["end_reminders"] == 0
    utils.advance_clock(30)                                             # now overstaying
    with app.app_context():
        assert scan_bookings()["overstay_alerts"] == 1
    subjects = "".join(open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(app.config["OUTBOX_DIR"], "*.txt")))
    assert "ends soon" in subjects and "overstayed" in subjects
