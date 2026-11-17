import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockGas } from '../scripts/mock-gas.mjs';

const AUTH = 'a'.repeat(43);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function claimed(opts) {
  const gas = createMockGas(opts);
  assert.equal(gas.doPost({ action: 'hello', auth: AUTH, claim: true }).claimed, true);
  return gas;
}

test('first device claims the backend; later callers need the same token', () => {
  const gas = createMockGas();
  assert.equal(gas.doGet().claimed, false);
  assert.equal(gas.doPost({ action: 'hello', auth: AUTH }).error, 'unclaimed');
  assert.equal(gas.doPost({ action: 'pull', auth: AUTH }).error, 'unauthorized');
  assert.equal(gas.doPost({ action: 'hello', auth: AUTH, claim: true }).claimed, true);
  assert.equal(gas.doGet().claimed, true);
  assert.equal(gas.doPost({ action: 'hello', auth: AUTH }).ok, true);
  assert.equal(gas.doPost({ action: 'hello', auth: 'b'.repeat(43), claim: true }).error, 'unauthorized');
  assert.equal(gas.doPost({ action: 'pull', auth: 'b'.repeat(43) }).error, 'unauthorized');
  assert.notEqual(gas.props.get('AUTH_HASH'), AUTH, 'only a hash is stored');
  assert.equal(gas.doPost('not json').error, 'bad_request');
});

test('push keeps the newest version per record and pull pages by sequence', () => {
  const gas = claimed();
  const push = (records) => gas.doPost({ action: 'push', auth: AUTH, records });
  const r1 = push([{ id: id(1), ts: 100, dev: 'A', blob: 'v1' }, { id: id(2), ts: 100, dev: 'A', blob: 'x1' }]);
  assert.deepEqual(r1.results.map((r) => r.seq), [1, 2]);

  const older = push([{ id: id(1), ts: 50, dev: 'B', blob: 'old' }]);
  assert.equal(older.results[0].applied, false);
  assert.equal(older.results[0].current.blob, 'v1');

  const newer = push([{ id: id(1), ts: 200, dev: 'B', blob: 'v2' }]);
  assert.equal(newer.results[0].seq, 3);

  // Same timestamp: the device id breaks the tie.
  assert.equal(push([{ id: id(2), ts: 100, dev: 'Z', blob: 'x2' }]).results[0].applied, true);
  assert.equal(push([{ id: id(2), ts: 100, dev: 'C', blob: 'x3' }]).results[0].applied, false);

  const all = gas.doPost({ action: 'pull', auth: AUTH, since: 0 });
  assert.deepEqual(all.records.map((r) => [r.id, r.blob]), [[id(1), 'v2'], [id(2), 'x2']]);
  assert.equal(all.maxSeq, 4);
  assert.equal(gas.doPost({ action: 'pull', auth: AUTH, since: 4 }).records.length, 0);
  const page = gas.doPost({ action: 'pull', auth: AUTH, since: 0, limit: 1 });
  assert.equal(page.more, true);
  assert.equal(page.maxSeq, 3);
});

test('pull reads only what changed, and nothing at all when nothing did', () => {
  const gas = claimed();
  const records = [];
  for (let i = 0; i < 300; i++) records.push({ id: id(i), ts: 1, dev: 'A', blob: 'x'.repeat(500) });
  gas.doPost({ action: 'push', auth: AUTH, records });
  const maxSeq = gas.doPost({ action: 'pull', auth: AUTH, since: 0 }).maxSeq;

  gas.stats.cellsRead = 0;
  assert.equal(gas.doPost({ action: 'pull', auth: AUTH, since: maxSeq }).records.length, 0);
  assert.equal(gas.stats.cellsRead, 0, 'polling with nothing new skips the sheet');

  gas.doPost({ action: 'push', auth: AUTH, records: [{ id: id(10), ts: 2, dev: 'A', blob: 'new10' }, { id: id(250), ts: 2, dev: 'A', blob: 'new250' }] });
  gas.stats.cellsRead = 0;
  const changed = gas.doPost({ action: 'pull', auth: AUTH, since: maxSeq });
  assert.deepEqual(changed.records.map((r) => r.blob), ['new10', 'new250']);
  assert.ok(gas.stats.cellsRead < 300 + 20, `read ${gas.stats.cellsRead} cells`);

  gas.stats.cellsRead = 0;
  const stale = gas.doPost({ action: 'push', auth: AUTH, records: [{ id: id(10), ts: 1, dev: 'B', blob: 'older' }] });
  assert.equal(stale.results[0].current.blob, 'new10');
  assert.ok(gas.stats.cellsRead < 300 * 4 + 5, 'push does not read the blob column');
});

