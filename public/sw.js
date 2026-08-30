/* pdf2book service worker: caches the app shell so it works fully offline
 * after the first visit. Uses network-first for navigations and a
 * stale-while-revalidate runtime cache for same-origin static assets. */
const CACHE = 'pdf2book-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/app-data.js',
  '/vendor/local-first.js',
  '/vendor/jszip.min.js',
  '/vendor/pdf.min.js',
  '/vendor/pdf.worker.min.js',
  '/vendor/tesseract.min.js',
  '/vendor/tesseract.worker.min.js',
  '/vendor/tesseract-core-simd.wasm.js',
  '/vendor/tesseract-core.wasm.js',
  '/pwa/manifest.webmanifest',
  '/pwa/icon.svg',
  '/pwa/icon-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for page navigations, fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // Stale-while-revalidate for everything else same-origin.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});