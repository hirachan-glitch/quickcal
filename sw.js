// QuickCal Service Worker — アプリ本体をキャッシュして瞬間起動にする
// 方式: stale-while-revalidate（キャッシュを即返し、裏で最新を取得して次回に反映）
// ただし /drone/（ドローンシミュレーター）は network-first で常に最新を配信する。
const CACHE = 'quickcal-v4';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Google API・認証系はキャッシュしない（常にネット直行）
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  // ドローンシミュレーターは network-first: 毎回最新を取りに行き、
  // 取れたらキャッシュ更新、オフライン時のみキャッシュにフォールバック。
  // （stale-while-revalidate だと更新が1回遅れて「動かない」原因になるため）
  if (url.pathname.includes('/drone/')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
