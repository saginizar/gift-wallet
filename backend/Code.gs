/**
 * Gift Wallet (ארנק מתנות) — sync backend for Google Apps Script.
 *
 * Bound to a Google Sheet in the household owner's account and deployed as a web app
 * (Execute as: Me, Who has access: Anyone). The phones send only encrypted records, so
 * the sheet holds ciphertext; requests are authorised by a token derived from the
 * household key, of which the script stores only a SHA-256 hash.
 *
 * Sheets (created automatically):
 *   records      id | seq | ts | dev | blob       one row per record, latest version only
 *   images       id | part | data                 encrypted photo chunks
 *   image_index  id | startRow | parts | bytes    where each photo's chunks live
 *   reminders    plaintext list for email reminders (only if the household opts in)
 *
 * Maintenance (run from the editor): resetAll() wipes everything and frees the backend
 * for a new household; sendReminders() runs the daily reminder job by hand.
 *
 * @OnlyCurrentDoc
 */

var GW_VERSION = 1;
var CHUNK_CHARS = 40000;
var PULL_LIMIT = 500;
var TZ = 'Asia/Jerusalem';

function doGet() {
  var claimed = !!PropertiesService.getScriptProperties().getProperty('AUTH_HASH');
  return json_({ ok: true, app: 'gift-wallet', version: GW_VERSION, claimed: claimed });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request', message: 'invalid JSON' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: 'busy', message: 'try again' });
  }
  try {
    return json_(route_(req));
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function route_(req) {
  if (!req || typeof req.action !== 'string') return { ok: false, error: 'bad_request' };
  if (req.action === 'hello') return hello_(req);
  if (!checkAuth_(req.auth)) return { ok: false, error: 'unauthorized' };
  switch (req.action) {
    case 'push': return push_(req);
    case 'pull': return pull_(req);
    case 'putImage': return putImage_(req);
    case 'getImage': return getImage_(req);
    case 'deleteImage': return deleteImage_(req);
    case 'reminders': return setReminders_(req);
    case 'testReminder': return testReminder_(req);
    default: return { ok: false, error: 'bad_request', message: 'unknown action' };
  }
}

// ---------------------------------------------------------------- auth

function hello_(req) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('AUTH_HASH');
  if (!stored) {
    if (!req.claim) return { ok: false, error: 'unclaimed' };
    if (!validToken_(req.auth)) return { ok: false, error: 'bad_request' };
    props.setProperty('AUTH_HASH', sha256Hex_(req.auth));
    props.setProperty('SEQ', '0');
    ensureSheets_();
    return { ok: true, claimed: true, maxSeq: 0, version: GW_VERSION, serverTime: Date.now() };
  }
  if (!checkAuth_(req.auth)) return { ok: false, error: 'unauthorized' };
  return { ok: true, claimed: false, maxSeq: Number(props.getProperty('SEQ') || 0), version: GW_VERSION, serverTime: Date.now() };
}

function validToken_(token) {
  return typeof token === 'string' && token.length >= 32 && token.length <= 128;
}

function checkAuth_(token) {
  var stored = PropertiesService.getScriptProperties().getProperty('AUTH_HASH');
  if (!stored || !validToken_(token)) return false;
  var actual = sha256Hex_(token);
  var diff = actual.length ^ stored.length;
  for (var i = 0; i < actual.length && i < stored.length; i++) diff |= actual.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

// ---------------------------------------------------------------- sheets

function ensureSheets_() {
  sheet_('records', ['id', 'seq', 'ts', 'dev', 'blob'], [1, 4, 5]);
  sheet_('images', ['id', 'part', 'data'], [1, 3]);
  sheet_('image_index', ['id', 'startRow', 'parts', 'chars'], [1]);
  sheet_('reminders', ['title', 'type', 'expiry', 'balance', 'currency', 'owner'], [1, 2, 3, 5, 6]);
}

// Returns the named sheet, creating it with a header row. Text columns are formatted as
// plain text so Sheets never reinterprets an id or a date string.
function sheet_(name, header, textCols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
    for (var i = 0; i < (textCols || []).length; i++) sh.getRange(1, textCols[i], sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}

function recordsSheet_() { return sheet_('records', ['id', 'seq', 'ts', 'dev', 'blob'], [1, 4, 5]); }

// Appends rows below the data, growing the sheet first: getRange cannot address rows
// past the sheet's current size. New rows get the same plain-text columns.
function appendRows_(sh, rows, textCols) {
  if (!rows.length) return 0;
  var start = sh.getLastRow() + 1;
  var end = start + rows.length - 1;
  var max = sh.getMaxRows();
  if (end > max) {
    var add = end - max + 500;
    sh.insertRowsAfter(max, add);
    for (var i = 0; i < (textCols || []).length; i++) sh.getRange(max + 1, textCols[i], add, 1).setNumberFormat('@');
  }
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  return start;
}

// Sheets may still hand back a Date for a date-looking cell; normalise to 'YYYY-MM-DD'.
function isoCell_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v);
}

