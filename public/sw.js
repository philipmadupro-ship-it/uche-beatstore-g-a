// U2C Beatstore — minimal service worker.
//
// Two responsibilities:
//
// 1. App-shell cache. On install we pre-cache /offline + manifest +
//    icon so when the user is genuinely offline and tries to
//    navigate, the browser gets the offline page instead of the
//    default "no internet" screen.
//
// 2. Stale-while-revalidate for /_next/static. Once the bundle is
//    cached the app boots without network — IndexedDB-cached tracks
//    play, the rest of the UI degrades gracefully.
//
// What this SW intentionally does NOT do:
//   - Cache audio blobs (handled by src/lib/offline/audio-cache.ts
//     via IndexedDB; SW + IndexedDB are kept separate so each has
//     one job).
//   - Cache API responses (mutating routes should always hit the
//     network; cached stale data on /api/* is a footgun).
//   - Push notifications (separate concern, opt-in surface).

const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `u2c-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `u2c-static-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  '/offline',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)),
  );
  // New SW takes control on next page load. We don't skipWaiting()
  // because the next page is already loaded with the OLD bundle —
  // forcing the new SW to control immediately is a recipe for
  // mismatched bundle/SW pairs and obscure runtime errors.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== APP_SHELL_CACHE && n !== STATIC_CACHE)
          .map((n) => caches.delete(n)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same-origin only — never proxy R2 audio or third-party requests.
  if (url.origin !== self.location.origin) return;

  // /_next/static — stable, content-hashed. Cache-first, fall back to
  // network. Stale-while-revalidate is overkill since the URLs are
  // immutable.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Navigation requests: try network first, fall back to /offline
  // when the user is genuinely offline. Network-first preserves the
  // SSR flow when online.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        return (await cache.match('/offline')) || Response.error();
      }),
    );
    return;
  }

  // Everything else passes through.
});
