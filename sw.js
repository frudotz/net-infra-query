// Service worker: network-first for the app shell so new deployments reach
// users immediately; the cache is only an offline fallback. Cross-origin
// requests (API, Turnstile, map tiles, fonts) are never intercepted.
//
// The previous worker (altyapi-cache-v1) was cache-first and never updated
// the shell; activating this version deletes that cache.

const CACHE_NAME = 'altyapi-shell-v2';
const SHELL = [
    '/',
    '/index.html',
    '/css/index.css',
    '/js/boot.js',
    '/js/app.js',
    '/js/api.js',
    '/js/address-form.js',
    '/js/address-match.js',
    '/js/export-image.js',
    '/js/map-picker.js',
    '/js/result-model.js',
    '/js/result-view.js',
    '/js/ui.js',
    '/manifest.json',
    '/favicon.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL))
            .catch(() => { /* offline fallback is best effort */ })
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(request, { ignoreSearch: true });
                if (cached) return cached;
                if (request.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
                return Response.error();
            }),
    );
});
