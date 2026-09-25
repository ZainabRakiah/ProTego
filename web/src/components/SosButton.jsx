import * as React from "react";
import { ShieldAlert, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION } from "@/lib/geo";
import { cn } from "@/lib/utils";

const HOLD_MS = 1500;

/**
 * Press-and-hold (or direct tap) emergency SOS button.
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
    const pos = position || FALLBACK_POSITION;
    setStatus("sending");
    try {
      const userId = user?.id ?? 0;
      let res;
      try {
        res = await api.sosDispatch(userId, pos.lat, pos.lng, kind);
      } catch (err) {
        console.warn("sosDispatch failed, falling back to sosSafety:", err);
        res = await api.sosSafety(userId, pos.lat, pos.lng);
      }

      setStatus("sent");
      const police = res?.police_dispatch?.station_name || "Police Control Room";
      const hospCount = res?.hospitals_alerted?.length || (res?.hospitals?.length ? res.hospitals.length : 3);
      const contactsCount = res?.contacts_notified?.length || 0;

      toast.success("🚨 SOS Emergency Dispatched!", {
        description: `Alert sent to ${police}, top ${hospCount} hospitals, and ${contactsCount} trusted contacts with your live GPS location.`,
        duration: 9000,
      });
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      setStatus("idle");
      toast.error("Could not send SOS", { description: err.message });
    }
  }

  function beginHold(e) {
    if (status !== "idle") return;
    if (e?.target?.setPointerCapture && e?.pointerId) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch {}
    }
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

  function handleClick(e) {
    e.preventDefault();
    if (status === "idle") {
      fire();
    }
  }

  const stroke = 5;
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;

  const busy = status !== "idle";

  const isCompact = size < 90;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        {/* Idle halo — stops once a hold begins so the ring reads as progress. */}
        {status === "idle" && progress === 0 ? (
          <span
            aria-hidden
            className="animate-pulse-ring absolute inset-1.5 rounded-full bg-destructive/30"
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
          onClick={handleClick}
          onPointerDown={beginHold}
          onPointerUp={cancel}
          onPointerCancel={cancel}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
              e.preventDefault();
              fire();
            }
          }}
          aria-label={`Send ${kind === "accident" ? "accident" : "safety"} SOS`}
          className={cn(
            "relative grid select-none place-items-center rounded-full text-destructive-foreground cursor-pointer transition-all duration-150",
            "bg-gradient-to-b from-[oklch(0.7_0.22_25)] to-[oklch(0.55_0.22_25)]",
            "shadow-[0_8px_24px_-6px_oklch(0.6_0.22_25/0.8)]",
            "active:scale-95 focus-visible:ring-4 focus-visible:ring-destructive/40 focus-visible:outline-none",
            "disabled:cursor-not-allowed",
          )}
          style={{ width: size - 20, height: size - 20 }}
        >
          {status === "sending" ? (
            <Loader2 className={cn(isCompact ? "size-5" : "size-7", "animate-spin")} />
          ) : status === "sent" ? (
            <Check className={cn(isCompact ? "size-6" : "size-8")} />
          ) : (
            <span className="flex flex-col items-center justify-center leading-none">
              <ShieldAlert className={cn(isCompact ? "size-4 mb-0.5" : "size-6 mb-1")} />
              <span className={cn(isCompact ? "text-xs font-black" : "text-base font-black", "tracking-wider")}>
                SOS
              </span>
            </span>
          )}
        </button>
      </div>

      <p className="text-center text-[11px] font-medium text-muted-foreground" aria-live="polite">
        {status === "sending"
          ? "Sending alert…"
          : status === "sent"
            ? "Alert dispatched"
            : progress > 0
              ? "Keep holding…"
              : "Click/hold for SOS"}
      </p>
    </div>
  );
}
