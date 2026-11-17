// Renders icons/icon.svg into the PNG sizes the PWA manifest and iOS need.
// One-off tooling: needs @resvg/resvg-js, which is not a project dependency.
//   npm install --no-save @resvg/resvg-js && node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Resvg } = require(process.env.RESVG_PATH || '@resvg/resvg-js');

const root = new URL('../icons/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', root), 'utf8');

// Maskable icons are cropped to a circle by Android, so the artwork sits inside the
// 80% safe zone on a full-bleed background with no rounded corners.
const maskable = svg
  .replace('<rect width="512" height="512" rx="112" fill="url(#bg)"/>',
    '<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(51.2 51.2) scale(0.8)">')
  .replace('</svg>', '</g></svg>');

// iOS fills transparent corners with black, so the touch icon is full-bleed too.
const square = svg.replace('rx="112" fill="url(#bg)"', 'fill="url(#bg)"');

const outputs = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', square, 180],
];

for (const [name, source, size] of outputs) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(name, root), png);
  console.log(`${name} ${size}px ${png.length} bytes`);
}
