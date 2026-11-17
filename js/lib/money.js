// Money formatting and parsing. Amounts are plain numbers rounded to agorot (2 decimals).

export const CURRENCIES = {
  ILS: { symbol: '₪', label: 'שקל' },
  USD: { symbol: '$', label: 'דולר' },
  EUR: { symbol: '€', label: 'אירו' },
  GBP: { symbol: '£', label: 'ליש"ט' },
};

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const formatters = new Map();
function formatter(currency, fraction) {
  const key = `${currency}:${fraction}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    }));
  }
  return formatters.get(key);
}

// "‏200 ‏₪" for whole amounts, "‏149.90 ‏₪" otherwise.
export function formatMoney(amount, currency = 'ILS') {
  if (amount == null || Number.isNaN(Number(amount))) return '';
  const n = round2(amount);
  const code = CURRENCIES[currency] ? currency : 'ILS';
  return formatter(code, Number.isInteger(n) ? 0 : 2).format(n);
}

// Parses user-typed amounts: "200", "1,250", "149.90", "149,9", "₪ 80", "80 ש״ח".
// Returns null when the text has no usable number.
export function parseAmount(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? round2(text) : null;
  let s = String(text).replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the later one is the decimal separator.
    s = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma > -1) {
    // Only commas: "1,250" groups thousands, "149,9" is a decimal comma.
    const groups = s.split(',');
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
    s = thousands ? groups.join('') : groups.slice(0, -1).join('') + '.' + groups[groups.length - 1];
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

// Value for an <input> showing an amount without currency formatting.
export function amountInputValue(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const r = round2(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}
