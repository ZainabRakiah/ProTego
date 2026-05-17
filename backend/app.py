from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import os
import webbrowser
import threading
import time
import math
import csv
import json
import datetime
from functools import lru_cache
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from flask import Flask

app = Flask(__name__)

@app.route("/")
def home():
    return "ProTego deployed successfully!"

from db import get_db, init_db

# Get the project root directory (parent of backend)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=None)
CORS(app)

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


def _all_incident_points():
    """Combine ProTego incidents with user reports/SOS from DB."""
    pts = _load_protego_points()
    return pts["incident"] + _get_db_incident_points()


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


def _count_within(points, lat, lng, radius_m=500.0):
    # quick bounding box pre-filter
    lat_delta = radius_m / 111000.0
    lng_delta = radius_m / (111000.0 * max(0.1, math.cos(math.radians(lat))))
    min_lat, max_lat = lat - lat_delta, lat + lat_delta
    min_lng, max_lng = lng - lng_delta, lng + lng_delta

    count = 0
    nearest_m = None
    for (plat, plng) in points:
        if plat < min_lat or plat > max_lat or plng < min_lng or plng > max_lng:
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


def _is_night_hour(hour):
    # Night/evening influence for lamps
    return hour >= 18 or hour < 6


def _rule_based_safety_score(lat, lng, hour=None):
    pts = _load_protego_points()
    if hour is None:
        hour = datetime.datetime.now().hour
    night = _is_night_hour(hour)

    police_count, nearest_police_m = _count_within(pts["police"], lat, lng, 500.0)
    lamp_count, _nearest_lamp_m = _count_within(pts["lamp"], lat, lng, 500.0)
    camera_count, _nearest_cam_m = _count_within(pts["camera"], lat, lng, 500.0)
    incident_count, _nearest_inc_m = _count_within(_all_incident_points(), lat, lng, 500.0)

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

    # Optional ML refinement: combine with RandomForest prediction
    if _SAFETY_MODEL is not None:
        try:
            crime_density = incident_count / max(1, police_count + lamp_count + camera_count) if (police_count + lamp_count + camera_count) > 0 else incident_count
            ml_vec = [
                police_count,
                lamp_count,
                camera_count,
                incident_count,
                1 if night else 0,
                crime_density,
            ]
            ml_pred = float(_SAFETY_MODEL.predict([ml_vec])[0])
            # Blend rule-based and ML predictions
            score = 0.5 * score + 0.5 * ml_pred
        except Exception as e:
            # If anything goes wrong, fall back to rule-based score
            print(f"[safety-ml] Inference error: {e}")

    score = max(0.0, min(100.0, score))
    nearest_police_km = (nearest_police_m / 1000.0) if nearest_police_m is not None else None
    return {
        "score": score,
        "nearest_police_km": nearest_police_km,
        "features": {
            "police_count_500m": police_count,
            "lamp_count_500m": lamp_count,
            "camera_count_500m": camera_count,
            "incident_count_500m": incident_count,
            "is_night": 1 if night else 0,
        },
    }


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

        scores = []
        for (lng, lat) in samples:
            scores.append(_rule_based_safety_score(lat, lng)["score"])

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
    """Serve asset files from frontend/assets"""
    return send_from_directory(os.path.join(FRONTEND_DIR, "assets"), filename)

# Serve data files (for CSV, etc.) (must come before catch-all)
@app.route("/data/<path:filename>")
def serve_data(filename):
    """Serve data files from data directory"""
    return send_from_directory(os.path.join(BASE_DIR, "data"), filename)

# Serve FriendsNavigator (static mini-app)
@app.route("/friendsnavigator/")
def serve_friendsnavigator_index():
    return send_from_directory(os.path.join(BASE_DIR, "FreindsNavigator"), "index.html")

