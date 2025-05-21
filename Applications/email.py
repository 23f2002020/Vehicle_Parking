from flask_mail import Mail, Message
from flask import current_app

mail = Mail()

def init_mail(app):
    mail.init_app(app)

def send_email_now(to_email, subject, body):
    with current_app.app_context():
        msg = Message(
            subject=subject,
            recipients=[to_email],
            body=body,
            sender=current_app.config['MAIL_USERNAME']
        )
        mail.send(msg)

    return { "message": "Email sent successfully" }