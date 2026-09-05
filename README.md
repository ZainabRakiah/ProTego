# ProTego

Night safety companion — safest-route navigation, one-tap SOS, a trusted circle
and a timestamped evidence vault.

## Run it

From the `ProTego` folder:

```bash
npm run dev
```
---

That single command starts everything and opens the app:

| Service  | URL                     | What it is                          |
| -------- | ----------------------- | ----------------------------------- |
| App      | http://localhost:5173   | React UI (opens automatically)      |
| API      | http://127.0.0.1:5001   | Flask backend + safety ML           |

On the first run it also creates `ProTego_venv`, installs `requirements.txt`,
and installs `web/node_modules` — so a fresh clone needs nothing but Node 18+
and Python 3. Press `Ctrl+C` to stop both processes.

### Production build

```bash
npm run build          # bundles the UI into web/dist
python backend/app.py  # Flask then serves the built app at :5001
```

## What's where

```
ProTego/
├─ package.json          # `npm run dev` entry point
├─ scripts/dev.mjs       # launcher: sets up the venv, starts Flask + Vite
├─ backend/              # Flask API, safety ML, SQLite (app.py, db.py)
├─ web/                  # the web app — Vite + React 19 + Tailwind v4 + shadcn/ui
│  ├─ src/pages/         # Login, Signup, Dashboard, Map, Report, Contacts, Evidence, Profile
│  ├─ src/components/    # AppShell, SosButton, SafetyMeter, CameraCapture, Aurora
│  ├─ src/components/ui/ # shadcn/ui primitives (button, card, input, dialog, badge…)
│  └─ src/lib/           # api client, auth context, geolocation helpers
├─ safety_route/         # standalone ML experiment (own Flask app + Vite frontend)
├─ camera/               # the original static HTML prototype, kept for reference
└─ FriendsNavigator/     # static location-sharing mini-app, served at /friendsnavigator/
```

## Features

- **Safest route with stops** — plan a trip as start → any number of stops →
  destination. Each leg is routed and scored independently, then stitched into
  one polyline coloured by safety band, with a per-leg distance/safety breakdown.
- **Live walking navigation** — a full-screen mode that follows your GPS along
  the route: maneuver banner with a live distance countdown, spoken guidance,
  progress bar, ETA, off-route detection and re-route from where you stand.
- **Map views** — Street, Geographic (terrain/contours), Satellite and Night
  basemaps, switchable from the map and remembered between visits.
- **Area details** — the administrative location plus the raw features the
  model scored it on: lamps, cameras, police and incidents within 500 m.
- **Safety overlay** — a live grid heat layer over the map for the current hour.
- **Press-and-hold SOS** — 1.5s hold guards against pocket triggers; logs your
  coordinates with the nearest police station or hospitals attached.
- **Incident reports** — every report retrains the safety model, so the area is
  rescored for everyone.
- **Trusted circle** — saved places, each with its own set of contacts.
- **Evidence vault** — photos stamped with time, coordinates and GPS accuracy.

## Multi-stop trips

`POST /api/safest-route` takes either shape:

```jsonc
{ "stops": [{ "lat": 12.86, "lng": 77.62 }, { "lat": 12.92, "lng": 77.61 }] }  // start, ...stops, destination
{ "start": { ... }, "end": { ... } }                                           // legacy pair, still supported
```

Up to 8 intermediate stops. Each consecutive pair is routed separately, so a leg
OSRM cannot solve falls back to a straight-line estimate on its own rather than
losing the whole trip. Overall safety is a **distance-weighted** mean of the legs,
so a long unsafe leg is not cancelled out by a short safe one.

Turn text is generated in `_describe_step()`: the public OSRM demo server returns
maneuvers but no `instruction` field, so directions are built from the maneuver
type, modifier, road name and distance.

## Live navigation

`Start navigation` on the route summary opens a full-screen walking mode.

Progress is tracked in one dimension along the route rather than by straight-line
distance to the next turn. `web/src/lib/navigation.js` builds a polyline index
with a cumulative distance at every vertex, projects each GPS fix onto the
nearest segment, and derives everything from comparing those two numbers.
That is what keeps it correct on a road that loops back on itself, where a turn
400 m ahead by road can be 50 m away as the crow flies.

- **Voice** — spoken once when a maneuver becomes current and again ~45 m out,
  via the Web Speech API. Muting is remembered.
- **Follow** — the map recentres on you until you pan away, then offers re-centre.
- **Off-route** — beyond 60 m from the path, a banner offers a reroute that
  starts from your current position and keeps the remaining stops.
- **Screen** — a Wake Lock is requested so the display stays on while walking.

### A limitation worth knowing

`router.project-osrm.org` only hosts the **driving** profile — requesting
`/walking` or `/foot` silently returns car routes. So route *geometry* follows
the road network, and walking *times* are derived from distance at
`_WALK_SPEED_KMH` (4.8 km/h) rather than returned by the router. The Walk/Drive
toggle changes that estimate. For true pedestrian routing (footpaths,
pedestrian-only links, one-way rules that do not apply on foot) you would need
a self-hosted OSRM with the foot profile, or a routing provider that serves one.

## India-only scope
Place search is restricted to India: Nominatim is queried with
`countrycodes=in` plus a bounded India viewbox, and results are filtered again
client-side by `isInIndia()` in [`web/src/lib/geo.js`](web/src/lib/geo.js).
Searching "London" returns Indian places named London, never the UK city.
Routing refuses coordinates outside the box, since the safety datasets only
cover India. To widen the scope later, change `INDIA_VIEWBOX` and the
`countrycodes` parameter in that one file.

## Your logo

Drop the file at **`web/public/logo.png`** and it appears in the sidebar, the
mobile header and both auth screens — no code change. Until then the app falls
back to a built-in shield mark, so nothing renders broken. See
[`web/public/README-logo.md`](web/public/README-logo.md) for sizing and how to
point at a different filename.

## Design system

Dark-first, since the product is built for night use. Colour tokens live in
[`web/src/index.css`](web/src/index.css) as `oklch` values under `:root` and
`.dark`, exposed to Tailwind through `@theme inline`. The safety scale
(`--safe` / `--caution` / `--risk`) is the one semantic axis shared by the
meter, the route legend and the grid overlay — and colour never carries a
reading alone, so every score is also shown as a number and a text band.

## Ports
Both Flask apps (`backend/app.py` and `safety_route/backend/app.py`) default to
5001, so only one can run at a time. Set `PORT` to run them side by side.

## Notes

- `frontend/` is empty: git records it as a submodule gitlink with no
  `.gitmodules`, so the original UI files were never committed to this repo.
  The app in `web/` replaces it, and Flask falls back to `web/dist` when
  `frontend/html/index.html` is absent.
- The camera needs a secure context. On `http://localhost` it works; over
  `http://<lan-ip>` browsers block it, so the capture sheet always offers a
  file-upload fallback.
- This is a prototype. SOS alerts are logged to SQLite, not dispatched — in a
  real emergency call your local emergency number.
