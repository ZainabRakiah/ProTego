import * as React from "react";
import { BAND_META, cn, safetyBand } from "@/lib/utils";

const START_ANGLE = 135; // bottom-left
const SWEEP = 270; // leaves a 90° gap at the bottom

function polar(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/** SVG arc path from one angle to another, drawn clockwise. */
function arcPath(cx, cy, r, fromDeg, toDeg) {
  const start = polar(cx, cy, r, fromDeg);
  const end = polar(cx, cy, r, toDeg);
  const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/**
 * Radial gauge for a 0–100 safety score.
 *
 * Drawn as explicit arc paths rather than a rotated dash-array circle, so the
 * geometry is readable and the value arc always starts from the same bottom-left
 * origin. Tick marks around the track give the fill a scale to be read against —
 * without them a low score is just a short crescent with no sense of proportion.
 *
 * Colour never carries the reading alone: the number and a text band label are
 * always present.
 */
export function SafetyMeter({ score, size = 156, label = "Area safety", className }) {
  const band = safetyBand(score);
  const meta = BAND_META[band];
  const hasScore = score !== null && score !== undefined;
  const pct = hasScore ? Math.max(0, Math.min(100, score)) : 0;

  const stroke = 12;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - stroke) / 2 - 2;

  // Animate the value arc on mount and whenever the score changes.
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  const valueEnd = START_ANGLE + (shown / 100) * SWEEP;
  const trackPath = arcPath(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP - 0.01);

  const ticks = Array.from({ length: 11 }, (_, i) => {
    const angle = START_ANGLE + (i / 10) * SWEEP;
    const inner = polar(cx, cy, r - stroke / 2 - 5, angle);
    const outer = polar(cx, cy, r - stroke / 2 - (i % 5 === 0 ? 11 : 8), angle);
    return { i, inner, outer, major: i % 5 === 0 };
  });

  return (
    <div className={cn("flex flex-col items-center gap-2.5", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label}: ${hasScore ? `${score} out of 100` : "unknown"}, ${meta.label}`}
        >
          {ticks.map(({ i, inner, outer, major }) => (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--muted-foreground)"
              strokeWidth={major ? 1.5 : 1}
              strokeLinecap="round"
              opacity={major ? 0.45 : 0.22}
            />
          ))}

          <path
            d={trackPath}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />

          {hasScore && shown > 0 ? (
            <path
              d={arcPath(cx, cy, r, START_ANGLE, valueEnd)}
              fill="none"
              stroke={meta.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              style={{
                transition: "d 900ms cubic-bezier(0.16,1,0.3,1), stroke 400ms ease",
                filter: `drop-shadow(0 0 8px color-mix(in oklab, ${meta.color} 45%, transparent))`,
              }}
            />
          ) : null}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-[2.75rem] leading-none font-semibold tracking-tight">
            {hasScore ? Math.round(score) : "—"}
          </span>
          <span className="mt-1.5 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
            out of 100
          </span>
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta.hint}</p>
      </div>
    </div>
  );
}

/** Compact inline bar for lists and route rows. */
export function SafetyBar({ score, className }) {
  const band = safetyBand(score);
  const meta = BAND_META[band];
  const pct = score ?? 0;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: meta.color }}
        />
      </div>
      <span className="tnum w-8 shrink-0 text-right text-xs text-muted-foreground">
        {score ?? "—"}
      </span>
    </div>
  );
}
