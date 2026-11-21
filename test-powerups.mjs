// Prüft jedes neue Power-up einzeln auf der Strecke (ohne Grafik)
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
const { buildWorld, gridSlot } = await import('./src/world.js');
const { Car } = await import('./src/car.js');
const { CARS } = await import('./src/presets.js');
const { Items, itemWeights } = await import('./src/items.js');
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
// Wegräumen gibt Geometrien frei: Explosionsring, abgelaufenes Nagelband, Fass beim Rennende
{ const S = setup(1); const [a] = S.cars;
  S.items.flash(pos(a), 0xff8a2a, 3); a.item = 'spikes'; S.items.use(a); a.item = 'barrel'; S.items.use(a);
  const geos = new Set(), freed = new Set();
  S.items.rings[0].mesh.traverse((o) => o.geometry && geos.add(o.geometry));
  for (const h of S.items.hazards) h.mesh.traverse((o) => o.geometry && geos.add(o.geometry));
  for (const g of geos) g.addEventListener('dispose', () => freed.add(g));
  S.items.hazards.find((h) => h.type === 'spikes').life = 0.5;
  step(S, 1); S.items.dispose();
  ok(freed.size === geos.size, `Power-up-Reste freigegeben: ${freed.size}/${geos.size} Geometrien`); }
// Fass über dem Limit und Fass, das ein Mitspieler sprengt: Geometrien frei, Explosion kennt den Besitzer
{ const S = setup(1); const [a] = S.cars;
  const geos = (h) => { const s = []; h.mesh.traverse((o) => o.geometry && s.push(o.geometry)); return s; };
  const freed = new Set(), watch = (h) => { const g = geos(h); for (const x of g) x.addEventListener('dispose', () => freed.add(x)); return g; };
  a.item = 'barrel'; S.items.use(a); const g1 = watch(S.items.hazards[0]);
  for (let k = 0; k < 8; k++) { a.item = 'barrel'; S.items.use(a); }
  const h2 = S.items.hazards[0], g2 = watch(h2);
  S.items.events.length = 0;
  S.items.remote({ type: 'boom', hz: h2.id, pos: [h2.pos.x, h2.pos.y, h2.pos.z], r: 7, k: 1.15 }, () => null);
  const hit = S.items.events.find((e) => e.type === 'hit');
  ok([...g1, ...g2].every((g) => freed.has(g)) && hit?.by === a, `Fässer weggeräumt: ${[...g1, ...g2].filter((g) => freed.has(g)).length}/${g1.length + g2.length} Geometrien frei, Treffer von ${hit?.by === a ? 'Besitzer' : 'unbekannt'}`); }
// Power-ups aus: update/dispose dürfen nicht abstürzen
{ const S = setup(1); S.items.dispose(); S.items = new Items(S.g, S.L.track, { enabled: false });
  let err = null; try { step(S, 0.2); S.items.dispose(); } catch (e) { err = e.message; }
  ok(!err, `Power-ups aus: Rennen läuft ${err ? '– Fehler: ' + err : 'ohne Fehler'}`); }
// Rakete: viel Schaden + kurz außer Gefecht
{ const S = setup(2); const [a, b] = S.cars;  // a vorne, b feuert von hinten
  step(S, 0.5);
  const hp0 = a.bodyHp; b.item = 'rocket'; S.items.use(b, a);
  let stun = 0; step(S, 2, () => { drive(a); stun = Math.max(stun, a.stunT); });
  ok(stun > 1.2 && a.bodyHp < hp0 - 30, `Rakete: außer Gefecht ${stun.toFixed(1)} s, Karosserie ${hp0.toFixed(0)} → ${a.bodyHp.toFixed(0)}`);
  a.stunT = 1; const v0 = a.speedMs; step(S, 0.8, () => drive(a)); ok(a.speedMs <= v0 + 0.5, `Rakete: kein Gas solange außer Gefecht (${(v0 * 3.6).toFixed(0)} → ${(a.speedMs * 3.6).toFixed(0)} km/h)`); }
// Nebelwand: der eigene Rauch stört die eigene Sicht nicht
{ const S = setup(1); const [a] = S.cars; step(S, 1, () => drive(a));
  a.item = 'smoke'; S.items.use(a); step(S, 1.2, () => drive(a));
  const cam = pos(a).add(new THREE.Vector3(0, 2, 7).applyQuaternion(a.root.quaternion));
  const others = S.items.smokeAt(cam), mine = S.items.smokeAt(cam, a);
  S.items.smokeWall.update(0, cam, a);
  const m = new THREE.Matrix4(), pp = new THREE.Vector3();
  let near = 0, shown = 0; for (let k = 0; k < S.items.smokeWall.mesh.count; k++) { S.items.smokeWall.mesh.getMatrixAt(k, m); pp.setFromMatrixPosition(m); if (pp.distanceTo(cam) < 4) { near++; shown += Math.hypot(m.elements[0], m.elements[1], m.elements[2]) > 0.01 ? 1 : 0; } }
  ok(mine === 0 && shown === 0, `Nebelwand: eigener Schleier ${mine.toFixed(2)} (für Verfolger ${others.toFixed(2)}), ${near} Wolken direkt vor der Kamera, davon sichtbar ${shown}`); }
