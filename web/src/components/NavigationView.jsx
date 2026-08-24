import * as React from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import { X, Volume2, VolumeX, Crosshair, TriangleAlert, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManeuverIcon } from "@/components/ManeuverIcon";
import { getLayer } from "@/lib/mapLayers";
import {
  buildRouteIndex,
  locateOnRoute,
  navigationState,
  pointAtDistance,
  lerpAngle,
  routeBands,
  formatMeters,
  formatMinutes,
  etaFrom,
} from "@/lib/navigation";
import { useFullscreenRoute } from "@/lib/useFullscreenRoute";
import { BAND_META, cn, normalizeScore, safetyBand } from "@/lib/utils";

const OFF_ROUTE_M = 60;
const ANNOUNCE_M = 45;

/** Strips the trailing " · 120 m" so spoken and headline text stay clean. */
function plain(text) {
  return (text ?? "").split(" · ")[0];
}

/**
 * Draws the walker and follows them, gliding between GPS fixes.
 *
 * Fixes land every 1-3 seconds, so anything driven straight off them moves in
 * visible jumps. This eases between them at display rate — but does it by
 * mutating the Leaflet marker directly rather than through React state.
 * Re-rendering at 60fps would reconcile every polyline on the map each frame,
 * which costs far more than the animation is worth.
 */
function SmoothWalker({ target, follow, onUserPan }) {
  const map = useMap();
  const markerRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const tween = React.useRef({ current: null, from: null, to: null, start: 0 });
  const followRef = React.useRef(follow);
  followRef.current = follow;

  // Create the marker once; React never re-renders it.
  React.useEffect(() => {
    const icon = L.divIcon({
      className: "",
      html:
        '<div class="pt-walker" style="width:44px;height:44px;position:relative">' +
        '<div style="position:absolute;left:50%;top:50%;width:0;height:0;' +
        "transform:translate(-50%,-100%);border-left:11px solid transparent;" +
        'border-right:11px solid transparent;border-bottom:20px solid rgba(124,92,255,0.45)"></div>' +
        '<div style="position:absolute;left:50%;top:50%;width:16px;height:16px;border-radius:999px;' +
        "transform:translate(-50%,-50%);background:oklch(0.62 0.2 292);border:3px solid #fff;" +
        'box-shadow:0 2px 8px rgba(0,0,0,.45)"></div></div>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    const marker = L.marker([0, 0], {
      icon,
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
      opacity: 0,
    }).addTo(map);
    markerRef.current = marker;

    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map]);

  // Panning by hand hands control back to the user.
  React.useEffect(() => {
    const onDragStart = () => onUserPan();
    map.on("dragstart", onDragStart);
    return () => map.off("dragstart", onDragStart);
  }, [map, onUserPan]);

  // Start a new tween whenever a fix moves the target.
  React.useEffect(() => {
    if (!target || !markerRef.current) return undefined;

    const t = tween.current;
    const prev = t.current;
    // First fix, or a jump big enough to be a reposition rather than walking:
    // snap instead of gliding across the city.
    const far =
      !prev ||
      Math.abs(target.lat - prev.lat) > 0.01 ||
      Math.abs(target.lng - prev.lng) > 0.01;

    t.from = far ? target : prev;
    t.to = target;
    t.start = performance.now();
    markerRef.current.setOpacity(1);

    const DURATION = far ? 0 : 1100;

    const apply = (p) => {
      t.current = p;
      markerRef.current?.setLatLng([p.lat, p.lng]);
      const el = markerRef.current?.getElement()?.querySelector(".pt-walker");
      // Rotate an inner element: Leaflet owns the transform on the icon root.
      if (el) el.style.transform = `rotate(${p.bearing ?? 0}deg)`;
      if (followRef.current) {
        // animate:false on purpose — this loop already interpolates, so
        // Leaflet's own easing would fight it. Zoom is left untouched.
        map.panTo([p.lat, p.lng], { animate: false });
      }
    };

    if (DURATION === 0) {
      apply(target);
      return undefined;
    }

    const tick = (now) => {
      const k = Math.min(1, (now - t.start) / DURATION);
      // easeInOutQuad — no hard start or stop at either end of a fix.
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      apply({
        lat: t.from.lat + (t.to.lat - t.from.lat) * e,
        lng: t.from.lng + (t.to.lng - t.from.lng) * e,
        bearing: lerpAngle(t.from.bearing ?? 0, t.to.bearing ?? 0, e),
      });
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target?.lat, target?.lng, target?.bearing, map]);

  // Re-centre immediately when following is switched back on.
  React.useEffect(() => {
    if (follow && tween.current.current) {
      const p = tween.current.current;
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17), { animate: true });
    }
  }, [follow, map]);

  return null;
}

