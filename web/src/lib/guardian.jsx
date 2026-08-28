import * as React from "react";
import { toast } from "sonner";
import { BurstCamera } from "@/lib/cameraBurst";
import {
  motionNeedsPermission,
  motionSupported,
  requestMotionPermission,
  useShakeDetector,
} from "@/lib/useShakeDetector";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FALLBACK_POSITION, useGeolocation } from "@/lib/geo";

/**
 * The always-on safety layer: continuous evidence capture, and the shake
 * gesture that starts everything at once.
 *
 * It lives above the router so a burst survives navigation — if the camera is
 * running because something is happening, changing page must not end it.
 */

const GuardianContext = React.createContext(null);

export const CAPTURE_INTERVAL_MS = 5000;
/**
 * How far a trusted contact's saved place can be and still count as "nearby".
 * Contacts inside this ring are alerted first and alone; everyone else follows
 * a few seconds later, so the person who can actually reach the user is the
 * first phone to ring.
 */
export const ALERT_RADIUS_KM = 30;
const SETTINGS_KEY = "protego.shake";
const BACKLOG_KEY = "protego.evidence.backlog";
/** Base64 frames are heavy; localStorage gives out long before this feels big. */
const BACKLOG_MAX = 8;

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { enabled: raw.enabled !== false, sensitivity: Number(raw.sensitivity) || 1 };
  } catch {
    return { enabled: true, sensitivity: 1 };
  }
}

