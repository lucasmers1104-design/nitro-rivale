import * as THREE from 'three';
import { updateFlame } from './fx.js';
import { buildCarModel } from './carmodel.js';

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function hash3(x, y, z, s = 0) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
  return h - Math.floor(h);
}

// Delle in ein Mesh drücken. Die Verschiebung hängt nur von der Original-Position ab,
// darum bleiben doppelte Kanten-Vertices deckungsgleich (keine Risse im Mesh).
// Zusätzlich: Falten (Ziehharmonika-Effekt) und abgeschabter Lack bis aufs blanke Blech.
const _inv = new THREE.Matrix4();
const _lp = new THREE.Vector3();
const _ld = new THREE.Vector3();
const STEEL = new THREE.Color(0x9da1a8), SCORCH = new THREE.Color(0x2c2d31), _col = new THREE.Color();
export function deformMesh(mesh, worldP, worldDir, depth, radius, maxDent = 0.85) {
  _inv.copy(mesh.matrixWorld).invert();
  _lp.copy(worldP).applyMatrix4(_inv);
  _ld.copy(worldDir).transformDirection(_inv);
  const geo = mesh.geometry;
  const bs = geo.boundingSphere;
  if (bs && _lp.distanceTo(bs.center) > radius + bs.radius) return false;
  const arr = geo.attributes.position.array;
  const orig = mesh.userData.orig;
  const dmg = mesh.userData.dmg;
  let changed = false;
  for (let i = 0; i < arr.length; i += 3) {
    const vx = arr[i], vy = arr[i + 1], vz = arr[i + 2];
    const dx = vx - _lp.x, dy = vy - _lp.y, dz = vz - _lp.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= radius) continue;
    const ox = orig[i], oy = orig[i + 1], oz = orig[i + 2];
    const h = hash3(ox, oy, oz);
    const f = (1 - d / radius) ** 1.6;
    const fold = 0.65 + 0.7 * Math.max(0, Math.sin(d * 11 + h * 6.28));
    const amt = depth * f * fold * (0.6 + 0.8 * h);
    let nx = vx + _ld.x * amt + (hash3(ox, oy, oz, 1) - 0.5) * amt * 0.7;
    let ny = vy + _ld.y * amt + (hash3(ox, oy, oz, 2) - 0.5) * amt * 0.7;
    let nz = vz + _ld.z * amt + (hash3(ox, oy, oz, 3) - 0.5) * amt * 0.7;
    const ex = nx - ox, ey = ny - oy, ez = nz - oz;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (el > maxDent) { const k = maxDent / el; nx = ox + ex * k; ny = oy + ey * k; nz = oz + ez * k; }
    arr[i] = nx; arr[i + 1] = ny; arr[i + 2] = nz;
    if (dmg) dmg[i / 3] = Math.min(2, dmg[i / 3] + f * (0.6 + depth * 2.2) * (0.4 + h));
    changed = true;
  }
  if (changed) {
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
    if (dmg) paintMesh(mesh);
  }
  return changed;
}
export function paintMesh(mesh) {
  const dmg = mesh.userData.dmg, col = mesh.geometry.attributes.color, paint = mesh.userData.paint;
  if (!dmg || !col) return;
  const c = col.array;
  for (let i = 0; i < dmg.length; i++) {
    const d = dmg[i];
    _col.copy(paint);
    if (d > 0.2) _col.lerp(STEEL, THREE.MathUtils.smoothstep(d, 0.2, 0.85) * (0.75 + 0.25 * hash3(i, d > 1 ? 1 : 0, 7)));
    if (d > 1.0) _col.lerp(SCORCH, THREE.MathUtils.smoothstep(d, 1.0, 1.8) * 0.65);
    c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b;
  }
  col.needsUpdate = true;
}

