// ---------------------------------------------------------------------------
// Spielstände (Coins, gekaufte Autos/Strecken/Teile) als eine JSON-Datei im
// Datenordner (DATA_DIR, in Coolify ein Persistent-Storage-Volume).
// Schlüssel = geheimer 12-stelliger Spielstand-Code des Spielers.
// ponytail: alles im Speicher + eine Datei; reicht für ein paar tausend Spieler, sonst SQLite.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

export const KEY_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;
const MAX_BYTES = 16000;

export class Saves {
  constructor({ dir, log = () => {}, delay = 2000 }) {
    this.file = path.join(dir, 'saves.json');
    this.log = log; this.delay = delay;
    this.map = new Map();
    this.ok = true; this.timer = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw)) if (KEY_RE.test(k) && v && typeof v === 'object') this.map.set(k, v);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // kaputte Datei nicht überschreiben, sondern beiseitelegen
        log('Spielstände nicht lesbar:', err.message);
        try { fs.renameSync(this.file, this.file + '.kaputt-' + Date.now()); } catch { /* egal */ }
      }
    }
    this.flush(); // prüft gleich beim Start, ob der Ordner beschreibbar ist
    log(`Spielstände: ${this.map.size} in ${this.file}${this.ok ? '' : ' – NICHT BESCHREIBBAR'}`);
  }
  get(key) { return this.map.get(key) || null; }
  // Nur neuere Stände annehmen (rev zählt jede Änderung hoch); sonst den aktuellen zurückgeben
  put(key, data) {
    const cur = this.map.get(key);
    if (cur && !(data.rev > cur.rev)) return { ok: false, data: cur };
    this.map.set(key, data);
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.delay); this.timer.unref?.(); }
    return { ok: true, rev: data.rev };
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
      fs.renameSync(tmp, this.file);
      this.ok = true;
    } catch (err) {
      if (this.ok) this.log('Spielstände speichern fehlgeschlagen:', err.message);
      this.ok = false;
    }
  }
  stats() { return { saves: this.map.size, store: this.ok ? 'ok' : 'fehler' }; }

  // HTTP: POST /api/save  {key} → {ok, data}   ·   {key, data} → {ok, rev} oder {ok:false, data: neuerer Stand}
  handle(body) {
    let m;
    try { m = JSON.parse(body); } catch { return [400, { ok: false, msg: 'kein JSON' }]; }
    if (!m || !KEY_RE.test(m.key)) return [400, { ok: false, msg: 'falscher Code' }];
    if (m.data === undefined) return [200, { ok: true, data: this.get(m.key) }];
    const d = m.data;
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Number.isInteger(d.rev) || d.rev < 1) return [400, { ok: false, msg: 'falsche Daten' }];
    if (JSON.stringify(d).length > MAX_BYTES) return [413, { ok: false, msg: 'zu groß' }];
    return [200, this.put(m.key, d)];
  }
}
