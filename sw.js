/**
 * Service Worker - sw.js
 * จัดการ Caching ด้วยกลยุทธ์ Network-First สำหรับโหมด Offline PWA
 * อัปเดตเวอร์ชันแคช (v3) เพื่อรองรับฟังก์ชันรวม 2 รูปและการแก้ไขการ์ดหน้างาน
 * ข้ามการแคชสำหรับ Google Gemini API โดยตรง
 */

const CACHE_NAME = 'sales-analytics-v3';

// รายการไฟล์ทั้งหมดในโปรเจกต์ที่ต้องแคชไว้ใช้งานออฟไลน์
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon.png',
  './db.js',
  './state.js',
  './dealer.js',
  './forecast.js',
  './site-visit.js',
  './sales-engine.js',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap'
];

// ติดตั้ง Service Worker และพรีแคชไฟล์พื้นฐานทั้งหมด
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// เคลียร์แคชเวอร์ชันเก่าทิ้งทันทีเมื่อโหลดเวอร์ชันใหม่
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

// กลยุทธ์ Network-First with Cache Fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ข้ามการแคชสำหรับคำขอเรียกใช้ Google Gemini API
  if (url.origin.includes('generativelanguage.googleapis.com')) {
    return;
  }

  // รองรับเฉพาะคำขอแบบ GET
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // หากดึงข้อมูลผ่านเครือข่ายสำเร็จ ให้อัปเดตข้อมูลลงแคช
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // หากออฟไลน์ ให้ดึงข้อมูลจากแคชที่บันทึกไว้
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // สำหรับคำขอนำทางหน้าเว็บ (Navigation) ให้ Fallback ไปที่ index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
