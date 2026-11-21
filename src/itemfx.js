// ---------------------------------------------------------------------------
// Effekte der Power-ups: Öl-Strahl + wachsende Lache, Schockwelle mit Bodenwelle,
// Druckkuppel, Staubwalze und Rissen, Brandflecken nach Explosionen.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const canvas = (w, h) => {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  return [cv, cv.getContext && cv.getContext('2d')];
};
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

// Regenbogen-Schimmer eines Ölfilms
function sheenTexture() {
  const [cv, x] = canvas(256, 256);
  if (x) {
    x.clearRect(0, 0, 256, 256);
    for (let k = 0; k < 7; k++) {
      const g = x.createRadialGradient(128 + Math.sin(k) * 18, 128 + Math.cos(k * 1.7) * 18, 10 + k * 8, 128, 128, 120);
      const h = (k * 47) % 360;
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.45 + k * 0.05, `hsla(${h},90%,60%,0.22)`);
      g.addColorStop(0.62 + k * 0.04, `hsla(${(h + 90) % 360},90%,55%,0.16)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Risse im Boden (Schockwelle) bzw. Brandfleck (Explosion)
function crackTexture() {
  const [cv, x] = canvas(256, 256);
  if (x) {
    x.clearRect(0, 0, 256, 256);
    const g = x.createRadialGradient(128, 128, 4, 128, 128, 70);
    g.addColorStop(0, 'rgba(20,18,16,0.75)'); g.addColorStop(1, 'rgba(20,18,16,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(18,16,14,0.9)'; x.lineCap = 'round';
    for (let k = 0; k < 11; k++) {
      let a = (k / 11) * Math.PI * 2 + Math.random() * 0.4, r = 8, px = 128, py = 128;
      x.lineWidth = 4;
      x.beginPath(); x.moveTo(px, py);
      while (r < 118) {
        r += 8 + Math.random() * 12; a += (Math.random() - 0.5) * 0.5;
        px = 128 + Math.cos(a) * r; py = 128 + Math.sin(a) * r;
        x.lineTo(px, py); x.lineWidth = Math.max(0.8, 4 - r / 35);
        if (Math.random() < 0.25) { const b = a + (Math.random() - 0.5) * 1.4; x.moveTo(px, py); x.lineTo(px + Math.cos(b) * 16, py + Math.sin(b) * 16); x.moveTo(px, py); }
      }
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function scorchTexture() {
  const [cv, x] = canvas(256, 256);
  if (x) {
    x.clearRect(0, 0, 256, 256);
    for (let k = 0; k < 9; k++) {
      const cx = 128 + (Math.random() - 0.5) * 50, cy = 128 + (Math.random() - 0.5) * 50, r = 50 + Math.random() * 60;
      const g = x.createRadialGradient(cx, cy, 2, cx, cy, r);
      g.addColorStop(0, 'rgba(12,10,9,0.55)'); g.addColorStop(0.6, 'rgba(25,20,16,0.3)'); g.addColorStop(1, 'rgba(25,20,16,0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Flache Scheibe, die dem Gelände folgt (für Decals)
function groundDisc(track, pos, r, seg = 24, lift = 0.06) {
  const geo = new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2);
  const a = geo.attributes.position;
  for (let k = 0; k < a.count; k++) a.setY(k, track.heightAt(pos.x + a.getX(k), pos.z + a.getZ(k)) - pos.y + lift);
  a.needsUpdate = true;
  return geo;
}

// ------------------------------------------------------------ Öl
export class OilFx {
  constructor(group, track, envMap) {
    this.group = group; this.track = track;
    this.max = 420;
    this.drops = [];
    this.streams = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x08080b, roughness: 0.12, metalness: 0.85, envMap, envMapIntensity: 1.3 });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.042, 1), mat, this.max);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(this.mesh);
    this.sheen = sheenTexture();
  }
  // Öl spritzt für ~0,6 s aus dem Heck des Autos
  stream(car, dur = 0.6) { if (car?.root) this.streams.push({ car, left: dur, acc: 0 }); }
  // Lache mit unregelmäßigem Rand + Regenbogen-Film
  puddle(pos, r, matOil) {
    const seg = 40;
    const geo = new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2);
    const a = geo.attributes.position;
    const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    for (let k = 1; k < a.count; k++) {
      const x = a.getX(k), z = a.getZ(k), ang = Math.atan2(z, x);
      const f = 0.82 + 0.1 * Math.sin(ang * 3 + ph[0]) + 0.07 * Math.sin(ang * 5 + ph[1]) + 0.05 * Math.sin(ang * 9 + ph[2]);
      a.setX(k, x * f); a.setZ(k, z * f);
    }
    for (let k = 0; k < a.count; k++) a.setY(k, this.track.heightAt(pos.x + a.getX(k), pos.z + a.getZ(k)) - pos.y);
    a.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, matOil);
    const film = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.sheen, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    film.position.y = 0.012;
    mesh.add(film);
    mesh.scale.set(0.06, 1, 0.06);
    mesh.userData.film = film;
    return mesh;
  }
  emitDrop(p, v) {
    if (this.drops.length >= this.max) this.drops.shift();
    this.drops.push({ p: p.clone(), v: v.clone(), landed: -1, s: 0.7 + Math.random() * 0.8 });
  }
  update(dt) {
    for (let k = this.streams.length - 1; k >= 0; k--) {
      const st = this.streams[k];
      st.left -= dt;
      if (st.left <= 0 || st.car.disposed) { this.streams.splice(k, 1); continue; }
      st.acc += dt * 210;
      const car = st.car, L = car.p.dims.l;
      const lv = car.body.linvel();
      while (st.acc > 1) {
        st.acc -= 1;
        // Austritt am Heck (unter der Stoßstange, Auspuffhöhe)
        _v.set((Math.random() - 0.5) * 0.5, 0.32, L / 2 + 0.05);
        car.root.localToWorld(_v);
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(car.root.quaternion);
        const vel = new THREE.Vector3(lv.x * 0.9, lv.y * 0.5, lv.z * 0.9)
          .addScaledVector(back, 3.2 + Math.random() * 2.4)
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.4 + Math.random() * 1.1, (Math.random() - 0.5) * 0.9));
        this.emitDrop(_v, vel);
      }
    }
    let n = 0;
    for (let k = this.drops.length - 1; k >= 0; k--) {
      const d = this.drops[k];
      if (d.landed < 0) {
        d.v.y -= 13.2 * dt;
        d.p.addScaledVector(d.v, dt);
        const gy = this.track.heightAt(d.p.x, d.p.z) + 0.03;
        if (d.p.y <= gy) { d.p.y = gy; d.landed = 0; }
        _q.setFromUnitVectors(_s.set(0, 1, 0), _v.copy(d.v).normalize());
        _s.set(d.s * 0.8, d.s * (1.4 + Math.min(4, d.v.length() * 0.35)), d.s * 0.8); // im Flug zum Strahl gezogen
      } else {
        d.landed += dt;
        if (d.landed > 1.2) { this.drops.splice(k, 1); continue; }
        // Tropfen zerläuft zu einem flachen Spritzer
        const e = easeOut(d.landed / 0.25);
        _q.identity();
        _s.set(d.s * (1 + e * 2.4), d.s * (1 - e * 0.85) + 0.01, d.s * (1 + e * 2.4)).multiplyScalar(d.landed > 0.9 ? (1.2 - d.landed) / 0.3 : 1);
      }
      _m.compose(d.p, _q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.drops = []; this.streams = []; this.mesh.count = 0; }
  dispose() { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.sheen.dispose(); }
}

// ------------------------------------------------------------ Schockwelle + Explosionen
const WAVE_VS = `
attribute float rad;
uniform float uR, uW, uAmp;
varying float vBump, vRad;
void main() {
  float d = (rad - uR) / uW;
  float bump = exp(-d * d);
  // hinter der Front noch ein kleines Nachschwingen
  float tail = exp(-pow((rad - uR * 0.72) / (uW * 0.8), 2.0)) * 0.3;
  vec3 p = position;
  p.y += (bump - tail * 0.6) * uAmp;
  vBump = bump; vRad = rad;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const WAVE_FS = `
uniform float uR, uOp;
uniform vec3 uColor;
varying float vBump, vRad;
void main() {
  float inner = smoothstep(uR, 0.0, vRad) * 0.06;
  float a = (vBump * 0.62 + inner) * uOp;
  vec3 c = mix(uColor, vec3(1.0), vBump * vBump * 0.7);
  gl_FragColor = vec4(c * 1.2, a);
}`;
const DOME_VS = `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const DOME_FS = `
uniform vec3 uColor; uniform float uOp;
varying vec3 vN; varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(vN, vV)), 2.2);
  gl_FragColor = vec4(uColor * (0.6 + rim * 1.8), (0.06 + rim * 0.9) * uOp);
}`;

export class BlastFx {
  constructor(group, track, game) {
    this.group = group; this.track = track; this.g = game;
    this.list = [];
    this.crackTex = crackTexture();
    this.scorchTex = scorchTexture();
    this.domeGeo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  }
  groundColors() {
    const th = this.g.level?.theme;
    const c = [th?.dirt, th?.ground, th?.sand].filter((v) => v != null);
    return c.length ? c : [0x8c7a5c, 0x6b8a44, 0x9a9a92];
  }
  dome(pos, color, size, dur) {
    const mat = new THREE.ShaderMaterial({ vertexShader: DOME_VS, fragmentShader: DOME_FS, uniforms: { uColor: { value: new THREE.Color(color) }, uOp: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.domeGeo, mat);
    mesh.position.copy(pos); mesh.scale.setScalar(0.1);
    this.group.add(mesh);
    this.list.push({ kind: 'dome', mesh, age: 0, dur, size });
  }
  decal(pos, tex, r, life, opacity = 1) {
    const mesh = new THREE.Mesh(groundDisc(this.track, pos, r, 28, 0.05), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mesh.position.copy(pos);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(mesh);
    this.list.push({ kind: 'decal', mesh, age: 0, life, op: opacity });
  }
  // Schockwelle: Boden hebt sich in einer Welle nach außen, Staubwalze an der Front
  shock(pos, radius = 16) {
    const ground = pos.clone(); ground.y = this.track.heightAt(pos.x, pos.z);
    const NR = 22, NS = 80, R = radius + 2;
    const posA = [], radA = [], idx = [];
    for (let i = 0; i <= NR; i++) {
      const r = (i / NR) * R;
      for (let j = 0; j < NS; j++) {
        const a = (j / NS) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        posA.push(x, this.track.heightAt(ground.x + x, ground.z + z) - ground.y + 0.1, z); radA.push(r);
      }
    }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) {
      const a = i * NS + j, b = i * NS + (j + 1) % NS, c = (i + 1) * NS + j, d = (i + 1) * NS + (j + 1) % NS;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
    geo.setAttribute('rad', new THREE.Float32BufferAttribute(radA, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ vertexShader: WAVE_VS, fragmentShader: WAVE_FS,
      uniforms: { uR: { value: 0 }, uW: { value: 1.6 }, uAmp: { value: 1.2 }, uOp: { value: 1 }, uColor: { value: new THREE.Color(0x6fcfff) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(ground);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.list.push({ kind: 'wave', mesh, age: 0, dur: 0.85, R: radius, pos: ground, dustAcc: 0, cols: this.groundColors() });
    this.dome(ground.clone().setY(ground.y + 0.2), 0x7fd6ff, radius * 0.75, 0.45);
    this.decal(ground, this.crackTex, 4.2, 14, 0.9);
    // Brocken direkt in der Mitte hochgeschleudert
    this.g.fx.chunks.burst(ground.clone().setY(ground.y + 0.3), 16, { dir: new THREE.Vector3(0, 1, 0), speed: 7, colors: this.groundColors() });
  }
  // Explosion: Feuerball-Blitz + Brandfleck
  blast(pos, radius) {
    const ground = pos.clone(); ground.y = this.track.heightAt(pos.x, pos.z);
    this.dome(pos.clone(), 0xff8a2a, radius * 0.7, 0.35);
    this.decal(ground, this.scorchTex, radius * 0.55 + 1.2, 25, 0.95);
  }
  update(dt) {
    const fx = this.g.fx;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const e = this.list[k];
      e.age += dt;
      if (e.kind === 'wave') {
        const t = e.age / e.dur, u = e.mesh.material.uniforms;
        const R = e.R * easeOut(t * 1.05);
        u.uR.value = R;
        u.uAmp.value = 1.3 * (1 - t) + 0.15;
        u.uW.value = 1.4 + t * 1.6;
        u.uOp.value = t < 0.08 ? t / 0.08 : 1 - Math.pow(t, 2);
        // Staubwalze an der Wellenfront
        e.dustAcc += dt * 75 * (1 - t);
        while (e.dustAcc > 1) {
          e.dustAcc -= 1;
          const a = Math.random() * Math.PI * 2, rr = R + (Math.random() - 0.3) * 1.2;
          const x = e.pos.x + Math.cos(a) * rr, z = e.pos.z + Math.sin(a) * rr, y = this.track.heightAt(x, z) + 0.25;
          const out = 4 + Math.random() * 6;
          fx.smoke.emit(x, y, z, Math.cos(a) * out, 1 + Math.random() * 2.5, Math.sin(a) * out,
            { color: e.cols[(Math.random() * e.cols.length) | 0], size0: 0.5, size1: 1.9 + Math.random() * 1.2, life: 0.7 + Math.random() * 0.6, rise: 0.4 });
          if (Math.random() < 0.06) fx.chunks.burst(new THREE.Vector3(x, y, z), 1, { dir: new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), speed: 5, colors: e.cols, size: 0.7 });
        }
        if (t >= 1) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); this.list.splice(k, 1); }
      } else if (e.kind === 'dome') {
        const t = e.age / e.dur;
        e.mesh.scale.setScalar(0.3 + e.size * easeOut(t));
        e.mesh.material.uniforms.uOp.value = Math.max(0, 1 - t) ** 1.5;
        if (t >= 1) { this.group.remove(e.mesh); e.mesh.material.dispose(); this.list.splice(k, 1); }
      } else if (e.kind === 'decal') {
        const fadeIn = Math.min(1, e.age / 0.15), fadeOut = clamp((e.life - e.age) / 3, 0, 1);
        e.mesh.material.opacity = e.op * fadeIn * fadeOut;
        if (e.age >= e.life) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); this.list.splice(k, 1); }
      }
    }
  }
  clear() {
    for (const e of this.list) { this.group.remove(e.mesh); e.mesh.geometry !== this.domeGeo && e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
    this.list = [];
  }
  dispose() { this.clear(); this.crackTex.dispose(); this.scorchTex.dispose(); this.domeGeo.dispose(); }
}

// =========================================================================
// v8: Modelle und Effekte der neuen Power-ups
// =========================================================================
const flat = (o) => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6, metalness: 0.1, ...o });

// Gelb-schwarze Warnstreifen (für Nagelband und Rampe)
function stripeTexture(rep = 6, chevron = false) {
  const [cv, x] = canvas(256, 64);
  if (x) {
    x.fillStyle = '#1d1f26'; x.fillRect(0, 0, 256, 64);
    x.fillStyle = '#ffc21a';
    const w = 256 / rep;
    for (let k = -1; k <= rep; k++) {
      x.beginPath();
      if (chevron) { x.moveTo(k * w, 0); x.lineTo(k * w + w * 0.5, 32); x.lineTo(k * w, 64); x.lineTo(k * w + w * 0.45, 64); x.lineTo(k * w + w * 0.95, 32); x.lineTo(k * w + w * 0.45, 0); }
      else { x.moveTo(k * w, 64); x.lineTo(k * w + w * 0.5, 64); x.lineTo(k * w + w, 0); x.lineTo(k * w + w * 0.5, 0); }
      x.closePath(); x.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------- Nagelband: fünf Scharnier-Glieder mit Stahldornen, quer zur Fahrbahn
export function buildSpikeStrip(width = 4.4) {
  const g = new THREE.Group();
  const metal = flat({ color: 0x3a3d46, metalness: 0.6, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dde6, metalness: 0.95, roughness: 0.18, flatShading: true });
  const stripes = flat({ map: stripeTexture(5), roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff1a0a, emissiveIntensity: 0.8, flatShading: true });
  const n = 6, seg = width / n;
  const spikeGeo = new THREE.ConeGeometry(0.045, 0.2, 4);
  const spikes = new THREE.InstancedMesh(spikeGeo, chrome, n * 10);
  let si = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x0 = -width / 2 + seg * (i + 0.5);
    const zig = (i % 2 ? 1 : -1) * 0.06;                  // Scherengitter leicht versetzt
    const plate = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.92, 0.06, 0.34), stripes);
    plate.position.set(x0, 0.03, zig);
    plate.rotation.y = (i % 2 ? 1 : -1) * 0.12;
    g.add(plate);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.92, 0.05, 0.06), metal);
    rail.position.set(x0, 0.075, zig); rail.rotation.y = plate.rotation.y; g.add(rail);
    for (let k = 0; k < 5; k++) for (const side of [-1, 1]) {
      const lx = -seg * 0.38 + (k / 4) * seg * 0.76;
      p.set(x0 + lx * Math.cos(plate.rotation.y), 0.16, zig + side * 0.1 - lx * Math.sin(plate.rotation.y));
      q.setFromEuler(new THREE.Euler(side * 0.35, 0, 0));
      m.compose(p, q, s); spikes.setMatrixAt(si++, m);
    }
    if (i < n - 1) {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 6), chrome);
      hinge.rotation.x = Math.PI / 2; hinge.position.set(x0 + seg / 2, 0.05, 0); g.add(hinge);
    }
  }
  spikes.count = si; g.add(spikes);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.4), metal);
    cap.position.set(side * (width / 2 + 0.05), 0.06, 0); g.add(cap);
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.24), red);
    refl.position.set(side * (width / 2 + 0.13), 0.07, 0); g.add(refl);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------- Rampe: Stahl-Keil mit Chevron-Belag, Stützen und Kantenschutz
export const RAMP = { w: 4.4, l: 5.2, h: 1.35 };
export function rampHull() {
  const { w, l, h } = RAMP, x = w / 2, z = l / 2;
  // Auffahrt bei +z (niedrig, zum Verfolger), hohe Kante bei -z (Fahrtrichtung)
  return new Float32Array([-x, 0, z, x, 0, z, -x, 0, -z, x, 0, -z, -x, h, -z, x, h, -z]);
}
export function buildRamp() {
  const { w, l, h } = RAMP;
  const g = new THREE.Group();
  const deckTex = stripeTexture(4, true); deckTex.repeat.set(1, 1); deckTex.rotation = Math.PI / 2; deckTex.center.set(0.5, 0.5);
  const deck = flat({ map: deckTex, roughness: 0.8 });
  const steel = flat({ color: 0x4a4f5c, metalness: 0.55, roughness: 0.4 });
  const dark = flat({ color: 0x23262e, metalness: 0.4, roughness: 0.6 });
  const edge = flat({ color: 0xffc21a, roughness: 0.5 });
  // Fahrbahn
  const len = Math.hypot(l, h), ang = Math.atan2(h, l);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, len), deck);
  top.position.set(0, h / 2, 0); top.rotation.x = ang; g.add(top);
  // Seitenwangen (Dreiecke)
  for (const side of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(-l / 2, 0); sh.lineTo(l / 2, 0); sh.lineTo(-l / 2, h); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
    const cheek = new THREE.Mesh(geo, steel);
    cheek.rotation.y = Math.PI / 2; cheek.position.set(side * (w / 2) - (side > 0 ? 0.12 : 0), 0, 0);
    g.add(cheek);
    // gelbe Kantenleiste
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, len), edge);
    rail.position.set(side * (w / 2 - 0.02), h / 2 + 0.1, 0); rail.rotation.x = ang; g.add(rail);
  }
  // Rückwand + Stützen (von hinten sichtbar)
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), dark);
  back.position.set(0, h / 2, -l / 2 + 0.06); g.add(back);
  for (let k = -1; k <= 1; k++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h * 0.95, 0.16), steel);
    post.position.set(k * w * 0.36, h * 0.47, -l / 2 + 0.25); g.add(post);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, l * 0.62), steel);
    brace.position.set(k * w * 0.36, h * 0.3, -l * 0.12); brace.rotation.x = Math.atan2(h * 0.55, l * 0.62); g.add(brace);
  }
  // Abrisskante oben (Stahlwinkel)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.14, 0.22), steel);
  lip.position.set(0, h + 0.03, -l / 2 + 0.11); g.add(lip);
  // Auffahrtsblech unten
  const toe = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.4), steel);
  toe.position.set(0, 0.02, l / 2 - 0.15); g.add(toe);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------- Rammbock: glühender Frontbügel aus Stahlrohr
export function buildRamBar(dims) {
  const g = new THREE.Group();
  const w = dims.w;
  const glow = new THREE.MeshStandardMaterial({ color: 0x3a2a22, metalness: 0.7, roughness: 0.3, emissive: 0xff4a10, emissiveIntensity: 1.5, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e36, metalness: 0.8, roughness: 0.35, flatShading: true });
  const tube = (pts, r, mat) => {
    const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    return new THREE.Mesh(new THREE.TubeGeometry(c, 18, r, 6, false), mat);
  };
  const x = w * 0.42;
  // Hauptbügel (gebogen), zwei Querrohre, Pfosten, Diagonalen
  g.add(tube([[-x, 0.0, 0], [-x * 0.95, 0.42, -0.06], [-x * 0.6, 0.62, -0.12], [0, 0.66, -0.14], [x * 0.6, 0.62, -0.12], [x * 0.95, 0.42, -0.06], [x, 0.0, 0]], 0.055, glow));
  g.add(tube([[-x, 0.22, -0.02], [0, 0.26, -0.18], [x, 0.22, -0.02]], 0.05, glow));
  for (const s of [-1, 1]) {
    g.add(tube([[s * x * 0.35, 0.0, -0.1], [s * x * 0.35, 0.64, -0.16]], 0.04, steel));
    g.add(tube([[s * x * 0.35, 0.26, -0.18], [s * x * 0.92, 0.5, -0.07]], 0.035, steel));
    // Halter zur Karosserie
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.32), steel);
    mount.position.set(s * x * 0.7, 0.1, 0.12); g.add(mount);
  }
  // Prallplatte mit Nieten
  const plate = new THREE.Mesh(new THREE.BoxGeometry(x * 0.7, 0.2, 0.05), steel);
  plate.position.set(0, 0.04, -0.12); g.add(plate);
  g.userData.glow = glow;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------- Leuchtband: gezackter Blitz / Strahl als zur Kamera gedrehtes Band
function beamTexture() {
  const [cv, x] = canvas(16, 64);
  if (x) {
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 16, 64);
  }
  return new THREE.CanvasTexture(cv);
}
let _beamTex = null;
export class Bolt {
  constructor(group, color, width = 0.35, segs = 16) {
    this.n = segs + 1; this.w = width;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    const uv = new Float32Array(this.n * 2 * 2), idx = [];
    for (let i = 0; i < this.n; i++) { uv.set([i / segs, 0, i / segs, 1], i * 4); if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    _beamTex = _beamTex || beamTexture();
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: _beamTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false;
    this.pts = Array.from({ length: this.n }, () => new THREE.Vector3());
    group.add(this.mesh);
    this.group = group;
  }
  // a → b mit zufälligen Zacken (Mitte am stärksten), cam: Kameraposition
  set(a, b, cam, jag = 0.6, opacity = 1) {
    const d = _v.copy(b).sub(a), len = d.length();
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize(), up = new THREE.Vector3().crossVectors(d, side).normalize();
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1), env = Math.sin(Math.PI * t);
      this.pts[i].copy(a).addScaledVector(d, t)
        .addScaledVector(side, (Math.random() - 0.5) * jag * env * Math.min(1, len / 6))
        .addScaledVector(up, (Math.random() - 0.5) * jag * env * Math.min(1, len / 6));
    }
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i], q = this.pts[Math.min(this.n - 1, i + 1)], o = this.pts[Math.max(0, i - 1)];
      const dir = new THREE.Vector3().subVectors(q, o).normalize();
      const view = new THREE.Vector3().subVectors(cam, p).normalize();
      const nrm = new THREE.Vector3().crossVectors(dir, view).normalize().multiplyScalar(this.w / 2);
      this.pos.set([p.x + nrm.x, p.y + nrm.y, p.z + nrm.z, p.x - nrm.x, p.y - nrm.y, p.z - nrm.z], i * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.mesh.material.opacity = opacity;
    this.mesh.visible = opacity > 0.01;
  }
  dispose() { this.group.remove(this.mesh); this.geo.dispose(); this.mesh.material.dispose(); }
}

// ---------- Nebelwand: eigene, dichte Rauchwolken (nicht der dünne Reifenqualm)
export class SmokeWall {
  constructor(group, track) {
    this.track = track; this.max = 260; this.list = [];
    // weich schattiert + leicht selbstleuchtend, sonst sehen die Wolken aus wie Felsbrocken
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6a6e76, flatShading: false, transparent: true, opacity: 0.8, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    group.add(this.mesh); this.group = group;
    this.emitters = [];
  }
  start(car, dur = 2.4) { if (car?.root) this.emitters.push({ car, left: dur, acc: 0 }); }
  puff(p, v) {
    if (this.list.length >= this.max) this.list.shift();
    const g = 0.84 + Math.random() * 0.14;
    this.list.push({ p: p.clone(), v: v.clone(), age: 0, life: 4.4 + Math.random() * 1.4, s0: 0.9 + Math.random() * 0.5, s1: 3.6 + Math.random() * 2.2, rot: Math.random() * 6, col: g });
  }
  // Dichte an einem Punkt (0..1): für Bots und den Sicht-Schleier
  density(p) {
    let d = 0;
    for (const s of this.list) {
      const r = s.s0 + (s.s1 - s.s0) * Math.min(1, s.age / 1.2);
      const dx = p.x - s.p.x, dy = p.y - s.p.y, dz = p.z - s.p.z, q = (dx * dx + dy * dy * 1.6 + dz * dz) / (r * r);
      if (q < 1) d += (1 - q) * 0.45 * Math.min(1, (s.life - s.age) / 1.2);
      if (d >= 1) return 1;
    }
    return d;
  }
  update(dt) {
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.left -= dt;
      if (e.left <= 0 || e.car.disposed) { this.emitters.splice(k, 1); continue; }
      e.acc += dt * 42;
      const L = e.car.p.dims.l, lv = e.car.body.linvel();
      while (e.acc > 1) {
        e.acc -= 1;
        _v.set((Math.random() - 0.5) * e.car.p.dims.w * 1.6, 0.4 + Math.random() * 0.6, L / 2 + 0.6 + Math.random() * 1.5);
        e.car.root.localToWorld(_v);
        this.puff(_v, new THREE.Vector3(lv.x * 0.15 + (Math.random() - 0.5) * 2.5, 0.4 + Math.random() * 0.6, lv.z * 0.15 + (Math.random() - 0.5) * 2.5));
      }
    }
    let n = 0;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const s = this.list[k];
      s.age += dt;
      if (s.age > s.life) { this.list.splice(k, 1); continue; }
      s.v.multiplyScalar(Math.exp(-dt * 1.4));
      s.p.addScaledVector(s.v, dt);
      const gy = this.track.heightAt(s.p.x, s.p.z);
      if (s.p.y < gy + 0.6) s.p.y = gy + 0.6;
      const grow = s.s0 + (s.s1 - s.s0) * (1 - Math.exp(-s.age * 1.6));
      const fade = Math.min(1, (s.life - s.age) / 1.4);
      _s.set(grow, grow * 0.78, grow).multiplyScalar(0.25 + 0.75 * fade);
      _q.setFromEuler(new THREE.Euler(s.rot, s.rot * 0.7 + s.age * 0.2, 0));
      _m.compose(s.p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.instanceColor.setXYZ(n, s.col, s.col, s.col * 1.02);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.list = []; this.emitters = []; this.mesh.count = 0; }
  dispose() { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
