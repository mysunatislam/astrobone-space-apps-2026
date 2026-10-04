#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
RUNTIME="${ASTROBONE_DENSEPOSE_RUNTIME:-$HOME/.local/share/astrobone-densepose}"
exec "$RUNTIME/venv/bin/python" -m uvicorn vision.densepose_app:app --host 127.0.0.1 --port 8012
