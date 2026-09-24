import os
import json
import time
import math
import shutil
import datetime
import pandas as pd
import numpy as np
import joblib

try:
    from db import (
        add_document,
        get_document,
        get_all_documents,
        query_collection,
        update_document,
    )
except ImportError:
    from api.db import (
        add_document,
        get_document,
        get_all_documents,
        query_collection,
        update_document,
    )

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "safety_route", "backend", "models")
PROD_MODEL_PATH = os.path.join(BASE_DIR, "safety_route", "backend", "safety_model.pkl")
GRID_PATH = os.path.join(BASE_DIR, "safety_route", "data", "grid_features.csv")

GRID_STEP = 0.0015

try:
    os.makedirs(MODELS_DIR, exist_ok=True)
except Exception as e:
    pass


# ---------------------------------------------------------------------------
# Audit Trail Helper
# ---------------------------------------------------------------------------

def log_audit_event(event_type: str, actor: str, details: dict):
    """Record an audit event in the system audit trail."""
    timestamp = int(time.time())
    event_doc = {
        "event_type": event_type,
        "actor": actor,
        "details": details,
        "timestamp": timestamp,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    try:
        add_document("audit_trail", event_doc)
    except Exception as e:
        print(f"[audit-error] Failed to log audit event {event_type}: {e}")
    return event_doc


# ---------------------------------------------------------------------------
# Data Quality Guard
# ---------------------------------------------------------------------------

def validate_incident_data_quality(lat, lng, incident_type, description):
    """
    Validate incident before adding it to the verified dataset.
    Returns (is_valid: bool, reason: str).
    """
    if lat is None or lng is None:
        return False, "Missing latitude or longitude"

    try:
        lat = float(lat)
        lng = float(lng)
    except (ValueError, TypeError):
        return False, "Invalid non-numeric coordinates"

    if not (-90.0 <= lat <= 90.0):
        return False, f"Latitude {lat} out of valid range [-90, 90]"

    if not (-180.0 <= lng <= 180.0):
        return False, f"Longitude {lng} out of valid range [-180, 180]"

    if not incident_type or not str(incident_type).strip():
        return False, "Missing incident_type"

    if not description or not str(description).strip():
        return False, "Missing incident description"

    # Check for duplicate reports in verified_incidents (same grid cell within ~50m and same type)
    try:
        existing = get_all_documents("verified_incidents")
        for item in existing:
            e_lat = item.get("lat")
            e_lng = item.get("lng")
            e_type = item.get("incident_type")
            if e_lat is not None and e_lng is not None:
                d_lat = abs(float(e_lat) - lat)
                d_lng = abs(float(e_lng) - lng)
                if d_lat < 0.0005 and d_lng < 0.0005 and str(e_type).lower() == str(incident_type).lower():
                    return False, f"Duplicate report detected near ({e_lat}, {e_lng}) for type '{incident_type}'"
    except Exception as e:
        print(f"[data-quality] Duplicate check warning: {e}")

    return True, "Passed data quality check"


# ---------------------------------------------------------------------------
# Geospatial Helper
# ---------------------------------------------------------------------------

def snap_to_grid_cell(lat, lng, step=GRID_STEP):
    cell_lat = round(lat / step) * step
    cell_lon = round(lng / step) * step
    return round(cell_lat, 6), round(cell_lon, 6)


# ---------------------------------------------------------------------------
# Verified Incident Handling & Spatial Updates
# ---------------------------------------------------------------------------

def add_to_verified_dataset(report_id, reviewer_id, reviewer_notes):
    """
    Process an APPROVED incident report:
    1. Fetch original report document.
    2. Run Data Quality Check.
    3. If valid, save to verified_incidents collection.
    4. Update real-time spatial feature cache.
    """
    report = get_document("reports", report_id)
    if not report:
        raise ValueError(f"Report {report_id} not found")

    lat = report.get("lat")
    lng = report.get("lng")
    incident_type = report.get("incident_type") or report.get("type") or "incident"
    description = report.get("description") or ""

    is_valid, reason = validate_incident_data_quality(lat, lng, incident_type, description)
    if not is_valid:
        # Mark as rejected due to data quality
        update_document("reports", report_id, {
            "verification_status": "REJECTED",
            "reviewed_at": int(time.time()),
            "reviewed_by": reviewer_id,
            "reviewer_notes": f"Data quality rejection: {reason}",
            "previous_status": report.get("verification_status", "PENDING"),
        })
        log_audit_event("INCIDENT_REJECTED", reviewer_id, {
            "report_id": report_id,
            "reason": f"Data Quality Check Failed: {reason}",
        })
        return False, f"Data Quality Check Failed: {reason}"

    cell_lat, cell_lon = snap_to_grid_cell(float(lat), float(lng))

    verified_id = f"ver_{report_id}"
    verified_doc = {
        "verified_incident_id": verified_id,
        "report_id": report_id,
        "user_id": report.get("user_id"),
        "lat": float(lat),
        "lng": float(lng),
        "incident_type": incident_type,
        "description": description,
        "timestamp": report.get("timestamp", int(time.time())),
        "cell_lat": cell_lat,
        "cell_lon": cell_lon,
        "verified_at": int(time.time()),
        "verified_by": reviewer_id,
    }

    add_document("verified_incidents", verified_doc, custom_id=verified_id)

    # Update report status
    update_document("reports", report_id, {
        "verification_status": "APPROVED",
        "reviewed_at": int(time.time()),
        "reviewed_by": reviewer_id,
        "reviewer_notes": reviewer_notes or "Approved by admin",
        "previous_status": report.get("verification_status", "PENDING"),
    })

    log_audit_event("INCIDENT_APPROVED", reviewer_id, {
        "report_id": report_id,
        "verified_incident_id": verified_id,
        "reviewer_notes": reviewer_notes,
    })

    log_audit_event("VERIFIED_DATASET_UPDATED", "system", {
        "verified_incident_id": verified_id,
        "cell_lat": cell_lat,
        "cell_lon": cell_lon,
    })

    # Check continual learning threshold
    check_and_trigger_continual_learning(trigger_actor=reviewer_id)

    return True, "Incident approved and added to verified dataset"


# ---------------------------------------------------------------------------
# Continual Learning Engine & Model Lifecycle
# ---------------------------------------------------------------------------

def check_and_trigger_continual_learning(trigger_actor="system"):
    """
    Check if threshold of newly approved incidents is reached.
    Environment variable: CONTINUAL_LEARNING_MIN_APPROVED_INCIDENTS (default 10).
    """
    min_incidents = int(os.environ.get("CONTINUAL_LEARNING_MIN_APPROVED_INCIDENTS", 10))

    # Count approved incidents since last retraining
    last_model = get_current_production_model_meta()
    last_verified_count = last_model.get("number_of_verified_incidents", 0) if last_model else 0

    all_verified = get_all_documents("verified_incidents")
    total_verified = len(all_verified)
    new_approved = total_verified - last_verified_count

    if new_approved >= min_incidents:
        print(f"[continual-learning] Threshold reached ({new_approved}/{min_incidents} new approved incidents). Starting retraining...")
        return run_retraining_pipeline(trigger_actor=trigger_actor, reason=f"{new_approved} new approved incidents reached threshold")

    return {
        "triggered": False,
        "new_approved_count": new_approved,
        "min_required": min_incidents,
        "message": f"{new_approved}/{min_incidents} approved incidents towards next retraining cycle."
    }


def get_current_production_model_meta():
    """Retrieve metadata of current PRODUCTION model version."""
    models = query_collection("model_versions", "deployment_status", "==", "PRODUCTION")
    if models:
        return models[0]
    return None


def calculate_target_safety_scores(X):
    """
    Ground truth formula for safety score 1-10 matching current repository:
    X: [incident_count, camera_count, police_count]
    """
    base_score = 5.0
    incident_penalty = 0.5
    camera_bonus = 0.4
    police_bonus = 2.0

    y = np.clip(
        base_score
        - X[:, 0] * incident_penalty
        + X[:, 1] * camera_bonus
        + X[:, 2] * police_bonus,
        1.0,
        10.0,
    )
    return y


def build_updated_grid_features():
    """
    Combine baseline grid_features.csv with all verified_incidents from DB.
    Returns DataFrame with columns ['cell_lat', 'cell_lon', 'incident_count', 'camera_count', 'police_count'].
    """
    if os.path.exists(GRID_PATH):
        df = pd.read_csv(GRID_PATH)
    else:
        df = pd.DataFrame(columns=["cell_lat", "cell_lon", "incident_count", "camera_count", "police_count"])

    # Ensure correct columns and types
    for col in ["incident_count", "camera_count", "police_count"]:
        if col not in df.columns:
            df[col] = 0.0
        df[col] = df[col].astype(float)

    verified = get_all_documents("verified_incidents")
    if not verified:
        return df

    # Group verified incidents by grid cell
    v_counts = {}
    for v in verified:
        lat = v.get("lat")
        lng = v.get("lng")
        if lat is not None and lng is not None:
            clat, clon = snap_to_grid_cell(float(lat), float(lng))
            cell = (clat, clon)
            v_counts[cell] = v_counts.get(cell, 0) + 1.0

    # Merge verified incident counts into grid dataframe
    cell_dict = {(round(row['cell_lat'], 6), round(row['cell_lon'], 6)): idx for idx, row in df.iterrows()}

    for (clat, clon), inc_cnt in v_counts.items():
        cell = (round(clat, 6), round(clon, 6))
        if cell in cell_dict:
            idx = cell_dict[cell]
            df.at[idx, "incident_count"] += inc_cnt
        else:
            # Add new grid cell
            new_row = {
                "cell_lat": clat,
                "cell_lon": clon,
                "incident_count": inc_cnt,
                "camera_count": 0.0,
                "police_count": 0.0,
            }
            df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)

    return df


