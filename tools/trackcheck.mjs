import * as THREE from 'three';
import fs from 'fs';
const { LEVELS } = await import('../src/levels.js');
const out = {};
for (const L of Object.values(LEVELS)) {
  const curve = new THREE.CatmullRomCurve3(L.ctrl.map(([x, z, y]) => new THREE.Vector3(x, y || 0, z)), true, 'centripetal');
  const len = curve.getLength(), N = Math.round(len / 0.8);
  const pts = curve.getSpacedPoints(N); pts.pop();
  const tan = pts.map((p, i) => new THREE.Vector3().subVectors(pts[(i + 1) % N], pts[(i - 1 + N) % N]).setY(0).normalize());
  const curv = pts.map((_, i) => { const a = tan[(i - 10 + N) % N], b = tan[(i + 10) % N]; return Math.atan2(a.x * b.z - a.z * b.x, a.dot(b)); });
  const rad = curv.map((c) => 16 / Math.max(Math.abs(c), 1e-4));
  // Kurven
  const corners = [];
  let i = 0;
  while (i < N) {
    if (rad[i] < 120) { let j = i, mr = 1e9, mi = i; while (j < N && rad[j] < 120) { if (rad[j] < mr) { mr = rad[j]; mi = j; } j++; } corners.push({ at: Math.round(mi * 0.8), r: Math.round(mr), v: Math.round(Math.sqrt(16.9 * 0.92 * mr) * 3.6) }); i = j; } else i++;
  }
  // Mindestabstand nicht benachbarter Abschnitte
  let md = 1e9, mdAt = null;
  for (let a = 0; a < N; a += 4) for (let b = a + 100; b < N; b += 4) {
    if (N - (b - a) < 100) continue;
    const d = Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z);
    if (d < md) { md = d; mdAt = [Math.round(a * 0.8), Math.round(b * 0.8), +(pts[a].y - pts[b].y).toFixed(1)]; }
  }
  let maxG = 0, maxX = 0;
  for (let k = 0; k < N; k++) { const g = Math.abs(pts[(k + 6) % N].y - pts[k].y) / 4.8; maxG = Math.max(maxG, g); maxX = Math.max(maxX, Math.abs(pts[k].x), Math.abs(pts[k].z)); }
  // Gerade vor dem Start (für die Startaufstellung)
  let straight = 0; for (let k = N - 1; k > N / 2 && rad[k] > 300; k--) straight += 0.8;
  console.log(`${L.id}: ${Math.round(len)} m, Kurven ${corners.length}, engste ${Math.min(...corners.map((c) => c.r))} m, Mindestabstand ${md.toFixed(0)} m bei ${JSON.stringify(mdAt)}, max Steigung ${(maxG * 100).toFixed(0)}%, max |x|,|z| ${maxX.toFixed(0)}, Gerade vor Start ${straight.toFixed(0)} m${L.ctrl.closeErr != null ? `, Schließfehler ${L.ctrl.closeErr.toFixed(1)} m / ${L.ctrl.headErr.toFixed(1)}°` : ''}`);
  console.log('   ' + corners.map((c) => `${c.at}m:R${c.r}(${c.v})`).join('  '));
  out[L.id] = { pts: pts.filter((_, k) => k % 3 === 0).map((p) => [p.x, p.z, p.y]), rad: rad.filter((_, k) => k % 3 === 0) };
}
fs.writeFileSync('/tmp/tracks.json', JSON.stringify(out));
