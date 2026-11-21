// Drift- und Grip-Test: misst, ob Driften kontrollierbar ist und Tempo hält
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Car } from './src/car.js';
import { CARS } from './src/presets.js';
await RAPIER.init();
const ASPH = { type: 'asphalt', mu: 1.3, roll: 1 };
function mkGame() {
  const world = new RAPIER.World({ x: 0, y: -13.2, z: 0 }); world.timestep = 1 / 120;
  const fx = { sparks: { burst() {} }, smoke: { emit() {} }, skids: { addQuad() {} }, chunks: { burst() {} }, shake: 0 };
  const g = { RAPIER, world, scene: new THREE.Scene(), gravity: 13.2, owners: new Map(), fx, track: { surfaceAt: () => ASPH }, debris: [] };
  world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.6));
  g.addDebris = () => {};
  return g;
}
const run = (g, c, secs, cb) => { for (let i = 0; i < Math.round(secs * 120); i++) { cb && cb(i / 120); c.storePreStep(); c.physicsStep(1 / 120); g.world.step(); c.update(1 / 120); } };
const beta = (c) => Math.atan2(c.vLat, Math.max(Math.abs(c.vLong), 1)) * 57.3;
const kmh = (c) => Math.hypot(c.body.linvel().x, c.body.linvel().z) * 3.6;
function fresh(id, v) {
  const g = mkGame(); const c = new Car(g, CARS[id], 0xff0000, { isPlayer: true }); c.uid = 1;
  c.spawn(new THREE.Vector3(0, 1.3, 0), 0); run(g, c, 1);
  if (v) { c.body.setLinvel({ x: 0, y: 0, z: -v / 3.6 }, true); c.gear = Math.max(1, Math.min(6, Math.round(v / 40))); run(g, c, 0.15, () => (c.input = { throttle: 0.5, brake: 0, steer: 0, handbrake: 0 })); }
  return [g, c];
}
const stats = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return [m, Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length)]; };
const f = (v, d = 0) => (v == null ? '–' : v.toFixed(d));
for (const id of ['brutus', 'kaze', 'rhino']) {
  const out = [];
  // 1) Handbremse antippen bei 90, dann mit Gas halten
  {
    const [g, c] = fresh(id, 90);
    const v0 = kmh(c);
    run(g, c, 0.25, () => (c.input = { throttle: 0.6, brake: 0, steer: 1, handbrake: 1 }));
    const B = [], R = []; let spin = false;
    run(g, c, 3, (t) => { c.input = { throttle: 1, brake: 0, steer: 0.25, handbrake: 0 }; const b = beta(c) * c.driftDir; if (t > 0.8) { B.push(b); R.push(Math.hypot(c.body.linvel().x, c.body.linvel().z) / Math.max(0.05, Math.abs(c.pathRate))); } if (Math.abs(b) > 85) spin = true; });
    const [bm, bs] = stats(B); const v1 = kmh(c);
    // Winkel steuern: stark in die Kurve
    const B2 = []; run(g, c, 1.2, (t) => { c.input = { throttle: 1, brake: 0, steer: 0.9 * c.driftDir, handbrake: 0 }; if (t > 0.5) B2.push(beta(c) * c.driftDir); });
    // Ausstieg: gegenlenken
    let exitT = null, over = 0; const dir = c.driftDir;
    run(g, c, 2.5, (t) => { c.input = { throttle: 0.5, brake: 0, steer: Math.abs(beta(c)) > 4 ? -0.7 * dir : 0, handbrake: 0 }; if (exitT == null && c.driftF < 0.05 && Math.abs(beta(c)) < 5) exitT = t; over = Math.max(over, -beta(c) * dir); });
    out.push(`Handbremse-Drift 90: Winkel ${f(bm)}°±${f(bs, 1)} | Tempo ${f(v0)}→${f(v1)} km/h (${f(v1 / v0 * 100)}%) | Bogen ~${f(stats(R)[0])} m | in die Kurve lenken → ${f(stats(B2)[0])}° | Ausstieg ${f(exitT, 2)} s, Überschwinger ${f(over)}° ${spin ? '| DREHER!' : ''}`);
  }
  // 2) Gas weg im Drift → greift wieder?
  {
    const [g, c] = fresh(id, 80);
    run(g, c, 0.25, () => (c.input = { throttle: 0.6, brake: 0, steer: 1, handbrake: 1 }));
    run(g, c, 1.5, () => (c.input = { throttle: 1, brake: 0, steer: 0.2, handbrake: 0 }));
    let rec = null; run(g, c, 3, (t) => { c.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 }; if (rec == null && c.driftF < 0.05 && Math.abs(beta(c)) < 5) rec = t; });
    out.push(`Gas weg im Drift: greift nach ${f(rec, 2)} s`);
  }
  // 3) Schwung-Wechsel links → rechts
  {
    const [g, c] = fresh(id, 85);
    run(g, c, 0.25, () => (c.input = { throttle: 0.6, brake: 0, steer: 1, handbrake: 1 }));
    run(g, c, 1.4, () => (c.input = { throttle: 1, brake: 0, steer: 0.3, handbrake: 0 }));
    const d0 = c.driftDir;
    run(g, c, 0.2, () => (c.input = { throttle: 0.7, brake: 0, steer: -1, handbrake: 1 }));
    const B = []; run(g, c, 1.6, (t) => { c.input = { throttle: 1, brake: 0, steer: -0.3, handbrake: 0 }; if (t > 0.7) B.push(beta(c) * c.driftDir); });
    out.push(`Schwung-Wechsel: Seite ${d0}→${c.driftDir}, neuer Winkel ${f(stats(B)[0])}°, Tempo ${f(kmh(c))} km/h`);
  }
  // 4) Power-Slide ohne Handbremse
  {
    const [g, c] = fresh(id, 60);
    let first = null, mb = 0; run(g, c, 2, (t) => { c.input = { throttle: 1, brake: 0, steer: 1, handbrake: 0 }; mb = Math.max(mb, Math.abs(beta(c))); if (first == null && c.drifting) first = t; });
    out.push(`Power-Slide (Vollgas+voll lenken, 60): ${first == null ? 'kein Drift' : 'Drift nach ' + f(first, 2) + ' s'}, max ${f(mb)}°`);
  }
  // 5) Grip: Querbeschleunigung bei 100 km/h, leichter Gaseinsatz (kein Drift)
  {
    const [g, c] = fresh(id, 100);
    let lat = 0; run(g, c, 2.5, (t) => { c.input = { throttle: 0.45, brake: 0, steer: 0.75, handbrake: 0 }; if (t > 1.5) lat = Math.max(lat, Math.abs(c.body.angvel().y * c.vLong)); });
    out.push(`Grip 100 km/h: Querbeschleunigung ${f(lat, 1)} m/s², Drift ${c.drifting ? 'ja' : 'nein'}`);
  }
  console.log(id + '\n  ' + out.join('\n  '));
}
// Mini-Turbo: 3,8 s Drift halten, dann gerade raus → Schub?
for (const id of ['brutus', 'kaze', 'rhino']) {
  const [g, c] = fresh(id, 90);
  run(g, c, 0.25, () => (c.input = { throttle: 0.6, brake: 0, steer: 1, handbrake: 1 }));
  let lv = 0; run(g, c, 3.8, () => { c.input = { throttle: 1, brake: 0, steer: 0.25, handbrake: 0 }; lv = Math.max(lv, c.driftLevel); });
  const v0 = kmh(c); let evs = [], vmax = 0;
  run(g, c, 2.5, () => { c.input = { throttle: 1, brake: 0, steer: Math.abs(beta(c)) > 4 ? -0.7 * c.driftDir : 0, handbrake: 0 }; for (const e of c.events) if (e.type === 'miniturbo') evs.push(e.level); c.events.length = 0; vmax = Math.max(vmax, kmh(c)); });
  console.log(`${id}: Mini-Turbo Stufe ${lv} → ausgelöst ${JSON.stringify(evs)} | Tempo nach dem Drift ${f(v0)} → max ${f(vmax)} km/h`);
}
// Langes Lenken ohne Handbremse darf nie einen Drift auslösen
for (const id of ['brutus', 'kaze', 'rhino']) {
  const res = [];
  for (const v of [80, 120, 160]) {
    const [g, c] = fresh(id, v);
    let mb = 0, dr = false;
    run(g, c, 4, () => { c.input = { throttle: 1, brake: 0, steer: 1, handbrake: 0 }; mb = Math.max(mb, Math.abs(beta(c))); if (c.drifting) dr = true; });
    res.push(`${v} km/h: max ${f(mb)}°${dr ? ' DRIFT!' : ''}`);
  }
  console.log(`${id} – 4 s voll lenken + Vollgas: ${res.join(' | ')}`);
}
// Drift-Cancel: Bremse antippen oder Handbremse ohne Lenken → greift sofort wieder, kein Mini-Turbo, kein Pendeln
let cancelBad = 0;
for (const id of ['brutus', 'rhino']) {
  for (const how of ['Bremse', 'Handbremse']) {
    const [g, c] = fresh(id, 100);
    run(g, c, 0.2, () => (c.input = { throttle: 0.7, brake: 0, steer: 1, handbrake: 1 }));
    run(g, c, 2.5, () => (c.input = { throttle: 1, brake: 0, steer: c.driftDir, handbrake: 0 }));
    const dir = c.driftDir, lv = c.driftLevel; let t8 = null, over = 0, turbo = 0;
    run(g, c, 1.5, (t) => {
      c.input = t < 0.12 ? (how === 'Bremse' ? { throttle: 0, brake: 1, steer: 0, handbrake: 0 } : { throttle: 0.8, brake: 0, steer: 0, handbrake: 1 }) : { throttle: 0.8, brake: 0, steer: 0, handbrake: 0 };
      if (t8 == null && Math.abs(beta(c)) < 8) t8 = t; over = Math.max(over, -beta(c) * dir); turbo = Math.max(turbo, c.miniTurbo);
    });
    const good = t8 != null && t8 < 1 && over < 10 && !c.drifting && turbo === 0;
    if (!good) cancelBad++;
    console.log(`${good ? '✓' : '✗'} ${id} Drift-Cancel per ${how}: gerade nach ${f(t8, 2)} s, Überschwinger ${f(over)}°, Mini-Turbo (Stufe ${lv}) ${turbo ? 'ausgelöst!' : 'verfallen'}`);
  }
}
if (cancelBad) process.exit(1);
