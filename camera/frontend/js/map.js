/*************************************************
 * SAFEWALK – MAP + SOS + CAMERA + LIVE TRACKING
 *************************************************/

/* =====================================
 * GLOBAL STATE
 ===================================== */
let map;
let routeLayer = null;

let liveMarker = null;
let watchId = null;
let lastPosition = null;

let cameraStream = null;
let torchOn = false;

let lastSOSLocation = null;
let currentEvidenceType = "NORMAL"; // NORMAL | SOS

let safetyPoints = [];

const BACKEND_URL = "http://127.0.0.1:5001";

/* =====================================
 * ARROW ICON (FIXED SCOPE)
 ===================================== */
const arrowIcon = L.divIcon({
  className: "arrow-marker",
  html: "➤",
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

/* =====================================
 * MAP INITIALIZATION
 ===================================== */
function initMap() {
  map = L.map("map").setView([12.9716, 77.5946], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

initMap();

/* =====================================
 * CSV PARSER
 ===================================== */
function parseCsv(text) {
  const rows = text.trim().split("\n");
  const headers = rows[0].split(",");

  const typeIdx = headers.indexOf("type");
  const latIdx = headers.indexOf("lat");
  const lngIdx = headers.indexOf("lon") !== -1
    ? headers.indexOf("lon")
    : headers.indexOf("lng");

  return rows.slice(1)
    .map(r => {
      const c = r.split(",");
      return {
        type: c[typeIdx],
        lat: parseFloat(c[latIdx]),
        lng: parseFloat(c[lngIdx])
      };
    })
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));
}

/* =====================================
 * LOAD SAFETY POINTS
 ===================================== */
fetch("safewalk.csv")
  .then(res => res.text())
  .then(text => {
    safetyPoints = parseCsv(text);

    safetyPoints.forEach(p => {
      const color = p.type === "police" ? "#1d4ed8" : "#facc15";
      const radius = p.type === "police" ? 6 : 4;

      L.circleMarker([p.lat, p.lng], {
        radius,
        color,
        fillColor: color,
        fillOpacity: 0.8
      }).addTo(map);
    });

    console.log("✅ Safety points loaded:", safetyPoints.length);
  });

/* =====================================
 * LIVE TRACKING (CALLED ONLY WHEN NEEDED)
 ===================================== */
function startLiveTracking() {
  if (watchId) return;

  watchId = navigator.geolocation.watchPosition(
    pos => {
      const current = [pos.coords.latitude, pos.coords.longitude];

      if (!liveMarker) {
        liveMarker = L.marker(current, { icon: arrowIcon }).addTo(map);
        map.setView(current, 16);
      } else {
        liveMarker.setLatLng(current);

        if (lastPosition) {
          const angle = getBearing(lastPosition, current);
          liveMarker._icon.style.transform =
            `rotate(${angle}deg) translate(-50%, -50%)`;
        }
      }

      lastPosition = current;
    },
    err => console.error("Tracking error", err),
    { enableHighAccuracy: true }
  );
}

/* =====================================
 * BEARING
 ===================================== */
function getBearing(from, to) {
  const lat1 = from[0] * Math.PI / 180;
  const lat2 = to[0] * Math.PI / 180;
  const dLng = (to[1] - from[1]) * Math.PI / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return Math.atan2(y, x) * 180 / Math.PI;
}

/* =====================================
 * SOS
 ===================================== */
document.getElementById("sosBtn").addEventListener("click", async () => {
  if (!confirm("Trigger SOS?")) return;

  currentEvidenceType = "SOS";
  startLiveTracking();

  navigator.geolocation.getCurrentPosition(pos => {
    lastSOSLocation = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy
    };
    openCamera();
  });
});

/* =====================================
 * CAMERA BUTTON (NORMAL)
 ===================================== */
document.getElementById("cameraBtn").addEventListener("click", () => {
  currentEvidenceType = "NORMAL";
  lastSOSLocation = null;
  openCamera();
});

/* =====================================
 * CAMERA LOGIC
 ===================================== */
async function openCamera() {
  const modal = document.getElementById("cameraModal");
  const video = document.getElementById("cameraView");

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  });

  video.srcObject = cameraStream;
  modal.style.display = "block";
}

document.getElementById("capturePhoto").addEventListener("click", async () => {
  const video = document.getElementById("cameraView");
  const canvas = document.getElementById("photoCanvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);

  const image = canvas.toDataURL("image/jpeg");

  cameraStream.getTracks().forEach(t => t.stop());
  document.getElementById("cameraModal").style.display = "none";

  const user = JSON.parse(sessionStorage.getItem("user"));

  await fetch(`${BACKEND_URL}/api/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: user.id,
      image_base64: image,
      type: currentEvidenceType,
      lat: lastSOSLocation?.lat,
      lng: lastSOSLocation?.lng,
      accuracy: lastSOSLocation?.accuracy,
      timestamp: Date.now()
    })
  });

  alert("Evidence stored securely");
});
