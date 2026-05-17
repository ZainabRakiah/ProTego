import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";
import { useState } from "react";
import { getSafetyScore } from "../api/safety";

// -------- ML-based Route Scoring --------
async function scoreRoute(routeCoords) {
  let scores = [];

  for (let i = 0; i < routeCoords.length; i += 5) {
    const [lng, lat] = routeCoords[i]; // OSRM format
    const s = await getSafetyScore(lat, lng);
    scores.push(s);
  }

  const avg =
    scores.reduce((a, b) => a + b, 0) / scores.length;

  return avg.toFixed(1);
}

export default function MapPage() {
  const [start, setStart] = useState("");
  const [dest, setDest] = useState("");
  const [route, setRoute] = useState([]);
  const [routeScore, setRouteScore] = useState(null);

  // -------- Fetch & Draw Route --------
  async function findRoute() {
    if (!start || !dest) {
      alert("Enter start & destination");
      return;
    }

    // GEOCODE
    const geo = async (place) => {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${place}+Bangalore`
      );
      const data = await res.json();
      return [data[0].lat, data[0].lon];
    };

    const [sLat, sLng] = await geo(start);
    const [dLat, dLng] = await geo(dest);

    // ROUTE (OSRM)
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/foot/${sLng},${sLat};${dLng},${dLat}?geometries=geojson`
    );
    const rData = await r.json();

    const coords = rData.routes[0].geometry.coordinates;
    setRoute(coords.map(c => [c[1], c[0]]));

    // ✅ ML SAFETY SCORE
    const score = await scoreRoute(coords);
    setRouteScore(score);
    if (score < 3) {
      alert("⚠️ You are entering a LOW SAFETY area. Stay alert!");
    }

  }

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>

      {/* ✅ INPUT PANEL */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 1000,
          background: "white",
          padding: "10px",
          borderRadius: "8px",
          boxShadow: "0 2px 6px rgba(0,0,0,.3)",
        }}
      >
        <input
          placeholder="Start"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <br />
        <input
          placeholder="Destination"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
        />
        <br />
        <button onClick={findRoute}>Find Route</button>

        {routeScore && (
          <h3>Safety Score: {routeScore}/10</h3>
        )}
      </div>
      {routeScore && (
        <div className="safety-banner">
          🛡 Safety Score: {routeScore}/10
        </div>
      )}

      {/* ✅ MAP */}
      <MapContainer
        center={[12.9716, 77.5946]}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="© OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {route.length > 0 && (
          <Polyline positions={route} color="blue" />
        )}
      </MapContainer>
    </div>
  );
}
