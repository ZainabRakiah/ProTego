import * as React from "react";

/**
 * The safety map, held on the device.
 *
 * ProTego's whole premise is knowing which streets are safe — and the moment
 * that matters most is the one where there is no signal. The server can score
 * any point, but a phone out on the street cannot reach the server, so the
 * grid travels with the user instead: one ~61KB download covering ~68km of
 * Bengaluru at roughly 110m resolution, cached and read locally.
 *
 * Stored in Cache Storage rather than localStorage: it survives reloads, has
 * no 5MB string limit, and the service worker can serve the same entry.
 */
const PACK_URL = "/api/offline/safety-pack";
const CACHE_NAME = "protego-safety-pack-v1";

let pack = null; // decoded, in memory
let loading = null; // in-flight promise, so concurrent callers share one fetch

function decode(raw) {
  const planeFrom = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  return {
    version: raw.version,
    generated: raw.generated,
    step: raw.step,
    rows: raw.rows,
    cols: raw.cols,
    bounds: raw.bounds,
    day: planeFrom(raw.day),
    night: planeFrom(raw.night),
    police: raw.police ?? [],
    hospitals: raw.hospitals ?? [],
  };
}

async function readCache() {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(PACK_URL);
    return hit ? decode(await hit.json()) : null;
  } catch {
    return null;
  }
}

async function writeCache(response) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(PACK_URL, response);
  } catch {
    /* a full or blocked cache is not fatal — the pack still works this session */
  }
}

/**
 * Make the pack available. Serves the cached copy immediately when present,
 * and only reaches the network if there is nothing stored yet.
 */
export async function ensurePack({ refresh = false } = {}) {
  if (pack && !refresh) return pack;
  if (loading && !refresh) return loading;

  loading = (async () => {
    if (!refresh) {
      const cached = await readCache();
      if (cached) {
        pack = cached;
        return pack;
      }
    }

    const res = await fetch(PACK_URL);
    if (!res.ok) throw new Error("Could not download the offline safety map.");
    // The body can only be read once, so keep a clone for the cache.
    await writeCache(res.clone());
    pack = decode(await res.json());
    return pack;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** Already-downloaded pack, if any. Never touches the network. */
export function getPack() {
  return pack;
}

export async function loadCachedPack() {
  if (pack) return pack;
  pack = await readCache();
  return pack;
}

export async function clearPack() {
  pack = null;
  if (typeof caches !== "undefined") {
    try {
      await caches.delete(CACHE_NAME);
    } catch {
      /* nothing to do */
    }
  }
}

function isNightHour(hour) {
  return hour >= 18 || hour < 6;
}

/**
 * Safety score 0-100 at a point, straight from the device.
 * Returns null outside the covered area or before the pack is downloaded.
 */
export function scoreAt(lat, lng, { hour = new Date().getHours() } = {}) {
  if (!pack) return null;
  const { bounds, step, rows, cols } = pack;

  const iy = Math.round((lat - bounds.minLat) / step);
  const ix = Math.round((lng - bounds.minLng) / step);
  if (iy < 0 || iy >= rows || ix < 0 || ix >= cols) return null;

  const plane = isNightHour(hour) ? pack.night : pack.day;
  // Bytes hold score * 2.55, so one byte spans 0-100 in 0.4 steps.
  return plane[iy * cols + ix] / 2.55;
}

/** True when the point falls inside the downloaded map. */
export function covers(lat, lng) {
  if (!pack) return false;
  const b = pack.bounds;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

function haversineKm(a, b) {
  const R = 6371;
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t;
  const dLng = (b.lng - a.lng) * t;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest police station from the packed list, with no network. */
export function nearestPolice(lat, lng) {
  if (!pack?.police?.length) return null;
  let best = null;
  for (const [plat, plng] of pack.police) {
    const km = haversineKm({ lat, lng }, { lat: plat, lng: plng });
    if (!best || km < best.distanceKm) best = { lat: plat, lng: plng, distanceKm: km };
  }
  return best;
}

/** Nearest hospitals from the packed list, with no network. */
export function nearestHospitals(lat, lng, limit = 5) {
  if (!pack?.hospitals?.length) return [];
  return pack.hospitals
    .map((h) => ({ ...h, distance_km: haversineKm({ lat, lng }, h) }))
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);
}

/**
 * Sample the safety along a path — used to describe a direction when there is
 * no connection to compute a real route.
 */
export function scoreAlong(from, to, { hour, samples = 24 } = {}) {
  const scores = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const s = scoreAt(from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t, {
      hour,
    });
    if (s !== null) scores.push(s);
  }
  if (!scores.length) return null;
  return {
    average: scores.reduce((a, b) => a + b, 0) / scores.length,
    worst: Math.min(...scores),
    samples: scores.length,
  };
}

/** Compass bearing and distance, for the offline "which way" readout. */
export function bearingTo(from, to) {
  const t = Math.PI / 180;
  const dLng = (to.lng - from.lng) * t;
  const y = Math.sin(dLng) * Math.cos(to.lat * t);
  const x =
    Math.cos(from.lat * t) * Math.sin(to.lat * t) -
    Math.sin(from.lat * t) * Math.cos(to.lat * t) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const compass = [
    "north", "north-east", "east", "south-east",
    "south", "south-west", "west", "north-west",
  ][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  return { degrees: ((deg % 360) + 360) % 360, compass, distanceKm: haversineKm(from, to) };
}

/** Subscribe to online/offline so the UI can say which mode it is in. */
export function useOnlineStatus() {
  const [online, setOnline] = React.useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  React.useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Pack state for the UI: ready, size, when it was built. */
export function useOfflinePack() {
  const [state, setState] = React.useState({ ready: Boolean(pack), pack, error: null, busy: false });

  React.useEffect(() => {
    let alive = true;
    loadCachedPack()
      .then((p) => alive && setState((s) => ({ ...s, ready: Boolean(p), pack: p })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const download = React.useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const p = await ensurePack({ refresh: true });
      setState({ ready: true, pack: p, error: null, busy: false });
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err.message }));
    }
  }, []);

  const remove = React.useCallback(async () => {
    await clearPack();
    setState({ ready: false, pack: null, error: null, busy: false });
  }, []);

  return { ...state, download, remove };
}
