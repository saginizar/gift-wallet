// Sync engine: pushes local changes to the household backend (a Google Apps Script web
// app on the owner's Google account) and pulls changes made on other devices.
//
// Protocol (POST, JSON body sent as text/plain to avoid a CORS preflight):
//   hello     { claim }            -> { claimed, maxSeq }   first device claims an empty backend
//   push      { records }          -> { results: [{ id, applied, seq } | { id, stale, current }] }
//   pull      { since, limit }     -> { records: [{ id, seq, ts, dev, blob }], maxSeq, more }
//   putImage / getImage / deleteImage { id, data }
//   reminders { enabled, emails, leadDays, items, appUrl } and testReminder
// Undecryptable rows (another key wrote them) are skipped on pull and overwritten on push.
// Every request carries the auth token derived from the household key; record payloads
// are AES-GCM ciphertext. The backend compares (ts, dev) to keep the newest version.

import { deriveKeys, encryptJSON, decryptJSON, encryptBytes, decryptBytes, randomKey, encodeText, decodeText } from './crypto.js';
import { stripLocal } from './store.js';
import { buildReminderItems } from './reminders.js';
import { normalizeText } from './catalog.js';

const CODE_PREFIX = 'GW1.';
const PUSH_BATCH = 100;

export class SyncError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

export const SYNC_MESSAGES = {
  offline: 'אין חיבור לאינטרנט. השינויים נשמרו במכשיר ויסונכרנו כשהחיבור יחזור.',
  unreachable: 'לא הצלחנו להגיע לשרת הסנכרון. ננסה שוב בקרוב.',
  unauthorized: 'מפתח הסנכרון לא מתאים לשרת. צריך לחבר את המכשיר מחדש.',
  unclaimed: 'השרת עדיין לא הוגדר. קודם מחברים את המכשיר הראשון בהגדרות > סנכרון.',
  bad_response: 'השרת החזיר תשובה לא צפויה. בדקו שבפריסה בחרתם Who has access: Anyone, ושהכתובת נגמרת במילה exec.',
  invalid_code: 'קוד הצירוף לא תקין. העתיקו אותו שוב מהמכשיר המחובר.',
  invalid_url: 'הכתובת לא תקינה. צריך להעתיק את הכתובת שמתחת ל-Web app URL, זו שנגמרת במילה exec.',
  already_claimed: 'הגיליון הזה כבר משויך לארנק אחר. כדי להצטרף אליו צריך קוד צירוף ממכשיר מחובר.',
  decrypt_failed: 'לא הצלחנו לפענח את הנתונים מהשרת. ייתכן שהמפתח שגוי.',
  server_error: 'שגיאה בשרת הסנכרון.',
  not_found: 'הקובץ לא נמצא בשרת.',
};

export function syncMessage(err) {
  return SYNC_MESSAGES[err?.code] || SYNC_MESSAGES.server_error;
}

export function isValidBackendUrl(url) {
  const s = String(url || '').trim();
  return /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/\s]+|macros)\/s\/[\w-]+\/exec$/.test(s)
    || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[\w/-]*$/.test(s);
}

export function makePairingCode(url, key) {
  return CODE_PREFIX + encodeText(JSON.stringify({ u: url, k: key }));
}

