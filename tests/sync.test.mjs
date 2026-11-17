import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockGas } from '../scripts/mock-gas.mjs';
import { createMemoryStorage } from '../js/lib/db.js';
import { createStore } from '../js/lib/store.js';
import { createSync, parsePairingCode, makePairingCode, isValidBackendUrl } from '../js/lib/sync.js';
import { deriveKeys, encryptJSON, decryptJSON, randomKey } from '../js/lib/crypto.js';

const URL_ = 'http://localhost:8080/mock-gas/exec';

function network(gas) {
  const net = { online: true, calls: [] };
  net.fetch = async (url, opts) => {
    if (!net.online) throw new TypeError('Failed to fetch');
    const body = JSON.parse(opts.body);
    net.calls.push(body.action);
    return { ok: true, status: 200, text: async () => JSON.stringify(gas.doPost(opts.body)) };
  };
  return net;
}

async function device(net, clock) {
  const store = createStore({ storage: createMemoryStorage(), now: () => clock.t++, today: () => '2026-11-13' });
  await store.load();
  const sync = createSync({ store, fetchImpl: net.fetch, isOnline: () => net.online, now: () => clock.t });
  return { store, sync };
}

const balanceOf = (d, id) => d.store.view(id).balance;

test('crypto round trip, wrong key and swapped id both fail', async () => {
  const k = await deriveKeys(randomKey());
  const blob = await encryptJSON(k.encKey, { a: 'שלום' }, 'id-1');
  assert.deepEqual(await decryptJSON(k.encKey, blob, 'id-1'), { a: 'שלום' });
  await assert.rejects(decryptJSON(k.encKey, blob, 'id-2'));
  const other = await deriveKeys(randomKey());
  await assert.rejects(decryptJSON(other.encKey, blob, 'id-1'));
  const again = await deriveKeys(randomKey());
  assert.notEqual(again.auth, k.auth);
});

test('pairing codes', () => {
  const key = randomKey();
  const code = makePairingCode(URL_, key);
  assert.deepEqual(parsePairingCode(`הצטרפי: https://x.github.io/gift-wallet/#join=${code} תודה`), { url: URL_, key });
  assert.equal(parsePairingCode('GW1.garbage-garbage-garbage'), null);
  assert.ok(isValidBackendUrl('https://script.google.com/macros/s/AKfycbx_abc-123/exec'));
  assert.ok(isValidBackendUrl('https://script.google.com/a/macros/example.com/s/AKfy/exec'));
  assert.ok(!isValidBackendUrl('https://script.google.com/macros/s/AKfy/dev'));
  assert.ok(!isValidBackendUrl('https://evil.example.com/exec'));
});

test('two phones share cards, purchases and history', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 1_000_000 };
  const a = await device(net, clock);
  const sagi = await a.store.addMember('שגיא');
  await a.store.setMe(sagi.id);
  const card = await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 300, expiry: '2027-06-01', code: '1234-5678', pin: '9999' });
  await a.sync.connectNew(URL_);
  assert.equal(a.sync.state.status, 'idle');
  assert.equal(a.store.dirtyRecords().length, 0);

  // The backend only ever sees ciphertext.
  const sheetText = JSON.stringify([...gas.sheets.get('records').rows]);
  assert.ok(!sheetText.includes('BuyMe') && !sheetText.includes('9999') && !sheetText.includes('שגיא'));

  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());
  assert.equal(b.store.view(card.id).card.code, '1234-5678');
  const dana = await b.store.addMember('דנה');
  await b.store.setMe(dana.id);
  await b.store.addTx(card.id, { type: 'use', amount: 120, note: 'נעליים' });
  await b.sync.syncNow();

  await a.sync.syncNow();
  assert.equal(balanceOf(a, card.id), 180);
  const names = a.store.snapshot().members.map((m) => m.name).sort();
  assert.deepEqual(names, ['דנה', 'שגיא']);
  const use = a.store.snapshot().events.find((e) => e.action === 'tx.use');
  assert.equal(use.by, dana.id);
  assert.equal(use.balanceAfter, 180);
});

