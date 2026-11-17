// Pulls card details out of a pasted SMS or email (BuyMe links, credit-note texts,
// coupon codes). Heuristic by nature: it pre-fills the form and the user confirms.

import { STORES, normalizeText } from './catalog.js';
import { parseAmount } from './money.js';
import { isISODate, todayISO } from './dates.js';

const CURRENCY_WORDS = [
  ['ILS', /(?:₪|ש"ח|ש״ח|שח|שקלים|שקל|nis|ils)/i],
  ['USD', /(?:\$|usd|דולר)/i],
  ['EUR', /(?:€|eur|יורו|אירו)/i],
];

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;

function findLink(text) {
  const m = text.match(/https?:\/\/[^\s<>"'״]+/i);
  return m ? m[0].replace(/[.,;:!?)\]}]+$/, '') : '';
}

function findAmount(text) {
  const candidates = [];
  for (const [currency, word] of CURRENCY_WORDS) {
    const w = word.source;
    for (const re of [new RegExp(`${w}\\s?${NUM}`, 'gi'), new RegExp(`${NUM}\\s?${w}`, 'gi')]) {
      for (const m of text.matchAll(re)) {
        const n = parseAmount(m[1]);
        if (n != null && n > 0) candidates.push({ amount: n, currency, index: m.index, strong: false });
      }
    }
  }
  const keyword = new RegExp(String.raw`(?:בסך|בשווי|על סך|בסכום|סכום|יתרה|יתרת|ערך|amount|value|balance)\s*(?:של|:)?\s*(?:₪|\$|€)?\s*${NUM}`, 'gi');
  for (const m of text.matchAll(keyword)) {
    const n = parseAmount(m[1]);
    if (n != null && n > 0) candidates.push({ amount: n, currency: null, index: m.index, strong: true });
  }
  if (!candidates.length) return null;
  // A number next to a currency sign beats a bare "בסך 200"; earlier mentions beat later ones.
  candidates.sort((a, b) => (b.currency ? 1 : 0) - (a.currency ? 1 : 0) || a.index - b.index);
  const best = candidates[0];
  return { amount: best.amount, currency: best.currency || 'ILS' };
}

function toISO(d, m, y) {
  let year = Number(y);
  if (year < 100) year += 2000;
  const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isISODate(iso) ? iso : null;
}

// No lookbehind in these patterns: Safari before 16.4 cannot even parse it, and a syntax
// error here would stop the whole app from loading. The leading group stands in for it.
function findDates(text) {
  const out = [];
  for (const m of text.matchAll(/(^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/g)) {
    const iso = toISO(m[2], m[3], m[4]);
    if (iso) out.push({ iso, index: m.index + m[1].length });
  }
  for (const m of text.matchAll(/(^|\D)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const iso = `${m[2]}-${m[3]}-${m[4]}`;
    if (isISODate(iso)) out.push({ iso, index: m.index + m[1].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

function findExpiry(text, today) {
  const dates = findDates(text);
  if (!dates.length) return null;
  const keyword = /(?:בתוקף עד|תוקף|תפוגה|יפוג|פג|ניתן לממש עד|למימוש עד|valid until|valid thru|expires?|expiry|exp\.?)/gi;
  for (const k of text.matchAll(keyword)) {
    const after = dates.find((d) => d.index >= k.index && d.index - k.index < 40);
    if (after) return after.iso;
  }
  // Otherwise the latest future date; purchase dates in the text are usually in the past.
  const future = dates.filter((d) => d.iso >= today).map((d) => d.iso).sort();
  return future.length ? future[future.length - 1] : null;
}

function findPin(text) {
  const m = text.match(/(?:קוד סודי|קוד אבטחה|סיסמה|pin|cvv|cvc)\s*[:\-]?\s*([0-9]{3,8})(?!\d)/i);
  return m ? m[1] : '';
}

function findCode(text, exclude) {
  const keyword = /(?:קוד(?!\s*(?:סודי|אבטחה))(?:\s*(?:שובר|קופון|מימוש|כרטיס|הטבה|זיכוי))?|מספר\s*(?:השובר|שובר|כרטיס|הכרטיס|זיכוי|תעודה|תעודת זיכוי)|מס['׳]?\s*(?:שובר|כרטיס|זיכוי)|card\s*(?:number|no\.?)|voucher\s*(?:code|number|no\.?)?|coupon\s*code|promo\s*code|gift\s*code|code)\s*[:#\-]?\s*([A-Z0-9](?:[A-Z0-9]|[ -](?=[A-Z0-9])){3,40})/i;
  const m = text.match(keyword);
  if (m) {
    const code = m[1].trim();
    // "1234 5678 9012" stays grouped as printed; a trailing word is not part of the code.
    const clean = /^[\d ]+$/.test(code) ? code.replace(/\s+/g, ' ') : code.split(' ')[0];
    if (!exclude.has(clean.replace(/\D/g, ''))) return clean;
  }
  // Fallback: the longest run of 8+ digits (allowing spaces/dashes between groups) that
  // is not a phone number, a date or part of a link.
  const noLinks = text.replace(/https?:\/\/\S+/gi, ' ');
  let best = '';
  for (const r of noLinks.matchAll(/(^|[^\d.,/])(\d(?:\d|[ -](?=\d)){7,30})(?![\d.,/])/g)) {
    const digits = r[2].replace(/\D/g, '');
    if (/^0(?:5\d|[2-9])\d{7}$/.test(digits)) continue;
    if (exclude.has(digits)) continue;
    if (digits.length > best.replace(/\D/g, '').length) best = r[2].trim();
  }
  return best;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word match. Short Latin names ("Fox", "Next", "KSP") only count when written
// with a capital letter, so ordinary English words ("next time") do not; Hebrew names
// may carry a one-letter prefix ("בפוקס", "לשופרסל").
function storeMentioned(name, original, norm) {
  const n = normalizeText(name);
  if (/^[a-z0-9 ]+$/.test(n)) {
    if (name.length < 3) return false;
    if (name.length <= 4) {
      const re = new RegExp(`(?:^|[^A-Za-z0-9])(${escapeRe(name)})(?=[^A-Za-z0-9]|$)`, 'gi');
      return [...original.matchAll(re)].some((m) => /^[A-Z]/.test(m[1]));
    }
    return new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`).test(norm);
  }
  if (n.length < 2) return false;
  return new RegExp(`(^|[^א-ת])[בלמוהשכ]?${escapeRe(n)}([^א-ת]|$)`).test(norm);
}

function findStore(text) {
  const norm = normalizeText(text);
  let best = null;
  for (const s of STORES) {
    for (const name of [s.name, ...s.aliases]) {
      const len = normalizeText(name).length;
      if ((!best || len > best.len) && storeMentioned(name, text, norm)) best = { name: s.name, len };
    }
  }
  return best?.name || '';
}

function findType(text, store) {
  if (/זיכוי|תעודת זיכוי|credit note|store credit/i.test(text)) return 'credit';
  if (/קופון|coupon|promo code|קוד הנחה|\d+%\s*הנחה/i.test(text)) return 'coupon';
  if (/גיפט|gift ?card|כרטיס מתנה|כרטיס נטען|תו קני|תו שי/i.test(text)) return 'giftcard';
  if (/שובר|voucher/i.test(text)) return store === 'BuyMe' ? 'giftcard' : 'voucher';
  const entry = STORES.find((s) => s.name === store);
  return entry?.kind || '';
}

function findDiscount(text) {
  const m = text.match(/(\d{1,2})\s?%\s?(?:הנחה|off|discount)/i) || text.match(/הנחה של\s?(\d{1,2})\s?%/);
  if (m) return `${m[1]}% הנחה`;
  if (/1\s?\+\s?1/.test(text)) return '1+1';
  return '';
}

export function parseGiftText(input, { today = todayISO() } = {}) {
  const text = String(input || '').replace(/[ \t]+/g, ' ').trim();
  if (!text) return { found: [] };
  const result = {};
  const link = findLink(text);
  if (link) result.link = link;
  const amount = findAmount(text.replace(/https?:\/\/\S+/gi, ' '));
  if (amount) {
    result.initialAmount = amount.amount;
    result.currency = amount.currency;
  }
  const expiry = findExpiry(text, today);
  if (expiry) result.expiry = expiry;
  const pin = findPin(text);
  if (pin) result.pin = pin;

  const exclude = new Set([pin].filter(Boolean));
  for (const d of findDates(text)) exclude.add(d.iso.replace(/-/g, ''));
  if (amount) exclude.add(String(amount.amount).replace(/\D/g, ''));
  const code = findCode(text, exclude);
  if (code) result.code = code;

  const store = findStore(text);
  if (store) result.store = store;
  const type = findType(text, store);
  if (type) result.type = type;
  const discount = findDiscount(text);
  if (discount && (type === 'coupon' || !amount)) result.discount = discount;

  result.found = Object.keys(result);
  return result;
}
