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
