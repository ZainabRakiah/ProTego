import * as React from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  CircleMarker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import {
  Loader2,
  Crosshair,
  Share2,
  Clock,
  Ruler,
  ShieldCheck,
  Layers,
  CornerUpRight,
  Route as RouteIcon,
  Compass,
  Play,
  Footprints,
  Car,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/misc";
import { RoutePlanner, initialWaypoints } from "@/components/RoutePlanner";
import { SosButton } from "@/components/SosButton";
import { LayerSwitcher } from "@/components/LayerSwitcher";
import { AreaPanel } from "@/components/AreaPanel";
import { ManeuverIcon } from "@/components/ManeuverIcon";
import { NavigationView } from "@/components/NavigationView";
import { routeBands } from "@/lib/navigation";
import { api } from "@/lib/api";
import { FALLBACK_POSITION, isInIndia, useGeolocation } from "@/lib/geo";
import { DEFAULT_LAYER_ID, getLayer } from "@/lib/mapLayers";
import { BAND_META, cn, formatDistance, normalizeScore, safetyBand } from "@/lib/utils";

const LAYER_KEY = "protego.maplayer";
const MODE_KEY = "protego.travelmode";

/** Leaflet's default marker images break under bundlers; draw our own instead. */
function pinIcon(color, glyph) {
  return L.divIcon({
    className: "",
    html: `<span style="
      display:grid;place-items:center;width:28px;height:28px;border-radius:999px;
      background:${color};color:#fff;font:600 12px/1 ui-sans-serif,system-ui;
      box-shadow:0 0 0 3px color-mix(in oklab, ${color} 30%, transparent), 0 4px 12px rgba(0,0,0,.45);
    ">${glyph}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const START_ICON = pinIcon("oklch(0.7 0.17 292)", "A");
const END_ICON = pinIcon("oklch(0.68 0.19 25)", "B");

/** Intermediate stops are numbered 1..n between A and B. */
const stopIcon = (n) => pinIcon("oklch(0.72 0.15 224)", String(n));

function FitBounds({ points }) {
  const map = useMap();
  React.useEffect(() => {
    if (!points?.length) return;
    map.fitBounds(
      points.map((p) => [p.lat, p.lng]),
      { padding: [56, 56], maxZoom: 16 },
    );
  }, [points, map]);
  return null;
}

function Recenter({ position, trigger }) {
  const map = useMap();
  React.useEffect(() => {
    if (position && trigger) map.flyTo([position.lat, position.lng], 16, { duration: 0.8 });
  }, [trigger, position, map]);
  return null;
}

/** Leaflet miscalculates its size when its container resizes; nudge it. */
function ResizeHandler({ dep }) {
  const map = useMap();
  React.useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 220);
    return () => clearTimeout(t);
  }, [dep, map]);

  React.useEffect(() => {
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [map]);
  return null;
}

export default function MapPage() {
  const {
    position,
    accuracy,
    error: geoError,
    loading: geoLoading,
    retry: retryLocation,
  } = useGeolocation();
  const here = position ?? FALLBACK_POSITION;

  // Ordered trip: [start, ...stops, destination]. Always at least two entries.
  const [waypoints, setWaypoints] = React.useState(initialWaypoints);

  const [route, setRoute] = React.useState(null);
  const [routing, setRouting] = React.useState(false);
  const [routeError, setRouteError] = React.useState(null);

  const [showGrid, setShowGrid] = React.useState(false);
  const [grid, setGrid] = React.useState([]);
  const [gridLoading, setGridLoading] = React.useState(false);
  const [recenterTick, setRecenterTick] = React.useState(0);

  const [layerId, setLayerId] = React.useState(
    () => localStorage.getItem(LAYER_KEY) ?? DEFAULT_LAYER_ID,
  );
  const layer = getLayer(layerId);

  // Which side panel is showing on mobile, where the map takes the full width.
  const [panel, setPanel] = React.useState("route");

  const [navigating, setNavigating] = React.useState(false);
  const [travelMode, setTravelMode] = React.useState(
    () => localStorage.getItem(MODE_KEY) ?? "walk",
  );

  React.useEffect(() => {
    localStorage.setItem(MODE_KEY, travelMode);
  }, [travelMode]);

  React.useEffect(() => {
    localStorage.setItem(LAYER_KEY, layerId);
  }, [layerId]);

  /*
   * A row marked `live` tracks the moving GPS fix; everything else is a fixed
   * point the user picked. A live row with no fix yet stays unresolved so the
   * form blocks with a clear message instead of silently routing from a
   * fallback the user never chose.
   */
  const resolvedStops = React.useMemo(() => {
    return waypoints.map((wp, i) => {
      if (wp.live) {
        return position ? { ...position, label: "Your live location", index: i, live: true } : null;
      }
      if (wp.point) return { ...wp.point, label: wp.text, index: i };
      return null;
    });
  }, [waypoints, position]);

  const placedStops = resolvedStops.filter(Boolean);

  async function findRoute(e) {
    e?.preventDefault();

    // Every row except an empty start must resolve to a real place.
    const missing = resolvedStops.findIndex((p) => p === null);
    if (missing !== -1) {
      const row = waypoints[missing];
      const isEnd = missing === waypoints.length - 1;
      setRouteError(
        row.live
          ? geoError ??
              "Still waiting for your location. Allow location access, or set the start manually."
          : isEnd
            ? "Pick a destination — search for a place and choose a suggestion."
            : `Stop ${missing} has no place selected. Choose a suggestion or remove it.`,
      );
      return;
    }
    if (placedStops.length < 2) {
      setRouteError("A trip needs at least a start and a destination.");
      return;
    }
    if (!placedStops.every(isInIndia)) {
      setRouteError("ProTego's safety data currently covers India only.");
      return;
    }

    setRouting(true);
    setRouteError(null);
    try {
      const res = await api.safestRoute(
        placedStops.map(({ lat, lng }) => ({ lat, lng })),
        { mode: travelMode },
      );
      setRoute(res);
      setPanel("route");
      if (res.osrm_error) {
        toast.warning("Using a straight-line estimate", {
          description: "The OSRM routing service was unreachable, so distances are approximate.",
        });
      }
    } catch (err) {
      setRouteError(err.message);
      setRoute(null);
    } finally {
      setRouting(false);
    }
  }

  /**
   * Re-route from the walker's current position, keeping the remaining stops
   * and destination. Used when they drift off the drawn route.
   */
  async function rerouteFromHere() {
    if (!position || placedStops.length < 2) return;
    const rest = placedStops.slice(1).map(({ lat, lng }) => ({ lat, lng }));
    setRouting(true);
    try {
      const res = await api.safestRoute([{ lat: position.lat, lng: position.lng }, ...rest], {
        mode: travelMode,
      });
      setRoute(res);
      toast.success("Route updated from your current location");
    } catch (err) {
      toast.error("Could not reroute", { description: err.message });
    } finally {
      setRouting(false);
    }
  }

  async function loadGrid() {
    setGridLoading(true);
    try {
      const pad = 0.012;
      const res = await api.safetyGrid(
        {
          minLat: here.lat - pad,
          maxLat: here.lat + pad,
          minLng: here.lng - pad,
          maxLng: here.lng + pad,
        },
        new Date().getHours(),
      );
      setGrid(res.points ?? []);
    } catch (err) {
      toast.error("Could not load the safety overlay", { description: err.message });
      setShowGrid(false);
    } finally {
      setGridLoading(false);
    }
  }

  function toggleGrid() {
    const next = !showGrid;
    setShowGrid(next);
    if (next && grid.length === 0) loadGrid();
  }

  async function share() {
    const text = `I'm at https://www.google.com/maps?q=${here.lat},${here.lng} — tracking my trip on ProTego.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My live location", text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success("Location copied", { description: "Paste it to whoever should know." });
      }
    } catch {
      /* the user dismissed the share sheet */
    }
  }

  const overall = normalizeScore(route?.overall_safety);
  const band = safetyBand(overall);

  // Follows the road: draws every point of the polyline, not the ~40-point
  // colouring sample. See routeBands().
  const segments = React.useMemo(
    () =>
      routeBands(route, {
        normalizeScore,
        safetyBand,
        colorFor: (band) => BAND_META[band].color,
      }),
    [route],
  );

  if (navigating && route) {
    return (
      <NavigationView
        route={route}
        position={position}
        layerId={layerId}
        onExit={() => setNavigating(false)}
        onReroute={rerouteFromHere}
      />
    );
  }

  return (
    <div className="animate-rise space-y-4 sm:space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Safe route</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We score several candidate paths and draw the safest one.
          </p>
        </div>
        <Button variant="outline" onClick={share} className="shrink-0">
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Share my location</span>
          <span className="sm:hidden">Share</span>
        </Button>
      </header>

      {/* Panel switcher — only meaningful below lg, where panels stack. */}
      <div className="flex gap-1 rounded-lg border border-border/70 bg-muted/40 p-1 lg:hidden">
        {[
          { id: "route", label: "Route", icon: RouteIcon },
          { id: "area", label: "Area", icon: Compass },
          { id: "sos", label: "SOS", icon: ShieldCheck },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            aria-pressed={panel === id}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              panel === id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,360px)_1fr] lg:gap-5">
        {/* ---- Controls column ---- */}
        <div className="space-y-4">
          <div className={cn(panel === "route" ? "block" : "hidden", "space-y-4 lg:block")}>
            <Card>
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div
                  role="radiogroup"
                  aria-label="Travel mode"
                  className="flex gap-1 rounded-lg border border-border/70 bg-muted/40 p-1"
                >
                  {[
                    { id: "walk", label: "Walk", icon: Footprints },
                    { id: "drive", label: "Drive", icon: Car },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={travelMode === id}
                      onClick={() => setTravelMode(id)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        travelMode === id
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                    </button>
                  ))}
                </div>

                <RoutePlanner
                  waypoints={waypoints}
                  onChange={setWaypoints}
                  onSubmit={findRoute}
                  routing={routing}
                  position={position}
                  accuracy={accuracy}
                  geoError={geoError}
                  geoLoading={geoLoading}
                  onRetryLocation={retryLocation}
                />

                {routeError ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {routeError}
                  </p>
                ) : null}
                {geoError ? <p className="text-xs text-muted-foreground">{geoError}</p> : null}

                <Separator />

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Layers className="size-4 text-muted-foreground" />
                    Safety overlay
                  </div>
                  <Button
                    variant={showGrid ? "secondary" : "outline"}
                    size="sm"
                    onClick={toggleGrid}
                  >
                    {gridLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {showGrid ? "On" : "Off"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {route ? (
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Route summary</CardTitle>
                  <Badge variant={band === "unknown" ? "outline" : band}>
                    {BAND_META[band].label}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => setNavigating(true)}
                    disabled={!route.route?.length}
                  >
                    <Play className="size-4" />
                    Start navigation
                  </Button>

                  <div className="grid grid-cols-3 gap-2">
                    <Metric icon={ShieldCheck} label="Safety" value={overall ?? "—"} />
                    <Metric icon={Ruler} label="Distance" value={formatDistance(route.distance_km)} />
                    <Metric
                      icon={Clock}
                      label="Time"
                      value={route.duration_min ? `${Math.round(route.duration_min)} min` : "—"}
                    />
                  </div>

                  {route.legs?.length > 1 ? (
                    <>
                      <Separator />
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Legs
                        </p>
                        <ul className="space-y-1.5">
                          {route.legs.map((leg) => {
                            const legBand = safetyBand(normalizeScore(leg.safety));
                            const from = leg.from_index === 0 ? "A" : String(leg.from_index);
                            const to =
                              leg.to_index === route.legs.length ? "B" : String(leg.to_index);
                            return (
                              <li
                                key={`${leg.from_index}-${leg.to_index}`}
                                className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/30 px-2.5 py-2"
                              >
                                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                  {from} → {to}
                                </span>
                                <span
                                  className="size-1.5 shrink-0 rounded-full"
                                  style={{ background: BAND_META[legBand].color }}
                                />
                                <span className="tnum flex-1 text-xs text-muted-foreground">
                                  {formatDistance(leg.distance_km)}
                                  {leg.duration_min
                                    ? ` · ${Math.round(leg.duration_min)} min`
                                    : ""}
                                </span>
                                <span className="tnum shrink-0 text-xs font-medium">
                                  {normalizeScore(leg.safety) ?? "—"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </>
                  ) : null}

                  {route.instructions?.length ? (
                    <>
                      <Separator />
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Turn by turn
                        </p>
                        <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                          {(route.leg_instructions ?? [{ leg: 0, steps: route.instructions }]).map(
                            (legGroup) => {
                              const legCount = route.legs?.length ?? 1;
                              const from = legGroup.leg === 0 ? "A" : String(legGroup.leg);
                              const to =
                                legGroup.leg + 1 === legCount ? "B" : String(legGroup.leg + 1);
                              return (
                                <div key={legGroup.leg}>
                                  {legCount > 1 ? (
                                    <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                                      {from} → {to}
                                    </p>
                                  ) : null}
                                  <ol className="space-y-1.5">
                                    {legGroup.steps.map((step, i) => {
                                      // Steps are objects now (live navigation needs the
                                      // maneuver coordinates); the flat `instructions`
                                      // fallback is still plain strings.
                                      const isText = typeof step === "string";
                                      const text = isText ? step : step.text;
                                      return (
                                        <li key={i} className="flex gap-2.5 text-sm">
                                          {isText ? (
                                            <CornerUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                          ) : (
                                            <ManeuverIcon
                                              type={step.type}
                                              modifier={step.modifier}
                                              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                                            />
                                          )}
                                          <span className="text-muted-foreground">{text}</span>
                                        </li>
                                      );
                                    })}
                                  </ol>
                                </div>
                              );
                            },
                          )}
                        </div>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className={cn(panel === "area" ? "block" : "hidden", "lg:block")}>
            <AreaPanel position={placedStops.at(-1) ?? position ?? FALLBACK_POSITION} />
          </div>

          <div className={cn(panel === "sos" ? "block" : "hidden", "lg:block")}>
            <Card>
              <CardContent className="flex flex-col items-center py-6">
                <SosButton position={position ?? FALLBACK_POSITION} kind="safety" size={116} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ---- Map ---- */}
        <Card className="overflow-hidden p-0 lg:order-none">
          <div className="relative h-[58vh] min-h-[360px] sm:h-[64vh] lg:h-[calc(100dvh-11rem)] lg:min-h-[560px]">
            <MapContainer
              center={[here.lat, here.lng]}
              zoom={14}
              scrollWheelZoom
              className={cn("size-full", layer.invertInDark && "map-invert")}
            >
              <TileLayer
                key={layer.id}
                attribution={layer.attribution}
                url={layer.url}
                maxZoom={layer.maxZoom}
              />

              {showGrid
                ? grid.map((p, i) => {
                    const s = normalizeScore(p.score);
                    return (
                      <CircleMarker
                        key={i}
                        center={[p.lat, p.lng]}
                        radius={7}
                        pathOptions={{
                          color: "transparent",
                          fillColor: BAND_META[safetyBand(s)].color,
                          fillOpacity: 0.32,
                        }}
                      />
                    );
                  })
                : null}

              {segments.map((seg, i) => (
                <Polyline
                  key={i}
                  positions={seg.positions}
                  pathOptions={{ color: seg.color, weight: 6, opacity: 0.9, lineCap: "round" }}
                />
              ))}

              {position ? (
                <CircleMarker
                  center={[position.lat, position.lng]}
                  radius={8}
                  pathOptions={{
                    color: "oklch(0.7 0.17 292)",
                    fillColor: "oklch(0.7 0.17 292)",
                    fillOpacity: 1,
                    weight: 3,
                  }}
                >
                  <Popup>You are here</Popup>
                </CircleMarker>
              ) : null}

              {resolvedStops.map((stop, i) => {
                // A live row is already drawn as the "you are here" dot, so it
                // needs no extra pin stacked on top of it.
                if (!stop || stop.live) return null;
                const isStart = i === 0;
                const isEnd = i === waypoints.length - 1;
                return (
                  <Marker
                    key={waypoints[i].id}
                    position={[stop.lat, stop.lng]}
                    icon={isStart ? START_ICON : isEnd ? END_ICON : stopIcon(i)}
                  >
                    <Popup>
                      <strong>{isStart ? "Start" : isEnd ? "Destination" : `Stop ${i}`}</strong>
                      {stop.label ? <div>{stop.label}</div> : null}
                    </Popup>
                  </Marker>
                );
              })}

              <FitBounds points={route?.route} />
              <Recenter position={position} trigger={recenterTick} />
              <ResizeHandler dep={panel} />
            </MapContainer>

            {/* Floating controls sit above Leaflet's own panes (z-index 400). */}
            <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[500] flex items-end justify-between gap-2 sm:inset-x-3 sm:bottom-3">
              <div className="surface pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] sm:px-3 sm:py-2 sm:text-xs">
                {["safe", "caution", "risk"].map((b) => (
                  <span key={b} className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: BAND_META[b].color }}
                    />
                    <span className="text-muted-foreground">{BAND_META[b].label}</span>
                  </span>
                ))}
              </div>

              <div className="pointer-events-auto flex flex-col gap-2">
                <LayerSwitcher value={layerId} onChange={setLayerId} />
                <Button
                  variant="outline"
                  size="icon"
                  className="shadow-lg"
                  onClick={() => setRecenterTick((t) => t + 1)}
                  aria-label="Recenter on my location"
                  title="Recenter on my location"
                >
                  <Crosshair className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 p-2 sm:p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className="tnum mt-1 text-base leading-none font-semibold sm:text-lg">{value}</p>
    </div>
  );
}
