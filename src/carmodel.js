// ---------------------------------------------------------------------------
// Auto-Modelle: prozedurale Low-Poly-Karosserien
//
// Aufbau jedes Autos:
//   - Karosserie als Loft: Querschnitts-Ringe entlang der Längsachse. Aus dem
//     Raster werden Haube, Kofferraum und Türen als eigene, bündige Teile
//     herausgeschnitten (mit schmaler Fuge), der Rest ist die feste Außenhaut.
//   - Radläufe sind echte Ausschnitte mit Radhausschale und Kotflügelkante.
//   - Fahrgastzelle mit lackierten Säulen, Dach und einzeln eingelassenen Scheiben.
//   - Dunkle Innenwanne unter der Außenhaut (sichtbar in Fugen und unter
//     abgefallenen Teilen).
// Koordinaten: vorne = -Z, oben = +Y, rechts = +X, Meter.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createFlame } from './fx.js';
import { paintMesh } from './car.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// Alle Koordinaten landen auf einem 0,1-mm-Raster: deckungsgleiche Punkte in
// verschiedenen Meshes sind dann bitgleich und verformen sich identisch.
const Q = (v) => Math.round(v * 1e4) / 1e4 + 0;
const nseg = (len, step = 0.29) => Math.max(1, Math.min(18, Math.ceil(len / step - 0.2)));

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const addS = (a, n, s) => [a[0] + n[0] * s, a[1] + n[1] * s, a[2] + n[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist = (a, b) => vlen(sub(a, b));
const mirX = (p) => [-p[0], p[1], p[2]];

// Stückweise lineare Kurve aus Stützpunkten [[t, wert], ...]
function pl(pts) {
  const f = (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0] || 1)); }
    }
    return pts[pts.length - 1][1];
  };
  f.knots = pts.map((p) => p[0]);
  return f;
}

// ---------------------------------------------------------------------------
// Mesh-Baukasten mit Vertex-Verschweißung
// ---------------------------------------------------------------------------
class MB {
  constructor() { this.p = []; this.t = []; this.i = []; this.map = new Map(); }
  get empty() { return this.i.length === 0; }
  v(P, u = 0, w = 0) {
    const x = Q(P[0]), y = Q(P[1]), z = Q(P[2]);
    const k = x + '|' + y + '|' + z;
    let id = this.map.get(k);
    if (id === undefined) { id = this.p.length / 3; this.p.push(x, y, z); this.t.push(u, w); this.map.set(k, id); }
    return id;
  }
  tri(a, b, c) { if (a !== b && b !== c && a !== c) this.i.push(a, b, c); }
  quad(A, B, C, D) { const a = this.v(A), b = this.v(B), c = this.v(C), d = this.v(D); this.tri(a, b, c); this.tri(a, c, d); }
  // Bilinearer Flicken. A→B ist die u-Richtung, A→D die v-Richtung.
  patch(A, B, C, D, nu = 1, nv = 1) {
    const ids = [];
    for (let j = 0; j <= nv; j++) {
      const t = j / nv, L = mix(A, D, t), R = mix(B, C, t), row = [];
      for (let i = 0; i <= nu; i++) row.push(this.v(mix(L, R, i / nu), i / nu, t));
      ids.push(row);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      this.tri(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1]);
      this.tri(ids[j][i], ids[j + 1][i + 1], ids[j + 1][i]);
    }
  }
  // Ringe (gleich viele Punkte) zu einem Schlauch verbinden
  loft(rings, { closed = true, capA = true, capB = true } = {}) {
    const m = rings[0].length;
    for (let k = 0; k < rings.length - 1; k++) {
      for (let j = 0; j < (closed ? m : m - 1); j++) {
        const j2 = (j + 1) % m;
        this.quad(rings[k][j], rings[k][j2], rings[k + 1][j2], rings[k + 1][j]);
      }
    }
    const cap = (r) => {
      const c = [0, 0, 0];
      for (const p of r) { c[0] += p[0] / m; c[1] += p[1] / m; c[2] += p[2] / m; }
      const ci = this.v(c);
      for (let j = 0; j < m; j++) this.tri(ci, this.v(r[j]), this.v(r[(j + 1) % m]));
    };
    if (capA) cap(rings[0]);
    if (capB) cap(rings[rings.length - 1]);
  }
  // Achsparalleler Quader, optional mit Fase an den oberen Längskanten
  box(c, sx, sy, sz) {
    const [x, y, z] = c, a = sx / 2, b = sy / 2, d = sz / 2;
    const r = (zz) => [[x - a, y - b, zz], [x + a, y - b, zz], [x + a, y + b, zz], [x - a, y + b, zz]];
    this.loft([r(z - d), r(z + d)]);
  }
  // Rohr zwischen zwei Punkten
  tube(p0, p1, r, n = 6, caps = true) {
    const ax = unit(sub(p1, p0));
    const ref = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = unit(cross(ax, ref)), w = cross(ax, u);
    const ring = (p) => Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2; return addS(addS(p, u, Math.cos(a) * r), w, Math.sin(a) * r); });
    this.loft([ring(p0), ring(p1)], { capA: caps, capB: caps });
  }
  // Fertige Geometrie (transformiert) anhängen
  addGeo(g, m = null) {
    const pos = g.attributes.position, idx = g.index, v = new THREE.Vector3(), ids = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); if (m) v.applyMatrix4(m); ids.push(this.v([v.x, v.y, v.z])); }
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) this.tri(ids[idx ? idx.getX(i) : i], ids[idx ? idx.getX(i + 1) : i + 1], ids[idx ? idx.getX(i + 2) : i + 2]);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.t), 2));
    g.setIndex(this.i);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// Fläche mit Rahmen und eingelassenen Feldern (Scheiben, Grill, Lampentöpfe).
// A,B = untere Ecken, D,C = obere Ecken. uL/vL teilen die Fläche in Zellen;
// eine u-Linie darf [unten, oben] sein (schräge Säulen).
// kind(i, j) -> 'frame' | 'none' | Name eines Ziel-MB in o (z. B. 'glass', 'recess')
function framedFace(o, A, B, C, D, uL, vL, kind, opt = {}) {
  const P = (u, v) => mix(mix(A, B, u), mix(D, C, u), v);
  let n = unit(cross(sub(B, A), sub(D, A)));
  if (opt.out && dot(n, opt.out) < 0) n = n.map((x) => -x);
  const U = uL.map((u) => (Array.isArray(u) ? u : [u, u]));
  const pt = (i, j) => P(lerp(U[i][0], U[i][1], vL[j]), vL[j]);
  const nu = [], nv = [];
  for (let i = 0; i < U.length - 1; i++) { let m = 0; for (let j = 0; j < vL.length; j++) m = Math.max(m, dist(pt(i, j), pt(i + 1, j))); nu.push(nseg(m)); }
  for (let j = 0; j < vL.length - 1; j++) { let m = 0; for (let i = 0; i < U.length; i++) m = Math.max(m, dist(pt(i, j), pt(i, j + 1))); nv.push(opt.nv ? opt.nv[j] : nseg(m)); }
  for (let i = 0; i < U.length - 1; i++) for (let j = 0; j < vL.length - 1; j++) {
    const k = kind(i, j) || 'frame';
    if (k === 'none') continue;
    const c = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
    if (k === 'frame') { o.frame.patch(c[0], c[1], c[2], c[3], nu[i], nv[j]); continue; }
    const depth = (opt.depth && opt.depth[k]) ?? (k === 'glass' ? 0.02 : 0.06);
    const q = c.map((p) => addS(p, n, -depth));
    for (let e = 0; e < 4; e++) o.reveal.patch(c[e], c[(e + 1) % 4], q[(e + 1) % 4], q[e], e % 2 ? nv[j] : nu[i], 1);
    o[k].patch(q[0], q[1], q[2], q[3], nu[i], nv[j]);
  }
  return { P, n };
}

