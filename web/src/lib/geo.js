import * as React from "react";

/** Bengaluru city centre — the dataset's coverage area, used before a fix lands. */
export const FALLBACK_POSITION = { lat: 12.9716, lng: 77.5946 };

export function useGeolocation({ watch = true } = {}) {
  const [state, setState] = React.useState({
    position: null,
    accuracy: null,
    error: null,
    loading: true,
  });
  // Bumping this re-runs the effect, which re-asks the browser for a fix.
  const [attempt, setAttempt] = React.useState(0);

  const retry = React.useCallback(() => {
    setState((prev) => ({ ...prev, error: null, loading: true }));
    setAttempt((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState({
        position: null,
        accuracy: null,
        error: "This browser does not support location.",
        loading: false,
      });
      return;
    }

    const onOk = (pos) => {
      const position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      // Keep place search centred on wherever the user actually is.
      setSearchCentre(position);
      setState({ position, accuracy: pos.coords.accuracy, error: null, loading: false });
    };

    const onErr = (err) =>
      setState((prev) => ({
        ...prev,
        error:
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked. Allow it from the padlock icon in the address bar, then retry."
            : err.code === err.TIMEOUT
              ? "Timed out waiting for GPS. Move somewhere with a clearer view of the sky and retry."
              : "Could not get your location.",
        loading: false,
      }));

    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 };
    navigator.geolocation.getCurrentPosition(onOk, onErr, options);

    if (!watch) return;
    const id = navigator.geolocation.watchPosition(onOk, onErr, options);
    return () => navigator.geolocation.clearWatch(id);
  }, [watch, attempt]);

  return React.useMemo(() => ({ ...state, retry }), [state, retry]);
}

/** Rough bounding box of India — west, north, east, south (Nominatim's order). */
export const INDIA_VIEWBOX = "68.1,37.1,97.4,6.5";

/** True when a coordinate falls inside the Indian mainland + islands box. */
export function isInIndia({ lat, lng }) {
  return lat >= 6.5 && lat <= 37.1 && lng >= 68.1 && lng <= 97.4;
}

/**
 * Where searches are centred. Defaults to Bengaluru — the city the safety
 * datasets cover — and follows the live GPS fix once there is one, so the app
 * works elsewhere without a code change. Module-level because the search
 * centre is genuinely app-wide state; useGeolocation keeps it current.
 */
let searchCentre = { ...FALLBACK_POSITION };

export function setSearchCentre(pos) {
  if (pos && isInIndia(pos)) searchCentre = { lat: pos.lat, lng: pos.lng };
}

export function getSearchCentre() {
  return searchCentre;
}

/** Half-width of the "local" box, in degrees (~45 km). */
const LOCAL_SPAN = 0.4;

function localViewbox(centre) {
  const { lat, lng } = centre;
  // west,north,east,south
  return [lng - LOCAL_SPAN, lat + LOCAL_SPAN, lng + LOCAL_SPAN, lat - LOCAL_SPAN].join(",");
}

async function queryNominatim({ q, viewbox, bounded, limit, signal }) {
  const params = new URLSearchParams({
    format: "json",
    limit: String(limit),
    countrycodes: "in",
    viewbox,
    addressdetails: "1",
    "accept-language": "en",
    q,
  });
  if (bounded) params.set("bounded", "1");

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Place search is unavailable right now.");
  return res.json();
}

function shape(row) {
  const a = row.address ?? {};
  // display_name is long and repeats ", India" on every row; build a short
  // primary line plus its administrative context.
  const label =
    row.name ||
    a.road ||
    a.suburb ||
    a.neighbourhood ||
    a.village ||
    a.town ||
    a.city ||
    String(row.display_name).split(",")[0];

  const context = [
    a.suburb || a.neighbourhood,
    a.city || a.town || a.village || a.county,
    a.state,
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i && v !== label)
    .join(", ");

  return {
    id: `${row.osm_type ?? "x"}${row.osm_id ?? row.place_id}`,
    label,
    context,
    display: row.display_name,
    importance: Number(row.importance) || 0,
    kindRank: kindRank(row),
    lat: Number(row.lat),
    lng: Number(row.lon),
  };
}

