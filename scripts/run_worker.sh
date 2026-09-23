#!/usr/bin/env bash
# Celery worker - Redis must be running (redis-server).
. "$(dirname "$0")/_env.sh"
exec celery -A Applications.celery_worker.celery worker -l info
