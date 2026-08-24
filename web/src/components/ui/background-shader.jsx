import * as React from "react";
import { MeshGradient } from "@paper-design/shaders-react";

/**
 * Animated mesh-gradient backdrop, rendered on the GPU.
 *
 * Shipped as a background *layer* rather than the demo's full page, so it can
 * sit behind real content. It replaces the hand-written per-pixel canvas that
 * used to back the sign-in screen: that loop cost ~17ms of CPU per frame, and
 * this does the same job in a fragment shader.
 *
 * Two guards that matter on a phone, where battery is a safety concern:
 *   - animation stops while the tab is hidden
 *   - `prefers-reduced-motion` renders a still frame instead of animating
 */

/**
 * The lavender family, by name.
 *
 * Replaces a saturated blue mesh that read as generic tech-startup. These are
 * muted rather than neon — the dusty end of purple, which is what makes the
 * set feel considered instead of synthetic.
 */
export const LAVENDER = {
  lavender: "hsl(266, 42%, 76%)",
  lilac: "hsl(280, 38%, 72%)",
  mauve: "hsl(288, 24%, 62%)",
  orchid: "hsl(292, 38%, 60%)",
  heather: "hsl(268, 20%, 58%)",
  periwinkle: "hsl(248, 52%, 72%)",
  wisteria: "hsl(278, 32%, 54%)",
  violet: "hsl(272, 48%, 44%)",
  amethyst: "hsl(276, 44%, 38%)",
  deep: "hsl(268, 46%, 24%)",
};

/**
 * The four the backdrop mixes. Weighted deep, because the app is dark and the
 * pale end of the family disappears entirely behind the scrim — periwinkle is
 * the single light note that keeps it from going flat.
 */
export const PROTEGO_MESH = [
  LAVENDER.deep,
  LAVENDER.amethyst,
  LAVENDER.wisteria,
  LAVENDER.periwinkle,
];

export function MeshBackground({
  colors = PROTEGO_MESH,
  speed = 0.6,
  distortion = 0.8,
  swirl = 0.1,
  scale = 1,
  className = "",
  style,
}) {
  const [reduced, setReduced] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(motion.matches);
    apply();
    motion.addEventListener("change", apply);

    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      motion.removeEventListener("change", apply);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // WebGL can be unavailable (blocklisted driver, hardware acceleration off).
  // A flat gradient in the same colours is better than an empty black screen.
  React.useEffect(() => {
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  const fallback = (
    <div
      aria-hidden
      className={`absolute inset-0 ${className}`}
      style={{
        background: `linear-gradient(140deg, ${colors[0]}, ${colors[1]} 40%, ${colors[2]} 72%, ${colors[3]})`,
        ...style,
      }}
    />
  );

  if (failed) return fallback;

  return (
    <div aria-hidden className={`absolute inset-0 overflow-hidden ${className}`} style={style}>
      <MeshGradient
        // Fills whatever it is placed in, so it works in a card as well as
        // full-screen — the demo hard-coded 100vw/100vh.
        style={{ width: "100%", height: "100%" }}
        /*
         * Cap the pixels the shader actually renders. Unbounded it runs at the
         * device pixel ratio, so a 1440p screen at DPR 2 is ~15M pixels every
         * frame for what is a soft blur. ~1.1M is a 1440x768-ish buffer, scaled
         * up by the GPU for free — invisible on a gradient this diffuse.
         */
        maxPixelCount={1_100_000}
        minPixelRatio={1}
        colors={colors}
        distortion={distortion}
        swirl={swirl}
        offsetX={0}
        offsetY={0}
        scale={scale}
        rotation={0}
        speed={reduced || hidden ? 0 : speed}
      />
    </div>
  );
}

export default MeshBackground;

/** The same palette as a plain gradient, for when the animation is turned off. */
export function StaticMeshBackground({ colors = PROTEGO_MESH, className = "" }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 ${className}`}
      style={{
        background: `linear-gradient(140deg, ${colors[0]}, ${colors[1]} 40%, ${colors[2]} 72%, ${colors[3]})`,
      }}
    />
  );
}
