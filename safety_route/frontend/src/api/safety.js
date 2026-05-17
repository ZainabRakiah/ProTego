// Base URL for the backend API.
// In development, this falls back to your local Flask server.
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:5001";

export async function getSafetyScore(lat, lng) {
  const res = await fetch(`${BACKEND_URL}/api/safety-score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  });

  const data = await res.json();
  return data.safety_score;
}