// Stationen entlang z: alle Merkmale plus Füllstationen, damit kein Feld zu groß wird
function stationsOf(features, maxGap) {
  const f = features.map(Q).sort((a, b) => a - b), u = [];
  for (const z of f) if (!u.length || z - u[u.length - 1] > 1e-4) u.push(z);
  const out = [];
  for (let i = 0; i < u.length; i++) {
    out.push(u[i]);
    if (i < u.length - 1) {
      const gap = u[i + 1] - u[i], n = Math.ceil(gap / maxGap - 1e-6);
      for (let k = 1; k < n; k++) out.push(Q(u[i] + (gap * k) / n));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Karosserie-Schale
// ---------------------------------------------------------------------------
// Ring (rechte Hälfte) je Station:
//   0 Unterkante innen · 1 Schweller · 2 breiteste Stelle · 3 Schulter · 4 Deckkante
//   5 Fuge Kotflügel/Haube · 6.. Längslinien der Deckfläche · letzter Punkt = Mitte
function buildShell(S) {
  const ARCH_N = 8;
  const arches = S.arches.map((a) => {
    const T = [];
    for (let k = 0; k <= ARCH_N; k++) {
      const th = (Math.PI * k) / ARCH_N;
      let z = a.zc - a.R * Math.cos(th);
      if (k === 0) z += 0.004;
      if (k === ARCH_N) z -= 0.004;
      z = Q(z);
      T.push({ z, y: Math.max(a.cy + a.R * Math.sin(th), S.yBot(z)), th });
    }
    return { ...a, T };
  });
  const feats = [S.z0, S.z1, ...(S.features || [])];
  for (const f of [S.xHalf, S.yTop, S.yBot, S.yMid]) if (f.knots) feats.push(...f.knots);
  for (const a of arches) { feats.push(a.zc - a.R, a.zc + a.R); for (const t of a.T) feats.push(t.z); }
  for (const b of S.blocks) feats.push(b.za, b.zb);
  if (S.bed) feats.push(S.bed.za, S.bed.za + 0.02);
  const st = stationsOf(feats.filter((z) => z >= S.z0 - 1e-6 && z <= S.z1 + 1e-6), S.maxGap || 0.29);
  const idx = (z) => { let b = 0; for (let i = 1; i < st.length; i++) if (Math.abs(st[i] - z) < Math.abs(st[b] - z)) b = i; return b; };
  const nTop = S.topLines.length, N = 6 + nTop + 1;

  const nominal = (z) => {
    const xh = S.xHalf(z), yt = S.yTop(z), yb = S.yBot(z), ym = S.yMid(z);
    const side = [
      [xh - S.lowIn - S.tuck, yb], [xh - S.lowIn, yb + S.rock], [xh, ym],
      [xh - S.shIn, yt - S.ch], [xh - S.shIn - S.ch * 0.9, yt],
    ];
    const xAt = (y) => {
      if (y <= side[1][1]) return side[1][0];
      if (y <= side[2][1]) return lerp(side[1][0], side[2][0], (y - side[1][1]) / (side[2][1] - side[1][1]));
      if (y <= side[3][1]) return lerp(side[2][0], side[3][0], (y - side[2][1]) / (side[3][1] - side[2][1]));
      return side[3][0];
    };
    return { xh, yt, yb, ym, side, xAt };
  };
  const archOf = (z, margin = 0) => arches.find((a) => z > a.zc - a.R - margin + 1e-5 && z < a.zc + a.R + margin - 1e-5);
  const archY = (z) => {
    const a = archOf(z);
    if (!a) return null;
    const T = a.T;
    if (z <= T[0].z) return T[0].y;
    for (let k = 0; k < T.length - 1; k++) if (z <= T[k + 1].z) return lerp(T[k].y, T[k + 1].y, (z - T[k].z) / (T[k + 1].z - T[k].z));
    return T[T.length - 1].y;
  };
  const inBed = (z) => S.bed && z > S.bed.za + 1e-5;
  const ring = (z, end = 0) => {
    const nm = nominal(z), side = nm.side.map((p) => p.slice());
    const ya = archY(z);
    if (ya !== null) {
      const xa = nm.xAt(ya);
      side[0] = [xa - 0.05, ya];
      side[1] = [xa, ya];
      if (side[2][1] < ya + 0.05) { const y2 = Math.min(ya + 0.05, side[3][1] - 0.02); side[2] = [nm.xAt(y2), y2]; }
    }
    const rk = end < 0 ? S.rakeF : end > 0 ? S.rakeR : null;
    const pts = side.map(([x, y], j) => [x, y, z + (rk ? rk[j] : 0)]);
    const zt = z + (rk ? rk[4] : 0), xe = side[4][0], yt = nm.yt;
    const cr = end || !S.crown ? 0 : S.crown(z);
    const topY = (x) => yt + cr * (1 - (x / xe) ** 2) + (S.bulge && !end ? S.bulge(x, z) : 0);
    if (inBed(z)) {
      const xs = xe - S.bed.rail;
      pts.push([xs, yt, zt]);
      S.topLines.forEach((L, k) => pts.push([k === 0 ? xs - 0.004 : Math.min(L, xs - 0.05 * (k + 1)), S.bed.floor, zt]));
      pts.push([0, S.bed.floor, zt]);
    } else {
      const xs = xe - S.seamIn;
      pts.push([xs, topY(xs), zt]);
      S.topLines.forEach((L, k) => { const x = Math.min(L, xs - 0.05 * (k + 1)); pts.push([x, topY(x), zt]); });
      pts.push([0, topY(0), zt]);
    }
    return pts;
  };
  const G = st.map((z, i) => ring(z, i === 0 ? -1 : i === st.length - 1 ? 1 : 0));

  // Felder den Blöcken zuordnen
  const blocks = S.blocks.map((b) => ({ ...b, ia: idx(b.za), ib: idx(b.zb), out: [] }));
  const owner = (i, j) => blocks.find((b) => i >= b.ia && i < b.ib && j >= b.ja && j < b.jb);
  const body = new MB(), lid = new MB();
  const f = (p, sx) => (sx > 0 ? p : mirX(p));
  for (let i = 0; i < st.length - 1; i++) {
    const zm = (st[i] + st[i + 1]) / 2;
    for (let j = 0; j < N - 1; j++) {
      if (owner(i, j)) continue;
      // Unter der Fahrgastzelle: dunkler Deckel statt Lack (hält den Innenraum blickdicht)
      const mb = S.skip && S.skip(zm, j) ? lid : body;
      for (const sx of [1, -1]) mb.quad(f(G[i][j], sx), f(G[i + 1][j], sx), f(G[i + 1][j + 1], sx), f(G[i][j + 1], sx));
    }
  }
  const toward = (p, q, d) => { const L = dist(p, q); return L < 1e-6 ? [0, 0, 0] : sub(mix(p, q, Math.min(0.45, d / L)), p); };
  for (const b of blocks) {
    const gap = b.gap ?? 0.012;
    const pt = (i, j) => {
      const p = G[i][j];
      let d = [0, 0, 0];
      if (i === b.ia) d = addS(d, toward(p, G[i + 1][j], gap), 1);
      if (i === b.ib) d = addS(d, toward(p, G[i - 1][j], gap), 1);
      if (j === b.ja) d = addS(d, toward(p, G[i][j + 1], gap), 1);
      if (j === b.jb && b.jb !== N - 1 && b.gapTop !== false) d = addS(d, toward(p, G[i][j - 1], gap), 1);
      return addS(p, d, 1);
    };
    const sides = b.split ? [[1], [-1]] : [[1, -1]];
    for (const sxs of sides) {
      const main = new MB(), stripe = new MB();
      for (const sx of sxs) for (let i = b.ia; i < b.ib; i++) for (let j = b.ja; j < b.jb; j++) {
        const mb = b.stripeJ === j ? stripe : main;
        mb.quad(f(pt(i, j), sx), f(pt(i + 1, j), sx), f(pt(i + 1, j + 1), sx), f(pt(i, j + 1), sx));
      }
      b.out.push({ sx: sxs.length === 1 ? sxs[0] : 0, main, stripe });
    }
  }

  // Dunkle Rinne knapp unter jeder Fuge: man sieht nie durch den Spalt hindurch
  const gutter = new MB();
  for (const b of blocks) {
    if (b.gap === 0) continue;
    const top = b.ja >= 5, acJ = top ? [0.035, 0, 0] : [0, 0.035, 0], acI = [0, 0, 0.035];
    const lines = [];
    for (const i of [b.ia, b.ib]) for (let j = b.ja; j < b.jb; j++) lines.push([G[i][j], G[i][j + 1], acI]);
    for (let i = b.ia; i < b.ib; i++) {
      lines.push([G[i][b.ja], G[i + 1][b.ja], acJ]);
      if (b.jb !== N - 1 && b.gapTop !== false) lines.push([G[i][b.jb], G[i + 1][b.jb], acJ]);
    }
    for (const sx of [1, -1]) {
      const inw = top ? [0, -0.028, 0] : [-0.028 * sx, 0, 0];
      for (const [p0, q0, ac] of lines) {
        const p = addS(f(p0, sx), inw, 1), q = addS(f(q0, sx), inw, 1);
        gutter.quad(addS(p, ac, -1), addS(p, ac, 1), addS(q, ac, 1), addS(q, ac, -1));
      }
    }
  }

  // Radhausschalen und Kotflügelkanten
  const liner = new MB(), mould = new MB();
  for (const a of arches) {
    const line = [{ z: a.zc - a.R, y: S.yBot(a.zc - a.R), dir: [-1, 0] }];
    a.T.forEach((t, k) => {
      const dir = k === 0 ? [-1, 0] : k === ARCH_N ? [1, 0] : [-Math.cos(t.th), Math.sin(t.th)];
      line.push({ z: t.z, y: t.y, dir });
    });
    line.push({ z: a.zc + a.R, y: S.yBot(a.zc + a.R), dir: [1, 0] });
    for (const sx of [1, -1]) {
      let prevL = null, prevM = null;
      for (const q of line) {
        const xs = nominal(q.z).xAt(q.y);
        const L = [f([xs - 0.045, q.y, q.z], sx), f([S.wellX, q.y, q.z], sx)];
        const off = (r) => [q.y + q.dir[1] * r, q.z + q.dir[0] * r];
        const [y1, z1] = off(S.flareT * 0.55), [y2, z2] = off(S.flareT), [y3, z3] = off(S.flareT + 0.012);
        const M = [
          f([xs - 0.02, q.y, q.z], sx), f([xs + S.flare, q.y, q.z], sx), f([xs + S.flare, y1, z1], sx),
          f([xs + S.flare * 0.35, y2, z2], sx), f([xs - 0.015, y3, z3], sx),
        ];
        if (prevL) {
          liner.quad(prevL[0], L[0], L[1], prevL[1]);
          for (let k = 0; k < 4; k++) mould.quad(prevM[k], M[k], M[k + 1], prevM[k + 1]);
        }
        prevL = L; prevM = M;
      }
    }
  }

  // Innenleben: Bodenblech plus dunkler Kern. Der Kern sitzt deutlich hinter der
  // Außenhaut, damit er bei Dellen nicht sofort durchsticht; er hält Fugen dunkel
  // und füllt die Öffnung, wenn Tür oder Haube fehlen.
  const tub = new MB();
  {
    const tf = [S.z0 + 0.2, S.z1 - 0.2, ...(S.tubFeatures || [])];
    for (const a of arches) tf.push(a.zc - a.R - 0.05, a.zc - a.R - 0.02, a.zc + a.R + 0.02, a.zc + a.R + 0.05);
    const ts = stationsOf(tf.filter((z) => z >= S.z0 + 0.2 - 1e-6 && z <= S.z1 - 0.2 + 1e-6), 0.32);
    const tr = (z) => {
      const nm = nominal(z), inArch = archOf(z, 0.03);
      const xf = inArch ? S.wellX : nm.xh - 0.09, xt = Math.min(nm.xh - 0.22, S.wellX);
      const yb = nm.yb + 0.03, yt = S.tubTop ? S.tubTop(z) : nm.yt - 0.1;
      return [[0, yb, z], [xf, yb, z], [xt, yb + 0.006, z], [xt, (yb + yt) / 2, z], [xt, yt, z], [xt / 2, yt, z], [0, yt, z]];
    };
    const R = ts.map(tr);
    for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < 6; j++) for (const sx of [1, -1]) tub.quad(f(R[i][j], sx), f(R[i + 1][j], sx), f(R[i + 1][j + 1], sx), f(R[i][j + 1], sx));
    for (const r of [R[0], R[R.length - 1]]) { tub.patch(mirX(r[2]), r[2], r[3], mirX(r[3]), 4, 1); tub.patch(mirX(r[3]), r[3], r[4], mirX(r[4]), 4, 1); }
  }

  const capRow = (end, r) => {
    const g = G[end < 0 ? 0 : st.length - 1];
    return [mirX(g[r]), g[r], g[r + 1], mirX(g[r + 1])];
  };
  // z und x der Außenhaut an einem Ende in Höhe y
  const endAt = (end, y) => {
    const g = G[end < 0 ? 0 : st.length - 1];
    for (let j = 0; j < 4; j++) if (y <= g[j + 1][1] || j === 3) { const t = clamp((y - g[j][1]) / (g[j + 1][1] - g[j][1] || 1), 0, 1); return { x: lerp(g[j][0], g[j + 1][0], t), z: lerp(g[j][2], g[j + 1][2], t) }; }
    return { x: g[4][0], z: g[4][2] };
  };
  return { st, G, N, idx, nominal, arches, body, lid, gutter, blocks, liner, mould, tub, capRow, endAt, block: (name) => blocks.find((b) => b.name === name) };
}

// Stange/Verkleidung, die einem Grundriss-Pfad folgt (Stoßstangen, Schweller).
// plan: [[x, z], ...] · section: [[d, y], ...] (d = nach außen)
function sweepPlan(mb, plan, section, yc, center = [0, 0]) {
  const pts = [];
  for (let i = 0; i < plan.length; i++) {
    pts.push(plan[i]);
    if (i < plan.length - 1) {
      const L = Math.hypot(plan[i + 1][0] - plan[i][0], plan[i + 1][1] - plan[i][1]), n = nseg(L, 0.3);
      for (let k = 1; k < n; k++) pts.push([lerp(plan[i][0], plan[i + 1][0], k / n), lerp(plan[i][1], plan[i + 1][1], k / n)]);
    }
  }
  const segN = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], L = Math.hypot(dx, dz) || 1;
    let n = [dz / L, -dx / L];
    const mx = (pts[i][0] + pts[i + 1][0]) / 2 - center[0], mz = (pts[i][1] + pts[i + 1][1]) / 2 - center[1];
    if (n[0] * mx + n[1] * mz < 0) n = [-n[0], -n[1]];
    segN.push(n);
  }
  const rings = pts.map((p, i) => {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    const m = [(a[0] + b[0]) / k, (a[1] + b[1]) / k];
    return section.map(([d, y]) => [p[0] + m[0] * d, yc + y, p[1] + m[1] * d]);
  });
  mb.loft(rings);
}

