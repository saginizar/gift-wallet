// The data model: card types, derived balance/status, filtering, sorting and totals.
// Everything here is pure so it can be unit tested without a browser.
//
// A card's balance is never stored. It is the card's initial amount, moved by the
// signed `delta` of every live transaction in date order (a correction sets it to its
// `target` instead), so two phones recording purchases offline still add up correctly
// after they sync.

import { daysBetween, yearOf } from './dates.js';
import { round2 } from './money.js';
import { normalizeText, storeSearchText } from './catalog.js';

export const TYPES = {
  giftcard: { label: 'כרטיס מתנה', plural: 'כרטיסי מתנה', amountRequired: true },
  credit: { label: 'זיכוי', plural: 'זיכויים', amountRequired: true },
  voucher: { label: 'שובר', plural: 'שוברים', amountRequired: false },
  coupon: { label: 'קופון', plural: 'קופונים', amountRequired: false },
};
export const TYPE_ORDER = ['giftcard', 'credit', 'voucher', 'coupon'];

export const STATUS_LABELS = {
  active: 'פעיל',
  expiring: 'פג בקרוב',
  expired: 'פג תוקף',
  used: 'נוצל',
  archived: 'בארכיון',
  deleted: 'נמחק',
};

export const DEFAULT_SOON_DAYS = 30;
export const URGENT_DAYS = 7;
export const SHARED_OWNER = 'shared';

// Fields a card carries besides the sync envelope (id, kind, timestamps, flags).
export const CARD_FIELDS = [
  'type', 'store', 'title', 'initialAmount', 'currency', 'expiry', 'code', 'pin',
  'barcode', 'barcodeType', 'link', 'usableAt', 'owner', 'notes', 'receivedAt',
  'discount', 'color', 'photos',
];

export const FIELD_LABELS = {
  type: 'סוג', store: 'חנות', title: 'כותרת', initialAmount: 'סכום', currency: 'מטבע',
  expiry: 'תוקף', code: 'קוד', pin: 'קוד סודי', barcode: 'ברקוד', barcodeType: 'סוג ברקוד',
  link: 'קישור', usableAt: 'איפה אפשר לממש', owner: 'שייך ל', notes: 'הערות',
  receivedAt: 'תאריך קבלה', discount: 'הטבה', color: 'צבע', photos: 'תמונות',
};

export const LIMITS = { store: 60, title: 80, code: 120, pin: 40, barcode: 200, link: 2000, usableAt: 500, notes: 2000, discount: 120, amount: 1000000 };

export function safeLink(url) {
  const s = String(url || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);

// Normalises raw form or imported data into the stored card shape.
export function cleanCard(data) {
  const type = TYPES[data.type] ? data.type : 'giftcard';
  const amount = data.initialAmount === '' || data.initialAmount == null ? null : round2(data.initialAmount);
  return {
    type,
    store: str(data.store, LIMITS.store),
    title: str(data.title, LIMITS.title),
    initialAmount: Number.isFinite(amount) ? amount : null,
    currency: ['ILS', 'USD', 'EUR', 'GBP'].includes(data.currency) ? data.currency : 'ILS',
    expiry: /^\d{4}-\d{2}-\d{2}$/.test(data.expiry || '') ? data.expiry : null,
    code: str(data.code, LIMITS.code),
    pin: str(data.pin, LIMITS.pin),
    barcode: str(data.barcode, LIMITS.barcode),
    barcodeType: ['none', 'code128', 'qr'].includes(data.barcodeType) ? data.barcodeType : 'none',
    link: safeLink(data.link).slice(0, LIMITS.link),
    usableAt: str(data.usableAt, LIMITS.usableAt),
    owner: data.owner || SHARED_OWNER,
    notes: str(data.notes, LIMITS.notes),
    receivedAt: /^\d{4}-\d{2}-\d{2}$/.test(data.receivedAt || '') ? data.receivedAt : null,
    discount: str(data.discount, LIMITS.discount),
    color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : null,
    photos: Array.isArray(data.photos) ? data.photos.filter((p) => typeof p === 'string').slice(0, 10) : [],
  };
}

// Form validation. Returns a map of field -> Hebrew error message (empty when valid).
export function validateCard(data) {
  const errors = {};
  if (!String(data.store || '').trim()) errors.store = 'צריך לבחור חנות או מנפיק';
  const required = TYPES[data.type]?.amountRequired;
  const amount = data.initialAmount;
  if (amount == null || amount === '') {
    if (required) errors.initialAmount = 'צריך להזין סכום';
  } else if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    errors.initialAmount = 'הסכום צריך להיות גדול מאפס';
  } else if (Number(amount) > LIMITS.amount) {
    errors.initialAmount = 'הסכום גבוה מדי';
  }
  if (data.openingBalance != null && data.openingBalance !== '') {
    const b = Number(data.openingBalance);
    if (!Number.isFinite(b) || b < 0) errors.openingBalance = 'יתרה לא תקינה';
    else if (Number.isFinite(Number(amount)) && b > Number(amount)) errors.openingBalance = 'היתרה גבוהה מהסכום המקורי';
  }
  if (data.link && !safeLink(data.link)) errors.link = 'קישור צריך להתחיל ב-https://';
  if (data.expiry && data.receivedAt && data.expiry < data.receivedAt) errors.expiry = 'התוקף מוקדם מתאריך הקבלה';
  return errors;
}

