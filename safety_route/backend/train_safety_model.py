import pandas as pd
import numpy as np
import joblib
import os

try:
    import xgboost as xgb
except ImportError:
    raise ImportError("XGBoost required. Install with: pip install xgboost")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GRID_PATH = os.path.join(BASE_DIR, "..", "data", "grid_features.csv")


def train_model():
    print("📥 Loading grid features...")

    if not os.path.exists(GRID_PATH):
        print("❌ grid_features.csv not found. Run generate_grid_features.py first.")
        return

    df = pd.read_csv(GRID_PATH)
    print(f"✅ Loaded {len(df)} grid cells with location-specific features")

    # Features: incident_count (negative), camera_count (positive), police_count (positive)
    X = df[["incident_count", "camera_count", "police_count"]].values

    # Safety score 1–10: higher cameras/police = safer, higher incidents = less safe
    base_score = 5.0
    incident_penalty = 0.5
    camera_bonus = 0.4
    police_bonus = 2.0

    y = np.clip(
        base_score
        - X[:, 0] * incident_penalty
        + X[:, 1] * camera_bonus
        + X[:, 2] * police_bonus,
        1,
        10,
    )

    print(f"   Safety score range: {y.min():.2f} to {y.max():.2f}")
    print(f"   Mean safety score: {y.mean():.2f}")
    print(f"   Std dev: {y.std():.2f}")

    # Train XGBoost regressor
    model = xgb.XGBRegressor(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        objective="reg:squarederror",
        random_state=42,
    )
    model.fit(X, y)

    model_path = os.path.join(BASE_DIR, "safety_model.pkl")
    joblib.dump(model, model_path)
    print(f"✅ Safety XGBoost model trained & saved to {model_path}")

    preds = model.predict(X)
    print(f"\n📊 Prediction range: {preds.min():.2f} to {preds.max():.2f}")
    print(f"   Feature importance: incident={model.feature_importances_[0]:.2f}, "
          f"camera={model.feature_importances_[1]:.2f}, police={model.feature_importances_[2]:.2f}")


if __name__ == "__main__":
    train_model()
