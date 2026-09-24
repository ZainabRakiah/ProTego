import os
import json
import time
import uuid
import sqlite3
import urllib.request
import urllib.parse
import urllib.error
from werkzeug.security import generate_password_hash
from google.oauth2 import service_account
import google.auth.transport.requests

# ---------------------------------------------------------------------------
# Lightweight Firebase Firestore REST Client + SQLite Fallback
# ---------------------------------------------------------------------------

_creds = None
_auth_request = None
_project_id = None

def get_db_path():
    """Returns a writable path for SQLite database (using /tmp on Vercel or read-only filesystems)."""
    default_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database.db")

    if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        tmp_db = os.path.join("/tmp", "database.db")
        if not os.path.exists(tmp_db) and os.path.exists(default_path):
            import shutil
            try:
                shutil.copy2(default_path, tmp_db)
            except Exception:
                pass
        return tmp_db

    try:
        db_dir = os.path.dirname(default_path)
        test_file = os.path.join(db_dir, ".write_test")
        with open(test_file, "w") as f:
            f.write("1")
        os.remove(test_file)
        return default_path
    except (OSError, IOError):
        tmp_db = os.path.join("/tmp", "database.db")
        if not os.path.exists(tmp_db) and os.path.exists(default_path):
            import shutil
            try:
                shutil.copy2(default_path, tmp_db)
            except Exception:
                pass
        return tmp_db


DB_PATH = get_db_path()


class FirebaseConfigurationError(RuntimeError):
    """Raised when Firestore credentials are required but not configured."""


def is_sqlite_mode():
    return not bool(os.environ.get("FIREBASE_CREDENTIALS"))