test('offline purchases on both phones add up after sync', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 5_000_000 };
  const a = await device(net, clock);
  const card = await a.store.createCard({ type: 'credit', store: 'Fox', initialAmount: 500 });
  await a.sync.connectNew(URL_);
  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());

  net.online = false;
  await a.store.addTx(card.id, { type: 'use', amount: 100 });
  await b.store.addTx(card.id, { type: 'use', amount: 150 });
  assert.equal(await a.sync.syncNow(), false);
  assert.equal(a.sync.state.status, 'offline');

  net.online = true;
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(balanceOf(a, card.id), 250);
  assert.equal(balanceOf(b, card.id), 250);
});

test('concurrent edits: the newest edit wins on both phones', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 9_000_000 };
  const a = await device(net, clock);
  const card = await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100, notes: 'original' });
  await a.sync.connectNew(URL_);
  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());

  await a.store.updateCard(card.id, { notes: 'from A' });
  await b.store.updateCard(card.id, { notes: 'from B (later)' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.store.view(card.id).card.notes, 'from B (later)');
  assert.equal(b.store.view(card.id).card.notes, 'from B (later)');
  assert.equal(a.store.dirtyRecords().length, 0);
  assert.equal(b.store.dirtyRecords().length, 0);
});

test('a phone with a slow clock does not lose its edit or get stuck', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clockA = { t: 20_000_000 };
  const clockB = { t: 10_000_000 }; // B's clock is far behind
  const a = await device(net, clockA);
  const card = await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 });
  await a.sync.connectNew(URL_);
  const b = await device(net, clockB);
  await b.sync.join(a.sync.pairingCode());
  // B edits after having seen A's version: the stamp moves past it despite the clock.
  await b.store.updateCard(card.id, { title: 'מתנה מהעבודה' });
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.store.view(card.id).card.title, 'מתנה מהעבודה');
  assert.equal(b.store.dirtyRecords().length, 0);
});

test('joining with existing local data merges it and folds duplicate members', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 30_000_000 };
  const a = await device(net, clock);
  const dana = await a.store.addMember('דנה');
  await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 });
  await a.sync.connectNew(URL_);

  const b = await device(net, clock);
  const localDana = await b.store.addMember('דנה');
  await b.store.setMe(localDana.id);
  const own = await b.store.createCard({ type: 'credit', store: 'Zara', initialAmount: 80, owner: localDana.id });
  await b.sync.join(a.sync.pairingCode());
  assert.equal(b.store.kv.me, dana.id);
  assert.equal(b.store.view(own.id).card.owner, dana.id);
  assert.deepEqual(b.store.snapshot().members.map((m) => m.name), ['דנה']);

  await a.sync.syncNow();
  assert.equal(a.store.view(own.id).card.owner, dana.id);
  assert.equal(a.store.snapshot().members.length, 1);
});

test('photos sync encrypted and are fetched on demand', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 40_000_000 };
  const a = await device(net, clock);
  const card = await a.store.createCard({ type: 'credit', store: 'Castro', initialAmount: 99 });
  const bytes = new Uint8Array(70000).map((_, i) => i % 251);
  const photoId = await a.store.addPhoto(card.id, bytes.buffer);
  await a.sync.connectNew(URL_);
  assert.deepEqual(a.store.kv.imgUpload, []);

  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());
  assert.deepEqual(b.store.view(card.id).card.photos, [photoId]);
  const img = await b.sync.fetchPhoto(photoId);
  assert.deepEqual(new Uint8Array(img.bytes), bytes);
  assert.ok(await b.store.getPhoto(photoId), 'cached locally after the first fetch');

  await b.store.removePhoto(card.id, photoId);
  await b.sync.syncNow();
  assert.equal(gas.doPost({ action: 'getImage', auth: (await deriveKeys(b.store.kv.sync.key)).auth, id: photoId }).error, 'not_found');
});

