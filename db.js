/**
 * SalesAnalyticsDB - IndexedDB Manager (db.js)
 * จัดการฐานข้อมูล IndexedDB ในเครื่อง สำหรับ settings, cached_files และ site_visits
 */
const DB_NAME = 'SalesAnalyticsDB';
const DB_VERSION = 1;
let db = null;

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      if (!dbInstance.objectStoreNames.contains('settings')) {
        dbInstance.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!dbInstance.objectStoreNames.contains('cached_files')) {
        dbInstance.createObjectStore('cached_files', { keyPath: 'fileType' });
      }
      if (!dbInstance.objectStoreNames.contains('site_visits')) {
        const visitStore = dbInstance.createObjectStore('site_visits', { keyPath: 'id', autoIncrement: true });
        visitStore.createIndex('projectId', 'projectId', { unique: false });
        visitStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => {
      console.error('IndexedDB open error:', e.target.error);
      reject(e.target.error);
    };
  });
}

function dbSave(storeName, data) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value || req.result : null);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbClearStore(storeName) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}
