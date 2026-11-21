// ---------------------------------------------------------------------------
// Nitro-Rivale-Server: liefert das Spiel aus (dist/) und betreibt die
// Mehrspieler-Räume unter /ws. Keine Fremdpakete nötig: `node server/server.mjs`
// ---------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './ws.mjs';
import { Hub } from './rooms.mjs';
import { Saves } from './saves.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.GAME_DIR || path.join(here, '..', 'dist'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const ZIP = new Set(['.html', '.js', '.json', '.svg']);
const zcache = new Map();
function gzipped(file, st) {
  const c = zcache.get(file);
  if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.buf;
  const buf = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
  zcache.set(file, { mtime: st.mtimeMs, size: st.size, buf });
  return buf;
}

// Spielstände: die Spielseite liegt evtl. woanders (pages.dev) – darum CORS, ohne Cookies
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (res, code, obj) => { res.writeHead(code, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

export function createServer({ port = Number(process.env.PORT) || 8080, host = process.env.HOST || '0.0.0.0', quiet = false, dataDir = process.env.DATA_DIR || path.join(here, '..', 'data') } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  const hub = new Hub({ log });
  const saves = new Saves({ dir: dataDir, log });
  const hits = new Map(); // einfache Drosselung je IP: 60 Spielstand-Anfragen pro Minute
  const limited = (req) => {
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    const now = Date.now(), h = hits.get(ip);
    if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
    return ++h.n > 60;
  };
  const server = http.createServer((req, res) => {
    // kaputte Adressen ("/%", "/%00") würfen sonst eine Ausnahme und beendeten den ganzen Server
    let url, p;
    try { url = new URL(req.url, 'http://x'); p = decodeURIComponent(url.pathname); } catch { /* p bleibt leer */ }
    if (!p || p.includes('\0')) { res.writeHead(400); res.end(); return; }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...hub.stats(), ...saves.stats() }));
      return;
    }
    if (url.pathname === '/api/save') {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return; }
      if (limited(req)) { json(res, 429, { ok: false, msg: 'zu viele Anfragen' }); return; }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (d) => { body += d; if (body.length > 32000) { json(res, 413, { ok: false }); req.destroy(); } });
      req.on('end', () => { if (res.headersSent) return; const [code, out] = saves.handle(body); json(res, code, out); });
      return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(ROOT, '.' + p);
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Nicht gefunden'); return; }
      const ext = path.extname(file).toLowerCase();
      const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' };
      // Text (vor allem die 5-MB-Spielseite) gepackt ausliefern – einmal packen, dann aus dem Speicher
      if (ZIP.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const buf = gzipped(file, st);
        res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': buf.length, vary: 'accept-encoding' });
        res.end(req.method === 'HEAD' ? undefined : buf);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': st.size });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
  });
  server.on('upgrade', (req, socket) => {
    let ws = false;
    try { ws = new URL(req.url, 'http://x').pathname === '/ws'; } catch { /* kaputte Adresse */ }
    if (!ws) { socket.destroy(); return; }
    const conn = acceptUpgrade(req, socket);
    if (!conn) return;
    const c = hub.connect(conn);
    conn.onmessage = (msg) => hub.message(c, msg);
    conn.onclose = () => hub.disconnect(c);
  });
  // Tote Verbindungen aufräumen
  const beat = setInterval(() => {
    for (const c of hub.clients.values()) {
      if (!c.conn.alive) { c.conn.close(1001); hub.disconnect(c); continue; }
      c.conn.ping();
    }
  }, 15000);
  server.on('close', () => { clearInterval(beat); saves.flush(); });
  return new Promise((resolve) => server.listen(port, host, () => {
    log(`Nitro Rivale läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}  (Spiel: ${ROOT})`);
    resolve({ server, hub, saves, port: server.address().port });
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ready = createServer();
  // Redeploy/Stopp: Spielstände noch schnell auf die Platte
  const stop = async () => { (await ready).saves.flush(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