function dataRows_(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols).getValues();
}

// ---------------------------------------------------------------- records

function newer_(ts, dev, curTs, curDev) {
  if (ts !== curTs) return ts > curTs;
  return String(dev) > String(curDev);
}

function push_(req) {
  var list = Array.isArray(req.records) ? req.records : [];
  if (list.length > 200) return { ok: false, error: 'bad_request', message: 'too many records' };
  var props = PropertiesService.getScriptProperties();
  var seq = Number(props.getProperty('SEQ') || 0);
  var sh = recordsSheet_();
  // Index by id without the blob column, which holds most of the sheet's bytes.
  var rows = dataRows_(sh, 4);
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    index[String(rows[i][0])] = { row: i + 2, seq: Number(rows[i][1]), ts: Number(rows[i][2]), dev: String(rows[i][3]) };
  }
  var results = [];
  var appends = [];
  for (var k = 0; k < list.length; k++) {
    var r = list[k];
    if (!r || typeof r.id !== 'string' || !/^[\w-]{8,64}$/.test(r.id) || typeof r.blob !== 'string' || r.blob.length > 45000 || typeof r.ts !== 'number') {
      results.push({ id: r && r.id, applied: false, error: 'invalid' });
      continue;
    }
    var dev = String(r.dev || '').slice(0, 64);
    var cur = index[r.id];
    if (cur && !newer_(r.ts, dev, cur.ts, cur.dev)) {
      var blob = cur.blob !== undefined ? cur.blob : String(sh.getRange(cur.row, 5).getValue());
      results.push({ id: r.id, applied: false, stale: true, current: { seq: cur.seq, ts: cur.ts, dev: cur.dev, blob: blob } });
      continue;
    }
    seq++;
    var values = [r.id, seq, r.ts, dev, r.blob];
    if (cur && cur.row > 0) {
      sh.getRange(cur.row, 1, 1, 5).setValues([values]);
    } else if (cur) {
      appends[cur.appendAt] = values;
    } else {
      appends.push(values);
    }
    index[r.id] = { row: cur ? cur.row : -1, appendAt: cur ? cur.appendAt : appends.length - 1, seq: seq, ts: r.ts, dev: dev, blob: r.blob };
    results.push({ id: r.id, applied: true, seq: seq });
  }
  appendRows_(sh, appends, [1, 4, 5]);
  props.setProperty('SEQ', String(seq));
  return { ok: true, results: results, maxSeq: seq };
}

function pull_(req) {
  var since = Math.max(0, Number(req.since) || 0);
  var limit = Math.min(Math.max(1, Number(req.limit) || PULL_LIMIT), PULL_LIMIT);
  var seqNow = Number(PropertiesService.getScriptProperties().getProperty('SEQ') || 0);
  var empty = { ok: true, more: false, maxSeq: seqNow, records: [] };
  // The common case (a phone polling with nothing new) never touches the sheet.
  if (since >= seqNow) return empty;
  var sh = recordsSheet_();
  var last = sh.getLastRow();
  if (last < 2) return empty;

  var seqs = sh.getRange(2, 2, last - 1, 1).getValues();
  var hits = [];
  for (var i = 0; i < seqs.length; i++) {
    var seq = Number(seqs[i][0]);
    if (seq > since) hits.push({ row: i + 2, seq: seq });
  }
  hits.sort(function (a, b) { return a.seq - b.seq; });
  var more = hits.length > limit;
  if (more) hits = hits.slice(0, limit);

  var data = readRows_(sh, hits.map(function (h) { return h.row; }), last);
  return {
    ok: true,
    more: more,
    maxSeq: more ? hits[hits.length - 1].seq : seqNow,
    records: hits.map(function (h) {
      var r = data[h.row];
      return { id: String(r[0]), seq: Number(r[1]), ts: Number(r[2]), dev: String(r[3]), blob: String(r[4]) };
    }),
  };
}

// Reads the given record rows: contiguous runs in one call each, or the whole sheet
// when the changes are scattered across many runs.
function readRows_(sh, rowNumbers, last) {
  var sorted = rowNumbers.slice().sort(function (a, b) { return a - b; });
  var runs = [];
  for (var i = 0; i < sorted.length; i++) {
    var run = runs[runs.length - 1];
    if (run && sorted[i] === run.start + run.count) run.count++;
    else runs.push({ start: sorted[i], count: 1 });
  }
  var out = {};
  if (runs.length > 40) {
    var all = sh.getRange(2, 1, last - 1, 5).getValues();
    for (var k = 0; k < sorted.length; k++) out[sorted[k]] = all[sorted[k] - 2];
    return out;
  }
  for (var j = 0; j < runs.length; j++) {
    var vals = sh.getRange(runs[j].start, 1, runs[j].count, 5).getValues();
    for (var m = 0; m < vals.length; m++) out[runs[j].start + m] = vals[m];
  }
  return out;
}

