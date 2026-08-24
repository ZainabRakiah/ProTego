import { cn } from "@/lib/utils";

/**
 * Ambient background: two slow-drifting colour fields behind a fine grid.
 *
 * Deliberately built from radial-gradients with soft colour stops rather than
 * `filter: blur()`. A large blur filter has to re-rasterise the layer on every
 * animation frame, which is what makes a page like this feel sticky while
 * scrolling; a gradient composites for free. `will-change: transform` keeps
 * each field on its own compositor layer, and `contain: strict` stops it from
 * ever affecting layout.
 *
 * Purely decorative: hidden from assistive tech, no pointer surface.
 */
export function Aurora({ className }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}
      style={{ contain: "strict" }}
    >
      <div className="absolute inset-0 bg-background" />

      <div
        className="animate-aurora absolute -top-1/2 -left-1/3 size-[85vw] rounded-full"
        style={{
          willChange: "transform",
          background:
            "radial-gradient(circle at 50% 50%, " +
            "oklch(0.62 0.2 292 / 0.32) 0%, " +
            "oklch(0.62 0.2 292 / 0.16) 32%, " +
            "oklch(0.62 0.2 292 / 0.05) 55%, " +
            "transparent 72%)",
        }}
      />
      <div
        className="animate-aurora absolute -right-1/3 -bottom-1/2 size-[80vw] rounded-full"
        style={{
          animationDelay: "-11s",
          willChange: "transform",
          background:
            "radial-gradient(circle at 50% 50%, " +
            "oklch(0.66 0.16 224 / 0.28) 0%, " +
            "oklch(0.66 0.16 224 / 0.14) 34%, " +
            "oklch(0.66 0.16 224 / 0.04) 56%, " +
            "transparent 72%)",
        }}
      />

      {/* Faint grid — reads as a map graticule, ties the visual to navigation. */}
      <div
        className="absolute inset-0 opacity-[0.1]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px)," +
            "linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 85% 55% at 50% 0%, black 25%, transparent 78%)",
        }}
      />
    </div>
  );
}
