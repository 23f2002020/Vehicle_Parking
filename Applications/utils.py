"""Small helpers shared by the whole backend.

TIME RULES (this is what fixes the wrong-date/time bugs):
  * Every datetime stored in the database is a *naive UTC* datetime.
  * The API always speaks ISO-8601 with an explicit offset, e.g. 2026-09-21T09:30:00Z.
  * The browser converts the user's local wall-clock choice to UTC before sending, and converts
    back to local time when displaying. The server never guesses a timezone.
"""
import math
import re
import secrets
import string
from datetime import datetime, timedelta, timezone

import pytz

# --------------------------------------------------------------------------- clock
# A movable clock: lets the demo/testing tools jump forward in time. Always call
# utils.now_utc() (never datetime.utcnow()) so the offset applies everywhere.
_clock_offset = timedelta(0)


def now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None) + _clock_offset


def get_clock_offset_minutes():
    return int(_clock_offset.total_seconds() // 60)


def advance_clock(minutes):
    global _clock_offset
    _clock_offset += timedelta(minutes=minutes)
    return get_clock_offset_minutes()


def reset_clock():
    global _clock_offset
    _clock_offset = timedelta(0)


# --------------------------------------------------------------------------- errors
class ApiError(Exception):
    """Raise anywhere inside a request; the API layer turns it into a JSON response."""

    def __init__(self, message, status=400, code=None, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.extra = extra

    def to_dict(self):
        d = {"message": self.message}
        if self.code:
            d["code"] = self.code
        d.update(self.extra)
        return d


# --------------------------------------------------------------------------- datetimes
def to_iso(dt):
    """naive-UTC datetime -> '2026-09-21T09:30:00Z' (or None)."""
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"


def parse_iso(value, field="datetime"):
    """ISO-8601 string with a timezone -> naive UTC datetime. Refuses ambiguous input."""
    if not value or not isinstance(value, str):
        raise ApiError(f"'{field}' is required (ISO-8601, e.g. 2026-09-21T09:30:00Z).", 400, "bad_datetime")
    s = value.strip()
    if s.endswith(("Z", "z")):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise ApiError(f"'{field}' is not a valid ISO-8601 date-time.", 400, "bad_datetime")
    if dt.tzinfo is None:
        raise ApiError(
            f"'{field}' must include a timezone offset (e.g. 'Z' or '+05:30') so the time is unambiguous.",
            400, "missing_timezone")
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def local_tz(name):
    try:
        return pytz.timezone(name)
    except Exception:
        return pytz.UTC


def fmt_local(dt, tz_name="Asia/Kolkata", fmt="%a %d %b %Y, %I:%M %p"):
    """naive-UTC datetime -> human string in the app timezone, e.g. 'Mon 21 Sep 2026, 03:00 PM IST'."""
    if dt is None:
        return ""
    aware = pytz.UTC.localize(dt).astimezone(local_tz(tz_name))
    return aware.strftime(fmt) + " " + (aware.tzname() or "")


def local_date(dt, tz_name="Asia/Kolkata"):
    return pytz.UTC.localize(dt).astimezone(local_tz(tz_name)).date()


def local_hour(dt, tz_name="Asia/Kolkata"):
    return pytz.UTC.localize(dt).astimezone(local_tz(tz_name)).hour


# --------------------------------------------------------------------------- misc
def money(x):
    return round(float(x or 0) + 1e-9, 2)


def gen_code(prefix="VP", n=6):
    alphabet = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"
    return f"{prefix}-" + "".join(secrets.choice(alphabet) for _ in range(n))


_VEHICLE_RE = re.compile(r"^[A-Z0-9]{4,12}$")


def normalize_vehicle(value):
    v = re.sub(r"[\s\-]", "", (value or "").upper())
    if not _VEHICLE_RE.match(v):
        raise ApiError("Enter a valid vehicle number (4-12 letters/digits, e.g. KA01AB1234).", 400, "bad_vehicle")
    return v


def row_letter(i):
    return string.ascii_uppercase[i]


def as_int(value, field, minimum=None, maximum=None, default=None):
    if value is None or value == "":
        if default is not None:
            return default
        raise ApiError(f"'{field}' is required.", 400)
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ApiError(f"'{field}' must be a whole number.", 400)
    if minimum is not None and n < minimum:
        raise ApiError(f"'{field}' must be at least {minimum}.", 400)
    if maximum is not None and n > maximum:
        raise ApiError(f"'{field}' must be at most {maximum}.", 400)
    return n


def as_float(value, field, minimum=None, maximum=None):
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"'{field}' must be a number.", 400)
    if minimum is not None and n < minimum:
        raise ApiError(f"'{field}' must be at least {minimum}.", 400)
    if maximum is not None and n > maximum:
        raise ApiError(f"'{field}' must be at most {maximum}.", 400)
    return n


_EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1, lng1, lat2, lng2):
    """Real straight-line ("as the crow flies") distance between two lat/lng points, in km. Used to
    turn the rider's two real OpenStreetMap pins into a real distance - still not a routed road
    distance (see ROAD_DISTANCE_FACTOR in config.py), but a genuine measurement, not a guess."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return _EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
