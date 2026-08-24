import * as React from "react";
import { ShieldAlert, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, formatDistance } from "@/lib/utils";

const HOLD_MS = 1500;

/**
 * Press-and-hold SOS.
 *
 * A single tap cannot fire an alert: the user must hold for 1.5s, which is the
 * standard guard against pocket-triggered emergency calls. Releasing early
 * cancels and resets the ring.
 */
export function SosButton({ position, kind = "safety", className, size = 132 }) {
  const { user } = useAuth();
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState("idle"); // idle | sending | sent
  const frame = React.useRef(null);
  const startedAt = React.useRef(0);

  const cancel = React.useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    setProgress(0);
  }, []);

  React.useEffect(() => cancel, [cancel]);

  async function fire() {
    cancel();
    if (!position) {
      toast.error("No location yet", {
        description: "ProTego needs your location before it can send an alert.",
      });
      return;
    }
    setStatus("sending");
    try {
      const userId = user?.id ?? 0;
      const res =
        kind === "accident"
          ? await api.sosAccident(userId, position.lat, position.lng)
          : await api.sosSafety(userId, position.lat, position.lng);

      setStatus("sent");
      const nearest = res?.nearest_police_km;
      const hospitals = res?.hospitals;
      toast.success("SOS sent", {
        description:
          kind === "accident"
            ? `Logged with your location. Nearest hospital: ${
                hospitals?.[0]?.name ?? "unknown"
              }.`
            : `Logged with your location.${
                nearest !== undefined && nearest !== null
                  ? ` Nearest police: ${formatDistance(nearest)}.`
                  : ""
              }`,
        duration: 8000,
      });
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      setStatus("idle");
      toast.error("Could not send SOS", { description: err.message });
    }
  }

  function beginHold() {
    if (status !== "idle") return;
    startedAt.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startedAt.current;
      const p = Math.min(1, elapsed / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        fire();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  const stroke = 5;
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;

  const busy = status !== "idle";

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        {/* Idle halo — stops once a hold begins so the ring reads as progress. */}
        {status === "idle" && progress === 0 ? (
          <span
            aria-hidden
            className="animate-pulse-ring absolute inset-2 rounded-full bg-destructive/30"
          />
        ) : null}

        <svg
          aria-hidden
          className="absolute inset-0 -rotate-90"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--destructive)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${progress * c} ${c}`}
          />
        </svg>

        <button
          type="button"
          disabled={busy}
          onPointerDown={beginHold}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
              e.preventDefault();
              beginHold();
            }
          }}
          onKeyUp={cancel}
          aria-label={`Hold to send ${kind === "accident" ? "accident" : "safety"} SOS`}
          className={cn(
            "relative grid select-none place-items-center rounded-full text-destructive-foreground",
            "bg-gradient-to-b from-[oklch(0.7_0.22_25)] to-[oklch(0.55_0.22_25)]",
            "shadow-[0_10px_36px_-10px_oklch(0.6_0.22_25/0.85)]",
            "transition-transform duration-150 active:scale-95",
            "focus-visible:ring-4 focus-visible:ring-destructive/40 focus-visible:outline-none",
            "disabled:cursor-not-allowed",
          )}
          style={{ width: size - 26, height: size - 26 }}
        >
          {status === "sending" ? (
            <Loader2 className="size-8 animate-spin" />
          ) : status === "sent" ? (
            <Check className="size-9" />
          ) : (
            <span className="flex flex-col items-center gap-0.5">
              <ShieldAlert className="size-7" />
              <span className="text-lg font-bold tracking-wider">SOS</span>
            </span>
          )}
        </button>
      </div>

      <p className="text-center text-xs text-muted-foreground" aria-live="polite">
        {status === "sending"
          ? "Sending alert…"
          : status === "sent"
            ? "Alert sent and logged"
            : progress > 0
              ? "Keep holding…"
              : "Press and hold for 1.5s"}
      </p>
    </div>
  );
}
