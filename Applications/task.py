from Applications.email import send_email_now
from Applications.celery_worker import celery

@celery.task
def send_reservation_email(to_email, subject, body):
    send_email_now(to_email, subject, body)