// ---------------------------------------------------------------- images

function imageIndex_() {
  var sh = sheet_('image_index', ['id', 'startRow', 'parts', 'chars'], [1]);
  var rows = dataRows_(sh, 4);
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue; // cleared entry
    map[String(rows[i][0])] = { indexRow: i + 2, start: Number(rows[i][1]), parts: Number(rows[i][2]) };
  }
  return { sheet: sh, map: map };
}

function validImageId_(id) {
  return typeof id === 'string' && /^[\w-]{8,64}$/.test(id);
}

function putImage_(req) {
  if (!validImageId_(req.id) || typeof req.data !== 'string' || !req.data.length) return { ok: false, error: 'bad_request' };
  if (req.data.length > 8000000) return { ok: false, error: 'bad_request', message: 'image too large' };
  removeImage_(req.id);
  var parts = [];
  for (var i = 0; i < req.data.length; i += CHUNK_CHARS) parts.push([req.id, parts.length, req.data.slice(i, i + CHUNK_CHARS)]);
  var start = appendRows_(sheet_('images', ['id', 'part', 'data'], [1, 3]), parts, [1, 3]);
  appendRows_(imageIndex_().sheet, [[req.id, start, parts.length, req.data.length]], [1]);
  return { ok: true, parts: parts.length };
}

function getImage_(req) {
  if (!validImageId_(req.id)) return { ok: false, error: 'bad_request' };
  var entry = imageIndex_().map[req.id];
  if (!entry) return { ok: false, error: 'not_found' };
  var rows = sheet_('images', ['id', 'part', 'data'], [1, 3]).getRange(entry.start, 1, entry.parts, 3).getValues();
  var data = '';
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) !== req.id || Number(rows[i][1]) !== i) return { ok: false, error: 'server_error', message: 'image index out of date' };
    data += String(rows[i][2]);
  }
  return { ok: true, data: data };
}

function deleteImage_(req) {
  if (!validImageId_(req.id)) return { ok: false, error: 'bad_request' };
  return { ok: true, removed: removeImage_(req.id) };
}

// Clears a photo's chunks and its index entry. Rows are never deleted: other photos'
// start rows must stay valid, and Sheets refuses to delete the last non-frozen row.
function removeImage_(id) {
  var idx = imageIndex_();
  var entry = idx.map[id];
  if (!entry) return false;
  sheet_('images', ['id', 'part', 'data'], [1, 3]).getRange(entry.start, 1, entry.parts, 3).clearContent();
  idx.sheet.getRange(entry.indexRow, 1, 1, 4).clearContent();
  return true;
}

// ---------------------------------------------------------------- reminders

function validEmail_(s) {
  return typeof s === 'string' && s.length <= 120 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);
}

function setReminders_(req) {
  var props = PropertiesService.getScriptProperties();
  var emails = (Array.isArray(req.emails) ? req.emails : []).filter(validEmail_).slice(0, 5);
  var leadDays = (Array.isArray(req.leadDays) ? req.leadDays : [30, 7, 1])
    .map(Number).filter(function (n) { return n >= 0 && n <= 365 && Math.floor(n) === n; }).slice(0, 6);
  var enabled = !!req.enabled && emails.length > 0;
  var appUrl = typeof req.appUrl === 'string' && /^https:\/\//.test(req.appUrl) ? req.appUrl.slice(0, 300) : '';
  props.setProperty('REMINDERS', JSON.stringify({ enabled: enabled, emails: emails, leadDays: leadDays, appUrl: appUrl }));

  var sh = sheet_('reminders', ['title', 'type', 'expiry', 'balance', 'currency', 'owner'], [1, 2, 3, 5, 6]);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).clearContent();
  var items = enabled && Array.isArray(req.items) ? req.items.slice(0, 500) : [];
  var rows = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(it.expiry))) continue;
    rows.push([
      String(it.title || '').slice(0, 120),
      String(it.type || '').slice(0, 30),
      String(it.expiry),
      typeof it.balance === 'number' ? it.balance : '',
      String(it.currency || 'ILS').slice(0, 3),
      String(it.owner || '').slice(0, 40),
    ]);
  }
  appendRows_(sh, rows, [1, 2, 3, 5, 6]);
  setDailyTrigger_(enabled);
  return { ok: true, enabled: enabled, items: rows.length };
}

function setDailyTrigger_(on) {
  var triggers = ScriptApp.getProjectTriggers();
  var existing = triggers.filter(function (t) { return t.getHandlerFunction() === 'sendReminders'; });
  if (on && !existing.length) {
    ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(9).inTimezone(TZ).create();
  } else if (!on) {
    existing.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  }
}

