/* Service Worker for Library Tracker
 * - Precache static assets (HTML, CSS, JS, manifest)
 * - Runtime caching for cover thumbnails from:
 *   - covers.openlibrary.org
 *   - books.google.com (books/content thumbnails)
 * - Avoid caching Open Library JSON metadata
 */

const PRECACHE = 'precache-v4';
const RUNTIME_IMAGE_CACHE = 'runtime-images-v1';

// Static assets to precache
const PRECACHE_URLS = [
  'index.html',
  'manifest.json',
  // Styles
  'styles/base.css',
  'styles/handsfree.css',
  'styles/modal.css',
  'styles/shelves.css',
  // JS
  'js/settings.js',
  'js/modal.js',
  'js/barcode.js',
  'js/search.js',
  'js/api.js',
  'js/voice.js',
  'js/utils.js',
  'js/main.js',
  'js/shelves.js',
  'js/db.js',
  'js/handsfree.js',
  'js/importExport.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (![PRECACHE, RUNTIME_IMAGE_CACHE].includes(key)) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Do not interfere with non-GET requests
  if (req.method !== 'GET') return;

  // Avoid caching Open Library JSON metadata
  if (url.hostname.endsWith('openlibrary.org') && url.pathname.endsWith('.json')) {
    return; // let the request go to network without SW handling
  }

  // Runtime caching (stale-while-revalidate) for cover thumbnails
  const isCoverImgHost = url.hostname === 'covers.openlibrary.org';
  const isGoogleBooksThumb = url.hostname === 'books.google.com' && url.pathname.startsWith('/books/content');

  if (isCoverImgHost || isGoogleBooksThumb) {
    event.respondWith(
      caches.open(RUNTIME_IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Cache-first strategy for same-origin precached assets
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(
        caches.match('index.html').then((resp) => resp || fetch(req))
      );
      return;
    }
    event.respondWith(
      caches.match(req).then((resp) => resp || fetch(req))
    );
    return;
  }
  // For all other requests, fall through to the network
});
