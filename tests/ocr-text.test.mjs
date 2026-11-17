import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderLine } from '../js/lib/ocr-text.js';

// Word boxes as Tesseract reported them for the fixtures (x positions in pixels).
const w = (text, x0) => ({ text, x0, x1: x0 + 10 });

test('Hebrew line with a grouped number reads right to left, as shown on screen', () => {
  // On screen: "קוד שובר: 8820 1145 6673" with 8820 rightmost.
  const words = [w('6673', 397), w('1145', 464), w('8820', 526), w('קוד', 657), w('שובר:', 592)];
  assert.equal(orderLine(words), 'קוד שובר: 8820 1145 6673');
});

test('consecutive Latin words keep their own order inside a Hebrew line', () => {
  const words = [w('גיפט', 357), w('קארד', 293), w('BUYME', 411), w('ALL', 507), w('250', 560), w('בשווי', 612), w('₪', 671)];
  assert.equal(orderLine(words), '₪ בשווי 250 BUYME ALL גיפט קארד');
});

test('a line with no Hebrew reads left to right', () => {
  assert.equal(orderLine([w('85%', 700), w('10:42', 30)]), '10:42 85%');
  assert.equal(orderLine([w('BuyMe', 594)]), 'BuyMe');
});

test('empty words are dropped', () => {
  assert.equal(orderLine([w('', 10), w('  ', 20)]), '');
  assert.equal(orderLine([]), '');
});
