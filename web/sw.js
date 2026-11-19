// Service worker: lets the installed app start and work without a connection.
// It only ever repeats the page's own same-origin GET requests for the app's own files. It never
// contacts another host, never sees or sends the user's data (that lives in localStorage, which a
// service worker cannot read), and never touches the assistant's /api/ requests.
// Strategy: try the network first so a new version arrives when online; fall back to the copy
// saved on the device when offline.

const CACHE = 'mealprep-app-v2';
// Every file the app needs. A test checks that this list matches the files in web/ and core/.
const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './i18n.js',
  './store.js',
  './assistant.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  '../core/assistant.js',
  '../core/batches.js',
  '../core/foods.js',
  '../core/inventory.js',
  '../core/nutrition.js',
  '../core/planning.js',
  '../core/seed.js',
  '../core/shopping.js',
  '../core/state.js',
  '../core/tracking.js',
  '../core/training.js',
  '../core/data/frida.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    // 'no-cache' makes the browser check with the server instead of trusting its own HTTP cache,
    // so a new version is picked up the next time the app is opened online.
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./index.html'))),
  );
});
