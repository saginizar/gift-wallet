// QR code as an SVG string, built on the vendored qrcode-generator.

import qrcode from '../vendor/qrcode.js';

const utf8 = new TextEncoder();
// The library's default byte conversion keeps only the low byte of each UTF-16 unit.
qrcode.stringToBytes = (s) => Array.from(utf8.encode(s));

export function qrSvg(text, { ecc = 'M', margin = 2, dark = '#000', light = '#fff' } = {}) {
  const qr = qrcode(0, ecc);
  qr.addData(String(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img"><rect width="${size}" height="${size}" fill="${light}"/><path fill="${dark}" d="${path}"/></svg>`;
}
