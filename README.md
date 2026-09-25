# ProTego

> **Night & Travel Safety Companion** — Safest-route navigation, press-and-hold SOS, unified Friends Navigator, 5s timestamped evidence camera, highway accident rescue, and a human-verified continual learning safety grid.

---

## 🚀 Quick Start

From the project root, the simplest way to run the full application is:

```bash
npm run dev
```

This command automatically creates the Python virtual environment if needed, installs the Python dependencies from `requirements.txt`, installs the web frontend dependencies, and starts both the Flask API backend and the Vite React frontend concurrently.

### Fresh Clone Setup Workflow

```bash
# 1) Create a Python virtual environment
python3 -m venv ProTego_venv
source ProTego_venv/bin/activate

# 2) Install Python dependencies
pip install -r requirements.txt

# 3) Install frontend dependencies
npm install

# 4) Launch full application (Backend + Frontend)
npm run dev
```

*Windows PowerShell equivalent:*

```powershell
python -m venv ProTego_venv
.\ProTego_venv\Scripts\Activate.ps1
pip install -r requirements.txt
npm install
npm run dev
```

### Environment Configuration & Local Database Fallback

Copy the environment template before using login, signup, incident reporting, or Firestore-backed features:

```bash
cp .env.example .env
```

Set `FIREBASE_CREDENTIALS` in `.env` to your complete Firebase service-account JSON string if using Firebase. If `FIREBASE_CREDENTIALS` is omitted, ProTego automatically falls back to a local SQLite database (`api/database.db`) so login, signup, and all features work out-of-the-box locally without external cloud dependencies.

A default administrator account is pre-seeded in local database mode:
- **Email**: `admin@protego.com`
- **Password**: `admin123`

### Application Ports & Services

When running locally, ProTego serves:

| Service | URL | Description |
| :--- | :--- | :--- |
| **Frontend UI** | `http://localhost:5173` | Vite + React 19 App (Opens automatically) |
| **Backend API** | `http://127.0.0.1:5001` | Flask API + Safety Machine Learning Engine |

Press `Ctrl+C` in the terminal to gracefully terminate both frontend and backend processes.

---

## 🌟 Real-World Origins & Core Motivations

ProTego was created to address real-world safety vulnerabilities and emergency situations experienced by everyday travelers:

1. 🛡️ **Safest Route (`Safety Route`)**  
   *The Problem:* Travelers walking or commuting alone at night frequently notice suspicious activity or feel they are being followed. Standard navigation apps optimize purely for speed or shortest distance—often routing pedestrians down unlit, isolated alleyways or high-risk zones.  
   *The Solution:* ProTego prioritizes personal safety over raw distance by analyzing streetlight coverage, police station proximity, CCTV density, and historical incident data to calculate the safest possible walking route.

2. 📸 **Safety Camera & Evidence Vault (`Safety Camera`)**  
   *The Problem:* When victims of harassment or stalking attempt to register a First Information Report (FIR) or report an incident at police stations, authorities frequently demand immediate physical proof or timestamped evidence.  
   *The Solution:* ProTego includes an automatic background evidence camera that captures photos at 5-second intervals, stamping exact GPS coordinates (lat/lng), accuracy meters, and ISO timestamps directly onto each frame, saving them securely to an immutable Evidence Vault.

3. 🚑 **Accident Rescue (`Highway & Long-Distance Rescue`)**  
   *The Problem:* Passengers traveling long distances (e.g., riding an intercity bus on a remote highway) often witness severe vehicular accidents where no bystanders stop to help, or nobody knows the local emergency contacts or nearest medical centers.  
   *The Solution:* ProTego features a 1-tap Highway Accident Rescue system that auto-detects the 3 nearest hospitals, dispatches emergency coordinates, drops an interactive map pin, and provides immediate turn-by-turn navigation for emergency transport.

4. 👥 **Friends Navigator (`Unified Multi-Friend Tracking`)**  
   *The Problem:* Groups of friends traveling to an unfamiliar city or new location worry about each other's safety and get frustrated having to switch between multiple messaging apps or browser tabs to track where everyone is.  
   *The Solution:* Friends Navigator provides a unified single-screen dashboard tracking all circle members on one live map, displaying real-time safety status badges and location safety meters without requiring multi-tab management.

5. 📊 **Report Incident & Community Safety Grid (`Continual Learning`)**  
   *The Problem:* Static map apps rely on outdated safety assumptions that do not reflect real-time community hazards like broken streetlights, recent harassment spots, or unmonitored construction zones.  
   *The Solution:* Citizens log real-time incident reports that undergo human admin verification. Approved reports update geospatial feature grids and trigger machine learning retraining to make the entire platform safer over time.

---

## 🔬 In-Depth Feature Deep-Dive