test('the same id twice in one batch is stored once', () => {
  const gas = claimed();
  gas.doPost({ action: 'push', auth: AUTH, records: [{ id: id(9), ts: 1, dev: 'A', blob: 'a' }, { id: id(9), ts: 2, dev: 'A', blob: 'b' }] });
  const all = gas.doPost({ action: 'pull', auth: AUTH, since: 0 });
  assert.equal(all.records.length, 1);
  assert.equal(all.records[0].blob, 'b');
});

test('the records sheet grows past its initial 1000 rows and keeps ids as text', () => {
  const gas = claimed();
  for (let batch = 0; batch < 6; batch++) {
    const records = [];
    for (let i = 0; i < 200; i++) records.push({ id: id(batch * 200 + i), ts: 1, dev: 'A', blob: `-${batch}${i}` });
    assert.equal(gas.doPost({ action: 'push', auth: AUTH, records }).ok, true);
  }
  let total = 0;
  let since = 0;
  for (;;) {
    const page = gas.doPost({ action: 'pull', auth: AUTH, since });
    total += page.records.length;
    since = page.maxSeq;
    if (!page.more) break;
  }
  assert.equal(total, 1200);
  const first = gas.doPost({ action: 'pull', auth: AUTH, since: 0, limit: 1 }).records[0];
  assert.equal(typeof first.blob, 'string');
  assert.equal(first.blob, '-00');
});

test('rejects malformed records', () => {
  const gas = claimed();
  const res = gas.doPost({ action: 'push', auth: AUTH, records: [{ id: 'x', ts: 1, blob: 'a' }, { id: id(1), ts: 'soon', blob: 'a' }] });
  assert.deepEqual(res.results.map((r) => r.error), ['invalid', 'invalid']);
});

test('images are chunked across rows and survive replacement and deletion', () => {
  const gas = claimed();
  const big = 'x'.repeat(95000);
  assert.equal(gas.doPost({ action: 'putImage', auth: AUTH, id: id(1), data: big }).parts, 3);
  gas.doPost({ action: 'putImage', auth: AUTH, id: id(2), data: 'small' });
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(1) }).data, big);
  gas.doPost({ action: 'putImage', auth: AUTH, id: id(1), data: 'replaced' });
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(1) }).data, 'replaced');
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(2) }).data, 'small');
  assert.equal(gas.doPost({ action: 'deleteImage', auth: AUTH, id: id(2) }).removed, true);
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(2) }).error, 'not_found');
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(1) }).data, 'replaced');
});

test('photo replace/delete cycles never delete sheet rows (Sheets forbids removing the last one)', () => {
  const gas = claimed();
  for (let i = 0; i < 1200; i++) {
    assert.equal(gas.doPost({ action: 'putImage', auth: AUTH, id: id(1), data: `v${i}` }).ok, true);
  }
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(1) }).data, 'v1199');
  assert.equal(gas.doPost({ action: 'deleteImage', auth: AUTH, id: id(1) }).removed, true);
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(1) }).error, 'not_found');
});

