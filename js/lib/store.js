// In-memory state backed by a persistence adapter (IndexedDB in the app).
//
// Every synced record shares one envelope:
//   { id, kind: 'card'|'tx'|'event'|'member'|'setting', createdAt, updatedAt, dev, by, deleted }
// `updatedAt` only moves forward for a record and, with `dev` (device id) as a tie
// breaker, decides last-write-wins between devices. Local edits set `_dirty` until the
// sync engine confirms the backend has them; fields starting with "_" never leave the device.

import { uid } from './ids.js';
import { round2 } from './money.js';
import { todayISO } from './dates.js';
import { PALETTE } from './catalog.js';
import { CARD_FIELDS, DEFAULT_SOON_DAYS, buildViews, cleanCard, computeView } from './model.js';

// Device-only preferences. Household-wide ones (email reminders) are synced 'setting' records.
export const DEFAULT_SETTINGS = { soonDays: DEFAULT_SOON_DAYS, sort: 'expiry' };
export const DEFAULT_REMINDER_DAYS = [30, 7, 1];

export function compareVersion(a, b) {
  if ((a.updatedAt || 0) !== (b.updatedAt || 0)) return (a.updatedAt || 0) - (b.updatedAt || 0);
  const da = String(a.dev || ''), db = String(b.dev || '');
  return da < db ? -1 : da > db ? 1 : 0;
}

