/**
 * Deliberately does NOT cache the app itself — event branding, photos, and
 * booth config all change per-event, so guests/kiosks must always get a
 * fresh network fetch. The only thing this precaches is offline.html, served
 * back in place of a failed page navigation so a dropped connection shows a
 * friendly retry screen instead of the browser's own dino/error page.
 */
const CACHE = 'jsm-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only ever intercept full-page navigations — every other request (assets,
  // API calls, photo uploads) passes straight through to the network,
  // untouched and uncached.
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  );
});
