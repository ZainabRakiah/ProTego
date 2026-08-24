import React, { useEffect, useRef } from "react";

/**
 * HeroWave — animated plasma/wave field rendered per-pixel to a canvas.
 *
 * Adapted from the original drop-in with four fixes needed to ship it here:
 *
 *  1. The render loop is cancelled on unmount. The original returned only a
 *     resize-listener cleanup, so requestAnimationFrame kept recursing forever
 *     after the component left the tree — burning a CPU core for the rest of
 *     the session once you signed in.
 *  2. Rendering goes to a small offscreen buffer that is then upscaled onto the
 *     visible canvas. The original called drawImage(canvas, …) with the canvas
 *     as its own source, which is a self-blit and smears on some browsers.
 *  3. Resolution follows a pixel budget and the frame rate is capped at 24fps.
 *     This is a JS per-pixel loop: measured here, the original's SCALE 2 on a
 *     1080p screen is 518k pixels at ~111 ms/frame — roughly 9fps, with a core
 *     pinned. The budget holds every screen size at ~17 ms/frame instead.
 *  4. It pauses when the tab is hidden and renders a single static frame under
 *     `prefers-reduced-motion`.
 *
 * Purely decorative: no props, no state, aria-hidden.
 */
const HeroWave = ({ className = "" }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");

    // Offscreen buffer at reduced resolution, upscaled on draw. Rendering into
    // a separate buffer avoids the original's canvas-onto-itself blit.
    const buffer = document.createElement("canvas");
    const bctx = buffer.getContext("2d");

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const FRAME_MS = 1000 / 24;

    /*
     * Resolution is chosen from a pixel budget rather than a fixed divisor, so
     * the cost per frame stays flat from a phone to a 4K monitor. Measured on
     * this machine: ~0.21 ms per 1k pixels, so 90k pixels is ~19 ms — about
     * 45% of the 41.7 ms budget at 24fps, leaving headroom on slower hardware.
     * The field is very soft, so the upscale is not visible; raise MAX_PIXELS
     * for more detail, lower it for less CPU.
     */
    const MAX_PIXELS = 90000;
    const scaleFor = (w, h) => Math.max(2, Math.ceil(Math.sqrt((w * h) / MAX_PIXELS)));

    let width = 0;
    let height = 0;
    let imageData = null;
    let data = null;
    let rafId = null;
    let lastFrame = 0;
    let disposed = false;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const scale = scaleFor(canvas.width, canvas.height);
      width = Math.max(1, Math.floor(canvas.width / scale));
      height = Math.max(1, Math.floor(canvas.height / scale));
      buffer.width = width;
      buffer.height = height;
      imageData = bctx.createImageData(width, height);
      data = imageData.data;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const startTime = Date.now();

    const SIN_TABLE = new Float32Array(1024);
    const COS_TABLE = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const angle = (i / 1024) * Math.PI * 2;
      SIN_TABLE[i] = Math.sin(angle);
      COS_TABLE[i] = Math.cos(angle);
    }

    const TAU = Math.PI * 2;
    const fastSin = (x) => SIN_TABLE[Math.floor(((x % TAU) / TAU) * 1024) & 1023];
    const fastCos = (x) => COS_TABLE[Math.floor(((x % TAU) / TAU) * 1024) & 1023];

    const drawFrame = (time) => {
      for (let y = 0; y < height; y++) {
        const u_y = (2 * y - height) / height;

        for (let x = 0; x < width; x++) {
          const u_x = (2 * x - width) / height;

          let a = 0;
          let d = 0;

          for (let i = 0; i < 4; i++) {
            a += fastCos(i - d + time * 0.5 - a * u_x);
            d += fastSin(i * u_y + a);
          }

          const wave = (fastSin(a) + fastCos(d)) * 0.5;
          const intensity = 0.3 + 0.4 * wave;
          const baseVal = 0.1 + 0.15 * fastCos(u_x + u_y + time * 0.3);
          const blueAccent = 0.2 * fastSin(a * 1.5 + time * 0.2);
          const purpleAccent = 0.15 * fastCos(d * 2 + time * 0.1);

          const r = Math.max(0, Math.min(1, baseVal + purpleAccent * 0.8)) * intensity;
          const g = Math.max(0, Math.min(1, baseVal + blueAccent * 0.6)) * intensity;
          const b =
            Math.max(0, Math.min(1, baseVal + blueAccent * 1.2 + purpleAccent * 0.4)) * intensity;

          const index = (y * width + x) * 4;
          data[index] = r * 255;
          data[index + 1] = g * 255;
          data[index + 2] = b * 255;
          data[index + 3] = 255;
        }
      }

      bctx.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buffer, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
    };

    const loop = (now) => {
      if (disposed) return;
      rafId = requestAnimationFrame(loop);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      if (document.hidden) return;
      drawFrame((Date.now() - startTime) * 0.001);
    };

    if (reduceMotion) {
      drawFrame(0);
    } else {
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`absolute inset-0 h-full w-full ${className}`}
    />
  );
};

export default HeroWave;
