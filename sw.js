const CACHE_NAME = 'abuzamel-pos-v26'; // online mode

const ASSETS = [
  './',
  './index.html',
  './core/style.css',
  './core/app.js',
  './core/db.js',
  './core/config.js',
  './core/remote-db.js',
  './core/manifest.json',
  './core/app-icon.png',
  './core/logo.jpg',
  './core/fontawesome/css/all.min.css',
  './core/fontawesome/webfonts/fa-solid-900.woff2',
  './core/fontawesome/webfonts/fa-solid-900.ttf',
  './core/fontawesome/webfonts/fa-regular-400.woff2',
  './core/fontawesome/webfonts/fa-regular-400.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).hostname.endsWith('.supabase.co')) return; // never cache API traffic

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cross-origin CDN files (Chart.js, XLSX, jsPDF, fonts) come back as opaque responses (status 0).
          // Cache them too so charts and Excel export keep working offline.
          if (!res || (res.status !== 200 && res.type !== 'opaque')) return res;
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => {
          // Only return index.html fallback for navigation requests (not JS/CSS/images)
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 408, statusText: 'Offline' });
        });
    })
  );
});
