// sw.js — Service Worker para modo offline
const CACHE = 'musicare-mobile-v4';
const ASSETS = [
  './',
  './index.html',
  './js/db.js',
  './js/drive.js',
  './js/recorder.js',
  './js/cron.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Solo cachear recursos locales, no llamadas a Google API
  if (e.request.url.includes('googleapis.com') ||
      e.request.url.includes('accounts.google.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