// Accepts the bare code, or any text/link that contains it.
export function parsePairingCode(text) {
  const m = String(text || '').match(/GW1\.[A-Za-z0-9_-]{20,}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(decodeText(m[0].slice(CODE_PREFIX.length)));
    if (isValidBackendUrl(obj.u) && typeof obj.k === 'string' && obj.k.length === 43) return { url: obj.u, key: obj.k };
  } catch { /* fall through */ }
  return null;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const chunks = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

export function createSync({ store, fetchImpl = (...a) => fetch(...a), isOnline = () => true, now = () => Date.now(), appUrl = '' }) {
  const keyCache = new Map();
  let running = null;
  let rerun = false;
  let switching = false;
  let timer = null;
  let state = { status: 'off', lastSyncAt: null, error: null };
  const listeners = new Set();
  const photoFetches = new Map();

  const config = () => store.kv.sync || null;
  const configured = () => !!config()?.url;

  function setState(patch) {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn(state);
  }

  async function keysOf(key) {
    if (!keyCache.has(key)) keyCache.set(key, await deriveKeys(key));
    return keyCache.get(key);
  }

  // Everything one cycle needs, fixed when it starts: a connection change can never
  // mix the old key or URL into requests that are already under way.
  async function connection(cfg) {
    const k = await keysOf(cfg.key);
    return { url: cfg.url, auth: k.auth, encKey: k.encKey };
  }

  async function post(url, body) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ v: 1, ...body }),
        redirect: 'follow',
        cache: 'no-store',
      });
    } catch (e) {
      throw new SyncError(isOnline() ? 'unreachable' : 'offline', e?.message);
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SyncError('bad_response', `HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    if (!data || data.ok !== true) throw new SyncError(data?.error || 'server_error', data?.message);
    return data;
  }

  const call = (conn, action, params = {}) => post(conn.url, { action, auth: conn.auth, ...params });

  // Rows that do not decrypt (written with another key) are reported, not fatal, so one
  // bad row cannot stop sync for good.
  async function decryptRows(conn, rows) {
    const records = [];
    const failed = [];
    for (const row of rows) {
      try {
        const rec = await decryptJSON(conn.encKey, row.blob, row.id);
        if (rec && rec.id === row.id) records.push(rec);
        else failed.push(row);
      } catch {
        failed.push(row);
      }
    }
    if (failed.length && typeof console !== 'undefined') console.warn(`sync: ${failed.length} record(s) could not be decrypted`);
    return { records, failed };
  }

  async function push(conn) {
    for (const batch of chunks(store.dirtyRecords(), PUSH_BATCH)) {
      const payload = [];
      for (const r of batch) {
        payload.push({ id: r.id, ts: r.updatedAt, dev: r.dev || '', blob: await encryptJSON(conn.encKey, stripLocal(r), r.id) });
      }
      const res = await call(conn, 'push', { records: payload });
      const synced = [];
      const newer = [];
      for (const result of res.results || []) {
        const sent = batch.find((b) => b.id === result.id);
        if (!sent) continue;
        if (result.applied) synced.push({ id: sent.id, updatedAt: sent.updatedAt });
        else if (result.current) newer.push({ id: result.id, ...result.current });
      }
      await store.markSynced(synced);
      if (newer.length) {
        const { records, failed } = await decryptRows(conn, newer);
        await store.applyRemote(records);
        // The server's copy is unreadable: overwrite it with ours on the next round.
        for (const row of failed) await store.restamp(row.id, row.ts);
      }
    }
  }

  async function pull(conn, since, onPage) {
    for (let guard = 0; guard < 200; guard++) {
      const res = await call(conn, 'pull', { since, limit: 500 });
      if (res.records?.length) await store.applyRemote((await decryptRows(conn, res.records)).records);
      since = Number(res.maxSeq) || since;
      await onPage(since);
      if (!res.more) break;
    }
    await store.gcPhotos();
    return since;
  }

  async function pushPhotos(conn) {
    for (const id of [...(store.kv.imgUpload || [])]) {
      const img = await store.getPhoto(id);
      if (img) {
        const data = await encryptBytes(conn.encKey, new Uint8Array(img.bytes), `img:${id}`);
        await call(conn, 'putImage', { id, data });
      }
      await store.setKV('imgUpload', (store.kv.imgUpload || []).filter((x) => x !== id));
    }
    for (const id of [...(store.kv.imgDelete || [])]) {
      await call(conn, 'deleteImage', { id });
      await store.setKV('imgDelete', (store.kv.imgDelete || []).filter((x) => x !== id));
    }
  }

  // Reminder settings are shared by the household, so whichever phone syncs keeps the
  // emailed list current. The hash is per device and only avoids re-sending the same list.
  async function pushReminders(conn) {
    const rem = store.householdSetting('reminders');
    const enabled = !!(rem?.enabled && rem.emails?.length);
    const payload = enabled
      ? { enabled: true, emails: rem.emails, leadDays: store.reminderDays(), items: buildReminderItems(store.views(), store.snapshot().members), appUrl }
      : { enabled: false, emails: [], leadDays: [], items: [], appUrl };
    const hash = fnv1a(JSON.stringify(payload));
    const last = store.kv.remindersHash;
    if (hash === last || (!enabled && !last)) return;
    await call(conn, 'reminders', payload);
    await store.setKV('remindersHash', hash);
  }

  async function cycle() {
    const cfg = config();
    const conn = await connection(cfg);
    await push(conn);
    await pull(conn, cfg.lastSeq || 0, (seq) => store.setKV('sync', { ...config(), lastSeq: seq }));
    // Merging may have re-queued records (a tombstone that must win, a row to repair).
    if (store.dirtyRecords().length) await push(conn);
    await pushPhotos(conn);
    await pushReminders(conn);
  }

  function syncNow() {
    if (!configured() || switching) return Promise.resolve(false);
    if (running) {
      rerun = true;
      return running;
    }
    clearTimeout(timer);
    running = (async () => {
      setState({ status: 'syncing' });
      try {
        do {
          rerun = false;
          await cycle();
        } while (rerun);
        await store.setKV('sync', { ...config(), lastSyncAt: now() });
        setState({ status: 'idle', lastSyncAt: now(), error: null });
        return true;
      } catch (e) {
        const err = e instanceof SyncError ? e : new SyncError('server_error', e?.message);
        setState({ status: err.code === 'offline' ? 'offline' : 'error', error: err });
        if (err.code !== 'unauthorized') schedule(30000);
        return false;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function schedule(delay = 1500) {
    if (!configured()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { syncNow(); }, delay);
  }

  // Waits for a cycle in progress and blocks new ones while the connection changes.
  async function exclusive(fn) {
    switching = true;
    clearTimeout(timer);
    try {
      while (running) await running.catch(() => {});
      return await fn();
    } finally {
      switching = false;
    }
  }

  // Members created on this device before it joined a household are folded into the
  // household's member with the same name, so "דנה" does not show up twice.
  async function foldDuplicateMembers(localIds) {
    const members = store.snapshot().members;
    const remote = members.filter((m) => !localIds.has(m.id));
    for (const local of members.filter((m) => localIds.has(m.id))) {
      const twin = remote.find((r) => normalizeText(r.name) === normalizeText(local.name));
      if (twin) await store.remapMember(local.id, twin.id);
    }
  }

  async function hello(url, key, claim) {
    const k = await keysOf(key);
    try {
      return await post(url, { action: 'hello', auth: k.auth, claim });
    } catch (e) {
      if (claim && e.code === 'unauthorized') throw new SyncError('already_claimed');
      throw e;
    }
  }

  return {
    get state() { return state; },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    configured,
    syncNow,
    schedule,

    // First device: claims an empty backend with a fresh household key. The key is kept
    // until the claim is confirmed, so a retry after a lost response reuses it instead of
    // finding the sheet claimed by a key nobody has.
    async connectNew(url) {
      const clean = String(url || '').trim();
      if (!isValidBackendUrl(clean)) throw new SyncError('invalid_url');
      await exclusive(async () => {
        const pending = store.kv.pendingClaim;
        const key = pending?.url === clean ? pending.key : randomKey();
        await store.setKV('pendingClaim', { url: clean, key });
        await hello(clean, key, true);
        await store.setKV('sync', { url: clean, key, lastSeq: 0, connectedAt: now() });
        await store.setKV('pendingClaim', null);
        await store.setKV('remindersHash', null);
        await store.markAllDirty();
        setState({ status: 'idle', error: null });
      });
      await syncNow();
      if (state.status === 'error') throw state.error;
    },

    // Another device: joins with the pairing code shown on a connected device. The
    // connection is saved only once the household's data has been downloaded.
    async join(codeText) {
      const parsed = parsePairingCode(codeText);
      if (!parsed) throw new SyncError('invalid_code');
      await exclusive(async () => {
        await hello(parsed.url, parsed.key, false);
        const localIds = new Set(store.exportRecords().map((r) => r.id));
        const localMembers = new Set(store.snapshot().members.map((m) => m.id));
        setState({ status: 'syncing', error: null });
        try {
          const cfg = { url: parsed.url, key: parsed.key, lastSeq: 0, connectedAt: now() };
          const lastSeq = await pull(await connection(cfg), 0, async () => {});
          await foldDuplicateMembers(localMembers);
          if (localIds.size) await store.markDirtyIds(localIds);
          await store.setKV('remindersHash', null);
          await store.setKV('sync', { ...cfg, lastSeq });
          setState({ status: 'idle' });
        } catch (e) {
          setState({ status: 'off', error: null });
          throw e;
        }
      });
      await syncNow();
      if (state.status === 'error') throw state.error;
    },

    pairingCode() {
      const cfg = config();
      return cfg ? makePairingCode(cfg.url, cfg.key) : null;
    },

    async disconnect() {
      await exclusive(async () => {
        await store.setKV('sync', null);
        await store.setKV('remindersHash', null);
        setState({ status: 'off', error: null, lastSyncAt: null });
      });
    },

    // True while something made on this device has not reached the backend yet.
    hasUnsynced() {
      return store.dirtyRecords().length > 0 || (store.kv.imgUpload || []).length > 0 || (store.kv.imgDelete || []).length > 0;
    },

    // Photo bytes are fetched lazily the first time a card's photo is shown here.
    async fetchPhoto(id) {
      const local = await store.getPhoto(id);
      if (local) return local;
      if (!configured()) return null;
      if (!photoFetches.has(id)) {
        photoFetches.set(id, (async () => {
          try {
            const conn = await connection(config());
            const res = await call(conn, 'getImage', { id });
            const bytes = await decryptBytes(conn.encKey, res.data, `img:${id}`);
            const img = { id, mime: 'image/jpeg', bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), createdAt: now() };
            await store.putRemotePhoto(img);
            return img;
          } catch {
            return null;
          } finally {
            photoFetches.delete(id);
          }
        })());
      }
      return photoFetches.get(id);
    },

    async testReminder() {
      return call(await connection(config()), 'testReminder', { appUrl });
    },
  };
}
