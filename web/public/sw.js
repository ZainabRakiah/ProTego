/*
 * ProTego service worker.
 *
 * The point of the app is knowing which streets are safe, and the moment that
 * matters most is the one with no signal. So the shell, the map tiles you have
 * already seen, and the safety pack all have to survive losing the network.
 *
 * Three different caching strategies, because the right answer differs:
 *   shell   cache-first, refreshed in the background — must open instantly
 *   tiles   cache-first with a cap — immutable, but unbounded if left to grow
 *   api     network-first with a cached fallback — fresh when possible
 */
const VERSION = "v1";
const SHELL_CACHE = `protego-shell-${VERSION}`;
const TILE_CACHE = `protego-tiles-${VERSION}`;
const API_CACHE = `protego-api-${VERSION}`;
const PACK_CACHE = "protego-safety-pack-v1"; // shared with lib/offlineSafety.js

// Tiles are small but endless; keep the most recent slice of what was viewed.
const TILE_LIMIT = 1200;

const TILE_HOSTS = [
  "tile.openstreetmap.org",
  "tile.opentopomap.org",
  "basemaps.cartocdn.com",
  "server.arcgisonline.com",
];

/** API paths that are useful offline and safe to serve stale. */
const CACHEABLE_API = ["/api/offline/safety-pack", "/api/hospitals-nearby", "/api/safety-point"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // "/" pulls in the built JS and CSS via the navigation fallback below.
      await cache.addAll(["/", "/manifest.webmanifest"]).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, TILE_CACHE, API_CACHE, PACK_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Drop the oldest entries once a cache passes its cap. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}

async function cacheFirst(request, cacheName, { limit } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Opaque responses (cross-origin tiles) are cacheable but unreadable; that is
  // fine here since they are only ever handed straight back to the map layer.
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    if (limit) trim(cacheName, limit);
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // --- map tiles -----------------------------------------------------------
  if (TILE_HOSTS.some((host) => url.hostname.endsWith(host))) {
    event.respondWith(
      cacheFirst(request, TILE_CACHE, { limit: TILE_LIMIT }).catch(
        // A missing tile offline should leave a blank square, not break the map.
        () => new Response("", { status: 504, statusText: "Tile unavailable offline" }),
      ),
    );
    return;
  }

  // Place search is useless without a network and must not be cached stale.
  if (url.hostname.endsWith("nominatim.openstreetmap.org")) return;

  if (url.origin !== self.location.origin) return;

  // --- safety pack: the offline map itself ---------------------------------
  if (url.pathname === "/api/offline/safety-pack") {
    event.respondWith(cacheFirst(request, PACK_CACHE));
    return;
  }

  // --- other API -----------------------------------------------------------
  if (url.pathname.startsWith("/api/")) {
    if (CACHEABLE_API.some((path) => url.pathname.startsWith(path))) {
      event.respondWith(networkFirst(request, API_CACHE));
    }
    // Everything else (auth, writes) is left alone: a stale answer there would
    // be worse than an honest failure the UI can report.
    return;
  }

  // --- app shell -----------------------------------------------------------
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match("/")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Built assets are content-hashed, so cache-first is always correct.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

/** Let the page ask how much has been stored, and pre-warm an area of tiles. */
self.addEventListener("message", (event) => {
  const { type } = event.data ?? {};

  if (type === "cache-status") {
    event.waitUntil(
      (async () => {
        const tiles = await caches.open(TILE_CACHE);
        const pack = await caches.open(PACK_CACHE);
        event.source?.postMessage({
          type: "cache-status",
          tiles: (await tiles.keys()).length,
          hasPack: (await pack.keys()).length > 0,
        });
      })(),
    );
  }

  if (type === "cache-tiles" && Array.isArray(event.data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(TILE_CACHE);
        let done = 0;
        // Sequential on purpose: a burst of hundreds of tile requests gets a
        // public tile server to rate-limit or ban the client.
        for (const url of event.data.urls) {
          try {
            if (!(await cache.match(url))) {
              const res = await fetch(url, { mode: "no-cors" });
              await cache.put(url, res);
            }
            done += 1;
            if (done % 25 === 0) {
              event.source?.postMessage({
                type: "cache-progress",
                done,
                total: event.data.urls.length,
              });
            }
          } catch {
            /* one failed tile should not abort the download */
          }
        }
        await trim(TILE_CACHE, TILE_LIMIT);
        event.source?.postMessage({
          type: "cache-progress",
          done,
          total: event.data.urls.length,
          finished: true,
        });
      })(),
    );
  }
});
