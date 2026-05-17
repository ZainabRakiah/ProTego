# Safety Route Navigation System — Complete Architecture

A **real-world deployable** safety-first navigation system similar to Google Maps but optimized for **personal safety** instead of shortest distance.

---

## 1. Grid-Based Spatial System

- **Grid size**: ~100 m (0.0009°–0.001° lat/lng step)
- Each grid cell computes a **safety score**
- Grid centers used for heatmap and route scoring
- API: `GET /api/safety-grid?minLat=&maxLat=&minLng=&maxLng=`

---

## 2. Feature Extraction (Haversine 500 m)

For each grid/location, detect within **500 meters**:

| Feature         | Source                                      |
|-----------------|---------------------------------------------|
| Police stations | ProTego.csv `type=police` + DB              |
| Street lamps    | ProTego.csv `type=street_lamp,lamp`         |
| Surveillance    | ProTego.csv `type=camera,cctv,surveillance` |
| Crime incidents | ProTego `crime_reports` + `reports` + `sos_alerts` |

Haversine distance used for accurate spherical computation.

---

## 3. Safety Score Rules (All Combinations)

| Combination                    | Approx. Safety |
|-------------------------------|----------------|
| police + lamp + camera        | ~80%           |
| police + lamp + incident      | ~70%           |
| police + camera               | ~75%           |
| police + lamp                 | ~72%           |
| lamp + camera                 | ~65%           |
| only police                   | 60%            |
| only camera                   | 58%            |
| only lamp                     | 55%            |
| no infra, no incident         | ~45%           |
| no infra + incident           | ~30%           |

- Incidents reduce score (−4 per incident, capped)
- All combinations explicitly handled

---

## 4. Time-Aware Features

- **Street lamps** influence safety **only at night/evening** (18:00–06:00)
- During daytime, lamp count does not affect score
- `hour` parameter passed to scoring and ML inference

---

## 5. Machine Learning Model

- **Model**: Random Forest (or Gradient Boosting)
- **Features**: police, lamp, camera, incident counts; `is_night`; `crime_density`
- **Training**: ProTego.csv + synthetic samples from user reports/SOS
- **Output**: Predicted safety score per grid
- **Inference**: Blended with rule-based score (0.5 rule + 0.5 ML)

---

## 6. Heatmap Visualization

- **Colors**:
  - Red = unsafe (&lt; 25%)
  - Yellow = moderately unsafe (25–50%)
  - Blue = safe (50–75%)
  - Green = extremely safe (75–100%)
- Live safety score shown in the search bar
- Circle markers on map from `/api/safety-grid`

---

## 7. Safest Route Algorithm

- OSRM route alternatives requested
- Each route sampled; safety score computed per point
- **Edge weight** = distance + safety (prefer higher safety, penalize long detours)
- Select route with best `avg_safety − 2.5 × distance_km`
- API: `POST /api/safest-route`

---

## 8. Live User Tracking

- `navigator.geolocation.watchPosition` for continuous GPS
- User marker moves as the user moves
- **Traveled route segments** → gray
- **Remaining route** → colored by safety level

---

## 9. Navigation Instructions

- OSRM `steps` → “Turn right in 100 m”, “Slight left”, etc.
- Similar to Google Maps turn-by-turn

---

## 10. Learning from User Behavior

- **Reports** (`POST /api/reports`) → trigger retrain after ~2 s
- **SOS** (`POST /api/emergency/sos-safety`) → trigger retrain
- **Periodic retrain** every 6 hours in background
- ML learns from new incidents and updates predictions

---

## Code Structure

```
backend/
  app.py              # Flask, safety scoring, ML, APIs
  db.py               # SQLite (users, reports, sos_alerts, evidence)
frontend/
  html/
    safe_route.html   # Safety Route page (expanded search, live score)
    map.html          # Home map
  js/
    safe_route.js     # Route planning, heatmap, live tracking, safety score
    map.js            # Home map, geolocation
  css/
    style.css         # Safe route panel, safety badge styles
data/
  ProTego.csv         # Grid data (optional)
safety_route/data1/
  ProTego.csv         # Primary dataset
```
