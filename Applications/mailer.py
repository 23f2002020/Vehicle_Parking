"""E-mail delivery.

* SMTP configured (MAIL_SERVER + MAIL_USERNAME)  -> real e-mail through smtplib.
* Nothing configured (default for local dev)      -> the message is written to instance/outbox/
  as a .txt file and logged, so the whole booking flow can be tested without an SMTP account.

(This module replaces the old Applications/email.py - a file called `email.py` shadows Python's
standard-library `email` package whenever the folder is on sys.path, which breaks smtplib.)
"""
import logging
import os
import smtplib
import uuid
from email.message import EmailMessage

from flask import current_app

from . import utils

log = logging.getLogger("vp.mail")


def _safe(text):
    """Keep log lines ASCII so a Windows cp1252 console never chokes on symbols like the rupee sign."""
    return str(text).encode("ascii", "replace").decode("ascii")


def smtp_configured(app=None):
    app = app or current_app
    return bool(app.config.get("MAIL_SERVER") and app.config.get("MAIL_USERNAME"))


def mail_mode(app=None):
    return "smtp" if smtp_configured(app) else "outbox"


def send_email_now(to_email, subject, body):
    cfg = current_app.config
    sender = cfg.get("MAIL_DEFAULT_SENDER") or "VParkEasy <no-reply@vparkeasy.local>"

    if not smtp_configured():
        return _write_outbox(to_email, subject, body, sender)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(body)
    try:
        if cfg.get("MAIL_USE_SSL"):
            server = smtplib.SMTP_SSL(cfg["MAIL_SERVER"], cfg["MAIL_PORT"], timeout=20)
        else:
            server = smtplib.SMTP(cfg["MAIL_SERVER"], cfg["MAIL_PORT"], timeout=20)
            if cfg.get("MAIL_USE_TLS"):
                server.starttls()
        with server:
            server.login(cfg["MAIL_USERNAME"], cfg["MAIL_PASSWORD"])
            server.send_message(msg)
        log.info("E-mail sent to %s: %s", to_email, _safe(subject))
        return {"delivered": True, "mode": "smtp"}
    except Exception as exc:                      # never let a mail problem break a booking
        log.error("SMTP send failed (%s) - saving to outbox instead", exc)
        return _write_outbox(to_email, subject, body, sender, note=f"SMTP failed: {exc}")


def _write_outbox(to_email, subject, body, sender, note=None):
    folder = current_app.config.get("OUTBOX_DIR")
    os.makedirs(folder, exist_ok=True)
    stamp = utils.now_utc().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(folder, f"{stamp}-{uuid.uuid4().hex[:6]}.txt")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"From: {sender}\nTo: {to_email}\nSubject: {subject}\n")
        if note:
            fh.write(f"X-Note: {note}\n")
        fh.write("\n" + body + "\n")
    log.info("E-mail (outbox mode) to %s: %s -> %s", to_email, _safe(subject), path)
    return {"delivered": False, "mode": "outbox", "path": path}
