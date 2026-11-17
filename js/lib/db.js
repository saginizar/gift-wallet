// Persistence adapters. The app uses IndexedDB; tests use the in-memory adapter.
// Both expose the same small API so the store does not care which one it gets.
//
// Object stores:
//   records  every synced record (cards, transactions, events, members), keyed by id
//   kv       device-local settings: deviceId, who "me" is, sync config, queues
//   images   photo bytes, keyed by photo id (kept out of memory until needed)

const DB_VERSION = 1;

const req2promise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

export function createIDBStorage(name = 'gift-wallet') {
  let opening = null;
  const db = () => opening || (opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => d.close();
      resolve(d);
    };
    req.onerror = () => reject(req.error);
  }));

  async function run(storeName, mode, fn) {
    const d = await db();
    const tx = d.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    await txDone(tx);
    return result instanceof IDBRequest ? result.result : result;
  }

  return {
    async loadAll() {
      const d = await db();
      const tx = d.transaction(['records', 'kv'], 'readonly');
      const records = req2promise(tx.objectStore('records').getAll());
      const kv = {};
      const cursorReq = tx.objectStore('kv').openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          kv[cursor.key] = cursor.value;
          cursor.continue();
        }
      };
      await txDone(tx);
      return { records: await records, kv };
    },
    putRecords: (list) => run('records', 'readwrite', (s) => { for (const r of list) s.put(r); }),
    putKV: (key, value) => run('kv', 'readwrite', (s) => { s.put(value, key); }),
    deleteKV: (key) => run('kv', 'readwrite', (s) => { s.delete(key); }),
    getImage: (id) => run('images', 'readonly', (s) => s.get(id)),
    putImage: (img) => run('images', 'readwrite', (s) => { s.put(img); }),
    deleteImage: (id) => run('images', 'readwrite', (s) => { s.delete(id); }),
    allImages: () => run('images', 'readonly', (s) => s.getAll()),
    async clear() {
      const d = await db();
      const tx = d.transaction(['records', 'kv', 'images'], 'readwrite');
      for (const n of ['records', 'kv', 'images']) tx.objectStore(n).clear();
      await txDone(tx);
    },
  };
}

export function createMemoryStorage(seed = {}) {
  const clone = (v) => (v === undefined ? v : structuredClone(v));
  const records = new Map((seed.records || []).map((r) => [r.id, clone(r)]));
  const kv = new Map(Object.entries(seed.kv || {}));
  const images = new Map();
  return {
    async loadAll() {
      return { records: [...records.values()].map(clone), kv: Object.fromEntries([...kv].map(([k, v]) => [k, clone(v)])) };
    },
    async putRecords(list) { for (const r of list) records.set(r.id, clone(r)); },
    async putKV(key, value) { kv.set(key, clone(value)); },
    async deleteKV(key) { kv.delete(key); },
    async getImage(id) { return clone(images.get(id)); },
    async putImage(img) { images.set(img.id, clone(img)); },
    async deleteImage(id) { images.delete(id); },
    async allImages() { return [...images.values()].map(clone); },
    async clear() { records.clear(); kv.clear(); images.clear(); },
    _dump: () => ({ records, kv, images }),
  };
}
