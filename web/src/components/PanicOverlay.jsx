import * as React from "react";
import {
  ShieldAlert,
  Camera,
  Flashlight,
  FlashlightOff,
  CloudUpload,
  X,
  Users,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGuardian } from "@/lib/guardian";
import { cn } from "@/lib/utils";

/**
 * What the screen becomes once a shake (or the SOS button) fires.
 *
 * Deliberately loud and deliberately hard to dismiss by accident: the phone is
 * probably being swung around, so a stray tap must not turn the evidence camera
 * off. Dismissing takes a deliberate 1.2s hold.
 */
const CANCEL_HOLD_MS = 1200;

function elapsed(since) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function PanicOverlay() {
  const { panic, burst, streamId, setTorch, attachPreview, cancelPanic } = useGuardian();
  const videoRef = React.useRef(null);
  const [, tick] = React.useReducer((n) => n + 1, 0);
  const [hold, setHold] = React.useState(0);
  const holdFrame = React.useRef(null);

  React.useEffect(() => {
    if (!panic.active) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [panic.active]);

  React.useEffect(() => {
    if (panic.active) attachPreview(videoRef.current);
  }, [panic.active, streamId, attachPreview]);

  const stopHold = React.useCallback(() => {
    if (holdFrame.current) cancelAnimationFrame(holdFrame.current);
    holdFrame.current = null;
    setHold(0);
  }, []);

  function beginHold() {
    const start = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / CANCEL_HOLD_MS);
      setHold(p);
      if (p >= 1) {
        stopHold();
        cancelPanic();
        return;
      }
      holdFrame.current = requestAnimationFrame(step);
    };
    holdFrame.current = requestAnimationFrame(step);
  }

  React.useEffect(() => stopHold, [stopHold]);

  if (!panic.active) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Emergency mode active"
      className="fixed inset-0 z-[100] flex flex-col bg-black/92 backdrop-blur-sm pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/15 px-4 py-3">
        <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-destructive text-destructive-foreground">
          <span aria-hidden className="animate-pulse-ring absolute inset-0 rounded-full bg-destructive/50" />
          <ShieldAlert className="relative size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-destructive-foreground">
            Emergency mode {panic.source === "shake" ? "· triggered by shake" : "active"}
          </p>
          <p className="tnum text-xs text-white/70">
            Running {elapsed(panic.since)} · capturing every 5s
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={burst.torch ? "Turn the flash off" : "Turn the flash on"}
          disabled={!burst.torchSupported}
          onClick={() => setTorch(!burst.torch)}
          className="text-white hover:bg-white/10"
        >
          {burst.torch ? <Flashlight className="size-5" /> : <FlashlightOff className="size-5" />}
        </Button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="size-full object-cover opacity-90"
        />
        {burst.error ? (
          <p className="absolute inset-x-4 top-4 rounded-lg bg-black/80 px-3 py-2 text-center text-xs text-white/90">
            {burst.error}
          </p>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-4 pt-10 pb-4 text-xs text-white/85">
          <Stat icon={Camera} label={`${burst.saved} saved`} />
          {burst.pending ? <Stat icon={CloudUpload} label={`${burst.pending} uploading`} /> : null}
          {burst.night ? <Stat icon={Flashlight} label="Night mode" /> : null}
          {burst.failed ? (
            <Stat icon={CloudUpload} label={`${burst.failed} queued offline`} tone="warn" />
          ) : null}
        </div>
      </div>

      <AlertRoster alert={panic.alert} />

      <div className="px-4 py-4">
        <button
          type="button"
          onPointerDown={beginHold}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className="relative w-full overflow-hidden rounded-xl border border-white/25 py-4 text-sm font-semibold text-white transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-75"
            style={{ width: `${hold * 100}%` }}
          />
          <span className="relative flex items-center justify-center gap-2">
            <X className="size-4" />
            {hold > 0 ? "Keep holding to stop…" : "Hold to stop emergency mode"}
          </span>
        </button>
        <p className="mt-2 text-center text-[11px] text-white/50">
          Everything captured is already in your evidence vault.
        </p>
      </div>
    </div>
  );
}

/**
 * Who is being called, nearest first.
 *
 * In the middle of an emergency the reassuring fact is not "an SOS was sent" —
 * it is that the person twenty minutes away already knows. So the closest
 * contact is named, and the ring behind them is shown as a pending count.
 */
function AlertRoster({ alert }) {
  const waves = alert?.waves;
  if (!waves?.length) return null;

  const [first, ...later] = waves;
  const pending = later.reduce((n, w) => n + w.contacts.length, 0);

  return (
    <div className="border-t border-white/10 px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-white/50 uppercase">
        <Users className="size-3.5" />
        Alerting nearest first
      </div>
      <ul className="space-y-1.5">
        {first.contacts.map((c) => (
          <li
            key={c.contact_id}
            className="flex items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2 text-sm text-white"
          >
            <span className="min-w-0 truncate">
              {c.name}
              {c.location_label ? (
                <span className="text-white/50"> · {c.location_label}</span>
              ) : null}
            </span>
            <span className="tnum shrink-0 text-xs text-white/60">
              {c.distance_km != null ? `${c.distance_km} km` : "no location"}
            </span>
          </li>
        ))}
      </ul>
      {pending ? (
        <p className="tnum mt-2 flex items-center gap-1.5 text-[11px] text-white/45">
          <Clock className="size-3" />
          {pending} more {pending === 1 ? "contact" : "contacts"} in {Math.round(later[0].delay_s)}s
        </p>
      ) : null}
    </div>
  );
}

function Stat({ icon: Icon, label, tone }) {
  return (
    <span
      className={cn(
        "tnum inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1",
        tone === "warn" && "border-caution/40 text-[var(--caution)]",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}
