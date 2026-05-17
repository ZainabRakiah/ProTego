// src/App.jsx
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./index.css";

const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:5001";

export default function App() {
  const mapRef = useRef(null);
  const liveMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  const routeLayerRef = useRef(null);
  const currentPosRef = useRef(null);
  const lastAlertRef = useRef(0);

  const startInputRef = useRef(null);
  const destInputRef = useRef(null);

  const [routeScore, setRouteScore] = useState(null);
  const [isCalculatingScore, setIsCalculatingScore] = useState(false);
  const [isLocating, setIsLocating] = useState(true);
  const routeCalculationRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) return; // prevent double init

    // 1) Init map
    const map = L.map("map", {
      zoomControl: true,
    }).setView([12.9716, 77.5946], 13);
    mapRef.current = map;

    // 2) Tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    // 3) Live GPS tracking + real-time safety popup
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const current = [lat, lng];
          currentPosRef.current = current;

          try {
            const icon = L.divIcon({
              className: "user-location-marker",
              html:
                '<div style="background-color: #3b82f6; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            });

            liveMarkerRef.current = L.marker(current, { icon }).addTo(map);
          } catch (e) {
            console.error("Marker creation error:", e);
          }

          map.setView(current, 16);
          setIsLocating(false);
          console.log("📍 Location found:", lat, lng);
        },
        (err) => {
          console.warn("Initial location request failed, will try watchPosition:", err);
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 15000 }
      );

      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const current = [lat, lng];
          currentPosRef.current = current;

          try {
            const icon = L.divIcon({
              className: "user-location-marker",
              html:
                '<div style="background-color: #3b82f6; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            });

            if (!liveMarkerRef.current) {
              liveMarkerRef.current = L.marker(current, { icon }).addTo(map);
              map.setView(current, 16);
              setIsLocating(false);
              console.log("📍 Location tracking started:", lat, lng);
            } else {
              liveMarkerRef.current.setLatLng(current);
              setIsLocating(false);
              if (map.getZoom() >= 15) {
                map.setView(current, map.getZoom(), { animate: true, duration: 0.5 });
              }
            }
          } catch (e) {
            console.error("Marker update error:", e);
          }

          // Real-time safety check
          try {
            const res = await fetch(`${BACKEND_BASE}/api/safety-score`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lat, lng }),
            });

            if (!res.ok) {
              throw new Error(`API error: ${res.status}`);
            }

            const data = await res.json();
            if (data.safety_score !== undefined) {
              const now = Date.now();
              if (data.safety_score < 3 && now - lastAlertRef.current > 5 * 60 * 1000) {
                alert("⚠️ You are entering a low-safety area.");
                lastAlertRef.current = now;
              }
            }
          } catch (e) {
            console.error("Safety check failed:", e);
          }
        },
        (err) => {
          console.error("GPS watchPosition error:", err);
          let errorMsg = "";

          if (err.code === err.PERMISSION_DENIED) {
            errorMsg =
              "❌ Location permission denied.\n\nPlease enable location access in your browser settings to use this feature.";
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            errorMsg = "❌ Location information unavailable.\n\nPlease check your GPS settings.";
          } else if (err.code === err.TIMEOUT) {
            errorMsg = "⏱️ Location request timed out.\n\nPlease try again.";
          } else {
            errorMsg = "❌ Could not get your location.\n\nError code: " + err.code;
          }

          if (!currentPosRef.current) {
            setIsLocating(false);
            alert(errorMsg);
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 15000,
        }
      );
    } else {
      alert("❌ Geolocation is not supported on this device or browser.");
    }

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // =========================
  // ROUTE HANDLERS
  // =========================
  async function handleFindRoute() {
    const startText = startInputRef.current.value.trim();
    const destText = destInputRef.current.value.trim();

    if (!destText) {
      alert("Please enter a destination");
      return;
    }

    // Cancel any previous route calculation
    if (routeCalculationRef.current) {
      routeCalculationRef.current.cancelled = true;
    }

    setRouteScore(null);
    setIsCalculatingScore(true);

    const calculation = { cancelled: false };
    routeCalculationRef.current = calculation;

    try {
      let startCoords;

      if (!startText || startText.toLowerCase().includes("current")) {
        if (!currentPosRef.current) {
          alert("Waiting for GPS signal… please try again in a few seconds.");
          setIsCalculatingScore(false);
          return;
        }
        const [lat, lng] = currentPosRef.current;
        startCoords = { lat, lng };
      } else {
        startCoords = await geocode(startText);
      }

      const destCoords = await geocode(destText);

      // Fetch route via backend proxy
      const route = await fetchRoute(startCoords, destCoords).catch((e) => {
        console.error("fetchRoute error:", e);
        return null;
      });
      if (!route) {
        alert("No route found");
        setIsCalculatingScore(false);
        return;
      }

      drawRoute(route);

      // Calculate safety score for the route (defensive)
      const coordsArray =
        route.geometry?.coordinates ||
        (route.geometry?.points && route.geometry.points.coordinates) ||
        route.geometry?.points || // GraphHopper may provide points object already usable
        [];

      if (!Array.isArray(coordsArray) || coordsArray.length === 0) {
        console.warn("No route coordinates available for scoring", route);
        setIsCalculatingScore(false);
        return;
      }

      const coordsLatLng = coordsArray.map(([lng, lat]) => [lat, lng]);

      try {
        console.log("Calculating safety score for route with", coordsLatLng.length, "points");
        const res = await fetch(`${BACKEND_BASE}/api/score-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coords: coordsLatLng }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error("Safety score API error:", errorData);
          throw new Error(errorData.error || "Failed to calculate safety score");
        }

        const data = await res.json();
        console.log("Safety score response:", data);

        if (calculation.cancelled) {
          console.log("Route calculation was cancelled, ignoring result");
          return;
        }

        if (data.score !== undefined && data.score !== null) {
          const score = Number(data.score).toFixed(1);
          setRouteScore(score);

          if (data.score < 3) {
            alert(`⚠️ Warning: This route has a low safety score (${score}/10). Consider an alternative route.`);
          }
        } else {
          if (!calculation.cancelled) {
            setRouteScore(null);
          }
        }
      } catch (scoreErr) {
        console.error("Safety score calculation error:", scoreErr);
        if (!calculation.cancelled) {
          setRouteScore(null);
        }
      } finally {
        if (!calculation.cancelled) {
          setIsCalculatingScore(false);
        }
      }
    } catch (err) {
      console.error("Route calculation error:", err);
      alert("Could not calculate route. Check console for details.");
      setIsCalculatingScore(false);
      setRouteScore(null);
    }
  }

  function drawRoute(route) {
    const map = mapRef.current;
    if (!map) return;

    if (routeLayerRef.current) {
      try {
        map.removeLayer(routeLayerRef.current);
      } catch (e) {
        console.warn("Could not remove previous route layer:", e);
      }
      routeLayerRef.current = null;
    }

    // Robustly locate coordinates in various provider shapes
    let coords =
      (route && route.geometry && route.geometry.coordinates) ||
      (route && route.geometry && route.geometry.points && route.geometry.points.coordinates) ||
      (route && route.geometry && route.geometry.points) ||
      [];

    if (!Array.isArray(coords) || coords.length === 0) {
      console.error("❌ drawRoute: No route coordinates found. Route object:", route);
      alert("Failed to draw route: no coordinates returned by backend.");
      return;
    }

    // Ensure coords are [lng, lat] pairs; convert to [lat, lng] for Leaflet
    const leafletCoords = coords.map((pt) => {
      // pt might be [lng, lat] or {coordinates: [lng,lat]} if weird shape
      if (Array.isArray(pt) && pt.length >= 2) {
        return [pt[1], pt[0]];
      } else if (pt && pt.coordinates && Array.isArray(pt.coordinates)) {
        return [pt.coordinates[1], pt.coordinates[0]];
      } else {
        return null;
      }
    }).filter(Boolean);

    if (leafletCoords.length === 0) {
      console.error("No valid leaflet coordinates parsed from route:", coords);
      alert("Failed to parse route coordinates.");
      return;
    }

    const polyline = L.polyline(leafletCoords, {
      color: "#2563eb",
      weight: 6,
      opacity: 0.9,
    }).addTo(map);

    routeLayerRef.current = polyline;
    try {
      map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    } catch (e) {
      console.warn("fitBounds failed:", e);
    }
  }

  // =========================
  // SOS (unchanged)
  // =========================
  async function handleSOS() {
    const confirmed = window.confirm(
      "🚨 Are you sure you want to send an SOS alert?\n\n" +
      "Your current location will be shared with emergency services."
    );

    if (!confirmed) return;

    if (currentPosRef.current) {
      const [lat, lng] = currentPosRef.current;
      await sendSOSWithCoords(lat, lng);
      return;
    }

    if (!navigator.geolocation) {
      alert("❌ GPS not supported on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await sendSOSWithCoords(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        console.error("SOS GPS error:", err);
        let errorMsg = "Could not get your location for SOS.";

        if (err.code === err.PERMISSION_DENIED) {
          errorMsg =
            "❌ Location permission denied.\n\nPlease enable location access in your browser settings.";
        } else if (err.code === err.TIMEOUT) {
          errorMsg =
            "❌ Location request timed out.\n\nPlease make sure location is enabled and try again.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          errorMsg =
            "❌ Location information unavailable.\n\nPlease check your GPS settings.";
        }

        alert(errorMsg);
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 15000,
      }
    );
  }

  // =========================
  // RENDER (unchanged)
  // =========================
  return (
    <div className="app-root" style={{ position: "relative" }}>
      <div className="top-bar">
        <input
          ref={startInputRef}
          className="search-input"
          placeholder="Start (leave blank for current location)"
        />
        <input
          ref={destInputRef}
          className="search-input"
          placeholder="Destination (area / street / place)"
        />

        <button onClick={handleFindRoute} className="primary-btn">
          Find Route
        </button>

        <div className="score-chip">
          Safety:{" "}
          <span className="score-value">
            {isCalculatingScore ? "..." : routeScore !== null ? routeScore : "—"}
          </span>
          /10
        </div>

        <button onClick={handleSOS} className="sos-btn">
          🚨 SOS
        </button>
      </div>

      <div id="map" />
      {isLocating && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(255, 255, 255, 0.95)",
          padding: "20px 30px",
          borderRadius: "10px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          zIndex: 1000,
          textAlign: "center"
        }}>
          <div style={{ fontSize: "24px", marginBottom: "10px" }}>📍</div>
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>Getting your location...</div>
          <div style={{ fontSize: "14px", color: "#666" }}>Please allow location access</div>
        </div>
      )}
    </div>
  );
}

/* ============ helpers ============ */

async function sendSOSWithCoords(lat, lng) {
  try {
    let userId = null;
    try {
      const userStr = sessionStorage.getItem("user");
      if (userStr) {
        const user = JSON.parse(userStr);
        userId = user?.id || null;
      }
    } catch (e) {
      console.log("No user session found, sending anonymous SOS");
    }

    const payload = {
      user_id: userId,
      lat,
      lng,
      message: "HELP ME",
      timestamp: Date.now(),
    };

    console.log("Sending SOS alert:", payload);

    const res = await fetch(`${BACKEND_BASE}/api/sos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to send SOS alert");
    }

    alert(
      "✅ " +
        (data.message || "SOS alert sent successfully!") +
        "\n\n" +
        "Your location has been shared. Help is on the way!"
    );
  } catch (e) {
    console.error("SOS error:", e);
    alert(
      "❌ Could not send SOS alert.\n\n" +
        "Error: " +
        (e.message || "Unknown error") +
        "\n\n" +
        "Please check your internet connection and try again."
    );
  }
}

async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&q=" +
    encodeURIComponent(query + " Bangalore");

  const res = await fetch(url);
  const data = await res.json();

  if (!data.length) {
    throw new Error("Location not found: " + query);
  }

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
  };
}

/**
 * fetchRoute now calls your backend route proxy.
 * Backend expects start & end as "lng,lat" (note order).
 */
async function fetchRoute(start, end) {
  const url =
    `${BACKEND_BASE}/api/route?start=${start.lng},${start.lat}` +
    `&end=${end.lng},${end.lat}`;

  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error("Route fetch failed: " + res.status + " " + txt);
  }

  const data = await res.json();

  // Data could be from GraphHopper (we return routes[0].geometry),
  // or defensive shapes like features[].
  if (data.routes && data.routes.length) {
    return data.routes[0];
  }

  if (data.features && data.features.length && data.features[0].geometry) {
    return { geometry: data.features[0].geometry };
  }

  throw new Error("No route returned from backend");
}
