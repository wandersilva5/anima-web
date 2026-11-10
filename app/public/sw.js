/* Service worker minimo: cache do shell e das miniaturas ja visitadas. */
const SHELL = 'anima-shell-v2';
const MEDIA = 'anima-media-v2';

// Raiz do app ('/' localmente, '/anima/' em producao): o escopo do proprio
// registration ja entrega o prefixo certo, entao nada aqui e fixo na raiz do dominio.
const BASE = new URL(self.registration.scope).pathname;
const SHELL_FILES = [BASE, `${BASE}manifest.webmanifest`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Miniaturas: cache-first (conteudo imutavel por hash)
  if (url.pathname.startsWith(`${BASE}media/`)) {
    event.respondWith(
      caches.open(MEDIA).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // HTML: network-first para sempre pegar a versao nova
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(BASE, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(BASE)),
    );
  }
});