export const hasAmount = (card) => card.initialAmount != null;

const txOrder = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0));

// Derived view of one card: balance, status, days left, ledger with running balance.
export function computeView(card, txs = [], today, soonDays = DEFAULT_SOON_DAYS) {
  const live = txs.filter((t) => !t.deleted).sort(txOrder);
  let balance = hasAmount(card) ? card.initialAmount : null;
  let spent = 0;
  const ledger = live.map((t) => {
    if (balance != null) {
      // A correction sets the balance; everything else moves it by its delta.
      if (t.type === 'adjust' && typeof t.target === 'number') balance = round2(t.target);
      else if (typeof t.delta === 'number') balance = round2(balance + t.delta);
    }
    if (t.type === 'use' && typeof t.delta === 'number') spent = round2(spent - t.delta);
    return { tx: t, balanceAfter: balance };
  });
  const redeemed = live.some((t) => t.type === 'redeem');
  const daysLeft = card.expiry ? daysBetween(today, card.expiry) : null;

  let status;
  if (card.deleted) status = 'deleted';
  else if (card.archived) status = 'archived';
  else if (redeemed || (balance != null && balance <= 0)) status = 'used';
  else if (daysLeft != null && daysLeft < 0) status = 'expired';
  else if (daysLeft != null && daysLeft <= soonDays) status = 'expiring';
  else status = 'active';

  return {
    id: card.id,
    card,
    balance,
    spent,
    redeemed,
    daysLeft,
    status,
    urgent: status === 'expiring' && daysLeft <= URGENT_DAYS,
    ledger,
    searchText: normalizeText([
      card.store, storeSearchText(card.store), card.title, card.usableAt, card.notes,
      card.code, card.discount, TYPES[card.type]?.label,
    ].join(' ')),
  };
}

export function buildViews(cards, txs, today, soonDays = DEFAULT_SOON_DAYS) {
  const byCard = new Map();
  for (const t of txs) {
    if (!byCard.has(t.cardId)) byCard.set(t.cardId, []);
    byCard.get(t.cardId).push(t);
  }
  return cards.map((c) => computeView(c, byCard.get(c.id) || [], today, soonDays));
}

export const GROUPS = {
  active: (v) => v.status === 'active' || v.status === 'expiring',
  expiring: (v) => v.status === 'expiring',
  expired: (v) => v.status === 'expired',
  used: (v) => v.status === 'used',
  archived: (v) => v.status === 'archived',
  inactive: (v) => v.status === 'expired' || v.status === 'used' || v.status === 'archived',
  trash: (v) => v.status === 'deleted' && !v.card.purged,
  all: (v) => v.status !== 'deleted',
};