### 1. 🛡️ Safest-Route Navigation Engine
- **Multi-Stop Itinerary Routing**: Plan complex trips with a starting point, up to 8 intermediate stops, and a final destination (`Start → Stop 1 → Stop 2 → ... → Destination`). Each leg is independently routed and scored for safety.
- **Distance-Weighted Safety Scoring**: Calculates safety on a 0–100 scale using spatial factors within a 500-meter radius (police stations, street lamps, CCTV cameras, and historical incidents). Overall trip safety uses distance-weighted averaging so a long unsafe stretch cannot be masked by a short safe leg.
- **Full-Screen Live Walking Navigation**:
  - Live GPS progress tracking projected onto route segment polylines (handles roads looping back on themselves accurately).
  - Maneuver banner with real-time distance countdown to the next turn.
  - Spoken voice guidance via Web Speech API (announces maneuvers at start and ~45m before turn).
  - Off-route detection (>60m divergence) triggering 1-tap re-routing from current GPS position.
  - Display Wake Lock integration preventing screen lock while walking.
- **Interactive Basemaps & Safety Overlay**:
  - Switch between Street, Geographic (Terrain/Contours), Satellite, and Night Basemaps.
  - Dynamic hourly Safety Heat Grid overlay visualizing localized risk levels across the map.

### 2. 📸 Safety Camera & Timestamped Evidence Vault
- **Automatic Torch / Flashlight Activation**: When the Safety Camera opens via SOS dispatch or in auto-evidence mode, the device's flashlight/torch automatically switches ON to illuminate dark surroundings and ensure high-visibility evidence capture.
- **Automated Interval Capture**: Built-in WebRTC camera capture engine supporting configurable 5-second automatic photo snapshot intervals alongside manual capture.
- **Tamper-Evident Metadata Overlay**: Stamped directly on each photo frame:
  - Exact Latitude & Longitude coordinates.
  - GPS Accuracy radius (in meters).
  - Standardized Date and Timestamp (ISO 8601 format).
- **Timestamped Evidence Vault**:
  - Secure gallery allowing users to review, filter by date/location, and download high-resolution stamped evidence for FIR filings or legal proceedings.
  - WebRTC fallback system supporting manual file uploads in non-secure HTTP/LAN contexts.

### 3. 🚑 Highway & Long-Distance Accident Rescue
- **1-Tap Highway Emergency Trigger**: Immediate emergency action mode designed for long-distance highway travel.
- **Auto-Geolocation of Emergency Services**: Instantly identifies and lists the 3 nearest hospitals and nearest police control stations with direct telephone dialers and distance metrics.
- **Bystander Incident Reporting**: Interactive map pin placement allowing bystanders to drop an exact accident pin, attach notes, and alert nearby response nodes.
- **Fastest Hospital Navigation**: Embedded turn-by-turn navigation directing emergency vehicles or Good Samaritans straight to the closest hospital care unit.
- **Automated Emergency Dispatch**: Sends live GPS coordinates and Google Maps location links to local emergency dispatchers and saved trusted circle contacts.

### 4. 👥 Friends Navigator (Unified Multi-Friend Tracking)
- **Single-Dashboard Multi-Location Map**: Eliminates multi-tab clutter by plotting all trusted circle members on a single interactive map canvas.
- **Real-Time Safety Badging**: Displays individual member statuses (e.g., `Safe`, `In-Transit`, `SOS Triggered`) alongside localized safety scores for each friend's position.
- **Direct Emergency Shortcuts**: 1-click speed dial, SMS dispatch, and route guidance directly to any friend's coordinates if they encounter trouble in an unfamiliar location.

### 5. 🚨 Press-and-Hold SOS & Auto-Dispatch
- **1.5-Second Hold Guard**: Requires a deliberate 1.5-second press-and-hold action to prevent accidental triggers while carrying phones in pockets or bags.
- **Automatic Camera & Torch Activation**: Upon SOS dispatch, the Safety Camera launches automatically with device flashlight/torch turned ON and 5-second auto-capture activated to record continuous evidence.
- **Multi-Channel Emergency Alert**: Automatically dispatches distress alerts containing live GPS coordinates, accuracy margins, and clickable Google Maps links to:
  - Nearest Police Control Room / Station.
  - Top 3 Nearest Hospital Emergency Departments.
  - All contacts configured in the user's Trusted Circle.
- **Trusted Circle Profiles**: Custom circle management allowing users to set designated emergency contacts per safe place (Home, Campus, Work).