def train_and_evaluate_model(X, y):
    """
    Train regressor model on (X, y) and evaluate with 80/20 train/test split.
    Uses XGBoost if available, else sklearn RandomForest / Ridge fallback.
    """
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = None
    model_type = "XGBoostRegressor"
    try:
        import xgboost as xgb
        model = xgb.XGBRegressor(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            objective="reg:squarederror",
            random_state=42,
        )
    except ImportError:
        from sklearn.ensemble import RandomForestRegressor
        model_type = "RandomForestRegressor"
        model = RandomForestRegressor(n_estimators=100, max_depth=4, random_state=42)

    model.fit(X_train, y_train)
    preds = model.predict(X_test)

    mse = float(mean_squared_error(y_test, preds))
    rmse = float(math.sqrt(mse))
    mae = float(mean_absolute_error(y_test, preds))
    r2 = float(r2_score(y_test, preds))

    metrics = {
        "rmse": round(rmse, 4),
        "mae": round(mae, 4),
        "r2": round(r2, 4),
        "mse": round(mse, 4),
    }

    return model, model_type, metrics, X_test, y_test


def evaluate_existing_model(model_path, X_test, y_test):
    """Evaluate an existing model file on (X_test, y_test)."""
    if not os.path.exists(model_path):
        return None

    try:
        from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
        model = joblib.load(model_path)
        preds = model.predict(X_test)
        mse = float(mean_squared_error(y_test, preds))
        rmse = float(math.sqrt(mse))
        mae = float(mean_absolute_error(y_test, preds))
        r2 = float(r2_score(y_test, preds))
        return {
            "rmse": round(rmse, 4),
            "mae": round(mae, 4),
            "r2": round(r2, 4),
            "mse": round(mse, 4),
        }
    except Exception as e:
        print(f"[eval-error] Could not evaluate existing model: {e}")
        return None


