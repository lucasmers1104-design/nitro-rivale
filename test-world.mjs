import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
const { buildWorld } = await import('./src/world.js');
const { LEVEL_ORDER } = await import('./src/levels.js');
await RAPIER.init();
for (const id of LEVEL_ORDER) {
  const world = new RAPIER.World({ x: 0, y: -13.2, z: 0 });
  const g = { RAPIER, world, scene: new THREE.Scene(), gravity: 13.2, owners: new Map(), debris: [], envMap: null };
  const t0 = performance.now();
  const L = buildWorld(g, id);
  const ms = performance.now() - t0;
  const tr = L.track;
  world.step();
  let maxErr = 0, sumErr = 0, n = 0, maxRoad = 0;
  const rnd = (a) => (Math.random() * 2 - 1) * a;
  const hits = (x, z) => { let best = null; world.intersectionsWithRay(new RAPIER.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 }), 400, true, (h) => { if (g.owners.get(h.collider.handle)?.type === 'ground') { best = 200 - h.timeOfImpact; } return true; }); return best; };
  for (let k = 0; k < 3000; k++) {
    const x = rnd(320), z = rnd(320);
    const y = hits(x, z); if (y == null) continue;
    const e = Math.abs(y - tr.heightAt(x, z)); maxErr = Math.max(maxErr, e); sumErr += e; n++;
  }
  for (let i = 0; i < tr.N; i += 7) {
    for (const off of [-6, 0, 6]) {
      const p = tr.pts[i].clone().addScaledVector(tr.side[i], off);
      const y = hits(p.x, p.z); if (y == null) continue;
      maxRoad = Math.max(maxRoad, Math.abs(y - tr.heightAt(p.x, p.z)));
    }
  }
  let objs = 0; L.group.traverse(() => objs++);
  const ys = tr.pts.map((p) => p.y);
  console.log(`${id}: Bauzeit ${ms.toFixed(0)} ms, Objekte ${objs}, Kollider ${world.colliders.len()}, Höhe Straße ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)} m, Gelände-Abweichung max ${maxErr.toFixed(3)} / Ø ${(sumErr / n).toFixed(4)} m, auf der Straße max ${maxRoad.toFixed(3)} m`);
  // Abkürzungen: jede gerade Linie quer über die Wiese, die viel Strecke spart, muss eine Leitplanke kreuzen
  {
    const P = tr.pts, N = tr.N, step = tr.length / N;
    let pairs = 0, open = 0;
    for (let a = 0; a < N; a += 6) for (let gg = 60; gg <= N / 2; gg += 6) {
      const b = (a + gg) % N, d = Math.hypot(P[a].x - P[b].x, P[a].z - P[b].z), along = gg * step;
      if (d > 140 || along - d < 35 || d > along * 0.6) continue;
      pairs++;
      const y = (x, z) => tr.heightAt(x, z) + 0.6, segs = Math.ceil(d / 4);
      let hit = false;
      for (let s = 0; s < segs && !hit; s++) {
        const x0 = P[a].x + ((P[b].x - P[a].x) * s) / segs, z0 = P[a].z + ((P[b].z - P[a].z) * s) / segs;
        const x1 = P[a].x + ((P[b].x - P[a].x) * (s + 1)) / segs, z1 = P[a].z + ((P[b].z - P[a].z) * (s + 1)) / segs;
        const dir = { x: x1 - x0, y: y(x1, z1) - y(x0, z0), z: z1 - z0 }, len = Math.hypot(dir.x, dir.y, dir.z);
        world.intersectionsWithRay(new RAPIER.Ray({ x: x0, y: y(x0, z0), z: z0 }, { x: dir.x / len, y: dir.y / len, z: dir.z / len }), len, true, (h) => { if (g.owners.get(h.collider.handle)?.type === 'rail') { hit = true; return false; } return true; });
      }
      if (!hit) open++;
    }
    console.log(`${open ? '✗' : '✓'} ${id}: Abkürzungen gesperrt ${pairs - open}/${pairs} (${tr.cutRails} neue Planken)`);
    if (open) process.exitCode = 1;
  }
  L.dispose(); world.free();
}
// Auto entfernen gibt Geometrien + Materialien frei (sonst Speicherleck bei jedem Rennen/Streckenwechsel)
{
  const { Car } = await import('./src/car.js');
  const { CARS } = await import('./src/presets.js');
  const world = new RAPIER.World({ x: 0, y: -13.2, z: 0 });
  const car = new Car({ RAPIER, world, scene: new THREE.Scene(), gravity: 13.2, owners: new Map(), envMap: null }, CARS.vipera, 0xff0000, { ai: true });
  const res = new Set(), freed = new Set();
  car.root.traverse((o) => { if (o.isMesh) res.add(o.geometry); for (const m of [].concat(o.material || [])) res.add(m); });
  for (const r of res) r.addEventListener('dispose', () => freed.add(r));
  car.dispose(); world.free();
  console.log(`${freed.size === res.size ? '✓' : '✗'} Auto entfernen: ${freed.size}/${res.size} Geometrien+Materialien freigegeben`);
}