test('resetAll works when the data fills the sheet to its last row', () => {
  const gas = claimed();
  const records = [];
  for (let i = 0; i < 199; i++) records.push({ id: id(i), ts: 1, dev: 'A', blob: 'b' });
  for (let k = 0; k < 5; k++) gas.doPost({ action: 'push', auth: AUTH, records: records.map((r, i) => ({ ...r, id: id(k * 199 + i) })) });
  assert.equal(gas.sheets.get('records').getLastRow(), 996);
  gas.doPost({ action: 'push', auth: AUTH, records: [1, 2, 3, 4].map((n) => ({ id: id(5000 + n), ts: 1, dev: 'A', blob: 'b' })) });
  assert.equal(gas.sheets.get('records').getLastRow(), gas.sheets.get('records').getMaxRows());
  gas.run('resetAll');
  assert.equal(gas.doGet().claimed, false);
});

test('many photos push the images sheet past 1000 rows', () => {
  const gas = claimed();
  const data = 'y'.repeat(200000); // 5 chunks each
  for (let i = 0; i < 210; i++) assert.equal(gas.doPost({ action: 'putImage', auth: AUTH, id: id(i), data }).ok, true);
  assert.equal(gas.doPost({ action: 'getImage', auth: AUTH, id: id(209) }).data.length, 200000);
});

test('email reminders: config, daily trigger and the digest', () => {
  let now = Date.UTC(2026, 10, 13, 7);
  const gas = claimed({ now: () => now, today: () => '2026-11-13' });
  const res = gas.doPost({
    action: 'reminders', auth: AUTH, enabled: true, emails: ['a@example.com', 'not-an-email'], leadDays: [30, 7, 1], appUrl: 'https://example.github.io/gift-wallet/',
    items: [
      { title: 'BuyMe', type: 'כרטיס מתנה', expiry: '2026-11-20', balance: 200, currency: 'ILS', owner: 'משותף' },
      { title: 'Fox', type: 'זיכוי', expiry: '2026-12-13', balance: 149.9, currency: 'ILS', owner: 'דנה' },
      { title: 'Zara', type: 'זיכוי', expiry: '2027-03-01', balance: 80, currency: 'ILS', owner: '' },
    ],
  });
  assert.equal(res.enabled, true);
  assert.equal(res.items, 3);
  assert.equal(gas.triggers.length, 1);
  assert.equal(gas.triggers[0].atHour, 9);

  // Expiry strings must come back as text even though Sheets likes to turn them into dates.
  assert.equal(gas.run('sendReminders'), 2);
  assert.equal(gas.mails.length, 1);
  assert.equal(gas.mails[0].to, 'a@example.com');
  assert.match(gas.mails[0].subject, /2 כרטיסים/);
  assert.match(gas.mails[0].htmlBody, /BuyMe/);
  assert.match(gas.mails[0].htmlBody, /149\.90/);
  assert.doesNotMatch(gas.mails[0].htmlBody, /Zara/);

  assert.equal(gas.doPost({ action: 'testReminder', auth: AUTH }).ok, true);
  assert.equal(gas.mails.length, 2);
  assert.match(gas.mails[1].subject, /בדיקה/);

  gas.doPost({ action: 'reminders', auth: AUTH, enabled: false, emails: [], items: [] });
  assert.equal(gas.triggers.length, 0);
  assert.equal(gas.run('sendReminders'), 0);
});

test('resetAll frees the backend for a new household', () => {
  const gas = claimed();
  gas.doPost({ action: 'push', auth: AUTH, records: [{ id: id(1), ts: 1, dev: 'A', blob: 'a' }] });
  gas.run('resetAll');
  assert.equal(gas.doGet().claimed, false);
  const other = 'c'.repeat(43);
  assert.equal(gas.doPost({ action: 'hello', auth: other, claim: true }).claimed, true);
  assert.equal(gas.doPost({ action: 'pull', auth: other, since: 0 }).records.length, 0);
});