export function stripLocal(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function createStore({ storage, now = () => Date.now(), today = () => todayISO() }) {
  const records = new Map();
  const listeners = new Set();
  let kv = {};
  let version = 0;
  let snap = null;
  let viewCache = null;

  function emit(local) {
    version++;
    snap = null;
    viewCache = null;
    for (const fn of [...listeners]) fn({ local });
  }

  async function persist(list) {
    for (const r of list) records.set(r.id, r);
    await storage.putRecords(list);
  }

  async function setKV(key, value) {
    kv = { ...kv, [key]: value };
    await storage.putKV(key, value);
    emit(false);
  }

  const me = () => kv.me || null;

  // Next timestamp for a record: wall clock, but never at or before its previous version.
  const stamp = (prev) => Math.max(now(), (prev?.updatedAt || 0) + 1);

  function make(kind, fields) {
    const t = now();
    return { id: uid(), kind, createdAt: t, updatedAt: t, dev: kv.deviceId, by: me(), deleted: false, ...fields, _dirty: true };
  }

  function revise(prev, fields) {
    return { ...prev, ...fields, updatedAt: stamp(prev), dev: kv.deviceId, updatedBy: me(), _dirty: true };
  }

  function logEvent(action, fields) {
    return make('event', { at: now(), action, ...fields });
  }

  const cardEventFields = (card) => ({ cardId: card.id, store: card.store, cardType: card.type, currency: card.currency });

  function getCard(id) {
    const c = records.get(id);
    if (!c || c.kind !== 'card') throw new Error('card_not_found');
    return c;
  }

  function cardTxs(cardId) {
    return [...records.values()].filter((r) => r.kind === 'tx' && r.cardId === cardId);
  }

  function viewOf(cardId) {
    return computeView(getCard(cardId), cardTxs(cardId), today(), settings().soonDays);
  }

  function settings() {
    return { ...DEFAULT_SETTINGS, ...(kv.settings || {}) };
  }

  function tombstone(card, updatedAt) {
    return {
      id: card.id, kind: 'card', createdAt: card.createdAt, updatedAt, dev: kv.deviceId,
      by: card.by, deleted: true, purged: true, store: card.store, type: card.type, _dirty: true,
    };
  }

  // Photo ids still in use: any card that is not purged (cards in the bin keep theirs).
  function referencedPhotos() {
    const ids = new Set();
    for (const r of records.values()) if (r.kind === 'card' && !r.purged) for (const p of r.photos || []) ids.add(p);
    return ids;
  }

  async function commit(list) {
    await persist(list);
    emit(true);
  }

  const api = {
    async load() {
      const data = await storage.loadAll();
      records.clear();
      for (const r of data.records) records.set(r.id, r);
      kv = data.kv || {};
      if (!kv.deviceId) {
        kv.deviceId = uid();
        await storage.putKV('deviceId', kv.deviceId);
      }
      emit(false);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    get version() { return version; },

    snapshot() {
      if (snap) return snap;
      const cards = [], txs = [], events = [], members = [];
      const household = {};
      for (const r of records.values()) {
        if (r.kind === 'card') cards.push(r);
        else if (r.kind === 'tx') txs.push(r);
        else if (r.kind === 'event') events.push(r);
        else if (r.kind === 'member') members.push(r);
        else if (r.kind === 'setting' && !r.deleted) household[r.key] = r.value;
      }
      events.sort((a, b) => (b.at || 0) - (a.at || 0));
      members.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      snap = { version, cards, txs, events, members: members.filter((m) => !m.deleted), allMembers: members, household, kv, settings: settings() };
      return snap;
    },

    views() {
      const t = today();
      const s = settings();
      if (viewCache && viewCache.today === t && viewCache.soonDays === s.soonDays && viewCache.version === version) return viewCache.views;
      const { cards, txs } = api.snapshot();
      const views = buildViews(cards, txs, t, s.soonDays);
      viewCache = { today: t, soonDays: s.soonDays, version, views };
      return views;
    },

    view(cardId) {
      return api.views().find((v) => v.id === cardId) || null;
    },

    get kv() { return kv; },
    settings,
    setKV,
    async updateSettings(patch) { await setKV('settings', { ...settings(), ...patch }); },
    me,
    async setMe(memberId) { await setKV('me', memberId); },

    // Settings shared by the whole household (synced like any other record).
    householdSetting(key) {
      return api.snapshot().household[key];
    },
    async setHouseholdSetting(key, value) {
      const id = `setting-${key}`;
      const prev = records.get(id);
      if (prev && same(prev.value, value)) return;
      const next = prev ? revise(prev, { value, deleted: false }) : { ...make('setting', { key, value }), id };
      await commit([next]);
    },
    reminderDays() {
      const days = api.householdSetting('reminders')?.days;
      return Array.isArray(days) && days.length ? days : DEFAULT_REMINDER_DAYS;
    },

    // Cards

    async createCard(data) {
      const fields = cleanCard(data);
      const card = make('card', { ...fields, archived: false });
      const out = [card];
      const opening = data.openingBalance;
      let balanceAfter = fields.initialAmount;
      if (opening != null && opening !== '' && fields.initialAmount != null && round2(opening) !== fields.initialAmount) {
        const delta = round2(opening - fields.initialAmount);
        balanceAfter = round2(opening);
        out.push(make('tx', { cardId: card.id, type: 'adjust', target: balanceAfter, delta, amount: Math.abs(delta), date: today(), note: 'יתרה בעת ההוספה' }));
      }
      out.push(logEvent('card.create', { ...cardEventFields(card), amount: fields.initialAmount, balanceAfter }));
      await commit(out);
      return card;
    },

    async updateCard(id, patch) {
      const prev = getCard(id);
      const fields = cleanCard({ ...prev, ...patch });
      const changed = CARD_FIELDS.filter((f) => !same(prev[f], fields[f]));
      if (!changed.length) return prev;
      const next = revise(prev, fields);
      await commit([next, logEvent('card.update', { ...cardEventFields(next), fields: changed })]);
      return next;
    },

    async setArchived(id, archived) {
      const prev = getCard(id);
      if (!!prev.archived === !!archived) return prev;
      const next = revise(prev, { archived: !!archived });
      await commit([next, logEvent(archived ? 'card.archive' : 'card.unarchive', cardEventFields(next))]);
      return next;
    },

    async deleteCard(id) {
      const prev = getCard(id);
      if (prev.deleted) return prev;
      const next = revise(prev, { deleted: true, deletedAt: now() });
      await commit([next, logEvent('card.delete', cardEventFields(next))]);
      return next;
    },

    async restoreCard(id) {
      const prev = getCard(id);
      if (!prev.deleted || prev.purged) return prev;
      const next = revise(prev, { deleted: false, deletedAt: null });
      await commit([next, logEvent('card.restore', cardEventFields(next))]);
      return next;
    },

    // Permanently removes a deleted card's contents. A tombstone stays so other
    // devices learn about it, and it wins over a concurrent edit or restore (see
    // applyRemote). Purchases are kept but their notes are blanked, as are the notes in
    // the activity log, which keeps only the store name.
    async purgeCards(ids) {
      const out = [];
      const photoIds = [];
      let purged = 0;
      for (const id of ids) {
        const prev = records.get(id);
        if (!prev || prev.kind !== 'card' || !prev.deleted || prev.purged) continue;
        photoIds.push(...(prev.photos || []));
        out.push(tombstone(prev, stamp(prev)));
        for (const r of records.values()) {
          if ((r.kind === 'tx' || r.kind === 'event') && r.cardId === id && r.note) out.push(revise(r, { note: '' }));
        }
        purged++;
      }
      if (!out.length) return 0;
      await commit(out);
      for (const pid of photoIds) await api.forgetPhoto(pid);
      return purged;
    },

    // Ledger

    async addTx(cardId, { type, amount, balance, date, note }) {
      const card = getCard(cardId);
      const view = viewOf(cardId);
      let delta;
      let amt = amount == null ? null : round2(amount);
      if (type === 'use') delta = -amt;
      else if (type === 'load') delta = amt;
      else if (type === 'adjust') {
        delta = round2(balance - (view.balance ?? 0));
        amt = Math.abs(delta);
      } else if (type !== 'redeem') throw new Error('bad_tx_type');
      const balanceAfter = view.balance != null && typeof delta === 'number' ? round2(view.balance + delta) : view.balance;
      const tx = make('tx', { cardId, type, amount: amt, date: date || today(), note: String(note || '').trim().slice(0, 200) });
      if (typeof delta === 'number') tx.delta = delta;
      // A correction records the balance it sets, so two phones correcting to the same
      // number at once end up there instead of applying the difference twice.
      if (type === 'adjust') tx.target = round2(balance);
      await commit([tx, logEvent(`tx.${type}`, { ...cardEventFields(card), txId: tx.id, amount: amt, balanceAfter, note: tx.note })]);
      return tx;
    },

    async deleteTx(txId) {
      const prev = records.get(txId);
      if (!prev || prev.kind !== 'tx' || prev.deleted) return null;
      const card = getCard(prev.cardId);
      const next = revise(prev, { deleted: true });
      await commit([next, logEvent('tx.delete', { ...cardEventFields(card), txId, txType: prev.type, amount: prev.amount })]);
      return next;
    },

    // Household members

    async addMember(name) {
      const clean = String(name || '').trim().slice(0, 30);
      if (!clean) throw new Error('empty_name');
      const count = api.snapshot().allMembers.length;
      const member = make('member', { name: clean, color: PALETTE[(count * 5) % PALETTE.length] });
      await commit([member, logEvent('member.add', { memberId: member.id, memberName: clean })]);
      return member;
    },

    async renameMember(id, name) {
      const prev = records.get(id);
      const clean = String(name || '').trim().slice(0, 30);
      if (!prev || prev.kind !== 'member' || !clean || clean === prev.name) return prev;
      const next = revise(prev, { name: clean });
      await commit([next, logEvent('member.rename', { memberId: id, memberName: clean, previousName: prev.name })]);
      return next;
    },

    // Photos. Bytes live in their own object store and sync separately.

    async addPhoto(cardId, bytes, mime = 'image/jpeg') {
      const card = getCard(cardId);
      const id = uid();
      await storage.putImage({ id, cardId, mime, bytes, createdAt: now() });
      await setKV('imgUpload', [...(kv.imgUpload || []), id]);
      await api.updateCard(cardId, { photos: [...(card.photos || []), id] });
      return id;
    },

    async removePhoto(cardId, photoId) {
      const card = getCard(cardId);
      await api.updateCard(cardId, { photos: (card.photos || []).filter((p) => p !== photoId) });
      await api.forgetPhoto(photoId);
    },

    async forgetPhoto(photoId) {
      await storage.deleteImage(photoId);
      const wasQueued = (kv.imgUpload || []).includes(photoId);
      await setKV('imgUpload', (kv.imgUpload || []).filter((p) => p !== photoId));
      if (!wasQueued) await setKV('imgDelete', [...new Set([...(kv.imgDelete || []), photoId])]);
    },

    getPhoto: (id) => storage.getImage(id),
    putRemotePhoto: (img) => storage.putImage(img),
    allPhotos: () => storage.allImages(),
    referencedPhotos,

    // Drops cached photos that no card uses any more, e.g. after the other phone removed
    // a photo or emptied the bin, so they do not linger here or end up in backups.
    async gcPhotos() {
      const used = referencedPhotos();
      let removed = 0;
      for (const img of await storage.allImages()) {
        if (!used.has(img.id)) {
          await storage.deleteImage(img.id);
          removed++;
        }
      }
      const queue = (kv.imgUpload || []).filter((p) => used.has(p));
      if (queue.length !== (kv.imgUpload || []).length) await setKV('imgUpload', queue);
      return removed;
    },

    // Sync support

    dirtyRecords() {
      return [...records.values()].filter((r) => r._dirty);
    },

    async markSynced(list) {
      const out = [];
      for (const { id, updatedAt } of list) {
        const r = records.get(id);
        if (r && r._dirty && r.updatedAt === updatedAt) out.push({ ...r, _dirty: false });
      }
      if (out.length) await persist(out);
      return out.length;
    },

    // Last-write-wins merge of records that came from another device or a backup.
    // `markDirty` is used for imports so the merged result is pushed on the next sync.
    async applyRemote(list, { markDirty = false } = {}) {
      const out = [];
      for (const raw of list) {
        if (!raw || typeof raw.id !== 'string' || !raw.kind) continue;
        const local = records.get(raw.id);
        if (local?.purged && !raw.purged) {
          // Emptying the bin wins over an edit or restore made elsewhere at the same
          // time: keep the tombstone and push it again with a newer stamp.
          out.push(tombstone(local, Math.max(now(), (raw.updatedAt || 0) + 1)));
          continue;
        }
        if (local && compareVersion(local, raw) > 0) continue;
        if (local && !markDirty && compareVersion(local, raw) === 0 && !local._dirty) continue;
        out.push({ ...stripLocal(raw), _dirty: markDirty });
      }
      if (out.length) {
        await persist(out);
        emit(false);
      }
      return out.length;
    },

    // The backend holds a version of this record that cannot be decrypted (written with
    // another key). Re-stamp ours past it so the next push replaces it.
    async restamp(id, pastTs) {
      const r = records.get(id);
      if (!r) return;
      await persist([{ ...r, updatedAt: Math.max(now(), (pastTs || 0) + 1, (r.updatedAt || 0) + 1), dev: kv.deviceId, _dirty: true }]);
    },

    async markAllDirty() {
      return api.markDirtyIds([...records.keys()]);
    },

    async markDirtyIds(ids) {
      const out = [];
      for (const id of ids) {
        const r = records.get(id);
        if (r && !r._dirty) out.push({ ...r, _dirty: true });
      }
      if (out.length) await persist(out);
      await api.gcPhotos();
      const photos = (await storage.allImages()).map((i) => i.id);
      await setKV('imgUpload', [...new Set([...(kv.imgUpload || []), ...photos])]);
    },

    // Points references at another member and retires the old one. Used when a device
    // joins a household and its own local member duplicates an existing one.
    async remapMember(fromId, toId) {
      const out = [];
      for (const r of records.values()) {
        let next = null;
        for (const f of ['owner', 'by', 'updatedBy', 'memberId']) {
          if (r[f] === fromId) {
            next = next || { ...r };
            next[f] = toId;
          }
        }
        if (next) out.push(next);
      }
      const member = records.get(fromId);
      if (member) out.push({ ...member, deleted: true, updatedAt: stamp(member), _dirty: true });
      if (out.length) await persist(out);
      if (kv.me === fromId) await setKV('me', toId);
      emit(false);
    },

    exportRecords() {
      return [...records.values()].map(stripLocal);
    },

    async wipe() {
      await storage.clear();
      records.clear();
      kv = {};
      await api.load();
    },
  };

  return api;
}