@app.route("/friendsnavigator/<path:filename>")
def serve_friendsnavigator_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "FreindsNavigator"), filename)

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

    name = data.get("name")
    email = data.get("email")
    phone = data.get("phone")
    password = data.get("password")

    if not name or not email or not password:
        return jsonify({"error": "Missing fields"}), 400

    password_hash = generate_password_hash(password)

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO users (name, email, phone, password_hash)
            VALUES (?, ?, ?, ?)
        """, (name, email, phone, password_hash))
        conn.commit()
        conn.close()

        return jsonify({"message": "User registered successfully"}), 201

    except Exception:
        return jsonify({"error": "Email already exists"}), 409


# ============================
# LOGIN
# ============================
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}

    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cur.fetchone()
    conn.close()

    if not user:
        return jsonify({"error": "User not found"}), 404

    if not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid password"}), 401

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
    cur = conn.cursor()

    # First delete all contacts for this location
    cur.execute("DELETE FROM trusted_contacts WHERE location_id = ?", (location_id,))
    
    # Then delete the location
    cur.execute("DELETE FROM locations WHERE id = ?", (location_id,))

    conn.commit()
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
    points = []

    # Limit work (avoid freezing)
    max_points = 250
    lat = min_lat
    while lat <= max_lat and len(points) < max_points:
        lng = min_lng
        while lng <= max_lng and len(points) < max_points:
            r = _rule_based_safety_score(lat, lng, hour=hour)
            points.append({"lat": lat, "lng": lng, "score": r["score"]})
            lng += step
        lat += step

    return jsonify({"points": points}), 200


# ============================
# SAFEST ROUTE (OSRM + SAFETY)
# ============================
@app.route("/api/safest-route", methods=["POST"])
def safest_route():
    data = request.json or {}
    start = data.get("start") or {}
    end = data.get("end") or {}
    try:
        start_lat = float(start.get("lat"))
        start_lng = float(start.get("lng"))
        end_lat = float(end.get("lat"))
        end_lng = float(end.get("lng"))
    except Exception:
        return jsonify({"error": "start/end lat,lng required"}), 400

    osrm_error = None
    try:
        route, meta = _pick_safest_osrm_route(
            {"lat": start_lat, "lng": start_lng},
            {"lat": end_lat, "lng": end_lng},
            alternatives=2
        )
    except Exception as e:
        # Fallback route (still deployable offline): straight-line with midpoint
        osrm_error = str(e)
        mid_lat = (start_lat + end_lat) / 2.0
        mid_lng = (start_lng + end_lng) / 2.0
        route = [{"lat": start_lat, "lng": start_lng}, {"lat": mid_lat, "lng": mid_lng}, {"lat": end_lat, "lng": end_lng}]
        # Estimate distance as sum of haversine segments
        dist_km = (_haversine_m(start_lat, start_lng, mid_lat, mid_lng) + _haversine_m(mid_lat, mid_lng, end_lat, end_lng)) / 1000.0
        meta = {"avg_safety": (_rule_based_safety_score(mid_lat, mid_lng)["score"]), "distance_km": dist_km, "duration_min": None, "steps": []}

    start_meta = _rule_based_safety_score(start_lat, start_lng)
    # Per-point safety scores for colored route segments (blue=safe, green=normal, red=unsafe)
    segment_scores = []
    step = max(1, len(route) // 30)
    for i in range(0, len(route), step):
        pt = route[i]
        s = _rule_based_safety_score(pt["lat"], pt["lng"])["score"]
        segment_scores.append({"lat": pt["lat"], "lng": pt["lng"], "score": s})
    if route and segment_scores and (segment_scores[-1]["lat"], segment_scores[-1]["lng"]) != (route[-1]["lat"], route[-1]["lng"]):
        pt = route[-1]
        segment_scores.append({"lat": pt["lat"], "lng": pt["lng"], "score": _rule_based_safety_score(pt["lat"], pt["lng"])["score"]})

    return jsonify({
        "route": route,
        "segment_scores": segment_scores,
        "overall_safety": meta.get("avg_safety"),
        "distance_km": meta.get("distance_km"),
        "duration_min": meta.get("duration_min"),
        "nearest_police_km": start_meta.get("nearest_police_km"),
        "osrm_error": osrm_error,
        "instructions": [
            (s.get("maneuver") or {}).get("instruction")
            for s in (meta.get("steps") or [])
            if (s.get("maneuver") or {}).get("instruction")
        ]
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
    conn.commit()
    conn.close()
    _schedule_retrain("new SOS alert")


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

    meta = _rule_based_safety_score(lat, lng)
    msg = f"SAFETY SOS: user={user_id} at {lat},{lng} (score={round(meta['score'])}%)"
    _log_sos(user_id, lat, lng, msg)

    return jsonify({
        "message": "SOS logged (MVP). Integrate SMS/WhatsApp next.",
        "nearest_police_km": meta.get("nearest_police_km"),
        "score": meta.get("score"),
    }), 200


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

# Serve HTML files - serve from html subdirectory to match relative paths
@app.route("/")
def index():
    """Serve index.html as the home page"""
    return send_from_directory(os.path.join(FRONTEND_DIR, "html"), "index.html")

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
    return "File not found", 404


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
    # Periodic retrain thread (grid-based ML learns from new data every 6h)
    retrain_thread = threading.Thread(target=_periodic_retrain_worker, daemon=True)
    retrain_thread.start()

    if port == 5001:
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
    if port == 5001:
        print("✨ Browser will open automatically...")
    print("=" * 50)
    
    app.run(host="0.0.0.0", port=port, debug=(port == 5001), use_reloader=False)