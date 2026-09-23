"""Page routing + global error handling.

The front end is a single-page app using Vue Router in *history* mode (clean URLs like /admin/lots).
That means the server must return index.html for every non-API, non-static path, otherwise pressing
refresh on /app/bookings gives a 404 - one of the "routing errors" in the original project.
"""
import os

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .utils import ApiError

routes_bp = Blueprint("routes_bp", __name__)


def _index():
    resp = send_from_directory(os.path.join(current_app.root_path, "templates"), "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@routes_bp.route("/", defaults={"path": ""})
@routes_bp.route("/<path:path>")
def spa(path):
    if path == "api" or path.startswith("api/"):
        return jsonify({"message": "Endpoint not found.", "code": "not_found"}), 404
    return _index()


def register_routes(app):
    app.register_blueprint(routes_bp)

    @app.errorhandler(ApiError)
    def _api_error(e):
        return jsonify(e.to_dict()), e.status

    @app.errorhandler(HTTPException)
    def _http_error(e):
        if request.path.startswith("/api"):
            return jsonify({"message": e.description or e.name, "code": e.name.lower().replace(" ", "_")}), e.code
        return e

    @app.errorhandler(Exception)
    def _unhandled(e):
        if request.path.startswith("/api"):
            try:
                from flask_security import current_user
                who = current_user.email if current_user and current_user.is_authenticated else "anonymous"
            except Exception:                                   # never let logging itself break the response
                who = "unknown"
            body = request.get_data(as_text=True)
            current_app.logger.exception("Unhandled error on %s %s (user=%s, body=%s)",
                                         request.method, request.path, who, body[:2000])
            return jsonify({"message": "Something went wrong on our side. Please try again.",
                            "code": "server_error"}), 500
        raise e

    @app.after_request
    def _no_cache_api(resp):
        if request.path.startswith("/api"):
            resp.headers["Cache-Control"] = "no-store"
        return resp
