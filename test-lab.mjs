import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
const { buildWorld } = await import('./src/world.js');
const { LEVELS } = await import('./src/levels.js');
const LAB = LEVELS.tal.extras.lab;
const { Car } = await import('./src/car.js');
const { CARS } = await import('./src/presets.js');
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -13.2, z: 0 }); world.timestep = 1 / 120;
const fx = { sparks: { burst() {} }, smoke: { emit() {} }, skids: { addQuad() {} }, chunks: { burst() {} }, shake: 0 };
const g = { RAPIER, world, scene: new THREE.Scene(), gravity: 13.2, owners: new Map(), debris: [], envMap: null, fx };
const { track } = buildWorld(g); g.track = track; g.heightAt = track.heightAt; g.addDebris = () => {};
const car = new Car(g, CARS.brutus, 0xff0000, { isPlayer: true }); car.uid = 1;
car.spawn(new THREE.Vector3(LAB.x, g.heightAt(LAB.x, LAB.z) + 1.0, LAB.z), Math.PI / 2);
car.input = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
const eq = new RAPIER.EventQueue(true);
const step = () => { car.storePreStep(); car.physicsStep(1 / 120); world.step(eq); car.update(1 / 120); };
for (let i = 0; i < 120; i++) step();
// Rammbock wie in fireRam (Front, 90 km/h, 2.4 t)
const v = 25, w = 1.9, h = 1.35, l = 4.0;
const t = car.body.translation(), q = car.root.quaternion;
const target = new THREE.Vector3(0, 0, -CARS.brutus.dims.l * 0.5).applyQuaternion(q).add(new THREE.Vector3(t.x, 0, t.z));
const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).setY(0).normalize();
const pos = target.clone().addScaledVector(dir, 13 + l / 2); pos.y = g.heightAt(pos.x, pos.z) + h / 2 + 0.1;
const vel = dir.clone().multiplyScalar(-v);
const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().negate());
console.log('car', t, 'dir', dir, 'ram start', pos, 'vel', vel);
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }).setLinvel(vel.x, vel.y, vel.z).lockRotations().setCcdEnabled(true).setGravityScale(0));
const col = world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, l / 2).setMass(2400).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.05), body);
g.owners.set(col.handle, { type: 'ram', body });
for (let i = 0; i < 120; i++) {
  step();
  let n = 0; eq.drainContactForceEvents((e) => { n++;
    const o1 = g.owners.get(e.collider1()), o2 = g.owners.get(e.collider2());
    if ((o1?.type === 'car' || o2?.type === 'car') && !car._hit) {
      let point, normal; world.contactPair(world.getCollider(e.collider1()), world.getCollider(e.collider2()), (m) => { if (point || !m.numSolverContacts()) return; const p = m.solverContactPoint(0); point = new THREE.Vector3(p.x, p.y, p.z); const nn = m.normal(); normal = new THREE.Vector3(nn.x, nn.y, nn.z); });
      if (point) { const vA = car.velocityAtPrev(point, new THREE.Vector3()); const vb = body.linvel(); const sp = Math.abs(new THREE.Vector3(vb.x, vb.y, vb.z).sub(vA).dot(normal)); const tt = car.body.translation(); const d = normal.clone(); if (d.dot(new THREE.Vector3(tt.x, tt.y, tt.z).sub(point)) < 0) d.negate(); car._hit = car.applyImpact(point, d, sp * 1.65); console.log('IMPACT speed', sp.toFixed(1), 's', car._hit.toFixed(2)); }
    } });
  const others = []; world.contactPairsWith(col, (c2) => others.push((g.owners.get(c2.handle)?.type || 'none') + '@' + JSON.stringify(c2.translation())));
  if (others.length && i > 35) console.log(i, 'contacts', others.join(' '), 'car', JSON.stringify(car.body.translation()));
  if (i % 10 === 0 || n) { const r = body.translation(), lv = body.linvel(); console.log(i, 'ram', r.x.toFixed(2), r.y.toFixed(2), r.z.toFixed(2), 'v', lv.x.toFixed(1), lv.y.toFixed(1), 'events', n); }
  if (i > 100) break;
}
console.log(JSON.stringify(car.stats));
