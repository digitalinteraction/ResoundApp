const version = "resound-004";
// paths resolved relative to the service worker file location
const assets = [
  'package.html',
  'img/icon.png',
  'img/sphere-down.png',
  'img/sphere-up.png'
].map(p => new URL(p, self.location).toString());

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    console.log('@install');
    const cache = await caches.open(version);
    try {
      await cache.addAll(assets);
      console.log('cached assets', assets);
    } catch (err) {
      console.warn('cache.addAll failed (some assets may be missing)', err);
      // continue install even if some assets fail
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    console.log('@activate');
    const keys = await caches.keys();
    await Promise.all(keys.map(key => key !== version ? caches.delete(key) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  event.respondWith(performFetch(event));
});

async function performFetch(event) {
  const request = event.request;
  try {
    const cached = await caches.match(request);
    if (cached) return cached;

    const networkResponse = await fetch(request);
    // optionally cache GET responses so next time we can serve from cache
    if (request.method === 'GET' && networkResponse && networkResponse.ok) {
      const c = await caches.open(version);
      c.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // navigation fallback: return cached package.html if available
    if (request.mode === 'navigate') {
      const fallback = await caches.match(new URL('package.html', self.location).toString());
      if (fallback) return fallback;
    }
    // rethrow so devtools show the error
    throw err;
  }
}