#!/usr/bin/env bash
. "$(dirname "$0")/_env.sh"
exec python -m pytest tests -q "$@"
