// Dexter Write — Offline Service Worker
// Enables 100% offline document editing, Monaco workers, and KaTeX fonts.

const SCOPE_PATH = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = `dexter-write:${SCOPE_PATH}:`;
const CACHE_NAME = `${CACHE_PREFIX}v3`;

const STATIC_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
];

// Install Event: Pre-cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[ServiceWorker] Pre-cache warning:', err);
      }),
  );
});

// Activate Event: Cleanup older cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && (
              name.startsWith(CACHE_PREFIX) || name === 'dexter-write-v1' || name === 'dexter-write-v2'
            ))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch Event: Network-first for navigations, Cache-first for immutable assets
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests and http/https schemes
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);
  const inScope = url.origin === self.location.origin && url.pathname.startsWith(SCOPE_PATH);
  const appPath = inScope ? url.pathname.slice(SCOPE_PATH.length) : '';
  const isStaticCdn = url.hostname === 'cdn.jsdelivr.net';
  // Keep OAuth, cloud data, and local bridge requests out of the offline cache.
  if (
    request.headers.has('Authorization') ||
    (!inScope && !isStaticCdn) ||
    appPath.startsWith('oauth/') ||
    appPath.startsWith('api/') ||
    appPath.startsWith('__dexter/mcp/') ||
    appPath === 'events' ||
    request.headers.get('Accept')?.includes('text/event-stream') ||
    url.searchParams.has('code') ||
    url.searchParams.has('authorization_id')
  ) return;

  // Strategy 1: HTML Navigations -> Network-first with cache fallback
  if (request.mode === 'navigate' && inScope) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('./index.html');
          return fallback || Response.error();
        }),
    );
    return;
  }

  // Strategy 2: Static assets (JS chunks, CSS, fonts, SVG, WASM) -> Cache-first with background revalidation
  const isStaticAsset =
    appPath.startsWith('assets/') ||
    appPath.startsWith('core/busytex/') ||
    url.pathname.endsWith('.wasm') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf') ||
    isStaticCdn;

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached asset immediately, revalidate in background if online
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
              }
            })
            .catch(() => {
              // Network failed, silent fallback is fine
            });
          return cachedResponse;
        }

        // Cache miss -> fetch and store
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      }),
    );
  }
});
