// ---------------------------------------------------------------------------
// Schlanker WebSocket-Server (RFC 6455) ohne Fremdpakete.
// Unterstützt Text-Nachrichten, Fragmentierung, Ping/Pong, sauberes Schließen.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 256 * 1024;

export class WSConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  send(text) {
    if (!this.open) return;
    const payload = Buffer.from(text, 'utf8');
    const n = payload.length;
    let head;
    if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
    else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    head[0] = 0x81; // FIN + Text
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }

  _ctrl(op, payload = Buffer.alloc(0)) {
    if (!this.open) return;
    const head = Buffer.from([0x80 | op, payload.length]);
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }

  ping() { this.alive = false; this._ctrl(0x9); }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    this._ctrl(0x8, p);
    this.open = false;
    setTimeout(() => this.socket.destroy(), 200);
    this.onclose?.();
    this.onclose = null;
  }

  _closed() {
    if (!this.open && !this.onclose) return;
    this.open = false;
    this.onclose?.();
    this.onclose = null;
    this.socket.destroy();
  }

  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) return this.close(1009); len = Number(big); off = 10; }
      if (len > MAX_MSG) return this.close(1009);
      if (!masked) return this.close(1002); // Clients müssen maskieren
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.alive = true;
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._ctrl(0xa, data); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frags.push(data);
        const total = this.frags.reduce((a, b) => a + b.length, 0);
        if (total > MAX_MSG) return this.close(1009);
        if (fin) {
          const msg = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          try { this.onmessage?.(msg); } catch (err) { console.error('Nachricht fehlgeschlagen:', err); }
        }
      }
    }
  }
}

// HTTP-Upgrade annehmen; gibt eine WSConn zurück oder null
export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  return new WSConn(socket);
}
