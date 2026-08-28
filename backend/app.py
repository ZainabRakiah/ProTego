from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import os
import sys
import webbrowser
import threading
import time
import math
import csv
import sqlite3
import secrets
import json
import datetime
from functools import lru_cache
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from flask import Flask

# Windows consoles default to cp1252, which cannot encode the emoji used in the
# startup banner. Force UTF-8 so `python backend/app.py` does not crash there.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

app = Flask(__name__)

@app.route("/")
def home():
    return "ProTego deployed successfully!"

from db import get_db, init_db

# Get the project root directory (parent of backend)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=None)

# In production the browser loads the app from Vercel and calls this API on a
# different host, so CORS has to name that origin explicitly. Set
# ALLOWED_ORIGINS to a comma-separated list; the default "*" keeps local
# development working but should not be what a deployed instance runs with.
_ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
CORS(app, origins=_ALLOWED_ORIGINS, supports_credentials=False)

# Initialize database
init_db()

# ============================
# SAFETY MODEL (ML + RULE-BASED)
# ============================
_SAFETY_MODEL = None  # RandomForestRegressor trained on grid-based features
_LAST_TRAIN_TIME = 0
_RETRAIN_INTERVAL_SEC = 6 * 3600  # 6 hours periodic retrain
_GRID_STEP = 0.0009  # ~100m


# ============================
# SAFETY + ROUTING HELPERS
# ============================

def _haversine_m(lat1, lon1, lat2, lon2):
    # Earth radius in meters
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


@lru_cache(maxsize=1)
def _load_protego_points():
    """
    Load ProTego safety dataset once.

    Uses safety_route/data1/ProTego.csv if present, otherwise data/ProTego.csv.
    Returns dict with lists of (lat, lon).
    """
    candidates = [
        os.path.join(BASE_DIR, "safety_route", "data1", "ProTego.csv"),
        os.path.join(BASE_DIR, "data", "ProTego.csv"),
    ]
    path = None
    for p in candidates:
        if os.path.exists(p):
            path = p
            break
    if not path:
        return {"police": [], "lamp": [], "camera": [], "incident": []}

    police = []
    lamps = []
    cameras = []
    incidents = []

    with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lat = float(row.get("lat") or "")
                lon = float(row.get("lon") or row.get("lng") or "")
            except Exception:
                continue

            t = (row.get("type") or "").strip().lower()
            if t in ("police", "police_station"):
                police.append((lat, lon))
            elif t in ("street_lamp", "lamp", "streetlamp"):
                lamps.append((lat, lon))
            elif t in ("camera", "cctv", "surveillance_camera", "surveillance"):
                cameras.append((lat, lon))

            # Incidents: treat rows with crime_reports>0 as an incident signal at that point
            try:
                crime_reports = float(row.get("crime_reports") or 0)
            except Exception:
                crime_reports = 0
            if crime_reports and crime_reports > 0:
                incidents.append((lat, lon))

    return {"police": police, "lamp": lamps, "camera": cameras, "incident": incidents}


def _get_db_incident_points():
    """
    Load incident points from DB: reports + SOS alerts.
    These feed into safety scoring and ML training (feedback loop).
    """
    points = []
    try:
        conn = get_db()
        cur = conn.cursor()
        for table, lat_col, lng_col in [("reports", "lat", "lng"), ("sos_alerts", "lat", "lng")]:
            cur.execute(f"SELECT {lat_col}, {lng_col} FROM {table} WHERE {lat_col} IS NOT NULL AND {lng_col} IS NOT NULL")
            for row in cur.fetchall():
                try:
                    lat, lng = float(row[0]), float(row[1])
                    if -90 <= lat <= 90 and -180 <= lng <= 180:
                        points.append((lat, lng))
                except (TypeError, ValueError):
                    pass
        conn.close()
    except Exception as e:
        print(f"[safety-ml] Could not load DB incidents: {e}")
    return points


# Combining incidents hits SQLite, and /api/safety-grid scores 250 points per
# request — without this cache that is 250 fresh connections and 500 table scans
# for a single overlay toggle. Invalidated explicitly whenever a report or SOS
# lands, so new incidents still show up immediately.
_INCIDENT_CACHE = {"points": None, "stamp": 0.0}
_INCIDENT_CACHE_TTL_SEC = 30.0


def _invalidate_incident_cache():
    _INCIDENT_CACHE["points"] = None


def _all_incident_points():
    """Combine ProTego incidents with user reports/SOS from DB."""
    now = time.time()
    cached = _INCIDENT_CACHE["points"]
    if cached is not None and (now - _INCIDENT_CACHE["stamp"]) < _INCIDENT_CACHE_TTL_SEC:
        return cached

    pts = _load_protego_points()
    combined = pts["incident"] + _get_db_incident_points()
    _INCIDENT_CACHE["points"] = combined
    _INCIDENT_CACHE["stamp"] = now
    return combined


@lru_cache(maxsize=1)
def _load_hospitals():
    candidates = [
        os.path.join(BASE_DIR, "data", "bangalore_hospitals.csv"),
        os.path.join(BASE_DIR, "safety_route", "data1", "bangalore_hospitals.csv"),
    ]
    path = None
    for p in candidates:
        if os.path.exists(p):
            path = p
            break
    if not path:
        return []

    hospitals = []
    with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lat = row.get("latitude") or row.get("lat")
            lon = row.get("longitude") or row.get("lon") or row.get("lng")
            try:
                if lat is None or lon is None:
                    continue
                lat = float(lat)
                lon = float(lon)
            except Exception:
                continue

            name = row.get("Hospital_name") or row.get("name") or "Hospital"
            address = row.get("full_address_for_geocoding") or row.get("Address") or row.get("address") or ""
            phone = row.get("Phone_number") or row.get("phone") or ""
            hospitals.append({"name": name, "address": address, "phone": phone, "lat": lat, "lng": lon})

    return hospitals


# ============================
# SPATIAL INDEX (for bulk scoring)
# ============================
# Counting neighbours by scanning all ~12k dataset points is fine for one
# lookup, but the offline pack scores hundreds of thousands of cells. Bucketing
# the points by coarse cell turns each query into a scan of the 3x3 buckets
# around it instead of the whole dataset.
_BUCKET_DEG = 0.006  # ~660m, comfortably larger than the 500m feature radius


def _bucket_key(lat, lng):
    return (int(math.floor(lat / _BUCKET_DEG)), int(math.floor(lng / _BUCKET_DEG)))


@lru_cache(maxsize=1)
def _spatial_index():
    pts = _load_protego_points()
    index = {}
    for kind in ("police", "lamp", "camera"):
        buckets = {}
        for (lat, lng) in pts[kind]:
            buckets.setdefault(_bucket_key(lat, lng), []).append((lat, lng))
        index[kind] = buckets
    return index


def _bucketed_incidents():
    """Incidents include user reports, so this is rebuilt when they change."""
    buckets = {}
    for (lat, lng) in _all_incident_points():
        buckets.setdefault(_bucket_key(lat, lng), []).append((lat, lng))
    return buckets


def _count_bucketed(buckets, lat, lng, radius_m=500.0):
    """Count points within radius_m using the bucket index."""
    b_lat, b_lng = _bucket_key(lat, lng)
    count = 0
    for d_lat in (-1, 0, 1):
        for d_lng in (-1, 0, 1):
            for (plat, plng) in buckets.get((b_lat + d_lat, b_lng + d_lng), ()):
                if _haversine_m(lat, lng, plat, plng) <= radius_m:
                    count += 1
    return count


def _count_within(points, lat, lng, radius_m=500.0, nearest_all=False):
    """Count points within radius_m, and report the nearest one.

    By default `nearest_m` only considers points that pass the bounding-box
    pre-filter, so it is really "nearest within the radius" and comes back None
    when the radius is empty. Pass nearest_all=True to measure every point and
    get the true nearest at any distance — only worth it for small datasets
    (police is ~60 points; lamps and cameras are in the thousands).
    """
    # quick bounding box pre-filter
    lat_delta = radius_m / 111000.0
    lng_delta = radius_m / (111000.0 * max(0.1, math.cos(math.radians(lat))))
    min_lat, max_lat = lat - lat_delta, lat + lat_delta
    min_lng, max_lng = lng - lng_delta, lng + lng_delta

    count = 0
    nearest_m = None
    for (plat, plng) in points:
        outside_box = plat < min_lat or plat > max_lat or plng < min_lng or plng > max_lng
        if outside_box and not nearest_all:
            continue
        d = _haversine_m(lat, lng, plat, plng)
        if d <= radius_m:
            count += 1
        if nearest_m is None or d < nearest_m:
            nearest_m = d
    return count, nearest_m
    

