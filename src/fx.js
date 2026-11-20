import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _e = new THREE.Euler();
const _zAxis = new THREE.Vector3(0, 0, 1);

// Low-Poly-Rauchwolken: geschnittene Ikosaeder, die wachsen und wieder verschwinden.
export class Smoke {
  constructor(scene, max = 700) {
    this.max = max;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.5, depthWrite: false });
    // Rauch nahe der Kamera ausblenden -> verdeckt nie die Sicht
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n  gl_FragColor.a *= smoothstep(2.5, 9.0, length(vViewPosition));');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.rot = new Float32Array(max * 3);
    this.rise = new Float32Array(max);
    this.cursor = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
  }
  emit(x, y, z, vx, vy, vz, { life = 1.6, size0 = 0.35, size1 = 2.0, color = 0xe8e8e8, rise = 0.8 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size0; this.size1[i] = size1;
    this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = Math.random() * 6;
    this.rise[i] = rise;
    this.mesh.setColorAt(i, _c.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06));
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const drag = Math.exp(-dt * 1.8);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      const k = i * 3;
      this.vel[k] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag + this.rise[i] * dt; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const grow = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      const fadeIn = Math.min(1, t / 0.08);
      const fadeOut = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
      const sc = grow * fadeIn * Math.max(0, fadeOut);
      this.rot[k] += dt * 0.4;
      _q.setFromEuler(_e.set(this.rot[k], this.rot[k + 1], this.rot[k + 2]));
      _m.compose(_p.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), _q, _s.set(sc, sc * 0.85, sc));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Funken und Glassplitter: kleine leuchtende Stäbchen mit Schwerkraft.
export class Sparks {
  constructor(scene, max = 500) {
    this.max = max;
    const geo = new THREE.BoxGeometry(0.035, 0.035, 0.22);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.str = new Float32Array(max).fill(1);
    this.size = new Float32Array(max).fill(1);
    this.cursor = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, _c.set(0xffb040)); }
  }
  burst(p, n, { speed = 7, dir = null, color = 0xffb040, spread = 1, life = 0.6, up = 2.5, stretch = 1, size = 1, base = null } = {}) {
    for (let j = 0; j < n; j++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      let vx = (Math.random() - 0.5) * 2 * spread, vy = Math.random() * spread + 0.2, vz = (Math.random() - 0.5) * 2 * spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const len = Math.hypot(vx, vy, vz) || 1;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = (vx / len) * sp; this.vel[i * 3 + 1] = (vy / len) * sp + up * Math.random(); this.vel[i * 3 + 2] = (vz / len) * sp;
      this.life[i] = life * (0.5 + Math.random() * 0.8);
      this.str[i] = stretch; this.size[i] = size;
      if (base) { this.vel[i * 3] += base.x; this.vel[i * 3 + 1] += base.y; this.vel[i * 3 + 2] += base.z; }
      const col = _c.set(color);
      if (color === 0xffb040) col.offsetHSL((Math.random() - 0.5) * 0.06, 0, Math.random() * 0.2);
      this.mesh.setColorAt(i, col);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      this.vel[k + 1] -= 14 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.03) { this.pos[k + 1] = 0.03; this.vel[k + 1] *= -0.35; this.vel[k] *= 0.6; this.vel[k + 2] *= 0.6; }
      _dir.set(this.vel[k], this.vel[k + 1], this.vel[k + 2]);
      const sp = _dir.length();
      if (sp > 0.001) _q.setFromUnitVectors(_zAxis, _dir.multiplyScalar(1 / sp));
      const sc = Math.min(1, this.life[i] * 3) * this.size[i];
      _m.compose(_p.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), _q, _s.set(sc, sc, sc * (0.6 + Math.min(sp * 0.12, 1.6) * this.str[i])));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Bremsspuren: ein Ringpuffer aus flachen Vierecken knapp über dem Asphalt.
