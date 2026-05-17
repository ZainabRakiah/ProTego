# backend/app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import os
import joblib
import pandas as pd
import numpy as np
import requests
import traceback

from db import get_db, init_db

# ======================================================
# APP SETUP
# ======================================================
app = Flask(__name__)
CORS(app)

init_db()

# ======================================================
# PATHS
# ======================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_DIR_PARENT = os.path.join(BASE_DIR, "..", "data")

MODEL_PATH = os.path.join(BASE_DIR, "safety_model.pkl")
GRID_PATH = os.path.join(DATA_DIR, "grid_features.csv")
GRID_PATH_FALLBACK = os.path.join(DATA_DIR_PARENT, "grid_features.csv")

# ======================================================
# ML LOAD
# ======================================================
safety_model = None
grid_df = None

GRID_STEP = 0.0015


def load_ml():
    global safety_model, grid_df
    try:
        if os.path.exists(MODEL_PATH):
            safety_model = joblib.load(MODEL_PATH)
            print("✅ Safety model loaded")
        else:
            print("❌ Safety model file not found:", MODEL_PATH)
            safety_model = None

        grid_path = GRID_PATH if os.path.exists(GRID_PATH) else GRID_PATH_FALLBACK
        if os.path.exists(grid_path):
            grid_df = pd.read_csv(grid_path)
            print(f"✅ Grid features loaded: {len(grid_df)} cells from {grid_path}")
        else:
            print("⚠️ grid_features.csv not found – run generate_grid_features.py to create it")
            grid_df = None

    except Exception as e:
        print(f"❌ ML load failed: {e}")
        traceback.print_exc()


load_ml()

# ======================================================
# HELPERS
# ======================================================
def make_cell(lat, lng):
    return (
        round(lat / GRID_STEP) * GRID_STEP,
        round(lng / GRID_STEP) * GRID_STEP,
    )


def get_cell_features(lat, lon):
    """Return [crime_score, camera_count, police_score]."""
    if grid_df is None:
        return [0.0, 0.0, 0.0]

    cell = make_cell(lat, lon)
    row = grid_df[
        (grid_df["cell_lat"] == cell[0]) & (grid_df["cell_lon"] == cell[1])
    ]

    if row.empty:
        return [0.0, 0.0, 0.0]

    r = row.iloc[0]

    crime_score = float(r.get("incident_count", 0.0))
    camera_count = float(r.get("camera_count", 0.0))
    police_score = float(r.get("police_count", 0.0))

    return [crime_score, camera_count, police_score]

# ======================================================
# ROOT
# ======================================================
@app.route("/")
def home():
    return "✅ SafeWalk Backend Running"