function readBacklog() {
  try {
    const v = JSON.parse(localStorage.getItem(BACKLOG_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeBacklog(items) {
  try {
    localStorage.setItem(BACKLOG_KEY, JSON.stringify(items.slice(-BACKLOG_MAX)));
  } catch {
    /* Quota is expected once a few frames are stashed — the newest still win. */
  }
}

/** Turn the alert response into the one line that matters in the moment. */
function describeAlert(res) {
  const nearest = res?.nearest_contact;
  const total = res?.notified_count ?? 0;
  if (!total) {
    return "Your location is logged and the camera is recording evidence.";
  }
  const others = total - 1;
  const where =
    nearest?.distance_km != null ? ` · ${nearest.distance_km} km away` : "";
  const rest = others > 0 ? `, then ${others} more` : "";
  return nearest
    ? `${nearest.name} alerted first${where}${rest}. Camera is recording.`
    : `${total} contact${total === 1 ? "" : "s"} alerted. Camera is recording.`;
}

export function GuardianProvider({ children }) {
  const { user } = useAuth();
  const { position, accuracy } = useGeolocation();

  const cameraRef = React.useRef(null);
  const camera = React.useCallback(() => {
    cameraRef.current ??= new BurstCamera();
    return cameraRef.current;
  }, []);

  // Latest fix, read at capture time so every frame carries fresh coordinates.
  const fix = React.useRef({ position: null, accuracy: null });
  fix.current = { position, accuracy };

  const [burst, setBurst] = React.useState({
    active: false,
    mode: "NORMAL",
    saved: 0,
    pending: 0,
    failed: 0,
    night: false,
    torch: false,
    torchSupported: false,
    error: null,
  });
  // Bumped each time a stream actually opens, so previews know when to attach.
  const [streamId, setStreamId] = React.useState(0);
  const [panic, setPanic] = React.useState({
    active: false,
    since: null,
    source: null,
    alert: null,
  });
  const panicRef = React.useRef(false);
  const [settings, setSettings] = React.useState(loadSettings);
  const [motionPermission, setMotionPermission] = React.useState(() =>
    motionNeedsPermission() ? "prompt" : motionSupported() ? "granted" : "unsupported",
  );

  React.useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* non-fatal */
    }
  }, [settings]);

  /* ---- Upload queue --------------------------------------------------- */
  // Frames post one at a time. A failure never blocks capture: the frame drops
  // into a localStorage backlog and is retried when the network comes back.
  const queue = React.useRef([]);
  const draining = React.useRef(false);

  const drain = React.useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current[0];
        try {
          await api.saveEvidence(item);
          queue.current.shift();
          setBurst((b) => ({ ...b, saved: b.saved + 1, pending: queue.current.length }));
        } catch {
          queue.current.shift();
          writeBacklog([...readBacklog(), item]);
          setBurst((b) => ({ ...b, failed: b.failed + 1, pending: queue.current.length }));
        }
      }
    } finally {
      draining.current = false;
    }
  }, []);

  const enqueue = React.useCallback(
    (dataUrl, type) => {
      const p = fix.current.position ?? FALLBACK_POSITION;
      queue.current.push({
        user_id: user?.id,
        image_base64: dataUrl,
        lat: p.lat,
        lng: p.lng,
        accuracy: fix.current.accuracy ?? null,
        type,
        timestamp: Math.floor(Date.now() / 1000),
      });
      setBurst((b) => ({ ...b, pending: queue.current.length }));
      drain();
    },
    [drain, user?.id],
  );

  /** Retry anything a dead network left behind. */
  const flushBacklog = React.useCallback(async () => {
    const items = readBacklog();
    if (!items.length) return 0;
    writeBacklog([]);
    let sent = 0;
    for (const item of items) {
      try {
        await api.saveEvidence(item);
        sent += 1;
      } catch {
        writeBacklog([...readBacklog(), item]);
      }
    }
    if (sent) {
      setBurst((b) => ({
        ...b,
        saved: b.saved + sent,
        failed: Math.max(0, b.failed - sent),
      }));
    }
    return sent;
  }, []);

  React.useEffect(() => {
    const onOnline = () => flushBacklog();
    window.addEventListener("online", onOnline);
    flushBacklog();
    return () => window.removeEventListener("online", onOnline);
  }, [flushBacklog]);

  /* ---- Burst control -------------------------------------------------- */
  const startBurst = React.useCallback(
    async (mode = "NORMAL") => {
      setBurst((b) => ({ ...b, error: null, mode, active: true, saved: 0, failed: 0 }));
      await camera().start({
        intervalMs: CAPTURE_INTERVAL_MS,
        autoTorch: true,
        onFrame: ({ dataUrl, night }) => {
          enqueue(dataUrl, mode);
          setBurst((b) => ({
            ...b,
            night,
            torch: camera().torchOn,
            torchSupported: camera().torchSupported,
          }));
        },
        onError: (message) => {
          setBurst((b) => ({ ...b, active: false, error: message }));
          toast.error("Camera could not start", { description: message });
        },
      });
      setBurst((b) => ({ ...b, torchSupported: camera().torchSupported }));
      if (camera().running) setStreamId((n) => n + 1);
    },
    [camera, enqueue],
  );

  const stopBurst = React.useCallback(() => {
    camera().stop();
    setBurst((b) => ({ ...b, active: false, torch: false }));
  }, [camera]);

  const setTorch = React.useCallback(
    async (on) => {
      const ok = await camera().setTorch(on);
      if (ok) setBurst((b) => ({ ...b, torch: camera().torchOn }));
      return ok;
    },
    [camera],
  );

  const attachPreview = React.useCallback((el) => camera().attach(el), [camera]);

  /* ---- Panic ---------------------------------------------------------- */
  // Flash on, alert out, camera rolling — the light and the buzz are the parts
  // that help in the first second, so they do not wait on the network.
  const trigger = React.useCallback(
    async (source = "manual") => {
      if (panicRef.current) return;
      panicRef.current = true;
      setPanic({ active: true, since: Date.now(), source, alert: null });

      navigator.vibrate?.([300, 120, 300, 120, 600]);
      startBurst("SOS").then(() => setTorch(true));

      const p = fix.current.position ?? FALLBACK_POSITION;
      try {
        const res = await api.sosSafety(user?.id ?? 0, p.lat, p.lng, ALERT_RADIUS_KM);
        setPanic((s) => (s.active ? { ...s, alert: res } : s));
        toast.success("SOS sent", {
          description: describeAlert(res),
          duration: 10000,
        });
      } catch (err) {
        toast.error("SOS could not reach the server", {
          description: `${err.message} Evidence is still being captured and saved.`,
          duration: 10000,
        });
      }
    },
    [startBurst, setTorch, user?.id],
  );

  const cancelPanic = React.useCallback(() => {
    panicRef.current = false;
    setPanic({ active: false, since: null, source: null, alert: null });
    stopBurst();
    navigator.vibrate?.(0);
  }, [stopBurst]);

  /* ---- Shake ---------------------------------------------------------- */
  useShakeDetector(() => trigger("shake"), {
    enabled: settings.enabled && motionPermission === "granted",
    sensitivity: settings.sensitivity,
  });

  const enableShake = React.useCallback(async () => {
    const result = await requestMotionPermission();
    setMotionPermission(result);
    if (result === "granted") {
      setSettings((s) => ({ ...s, enabled: true }));
    } else if (result === "denied") {
      toast.error("Motion access was refused", {
        description: "Shake to SOS needs the motion sensor. Allow it in your browser settings.",
      });
    }
    return result;
  }, []);

  // Never leave the torch on or the camera live after the app unmounts.
  React.useEffect(() => () => cameraRef.current?.stop(), []);

  const value = React.useMemo(
    () => ({
      burst,
      panic,
      streamId,
      startBurst,
      stopBurst,
      setTorch,
      attachPreview,
      trigger,
      cancelPanic,
      flushBacklog,
      shake: {
        ...settings,
        supported: motionSupported(),
        permission: motionPermission,
        needsPermission: motionNeedsPermission(),
        enable: enableShake,
        setEnabled: (enabled) => setSettings((s) => ({ ...s, enabled })),
        setSensitivity: (sensitivity) => setSettings((s) => ({ ...s, sensitivity })),
      },
    }),
    [
      burst,
      panic,
      streamId,
      startBurst,
      stopBurst,
      setTorch,
      attachPreview,
      trigger,
      cancelPanic,
      flushBacklog,
      settings,
      motionPermission,
      enableShake,
    ],
  );

  return <GuardianContext.Provider value={value}>{children}</GuardianContext.Provider>;
}

export function useGuardian() {
  const ctx = React.useContext(GuardianContext);
  if (!ctx) throw new Error("useGuardian must be used inside <GuardianProvider>");
  return ctx;
}
