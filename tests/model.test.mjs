import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeView, buildViews, filterViews, sortViews, summarize, insights, validateCard, cleanCard, matchesQuery } from '../js/lib/model.js';
import { daysBetween, addMonths, addYears, expiryLabel, relativeDays, formatDate, isISODate } from '../js/lib/dates.js';
import { parseAmount, formatMoney } from '../js/lib/money.js';
import { suggestStores, findStore, storeInitials, normalizeText } from '../js/lib/catalog.js';

const TODAY = '2026-11-13';
let n = 0;
const card = (over = {}) => ({ id: `c${++n}`, kind: 'card', type: 'giftcard', store: 'BuyMe', initialAmount: 200, currency: 'ILS', expiry: '2027-06-01', owner: 'shared', createdAt: n, ...over });
const tx = (cardId, type, amount, over = {}) => ({
  id: `t${++n}`, kind: 'tx', cardId, type, amount, date: TODAY, createdAt: n,
  ...(type === 'use' ? { delta: -amount } : type === 'load' ? { delta: amount } : {}),
  ...over,
});

test('date math', () => {
  assert.equal(daysBetween('2026-11-13', '2026-11-14'), 1);
  assert.equal(daysBetween('2026-03-26', '2026-03-29'), 3); // across the Israeli DST change
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addYears('2028-02-29', 1), '2029-02-28');
  assert.equal(formatDate('2026-12-01'), '01/12/2026');
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(expiryLabel(0), 'פג היום');
  assert.equal(expiryLabel(12), 'עוד 12 ימים');
  assert.equal(expiryLabel(-3), 'פג לפני 3 ימים');
  assert.equal(relativeDays(2), 'בעוד יומיים');
  assert.equal(relativeDays(400), 'בעוד שנה');
  assert.equal(relativeDays(60), 'בעוד חודשיים');
});

test('amount parsing', () => {
  assert.equal(parseAmount('200'), 200);
  assert.equal(parseAmount('1,250'), 1250);
  assert.equal(parseAmount('149.90'), 149.9);
  assert.equal(parseAmount('149,9'), 149.9);
  assert.equal(parseAmount('₪ 80'), 80);
  assert.equal(parseAmount('1.234,50'), 1234.5);
  assert.equal(parseAmount('abc'), null);
  assert.match(formatMoney(200), /200/);
  assert.match(formatMoney(149.9), /149\.90/);
});

test('balance is the initial amount plus the live ledger', () => {
  const c = card();
  const v = computeView(c, [tx(c.id, 'use', 50), tx(c.id, 'load', 20), tx(c.id, 'use', 30, { deleted: true })], TODAY);
  assert.equal(v.balance, 170);
  assert.equal(v.spent, 50);
  assert.equal(v.status, 'active');
  assert.deepEqual(v.ledger.map((l) => l.balanceAfter), [150, 170]);
});

test('statuses', () => {
  assert.equal(computeView(card({ expiry: '2026-11-20' }), [], TODAY).status, 'expiring');
  assert.equal(computeView(card({ expiry: '2026-11-20' }), [], TODAY).urgent, true);
  assert.equal(computeView(card({ expiry: '2026-12-10' }), [], TODAY).urgent, false);
  assert.equal(computeView(card({ expiry: TODAY }), [], TODAY).status, 'expiring');
  assert.equal(computeView(card({ expiry: '2026-11-12' }), [], TODAY).status, 'expired');
  assert.equal(computeView(card({ expiry: null }), [], TODAY).status, 'active');
  const c = card();
  assert.equal(computeView(c, [tx(c.id, 'use', 200)], TODAY).status, 'used');
  const v = card({ type: 'voucher', initialAmount: null });
  assert.equal(computeView(v, [], TODAY).balance, null);
  assert.equal(computeView(v, [tx(v.id, 'redeem', null)], TODAY).status, 'used');
  assert.equal(computeView(card({ archived: true }), [], TODAY).status, 'archived');
  assert.equal(computeView(card({ deleted: true }), [], TODAY).status, 'deleted');
});

