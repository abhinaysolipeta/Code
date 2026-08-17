// Local-first HTTP server: static frontend + JSON API, no dependencies.
// Binds to 127.0.0.1 by default -- this data should not leave the machine
// unless the operator explicitly asks it to.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HttpError, handleApi } from './api.js';
import { Store } from './store.js';
import { ValidationError } from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.FINANCE_DATA || path.join(ROOT, 'data', 'finance.json');
const MAX_BODY = 12 * 1024 * 1024; // generous enough for a multi-year CSV import

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const store = new Store(DATA_FILE);
store.load();

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Resolve a URL path to a file inside one of the served roots, or null. */
function resolveStatic(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');

  const candidates = rel.startsWith('shared/')
    ? [path.join(SHARED_DIR, rel.slice('shared/'.length))]
    : [path.join(PUBLIC_DIR, rel)];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    // Containment check defeats ../ traversal.
    const inPublic = resolved.startsWith(PUBLIC_DIR + path.sep);
    const inShared = resolved.startsWith(SHARED_DIR + path.sep);
    if (!inPublic && !inShared) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = handleApi(store, req.method, pathname, url.searchParams, body);

      // Handlers may ask for a raw (non-JSON) response, e.g. CSV downloads.
      if (result && typeof result === 'object' && result.__raw !== undefined) {
        return send(res, 200, result.__raw, {
          'Content-Type': result.__contentType ?? 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.__filename ?? 'export.txt'}"`,
        });
      }
      return sendJson(res, 200, result ?? { ok: true });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const file = resolveStatic(pathname);
    if (!file) {
      // Unknown non-asset paths fall through to the SPA shell.
      if (path.extname(pathname)) return sendJson(res, 404, { error: 'Not found' });
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')), {
        'Content-Type': 'text/html; charset=utf-8',
      });
    }

    return send(res, 200, fs.readFileSync(file), {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    });
  } catch (err) {
    const status = err.status ?? (err instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error('[error]', err);
    return sendJson(res, status, {
      error: err.message ?? 'Something went wrong',
      field: err.field,
    });
  }
});

server.listen(PORT, HOST, () => {
  const empty = store.db.accounts.length === 0;
  console.log('');
  console.log('  LedgerLight — household finance monitor');
  console.log(`  ▸ http://${HOST}:${PORT}`);
  console.log(`  ▸ data: ${DATA_FILE}`);
  if (empty) console.log('  ▸ no accounts yet — run `npm run seed` for demo data, or add yours in the app');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=4400 npm start`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
