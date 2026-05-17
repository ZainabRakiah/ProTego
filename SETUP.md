# ProTego Setup

## Virtual environment (recommended)

Use a dedicated ProTego venv so dependencies don’t conflict with other projects.

### Create ProTego venv

```bash
# From project root
./setup_venv.sh
```

Or manually:

```bash
python3 -m venv ProTego_venv
source ProTego_venv/bin/activate   # On Windows: ProTego_venv\Scripts\activate
pip install -r requirements.txt
```

### Run the app

```bash
source ProTego_venv/bin/activate
python backend/app.py
```

**Avoid**: Running `pip install -r requirements.txtpython3 backend/app.py` as one command. Pip treats `backend/app.py` as a package and fails. Use two commands:

```bash
pip install -r requirements.txt
python backend/app.py
```

## Feedback loop (ML retraining)

- **On new report**: Model retrains 2 seconds after a user submits a report.
- **On SOS**: Model retrains after each SOS alert.
- **Periodic**: Model retrains every 6 hours in the background.

Retraining uses:
- ProTego.csv (grid-based safety scores)
- User reports
- SOS alerts

The model learns from both static data and live incidents.
