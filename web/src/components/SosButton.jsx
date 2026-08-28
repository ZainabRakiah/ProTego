import * as React from "react";
import { ShieldAlert, Loader2, Check } from "lucide-react";
import { useGuardian } from "@/lib/guardian";
import { cn } from "@/lib/utils";

const HOLD_MS = 1500;

/**
 * Press-and-hold SOS.
 *
 * A single tap cannot fire an alert: the user must hold for 1.5s, which is the
 * standard guard against pocket-triggered emergency calls. Releasing early
 * cancels and resets the ring.
 *
 * Firing hands off to the guardian layer, so the button and a vigorous shake do
 * exactly the same thing — alert, flash, and rolling evidence capture.
 */
export function SosButton({ className, size = 132 }) {
  const { trigger, panic } = useGuardian();
  const [progress, setProgress] = React.useState(0);
  const [sending, setSending] = React.useState(false);
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
    setSending(true);
    try {
      await trigger("manual");
    } finally {
      setSending(false);
    }
  }

  function beginHold() {
    if (sending || panic.active) return;
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
  const busy = sending || panic.active;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        {/* Idle halo — stops once a hold begins so the ring reads as progress. */}
        {!busy && progress === 0 ? (
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
          aria-label="Hold to send an SOS"
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
          {sending ? (
            <Loader2 className="size-8 animate-spin" />
          ) : panic.active ? (
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
        {sending
          ? "Sending alert…"
          : panic.active
            ? "Emergency mode running"
            : progress > 0
              ? "Keep holding…"
              : "Press and hold for 1.5s"}
      </p>
    </div>
  );
}
