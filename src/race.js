// ---------------------------------------------------------------------------
// Rennen: Startampel, Fortschritt, Runden, Platzierung, Ziel
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Race {
  constructor(track, { laps = 3, mode = 'race' } = {}) {
    this.track = track;
    this.laps = laps;
    this.mode = mode; // 'race' | 'free'
    this.entries = [];
    this.phase = 'grid'; // grid -> countdown -> running -> done
    this.cd = 0;
    this.step = -1;
    this.time = 0; // Rennzeit ab Grün
    this.events = [];
    this.finishOrder = 0;
    this.playerDoneAt = null;
  }

  add(car, { name, isPlayer = false, bot = null, color = '#ffffff', remote = false, netId = null }) {
    const tr = this.track, N = tr.N;
    const p = car.body.translation();
    const n = tr.nearest(p.x, p.z, 3);
    const i = n.i < 0 ? 0 : n.i;
    const e = {
      car, name, isPlayer, bot, color, remote, netId, lastI: i,
      total: i > N / 2 ? i - N : i, // Startaufstellung liegt vor der Linie
      lap: 0, lapStart: 0, lastLap: null, bestLap: null, finished: false, finishTime: null, place: this.entries.length + 1,
      wrongT: 0, wrong: false, offT: 0, lapTimes: [],
    };
    this.entries.push(e);
    return e;
  }

  get player() { return this.entries.find((e) => e.isPlayer); }
  entryOf(car) { return this.entries.find((e) => e.car === car); }
  progressM(e) { return e.total * 0.8; }

  start(intro = 1.2) {
    this.phase = 'countdown';
    this.cd = -intro;
    this.step = -1;
    for (const e of this.entries) e.car.hold = true;
  }

  update(dt) {
    const tr = this.track, N = tr.N;
    if (this.phase === 'countdown') {
      this.cd += dt;
      const s = Math.floor(this.cd);
      if (s !== this.step && this.cd >= 0) {
        this.step = s;
        if (s < 3) this.events.push({ type: 'light', n: s + 1 });
        else {
          this.phase = 'running';
          this.time = 0;
          for (const e of this.entries) { e.car.hold = false; e.lapStart = 0; }
          this.events.push({ type: 'go' });
        }
      }
      return;
    }
    if (this.phase !== 'running' && this.phase !== 'done') return;
    this.time += dt;

    for (const e of this.entries) {
      const p = e.car.body.translation();
      const n = tr.nearest(p.x, p.z, 2);
      if (n.i < 0 || n.d > 70) continue;
      let d = n.i - e.lastI;
      if (d < -N / 2) d += N;
      if (d > N / 2) d -= N;
      if (Math.abs(d) > 75) continue; // Abkürzung über die Wiese zählt nicht
      e.total += d;
      e.lastI = n.i;
      e.offT = n.d > tr.width / 2 + 4 ? e.offT + dt : 0;
      // Falsche Richtung
      const lv = e.car.body.linvel();
      const along = lv.x * tr.tan[n.i].x + lv.z * tr.tan[n.i].z;
      _v.set(0, 0, -1).applyQuaternion(e.car.root.quaternion);
      const face = _v.x * tr.tan[n.i].x + _v.z * tr.tan[n.i].z;
      e.wrongT = along < -3 || (face < -0.5 && Math.hypot(lv.x, lv.z) < 3 && e.car.input.throttle > 0.5) ? e.wrongT + dt : Math.max(0, e.wrongT - dt * 2);
      e.wrong = e.wrongT > 1.2;
      if (e.finished) continue;
      const lapsDone = Math.floor(e.total / N);
      if (lapsDone > e.lap) {
        e.lap = lapsDone;
        if (lapsDone >= 1) {
          const lt = this.time - e.lapStart;
          e.lastLap = lt; e.lapTimes.push(lt);
          const best = e.bestLap == null || lt < e.bestLap;
          if (best) e.bestLap = lt;
          e.lapStart = this.time;
          this.events.push({ type: 'lap', e, time: lt, best, lap: lapsDone });
        }
        if (this.mode === 'race' && lapsDone >= this.laps && e.remote) { /* Zielmeldung kommt vom Besitzer */ }
        else if (this.mode === 'race' && lapsDone >= this.laps) {
          e.finished = true;
          e.finishTime = this.time;
          e.finishPlace = ++this.finishOrder;
          this.events.push({ type: 'finish', e });
          if (e.isPlayer) this.playerDoneAt = this.time;
        } else if (this.mode === 'race' && lapsDone === this.laps - 1) this.events.push({ type: 'final', e });
      }
    }
    // Platzierung
    const sorted = [...this.entries].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.total - a.total;
    });
    sorted.forEach((e, k) => { e.place = k + 1; });
    this.sorted = sorted;
    // Ende: alle im Ziel oder 30 s nach dem Spieler
    if (this.mode === 'race' && this.phase === 'running' && !this.net) {
      const all = this.entries.every((e) => e.finished);
      if (all || (this.playerDoneAt != null && this.time - this.playerDoneAt > 30)) {
        this.phase = 'done';
        this.events.push({ type: 'done' });
      }
    }
  }

  // Zielmeldung über das Netz (gilt für alle Autos, auch die eigenen)
  netFinish(e, time, best, place) {
    if (!e) return;
    if (!e.finished) {
      e.finished = true;
      e.finishTime = time;
      this.finishOrder++;
      this.events.push({ type: 'finish', e, net: true });
    }
    if (best != null && (e.bestLap == null || best < e.bestLap)) e.bestLap = best;
    if (place) e.finishPlace = place;
  }
  remove(e) {
    this.entries = this.entries.filter((x) => x !== e);
    if (this.sorted) this.sorted = this.sorted.filter((x) => x !== e);
  }

  // Geschätzte Zielzeit für Autos, die noch fahren
  results() {
    const N = this.track.N;
    return (this.sorted || this.entries).map((e) => {
      let time = e.finishTime, est = false;
      if (time == null) {
        const done = Math.max(0.05, e.total / (N * this.laps));
        time = this.time / done; est = true;
      }
      return { name: e.name, isPlayer: e.isPlayer, color: e.color, car: e.car.p.name, place: e.place, time, est, best: e.bestLap };
    });
  }

  // Auto auf die Mittellinie am letzten gültigen Punkt zurücksetzen
  respawnPose(e, back = 6) {
    const tr = this.track, N = tr.N;
    const i = (e.lastI - back + N) % N;
    const p = tr.pts[i].clone();
    const t = tr.tan[i];
    return { pos: p, yaw: Math.atan2(-t.x, -t.z), i };
  }
}
