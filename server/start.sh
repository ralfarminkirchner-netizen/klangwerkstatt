#!/bin/bash
set -a
source /Users/raki/.hermes/.env 2>/dev/null
set +a
PYTHONPATH="" exec /Users/raki/klangwerkstatt/server/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
