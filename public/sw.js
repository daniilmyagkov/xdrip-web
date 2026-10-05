/*
 * Service worker: keeps the app shell available offline and lets the site be installed as an app.
 * Only this site's own files are cached. Requests to Nightscout (another origin) are never touched,
 * so glucose data is always live and the access token never lands in a cache.
 */
const CACHE = 'xdripweb-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: network first, so a new version shows up at once; the cached copy is the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Built files have content hashes in their names: cache first. Icons/manifest: refreshed in background.
  const immutable = url.pathname.includes('/assets/');
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (hit) {
        if (!immutable) network.catch(() => undefined);
        return hit;
      }
      return network;
    }),
  );
});
