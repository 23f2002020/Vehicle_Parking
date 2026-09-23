#!/usr/bin/env bash
# Creates .venv and installs the requirements.
set -e
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
"$PY" -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
echo
echo "Done.  Start the app with:  bash scripts/run_web.sh"