// ---------------------------------------------------------------------------
// Fahrgastzelle
// ---------------------------------------------------------------------------
function buildGreenhouse(o, g) {
  const yU = g.yR - g.c;
  const BF = [g.xB0, g.yA0, g.zA0], BR = [g.xB1, g.yC0, g.zC0], UF = [g.xR, yU, g.zA1], UR = [g.xR, yU, g.zC1];
  const fr = (i, j, cols) => (j === 1 && cols.includes(i) ? 'glass' : 'frame');
  // Alle vier Flächen teilen dieselbe Höhenteilung, damit die Säulenkanten sauber schließen
  const Hs = dist(BF, UF), vL = [0, g.sill / Hs, 1 - g.head / Hs, 1], nv = [1, nseg(Hs), 1];
  // Frontscheibe
  {
    const wb = 2 * g.xB0, wt = 2 * g.xR;
    framedFace(o, mirX(BF), BF, UF, mirX(UF), [0, [g.pa[0] / wb, g.pa[1] / wt], [1 - g.pa[0] / wb, 1 - g.pa[1] / wt], 1], vL, (i, j) => fr(i, j, [1]), { out: [0, 0.4, -1], nv });
  }
  // Heckscheibe
  {
    const wb = 2 * g.xB1, wt = 2 * g.xR;
    framedFace(o, mirX(BR), BR, UR, mirX(UR), [0, [g.pr[0] / wb, g.pr[1] / wt], [1 - g.pr[0] / wb, 1 - g.pr[1] / wt], 1], vL, (i, j) => fr(i, j, [1]), { out: [0, 0.4, 1], nv });
  }
  // Seiten
  const Lb = g.zC0 - g.zA0, Lt = g.zC1 - g.zA1;
  const uL = [0, [g.ps[0] / Lb, g.ps[1] / Lt]], glassCols = [1];
  for (const b of g.bPillars || []) {
    const t0 = clamp((b.z - g.zA1) / Lt, g.ps[1] / Lt + 0.05, 1 - g.pc[1] / Lt - 0.1);
    const t1 = clamp((b.z + b.w - g.zA1) / Lt, t0 + 0.02, 1 - g.pc[1] / Lt - 0.04);
    uL.push([(b.z - g.zA0) / Lb, t0], [(b.z + b.w - g.zA0) / Lb, t1]);
    glassCols.push(uL.length - 1);
  }
  uL.push([1 - g.pc[0] / Lb, 1 - g.pc[1] / Lt], 1);
  for (const sx of [1, -1]) {
    const s = (p) => [sx * p[0], p[1], p[2]];
    framedFace(o, s(BF), s(BR), s(UR), s(UF), uL, vL, (i, j) => fr(i, j, glassCols), { out: [sx, 0.3, 0], nv });
  }
  // Überlappende Lippe hinter der Dachkante (verdeckt Haarrisse zwischen Fläche und Fase)
  {
    const lip = (P, Qp) => o.frame.quad(P, Qp, [Qp[0] * 0.985, Qp[1] - 0.014, Qp[2] * 1 ], [P[0] * 0.985, P[1] - 0.014, P[2]]);
    const zin = 0.006;
    lip(mirX(UF).map((v, k) => (k === 2 ? v + zin : v)), UF.map((v, k) => (k === 2 ? v + zin : v)));
    lip(mirX(UR).map((v, k) => (k === 2 ? v - zin : v)), UR.map((v, k) => (k === 2 ? v - zin : v)));
    for (const sx of [1, -1]) o.frame.quad([sx * (UF[0] - zin), yU, UF[2]], [sx * (UR[0] - zin), yU, UR[2]], [sx * (UR[0] - zin), yU - 0.014, UR[2]], [sx * (UF[0] - zin), yU - 0.014, UF[2]]);
  }
  // Fase und Dach
  const xr = g.xR - g.c, zf = g.zA1 + g.c * 0.9, zr = g.zC1 - g.c * 0.9;
  const xl = [0, ...(g.stripes || [xr * 0.5]), xr];
  const nz = nseg(zr - zf);
  const roofY = (x, t) => g.yR + (g.crown || 0) * (1 - (x / xr) ** 2) * Math.min(1, 6 * t * (1 - t));
  for (const sx of [1, -1]) {
    const s = (p) => [sx * p[0], p[1], p[2]];
    o.frame.patch(s(UF), s(UR), s([xr, g.yR, zr]), s([xr, g.yR, zf]), nz, 1);
    for (let k = 0; k < xl.length - 1; k++) {
      const a = xl[k], b = xl[k + 1], sc = g.xR / xr;
      o.frame.quad(s([a * sc, yU, g.zA1]), s([b * sc, yU, g.zA1]), s([b, g.yR, zf]), s([a, g.yR, zf]));
      o.frame.quad(s([a * sc, yU, g.zC1]), s([b * sc, yU, g.zC1]), s([b, g.yR, zr]), s([a, g.yR, zr]));
      const mb = g.stripes && k === 1 ? o.stripe : o.frame;
      for (let i = 0; i < nz; i++) {
        const t0 = i / nz, t1 = (i + 1) / nz, z0 = lerp(zf, zr, t0), z1 = lerp(zf, zr, t1);
        mb.quad(s([a, roofY(a, t0), z0]), s([b, roofY(b, t0), z0]), s([b, roofY(b, t1), z1]), s([a, roofY(a, t1), z1]));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Räder
// ---------------------------------------------------------------------------
function wheelGeos(W, st) {
  const r = W.r, w = W.w, hw = w / 2, rr = r * (st.rimRatio || 0.66), c = st.tireCham || 0.04, n = st.tireSeg || 16;
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([rad, ax]) => new THREE.Vector2(rad, ax)), seg).rotateZ(-Math.PI / 2);
  // Reifen: Flanke, Fase, Lauffläche
  const tire = new MB();
  tire.addGeo(lathe([[rr - 0.012, -hw + 0.03], [rr, -hw], [r - c, -hw], [r, -hw + c], [r, hw - c], [r - c, hw], [rr, hw], [rr - 0.012, hw - 0.03]], n));
  if (st.lugs) {
    const g = new THREE.BoxGeometry(0.1, 0.05, 0.085);
    for (let k = 0; k < st.lugs; k++) for (const side of [-1, 1]) {
      const a = ((k + (side > 0 ? 0.5 : 0)) / st.lugs) * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(side * (hw - 0.05), r - 0.008, 0));
      tire.addGeo(g, m);
    }
  }
  // Felge: Horn, Bett, Speichen, Nabe (Außenseite zeigt nach +X)
  const rim = new MB();
  const face = hw - (st.dish || 0.055);
  rim.addGeo(lathe([[rr, hw - 0.005], [rr - 0.022, hw - 0.012], [rr - 0.04, face - 0.02], [rr - 0.04, -hw + 0.04]], n));
  const spokes = st.spokes || 5, sw = st.spokeW || 0.075, hubR = rr * 0.26;
  for (let k = 0; k < spokes; k++) {
    const m = new THREE.Matrix4().makeRotationX((k / spokes) * Math.PI * 2);
    const sp = new MB();
    const ring = (rad, wd, x0, th) => [[x0, rad, -wd / 2], [x0, rad, wd / 2], [x0 - th, rad, wd / 2], [x0 - th, rad, -wd / 2]];
    sp.loft([ring(hubR * 0.6, sw * 1.15, face + 0.012, 0.05), ring(rr * 0.62, sw * 0.9, face + 0.004, 0.04), ring(rr - 0.03, sw * 0.8, face - 0.012, 0.035)]);
    rim.addGeo(sp.geo(), m);
  }
  rim.addGeo(new THREE.CylinderGeometry(hubR, hubR * 1.1, 0.06, st.hubSeg || 6).rotateZ(-Math.PI / 2).translate(face + 0.0, 0, 0));
  // Bremsscheibe und dunkler Felgengrund
  const disc = new MB();
  disc.addGeo(new THREE.CylinderGeometry(rr * 0.78, rr * 0.78, 0.025, 12).rotateZ(-Math.PI / 2).translate(face - 0.085, 0, 0));
  const back = new MB();
  back.addGeo(new THREE.CylinderGeometry(rr - 0.03, rr - 0.03, 0.02, n).rotateZ(-Math.PI / 2).translate(face - 0.12, 0, 0));
  back.addGeo(new THREE.CylinderGeometry(rr - 0.01, rr - 0.01, 0.02, n).rotateZ(-Math.PI / 2).translate(-hw + 0.035, 0, 0));
  const cal = new MB();
  {
    const g = new THREE.BoxGeometry(0.06, rr * 0.3, rr * 0.62);
    cal.addGeo(g, new THREE.Matrix4().makeRotationX(-0.9).multiply(new THREE.Matrix4().makeTranslation(face - 0.075, rr * 0.66, 0)));
  }
  return { tire: tire.geo(), rim: rim.geo(), disc: disc.geo(), back: back.geo(), cal: cal.geo() };
}

// ---------------------------------------------------------------------------
// Bausatz: Materialien, Teile-Verwaltung, gemeinsamer Zusammenbau
// ---------------------------------------------------------------------------
function makeKit(preset, color, envMap) {
  const DS = THREE.DoubleSide;
  const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, side: DS, ...o });
  const mats = {
    paint: std({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.12 }),
    dark: std({ color: 0x15161a, roughness: 0.85 }),
    trim: std({ color: 0x2b2d33, roughness: 0.55, metalness: 0.35 }),
    chrome: std({ color: 0xc9ccd1, roughness: 0.38, metalness: 0.85 }),
    glass: std({ color: 0x1a2530, roughness: 0.1, metalness: 0.75 }),
    stripe: std({ color: 0xf3f0e8, roughness: 0.4, metalness: 0.2 }),
    mirror: std({ color, roughness: 0.45, metalness: 0.15 }),
    rim: std({ color: 0xbfc3c9, roughness: 0.42, metalness: 0.8 }),
    tire: std({ color: 0x111215, roughness: 0.92 }),
    steel: std({ color: 0x6d7178, roughness: 0.45, metalness: 0.7 }),
    caliper: std({ color: 0xc8261c, roughness: 0.5, metalness: 0.2 }),
  };
  if (envMap) {
    for (const [k, i] of [['paint', 0.14], ['chrome', 0.5], ['glass', 0.8], ['rim', 0.5], ['trim', 0.3], ['steel', 0.4], ['mirror', 0.14]]) {
      mats[k].envMap = envMap;
      mats[k].envMapIntensity = i;
    }
  }
  const root = new THREE.Group();
  const deformables = [], parts = [], wheels = [], exhausts = [], flames = [];
  const lights = { head: [], tail: [] };
  const paintColor = new THREE.Color(color);
  const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const addDeform = (m) => {
    m.userData.orig = m.geometry.attributes.position.array.slice();
    if (m.material === mats.paint) {
      const n = m.geometry.attributes.position.count;
      m.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      m.userData.dmg = new Float32Array(n);
      m.userData.paint = m.userData.paint || paintColor;
      paintMesh(m);
    }
    deformables.push(m);
    return m;
  };
  // Festes Karosserie-Mesh (verformbar)
  const fixed = (mb, mat, paint = null) => {
    if (mb.empty) return null;
    const m = shadow(new THREE.Mesh(mb.geo(), mat));
    if (paint) m.userData.paint = paint;
    root.add(addDeform(m));
    return m;
  };
  // Abnehmbares Teil aus Meshes in Karosserie-Koordinaten
  const partFrom = (items) => {
    const box = new THREE.Box3(), list = [];
    for (const it of items) { if (it.mb.empty) continue; const g = it.mb.geo(); box.union(g.boundingBox); list.push([g, it]); }
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const obj = new THREE.Group(), deform = [];
    for (const [g, it] of list) {
      g.translate(-c.x, -c.y, -c.z);
      const m = new THREE.Mesh(g, it.mat);
      if (it.paint) m.userData.paint = it.paint;
      obj.add(m);
      deform.push(m);
    }
    return { obj, center: c, size: [s.x, s.y, s.z], deform };
  };
  const addPart = (def) => {
    const pivot = new THREE.Group();
    pivot.position.copy(def.pivot);
    root.add(pivot);
    def.obj.position.copy(def.center).sub(def.pivot);
    pivot.add(def.obj);
    const part = {
      id: def.id, label: def.label, obj: def.obj, pivot, axis: def.axis || 'x',
      looseAngle: def.looseAngle || 0.3, size: def.size, hp: def.hp || 100, maxHp: def.hp || 100,
      looseAt: def.looseAt ?? 55, state: 'ok', looseAmt: 0, wob: 0, wobV: 0,
      reach: Math.max(...def.size) * 0.55 + 0.2, mass: def.mass || 25, deform: def.deform || [],
    };
    parts.push(part);
    for (const m of part.deform) addDeform(m);
    def.obj.traverse((o) => { if (o.isMesh) shadow(o); });
    return part;
  };
  // Lampe: eigenes Mesh mit eigenem Leuchtmaterial, liegt auf einer Fläche (Normale n)
  const light = (kind, geo, pos, n, u = [1, 0, 0]) => {
    const mat = kind === 'head'
      ? new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff1c9, emissiveIntensity: 1.6, flatShading: true, side: DS })
      : new THREE.MeshStandardMaterial({ color: 0xc81e1e, emissive: 0xff2a1a, emissiveIntensity: 1.1, flatShading: true, side: DS });
    const m = new THREE.Mesh(geo, mat);
    const z = new THREE.Vector3(...unit(n)), x = new THREE.Vector3(...unit(u)), y = new THREE.Vector3().crossVectors(z, x).normalize();
    x.crossVectors(y, z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    m.position.set(pos[0], pos[1], pos[2]);
    root.add(addDeform(m));
    lights[kind].push(m);
    return m;
  };
  const W = preset.wheel;
  const anchorY = -preset.dims.h / 2 + 0.16;
  return {
    preset, dims: preset.dims, W, st: preset.style || {}, mats, root, deformables, parts, wheels, exhausts, flames, lights, paintColor,
    shadow, addDeform, fixed, partFrom, addPart, light, anchorY,
    wheelY: anchorY - W.rest * 0.5, groundY: anchorY - W.rest * 0.5 - W.r,
    // Sammel-Meshes für feste Kleinteile
    det: { dark: new MB(), trim: new MB(), chrome: new MB(), steel: new MB() },
  };
}

