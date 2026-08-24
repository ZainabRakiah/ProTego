import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  RotateCcw,
  RotateCw,
  Flag,
  Navigation,
} from "lucide-react";

/**
 * Picks the arrow for an OSRM maneuver. Falls back to "straight on" for any
 * type we don't have artwork for, which is always a safe thing to show.
 */
export function ManeuverIcon({ type, modifier, className }) {
  const t = (type || "").toLowerCase();
  const m = (modifier || "").toLowerCase();

  let Icon = ArrowUp;

  if (t === "arrive") Icon = Flag;
  else if (t === "depart") Icon = Navigation;
  else if (t === "roundabout" || t === "rotary") Icon = RotateCw;
  else if (m.includes("uturn")) Icon = RotateCcw;
  else if (m === "sharp left" || m === "left") Icon = CornerUpLeft;
  else if (m === "sharp right" || m === "right") Icon = CornerUpRight;
  else if (m === "slight left") Icon = ArrowUpLeft;
  else if (m === "slight right") Icon = ArrowUpRight;

  return <Icon className={className} aria-hidden />;
}
