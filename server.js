'use strict';
/**
 * BLANION — Node adapter (no dependencies). For Cloudflare use src/index.js instead.
 * Run:  node server.js     (PORT, ADMIN_PASSWORD, LAUNCH_DATE, BLANION_DATA, TRUST_PROXY are optional env vars)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./lib/store');
const { createApp, SEC } = require('./lib/core');

S.load();
const PORT = Number(process.env.PORT) || 3000;
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.log(`[blanion] ADMIN_PASSWORD not set. Temporary admin password for this run: ${ADMIN_PASSWORD}`);
}
const app = createApp({ store: S, adminPassword: ADMIN_PASSWORD, reviewerPassword: process.env.REVIEWER_PASSWORD, botUserAgent: process.env.BOT_USER_AGENT });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20000) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/reviewer') pathname = '/reviewer.html';
  if (pathname === '/stack') pathname = '/stack.html';
  const root = path.join(__dirname, 'public');
  const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SEC }); return res.end('Lost at sea (404)'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300', ...SEC });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const ip = (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
      const out = await app.handle({ method: req.method, headers: req.headers, ip, json: () => readJson(req) }, url);
      res.writeHead(out.code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC });
      return res.end(JSON.stringify(out.body));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Something went wrong in the deep."}');
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`[blanion] listening on http://localhost:${PORT}  (admin at /admin)`));
  const bye = () => { S.flush(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  setInterval(app.autoFinalize, 30000).unref();
  setInterval(() => app.runBot(8).then(r => { if (r.checked) console.log('[blanion] bot', JSON.stringify({ checked: r.checked, approved: r.approved, merged: r.merged, rejected: r.rejected })); }).catch(e => console.error('[blanion] bot error', e.message)), 5 * 60e3).unref();
}
module.exports = { server };
