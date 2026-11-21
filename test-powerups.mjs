// Prüft jedes neue Power-up einzeln auf der Strecke (ohne Grafik)
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
const { buildWorld, gridSlot } = await import('./src/world.js');
const { Car } = await import('./src/car.js');
const { CARS } = await import('./src/presets.js');
const { Items } = await import('./src/items.js');
await RAPIER.init();
const noop = () => {};
function setup(n = 2) {
  const world = new RAPIER.World({ x: 0, y: -13.2, z: 0 }); world.timestep = 1 / 120;
  const fx = { sparks: { burst: noop }, smoke: { emit: noop }, skids: { addQuad: noop }, chunks: { burst: noop }, shake: 0 };
  const g = { RAPIER, world, scene: new THREE.Scene(), gravity: 13.2, owners: new Map(), debris: [], envMap: null, fx, addDebris: noop };
  const L = buildWorld(g, 'tal'); g.track = L.track; g.heightAt = L.track.heightAt;
  const items = new Items(g, L.track, { enabled: true });
  const cars = [];
  for (let k = 0; k < n; k++) {
    const car = new Car(g, CARS[['brutus', 'kaze', 'rhino'][k % 3]], 0xff0000, { ai: true }); car.uid = k + 1;
    const s = gridSlot(L.track, k * 2); s.pos.y = L.track.heightAt(s.pos.x, s.pos.z) + 1.2; car.spawn(s.pos, s.yaw);
    cars.push(car);
  }
  g.cars = () => cars;
  return { g, world, L, items, cars };
}
function step(S, secs, input) {
  for (let i = 0; i < Math.round(secs * 120); i++) {
    if (input) input(i / 120);
    if (i % 2 === 0) { S.items.update(1 / 60, S.cars.map((c, k) => ({ car: c, rankFrac: k / Math.max(1, S.cars.length - 1), isPlayer: false }))); }
    for (const c of S.cars) { c.storePreStep(); c.physicsStep(1 / 120); }
    S.world.step();
    for (const c of S.cars) c.update(1 / 120);
  }
}
const pos = (c) => { const t = c.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); };
const out = [];
const ok = (cond, msg) => out.push(`${cond ? '✓' : '✗'} ${msg}`);
const drive = (c, thr = 1) => (c.input = { throttle: thr, brake: 0, steer: 0, handbrake: 0 });
// Nebelwand
{ const S = setup(1); const [a] = S.cars; step(S, 1, () => drive(a));
  a.item = 'smoke'; S.items.use(a); step(S, 2.5, () => drive(a));
  const back = pos(a).add(new THREE.Vector3(0, 0, 1).applyQuaternion(a.root.quaternion).multiplyScalar(12)); back.y = S.L.track.heightAt(back.x, back.z) + 1.2;
  const d1 = Math.max(...[6, 12, 18, 24, 30].map((k) => { const q = pos(a).add(new THREE.Vector3(0, 0, 1).applyQuaternion(a.root.quaternion).multiplyScalar(k)); q.y = S.L.track.heightAt(q.x, q.z) + 1.4; return S.items.smokeAt(q); }));
  step(S, 6, () => drive(a, 0)); const d2 = S.items.smokeAt(back);
  ok(d1 > 0.5 && d2 < 0.05, `Nebelwand: Dichte hinter dem Auto ${d1.toFixed(2)}, nach 6 s ${d2.toFixed(2)}`); }
// Nagelband
{ const S = setup(2); const [a, b] = S.cars;
  step(S, 0.5); a.item = 'spikes'; S.items.use(a);
  const h = S.items.hazards.find((x) => x.type === 'spikes');
  // b fährt über das Band: direkt drauf setzen
  b.body.setTranslation({ x: h.pos.x, y: h.pos.y + 1.0, z: h.pos.z }, true); step(S, 1.2, () => drive(b, 0.3));
  ok(b.flatT > 0, `Nagelband: Plattfuß beim Überfahrer (${b.flatT.toFixed(1)} s übrig)`); }