def run_retraining_pipeline(trigger_actor="admin", reason="Manual trigger"):
    """
    Execute complete end-to-end retraining & model quality gate pipeline.
    """
    log_audit_event("RETRAINING_STARTED", trigger_actor, {"reason": reason})

    version_str = f"v_{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    candidate_model_filename = f"safety_model_{version_str}.pkl"
    candidate_model_path = os.path.join(MODELS_DIR, candidate_model_filename)

    try:
        grid_df = build_updated_grid_features()
        if len(grid_df) == 0:
            raise ValueError("No grid features available for retraining.")

        X = grid_df[["incident_count", "camera_count", "police_count"]].values
        y = calculate_target_safety_scores(X)

        candidate_model, model_type, candidate_metrics, X_test, y_test = train_and_evaluate_model(X, y)

        # Save candidate model file
        joblib.dump(candidate_model, candidate_model_path)

        all_verified = get_all_documents("verified_incidents")
        verified_ids = [v.get("id") or v.get("verified_incident_id") for v in all_verified]

        # Evaluate current production model on same test set
        prod_metrics = evaluate_existing_model(PROD_MODEL_PATH, X_test, y_test)

        # Quality Gate Check
        max_degradation = float(os.environ.get("CONTINUAL_LEARNING_MAX_DEGRADATION", 0.0))
        passed_quality_gate = True
        gate_reason = "Passed Quality Gate: Candidate performance equals or exceeds production model."

        if prod_metrics is not None:
            cand_rmse = candidate_metrics["rmse"]
            prod_rmse = prod_metrics["rmse"]
            allowed_max_rmse = prod_rmse * (1.0 + max_degradation)

            if cand_rmse > allowed_max_rmse:
                passed_quality_gate = False
                gate_reason = (
                    f"Quality Gate Failed: Candidate RMSE ({cand_rmse}) "
                    f"exceeds production model RMSE ({prod_rmse}) + allowed degradation ({max_degradation})."
                )

        version_doc = {
            "model_version": version_str,
            "created_at": int(time.time()),
            "created_at_iso": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "training_data_version": f"tdv_{version_str}",
            "number_of_verified_incidents": len(all_verified),
            "verified_incident_ids": verified_ids,
            "evaluation_metrics": candidate_metrics,
            "production_metrics": prod_metrics,
            "feature_version": "grid_features_v1",
            "model_type": model_type,
            "deployment_status": "PENDING_GATE",
            "file_path": candidate_model_path,
            "trigger_reason": reason,
            "triggered_by": trigger_actor,
        }

        log_audit_event("RETRAINING_COMPLETED", trigger_actor, {
            "model_version": version_str,
            "candidate_metrics": candidate_metrics,
            "production_metrics": prod_metrics,
        })

        if passed_quality_gate:
            # Mark previous production models as ARCHIVED
            prev_prods = query_collection("model_versions", "deployment_status", "==", "PRODUCTION")
            for p in prev_prods:
                update_document("model_versions", p["id"], {"deployment_status": "ARCHIVED"})

            # Promote candidate to PRODUCTION
            version_doc["deployment_status"] = "PRODUCTION"
            version_doc["deployed_at"] = int(time.time())
            add_document("model_versions", version_doc, custom_id=version_str)

            # Deploy to production file
            shutil.copyfile(candidate_model_path, PROD_MODEL_PATH)

            log_audit_event("CANDIDATE_MODEL_DEPLOYED", trigger_actor, {
                "model_version": version_str,
                "metrics": candidate_metrics,
            })

            return {
                "success": True,
                "status": "DEPLOYED",
                "model_version": version_str,
                "candidate_metrics": candidate_metrics,
                "production_metrics": prod_metrics,
                "message": f"Candidate model {version_str} successfully passed Quality Gate and was deployed to production.",
            }
        else:
            version_doc["deployment_status"] = "REJECTED"
            version_doc["rejection_reason"] = gate_reason
            add_document("model_versions", version_doc, custom_id=version_str)

            log_audit_event("CANDIDATE_MODEL_REJECTED", trigger_actor, {
                "model_version": version_str,
                "reason": gate_reason,
                "candidate_metrics": candidate_metrics,
                "production_metrics": prod_metrics,
            })

            return {
                "success": False,
                "status": "REJECTED",
                "model_version": version_str,
                "candidate_metrics": candidate_metrics,
                "production_metrics": prod_metrics,
                "message": gate_reason,
            }

    except Exception as e:
        err_msg = f"Retraining pipeline failed: {type(e).__name__}: {e}"
        print(f"[continual-learning] {err_msg}")
        log_audit_event("RETRAINING_FAILED", trigger_actor, {"error": str(e)})
        return {"success": False, "status": "FAILED", "error": str(e)}


def rollback_production_model(target_version: str, actor: str = "admin"):
    """
    Rollback active production model to a previous valid version.
    """
    target = get_document("model_versions", target_version)
    if not target:
        raise ValueError(f"Model version {target_version} not found")

    file_path = target.get("file_path")
    if not file_path or not os.path.exists(file_path):
        raise ValueError(f"Model file for version {target_version} does not exist at {file_path}")

    current_prod = get_current_production_model_meta()
    if current_prod:
        update_document("model_versions", current_prod["id"], {
            "deployment_status": "ROLLED_BACK",
            "rolled_back_at": int(time.time()),
        })

    # Restore target version to production status
    update_document("model_versions", target_version, {
        "deployment_status": "PRODUCTION",
        "restored_at": int(time.time()),
    })

    # Copy target model file to production model path
    shutil.copyfile(file_path, PROD_MODEL_PATH)

    log_audit_event("MODEL_ROLLBACK_PERFORMED", actor, {
        "target_version": target_version,
        "previous_version": current_prod.get("model_version") if current_prod else "unknown",
    })

    return {
        "success": True,
        "message": f"Successfully rolled back production model to version {target_version}.",
        "active_model_version": target_version,
    }
