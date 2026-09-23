"""Celery <-> Flask glue (the pattern recommended by the Flask docs).

The old project built a *second, half-configured* Flask app inside celery_worker.py, never pushed an
application context in tasks, never configured mail and never told Celery which tasks exist.
Here the worker imports the real Flask app, and every task automatically runs inside its app context.
"""
from celery import Celery, Task
from flask import Flask


def celery_init_app(app: Flask) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery = Celery(app.name, task_cls=FlaskTask)
    celery.config_from_object(app.config["CELERY"])
    celery.set_default()
    app.extensions["celery"] = celery
    return celery
