// Local static server for running the app on this computer.
//   npm start                 http://localhost:8080
//   npm run dev               same, plus an emulated sync backend at /mock-gas/exec
// It listens on loopback only. Phones use the GitHub Pages copy instead (this laptop's
// firewall policy blocks inbound connections, so a phone could not reach it anyway).

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockGas } from './mock-gas.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(argValue('--port') || process.env.PORT || 8080);
const MOCK = args.includes('--mock-backend') || process.env.MOCK_BACKEND === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.gs': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Only the files GitHub Pages would serve as the app; never .git, .env, tests or scripts.
const PUBLIC = /^\/(?:index\.html|manifest\.webmanifest|sw\.js|(?:css|js|icons|fonts|backend)\/[\w./-]+)$/;

let gas = MOCK ? createMockGas() : null;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const cors = { 'Access-Control-Allow-Origin': '*' };

  // Lets the end-to-end test start from an empty, unclaimed backend.
  if (gas && url.pathname === '/mock-gas/reset' && req.method === 'POST') {
    gas = createMockGas();
    return send(res, 200, 'reset', cors);
  }

  if (gas && url.pathname === '/mock-gas/exec') {
    if (req.method === 'OPTIONS') return send(res, 204, '', { ...cors, 'Access-Control-Allow-Headers': 'Content-Type' });
    const json = { 'Content-Type': 'application/json; charset=utf-8', ...cors };
    if (req.method === 'GET') return send(res, 200, JSON.stringify(gas.doGet()), json);
    if (req.method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, JSON.stringify(gas.doPost(body)), json);
    }
    return send(res, 405, 'method not allowed');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  if (!PUBLIC.test(path) || path.includes('..')) return send(res, 404, 'not found');
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT + sep))) return send(res, 404, 'not found');
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return send(res, 404, 'not found');
  }
  if (!stat.isFile()) return send(res, 404, 'not found');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const listener = (req, res) => handle(req, res).catch((e) => send(res, 500, String(e?.message || e)));

let started = 0;
for (const host of ['127.0.0.1', '::1']) {
  const server = http.createServer(listener);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use on ${host}. Try: npm start -- --port 8090`);
      process.exit(1);
    }
    if (e.code !== 'EADDRNOTAVAIL' && e.code !== 'EAFNOSUPPORT') throw e;
  });
  server.listen(PORT, host, () => {
    if (++started === 1) {
      console.log(`Gift Wallet running at http://localhost:${PORT}/`);
      if (gas) console.log(`Mock sync backend: http://localhost:${PORT}/mock-gas/exec (paste this URL in Settings > Sync)`);
    }
  });
}
