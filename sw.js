const CACHE_NAME = 'planpro-cache-v1';

// 缓存你的核心文件
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js'
];

// 安装 Service Worker 并缓存文件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// 拦截网络请求，优先使用缓存（提升加载速度）
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果缓存里有，就直接返回缓存的内容
        if (response) {
          return response;
        }
        // 否则向网络发起真实的请求
        return fetch(event.request);
      })
  );
});