"""Registration, login, profile, health and the demo clock."""
import re

from flask import current_app
from flask_restful import Resource
from flask_security import current_user, hash_password, verify_and_update_password

from .. import task as task_mod
from .. import utils
from ..database import db
from ..mailer import mail_mode
from ..models import User
from ..serializers import user_dict
from .base import AuthResource, json_body

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _me_payload(user):
    d = user_dict(user)
    d["server_time"] = utils.to_iso(utils.now_utc())
    d["clock_offset_minutes"] = utils.get_clock_offset_minutes()
    d["demo_mode"] = bool(current_app.config["DEMO_MODE"])
    return d


class RegisterResource(Resource):
    def post(self):
        data = json_body()
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        role = (data.get("role") or "user").lower()
        if len(username) < 3:
            raise utils.ApiError("Username must be at least 3 characters.", 400, "bad_username")
        if not _EMAIL_RE.match(email):
            raise utils.ApiError("Enter a valid email address.", 400, "bad_email")
        if len(password) < 6:
            raise utils.ApiError("Password must be at least 6 characters.", 400, "weak_password")
        if role not in ("user", "admin"):
            raise utils.ApiError("Unknown account type.", 400, "bad_role")
        if role == "admin" and not current_app.config["ALLOW_ADMIN_SIGNUP"]:
            raise utils.ApiError("Lot-owner sign-up is disabled on this server.", 403, "admin_signup_disabled")
        if User.query.filter_by(email=email).first():
            raise utils.ApiError("An account with this email already exists.", 409, "email_taken")
        if User.query.filter(db.func.lower(User.username) == username.lower()).first():
            raise utils.ApiError("That username is taken.", 409, "username_taken")

        # datastore.create_user fills fs_uniquifier (the old code skipped it -> IntegrityError / HTTP 500)
        user = current_app.security.datastore.create_user(
            email=email, username=username, password=hash_password(password), active=True, roles=[role],
            free_minutes_allowed=current_app.config["WELCOME_FREE_MINUTES"] if role == "user" else 0)
        db.session.commit()
        return {"message": "User created successfully", "user": user_dict(user)}, 201


class LoginResource(Resource):
    def post(self):
        data = json_body()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        login_as = (data.get("login_as") or "user").lower()
        if not email or not password:
            raise utils.ApiError("Email and password are required.", 400, "missing_fields")
        user = User.query.filter(db.func.lower(User.email) == email).first()
        # same message for unknown e-mail and wrong password (don't reveal which accounts exist)
        if not user or not verify_and_update_password(password, user):
            raise utils.ApiError("Incorrect email or password.", 401, "bad_credentials")
        if not user.active:
            raise utils.ApiError("This account is suspended." + (f" Reason: {user.ban_reason}" if user.ban_reason else ""),
                                 403, "suspended")
        roles = [r.name for r in user.roles]
        if login_as not in roles:
            names = {"admin": "a lot owner (admin)", "user": "a user", "driver": "a driver partner"}
            raise utils.ApiError(f"This account is not registered as {names.get(login_as, login_as)}. "
                                 f"Try signing in as {names.get(roles[0], roles[0]) if roles else 'a different role'}.",
                                 403, "wrong_role")
        db.session.commit()   # verify_and_update_password may upgrade the stored hash
        payload = user_dict(user)
        payload["roles"] = [login_as]
        payload["auth_token"] = user.get_auth_token()
        payload["server_time"] = utils.to_iso(utils.now_utc())
        payload["demo_mode"] = bool(current_app.config["DEMO_MODE"])
        return {"message": "Login successful", "user": payload}, 200


class LogoutResource(AuthResource):
    def post(self):
        return {"message": "Logged out successfully"}, 200

    get = post


class MeResource(AuthResource):
    def get(self):
        return _me_payload(current_user)


class ProfileResource(AuthResource):
    def get(self):
        return _me_payload(current_user)

    def put(self):
        data = json_body()
        user = current_user
        if "username" in data:
            name = (data["username"] or "").strip()
            if len(name) < 3:
                raise utils.ApiError("Username must be at least 3 characters.", 400)
            if User.query.filter(db.func.lower(User.username) == name.lower(), User.id != user.id).first():
                raise utils.ApiError("That username is taken.", 409)
            user.username = name
        if "email" in data:
            email = (data["email"] or "").strip().lower()
            if not _EMAIL_RE.match(email):
                raise utils.ApiError("Enter a valid email address.", 400)
            if User.query.filter(User.email == email, User.id != user.id).first():
                raise utils.ApiError("That email is already in use.", 409)
            user.email = email
        if "phone" in data:
            phone = (data["phone"] or "").strip()
            if phone and not re.match(r"^[+\d][\d\s\-]{6,18}$", phone):
                raise utils.ApiError("Enter a valid phone number.", 400)
            user.phone = phone or None
        if "address" in data:
            user.address = (data["address"] or "").strip()[:255] or None
        if data.get("new_password"):
            if not verify_and_update_password(data.get("current_password") or "", user):
                raise utils.ApiError("Your current password is incorrect.", 403, "bad_password")
            if len(data["new_password"]) < 6:
                raise utils.ApiError("New password must be at least 6 characters.", 400, "weak_password")
            user.password = hash_password(data["new_password"])
        db.session.commit()
        return {"message": "Profile updated successfully", "user": _me_payload(user)}


# ---------------------------------------------------------------- health / time / demo clock
class HealthResource(Resource):
    def get(self):
        redis_ok = task_mod.redis_available(force=True)
        workers = task_mod.celery_worker_count() if redis_ok else 0
        try:
            db.session.execute(db.text("SELECT 1"))
            db_ok = True
        except Exception:
            db_ok = False
        mode = current_app.config["TASK_MODE"]
        if mode == "inline" or not redis_ok or workers == 0:
            jobs = "in-process thread (no Celery worker attached)"
        else:
            jobs = f"celery ({workers} worker{'s' if workers != 1 else ''})"
        return {"status": "ok" if db_ok else "degraded", "database": db_ok, "redis": redis_ok,
                "celery_workers": workers, "task_mode": mode, "background_jobs": jobs, "mail_mode": mail_mode(),
                "demo_mode": bool(current_app.config["DEMO_MODE"]), "server_time": utils.to_iso(utils.now_utc()),
                "clock_offset_minutes": utils.get_clock_offset_minutes()}


class TimeResource(Resource):
    """Lets the browser correct for a wrong device clock (a classic cause of 'wrong booking time')."""

    def get(self):
        return {"server_time": utils.to_iso(utils.now_utc()),
                "clock_offset_minutes": utils.get_clock_offset_minutes(),
                "demo_mode": bool(current_app.config["DEMO_MODE"]),
                "timezone": current_app.config["APP_TIMEZONE"]}


class DemoClockResource(AuthResource):
    def post(self):
        if not current_app.config["DEMO_MODE"]:
            raise utils.ApiError("Demo tools are disabled on this server.", 403, "demo_disabled")
        data = json_body()
        if data.get("reset"):
            utils.reset_clock()
        else:
            minutes = utils.as_int(data.get("minutes"), "minutes", minimum=-1440, maximum=60 * 24 * 7)
            utils.advance_clock(minutes)
        return {"server_time": utils.to_iso(utils.now_utc()), "clock_offset_minutes": utils.get_clock_offset_minutes()}
