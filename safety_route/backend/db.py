import sqlite3
import os

DB_NAME = os.path.join(os.path.dirname(__file__), "database.db")


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    # ========= USERS =========
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password_hash TEXT NOT NULL
        )
    """)

    # ========= EVIDENCE (photos from camera) =========
    cur.execute("""
        CREATE TABLE IF NOT EXISTS evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            image_base64 TEXT NOT NULL,
            lat REAL,
            lng REAL,
            accuracy REAL,
            type TEXT NOT NULL,      -- NORMAL or SOS
            timestamp INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ========= SAVED LOCATIONS (Home / Hostel / College etc.) =========
    cur.execute("""
        CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            lat REAL,
            lng REAL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    # ========= TRUSTED CONTACTS FOR EACH LOCATION =========
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

    # ========= SOS ALERT LOGS =========
    # user_id is now nullable to allow anonymous SOS alerts
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sos_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            message TEXT,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)
    
    # If you have an existing database with user_id NOT NULL constraint,
    # you may need to manually update it or delete database.db to recreate

    conn.commit()
    conn.close()