function addWheels(K, style) {
  const { W, mats, root, wheels, anchorY, shadow } = K;
  if (style.rimColor !== undefined) mats.rim.color.set(style.rimColor);
  const g = wheelGeos(W, style);
  for (const [front, sx] of [[true, -1], [true, 1], [false, -1], [false, 1]]) {
    const local = new THREE.Vector3((sx * W.track) / 2, anchorY, front ? -W.base / 2 : W.base / 2);
    const pivot = new THREE.Group();
    pivot.position.copy(local);
    const hold = new THREE.Group(), spin = new THREE.Group(), vis = new THREE.Group();
    if (sx < 0) vis.rotation.y = Math.PI;
    vis.add(shadow(new THREE.Mesh(g.tire, mats.tire)), shadow(new THREE.Mesh(g.rim, mats.rim)), new THREE.Mesh(g.disc, mats.steel), new THREE.Mesh(g.back, mats.dark));
    spin.add(vis);
    const cal = new THREE.Mesh(g.cal, mats.caliper);
    if (sx < 0) cal.rotation.y = Math.PI;
    hold.add(spin, cal);
    pivot.add(hold);
    root.add(pivot);
    wheels.push({
      id: (front ? 'F' : 'R') + (sx < 0 ? 'L' : 'R'), front, left: sx < 0, local, pivot, hold, spin,
      comp: 0, dist: W.rest + W.r, grounded: false, load: 0, vLong: 0, vLat: 0, spinAmt: 0, angle: 0,
      contact: new THREE.Vector3(), side: new THREE.Vector3(), surface: 'asphalt', bend: 0, toeSign: Math.random() < 0.5 ? -1 : 1,
      lost: false, smokeAcc: 0, mark: null,
    });
  }
}

function addExhaust(K, x, y, z, r, len = 0.3) {
  const { det, root, exhausts, flames } = K;
  det.chrome.tube([x, y, z - len], [x, y, z], r, 8, false);
  det.dark.tube([x, y, z - len], [x, y, z - 0.03], r * 0.8, 8, true);
  exhausts.push(new THREE.Vector3(x, y, z + 0.02));
  const flame = createFlame();
  flame.position.set(x, y, z);
  root.add(flame);
  flames.push(flame);
}

// Gemeinsamer Rohbau: Schale, Wanne, Radhäuser, Haube, Kofferraum, Türen
function assemble(K, sh, o) {
  const { mats } = K;
  K.fixed(sh.body, mats.paint);
  K.fixed(sh.tub, mats.dark);
  K.fixed(sh.lid, mats.dark);
  K.fixed(sh.gutter, mats.dark);
  K.fixed(sh.liner, mats.dark);
  K.fixed(sh.mould, o.mouldMat || mats.paint);
  const stripe = o.stripeColor || null;
  for (const b of sh.blocks) for (const out of b.out) {
    const items = [{ mb: out.main, mat: mats.paint }];
    if (!out.stripe.empty) items.push({ mb: out.stripe, mat: mats.paint, paint: stripe });
    const extra = o.extras && o.extras[b.name] ? o.extras[b.name](out.sx, sh) : [];
    if (b.fixed) { for (const it of [...items, ...extra]) K.fixed(it.mb, b.matKey && it.mat === mats.paint ? mats[b.matKey] : it.mat, it.paint); continue; }
    const p = K.partFrom([...items, ...extra]);
    const c = p.center, s = p.size;
    if (b.name === 'hood') {
      K.addPart({ id: 'hood', label: 'Motorhaube', obj: p.obj, size: s, center: c, pivot: new THREE.Vector3(0, c.y, b.zb), axis: 'x', looseAngle: 0.55, hp: 110, looseAt: 60, mass: 16, deform: p.deform });
    } else if (b.name === 'trunk') {
      K.addPart({ id: 'trunk', label: 'Kofferraumdeckel', obj: p.obj, size: s, center: c, pivot: new THREE.Vector3(0, c.y, b.za), axis: 'x', looseAngle: -0.5, hp: 95, looseAt: 55, mass: 14, deform: p.deform });
    } else if (b.name === 'door') {
      const sx = out.sx;
      K.addPart({ id: sx < 0 ? 'doorL' : 'doorR', label: sx < 0 ? 'Fahrertür' : 'Beifahrertür', obj: p.obj, size: s, center: c, pivot: new THREE.Vector3(c.x, c.y, b.za), axis: 'y', looseAngle: sx * 0.6, hp: 120, looseAt: 55, mass: 22, deform: p.deform });
    }
  }
  return sh;
}

