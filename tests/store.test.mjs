import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../js/lib/db.js';
import { createStore } from '../js/lib/store.js';
import { describeEvent } from '../js/lib/events.js';
import { buildBackup, parseBackup, restoreBackup, buildCSV } from '../js/lib/backup.js';
import { buildICS, foldLine, googleCalendarUrl, buildReminderItems } from '../js/lib/reminders.js';

async function newStore(storage = createMemoryStorage()) {
  let t = 1_700_000_000_000;
  const store = createStore({ storage, now: () => (t += 1000), today: () => '2026-11-13' });
  await store.load();
  return store;
}

test('every change is logged with who made it', async () => {
  const s = await newStore();
  const me = await s.addMember('שגיא');
  await s.setMe(me.id);
  const c = await s.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 500, openingBalance: 320, expiry: '2027-01-01' });
  assert.equal(s.view(c.id).balance, 320, 'opening balance below face value');
  await s.addTx(c.id, { type: 'use', amount: 120, note: 'מתנה לאמא' });
  await s.addTx(c.id, { type: 'adjust', balance: 150 });
  await s.updateCard(c.id, { notes: 'שמור בארנק', title: 'יום הולדת' });
  await s.setArchived(c.id, true);
  await s.setArchived(c.id, false);
  const actions = s.snapshot().events.map((e) => e.action).reverse();
  assert.deepEqual(actions, ['member.add', 'card.create', 'tx.use', 'tx.adjust', 'card.update', 'card.archive', 'card.unarchive']);
  const use = s.snapshot().events.find((e) => e.action === 'tx.use');
  assert.equal(use.by, me.id);
  assert.equal(use.balanceAfter, 200);
  assert.match(describeEvent(use).title, /מימוש .*120.* · BuyMe/);
  assert.match(describeEvent(use).detail, /200/);
  const upd = s.snapshot().events.find((e) => e.action === 'card.update');
  assert.equal(describeEvent(upd).detail, 'כותרת, הערות');
  assert.equal(s.view(c.id).balance, 150);
});

test('household settings are synced records with defaults', async () => {
  const s = await newStore();
  assert.deepEqual(s.reminderDays(), [30, 7, 1]);
  await s.setHouseholdSetting('reminders', { enabled: true, emails: ['a@b.co'], days: [14, 1] });
  assert.deepEqual(s.reminderDays(), [14, 1]);
  const rec = s.exportRecords().find((r) => r.kind === 'setting');
  assert.equal(rec.id, 'setting-reminders');
  assert.equal(s.dirtyRecords().some((r) => r.id === 'setting-reminders'), true);
});

test('undoing a transaction restores the balance', async () => {
  const s = await newStore();
  const c = await s.createCard({ type: 'credit', store: 'Fox', initialAmount: 100 });
  const t = await s.addTx(c.id, { type: 'use', amount: 100 });
  assert.equal(s.view(c.id).status, 'used');
  await s.deleteTx(t.id);
  assert.equal(s.view(c.id).balance, 100);
  assert.equal(s.view(c.id).status, 'active');
});

test('vouchers without an amount are marked as redeemed', async () => {
  const s = await newStore();
  const c = await s.createCard({ type: 'voucher', store: 'ארומה', title: 'ארוחת בוקר זוגית' });
  assert.equal(s.view(c.id).balance, null);
  await s.addTx(c.id, { type: 'redeem' });
  assert.equal(s.view(c.id).status, 'used');
});

test('delete, restore and purge', async () => {
  const s = await newStore();
  const c = await s.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 50, code: 'SECRET' });
  await s.addTx(c.id, { type: 'use', amount: 10 });
  await s.deleteCard(c.id);
  assert.equal(s.view(c.id).status, 'deleted');
  await s.restoreCard(c.id);
  assert.equal(s.view(c.id).status, 'active');
  await s.deleteCard(c.id);
  assert.equal(await s.purgeCards([c.id]), 1);
  const rec = s.exportRecords().find((r) => r.id === c.id);
  assert.equal(rec.purged, true);
  assert.equal(rec.code, undefined, 'contents are gone, tombstone stays');
  const tx = s.snapshot().txs.find((t) => t.cardId === c.id);
  assert.equal(tx.deleted, false, 'the ledger is kept');
  assert.ok(s.snapshot().events.filter((e) => e.cardId === c.id).every((e) => !e.note));
  assert.equal(await s.purgeCards([c.id]), 0);
});