# ======================================================
# AUTH (unchanged)
# ======================================================
@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.json or {}
    name, email, phone, password = (
        data.get("name"),
        data.get("email"),
        data.get("phone"),
        data.get("password"),
    )

    if not name or not email or not password:
        return jsonify({"error": "Missing fields"}), 400

    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO users (name, email, phone, password_hash)
            VALUES (?, ?, ?, ?)
        """, (name, email, phone, generate_password_hash(password)))
        conn.commit()
        conn.close()
        return jsonify({"message": "User created"}), 201
    except Exception as e:
        print("Signup error:", e)
        return jsonify({"error": "Email already exists"}), 409


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    email, password = data.get("email"), data.get("password")

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cur.fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid credentials"}), 401

    return jsonify({
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "phone": user["phone"]
        }
    }), 200


# ======================================================
# ML – POINT SAFETY SCORE (LIVE GPS)
# ======================================================
@app.route("/api/safety-score", methods=["POST"])
def safety_score_point():
    if safety_model is None or grid_df is None:
        return jsonify({"error": "Safety model not loaded"}), 500

    data = request.json
    lat = data.get("lat")
    lng = data.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "lat & lng required"}), 400

    features = np.array([ get_cell_features(lat, lng) ])

    try:
        score = float(safety_model.predict(features)[0])
        score = round(np.clip(score, 1, 10), 2)
        return jsonify({"safety_score": score})
    except Exception as e:
        print("Safety score predict failed:", e)
        traceback.print_exc()
        return jsonify({"error": "Prediction failed"}), 500


# ======================================================
# ROUTE PROXY (GraphHopper)
# ======================================================
@app.route("/api/route")
def route_proxy():
    """
    Query params:
      start = "<lng>,<lat>"
      end   = "<lng>,<lat>"
    Returns JSON with `routes[0].geometry` in GeoJSON LineString form:
      { "routes": [ { "geometry": { "type":"LineString", "coordinates":[...] } } ] }
    """
    try:
        start = request.args.get("start")
        end = request.args.get("end")

        if not start or not end:
            return jsonify({"error": "start and end query params required"}), 400

        # parse start/end into floats
        try:
            start_lng, start_lat = map(float, start.split(","))
            end_lng, end_lat = map(float, end.split(","))
        except Exception as e:
            return jsonify({"error": "start/end must be 'lng,lat' floats", "details": str(e)}), 400

        GH_KEY = os.environ.get("GRAPHOPPER_KEY")
        if not GH_KEY:
            return jsonify({"error": "GraphHopper API key missing (set GRAPHOPPER_KEY)"}), 500

        gh_url = (
            "https://graphhopper.com/api/1/route?"
            f"point={start_lat},{start_lng}&point={end_lat},{end_lng}"
            "&profile=foot&locale=en&calc_points=true&geometry_format=geojson"
            f"&key={GH_KEY}"
        )

        r = requests.get(gh_url, timeout=15)
        if r.status_code != 200:
            print("GraphHopper returned:", r.status_code, r.text)
            return jsonify({"error": "GraphHopper routing failed", "details": r.text}), 502

        data = r.json()
        if "paths" not in data or len(data["paths"]) == 0:
            return jsonify({"error": "GraphHopper returned no paths", "details": data}), 502

        geometry = data["paths"][0].get("points")
        # geometry is already a GeoJSON geometry (type: LineString, coordinates: [...])
        return jsonify({
            "routes": [
                {"geometry": geometry}
            ],
            "source": "graphhopper"
        }), 200

    except Exception as e:
        print("Route proxy exception:", e)
        traceback.print_exc()
        return jsonify({"error": "Routing failed", "details": str(e)}), 500


# ======================================================
# ML – ROUTE SAFETY SCORE
# ======================================================
@app.route("/api/score-route", methods=["POST"])
def score_route():
    if safety_model is None:
        return jsonify({"error": "Safety model not loaded. Check backend logs."}), 500
    
    if grid_df is None:
        return jsonify({"error": "Grid features not loaded. Run generate_grid_features.py first."}), 500

    data = request.json or {}
    coords = data.get("coords")

    if not coords:
        return jsonify({"error": "coords required"}), 400

    if not isinstance(coords, list) or len(coords) == 0:
        return jsonify({"error": "coords must be a non-empty array"}), 400

    try:
        # Sample coordinates if route is very long (to avoid processing too many points)
        if len(coords) > 1000:
            step = len(coords) // 1000
            coords = coords[::step]
        
        X = np.array([get_cell_features(p[0], p[1]) for p in coords])
        
        if X.shape[0] == 0:
            return jsonify({"error": "No valid coordinates to score"}), 400
        
        preds = safety_model.predict(X)
        
        # Clip scores to valid range (1-10) and calculate mean
        preds_clipped = np.clip(preds, 1, 10)
        avg_score = float(np.mean(preds_clipped))
        
        return jsonify({
            "score": round(avg_score, 2),
            "segments": [round(float(x), 2) for x in preds_clipped[:100]]  # Limit segments for response size
        })
    except Exception as e:
        print(f"Error scoring route: {e}")
        traceback.print_exc()
        return jsonify({"error": f"Failed to calculate safety score: {str(e)}"}), 500


# ======================================================
# SOS ALERT
# ======================================================
@app.route("/api/sos", methods=["POST"])
def sos():
    try:
        d = request.json or {}
        
        # Validate required fields
        lat = d.get("lat")
        lng = d.get("lng")
        timestamp = d.get("timestamp")
        
        if lat is None or lng is None:
            return jsonify({"error": "Latitude and longitude are required"}), 400
        
        if timestamp is None:
            return jsonify({"error": "Timestamp is required"}), 400
        
        # user_id is optional (can be None for anonymous users)
        user_id = d.get("user_id")
        message = d.get("message", "HELP ME")
        
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO sos_alerts (user_id, lat, lng, message, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, (
            user_id, lat, lng, message, timestamp
        ))
        conn.commit()
        last_id = cur.lastrowid
        conn.close()
        
        return jsonify({
            "message": "🚨 SOS alert sent successfully",
            "alert_id": last_id
        }), 201
        
    except Exception as e:
        print(f"Error processing SOS alert: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to process SOS alert"}), 500


# ======================================================
# ML – SAFETY GRID (heatmap data)
# ======================================================
@app.route("/api/safety-grid", methods=["GET"])
def safety_grid():
    """Return grid points with ML-predicted safety scores (0–100) for heatmap coloring."""
    if safety_model is None:
        return jsonify({"error": "Safety model not loaded"}), 500
    if grid_df is None:
        return jsonify({"error": "Grid features not loaded"}), 500

    try:
        min_lat = float(request.args.get("minLat", 12.8))
        max_lat = float(request.args.get("maxLat", 13.2))
        min_lng = float(request.args.get("minLng", 77.4))
        max_lng = float(request.args.get("maxLng", 77.8))
    except (TypeError, ValueError):
        return jsonify({"error": "minLat, maxLat, minLng, maxLng required as floats"}), 400

    # Filter grid to view bounds
    mask = (
        (grid_df["cell_lat"] >= min_lat) & (grid_df["cell_lat"] <= max_lat)
        & (grid_df["cell_lon"] >= min_lng) & (grid_df["cell_lon"] <= max_lng)
    )
    subset = grid_df[mask]
    if subset.empty:
        return jsonify({"points": []}), 200

    X = subset[["incident_count", "camera_count", "police_count"]].values
    preds = safety_model.predict(X)
    preds_clipped = np.clip(preds, 1, 10)

    # Convert 1–10 to 0–100 so heatmap colors work: red(<25) yellow(<50) blue(<75) green(>=75)
    scores_pct = ((preds_clipped - 1) / 9 * 100).astype(float)

    points = [
        {
            "lat": float(row["cell_lat"]),
            "lng": float(row["cell_lon"]),
            "score": round(float(s), 1),
        }
        for row, s in zip(subset.to_dict("records"), scores_pct)
    ]
    return jsonify({"points": points}), 200


# ======================================================
# RELOAD ML MODEL (for development)
# ======================================================
@app.route("/api/reload-ml", methods=["POST"])
def reload_ml():
    load_ml()
    if safety_model is None or grid_df is None:
        return jsonify({"error": "Failed to reload ML model"}), 500
    return jsonify({"message": "ML model reloaded successfully"}), 200


# ======================================================
# RUN
# ======================================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
