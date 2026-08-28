import * as React from "react";

/**
 * Vigorous-shake detector for the panic trigger.
 *
 * A single hard jolt is not a shake — putting the phone down, a pocket bump and
 * a jog step all clear any sensible magnitude threshold. What separates the
 * gesture we want (someone whipping the phone back and forth while running) is
 * *repetition*: several direction reversals, each above threshold, inside a
 * short window. Requiring reversals is what keeps this from firing in a bag.
 */

/** Peak acceleration above rest, in m/s², that counts as one jolt. */
const JOLT_G = 18;
/** Jolts needed inside WINDOW_MS to call it a shake. */
export const JOLT_COUNT = 5;
const WINDOW_MS = 1400;
/** Ignore everything for this long after a trigger, so one shake fires once. */
const COOLDOWN_MS = 25000;
const GRAVITY = 9.81;

export function motionSupported() {
  return typeof window !== "undefined" && "DeviceMotionEvent" in window;
}

/** iOS 13+ gates the sensor behind a call made from a user gesture. */
export function motionNeedsPermission() {
  return motionSupported() && typeof window.DeviceMotionEvent.requestPermission === "function";
}

export async function requestMotionPermission() {
  if (!motionNeedsPermission()) return motionSupported() ? "granted" : "unsupported";
  try {
    return await window.DeviceMotionEvent.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * The shared devicemotion listener. `onShake` fires on a real shake; `onSample`
 * gets every reading and is only wired up when something is drawing a meter,
 * because it fires ~60 times a second.
 */
function listen({ sensitivity, onShake, onSample }) {
  const threshold = JOLT_G / Math.max(0.4, sensitivity);
  let jolts = [];
  let lastSign = 0;
  let cooldownUntil = 0;

  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity ?? e.acceleration;
    if (!a || a.x === null) return;

    const magnitude = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    // accelerationIncludingGravity rests at ~9.81; acceleration rests at ~0.
    const excess = Math.abs(magnitude - (e.accelerationIncludingGravity ? GRAVITY : 0));
    const now = Date.now();

    jolts = jolts.filter((t) => now - t < WINDOW_MS);
    onSample?.({ peak: excess, jolts: jolts.length, threshold });

    if (now < cooldownUntil || excess < threshold) return;

    // Only count a jolt when the dominant axis flipped direction: that is the
    // back-and-forth of a real shake rather than one big knock.
    const dominant = Math.max(Math.abs(a.x ?? 0), Math.abs(a.y ?? 0), Math.abs(a.z ?? 0));
    const axis =
      Math.abs(a.x ?? 0) === dominant ? a.x : Math.abs(a.y ?? 0) === dominant ? a.y : a.z;
    const sign = Math.sign(axis ?? 0);
    if (sign !== 0 && sign === lastSign) return;
    lastSign = sign;

    jolts.push(now);
    if (jolts.length >= JOLT_COUNT) {
      jolts = [];
      lastSign = 0;
      cooldownUntil = now + COOLDOWN_MS;
      onShake?.();
    }
  };

  window.addEventListener("devicemotion", onMotion);
  return () => window.removeEventListener("devicemotion", onMotion);
}

/**
 * Calls `onShake()` when the device is shaken hard and repeatedly.
 *
 * Holds no state on purpose: this runs app-wide, and re-rendering the whole
 * tree on every accelerometer sample would be a tax paid on every step taken.
 *
 * @param {{ enabled?: boolean, sensitivity?: number }} options
 *   `sensitivity` scales the jolt threshold: 1 is the default, higher means a
 *   lighter shake is enough.
 */
export function useShakeDetector(onShake, { enabled = true, sensitivity = 1 } = {}) {
  const handler = React.useRef(onShake);
  handler.current = onShake;

  React.useEffect(() => {
    if (!enabled || !motionSupported()) return;
    return listen({ sensitivity, onShake: () => handler.current?.() });
  }, [enabled, sensitivity]);
}

/**
 * Live readout of shake strength, for the settings meter only. Samples are
 * throttled to ~8/s — enough to feel live, cheap enough to render.
 */
export function useShakeMeter({ enabled = true, sensitivity = 1 } = {}) {
  const [reading, setReading] = React.useState({ peak: 0, jolts: 0, threshold: JOLT_G });

  React.useEffect(() => {
    if (!enabled || !motionSupported()) return;
    let last = 0;
    return listen({
      sensitivity,
      onSample: (sample) => {
        const now = Date.now();
        if (now - last < 120) return;
        last = now;
        setReading(sample);
      },
    });
  }, [enabled, sensitivity]);

  return reading;
}