def _train_safety_model():
    """
    Train a RandomForestRegressor on grid-based features.
    Data: ProTego.csv (labeled) + synthetic samples from user reports/SOS (feedback loop).
    Features: police, lamp, camera, incident counts (500m), is_night, crime_density.
    Learns patterns from both static dataset and live user incident reports.
    """
    global _SAFETY_MODEL, _LAST_TRAIN_TIME
    try:
        from sklearn.ensemble import RandomForestRegressor
    except Exception:
        print("[safety-ml] scikit-learn not installed; using rule-based safety only.")
        _SAFETY_MODEL = None
        return

    pts = _load_protego_points()
    db_incidents = _get_db_incident_points()

    def incident_count_at(lat, lon):
        return _count_within(pts["incident"] + db_incidents, lat, lon, 500.0)[0]

    X = []
    y = []

    # 1) ProTego.csv labeled data
    candidates = [
        os.path.join(BASE_DIR, "safety_route", "data1", "ProTego.csv"),
        os.path.join(BASE_DIR, "data", "ProTego.csv"),
    ]
    path = None
    for p in candidates:
        if os.path.exists(p):
            path = p
            break

    if path:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        lat = float(row.get("lat") or "")
                        lon = float(row.get("lon") or row.get("lng") or "")
                    except Exception:
                        continue
                    raw_score = row.get("safety_score")
                    if raw_score is None or raw_score == "":
                        continue
                    try:
                        s_val = float(raw_score)
                    except Exception:
                        continue
                    if 0.0 <= s_val <= 1.0:
                        s_val *= 100.0

                    police_count, _ = _count_within(pts["police"], lat, lon, 500.0)
                    lamp_count, _ = _count_within(pts["lamp"], lat, lon, 500.0)
                    camera_count, _ = _count_within(pts["camera"], lat, lon, 500.0)
                    inc_count = incident_count_at(lat, lon)
                    crime_density = inc_count / max(1, police_count + lamp_count + camera_count) if (police_count + lamp_count + camera_count) > 0 else inc_count

                    feat = [police_count, lamp_count, camera_count, inc_count, 0, crime_density]
                    X.append(feat)
                    y.append(s_val)
        except Exception as e:
            print(f"[safety-ml] Failed to load ProTego.csv: {e}")

    # 2) Synthetic samples from user reports & SOS (feedback loop - learn from real incidents)
    for (lat, lon) in db_incidents:
        police_count, _ = _count_within(pts["police"], lat, lon, 500.0)
        lamp_count, _ = _count_within(pts["lamp"], lat, lon, 500.0)
        camera_count, _ = _count_within(pts["camera"], lat, lon, 500.0)
        inc_count = incident_count_at(lat, lon)
        crime_density = inc_count / max(1, police_count + lamp_count + camera_count) if (police_count + lamp_count + camera_count) > 0 else inc_count

        # Reports/SOS = low safety (25–40); infra helps slightly
        base = 28.0
        if police_count > 0:
            base += 5.0
        if camera_count > 0:
            base += 3.0
        if lamp_count > 0:
            base += 2.0
        s_val = min(45.0, base + min(inc_count, 3) * -2.0)

        feat = [police_count, lamp_count, camera_count, inc_count, 0, crime_density]
        X.append(feat)
        y.append(max(10.0, s_val))

    if len(X) < 50:
        if path:
            print(f"[safety-ml] Not enough samples ({len(X)}); using rule-based only.")
        else:
            print("[safety-ml] ProTego.csv not found and no DB incidents; using rule-based only.")
        _SAFETY_MODEL = None
        return

    try:
        model = RandomForestRegressor(
            n_estimators=100,
            max_depth=12,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X, y)
        _SAFETY_MODEL = model
        _LAST_TRAIN_TIME = time.time()
        print(f"[safety-ml] Trained on {len(X)} samples (incl. {len(db_incidents)} from user reports/SOS).")
    except Exception as e:
        print(f"[safety-ml] Training failed: {e}")
        _SAFETY_MODEL = None


# Run training once at startup (after function is defined)
_train_safety_model()


def _schedule_retrain(reason=""):
    """Trigger async retrain (e.g. after new report)."""
    # A retrain always follows a new report or SOS, so this is the one place
    # that needs to drop the cached incident list.
    _invalidate_incident_cache()

    def _run():
        time.sleep(2)  # debounce
        print(f"[safety-ml] Retraining ({reason})...")
        _train_safety_model()

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _periodic_retrain_worker():
    """Background thread: retrain every RETRAIN_INTERVAL_SEC."""
    while True:
        time.sleep(_RETRAIN_INTERVAL_SEC)
        print("[safety-ml] Periodic retrain...")
        _train_safety_model()


_retrain_thread_started = False


def _start_periodic_retrain():
    """Start the retrain loop once, however the app was launched.

    This used to live in the `__main__` block, so under gunicorn — which
    imports the module rather than running it — the periodic retrain never
    started at all. Reports still trigger a retrain on their own, but the
    scheduled one silently did nothing in production.
    """
    global _retrain_thread_started
    if _retrain_thread_started:
        return
    _retrain_thread_started = True
    threading.Thread(target=_periodic_retrain_worker, daemon=True).start()


def _is_night_hour(hour):
    # Night/evening influence for lamps
    return hour >= 18 or hour < 6


def _rule_score_from_counts(police_count, lamp_count, camera_count, incident_count, night):
    """The rule-based score for a set of neighbour counts.

    Split out so the offline pack builder scores cells through exactly this
    function. Duplicating the ladder there would let the downloadable map drift
    away from what the live API reports for the same place.
    """
    has_police = police_count > 0
    has_lamp = lamp_count > 0
    has_camera = camera_count > 0
    has_incident = incident_count > 0

    # Base combinations
    infra = sum([1 if has_police else 0, 1 if has_lamp else 0, 1 if has_camera else 0])
    score = 50.0

    if has_police and has_lamp and has_camera:
        score = 80.0
    elif has_police and has_lamp and has_incident and not has_camera:
        score = 70.0
    elif infra == 2:
        if has_police and has_camera:
            score = 75.0
        elif has_police and has_lamp:
            score = 72.0
        elif has_lamp and has_camera:
            score = 65.0
    elif infra == 1:
        if has_police:
            score = 60.0
        elif has_camera:
            score = 58.0
        elif has_lamp:
            score = 55.0
    elif infra == 0:
        score = 45.0 if not has_incident else 30.0

    # Time-aware lamps
    if night and has_lamp:
        score += 7.0

    # Incidents reduce safety
    if incident_count > 0:
        score -= min(incident_count * 4.0, 25.0)

    # minor boosts for density
    score += min(police_count, 3) * 1.5
    score += min(camera_count, 3) * 1.0

    return score


def _safety_components(lat, lng, hour=None):
    """Feature extraction plus the rule-based score, without the ML blend.

    Split out from _rule_based_safety_score so callers that score many points
    (the grid) can run one batched model prediction instead of one per point.
    """
    pts = _load_protego_points()
    if hour is None:
        hour = datetime.datetime.now().hour
    night = _is_night_hour(hour)

    # nearest_all: "nearest police station" should mean the nearest one anywhere,
    # not just one that happens to fall inside the 500m feature radius.
    police_count, nearest_police_m = _count_within(pts["police"], lat, lng, 500.0, nearest_all=True)
    lamp_count, _nearest_lamp_m = _count_within(pts["lamp"], lat, lng, 500.0)
    camera_count, _nearest_cam_m = _count_within(pts["camera"], lat, lng, 500.0)
    incident_count, _nearest_inc_m = _count_within(_all_incident_points(), lat, lng, 500.0)

    has_police = police_count > 0
    score = _rule_score_from_counts(police_count, lamp_count, camera_count, incident_count, night)

    crime_density = incident_count / max(1, police_count + lamp_count + camera_count) if (police_count + lamp_count + camera_count) > 0 else incident_count

    return {
        "rule_score": score,
        "ml_vec": [
            police_count,
            lamp_count,
            camera_count,
            incident_count,
            1 if night else 0,
            crime_density,
        ],
        "nearest_police_m": nearest_police_m,
        "features": {
            "police_count_500m": police_count,
            "lamp_count_500m": lamp_count,
            "camera_count_500m": camera_count,
            "incident_count_500m": incident_count,
            "is_night": 1 if night else 0,
        },
    }


def _finalize_score(components, ml_pred):
    """Blend the rule score with the model prediction and clamp to 0-100."""
    score = components["rule_score"]
    if ml_pred is not None:
        score = 0.5 * score + 0.5 * ml_pred
    score = max(0.0, min(100.0, score))
    nearest_police_m = components["nearest_police_m"]
    return {
        "score": score,
        "nearest_police_km": (nearest_police_m / 1000.0) if nearest_police_m is not None else None,
        "features": components["features"],
    }


