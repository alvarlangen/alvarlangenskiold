/* Map in the Dark — service worker (generated from src/sw-template.js at build time). */
const VERSION = '__VERSION__';
const CACHE = `mitd-${VERSION}`;
/** Satellite tiles are cached as they are viewed and kept across versions (they rarely change). */
const IMAGERY_CACHE = 'imagery-v1';
const CORE = __CORE__;
const EXTRA = __EXTRA__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('mitd-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      // Cache every country's pieces and every flag in the background, in small batches.
      const cache = await caches.open(CACHE);
      for (let i = 0; i < EXTRA.length; i += 20) {
        const batch = EXTRA.slice(i, i + 20);
        await Promise.all(
          batch.map(async (url) => {
            if (await cache.match(url)) return;
            try {
              const res = await fetch(url);
              if (res.ok) await cache.put(url, res);
            } catch {
              /* offline: retry on next activation or on demand */
            }
          }),
        );
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first (to pick up new versions), cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./', { ignoreSearch: true })),
    );
    return;
  }

  if (/\/imagery\/\d+\/\d+\/\d+\.webp$/.test(url.pathname)) {
    event.respondWith(
      caches.open(IMAGERY_CACHE).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Everything else (hashed assets, data, flags): cache first, then network (and cache it).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
