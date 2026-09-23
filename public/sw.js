// Dexter Write — Offline Service Worker
// Enables 100% offline document editing, Monaco workers, and KaTeX fonts.

const CACHE_NAME = 'dexter-write-v1';

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
            .filter((name) => name !== CACHE_NAME)
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

  // Strategy 1: HTML Navigations -> Network-first with cache fallback
  if (request.mode === 'navigate') {
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
    url.pathname.includes('/assets/') ||
    url.pathname.endsWith('.wasm') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf') ||
    url.hostname.includes('cdn.jsdelivr.net');

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
    return;
  }

  // Strategy 3: Default -> Stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached || Response.error());

      return cached || fetchPromise;
    }),
  );
});
