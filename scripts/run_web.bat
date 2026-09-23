@echo off
rem Starts the web app on http://127.0.0.1:5000  (works without Redis)
cd /d "%~dp0.."
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
python app.py
