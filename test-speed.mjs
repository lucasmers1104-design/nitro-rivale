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
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(0.6));
  g.addDebris = () => {};
  return g;
}
const tuneArg = process.argv[3] ? JSON.parse(process.argv[3]) : null;
for (const id of (process.argv[2] ? process.argv[2].split(',') : Object.keys(CARS))) {
  const g = mkGame();
  let preset = CARS[id];
  if (tuneArg) { const { applyTune } = await import('./src/tune.js'); preset = applyTune(preset, tuneArg); }
  const c = new Car(g, preset, 0xff0000, { isPlayer: true, tune: tuneArg }); c.uid = 1;
  c.spawn(new THREE.Vector3(0, 1.5, 0), 0);
  let t100 = null, t200 = null, vmax = 0;
  for (let i = 0; i < 120 * 40; i++) {
    const t = i / 120;
    c.input = { throttle: t > 1 ? 1 : 0, brake: 0, steer: 0, handbrake: 0 };
    c.storePreStep(); c.physicsStep(1 / 120); g.world.step(); c.update(1 / 120);
    const kmh = c.speedMs * 3.6;
    if (t100 == null && kmh >= 100) t100 = t - 1;
    if (t200 == null && kmh >= 200) t200 = t - 1;
    vmax = Math.max(vmax, kmh);
  }
  const y = c.body.translation().y;
  console.log(id.padEnd(7), '0-100', t100?.toFixed(2), 's  0-200', t200?.toFixed(2) ?? '-', 's  vmax', vmax.toFixed(0), 'km/h  rideY', y.toFixed(2));
}