def _rule_based_safety_score(lat, lng, hour=None):
    components = _safety_components(lat, lng, hour)

    # Optional ML refinement: combine with RandomForest prediction
    ml_pred = None
    if _SAFETY_MODEL is not None:
        try:
            ml_pred = float(_SAFETY_MODEL.predict([components["ml_vec"]])[0])
        except Exception as e:
            # If anything goes wrong, fall back to rule-based score
            print(f"[safety-ml] Inference error: {e}")

    return _finalize_score(components, ml_pred)


def _safety_scores_batch(coords, hour=None):
    """Score many (lat, lng) pairs with a single model prediction.

    A per-point predict() costs ~35ms of sklearn overhead, so scoring the 250
    grid points one at a time took ~9s. Batched, the same work is one call.
    """
    components = [_safety_components(lat, lng, hour) for (lat, lng) in coords]
    preds = [None] * len(components)

    if _SAFETY_MODEL is not None and components:
        try:
            raw = _SAFETY_MODEL.predict([c["ml_vec"] for c in components])
            preds = [float(v) for v in raw]
        except Exception as e:
            print(f"[safety-ml] Batch inference error: {e}")

    return [_finalize_score(c, p) for c, p in zip(components, preds)]


# ============================
# OFFLINE SAFETY PACK
# ============================
# The phone cannot reach this server when the user is out on the street, so the
# safety map has to travel with them. This precomputes a score for every ~110m
# cell over the dataset's coverage and ships it as a compact byte grid the
# browser caches and reads directly.
#
# Counting neighbours cell-by-cell would be ~4 billion distance checks. Counting
# points within a radius of *every* cell is the same thing as convolving a
# point-density histogram with a disc kernel, which turns the whole job into a
# few array operations.
_OFFLINE_PACK_STEP = 0.001  # ~110m
# Written at runtime, so it belongs on the writable disk alongside the DB.
_OFFLINE_PACK_PATH = os.path.join(
    os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "backend"), "offline_pack.json"
)
_OFFLINE_PACK_CACHE = {"data": None, "stamp": 0.0}


def _disc_kernel(np, step, centre_lat, radius_m=500.0):
    """Boolean disc covering radius_m, in grid cells at this latitude."""
    cell_lat_m = step * 111320.0
    cell_lng_m = step * 111320.0 * math.cos(math.radians(centre_lat))
    ry = max(1, int(math.ceil(radius_m / cell_lat_m)))
    rx = max(1, int(math.ceil(radius_m / cell_lng_m)))
    yy, xx = np.mgrid[-ry : ry + 1, -rx : rx + 1]
    dist2 = (yy * cell_lat_m) ** 2 + (xx * cell_lng_m) ** 2
    return (dist2 <= radius_m**2).astype(np.float32)


def _build_offline_pack(step=_OFFLINE_PACK_STEP):
    """Build the downloadable safety grid. Returns the pack dict."""
    import numpy as np
    from scipy.ndimage import convolve

    pts = _load_protego_points()
    incidents = _all_incident_points()

    every = pts["police"] + pts["lamp"] + pts["camera"] + incidents
    if not every:
        raise ValueError("No safety data loaded")

    lats = [p[0] for p in every]
    lngs = [p[1] for p in every]
    # A small margin so cells at the very edge still see their neighbours.
    pad = 0.01
    min_lat, max_lat = min(lats) - pad, max(lats) + pad
    min_lng, max_lng = min(lngs) - pad, max(lngs) + pad

    rows = int(round((max_lat - min_lat) / step)) + 1
    cols = int(round((max_lng - min_lng) / step)) + 1

    def density(points):
        grid = np.zeros((rows, cols), dtype=np.float32)
        if not points:
            return grid
        arr = np.asarray(points, dtype=np.float64)
        iy = np.rint((arr[:, 0] - min_lat) / step).astype(np.int64)
        ix = np.rint((arr[:, 1] - min_lng) / step).astype(np.int64)
        keep = (iy >= 0) & (iy < rows) & (ix >= 0) & (ix < cols)
        np.add.at(grid, (iy[keep], ix[keep]), 1.0)
        return grid

    kernel = _disc_kernel(np, step, (min_lat + max_lat) / 2.0)
    counts = {
        name: convolve(density(points), kernel, mode="constant", cval=0.0)
        for name, points in (
            ("police", pts["police"]),
            ("lamp", pts["lamp"]),
            ("camera", pts["camera"]),
            ("incident", incidents),
        )
    }

    police = counts["police"].ravel()
    lamp = counts["lamp"].ravel()
    camera = counts["camera"].ravel()
    incident = counts["incident"].ravel()
    total_cells = police.size

    planes = {}
    for profile, night in (("day", False), ("night", True)):
        # Scored through the same function the live API uses, so the offline map
        # and the online one cannot disagree about the same place.
        rule = np.fromiter(
            (
                _rule_score_from_counts(
                    int(police[i]), int(lamp[i]), int(camera[i]), int(incident[i]), night
                )
                for i in range(total_cells)
            ),
            dtype=np.float32,
            count=total_cells,
        )

        blended = rule
        if _SAFETY_MODEL is not None:
            infra_total = police + lamp + camera
            crime_density = np.where(infra_total > 0, incident / np.maximum(1.0, infra_total), incident)
            features = np.column_stack(
                [
                    police,
                    lamp,
                    camera,
                    incident,
                    np.full(total_cells, 1.0 if night else 0.0, dtype=np.float32),
                    crime_density,
                ]
            )
            try:
                blended = 0.5 * rule + 0.5 * _SAFETY_MODEL.predict(features).astype(np.float32)
            except Exception as e:
                print(f"[offline-pack] ML blend failed, rule-based only: {e}")

        clamped = np.clip(blended, 0.0, 100.0)
        # 0-100 into one byte; 0.4 of a point of precision is far finer than the
        # model is meaningful to, and keeps the download small.
        planes[profile] = np.rint(clamped * 2.55).astype(np.uint8).tobytes()

    import base64

    return {
        "version": 1,
        "generated": int(time.time()),
        "step": step,
        "rows": rows,
        "cols": cols,
        "bounds": {"minLat": min_lat, "maxLat": max_lat, "minLng": min_lng, "maxLng": max_lng},
        # Row-major from the south-west corner; byte / 2.55 = score out of 100.
        "day": base64.b64encode(planes["day"]).decode("ascii"),
        "night": base64.b64encode(planes["night"]).decode("ascii"),
        # Small enough to ship whole, and what the offline SOS screen needs.
        "police": [[round(lat, 5), round(lng, 5)] for (lat, lng) in pts["police"]],
        "hospitals": [
            {"name": h["name"], "lat": round(h["lat"], 5), "lng": round(h["lng"], 5)}
            for h in _load_hospitals()[:400]
        ],
    }


