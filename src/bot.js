// ---------------------------------------------------------------------------
// Bot-Fahrer: Ideallinie, Bremspunkte aus der Kurvenkrümmung, Ausweichen,
// Befreien aus Sackgassen und Einsatz von Power-ups
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _f = new THREE.Vector3(), _t = new THREE.Vector3();

export const SKILL = {
  leicht: { lat: 0.72, top: 0.86, brake: 7.0, react: 0.35, line: 0.5 },
  normal: { lat: 0.83, top: 0.95, brake: 8.2, react: 0.2, line: 0.8 },
  profi: { lat: 0.93, top: 1.0, brake: 9.3, react: 0.1, line: 1.0 },
};

export class BotDriver {
  constructor(car, track, skill = 'normal', seed = Math.random()) {
    this.car = car;
    this.track = track;
    const S = SKILL[skill] || SKILL.normal;
    const v = (k) => 1 + (((seed * 9301 + k * 49297) % 1) - 0.5) * 0.06;
    this.s = { lat: S.lat * v(1), top: S.top * v(2), brake: S.brake * v(3), react: S.react, line: S.line };
    this.bias = (((seed * 7919) % 1) - 0.5) * 3.0; // bevorzugte Spur
    this.idx = -1;
    this.avoid = 0;
    this.stuckT = 0;
    this.revT = 0;
    this.revSteer = 0;
    this.tries = 0;
    this.itemT = 0;
    this.noise = 0;
    this.noiseT = 0;
  }

