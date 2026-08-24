/**
 * Progress tracking for live turn-by-turn navigation.
 *
 * The route is flattened into a polyline with a cumulative "distance along"
 * value at every vertex. A GPS fix is projected onto the nearest segment to get
 * the walker's own distance-along, and everything else — which instruction is
 * current, how far to the next turn, distance and time remaining — falls out of
 * comparing that number against each maneuver's distance-along.
 *
 * Working in one dimension along the path (rather than straight-line distance
 * to the next turn) is what makes this behave on a road that curves back on
 * itself, where a turn 400m ahead by road can be 50m away as the crow flies.
 */

const EARTH_R = 6371000;

/** Local equirectangular projection — accurate enough over a single route. */
function makeProjector(refLat) {
  const kx = (Math.PI / 180) * EARTH_R * Math.cos((refLat * Math.PI) / 180);
  const ky = (Math.PI / 180) * EARTH_R;
  return (p) => ({ x: p.lng * kx, y: p.lat * ky });
}

function distance2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Pre-compute the polyline index once per route.
 * Returns null for an empty route so callers can guard on it.
 */
export function buildRouteIndex(routePoints, legInstructions) {
  if (!routePoints || routePoints.length < 2) return null;

  const project = makeProjector(routePoints[0].lat);
  const pts = routePoints.map((p) => ({ ...p, ...project(p) }));

  // Cumulative metres from the start at each vertex.
  pts[0].along = 0;
  for (let i = 1; i < pts.length; i += 1) {
    pts[i].along =
      pts[i - 1].along + Math.sqrt(distance2(pts[i].x, pts[i].y, pts[i - 1].x, pts[i - 1].y));
  }
  const total = pts[pts.length - 1].along;

  // Flatten every leg's steps and place each maneuver on the path.
  const steps = [];
  (legInstructions ?? []).forEach((leg) => {
    (leg.steps ?? []).forEach((step) => {
      if (step.lat == null || step.lng == null) return;
      const m = project(step);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i += 1) {
        const d = distance2(m.x, m.y, pts[i].x, pts[i].y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      steps.push({ ...step, leg: leg.leg, along: pts[best].along });
    });
  });

  // Maneuvers must read in path order even if a leg boundary nudges them.
  steps.sort((a, b) => a.along - b.along);

  return { pts, total, steps, project };
}

/** Project a live position onto the route. */
export function locateOnRoute(index, position) {
  if (!index || !position) return null;
  const { pts, project } = index;
  const p = project(position);

  let bestAlong = 0;
  let bestDist2 = Infinity;

  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;

    // Clamped projection of p onto segment a->b.
    let t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
    t = Math.max(0, Math.min(1, t));

    const px = a.x + t * vx;
    const py = a.y + t * vy;
    const d2 = distance2(p.x, p.y, px, py);

    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestAlong = a.along + t * Math.sqrt(len2);
    }
  }

  return { along: bestAlong, offRouteM: Math.sqrt(bestDist2) };
}

/**
 * Current navigation state for a position on the route.
 * `speedKmh` is used for the time-remaining estimate.
 */
export function navigationState(index, located, speedKmh = 4.8) {
  if (!index || !located) return null;

  const { total, steps } = index;
  const along = located.along;
  const remainingM = Math.max(0, total - along);

  // The active instruction is the first maneuver still ahead of us. A small
  // slack absorbs GPS jitter so the banner does not flicker back a step.
  const SLACK_M = 8;
  let current = steps.find((s) => s.along > along + SLACK_M) ?? steps[steps.length - 1] ?? null;
  const currentIndex = current ? steps.indexOf(current) : -1;
  const next = currentIndex >= 0 ? (steps[currentIndex + 1] ?? null) : null;

  const distanceToStep = current ? Math.max(0, current.along - along) : 0;

  return {
    along,
    offRouteM: located.offRouteM,
    remainingM,
    remainingMin: (remainingM / 1000 / speedKmh) * 60,
    step: current,
    stepIndex: currentIndex,
    nextStep: next,
    distanceToStepM: distanceToStep,
    progress: total > 0 ? Math.min(1, along / total) : 0,
    arrived: remainingM < 25,
  };
}

/**
 * Split a route into coloured runs that follow the road.
 *
 * `segment_scores` is a ~40-point sample of the route, meant for colouring —
 * not for drawing. Rendering lines between those samples straightens every bend
 * between them, which on a 17km route cut corners by up to 1.1km and drew the
 * path diagonally through buildings. So walk the *full* polyline and take each
 * point's band from the nearest sample, then group consecutive points that
 * share a band.
 *
 * Runs overlap by one point so there is no gap where the colour changes.
 */
export function routeBands(route, { normalizeScore, safetyBand, colorFor }) {
  const full = route?.route ?? [];
  if (full.length < 2) return [];

  const samples = route?.segment_scores ?? [];
  const bandAt = (index) => {
    if (!samples.length) return "unknown";
    // Samples are taken at even intervals, so map by position along the route.
    const s = samples[
      Math.min(
        samples.length - 1,
        Math.round((index / Math.max(1, full.length - 1)) * (samples.length - 1)),
      )
    ];
    return safetyBand(normalizeScore(s.score));
  };

  const runs = [];
  let current = { band: bandAt(0), positions: [[full[0].lat, full[0].lng]] };

  for (let i = 1; i < full.length; i += 1) {
    const band = bandAt(i);
    const point = [full[i].lat, full[i].lng];

    if (band === current.band) {
      current.positions.push(point);
      continue;
    }
    // Close the run *through* this point, then start the next one from it.
    current.positions.push(point);
    runs.push(current);
    current = { band, positions: [point] };
  }
  runs.push(current);

  return runs
    .filter((r) => r.positions.length > 1)
    .map((r) => ({ positions: r.positions, color: colorFor(r.band) }));
}

/** Compass bearing from a to b, in degrees clockwise from north. */
function bearingBetween(a, b) {
  const toRad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * The point on the route at a given distance along it, plus the direction the
 * route is heading there.
 *
 * Drawing the walker here rather than at the raw GPS fix is what map-matching
 * buys you: the marker sits on the road instead of wandering into buildings,
 * and the heading comes from the route's own geometry, which is far steadier
 * than the compass value a phone reports while walking slowly.
 */
export function pointAtDistance(index, along) {
  const pts = index?.pts;
  if (!pts || pts.length < 2) return null;

  const target = Math.max(0, Math.min(index.total, along));

  // Binary search for the segment containing `target`.
  let lo = 1;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].along < target) lo = mid + 1;
    else hi = mid;
  }

  const b = pts[lo];
  const a = pts[lo - 1];
  const span = b.along - a.along;
  const t = span > 0 ? (target - a.along) / span : 0;

  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    bearing: bearingBetween(a, b),
  };
}

/** Interpolate between two angles the short way round the circle. */
export function lerpAngle(from, to, t) {
  let delta = ((to - from + 540) % 360) - 180;
  return from + delta * t;
}

/** "40 m" / "1.2 km" — the phrasing used on the maneuver banner. */
export function formatMeters(m) {
  if (m == null || Number.isNaN(m)) return "—";
  if (m < 20) return "now";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatMinutes(min) {
  if (min == null || Number.isNaN(min)) return "—";
  if (min < 1) return "<1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${Math.round(min % 60)} min`;
}

export function etaFrom(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  return new Date(Date.now() + minutes * 60000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