### 6. 📊 Report Incident & Human-in-the-Loop Continual Learning
- **Citizen Hazard Reporting**: Submit incident reports specifying hazard category (harassment, dark area, assault, stalking, infrastructure failure), description, severity, and exact map location.
- **Human-in-the-Loop Governance**: All submitted reports enter a `PENDING` state to prevent spam or false reports from skewing safety algorithms.
- **Admin Verification Portal**: Admins review, approve, or reject pending reports with automated data quality checks.
- **Automated ML Pipeline Retraining**:
  - Only `APPROVED` reports enter the verified incident dataset and update spatial grid features (`incident_count`, `camera_count`, `police_count`).
  - Automated candidate model retraining (XGBoost Regressor with Random Forest fallback) triggered after `N` approved incidents or via manual admin trigger.
  - Validation Quality Gate evaluation before deploying candidate models to production, with versioning, rollback capabilities, and complete audit logging.

---

## 🗂️ Project Structure

```
ProTego/
├─ package.json                   # Root scripts & npm run dev launcher
├─ scripts/dev.mjs                # Multi-process launcher (venv setup, Flask + Vite)
├─ api/                           # Flask API & Safety ML Backend
│  ├─ index.py                    # API endpoints, auth, route scoring, SOS dispatcher
│  ├─ db.py                       # Database abstraction (SQLite fallback / Firestore)
│  └─ continual_learning.py       # ML retraining pipeline & admin governance logic
├─ web/                           # Vite + React 19 + Tailwind v4 + shadcn/ui App
│  ├─ src/pages/                  # Application Pages
│  │  ├─ MapPage.jsx              # Main Safest-Route Navigation & Heatmap
│  │  ├─ AccidentRescue.jsx       # Highway Accident Rescue & Hospital Finder
│  │  ├─ Evidence.jsx             # Camera Capture & Timestamped Evidence Vault
│  │  ├─ Report.jsx               # Citizen Incident Reporting Page
│  │  ├─ Admin.jsx                # Admin Governance & ML Retraining Dashboard
│  │  ├─ Contacts.jsx             # Trusted Circle Management
│  │  ├─ Dashboard.jsx            # Quick Safety Overview & Emergency Actions
│  │  └─ Auth.jsx                 # Login & Signup pages
│  ├─ src/components/             # AppShell, SosButton, SafetyMeter, CameraCapture
│  ├─ src/components/ui/          # shadcn/ui component primitives
│  └─ src/lib/                    # API client, navigation math, geolocation utilities
├─ FriendsNavigator/              # Unified multi-friend location tracking sub-app
├─ safety_route/                  # Standalone ML training & dataset experiment workspace
├─ camera/                        # Original static camera prototype reference
└─ database.db                    # Auto-generated local SQLite database
```

---

## 🔌 API Reference & Multi-Stop Data Contract

### Multi-Stop Safest Route Endpoint
`POST /api/safest-route`

Accepts array of coordinates specifying an itinerary:

```jsonc
{
  "stops": [
    { "lat": 12.9716, "lng": 77.5946 }, // Start location
    { "lat": 12.9352, "lng": 77.6245 }, // Intermediate stop 1
    { "lat": 12.9141, "lng": 77.6411 }  // Destination
  ]
}
```

*Response*: Returns individual route legs, overall distance-weighted safety score, spatial feature counts (lamps, cameras, police, incidents within 500m), step-by-step navigation instructions, and safety-banded polyline geometries.

---

## 🇮🇳 India-Only Geospatial Scope

Place search and geographic boundary validation are scoped exclusively to India:
- Search queries sent to Nominatim include `countrycodes=in` and a bounded viewbox.
- Client-side coordinate checking via `isInIndia()` in [`web/src/lib/geo.js`](web/src/lib/geo.js) enforces spatial boundaries for safety dataset integrity.
- Searching international locations (e.g., "London") filters results to Indian locations sharing the name. To expand boundaries, modify `INDIA_VIEWBOX` and `countrycodes` in [`web/src/lib/geo.js`](web/src/lib/geo.js).

---

## 🎨 Design System & Aesthetics

- **Dark-First Theme**: Styled specifically for low-light and nighttime usage to preserve user vision and visibility.
- **OKLCH Color Palette**: Custom OKLCH color tokens defined in [`web/src/index.css`](web/src/index.css) providing smooth contrast and uniform luminance.
- **Accessible Safety Scale**: Dual-encoded safety metrics combining color codes (`--safe`, `--caution`, `--risk`) with numeric values (0–100) and text labels to ensure full accessibility.

---

## ⚠️ Prototype Boundaries & Safety Disclaimer

ProTego is a functional prototype designed for safety navigation, evidence collection, and community incident reporting:
- SOS dispatches and emergency notifications log to local databases/interfaces and emulate dispatch protocols. In an immediate life-threatening emergency, always contact official local emergency telephone numbers (e.g., 112 / 100 / 108) directly.
- Camera access requires a secure context (`https://` or `http://localhost`). Standard HTTP access across local area networks (LAN IPs) will trigger browser security restrictions, activating the manual file-upload fallback.