def get_sqlite_conn():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _init_sqlite():
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            collection TEXT NOT NULL,
            doc_id TEXT NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (collection, doc_id)
        )
    """)
    conn.commit()

    # Seed admin user if not exists
    cursor.execute("SELECT data FROM documents WHERE collection = 'users'")
    rows = cursor.fetchall()
    has_admin = False
    for r in rows:
        d = json.loads(r["data"])
        if d.get("email") == "admin@protego.com" or d.get("is_admin"):
            has_admin = True
            break

    if not has_admin:
        admin_id = "admin_user_id"
        admin_data = {
            "id": admin_id,
            "name": "System Administrator",
            "email": "admin@protego.com",
            "phone": "+10000000000",
            "password_hash": generate_password_hash("admin123"),
            "address": "Admin Command Center",
            "is_admin": True,
        }
        cursor.execute(
            "INSERT OR REPLACE INTO documents (collection, doc_id, data) VALUES (?, ?, ?)",
            ("users", admin_id, json.dumps(admin_data))
        )
        conn.commit()

    conn.close()


def _get_auth():
    """Initialise and refresh Google OAuth2 credentials from FIREBASE_CREDENTIALS."""
    global _creds, _auth_request, _project_id

    if is_sqlite_mode():
        return None, "sqlite-local"

    if _creds is None:
        creds_json = os.environ.get("FIREBASE_CREDENTIALS")
        if not creds_json:
            raise FirebaseConfigurationError(
                "FIREBASE_CREDENTIALS environment variable is required. "
                "Paste the full JSON of your Firebase service-account key."
            )
        creds_dict = json.loads(creds_json)
        _project_id = creds_dict.get("project_id", "protego-945bf")
        _creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/datastore"]
        )
        _auth_request = google.auth.transport.requests.Request()

    if not _creds.valid:
        _creds.refresh(_auth_request)

    return _creds.token, _project_id


def _py_to_firestore_val(v):
    if v is None:
        return {"nullValue": None}
    elif isinstance(v, bool):
        return {"booleanValue": v}
    elif isinstance(v, int):
        return {"integerValue": str(v)}
    elif isinstance(v, float):
        return {"doubleValue": v}
    elif isinstance(v, str):
        return {"stringValue": v}
    elif isinstance(v, list):
        return {"arrayValue": {"values": [_py_to_firestore_val(x) for x in v]}}
    elif isinstance(v, dict):
        return {"mapValue": {"fields": {k: _py_to_firestore_val(val) for k, val in v.items()}}}
    return {"stringValue": str(v)}


def _firestore_to_py_val(fv):
    if not isinstance(fv, dict):
        return fv
    if "stringValue" in fv:
        return fv["stringValue"]
    elif "integerValue" in fv:
        try:
            return int(fv["integerValue"])
        except ValueError:
            return fv["integerValue"]
    elif "doubleValue" in fv:
        return float(fv["doubleValue"])
    elif "booleanValue" in fv:
        return fv["booleanValue"]
    elif "nullValue" in fv:
        return None
    elif "arrayValue" in fv:
        return [_firestore_to_py_val(x) for x in fv["arrayValue"].get("values", [])]
    elif "mapValue" in fv:
        return {k: _firestore_to_py_val(v) for k, v in fv["mapValue"].get("fields", {}).items()}
    return None


def _firestore_doc_to_dict(doc):
    if not doc:
        return None
    fields = doc.get("fields", {})
    res = {k: _firestore_to_py_val(v) for k, v in fields.items()}
    name = doc.get("name", "")
    res["id"] = name.split("/")[-1] if "/" in name else ""
    return res


def _api_request(url, method="GET", data=None):
    token, _ = _get_auth()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        err_msg = e.read().decode("utf-8")
        print(f"[firestore-error] {method} {url} HTTP {e.code}: {err_msg}")
        raise


def get_db():
    """Compatibility interface for stream-like collections."""
    class FirestoreWrapper:
        def collection(self, col_name):
            class ColWrapper:
                def stream(self):
                    docs = get_all_documents(col_name)
                    class DocWrapper:
                        def __init__(self, d):
                            self._d = d
                            self.id = d.get("id")
                        def to_dict(self):
                            return self._d
                    return [DocWrapper(d) for d in docs]
            return ColWrapper()
    return FirestoreWrapper()


def init_db():
    """Ensure database connection/tables are initialised."""
    if is_sqlite_mode():
        _init_sqlite()
        print("[db-init] Using SQLite database at:", DB_PATH)
    else:
        try:
            _get_auth()
            print("[db-init] Using Firebase Firestore")
        except Exception as e:
            print(f"[firebase-warning] Deferred Firestore auth init: {e}")


# ---------------------------------------------------------------------------
# Core Document Operations
# ---------------------------------------------------------------------------

def add_document(collection: str, data: dict, custom_id: str = None) -> str:
    """Add a document and return its ID."""
    if is_sqlite_mode():
        doc_id = custom_id or str(uuid.uuid4())
        doc_data = dict(data)
        doc_data["id"] = doc_id
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO documents (collection, doc_id, data) VALUES (?, ?, ?)",
            (collection, doc_id, json.dumps(doc_data))
        )
        conn.commit()
        conn.close()
        return doc_id

    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}"
    if custom_id:
        url += f"?documentId={urllib.parse.quote(custom_id)}"
    payload = {"fields": {k: _py_to_firestore_val(v) for k, v in data.items()}}
    resp = _api_request(url, method="POST", data=payload)
    name = resp.get("name", "")
    return name.split("/")[-1] if "/" in name else (custom_id or "")


def get_document(collection: str, doc_id: str):
    """Fetch a single document by ID. Returns dict | None."""
    if is_sqlite_mode():
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT data FROM documents WHERE collection = ? AND doc_id = ?",
            (collection, str(doc_id))
        )
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        d = json.loads(row["data"])
        d["id"] = str(doc_id)
        return d

    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}/{doc_id}"
    resp = _api_request(url, method="GET")
    return _firestore_doc_to_dict(resp)


def query_collection(collection: str, field: str, op: str, value):
    """Return list[dict] for a simple single-field query."""
    if is_sqlite_mode():
        all_docs = get_all_documents(collection)
        res = []
        for doc in all_docs:
            val = doc.get(field)
            val_comp = str(val).lower() if isinstance(val, str) else val
            target_comp = str(value).lower() if isinstance(value, str) else value
            
            match = False
            if op in ("==", "="):
                match = (val_comp == target_comp)
            elif op == "!=":
                match = (val_comp != target_comp)
            elif op == "<":
                match = (val is not None and val < value)
            elif op == "<=":
                match = (val is not None and val <= value)
            elif op == ">":
                match = (val is not None and val > value)
            elif op == ">=":
                match = (val is not None and val >= value)
            
            if match:
                res.append(doc)
        return res

    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents:runQuery"
    
    op_map = {
        "==": "EQUAL",
        "=": "EQUAL",
        "<": "LESS_THAN",
        "<=": "LESS_THAN_OR_EQUAL",
        ">": "GREATER_THAN",
        ">=": "GREATER_THAN_OR_EQUAL",
    }
    filter_op = op_map.get(op, "EQUAL")

    payload = {
        "structuredQuery": {
            "from": [{"collectionId": collection}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": field},
                    "op": filter_op,
                    "value": _py_to_firestore_val(value)
                }
            }
        }
    }
    resp = _api_request(url, method="POST", data=payload)
    results = []
    if isinstance(resp, list):
        for item in resp:
            if "document" in item:
                results.append(_firestore_doc_to_dict(item["document"]))
    return results


def get_all_documents(collection: str):
    """Fetch all documents in a collection."""
    if is_sqlite_mode():
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT doc_id, data FROM documents WHERE collection = ?", (collection,))
        rows = cursor.fetchall()
        conn.close()
        res = []
        for r in rows:
            d = json.loads(r["data"])
            d["id"] = r["doc_id"]
            res.append(d)
        return res

    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}?pageSize=1000"
    resp = _api_request(url, method="GET")
    if not resp or "documents" not in resp:
        return []
    return [_firestore_doc_to_dict(doc) for doc in resp.get("documents", [])]


def update_document(collection: str, doc_id: str, data: dict):
    """Merge-update fields on an existing document."""
    if is_sqlite_mode():
        existing = get_document(collection, doc_id) or {}
        existing.update(data)
        existing["id"] = str(doc_id)
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO documents (collection, doc_id, data) VALUES (?, ?, ?)",
            (collection, str(doc_id), json.dumps(existing))
        )
        conn.commit()
        conn.close()
        return

    token, project_id = _get_auth()
    field_paths = "&".join([f"updateMask.fieldPaths={urllib.parse.quote(k)}" for k in data.keys()])
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}/{doc_id}?{field_paths}"
    payload = {"fields": {k: _py_to_firestore_val(v) for k, v in data.items()}}
    _api_request(url, method="PATCH", data=payload)


def delete_document(collection: str, doc_id: str):
    """Delete a document by ID."""
    if is_sqlite_mode():
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM documents WHERE collection = ? AND doc_id = ?",
            (collection, str(doc_id))
        )
        conn.commit()
        conn.close()
        return

    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}/{doc_id}"
    _api_request(url, method="DELETE")

