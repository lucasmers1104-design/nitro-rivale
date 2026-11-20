// ---------------------------------------------------------------------------
// Räume, Lobby und Rennablauf. Der Server ist Schiedsrichter für Raum, Start
// und Zielwertung; die Fahrphysik rechnet jeder Client für seine eigenen Autos.
// ---------------------------------------------------------------------------
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LEVELS = ['tal', 'canyon', 'pass', 'kueste'];
const CARS = ['brutus', 'kaze', 'rhino'];
const MAX = 8;
const clampN = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, Math.round(+v))) : d);
const str = (v, n, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) : d) || d;
const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#d9322b');

export class Hub {
  constructor({ now = () => Date.now(), log = () => {}, timers = { setTimeout, clearTimeout } } = {}) {
    this.now = now;
    this.log = log;
    this.T = timers;
    this.rooms = new Map();
    this.clients = new Map();
    this.seq = 0;
    this.raceSeq = 0;
  }

  // ------------------------------------------------------------ Verbindungen
  connect(conn) {
    const id = 'p' + (++this.seq).toString(36);
    const c = { id, conn, name: 'Fahrer', car: 'brutus', color: '#d9322b', sound: '', room: null, msgs: 0, winStart: this.now() };
    this.clients.set(id, c);
    this.send(c, { t: 'welcome', id, v: 1 });
    return c;
  }
  disconnect(c) {
    if (!this.clients.has(c.id)) return;
    this.leave(c);
    this.clients.delete(c.id);
  }
  send(c, msg) { c.conn.send(JSON.stringify(msg)); }
  sendRaw(c, raw) { c.conn.send(raw); }
  broadcast(room, msg, except = null) {
    const raw = JSON.stringify(msg);
    for (const pid of room.players) { if (pid === except) continue; const c = this.clients.get(pid); if (c) this.sendRaw(c, raw); }
  }
  error(c, code, msg) { this.send(c, { t: 'error', code, msg }); }

  message(c, raw) {
    // einfache Drosselung gegen Fluten
    const now = this.now();
    if (now - c.winStart > 1000) { c.winStart = now; c.msgs = 0; }
    if (++c.msgs > 160) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = c.room ? this.rooms.get(c.room) : null;
    switch (m.t) {
      case 'ping': this.send(c, { t: 'pong', c: m.c, s: now }); break;
      case 'create': this.profile(c, m); this.create(c); break;
      case 'join': this.profile(c, m); this.join(c, String(m.code || '').toUpperCase()); break;
      case 'leave': this.leave(c); break;
      case 'profile': this.profile(c, m); if (room && room.state === 'lobby') this.sync(room); break;
      case 'settings': if (room && this.isHost(c, room) && room.state === 'lobby') { this.settings(room, m); this.sync(room); } break;
      case 'bots': if (room && this.isHost(c, room) && room.state === 'lobby') { this.setBots(room, m.list); this.sync(room); } break;
      case 'start': if (room && this.isHost(c, room) && room.state === 'lobby') this.start(room, m); break;
      case 'ready': if (room && room.race && m.race === room.race.id) { room.race.ready.add(c.id); this.checkReady(room); } break;
      case 's': if (room && room.race && Array.isArray(m.c)) this.relayState(c, room, m); break;
      case 'ev': if (room && room.race && m.e && typeof m.e === 'object') this.relayEvent(c, room, m.e); break;
      case 'fin': if (room && room.race) this.finish(c, room, m); break;
      case 'stop': if (room && room.race && this.isHost(c, room)) this.end(room, room.race.id); break;
      case 'chat': if (room) this.broadcast(room, { t: 'chat', from: c.id, text: str(m.text, 120) }); break;
    }
  }

