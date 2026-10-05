// Service Worker for offline support

// NOTE: This SW only registers in production (see src/main.tsx PROD check).
// Bump CACHE_NAME to force old caches to be purged on next user visit.
// Every redeploy with stale cache complaints → bump this version suffix.
const CACHE_NAME = 'participation-platform-v2';
const OFFLINE_URL = '/offline.html';

// Resources to precache. "/" is intentionally NOT listed here: precaching the
// root caused stale index.html to be served on local dev / fast reloads.
const PRECACHE_URLS = [
  '/index.html',
  '/offline.html',
];

// Install event - precache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API requests (always go to network)
  if (event.request.url.includes('/api/')) return;

  // Bypass Vite dev server module URLs entirely — these must never be cached.
  // This belt-and-suspenders guard avoids stale assets even if SW ever runs in dev.
  const devPatterns = [
    '/@vite/', '/@id/', '/@fs/', '/src/', '/node_modules/', '.tsx', '.ts', '.jsx',
    '?t=', '?v=', '?import=', '?vite',
  ];
  const url = event.request.url;
  if (devPatterns.some((p) => url.includes(p)) || event.request.destination === 'script' || event.request.destination === 'style') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request).then((response) => {
          return response || caches.match(OFFLINE_URL);
        });
      })
  );
});

// Background sync for drafts
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-drafts') {
    event.waitUntil(syncDrafts());
  }
});

async function syncDrafts() {
  // Notify all clients to sync their drafts
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_DRAFTS' });
  });
}

// Push notifications (future feature)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
      })
    );
  }
});
