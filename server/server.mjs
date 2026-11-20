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

export function createServer({ port = Number(process.env.PORT) || 8080, host = process.env.HOST || '0.0.0.0', quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  const hub = new Hub({ log });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...hub.stats() }));
      return;
    }
    let p = decodeURIComponent(url.pathname);
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
    if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
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
  server.on('close', () => clearInterval(beat));
  return new Promise((resolve) => server.listen(port, host, () => {
    log(`Nitro Rivale läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}  (Spiel: ${ROOT})`);
    resolve({ server, hub, port: server.address().port });
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer();
  process.on('SIGTERM', () => process.exit(0));
}
