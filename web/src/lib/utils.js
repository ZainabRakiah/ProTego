import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Safety scores arrive 0–10 from the ML grid and 0–100 from the rule engine. */
export function normalizeScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  return n <= 10 ? Math.round(n * 10) : Math.round(n);
}

export function safetyBand(score) {
  if (score === null || score === undefined) return "unknown";
  if (score >= 70) return "safe";
  if (score >= 45) return "caution";
  return "risk";
}

export const BAND_META = {
  safe: { label: "Safe", color: "var(--safe)", hint: "Well-lit, patrolled, busy" },
  caution: { label: "Caution", color: "var(--caution)", hint: "Stay alert, share your trip" },
  risk: { label: "High risk", color: "var(--risk)", hint: "Avoid alone after dark" },
  unknown: { label: "Unknown", color: "var(--muted-foreground)", hint: "No data for this area" },
};

export function formatDistance(km) {
  if (km === null || km === undefined || Number.isNaN(Number(km))) return "—";
  const n = Number(km);
  return n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(1)} km`;
}

export function formatTime(unixSeconds) {
  if (!unixSeconds) return "—";
  const ms = unixSeconds > 1e11 ? unixSeconds : unixSeconds * 1000;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
