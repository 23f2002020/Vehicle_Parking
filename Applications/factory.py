"""Application factory: builds the Flask app, security, database, Celery and background scheduler."""
import logging
import logging.handlers
import os
import shutil
import sys

from flask import Flask
from flask_security import Security, SQLAlchemyUserDatastore
from sqlalchemy import create_engine, event, inspect

from . import task as task_mod
from .celery_app import celery_init_app
from .config import get_config
from .database import db
from .models import Role, User
from .resources import api
from .routes import register_routes
from .seed import seed_core, seed_demo

log = logging.getLogger("vp.app")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _install_error_log_file(app):
    """Every unhandled server error is already logged with a full traceback (see routes.py's
    catch-all @app.errorhandler(Exception)) - but by default that only goes to the console, which
    scrolls out of view and isn't something most people know to copy from. This mirrors WARNING-and-up
    log records (including every such traceback) into instance/error.log as well, so if a "something
    went wrong" error ever shows up in the browser, the exact cause is sitting in a plain text file
    next to the database - no terminal-scrolling required. Rotates at 2MB, keeps 3 backups."""
    if app.testing:
        return
    log_path = os.path.join(app.instance_path, "error.log")
    handler = logging.handlers.RotatingFileHandler(log_path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setLevel(logging.WARNING)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.getLogger().addHandler(handler)


def _backup_legacy_sqlite(app):
    """The original project shipped a SQLite file with an incompatible schema - and separately, this
    project's OWN schema has grown since (e.g. PaymentTransaction later gained ride_id/valet_id columns
    so a ride/valet payment can link back to its job). Either way, db.create_all() only creates tables
    that don't exist yet - it never adds a new column to a table that's already on disk. A database file
    left over from an older copy of this app can therefore be missing columns the current code expects,
    which surfaces as a genuine, reproducible 'sqlite3.OperationalError: no such column: ...' 500 on
    almost every request that touches that table (this has actually happened - a stale instance/*.sqlite3
    carried forward from before the ride/valet payment-linking columns existed).

    Detect this generically instead of hardcoding specific column names: compare every table's ACTUAL
    on-disk columns against what today's SQLAlchemy models expect (db.metadata, populated the moment
    Applications/models.py is imported, independent of db.init_app()). If any expected column is
    missing anywhere, treat the whole file as outdated and move it aside (never delete) so a complete,
    up-to-date database gets created fresh right after this runs. A brand-new install (no existing
    file) or an already-current database is untouched."""
    uri = app.config["SQLALCHEMY_DATABASE_URI"]
    if not uri.startswith("sqlite:///") or ":memory:" in uri:
        return
    rel = uri.replace("sqlite:///", "", 1)
    path = rel if os.path.isabs(rel) else os.path.join(app.instance_path, rel)
    if not os.path.exists(path):
        return
    try:
        eng = create_engine("sqlite:///" + path)
        insp = inspect(eng)
        outdated = False
        reason = ""
        for table in db.metadata.tables.values():
            if not insp.has_table(table.name):
                continue                              # a brand-new table - create_all() will add it fine
            actual_cols = {c["name"] for c in insp.get_columns(table.name)}
            missing = {c.name for c in table.columns} - actual_cols
            if missing:
                outdated = True
                reason = f"{table.name} is missing column(s): {', '.join(sorted(missing))}"
                break
        eng.dispose()
        if outdated:
            backup = path + ".legacy-backup"
            n = 1
            while os.path.exists(backup):
                n += 1
                backup = f"{path}.legacy-backup{n}"
            shutil.move(path, backup)
            log.warning("Database schema is out of date (%s) - moved it to %s and creating a fresh one.",
                        reason, backup)
    except Exception as exc:                                    # pragma: no cover
        log.warning("Could not inspect existing database: %s", exc)


def create_app(config_object=None, role="web"):
    """role: 'web' (serves requests, seeds data, may start the embedded scheduler) or 'worker' (Celery)."""
    app = Flask("vparkeasy", root_path=ROOT, static_folder="static", template_folder="templates")
    app.config.from_object(config_object or get_config())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if (not app.debug and not app.testing and
            app.config["SECRET_KEY"].startswith("dev-only")):
        log.warning("SECRET_KEY is the built-in development value. Set SECRET_KEY in the environment "
                    "before exposing this app to the internet.")

    os.makedirs(app.instance_path, exist_ok=True)
    _install_error_log_file(app)
    _backup_legacy_sqlite(app)

    db.init_app(app)

    # SQLite, by default, lets a writer block every reader (and vice versa) for the whole transaction.
    # Under concurrent use - e.g. a rider's dashboard polling while a driver partner updates a ride in
    # another tab/browser - that can surface as a genuine "database is locked" error. WAL journal mode
    # lets reads proceed while a write is in progress, and busy_timeout makes a writer retry for a bit
    # instead of failing immediately when it does contend with another writer.
    with app.app_context():
        if db.engine.url.drivername.startswith("sqlite"):
            @event.listens_for(db.engine, "connect")
            def _sqlite_pragmas(dbapi_connection, connection_record):     # noqa: ANN001
                cur = dbapi_connection.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA busy_timeout=15000")
                cur.close()

    datastore = SQLAlchemyUserDatastore(db, User, Role)
    security = Security(app, datastore)
    app.security = security                               # (kept: seed code and old imports use app.security)

    @security.unauthn_handler
    def _unauthenticated(mechanisms, headers=None):        # noqa: ANN001
        # Default Flask-Security behaviour is a 302 redirect to an HTML login page, which made every
        # fetch() from the SPA fail with "Unexpected token '<'". Always answer with JSON instead.
        from flask import jsonify
        resp = jsonify({"message": "Please sign in to continue.", "code": "unauthenticated"})
        resp.status_code = 401          # must be a Response (not a tuple) so Flask-RESTful passes it through
        return resp

    @security.unauthz_handler
    def _unauthorized(func_name, params):                  # noqa: ANN001
        from flask import jsonify
        resp = jsonify({"message": "You don't have permission to do that.", "code": "forbidden"})
        resp.status_code = 403
        return resp

    api.init_app(app)
    celery_init_app(app)
    register_routes(app)

    with app.app_context():
        db.create_all()
        if role == "web":
            seed_core()
            if app.config["SEED_DEMO_DATA"]:
                seed_demo()

    if role == "web":
        _maybe_start_scheduler(app)
        if not app.testing:
            _banner(app)
    return app


def _maybe_start_scheduler(app):
    mode = str(app.config.get("EMBEDDED_SCHEDULER", "auto")).lower()
    if mode == "off" or app.testing:
        return
    # with the reloader, only the child process should own background threads
    if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        return
    with app.app_context():
        redis_ok = task_mod.redis_available(force=True)
    if mode == "on" or not redis_ok:
        task_mod.start_embedded_scheduler(app)


def _banner(app):
    if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        return
    with app.app_context():
        redis_ok = task_mod.redis_available(force=True)
    from .mailer import mail_mode
    log.info("---------------------------------------------------------------")
    log.info(" VParkEasy is ready and fully working at the URL below.")
    log.info(" Task mode: %s   Mail: %s", app.config["TASK_MODE"], mail_mode(app))
    if redis_ok:
        log.info(" Redis: connected - background jobs are handled by a separate Celery worker.")
    else:
        # Redis/Celery are an OPTIONAL production-style setup, not a requirement - nothing below is
        # an error. Without them, background jobs (e-mails, reminders) simply run inside this same
        # process instead, which is exactly what a local/demo install is expected to do.
        log.info(" Redis: not running - this is expected and NOT a problem for local/demo use.")
        log.info(" Background jobs (e-mails, reminders) are simply running inside this same process")
        log.info(" instead of a separate worker. Everything in the app works normally either way.")
        log.info(" (Redis + a Celery worker are only needed if you want that separate-worker setup - see README.)")
    if sys.platform.startswith("win"):
        log.info(" Windows note: start the Celery worker with  --pool=solo")
    if app.config["DEMO_MODE"]:
        log.info(" Demo logins ->  driver: user@user.com / password    admin: user@admin.com / password")
    log.info("---------------------------------------------------------------")
