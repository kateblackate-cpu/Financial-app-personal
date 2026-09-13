/*
 * K+ service worker — makes the app usable with no network at all.
 *
 * Strategy:
 *   navigations   -> network first, fall back to the cached shell (so a cold
 *                    offline launch from the home screen still boots)
 *   everything else -> cache first, then network (Vite hashes asset filenames,
 *                    so a cached asset is never stale)
 *
 * Bump CACHE whenever the shell changes; `activate` drops every older cache.
 */
const CACHE = "kplus-v1";

// Resolved against the registration scope so the app also works from a sub-path.
const url = (p) => new URL(p, self.registration.scope).href;
const SHELL = ["./", "./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Added one by one: a single 404 must not abort the whole precache.
      await Promise.all(SHELL.map((p) => cache.add(url(p)).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(url("./index.html"), fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(url("./index.html"))) || (await cache.match(url("./"))) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
});
