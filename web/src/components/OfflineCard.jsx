import * as React from "react";
import {
  CloudDownload,
  CloudOff,
  Check,
  Loader2,
  Trash2,
  WifiOff,
  Map as MapIcon,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/misc";
import { useOfflinePack, useOnlineStatus } from "@/lib/offlineSafety";
import { formatTime } from "@/lib/utils";

/** Tile URLs covering a square around a point, for the zooms worth storing. */
function tilesAround({ lat, lng }, { radiusKm = 3, zooms = [14, 15, 16] } = {}) {
  const urls = [];
  for (const z of zooms) {
    const n = 2 ** z;
    const toX = (lon) => Math.floor(((lon + 180) / 360) * n);
    const toY = (la) => {
      const r = (la * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    };
    // Degrees covering the radius at this latitude.
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const x0 = toX(lng - dLng);
    const x1 = toX(lng + dLng);
    const y0 = toY(lat + dLat); // north edge is the smaller y
    const y1 = toY(lat - dLat);

    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        urls.push(`https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`);
      }
    }
  }
  return urls;
}

/**
 * Offline readiness: the safety map, and the tiles to draw it on.
 *
 * These are deliberately separate. The safety grid is the part that answers
 * "is this street safe" and is only ~61KB, so it should always be downloaded.
 * Map tiles are far larger and only make the answer easier to look at, so
 * storing them is an explicit choice tied to an area.
 */
export function OfflineCard({ position }) {
  const online = useOnlineStatus();
  const { ready, pack, error, busy, download, remove } = useOfflinePack();
  const [tiles, setTiles] = React.useState(null);
  const [tileProgress, setTileProgress] = React.useState(null);

  const worker = navigator.serviceWorker?.controller;

  const askStatus = React.useCallback(() => {
    navigator.serviceWorker?.controller?.postMessage({ type: "cache-status" });
  }, []);

  React.useEffect(() => {
    if (!navigator.serviceWorker) return undefined;
    const onMessage = (event) => {
      const data = event.data ?? {};
      if (data.type === "cache-status") setTiles(data.tiles);
      if (data.type === "cache-progress") {
        setTileProgress(data.finished ? null : { done: data.done, total: data.total });
        if (data.finished) {
          toast.success(`Saved ${data.done} map tiles for offline use`);
          askStatus();
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    askStatus();
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [askStatus]);

  function saveTiles() {
    if (!position) {
      toast.error("No location yet", { description: "ProTego needs your position to pick an area." });
      return;
    }
    const urls = tilesAround(position);
    setTileProgress({ done: 0, total: urls.length });
    navigator.serviceWorker.controller.postMessage({ type: "cache-tiles", urls });
  }

  const cells = pack ? pack.rows * pack.cols : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Offline safety</CardTitle>
          <CardDescription className="mt-1">
            Works with no signal — the moment it matters most.
          </CardDescription>
        </div>
        {!online ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--caution)_18%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--caution)]">
            <WifiOff className="size-3.5" />
            Offline
          </span>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---- the safety grid ---- */}
        <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/30 p-3">
          <span
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${
              ready ? "bg-[color-mix(in_oklab,var(--safe)_18%,transparent)]" : "bg-muted"
            }`}
          >
            {ready ? (
              <ShieldCheck className="size-4 text-[var(--safe)]" />
            ) : (
              <CloudOff className="size-4 text-muted-foreground" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Safety map</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ready
                ? `${cells.toLocaleString()} cells · ~110 m each · built ${formatTime(pack.generated)}`
                : "Street-by-street safety scores, stored on this device (~61 KB)."}
            </p>
            {error ? (
              <p role="alert" className="mt-1.5 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant={ready ? "outline" : "default"} onClick={download} disabled={busy}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : ready ? (
                <Check className="size-3.5" />
              ) : (
                <CloudDownload className="size-3.5" />
              )}
              {busy ? "Saving…" : ready ? "Update" : "Download"}
            </Button>
            {ready ? (
              <Button size="icon-sm" variant="ghost" onClick={remove} aria-label="Remove offline safety map">
                <Trash2 className="size-3.5 text-muted-foreground" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* ---- map tiles ---- */}
        <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/30 p-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
            <MapIcon className="size-4 text-muted-foreground" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Map images near you</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tileProgress
                ? `Saving ${tileProgress.done} of ${tileProgress.total}…`
                : tiles
                  ? `${tiles} tiles stored. Anywhere you have already looked stays visible offline.`
                  : "Store a 3 km area so the map still draws with no signal."}
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={saveTiles}
            disabled={!worker || Boolean(tileProgress) || !online}
            title={
              !worker
                ? "Available once the app is installed or reloaded"
                : !online
                  ? "Needs a connection to download"
                  : undefined
            }
          >
            {tileProgress ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CloudDownload className="size-3.5" />
            )}
            Save area
          </Button>
        </div>

        <Separator />

        <p className="text-xs text-muted-foreground">
          With the safety map stored, ProTego can still tell you the safety of the
          streets around you, your nearest police station and hospitals — with the
          radio off. Route calculation and place search still need a connection.
        </p>

        {!worker ? (
          <p className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
            Offline storage for map images needs the installed app. Open the built
            site over <span className="font-medium text-foreground">https</span> or{" "}
            <span className="font-medium text-foreground">localhost</span> — browsers
            block it on a plain http address.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
