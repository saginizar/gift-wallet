import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appAssets, assetsVersion, onDemandAssets } from '../scripts/stamp-sw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sources = appAssets().filter((p) => p.endsWith('.js') && !p.includes('/vendor/'));

test('sw.js precaches every app file under the current version (npm run stamp)', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes(`const VERSION = '${assetsVersion()}'`), 'sw.js is not stamped; run npm run stamp');
  for (const asset of appAssets()) assert.ok(sw.includes(`'${asset}'`), `${asset} missing from sw.js`);
});

test('every relative import points at a precached file', () => {
  const assets = new Set(appAssets());
  for (const file of sources) {
    for (const m of read(file).matchAll(/from '(\.[^']+)'/g)) {
      const target = normalize(join(dirname(file), m[1])).split('\\').join('/');
      assert.ok(existsSync(join(ROOT, target)), `${file} imports missing ${m[1]}`);
      assert.ok(assets.has(target), `${target} (imported by ${file}) is not precached`);
    }
  }
});

test('text recognition files exist and are cached on demand, not at install', () => {
  const onDemand = new Set(onDemandAssets());
  const ocr = read('js/lib/ocr.js');
  const dynamic = [...ocr.matchAll(/import\('(\.[^']+)'\)/g)].map((m) => normalize(join('js/lib', m[1])).split('\\').join('/'));
  assert.deepEqual(dynamic, ['js/vendor/tesseract/tesseract.esm.min.js']);
  for (const f of [...dynamic, 'js/vendor/tesseract/worker.min.js', 'ocr/heb.traineddata.gz', 'ocr/eng.traineddata.gz',
    'ocr/tesseract-core-simd-lstm.wasm.js', 'ocr/tesseract-core-lstm.wasm.js']) {
    assert.ok(existsSync(join(ROOT, f)), `${f} missing`);
    assert.ok(onDemand.has(f), `${f} is not in the on-demand cache`);
  }
  assert.ok(!appAssets().some((a) => a.startsWith('ocr/') || a.includes('/tesseract/')), 'OCR files must not be precached');
  assert.match(read('sw.js'), /const OCR_VERSION = 'gw-ocr-[0-9a-f]{12}'/);
  assert.match(read('index.html'), /'wasm-unsafe-eval'/);
});

test('no regex lookbehind: Safari before 16.4 fails to parse the module', () => {
  for (const file of sources) assert.doesNotMatch(read(file), /\(\?<[=!]/, file);
});

test('the page loads only same-origin scripts and styles', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script(?![^>]*src="js\/)[^>]*>/, 'inline or external script');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
});
