from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

from db import get_db, init_db

app = Flask(__name__)
CORS(app)

# Initialize database
init_db()


# ============================
# HEALTH CHECK
# ============================
@app.route("/")
def home():
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

    return jsonify({
        "message": "Login successful",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "phone": user["phone"]
        }
    }), 200


# ============================
# EVIDENCE (NORMAL / SOS)
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
    """, (
        user_id, image, lat, lng, accuracy, evidence_type, timestamp
    ))
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
    conn.commit()
    conn.close()

    return jsonify({"message": "Location added"}), 201


@app.route("/api/locations/<int:user_id>", methods=["GET"])
def get_locations(user_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM locations WHERE user_id = ?", (user_id,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows]), 200


@app.route("/api/locations/<int:loc_id>", methods=["DELETE"])
def delete_location(loc_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM locations WHERE id = ?", (loc_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Location deleted"}), 200


# ============================
# TRUSTED CONTACTS
# ============================
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


@app.route("/api/contacts/<int:location_id>", methods=["GET"])
def get_contacts(location_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT * FROM trusted_contacts WHERE location_id = ?
    """, (location_id,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows]), 200


@app.route("/api/contacts/<int:contact_id>", methods=["DELETE"])
def delete_contact(contact_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM trusted_contacts WHERE id = ?", (contact_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Contact deleted"}), 200


# ============================
# SOS ALERT LOG
# ============================
@app.route("/api/sos", methods=["POST"])
def save_sos():
    data = request.json or {}

    user_id = data.get("user_id")
    lat = data.get("lat")
    lng = data.get("lng")
    message = data.get("message")
    timestamp = data.get("timestamp")

    if not user_id or not lat or not lng or not message or not timestamp:
        return jsonify({"error": "Missing fields"}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO sos_alerts
        (user_id, lat, lng, message, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, lat, lng, message, timestamp))
    conn.commit()
    conn.close()

    return jsonify({"message": "SOS logged"}), 201


# ============================
# RUN SERVER
# ============================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
