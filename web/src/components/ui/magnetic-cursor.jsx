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
export const MagneticCursor = ({
  children,
  lerpAmount = 0.1,
  magneticFactor = 0.2,
  hoverPadding = 12,
  hoverAttribute = "data-magnetic",
  cursorSize = 24,
  cursorColor = "white",
  blendMode = "exclusion",
  cursorClassName = "",
  shape = "circle",
  disableOnTouch = true,
  speedMultiplier = 0.02,
  maxScaleX = 1,
  maxScaleY = 0.3,
  contrastBoost = 1,
}) => {
  const cursorRef = useRef(null);
  const stateRef = useRef(null);
  const [disabled, setDisabled] = useState(true);

  const configRef = useRef({});
  configRef.current = {
    magneticFactor,
    speedMultiplier,
    maxScaleX,
    maxScaleY,
    cursorSize,
    lerpAmount,
    hoverPadding,
    cursorColor,
    shape,
  };

  // Decided after mount so server-rendered and first-paint markup match.
  useEffect(() => {
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    setDisabled((disableOnTouch && touch) || reduced || !fine);
  }, [disableOnTouch]);

  useEffect(() => {
    if (disabled) return undefined;
    const cursorEl = cursorRef.current;
    if (!cursorEl) return undefined;

    gsap.set(cursorEl, { xPercent: -50, yPercent: -50 });

    stateRef.current = {
      el: cursorEl,
      pos: {
        current: vec2(-100, -100),
        target: vec2(-100, -100),
        previous: vec2(-100, -100),
      },
      hover: { isHovered: false },
      isDetaching: false,
      overText: false,
    };

    const update = () => {
      const state = stateRef.current;
      if (!state || state.hover.isHovered) return;

      const { speedMultiplier: sm, maxScaleX: mx, maxScaleY: my, lerpAmount: lerp } =
        configRef.current;

      state.pos.current.lerp(state.pos.target, lerp);
      const delta = state.pos.current.clone().sub(state.pos.previous);
      state.pos.previous.copy(state.pos.current);

      if (state.isDetaching || state.overText) {
        gsap.set(state.el, { x: state.pos.current.x, y: state.pos.current.y, overwrite: "auto" });
        return;
      }

      const speed = Math.hypot(delta.x, delta.y) * sm;
      gsap.set(state.el, {
        x: state.pos.current.x,
        y: state.pos.current.y,
        rotate: (Math.atan2(delta.y, delta.x) * 180) / Math.PI,
        scaleX: 1 + Math.min(speed, mx),
        scaleY: 1 - Math.min(speed, my),
        overwrite: "auto",
      });
    };

    const initializePosition = (event) => {
      const state = stateRef.current;
      if (!state) return;
      const { clientX: x, clientY: y } = event;
      state.pos.current.x = x;
      state.pos.current.y = y;
      state.pos.target.x = x;
      state.pos.target.y = y;
      state.pos.previous.x = x;
      state.pos.previous.y = y;
      gsap.set(cursorEl, { x, y, opacity: 1 });
    };

    const TEXT_TAGS = ["P", "SPAN", "H1", "H2", "H3", "H4", "H5", "H6", "LABEL", "LI"];

    const onPointerMove = (event) => {
      const state = stateRef.current;
      if (!state) return;

      state.pos.target.x = event.clientX;
      state.pos.target.y = event.clientY;

      if (state.hover.isHovered || state.isDetaching) return;

      // Tag check only. getComputedStyle here forced a style recalculation on
      // every mouse move, which is one of the most expensive things you can do
      // in a pointermove handler.
      const isText = TEXT_TAGS.includes(event.target.tagName);

      // Only tween on the transition, not on every move — the original fired a
      // fresh tween per pointermove, which is hundreds of tweens a second.
      if (isText !== state.overText) {
        state.overText = isText;
        gsap.to(cursorEl, {
          scaleX: isText ? 0.5 : 1,
          scaleY: isText ? 1.5 : 1,
          duration: 0.3,
          overwrite: "auto",
        });
      }
    };

    const onLeave = () => gsap.to(cursorEl, { opacity: 0, duration: 0.3 });
    const onEnter = () => gsap.to(cursorEl, { opacity: 1, duration: 0.3 });

    gsap.ticker.add(update);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointermove", initializePosition, { once: true, passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseenter", onEnter);

    /*
     * Magnetic targets are handled by delegation from the document, not by
     * binding four listeners to every match.
     *
     * The previous version re-scanned the DOM on every mutation. This app
     * mutates constantly — a GPS watch updates state every second and the
     * navigation loop runs every frame — so it was tearing down and rebuilding
     * every target's listeners and gsap instances several times a second. That
     * was the lag.
     */
    const pulls = new WeakMap();

    const pullFor = (el) => {
      let pull = pulls.get(el);
      if (!pull) {
        pull = {
          xTo: gsap.quickTo(el, "x", { duration: 1, ease: "elastic.out(1, 0.3)" }),
          yTo: gsap.quickTo(el, "y", { duration: 1, ease: "elastic.out(1, 0.3)" }),
        };
        pulls.set(el, pull);
      }
      return pull;
    };

    let activeTarget = null;
    let magnetRaf = null;

    const enterTarget = (el) => {
      const state = stateRef.current;
      if (!state) return;
      activeTarget = el;
      state.hover.isHovered = true;
      state.isDetaching = false;
      state.overText = false;

      const bounds = el.getBoundingClientRect();
      const radius = window.getComputedStyle(el).borderRadius;
      const colour = el.getAttribute("data-magnetic-color") || configRef.current.cursorColor;
      const grow = configRef.current.hoverPadding * (1 + configRef.current.magneticFactor);

      gsap.killTweensOf(cursorEl);
      gsap.to(cursorEl, {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
        width: bounds.width + grow * 2,
        height: bounds.height + grow * 2,
        borderRadius: radius,
        backgroundColor: colour,
        scaleX: 1,
        scaleY: 1,
        rotate: 0,
        duration: 0.3,
        ease: "power3.out",
        overwrite: "all",
      });
    };

    const leaveTarget = (el) => {
      const state = stateRef.current;
      if (!state) return;

      const { xTo, yTo } = pullFor(el);
      xTo(0);
      yTo(0);

      const x = gsap.getProperty(cursorEl, "x");
      const y = gsap.getProperty(cursorEl, "y");
      state.pos.current.x = x;
      state.pos.current.y = y;
      state.pos.previous.x = x;
      state.pos.previous.y = y;
      state.hover.isHovered = false;
      state.isDetaching = true;
      activeTarget = null;

      const { cursorSize: size, shape: sh, cursorColor: colour } = configRef.current;
      gsap.killTweensOf(cursorEl);
      gsap.to(cursorEl, {
        width: size,
        height: size,
        borderRadius: sh === "circle" ? "50%" : sh === "square" ? "0" : "8px",
        backgroundColor: colour,
        scaleX: 1,
        scaleY: 1,
        duration: 0.35,
        ease: "power3.out",
        overwrite: "all",
        onComplete: () => {
          state.isDetaching = false;
        },
      });
    };

    const onOver = (event) => {
      const el = event.target.closest?.(`[${hoverAttribute}]`);
      if (el && el !== activeTarget) {
        if (activeTarget) leaveTarget(activeTarget);
        enterTarget(el);
      } else if (!el && activeTarget) {
        leaveTarget(activeTarget);
      }
    };

    const onMagnetMove = (event) => {
      if (!activeTarget || magnetRaf) return;
      const { clientX, clientY } = event;
      magnetRaf = requestAnimationFrame(() => {
        magnetRaf = null;
        if (!activeTarget) return;
        const { height, width, left, top } = activeTarget.getBoundingClientRect();
        const { xTo, yTo } = pullFor(activeTarget);
        const factor = configRef.current.magneticFactor;
        xTo((clientX - (left + width / 2)) * factor);
        yTo((clientY - (top + height / 2)) * factor);
      });
    };

    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointermove", onMagnetMove, { passive: true });

    return () => {
      gsap.ticker.remove(update);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointermove", initializePosition);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseenter", onEnter);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointermove", onMagnetMove);
      if (magnetRaf) cancelAnimationFrame(magnetRaf);
      if (activeTarget) gsap.killTweensOf(activeTarget);
      gsap.killTweensOf(cursorEl);
    };
  }, [disabled, hoverAttribute]);

  if (disabled) return <>{children}</>;

  return (
    <>
      <div
        ref={cursorRef}
        aria-hidden="true"
        className={`magnetic-cursor ${cursorClassName}`}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 9999,
          opacity: 0,
          pointerEvents: "none",
          willChange: "transform, width, height",
          backgroundColor: cursorColor,
          mixBlendMode: blendMode,
          width: cursorSize,
          height: cursorSize,
          borderRadius: shape === "circle" ? "50%" : shape === "square" ? "0" : "8px",
          backdropFilter: contrastBoost !== 1 ? `contrast(${contrastBoost})` : "none",
          WebkitBackdropFilter: contrastBoost !== 1 ? `contrast(${contrastBoost})` : "none",
        }}
      />
      {children}
    </>
  );
};

export default MagneticCursor;
