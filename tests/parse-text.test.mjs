import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGiftText } from '../js/lib/parse-text.js';

const today = '2026-11-13';

test('BuyMe gift SMS with link and amount', () => {
  const r = parseGiftText('היי דנה! קיבלת מתנה מיוסי 🎁 גיפט קארד BUYME ALL בשווי 300 ₪. לצפייה במתנה: https://buyme.co.il/giftcard/a1b2c3?utm=sms. בתוקף עד 12/11/2031', { today });
  assert.equal(r.store, 'BuyMe');
  assert.equal(r.type, 'giftcard');
  assert.equal(r.initialAmount, 300);
  assert.equal(r.currency, 'ILS');
  assert.equal(r.link, 'https://buyme.co.il/giftcard/a1b2c3?utm=sms');
  assert.equal(r.expiry, '2031-11-12');
});

test('store credit note text', () => {
  const r = parseGiftText('תודה שקנית בפוקס! זיכוי מספר 98765432 על סך 149.90 ש"ח, בתוקף עד 13.11.2028. לבירורים 03-1234567', { today });
  assert.equal(r.store, 'Fox');
  assert.equal(r.type, 'credit');
  assert.equal(r.initialAmount, 149.9);
  assert.equal(r.code, '98765432');
  assert.equal(r.expiry, '2028-11-13');
});

test('supermarket card with PIN', () => {
  const r = parseGiftText('כרטיס מתנה שופרסל: מספר כרטיס 6001 2345 6789 0123, קוד סודי 4821, יתרה 500 ש"ח', { today });
  assert.equal(r.store, 'שופרסל');
  assert.equal(r.code, '6001 2345 6789 0123');
  assert.equal(r.pin, '4821');
  assert.equal(r.initialAmount, 500);
  assert.equal(r.type, 'giftcard');
});

test('coupon with discount and short date', () => {
  const r = parseGiftText('קופון 20% הנחה בקסטרו! קוד קופון: CASTRO20 בתוקף עד 30/11/26', { today });
  assert.equal(r.store, 'קסטרו');
  assert.equal(r.type, 'coupon');
  assert.equal(r.code, 'CASTRO20');
  assert.equal(r.discount, '20% הנחה');
  assert.equal(r.expiry, '2026-11-30');
  assert.equal(r.initialAmount, undefined);
});

test('English email', () => {
  const r = parseGiftText('Your Amazon gift card. Claim code: ABCD-EFGH-1234. Amount: $50.00. Expires 2027-05-01.', { today });
  assert.equal(r.store, 'Amazon');
  assert.equal(r.code, 'ABCD-EFGH-1234');
  assert.equal(r.initialAmount, 50);
  assert.equal(r.currency, 'USD');
  assert.equal(r.expiry, '2027-05-01');
});

test('phone numbers and purchase dates are not codes or expiry', () => {
  const r = parseGiftText('נרכש ב-01/11/2026. לשירות: 0521234567. שובר מס\' 77712345678 בתוקף עד 01/11/2031', { today });
  assert.equal(r.code, '77712345678');
  assert.equal(r.expiry, '2031-11-01');
});

test('common English words do not become stores', () => {
  const r = parseGiftText('See you next time, have a big day. Code: 12345678', { today });
  assert.equal(r.store, undefined);
  assert.equal(r.code, '12345678');
});

test('empty input', () => {
  assert.deepEqual(parseGiftText('   ').found, []);
});
