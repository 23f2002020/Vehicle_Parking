@echo off
rem Creates .venv and installs the requirements.
cd /d "%~dp0.."
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% -m venv .venv || goto :err
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || goto :err
echo.
echo Done.  Start the app with:  scripts\run_web.bat
goto :eof
:err
echo Setup failed - is Python 3.9-3.12 installed and on PATH?
exit /b 1