test('edits that change nothing are not recorded', async () => {
  const s = await newStore();
  const c = await s.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 50 });
  const before = s.snapshot().events.length;
  await s.updateCard(c.id, { store: 'BuyMe', initialAmount: 50 });
  assert.equal(s.snapshot().events.length, before);
});

test('data survives a reload from storage', async () => {
  const storage = createMemoryStorage();
  const s1 = await newStore(storage);
  const c = await s1.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 75 });
  await s1.addTx(c.id, { type: 'use', amount: 25 });
  const s2 = await newStore(storage);
  assert.equal(s2.view(c.id).balance, 50);
  assert.equal(s2.kv.deviceId, s1.kv.deviceId);
});

test('backup round trip merges without overwriting newer data', async () => {
  const s = await newStore();
  const c = await s.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 });
  await s.addPhoto(c.id, new Uint8Array([1, 2, 3]).buffer);
  const backup = await buildBackup(s);
  const text = JSON.stringify(backup);

  const fresh = await newStore();
  const res = await restoreBackup(fresh, parseBackup(text));
  assert.ok(res.merged > 0);
  assert.equal(res.photos, 1);
  assert.equal(fresh.view(c.id).balance, 100);
  assert.deepEqual([...new Uint8Array((await fresh.getPhoto(fresh.view(c.id).card.photos[0])).bytes)], [1, 2, 3]);

  await s.updateCard(c.id, { notes: 'newer' });
  await restoreBackup(s, parseBackup(text));
  assert.equal(s.view(c.id).card.notes, 'newer');

  assert.throws(() => parseBackup('{"app":"other","records":[]}'));
  assert.throws(() => parseBackup('not json'));
});

test('CSV export is Excel-safe', async () => {
  const s = await newStore();
  await s.createCard({ type: 'credit', store: 'Fox', initialAmount: 99.9, notes: '=HYPERLINK("x")', code: '123,456' });
  const csv = buildCSV(s.views(), []);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"123,456"/);
  assert.match(csv, /זיכוי,Fox/);
});

test('calendar export', async () => {
  const s = await newStore();
  await s.createCard({ type: 'giftcard', store: 'BuyMe', title: 'מתנה מהעבודה, חג', initialAmount: 200, expiry: '2026-12-01' });
  await s.createCard({ type: 'credit', store: 'Fox', initialAmount: 50 });
  const ics = buildICS(s.views(), { appUrl: 'https://example.github.io/gift-wallet/', reminderDays: [30, 7, 1], now: Date.UTC(2026, 10, 13) });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, 'cards without expiry are skipped');
  assert.match(ics, /DTSTART;VALUE=DATE:20261201/);
  assert.match(ics, /DTEND;VALUE=DATE:20261202/);
  assert.match(ics, /TRIGGER:-P29DT15H/);
  assert.match(ics, /TRIGGER:-P6DT15H/);
  assert.match(ics, /TRIGGER:-PT15H/);
  assert.match(ics, /מתנה מהעבודה\\, חג/);
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(enc.encode(line).length <= 75, `line too long: ${line}`);
  assert.equal(foldLine('א'.repeat(60)).split('\r\n ').join(''), 'א'.repeat(60));

  const url = new URL(googleCalendarUrl(s.views().find((v) => v.card.expiry), { leadDays: 7 }));
  assert.equal(url.searchParams.get('dates'), '20261124/20261125');
  assert.match(url.searchParams.get('text'), /BuyMe/);

  const items = buildReminderItems(s.views(), []);
  assert.equal(items.length, 1);
  assert.equal(items[0].expiry, '2026-12-01');
  assert.equal('code' in items[0], false);
});
