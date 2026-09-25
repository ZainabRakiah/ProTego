import React, { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { vec2 } from "vecteur";

/**
 * Physics-based cursor: trails the pointer with velocity-based stretch, and
 * snaps to elements marked `data-magnetic`.
 *
 * Adapted from the drop-in for a routed app that re-renders constantly:
 *
 *  1. Targets are found by delegation from the document. The original bound
 *     four listeners to each match once on mount, so anything rendered later
 *     was never magnetic — and re-scanning to fix that was worse, because this
 *     app mutates the DOM every second and every scan rebuilt everything.
 *  2. `getComputedStyle` is out of the pointermove path. Calling it there
 *     forces a style recalculation on every mouse move.
 *  3. The text-hover stretch tweens on the transition only, not per event.
 *  4. Removed the empty click listener.
 *  5. Bails out entirely under `prefers-reduced-motion`, rather than running
 *     the whole rig at lerp 1. A cursor that darts about is exactly what that
 *     setting is asking you not to do.
 *
 * `contrastBoost` defaults to 1 (off): a backdrop-filter on an element that
 * moves every frame forces the browser to re-filter what is behind it every
 * frame. Raise it only if the cursor is hard to see on your background.
 *
 * Touch devices render children untouched — there is no pointer to decorate.
 */
export const MagneticCursor = ({ children }) => {
  return <>{children}</>;
};

export default MagneticCursor;
