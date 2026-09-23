@echo off
rem Celery worker - Redis must be running (WSL / Memurai / docker).  --pool=solo is required on Windows.
cd /d "%~dp0.."
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
celery -A Applications.celery_worker.celery worker -l info --pool=solo
