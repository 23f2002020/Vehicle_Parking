#!/usr/bin/env bash
# Starts the web app on http://127.0.0.1:5000  (works without Redis)
. "$(dirname "$0")/_env.sh"
exec python app.py
