/*
 * Fitness Friend service worker.
 *
 * It lets the app open without a connection once it has loaded one time.
 * The build fills in VERSION and PRECACHE (see build.mjs), so every deploy gets its own cache.
 *
 *   Pages            Network first, so a new version shows up on the next visit.
 *                    If the network fails or takes longer than four seconds, the saved copy is used.
 *   Built files      Their names change with their content, so they are saved once and then served from the cache.
 *   Other files      Icons and the manifest come from the cache and are refreshed in the background.
 *   Google Fonts     Saved on first use and refreshed in the background, so the typeface survives going offline.
 *
 * This worker never reads or stores anything you enter. That lives in the browser's own storage.
 */

const VERSION = "ba0b79c85a";
const PRECACHE = ["./index.html","./app-PH7EMUW4.js","./app-DC3GY2A4.css","./apple-touch-icon.png","./icon-192.png","./icon-512.png","./icon.svg","./manifest.webmanifest"];
const CACHE = `fitness-friend-${VERSION}`;
const FONTS = 'fitness-friend-fonts';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const HASHED = /-[A-Z0-9]{8}\.(?:js|css)$/;
const PAGE = './index.html';
const SLOW_MS = 4000;

self.addEventListener('install', (event) => {
  // addAll is all or nothing, so a half-saved version never becomes the active one.
  // "reload" skips the browser's own HTTP cache, so a fresh deploy is never saved as an older copy.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('fitness-friend-') && n !== CACHE && n !== FONTS).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  let handler = null;
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') handler = page;
    else if (HASHED.test(url.pathname)) handler = cacheFirst;
    else handler = (e) => refreshInBackground(e, CACHE);
  } else if (FONT_HOSTS.includes(url.hostname)) {
    handler = (e) => refreshInBackground(e, FONTS);
  }
  // If the cache itself is unavailable (some private windows), act as if there were no worker.
  if (handler) event.respondWith(handler(event).catch(() => fetch(req)));
});

const keep = (res) => res && (res.ok || res.type === 'opaque');

// Every page of this app is the same index.html (the screens are chosen by the part after the #).
async function page(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(PAGE);
  const fresh = fetch(PAGE, { cache: 'no-cache' }).then((res) => {
    // Only a good page replaces the saved one, so an error page never gets saved.
    if (res.ok) event.waitUntil(cache.put(PAGE, res.clone()));
    return res;
  });
  if (!saved) return fresh;
  // A server error counts as a failure: the saved page is better than an error page.
  const usable = fresh.then((res) => (res.ok ? res : saved)).catch(() => saved);
  event.waitUntil(fresh.catch(() => {}));
  return Promise.race([usable, new Promise((resolve) => setTimeout(() => resolve(saved), SLOW_MS))]);
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok) event.waitUntil(cache.put(event.request, res.clone()));
  return res;
}

async function refreshInBackground(event, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(event.request);
  const network = fetch(event.request).then((res) => {
    if (keep(res)) event.waitUntil(cache.put(event.request, res.clone()));
    return res;
  });
  if (hit) {
    event.waitUntil(network.catch(() => {}));
    return hit;
  }
  return network;
}