// Ausgeschiedene Autos sammeln keine Kisten mehr
{ const S = setup(1); const [a] = S.cars; const bx = S.items.boxes[0];
  a.out = true; a.spawn(bx.pos.clone(), 0); step(S, 0.3);
  const outGot = !!a.item || bx.off > 0;
  a.out = false; step(S, 0.1);
  ok(!outGot && !!a.item, `Ausgeschieden: Kiste ${outGot ? 'eingesammelt' : 'bleibt liegen'}, wieder im Rennen: ${a.item || 'nichts'}`); }
// Geist: Teile, die währenddessen abfallen, sind danach nicht mehr halbdurchsichtig
{ const S = setup(1); const [a] = S.cars; a.item = 'ghost'; S.items.use(a); step(S, 0.1);
  const part = a.parts.find((x) => x.state !== 'gone'), dir = new THREE.Vector3(1, 0, 0);
  a.detachPart(part, dir, 10); a.loseWheel(a.wheels[0], dir);
  const mats = []; for (const o of [part.obj, a.wheels[0].hold]) o.traverse((m) => { if (m.isMesh) mats.push(...[].concat(m.material)); });
  const see = mats.filter((m) => m.opacity === 0.32).length;
  ok(a.ghostOn && see === 0, `Geist: abgefallene Teile wieder fest (${see} von ${mats.length} Materialien halbdurchsichtig)`); }
// Wahrscheinlichkeiten nach Platz
{ const share = (w, k) => (w[k] || 0) / Object.values(w).reduce((x, y) => x + y, 0);
  const last = itemWeights(1), first = itemWeights(0), mid = itemWeights(0.5);
  ok(share(last, 'rocket') >= 0.2 && share(last, 'nitro') >= 0.2 && !first.rocket && share(mid, 'rocket') > 0 && share(mid, 'rocket') < share(last, 'rocket'),
    `Power-ups nach Platz: Letzter Rakete ${(share(last, 'rocket') * 100).toFixed(0)} %, Nitro ${(share(last, 'nitro') * 100).toFixed(0)} % · Mitte Rakete ${(share(mid, 'rocket') * 100).toFixed(0)} % · Erster Rakete 0 %`);
  ok(!itemWeights(1, { derby: true, hurt: true }).repair && itemWeights(1, { hurt: true }).repair > 3, 'Derby: keine Reparatur, sonst bei Schaden öfter'); }
// Magnet eines Mitspielers (Ghost, ohne eigene Physik): Strahl endet nach Ablauf; Strahl eines neu aufgebauten Autos verschwindet
{ const S = setup(2); const [a, b] = S.cars; step(S, 0.3);
  a.netId = 'A'; b.netId = 'B';
  S.items.remote({ type: 'use', id: 'B', item: 'magnet', target: 'A' }, (id) => S.cars.find((c) => c.netId === id));
  const st = { v: { x: 0, y: 0, z: 0 }, av: { x: 0, y: 0, z: 0 }, steer: 0, rpm: 900, gear: 1, throttle: 0, flame: 0, flags: 0 };
  let shown = false;
  for (let i = 0; i < 60 * 4; i++) { b.ghostPrep(st, 1 / 60); S.items.update(1 / 60, []); if (i === 30) shown = S.items.beams.has(b); }
  ok(shown && b.magnetT === 0 && !S.items.beams.has(b), `Magnet beim Mitspieler: Strahl ${shown ? 'sichtbar' : 'fehlt'}, nach 4 s ${S.items.beams.has(b) ? 'NOCH DA' : 'weg'}`);
  a.magnetT = 3; a.magnetTarget = b; S.items.update(1 / 60, []);
  const had = S.items.beams.has(a); S.cars.splice(0, 1, { ...a, disposed: true }); a.disposed = true; S.items.update(1 / 60, []);
  ok(had && !S.items.beams.has(a), 'Magnet: Strahl eines reparierten (neu aufgebauten) Autos wird entfernt'); }
console.log(out.join('\n'));
process.exit(out.some((l) => l.startsWith('✗')) ? 1 : 0);