/**
 * Full-screen walking navigation.
 *
 * Takes the live GPS position from the parent, projects it onto the route, and
 * shows the current maneuver with a live distance countdown — the map-follows-you,
 * voice-prompted experience rather than a static list of directions.
 */
export function NavigationView({ route, position, layerId, onExit, onReroute }) {
  // Navigation owns the whole screen; the page behind it must not scroll.
  useFullscreenRoute();

  const [muted, setMuted] = React.useState(
    () => localStorage.getItem("protego.nav.muted") === "1",
  );
  const [following, setFollowing] = React.useState(true);
  const spokenFor = React.useRef({ index: -1, near: false });
  const layer = getLayer(layerId);

  const index = React.useMemo(
    () => buildRouteIndex(route?.route, route?.leg_instructions),
    [route],
  );

  const located = React.useMemo(
    () => locateOnRoute(index, position),
    [index, position?.lat, position?.lng],
  );

  const nav = React.useMemo(() => navigationState(index, located), [index, located]);

  /*
   * Draw the walker on the route rather than at the raw fix. GPS wanders 10-30m
   * in a street canyon, which puts the dot through buildings; the projection is
   * already computed for progress, so reuse it. Heading comes from the route's
   * geometry too — steadier than a phone compass at walking pace.
   */
  const snapped = React.useMemo(() => {
    if (!index || !nav) return position ? { ...position, bearing: 0 } : null;
    // Too far off to trust the projection — show where they actually are.
    if (nav.offRouteM > OFF_ROUTE_M) return position ? { ...position, bearing: 0 } : null;
    return pointAtDistance(index, nav.along);
  }, [index, nav?.along, nav?.offRouteM, position?.lat, position?.lng]);


  React.useEffect(() => {
    localStorage.setItem("protego.nav.muted", muted ? "1" : "0");
  }, [muted]);

  // --- voice guidance -------------------------------------------------------
  const speak = React.useCallback(
    (text) => {
      if (muted || !text || typeof window === "undefined" || !window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.lang = "en-IN";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    },
    [muted],
  );

  React.useEffect(() => {
    if (!nav?.step) return;
    // Announce once when a maneuver becomes current, then again on approach.
    if (spokenFor.current.index !== nav.stepIndex) {
      spokenFor.current = { index: nav.stepIndex, near: false };
      speak(
        nav.distanceToStepM > ANNOUNCE_M
          ? `In ${formatMeters(nav.distanceToStepM)}, ${plain(nav.step.text)}`
          : plain(nav.step.text),
      );
    } else if (!spokenFor.current.near && nav.distanceToStepM <= ANNOUNCE_M) {
      spokenFor.current.near = true;
      speak(plain(nav.step.text));
    }
  }, [nav?.stepIndex, nav?.distanceToStepM, nav?.step, speak]);

  React.useEffect(() => {
    if (nav?.arrived) speak("You have arrived at your destination.");
  }, [nav?.arrived, speak]);

  // Stop any queued speech when navigation closes.
  React.useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // --- keep the screen on while walking ------------------------------------
  React.useEffect(() => {
    let lock = null;
    let cancelled = false;
    (async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
        if (cancelled) lock?.release();
      } catch {
        /* wake lock is a nice-to-have; ignore refusals */
      }
    })();
    return () => {
      cancelled = true;
      lock?.release?.().catch(() => {});
    };
  }, []);

  // --- route drawing --------------------------------------------------------
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

  const destination = route?.route?.[route.route.length - 1];
  const offRoute = nav && nav.offRouteM > OFF_ROUTE_M;
  const stepText = nav?.step ? plain(nav.step.text) : "Follow the route";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      {/* ---- Maneuver banner ---- */}
      <div className="shrink-0 bg-primary px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-primary-foreground">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-4">
          <ManeuverIcon
            type={nav?.step?.type}
            modifier={nav?.step?.modifier}
            className="size-10 shrink-0 sm:size-12"
          />
          <div className="min-w-0 flex-1">
            <p className="tnum text-2xl leading-none font-semibold sm:text-3xl">
              {nav?.arrived ? "Arrived" : formatMeters(nav?.distanceToStepM)}
            </p>
            <p className="mt-1.5 truncate text-sm sm:text-base">{stepText}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onExit}
            aria-label="Exit navigation"
            className="shrink-0 text-primary-foreground hover:bg-white/15"
          >
            <X className="size-5" />
          </Button>
        </div>

        {nav?.nextStep && !nav.arrived ? (
          <div className="mx-auto mt-2 flex w-full max-w-3xl items-center gap-2 border-t border-white/20 pt-2 text-xs opacity-80">
            <span>then</span>
            <ManeuverIcon
              type={nav.nextStep.type}
              modifier={nav.nextStep.modifier}
              className="size-3.5 shrink-0"
            />
            <span className="truncate">{plain(nav.nextStep.text)}</span>
          </div>
        ) : null}
      </div>

      {offRoute ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 bg-[var(--caution)] px-4 py-2 text-sm font-medium text-black"
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span className="flex-1">You are {formatMeters(nav.offRouteM)} off the route.</span>
          <Button size="sm" variant="secondary" onClick={onReroute}>
            Reroute
          </Button>
        </div>
      ) : null}

      {/* ---- Map ---- */}
      <div className="relative min-h-0 flex-1">
        <MapContainer
          center={[position?.lat ?? destination?.lat ?? 0, position?.lng ?? destination?.lng ?? 0]}
          zoom={17}
          zoomControl={false}
          className={cn("size-full", layer.invertInDark && "map-invert")}
        >
          <TileLayer attribution={layer.attribution} url={layer.url} maxZoom={layer.maxZoom} />

          {segments.map((seg, i) => (
            <Polyline
              key={i}
              positions={seg.positions}
              pathOptions={{ color: seg.color, weight: 8, opacity: 0.9, lineCap: "round" }}
            />
          ))}

          {destination ? (
            <CircleMarker
              center={[destination.lat, destination.lng]}
              radius={9}
              pathOptions={{
                color: "#fff",
                fillColor: "oklch(0.655 0.225 22)",
                fillOpacity: 1,
                weight: 3,
              }}
            />
          ) : null}

          <SmoothWalker
            target={snapped}
            follow={following}
            onUserPan={() => setFollowing(false)}
          />
        </MapContainer>

        <div className="pointer-events-none absolute right-3 bottom-3 z-[500] flex flex-col gap-2">
          <Button
            variant="outline"
            size="icon"
            className="pointer-events-auto shadow-lg"
            onClick={() => setMuted((v) => !v)}
            aria-label={muted ? "Turn voice guidance on" : "Turn voice guidance off"}
            title={muted ? "Voice off" : "Voice on"}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          {!following ? (
            <Button
              size="icon"
              className="pointer-events-auto shadow-lg"
              onClick={() => setFollowing(true)}
              aria-label="Resume following my location"
              title="Re-centre"
            >
              <Crosshair className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* ---- Trip footer ---- */}
      <div className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div
          className="mx-auto mb-3 h-1 w-full max-w-3xl overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round((nav?.progress ?? 0) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Trip progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${(nav?.progress ?? 0) * 100}%` }}
          />
        </div>

        <div className="mx-auto flex w-full max-w-3xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="tnum text-lg leading-none font-semibold">
              {nav?.arrived ? "You are here" : formatMinutes(nav?.remainingMin)}
            </p>
            <p className="tnum mt-1 text-xs text-muted-foreground">
              {nav?.arrived
                ? "Destination reached"
                : `${formatMeters(nav?.remainingM)} · arrive ${etaFrom(nav?.remainingMin)}`}
            </p>
          </div>

          {nav?.arrived ? (
            <Button onClick={onExit}>
              <Flag className="size-4" />
              Finish
            </Button>
          ) : (
            <Button variant="destructive" onClick={onExit}>
              <X className="size-4" />
              End
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
