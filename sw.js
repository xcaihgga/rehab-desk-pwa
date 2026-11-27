/* 康复病历工作台 Service Worker —— 只缓存界面文件，不读写任何病例数据 */
/* VERSION 由部署流程改写（见 .github/workflows/deploy.yml），保证每次发版 SW 字节必变，
   用户不会被旧缓存长期钉在旧版本。手动部署时请务必同步改这一行。 */
const VERSION = 'deploy-19-1b0d93d';
const CACHE = 'rehab-desk-' + VERSION;
const PRECACHE = ['./', 'index.html', 'styles.css', 'data.js', 'templates-bingli.js', 'schemas-bingli.js', 'hints-bingli.js', 'app.js', 'manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const missing = [];
    await Promise.all(PRECACHE.map(async (u) => {
      try {
        const r = await fetch(new Request(u, { cache: 'reload' }));
        if (!r || !r.ok) { missing.push(u + '(' + (r ? 'HTTP ' + r.status : 'no response') + ')'); return; }
        await cache.put(u, r);
      } catch (e) { missing.push(u + '(' + ((e && e.name) || 'fetch failed') + ')'); }
    }));
    /* 关键：离线包不全时宁可让本次安装失败，也不能带着残缺缓存接管页面。
       安装失败后旧版本 SW（或"无 SW"的在线状态）继续服务，下次联网会重试安装。 */
    if (missing.length) {
      try { await caches.delete(CACHE); } catch (e) {}
      throw new Error('precache incomplete: ' + missing.join(', '));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('rehab-desk-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });

async function networkFirst(request, fallbackUrl, timeoutMs) {
  const cache = await caches.open(CACHE);
  try {
    /* 明确离线时不再空等 4 秒，直接走缓存 */
    if (self.navigator && self.navigator.onLine === false) throw new Error('offline');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (resp && resp.ok) {
      /* 两份入口键同步刷新，避免新 index 配旧资源 */
      try { await cache.put('index.html', resp.clone()); await cache.put('./', resp.clone()); } catch (e) {}
      return resp;
    }
    throw new Error('bad status');
  } catch (e) {
    const fb = (await cache.match(fallbackUrl)) || (await cache.match('./')) || (await cache.match('index.html'));
    if (fb) return fb;
    return new Response('<!doctype html><meta charset="utf-8"><title>离线</title><body style="font-family:system-ui;padding:40px;line-height:1.8"><h2>暂时离线</h2><p>这台设备还没缓存过本应用，请先联网打开一次。</p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp && resp.ok && request.method === 'GET' && new URL(request.url).origin === self.location.origin) cache.put(request, resp.clone());
  return resp;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req, 'index.html', 4000)); return; }
  event.respondWith(cacheFirst(req));
});
