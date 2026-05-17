# Safety Route Navigation System — Architecture

## Overview

Grid-based safety scoring system with ML (Random Forest) + rule-based fallback, optimized for personal safety rather than shortest distance.

---

## 1. Grid-Based Spatial System

- **Grid size**: ~100m (0.001° lat/lng step)
- **Per grid**: `(lat, lng)` center, Haversine features, safety score
- **Heatmap**: `/api/safety-grid` returns points with scores for map overlay

---

## 2. Feature Extraction (Haversine 500m)

For each point, we compute within 500m:

| Feature          | Source (ProTego.csv `type`)     |
|------------------|----------------------------------|
| police_count     | `police`, `police_station`       |
| lamp_count       | `street_lamp`, `lamp`            |
| camera_count     | `camera`, `cctv`, `surveillance` |
| incident_count   | rows with `crime_reports` > 0    |

---

## 3. Safety Score Rules (All Combinations)

- police + lamp + camera → ~80%
- police + lamp + incident (no camera) → ~70%
- police + camera → ~75%
- police + lamp → ~72%
- lamp + camera → ~65%
- only police → 60%, only camera → 58%, only lamp → 55%
- no infra + no incident → ~45%
- no infra + incident → ~30%
- Incidents reduce score (≈ −4 per incident, capped)
- **Time-aware**: lamps add ~7% only at night (18:00–06:00)

---

## 4. ML Model (Random Forest)

**Training** (automatic on backend startup):

1. Load `safety_route/data1/ProTego.csv` or `data/ProTego.csv`
2. For each row with `safety_score`, compute:
   - `police_count`, `lamp_count`, `camera_count`, `incident_count` (500m)
   - `is_night` (0/1)
3. Fit `RandomForestRegressor` (80 trees) on these features
4. Blend rule-based score with ML prediction: `0.5 * rule + 0.5 * ml`

**Inference**: Same 5 features per (lat, lng, hour) → predict score 0–100

---

## 5. How to Train the Model

**Automatic**:

- Model trains when you start the backend: `python3 backend/app.py`
- Requires: `scikit-learn`, `ProTego.csv` in `safety_route/data1/` or `data/`
- Console: `[safety-ml] Trained RandomForest safety model on N samples.`

**Manual** (optional):

```bash
pip install scikit-learn pandas
python3 backend/app.py   # trains on startup
```

**Retrain**: Restart the Flask server; training runs again at startup.

---

## 6. Heatmap Visualization

- **Colors**: red (unsafe) &lt; yellow &lt; blue &lt; green (safe)
- **API**: `GET /api/safety-grid?minLat=...&maxLat=...&minLng=...&maxLng=...`
- **Frontend**: `safe_route.js` → `loadSafetyHeat()` draws circle markers

---

## 7. Safest Route Algorithm

1. Call OSRM for route alternatives
2. Sample points along each route; score each with `_rule_based_safety_score` (ML-blended)
3. Pick route with best `avg_safety - 2.5 * distance_km`
4. Fallback: straight-line if OSRM fails

---

## 8. Live Tracking & Navigation

- User marker: `navigator.geolocation.watchPosition`
- Route coloring: can extend to gray (traveled) vs colored (remaining)
- Instructions: OSRM `steps` → “Turn right in 100m” etc.

---

## 9. Learning from User Behavior (Feedback Loop)

- **Reports**: `POST /api/reports` → retrain ~2s after submission
- `POST /api/feedback` (to add) for “how safe did you feel?”
- **SOS alerts** → retrain after each SOS; **periodic** → every 6h; crime density feature

---

## 10. Code Structure

```
backend/
  app.py          # Flask app, safety helpers, _train_safety_model, APIs
  db.py           # SQLite
data/
  ProTego.csv     # optional dataset
safety_route/data1/
  ProTego.csv     # primary dataset (police, lamps, cameras, incidents)
frontend/
  html/safe_route.html
  js/safe_route.js
```
