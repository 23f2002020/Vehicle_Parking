"""Background jobs (Celery) + a safe way to launch them.

WHY dispatch() EXISTS
---------------------
The old code called `send_reservation_email.delay(...)` straight from the request. With Redis down (very
common on Windows) that call blocked for ~20 seconds and then raised OperationalError - *after* the
booking had already been saved - so the user saw a 500 error for a booking that actually succeeded.

dispatch() never lets the background system break a request:
  1. TASK_MODE=inline  -> run in a background thread (no Redis needed at all)
  2. otherwise ping Redis (cached); if reachable -> hand the job to Celery
  3. if Redis is down or publishing fails -> log a warning and run in a background thread instead
"""
import logging
import threading
import time

from celery import shared_task
from flask import current_app

log = logging.getLogger("vp.tasks")

_redis_cache = {"ok": None, "at": 0.0}


def redis_available(force=False):
    """Cheap, cached reachability check for the broker."""
    now = time.time()
    if not force and _redis_cache["ok"] is not None:
        ttl = 15 if _redis_cache["ok"] else 5
        if now - _redis_cache["at"] < ttl:
            return _redis_cache["ok"]
    ok = False
    try:
        import redis
        client = redis.Redis.from_url(current_app.config["REDIS_URL"], socket_connect_timeout=0.6,
                                      socket_timeout=0.6)
        ok = bool(client.ping())
    except Exception:
        ok = False
    _redis_cache.update(ok=ok, at=now)
    return ok


def celery_worker_count(timeout=0.8):
    """How many Celery workers answer a ping (0 if Redis is down / no worker running)."""
    if not redis_available():
        return 0
    try:
        replies = current_app.extensions["celery"].control.ping(timeout=timeout) or []
        return len(replies)
    except Exception:
        return 0


def _run_in_thread(app, fn, args, kwargs):
    def runner():
        with app.app_context():
            try:
                fn(*args, **kwargs)
            except Exception:
                log.exception("Background job %s failed", getattr(fn, "__name__", fn))
    threading.Thread(target=runner, daemon=True, name="vp-inline-job").start()


def dispatch(task, *args, **kwargs):
    """Fire-and-forget. Returns 'celery' or 'thread' (which path was used)."""
    app = current_app._get_current_object()
    mode = app.config.get("TASK_MODE", "auto")
    if mode == "sync":                     # run right now, in this thread (used by the test-suite)
        task.run(*args, **kwargs)
        return "sync"
    if mode not in ("inline", "sync") and (mode == "celery" or redis_available()):
        try:
            task.apply_async(args=args, kwargs=kwargs, retry=False)
            return "celery"
        except Exception as exc:
            _redis_cache.update(ok=False, at=time.time())
            log.warning("Celery unavailable (%s) - running %s in a background thread", exc, task.name)
    _run_in_thread(app, task.run, args, kwargs)
    return "thread"


# ============================================================================ tasks
@shared_task(name="vp.send_email", ignore_result=True)
def send_email_task(to_email, subject, body):
    from .mailer import send_email_now
    return send_email_now(to_email, subject, body)


@shared_task(name="vp.notify_booking", ignore_result=True)
def notify_booking_task(reservation_id, kind, extra=None):
    from .notifications import send_booking_email
    return send_booking_email(reservation_id, kind, extra)


@shared_task(name="vp.scan_bookings", ignore_result=True)
def scan_bookings_task():
    """Every 5 minutes: reminders before start/end + overstay alerts."""
    from .booking_service import scan_bookings
    result = scan_bookings()
    log.info("scan_bookings: %s", result)
    return result


@shared_task(name="vp.housekeeping", ignore_result=True)
def housekeeping_task():
    """Hourly: close no-shows and expire finished subscriptions."""
    from .booking_service import housekeeping
    result = housekeeping()
    log.info("housekeeping: %s", result)
    return result


# Old name kept so any leftover import keeps working.
send_reservation_email = send_email_task


# ============================================================================ embedded scheduler
_scheduler_started = False


def start_embedded_scheduler(app, interval=300):
    """Tiny in-process replacement for Celery beat when Redis isn't available."""
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        n = 0
        while True:
            time.sleep(interval)
            n += 1
            with app.app_context():
                try:
                    scan_bookings_task.run()
                    if n % 12 == 0:
                        housekeeping_task.run()
                except Exception:
                    log.exception("embedded scheduler tick failed")

    threading.Thread(target=loop, daemon=True, name="vp-embedded-scheduler").start()
    log.info("Embedded scheduler started (every %ss)", interval)
