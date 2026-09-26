// アプリ本体と最後に受け取った暗号文をキャッシュし、オフラインでも前回の内容を表示できるようにする。
const VERSION = 'sikun-mobile-v2';
const SHELL = [
  '/', '/index.html', '/styles.css', '/manifest.webmanifest',
  '/js/app.js', '/js/crypto.js', '/js/sanitize.js', '/vendor/marked.umd.js',
  '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/icons/guide-bear.png', '/personas/default.png', '/personas/chief.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function snapshot(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    else if (response.status === 404) await cache.delete(request);
    return response;
  } catch {
    const cached = await cache.match(request);
    if (!cached) return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    const headers = new Headers(cached.headers);
    headers.set('X-Sikun-Offline', '1');
    return new Response(await cached.blob(), { status: 200, headers });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request) || (request.mode === 'navigate' ? await cache.match('/index.html') : undefined);
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api/snapshot') event.respondWith(snapshot(event.request));
  else event.respondWith(networkFirst(event.request));
});
