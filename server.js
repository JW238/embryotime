// Minimal static file server for local use: `npm start`, then open http://localhost:5173
// (ES modules cannot be loaded from file:// URLs, so the app needs to be served.)
//
// SITE_ROOT serves another folder (e.g. the built `docs/` release); PORT=0 picks a free port.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SITE_ROOT ? resolve(process.env.SITE_ROOT) : fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 5173;
const HOST = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
// Only site files are served — never tests, scripts, package files or local tooling.
const PUBLIC = [/^index\.html$/, /^(r\/[0-9a-f]{10}\/)?styles\.css$/, /^(r\/[0-9a-f]{10}\/)?src\/[\w./-]+\.js$/];

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const rel = normalize(path === '/' ? 'index.html' : path.slice(1)).split(sep).join('/');
  if (rel.startsWith('..') || rel.includes('../') || !PUBLIC.some((re) => re.test(rel))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`EmbryoTime running at http://localhost:${server.address().port}`);
});