test('a wrong pairing code or an already-claimed sheet is reported clearly', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 50_000_000 };
  const a = await device(net, clock);
  await a.sync.connectNew(URL_);
  const b = await device(net, clock);
  await assert.rejects(b.sync.connectNew(URL_), { code: 'already_claimed' });
  await assert.rejects(b.sync.join(makePairingCode(URL_, randomKey())), { code: 'unauthorized' });
  await assert.rejects(b.sync.join('hello'), { code: 'invalid_code' });
  assert.equal(b.sync.configured(), false);
});

test('email reminders: opt-in is shared, either phone keeps the list current, re-sent only on change', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 60_000_000 };
  const a = await device(net, clock);
  await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100, expiry: '2026-12-01', code: 'SECRET-CODE' });
  await a.sync.connectNew(URL_);
  assert.ok(!net.calls.includes('reminders'));

  await a.store.setHouseholdSetting('reminders', { enabled: true, emails: ['a@example.com'], days: [30, 7, 1] });
  await a.sync.syncNow();
  const sent = () => net.calls.filter((c) => c === 'reminders').length;
  assert.equal(sent(), 1);
  const rows = () => JSON.stringify(gas.sheets.get('reminders').rows);
  assert.ok(rows().includes('BuyMe') && !rows().includes('SECRET-CODE'));

  await a.sync.syncNow();
  assert.equal(sent(), 1, 'unchanged summary is not re-sent');

  // A card added on the other phone reaches the emailed list without phone A.
  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());
  assert.equal(b.store.householdSetting('reminders').enabled, true);
  await b.store.createCard({ type: 'credit', store: 'Zara', initialAmount: 80, expiry: '2026-12-20' });
  await b.sync.syncNow();
  assert.ok(rows().includes('Zara'));

  await a.sync.syncNow();
  await a.store.setHouseholdSetting('reminders', { ...a.store.householdSetting('reminders'), enabled: false });
  await a.sync.syncNow();
  assert.equal(gas.triggers.length, 0);
});

test('emptying the bin on one phone wins over a restore on the other, and keeps purchases', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 70_000_000 };
  const a = await device(net, clock);
  const card = await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 500, code: 'SECRET' });
  await a.store.addTx(card.id, { type: 'use', amount: 400, note: 'מתנה' });
  await a.store.deleteCard(card.id);
  await a.sync.connectNew(URL_);
  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());

  net.online = false;
  await a.store.purgeCards([card.id]);
  await b.store.restoreCard(card.id);
  net.online = true;
  await b.sync.syncNow();
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();

  for (const d of [a, b]) {
    const rec = d.store.exportRecords().find((r) => r.id === card.id);
    assert.equal(rec.purged, true, 'purge wins');
    assert.equal(rec.code, undefined);
    const txs = d.store.snapshot().txs.filter((t) => t.cardId === card.id);
    assert.ok(txs.every((t) => !t.deleted && t.note === ''), 'purchases kept, notes blanked');
  }
  assert.equal(a.store.dirtyRecords().length + b.store.dirtyRecords().length, 0);
});

test('two phones correcting the balance to the same number agree', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 80_000_000 };
  const a = await device(net, clock);
  const card = await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 });
  await a.sync.connectNew(URL_);
  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());
  await a.store.addTx(card.id, { type: 'adjust', balance: 80 });
  await b.store.addTx(card.id, { type: 'adjust', balance: 80 });
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(balanceOf(a, card.id), 80);
  assert.equal(balanceOf(b, card.id), 80);
});

test('a photo removed on one phone is dropped from the other phone and its backups', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 90_000_000 };
  const a = await device(net, clock);
  const card = await a.store.createCard({ type: 'credit', store: 'Fox', initialAmount: 50 });
  const photoId = await a.store.addPhoto(card.id, new Uint8Array([9, 9, 9]).buffer);
  await a.sync.connectNew(URL_);
  const b = await device(net, clock);
  await b.sync.join(a.sync.pairingCode());
  assert.ok(await b.sync.fetchPhoto(photoId));
  await a.store.removePhoto(card.id, photoId);
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(await b.store.getPhoto(photoId), undefined);
  const { buildBackup } = await import('../js/lib/backup.js');
  assert.equal((await buildBackup(b.store)).photos.length, 0);
});

