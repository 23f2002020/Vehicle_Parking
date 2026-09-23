"""Shared building blocks for the REST resources."""
from functools import wraps

from flask import current_app, request
from flask_restful import Api, Resource
from flask_security import auth_required, current_user
from werkzeug.exceptions import HTTPException

from ..utils import ApiError


class JsonApi(Api):
    """Flask-RESTful Api that ALWAYS answers with JSON (never an HTML debugger/error page)."""

    def handle_error(self, e):
        if isinstance(e, ApiError):
            return self.make_response(e.to_dict(), e.status)
        if isinstance(e, HTTPException):
            return super().handle_error(e)
        current_app.logger.exception("Unhandled error on %s %s", request.method, request.path)
        return self.make_response({"message": "Something went wrong on our side. Please try again.",
                                   "code": "server_error"}, 500)


def require_role(*names):
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not any(r.name in names for r in current_user.roles):
                raise ApiError("You don't have permission to do that.", 403, "forbidden")
            return fn(*args, **kwargs)
        return wrapper
    return deco


# NOTE: Flask-RESTful applies `method_decorators` in list order, so the LAST entry runs first.
class AuthResource(Resource):
    """Any signed-in account."""
    method_decorators = [auth_required("token")]


class UserResource(Resource):
    """Driver accounts only."""
    method_decorators = [require_role("user"), auth_required("token")]


class AdminResource(Resource):
    """Lot-owner (admin) accounts only."""
    method_decorators = [require_role("admin"), auth_required("token")]


class DriverResource(Resource):
    """Driver-partner accounts only (ride captains + valet drivers - see driver_service.py)."""
    method_decorators = [require_role("driver"), auth_required("token")]


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}