// Rampe: ein Auto fährt drüber und hebt ab
{ const S = setup(2); const [a, b] = S.cars;
  step(S, 0.3); a.item = 'ramp'; S.items.use(a);
  const h = S.items.hazards.find((x) => x.type === 'ramp');
  const back = new THREE.Vector3(Math.sin(h.yaw), 0, Math.cos(h.yaw));   // Auffahrtsseite
  const start = h.pos.clone().addScaledVector(back, 22); start.y = S.L.track.heightAt(start.x, start.z) + 1.2;
  b.spawn(start, h.yaw); step(S, 0.3);
  b.body.setLinvel({ x: -back.x * 24, y: 0, z: -back.z * 24 }, true);
  let maxAir = 0; step(S, 2.2, () => { drive(b); const q = pos(b); maxAir = Math.max(maxAir, q.y - S.L.track.heightAt(q.x, q.z)); });
  ok(!!h.body && maxAir > 2.2, `Rampe: Physik-Körper ${h.body ? 'da' : 'fehlt'}, Flughöhe ${maxAir.toFixed(1)} m`); }
// Rammbock: Zeitfenster gesetzt (Schaden-Verdreifachung läuft im Hauptspiel)
{ const S = setup(1); const [a] = S.cars; a.item = 'ram'; S.items.use(a); step(S, 0.2);
  ok(a.ramT > 9, `Rammbock: aktiv für ${a.ramT.toFixed(1)} s, Bügel-Modell ${a.ramBar ? 'montiert' : 'fehlt'}`); }
// Magnet: zieht an den Vordermann heran
{ const S = setup(2); const [a, b] = S.cars;  // a startet vorne (Slot 0), b hinten
  step(S, 0.5);
  const d0 = pos(a).distanceTo(pos(b));
  b.item = 'magnet'; S.items.use(b, a); step(S, 2.5, () => { drive(a, 0.6); drive(b, 0.6); });
  const d1 = pos(a).distanceTo(pos(b));
  const R = setup(2); step(R, 0.5); step(R, 2.5, () => { drive(R.cars[0], 0.6); drive(R.cars[1], 0.6); });
  const dRef = pos(R.cars[0]).distanceTo(pos(R.cars[1]));
  ok(d1 < dRef - 4, `Magnet: Abstand nach 2,5 s ${d1.toFixed(1)} m statt ${dRef.toFixed(1)} m ohne Magnet`); }
// EMP: Autos vor dir verlieren Leistung
{ const S = setup(2); const [a, b] = S.cars;
  step(S, 0.3); b.item = 'emp'; S.items.use(b, a, [a]);
  const v0 = a.speedMs; step(S, 1.5, () => drive(a)); const v1 = a.speedMs;
  const S2 = setup(1); step(S2, 0.3); step(S2, 1.5, () => drive(S2.cars[0])); const vRef = S2.cars[0].speedMs;
  ok(a.empT > 0 && v1 < vRef * 0.5, `EMP: Ziel nach 1,5 s Vollgas ${(v1 * 3.6).toFixed(0)} km/h statt ${(vRef * 3.6).toFixed(0)} km/h`); }
// Geist: fährt durch ein anderes Auto hindurch
{ const S = setup(2); const [a, b] = S.cars;
  step(S, 0.5);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(b.root.quaternion).setY(0).normalize();
  const tgt = pos(b).addScaledVector(fwd, 9); tgt.y = S.L.track.heightAt(tgt.x, tgt.z) + 1.2;
  a.spawn(tgt, Math.atan2(-fwd.x, -fwd.z)); step(S, 0.4);
  b.item = 'ghost'; S.items.use(b);
  b.body.setLinvel({ x: fwd.x * 18, y: 0, z: fwd.z * 18 }, true);
  const aBefore = pos(a); let minD = 99;
  step(S, 1.2, () => { drive(b); minD = Math.min(minD, pos(a).distanceTo(pos(b))); });
  const pushed = pos(a).distanceTo(aBefore);
  const passed = new THREE.Vector3().subVectors(pos(b), pos(a)).dot(fwd) > 0;
  ok(b.ghostOn && passed && pushed < 1.0, `Geist: durchgefahren ${passed ? 'ja' : 'nein'}, anderes Auto verschoben um ${pushed.toFixed(2)} m, kleinster Abstand ${minD.toFixed(1)} m`);
  step(S, 4, () => drive(b, 0)); ok(!b.ghostOn, 'Geist: nach Ablauf wieder fest'); }
console.log(out.join('\n'));
