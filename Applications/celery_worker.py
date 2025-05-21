from celery import Celery
from flask import Flask
from Applications.config import LocalConfig
from Applications.email import init_mail
from Applications.database import db

def make_celery(app_name=__name__):
    flask_app = Flask(app_name)
    flask_app.config.from_object(LocalConfig)
    db.init_app(flask_app)
    init_mail(flask_app)

    celery = Celery(
        app_name,
        broker='redis://localhost:6379/0',
        backend='redis://localhost:6379/0'
    )
    celery.conf.update(flask_app.config)
    celery.flask_app = flask_app
    return celery

celery = make_celery()
