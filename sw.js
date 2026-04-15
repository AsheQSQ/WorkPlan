// 每次你对项目做了重大更新，请把这里的 v1 改成 v2, v3, v4...
const CACHE_NAME = 'planpro-cache-v2';

// 需要缓存的文件
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// 1. 安装阶段：跳过等待，立即接管
self.addEventListener('install', event => {
  self.skipWaiting(); // 强制新版本的 Service Worker 立即生效
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// 2. 激活阶段：自动清理以前的旧缓存（当 CACHE_NAME 改变时触发）
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('SW: 清理旧版本缓存', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // 立即控制所有打开的页面
  );
});

// 3. 拦截请求阶段：改为【网络优先，缓存兜底 (Network First)】
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 如果网络请求成功，说明在线。把最新拿到的数据存入缓存一份
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response; // 返回最新的网页内容
      })
      .catch(() => {
        // 如果 fetch 报错（通常是因为断网了），就退而求其次，去缓存里找
        console.log('SW: 网络不可用，使用离线缓存');
        return caches.match(event.request);
      })
  );
});
