"""Entry point for the Celery worker and Celery beat.

    celery -A Applications.celery_worker.celery worker -l info            (Linux / macOS)
    celery -A Applications.celery_worker.celery worker -l info --pool=solo   (Windows)
    celery -A Applications.celery_worker.celery beat   -l info            (periodic jobs)

Redis must be running (docker compose up redis  /  redis-server  /  WSL / Memurai on Windows).
Don't have Redis? Skip this file entirely - the web app falls back to running its background
jobs in-process (see TASK_MODE in Applications/config.py).
"""
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from Applications.factory import create_app

flask_app = create_app(role="worker")
celery = flask_app.extensions["celery"]

# importing the module registers every @shared_task with this Celery app
import Applications.task  # noqa: E402,F401
