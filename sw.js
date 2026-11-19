/**
 * Service Worker - sw.js
 * จัดการ Caching ด้วยกลยุทธ์ Network-First สำหรับโหมด Offline PWA
 * อัปเดตเวอร์ชันแคชเป็น v20 และปรับรายการไฟล์สคริปต์เป็น ?v=16 ให้ตรงกับ index.html
 */

const CACHE_NAME = 'sales-analytics-v20';

// รายการไฟล์ทั้งหมดในโปรเจกต์ที่ต้องแคชไว้ใช้งานออฟไลน์
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon.png',
  './db.js?v=16',
  './state.js?v=16',
  './dealer.js?v=16',
  './forecast.js?v=16',
  './site-visit.js?v=16',
  './sales-engine.js?v=16',
  './pptx-export.js?v=16',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ข้ามการแคชสำหรับคำขอเรียกใช้ Google Gemini API
  if (url.origin.includes('generativelanguage.googleapis.com')) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
