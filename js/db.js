// ═══════════════════════════════════════════════════
// db.js — Persistencia local con IndexedDB
// Guarda grabaciones, carpetas y ajustes offline
// ═══════════════════════════════════════════════════

const DB_NAME    = 'musicare_mobile';
const DB_VERSION = 1;
let _db = null;

function dbOpen() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Grabaciones
      if (!db.objectStoreNames.contains('recordings')) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('status',    'status',    { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      // Carpetas de Drive
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      // Ajustes clave-valor
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Grabaciones ───────────────────────────────────
async function dbSaveRecording(rec) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put(rec);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbGetAllRecordings() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('recordings', 'readonly');
    const req = tx.objectStore('recordings').index('createdAt').getAll();
    req.onsuccess = e => resolve(e.target.result.reverse());
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGetRecording(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('recordings', 'readonly');
    const req = tx.objectStore('recordings').get(id);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbUpdateRecordingStatus(id, status, driveId) {
  const rec = await dbGetRecording(id);
  if (!rec) return;
  rec.status  = status;
  if (driveId) rec.driveId = driveId;
  await dbSaveRecording(rec);
}

async function dbDeleteRecording(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbGetPendingRecordings() {
  const all = await dbGetAllRecordings();
  return all.filter(r => r.status === 'pending' || r.status === 'error');
}

// ── Carpetas ──────────────────────────────────────
async function dbSaveFolder(folder) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').put(folder);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbGetFolders() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('folders', 'readonly');
    const req = tx.objectStore('folders').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbDeleteFolder(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

// ── Ajustes ───────────────────────────────────────
async function dbSetSetting(key, value) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbGetSetting(key, defaultValue = null) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = e => resolve(e.target.result ? e.target.result.value : defaultValue);
    req.onerror   = e => reject(e.target.error);
  });
}