export class Skids {
  constructor(scene, maxQuads = 5000) {
    this.max = maxQuads;
    this.positions = new Float32Array(maxQuads * 6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ color: 0x15151a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.cursor = 0;
    this.dirty = false;
  }
  // a/b: vorige Punkte links/rechts, c/d: neue Punkte links/rechts
  addQuad(ax, az, bx, bz, cx, cz, dx, dz, y0 = 0.045, y1 = y0) {
    const o = this.cursor * 18;
    const P = this.positions;
    P[o] = ax; P[o + 1] = y0; P[o + 2] = az;
    P[o + 3] = cx; P[o + 4] = y1; P[o + 5] = cz;
    P[o + 6] = bx; P[o + 7] = y0; P[o + 8] = bz;
    P[o + 9] = bx; P[o + 10] = y0; P[o + 11] = bz;
    P[o + 12] = cx; P[o + 13] = y1; P[o + 14] = cz;
    P[o + 15] = dx; P[o + 16] = y1; P[o + 17] = dz;
    this.cursor = (this.cursor + 1) % this.max;
    this.dirty = true;
  }
  clear() { this.positions.fill(0); this.cursor = 0; this.dirty = true; }
  update() {
    if (!this.dirty) return;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.dirty = false;
  }
}

// Karosserie-Splitter: kleine Low-Poly-Brocken mit Schwerkraft, bleiben eine Weile liegen
export class Chunks {
  constructor(scene, groundY, max = 600) {
    this.max = max;
    this.groundY = groundY;
    const geo = new THREE.TetrahedronGeometry(0.14, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.5, metalness: 0.3 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3); this.spin = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.size = new Float32Array(max); this.rest = new Uint8Array(max);
    this.cursor = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, _c.set(0xffffff)); }
  }
  burst(p, n, { dir = null, speed = 6, colors = [0x888888], size = 1 } = {}) {
    for (let j = 0; j < n; j++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.4; this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.3; this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.4;
      const sp = speed * (0.3 + Math.random() * 0.9);
      let vx = (Math.random() - 0.5) * 2, vy = Math.random() * 1.2 + 0.3, vz = (Math.random() - 0.5) * 2;
      if (dir) { vx += dir.x * 1.5; vy += dir.y; vz += dir.z * 1.5; }
      const l = Math.hypot(vx, vy, vz) || 1;
      this.vel[i * 3] = (vx / l) * sp; this.vel[i * 3 + 1] = (vy / l) * sp + 2; this.vel[i * 3 + 2] = (vz / l) * sp;
      for (let k = 0; k < 3; k++) { this.rot[i * 3 + k] = Math.random() * 6; this.spin[i * 3 + k] = (Math.random() - 0.5) * 22; }
      this.life[i] = 9 + Math.random() * 6;
      this.size[i] = size * (0.5 + Math.random() * 1.3);
      this.rest[i] = 0;
      this.mesh.setColorAt(i, _c.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      if (!this.rest[i]) {
        this.vel[k + 1] -= 13 * dt;
        this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
        for (let a = 0; a < 3; a++) this.rot[k + a] += this.spin[k + a] * dt;
        const gy = this.groundY(this.pos[k], this.pos[k + 2]) + 0.05 * this.size[i];
        if (this.pos[k + 1] < gy) {
          this.pos[k + 1] = gy;
          this.vel[k + 1] *= -0.3; this.vel[k] *= 0.55; this.vel[k + 2] *= 0.55;
          for (let a = 0; a < 3; a++) this.spin[k + a] *= 0.5;
          if (Math.abs(this.vel[k + 1]) < 0.8 && Math.hypot(this.vel[k], this.vel[k + 2]) < 0.6) this.rest[i] = 1;
        }
      }
      const sc = this.size[i] * Math.min(1, this.life[i] * 0.6);
      _q.setFromEuler(_e.set(this.rot[k], this.rot[k + 1], this.rot[k + 2]));
      _m.compose(_p.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), _q, _s.set(sc, sc * 0.45, sc * 1.2));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Auspuffflamme: zwei additive Kegel (heißer blauweißer Kern + orange Flamme) mit Flacker-Shader
const flameVert = `
  attribute float aT;
  uniform float uTime; uniform float uSeed;
  varying float vT; varying vec2 vUv;
  void main() {
    vUv = uv; vT = aT;
    vec3 p = position;
    float n = sin(uTime * 63.0 + aT * 13.0 + uSeed) * 0.5 + 0.5;
    p.xy *= 1.0 + 0.35 * n * aT;
    p.x += sin(uTime * 47.0 + aT * 9.0 + uSeed * 2.0) * 0.05 * aT;
    p.y += cos(uTime * 41.0 + aT * 7.0 + uSeed) * 0.04 * aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const flameFrag = `
  uniform float uTime; uniform float uSeed; uniform float uIntensity; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
  varying float vT; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float flick = 0.7 + 0.3 * hash(vec2(floor(uTime * 45.0), uSeed));
    vec3 col = mix(uA, uB, smoothstep(0.0, 0.45, vT));
    col = mix(col, uC, smoothstep(0.45, 1.0, vT));
    float streak = hash(vec2(floor(vUv.x * 12.0), floor((vUv.y - uTime * 9.0) * 5.0)));
    float edge = 1.0 - smoothstep(0.15, 1.0, vT);
    float a = edge * (0.65 + 0.35 * streak) * flick * uIntensity;
    gl_FragColor = vec4(col * a * 1.6, a);
  }`;
function flameLayer(r, h, a, b, c, boost = 1, additive = false) {
  const geo = new THREE.ConeGeometry(r, h, 12, 8, true);
  const pos = geo.attributes.position;
  const t = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) t[i] = pos.getY(i) / h + 0.5;
  geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  geo.rotateX(Math.PI / 2).translate(0, 0, h / 2);
  // Flammenkörper deckend (sichtbar auch vor hellem Asphalt), Kern additiv (Glühen)
  const frag = additive
    ? flameFrag.replace('col * a * 1.6', `col * a * ${(0.9 * boost).toFixed(2)}`)
    : flameFrag.replace('gl_FragColor = vec4(col * a * 1.6, a);', `gl_FragColor = vec4(col * ${(1.1 * boost).toFixed(2)}, min(1.0, a * 1.1));`);
  const mat = new THREE.ShaderMaterial({
    vertexShader: flameVert, fragmentShader: frag, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uSeed: { value: Math.random() * 100 }, uIntensity: { value: 0 }, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uC: { value: new THREE.Color(c) } },
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}
let glowTex = null;
function getGlowTex() {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext && cv.getContext('2d');
  if (!x) return null;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.18, 'rgba(255,200,110,0.9)'); g.addColorStop(0.45, 'rgba(255,110,30,0.35)'); g.addColorStop(1, 'rgba(255,60,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}
export function createFlame() {
  const g = new THREE.Group();
  const outer = flameLayer(0.14, 1.35, 0xffb040, 0xff5a0c, 0xa01a04, 1.0, false);
  const mid = flameLayer(0.09, 0.95, 0xfff0b0, 0xffb030, 0xff6010, 1.05, false);
  const core = flameLayer(0.05, 0.36, 0xe0ecff, 0x4a80ff, 0xffa040, 1.6, true);
  outer.renderOrder = 5; mid.renderOrder = 6; core.renderOrder = 7;
  g.add(outer, mid, core);
  const tex = getGlowTex();
  if (tex) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    spr.position.z = 0.05;
    g.add(spr);
    g.userData.glow = spr;
  }
  g.visible = false;
  g.userData.layers = [outer, mid, core];
  return g;
}
export function updateFlame(g, intensity, time) {
  g.visible = intensity > 0.03;
  if (!g.visible) return;
  const flick = 0.85 + Math.random() * 0.3;
  const len = (0.55 + intensity * 1.0) * flick;
  const wid = 0.85 + intensity * 0.45;
  g.scale.set(wid, wid, len);
  for (const l of g.userData.layers) { l.material.uniforms.uTime.value = time; l.material.uniforms.uIntensity.value = Math.min(1, intensity * 1.1); }
  const glow = g.userData.glow;
  if (glow) {
    const sz = (0.3 + intensity * 0.5) * flick;
    glow.scale.set(sz / wid, sz / wid, 1);
    glow.material.opacity = Math.min(0.55, intensity * 0.5);
    glow.material.color.setRGB(1.0, 0.62, 0.3);
  }
}

export class FX {
  constructor(scene, groundY = () => 0) {
    this.smoke = new Smoke(scene);
    this.sparks = new Sparks(scene);
    this.skids = new Skids(scene);
    this.chunks = new Chunks(scene, groundY);
    this.shake = 0;
  }
  update(dt) {
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.skids.update();
    this.chunks.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}