  // ctx: { cars: [{car, prog}], myProg, rubber, useItem(car), respawn(car), running }
  update(dt, ctx) {
    const car = this.car, tr = this.track, N = tr.N, S = this.s;
    const inp = car.input;
    if (!ctx.running) { inp.throttle = ctx.rev ? ctx.rev : 0; inp.brake = 0; inp.steer = 0; inp.handbrake = 0; return; }
    const p = car.body.translation();
    const n = tr.nearest(p.x, p.z, 2);
    if (n.i >= 0) this.idx = n.i;
    if (this.idx < 0) return;
    const i0 = this.idx;
    const v = Math.max(0, car.vLong);
    const W = tr.width;

    // ---- Befreien: rückwärts raus, notfalls zurück auf die Strecke setzen
    if (this.revT > 0) {
      this.revT -= dt;
      inp.throttle = 0; inp.brake = 1; inp.handbrake = 0; inp.steer = this.revSteer;
      return;
    }
    const wantGo = inp.throttle > 0.5;
    if (wantGo && car.speedMs < 1.6) this.stuckT += dt; else { this.stuckT = Math.max(0, this.stuckT - dt * 2); if (car.speedMs > 6) this.tries = 0; }
    if (car.flipTimer > 1.3 || n.d > W / 2 + 28 || (ctx.water != null && p.y < ctx.water - 0.3)) { ctx.respawn(car); this.stuckT = 0; this.tries = 0; return; }
    if (this.stuckT > 1.4) {
      this.stuckT = 0; this.tries++;
      if (this.tries > 2) { ctx.respawn(car); this.tries = 0; return; }
      this.revT = 1.3;
      this.revSteer = -Math.sign(this.lastSteer || 1);
      return;
    }

    // ---- Ideallinie: vor Kurven nach außen, am Scheitel nach innen
    const lineAt = (j) => {
      const c = tr.curv[j % N];
      const cAhead = tr.curv[(j + 30) % N];
      const inner = clamp(c * 22, -1, 1), prep = clamp(-cAhead * 14, -1, 1) * (Math.abs(c) < 0.08 ? 1 : 0);
      return (inner * 0.8 + prep * 0.5) * (W / 2 - 2.2) * S.line;
    };

    // ---- Ausweichen: Autos knapp voraus in der eigenen Spur
    const myOff = tr.offsetAt(i0, p.x, p.z);
    let avoidT = 0, closeBrake = 0;
    for (const o of ctx.cars) {
      if (o.car === car) continue;
      const op = o.car.body.translation();
      const dz = o.prog - ctx.myProg;
      if (dz < -3 || dz > 26) continue;
      const oi = tr.nearest(op.x, op.z, 1).i;
      if (oi < 0) continue;
      const oOff = tr.offsetAt(oi, op.x, op.z);
      const lat = oOff - (myOff + this.avoid);
      if (Math.abs(lat) < 3.0) {
        const room = (side) => (side > 0 ? W / 2 - 1.5 - oOff : oOff + W / 2 - 1.5);
        const side = room(1) > room(-1) ? 1 : -1;
        avoidT = clamp(oOff + side * 3.4, -(W / 2 - 1.6), W / 2 - 1.6) - lineAt(i0 + 12) - this.bias;
        const closing = v - Math.max(0, o.car.vLong);
        if (dz < 9 && closing > 3) closeBrake = Math.max(closeBrake, clamp((closing - 3) / 6, 0, 0.6));
      }
    }
    this.avoid += (avoidT - this.avoid) * Math.min(1, dt * 2.2);

    // ---- Lenken: Zielpunkt voraus
    this.noiseT -= dt;
    if (this.noiseT <= 0) { this.noiseT = 0.6 + Math.random(); this.noise = (Math.random() - 0.5) * S.react; }
    const look = Math.round(9 + v * 0.45);
    const j = (i0 + look) % N;
    const off = clamp(lineAt(j) + this.bias + this.avoid, -(W / 2 - 1.4), W / 2 - 1.4);
    const tp = tr.pts[j], sd = tr.side[j];
    _t.set(tp.x + sd.x * off - p.x, 0, tp.z + sd.z * off - p.z).normalize();
    _f.set(0, 0, -1).applyQuaternion(car.root.quaternion).setY(0).normalize();
    const err = Math.atan2(_f.x * _t.z - _f.z * _t.x, _f.x * _t.x + _f.z * _t.z);
    const steer = clamp(-err * 2.8 + this.noise * 0.15, -1, 1);
    this.lastSteer = steer;

    // ---- Zieltempo aus Kurven voraus inkl. Bremsweg
    const aLat = 19 * S.lat * (car.onGrass ? 0.7 : 1) * (car.oilT > 0 ? 0.4 : 1);
    const reach = Math.min(N / 2, Math.round((v * v) / (2 * S.brake) / 0.8 + 30));
    let vT = 90;
    for (let k = 8; k < reach; k += 5) {
      const K = Math.abs(tr.curv[(i0 + k) % N]) / 16;
      if (K < 1e-4) continue;
      const vc = Math.sqrt(aLat / K);
      const allow = Math.sqrt(vc * vc + 2 * S.brake * Math.max(0, k * 0.8 - 6));
      if (allow < vT) vT = allow;
    }
    vT *= ctx.rubber || 1;
    const topCap = 90 * S.top;
    vT = Math.min(vT, topCap);
    let th = v < vT - 0.5 ? 1 : v < vT + 0.5 ? 0.4 : 0;
    let br = v > vT + 1.5 ? clamp((v - vT) / 5, 0.25, 1) : 0;
    if (closeBrake > 0) { br = Math.max(br, closeBrake); th = Math.min(th, 0.3); }
    if (Math.abs(err) > 1.2 && v > 8) { th = 0; br = Math.max(br, 0.5); }
    if (car.vLong < -0.5 && th > 0) br = 0;
    inp.throttle = th * (S.top < 0.9 && v > topCap * 0.8 ? 0.85 : 1);
    inp.brake = br;
    inp.steer = steer;
    inp.handbrake = 0;

    // ---- Power-ups
    if (car.item && !car.itemRoll) {
      this.itemT += dt;
      const ahead = ctx.cars.filter((o) => o.car !== car && o.prog - ctx.myProg > 0 && o.prog - ctx.myProg < 120);
      const behind = ctx.cars.filter((o) => o.car !== car && ctx.myProg - o.prog > 0 && ctx.myProg - o.prog < 45);
      const near = ctx.cars.filter((o) => { if (o.car === car) return false; const q = o.car.body.translation(); return Math.hypot(q.x - p.x, q.z - p.z) < 12; });
      let straight = true;
      for (let k = 10; k < 80; k += 8) if (Math.abs(tr.curv[(i0 + k) % N]) > 0.12) { straight = false; break; }
      const st = car.stats;
      const t = this.itemT, it = car.item;
      let use = false;
      if (it === 'nitro') use = straight && v > 14;
      else if (it === 'jump') use = ahead.some((o) => o.prog - ctx.myProg < 12) || (t > 7 && straight);
      else if (it === 'rocket') use = ahead.length > 0 || t > 9;
      else if (it === 'barrel' || it === 'oil') use = behind.length > 0 || t > 8;
      else if (it === 'shock') use = near.length > 0 || t > 10;
      else if (it === 'armor') use = near.length > 0 || t > 6;
      else if (it === 'repair') use = st.body < 60 || st.engine < 60 || t > 12;
      if (use && t > 0.8) { ctx.useItem(car); this.itemT = 0; }
    } else this.itemT = 0;
  }
}
