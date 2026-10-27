#!/usr/bin/env bash
# Starts TenderPilot on this computer (macOS / Linux). Double-click or: ./start.sh
set -euo pipefail
cd "$(dirname "$0")/engine"

if ! command -v python3 >/dev/null; then
  echo "Python غير مثبّت. ثبّت Python 3.10 أو أحدث من https://www.python.org/downloads/ ثم أعد المحاولة."
  exit 1
fi
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
echo "تجهيز المتطلبات (أول مرة فقط تأخذ دقيقة)…"
pip install -q --disable-pip-version-check -e .

[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ضع مفتاح Claude API في الملف: $(pwd)/.env  (السطر ANTHROPIC_API_KEY=) ثم شغّل مرة أخرى."
  exit 1
fi

echo "TenderPilot يعمل الآن: افتح http://localhost:8000 — لإيقافه اضغط Ctrl+C"
( sleep 2; command -v open >/dev/null && open http://localhost:8000 || true ) &
exec uvicorn tenderpilot.api:app --host 127.0.0.1 --port 8000
