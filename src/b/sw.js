// dumb hack to allow firefox to work (please dont do this in prod)
// do this in prod
if (typeof crossOriginIsolated === 'undefined' && navigator.userAgent.includes('Firefox')) {
    Object.defineProperty(self, "crossOriginIsolated", {
        value: true,
        writable: false,
    });
}

importScripts(
    '/b/s/scramjet.all.js',
    '/b/u/bunbun.js',
    '/b/u/concon.js',
    '/b/u/serser.js',
);

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
const uv = new UVServiceWorker();

let scramjetConfigLoaded = false;
const CACHE_NAME = 'xin-cache';

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    event.respondWith((async () => {
        try {
            // Guard: prevent failed proxy attempts to localhost/loopback from breaking pages
            // Example failing requests: /b/s/http%3A%2F%2Flocalhost%3A33445%2Fhello => 500/libcurl code 52
            if (url.pathname.startsWith('/b/s/')) {
                try {
                    const original = decodeURIComponent(url.pathname.slice(5)); // strip '/b/s/'
                    const originalUrl = new URL(original);
                    const h = originalUrl.hostname.toLowerCase();
                    const isLoopback = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
                    if (isLoopback) {
                        return new Response('', { status: 204 });
                    }
                } catch (_) {}
            }
            if (!scramjetConfigLoaded) {
                await scramjet.loadConfig();
                scramjetConfigLoaded = true;
            }

            if (url.pathname.startsWith('/b/s/scramjet.') && !url.pathname.endsWith('scramjet.wasm.wasm')) {
                return fetch(request);
            }

            if (scramjet.route(event)) {
                const response = await scramjet.fetch(event);
                if (request.method === 'GET') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                }
                return response;
            }

            if (uv.route(event)) {
                const response = await uv.fetch(event);
                if (request.method === 'GET') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                }
                return response;
            }

            const cache = await caches.open(CACHE_NAME);
            const cachedResponse = await cache.match(request);
            if (cachedResponse) {
                return cachedResponse;
            }

            const networkResponse = await fetch(request);
            if (request.method === 'GET' && networkResponse && networkResponse.ok) {
                const responseClone = networkResponse.clone();
                cache.put(request, responseClone);
            }
            return networkResponse;

        } catch (err) {
            try {
                // Surface transport-level failures to the page so it can react (e.g., switch transports)
                const clients = await self.clients.matchAll();
                const msg = (err && (err.message || err.toString())) || 'unknown error';
                let originalUrl = request.url;
                let targetUrl = null;
                try {
                    const u = new URL(originalUrl);
                    if (u.pathname.startsWith('/b/s/')) {
                        targetUrl = decodeURIComponent(u.pathname.slice('/b/s/'.length) + u.search + u.hash);
                    }
                } catch (_) {}
                for (const c of clients) {
                    c.postMessage({ type: 'transport-error', error: msg, url: originalUrl, target: targetUrl });
                }
            } catch (_) {}
            console.error('SW fetch error:', err);
            return fetch(request);
        }
    })());
});
