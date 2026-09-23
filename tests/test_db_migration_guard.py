"""Regression test for a real bug found in the field: a SQLite file left over from an older copy
of this app can be missing a column the current models expect (db.create_all() only creates missing
TABLES, it never adds a missing COLUMN to a table that already exists on disk). That surfaced as a
genuine 500 ("no such column: payment_transaction.ride_id") on almost every page that touches
payments - My bookings, Payments, and paying for a booking - even though the code itself had no bug.

Applications/factory.py's _backup_legacy_sqlite() now detects this generically (comparing every
table's on-disk columns against what today's models expect) and moves the stale file aside so a
complete, working database gets created fresh. This test simulates exactly that carried-forward
file and confirms the app heals itself and the previously-broken endpoints work afterward.
"""
import os
import sqlite3

from sqlalchemy import inspect as sa_inspect

from Applications import utils
from Applications.config import TestingConfig
from Applications.database import db
from Applications.factory import create_app
from Applications.seed import seed_demo


class _FileDBConfig(TestingConfig):
    """Same fast/no-scheduler/no-mail settings as TestingConfig, but backed by a real file on disk
    instead of :memory: - the legacy/outdated-schema detector only runs for a file-based database."""
    SQLALCHEMY_DATABASE_URI = None   # set per-test to a tmp_path-based sqlite file
    SQLALCHEMY_ENGINE_OPTIONS = {"connect_args": {"timeout": 15}}


def _make_config(db_path):
    class Cfg(_FileDBConfig):
        SQLALCHEMY_DATABASE_URI = f"sqlite:///{db_path}"
    return Cfg


def test_carried_forward_db_missing_new_columns_is_healed_automatically(tmp_path):
    utils.reset_clock()
    db_path = tmp_path / "legacy.sqlite3"
    cfg = _make_config(db_path)

    # 1) A completely fresh install: builds a fully up-to-date database.
    app1 = create_app(cfg)
    with app1.app_context():
        db.session.remove()
        db.engine.dispose()
    assert db_path.exists()

    # 2) Simulate a database carried forward from BEFORE payment_transaction gained its ride_id/
    #    valet_id columns (exactly what shipped with an earlier version of this app) by dropping
    #    them from the otherwise-current file, mirroring the real report byte-for-byte.
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    cur.execute("PRAGMA table_info(payment_transaction)")
    cols_before = {r[1] for r in cur.fetchall()}
    assert {"ride_id", "valet_id"} <= cols_before, "test setup assumption broke - check the model"
    keep = cols_before - {"ride_id", "valet_id"}
    cur.execute(f"CREATE TABLE payment_transaction_old AS SELECT {', '.join(sorted(keep))} FROM payment_transaction")
    cur.execute("DROP TABLE payment_transaction")
    cur.execute("ALTER TABLE payment_transaction_old RENAME TO payment_transaction")
    con.commit()
    con.close()

    backup_path = str(db_path) + ".legacy-backup"
    assert not os.path.exists(backup_path)

    # 3) Booting the app again against this now-outdated file must detect the drift, move the old
    #    file aside (never delete it), and end up with a fresh, fully-current database.
    app2 = create_app(cfg)
    try:
        assert os.path.exists(backup_path), "outdated database was not backed up - guard regressed"

        with app2.app_context():
            insp = sa_inspect(db.engine)
            cols_after = {c["name"] for c in insp.get_columns("payment_transaction")}
            assert {"ride_id", "valet_id"} <= cols_after

            # the backed-up copy must still have the OLD, incomplete schema (proves we moved the
            # actual stale file rather than quietly rewriting it)
            old_con = sqlite3.connect(backup_path)
            old_cols = {r[1] for r in old_con.execute("PRAGMA table_info(payment_transaction)")}
            old_con.close()
            assert "ride_id" not in old_cols

            seed_demo()

        # 4) The exact endpoints from the field report must now work end-to-end.
        client = app2.test_client()
        login = client.post("/api/login", json={"email": "user@user.com", "password": "password",
                                                 "login_as": "user"})
        assert login.status_code == 200
        headers = {"Authentication-Token": login.get_json()["user"]["auth_token"]}

        r = client.get("/api/bookings", headers=headers)
        assert r.status_code == 200, r.get_json()

        r = client.get("/api/payments", headers=headers)
        assert r.status_code == 200, r.get_json()
    finally:
        with app2.app_context():
            db.session.remove()
            db.engine.dispose()
        utils.reset_clock()


def test_fresh_or_already_current_database_is_left_alone(tmp_path):
    """The guard must never touch a database that is already fully up to date - only a real
    schema mismatch should trigger a backup+rebuild."""
    utils.reset_clock()
    db_path = tmp_path / "current.sqlite3"
    cfg = _make_config(db_path)

    app1 = create_app(cfg)
    with app1.app_context():
        db.session.remove()
        db.engine.dispose()
    assert db_path.exists()

    # Booting again against the SAME, already-current file must not back anything up, and the
    # app must still work normally afterward.
    app2 = create_app(cfg)
    try:
        assert not os.path.exists(str(db_path) + ".legacy-backup")
        with app2.app_context():
            seed_demo()
        client = app2.test_client()
        login = client.post("/api/login", json={"email": "user@user.com", "password": "password",
                                                 "login_as": "user"})
        assert login.status_code == 200
    finally:
        with app2.app_context():
            db.session.remove()
            db.engine.dispose()
        utils.reset_clock()
