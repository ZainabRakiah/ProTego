import sqlite3
import os

# Always use the project-root database file,
# regardless of where the server is started from.
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DB_NAME = os.path.join(PROJECT_ROOT, "database.db")


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    # =========================
    # USERS
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    except sqlite3.OperationalError:
        pass  # Column already exists

    # =========================
    # EVIDENCE (NORMAL + SOS)
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            image_base64 TEXT NOT NULL,
            lat REAL,
            lng REAL,
            accuracy REAL,
            type TEXT NOT NULL,          -- NORMAL or SOS
            timestamp INTEGER NOT NULL,

            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # =========================
    # SAVED LOCATIONS (Home, Hostel, College, etc.)
    # =========================
    cur.execute("""
        CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            label TEXT NOT NULL,         -- Home / Hostel / College
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    conn.commit()
    conn.close()