// Türgriff als kleines Zusatz-Mesh an der Türhaut
function handleExtra(K, sh, sx, z, y, mat) {
  const mb = new MB(), x = sh.nominal(z).xAt(y);
  mb.box([sx * (x + 0.004), y, z], 0.03, 0.035, 0.17);
  return { mb, mat };
}

// Außenspiegel (abnehmbares Teil)
function addMirror(K, sx, base, o = {}) {
  const { mats } = K;
  const [bx, by, bz] = base, len = o.arm || 0.11, hw = o.w || 0.19, hh = o.h || 0.115;
  const body = new MB(), arm = new MB(), gl = new MB();
  const cx = bx + len + 0.03;
  arm.loft([[[bx - 0.02, by - 0.02, bz - 0.03], [bx - 0.02, by + 0.02, bz - 0.03], [bx - 0.02, by + 0.02, bz + 0.03], [bx - 0.02, by - 0.02, bz + 0.03]].map((p) => [sx * p[0], p[1], p[2]]),
    [[cx, by + 0.0, bz - 0.025], [cx, by + 0.04, bz - 0.025], [cx, by + 0.04, bz + 0.025], [cx, by + 0.0, bz + 0.025]].map((p) => [sx * p[0], p[1], p[2]])]);
  const yc = by + 0.055;
  const ring = (z, k) => [[cx - hw / 2 * k, yc - hh / 2 * k], [cx + hw / 2 * k, yc - hh / 2 * k * 0.8], [cx + hw / 2 * k, yc + hh / 2 * k], [cx - hw / 2 * k, yc + hh / 2 * k]].map(([x, y]) => [sx * x, y, z]);
  body.loft([ring(bz - 0.065, 0.55), ring(bz - 0.02, 1), ring(bz + 0.045, 1)]);
  const g = ring(bz + 0.047, 0.84);
  gl.quad(g[0], g[1], g[2], g[3]);
  const p = K.partFrom([{ mb: body, mat: mats.mirror }, { mb: arm, mat: mats.dark }, { mb: gl, mat: mats.chrome }]);
  K.addPart({ id: sx < 0 ? 'mirrorL' : 'mirrorR', label: 'Spiegel', obj: p.obj, size: p.size, center: p.center, pivot: new THREE.Vector3(sx * bx, by, bz), axis: 'y', looseAngle: sx * 0.9, hp: 25, looseAt: 0, mass: 1.5, deform: p.deform });
}

// Stoßstange entlang der Bug- oder Heckkontur
function bumperPlan(sh, S, end, yc, wrap, corner) {
  const e = sh.endAt(end, yc), zEnd = end < 0 ? S.z0 : S.z1, dir = end < 0 ? 1 : -1;
  const xs = (z) => sh.nominal(z).xAt(yc);
  const half = [[xs(zEnd + dir * wrap), zEnd + dir * wrap], [xs(zEnd + dir * corner), zEnd + dir * corner], [e.x, e.z]];
  return [...half, ...half.slice().reverse().map(([x, z]) => [-x, z])];
}
function addBumper(K, sh, S, end, o) {
  const mb = new MB();
  sweepPlan(mb, bumperPlan(sh, S, end, o.yc, o.wrap, o.corner), o.section, o.yc);
  const items = [{ mb, mat: o.mat }, ...(o.extra ? o.extra(sh.endAt(end, o.yc)) : [])];
  const p = K.partFrom(items);
  K.addPart({
    id: end < 0 ? 'bumperF' : 'bumperR', label: end < 0 ? 'Frontstoßstange' : 'Heckstoßstange', obj: p.obj, size: p.size, center: p.center,
    pivot: new THREE.Vector3(-p.size[0] / 2, p.center.y, p.center.z), axis: 'z', looseAngle: -0.24, hp: o.hp || 90, mass: o.mass || 18, deform: p.deform,
  });
}

function finish(K, enginePoint) {
  const { root, wheels, mats, det } = K;
  for (const k of Object.keys(det)) K.fixed(det[k], mats[k]);
  // Karosserie in eigene Gruppe -> kann beim Beschleunigen/Bremsen/Kurven nicken und rollen
  const sway = new THREE.Group();
  const wheelPivots = new Set(wheels.map((w) => w.pivot));
  for (const ch of [...root.children]) if (!wheelPivots.has(ch)) sway.add(ch);
  root.add(sway);
  // Motorbrand (erscheint erst bei Totalschaden)
  const fire = createFlame();
  fire.rotation.x = -Math.PI / 2;
  fire.position.set(enginePoint.x, enginePoint.y - 0.05, enginePoint.z + 0.1);
  sway.add(fire);
  return {
    root, sway, mats, deformables: K.deformables, parts: K.parts, wheels, lights: K.lights, exhausts: K.exhausts, flames: K.flames, fire,
    paintColor: K.paintColor, enginePoint, anchorY: K.anchorY,
  };
}

const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const discGeo = (r, d, n = 8) => new THREE.CylinderGeometry(r, r, d, n).rotateX(Math.PI / 2);

// Quader mit unterteilten Flächen (verformbar)
function slab(mb, x0, x1, y0, y1, z0, z1) {
  const nx = nseg(x1 - x0), ny = nseg(y1 - y0), nz = nseg(z1 - z0);
  mb.patch([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], nx, ny);
  mb.patch([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], nx, ny);
  mb.patch([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], nx, nz);
  mb.patch([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], nx, nz);
  mb.patch([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], nz, ny);
  mb.patch([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], nz, ny);
}
function plainCap(sh, end, r) { const [A, B, C, D] = sh.capRow(end, r); sh.body.patch(A, B, C, D, nseg(B[0] * 2), 1); }
// Schmale Streifen knapp hinter den Zeilengrenzen von Bug/Heck: verdecken Haarrisse,
// wo unterschiedlich unterteilte Flächen aneinanderstoßen
function capBacking(sh, end, rows = [2, 3, 4]) {
  const g = sh.G[end < 0 ? 0 : sh.st.length - 1], dz = end < 0 ? 0.005 : -0.005;
  for (const j of rows) {
    const [x, y, z] = g[j];
    sh.body.patch([-x, y - 0.012, z + dz], [x, y - 0.012, z + dz], [x, y + (j === 4 ? 0 : 0.012), z + dz], [-x, y + (j === 4 ? 0 : 0.012), z + dz], 4, 1);
  }
}
function engineBlock(K, z, yTop, o = {}) {
  const { det } = K;
  det.trim.box([0, yTop - 0.11, z], 0.5, 0.2, 0.66);
  for (const sx of [-1, 1]) det.steel.box([sx * 0.19, yTop - 0.005, z], 0.15, 0.05, 0.56);
  if (o.cleaner) det.chrome.tube([0, yTop - 0.01, z - 0.05], [0, yTop + 0.03, z - 0.05], 0.17, 10);
  else det.dark.box([0, yTop - 0.0, z - 0.05], 0.22, 0.04, 0.4);
}

const DESIGNS = {};

