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
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(0, -1, 0).setFriction(0.6));
  g.addDebris = () => {};
  return g;
}
const run = (g, c, secs, cb) => { for (let i = 0; i < secs * 120; i++) { cb && cb(i / 120); c.storePreStep(); c.physicsStep(1 / 120); g.world.step(); c.update(1 / 120); } };
const slipDeg = (c) => Math.atan2(c.vLat, Math.max(Math.abs(c.vLong), 1)) * 57.3;
const yawRate = (c) => c.body.angvel().y;
function fresh(id, kmh = 0) {
  const g = mkGame(); const c = new Car(g, CARS[id], 0xff0000, { isPlayer: true }); c.uid = 1;
  c.spawn(new THREE.Vector3(0, 1.3, 0), 0); run(g, c, 1);
  if (kmh) { c.body.setLinvel({ x: 0, y: 0, z: -kmh / 3.6 }, true); c.gear = Math.max(1, Math.min(6, Math.round(kmh / 45))); run(g, c, 0.1, () => (c.input = { throttle: 0.5, brake: 0, steer: 0, handbrake: 0 })); }
  return [g, c];
}
for (const id of (process.argv[2] ? process.argv[2].split(',') : ['brutus', 'kaze', 'rhino', 'vipera', 'brummi'])) {
  const out = [];
  for (const kmh of [50, 100, 160]) {
    const [g, c] = fresh(id, kmh);
    let ms = 0, mdF = 0;
    c.input = { throttle: 0.7, brake: 0, steer: 1, handbrake: 0 };
    run(g, c, 3, () => { ms = Math.max(ms, Math.abs(slipDeg(c))); mdF = Math.max(mdF, c.driftF); });
    const latA = Math.abs(yawRate(c) * c.vLong);
    // loslassen -> geradeaus?
    c.input = { throttle: 0.7, brake: 0, steer: 0, handbrake: 0 };
    let settle = null; run(g, c, 2, (t) => { if (settle == null && Math.abs(yawRate(c)) < 0.05 && Math.abs(slipDeg(c)) < 2) settle = t; });
    out.push(`full-steer ${kmh}: maxSlip ${ms.toFixed(1)}° driftF ${mdF.toFixed(2)} latAcc ${latA.toFixed(1)} m/s² end ${c.speed.toFixed(0)}km/h | straight after release ${settle?.toFixed(2)}s`);
  }
  // Spurwechsel 120 km/h
  {
    const [g, c] = fresh(id, 120);
    let ms = 0;
    run(g, c, 1.6, (t) => { c.input = { throttle: 0.6, brake: 0, steer: t < 0.5 ? 1 : t < 1.0 ? -1 : 0, handbrake: 0 }; ms = Math.max(ms, Math.abs(slipDeg(c))); });
    const x = c.body.translation().x;
    let settle = null; run(g, c, 2, (t) => { if (settle == null && Math.abs(yawRate(c)) < 0.05 && Math.abs(slipDeg(c)) < 2) settle = t; });
    out.push(`lane change 120: maxSlip ${ms.toFixed(1)}° lateral shift ${x.toFixed(1)}m settle ${settle?.toFixed(2)}s`);
  }
  // Handbremsdrift 80 km/h, halten, dann Gas weg -> fängt sich?
  {
    const [g, c] = fresh(id, 80);
    c.input = { throttle: 0.6, brake: 0, steer: 1, handbrake: 1 };
    let ms = 0; run(g, c, 0.4, () => (ms = Math.max(ms, Math.abs(slipDeg(c)))));
    let held = 0;
    run(g, c, 3, () => { const sd = slipDeg(c); ms = Math.max(ms, Math.abs(sd)); if (Math.abs(sd) > 15) held += 1 / 120; c.input = { throttle: 1, brake: 0, steer: Math.abs(sd) > 35 ? -0.3 : 0.5, handbrake: 0 }; });
    const sp = c.speed;
    c.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    let rec = null; run(g, c, 2, (t) => { if (rec == null && Math.abs(slipDeg(c)) < 5 && Math.abs(yawRate(c)) < 0.15) rec = t; });
    out.push(`handbrake drift 80: held>15° ${held.toFixed(1)}s maxSlip ${ms.toFixed(0)}° speed ${sp.toFixed(0)} | recover after lift ${rec?.toFixed(2)}s`);
  }
  // Vollgas aus dem Stand mit Lenkeinschlag (darf nicht ausbrechen)
  {
    const [g, c] = fresh(id, 0);
    let ms = 0; c.input = { throttle: 1, brake: 0, steer: 1, handbrake: 0 };
    run(g, c, 3, () => { if (c.speed > 15) ms = Math.max(ms, Math.abs(slipDeg(c))); });
    out.push(`launch + full steer: maxSlip ${ms.toFixed(1)}° end ${c.speed.toFixed(0)}`);
  }
  // Beschleunigung
  {
    const [g, c] = fresh(id, 0); c.input = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
    let t100 = null; run(g, c, 8, (t) => { if (t100 == null && c.speed >= 100) t100 = t; });
    out.push(`0-100 ${t100?.toFixed(1)}s`);
  }
  console.log(id + '\n  ' + out.join('\n  '));
}
