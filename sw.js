/* 오프라인용: 앱 파일을 기기에 담아 두고 인터넷 없이 연다. 파일을 고치면 VERSION을 올린다. */
const VERSION = 'gunmu-v6';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'js/jszip.min.js', 'js/calc.js', 'js/xlsx.js', 'js/store.js', 'js/mine.js', 'js/view.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit ||
      fetch(e.request).catch(() => (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
