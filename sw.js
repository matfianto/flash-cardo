/* Flash Cardo - Service Worker
 * - App shell (file lokal) di-precache saat instal -> aplikasi bisa dibuka offline.
 * - Library CDN (Tailwind, Lucide, Google Fonts) ikut di-cache supaya tampilan tetap utuh offline.
 * - Halaman utama memakai "network-first" sehingga update yang Anda push ke GitHub Pages
 *   langsung terlihat saat online, dan tetap jalan dari cache saat offline.
 *
 * Naikkan VERSION setiap kali Anda menambah/mengganti file di SHELL_ASSETS atau CDN_ASSETS.
 */
const VERSION = 'v1';
const SHELL_CACHE = `flashcardo-shell-${VERSION}`;
const RUNTIME_CACHE = `flashcardo-runtime-${VERSION}`;

// Path relatif terhadap lokasi sw.js -> otomatis benar di https://user.github.io/nama-repo/
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Harus sama persis dengan URL di index.html
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com/3.4.17',
  'https://unpkg.com/lucide@0.525.0/dist/umd/lucide.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

const CDN_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // cache:'reload' -> selalu ambil dari server, bukan dari cache HTTP
    await shell.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' })));

    // CDN lintas-origin: no-cors (respons "opaque"). Gagal satu tidak membatalkan instalasi.
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(CDN_ASSETS.map(async (u) => {
      const res = await fetch(new Request(u, { mode: 'no-cors' }));
      await runtime.put(u, res);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('flashcardo-') && !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Tombol "Muat ulang" pada banner update mengirim pesan ini
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function handleNavigation(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetchWithTimeout(event.request, 4000);
    if (res && res.ok) event.waitUntil(cache.put(event.request, res.clone()));
    return res;
  } catch (err) {
    return (await cache.match(event.request, { ignoreSearch: true }))
        || (await cache.match('./index.html'))
        || (await cache.match('./'))
        || Response.error();
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(network); // perbarui cache di belakang layar
    return cached;
  }
  return (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE));
  }
});
