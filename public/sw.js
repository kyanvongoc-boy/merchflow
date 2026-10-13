/* Public installation assets only. Business data always requires the network. */
'use strict';
const CACHE_PREFIX = 'merchflow-public-';
const CACHE_NAME = CACHE_PREFIX + '1.0.0-rc1';
const OFFLINE_PATH = '/offline.html';
const PUBLIC_ASSETS = new Set([
  OFFLINE_PATH,
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
]);

function allowedPublicRequest(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin &&
    !url.search && PUBLIC_ASSETS.has(url.pathname);
}

async function safePublicResponse(response, pathname) {
  if (!response || response.status !== 200 || response.redirected || response.type === 'opaque') return false;
  const expected = new URL(pathname, self.location.origin);
  if (response.url && response.url !== expected.href) return false;
  const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (pathname === OFFLINE_PATH) {
    if (type !== 'text/html') return false;
    const body = await response.clone().text();
    return body.includes('<meta name="merchflow-offline" content="1.0">');
  }
  if (type !== 'image/png') return false;
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  return bytes.length > 24 && bytes.length <= 200000 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // A failed optional icon never prevents installation or caches a sign-in page.
    await Promise.allSettled([...PUBLIC_ASSETS].map(async path => {
      const response = await fetch(new Request(new URL(path, self.location.origin), { cache: 'reload', credentials: 'same-origin' }));
      if (await safePublicResponse(response, path)) await cache.put(path, response);
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  // Only a controlled same-origin window may approve activating an update.
  const source = event.source;
  if (event.data?.type !== 'MERCHFLOW_APPLY_UPDATE' || !source || source.type !== 'window') return;
  try { if (new URL(source.url).origin !== self.location.origin) return; } catch { return; }
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Preserve every HTTP status and redirect, including 401, 403 and 500.
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_PATH);
        return offline || new Response('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MerchFlow · Offline</title><body><h1>Không có kết nối / You are offline</h1><p>Kết nối Internet rồi tải lại. / Connect to the Internet and reload.</p><p>Dữ liệu chưa được tải hoặc đồng bộ. / Data has not been loaded or synced.</p><a href="/workspace#tasks">Thử lại / Try again</a></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
    })());
    return;
  }
  if (!allowedPublicRequest(request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (await safePublicResponse(response, url.pathname)) await cache.put(request, response.clone());
    return response;
  })());
});
