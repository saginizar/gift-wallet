import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appAssets, assetsVersion } from '../scripts/stamp-sw.mjs';

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

test('no regex lookbehind: Safari before 16.4 fails to parse the module', () => {
  for (const file of sources) assert.doesNotMatch(read(file), /\(\?<[=!]/, file);
});

test('the page loads only same-origin scripts and styles', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script(?![^>]*src="js\/)[^>]*>/, 'inline or external script');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
});
