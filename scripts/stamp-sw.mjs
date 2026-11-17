// Writes the precache list and a content-hash version into sw.js. Run after changing
// any app file (`npm run stamp`); the version change is what makes phones update.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, filter) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, filter));
    else if (filter(name)) out.push(rel);
  }
  return out;
}

// Loaded on first scan and cached then (see sw.js): too big to download with the app.
export const isOnDemand = (p) => p.startsWith('ocr/') || p.startsWith('js/vendor/tesseract/');

export function onDemandAssets() {
  return [...walk('ocr', () => true), ...walk('js/vendor/tesseract', (n) => n.endsWith('.js'))]
    .map((p) => p.split(sep).join('/')).sort();
}

export function appAssets() {
  return [
    'index.html',
    'manifest.webmanifest',
    ...walk('css', (n) => n.endsWith('.css')),
    ...walk('js', (n) => n.endsWith('.js')).filter((p) => !isOnDemand(p)),
    ...walk('fonts', (n) => n.endsWith('.woff2')),
    ...walk('icons', (n) => /\.(png|svg)$/.test(n)),
    'backend/Code.gs',
  ].map((p) => p.split(sep).join('/')).sort();
}

export function assetsVersion(assets = appAssets()) {
  const hash = createHash('sha256');
  for (const p of assets) {
    hash.update(p);
    hash.update(readFileSync(join(ROOT, p)));
  }
  return `gw-${hash.digest('hex').slice(0, 12)}`;
}

// The on-demand cache has its own version, so an app update does not throw away the
// 5 MB the phone already downloaded unless the OCR files themselves changed.
export function stampedBlock(assets = appAssets()) {
  const list = assets.map((a) => `  '${a}',`).join('\n');
  const ocrVersion = assetsVersion(onDemandAssets()).replace('gw-', 'gw-ocr-');
  return `// <assets>\nconst VERSION = '${assetsVersion(assets)}';\nconst OCR_VERSION = '${ocrVersion}';\nconst ASSETS = [\n${list}\n];\n// </assets>`;
}

const isMain = process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '';
if (isMain) {
  const path = join(ROOT, 'sw.js');
  const sw = readFileSync(path, 'utf8');
  const next = sw.replace(/\/\/ <assets>[\s\S]*?\/\/ <\/assets>/, stampedBlock());
  writeFileSync(path, next);
  console.log(`sw.js stamped: ${assetsVersion()} (${appAssets().length} files)`);
}
