import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, encodeModules, encodeValues, canEncode, code128Svg, barcodeValue } from '../js/lib/code128.js';

// Reference encodings produced by JsBarcode 3 (its CODE128B and CODE128C classes).
const FIXTURES = [
  ['Hello World', 'B', '110100100001100010100010110010000110010100001100101000010001111010110110011001110100011010001111010100100111101100101000010000100110101100011101100011101011'],
  ['BUYME-2026', 'B', '1101001000010001011000110111011101110110100010111011000100011010001001101110011001110010100111011001100111001011001110100110111000101100011101011'],
  ['abc~{}|', 'B', '1101001000010010110000100100001101000010110010001011110111101101101010001111010101111000101001100001100011101011'],
  ['X', 'B', '1101001000011100010110111011010001100011101011'],
  [' A1b2C3 ', 'B', '110100100001101100110010100011000100111001101001000011011001110010100010001101100101110011011001100100010111101100011101011'],
  ['Gift Card #42!', 'B', '110100100001101000100010000110100101100001001001111010011011001100100010001101001011000010010011110100001001101101100110010010011000110010011101100111001011001101100101111000101100011101011'],
  ['12', 'C', '1101001110010110011100100110011101100011101011'],
  ['123456', 'C', '11010011100101100111001000101100011100010110100011011101100011101011'],
  ['00998877665544332211', 'C', '1101001110011011001100101110111101111001001011110111010100100001101110100011010001101110101000110001100111010011000100100101110001101100011101011'],
  ['6001234567890123', 'C', '110100111001110111101011001101100111011011101011101100010000101100110110111101100110110011101101110100010110001100011101011'],
];

test('pattern table is well formed', () => {
  assert.equal(PATTERNS.length, 107);
  assert.equal(new Set(PATTERNS).size, 107);
  PATTERNS.forEach((p, i) => {
    const sum = [...p].reduce((a, b) => a + Number(b), 0);
    assert.equal(sum, i === 106 ? 13 : 11, `pattern ${i}`);
  });
});

test('matches the JsBarcode reference for fixed code sets', () => {
  for (const [text, set, expected] of FIXTURES) {
    assert.equal(encodeModules(text, { force: set }), expected, `${set}: ${text}`);
  }
});

// Decodes a module string back to text, to check the automatic code-set switching.
function decode(modules) {
  const widths = [];
  let run = 1;
  for (let i = 1; i <= modules.length; i++) {
    if (modules[i] === modules[i - 1]) run++;
    else {
      widths.push(run);
      run = 1;
    }
  }
  const values = [];
  // Every symbol is 6 elements; the 7-element stop pattern is the tail.
  for (let i = 0; i + 7 < widths.length; i += 6) {
    const idx = PATTERNS.indexOf(widths.slice(i, i + 6).join(''));
    assert.notEqual(idx, -1, `unknown symbol at element ${i}`);
    values.push(idx);
  }
  assert.equal(widths.slice(-7).join(''), PATTERNS[106], 'stop pattern');
  const check = values.pop();
  let sum = values[0];
  for (let k = 1; k < values.length; k++) sum += values[k] * k;
  assert.equal(sum % 103, check, 'checksum');
  let set = values[0] === 105 ? 'C' : 'B';
  let out = '';
  for (const v of values.slice(1)) {
    if (set === 'C') {
      if (v === 100) set = 'B';
      else out += String(v).padStart(2, '0');
    } else if (v === 99) set = 'C';
    else out += String.fromCharCode(v + 32);
  }
  return out;
}

test('automatic mode round-trips through a decoder', () => {
  for (const text of ['1234', '12345', 'AB1234567890', 'X12Y', '6001234567890123', 'CODE-2026-0042', '00012', 'a1b2c3d4e5', '9']) {
    assert.equal(decode(encodeModules(text)), text, text);
  }
});

test('automatic mode uses code set C for long digit runs', () => {
  assert.equal(encodeValues('123456')[0], 105);
  assert.equal(encodeValues('AB')[0], 104);
  assert.ok(encodeModules('6001234567890123').length < encodeModules('6001234567890123', { force: 'B' }).length);
});

test('rejects text Code 128 cannot carry', () => {
  assert.equal(canEncode('שובר'), false);
  assert.equal(canEncode(''), false);
  assert.equal(code128Svg('קוד'), null);
  assert.match(code128Svg('123'), /^<svg/);
});

test('barcodeValue strips grouping from numeric codes only', () => {
  assert.equal(barcodeValue('1234 5678-9012'), '123456789012');
  assert.equal(barcodeValue('AB 12'), 'AB 12');
});
