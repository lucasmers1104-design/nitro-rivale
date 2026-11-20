import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
const { buildWorld } = await import('./src/world.js');
const { Car } = await import('./src/car.js');
const { CARS } = await import('./src/presets.js');
await RAPIER.init();
for (const id of ['brutus', 'kaze', 'rhino']) {
  const world = new RAPIER.World({ x: 0, y: -13.2, z: 0 }); world.timestep = 1 / 120;
  const fx = { sparks: { burst() {} }, smoke: { emit() {} }, skids: { addQuad() {} }, chunks: { burst() {} }, shake: 0 };
  const g = { RAPIER, world, scene: new THREE.Scene(), gravity: 13.2, owners: new Map(), debris: [], envMap: null, fx };
  const { track } = buildWorld(g); g.track = track; g.addDebris = () => {};
  const car = new Car(g, CARS[id], 0xff0000, { isPlayer: true }); car.uid = 1;
  const i0 = 34, p0 = track.pts[i0], t0 = track.tan[i0];
  car.spawn(new THREE.Vector3(p0.x, 1.2, p0.z), Math.atan2(-t0.x, -t0.z));
  let idx = i0, time = 0, maxDev = 0, offT = 0, lapDone = null, minV = 999, prog = 0;
  const N = track.N;
  for (let step = 0; step < 120 * 120 && lapDone == null; step++) {
    const tr = car.body.translation();
    const n = track.nearest(tr.x, tr.z, 2);
    if (n.i >= 0) {
      let d = n.i - (idx % N); if (d < -N / 2) d += N; if (d > N / 2) d -= N;
      if (d > 0 && d < 60) { idx += d; prog += d; }
      maxDev = Math.max(maxDev, n.d); if (n.d > 7) offT += 1 / 120;
    }
    const v = car.vLong;
    const look = Math.round(9 + v * 0.45);
    const tp = track.pts[(idx + look) % N];
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(car.root.quaternion);
    const toT = new THREE.Vector3(tp.x - tr.x, 0, tp.z - tr.z).normalize();
    const err = Math.atan2(fwd.x * toT.z - fwd.z * toT.x, fwd.x * toT.x + fwd.z * toT.z);
    // Kurvenradius voraus -> Zieltempo
    let maxK = 0;
    for (let k = 10; k < 10 + v * 2.2; k += 6) maxK = Math.max(maxK, Math.abs(track.curv[(idx + k) % N]) / 16);
    const vT = Math.min(80, Math.sqrt((17 * 0.85) / Math.max(maxK, 1e-4)));
    const steer = Math.max(-1, Math.min(1, -err * 2.8));
    car.input = { throttle: v < vT ? 1 : 0, brake: v > vT + 2 ? 1 : 0, steer, handbrake: 0 };
    car.storePreStep(); car.physicsStep(1 / 120); world.step(); car.update(1 / 120);
    time += 1 / 120; minV = Math.min(minV, car.speed > 5 ? car.speed : minV);
    if (prog >= N) lapDone = time;
  }
  console.log(`${id}: Runde ${lapDone ? lapDone.toFixed(1) + ' s' : 'nicht beendet'}  Ø ${(track.length / (lapDone || time) * 3.6).toFixed(0)} km/h  max. Abweichung ${maxDev.toFixed(1)} m  neben der Strecke ${offT.toFixed(1)} s  langsamste Kurve ${minV.toFixed(0)} km/h`);
}
