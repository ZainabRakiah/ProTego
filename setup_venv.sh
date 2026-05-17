#!/bin/bash
# ProTego venv setup
# Run: ./setup_venv.sh  (or: bash setup_venv.sh)

set -e
cd "$(dirname "$0")"

VENV_DIR="ProTego_venv"

echo "Creating ProTego virtual environment: $VENV_DIR"
python3 -m venv "$VENV_DIR"

echo "Activating and installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install -r requirements.txt

echo ""
echo "✅ ProTego venv ready."
echo ""
echo "To use it:"
echo "  source ProTego_venv/bin/activate"
echo "  python backend/app.py"
echo ""
echo "To deactivate: type 'deactivate'"
echo ""