  // ------------------------------------------------------------ Lobby
  profile(c, m) {
    c.name = str(m.name, 16, c.name);
    if (CARS.includes(m.car)) c.car = m.car;
    if (m.color) c.color = color(m.color);
    if (typeof m.sound === 'string') c.sound = str(m.sound, 24);
  }
  newCode() {
    for (let k = 0; k < 1000; k++) {
      const code = Array.from({ length: 5 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('keine freien Codes');
  }
  create(c) {
    this.leave(c);
    const code = this.newCode();
    const room = { code, host: c.id, players: [c.id], bots: [], state: 'lobby', race: null, created: this.now(),
      settings: { level: 'tal', laps: 3, items: true, skill: 'normal', mode: 'race', fill: true } };
    this.rooms.set(code, room);
    c.room = code;
    this.log(`Raum ${code} erstellt von ${c.name}`);
    this.sync(room);
  }
  join(c, code) {
    if (!/^[A-Z0-9]{5}$/.test(code)) return this.error(c, 'badCode', 'Der Code hat 5 Zeichen');
    const room = this.rooms.get(code);
    if (!room) return this.error(c, 'notfound', 'Raum nicht gefunden');
    if (room.players.includes(c.id)) return this.sync(room);
    if (room.state !== 'lobby') return this.error(c, 'running', 'In diesem Raum läuft gerade ein Rennen');
    if (room.players.length + room.bots.length >= MAX) {
      if (room.bots.length) room.bots.pop(); // ein Bot macht Platz
      else return this.error(c, 'full', 'Der Raum ist voll');
    }
    this.leave(c);
    room.players.push(c.id);
    c.room = code;
    this.log(`${c.name} tritt ${code} bei`);
    this.sync(room);
  }
  leave(c) {
    const room = c.room ? this.rooms.get(c.room) : null;
    c.room = null;
    if (!room) return;
    room.players = room.players.filter((p) => p !== c.id);
    if (!room.players.length) { this.closeRoom(room); return; }
    if (room.host === c.id) {
      room.host = room.players[0];
      // Bots gehören dem Gastgeber; im Rennen verschwinden sie mit ihm
      if (room.race) for (const g of room.race.grid) if (g.owner === c.id) g.gone = true;
    }
    this.broadcast(room, { t: 'left', id: c.id, host: room.host });
    if (room.race) { room.race.ready.delete(c.id); this.checkReady(room); this.checkEnd(room); }
    this.sync(room);
  }
  closeRoom(room) {
    if (room.race?.timer) this.T.clearTimeout(room.race.timer);
    if (room.race?.endTimer) this.T.clearTimeout(room.race.endTimer);
    this.rooms.delete(room.code);
    this.log(`Raum ${room.code} geschlossen`);
  }
  isHost(c, room) { return room.host === c.id; }
  settings(room, m) {
    const s = room.settings;
    if (LEVELS.includes(m.level)) s.level = m.level;
    if (m.laps != null) s.laps = clampN(m.laps, 1, 10, s.laps);
    if (typeof m.items === 'boolean') s.items = m.items;
    if (['leicht', 'normal', 'profi'].includes(m.skill)) s.skill = m.skill;
    if (['race', 'free'].includes(m.mode)) s.mode = m.mode;
    if (typeof m.fill === 'boolean') s.fill = m.fill;
  }
  setBots(room, list) {
    if (!Array.isArray(list)) return;
    const free = MAX - room.players.length;
    room.bots = list.slice(0, Math.max(0, free)).map((b) => ({ name: str(b?.name, 16, 'Bot'), car: CARS.includes(b?.car) ? b.car : 'brutus', color: color(b?.color) }));
  }
  view(room) {
    return {
      t: 'room', code: room.code, host: room.host, state: room.state, settings: room.settings, bots: room.bots,
      players: room.players.map((pid) => { const c = this.clients.get(pid); return { id: pid, name: c.name, car: c.car, color: c.color, sound: c.sound }; }),
    };
  }
  sync(room) { this.broadcast(room, this.view(room)); }

  // ------------------------------------------------------------ Rennablauf
  start(room, m) {
    if (m && Array.isArray(m.bots)) this.setBots(room, m.bots);
    const s = room.settings;
    const humans = room.players.slice().sort(() => Math.random() - 0.5);
    const bots = s.mode === 'race' ? room.bots : [];
    const grid = [];
    bots.forEach((b, k) => grid.push({ id: 'b' + (k + 1), slot: grid.length, name: b.name, car: b.car, color: b.color, sound: '', bot: true, owner: room.host }));
    for (const pid of humans) { const c = this.clients.get(pid); grid.push({ id: pid, slot: grid.length, name: c.name, car: c.car, color: c.color, sound: c.sound, bot: false, owner: pid }); }
    const race = { id: ++this.raceSeq, grid, ready: new Set(), finished: new Map(), started: false, startedAt: 0, firstHumanFinish: null, timer: null, endTimer: null };
    room.race = race;
    room.state = 'loading';
    this.broadcast(room, { t: 'load', race: { id: race.id, level: s.level, laps: s.laps, items: s.items, skill: s.skill, mode: s.mode, grid, seed: Math.floor(Math.random() * 1e9) } });
    this.sync(room);
    race.timer = this.T.setTimeout(() => this.countdown(room, race.id), 30000); // Nachzügler nicht ewig abwarten
    this.log(`Rennen ${race.id} in ${room.code}: ${s.level}, ${grid.length} Autos`);
  }
  checkReady(room) {
    const r = room.race;
    if (!r || r.started) return;
    if (room.players.every((p) => r.ready.has(p))) this.countdown(room, r.id);
  }
  countdown(room, id) {
    const r = room.race;
    if (!r || r.id !== id || r.started || !this.rooms.has(room.code)) return;
    if (r.timer) this.T.clearTimeout(r.timer);
    r.started = true;
    r.startedAt = this.now();
    room.state = 'race';
    this.broadcast(room, { t: 'countdown', race: r.id, gone: r.grid.filter((g) => g.gone).map((g) => g.id) });
    this.sync(room);
    // Sicherheitsnetz: Rennen endet spätestens nach 20 Minuten
    r.endTimer = this.T.setTimeout(() => this.end(room, id), 20 * 60 * 1000);
  }
  ownerOf(room, carId) { return room.race?.grid.find((g) => g.id === carId)?.owner; }
  relayState(c, room, m) {
    const cars = m.c.filter((s) => Array.isArray(s) && this.ownerOf(room, s[0]) === c.id).slice(0, MAX);
    if (!cars.length) return;
    this.broadcast(room, { t: 's', c: cars }, c.id);
  }
  relayEvent(c, room, e) {
    if (typeof e.type !== 'string') return;
    if (e.id && this.ownerOf(room, e.id) !== c.id) return; // nur eigene Autos
    this.broadcast(room, { t: 'ev', from: c.id, e }, c.id);
  }
  finish(c, room, m) {
    const r = room.race;
    const g = r.grid.find((x) => x.id === m.id);
    if (!g || g.owner !== c.id || r.finished.has(g.id) || !r.started) return;
    const time = Number(m.time);
    if (!Number.isFinite(time) || time <= 0 || time > 3600) return;
    r.finished.set(g.id, { id: g.id, time, best: Number(m.best) || null, place: r.finished.size + 1 });
    this.broadcast(room, { t: 'fin', id: g.id, time, best: Number(m.best) || null, place: r.finished.size });
    if (!g.bot && r.firstHumanFinish == null) {
      r.firstHumanFinish = this.now();
      if (r.endTimer) this.T.clearTimeout(r.endTimer);
      r.endTimer = this.T.setTimeout(() => this.end(room, r.id), 30000);
    }
    this.checkEnd(room);
  }
  checkEnd(room) {
    const r = room.race;
    if (!r || !r.started) return;
    const humans = r.grid.filter((g) => !g.bot && room.players.includes(g.id));
    if (humans.length && humans.every((g) => r.finished.has(g.id))) {
      if (r.endTimer) this.T.clearTimeout(r.endTimer);
      r.endTimer = this.T.setTimeout(() => this.end(room, r.id), 2500);
    }
  }
  end(room, id) {
    const r = room.race;
    if (!r || r.id !== id || !this.rooms.has(room.code)) return;
    if (r.timer) this.T.clearTimeout(r.timer);
    if (r.endTimer) this.T.clearTimeout(r.endTimer);
    this.broadcast(room, { t: 'end', race: r.id, finished: [...r.finished.values()] });
    room.race = null;
    room.state = 'lobby';
    this.sync(room);
    this.log(`Rennen ${id} in ${room.code} beendet`);
  }

  stats() { return { rooms: this.rooms.size, players: this.clients.size }; }
}
