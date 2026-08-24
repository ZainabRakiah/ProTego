import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * ProTego mark: a guiding star held inside a shield.
 *
 * The shield is protection; the star is the thing that gets you home in the
 * dark. Together they say "night safety companion" without needing a map
 * cliché — an earlier version drew an actual route inside the shield, and at
 * the 36px the sidebar uses it collapsed into an unreadable squiggle.
 *
 * The star is knocked out of a solid shield rather than drawn on top. Two
 * clean shapes with hard figure/ground contrast survive all the way down to
 * the 16px favicon; thin strokes do not.
 *
 * `variant`:
 *   "tile"  — white mark on the brand gradient, for app icons and headers
 *   "plain" — currentColor, for inline and monochrome use
 */

// Shared geometry, so the component, public/logo.svg and the favicon in
// index.html cannot quietly drift apart.
const SHIELD_D =
  "M16 2.4C19.4 4.9 23.4 6.1 26.9 6.5V15C26.9 21.2 23.2 26 16 30.6C8.8 26 5.1 21.2 5.1 15V6.5C8.6 6.1 12.6 4.9 16 2.4Z";
const STAR_D =
  "M16 8.2C16.75 12.4 18.9 14.55 23.1 15.3C18.9 16.05 16.75 18.2 16 22.4C15.25 18.2 13.1 16.05 8.9 15.3C13.1 14.55 15.25 12.4 16 8.2Z";
const INSET = "translate(16 16) scale(0.82) translate(-16 -16)";

export function ProTegoLogo({ size = 40, variant = "tile", className, ...props }) {
  // Mask and gradient ids must be document-unique or instances collide and
  // the mask renders blank.
  const uid = React.useId().replace(/:/g, "");
  const gradId = `pt-g-${uid}`;
  const sheenId = `pt-s-${uid}`;
  const maskId = `pt-m-${uid}`;
  const isTile = variant === "tile";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="ProTego"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="55%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id={sheenId} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="60%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        {/* White is kept, black is cut away: the star becomes a hole. */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="black" />
          <g transform={isTile ? INSET : undefined}>
            <path d={SHIELD_D} fill="white" />
            <path d={STAR_D} fill="black" />
          </g>
        </mask>
      </defs>

      {isTile ? (
        <>
          <rect width="32" height="32" rx="9" fill={`url(#${gradId})`} />
          {/* Top-edge sheen so the tile reads as a lit surface, not a flat swatch. */}
          <rect width="32" height="32" rx="9" fill={`url(#${sheenId})`} />
          <rect width="32" height="32" fill="#fff" mask={`url(#${maskId})`} />
        </>
      ) : (
        <rect width="32" height="32" fill="currentColor" mask={`url(#${maskId})`} />
      )}
    </svg>
  );
}