test('filtering, search across spellings, sorting and totals', () => {
  const a = card({ store: 'BuyMe', expiry: '2026-11-20', initialAmount: 300 });
  const b = card({ store: 'פוקס', type: 'credit', expiry: '2027-01-01', initialAmount: 150, notes: 'מהחזרת מעיל' });
  const c = card({ store: 'שופרסל', type: 'credit', expiry: '2026-10-01', initialAmount: 80 });
  const d = card({ store: 'קופון', type: 'coupon', initialAmount: null, expiry: null, currency: 'USD' });
  const views = buildViews([a, b, c, d], [tx(a.id, 'use', 100)], TODAY);
  assert.equal(filterViews(views, { group: 'active' }).length, 3);
  assert.equal(filterViews(views, { group: 'expired' })[0].card.id, c.id);
  assert.equal(filterViews(views, { group: 'active', query: 'ביימי' })[0].card.id, a.id);
  assert.equal(filterViews(views, { group: 'active', query: 'fox' })[0].card.id, b.id);
  assert.equal(filterViews(views, { group: 'active', query: 'מעיל' })[0].card.id, b.id);
  assert.equal(filterViews(views, { group: 'active', type: 'credit' }).length, 1);
  assert.deepEqual(sortViews(filterViews(views, {}), 'expiry').map((v) => v.card.id), [a.id, b.id, d.id]);
  assert.deepEqual(sortViews(filterViews(views, {}), 'balance').map((v) => v.card.id), [a.id, b.id, d.id]);
  const s = summarize(views);
  assert.deepEqual(s.totals, { ILS: 350 });
  assert.equal(s.activeCount, 3);
  assert.equal(s.expiringCount, 1);
  assert.equal(s.counts.expired, 1);
  const ins = insights(views, 2026);
  assert.deepEqual(ins.usedThisYear, { ILS: 100 });
  assert.deepEqual(ins.lostToExpiry, { ILS: 80 });
  assert.equal(ins.topStores[0].store, 'BuyMe');
});

test('search ignores final letters, quotes and spacing', () => {
  const v = computeView(card({ store: 'סופר-פארם', title: 'שובר יום הולדת' }), [], TODAY);
  assert.ok(matchesQuery(v, 'סופרפארם'));
  assert.ok(matchesQuery(v, 'super'));
  assert.ok(matchesQuery(v, 'הולדת'));
  assert.ok(!matchesQuery(v, 'קסטרו'));
  assert.equal(normalizeText('ש"ח'), 'שח');
});

test('validation', () => {
  assert.deepEqual(validateCard({ type: 'giftcard', store: 'BuyMe', initialAmount: 100 }), {});
  assert.ok(validateCard({ type: 'giftcard', store: '', initialAmount: 100 }).store);
  assert.ok(validateCard({ type: 'credit', store: 'Fox' }).initialAmount);
  assert.deepEqual(validateCard({ type: 'voucher', store: 'ארומה' }), {});
  assert.ok(validateCard({ type: 'giftcard', store: 'x', initialAmount: 100, openingBalance: 150 }).openingBalance);
  assert.ok(validateCard({ type: 'giftcard', store: 'x', initialAmount: 100, link: 'javascript:alert(1)' }).link);
  assert.equal(cleanCard({ link: 'javascript:alert(1)' }).link, '');
  assert.equal(cleanCard({ type: 'nope' }).type, 'giftcard');
});

test('store catalog', () => {
  assert.equal(findStore('ביימי').name, 'BuyMe');
  assert.equal(findStore('super pharm')?.name, 'סופר-פארם');
  assert.equal(suggestStores('פו')[0], 'Fox');
  assert.equal(suggestStores('', ['החנות של שלומי'])[0], 'החנות של שלומי');
  assert.equal(storeInitials('Terminal X'), 'TX');
  assert.equal(storeInitials('שופרסל'), 'ש');
});
