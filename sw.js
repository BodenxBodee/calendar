// Service worker: makes the app load offline and shows push reminders.
// Bump VERSION whenever you change app files so devices pick up the update.
const VERSION = 'v1.0.0';
const CACHE = `calendar-${VERSION}`;

const APP_FILES = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js', 'js/config.js', 'js/ctx.js', 'js/dates.js', 'js/editor.js',
  'js/ics.js', 'js/recurrence.js', 'js/settings.js', 'js/store.js', 'js/views.js',
  'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/badge-72.png',
];
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('calendar-') && k !== CACHE).map((k) => caches.delete(k)),
  )));
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isSdk = req.url.startsWith(FIREBASE_SDK);
  if (!sameOrigin && !isSdk) return; // Firestore / sign-in traffic goes straight to the network

  // Pages: network first so updates show up, fall back to cache offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html', { ignoreSearch: true })));
    return;
  }
  // Everything else: cache first, then network (and remember it).
  e.respondWith(caches.match(req, { ignoreSearch: sameOrigin }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});

// ── Push reminders (sent by the GitHub reminder job) ──

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Reminder', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Reminder', {
    body: data.body || '',
    tag: data.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-72.png',
    data: { url: data.url || './' },
    timestamp: data.at || Date.now(),
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
