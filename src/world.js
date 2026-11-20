import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LEVELS, THEMES } from './levels.js';

// Deterministischer Zufall: wichtig für Multiplayer (alle Clients bauen dieselbe Welt)
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function vhash(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = vhash(xi, zi), b = vhash(xi + 1, zi), c = vhash(xi, zi + 1), d = vhash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z) => vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 7, z * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, z * 4.3 + 9) * 0.15;

export const BOUND = 330;
const TER = { size: 680, n: 170 };

export const SURF = {
  asphalt: { type: 'asphalt', mu: 1.3, roll: 1 },
  curb: { type: 'curb', mu: 1.15, roll: 1.5 },
  grass: { type: 'grass', mu: 0.8, roll: 4, off: true },
  sand: { type: 'sand', mu: 0.72, roll: 6.5, off: true },
  snow: { type: 'snow', mu: 0.62, roll: 5, off: true },
  gravel: { type: 'gravel', mu: 0.6, roll: 9, off: true },
  water: { type: 'water', mu: 0.45, roll: 22, off: true },
};
const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });

// Rechteck-Zonen (gedreht) und Kreise: dort wird das Gelände eben
function zoneWeight(z, x, zz) {
  const b = Math.max(0.5, z.blend ?? (z.r ? 25 : 22));
  if (z.r) return 1 - sstep(Math.hypot(x - z.x, zz - z.z) - z.r, 0, b);
  const dx = x - z.x, dz = zz - z.z, c = Math.cos(z.yaw || 0), s = Math.sin(z.yaw || 0);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return 1 - sstep(Math.max(Math.abs(lx) - z.hw, Math.abs(lz) - z.hd), 0, b);
}

