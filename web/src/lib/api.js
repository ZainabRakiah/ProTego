/**
 * Thin client over the Flask API in backend/app.py.
 *
 * In dev, Vite proxies /api to the Flask server, so requests stay same-origin.
 * In production the Flask server serves this bundle, so the same paths work.
 */
const BASE = import.meta.env.VITE_API_BASE || "";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new ApiError(
      "Can't reach the ProTego server. Is the backend running on port 5001?",
      0,
      null,
    );
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && (data.error || data.message)) ||
      (typeof data === "string" && data) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data;
}

export const api = {
  health: () => request("/api/health"),

  // --- auth ---
  signup: (payload) => request("/api/signup", { method: "POST", body: payload }),
  login: (email, password) => request("/api/login", { method: "POST", body: { email, password } }),
  updateProfile: (payload) => request("/api/update-profile", { method: "POST", body: payload }),

  // --- password reset (phone-verified; see backend/app.py) ---
  forgotPassword: (email, phone) =>
    request("/api/password/forgot", { method: "POST", body: { email, phone } }),
  resetPassword: (token, password) =>
    request("/api/password/reset", { method: "POST", body: { token, password } }),

  // --- safety intelligence ---
  safetyPoint: (lat, lng, hour) =>
    request(
      `/api/safety-point?lat=${lat}&lng=${lng}${hour !== undefined ? `&hour=${hour}` : ""}`,
    ),
  safetyGrid: (bounds, hour) =>
    request(
      `/api/safety-grid?minLat=${bounds.minLat}&maxLat=${bounds.maxLat}` +
        `&minLng=${bounds.minLng}&maxLng=${bounds.maxLng}` +
        (hour !== undefined ? `&hour=${hour}` : ""),
    ),
  /**
   * Safest route through an ordered trip.
   * Pass an array of 2+ {lat,lng} (start, ...stops, destination), or the
   * legacy (start, end) pair.
   */
  safestRoute: (stopsOrStart, optionsOrEnd, maybeSignal) => {
    const isList = Array.isArray(stopsOrStart);
    const opts = isList ? (optionsOrEnd ?? {}) : {};
    const body = isList
      ? { stops: stopsOrStart, mode: opts.mode ?? "walk" }
      : { start: stopsOrStart, end: optionsOrEnd };
    return request("/api/safest-route", {
      method: "POST",
      body,
      signal: isList ? opts.signal : maybeSignal,
    });
  },
  hospitalsNearby: (lat, lng) => request(`/api/hospitals-nearby?lat=${lat}&lng=${lng}`),

  // --- emergency ---
  sosSafety: (user_id, lat, lng, radius_km) =>
    request("/api/emergency/sos-safety", {
      method: "POST",
      body: { user_id, lat, lng, ...(radius_km ? { radius_km } : {}) },
    }),
  sosNotifications: (sosId) => request(`/api/emergency/sos/${sosId}/notifications`),
  sosAccident: (user_id, lat, lng) =>
    request("/api/emergency/sos-accident", { method: "POST", body: { user_id, lat, lng } }),
  accidentThirdParty: (lat, lng, label) =>
    request("/api/emergency/accident-third-party", { method: "POST", body: { lat, lng, label } }),

  // --- reports ---
  createReport: (payload) => request("/api/reports", { method: "POST", body: payload }),

  // --- saved locations + trusted contacts ---
  locationsWithContacts: (userId) => request(`/api/locations/${userId}/with-contacts`),
  addLocation: (payload) => request("/api/locations", { method: "POST", body: payload }),
  deleteLocation: (id) => request(`/api/locations/${id}`, { method: "DELETE" }),
  addContact: (payload) => request("/api/contacts", { method: "POST", body: payload }),
  updateContact: (id, payload) => request(`/api/contacts/${id}`, { method: "PUT", body: payload }),
  deleteContact: (id) => request(`/api/contacts/${id}`, { method: "DELETE" }),

  // --- evidence vault ---
  listEvidence: (userId) => request(`/api/evidence/${userId}`),
  saveEvidence: (payload) => request("/api/evidence", { method: "POST", body: payload }),
  deleteEvidence: (id) => request(`/api/evidence/${id}`, { method: "DELETE" }),
};