/**
 * People navigating search for areas and roads far more often than for shops.
 * Without this, typing "bismillah" put three chicken shops above Bismillah
 * Nagar simply because they were marginally closer.
 */
function kindRank(row) {
  const cls = (row.class || "").toLowerCase();
  if (cls === "place" || cls === "boundary") return 2;
  if (cls === "highway") return 1;
  return 0;
}

/** How well the place name answers what was typed. Higher is better. */
function nameScore(label, query) {
  const name = label.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (name === q) return 3;
  if (name.startsWith(q)) return 2;
  if (name.includes(q)) return 1;
  return 0;
}

/**
 * Free-text place search, local-first.
 *
 * Nominatim's viewbox is only a soft hint and loses to high-"importance"
 * matches elsewhere — searching "bismillah" from Bengaluru returned results in
 * Maharashtra, Gujarat and Andhra Pradesh before this. So the near box is
 * queried with bounded=1 first, and the rest of India is only brought in when
 * the local search is thin. That also keeps it to one request for most
 * searches, which matters on Nominatim's public endpoint.
 *
 * Results are returned in two tiers; `nearby` marks the local ones so the list
 * can show where a far-away result actually is.
 */
export async function geocode(query, { signal, near } = {}) {
  const centre = near ?? searchCentre;
  const q = query.trim();
  if (q.length < 2) return [];

  const localRows = await queryNominatim({
    q,
    viewbox: localViewbox(centre),
    bounded: true,
    limit: 8,
    signal,
  });

  const seen = new Set();
  const local = [];
  for (const row of localRows) {
    const item = shape(row);
    if (seen.has(item.id) || !isInIndia(item)) continue;
    seen.add(item.id);
    local.push({ ...item, nearby: true, distanceKm: haversineKm(centre, item) });
  }

  local.sort(
    (a, b) =>
      nameScore(b.label, q) - nameScore(a.label, q) ||
      b.kindRank - a.kindRank ||
      a.distanceKm - b.distanceKm,
  );

  // Enough good local answers — no need to trouble the wider index.
  if (local.length >= 4) return local.slice(0, 7);

  let wider = [];
  try {
    const widerRows = await queryNominatim({
      q,
      // Soft bias, not bounded: still prefers near matches but lets the rest
      // of the country through when there is nothing local.
      viewbox: localViewbox(centre),
      bounded: false,
      limit: 8,
      signal,
    });
    for (const row of widerRows) {
      const item = shape(row);
      if (seen.has(item.id) || !isInIndia(item)) continue;
      seen.add(item.id);
      wider.push({ ...item, nearby: false, distanceKm: haversineKm(centre, item) });
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    // The local tier is still useful on its own.
  }

  wider.sort(
    (a, b) =>
      nameScore(b.label, q) - nameScore(a.label, q) ||
      b.kindRank - a.kindRank ||
      b.importance - a.importance,
  );

  return [...local, ...wider].slice(0, 7);
}

/** Reverse geocode a coordinate to an Indian locality, for the area panel. */
export async function reverseGeocode({ lat, lng }, signal) {
  const params = new URLSearchParams({
    format: "json",
    lat: String(lat),
    lon: String(lng),
    zoom: "16",
    addressdetails: "1",
    "accept-language": "en",
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Could not look up this area.");

  const data = await res.json();
  const a = data.address ?? {};
  return {
    locality: a.suburb || a.neighbourhood || a.village || a.town || a.city_district || null,
    city: a.city || a.town || a.village || a.county || null,
    district: a.state_district || a.county || null,
    state: a.state || null,
    postcode: a.postcode || null,
    country: a.country || null,
    display: data.display_name || null,
  };
}

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
