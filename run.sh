#!/bin/bash
# ProTego: Train safety model + start server (backend + frontend) + open browser

cd "$(dirname "$0")"

echo "🔬 Training safety model..."
if [ -d "safety_route/venv" ]; then
  safety_route/venv/bin/python -m pip install -q xgboost 2>/dev/null
  safety_route/venv/bin/python safety_route/backend/train_safety_model.py
else
  python safety_route/backend/train_safety_model.py 2>/dev/null || echo "⚠️ Skipping safety_route train"
fi

echo ""
echo "🚀 Starting SafeWalk (backend + frontend at http://127.0.0.1:5001/)..."
echo "✨ Browser will open in a few seconds..."
(sleep 3 && open "http://127.0.0.1:5001/") &

if [ -d "ProTego_venv" ]; then
  ProTego_venv/bin/python backend/app.py
else
  python backend/app.py
fi