// --------------------------------------------------------------------------- Brutus V8
// Muscle-Car: lange Haube mit Hutze, Fastback, Chromstoßstangen, Doppelstreifen
DESIGNS.brutus = (K) => {
  const { mats, det } = K, { w, l, h } = K.dims, W = K.W;
  const hw = w / 2, zF = -l / 2, zR = l / 2, top = h / 2, axF = -W.base / 2, axR = W.base / 2;
  const cy = K.wheelY, R = W.r + 0.075, yb = K.groundY + 0.21;
  const zCowl = zF + 0.32 * l, zA0 = zCowl + 0.04, zA1 = zA0 + 0.62, zC0 = zR - 0.655, zC1 = zC0 - 0.92, zD0 = axF + R + 0.1, zD1 = zD0 + 1.33;
  const S = {
    z0: zF, z1: zR,
    xHalf: pl([[zF, hw - 0.09], [zF + 0.16, hw - 0.015], [zF + 0.6, hw], [0.1, hw - 0.022], [axR - 0.25, hw], [zR - 0.5, hw - 0.005], [zR - 0.14, hw - 0.03], [zR, hw - 0.1]]),
    yTop: pl([[zF, top - 0.1], [zF + 0.16, top - 0.05], [axF, top - 0.012], [zCowl, top], [zD1, top], [axR - 0.3, top + 0.045], [axR + 0.3, top + 0.045], [zR, top + 0.02]]),
    yBot: pl([[zF, yb + 0.09], [zF + 0.45, yb], [zR - 0.5, yb], [zR, yb + 0.13]]),
    yMid: pl([[zF, -0.13], [zF + 0.3, -0.06], [zR - 0.3, -0.04], [zR, -0.1]]),
    lowIn: 0.03, tuck: 0.06, rock: 0.05, shIn: 0.035, ch: 0.045, seamIn: 0.1,
    topLines: [0.62, 0.4, 0.16], crown: () => 0.022,
    rakeF: [0.07, 0.05, 0, -0.035, -0.03], rakeR: [-0.09, -0.07, 0, 0.02, 0.015],
    arches: [{ zc: axF, R, cy }, { zc: axR, R, cy }],
    wellX: W.track / 2 - W.w / 2 - 0.035, flare: 0.03, flareT: 0.055,
    features: [zA0, zC0],
    blocks: [
      { name: 'hood', za: zF + 0.16, zb: zCowl, ja: 5, jb: 9, stripeJ: 7 },
      { name: 'trunk', za: zC0 + 0.04, zb: zR - 0.07, ja: 5, jb: 9, stripeJ: 7 },
      { name: 'door', za: zD0, zb: zD1, ja: 1, jb: 4, split: true, gapTop: false },
    ],
    skip: (zm, j) => j >= 5 && zm > zA0 + 0.03 && zm < zC0,
  };
  S.tubTop = (z) => S.yTop(z) - (z < zCowl ? 0.13 : 0.1);
  const sh = buildShell(S);
  const xe = (z) => S.xHalf(z) - S.shIn - S.ch * 0.9;

  // Streifenfarbe passt sich dem Lack an (hell auf dunkel, dunkel auf hell)
  const stripe = new THREE.Color();
  const setStripe = () => { const c = K.paintColor; stripe.set(0.3 * c.r + 0.59 * c.g + 0.11 * c.b > 0.45 ? 0x18191d : 0xf1ede2); };
  setStripe();
  K.paintColor.set = function (...a) { THREE.Color.prototype.set.apply(this, a); setStripe(); return this; };

  // Bug: Chromrahmen mit versenktem Grill und Doppelscheinwerfern
  const fo = { frame: sh.body, recess: det.dark, reveal: det.chrome };
  plainCap(sh, -1, 0); plainCap(sh, -1, 1); plainCap(sh, -1, 3);
  capBacking(sh, -1); capBacking(sh, 1);
  {
    const [A, B, C, D] = sh.capRow(-1, 2);
    const F = framedFace(fo, A, B, C, D, [0, 0.03, 0.97, 1], [0, 0.1, 0.9, 1], (i, j) => (i === 1 && j === 1 ? 'recess' : 'frame'), { out: [0, 0, -1], depth: { recess: 0.07 } });
    const xw = (A[0] + D[0]) / -2;
    for (const sx of [-1, 1]) for (const x of [0.5, 0.71]) {
      const p = F.P((sx * x) / xw / 2 + 0.5, 0.5);
      K.light('head', discGeo(0.086, 0.05, 8), addS(p, F.n, -0.045), F.n);
      det.chrome.tube(addS(p, F.n, -0.07), addS(p, F.n, -0.012), 0.102, 8, false);
    }
    for (const v of [0.27, 0.5, 0.73]) det.trim.box(addS(F.P(0.5, v), F.n, -0.05), 0.68, 0.02, 0.03);
  }
  // Heck: versenkte Blende mit je drei Leuchten
  plainCap(sh, 1, 0); plainCap(sh, 1, 1); plainCap(sh, 1, 3);
  {
    const [A, B, C, D] = sh.capRow(1, 2);
    const F = framedFace(fo, A, B, C, D, [0, 0.04, 0.96, 1], [0, 0.4, 0.9, 1], (i, j) => (i === 1 && j === 1 ? 'recess' : 'frame'), { out: [0, 0, 1], depth: { recess: 0.045 } });
    const xw = (A[0] + D[0]) / -2;
    for (const sx of [-1, 1]) for (const x of [0.34, 0.505, 0.67]) K.light('tail', boxGeo(0.13, 0.12, 0.035), addS(F.P((sx * x) / xw / 2 + 0.5, 0.65), F.n, -0.025), F.n);
  }

  // Haube mit Hutze
  const hoodExtra = () => {
    const sc = new MB(), dk = new MB();
    const yH = (z) => S.yTop(z) + 0.02;
    const ring = (z, hh, wv) => { const y = yH(z), c = Math.min(0.03, hh * 0.45); return [[-wv, y - 0.03, z], [-wv, y + hh - c, z], [-wv + c, y + hh, z], [wv - c, y + hh, z], [wv, y + hh - c, z], [wv, y - 0.03, z]]; };
    const z0 = axF - 0.42, z1 = axF + 0.42;
    sc.loft([ring(z0, 0.075, 0.13), ring(z0 + 0.3, 0.09, 0.145), ring(z1, 0.012, 0.15)]);
    const y = yH(z0);
    dk.quad([-0.1, y + 0.012, z0 - 0.004], [0.1, y + 0.012, z0 - 0.004], [0.1, y + 0.052, z0 - 0.004], [-0.1, y + 0.052, z0 - 0.004]);
    return [{ mb: sc, mat: mats.paint }, { mb: dk, mat: mats.dark }];
  };
  assemble(K, sh, {
    stripeColor: stripe,
    extras: { hood: hoodExtra, door: (sx) => [handleExtra(K, sh, sx, zD1 - 0.17, top - 0.115, mats.chrome)] },
  });

  // Fahrgastzelle (Fastback)
  const go = { frame: new MB(), glass: new MB(), reveal: det.dark, stripe: new MB() };
  buildGreenhouse(go, {
    zA0, yA0: S.yTop(zA0) - 0.004, xB0: xe(zA0) - 0.05, zA1, zC1, zC0, yC0: S.yTop(zC0) - 0.004, xB1: xe(zC0) - 0.05,
    yR: top + K.dims.cabinH - 0.02, xR: 0.67, c: 0.04, pa: [0.075, 0.065], pr: [0.1, 0.08], ps: [0.1, 0.075], pc: [0.42, 0.13],
    bPillars: [{ z: zD1 - 0.045, w: 0.085 }], sill: 0.035, sillR: 0.045, head: 0.05, sillS: 0.03, headS: 0.045, crown: 0.012, stripes: [0.16, 0.4],
  });
  K.fixed(go.frame, mats.paint); K.fixed(go.stripe, mats.paint, stripe); K.fixed(go.glass, mats.glass);
  for (const sx of [-1, 1]) addMirror(K, sx, [xe(zA0) - 0.075, top + 0.045, zA0 + 0.115], { w: 0.17, h: 0.1, arm: 0.13 });

  // Chromstoßstangen
  const bar = [[-0.03, -0.065], [0.05, -0.065], [0.082, -0.03], [0.082, 0.03], [0.05, 0.065], [-0.03, 0.065]];
  const guards = (dz) => (e) => { const mb = new MB(); for (const sx of [-1, 1]) mb.box([sx * 0.34, -0.235 + 0.01, e.z + dz], 0.07, 0.2, 0.06); return [{ mb, mat: mats.chrome }]; };
  addBumper(K, sh, S, -1, { yc: -0.235, wrap: 0.4, corner: 0.16, section: bar, mat: mats.chrome, extra: guards(-0.085) });
  addBumper(K, sh, S, 1, { yc: -0.2, wrap: 0.38, corner: 0.14, section: bar, mat: mats.chrome, extra: guards(0.085) });

  // Entenbürzel
  {
    const mb = new MB(), yD = S.yTop(zR) + 0.012, xs = [-0.8, -0.72, -0.36, 0, 0.36, 0.72, 0.8];
    mb.loft(xs.map((x) => { const k = Math.abs(x) > 0.75 ? 0.35 : 1; return [[x, yD + 0.005, zR - 0.3], [x, yD + 0.085 * k, zR - 0.01], [x, yD - 0.03, zR + 0.012]]; }));
    const p = K.partFrom([{ mb, mat: mats.paint }]);
    K.addPart({ id: 'spoiler', label: 'Spoiler', obj: p.obj, size: p.size, center: p.center, pivot: new THREE.Vector3(-0.8, p.center.y, p.center.z), axis: 'z', looseAngle: -0.35, hp: 70, looseAt: 50, mass: 5, deform: p.deform });
  }

  const yEx = S.yBot(zR) - 0.03;
  for (const sx of [-1, 1]) addExhaust(K, sx * 0.52, yEx, zR + 0.045, 0.055, 0.22);
  { const ze = (zF + zCowl) / 2 + 0.12; engineBlock(K, ze, S.yTop(ze - 0.33) - 0.045, { cleaner: true }); }
  addWheels(K, { spokes: 5, spokeW: 0.09, rimColor: 0xc2c6cc, dish: 0.065 });
  return new THREE.Vector3(0, top + 0.1, axF + 0.2);
};

