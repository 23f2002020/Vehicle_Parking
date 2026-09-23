@echo off
rem Celery beat (periodic jobs) - Redis must be running.
cd /d "%~dp0.."
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
celery -A Applications.celery_worker.celery beat -l info --schedule instance\celerybeat-schedule
