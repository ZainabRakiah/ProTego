import pandas as pd
import numpy as np
import os

# Same GRID_STEP as in app.py
GRID_STEP = 0.0015

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
GRID_PATH = os.path.join(DATA_DIR, "grid_features.csv")


def make_cell(lat, lng):
    """Round to grid cell coordinates."""
    return (
        round(lat / GRID_STEP) * GRID_STEP,
        round(lng / GRID_STEP) * GRID_STEP,
    )


def generate_grid_features():
    print("📥 Loading datasets...")
    
    # Load data files
    try:
        incident = pd.read_excel(os.path.join(DATA_DIR, "incident.xlsx"))
        police = pd.read_excel(os.path.join(DATA_DIR, "police.xlsx"))
        surv = pd.read_csv(os.path.join(DATA_DIR, "surveillance.csv"))
    except Exception as e:
        print(f"❌ Error loading data files: {e}")
        return
    
    # Normalize column names
    incident.columns = incident.columns.str.lower()
    police.columns = police.columns.str.lower()
    surv.columns = surv.columns.str.lower()
    
    print("🔨 Building grid features from location-specific data...")
    
    # Create grid cells from surveillance data (has GPS coordinates)
    surv["cell_lat"] = surv["lat"].apply(lambda x: make_cell(x, 0)[0])
    surv["cell_lon"] = surv["lon"].apply(lambda x: make_cell(0, x)[1])
    
    # Aggregate features per grid cell using ACTUAL location-specific data from surveillance.csv
    # This gives us varied features per location instead of area-level averages
    
    # 1. Camera count: Sum of CCTV cameras per cell
    camera_counts = surv.groupby(["cell_lat", "cell_lon"])["cctv_count"].sum().reset_index(name="camera_count")
    
    # 2. Incident count: Average crime reports per cell (using actual crime_reports from surveillance)
    # If crime_reports column exists, use it; otherwise fall back to counting points
    if "crime_reports" in surv.columns:
        incident_counts = surv.groupby(["cell_lat", "cell_lon"])["crime_reports"].mean().reset_index(name="incident_count")
    else:
        # Fallback: count surveillance points as proxy for incidents
        incident_counts = surv.groupby(["cell_lat", "cell_lon"]).size().reset_index(name="incident_count")
        incident_counts["incident_count"] = incident_counts["incident_count"] * 0.5  # Normalize
    
    # 3. Police count: Sum of police_near indicator per cell (using actual police_near from surveillance)
    if "police_near" in surv.columns:
        police_counts = surv.groupby(["cell_lat", "cell_lon"])["police_near"].sum().reset_index(name="police_count")
    else:
        # Fallback: use area-level average
        avg_police = len(police) / len(camera_counts) if len(camera_counts) > 0 else 0
        police_counts = camera_counts[["cell_lat", "cell_lon"]].copy()
        police_counts["police_count"] = avg_police
    
    # Merge all features
    grid_df = camera_counts.copy()
    grid_df = grid_df.merge(incident_counts[["cell_lat", "cell_lon", "incident_count"]], 
                           on=["cell_lat", "cell_lon"], how="left")
    grid_df = grid_df.merge(police_counts[["cell_lat", "cell_lon", "police_count"]], 
                           on=["cell_lat", "cell_lon"], how="left")
    
    # Fill NaN values with 0
    grid_df["camera_count"] = grid_df["camera_count"].fillna(0)
    grid_df["incident_count"] = grid_df["incident_count"].fillna(0)
    grid_df["police_count"] = grid_df["police_count"].fillna(0)
    
    # Normalize features to reasonable ranges for better model performance
    # Scale incident_count to 0-10 range (crime_reports are 0-4, so multiply by 2.5)
    if grid_df["incident_count"].max() > 0:
        grid_df["incident_count"] = grid_df["incident_count"] * 2.5
    
    print(f"   Feature ranges:")
    print(f"   - Camera count: {grid_df['camera_count'].min():.1f} to {grid_df['camera_count'].max():.1f}")
    print(f"   - Incident count: {grid_df['incident_count'].min():.1f} to {grid_df['incident_count'].max():.1f}")
    print(f"   - Police count: {grid_df['police_count'].min():.1f} to {grid_df['police_count'].max():.1f}")
    
    # Ensure numeric types
    grid_df["camera_count"] = grid_df["camera_count"].astype(float)
    grid_df["incident_count"] = grid_df["incident_count"].astype(float)
    grid_df["police_count"] = grid_df["police_count"].astype(float)
    
    # Save to CSV
    grid_df.to_csv(GRID_PATH, index=False)
    print(f"✅ Grid features saved to {GRID_PATH}")
    print(f"   Total grid cells: {len(grid_df)}")
    print(f"   Columns: {list(grid_df.columns)}")


if __name__ == "__main__":
    generate_grid_features()

