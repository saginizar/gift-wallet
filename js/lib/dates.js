// Date helpers. Expiry dates are calendar dates stored as 'YYYY-MM-DD' strings in the
// device's local time zone (Israel), so all day math goes through UTC midnights to stay
// clear of DST shifts.

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Whole days from `fromISO` to `toISO` (positive when `toISO` is later).
export function daysBetween(fromISO, toISO) {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / DAY);
}

export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * DAY);
}

// Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28).
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, lastDay))}`;
}

export const addYears = (iso, n) => addMonths(iso, n * 12);

export function formatDate(iso) {
  if (!isISODate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatShortDate(iso) {
  if (!isISODate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

// Hebrew phrase for how far away an expiry date is.
export function relativeDays(days) {
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === -1) return 'אתמול';
  const abs = Math.abs(days);
  let span;
  if (abs === 2) span = 'יומיים';
  else if (abs < 30) span = `${abs} ימים`;
  else if (abs < 365) {
    const months = Math.round(abs / 30.44);
    span = months <= 1 ? 'חודש' : months === 2 ? 'חודשיים' : `${months} חודשים`;
  } else {
    const years = Math.round(abs / 365.25);
    span = years <= 1 ? 'שנה' : years === 2 ? 'שנתיים' : `${years} שנים`;
  }
  return days > 0 ? `בעוד ${span}` : `לפני ${span}`;
}

// Short label for a card's expiry chip: "פג היום", "עוד 12 ימים", "פג לפני 3 ימים".
export function expiryLabel(days) {
  if (days == null) return 'ללא תוקף';
  if (days === 0) return 'פג היום';
  if (days === 1) return 'פג מחר';
  if (days < 0) return `פג ${relativeDays(days)}`;
  return relativeDays(days).replace('בעוד', 'עוד');
}

export function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(ms) {
  return `${formatDate(todayISO(new Date(ms)))} ${formatTime(ms)}`;
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// Heading for a day group in the history feed.
export function dayHeading(ms, now = new Date()) {
  const iso = todayISO(new Date(ms));
  const diff = daysBetween(iso, todayISO(now));
  if (diff === 0) return 'היום';
  if (diff === 1) return 'אתמול';
  const d = new Date(ms);
  if (diff > 1 && diff < 7) return `יום ${WEEKDAYS[d.getDay()]}`;
  return formatDate(iso);
}

export function yearOf(iso) {
  return Number(String(iso).slice(0, 4));
}
