// Calendar reminders (.ics and Google Calendar links) and the plaintext summary sent to
// the backend when the household opts in to email reminders. That summary is the only
// data the backend can read: store, title, expiry and balance. Codes and PINs never go.

import { TYPES, memberName } from './model.js';
import { formatMoney } from './money.js';
import { formatDate, addDays } from './dates.js';

export function buildReminderItems(views, members) {
  return views
    .filter((v) => (v.status === 'active' || v.status === 'expiring') && v.card.expiry)
    .sort((a, b) => (a.card.expiry < b.card.expiry ? -1 : a.card.expiry > b.card.expiry ? 1 : 0))
    .slice(0, 500)
    .map((v) => ({
      title: v.card.title ? `${v.card.store} – ${v.card.title}` : v.card.store,
      type: TYPES[v.card.type]?.label || '',
      expiry: v.card.expiry,
      balance: v.balance,
      currency: v.card.currency,
      owner: memberName(members, v.card.owner),
    }));
}

// RFC 5545 text escaping.
function esc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Folds a content line to at most 75 octets, never splitting a UTF-8 character.
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (iso) => iso.replace(/-/g, '');

function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function eventTitle(view) {
  const amount = view.balance != null ? ` ${formatMoney(view.balance, view.card.currency)}` : '';
  return `פג תוקף: ${view.card.store}${amount}`;
}

function eventDescription(view, appUrl) {
  const lines = [
    `${TYPES[view.card.type]?.label || ''} ${view.card.store}${view.card.title ? ` – ${view.card.title}` : ''}`,
    view.balance != null ? `יתרה: ${formatMoney(view.balance, view.card.currency)}` : '',
    `בתוקף עד ${formatDate(view.card.expiry)}`,
    appUrl ? `לפתיחה בארנק: ${appUrl}#/card/${view.card.id}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

// Alarm offsets relative to the all-day event's start (midnight of the expiry day), set to
// fire at 09:00: "-P6DT15H" is 7 days before at 09:00, "PT9H" is the day itself at 09:00.
function alarmTrigger(daysBefore) {
  if (daysBefore <= 0) return 'PT9H';
  return daysBefore === 1 ? '-PT15H' : `-P${daysBefore - 1}DT15H`;
}

export function buildICS(views, { appUrl = '', reminderDays = [30, 7, 1], now = Date.now() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gift Wallet//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const v of views) {
    if (!v.card.expiry) continue;
    const title = eventTitle(v);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${v.card.id}-expiry@gift-wallet`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART;VALUE=DATE:${compactDate(v.card.expiry)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(v.card.expiry, 1))}`,
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(eventDescription(v, appUrl))}`,
      'TRANSP:TRANSPARENT',
    );
    for (const d of [...new Set(reminderDays)].sort((a, b) => b - a)) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, `TRIGGER:${alarmTrigger(d)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Google Calendar "add event" link. Google applies the user's default all-day
// notifications, so the event is placed `leadDays` before expiry to act as the reminder.
export function googleCalendarUrl(view, { appUrl = '', leadDays = 7 } = {}) {
  const day = view.card.expiry;
  const start = leadDays > 0 ? addDays(day, -leadDays) : day;
  const title = leadDays > 0
    ? `לממש: ${view.card.store}${view.balance != null ? ` ${formatMoney(view.balance, view.card.currency)}` : ''} (פג ב-${formatDate(day)})`
    : eventTitle(view);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${compactDate(start)}/${compactDate(addDays(start, 1))}`,
    details: eventDescription(view, appUrl),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