// ---------------------------------------------------------------------------
// Strecke
// ---------------------------------------------------------------------------
export class Track {
  constructor(level) {
    this.level = level;
    this.theme = THEMES[level.theme];
    this.curve = new THREE.CatmullRomCurve3(level.ctrl.map(([x, z, y]) => new THREE.Vector3(x, y || 0, z)), true, 'centripetal');
    this.length = this.curve.getLength();
    this.N = Math.round(this.length / 0.8);
    const pts = this.curve.getSpacedPoints(this.N);
    pts.pop();
    this.pts = pts;
    // Straßenhöhe entlang der Strecke glätten (Ausgangswert, später = Gelände)
    const N = this.N, ys = pts.map((p) => p.y);
    this.roadY = ys.map((_, i) => { let s = 0; for (let k = -12; k <= 12; k++) s += ys[(i + k + N) % N]; return s / 25; });
    this.tan = pts.map((p, i) => new THREE.Vector3().subVectors(pts[(i + 1) % N], pts[(i - 1 + N) % N]).setY(0).normalize());
    this.side = this.tan.map((t) => new THREE.Vector3(-t.z, 0, t.x));
    // Krümmung (>0: Kurve zur side-Richtung). Außenseite = -sign(curv)
    this.curv = pts.map((_, i) => {
      const a = this.tan[(i - 10 + N) % N], b = this.tan[(i + 10) % N];
      return Math.atan2(a.x * b.z - a.z * b.x, a.dot(b));
    });
    // Kiesbett an der Außenseite schneller Kurven
    this.gravel = this.curv.map((_, i) => {
      let m = 0;
      for (let k = -18; k <= 18; k += 3) m = Math.max(m, Math.abs(this.curv[(i + k + N) % N]));
      return m > 0.3 ? -Math.sign(this.curv[i] || 1) : 0;
    });
    this.cell = 10;
    this.grid = new Map();
    pts.forEach((p, i) => {
      const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
    this.width = level.width || 14;
    this.heightAt = () => 0;
    this.extras = level.extras || {};
    this.offroad = SURF[this.theme.offroad] || SURF.grass;
  }
  key(cx, cz) { return cx * 10007 + cz; }
  nearest(x, z, rad = 1) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      const arr = this.grid.get(this.key(cx + dx, cz + dz));
      if (!arr) continue;
      for (const i of arr) {
        const p = this.pts[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return { i: best, d: Math.sqrt(bd) };
  }
  // Seitlicher Versatz eines Punktes zur Mittellinie (+ = side-Richtung)
  offsetAt(i, x, z) { const p = this.pts[i], s = this.side[i]; return (x - p.x) * s.x + (z - p.z) * s.z; }
  surfaceAt(x, z) {
    const E = this.extras, W = this.width;
    if (E.lake && (x - E.lake.x) ** 2 + (z - E.lake.z) ** 2 < (E.lake.r - 6) ** 2) return SURF.water;
    if (E.arena && (x - E.arena.x) ** 2 + (z - E.arena.z) ** 2 < (E.arena.r - 1) ** 2) return SURF.asphalt;
    if (E.lab && Math.abs(x - E.lab.x) < E.lab.w / 2 && Math.abs(z - E.lab.z) < E.lab.d / 2) return SURF.asphalt;
    if (E.ramp && x > E.ramp.x - 8 && x < E.ramp.x + 46 && z > E.ramp.z - 13 && z < E.ramp.z + 13) return SURF.asphalt;
    if (E.arena && Math.abs(x - E.arena.x) < 8 && z > E.arena.z - E.arena.r - 24 && z < E.arena.z - E.arena.r + 2) return SURF.asphalt;
    if (this.theme.sea && Math.max(Math.abs(x), Math.abs(z)) > BOUND + 2) return SURF.water;
    const n = this.nearest(x, z, 2);
    if (n.i < 0) return this.offroad;
    if (n.d < W / 2) return SURF.asphalt;
    if (n.d < W / 2 + 1.3) return SURF.curb;
    const g = this.gravel[n.i];
    if (g && n.d < W / 2 + 13 && Math.sign(this.offsetAt(n.i, x, z)) === g) return SURF.gravel;
    return this.offroad;
  }
}

// Startaufstellung: versetzt, zwei Spuren
export function gridSlot(track, k) {
  const N = track.N, i = (N - 12 - k * 10) % N, s = k % 2 ? 1 : -1;
  const p = track.pts[i].clone().addScaledVector(track.side[i], s * Math.min(3.6, track.width / 4));
  const t = track.tan[i];
  return { i, pos: p, yaw: Math.atan2(-t.x, -t.z) };
}

// ---------------------------------------------------------------------------
// Gelände (Heightfield) – gleiche Daten für Physik und Optik
// ---------------------------------------------------------------------------
class Terrain {
  constructor(track, zones) {
    const { size, n } = TER;
    const T = track.theme, E = track.extras;
    this.size = size; this.n = n; this.step = size / n;
    const N1 = n + 1;
    this.h = new Float32Array(N1 * N1); // Index: i (z-Zeile) + j (x-Spalte) * N1
    this.dRoad = new Float32Array(N1 * N1);
    const sx = [], sz = [], sy = [];
    track.pts.forEach((p, i) => { if (i % 3 === 0) { sx.push(p.x); sz.push(p.z); sy.push(track.roadY[i]); } });
    const ns = sx.length;
    for (let j = 0; j <= n; j++) {
      const x = -size / 2 + j * this.step;
      for (let i = 0; i <= n; i++) {
        const z = -size / 2 + i * this.step;
        let md = Infinity, sw = 0, swy = 0;
        for (let k = 0; k < ns; k++) {
          const d2 = (sx[k] - x) ** 2 + (sz[k] - z) ** 2;
          if (d2 < md) md = d2;
          const w = 1 / (d2 + 4) ** 3;
          sw += w; swy += w * sy[k];
        }
        md = Math.sqrt(md);
        const ry = swy / sw;
        const w = sstep(md, track.width / 2 + 10, 62);
        let hgt = ry + (fbm(x / 120 + 3.1, z / 120 + 7.7) - 0.3) * 19 * T.hills * w;
        for (const zn of zones) { const zw = zoneWeight(zn, x, z); if (zw > 0) hgt = lerp(hgt, zn.y, zw); }
        if (E.lake) {
          const lr = Math.hypot(x - E.lake.x, z - E.lake.z);
          if (lr < E.lake.r + 4) hgt = Math.min(hgt, -3.4 * (1 - sstep(lr, E.lake.r * 0.55, E.lake.r + 3)));
        }
        const r = Math.max(Math.abs(x), Math.abs(z));
        if (T.sea) {
          hgt = lerp(hgt, 0.3, sstep(r, BOUND - 45, BOUND - 12));
          if (r > BOUND + 2) hgt = lerp(0.3, -2.5, sstep(r, BOUND + 2, BOUND + 9));
        } else hgt = lerp(hgt, 0, sstep(r, BOUND - 25, BOUND + 8));
        this.h[i + j * N1] = hgt;
        this.dRoad[i + j * N1] = md;
      }
    }
  }
  // Gleiche Dreiecksaufteilung wie das sichtbare Gelände
  heightAt(x, z) {
    const { size, n, step } = this;
    const fx = (x + size / 2) / step, fz = (z + size / 2) / step;
    if (fx < 0 || fz < 0 || fx >= n || fz >= n) return 0;
    const j = Math.floor(fx), i = Math.floor(fz), u = fx - j, v = fz - i, N1 = n + 1;
    const a = this.h[i + j * N1], b = this.h[i + (j + 1) * N1], d = this.h[i + 1 + j * N1], e = this.h[i + 1 + (j + 1) * N1];
    if (u + v <= 1) return a + (b - a) * u + (d - a) * v;
    return e + (d - e) * (1 - u) + (b - e) * (1 - v);
  }
  roadDist(x, z) {
    const { size, n, step } = this;
    const j = Math.round((x + size / 2) / step), i = Math.round((z + size / 2) / step);
    if (i < 0 || j < 0 || i > n || j > n) return 999;
    return this.dRoad[i + j * (n + 1)];
  }
}

// ---------------------------------------------------------------------------
// Vegetation: zusammengeführte Low-Poly-Geometrien mit Vertexfarben
// ---------------------------------------------------------------------------
function plantTypes() {
  const C = (hex) => new THREE.Color(hex);
  const colorize = (geo, color) => {
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
  };
  const ni = (g) => (g.index ? g.toNonIndexed() : g);
  const strip = (g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; };
  const merge = (parts) => mergeGeometries(parts.map(([g, c]) => colorize(strip(ni(g)), C(c))));
  const cyl = (r0, r1, h, s = 6) => new THREE.CylinderGeometry(r0, r1, h, s);
  const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s);
  const ico = (r) => new THREE.IcosahedronGeometry(r, 0);
  // Palme: gebogener Stamm aus Segmenten + hängende Wedel
  const palm = () => {
    const parts = [];
    let x = 0, y = 0;
    for (let k = 0; k < 7; k++) {
      const seg = cyl(0.2 - k * 0.012, 0.24 - k * 0.012, 1.15, 6);
      const lean = 0.05 + k * 0.035;
      seg.rotateZ(-lean).translate(x + Math.sin(lean) * 0.55, y + 0.55, 0);
      parts.push([seg, k % 2 ? 0x8a6a48 : 0x7a5c3e]);
      x += Math.sin(lean) * 1.12; y += Math.cos(lean) * 1.12;
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const leaf = new THREE.BufferGeometry();
      const L = 3.2, W = 0.55;
      const v = [0, 0, 0, L * 0.5, 0.35, W, L * 0.5, 0.35, -W, L, -0.9, 0];
      leaf.setAttribute('position', new THREE.Float32BufferAttribute([...v.slice(0, 3), ...v.slice(3, 6), ...v.slice(6, 9), ...v.slice(3, 6), ...v.slice(9, 12), ...v.slice(6, 9)], 3));
      leaf.computeVertexNormals();
      leaf.rotateY(a).translate(x, y, 0);
      parts.push([leaf, k % 2 ? 0x3f8f3a : 0x4fa044]);
    }
    parts.push([ico(0.18).translate(x + 0.2, y - 0.25, 0.1), 0x6b4a2a], [ico(0.18).translate(x - 0.1, y - 0.3, -0.2), 0x6b4a2a]);
    return merge(parts);
  };
  const cactus = () => merge([
    [cyl(0.32, 0.38, 4.2, 8).translate(0, 2.1, 0), 0x4f8a3c], [ico(0.33).scale(1, 0.6, 1).translate(0, 4.2, 0), 0x5a9645],
    [cyl(0.2, 0.2, 0.9, 7).rotateZ(Math.PI / 2).translate(0.6, 1.9, 0), 0x4f8a3c], [cyl(0.2, 0.22, 1.5, 7).translate(1.05, 2.6, 0), 0x56913f],
    [cyl(0.18, 0.18, 0.7, 7).rotateZ(Math.PI / 2).translate(-0.5, 2.6, 0), 0x4f8a3c], [cyl(0.18, 0.2, 1.1, 7).translate(-0.85, 3.1, 0), 0x56913f],
  ]);
  const snowTier = (r, h, y, s, green) => [[cone(r, h, s).translate(0, y, 0), green], [cone(r * 0.72, h * 0.55, s).translate(0, y + h * 0.28, 0), 0xf4f7fb]];
  return {
    pine: merge([[cyl(0.2, 0.3, 1.8, 5).translate(0, 0.9, 0), 0x6b4a32], [cone(2.0, 3.0).translate(0, 2.9, 0), 0x2e6a3b], [cone(1.55, 2.6).translate(0, 4.3, 0), 0x357643], [cone(1.05, 2.2).translate(0, 5.6, 0), 0x3d834b]]),
    fir: merge([[cyl(0.18, 0.26, 2.2, 5).translate(0, 1.1, 0), 0x5e412c], [cone(1.5, 4.2, 6).translate(0, 3.6, 0), 0x24573a], [cone(1.1, 3.4, 6).translate(0, 5.6, 0), 0x2a6342], [cone(0.7, 2.6, 6).translate(0, 7.4, 0), 0x31704a]]),
    birch: merge([[cyl(0.14, 0.18, 4.2).translate(0, 2.1, 0), 0xe9e6dc], [cyl(0.16, 0.16, 0.25).translate(0, 1.4, 0), 0x2a2a2a], [cyl(0.15, 0.15, 0.2).translate(0, 2.7, 0), 0x2a2a2a], [ico(1.5).scale(1, 1.4, 1).translate(0, 4.8, 0), 0x8fbf4f], [ico(1.0).translate(0.7, 4.0, 0.3), 0x9cc95a]]),
    oak: merge([[cyl(0.3, 0.45, 2.4).translate(0, 1.2, 0), 0x6b4a32], [ico(2.1).translate(0, 3.8, 0), 0x4f8f35], [ico(1.5).translate(1.4, 3.3, 0.4), 0x5a9a3c], [ico(1.4).translate(-1.2, 3.5, -0.6), 0x467f30]]),
    bush: merge([[ico(0.9).scale(1, 0.7, 1).translate(0, 0.45, 0), 0x4f8a35], [ico(0.7).scale(1, 0.7, 1).translate(0.7, 0.35, 0.2), 0x5c9a3c]]),
    cactus: cactus(),
    drybush: merge([[ico(0.8).scale(1, 0.55, 1).translate(0, 0.35, 0), 0x9c8a5a], [ico(0.6).scale(1, 0.5, 1).translate(0.6, 0.28, 0.2), 0xae9a64], [ico(0.5).scale(1, 0.5, 1).translate(-0.5, 0.25, -0.3), 0x8e7c50]]),
    deadtree: merge([[cyl(0.18, 0.3, 3.4, 5).translate(0, 1.7, 0), 0x7a6a58], [cyl(0.08, 0.12, 1.8, 4).rotateZ(0.8).translate(0.6, 3.0, 0), 0x7a6a58], [cyl(0.07, 0.1, 1.5, 4).rotateZ(-0.9).rotateY(1.2).translate(-0.3, 2.6, 0.4), 0x6e5f4f], [cyl(0.06, 0.08, 1.2, 4).rotateX(0.7).translate(0, 3.5, 0.3), 0x7a6a58]]),
    snowfir: merge([[cyl(0.18, 0.26, 2.2, 5).translate(0, 1.1, 0), 0x5e412c], ...snowTier(1.6, 4.2, 3.6, 6, 0x24503c), ...snowTier(1.15, 3.4, 5.6, 6, 0x2a5a44), ...snowTier(0.72, 2.6, 7.4, 6, 0x2f634b)]),
    snowpine: merge([[cyl(0.2, 0.3, 1.8, 5).translate(0, 0.9, 0), 0x6b4a32], ...snowTier(2.0, 3.0, 2.9, 7, 0x2e5f3f), ...snowTier(1.55, 2.6, 4.3, 7, 0x356a47), ...snowTier(1.05, 2.2, 5.6, 7, 0x3b744d)]),
    snowbush: merge([[ico(0.9).scale(1, 0.6, 1).translate(0, 0.4, 0), 0xf2f6fa], [ico(0.6).scale(1, 0.6, 1).translate(0.7, 0.3, 0.2), 0x3c6a4a], [ico(0.55).scale(1, 0.55, 1).translate(0.75, 0.42, 0.2), 0xf4f7fb]]),
    palm: palm(),
  };
}
const TREE_COLLIDE = { pine: 0.28, fir: 0.28, birch: 0.24, oak: 0.42, cactus: 0.36, deadtree: 0.28, snowfir: 0.28, snowpine: 0.28, palm: 0.24 };

// ---------------------------------------------------------------------------
// Welt bauen
// ---------------------------------------------------------------------------
export function buildWorld(game, levelId = 'tal') {
  const level = LEVELS[levelId] || LEVELS.tal;
  const T = THEMES[level.theme];
  const { world, RAPIER: R } = game;
  const scene = new THREE.Group();
  scene.name = 'level-' + level.id;
  const rand = mulberry32(1337 + level.id.length * 101);
  const track = new Track(level);
  const W = track.width, N = track.N, E = track.extras;

  // ---------------- Start-Rahmen: Tribüne außen, Boxen innen
  const p0 = track.pts[0], t0 = track.tan[0], s0 = track.side[0];
  const cen = track.pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
  const outS = new THREE.Vector3().subVectors(p0, cen).dot(s0) > 0 ? 1 : -1;
  const y0 = track.roadY[0];
  const frame = (along, off) => p0.clone().addScaledVector(t0, along).addScaledVector(s0, off * outS);
  const yawT = Math.atan2(t0.x, t0.z);
  const zones = [];
  const stand = { c: frame(0, W / 2 + 23 + 5), yaw: yawT };
  zones.push({ x: stand.c.x, z: stand.c.z, yaw: yawT - Math.PI / 2, hw: 48, hd: 12, y: y0 });
  let pit = frame(-30, -(W / 2 + 19));
  { const n = track.nearest(pit.x, pit.z, 4); if (n.d < W / 2 + 12 || n.i < 0) pit = null; }
  if (pit) zones.push({ x: pit.x, z: pit.z, yaw: yawT - Math.PI / 2, hw: 30, hd: 8, y: y0 });
  if (E.arena) zones.push({ x: E.arena.x, z: E.arena.z, r: E.arena.r + 4, y: 0 });
  if (E.lab) zones.push({ x: E.lab.x, z: E.lab.z, yaw: 0, hw: E.lab.w / 2 + 4, hd: E.lab.d / 2 + 4, y: 0 });
  if (E.ramp) zones.push({ x: E.ramp.x + 12, z: E.ramp.z, yaw: 0, hw: 60, hd: 24, y: 0 });
  if (E.lake) zones.push({ x: E.lake.x, z: E.lake.z, r: E.lake.r + 2, y: 0 });

  const terrain = new Terrain(track, zones);
  track.heightAt = (x, z) => terrain.heightAt(x, z);
  for (const p of track.pts) p.y = terrain.heightAt(p.x, p.z);
  const H = (x, z) => terrain.heightAt(x, z);
  const statics = [];
  const addStatic = (desc, type = 'static') => {
    const c = world.createCollider(desc.setFriction(0.6));
    game.owners.set(c.handle, { type });
    statics.push(c);
    return c;
  };
  const shadow = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
  const rotY = (yaw) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

  // ---------------- Himmel, Sonne
  const sunDir = new THREE.Vector3(...T.sunDir).normalize();
  {
    const g = new THREE.SphereGeometry(2000, 32, 16);
    const col = [];
    const p = g.attributes.position;
    const top = new THREE.Color(T.sky[0]), mid = new THREE.Color(T.sky[1]), hor = new THREE.Color(T.sky[2]), glow = new THREE.Color(T.sky[3]);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const y = v.y;
      const c = y < 0.1 ? hor.clone().lerp(mid, Math.max(0, y) / 0.1) : mid.clone().lerp(top, Math.min(1, (y - 0.1) / 0.55));
      const sd = Math.max(0, v.dot(sunDir));
      c.lerp(glow, Math.pow(sd, 6) * 0.6);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    const sun = new THREE.Mesh(new THREE.CircleGeometry(T.sea ? 70 : 48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 2.4), fog: false, toneMapped: false }));
    sun.position.copy(sunDir).multiplyScalar(1800);
    sun.lookAt(0, 0, 0);
    scene.add(sun);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const cx = cv.getContext && cv.getContext('2d');
    if (cx) {
      const gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,236,200,0.9)'); gr.addColorStop(0.25, 'rgba(255,214,160,0.35)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
      const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      glowS.position.copy(sun.position).multiplyScalar(0.98);
      glowS.scale.setScalar(900);
      scene.add(glowS);
    }
  }

  // ---------------- Gelände
  {
    const { size, n } = TER, N1 = n + 1, st = size / n;
    addStatic(R.ColliderDesc.heightfield(n, n, terrain.h, { x: size, y: 1, z: size }), 'ground');
    const pos = [], col = [];
    const c = new THREE.Color();
    const [gA, gB, gC] = T.ground.map((h) => new THREE.Color(h));
    const high = new THREE.Color(T.high), dirt = new THREE.Color(T.dirt), sand = new THREE.Color(T.sand);
    const Hh = (i, j) => terrain.h[i + j * N1];
    const P = (i, j) => [-size / 2 + j * st, Hh(i, j), -size / 2 + i * st];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = P(i, j), b = P(i, j + 1), d = P(i + 1, j), e = P(i + 1, j + 1);
      for (const tri of [[a, d, b], [b, d, e]]) {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        const nz = fbm(cx / 40, cz / 40);
        c.copy(gA).lerp(gB, nz).lerp(gC, vhash(cx, cz) * 0.35);
        const ny = Math.abs((b[1] - a[1]) / st) + Math.abs((d[1] - a[1]) / st);
        if (level.theme === 'desert' && ny > 0.35) c.lerp(high, 0.7);
        else if (level.theme === 'snow' && ny > 0.55) c.lerp(new THREE.Color(0x9aa6b4), 0.55);
        else if (cy - track.roadY[0] > 7) c.lerp(high, Math.min(1, (cy - 7) / 8) * 0.6);
        const rd = terrain.roadDist(cx, cz);
        if (rd > W / 2 + 1.5 && rd < W / 2 + 4) c.lerp(dirt, 0.25);
        if (E.lake) { const lr = Math.hypot(cx - E.lake.x, cz - E.lake.z); if (lr < E.lake.r + 6) c.lerp(sand, sstep(lr, E.lake.r + 6, E.lake.r - 4)); }
        if (T.sea) c.lerp(sand, sstep(Math.max(Math.abs(cx), Math.abs(cz)), BOUND - 40, BOUND - 25));
        c.offsetHSL(0, 0, (vhash(cz, cx) - 0.5) * 0.04);
        for (const v of tri) { pos.push(...v); col.push(c.r, c.g, c.b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    scene.add(shadow(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })), false, true));
    // Umland außerhalb des Spielfelds
    let og = new THREE.PlaneGeometry(2720, 2720, 80, 80).rotateX(-Math.PI / 2);
    const op = og.attributes.position;
    for (let i = 0; i < op.count; i++) {
      const x = op.getX(i), z = op.getZ(i), r = Math.max(Math.abs(x), Math.abs(z));
      op.setY(i, T.sea ? -6 : r < 339 ? -6 : sstep(r, 340, 600) * (20 + fbm(x / 160, z / 160) * 60) * T.outer);
    }
    og = og.toNonIndexed();
    const oc = [];
    for (let i = 0; i < og.attributes.position.count; i += 3) {
      const y = og.attributes.position.getY(i);
      if (T.sea) c.set(0x1d4f6a);
      else c.copy(gA).lerp(gC, rand()).lerp(high, Math.min(0.5, Math.max(0, (y - 25) / 60)));
      if (level.theme === 'snow' && y > 70) c.lerp(new THREE.Color(0x8f9aaa), 0.4);
      for (let k = 0; k < 3; k++) oc.push(c.r, c.g, c.b);
    }
    og.setAttribute('color', new THREE.Float32BufferAttribute(oc, 3));
    og.computeVertexNormals();
    scene.add(shadow(new THREE.Mesh(og, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })), false, true));
  }

  // ---------------- Wasser: See bzw. Meer
  let water = null, waterLevel = 0;
  if (E.lake) {
    const g = new THREE.CircleGeometry(E.lake.r + 4, 40).rotateX(-Math.PI / 2);
    water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3f86ad, transparent: true, opacity: 0.86, roughness: 0.08, metalness: 0.2, flatShading: true, envMap: game.envMap, envMapIntensity: 0.9 }));
    water.position.set(E.lake.x, E.lake.level, E.lake.z);
    waterLevel = E.lake.level;
    water.receiveShadow = true;
    scene.add(water);
    const reeds = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 1.4, 3).translate(0, 0.7, 0), flat(0x6f8a3a), 260);
    const m = new THREE.Matrix4();
    for (let k = 0; k < 260; k++) {
      const a = rand() * Math.PI * 2, r = E.lake.r - 2 + rand() * 7;
      const x = E.lake.x + Math.cos(a) * r, z = E.lake.z + Math.sin(a) * r;
      m.compose(new THREE.Vector3(x, H(x, z), z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3)), new THREE.Vector3(1, 0.6 + rand() * 0.8, 1));
      reeds.setMatrixAt(k, m);
    }
    scene.add(reeds);
  }
  if (T.sea) {
    const g = new THREE.CircleGeometry(2400, 64).rotateX(-Math.PI / 2);
    water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2c7aa6, transparent: true, opacity: 0.9, roughness: 0.12, metalness: 0.25, flatShading: true, envMap: game.envMap, envMapIntensity: 0.9 }));
    waterLevel = -0.55;
    water.position.y = waterLevel;
    water.receiveShadow = true;
    scene.add(water);
  }

  // ---------------- Straße, Curbs, Kiesbetten, Markierungen
  {
    const pos = [], col = [];
    const push = (p, c) => { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); };
    const L = (i, off, y) => { const p = track.pts[i % N].clone().addScaledVector(track.side[i % N], off); p.y = H(p.x, p.z) + y; return p; };
    const quad = (a, b, c2, d, color) => { push(a, color); push(c2, color); push(b, color); push(b, color); push(c2, color); push(d, color); };
    const cAs = new THREE.Color();
    const gravelC = new THREE.Color(T.gravel);
    const lanes = 6;
    for (let i = 0; i < N; i++) {
      const j = i + 1;
      for (let k = 0; k < lanes; k++) {
        const o1 = -W / 2 + (k * W) / lanes, o2 = o1 + W / lanes;
        const lane = k === 1 || k === 4 ? 0.92 : 1;
        const sh = (0.2 + vhash(i * 0.37, k) * 0.03) * lane * (level.theme === 'snow' ? 1.12 : 1);
        cAs.setRGB(sh, sh * 1.01, sh * 1.06);
        quad(L(i, o1, 0.03), L(i, o2, 0.03), L(j, o1, 0.03), L(j, o2, 0.03), cAs.clone());
      }
      const curvy = Math.abs(track.curv[i]) > 0.16;
      for (const s of [-1, 1]) {
        if (curvy) {
          const red = Math.floor(i / 3) % 2 === 0;
          const cc = new THREE.Color(red ? 0xd9322b : 0xf1efe9);
          quad(L(i, s * W / 2, 0.04), L(i, s * (W / 2 + 0.65), 0.1), L(j, s * W / 2, 0.04), L(j, s * (W / 2 + 0.65), 0.1), cc);
          quad(L(i, s * (W / 2 + 0.65), 0.1), L(i, s * (W / 2 + 1.3), 0.04), L(j, s * (W / 2 + 0.65), 0.1), L(j, s * (W / 2 + 1.3), 0.04), cc.clone().multiplyScalar(0.85));
        } else {
          quad(L(i, s * (W / 2 - 0.55), 0.04), L(i, s * (W / 2 - 0.25), 0.04), L(j, s * (W / 2 - 0.55), 0.04), L(j, s * (W / 2 - 0.25), 0.04), new THREE.Color(0xe9e6dc));
        }
        if (track.gravel[i] === s) {
          const gc = gravelC.clone().offsetHSL(0, 0, (vhash(i, s) - 0.5) * 0.06);
          quad(L(i, s * (W / 2 + 1.3), 0.035), L(i, s * (W / 2 + 13), 0.035), L(j, s * (W / 2 + 1.3), 0.035), L(j, s * (W / 2 + 13), 0.035), gc);
        }
      }
      if (Math.floor(i / 4) % 2 === 0 && !curvy) quad(L(i, -0.14, 0.04), L(i, 0.14, 0.04), L(j, -0.14, 0.04), L(j, 0.14, 0.04), new THREE.Color(0xe9e6dc));
    }
    // Start/Ziel: Schachbrett
    for (let r = 0; r < 2; r++) for (let k = 0; k < 10; k++) {
      const c = (r + k) % 2 ? new THREE.Color(0x111111) : new THREE.Color(0xf5f5f5);
      const o1 = -W / 2 + (k * W) / 10, o2 = o1 + W / 10;
      const a = track.pts[0].clone().addScaledVector(t0, r * 1.2 - 1.2), b = a.clone().addScaledVector(t0, 1.2);
      const Pp = (base, off) => { const q = base.clone().addScaledVector(s0, off); q.y = H(q.x, q.z) + 0.05; return q; };
      quad(Pp(a, o1), Pp(a, o2), Pp(b, o1), Pp(b, o2), c);
    }
    // Startboxen
    for (let k = 0; k < 8; k++) {
      const { i, pos: base } = gridSlot(track, k);
      const t = track.tan[i], sd = track.side[i];
      const Q = (a, b) => { const q = base.clone().addScaledVector(sd, a).addScaledVector(t, b); q.y = H(q.x, q.z) + 0.045; return q; };
      const wc = new THREE.Color(0xe9e6dc);
      quad(Q(-1.6, 2.6), Q(1.6, 2.6), Q(-1.6, 2.9), Q(1.6, 2.9), wc);
      quad(Q(-1.6, 2.6), Q(-1.3, 2.6), Q(-1.6, 0.2), Q(-1.3, 0.2), wc);
      quad(Q(1.3, 2.6), Q(1.6, 2.6), Q(1.3, 0.2), Q(1.6, 0.2), wc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    road.receiveShadow = true;
    scene.add(road);
  }

  // ---------------- Text-Schilder
  const textTex = (text, bg, fg, w = 1024, h = 128, font = 92) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext && cv.getContext('2d');
    if (x) {
      x.fillStyle = bg; x.fillRect(0, 0, w, h);
      x.fillStyle = fg; x.font = `${font}px "Lilita One", "Arial Black", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, w / 2, h / 2 + 4);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const sign = (text, bg, fg, w, h, pos, yaw, postH = 0) => {
    const grp = new THREE.Group();
    const frameM = flat(0x2c2f36, { metalness: 0.4 });
    const face = new THREE.MeshBasicMaterial({ map: textTex(text, bg, fg) });
    const board = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), [frameM, frameM, frameM, frameM, face, face]));
    board.position.y = postH + h / 2;
    grp.add(board);
    if (postH > 0) for (const sx of [-1, 1]) {
      const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.25, postH, 0.25), frameM));
      post.position.set(sx * (w / 2 - 0.4), postH / 2, 0);
      grp.add(post);
    }
    grp.position.copy(pos);
    grp.rotation.y = yaw;
    scene.add(grp);
    return grp;
  };

  // ---------------- Start-Portal mit Startampel
  const startLights = [];
  {
    const grp = new THREE.Group();
    grp.position.set(p0.x, H(p0.x, p0.z), p0.z);
    grp.rotation.y = yawT;
    const pm = flat(0x2c2f36, { metalness: 0.4 });
    for (const sx of [-1, 1]) {
      const pil = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.8, 7.5, 0.8), pm));
      pil.position.set(sx * (W / 2 + 2), 3.75, 0);
      grp.add(pil);
      const wp = p0.clone().addScaledVector(s0, -sx * (W / 2 + 2));
      addStatic(R.ColliderDesc.cuboid(0.4, 3.75, 0.4).setTranslation(wp.x, H(wp.x, wp.z) + 3.75, wp.z));
    }
    const tex = textTex('NITRO RIVALE', '#d9322b', '#ffffff');
    const banner = shadow(new THREE.Mesh(new THREE.BoxGeometry(W + 4.8, 1.7, 0.4), [pm, pm, pm, pm, new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex })]));
    banner.position.set(0, 7, 0);
    grp.add(banner);
    // Ampel: 5 Gehäuse mit je zwei Lampen, zur Startaufstellung gerichtet
    const housing = flat(0x15161a, { roughness: 0.6 });
    for (let k = 0; k < 5; k++) {
      const x = (k - 2) * 1.35;
      const box = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.5), housing));
      box.position.set(x, 4.95, -0.4);
      grp.add(box);
      const mat = new THREE.MeshStandardMaterial({ color: 0x2a0806, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.3 });
      for (const y of [5.45, 4.45]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 14).rotateX(Math.PI / 2), mat);
        l.position.set(x, y, -0.68);
        grp.add(l);
      }
      startLights.push(mat);
    }
    scene.add(grp);
  }

  // ---------------- Tribüne mit Zuschauern + Boxengebäude
  {
    const len = 90;
    const grp = new THREE.Group();
    const conc = flat(0xb9b5ab);
    // lokales System: x entlang der Strecke, -z nach außen
    for (let r = 0; r < 7; r++) {
      const step = shadow(new THREE.Mesh(new THREE.BoxGeometry(len, 0.6 + r * 0.7, 1.6), conc));
      step.position.set(0, (0.6 + r * 0.7) / 2, -r * 1.6);
      grp.add(step);
    }
    const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.3, 13), flat(0xd9322b)));
    roof.position.set(0, 9.2, -5);
    roof.rotation.x = -0.08;
    grp.add(roof);
    for (let k = -4; k <= 4; k++) {
      const pil = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.35, 9.5, 0.35), flat(0x2c2f36)));
      pil.position.set(k * 11, 4.75, -11);
      grp.add(pil);
    }
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.8, 0.35), flat(0xffffff), 520);
    const head = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), flat(0xe2b48c), 520);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const shirts = [0xd9322b, 0x2d5fb5, 0xf2a23a, 0xf4f1ea, 0x2f8f5a, 0x1d1d22, 0x7a1fa2, 0xe7b52e];
    let k = 0;
    for (let r = 0; r < 7 && k < 520; r++) for (let x = -len / 2 + 1; x < len / 2 - 1 && k < 520; x += 0.75 + rand() * 0.6) {
      if (rand() < 0.15) continue;
      const y = 0.6 + r * 0.7 + 0.4, z = -r * 1.6;
      m.makeTranslation(x, y, z + (rand() - 0.5) * 0.3);
      crowd.setMatrixAt(k, m); crowd.setColorAt(k, c.set(shirts[Math.floor(rand() * shirts.length)]));
      m.makeTranslation(x, y + 0.58, z);
      head.setMatrixAt(k, m); head.setColorAt(k, c.set(0xe2b48c).offsetHSL(0, 0, (rand() - 0.5) * 0.3));
      k++;
    }
    crowd.count = head.count = k;
    grp.add(crowd, head);
    const front = frame(0, W / 2 + 23);
    grp.position.set(front.x, y0, front.z);
    // lokales +x entlang t0, lokales -z nach außen
    const outV = s0.clone().multiplyScalar(outS);
    const zA = outV.clone().negate(), yA = new THREE.Vector3(0, 1, 0), xA = new THREE.Vector3().crossVectors(yA, zA);
    grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
    scene.add(grp);
    const cc = front.clone().addScaledVector(outV, 5);
    addStatic(R.ColliderDesc.cuboid(len / 2, 3, 6).setTranslation(cc.x, y0 + 3, cc.z).setRotation(grp.quaternion.clone()));
    if (pit) {
      const pg = new THREE.Group();
      const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(56, 6, 12), flat(0xe8e4da)));
      body.position.y = 3;
      pg.add(body);
      for (let k2 = 0; k2 < 7; k2++) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(5.5, 4, 0.2), flat(0x30333a, { metalness: 0.4 }));
        door.position.set(-24 + k2 * 8, 2, -6.05);
        pg.add(door);
      }
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(56.2, 0.6, 12.2), flat(0xd9322b));
      stripe.position.y = 5.5;
      pg.add(stripe);
      pg.position.set(pit.x, y0, pit.z);
      pg.quaternion.copy(grp.quaternion);
      scene.add(pg);
      addStatic(R.ColliderDesc.cuboid(28, 3, 6).setTranslation(pit.x, y0 + 3, pit.z).setRotation(pg.quaternion.clone()));
    }
  }

  // ---------------- Betonwände + Leitplanken (Instanzen)
  const barrierShape = new THREE.Shape([
    new THREE.Vector2(-0.42, 0), new THREE.Vector2(0.42, 0), new THREE.Vector2(0.26, 0.32),
    new THREE.Vector2(0.15, 0.95), new THREE.Vector2(-0.15, 0.95), new THREE.Vector2(-0.26, 0.32),
  ]);
  const barriers = [];
  const addBarrier = (x, z, yaw, len, color, collide = true) => {
    const y = H(x, z);
    barriers.push({ x, y, z, yaw, len, color });
    if (collide) addStatic(R.ColliderDesc.cuboid(0.36, 0.5, len / 2).setTranslation(x, y + 0.5, z).setRotation(rotY(yaw)));
  };
  for (const [axis, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
    for (let k = -BOUND; k < BOUND; k += 6) {
      const x = axis === 'x' ? sgn * BOUND : k + 3, z = axis === 'x' ? k + 3 : sgn * BOUND;
      barriers.push({ x, y: H(x, z) - 0.05, z, yaw: axis === 'x' ? 0 : Math.PI / 2, len: 5.8, color: 0xb9b6ad });
    }
    addStatic(R.ColliderDesc.cuboid(axis === 'x' ? 0.5 : BOUND, 12, axis === 'x' ? BOUND : 0.5).setTranslation(axis === 'x' ? sgn * BOUND : 0, 4, axis === 'z' ? sgn * BOUND : 0));
  }
  if (E.arena) {
    const n = 54;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.sin(a) < -0.93) continue;
      addBarrier(E.arena.x + Math.cos(a) * E.arena.r, E.arena.z + Math.sin(a) * E.arena.r, -a, (2 * Math.PI * E.arena.r) / n - 0.15, i % 2 ? 0xd9322b : 0xf1efe9);
    }
  }
  // Leitplanken hinter den Kiesbetten
  {
    const rails = [];
    let i = 0;
    while (i < N) {
      const s = track.gravel[i];
      if (!s) { i++; continue; }
      let j = i;
      while (j < N && track.gravel[j] === s) j++;
      for (let k = i; k < j; k += 5) {
        const a = track.pts[k].clone().addScaledVector(track.side[k], s * (W / 2 + 15));
        const kb = Math.min(k + 5, N - 1);
        const b = track.pts[kb].clone().addScaledVector(track.side[kb], s * (W / 2 + 15));
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        if (len < 0.5) continue;
        // nicht in einen anderen Streckenteil hinein
        const nn = track.nearest(mid.x, mid.z, 3);
        if (nn.d < W / 2 + 8) continue;
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        mid.y = H(mid.x, mid.z);
        rails.push({ p: mid, yaw, len });
        addStatic(R.ColliderDesc.cuboid(0.15, 0.6, len / 2 + 0.05).setTranslation(mid.x, mid.y + 0.6, mid.z).setRotation(rotY(yaw)));
      }
      i = j;
    }
    const railGeo = new THREE.BoxGeometry(0.08, 0.32, 1).translate(0, 0.62, 0);
    const postGeo = new THREE.BoxGeometry(0.12, 0.75, 0.12).translate(0, 0.37, -0.5);
    const rm = new THREE.InstancedMesh(railGeo, flat(0xc5c9cf, { metalness: 0.7, roughness: 0.35, envMap: game.envMap }), Math.max(1, rails.length));
    const pmI = new THREE.InstancedMesh(postGeo, flat(0x5a5e66), Math.max(1, rails.length));
    const m = new THREE.Matrix4();
    rails.forEach((r, k) => {
      m.compose(r.p, rotY(r.yaw), new THREE.Vector3(1, 1, r.len + 0.1));
      rm.setMatrixAt(k, m);
      m.compose(r.p, rotY(r.yaw), new THREE.Vector3(1, 1, 1));
      pmI.setMatrixAt(k, m);
    });
    rm.count = pmI.count = rails.length;
    shadow(rm); shadow(pmI);
    scene.add(rm, pmI);
  }

  // ---------------- Arena (nur Grünes Tal)
  if (E.arena) {
    const A = E.arena;
    const g = new THREE.CircleGeometry(A.r + 0.5, 36).rotateX(-Math.PI / 2).toNonIndexed();
    const cols = [];
    for (let i = 0; i < g.attributes.position.count; i += 3) { const s = 0.27 + rand() * 0.05; for (let k = 0; k < 3; k++) cols.push(s, s, s * 1.04); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const floor = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    floor.position.set(A.x, 0.025, A.z);
    floor.receiveShadow = true;
    scene.add(floor);
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(16, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3d3f45, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    lane.position.set(A.x, 0.02, A.z - A.r - 8);
    lane.receiveShadow = true;
    scene.add(lane);
    sign('CRASH-ARENA', '#16171b', '#f2a23a', 12, 3, new THREE.Vector3(A.x, 0, A.z - A.r - 2), 0, 5);
    for (const sx of [-1, 1]) addStatic(R.ColliderDesc.cuboid(0.2, 3, 0.2).setTranslation(A.x + sx * 5.6, 3, A.z - A.r - 2));
  }

  // ---------------- Crash-Labor (nur Grünes Tal)
  if (E.lab) {
    const LB = E.lab;
    const g = new THREE.PlaneGeometry(LB.w, LB.d, 12, 8).rotateX(-Math.PI / 2).toNonIndexed();
    const cols = [];
    for (let i = 0; i < g.attributes.position.count; i += 3) { const s = 0.52 + rand() * 0.05; for (let k = 0; k < 3; k++) cols.push(s, s, s * 0.98); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const pad = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    pad.position.set(LB.x, 0.02, LB.z);
    pad.receiveShadow = true;
    scene.add(pad);
    const mark = flat(0xf2c43a);
    for (const [w, d] of [[14, 0.25], [0.25, 14]]) {
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mark);
      ln.position.set(LB.x, 0.03, LB.z);
      scene.add(ln);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.8, 8.1, 48).rotateX(-Math.PI / 2), mark);
    ring.position.set(LB.x, 0.03, LB.z);
    scene.add(ring);
    const wall = shadow(new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 1.6), flat(0xa8a49b)));
    wall.position.set(LB.x + 32, 1.1, LB.z);
    wall.rotation.y = Math.PI / 2;
    scene.add(wall);
    for (let k = 0; k < 6; k++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.61, 2.21, 1.2), flat(k % 2 ? 0x16171b : 0xf2c43a));
      st.position.set(LB.x + 32, 1.1, LB.z - 6 + k * 2.4);
      scene.add(st);
    }
    addStatic(R.ColliderDesc.cuboid(0.8, 1.1, 7).setTranslation(LB.x + 32, 1.1, LB.z));
    const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.2, 10), flat(0xc5c9cf, { metalness: 0.8, roughness: 0.3, envMap: game.envMap })));
    pole.position.set(LB.x - 30, 1.6, LB.z + 14);
    scene.add(pole);
    addStatic(R.ColliderDesc.cylinder(1.6, 0.22).setTranslation(LB.x - 30, 1.6, LB.z + 14));
    for (const [x, z] of [[-LB.w / 2, -LB.d / 2], [LB.w / 2, -LB.d / 2], [-LB.w / 2, LB.d / 2], [LB.w / 2, LB.d / 2]]) {
      const mast = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 0.4), flat(0x5a5e66)));
      mast.position.set(LB.x + x, 7, LB.z + z);
      scene.add(mast);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 1.2 }));
      lamp.position.set(LB.x + x, 14, LB.z + z);
      scene.add(lamp);
    }
    sign('CRASH-LABOR', '#16171b', '#f2c43a', 16, 3, new THREE.Vector3(LB.x, 0, LB.z - LB.d / 2 - 1), 0, 4.5);
  }

  // ---------------- Sprungschanze (nur Grünes Tal)
  if (E.ramp) {
    const pts = [[-4, 0, 0], [4, 0, 0], [-4, 0, 14], [4, 0, 14], [-4, 2.6, 14], [4, 2.6, 14]];
    const q = rotY(Math.PI / 2);
    const origin = new THREE.Vector3(E.ramp.x, 0, E.ramp.z);
    addStatic(R.ColliderDesc.convexHull(new Float32Array(pts.flat())).setTranslation(origin.x, 0, origin.z).setRotation(q));
    const g = new THREE.BufferGeometry();
    const v = pts.map((p) => new THREE.Vector3(...p));
    const tri = [[0, 2, 4], [0, 4, 1], [1, 4, 5], [1, 5, 3], [1, 3, 2], [1, 2, 0], [0, 4, 2], [1, 3, 5], [2, 3, 5], [2, 5, 4]];
    const arr = [];
    tri.forEach((t) => t.forEach((k) => arr.push(v[k].x, v[k].y, v[k].z)));
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const ramp = shadow(new THREE.Mesh(g, flat(0xf2a23a, { side: THREE.DoubleSide })));
    ramp.position.copy(origin);
    ramp.quaternion.copy(q);
    scene.add(ramp);
    for (let k = 0; k < 4; k++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(8.05, 0.05, 0.9), flat(0x1d1d1f));
      const z = 2 + k * 3.2;
      st.position.set(0, (z / 14) * 2.6 + 0.03, z);
      st.rotation.x = -Math.atan(2.6 / 14);
      ramp.add(st);
    }
  }

  // ---------------- Gesperrte Flächen für Bewuchs
  const blocked = (x, z, pad = 0) => {
    for (const zn of zones) if (zoneWeight({ ...zn, blend: 6 + pad }, x, z) > 0) return true;
    if (E.arena && Math.abs(x - E.arena.x) < 14 && z > E.arena.z - E.arena.r - 70 && z < E.arena.z) return true;
    return false;
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();

  // ---------------- Tafelberge (Wüste)
  if (T.buttes) {
    const bands = [0xb5653f, 0xc7774c, 0xd98c5a, 0xa85a3c];
    let made = 0, tries = 0;
    while (made < T.buttes && tries++ < 600) {
      const x = (rand() * 2 - 1) * (BOUND - 30), z = (rand() * 2 - 1) * (BOUND - 30);
      const r = 9 + rand() * 16;
      if (terrain.roadDist(x, z) < r + 30 || blocked(x, z, r)) continue;
      const hgt = 14 + rand() * 30, y = H(x, z) - 2;
      const grp = new THREE.Group();
      const layers = 3 + Math.floor(rand() * 2);
      for (let k = 0; k < layers; k++) {
        const rr = r * (1 - k * 0.09), hh = hgt / layers;
        const seg = shadow(new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.94, rr, hh, 7), flat(bands[(k + made) % bands.length])));
        seg.position.y = hh * (k + 0.5);
        seg.rotation.y = rand();
        grp.add(seg);
      }
      grp.position.set(x, y, z);
      scene.add(grp);
      addStatic(R.ColliderDesc.cylinder(hgt / 2, r).setTranslation(x, y + hgt / 2, z));
      zones.push({ x, z, r: r + 4, y, blend: 0 });
      made++;
    }
  }

  // ---------------- Leuchtturm (Küste)
  if (T.lighthouse) {
    let best = null;
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2, x = Math.cos(ang) * 285, z = Math.sin(ang) * 285;
      const d = terrain.roadDist(x, z);
      if (d > 35 && d < 90 && (!best || d < best.d)) best = { x, z, d };
    }
    if (best) {
      const grp = new THREE.Group(), y = H(best.x, best.z);
      for (let k = 0; k < 6; k++) {
        const seg = shadow(new THREE.Mesh(new THREE.CylinderGeometry(2.3 - k * 0.2, 2.5 - k * 0.2, 3, 10), flat(k % 2 ? 0xf2efe8 : 0xd9322b)));
        seg.position.y = 1.5 + k * 3;
        grp.add(seg);
      }
      const gal = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.3, 10), flat(0x2c2f36)));
      gal.position.y = 18.1;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.8, 10), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd780, emissiveIntensity: 2.6 }));
      lamp.position.y = 19.2;
      const cap = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.5, 10), flat(0xd9322b)));
      cap.position.y = 20.8;
      grp.add(gal, lamp, cap);
      grp.position.set(best.x, y - 0.2, best.z);
      scene.add(grp);
      addStatic(R.ColliderDesc.cylinder(10, 2.5).setTranslation(best.x, y + 10, best.z));
      zones.push({ x: best.x, z: best.z, r: 6, y, blend: 0 });
    }
  }

  // ---------------- Bäume, Büsche, Gras, Blumen, Felsen
  {
    const types = plantTypes();
    const kinds = Object.entries(T.trees);
    const lists = Object.fromEntries(kinds.map(([k]) => [k, []]));
    const all = [];
    let tries = 0;
    const pick = (y) => {
      if (y - track.roadY[0] > 6 && T.highTrees && rand() < 0.6) return T.highTrees[Math.floor(rand() * T.highTrees.length)];
      let r = rand();
      for (const [k, w] of kinds) { if ((r -= w) <= 0) return k; }
      return kinds[0][0];
    };
    while (all.length < T.treeCount && tries++ < 14000) {
      const cluster = all.length && rand() < 0.65 ? all[Math.floor(rand() * all.length)] : null;
      const x = cluster ? cluster.x + (rand() - 0.5) * 26 : (rand() * 2 - 1) * (BOUND - 8);
      const z = cluster ? cluster.z + (rand() - 0.5) * 26 : (rand() * 2 - 1) * (BOUND - 8);
      if (Math.abs(x) > BOUND - (T.sea ? 30 : 5) || Math.abs(z) > BOUND - (T.sea ? 30 : 5)) continue;
      if (blocked(x, z) || terrain.roadDist(x, z) < W / 2 + 12) continue;
      if (all.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 10)) continue;
      const y = H(x, z);
      if (water && y < waterLevel + 0.4) continue;
      const type = pick(y);
      const s = { x, z, y, s: 0.8 + rand() * 0.6, rot: rand() * 6, type };
      all.push(s);
      lists[type].push(s);
    }
    for (const [type, list] of Object.entries(lists)) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(types[type], new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: type === 'palm' ? THREE.DoubleSide : THREE.FrontSide }), list.length);
      list.forEach((s, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
        m.compose(new THREE.Vector3(s.x, s.y - 0.1, s.z), q, new THREE.Vector3(s.s, s.s * (0.9 + rand() * 0.25), s.s));
        im.setMatrixAt(i, m);
        im.setColorAt(i, c.setRGB(1, 1, 1).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.12));
        if (TREE_COLLIDE[type]) addStatic(R.ColliderDesc.cylinder(1.5, TREE_COLLIDE[type] * s.s).setTranslation(s.x, s.y + 1.5, s.z));
      });
      shadow(im);
      scene.add(im);
    }
    if (T.tufts) {
      const ni = (g) => (g.index ? g.toNonIndexed() : g);
      const tuft = mergeGeometries([0, 1, 2].map((k) => ni(new THREE.ConeGeometry(0.07, 0.55 + k * 0.12, 3).translate(0, 0.28, 0).rotateZ((k - 1) * 0.35).rotateY(k * 2.1))));
      const nT = T.tufts[1], nF = T.flowers ? 2600 : 0;
      const tufts = new THREE.InstancedMesh(tuft, flat(0xffffff), nT);
      const flower = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.32, 0), flat(0xffffff, { emissive: 0x111111 }), Math.max(1, nF));
      let ti = 0, fi = 0, guard = 0;
      while (ti < nT && guard++ < nT * 6) {
        const x = (rand() * 2 - 1) * (BOUND - 3), z = (rand() * 2 - 1) * (BOUND - 3);
        if (terrain.roadDist(x, z) < W / 2 + 3 || blocked(x, z, -6)) continue;
        const y = H(x, z);
        if (water && y < waterLevel + 0.3) continue;
        if (T.sea && Math.max(Math.abs(x), Math.abs(z)) > BOUND - 38) continue;
        m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6), new THREE.Vector3(1, 0.7 + rand() * 0.9, 1).multiplyScalar(0.8 + rand() * 0.8));
        tufts.setMatrixAt(ti, m);
        tufts.setColorAt(ti, c.set(T.tufts[0]).offsetHSL((rand() - 0.5) * 0.05, 0, (rand() - 0.5) * 0.12));
        ti++;
        if (fi < nF && fbm(x / 30 + 11, z / 30 + 5) > 0.58) {
          const fc = T.flowers[Math.floor(vhash(Math.floor(x / 20), Math.floor(z / 20)) * T.flowers.length)];
          for (let k = 0; k < 3 && fi < nF; k++) {
            const fx = x + (rand() - 0.5) * 2, fz = z + (rand() - 0.5) * 2;
            m.compose(new THREE.Vector3(fx, H(fx, fz), fz), q.identity(), new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rand() * 0.6));
            flower.setMatrixAt(fi, m);
            flower.setColorAt(fi, c.set(fc));
            fi++;
          }
        }
      }
      tufts.count = ti; flower.count = fi;
      scene.add(tufts);
      if (fi) scene.add(flower);
    }
    // Felsen
    const rocks = [];
    for (let i = 0; i < T.rocks[1]; i++) {
      const x = (rand() * 2 - 1) * (BOUND - 10), z = (rand() * 2 - 1) * (BOUND - 10);
      if (terrain.roadDist(x, z) < W / 2 + 9 || blocked(x, z)) continue;
      rocks.push({ x, z, y: H(x, z), s: 0.5 + rand() * (level.theme === 'desert' ? 2.4 : 1.6), r: rand() * 6 });
    }
    if (rocks.length) {
      const rim = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), flat(0xffffff), rocks.length);
      rocks.forEach((r, i) => {
        m.compose(new THREE.Vector3(r.x, r.y + r.s * 0.25, r.z), q.setFromEuler(new THREE.Euler(r.r, r.r * 2, 0)), new THREE.Vector3(r.s * 1.3, r.s * 0.8, r.s));
        rim.setMatrixAt(i, m);
        rim.setColorAt(i, c.set(T.rocks[0]).offsetHSL(0, 0, (rand() - 0.5) * 0.15));
        addStatic(R.ColliderDesc.ball(r.s * 0.8).setTranslation(r.x, r.y + r.s * 0.15, r.z));
      });
      shadow(rim);
      scene.add(rim);
    }
  }

  // ---------------- Betonwände rendern
  if (barriers.length) {
    const geo = new THREE.ExtrudeGeometry(barrierShape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
    const im = new THREE.InstancedMesh(geo, flat(0xffffff), barriers.length);
    const s = new THREE.Vector3();
    barriers.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x, b.y, b.z), rotY(b.yaw), s.set(1, 1, b.len));
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.set(b.color));
    });
    shadow(im);
    scene.add(im);
  }

  // ---------------- Berge + Wolken
  {
    const M = T.mountains;
    for (let i = 0; i < M.n; i++) {
      const a = (i / M.n) * Math.PI * 2 + rand() * 0.12;
      const d = M.d + rand() * 300;
      const h = M.h[0] + rand() * M.h[1], r = 160 + rand() * 180;
      const segs = 5 + Math.floor(rand() * 3);
      const col = M.colors[Math.floor(rand() * M.colors.length)];
      if (M.mesa) {
        const grp = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * (0.62 - k * 0.07), r * (0.7 - k * 0.07), h / 3, segs), flat(k % 2 ? col : 0xd08a5c));
          seg.position.y = (h / 3) * (k + 0.5) - 25;
          grp.add(seg);
        }
        grp.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
        grp.rotation.y = rand() * 6;
        scene.add(grp);
        continue;
      }
      if (M.islands) {
        const isl = new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, h, segs, 2), flat(col));
        isl.position.set(Math.cos(a) * d, h / 2 - 12, Math.sin(a) * d);
        isl.rotation.y = rand() * 6;
        scene.add(isl);
        continue;
      }
      const mt = new THREE.Mesh(new THREE.ConeGeometry(r, h, segs, 3), flat(col));
      mt.position.set(Math.cos(a) * d, h / 2 - 25, Math.sin(a) * d);
      mt.rotation.y = rand() * 6;
      scene.add(mt);
      if (M.caps && h > (M.bigCaps ? 200 : 280)) {
        const k = M.bigCaps ? 0.45 : 0.3;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(r * k, h * k, segs), flat(0xf4f6fa));
        cap.position.set(mt.position.x, h - 25 - (h * k) / 2 + 1, mt.position.z);
        cap.rotation.y = mt.rotation.y;
        scene.add(cap);
      }
    }
    const clouds = new THREE.Group();
    const cm = new THREE.MeshLambertMaterial({ color: T.clouds[0], flatShading: true, emissive: T.clouds[1], transparent: true, opacity: 0.95 });
    for (let i = 0; i < T.clouds[2]; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(14 + rand() * 14, 0), cm);
        b.position.set(k * 17 - n * 8, rand() * 7, rand() * 12);
        b.scale.y = 0.55;
        g.add(b);
      }
      g.position.set((rand() * 2 - 1) * 1000, 180 + rand() * 120, (rand() * 2 - 1) * 1000);
      clouds.add(g);
    }
    scene.add(clouds);
    game.clouds = clouds;
  }

  // ---------------- Schneefall
  let snow = null;
  if (T.snowfall) {
    const n = 2600, box = 90;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = (rand() - 0.5) * box; arr[i * 3 + 1] = rand() * 40; arr[i * 3 + 2] = (rand() - 0.5) * box; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.9, depthWrite: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    snow = { pts, arr, n, box, center: new THREE.Vector3() };
  }

  game.water = water;
  game.waterLevel = water ? waterLevel : null;
  game.sunDir = sunDir;
  game.scene.add(scene);

  const update = (dt, now, cam) => {
    if (game.clouds) game.clouds.position.x = Math.sin(now * 0.01) * 60;
    if (water) water.position.y = waterLevel + Math.sin(now * 0.8) * 0.04;
    if (snow && cam) {
      const { arr, n, box } = snow;
      for (let i = 0; i < n; i++) {
        let y = arr[i * 3 + 1] - dt * (2.2 + (i % 7) * 0.25);
        arr[i * 3] += Math.sin(now * 0.7 + i) * dt * 0.4;
        if (y < 0) y += 40;
        arr[i * 3 + 1] = y;
      }
      snow.pts.position.set(Math.round(cam.position.x / box) * box, cam.position.y - 15, Math.round(cam.position.z / box) * box);
      // Flocken um die Kamera wickeln
      const ox = cam.position.x - snow.pts.position.x, oz = cam.position.z - snow.pts.position.z;
      for (let i = 0; i < n; i++) {
        const dx = arr[i * 3] - ox, dz = arr[i * 3 + 2] - oz;
        if (dx > box / 2) arr[i * 3] -= box; else if (dx < -box / 2) arr[i * 3] += box;
        if (dz > box / 2) arr[i * 3 + 2] -= box; else if (dz < -box / 2) arr[i * 3 + 2] += box;
      }
      snow.pts.geometry.attributes.position.needsUpdate = true;
    }
  };

  const dispose = () => {
    game.scene.remove(scene);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mt of mats) { if (mt.map) mt.map.dispose(); mt.dispose(); }
    });
  };

  return { track, terrain, level, theme: T, group: scene, startLights, update, dispose };
}

// ---------------------------------------------------------------------------
// Bewegliche Requisiten: Pylonen, Fässer, Reifenstapel
// ---------------------------------------------------------------------------
export class Props {
  constructor(game, track) {
    this.g = game;
    this.track = track;
    this.groups = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const rand = mulberry32(99);
    const { RAPIER: R } = game;
    const E = track.extras, W = track.width;
    const coneGeo = new THREE.ConeGeometry(0.28, 0.76, 7);
    const coneBase = new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, -0.36, 0);
    const coneStripe = new THREE.CylinderGeometry(0.2, 0.23, 0.12, 7).translate(0, -0.02, 0);
    const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10);
    const barrelRing = new THREE.CylinderGeometry(0.31, 0.31, 0.05, 10);
    const tireProfile = [];
    for (let k = 0; k <= 8; k++) tireProfile.push(new THREE.Vector2(k % 2 ? 0.36 : 0.3, -0.5 + k / 8));
    const tireGeo = new THREE.LatheGeometry(tireProfile, 9);

    const cones = [], barrels = [], tires = [];
    const corners = [];
    for (let i = 0; i < track.N; i += 6) if (Math.abs(track.curv[i]) > 0.5) corners.push(i);
    for (const i of corners.filter((_, k) => k % 3 === 0)) {
      const inner = Math.sign(track.curv[i]);
      cones.push(track.pts[i].clone().addScaledVector(track.side[i], inner * (W / 2 + 2.2)));
    }
    const sharp = [...track.curv.keys()].sort((a, b) => Math.abs(track.curv[b]) - Math.abs(track.curv[a]));
    const picked = [];
    for (const i of sharp) {
      if (picked.length >= 5) break;
      if (picked.every((j) => Math.min(Math.abs(i - j), track.N - Math.abs(i - j)) > 120)) picked.push(i);
    }
    for (const i of picked) {
      const outer = -Math.sign(track.curv[i]);
      for (let k = -7; k <= 7; k++) {
        const j = (i + k * 2 + track.N) % track.N;
        const p = track.pts[j].clone().addScaledVector(track.side[j], outer * (W / 2 + 14));
        if (track.nearest(p.x, p.z, 2).d > W / 2 + 6) tires.push(p);
      }
    }
    if (E.arena) {
      for (let k = 0; k < 18; k++) {
        const a = rand() * Math.PI * 2, r = 6 + rand() * (E.arena.r - 12);
        barrels.push(new THREE.Vector3(E.arena.x + Math.cos(a) * r, 0, E.arena.z + Math.sin(a) * r));
      }
      for (let k = 0; k < 4; k++) barrels.push(new THREE.Vector3(E.arena.x - 4 + k * 2.7, 0, E.arena.z - E.arena.r - 18));
    }
    if (E.lab) for (let k = 0; k < 6; k++) cones.push(new THREE.Vector3(E.lab.x - 20 + k * 4, 0, E.lab.z - 18), new THREE.Vector3(E.lab.x - 20 + k * 4, 0, E.lab.z - 24));

    this.addGroup(cones, coneGeo, 0xf06a1d, () => R.ColliderDesc.cone(0.38, 0.28).setDensity(60), 0.38, [[coneBase, 0x1d1d1f], [coneStripe, 0xf4f1ea]]);
    if (barrels.length) this.addGroup(barrels, barrelGeo, null, () => R.ColliderDesc.cylinder(0.45, 0.3).setDensity(150), 0.45, [[barrelRing, 0x2a2c31]], [0xc73b2b, 0x2d5fb5, 0xe7b52e]);
    if (tires.length) this.addGroup(tires, tireGeo, null, () => R.ColliderDesc.cylinder(0.5, 0.35).setDensity(115), 0.5, [], [0x1e1f22, 0xe9e6dc, 0xd9322b]);
  }

  addGroup(list, geo, color, colliderFn, halfH, extraGeos = [], palette = null) {
    const { RAPIER: R, world } = this.g;
    const scene = this.group;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.7 });
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = true; im.receiveShadow = true;
    const extras = extraGeos.map(([g, col]) => { const e = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: col, flatShading: true, roughness: 0.6 }), list.length); e.castShadow = true; scene.add(e); return e; });
    const bodies = [];
    const c = new THREE.Color();
    list.forEach((p, i) => {
      const y = this.g.heightAt(p.x, p.z) + halfH + 0.02;
      p.y = y;
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, y, p.z).setLinearDamping(0.3).setAngularDamping(0.4));
      const col = world.createCollider(colliderFn(p).setFriction(0.8).setRestitution(0.25), body);
      this.g.owners.set(col.handle, { type: 'prop', body });
      bodies.push(body);
      im.setColorAt(i, c.set(color ?? palette[i % palette.length]));
    });
    scene.add(im);
    this.groups.push({ im, extras, bodies, start: list.map((p) => p.clone()), halfH, first: true });
  }

  update() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const g of this.groups) {
      let dirty = false;
      g.bodies.forEach((b, i) => {
        if (!g.first && b.isSleeping()) return;
        const t = b.translation(), r = b.rotation();
        m.compose(p.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), one);
        g.im.setMatrixAt(i, m);
        for (const e of g.extras) e.setMatrixAt(i, m);
        dirty = true;
      });
      g.first = false;
      if (dirty) { g.im.instanceMatrix.needsUpdate = true; for (const e of g.extras) e.instanceMatrix.needsUpdate = true; }
    }
  }

  reset() {
    for (const g of this.groups) {
      g.bodies.forEach((b, i) => {
        const s = g.start[i];
        b.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
        b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
      g.first = true;
    }
  }

  dispose() {
    this.g.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