// Rissige Scheibe als Canvas-Textur
function crackTexture(stage) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const x = cv.getContext && cv.getContext('2d');
  if (!x) return null;
  x.fillStyle = stage > 1 ? '#56687a' : '#26333f';
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(235,245,255,0.85)';
  const centers = stage > 1 ? 4 : 2;
  for (let c = 0; c < centers; c++) {
    const cx = 40 + Math.random() * 176, cy = 40 + Math.random() * 176;
    const rays = 9 + Math.floor(Math.random() * 6);
    for (let r = 0; r < rays; r++) {
      let px = cx, py = cy, a = (r / rays) * Math.PI * 2 + Math.random() * 0.3;
      x.lineWidth = 1.2 + Math.random();
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 7; k++) { a += (Math.random() - 0.5) * 0.5; px += Math.cos(a) * 22; py += Math.sin(a) * 22; x.lineTo(px, py); }
      x.stroke();
    }
    for (let ring = 1; ring <= 3; ring++) {
      x.lineWidth = 0.8; x.beginPath();
      for (let k = 0; k <= 14; k++) { const a = (k / 14) * Math.PI * 2; const rr = ring * 22 + Math.random() * 9; k ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Auto-Modell: siehe carmodel.js (prozedurale Low-Poly-Karosserien)
// ---------------------------------------------------------------------------
export { buildCarModel };

// ---------------------------------------------------------------------------
// Fahrzeug: Physik, Schaden, Effekte
// ---------------------------------------------------------------------------
const V = () => new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pos = V(), _up = V(), _fwd = V(), _right = V();
const _a = V(), _b = V(), _c = V(), _d = V(), _imp = V(), _com = V();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const DUST = { grass: 0xb59a6a, sand: 0xe0c08a, snow: 0xf4f8fc, gravel: 0xc8b48a, water: 0xd8e8f0 };

export class Car {
  constructor(game, preset, color, { isPlayer = false, ai = false, remote = false, name = '' } = {}) {
    this.g = game;
    this.p = preset;
    this.isPlayer = isPlayer;
    this.ai = ai;
    this.active = isPlayer || ai; // gesteuerte Autos schlafen nie
    this.remote = remote; // Auto eines anderen Spielers: folgt nur den Netzdaten
    // Power-up-Zustände
    this.nitro = 0; this.oilT = 0; this.armorT = 0; this.hold = false; this.spinDir = 1;
    this.name = name;
    this.color = color;
    Object.assign(this, buildCarModel(preset, color, game.envMap));
    game.scene.add(this.root);

    const R = game.RAPIER;
    const { w, l, h, cabinH, cabinL, cabinZ } = preset.dims;
    const m = preset.mass;
    const H = h + cabinH;
    this.body = game.world.createRigidBody(
      (remote ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic()).setAngularDamping(0.6).setLinearDamping(0.01).setCcdEnabled(true).setCanSleep(!(isPlayer || ai))
    );
    const inertia = { x: (m / 12) * (H * H + l * l) * 1.1, y: (m / 12) * (w * w + l * l), z: (m / 12) * (w * w + H * H) * 2.0 };
    this.comLocal = new THREE.Vector3(0, -h * 0.45, 0.05);
    const chassis = R.ColliderDesc.cuboid(w * 0.49, h / 2, l / 2 + 0.1)
      .setMassProperties(m, this.comLocal, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.35).setRestitution(0.05)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(m * 1.2);
    const cabin = R.ColliderDesc.cuboid(w * 0.37, cabinH / 2, cabinL * 0.45)
      .setTranslation(0, h / 2 + cabinH / 2, cabinZ).setDensity(0).setFriction(0.3)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(m * 1.2);
    this.colliders = [game.world.createCollider(chassis, this.body), game.world.createCollider(cabin, this.body)];
    for (const c of this.colliders) game.owners.set(c.handle, { type: 'car', car: this });

    // Federung: statisch ~50 % eingefedert
    const W = preset.wheel;
    this.spring = (m * game.gravity) / 4 / (W.rest * 0.5);
    this.damper = 2 * 0.42 * Math.sqrt(this.spring * (m / 4));

    // Zustand
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.steer = 0;
    this.steerIn = 0;
    this.driftF = 0;
    this.drifting = false;
    this.flame = 0;
    this.gear = 1;
    this.rpm = preset.engine.idle;
    this.boost = 0;
    this.shiftTimer = 0;
    this.limiterT = 0;
    this.limiterCut = false;
    this.engineHp = 100;
    this.bodyHp = 100;
    this.speed = 0; this.vLong = 0; this.vLat = 0;
    this.grounded = 0;
    this.driftAngle = 0;
    this.slipMax = 0;
    this.onGrass = false;
    this.flipTimer = 0;
    this.prevThrottle = 0;
    this.popQueue = [];
        this.glassBroken = false;
    this.lastImpact = -10;
    this.prevLin = new THREE.Vector3();
    this.prevAng = new THREE.Vector3();
    this.events = [];
    this.time = 0;
    this.idleTime = 0;
    this.glassStage = 0;
    this.lastHit = null;
    this.pitch = 0; this.pitchV = 0; this.roll = 0; this.rollV = 0; this.shiftKick = 0;
    this.prevVLong = 0; this.accLong = 0;
  }

  spawn(pos, yaw) {
    _q.setFromAxisAngle(WORLD_UP, yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.syncVisual();
  }

  resetUpright() {
    const t = this.body.translation();
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    const yaw = Math.atan2(-_fwd.x, -_fwd.z);
    this.spawn(new THREE.Vector3(t.x, Math.max(t.y, 0) + 1.4, t.z), yaw);
    this.gear = 1;
  }

  // ---------------------------------------------------------------- Physik
  physicsStep(dt) {
    const b = this.body;
    const P = this.p, E = P.engine, W = P.wheel;
    const g = this.g;
    this.time += dt;
    if (!this.active && b.isSleeping()) return;

    const t = b.translation(), r = b.rotation();
    _pos.set(t.x, t.y, t.z);
    _q.set(r.x, r.y, r.z, r.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);
    const lin = b.linvel();
    const av = b.angvel();
    const vLong = lin.x * _fwd.x + lin.y * _fwd.y + lin.z * _fwd.z;
    const vLat = lin.x * _right.x + lin.y * _right.y + lin.z * _right.z;
    const speed = Math.hypot(lin.x, lin.y, lin.z);
    const yawRate = av.x * _up.x + av.y * _up.y + av.z * _up.z;
    this.vLong = vLong; this.vLat = vLat; this.speedMs = speed;
    _com.copy(this.comLocal).applyQuaternion(_q).add(_pos);
    const m = P.mass;
    const mq = m / 4;
    const L = W.base;
    const absV = Math.abs(vLong);
    const Iyy = (m / 12) * (P.dims.w ** 2 + P.dims.l ** 2);
    this.oilT = Math.max(0, this.oilT - dt); this.armorT = Math.max(0, this.armorT - dt);
    const oil = this.oilT > 0 ? 0.28 : 1;
    const aMax = 1.28 * g.gravity * P.grip; // maximale Querbeschleunigung

    // Dummies schlafen lassen, wenn sie ruhig stehen
    if (!this.active) {
      if (speed < 0.15 && Math.hypot(av.x, av.y, av.z) < 0.1 && this.grounded >= 3) this.idleTime += dt; else this.idleTime = 0;
      if (this.idleTime > 1.5) { b.sleep(); return; }
    }

    // ---- Eingaben, Rückwärtsgang
    const inp = this.input;
    let drive = inp.throttle, brake = this.hold ? 1 : inp.brake;
    if (this.gear === -1) {
      drive = inp.brake; brake = inp.throttle;
      if (inp.throttle > 0.1 && vLong > -1.2) this.gear = 1;
    } else if (inp.brake > 0.1 && vLong < 0.8 && inp.throttle < 0.1 && this.active) {
      this.gear = -1; drive = inp.brake; brake = 0;
    }
    const handbrake = inp.handbrake;
    const bodySlip = Math.atan2(vLat, Math.max(absV, 1)); // >0: Auto rutscht nach rechts weg
    const slipDeg = Math.abs(bodySlip) * 57.3;

    // ---- Drift-Zustand: nur per Handbremse auslösbar, endet von selbst
    if (handbrake > 0.5 && absV > 7 && this.gear > 0) {
      this.driftF = Math.min(1, this.driftF + dt * 7);
    } else {
      const canHold = P.drive !== 'FWD' && drive > 0.55 && slipDeg > 10 && vLong > 6;
      const target = canHold ? 0.75 : 0;
      const rate = canHold ? 2 : slipDeg < 7 ? 8 : 4.5;
      this.driftF += (target - this.driftF) * Math.min(1, dt * rate);
      if (this.driftF < 0.01) this.driftF = 0;
    }
    const dF = this.driftF;
    this.drifting = dF > 0.15;

    // ---- Lenkung: Lenkwinkel physikalisch begrenzt, im Drift mehr Einschlag zum Gegenlenken
    const steerRate = Math.sign(inp.steer) !== Math.sign(this.steerIn) || inp.steer === 0 ? 10 : 7;
    this.steerIn += clamp(inp.steer - this.steerIn, -steerRate * dt, steerRate * dt);
    const gripSteer = Math.atan((L * aMax) / Math.max(absV * absV, 1)) * 1.55;
    const maxSteer = lerp(clamp(gripSteer, 0.085, 0.62), 0.55, dF);
    this.steer = this.steerIn * maxSteer;

    // ---- Motor & Getriebe
    const nG = P.gears.length;
    const gearRatio = this.gear === -1 ? -3.1 : P.gears[this.gear - 1];
    let wheelV = 0, nd = 0, spinSum = 0;
    for (const w of this.wheels) {
      if (this.isDriven(w) && !w.lost) { wheelV += w.vLong; nd++; spinSum += w.spinAmt; }
    }
    wheelV = nd ? wheelV / nd : vLong;
    const spinAvg = nd ? spinSum / nd : 0;
    const ratioAbs = Math.abs(gearRatio) * P.finalDrive;
    const rpmWheels = (Math.abs(wheelV) / W.r) * ratioAbs * 60 / (2 * Math.PI);
    const launch = E.idle + drive * (0.42 * E.redline - E.idle);
    let rpmT = Math.abs(wheelV) < 6 ? Math.max(rpmWheels, lerp(launch, rpmWheels, Math.abs(wheelV) / 6)) : rpmWheels;
    rpmT += spinAvg * 2600 * drive;
    if (this.grounded === 0 || this.hold) rpmT = lerp(E.idle, E.redline, drive);
    rpmT = clamp(Math.max(rpmT, E.idle), E.idle, E.redline + 50);
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * (this.shiftTimer > 0 ? 6 : 14));
    this.limiterT -= dt;
    if (this.rpm >= E.redline - 20 && drive > 0.5) {
      if (this.limiterT <= 0) { this.limiterCut = !this.limiterCut; this.limiterT = 0.055; }
      this.rpm = Math.min(this.rpm, E.redline);
    } else this.limiterCut = false;
    if (E.turbo > 0) {
      const bt = drive * clamp((this.rpm - 0.28 * E.redline) / (0.35 * E.redline), 0, 1);
      this.boost += (bt - this.boost) * dt * (bt > this.boost ? 1.5 : 5);
    }
    const x = this.rpm / E.redline;
    const curve = clamp(0.62 + 0.95 * x - 0.85 * x * x, 0.35, 1);
    const engineFactor = 0.35 + 0.65 * (this.engineHp / 100);
    let torque = E.torque * curve * drive * engineFactor * (1 + this.boost * 0.55 * E.turbo);
    this.shiftTimer -= dt;
    if (this.shiftTimer > 0 || this.limiterCut || this.hold) torque = 0;
    const driveForce = (torque * ratioAbs * 0.88) / W.r * Math.sign(gearRatio);
    if (this.gear >= 1 && this.shiftTimer <= -0.25 && this.grounded >= 2 && !this.hold) {
      if (this.rpm > E.redline * 0.93 && this.gear < nG && drive > 0.3 && spinAvg < 0.4) {
        this.gear++; this.shiftTimer = 0.1; this.events.push({ type: 'shift', up: true }); this.popQueue.push(this.time + 0.02); if (Math.random() < 0.5) this.popQueue.push(this.time + 0.09); this.shiftKick = 1;
      } else if (this.rpm < E.redline * (drive > 0.6 ? 0.42 : 0.3) && this.gear > 1) {
        this.gear--; this.shiftTimer = 0.08; this.events.push({ type: 'shift', up: false });
      }
    }

    // ---- Räder: Raycast-Federung + Reifen
    const maxLen = W.rest + W.r;
    const R = g.RAPIER;
    let grounded = 0, slipMax = 0, grass = 0;
    const driveW = this.driveWeights();
    const rearGripF = lerp(1, 0.5, dF) * (handbrake > 0.5 ? 0.75 : 1);
    for (const w of this.wheels) {
      if (w.lost) { w.grounded = false; w.load = 0; continue; }
      _a.copy(w.local).applyQuaternion(_q).add(_pos);
      _b.copy(_up).negate();
      const hit = g.world.castRayAndGetNormal(new R.Ray(_a, _b), maxLen, true, undefined, undefined, undefined, b);
      if (!hit) { w.grounded = false; w.load = 0; w.comp = 0; w.dist = maxLen; w.spinAmt *= 0.95; continue; }
      grounded++;
      const dist = hit.timeOfImpact;
      const comp = maxLen - dist;
      const compVel = (comp - w.comp) / dt;
      w.comp = comp; w.dist = dist;
      let Fs = this.spring * comp + this.damper * compVel;
      if (comp > W.rest) Fs += this.spring * 5 * (comp - W.rest);
      Fs = Math.max(0, Fs);
      w.load = Fs; w.grounded = true;
      b.applyImpulseAtPoint(_imp.copy(_up).multiplyScalar(Fs * dt), _a, true);

      w.contact.copy(_a).addScaledVector(_b, dist);
      _c.set(hit.normal.x, hit.normal.y, hit.normal.z);
      const surf = g.track.surfaceAt(w.contact.x, w.contact.z);
      w.surface = surf.type;
      if (surf.off) grass++;

      const steerA = (w.front ? this.steer : 0) + w.toeSign * w.bend * 0.6;
      _d.set(-Math.sin(steerA), 0, -Math.cos(steerA)).applyQuaternion(_q);
      _d.addScaledVector(_c, -_d.dot(_c)).normalize();
      w.side.crossVectors(_d, _c).normalize();
      const vp = b.velocityAtPoint(w.contact);
      const wl = vp.x * _d.x + vp.y * _d.y + vp.z * _d.z;
      const wt = vp.x * w.side.x + vp.y * w.side.y + vp.z * w.side.z;
      w.vLong = wl; w.vLat = wt;

      const mu = surf.mu * P.grip * oil * (w.front ? 1 : 1.06 * rearGripF);
      const maxF = mu * Fs;
      const sp = Math.hypot(wl, wt);
      // Seitenkraft: sättigt ohne Abfall -> berechenbar, kein Ausbrechen
      const slip = Math.atan2(wt, Math.max(Math.abs(wl), 1.5));
      let Fy = -Math.tanh(slip * 9) * maxF;
      if (sp < 4) Fy = lerp(clamp((-wt * mq) / dt * 0.3, -maxF, maxF), Fy, sp / 4);
      // Längskraft
      let Fx = 0;
      const driven = this.isDriven(w);
      if (driven && !(handbrake > 0.3 && !w.front)) Fx += driveForce * driveW[w.front ? 0 : 1];
      // Traktionskontrolle (im Drift locker)
      const tcs = maxF * lerp(0.92, 1.4, dF) * (this.gear >= 1 && this.gear <= 2 && drive > 0.9 && absV < 25 ? 1.18 : 1);
      let spinT = 0;
      if (driven && Math.abs(Fx) > tcs) { spinT = clamp(Math.abs(Fx) / tcs - 1, 0, 1); Fx = Math.sign(Fx) * tcs; }
      const bf = brake * m * g.gravity * 0.85 * (w.front ? 0.3 : 0.2);
      if (bf > 0) Fx -= Math.sign(wl) * Math.min(bf, (Math.abs(wl) * mq) / dt * 0.5);
      if (!w.front && handbrake > 0.05) Fx -= Math.sign(wl) * Math.min(maxF * 0.6 * handbrake, (Math.abs(wl) * mq) / dt * 0.5);
      if (driven && drive < 0.05) {
        const eb = (0.06 * E.torque * ratioAbs) / W.r * x * driveW[w.front ? 0 : 1];
        Fx -= Math.sign(wl) * Math.min(eb, (Math.abs(wl) * mq) / dt * 0.3);
      }
      Fx -= Math.sign(wl) * Math.min(Fs * 0.012 * surf.roll, (Math.abs(wl) * mq) / dt * 0.1);
      if (sp < 1.0 && drive < 0.05) Fx = clamp((-wl * mq) / dt * 0.3, -maxF, maxF);
      // Reibungskreis
      const tot = Math.hypot(Fx, Fy);
      if (tot > maxF * 1.05) { const k = (maxF * 1.05) / tot; Fx *= k; Fy *= k; }
      w.spinAmt += (spinT - w.spinAmt) * Math.min(1, dt * 10);
      _imp.copy(_d).multiplyScalar(Fx * dt).addScaledVector(w.side, Fy * dt);
      _a.copy(_com).sub(w.contact);
      const lift = _a.dot(_up) * 0.7;
      _a.copy(w.contact).addScaledVector(_up, lift);
      b.applyImpulseAtPoint(_imp, _a, true);

      const slide = Math.abs(wt) + w.spinAmt * 8 + (!w.front && handbrake > 0.2 && Math.abs(wl) > 3 ? 4 : 0);
      w.slide = slide;
      if (slide > slipMax) slipMax = slide;
    }
    this.grounded = grounded;
    this.slipMax = slipMax;
    this.onGrass = grass >= 2;

    // ---- Stabilisatoren
    const wh = this.wheels;
    for (const [Lw, Rw, k] of [[wh[0], wh[1], 0.6], [wh[2], wh[3], 0.45]]) {
      const diff = (Lw.grounded ? Lw.comp : 0) - (Rw.grounded ? Rw.comp : 0);
      const F = diff * this.spring * k * dt;
      if (Lw.grounded) { _a.copy(Lw.local).applyQuaternion(_q).add(_pos); b.applyImpulseAtPoint(_imp.copy(_up).multiplyScalar(F), _a, true); }
      if (Rw.grounded) { _a.copy(Rw.local).applyQuaternion(_q).add(_pos); b.applyImpulseAtPoint(_imp.copy(_up).multiplyScalar(-F), _a, true); }
    }

    if (grounded >= 3 && absV > 1.2) {
      // ---- Gierraten-Regler (Arcade-ESP): das Auto dreht genau so, wie gelenkt wird
      const rMax = aMax / Math.max(absV, 3);
      let rDes = (vLong * Math.tan(this.steer)) / L;
      if (dF > 0.1) rDes = lerp(clamp(rDes, -rMax, rMax), (vLong * Math.tan(this.steer)) / L * 1.6, dF);
      rDes = clamp(rDes, -rMax * (1 + dF * 1.4), rMax * (1 + dF * 1.4));
      const kYaw = lerp(6.5, 13, clamp(absV / 30, 0, 1)) * lerp(1, 0.35, dF) * oil;
      b.applyTorqueImpulse(_imp.copy(_up).multiplyScalar(Iyy * kYaw * (rDes - yawRate) * dt), true);
      // Seitliches Rutschen dämpfen, solange nicht gedriftet wird
      const kSlip = 2.2 * (1 - dF) * (this.onGrass ? 0.5 : 1) * oil;
      if (kSlip > 0) {
        const Fl = clamp(-vLat * m * kSlip, -m * aMax * 0.5, m * aMax * 0.5);
        b.applyImpulse(_imp.copy(_right).multiplyScalar(Fl * dt), true);
      }
      // Drift-Begrenzer: ab ~50° wird das Auto zurückgedreht -> kein Wegdrehen
      const excess = Math.abs(bodySlip) - 0.85;
      if (excess > 0 && vLong > 0) {
        b.applyTorqueImpulse(_imp.copy(_up).multiplyScalar(-Math.sign(bodySlip) * Iyy * 14 * Math.min(excess, 0.8) * dt), true);
      }
      // Drift-Schub: hält das Tempo im kontrollierten Drift
      if (dF > 0.2 && drive > 0.3 && vLong > 5) {
        _a.set(lin.x, 0, lin.z).normalize();
        b.applyImpulse(_imp.copy(_a).multiplyScalar(m * 5.2 * dF * drive * dt), true);
      }
    }

    // ---- Power-ups: Öl lässt das Heck kreisen, Nitro schiebt
    if (this.oilT > 0 && grounded >= 2 && absV > 4) b.applyTorqueImpulse(_imp.copy(_up).multiplyScalar(Iyy * 2.6 * this.spinDir * Math.min(1, this.oilT) * dt), true);
    if (this.nitro > 0) {
      this.nitro = Math.max(0, this.nitro - dt);
      if (grounded >= 2) { _a.copy(_fwd).setY(0).normalize(); b.applyImpulse(_imp.copy(_a).multiplyScalar(m * 10.5 * dt), true); }
      this.flame = Math.max(this.flame, 0.75 + Math.random() * 0.25);
    }

    // ---- Abtrieb + Luftwiderstand
    const v2 = speed * speed;
    if (grounded > 0) b.applyImpulse(_imp.copy(_up).multiplyScalar(-1.0 * v2 * (m / 1400) * dt), true);
    b.applyImpulse(_imp.set(lin.x, lin.y, lin.z).multiplyScalar(-0.5 * speed * dt * (this.nitro > 0 ? 0.55 : 1)), true);

    // ---- In der Luft: sanft aufrichten
    if (grounded === 0) {
      _a.crossVectors(_up, WORLD_UP).multiplyScalar(m * 2.2 * dt);
      b.applyTorqueImpulse(_a, true);
      const a2 = b.angvel();
      b.setAngvel({ x: a2.x * 0.995, y: a2.y * 0.995 + inp.steer * dt * 0.8, z: a2.z * 0.995 }, true);
    }

    if (_up.y < 0.25 && speed < 3) this.flipTimer += dt; else this.flipTimer = 0;
    this.driftAngle = speed > 7 && vLong > 2 && grounded >= 3 ? slipDeg : 0;
    this.speed = absV * 3.6;

    // ---- Fehlzündungen im Schiebebetrieb
    const overrun = drive < 0.08 && this.rpm > E.redline * 0.5 && this.gear > 0;
    if (this.prevThrottle > 0.5 && drive < 0.1) {
      if (E.turbo > 0 && this.boost > 0.35) this.events.push({ type: 'blowoff', amount: this.boost, flutter: !!E.flutter });
      if (this.rpm > E.redline * 0.45) {
        const n = 4 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) this.popQueue.push(this.time + 0.03 + Math.random() * 0.9);
      }
    }
    if (overrun && Math.random() < dt * 4 * x) this.popQueue.push(this.time + Math.random() * 0.1);
    if (this.limiterCut && !this._limPrev && Math.random() < 0.55) this.popQueue.push(this.time);
    this._limPrev = this.limiterCut;
    this.prevThrottle = drive;
    if (E.turbo > 0 && drive < 0.1) this.boost *= Math.exp(-dt * 6);
    for (let i = this.popQueue.length - 1; i >= 0; i--) {
      if (this.popQueue[i] <= this.time) {
        this.popQueue.splice(i, 1);
        const s = 0.6 + Math.random() * 0.7;
        this.events.push({ type: 'pop', strength: s });
        this.flame = Math.max(this.flame, s);
        this.popFx = s;
      }
    }
  }

  isDriven(w) {
    const d = this.p.drive;
    return d === 'AWD' || (d === 'RWD' && !w.front) || (d === 'FWD' && w.front);
  }
  driveWeights() {
    const d = this.p.drive;
    const front = this.wheels.filter((w) => w.front && !w.lost && w.grounded).length;
    const rear = this.wheels.filter((w) => !w.front && !w.lost && w.grounded).length;
    if (d === 'AWD') {
      const fw = front ? 0.4 / front : 0, rw = rear ? 0.6 / rear : 0;
      const s = (front ? 0.4 : 0) + (rear ? 0.6 : 0) || 1;
      return [fw / s, rw / s];
    }
    if (d === 'RWD') return [0, rear ? 1 / rear : 0];
    return [front ? 1 / front : 0, 0];
  }

  storePreStep() {
    const l = this.body.linvel(), a = this.body.angvel();
    this.prevLin.set(l.x, l.y, l.z);
    this.prevAng.set(a.x, a.y, a.z);
  }
  velocityAtPrev(p, out) {
    const t = this.body.translation();
    _a.set(p.x - t.x, p.y - t.y, p.z - t.z);
    return out.crossVectors(this.prevAng, _a).add(this.prevLin);
  }

  // --------------------------------------------------------------- Schaden
  applyImpact(p, dirInto, impactSpeed) {
    const P = this.p;
    if (impactSpeed < 2.4) return 0;
    if (this.armorT > 0) { this.lastImpact = this.time; this.g.fx.sparks.burst(p, 10, { speed: 5, spread: 0.9, life: 0.4 }); return 0; }
    const s = clamp((impactSpeed - 2.4) / 13, 0, 2.0) / P.durability;
    if (s < 0.01) return 0;
    this.lastImpact = this.time;
    this.lastHit = { speed: impactSpeed * 3.6, s };
    this.root.updateMatrixWorld(true);
    if (this.onImpact) this.onImpact(p, dirInto, impactSpeed);
    const depth = Math.min(0.85, 0.06 + 0.42 * s);
    const radius = 0.5 + 0.75 * Math.min(s, 1.5);
    for (const mesh of this.deformables) deformMesh(mesh, p, dirInto, depth, radius);
    this.bodyHp = Math.max(0, this.bodyHp - 26 * s);

    const local = this.root.worldToLocal(p.clone());
    const { l, h } = P.dims;
    const labels = [];
    const fx = this.g.fx;
    for (const part of this.parts) {
      if (part.state === 'gone') continue;
      part.obj.getWorldPosition(_c);
      const d = _c.distanceTo(p);
      const reach = part.reach + radius;
      if (d > reach) continue;
      part.hp -= 160 * s * Math.pow(1 - d / reach, 0.7);
      if (part.hp <= 0) { this.detachPart(part, dirInto, impactSpeed); labels.push(part.label + ' ab!'); }
      else if (part.hp < part.looseAt && part.state === 'ok') { part.state = 'loose'; labels.push(part.label + ' lose'); }
    }
    this.engineHp = Math.max(0, this.engineHp - (local.z < -l * 0.18 ? 62 : 10) * s);
    for (const w of this.wheels) {
      if (w.lost) continue;
      const dd = Math.hypot(local.x - w.local.x, local.z - w.local.z);
      if (dd < 1.25) {
        w.bend += 0.11 * s * (1 - dd / 1.25);
        if (w.bend > 0.28) { this.loseWheel(w, dirInto); labels.push('Rad ab!'); }
      }
    }
    for (const hl of [...this.lights.head, ...this.lights.tail]) {
      if (hl.userData.broken) continue;
      hl.getWorldPosition(_c);
      if (_c.distanceTo(p) < radius + 0.35 && s > 0.12) {
        hl.userData.broken = true;
        hl.visible = false;
        fx.chunks.burst(_c, 7, { colors: [0xdff1ff, 0xffffff, 0x2a2c31], speed: 4, size: 0.6 });
        fx.sparks.burst(_c, 12, { color: 0xdff1ff, speed: 4, life: 0.5 });
      }
    }
    const nearCabin = local.y > h / 2 - 0.15 || Math.abs(local.z - P.dims.cabinZ) < P.dims.cabinL * 0.6;
    if (nearCabin && s > 0.35 && this.glassStage < 2) {
      const stage = s > 0.9 || this.glassStage === 1 ? 2 : 1;
      this.glassStage = stage;
      const tex = crackTexture(stage);
      if (tex) { this.mats.glass.map = tex; this.mats.glass.color.set(0xffffff); this.mats.glass.metalness = 0.25; this.mats.glass.roughness = 0.5; this.mats.glass.needsUpdate = true; }
      else this.mats.glass.color.set(0x6f8394);
      this.glassBroken = true;
      fx.chunks.burst(p, 18, { colors: [0xd8efff, 0xb8d8f0, 0xffffff], speed: 5, size: 0.5 });
      fx.sparks.burst(p, 30, { color: 0xd8efff, speed: 5, life: 0.8 });
      this.events.push({ type: 'glass' });
    }
    // Splitter, Funken, Staub
    _d.copy(dirInto).negate().multiplyScalar(2).add(WORLD_UP);
    const hex = '#' + this.paintColor.getHexString();
    fx.chunks.burst(p, Math.round(5 + 26 * Math.min(s, 1.5)), { dir: _d, speed: 4 + 6 * s, colors: [hex, hex, 0x1b1c20, 0x9da1a8], size: 0.8 + s * 0.4 });
    fx.sparks.burst(p, Math.round(12 + 60 * Math.min(s, 1.4)), { dir: _d, speed: 5 + 8 * s, spread: 1.3 });
    if (s > 0.25) for (let i = 0; i < 3; i++) fx.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, { color: 0xc9c2b6, size0: 0.3, size1: 1.3, life: 0.8 });
    this.events.push({ type: 'crash', strength: Math.min(1.3, s), labels });
    return s;
  }

  get stats() {
    const pull = this.wheels.filter((w) => w.front && !w.lost).reduce((a, w) => a + w.toeSign * w.bend * 0.6, 0) * 57.3;
    return {
      body: this.bodyHp, engine: this.engineHp, power: (0.35 + 0.65 * (this.engineHp / 100)) * 100,
      pull, wheelsLost: this.wheels.filter((w) => w.lost).length, glass: this.glassStage,
      lost: this.parts.filter((x) => x.state === 'gone').map((x) => x.label),
      loose: this.parts.filter((x) => x.state === 'loose').map((x) => x.label),
    };
  }

  setPaint(color) {
    this.paintColor.set(color);
    this.mats.mirror.color.set(color);
    for (const m of this.deformables) if (m.userData.dmg) paintMesh(m);
  }

  detachPart(part, dir, speed) {
    part.state = 'gone';
    part.hp = 0;
    this.root.updateMatrixWorld(true);
    const obj = part.obj;
    obj.getWorldPosition(_c);
    this.g.fx.chunks.burst(_c, 6, { colors: ['#' + this.paintColor.getHexString(), 0x1b1c20], speed: 4, size: 0.7 });
    this.g.scene.attach(obj);
    this.deformables = this.deformables.filter((m) => !part.deform.includes(m));
    const vp = this.body.velocityAtPoint(obj.position);
    const rnd = () => (Math.random() - 0.5) * 2;
    const v = new THREE.Vector3(vp.x, vp.y, vp.z).addScaledVector(dir, -speed * 0.22).add(new THREE.Vector3(rnd() * 1.5, 2 + Math.random() * 3, rnd() * 1.5));
    const half = part.size.map((x) => Math.max(0.03, x / 2));
    this.g.addDebris(obj, half, v, part.mass);
  }

  loseWheel(w, dir) {
    w.lost = true;
    w.grounded = false;
    this.root.updateMatrixWorld(true);
    w.hold.getWorldPosition(_c);
    this.g.fx.sparks.burst(_c, 30, { speed: 6 });
    this.g.scene.attach(w.hold);
    const vp = this.body.velocityAtPoint(w.hold.position);
    const v = new THREE.Vector3(vp.x, vp.y, vp.z).addScaledVector(dir, -2.5).add(new THREE.Vector3(0, 3, 0));
    const W = this.p.wheel;
    this.g.addDebris(w.hold, null, v, 22, { wheel: true, r: W.r, w: W.w });
  }

  // ------------------------------------------------------------- Netzwerk
  // Kinematisches Auto eines anderen Spielers an die nächste Lage schieben
  setNetPose(p, q) {
    this.body.setNextKinematicTranslation(p);
    this.body.setNextKinematicRotation(q);
  }
  // Optik eines entfernten Autos aus den Netzdaten vorbereiten (vor update())
  ghostPrep(st, dt) {
    this.time += dt;
    this.prevLin.set(st.v.x, st.v.y, st.v.z);
    this.prevAng.set(st.av.x, st.av.y, st.av.z);
    _q.copy(this.root.quaternion);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);
    this.vLong = st.v.x * _fwd.x + st.v.y * _fwd.y + st.v.z * _fwd.z;
    this.vLat = st.v.x * _right.x + st.v.z * _right.z;
    this.speedMs = Math.hypot(st.v.x, st.v.y, st.v.z);
    this.speed = Math.abs(this.vLong) * 3.6;
    this.steer = st.steer;
    this.rpm = st.rpm; this.gear = st.gear;
    this.input.throttle = st.throttle;
    this.flame = Math.max(this.flame, st.flame);
    this.nitro = st.flags & 1 ? 0.2 : 0;
    this.armorT = st.flags & 2 ? 0.5 : 0;
    this.drifting = !!(st.flags & 4);
    this.oilT = st.flags & 8 ? 0.3 : 0;
    this.limiterCut = !!(st.flags & 16);
    if (this.nitro > 0) this.flame = Math.max(this.flame, 0.8);
    this.grounded = 4;
    const W = this.p.wheel;
    const pos = this.root.position;
    for (const w of this.wheels) {
      if (w.lost) continue;
      w.grounded = true;
      w.dist = W.rest * 0.5 + W.r;
      w.vLong = this.vLong;
      w.spinAmt = 0;
      w.slide = this.drifting && !w.front ? 6 : Math.abs(this.vLat) > 4 ? 4 : 0;
      w.contact.copy(w.local).applyQuaternion(_q).add(pos).addScaledVector(_up, -(W.rest * 0.5 + W.r));
      w.side.copy(_right);
      w.surface = this.g.track ? this.g.track.surfaceAt(w.contact.x, w.contact.z).type : 'asphalt';
    }
  }
  // Namensschild über dem Auto
  setNameTag(text, color = '#ffffff') {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const x = cv.getContext && cv.getContext('2d');
    if (!x) return;
    x.font = '700 64px Fredoka, "Arial Rounded MT Bold", sans-serif';
    const w = Math.min(500, x.measureText(text).width + 90);
    x.fillStyle = 'rgba(35,38,74,0.85)';
    const r = 40, x0 = (512 - w) / 2, y0 = 20, h = 88;
    x.beginPath(); x.moveTo(x0 + r, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, r); x.arcTo(x0 + w, y0 + h, x0, y0 + h, r); x.arcTo(x0, y0 + h, x0, y0, r); x.arcTo(x0, y0, x0 + w, y0, r); x.fill();
    x.fillStyle = color; x.beginPath(); x.arc(x0 + 44, 64, 16, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillText(text, x0 + 72, 66, w - 90);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    spr.scale.set(3.2, 0.8, 1);
    spr.position.set(0, this.p.dims.h / 2 + this.p.dims.cabinH + 1.0, 0);
    spr.renderOrder = 20;
    this.root.add(spr);
    this.nameTag = spr;
  }

  dispose() {
    if (this.nameTag) { this.nameTag.material.map.dispose(); this.nameTag.material.dispose(); }
    for (const c of this.colliders) this.g.owners.delete(c.handle);
    this.g.world.removeRigidBody(this.body);
    this.g.scene.remove(this.root);
  }

  // --------------------------------------------------------------- Visuals
  syncVisual() {
    const t = this.body.translation(), r = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(r.x, r.y, r.z, r.w);
  }

  update(dt) {
    this.syncVisual();
    // Karosserie-Bewegung (Feder-Dämpfer): Nicken bei Gas/Bremse, Rollen in Kurven
    if (dt > 0) {
      const aL = (this.vLong - this.prevVLong) / dt;
      this.prevVLong = this.vLong;
      this.accLong += (aL - this.accLong) * Math.min(1, dt * 8);
      const yawR = this.body.angvel().y;
      const grounded = this.grounded >= 3 ? 1 : 0.2;
      const pT = clamp(this.accLong * 0.0055, -0.065, 0.06) * grounded + this.shiftKick * -0.025;
      const rT = clamp(-yawR * this.vLong * 0.0042, -0.07, 0.07) * grounded;
      this.shiftKick *= Math.exp(-dt * 10);
      this.pitchV += ((pT - this.pitch) * 90 - this.pitchV * 11) * dt; this.pitch += this.pitchV * dt;
      this.rollV += ((rT - this.roll) * 80 - this.rollV * 10) * dt; this.roll += this.rollV * dt;
      this.sway.rotation.set(this.pitch, 0, this.roll);
    }
    const W = this.p.wheel;
    const fx = this.g.fx;
    const lin = this.body.linvel();
    const speed = Math.hypot(lin.x, lin.z);
    for (const w of this.wheels) {
      if (w.lost) continue;
      const travel = Math.min(w.dist - W.r, W.rest);
      w.hold.position.set(0, -Math.max(0.02, travel), 0);
      w.pivot.rotation.y = (w.front ? this.steer : 0) + w.toeSign * w.bend * 0.6;
      w.hold.rotation.z = (w.left ? 1 : -1) * w.bend * 1.4;
      const spinV = w.vLong + (w.spinAmt > 0.05 ? 14 * w.spinAmt : 0);
      const locked = !w.front && this.input.handbrake > 0.3;
      if (!locked) w.angle -= (spinV / W.r) * dt;
      w.spin.rotation.x = w.angle;

      // Rauch, Staub, Bremsspuren
      if (!w.grounded) { w.mark = null; continue; }
      const slide = w.slide || 0;
      const onAsphalt = w.surface === 'asphalt' || w.surface === 'curb';
      if (onAsphalt && slide > 3.2) {
        w.smokeAcc += dt * clamp((slide - 2.5) * 5, 0, 38);
        while (w.smokeAcc > 1) {
          w.smokeAcc -= 1;
          fx.smoke.emit(w.contact.x + (Math.random() - 0.5) * 0.4, w.contact.y + 0.25, w.contact.z + (Math.random() - 0.5) * 0.4,
            lin.x * 0.12 + (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.6, lin.z * 0.12 + (Math.random() - 0.5) * 1.2,
            { color: 0xeeeeee, size0: 0.25, size1: 1.15 + Math.min(slide, 15) * 0.09, life: 1.2 + Math.random() * 0.7, rise: 0.55 });
        }
      } else if (!onAsphalt && speed > 4) {
        w.smokeAcc += dt * clamp(speed * 0.5 + slide * 2, 0, 25);
        while (w.smokeAcc > 1) {
          w.smokeAcc -= 1;
          fx.smoke.emit(w.contact.x, w.contact.y + 0.2, w.contact.z, lin.x * 0.2 + (Math.random() - 0.5), 0.8, lin.z * 0.2 + (Math.random() - 0.5),
            { color: DUST[w.surface] || 0xb59a6a, size0: 0.25, size1: 1.1, life: 0.9, rise: 0.3 });
        }
      }
      const marking = onAsphalt && slide > 3.8;
      if (marking) {
        const hw = W.w * 0.42;
        const lx = w.contact.x - w.side.x * hw, lz = w.contact.z - w.side.z * hw;
        const rx = w.contact.x + w.side.x * hw, rz = w.contact.z + w.side.z * hw;
        if (w.mark) {
          const dx = w.contact.x - w.mark[4], dz = w.contact.z - w.mark[5];
          if (dx * dx + dz * dz > 0.09) {
            fx.skids.addQuad(w.mark[0], w.mark[1], w.mark[2], w.mark[3], lx, lz, rx, rz, w.mark[6], w.contact.y + 0.05);
            w.mark = [lx, lz, rx, rz, w.contact.x, w.contact.z, w.contact.y + 0.05];
          }
        } else w.mark = [lx, lz, rx, rz, w.contact.x, w.contact.z, w.contact.y + 0.05];
      } else w.mark = null;
    }

    // Lose Teile flattern
    for (const part of this.parts) {
      if (part.state !== 'loose') continue;
      part.looseAmt = Math.min(1, part.looseAmt + dt * 3);
      part.wobV += (-part.wob * 70 - part.wobV * 3 + (Math.random() - 0.5) * (12 + speed * 6)) * dt;
      part.wob += part.wobV * dt;
      const ang = part.looseAngle * part.looseAmt + part.wob * 0.12;
      part.pivot.rotation.set(0, 0, 0);
      part.pivot.rotation[part.axis] = ang;
      if ((part.id === 'bumperF' || part.id === 'bumperR') && speed > 7 && Math.random() < dt * 9) {
        part.obj.getWorldPosition(_c);
        _c.y = this.g.heightAt(_c.x, _c.z) + 0.08;
        fx.sparks.burst(_c, 3, { speed: 3, spread: 0.6, life: 0.35 });
        this.events.push({ type: 'scrape' });
      }
    }

    // Motorschaden: erst dezenter Kühlerdampf, dann dunkler Rauch, bei Totalschaden Feuer
    if (this.engineHp < 65) {
      const sev = (65 - this.engineHp) / 65;
      this.engAcc = (this.engAcc || 0) + dt * (3 + sev * 6);
      _c.copy(this.enginePoint);
      this.root.localToWorld(_c);
      while (this.engAcc > 1) {
        this.engAcc -= 1;
        const dark = this.engineHp < 25;
        fx.smoke.emit(_c.x + (Math.random() - 0.5) * 0.5, _c.y + 0.1, _c.z + (Math.random() - 0.5) * 0.5,
          lin.x * 0.75 + (Math.random() - 0.5) * 0.6, 1.4, lin.z * 0.75 + (Math.random() - 0.5) * 0.6,
          { color: dark ? 0x3a3a3d : 0xf2f2f2, size0: 0.12, size1: dark ? 0.85 : 0.6, life: dark ? 0.9 : 0.6, rise: 2.4 });
      }
    }
    updateFlame(this.fire, this.engineHp <= 0 ? 0.55 + Math.sin(this.time * 9) * 0.15 + Math.random() * 0.15 : 0, this.time);

    // Flammen aus dem Auspuff
    this.flame *= Math.exp(-dt * 9);
    for (const f of this.flames) updateFlame(f, this.flame, this.time);
    // Glut-Funken + Rauchwölkchen bei jedem Knall
    if (this.popFx) {
      const s = this.popFx; this.popFx = 0;
      this.root.updateMatrixWorld(true);
      for (const e of this.exhausts) {
        _c.copy(e); _c.z += 0.25; this.root.localToWorld(_c);
        _d.set(0, 0.25, 1).applyQuaternion(this.root.quaternion);
        fx.sparks.burst(_c, Math.round(2 + s * 4), { dir: _d, speed: 2.5 + s * 2, spread: 0.6, color: 0xffa040, life: 0.3, up: 0.8, stretch: 0.12, size: 0.6, base: { x: lin.x * 0.97, y: 0, z: lin.z * 0.97 } });
        fx.smoke.emit(_c.x, _c.y, _c.z, lin.x * 0.85 + _d.x * 1.5, 0.4, lin.z * 0.85 + _d.z * 1.5, { color: 0x4a4644, size0: 0.12, size1: 0.6, life: 0.5, rise: 0.6 });
      }
    }
  }
}
