// Code 128 barcode encoder (code sets B and C) with SVG output, so a credit note's number
// can be shown on screen for the cashier's scanner. Scanners read the data, not the
// symbology the store printed, so Code 128 works for numbers printed as EAN or Code 39.

// Bar/space widths for symbol values 0..106 (106 is the stop pattern).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const TO_C = 99;
const TO_B = 100;
const STOP = 106;

export { PATTERNS };

// Code set B covers printable ASCII (space through "~").
export function canEncode(text) {
  const s = String(text ?? '');
  if (!s || s.length > 80) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

const isDigit = (ch) => ch >= '0' && ch <= '9';

function digitRun(s, from) {
  let j = from;
  while (j < s.length && isDigit(s[j])) j++;
  return j - from;
}

// Symbol values including start, checksum and stop. `force` pins a single code set
// ('B', or 'C' for even-length digit strings), which the tests use to compare against a
// reference implementation; the default switches to C for runs of digits.
export function encodeValues(text, { force } = {}) {
  const s = String(text);
  if (!canEncode(s)) return null;
  const values = [];
  let set;
  const firstRun = digitRun(s, 0);
  if (force === 'C') {
    if (firstRun !== s.length || s.length % 2) return null;
    set = 'C';
  } else if (force === 'B') {
    set = 'B';
  } else {
    set = (firstRun === s.length && firstRun % 2 === 0) || firstRun >= 4 ? 'C' : 'B';
  }
  values.push(set === 'C' ? START_C : START_B);

  let i = 0;
  while (i < s.length) {
    if (set === 'C') {
      if (digitRun(s, i) >= 2) {
        values.push(Number(s.slice(i, i + 2)));
        i += 2;
      } else {
        values.push(TO_B);
        set = 'B';
      }
      continue;
    }
    const run = force === 'B' ? 0 : digitRun(s, i);
    // Switching costs one symbol, so it pays off for 4+ digits at the end or 6+ inside.
    if (run >= 6 || (run >= 4 && i + run === s.length)) {
      if (run % 2) {
        values.push(s.charCodeAt(i) - 32);
        i++;
      }
      values.push(TO_C);
      set = 'C';
      continue;
    }
    values.push(s.charCodeAt(i) - 32);
    i++;
  }

  let sum = values[0];
  for (let k = 1; k < values.length; k++) sum += values[k] * k;
  values.push(sum % 103, STOP);
  return values;
}

// "1" for a bar module, "0" for a space module, start through stop (no quiet zone).
export function encodeModules(text, opts) {
  const values = encodeValues(text, opts);
  if (!values) return null;
  let out = '';
  for (const v of values) {
    const widths = PATTERNS[v];
    for (let k = 0; k < widths.length; k++) out += (k % 2 ? '0' : '1').repeat(Number(widths[k]));
  }
  return out;
}

export function code128Svg(text, { height = 80, quiet = 10 } = {}) {
  const modules = encodeModules(text);
  if (!modules) return null;
  const width = modules.length + quiet * 2;
  let rects = '';
  for (let x = 0; x < modules.length;) {
    if (modules[x] === '1') {
      let w = 1;
      while (modules[x + w] === '1') w++;
      rects += `<rect x="${x + quiet}" y="0" width="${w}" height="${height}"/>`;
      x += w;
    } else {
      x++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img"><rect width="${width}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

// The value printed under a barcode is often grouped with spaces ("1234 5678"); the
// encoded value drops them so the scanner gets the bare number.
export function barcodeValue(raw) {
  const s = String(raw || '').trim();
  return /^[\d\s-]+$/.test(s) ? s.replace(/[\s-]/g, '') : s;
}