function reminderConfig_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('REMINDERS') || '{}');
  } catch (e) {
    return {};
  }
}

function reminderItems_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('reminders');
  if (!sh) return [];
  return dataRows_(sh, 6).filter(function (r) { return r[2]; }).map(function (r) {
    return { title: String(r[0]), type: String(r[1]), expiry: isoCell_(r[2]), balance: r[3] === '' ? null : Number(r[3]), currency: String(r[4] || 'ILS'), owner: String(r[5]) };
  });
}

function todayISO_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function daysBetween_(fromISO, toISO) {
  var a = fromISO.split('-'), b = toISO.split('-');
  return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
}

// Daily trigger: one email listing cards whose days-left match a configured lead time.
function sendReminders() {
  var cfg = reminderConfig_();
  if (!cfg.enabled || !cfg.emails || !cfg.emails.length) return 0;
  var today = todayISO_();
  var lead = (cfg.leadDays && cfg.leadDays.length ? cfg.leadDays : [30, 7, 1]).concat([0]);
  var due = reminderItems_().filter(function (it) {
    return lead.indexOf(daysBetween_(today, it.expiry)) !== -1;
  });
  if (!due.length) return 0;
  mail_(cfg, due, today, false);
  return due.length;
}

function testReminder_() {
  var cfg = reminderConfig_();
  if (!cfg.emails || !cfg.emails.length) return { ok: false, error: 'bad_request', message: 'no emails configured' };
  var today = todayISO_();
  var upcoming = reminderItems_().filter(function (it) {
    var d = daysBetween_(today, it.expiry);
    return d >= 0 && d <= 60;
  });
  mail_(cfg, upcoming, today, true);
  return { ok: true, sent: cfg.emails.length, items: upcoming.length };
}

function money_(amount, currency) {
  if (amount === null || amount === undefined || isNaN(amount)) return '';
  var symbols = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };
  var fixed = Math.round(amount) === amount ? String(amount) : Number(amount).toFixed(2);
  return fixed + ' ' + (symbols[currency] || currency);
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function whenText_(days) {
  if (days === 0) return 'פג היום';
  if (days === 1) return 'פג מחר';
  return 'פג בעוד ' + days + ' ימים';
}

function mail_(cfg, items, today, isTest) {
  var rows = items.map(function (it) {
    var days = daysBetween_(today, it.expiry);
    var parts = it.expiry.split('-');
    return '<tr>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #eee"><b>' + escapeHtml_(it.title) + '</b><br><span style="color:#666">' + escapeHtml_(it.type) + (it.owner ? ' · ' + escapeHtml_(it.owner) : '') + '</span></td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap">' + escapeHtml_(money_(it.balance, it.currency)) + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;color:' + (days <= 7 ? '#c92a2a' : '#b35c00') + '">' + whenText_(days) + '<br><span style="color:#666">' + parts[2] + '/' + parts[1] + '/' + parts[0] + '</span></td>' +
      '</tr>';
  }).join('');
  var intro = isTest
    ? 'זו הודעת בדיקה מארנק המתנות. כך ייראו התזכורות.' + (items.length ? ' אלה הכרטיסים שפגים ב-60 הימים הקרובים:' : ' כרגע אין כרטיסים שפגים ב-60 הימים הקרובים.')
    : 'הכרטיסים האלה עומדים לפוג. כדאי לממש אותם בזמן:';
  var link = cfg.appUrl ? '<p><a href="' + escapeHtml_(cfg.appUrl) + '" style="color:#5b45e0">פתיחת הארנק</a></p>' : '';
  var html = '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#1d1d27">' +
    '<p>' + intro + '</p>' +
    (items.length ? '<table style="border-collapse:collapse">' + rows + '</table>' : '') +
    link + '<p style="color:#888;font-size:12px">נשלח אוטומטית מארנק המתנות שלכם.</p></div>';
  var subject = isTest ? 'בדיקה: תזכורות מארנק המתנות'
    : (items.length === 1 ? 'תזכורת: ' + items[0].title + ' ' + whenText_(daysBetween_(today, items[0].expiry))
      : 'תזכורת: ' + items.length + ' כרטיסים עומדים לפוג');
  MailApp.sendEmail({ to: cfg.emails.join(','), subject: subject, htmlBody: html, name: 'ארנק מתנות' });
}

// ---------------------------------------------------------------- maintenance

// Run from the editor to wipe all data and free the backend for a new household key.
function resetAll() {
  var props = PropertiesService.getScriptProperties();
  ['AUTH_HASH', 'SEQ', 'REMINDERS'].forEach(function (k) { props.deleteProperty(k); });
  setDailyTrigger_(false);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ['records', 'images', 'image_index', 'reminders'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
