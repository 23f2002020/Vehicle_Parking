# sourced by the other scripts: go to the project root and activate .venv if it exists
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -f .venv/bin/activate ]; then . .venv/bin/activate; fi
