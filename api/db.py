import os
import json
import time
import urllib.request
import urllib.parse
import urllib.error
from google.oauth2 import service_account
import google.auth.transport.requests

# ---------------------------------------------------------------------------
# Lightweight Firebase Firestore REST Client
# Avoids heavy gRPC / firebase-admin dependencies to keep Vercel bundle < 20MB
# ---------------------------------------------------------------------------

_creds = None
_auth_request = None
_project_id = None


def _get_auth():
    """Initialise and refresh Google OAuth2 credentials from FIREBASE_CREDENTIALS."""
    global _creds, _auth_request, _project_id

    if _creds is None:
        creds_json = os.environ.get("FIREBASE_CREDENTIALS")
        if not creds_json:
            raise ValueError(
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
    """Ensure credentials can authenticate."""
    try:
        _get_auth()
    except Exception as e:
        print(f"[firebase-warning] Deferred Firestore auth init: {e}")


# ---------------------------------------------------------------------------
# Core Firestore Document Operations
# ---------------------------------------------------------------------------

def add_document(collection: str, data: dict) -> str:
    """Add a document and return its auto-generated ID."""
    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}"
    payload = {"fields": {k: _py_to_firestore_val(v) for k, v in data.items()}}
    resp = _api_request(url, method="POST", data=payload)
    name = resp.get("name", "")
    return name.split("/")[-1] if "/" in name else ""


def get_document(collection: str, doc_id: str):
    """Fetch a single document by ID. Returns dict | None."""
    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}/{doc_id}"
    resp = _api_request(url, method="GET")
    return _firestore_doc_to_dict(resp)


def query_collection(collection: str, field: str, op: str, value):
    """Return list[dict] for a simple single-field query."""
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
    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}?pageSize=1000"
    resp = _api_request(url, method="GET")
    if not resp or "documents" not in resp:
        return []
    return [_firestore_doc_to_dict(doc) for doc in resp.get("documents", [])]


def update_document(collection: str, doc_id: str, data: dict):
    """Merge-update fields on an existing document."""
    token, project_id = _get_auth()
    field_paths = "&".join([f"updateMask.fieldPaths={urllib.parse.quote(k)}" for k in data.keys()])
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}/{doc_id}?{field_paths}"
    payload = {"fields": {k: _py_to_firestore_val(v) for k, v in data.items()}}
    _api_request(url, method="PATCH", data=payload)


def delete_document(collection: str, doc_id: str):
    """Delete a document by ID."""
    token, project_id = _get_auth()
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{collection}/{doc_id}"
    _api_request(url, method="DELETE")