export function matchesQuery(view, query) {
  const terms = normalizeText(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const text = view.searchText;
  const compact = text.replace(/ /g, '');
  return terms.every((t) => text.includes(t) || compact.includes(t));
}

export function filterViews(views, { group = 'active', type = null, owner = null, query = '' } = {}) {
  const inGroup = GROUPS[group] || GROUPS.active;
  return views.filter((v) =>
    inGroup(v)
    && (!type || v.card.type === type)
    && (!owner || v.card.owner === owner)
    && matchesQuery(v, query));
}

const collator = new Intl.Collator('he');

export const SORTS = {
  expiry: { label: 'לפי תוקף', compare: (a, b) => nullsLast(a.daysLeft, b.daysLeft) || collator.compare(a.card.store, b.card.store) },
  balance: { label: 'לפי יתרה', compare: (a, b) => nullsLast(a.balance, b.balance, -1) || nullsLast(a.daysLeft, b.daysLeft) },
  recent: { label: 'נוספו לאחרונה', compare: (a, b) => (b.card.createdAt || 0) - (a.card.createdAt || 0) },
  store: { label: 'לפי חנות', compare: (a, b) => collator.compare(a.card.store, b.card.store) || nullsLast(a.daysLeft, b.daysLeft) },
};

// Ascending (or descending with dir = -1) with missing values always at the end.
function nullsLast(a, b, dir = 1) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

export function sortViews(views, key = 'expiry') {
  return [...views].sort((SORTS[key] || SORTS.expiry).compare);
}

function addTo(totals, currency, amount) {
  const c = currency || 'ILS';
  totals[c] = round2((totals[c] || 0) + amount);
}

// Header numbers for the wallet screen.
export function summarize(views) {
  const totals = {};
  let activeCount = 0, expiringCount = 0, urgentCount = 0;
  const counts = { expired: 0, used: 0, archived: 0, trash: 0 };
  for (const v of views) {
    if (GROUPS.active(v)) {
      activeCount++;
      if (v.status === 'expiring') expiringCount++;
      if (v.urgent) urgentCount++;
      if (v.balance > 0) addTo(totals, v.card.currency, v.balance);
    } else if (v.status in counts) counts[v.status]++;
    else if (GROUPS.trash(v)) counts.trash++;
  }
  return { totals, activeCount, expiringCount, urgentCount, counts };
}

// Year-level numbers for the history screen.
export function insights(views, year) {
  const usedThisYear = {}, lostToExpiry = {}, addedThisYear = {};
  let usesCount = 0;
  const byStore = new Map();
  for (const v of views) {
    if (v.status === 'deleted') continue;
    const cur = v.card.currency;
    for (const { tx } of v.ledger) {
      if (tx.type === 'use' && typeof tx.delta === 'number' && yearOf(tx.date) === year) {
        addTo(usedThisYear, cur, -tx.delta);
        usesCount++;
        if (cur === 'ILS') byStore.set(v.card.store, round2((byStore.get(v.card.store) || 0) - tx.delta));
      }
    }
    if (v.status === 'expired' && v.balance > 0) addTo(lostToExpiry, cur, v.balance);
    if (v.card.createdAt && new Date(v.card.createdAt).getFullYear() === year && v.card.initialAmount) {
      addTo(addedThisYear, cur, v.card.initialAmount);
    }
  }
  const topStores = [...byStore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([store, amount]) => ({ store, amount }));
  return { usedThisYear, lostToExpiry, addedThisYear, usesCount, topStores };
}

// Stores already used in this wallet, most recent first, for autocomplete.
export function knownStores(cards) {
  return [...cards]
    .filter((c) => !c.deleted && c.store)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((c) => c.store);
}

export function memberName(members, id) {
  if (!id) return '';
  if (id === SHARED_OWNER) return 'משותף';
  return members.find((m) => m.id === id)?.name || 'לא ידוע';
}

export function cardTitle(card) {
  return card.title || TYPES[card.type]?.label || '';
}
