import psycopg2
import psycopg2.extras
import os

def get_db():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable is required")
        
    conn = psycopg2.connect(db_url, cursor_factory=psycopg2.extras.DictCursor)
    conn.autocommit = True
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()

    # =========================
    # USERS
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            address TEXT,
            password_hash TEXT NOT NULL
        )
    """)
    
    # Add address column if it doesn't exist (for existing databases)
    try:
        cur.execute("ALTER TABLE users ADD COLUMN address TEXT")
    except Exception:
        pass  # Column already exists

    # =========================
    # EVIDENCE (NORMAL + SOS)
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS evidence (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            image_base64 TEXT NOT NULL,
            lat REAL,
            lng REAL,
            accuracy REAL,
            type TEXT NOT NULL,
            timestamp INTEGER NOT NULL,

            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # =========================
    # SAVED LOCATIONS (Home, Hostel, College, etc.)
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS locations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            lat REAL,
            lng REAL,

            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # =========================
    # TRUSTED CONTACTS PER LOCATION
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS trusted_contacts (
            id SERIAL PRIMARY KEY,
            location_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,

            FOREIGN KEY(location_id) REFERENCES locations(id)
        )
    """)

    # =========================
    # SOS ALERT LOGS
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sos_alerts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            lat REAL,
            lng REAL,
            message TEXT,
            timestamp INTEGER NOT NULL,

            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # =========================
    # REPORTS (User Reports)
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            location_label TEXT,
            lat REAL,
            lng REAL,
            description TEXT NOT NULL,
            image_base64 TEXT,
            timestamp INTEGER NOT NULL,

            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    conn.close()
