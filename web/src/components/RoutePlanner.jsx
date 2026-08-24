import * as React from "react";
import {
  Crosshair,
  Search,
  X,
  Plus,
  Navigation,
  Loader2,
  ArrowUpDown,
  LocateFixed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PlaceSearch } from "@/components/PlaceSearch";
import { LiveLocationField } from "@/components/LiveLocationField";
import { cn } from "@/lib/utils";

export const MAX_STOPS = 8; // intermediate stops, excluding start and destination

let nextId = 0;
export function makeWaypoint(patch = {}) {
  nextId += 1;
  // `live` pins a row to the moving GPS position instead of a fixed point.
  return { id: `wp-${nextId}`, text: "", point: null, live: false, ...patch };
}

/**
 * A fresh trip: start pinned to the live location, plus an empty destination.
 * Starting live is the common case — most trips begin where you are standing.
 */
export function initialWaypoints() {
  return [makeWaypoint({ live: true }), makeWaypoint()];
}

function roleOf(index, total) {
  if (index === 0) return "start";
  if (index === total - 1) return "end";
  return "stop";
}

const ROLE_LABEL = { start: "Start", end: "Destination", stop: "Stop" };

/**
 * Ordered trip builder: start → any number of stops → destination.
 *
 * The list is the single source of truth for the trip; the first and last rows
 * are always start and destination, so "add stop" inserts second-to-last and
 * removing the last stop can never leave the trip without an endpoint.
 */
export function RoutePlanner({
  waypoints,
  onChange,
  onSubmit,
  routing,
  position,
  accuracy,
  geoError,
  geoLoading,
  onRetryLocation,
  className,
}) {
  const hasCurrentPosition = Boolean(position);
  const total = waypoints.length;
  const stopCount = Math.max(0, total - 2);

  function patchAt(index, patch) {
    onChange(waypoints.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function addStop() {
    if (stopCount >= MAX_STOPS) return;
    const next = waypoints.slice();
    next.splice(next.length - 1, 0, makeWaypoint());
    onChange(next);
  }

  function removeAt(index) {
    if (total <= 2) return;
    onChange(waypoints.filter((_, i) => i !== index));
  }

  function reverse() {
    onChange(waypoints.slice().reverse());
  }

  return (
    <form onSubmit={onSubmit} className={cn("space-y-3", className)}>
      <ol className="space-y-2">
        {waypoints.map((wp, index) => {
          const role = roleOf(index, total);
          const glyph = role === "start" ? "A" : role === "end" ? "B" : String(index);
          const isLast = index === total - 1;

          return (
            <li key={wp.id} className="relative flex gap-2.5">
              {/* Rail: marker badge plus the connector down to the next row. */}
              <div className="flex flex-col items-center pt-7">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                    role === "start" && "bg-primary text-primary-foreground",
                    role === "end" && "bg-destructive text-destructive-foreground",
                    role === "stop" && "border border-border bg-card text-muted-foreground",
                  )}
                >
                  {glyph}
                </span>
                {!isLast ? (
                  <span
                    aria-hidden
                    className="mt-1 w-px flex-1 border-l border-dashed border-border"
                  />
                ) : null}
              </div>

              <div className="min-w-0 flex-1 pb-1">
                {wp.live ? (
                  <>
                    <Label className="mb-1.5 block">{ROLE_LABEL[role]}</Label>
                    <LiveLocationField
                      position={position}
                      accuracy={accuracy}
                      error={geoError}
                      loading={geoLoading}
                      onClear={() => patchAt(index, { live: false, text: "", point: null })}
                      onRetry={onRetryLocation}
                    />
                  </>
                ) : (
                <PlaceSearch
                  id={`wp-${wp.id}`}
                  label={
                    role === "stop" ? `${ROLE_LABEL.stop} ${index}` : ROLE_LABEL[role]
                  }
                  icon={role === "start" ? Crosshair : Search}
                  value={wp.text}
                  onChange={(text) => patchAt(index, { text, point: null })}
                  onPick={(r) =>
                    patchAt(index, { text: r.label, point: { lat: r.lat, lng: r.lng } })
                  }
                  placeholder={
                    role === "start"
                      ? hasCurrentPosition
                        ? "Current location"
                        : "Search a starting point"
                      : role === "end"
                        ? "Where are you heading?"
                        : "Somewhere along the way"
                  }
                  trailing={
                    wp.text || role === "stop" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={
                          role === "stop"
                            ? `Remove stop ${index}`
                            : `Clear ${ROLE_LABEL[role].toLowerCase()}`
                        }
                        onClick={() =>
                          role === "stop"
                            ? removeAt(index)
                            : patchAt(index, { text: "", point: null })
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null
                  }
                />
                )}

                {/* Any row can be pinned to the live position, not just the start. */}
                {!wp.live ? (
                  <button
                    type="button"
                    onClick={() => patchAt(index, { live: true, text: "", point: null })}
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-1.5 rounded text-xs transition-colors",
                      "text-muted-foreground hover:text-primary",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                  >
                    <LocateFixed className="size-3" />
                    Use my live location
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addStop}
          disabled={stopCount >= MAX_STOPS}
          title={
            stopCount >= MAX_STOPS ? `Up to ${MAX_STOPS} stops` : "Add a stop along the way"
          }
        >
          <Plus className="size-3.5" />
          Add stop
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reverse}
          title="Reverse the trip"
        >
          <ArrowUpDown className="size-3.5" />
          Reverse
        </Button>

        {stopCount > 0 ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {stopCount} {stopCount === 1 ? "stop" : "stops"}
          </span>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={routing}>
        {routing ? <Loader2 className="size-4 animate-spin" /> : <Navigation className="size-4" />}
        {routing ? "Scoring routes…" : "Find safest route"}
      </Button>
    </form>
  );
}
