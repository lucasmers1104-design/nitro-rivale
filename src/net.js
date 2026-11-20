// ---------------------------------------------------------------------------
// Verbindung zum Nitro-Rivale-Server (WebSocket, JSON-Nachrichten)
// ---------------------------------------------------------------------------
// Fester Spielserver: wird genutzt, wenn die Spielseite woanders liegt als der Server
// (z. B. auf nitro-rivale.pages.dev). Die Freunde sehen diese Adresse nicht.
export const GAME_SERVER = 'wss://nitro-server.traumcode.cloud/ws';

// Liefert die Serveradressen in der Reihenfolge, in der sie probiert werden
export function defaultServerUrl(custom) {
  if (custom) {
    let u = custom.trim();
    if (!/^wss?:\/\//.test(u)) u = (u.startsWith('localhost') || /^\d/.test(u) ? 'ws://' : 'wss://') + u;
    if (!/\/ws$/.test(u)) u = u.replace(/\/$/, '') + '/ws';
    return [u];
  }
  const list = [];
  const web = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.host;
  // Liegt die Seite auf unserem eigenen Server, läuft /ws gleich nebenan
  if (web && !/\.pages\.dev$/.test(location.hostname)) list.push((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  if (GAME_SERVER && !list.includes(GAME_SERVER)) list.push(GAME_SERVER);
  return list;
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.id = null;
    this.connected = false;
    this.rtt = 0;
    this.pingT = null;
  }
  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, msg) { const h = this.handlers.get(type); if (h) h(msg); }
  async connect(urls, timeout = 5000) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
    if (!list.length) throw new Error('Keine Serveradresse');
    let last;
    for (const u of list) {
      try { await this.connectOne(u, timeout); this.url = u; return this; } catch (err) { last = err; }
    }
    throw last;
  }
  connectOne(url, timeout) {
    return new Promise((resolve, reject) => {
      if (!url) { reject(new Error('Keine Serveradresse')); return; }
      let done = false;
      const fail = (err) => { if (done) return; done = true; try { ws?.close(); } catch { /* */ } reject(err); };
      // Läuft der Haupt-Thread gerade voll (Shader kompilieren, Strecke laden), kommt das
      // "welcome" verspätet an – ist die Leitung schon offen, wird einmal verlängert.
      let tm = setTimeout(function check(extended) {
        if (done) return;
        if (!extended && ws?.readyState === 1) { tm = setTimeout(() => check(true), timeout); return; }
        fail(new Error('Zeitüberschreitung'));
      }, timeout);
      let ws;
      try { ws = new WebSocket(url); } catch (err) { clearTimeout(tm); fail(err); return; }
      this.ws = ws;
      ws.onmessage = (e) => {
        if (this.ws !== ws) return; // alte, verworfene Leitung
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          this.id = m.id; this.connected = true;
          clearTimeout(tm);
          if (!done) { done = true; resolve(this); }
          this.pingT = setInterval(() => this.send('ping', { c: performance.now() }), 2000);
          return;
        }
        if (m.t === 'pong') { this.rtt = performance.now() - m.c; return; }
        this.emit(m.t, m);
      };
      ws.onerror = () => fail(new Error('Server nicht erreichbar'));
      ws.onclose = () => {
        if (this.ws !== ws) { if (!done) fail(new Error('Verbindung abgelehnt')); return; }
        clearInterval(this.pingT);
        const was = this.connected;
        this.connected = false;
        if (!done) fail(new Error('Verbindung abgelehnt'));
        else if (was) this.emit('close', {});
      };
    });
  }
  send(t, data = {}) {
    if (!this.connected || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ t, ...data }));
    return true;
  }
  close() {
    clearInterval(this.pingT);
    this.connected = false;
    this.handlers.delete('close');
    try { this.ws?.close(); } catch { /* */ }
  }
}

// Fahrzustand kompakt packen / entpacken
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
export function packCar(id, car, t) {
  const b = car.body, p = b.translation(), q = b.rotation(), v = b.linvel(), a = b.angvel();
  const flags = (car.nitro > 0 ? 1 : 0) | (car.armorT > 0 ? 2 : 0) | (car.drifting ? 4 : 0) | (car.oilT > 0 ? 8 : 0) | (car.limiterCut ? 16 : 0);
  return [id, Math.round(t), r2(p.x), r2(p.y), r2(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w), r2(v.x), r2(v.y), r2(v.z), r2(a.x), r2(a.y), r2(a.z),
    r2(car.steer), r2(car.input.throttle), Math.round(car.rpm), car.gear, r2(car.flame), flags, Math.round(car.engineHp)];
}
export function unpackCar(s) {
  return {
    id: s[0], t: s[1], p: { x: s[2], y: s[3], z: s[4] }, q: { x: s[5], y: s[6], z: s[7], w: s[8] }, v: { x: s[9], y: s[10], z: s[11] }, av: { x: s[12], y: s[13], z: s[14] },
    steer: s[15], throttle: s[16], rpm: s[17], gear: s[18], flame: s[19], flags: s[20] | 0, engineHp: s[21],
  };
}
