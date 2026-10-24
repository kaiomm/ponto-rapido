// Cache da interface. Chamadas à API (Tangerino / Worker) são de outros domínios e não passam por aqui.
// Estratégia: tenta a rede (para pegar atualizações), mas usa o cache se a rede falhar,
// devolver erro (ex.: GitHub Pages fora do ar) ou demorar mais que NET_TIMEOUT_MS.
const CACHE = 'ponto-rapido-v22';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png?v=2', 'icons/icon-512.png?v=2'];
const NET_TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(handle(e));
});

async function handle(e) {
  const cache = await caches.open(CACHE);
  // Navegação (abrir o app) sempre pode cair na página principal em cache.
  const cached = await cache.match(e.request) ||
    (e.request.mode === 'navigate' ? await cache.match('index.html') || await cache.match('./') : undefined);

  const network = fetch(e.request).then(r => {
    if (r.ok) { cache.put(e.request, r.clone()).catch(() => {}); return r; }
    throw new Error('HTTP ' + r.status);               // nunca guarda nem mostra página de erro se houver cache
  });

  if (!cached) {                                        // sem cópia local: só resta a rede, mesmo com erro
    try { return await network; } catch { return fetch(e.request); }
  }
  const timeout = new Promise(resolve => setTimeout(() => resolve(cached), NET_TIMEOUT_MS));
  network.catch(() => {});                              // evita "unhandled rejection" quando o cache vence
  return Promise.race([network.catch(() => cached), timeout]);
}
