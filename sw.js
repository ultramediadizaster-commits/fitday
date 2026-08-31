/* FitDay service worker — офлайн жұмыс үшін кэш */
const CACHE = 'fitday-v9';   // мобиль autoplay түзетуі + дыбыс диагностикасы

/* Қосымшаның қаңқасы (app shell) */
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './js/three.min.js',
  './js/GLTFLoader.js',
  './models/athlete.glb',
  './audio/voice.mp3',
  './audio/sprite.json'
];

/* Орнату: барлық файлды кэшке саламыз (біреуі жоқ болса да құламайды) */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

/* Белсендіру: ескі кэштерді тазалаймыз */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Сұраныс: алдымен кэш, болмаса желі (нәтижесін кэштейміз) */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetchAndCache(req))
  );
});

/* Желіден алып, кэшке көшірме қалдыру */
function fetchAndCache(req) {
  return fetch(req)
    .then((res) => {
      if (!res || !res.ok) return res;          // 404-ті кэштемейміз
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    })
    .catch(() => {
      /* Офлайн қалдық. Бет ашылса — қаңқаны береміз, ал сурет/дыбыс сияқты
         қосалқы файлға index.html беруге БОЛМАЙДЫ: voice.mp3 орнына HTML
         келсе, decodeAudioData түсініксіз қатемен құлайды. */
      if (req.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    });
}

/* Еске салу хабарламасын қосымшадан алып көрсету */
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'notify' || !self.registration.showNotification) return;
  self.registration.showNotification(d.title || 'FitDay', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'fitday-reminder'
  });
});

/* Хабарламаны басқанда қосымшаны ашу */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    if (list.length) return list[0].focus();
    return self.clients.openWindow('./index.html');
  }));
});
