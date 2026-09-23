"""Central configuration.

Everything can be overridden with environment variables (or a .env file, see .env.example),
so nothing needs to be edited in code to move from your laptop to a server.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _bool(name, default=False):
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float(name, default):
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


class Config:
    # ------------------------------------------------------------------ core
    DEBUG = False
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-secret-change-me-before-deploying-0123456789")
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///vehicle_Parking.sqlite3")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"connect_args": {"timeout": 15}} if "sqlite" in os.environ.get(
        "DATABASE_URL", "sqlite") else {}
    JSON_SORT_KEYS = False
    # Flask-RESTful re-raises unhandled errors in debug mode -> the SPA would receive an HTML
    # debugger page instead of JSON. We always want JSON errors from /api.
    PROPAGATE_EXCEPTIONS = False
    SEND_FILE_MAX_AGE_DEFAULT = 0

    # -------------------------------------------------------- Flask-Security
    # All built-in Flask-Security pages/endpoints live under /_security so they can never
    # collide with the single page app routes (/login, /register ...).
    SECURITY_URL_PREFIX = "/_security"
    SECURITY_PASSWORD_HASH = "pbkdf2_sha512"      # pure python - no compiled bcrypt needed on Windows
    SECURITY_PASSWORD_SALT = os.environ.get("SECURITY_PASSWORD_SALT", "dev-only-password-salt-change-me")
    SECURITY_TOKEN_AUTHENTICATION_HEADER = "Authentication-Token"
    SECURITY_TOKEN_MAX_AGE = 60 * 60 * 24 * 7      # tokens live for 7 days
    SECURITY_TRACKABLE = False
    SECURITY_REGISTERABLE = False                  # we ship our own JSON /api/register
    SECURITY_SEND_REGISTER_EMAIL = False
    SECURITY_CSRF_IGNORE_UNAUTH_ENDPOINTS = True
    SECURITY_CSRF_PROTECT_MECHANISMS = ["session"]  # token-auth API calls do not need CSRF
    WTF_CSRF_ENABLED = False
    ALLOW_ADMIN_SIGNUP = _bool("ALLOW_ADMIN_SIGNUP", True)   # lot owners can self-register as admin
    # the one admin who may edit driver plans and suspend accounts (platform operator)
    PLATFORM_ADMIN_EMAIL = os.environ.get("PLATFORM_ADMIN_EMAIL", "user@admin.com")

    # ---------------------------------------------------- Redis / Celery
    REDIS_URL = REDIS_URL
    # auto   : use Celery when Redis answers, otherwise run the job in a background thread
    # celery : always use Celery (fails loudly if Redis is down)
    # inline : never touch Redis, always run in a background thread (great for Windows dev)
    TASK_MODE = os.environ.get("TASK_MODE", "auto")
    EMBEDDED_SCHEDULER = os.environ.get("EMBEDDED_SCHEDULER", "auto")   # auto | on | off
    CELERY = dict(
        broker_url=REDIS_URL,
        result_backend=REDIS_URL,
        task_ignore_result=True,
        broker_connection_retry_on_startup=True,
        broker_connection_timeout=2,
        broker_transport_options={"socket_connect_timeout": 2, "socket_timeout": 5},
        redis_socket_connect_timeout=2,
        redis_socket_timeout=5,
        timezone="UTC",
        enable_utc=True,
        task_time_limit=120,
        worker_prefetch_multiplier=1,
        beat_schedule={
            "vp-scan-bookings": {"task": "vp.scan_bookings", "schedule": 300.0},      # every 5 min
            "vp-housekeeping": {"task": "vp.housekeeping", "schedule": 3600.0},       # hourly
        },
    )

    # ------------------------------------------------------------- e-mail
    # Leave MAIL_SERVER empty and every e-mail is written to instance/outbox/ instead of
    # being sent - so the app works out of the box with no SMTP account.
    MAIL_SERVER = os.environ.get("MAIL_SERVER", "")
    MAIL_PORT = _int("MAIL_PORT", 587)
    MAIL_USE_TLS = _bool("MAIL_USE_TLS", True)
    MAIL_USE_SSL = _bool("MAIL_USE_SSL", False)
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
    MAIL_DEFAULT_SENDER = os.environ.get("MAIL_DEFAULT_SENDER", "VParkEasy <no-reply@vparkeasy.local>")
    OUTBOX_DIR = str(BASE_DIR / "instance" / "outbox")

    # ----------------------------------------------------- business rules
    APP_NAME = "VParkEasy"
    APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "Asia/Kolkata")   # used for e-mails & daily reports only
    CURRENCY = "INR"
    CURRENCY_SYMBOL = "₹"
    BUFFER_MINUTES_DEFAULT = _int("BUFFER_MINUTES_DEFAULT", 45)     # turnaround gap between two bookings on a slot
    MIN_BOOKING_MINUTES = 30
    MAX_BOOKING_HOURS = 72
    MAX_ADVANCE_DAYS = 30
    BILLING_BLOCK_MINUTES = 15                                      # time is billed in started blocks of 15 min
    FINE_MULTIPLIER = _float("FINE_MULTIPLIER", 1.5)                # overstay costs 1.5x the hourly rate
    FINE_GRACE_MINUTES = _int("FINE_GRACE_MINUTES", 0)
    FINE_CAP_HOURS = 24
    CHECKIN_EARLY_MINUTES = 15
    FREE_CANCEL_MINUTES_BEFORE = 60
    LATE_CANCEL_REFUND_PERCENT = 50
    SUBSCRIPTION_FREE_MINUTES_PER_PARKING = 240
    WELCOME_FREE_MINUTES = _int("WELCOME_FREE_MINUTES", 60)        # one-time free parking for new drivers (0 = off)
    FREE_ADMIN_LOTS = 2
    REMINDER_BEFORE_END_MINUTES = 15
    REMINDER_BEFORE_START_MINUTES = 30
    MAX_SLOTS_PER_LOT = 500
    SEED_DEMO_DATA = _bool("SEED_DEMO_DATA", True)

    # ------------------------------------------------- driver domain (rides + valet)
    # Everything below is still a *dummy* simulation, same spirit as the payment gateway above -
    # EXCEPT for the map tiles themselves (see FIXES.md): the rider picks real pickup/drop pins on a
    # real OpenStreetMap map and the app measures the real straight-line distance between them, but
    # there is still no real routing/turn-by-turn service, no real GPS tracking of the driver's live
    # position, and no real KYC/document verification. "Time" is the real wall-clock elapsed between
    # ride events once a ride is under way; ROAD_DISTANCE_FACTOR/RIDE_AVG_SPEED_KMPH below only exist
    # to turn that straight-line map distance into a slightly more realistic *upfront* fare estimate
    # and are themselves dummy approximations, not a real routing calculation.
    RIDE_BASE_FARE = _float("RIDE_BASE_FARE", 40.0)
    RIDE_PER_KM_RATE = _float("RIDE_PER_KM_RATE", 12.0)
    RIDE_PER_MIN_RATE = _float("RIDE_PER_MIN_RATE", 2.0)
    RIDE_FREE_WAIT_MINUTES = _int("RIDE_FREE_WAIT_MINUTES", 3)          # free wait after driver arrives
    RIDE_WAIT_RATE_PER_MIN = _float("RIDE_WAIT_RATE_PER_MIN", 3.0)
    RIDE_CANCEL_FEE = _float("RIDE_CANCEL_FEE", 30.0)                   # only if cancelled after driver arrived
    RIDE_MAX_DISTANCE_KM = 200
    PEAK_SURGE_HOURS = {8, 9, 10, 18, 19, 20}                           # local-time hours, dummy surge
    PEAK_SURGE_MULTIPLIER = _float("PEAK_SURGE_MULTIPLIER", 1.2)
    VALET_BASE_FEE = _float("VALET_BASE_FEE", 80.0)
    VALET_PER_KM_RATE = _float("VALET_PER_KM_RATE", 15.0)
    VALET_CANCEL_FEE = _float("VALET_CANCEL_FEE", 40.0)                 # only if cancelled after pickup
    PLATFORM_COMMISSION_PERCENT = _float("PLATFORM_COMMISSION_PERCENT", 20.0)   # driver keeps the rest
    DRIVER_MAX_PHOTO_CHARS = 900_000          # ~650KB decoded - keeps dummy base64 "uploads" sane in SQLite
    # Upfront fare-estimate helpers only (see /api/rides/quote, /api/valet/quote):
    RIDE_AVG_SPEED_KMPH = _float("RIDE_AVG_SPEED_KMPH", 25.0)           # assumed city-traffic average speed
    ROAD_DISTANCE_FACTOR = _float("ROAD_DISTANCE_FACTOR", 1.3)          # roads aren't a straight line - dummy padding
    RIDE_ESTIMATE_LOW_FACTOR = _float("RIDE_ESTIMATE_LOW_FACTOR", 0.9)
    RIDE_ESTIMATE_HIGH_FACTOR = _float("RIDE_ESTIMATE_HIGH_FACTOR", 1.15)

    # Demo helpers: lets you move the app clock forward to see overstay fines / buffer behaviour
    # without waiting hours. MUST be off in production.
    DEMO_MODE = _bool("DEMO_MODE", True)


class DevelopmentConfig(Config):
    DEBUG = _bool("FLASK_DEBUG", True)


class ProductionConfig(Config):
    DEBUG = False
    DEMO_MODE = _bool("DEMO_MODE", False)
    SEED_DEMO_DATA = _bool("SEED_DEMO_DATA", False)


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {"connect_args": {"check_same_thread": False},
                                 "poolclass": __import__("sqlalchemy.pool", fromlist=["StaticPool"]).StaticPool}
    TASK_MODE = "sync"
    EMBEDDED_SCHEDULER = "off"
    SEED_DEMO_DATA = False
    DEMO_MODE = True
    OUTBOX_DIR = str(BASE_DIR / "instance" / "test_outbox")


# Kept for backwards compatibility with the old `from Applications.config import LocalConfig`
LocalConfig = DevelopmentConfig


def get_config():
    env = os.environ.get("APP_ENV", "development").lower()
    return {"production": ProductionConfig, "testing": TestingConfig}.get(env, DevelopmentConfig)
