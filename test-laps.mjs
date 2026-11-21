// Rundenzählung prüfen: node test-laps.mjs
// Ein Auto fährt die Mittellinie ab; einmal "kürzt" es 250 Punkte (~200 m) ab. Danach muss weitergezählt werden.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Race } from './src/race.js';
import { Track } from './src/world.js';
import { LEVELS } from './src/levels.js';

function lapRun(skipAt = null, skip = 0) {
  const tr = new Track(LEVELS.tal), N = tr.N;
  let i = N - 20; // Startaufstellung kurz vor der Linie
  const car = {
    input: { throttle: 1 },
    root: { quaternion: new THREE.Quaternion() },
    body: { translation: () => tr.pts[i], linvel: () => ({ x: tr.tan[i].x * 30, y: 0, z: tr.tan[i].z * 30 }) },
  };
  const yawTo = () => car.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tr.tan[i]);
  yawTo();
  const race = new Race(tr, { laps: 3 });
  const e = race.add(car, { name: 'Test', isPlayer: true });
  race.start(0); for (let k = 0; k < 200 && race.phase !== 'running'; k++) race.update(1 / 60); // Ampel abwarten
  race.events.length = 0;
  const laps = [], shortcuts = [];
  let skipped = false;
  for (let step = 0; step < 20000 && !e.finished; step++) {
    if (!skipped && skipAt != null && e.lap === 1 && (i % N) === skipAt) { i = (i + skip) % N; skipped = true; }
    else i = (i + 1) % N; // ~0,8 m je Schritt bei 60 Bildern/s ≈ 170 km/h
    yawTo();
    race.update(1 / 60);
    for (const ev of race.events) { if (ev.type === 'lap') laps.push(ev.lap); if (ev.type === 'shortcut') shortcuts.push(ev); }
    race.events.length = 0;
  }
  return { e, laps, shortcuts, N };
}

const normal = lapRun();
assert.deepEqual(normal.laps, [1, 2, 3], 'ohne Abkürzung: 3 Runden');
assert.ok(normal.e.finished, 'ohne Abkürzung im Ziel');

const cut = lapRun(400, 250);
console.log(`Abkürzung (250 Punkte): Runden ${cut.laps.join(',')}, im Ziel ${cut.e.finished}, Hinweis ${cut.shortcuts.length}×, gefahren ${(cut.e.total / cut.N).toFixed(2)} Runden`);
assert.ok(cut.e.finished, 'mit Abkürzung trotzdem im Ziel (vorher hing der Fortschritt eine ganze Runde fest)');
assert.deepEqual(cut.laps, [1, 2, 3], 'jede Runde wird genau einmal gezählt');
assert.equal(cut.shortcuts.length, 1, 'genau ein Abkürzungs-Hinweis');
// die abgekürzte Strecke wurde nicht gutgeschrieben: das Auto braucht dafür länger als ohne Abkürzung
assert.ok(cut.e.finishTime > normal.e.finishTime - 250 / 60 + 0.5, 'Abkürzung bringt keinen Vorteil');
console.log(`Zielzeit ohne Abkürzung ${normal.e.finishTime.toFixed(1)} s, mit ${cut.e.finishTime.toFixed(1)} s`);
assert.ok(cut.e.finishTime < normal.e.finishTime + 3, 'Abkürzung kostet nicht fast eine ganze Runde (Fortschritt hing fest)');
console.log('Rundenzählung OK');
