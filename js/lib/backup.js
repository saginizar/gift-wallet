// Backup file (JSON, optionally with photos) and Excel-friendly CSV export.

import { TYPES, STATUS_LABELS, memberName } from './model.js';
import { formatDate, todayISO } from './dates.js';
import { b64urlEncode, b64urlDecode } from './crypto.js';

export const BACKUP_APP = 'gift-wallet';
export const BACKUP_VERSION = 1;

export async function buildBackup(store, { includePhotos = true, now = Date.now() } = {}) {
  const backup = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    records: store.exportRecords(),
    photos: [],
  };
  if (includePhotos) {
    const used = store.referencedPhotos();
    for (const img of await store.allPhotos()) {
      if (!used.has(img.id)) continue;
      backup.photos.push({ id: img.id, cardId: img.cardId, mime: img.mime, data: b64urlEncode(new Uint8Array(img.bytes)) });
    }
  }
  return backup;
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('הקובץ אינו קובץ גיבוי תקין');
  }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.records)) throw new Error('הקובץ אינו גיבוי של ארנק המתנות');
  if (data.version > BACKUP_VERSION) throw new Error('הגיבוי נוצר בגרסה חדשה יותר של האפליקציה');
  return data;
}

// Merges a backup into the wallet with the same newest-wins rule sync uses, so restoring
// an old backup never overwrites newer changes.
export async function restoreBackup(store, data) {
  const merged = await store.applyRemote(data.records, { markDirty: true });
  let photos = 0;
  const queue = new Set(store.kv.imgUpload || []);
  for (const p of data.photos || []) {
    if (await store.getPhoto(p.id)) continue;
    const bytes = b64urlDecode(p.data);
    await store.putRemotePhoto({ id: p.id, cardId: p.cardId, mime: p.mime || 'image/jpeg', bytes: bytes.buffer, createdAt: Date.now() });
    queue.add(p.id);
    photos++;
  }
  await store.setKV('imgUpload', [...queue]);
  return { merged, photos };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  // Leading = + - @ would be run as a formula by Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCSV(views, members) {
  const header = ['סוג', 'חנות', 'כותרת', 'סכום מקורי', 'יתרה', 'מטבע', 'תוקף', 'סטטוס', 'קוד', 'קוד סודי', 'שייך ל', 'איפה אפשר לממש', 'הערות', 'קישור', 'נוסף בתאריך'];
  const rows = views
    .filter((v) => v.status !== 'deleted')
    .map((v) => [
      TYPES[v.card.type]?.label,
      v.card.store,
      v.card.title,
      v.card.initialAmount,
      v.balance,
      v.card.currency,
      formatDate(v.card.expiry),
      STATUS_LABELS[v.status],
      v.card.code,
      v.card.pin,
      memberName(members, v.card.owner),
      v.card.usableAt,
      v.card.notes,
      v.card.link,
      v.card.createdAt ? formatDate(todayISO(new Date(v.card.createdAt))) : '',
    ]);
  // BOM so Excel opens the Hebrew text as UTF-8.
  return String.fromCharCode(0xfeff) + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function backupFileName(ext, now = new Date()) {
  return `gift-wallet-${todayISO(now)}.${ext}`;
}
