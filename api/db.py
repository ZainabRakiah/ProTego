import os
import json
import time

# ---------------------------------------------------------------------------
# Firebase Admin SDK initialisation
# ---------------------------------------------------------------------------
# Reads credentials from the FIREBASE_CREDENTIALS environment variable
# (the full JSON string of the service-account key).
# ---------------------------------------------------------------------------

_firestore_client = None


def _init_firebase():
    """Initialise the Firebase Admin SDK exactly once."""
    global _firestore_client

    import firebase_admin
    from firebase_admin import credentials, firestore

    if _firestore_client is not None:
        return

    creds_json = os.environ.get("FIREBASE_CREDENTIALS")
    if not creds_json:
        raise ValueError(
            "FIREBASE_CREDENTIALS environment variable is required. "
            "Paste the full JSON of your Firebase service-account key."
        )

    creds_dict = json.loads(creds_json)
    cred = credentials.Certificate(creds_dict)

    # Avoid double-init if the default app already exists
    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(cred)

    _firestore_client = firestore.client()


def get_db():
    """Return the Firestore client, initialising on first call."""
    if _firestore_client is None:
        _init_firebase()
    return _firestore_client


def init_db():
    """Ensure Firebase is initialised.

    Firestore is schemaless so there are no tables to create — this just
    makes sure the SDK is ready.
    """
    _init_firebase()


# ---------------------------------------------------------------------------
# Tiny helpers that keep index.py readable
# ---------------------------------------------------------------------------

def add_document(collection: str, data: dict) -> str:
    """Add a document and return its auto-generated ID."""
    db = get_db()
    _, doc_ref = db.collection(collection).add(data)
    return doc_ref.id


def get_document(collection: str, doc_id: str):
    """Fetch a single document by ID.  Returns dict | None."""
    db = get_db()
    doc = db.collection(collection).document(doc_id).get()
    if doc.exists:
        d = doc.to_dict()
        d["id"] = doc.id
        return d
    return None


def query_collection(collection: str, field: str, op: str, value):
    """Return list[dict] for a simple single-field query."""
    db = get_db()
    docs = db.collection(collection).where(field, op, value).stream()
    results = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        results.append(d)
    return results


def update_document(collection: str, doc_id: str, data: dict):
    """Merge-update fields on an existing document."""
    db = get_db()
    db.collection(collection).document(doc_id).update(data)


def delete_document(collection: str, doc_id: str):
    """Delete a document by ID."""
    db = get_db()
    db.collection(collection).document(doc_id).delete()