def _offline_pack(force=False):
    """Cached pack: built once, reused, rebuilt when reports change it."""
    cached = _OFFLINE_PACK_CACHE["data"]
    if cached is not None and not force:
        return cached

    if not force and os.path.exists(_OFFLINE_PACK_PATH):
        try:
            with open(_OFFLINE_PACK_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            _OFFLINE_PACK_CACHE["data"] = data
            return data
        except Exception as e:
            print(f"[offline-pack] Could not read cached pack: {e}")

    print("[offline-pack] Building safety grid…")
    started = time.time()
    data = _build_offline_pack()
    try:
        with open(_OFFLINE_PACK_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception as e:
        print(f"[offline-pack] Could not cache pack to disk: {e}")
    _OFFLINE_PACK_CACHE["data"] = data
    print(
        f"[offline-pack] {data['rows']}x{data['cols']} cells in {time.time() - started:.1f}s"
    )
    return data


@app.route("/api/offline/safety-pack", methods=["GET"])
def offline_safety_pack():
    """The whole safety map, for the browser to cache and use with no signal."""
    try:
        pack = _offline_pack(force=request.args.get("rebuild") == "1")
    except Exception as e:
        print(f"[offline-pack] build failed: {e}")
        return jsonify({"error": "Could not build the offline pack", "detail": str(e)}), 500

    response = jsonify(pack)
    # Immutable for a day: the client re-checks `generated` to spot a rebuild.
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


def _http_get_json(url, headers=None, timeout=10):
    req = Request(url, headers=headers or {"User-Agent": "ProTego/1.0"})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _pick_safest_osrm_route(start, end, alternatives=2):
    """
    Query OSRM for up to (alternatives+1) routes and choose the safest by sampling.
    Returns: (route_latlng_list, meta)
    """
    # OSRM expects lng,lat
    coords = f"{start['lng']},{start['lat']};{end['lng']},{end['lat']}"
    qs = urlencode({
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        "alternatives": "true" if alternatives else "false",
    })
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}?{qs}"
    data = _http_get_json(url)
    routes = data.get("routes") or []
    if not routes:
        raise ValueError("No routes found")

    best = None
    best_score = None
    best_meta = None

    for r in routes[: max(1, alternatives + 1)]:
        geom = r.get("geometry", {}).get("coordinates") or []
        if len(geom) < 2:
            continue

        # Sample up to 30 points evenly across the route
        sample_n = min(30, len(geom))
        step = max(1, len(geom) // sample_n)
        samples = geom[::step]
        if samples[-1] != geom[-1]:
            samples.append(geom[-1])

        # Batched: this runs per alternative per leg, so single-row predicts
        # would cost seconds on a multi-stop trip.
        scores = [r["score"] for r in _safety_scores_batch([(lat, lng) for (lng, lat) in samples])]

        avg_safety = sum(scores) / max(1, len(scores))
        dist_km = (r.get("distance") or 0) / 1000.0

        # prefer safety, but penalize big detours
        combined = avg_safety - (dist_km * 2.5)

        if best_score is None or combined > best_score:
            best_score = combined
            best = geom
            best_meta = {
                "avg_safety": avg_safety,
                "distance_km": dist_km,
                "duration_min": (r.get("duration") or 0) / 60.0,
                "steps": (r.get("legs") or [{}])[0].get("steps") or [],
            }

    if not best:
        raise ValueError("No valid route")

    route_latlng = [{"lat": lat, "lng": lng} for (lng, lat) in best]
    return route_latlng, best_meta


@app.route("/api/osrm-route", methods=["GET"])
def osrm_route_proxy():
    """Proxy OSRM driving route so the browser does not call router.project-osrm.org directly (avoids CORS/connection refused)."""
    try:
        start_lat = float(request.args.get("start_lat"))
        start_lng = float(request.args.get("start_lng"))
        end_lat = float(request.args.get("end_lat"))
        end_lng = float(request.args.get("end_lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "start_lat, start_lng, end_lat, end_lng required"}), 400
    coords = f"{start_lng},{start_lat};{end_lng},{end_lat}"
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson&steps=true"
    try:
        data = _http_get_json(url)
    except Exception as e:
        return jsonify({"error": "Routing service unavailable", "detail": str(e)}), 502
    if data.get("code") == "NoRoute" or not data.get("routes"):
        return jsonify({"error": "No route found", "code": data.get("code")}), 404
    return jsonify(data), 200


# ============================
# STATIC FILE SERVING
# ============================

# Serve CSS files (must come before catch-all)
@app.route("/css/<path:filename>")
def serve_css(filename):
    """Serve CSS files from frontend/css"""
    return send_from_directory(os.path.join(FRONTEND_DIR, "css"), filename)

# Serve JavaScript files (must come before catch-all)
@app.route("/js/<path:filename>")
def serve_js(filename):
    """Serve JS files from frontend/js"""
    return send_from_directory(os.path.join(FRONTEND_DIR, "js"), filename)

# Serve assets (images, etc.) (must come before catch-all)
@app.route("/assets/<path:filename>")
def serve_assets(filename):
    """Serve asset files from frontend/assets, falling back to the React build.

    This route is matched before the catch-all, so it has to know about
    web/dist/assets or the built bundle's own CSS and JS would 404.
    """
    legacy_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.isfile(os.path.join(legacy_dir, filename)):
        return send_from_directory(legacy_dir, filename)
    return send_from_directory(os.path.join(BASE_DIR, "web", "dist", "assets"), filename)

# Serve data files (for CSV, etc.) (must come before catch-all)
@app.route("/data/<path:filename>")
def serve_data(filename):
    """Serve data files from the data directory the CSVs actually live in."""
    for candidate in (
        os.path.join(BASE_DIR, "data"),
        os.path.join(BASE_DIR, "safety_route", "data"),
        os.path.join(BASE_DIR, "safety_route", "data1"),
    ):
        if os.path.isfile(os.path.join(candidate, filename)):
            return send_from_directory(candidate, filename)
    return "File not found", 404

# Serve FriendsNavigator (static mini-app)
def _friendsnavigator_dir():
    """The folder has been spelled both ways over time; use whichever exists."""
    for name in ("FriendsNavigator", "FreindsNavigator"):
        path = os.path.join(BASE_DIR, name)
        if os.path.isdir(path):
            return path
    return os.path.join(BASE_DIR, "FriendsNavigator")

@app.route("/friendsnavigator/")
def serve_friendsnavigator_index():
    return send_from_directory(_friendsnavigator_dir(), "index.html")

@app.route("/friendsnavigator/<path:filename>")
def serve_friendsnavigator_files(filename):
    return send_from_directory(_friendsnavigator_dir(), filename)

# ============================
# HEALTH CHECK
# ============================
@app.route("/api/health")
def health():
    return "SafeWalk Backend Running ✅"


# ============================
# SIGNUP
# ============================
@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.json or {}

    name = (data.get("name") or "").strip()
    # Emails are matched case-insensitively, so store them normalised.
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip() or None
    password = data.get("password") or ""

    if not name or not email or not password:
        return jsonify({"error": "Missing fields"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    password_hash = generate_password_hash(password)

    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("SELECT id FROM users WHERE lower(email) = ?", (email,))
        if cur.fetchone():
            return jsonify({"error": "That email is already registered. Try signing in."}), 409

        cur.execute("""
            INSERT INTO users (name, email, phone, password_hash)
            VALUES (?, ?, ?, ?)
        """, (name, email, phone, password_hash))
        conn.commit()

        return jsonify({"message": "User registered successfully"}), 201

    except sqlite3.IntegrityError:
        # The only error that genuinely means "taken" — a UNIQUE violation.
        return jsonify({"error": "That email is already registered. Try signing in."}), 409
    except Exception as e:
        # Previously every failure was reported as "Email already exists", which
        # hid real faults (a locked database) behind a wrong message and left
        # users unable to sign in to an account that was never created.
        print(f"[signup] failed: {type(e).__name__}: {e}")
        return jsonify({"error": "Could not create the account. Please try again."}), 500
    finally:
        if conn is not None:
            conn.close()


# ============================
# LOGIN
# ============================
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    conn = get_db()
    try:
        cur = conn.cursor()
        # Case-insensitive so "Zoya@x.com" and "zoya@x.com" are one account.
        cur.execute("SELECT * FROM users WHERE lower(email) = ?", (email,))
        user = cur.fetchone()
    finally:
        conn.close()

    # One message for both cases: saying which half was wrong tells an attacker
    # which emails are registered.
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Incorrect email or password"}), 401

    # Convert Row to dict for easier access
    user_dict = dict(user)
    
    return jsonify({
        "message": "Login successful",
        "user": {
            "id": user_dict["id"],
            "name": user_dict["name"],
            "email": user_dict["email"],
            "phone": user_dict.get("phone") or None,
            "address": user_dict.get("address") or None
        }
    }), 200




# ============================
# PASSWORD RESET
# ============================
#
# There is no mail or SMS provider wired into this prototype, so identity is
# proved with the phone number already on the account. That is weaker than a
# one-time code sent out-of-band: anyone who knows both the email and the phone
# number can reset. Before this goes anywhere real, replace step one with a
# code emailed or texted to the user and keep the rest of the flow as-is.
_RESET_TOKENS = {}          # token -> {user_id, expires}
_RESET_ATTEMPTS = {}        # email -> [timestamps]
_RESET_TOKEN_TTL_SEC = 15 * 60
_RESET_MAX_ATTEMPTS = 5
_RESET_WINDOW_SEC = 15 * 60


def _reset_rate_limited(email):
    """Crude per-email throttle so the phone number cannot be brute forced."""
    now = time.time()
    recent = [t for t in _RESET_ATTEMPTS.get(email, []) if now - t < _RESET_WINDOW_SEC]
    _RESET_ATTEMPTS[email] = recent
    return len(recent) >= _RESET_MAX_ATTEMPTS


def _note_reset_attempt(email):
    _RESET_ATTEMPTS.setdefault(email, []).append(time.time())


def _purge_expired_tokens():
    now = time.time()
    for token in [t for t, v in _RESET_TOKENS.items() if v["expires"] < now]:
        _RESET_TOKENS.pop(token, None)


@app.route("/api/password/forgot", methods=["POST"])
def password_forgot():
    """Step 1: prove ownership with the phone on file, get a short-lived token."""
    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    phone = (data.get("phone") or "").strip()

    if not email or not phone:
        return jsonify({"error": "Email and registered phone number are required"}), 400

    if _reset_rate_limited(email):
        return jsonify({"error": "Too many attempts. Try again in 15 minutes."}), 429
    _note_reset_attempt(email)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, phone FROM users WHERE lower(email) = ?", (email,))
        user = cur.fetchone()
    finally:
        conn.close()

    # Compare digits only: "+91 93804 28285" and "9380428285" are the same number.
    def digits(v):
        return "".join(ch for ch in (v or "") if ch.isdigit())

    on_file = digits(user["phone"]) if user else ""
    given = digits(phone)
    matches = bool(on_file) and (on_file == given or on_file.endswith(given) or given.endswith(on_file))

    # Same response either way — a different message here would reveal which
    # emails are registered.
    if not user or not matches:
        return jsonify({"error": "That email and phone number do not match an account."}), 401

    _purge_expired_tokens()
    token = secrets.token_urlsafe(32)
    _RESET_TOKENS[token] = {"user_id": user["id"], "expires": time.time() + _RESET_TOKEN_TTL_SEC}
    _RESET_ATTEMPTS.pop(email, None)

    return jsonify({"token": token, "expires_in": _RESET_TOKEN_TTL_SEC}), 200


@app.route("/api/password/reset", methods=["POST"])
def password_reset():
    """Step 2: spend the token to set a new password."""
    data = request.json or {}
    token = data.get("token") or ""
    new_password = data.get("password") or ""

    if len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    _purge_expired_tokens()
    entry = _RESET_TOKENS.get(token)
    if not entry:
        return jsonify({"error": "This reset link has expired. Start again."}), 400

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(new_password), entry["user_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    # Single use.
    _RESET_TOKENS.pop(token, None)
    return jsonify({"message": "Password updated. You can sign in now."}), 200


# ============================
# EVIDENCE
# ============================
@app.route("/api/evidence", methods=["POST"])
def save_evidence():
    data = request.json or {}

    user_id = data.get("user_id")
    image = data.get("image_base64")
    lat = data.get("lat")
    lng = data.get("lng")
    accuracy = data.get("accuracy")
    evidence_type = data.get("type")
    timestamp = data.get("timestamp")

    if not user_id or not image or not evidence_type or not timestamp:
        return jsonify({"error": "Missing fields"}), 400

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO evidence
        (user_id, image_base64, lat, lng, accuracy, type, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (user_id, image, lat, lng, accuracy, evidence_type, timestamp))

    conn.commit()
    conn.close()

    return jsonify({"message": "Evidence stored"}), 201


@app.route("/api/evidence/<int:user_id>", methods=["GET"])
def get_evidence(user_id):

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT id, image_base64, type, timestamp
        FROM evidence
        WHERE user_id = ?
        ORDER BY timestamp DESC
    """, (user_id,))

    rows = cur.fetchall()
    conn.close()

    return jsonify([dict(r) for r in rows]), 200


@app.route("/api/evidence/<int:evidence_id>", methods=["DELETE"])
def delete_evidence(evidence_id):

    conn = get_db()
    cur = conn.cursor()

    cur.execute("DELETE FROM evidence WHERE id = ?", (evidence_id,))

    conn.commit()
    conn.close()

    return jsonify({"message": "Evidence deleted"}), 200


# ============================
# SAVED LOCATIONS
# ============================
@app.route("/api/locations", methods=["POST"])
def add_location():

    data = request.json or {}

    user_id = data.get("user_id")
    label = data.get("label")
    lat = data.get("lat")
    lng = data.get("lng")

    if not user_id or not label:
        return jsonify({"error": "Missing fields"}), 400

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO locations (user_id, label, lat, lng)
        VALUES (?, ?, ?, ?)
    """, (user_id, label, lat, lng))

    location_id = cur.lastrowid
    conn.commit()
    conn.close()

    return jsonify({"message": "Location added", "location_id": location_id}), 201


@app.route("/api/locations/<int:user_id>", methods=["GET"])
def get_locations(user_id):

    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM locations WHERE user_id = ?", (user_id,))
    rows = cur.fetchall()

    conn.close()

    return jsonify([dict(r) for r in rows]), 200


# GET ALL LOCATIONS WITH CONTACTS GROUPED
@app.route("/api/locations/<int:user_id>/with-contacts", methods=["GET"])
def get_locations_with_contacts(user_id):
    try:
        conn = get_db()
        cur = conn.cursor()

        # Get all locations for user
        cur.execute("SELECT * FROM locations WHERE user_id = ?", (user_id,))
        locations = cur.fetchall()

        result = []
        for loc in locations:
            location_dict = dict(loc)
            
            # Get contacts for this location
            cur.execute("""
                SELECT * FROM trusted_contacts
                WHERE location_id = ?
                ORDER BY id
            """, (loc["id"],))
            contacts = cur.fetchall()
            
            location_dict["contacts"] = [dict(c) for c in contacts]
            result.append(location_dict)

        conn.close()

        return jsonify(result), 200
    except Exception as e:
        print(f"Error in get_locations_with_contacts: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# DELETE LOCATION (cascade deletes contacts)
@app.route("/api/locations/<int:location_id>", methods=["DELETE"])
def delete_location(location_id):

    conn = get_db()
    try:
        cur = conn.cursor()
        # Autocommit is on, so wrap these two so a location can never lose its
        # contacts without itself being removed.
        cur.execute("BEGIN")
        cur.execute("DELETE FROM trusted_contacts WHERE location_id = ?", (location_id,))
        cur.execute("DELETE FROM locations WHERE id = ?", (location_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return jsonify({"message": "Location and contacts deleted"}), 200


# ============================
# TRUSTED CONTACTS
# ============================

# ADD CONTACT
@app.route("/api/contacts", methods=["POST"])
def add_contact():

    data = request.json or {}

    location_id = data.get("location_id")
    name = data.get("name")
    phone = data.get("phone")
    email = data.get("email")

    if not location_id or not name:
        return jsonify({"error": "Missing fields"}), 400

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO trusted_contacts
        (location_id, name, phone, email)
        VALUES (?, ?, ?, ?)
    """, (location_id, name, phone, email))

    conn.commit()
    conn.close()

    return jsonify({"message": "Contact added"}), 201


# BULK ADD CONTACTS
@app.route("/api/contacts/bulk", methods=["POST"])
def bulk_add_contacts():

    data = request.json or {}

    contacts = data.get("contacts", [])

    if not contacts:
        return jsonify({"error": "No contacts provided"}), 400

    conn = get_db()
    cur = conn.cursor()

    for contact in contacts:
        location_id = contact.get("location_id")
        name = contact.get("name")
        phone = contact.get("phone")
        email = contact.get("email")

        if location_id and name:
            cur.execute("""
                INSERT INTO trusted_contacts
                (location_id, name, phone, email)
                VALUES (?, ?, ?, ?)
            """, (location_id, name, phone, email))

    conn.commit()
    conn.close()

    return jsonify({"message": f"{len(contacts)} contacts added"}), 201


# GET CONTACTS FOR LOCATION
@app.route("/api/contacts/<int:location_id>", methods=["GET"])
def get_contacts(location_id):

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT * FROM trusted_contacts
        WHERE location_id = ?
    """, (location_id,))

    rows = cur.fetchall()
    conn.close()

    return jsonify([dict(r) for r in rows])


# UPDATE CONTACT
@app.route("/api/contacts/<int:contact_id>", methods=["PUT"])
def update_contact(contact_id):

    data = request.json or {}

    name = data.get("name")
    phone = data.get("phone")
    email = data.get("email")

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        UPDATE trusted_contacts
        SET name=?, phone=?, email=?
        WHERE id=?
    """,(name,phone,email,contact_id))

    conn.commit()
    conn.close()

    return jsonify({"message":"Contact updated"})


# DELETE CONTACT
@app.route("/api/contacts/<int:contact_id>", methods=["DELETE"])
def delete_contact(contact_id):

    conn = get_db()
    cur = conn.cursor()

    cur.execute("DELETE FROM trusted_contacts WHERE id=?", (contact_id,))

    conn.commit()
    conn.close()

    return jsonify({"message":"Contact deleted"})

# ============================
# SAFE ROUTE API
# ============================
@app.route("/api/route", methods=["POST"])
def get_safe_route():

    data = request.json or {}

    start_lat = data.get("start_lat")
    start_lng = data.get("start_lng")
    end_lat = data.get("end_lat")
    end_lng = data.get("end_lng")

    if not start_lat or not start_lng or not end_lat or not end_lng:
        return jsonify({"error": "Missing coordinates"}), 400

    route = [
        [start_lat, start_lng],
        [(start_lat + end_lat) / 2, (start_lng + end_lng) / 2],
        [end_lat, end_lng]
    ]

    return jsonify({
        "route": route,
        "safety_score": 7.8
    })


# ============================
# SAFETY SCORE + HEATMAP
# ============================
@app.route("/api/safety-point", methods=["GET"])
def safety_point():
    try:
        lat = float(request.args.get("lat"))
        lng = float(request.args.get("lng"))
    except Exception:
        return jsonify({"error": "lat and lng required"}), 400

    hour = request.args.get("hour")
    try:
        hour = int(hour) if hour is not None else None
    except Exception:
        hour = None

    result = _rule_based_safety_score(lat, lng, hour=hour)
    return jsonify({
        "score": result["score"],
        "nearest_police_km": result["nearest_police_km"],
        "features": result["features"],
    }), 200


@app.route("/api/safety-grid", methods=["GET"])
def safety_grid():
    try:
        min_lat = float(request.args.get("minLat"))
        max_lat = float(request.args.get("maxLat"))
        min_lng = float(request.args.get("minLng"))
        max_lng = float(request.args.get("maxLng"))
    except Exception:
        return jsonify({"error": "minLat,maxLat,minLng,maxLng required"}), 400

    hour = request.args.get("hour")
    try:
        hour = int(hour) if hour is not None else None
    except Exception:
        hour = None

    # ~100m grid spacing
    step = 0.001

    # Limit work (avoid freezing)
    max_points = 250
    coords = []
    lat = min_lat
    while lat <= max_lat and len(coords) < max_points:
        lng = min_lng
        while lng <= max_lng and len(coords) < max_points:
            coords.append((lat, lng))
            lng += step
        lat += step

    results = _safety_scores_batch(coords, hour=hour)
    points = [
        {"lat": lat, "lng": lng, "score": r["score"]}
        for (lat, lng), r in zip(coords, results)
    ]

    return jsonify({"points": points}), 200


# ============================
# SAFEST ROUTE (OSRM + SAFETY)
# ============================
def _format_distance(meters):
    if not meters:
        return ""
    if meters < 1000:
        return f"{int(round(meters / 10.0) * 10)} m"
    return f"{meters / 1000.0:.1f} km"


# Average walking pace, used to convert road distances into walking times.
_WALK_SPEED_KMH = 4.8

_COMPASS = [
    "north", "north-east", "east", "south-east",
    "south", "south-west", "west", "north-west",
]


def _bearing_word(deg):
    if deg is None:
        return ""
    return _COMPASS[int((float(deg) % 360) / 45.0 + 0.5) % 8]


def _describe_step(step):
    """Turn one OSRM step into a human instruction.

    The public OSRM demo server returns maneuvers but no `instruction` text
    (that comes from an optional module it does not run), so the turn-by-turn
    list was always empty. Build the sentence from type + modifier + road name.
    """
    m = step.get("maneuver") or {}
    kind = (m.get("type") or "").lower()
    mod = (m.get("modifier") or "").lower()
    name = (step.get("name") or "").strip()
    onto = f" onto {name}" if name else ""
    along = f" along {name}" if name else ""
    dist = _format_distance(step.get("distance"))

    if kind == "depart":
        # A turn modifier is meaningless with no previous road; use the compass.
        heading = _bearing_word(m.get("bearing_after"))
        text = f"Head {heading}{along}" if heading else (f"Start{along}" if name else "Start")
    elif kind == "arrive":
        # OSRM also reports "straight" here, which does not describe a side.
        text = "Arrive at your destination"
        if mod in ("left", "right"):
            text += f", on the {mod}"
        dist = ""
    elif kind in ("turn", "end of road"):
        text = f"Turn {mod}{onto}" if mod else f"Continue{onto}"
    elif kind == "new name":
        text = f"Continue{onto}"
    elif kind == "continue":
        text = f"Continue {mod}{onto}".replace("  ", " ").strip() if mod else f"Continue{onto}"
    elif kind == "merge":
        text = f"Merge {mod}{onto}" if mod else f"Merge{onto}"
    elif kind == "on ramp":
        text = f"Take the ramp {mod}{onto}".replace("  ", " ") if mod else f"Take the ramp{onto}"
    elif kind == "off ramp":
        text = f"Take the exit {mod}{onto}".replace("  ", " ") if mod else f"Take the exit{onto}"
    elif kind == "fork":
        text = f"Keep {mod}{onto}" if mod else f"Keep going{onto}"
    elif kind in ("roundabout", "rotary"):
        exit_no = m.get("exit")
        text = f"At the roundabout, take exit {exit_no}{onto}" if exit_no else f"Follow the roundabout{onto}"
    elif kind in ("roundabout turn", "exit roundabout", "exit rotary"):
        text = f"Leave the roundabout{onto}"
    else:
        text = f"Continue{onto}"

    text = " ".join(text.split())

    loc = m.get("location") or []
    return {
        "text": text,
        "type": kind,
        "modifier": mod,
        "name": name,
        "distance_m": step.get("distance") or 0,
        "duration_s": step.get("duration") or 0,
        # Where the maneuver happens — the client uses this to know when the
        # walker has reached the turn and the next instruction should show.
        "lat": loc[1] if len(loc) == 2 else None,
        "lng": loc[0] if len(loc) == 2 else None,
        "distance_text": dist,
    }


@app.route("/api/safest-route", methods=["POST"])
def safest_route():
    """Safest route through an ordered list of points.

    Accepts either the original {start, end} pair or a multi-stop trip:
      {"stops": [{lat,lng}, {lat,lng}, ...]}          full ordered list, or
      {"start": {...}, "waypoints": [...], "end": {...}}

    Each consecutive pair is routed and scored independently, then stitched into
    one polyline. A leg that OSRM cannot route falls back to a straight line on
    its own, so one bad stop does not lose the whole trip.
    """
    data = request.json or {}

    def _pt(raw):
        return {"lat": float(raw["lat"]), "lng": float(raw["lng"])}

    try:
        if isinstance(data.get("stops"), list):
            if len(data["stops"]) < 2:
                return jsonify({"error": "A trip needs at least a start and a destination"}), 400
            points = [_pt(p) for p in data["stops"]]
        else:
            points = [_pt(data.get("start") or {})]
            for w in (data.get("waypoints") or []):
                points.append(_pt(w))
            points.append(_pt(data.get("end") or {}))
    except (TypeError, ValueError, KeyError):
        return jsonify({"error": "start/end lat,lng required"}), 400

    mode = (data.get("mode") or "walk").lower()
    if mode not in ("walk", "drive"):
        mode = "walk"

    if len(points) < 2:
        return jsonify({"error": "At least a start and a destination are required"}), 400
    if len(points) > 10:
        return jsonify({"error": "A trip can have at most 8 stops between start and destination"}), 400

    route = []
    legs = []
    instructions = []
    osrm_error = None
    total_km = 0.0
    total_min = 0.0
    any_duration = False
    weighted_safety = 0.0
    weight_total = 0.0

    for idx in range(len(points) - 1):
        a, b = points[idx], points[idx + 1]
        try:
            leg_route, meta = _pick_safest_osrm_route(a, b, alternatives=2)
        except Exception as e:
            # Fallback for this leg only: straight line through the midpoint.
            osrm_error = str(e)
            mid = {"lat": (a["lat"] + b["lat"]) / 2.0, "lng": (a["lng"] + b["lng"]) / 2.0}
            leg_route = [a, mid, b]
            dist_km = (
                _haversine_m(a["lat"], a["lng"], mid["lat"], mid["lng"])
                + _haversine_m(mid["lat"], mid["lng"], b["lat"], b["lng"])
            ) / 1000.0
            meta = {
                "avg_safety": _rule_based_safety_score(mid["lat"], mid["lng"])["score"],
                "distance_km": dist_km,
                "duration_min": None,
                "steps": [],
            }

        leg_km = meta.get("distance_km") or 0.0
        leg_min = meta.get("duration_min")
        if mode == "walk":
            # router.project-osrm.org only hosts the driving profile, so its
            # duration is a car's. Re-derive it at an average walking pace.
            leg_min = (leg_km / _WALK_SPEED_KMH) * 60.0
            for st in (meta.get("steps") or []):
                st["duration"] = ((st.get("distance") or 0) / 1000.0 / _WALK_SPEED_KMH) * 3600.0
        leg_safety = meta.get("avg_safety")

        total_km += leg_km
        if leg_min is not None:
            total_min += leg_min
            any_duration = True
        if leg_safety is not None:
            # Weight by distance so a long unsafe leg is not cancelled by a short safe one.
            weighted_safety += leg_safety * max(leg_km, 0.001)
            weight_total += max(leg_km, 0.001)

        legs.append({
            "from_index": idx,
            "to_index": idx + 1,
            "distance_km": leg_km,
            "duration_min": leg_min,
            "safety": leg_safety,
        })

        leg_steps = [_describe_step(st) for st in (meta.get("steps") or [])]
        leg_steps = [st for st in leg_steps if st.get("text")]
        instructions.append({"leg": idx, "steps": leg_steps})

        # Drop the duplicated joint point where two legs meet.
        route.extend(leg_route[1:] if route else leg_route)

    # Per-point safety scores for the coloured route segments, batched.
    sample_step = max(1, len(route) // 40)
    sampled = [route[i] for i in range(0, len(route), sample_step)]
    if route and sampled and sampled[-1] is not route[-1]:
        sampled.append(route[-1])
    scored = _safety_scores_batch([(pt["lat"], pt["lng"]) for pt in sampled])
    segment_scores = [
        {"lat": pt["lat"], "lng": pt["lng"], "score": r["score"]}
        for pt, r in zip(sampled, scored)
    ]

    start_meta = _rule_based_safety_score(points[0]["lat"], points[0]["lng"])

    return jsonify({
        "route": route,
        "segment_scores": segment_scores,
        "overall_safety": (weighted_safety / weight_total) if weight_total else None,
        "distance_km": total_km,
        "duration_min": total_min if any_duration else None,
        "nearest_police_km": start_meta.get("nearest_police_km"),
        "osrm_error": osrm_error,
        "stops": points,
        "legs": legs,
        # Flat text list keeps older callers working; leg_instructions carries the
        # structured steps (with maneuver coordinates) that live navigation needs.
        "instructions": [st["text"] for leg in instructions for st in leg["steps"]],
        "leg_instructions": instructions,
        "travel_mode": mode,
    }), 200


# ============================
# HOSPITALS (ACCIDENT DASHBOARD)
# ============================
@app.route("/api/hospitals-nearby", methods=["GET"])
def hospitals_nearby():
    try:
        lat = float(request.args.get("lat"))
        lng = float(request.args.get("lng"))
    except Exception:
        return jsonify({"error": "lat and lng required"}), 400

    hospitals = _load_hospitals()
    enriched = []
    for h in hospitals:
        d_m = _haversine_m(lat, lng, h["lat"], h["lng"])
        enriched.append({**h, "distance_km": d_m / 1000.0})
    enriched.sort(key=lambda x: x["distance_km"])
    return jsonify({"hospitals": enriched[:10]}), 200


# ============================
# EMERGENCY / SOS (MVP LOGGING)
# ============================
def _log_sos(user_id, lat, lng, message):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO sos_alerts (user_id, lat, lng, message, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, lat, lng, message, int(time.time())))
    sos_id = cur.lastrowid
    conn.commit()
    conn.close()
    _schedule_retrain("new SOS alert")
    return sos_id


# ============================
# PROXIMITY ALERTING
# ============================
# Trusted contacts hang off saved places (Home, Hostel, College), and each place
# has coordinates. So "who is closest to the user right now" is answerable
# without asking contacts to share their live location: rank every contact by
# how far their place sits from where the SOS fired.
#
# The people inside INNER_RADIUS_KM are the ones who can physically get there,
# so they go out first and alone. Everyone else follows a few seconds later —
# far enough behind that the nearest phone is the first to ring, close enough
# that nobody is left out if the near contact does not pick up.
DEFAULT_ALERT_RADIUS_KM = 30.0
SECOND_WAVE_DELAY_S = 20.0


def _rank_contacts_by_distance(user_id, lat, lng, radius_km):
    """Every trusted contact of this user, nearest place first.

    Contacts on a place with no coordinates cannot be ranked, so they sort last
    with distance None rather than being dropped — an unplaceable contact is
    still someone who should hear about an SOS.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT c.id, c.name, c.phone, c.email,
                   l.label AS location_label, l.lat AS loc_lat, l.lng AS loc_lng
            FROM trusted_contacts c
            JOIN locations l ON l.id = c.location_id
            WHERE l.user_id = ?
        """, (int(user_id),))
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    ranked = []
    for r in rows:
        if r["loc_lat"] is None or r["loc_lng"] is None:
            distance_km = None
        else:
            distance_km = _haversine_m(lat, lng, float(r["loc_lat"]), float(r["loc_lng"])) / 1000.0
        ranked.append({
            "contact_id": r["id"],
            "name": r["name"],
            "phone": r["phone"],
            "email": r["email"],
            "location_label": r["location_label"],
            "distance_km": None if distance_km is None else round(distance_km, 2),
        })

    # None sorts last; everything else nearest first.
    ranked.sort(key=lambda c: (c["distance_km"] is None, c["distance_km"] or 0.0))

    for c in ranked:
        d = c["distance_km"]
        c["wave"] = 1 if (d is not None and d <= radius_km) else 2

    # If nobody fell inside the radius — the user is far from every saved place,
    # which is exactly the highway case — the single nearest contact is promoted
    # into wave 1 so the alert still has a first responder rather than one flat
    # delayed blast.
    if ranked and not any(c["wave"] == 1 for c in ranked):
        ranked[0]["wave"] = 1

    return ranked


def _dispatch_contact(contact):
    """Hand one alert to a delivery channel.

    The SMS/WhatsApp gateway plugs in here and nowhere else: ranking, waves and
    logging above stay untouched when it does. Until then a contact is recorded
    as queued, which is honest about what happened rather than claiming a text
    was sent.
    """
    channel = "sms" if contact.get("phone") else ("email" if contact.get("email") else None)
    if channel is None:
        return "failed", None
    return "queued", channel


def _record_notifications(sos_id, contacts):
    now = int(time.time())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("BEGIN")
        for c in contacts:
            cur.execute("""
                INSERT INTO sos_notifications
                    (sos_id, contact_id, contact_name, contact_phone, contact_email,
                     location_label, distance_km, wave, channel, status, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sos_id, c["contact_id"], c["name"], c.get("phone"), c.get("email"),
                c.get("location_label"), c.get("distance_km"), c["wave"],
                c.get("channel"), c.get("status", "queued"), now,
            ))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _send_wave(sos_id, contacts):
    """Dispatch one wave and log the outcome per contact."""
    for c in contacts:
        status, channel = _dispatch_contact(c)
        c["status"] = status
        c["channel"] = channel
    try:
        _record_notifications(sos_id, contacts)
    except Exception as e:
        # A logging failure must never swallow the alert itself.
        print(f"[sos] could not record notifications: {e}")


def _alert_trusted_contacts(sos_id, user_id, lat, lng, radius_km):
    """Rank, dispatch and log. Returns the waves for the client to display.

    Wave 1 goes out inside the request. Wave 2 is handed to a background timer
    so the response — and therefore the user's own confirmation that help was
    called — never waits on the stagger.
    """
    ranked = _rank_contacts_by_distance(user_id, lat, lng, radius_km)
    if not ranked:
        return []

    first = [c for c in ranked if c["wave"] == 1]
    rest = [c for c in ranked if c["wave"] == 2]

    _send_wave(sos_id, first)

    if rest:
        threading.Timer(
            SECOND_WAVE_DELAY_S, _send_wave, args=(sos_id, rest)
        ).start()
        for c in rest:
            c["status"] = "scheduled"
            c["channel"] = "sms" if c.get("phone") else ("email" if c.get("email") else None)

    waves = []
    for wave_no, members in ((1, first), (2, rest)):
        if not members:
            continue
        waves.append({
            "wave": wave_no,
            "radius_km": radius_km if wave_no == 1 else None,
            "delay_s": 0 if wave_no == 1 else SECOND_WAVE_DELAY_S,
            "contacts": members,
        })
    return waves


@app.route("/api/emergency/sos-safety", methods=["POST"])
def sos_safety():
    data = request.json or {}
    user_id = data.get("user_id")
    lat = data.get("lat")
    lng = data.get("lng")
    if user_id is None or lat is None or lng is None:
        return jsonify({"error": "user_id, lat, lng required"}), 400

    try:
        user_id = int(user_id)
        lat = float(lat)
        lng = float(lng)
    except Exception:
        return jsonify({"error": "Invalid values"}), 400

    try:
        radius_km = float(data.get("radius_km") or DEFAULT_ALERT_RADIUS_KM)
    except Exception:
        radius_km = DEFAULT_ALERT_RADIUS_KM

    meta = _rule_based_safety_score(lat, lng)
    msg = f"SAFETY SOS: user={user_id} at {lat},{lng} (score={round(meta['score'])}%)"
    sos_id = _log_sos(user_id, lat, lng, msg)

    waves = _alert_trusted_contacts(sos_id, user_id, lat, lng, radius_km)
    notified = sum(len(w["contacts"]) for w in waves)
    nearest = waves[0]["contacts"][0] if waves and waves[0]["contacts"] else None

    return jsonify({
        "message": "SOS logged and trusted contacts alerted nearest-first.",
        "sos_id": sos_id,
        "nearest_police_km": meta.get("nearest_police_km"),
        "score": meta.get("score"),
        "radius_km": radius_km,
        "notified_count": notified,
        "nearest_contact": nearest,
        "waves": waves,
    }), 200


@app.route("/api/emergency/sos/<int:sos_id>/notifications", methods=["GET"])
def sos_notifications(sos_id):
    """Who was alerted for one SOS, in the order they were alerted."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM sos_notifications
            WHERE sos_id = ?
            ORDER BY wave, (distance_km IS NULL), distance_km
        """, (sos_id,))
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return jsonify(rows), 200


@app.route("/api/emergency/sos-accident", methods=["POST"])
def sos_accident():
    data = request.json or {}
    user_id = data.get("user_id")
    lat = data.get("lat")
    lng = data.get("lng")
    if user_id is None or lat is None or lng is None:
        return jsonify({"error": "user_id, lat, lng required"}), 400

    try:
        user_id = int(user_id)
        lat = float(lat)
        lng = float(lng)
    except Exception:
        return jsonify({"error": "Invalid values"}), 400

    hospitals = _load_hospitals()
    enriched = []
    for h in hospitals:
        d_m = _haversine_m(lat, lng, h["lat"], h["lng"])
        enriched.append({**h, "distance_km": d_m / 1000.0})
    enriched.sort(key=lambda x: x["distance_km"])
    top3 = enriched[:3]

    msg = f"ACCIDENT SOS: user={user_id} at {lat},{lng}. Nearest hospitals: {[h['name'] for h in top3]}"
    _log_sos(user_id, lat, lng, msg)

    return jsonify({
        "message": "Accident SOS logged (MVP). Integrate ambulance/police messaging next.",
        "hospitals": top3,
    }), 200


@app.route("/api/emergency/accident-third-party", methods=["POST"])
def accident_third_party():
    data = request.json or {}
    lat = data.get("lat")
    lng = data.get("lng")
    label = data.get("label") or ""
    if lat is None or lng is None:
        return jsonify({"error": "lat, lng required"}), 400
    try:
        lat = float(lat)
        lng = float(lng)
    except Exception:
        return jsonify({"error": "Invalid values"}), 400

    # For third party, log with user_id=0 (system) for now
    msg = f"THIRD-PARTY ACCIDENT: location={label} at {lat},{lng}"
    _log_sos(0, lat, lng, msg)
    return jsonify({"message": "Third-party accident logged (MVP)."}), 200


# ============================
# SAFECAM (EVIDENCE VAULT) - MVP
# ============================
@app.route("/safecam/login", methods=["POST"])
def safecam_login():
    data = request.json or {}
    user_id = data.get("user_id")
    password = data.get("password")
    if not user_id or not password:
        return jsonify({"error": "user_id and password required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE id = ?", (int(user_id),))
    user = cur.fetchone()
    conn.close()

    if not user:
        return jsonify({"error": "User not found"}), 404
    if not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid password"}), 401

    return jsonify({"message": "OK"}), 200


@app.route("/safecam/upload", methods=["POST"])
def safecam_upload():
    data = request.json or {}
    user_id = data.get("user_id")
    image = data.get("image_base64")
    lat = data.get("lat")
    lng = data.get("lng")
    if not user_id or not image:
        return jsonify({"error": "user_id and image_base64 required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO evidence (user_id, image_base64, lat, lng, accuracy, type, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (int(user_id), image, lat, lng, None, "NORMAL", int(time.time())))
    conn.commit()
    conn.close()
    return jsonify({"message": "Saved"}), 201


@app.route("/api/safecam/upload-frame", methods=["POST"])
def safecam_upload_frame():
    data = request.json or {}
    user_id = data.get("user_id")
    image = data.get("image_base64")
    lat = data.get("lat")
    lng = data.get("lng")
    if not user_id or not image:
        return jsonify({"error": "user_id and image_base64 required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO evidence (user_id, image_base64, lat, lng, accuracy, type, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (int(user_id), image, lat, lng, None, "SOS", int(time.time())))
    conn.commit()
    conn.close()
    return jsonify({"message": "Saved"}), 201


@app.route("/safecam/auth/google", methods=["GET"])
def safecam_google_auth_stub():
    # Placeholder until you wire real Google OAuth from your friend's SafeCam module
    return jsonify({
        "message": "Google auth not wired yet in backend. Add OAuth flow here."
    }), 501


# ============================
# UPDATE PROFILE
# ============================
@app.route("/api/update-profile", methods=["POST"])
def update_profile():

    data = request.json or {}

    user_id = data.get("user_id")
    name = data.get("name")
    phone = data.get("phone")
    address = data.get("address")

    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT name, phone, address FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "User not found"}), 404
    n = name if name is not None else (row[0] or "")
    p = phone if phone is not None else (row[1] or "")
    a = address if address is not None else (row[2] or "")
    cur.execute("UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?", (n, p, a, user_id))

    conn.commit()
    conn.close()

    return jsonify({"message": "Profile updated"})


# ============================
# REPORTS
# ============================
@app.route("/api/reports", methods=["POST"])
def create_report():

    data = request.json or {}

    user_id = data.get("user_id")
    location_label = data.get("location_label")
    lat = data.get("lat")
    lng = data.get("lng")
    description = data.get("description")
    image_base64 = data.get("image_base64")
    timestamp = data.get("timestamp")

    if not user_id or not description:
        return jsonify({"error": "user_id and description required"}), 400

    if not timestamp:
        import time
        timestamp = int(time.time())

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO reports
        (user_id, location_label, lat, lng, description, image_base64, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (user_id, location_label, lat, lng, description, image_base64, timestamp))

    conn.commit()
    conn.close()

    # Feedback loop: retrain model so it learns from this incident
    _schedule_retrain("new report")

    return jsonify({"message": "Report submitted successfully"}), 201


# ============================
# FRONTEND ROUTES (Must be last to not interfere with API routes)
# ============================

# The React app in web/ builds to web/dist. When that build exists it is the
# frontend; the legacy frontend/html pages still win if they are present.
WEB_DIST_DIR = os.path.join(BASE_DIR, "web", "dist")


def _spa_index():
    """Serve the built React app, or explain how to start it if it isn't built."""
    if os.path.exists(os.path.join(WEB_DIST_DIR, "index.html")):
        return send_from_directory(WEB_DIST_DIR, "index.html")
    return (
        "<h1>ProTego API is running</h1>"
        "<p>The web app has not been built yet.</p>"
        "<p>For development run <code>npm run dev</code> from the ProTego folder, "
        "then open <a href='http://localhost:5173'>http://localhost:5173</a>.</p>"
        "<p>For a production build run <code>npm run build</code>, then reload this page.</p>",
        200,
    )


# Serve HTML files - serve from html subdirectory to match relative paths
@app.route("/")
def index():
    """Serve index.html as the home page"""
    legacy = os.path.join(FRONTEND_DIR, "html", "index.html")
    if os.path.exists(legacy):
        return send_from_directory(os.path.join(FRONTEND_DIR, "html"), "index.html")
    return _spa_index()

@app.route("/<path:filename>")
def serve_html(filename):
    """Serve HTML files from frontend/html - catch-all route must be last"""
    # Don't interfere with API routes
    if filename.startswith("api/"):
        return "API route not found", 404

    # Check if it's an HTML file
    if filename.endswith(".html"):
        html_path = os.path.join(FRONTEND_DIR, "html", filename)
        if os.path.exists(html_path):
            return send_from_directory(os.path.join(FRONTEND_DIR, "html"), filename)
    # If no extension, try to serve as HTML file
    elif "." not in filename:
        html_path = os.path.join(FRONTEND_DIR, "html", f"{filename}.html")
        if os.path.exists(html_path):
            return send_from_directory(os.path.join(FRONTEND_DIR, "html"), f"{filename}.html")

    # Fall through to the built React app: real files are served as-is, and any
    # unknown path gets index.html so client-side routing works on refresh.
    dist_path = os.path.join(WEB_DIST_DIR, filename)
    if os.path.isfile(dist_path):
        return send_from_directory(WEB_DIST_DIR, filename)
    if "." not in filename:
        return _spa_index()
    return "File not found", 404


# The retrain loop must start however the app was launched — `python app.py`
# locally, or gunicorn importing this module in production.
_start_periodic_retrain()


# ============================
# AUTO-OPEN BROWSER
# ============================
def open_browser():
    """Open browser after a short delay to ensure server is ready"""
    time.sleep(1.5)
    webbrowser.open("http://127.0.0.1:5001/")

# ============================
# RUN SERVER
# ============================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))

    # `npm run dev` starts this as an API server and opens Vite's URL instead,
    # so it sets NO_BROWSER=1 to keep a second tab from popping up.
    if port == 5001 and os.environ.get("NO_BROWSER") != "1":
        # Start browser only when running locally
        browser_thread = threading.Thread(target=open_browser)
        browser_thread.daemon = True
        browser_thread.start()

    print("=" * 50)
    print("🚀 SafeWalk Server Starting...")
    print("=" * 50)
    print(f"📁 Frontend directory: {FRONTEND_DIR}")
    print(f"🌐 Server running at: http://127.0.0.1:{port}/")
    print(f"📊 API endpoint: http://127.0.0.1:{port}/api/health")
    print("=" * 50)
    if port == 5001 and os.environ.get("NO_BROWSER") != "1":
        print("✨ Browser will open automatically...")
    print("=" * 50)
    
    app.run(host="0.0.0.0", port=port, debug=(port == 5001), use_reloader=False)