test('a lost reply to the first claim can be retried with the same URL', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 100_000_000 };
  const a = await device(net, clock);
  let dropNext = true;
  // The server handles the request; only the reply is lost on the way back.
  const lossy = async (url, opts) => {
    const body = await (await net.fetch(url, opts)).text();
    if (dropNext && JSON.parse(opts.body).action === 'hello') {
      dropNext = false;
      throw new TypeError('connection reset');
    }
    return { ok: true, status: 200, text: async () => body };
  };
  const flaky = createSync({ store: a.store, fetchImpl: lossy, now: () => clock.t });
  await assert.rejects(flaky.connectNew(URL_), { code: 'unreachable' });
  assert.equal(gas.doGet().claimed, true, 'the server did claim');
  await flaky.connectNew(URL_);
  assert.equal(flaky.state.status, 'idle');
});

test('a failed join leaves the device unconnected, and a later join works', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 110_000_000 };
  const a = await device(net, clock);
  await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 });
  await a.sync.connectNew(URL_);
  const b = await device(net, clock);
  let failPull = true;
  const failing = async (url, opts) => {
    if (failPull && JSON.parse(opts.body).action === 'pull') throw new TypeError('network down');
    return net.fetch(url, opts);
  };
  const syncB = createSync({ store: b.store, fetchImpl: failing, now: () => clock.t });
  await assert.rejects(syncB.join(a.sync.pairingCode()));
  assert.equal(syncB.configured(), false);
  assert.notEqual(syncB.state.status, 'syncing');
  failPull = false;
  await syncB.join(a.sync.pairingCode());
  assert.equal(syncB.configured(), true);
  assert.equal(b.store.snapshot().cards.length, 1);
});

test('disconnecting waits for a sync that is still running', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 120_000_000 };
  const a = await device(net, clock);
  await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 });
  let release;
  const gate = new Promise((r) => { release = r; });
  let slow = false;
  const slowFetch = async (url, opts) => {
    if (slow && JSON.parse(opts.body).action === 'pull') await gate;
    return net.fetch(url, opts);
  };
  const sync = createSync({ store: a.store, fetchImpl: slowFetch, now: () => clock.t });
  await sync.connectNew(URL_);
  slow = true;
  const running = sync.syncNow();
  let disconnected = false;
  const disc = sync.disconnect().then(() => { disconnected = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(disconnected, false, 'disconnect waits');
  release();
  await running;
  await disc;
  assert.equal(sync.configured(), false);
  assert.equal(await sync.syncNow(), false);
});

test('a server row this device cannot decrypt does not block sync and gets repaired', async () => {
  const gas = createMockGas();
  const net = network(gas);
  const clock = { t: 130_000_000 };
  const a = await device(net, clock);
  const card = await a.store.createCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 });
  await a.sync.connectNew(URL_);
  // Someone with another key overwrote the card's row with a newer version.
  const auth = (await deriveKeys(a.store.kv.sync.key)).auth;
  const other = await deriveKeys(randomKey());
  const bad = await encryptJSON(other.encKey, { id: card.id, kind: 'card', store: 'X' }, card.id);
  gas.doPost({ action: 'push', auth, records: [{ id: card.id, ts: clock.t + 1_000_000, dev: 'zz', blob: bad }] });

  await a.store.updateCard(card.id, { notes: 'still works' });
  assert.equal(await a.sync.syncNow(), true);
  assert.equal(await a.sync.syncNow(), true);
  const row = gas.doPost({ action: 'pull', auth, since: 0 }).records.find((r) => r.id === card.id);
  const k = await deriveKeys(a.store.kv.sync.key);
  assert.equal((await decryptJSON(k.encKey, row.blob, card.id)).notes, 'still works', 'our copy replaced the unreadable one');
});