// --------------------------------------------------------------------------- Kaze RS Turbo
// Sportcoupé: flache Keilnase, breite flache Scheinwerfer, großer Heckflügel
DESIGNS.kaze = (K) => {
  const { mats, det } = K, { w, l, h } = K.dims, W = K.W;
  const hw = w / 2, zF = -l / 2, zR = l / 2, top = h / 2, axF = -W.base / 2, axR = W.base / 2;
  const cy = K.wheelY, R = W.r + 0.07, yb = K.groundY + 0.16;
  const zCowl = zF + 0.316 * l, zA0 = zCowl + 0.04, zA1 = zA0 + 0.62, zC0 = zR - 0.795, zC1 = zC0 - 0.78, zD0 = axF + R + 0.09, zD1 = zD0 + 1.17;
  const S = {
    z0: zF, z1: zR,
    xHalf: pl([[zF, hw - 0.11], [zF + 0.18, hw - 0.02], [zF + 0.7, hw], [zR - 0.6, hw], [zR - 0.16, hw - 0.025], [zR, hw - 0.09]]),
    yTop: pl([[zF, top - 0.25], [zF + 0.18, top - 0.195], [axF, top - 0.06], [zCowl, top - 0.018], [zD1, top], [axR, top + 0.025], [zR, top + 0.04]]),
    yBot: pl([[zF, yb + 0.05], [zF + 0.4, yb], [zR - 0.5, yb], [zR, yb + 0.1]]),
    yMid: pl([[zF, -0.14], [zF + 0.3, -0.07], [zR - 0.3, -0.03], [zR, 0.02]]),
    lowIn: 0.03, tuck: 0.06, rock: 0.05, shIn: 0.035, ch: 0.04, seamIn: 0.1,
    topLines: [0.56, 0.3, 0.1], crown: () => 0.018,
    rakeF: [0, 0, 0, 0.07, 0.1], rakeR: [-0.07, -0.05, 0, 0, -0.02],
    arches: [{ zc: axF, R, cy }, { zc: axR, R, cy }],
    wellX: W.track / 2 - W.w / 2 - 0.035, flare: 0.035, flareT: 0.055,
    features: [zA0, zC0],
    blocks: [
      { name: 'hood', za: zF + 0.18, zb: zCowl, ja: 5, jb: 9 },
      { name: 'trunk', za: zC0 + 0.04, zb: zR - 0.07, ja: 5, jb: 9 },
      { name: 'door', za: zD0, zb: zD1, ja: 1, jb: 4, split: true, gapTop: false },
    ],
    skip: (zm, j) => j >= 5 && zm > zA0 + 0.03 && zm < zC0,
  };
  S.tubTop = (z) => S.yTop(z) - (z < zCowl ? 0.12 : 0.1);
  const sh = buildShell(S);
  const xe = (z) => S.xHalf(z) - S.shIn - S.ch * 0.9;

  // Bug: schmales Lichtband mit breiten Scheinwerfern
  const fo = { frame: sh.body, recess: det.dark, reveal: det.dark };
  plainCap(sh, -1, 0); plainCap(sh, -1, 1); plainCap(sh, -1, 3);
  capBacking(sh, -1); capBacking(sh, 1);
  {
    const [A, B, C, D] = sh.capRow(-1, 2);
    const F = framedFace(fo, A, B, C, D, [0, 0.035, 0.335, 0.665, 0.965, 1], [0, 0.16, 0.86, 1], (i, j) => (j === 1 && (i === 1 || i === 3) ? 'recess' : 'frame'), { out: [0, 0, -1], depth: { recess: 0.035 } });
    const wd = dist(F.P(0.035, 0.5), F.P(0.335, 0.5)), ht = dist(F.P(0.2, 0.16), F.P(0.2, 0.86));
    for (const u of [0.185, 0.815]) K.light('head', boxGeo(wd - 0.03, ht - 0.022, 0.03), addS(F.P(u, 0.51), F.n, -0.02), F.n);
  }
  // Heck: durchgehende dunkle Blende mit breiten Leuchten
  plainCap(sh, 1, 0); plainCap(sh, 1, 1); plainCap(sh, 1, 3);
  {
    const [A, B, C, D] = sh.capRow(1, 2);
    const F = framedFace(fo, A, B, C, D, [0, 0.035, 0.965, 1], [0, 0.3, 0.86, 1], (i, j) => (i === 1 && j === 1 ? 'recess' : 'frame'), { out: [0, 0, 1], depth: { recess: 0.035 } });
    for (const u of [0.2, 0.8]) K.light('tail', boxGeo(0.44, 0.1, 0.03), addS(F.P(u, 0.58), F.n, -0.02), F.n);
    det.trim.box(addS(F.P(0.5, 0.58), F.n, -0.025), 0.42, 0.1, 0.02);
  }

  assemble(K, sh, { extras: { door: (sx) => [handleExtra(K, sh, sx, zD1 - 0.16, top - 0.105, mats.dark)] } });

  const go = { frame: new MB(), glass: new MB(), reveal: det.dark, stripe: new MB() };
  buildGreenhouse(go, {
    zA0, yA0: S.yTop(zA0) - 0.004, xB0: xe(zA0) - 0.045, zA1, zC1, zC0, yC0: S.yTop(zC0) - 0.004, xB1: xe(zC0) - 0.045,
    yR: top + K.dims.cabinH - 0.01, xR: 0.6, c: 0.04, pa: [0.07, 0.06], pr: [0.09, 0.07], ps: [0.09, 0.07], pc: [0.33, 0.1],
    bPillars: [{ z: zD1 - 0.04, w: 0.08 }], sill: 0.035, sillR: 0.045, head: 0.05, sillS: 0.03, headS: 0.045, crown: 0.012,
  });
  K.fixed(go.frame, mats.paint); K.fixed(go.glass, mats.glass);
  for (const sx of [-1, 1]) addMirror(K, sx, [xe(zA0) - 0.07, top + 0.03, zA0 + 0.1], { w: 0.18, h: 0.105, arm: 0.13 });

  // Lackierte Stoßfänger mit Lufteinlässen
  addBumper(K, sh, S, -1, {
    yc: -0.29, wrap: 0.42, corner: 0.18, mat: mats.paint, hp: 80, mass: 12,
    section: [[-0.02, 0.135], [0.03, 0.135], [0.042, 0.04], [0.042, -0.075], [0.075, -0.125], [0.075, -0.165], [-0.02, -0.165]],
    extra: (e) => { const mb = new MB(); mb.box([0, -0.305, e.z - 0.042], 0.74, 0.1, 0.02); for (const sx of [-1, 1]) mb.box([sx * 0.56, -0.305, e.z - 0.042], 0.2, 0.08, 0.02); return [{ mb, mat: mats.dark }]; },
  });
  addBumper(K, sh, S, 1, {
    yc: -0.17, wrap: 0.4, corner: 0.16, mat: mats.paint, hp: 80, mass: 12,
    section: [[-0.02, 0.16], [0.03, 0.16], [0.045, 0.06], [0.045, -0.1], [0.02, -0.175], [-0.02, -0.175]],
    extra: (e) => { const mb = new MB(); mb.box([0, -0.3, e.z + 0.035], 0.9, 0.07, 0.03); return [{ mb, mat: mats.dark }]; },
  });

  // Seitenschweller
  {
    const mb = new MB(), z0 = axF + R + 0.06, z1 = axR - R - 0.06, n = nseg(z1 - z0), rings = [];
    for (const sx of [-1, 1]) {
      rings.length = 0;
      for (let i = 0; i <= n; i++) {
        const z = lerp(z0, z1, i / n), x = S.xHalf(z), k = i === 0 || i === n ? 0.4 : 1;
        rings.push([[x - 0.04, yb + 0.09, z], [x + 0.014 * k, yb + 0.065, z], [x + 0.014 * k, yb - 0.03, z], [x - 0.08, yb - 0.04, z]].map((p) => [sx * p[0], p[1], p[2]]));
      }
      mb.loft(rings);
    }
    K.fixed(mb, mats.paint);
  }

  // Heckflügel
  {
    const wing = new MB(), posts = new MB();
    const yD = S.yTop(zR - 0.3) + 0.01, yW = yD + 0.27, zc = zR - 0.25, span = hw - 0.06;
    const sec = [[-0.14, 0], [-0.05, 0.024], [0.13, 0.034], [0.14, 0.004], [-0.04, -0.014]];
    wing.loft([-span, -span / 2, 0, span / 2, span].map((x) => sec.map(([dz, dy]) => [x, yW + dy, zc + dz])));
    for (const sx of [-1, 1]) {
      slab(wing, sx * span - 0.012, sx * span + 0.012, yW - 0.06, yW + 0.075, zc - 0.16, zc + 0.17);
      posts.loft([[[sx * 0.5 - 0.02, yD - 0.02, zc - 0.11], [sx * 0.5 + 0.02, yD - 0.02, zc - 0.11], [sx * 0.5 + 0.02, yD - 0.02, zc + 0.09], [sx * 0.5 - 0.02, yD - 0.02, zc + 0.09]],
        [[sx * 0.5 - 0.02, yW, zc - 0.05], [sx * 0.5 + 0.02, yW, zc - 0.05], [sx * 0.5 + 0.02, yW, zc + 0.07], [sx * 0.5 - 0.02, yW, zc + 0.07]]]);
    }
    const p = K.partFrom([{ mb: wing, mat: mats.paint }, { mb: posts, mat: mats.dark }]);
    K.addPart({ id: 'spoiler', label: 'Heckflügel', obj: p.obj, size: p.size, center: p.center, pivot: new THREE.Vector3(-0.5, yD, zc), axis: 'z', looseAngle: -0.4, hp: 60, looseAt: 50, mass: 6, deform: p.deform });
  }

  addExhaust(K, 0.5, -0.315, zR + 0.065, 0.065, 0.26);
  { const ze = (zF + zCowl) / 2 + 0.22; engineBlock(K, ze, S.yTop(ze - 0.33) - 0.05); }
  addWheels(K, { spokes: 6, spokeW: 0.06, rimColor: 0xd9dce0, dish: 0.05 });
  return new THREE.Vector3(0, top + 0.05, axF + 0.2);
};

