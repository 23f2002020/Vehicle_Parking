#!/usr/bin/env bash
# Celery beat (periodic jobs: reminders every 5 min, housekeeping hourly) - Redis must be running.
. "$(dirname "$0")/_env.sh"
exec celery -A Applications.celery_worker.celery beat -l info --schedule instance/celerybeat-schedule
