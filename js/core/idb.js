/* IndexedDB для медиафайлов (blob). При недоступности — запасной Map в памяти. */
const DB = 'zubrilka-media', STORE = 'media';
let dbp = null, dead = false;
const mem = new Map();

function open() {
  if (dead) return Promise.reject(new Error('idb unavailable'));
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) { dead = true; rej(); return; }
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const st = rq.result.createObjectStore(STORE, { keyPath: 'key' });
      st.createIndex('deck', 'deckId');
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dead = true; rej(rq.error); };
  }).catch(e => { dead = true; throw e; });
  return dbp;
}

function tx(db, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    fn(t.objectStore(STORE));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function putMany(deckId, items) {
  for (const { name, blob } of items) {
    const rec = { key: deckId + '/' + name, deckId, name, blob };
    try {
      const db = await open();
      await tx(db, 'readwrite', st => st.put(rec));
    } catch { mem.set(rec.key, rec); }
  }
}

export async function getByDeck(deckId) {
  try {
    const db = await open();
    return await new Promise((res, rej) => {
      const rq = db.transaction(STORE).objectStore(STORE).index('deck').getAll(deckId);
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
  } catch {
    return [...mem.values()].filter(r => r.deckId === deckId);
  }
}

export async function deleteDeck(deckId) {
  const recs = await getByDeck(deckId);
  try {
    const db = await open();
    await tx(db, 'readwrite', st => { for (const r of recs) st.delete(r.key); });
  } catch { /* mem ниже */ }
  for (const k of [...mem.keys()]) if (k.startsWith(deckId + '/')) mem.delete(k);
}

export async function clearAll() {
  try { const db = await open(); await tx(db, 'readwrite', st => st.clear()); } catch { /* ok */ }
  mem.clear();
}