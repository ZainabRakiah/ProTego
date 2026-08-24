import * as React from "react";
import { LocateFixed, Loader2, X, TriangleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reverseGeocode } from "@/lib/geo";
import { cn } from "@/lib/utils";

/**
 * Start-of-trip field pinned to the user's live GPS position.
 *
 * Leaving Start blank already fell back to the current location, but nothing
 * said so and there was no way to see what it had resolved to — so a route
 * could begin somewhere the user never confirmed. This states it plainly:
 * the street it matched, how accurate the fix is, and that it keeps updating.
 */
export function LiveLocationField({ position, accuracy, error, loading, onClear, onRetry }) {
  const [place, setPlace] = React.useState(null);
  const [looking, setLooking] = React.useState(false);

  // Only re-label on a meaningful move (~100m), not on every GPS jitter.
  const key = position ? `${position.lat.toFixed(3)},${position.lng.toFixed(3)}` : null;

  React.useEffect(() => {
    if (!position) return undefined;
    const ctl = new AbortController();
    let alive = true;
    setLooking(true);

    reverseGeocode(position, ctl.signal)
      .then((p) => alive && setPlace(p))
      .catch(() => {
        /* the coordinates are still shown, so a failed lookup is not fatal */
      })
      .finally(() => alive && setLooking(false));

    return () => {
      alive = false;
      ctl.abort();
    };
  }, [key]);

  const label = place
    ? [place.locality, place.city].filter(Boolean).join(", ") || place.display
    : null;

  // --- permission denied or no fix yet -------------------------------------
  if (!position) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-2.5",
          error ? "border-destructive/40 bg-destructive/10" : "border-input bg-background/40",
        )}
      >
        {error ? (
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {error ?? (loading ? "Finding your location…" : "Waiting for a GPS fix…")}
        </p>
        <div className="flex shrink-0 gap-1">
          {error && onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Enter manually
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/[0.07] px-3 py-2.5">
      <span className="relative grid size-4 shrink-0 place-items-center">
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full bg-primary/40"
          style={{ animationDuration: "2.2s" }}
        />
        <LocateFixed className="relative size-4 text-primary" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">
            {label ?? (looking ? "Locating…" : "Your current location")}
          </span>
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
            Live
          </span>
        </p>
        <p className="tnum mt-0.5 truncate text-xs text-muted-foreground">
          {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
          {accuracy ? ` · ±${Math.round(accuracy)} m` : ""}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClear}
        aria-label="Use a different starting point"
        title="Use a different starting point"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
