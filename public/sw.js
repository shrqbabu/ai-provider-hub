// Service Worker for PWA Android Installability
const CACHE_NAME = 'aip-hub-v4';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER intercept API calls, proxy endpoints, or non-GET requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/v1/') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Handle page navigations (SPA routes like /home, /chat, /providers)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const indexMatch = await caches.match('/index.html') || await caches.match('/');
        if (indexMatch) return indexMatch;
        return new Response(
          '<!DOCTYPE html><html><body><h3>Network Offline</h3><p>Please check your connection and reload.</p></body></html>',
          {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          }
        );
      })
    );
    return;
  }

  // Handle static assets (scripts, styles, images)
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => {});
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response(null, { status: 404 });
      })
  );
});