// --------------------------------------------------------------------------- Rhino 4x4
// Pickup: hohe kantige Front, Doppelkabine, offene Ladefläche, Rammschutz
DESIGNS.rhino = (K) => {
  const { mats, det } = K, { w, l, h } = K.dims, W = K.W;
  const hw = w / 2, zF = -l / 2, zR = l / 2, top = h / 2, axF = -W.base / 2, axR = W.base / 2;
  const cy = K.wheelY, R = W.r + 0.095, yb = K.groundY + 0.42, floor = top - 0.44;
  const zCowl = zF + 0.22 * l, zA0 = zCowl + 0.04, zA1 = zA0 + 0.42, zC0 = zA0 + 2.08, zC1 = zC0 - 0.14, zD0 = axF + R + 0.07, zD1 = zD0 + 0.9, zD2 = zC0 - 0.02, zBed = zC0 + 0.04;
  const S = {
    z0: zF, z1: zR,
    xHalf: pl([[zF, hw - 0.07], [zF + 0.14, hw - 0.01], [zF + 0.5, hw], [zR - 0.3, hw], [zR - 0.1, hw - 0.01], [zR, hw - 0.04]]),
    yTop: pl([[zF, top - 0.06], [zF + 0.14, top - 0.025], [zF + 0.7, top - 0.005], [zCowl, top], [zR, top]]),
    yBot: pl([[zF, yb + 0.08], [zF + 0.35, yb], [zR - 0.35, yb], [zR, yb + 0.07]]),
    yMid: pl([[zF, -0.13], [zF + 0.3, floor], [zR, floor]]),
    lowIn: 0.03, tuck: 0.06, rock: 0.06, shIn: 0.035, ch: 0.05, seamIn: 0.11,
    topLines: [0.62, 0.4, 0.16], crown: (z) => (z < zCowl ? 0.02 : 0),
    bulge: (x, z) => (x < 0.45 && z > zF + 0.2 && z < zCowl - 0.12 ? 0.04 : 0),
    rakeF: [0.05, 0.035, 0, 0, 0], rakeR: [-0.04, -0.03, 0, 0, 0],
    arches: [{ zc: axF, R, cy }, { zc: axR, R, cy }],
    wellX: W.track / 2 - W.w / 2 - 0.035, flare: 0.075, flareT: 0.1,
    features: [zA0, zC0], tubFeatures: [zBed - 0.07, zBed - 0.04],
    bed: { za: zBed, rail: 0.11, floor },
    blocks: [
      { name: 'hood', za: zF + 0.14, zb: zCowl, ja: 5, jb: 9 },
      { name: 'door', za: zD0, zb: zD1, ja: 1, jb: 4, split: true, gapTop: false },
      { name: 'rdoor', za: zD1, zb: zD2, ja: 1, jb: 4, split: true, fixed: true, gapTop: false },
      { name: 'bed', za: zBed + 0.02, zb: zR, ja: 6, jb: 9, gap: 0, fixed: true, matKey: 'dark' },
    ],
    skip: (zm, j) => j >= 5 && zm > zA0 + 0.03 && zm < zC0,
  };
  S.tubTop = (z) => (z > zBed - 0.055 ? floor - 0.05 : S.yTop(z) - (z < zCowl ? 0.13 : 0.1));
  const sh = buildShell(S);
  const xe = (z) => S.xHalf(z) - S.shIn - S.ch * 0.9;

  // Bug: großer Grill zwischen hohen Scheinwerfern
  const fo = { frame: sh.body, recess: det.dark, reveal: det.chrome };
  plainCap(sh, -1, 0); plainCap(sh, -1, 1); plainCap(sh, -1, 3);
  capBacking(sh, -1); capBacking(sh, 1, [2]);
  {
    const [A, B, C, D] = sh.capRow(-1, 2);
    const uL = [0, 0.025, 0.2, 0.24, 0.76, 0.8, 0.975, 1];
    const F = framedFace(fo, A, B, C, D, uL, [0, 0.08, 0.93, 1], (i, j) => (j === 1 && i % 2 === 1 ? 'recess' : 'frame'), { out: [0, 0, -1], depth: { recess: 0.06 } });
    const lw = dist(F.P(0.025, 0.5), F.P(0.2, 0.5)), lh = dist(F.P(0.1, 0.08), F.P(0.1, 0.93));
    for (const u of [0.1125, 0.8875]) {
      K.light('head', boxGeo(lw - 0.035, lh * 0.56, 0.045), addS(F.P(u, 0.64), F.n, -0.035), F.n);
      K.light('head', boxGeo(lw - 0.035, lh * 0.16, 0.045), addS(F.P(u, 0.2), F.n, -0.035), F.n);
    }
    const gw = dist(F.P(0.24, 0.5), F.P(0.76, 0.5));
    for (const v of [0.25, 0.5, 0.75]) det.trim.box(addS(F.P(0.5, v), F.n, -0.035), gw - 0.02, 0.045, 0.05);
    det.trim.box(addS(F.P(0.5, 0.5), F.n, -0.03), 0.05, lh - 0.02, 0.05);
  }
  // Heck: Pfosten mit Leuchten, dazwischen die Heckklappe
  plainCap(sh, 1, 0); plainCap(sh, 1, 1);
  const gEnd = sh.G[sh.st.length - 1];
  for (const sx of [1, -1]) {
    const s = (p) => (sx > 0 ? p : mirX(p));
    sh.body.quad(s(gEnd[2]), s(gEnd[6]), s(gEnd[5]), s(gEnd[3]));
    sh.body.tri(sh.body.v(s(gEnd[3])), sh.body.v(s(gEnd[5])), sh.body.v(s(gEnd[4])));
    K.light('tail', boxGeo(0.085, 0.3, 0.03), [sx * (gEnd[5][0] + gEnd[3][0]) / 2, top - 0.21, zR + 0.004], [0, 0, 1]);
  }

  assemble(K, sh, {
    mouldMat: mats.trim,
    extras: {
      door: (sx) => [handleExtra(K, sh, sx, zD1 - 0.15, top - 0.13, mats.dark)],
      rdoor: (sx) => [handleExtra(K, sh, sx, zD2 - 0.17, top - 0.13, mats.dark)],
    },
  });

  // Heckklappe
  {
    const xs = gEnd[5][0] - 0.012, mb = new MB(), hd = new MB();
    slab(mb, -xs, xs, floor + 0.006, top - 0.006, zR - 0.07, zR - 0.004);
    hd.box([0, top - 0.09, zR - 0.002], 0.24, 0.045, 0.016);
    const p = K.partFrom([{ mb, mat: mats.paint }, { mb: hd, mat: mats.dark }]);
    K.addPart({ id: 'trunk', label: 'Heckklappe', obj: p.obj, size: p.size, center: p.center, pivot: new THREE.Vector3(0, floor, zR - 0.04), axis: 'x', looseAngle: 1.25, hp: 80, looseAt: 60, mass: 20, deform: p.deform });
  }

  const go = { frame: new MB(), glass: new MB(), reveal: det.dark, stripe: new MB() };
  buildGreenhouse(go, {
    zA0, yA0: S.yTop(zA0) - 0.004, xB0: xe(zA0) - 0.05, zA1, zC1, zC0, yC0: S.yTop(zC0) - 0.004, xB1: xe(zC0) - 0.05,
    yR: top + K.dims.cabinH, xR: 0.8, c: 0.045, pa: [0.085, 0.075], pr: [0.13, 0.11], ps: [0.1, 0.085], pc: [0.15, 0.11],
    bPillars: [{ z: zD1 - 0.05, w: 0.1 }], sill: 0.04, sillR: 0.06, head: 0.055, sillS: 0.035, headS: 0.05, crown: 0.012,
  });
  K.fixed(go.frame, mats.paint); K.fixed(go.glass, mats.glass);
  for (const sx of [-1, 1]) addMirror(K, sx, [xe(zA0) - 0.075, top + 0.1, zA0 + 0.13], { w: 0.2, h: 0.2, arm: 0.17 });

  // Stahlstoßstangen
  addBumper(K, sh, S, -1, {
    yc: -0.27, wrap: 0.4, corner: 0.14, mat: mats.trim, hp: 140, mass: 30,
    section: [[-0.03, -0.11], [0.07, -0.11], [0.11, -0.06], [0.11, 0.075], [0.07, 0.115], [-0.03, 0.115]],
    extra: (e) => { const mb = new MB(); mb.loft([[[-0.5, -0.36, e.z - 0.09], [0.5, -0.36, e.z - 0.09], [0.5, -0.38, e.z - 0.07], [-0.5, -0.38, e.z - 0.07]], [[-0.42, -0.5, e.z + 0.16], [0.42, -0.5, e.z + 0.16], [0.42, -0.52, e.z + 0.18], [-0.42, -0.52, e.z + 0.18]]]); return [{ mb, mat: mats.steel }]; },
  });
  addBumper(K, sh, S, 1, {
    yc: -0.25, wrap: 0.34, corner: 0.1, mat: mats.trim, hp: 140, mass: 28,
    section: [[-0.03, -0.09], [0.08, -0.09], [0.105, -0.04], [0.105, 0.06], [0.07, 0.095], [-0.03, 0.095]],
    extra: (e) => { const mb = new MB(); mb.box([0, -0.25 + 0.1, e.z + 0.045], 0.8, 0.012, 0.1); return [{ mb, mat: mats.dark }]; },
  });

  // Rammschutz
  {
    const mb = new MB(), z = sh.endAt(-1, -0.27).z - 0.2, r = 0.032, yT = top - 0.13, yM = -0.02, yL = -0.36;
    for (const sx of [-1, 1]) {
      mb.tube([sx * 0.38, yL, z], [sx * 0.38, yT - 0.06, z], r);
      mb.tube([sx * 0.38, yT - 0.06, z], [sx * 0.3, yT, z], r);
      mb.tube([sx * 0.38, yM, z], [sx * 0.84, yM - 0.07, z + 0.03], r);
      mb.tube([sx * 0.84, yM - 0.07, z + 0.03], [sx * 0.84, yL + 0.08, z + 0.03], r);
      mb.tube([sx * 0.84, yL + 0.08, z + 0.03], [sx * 0.38, yL + 0.02, z], r);
      mb.tube([sx * 0.38, -0.27, z], [sx * 0.38, -0.27, z + 0.13], r * 0.9);
    }
    mb.tube([-0.3, yT, z], [0.3, yT, z], r);
    mb.tube([-0.38, yM, z], [0.38, yM, z], r);
    mb.tube([-0.38, yL + 0.02, z], [0.38, yL + 0.02, z], r);
    const p = K.partFrom([{ mb, mat: mats.dark }]);
    K.addPart({ id: 'bullbar', label: 'Rammschutz', obj: p.obj, size: p.size, center: p.center, pivot: new THREE.Vector3(-0.84, p.center.y, p.center.z), axis: 'z', looseAngle: -0.3, hp: 170, looseAt: 60, mass: 25, deform: p.deform });
  }

  // Radkästen in der Ladefläche
  {
    const mb = new MB(), x1 = gEnd[5][0] - 0.004, yT = cy + R + 0.035;
    for (const sx of [-1, 1]) {
      const a = sx * (S.wellX - 0.03), b = sx * x1;
      slab(mb, Math.min(a, b), Math.max(a, b), floor - 0.01, yT, axR - R - 0.04, axR + R + 0.04);
    }
    K.fixed(mb, mats.dark);
  }

  // Trittbretter
  for (const sx of [-1, 1]) det.trim.box([sx * (hw + 0.02), yb - 0.02, (axF + axR) / 2], 0.2, 0.05, axR - axF - 2 * R - 0.16);

  addExhaust(K, 0.62, yb + 0.03, zR + 0.06, 0.055, 0.3);
  { const ze = (zF + zCowl) / 2 + 0.05; engineBlock(K, ze, S.yTop(ze - 0.33) - 0.05); }
  addWheels(K, { spokes: 6, spokeW: 0.08, lugs: 14, tireCham: 0.06, rimRatio: 0.6, rimColor: 0x4a4d54, dish: 0.07 });
  return new THREE.Vector3(0, top + 0.1, axF + 0.25);
};


export function buildCarModel(preset, color, envMap = null) {
  const K = makeKit(preset, color, envMap);
  const design = DESIGNS[preset.id] || DESIGNS.brutus;
  return finish(K, design(K));
}
