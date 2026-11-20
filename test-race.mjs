// Bot-Rennen ohne Grafik: alle Strecken, 8 Autos, Power-ups an
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
const { buildWorld, gridSlot } = await import('./src/world.js');
const { LEVEL_ORDER } = await import('./src/levels.js');
const { Car } = await import('./src/car.js');
const { CARS } = await import('./src/presets.js');
const { Race } = await import('./src/race.js');
const { BotDriver } = await import('./src/bot.js');
const { Items } = await import('./src/items.js');
await RAPIER.init();
const only = process.argv[2];
const laps = Number(process.argv[3] || 2);
const skill = process.argv[4] || 'profi';
const nCars = Number(process.argv[5] || 8);
const noop = () => {};
for (const id of LEVEL_ORDER) {
  if (only && only !== id) continue;
  const world = new RAPIER.World({ x: 0, y: -13.2, z: 0 }); world.timestep = 1 / 120;
  const fx = { sparks: { burst: noop }, smoke: { emit: noop }, skids: { addQuad: noop }, chunks: { burst: noop }, shake: 0 };
  const g = { RAPIER, world, scene: new THREE.Scene(), gravity: 13.2, owners: new Map(), debris: [], envMap: null, fx, addDebris: noop };
  const L = buildWorld(g, id); g.track = L.track; g.heightAt = L.track.heightAt;
  const tr = L.track;
  const race = new Race(tr, { laps });
  const items = new Items(g, tr, { enabled: true });
  const ids = ['brutus', 'kaze', 'rhino'];
  const cars = [];
  let respawns = 0, uses = {}, hits = 0;
  for (let k = 0; k < nCars; k++) {
    const pid = ids[k % 3];
    const car = new Car(g, CARS[pid], 0xff0000, { ai: true }); car.uid = k + 1;
    const s = gridSlot(tr, k);
    s.pos.y = tr.heightAt(s.pos.x, s.pos.z) + 1.2;
    car.spawn(s.pos, s.yaw);
    cars.push(car);
    const bot = new BotDriver(car, tr, skill, (k + 1) * 0.137);
    race.add(car, { name: 'Bot ' + (k + 1), bot });
  }
  g.cars = () => cars;
  race.start(0.5);
  let t = 0, maxSteps = 120 * 60 * 6;
  const respawn = (car) => {
    const e = race.entryOf(car); const r = race.respawnPose(e); if (process.env.DBG) { const q = car.body.translation(); const n = tr.nearest(q.x, q.z, 3); console.log(`  Neustart ${e.name} bei ${Math.round(e.lastI * 0.8)} m, Abstand ${n.d.toFixed(1)}, flip ${car.flipTimer.toFixed(1)}, v ${car.speedMs.toFixed(1)}, y ${q.y.toFixed(1)}`); }
    r.pos.y = tr.heightAt(r.pos.x, r.pos.z) + 1.3; car.spawn(r.pos, r.yaw); respawns++;
  };
  for (let step = 0; step < maxSteps && race.phase !== 'done'; step++) {
    const dt = 1 / 120;
    if (step % 2 === 0) {
      race.update(dt * 2);
      for (const e of race.entries) {
        const prog = race.progressM(e);
        e.bot.update(dt * 2, {
          running: race.phase === 'running', cars: race.entries.map((o) => ({ car: o.car, prog: race.progressM(o) })), myProg: prog,
          respawn, useItem: (c) => { const it = c.item; const ahead = race.sorted?.find((o) => o.place === e.place - 1)?.car || null; if (items.use(c, ahead)) uses[it] = (uses[it] || 0) + 1; }, water: null,
        });
      }
      items.update(dt * 2, race.entries.map((e) => ({ car: e.car, rankFrac: (e.place - 1) / Math.max(1, race.entries.length - 1), isPlayer: false })));
      for (const ev of items.events) if (ev.type === 'hit') hits++;
      items.events.length = 0;
      race.events.length = 0;
    }
    for (const c of cars) { c.storePreStep(); c.physicsStep(dt); }
    world.step();
    for (const c of cars) c.update(dt);
    t += dt;
  }
  const res = race.results();
  const best = Math.min(...race.entries.map((e) => e.bestLap ?? 1e9));
  const fin = race.entries.filter((e) => e.finished).length;
  console.log(`${id}: ${fin}/${nCars} im Ziel nach ${race.time.toFixed(1)} s, beste Runde ${best.toFixed(1)} s (Ø ${(tr.length / best * 3.6).toFixed(0)} km/h), Neustarts ${respawns}, Treffer ${hits}, Items ${JSON.stringify(uses)}`);
  console.log('   ' + res.map((r) => `${r.place}. ${r.name} ${r.car} ${r.time.toFixed(1)}${r.est ? '*' : ''}`).join(' | '));
  L.dispose(); world.free();
}
