// ---------------------------------------------------------------------------
// Power-ups: Kisten auf der Strecke, Zufallsgewinn nach Platzierung, Effekte
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createFlame, updateFlame } from './fx.js';
import { OilFx, BlastFx, SmokeWall, Bolt, buildSpikeStrip, buildRamp, rampHull, RAMP } from './itemfx.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const ITEMS = {
  nitro: { name: 'Nitro', hint: 'Kurzer, brutaler Schub' },
  jump: { name: 'Sprung', hint: 'Spring über Gegner und Hindernisse' },
  rocket: { name: 'Rakete', hint: 'Sucht sich das Auto vor dir' },
  barrel: { name: 'Sprengfass', hint: 'Fallen lassen – explodiert bei Kontakt' },
  oil: { name: 'Ölfleck', hint: 'Lässt Verfolger schleudern' },
  shock: { name: 'Schockwelle', hint: 'Schleudert alle Autos in der Nähe weg' },
  armor: { name: 'Stahlpanzer', hint: '7 s unzerstörbar, Rammen tut doppelt weh' },
  repair: { name: 'Reparatur', hint: 'Auto wieder wie neu' },
  smoke: { name: 'Nebelwand', hint: 'Dichter Rauch hinter dir – Verfolger sehen nichts' },
  spikes: { name: 'Nagelband', hint: 'Plattfuß für jeden, der drüberfährt' },
  ramp: { name: 'Rampe', hint: 'Sprungschanze hinter dir abstellen' },
  ram: { name: 'Rammbock', hint: 'Nächster Crash: dreifacher Schaden beim Gegner' },
  magnet: { name: 'Magnet', hint: 'Zieht dich an den Vordermann heran' },
  emp: { name: 'EMP-Blitz', hint: 'Alle vor dir verlieren kurz die Motorleistung' },
  ghost: { name: 'Geist', hint: '4 s durch Autos und Fässer fahren' },
};
export const ITEM_ORDER = Object.keys(ITEMS);

// Gewichte nach Platz: vorne eher Verteidigung, hinten eher Aufholen
const WEIGHTS = [
  { oil: 3, barrel: 3, spikes: 3, smoke: 2, jump: 2, armor: 2, ramp: 1, nitro: 1, shock: 1, ghost: 1 },
  { nitro: 3, rocket: 2, oil: 2, barrel: 2, spikes: 2, smoke: 2, jump: 2, shock: 2, ram: 2, armor: 1, repair: 1, magnet: 1, ramp: 1, ghost: 1 },
  { nitro: 4, rocket: 3, magnet: 3, emp: 2, ram: 2, shock: 2, repair: 2, ghost: 2, armor: 1, jump: 1 },
];

function boxTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext && cv.getContext('2d');
  if (x) {
    const g = x.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, '#ffd23e'); g.addColorStop(0.5, '#ff5fa2'); g.addColorStop(1, '#5aa8ff');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.lineWidth = 10; x.strokeStyle = 'rgba(255,255,255,0.85)'; x.strokeRect(5, 5, 118, 118);
    x.font = '88px "Lilita One", "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 12; x.strokeStyle = '#23264a'; x.strokeText('?', 64, 70);
    x.fillStyle = '#ffffff'; x.fillText('?', 64, 70);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Items {
  constructor(game, track, { enabled = true, arena = null } = {}) {
    this.g = game;
    this.track = track;
    this.enabled = enabled;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.boxes = [];
    this.hazards = [];
    this.rockets = [];
    this.rings = [];
    this.events = [];
    this.time = 0;
    this.seq = 0;
    this.owned = () => true; // im Mehrspieler: nur eigene Autos lösen Effekte aus
    this.emit = null; // im Mehrspieler: Ereignis an die anderen schicken
    if (!enabled) return;
    // Kistenreihen an ruhigen Stellen der Strecke
    const N = track.N, W = track.width;
    const tex = boxTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.35, transparent: true, opacity: 0.92 });
    const geo = new THREE.BoxGeometry(1.25, 1.25, 1.25);
    // Derby-Arena: zwei Kistenringe in der Arena statt Reihen an der Strecke
    const addBox = (p, phase) => { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.position.copy(p); this.group.add(mesh); this.boxes.push({ pos: p, mesh, off: 0, phase }); };
    if (arena) {
      for (const [n, rf] of [[5, 0.32], [8, 0.68]]) for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rf * 3;
        const p = new THREE.Vector3(arena.x + Math.cos(a) * arena.r * rf, 0, arena.z + Math.sin(a) * arena.r * rf);
        p.y = track.heightAt(p.x, p.z) + 1.15;
        addBox(p, k * 0.9);
      }
    }
    for (const f of arena ? [] : [0.17, 0.41, 0.63, 0.86]) {
      let best = Math.round(f * N), bc = 9;
      for (let d = -50; d <= 50; d += 5) {
        const i = (Math.round(f * N) + d + N) % N;
        let c = 0; for (let k = -15; k <= 15; k += 5) c += Math.abs(track.curv[(i + k + N) % N]);
        if (c < bc) { bc = c; best = i; }
      }
      const cols = W > 14 ? 5 : 4;
      for (let k = 0; k < cols; k++) {
        const off = (k - (cols - 1) / 2) * ((W - 4) / (cols - 1));
        const p = track.pts[best].clone().addScaledVector(track.side[best], off);
        p.y = track.heightAt(p.x, p.z) + 1.15;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.position.copy(p);
        this.group.add(mesh);
        this.boxes.push({ pos: p, mesh, off: 0, phase: k * 0.7 + best });
      }
    }
    this.matBarrel = new THREE.MeshStandardMaterial({ color: 0xd9322b, flatShading: true, roughness: 0.5 });
    this.matStripe = new THREE.MeshStandardMaterial({ color: 0xffd23e, flatShading: true, roughness: 0.5 });
    this.matBlink = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 0 });
    this.matOil = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, envMap: game.envMap, envMapIntensity: 1.2 });
    this.matRocket = new THREE.MeshStandardMaterial({ color: 0xf2efe8, flatShading: true, roughness: 0.4, metalness: 0.3 });
    this.matFin = new THREE.MeshStandardMaterial({ color: 0xd9322b, flatShading: true });
    this.oilFx = new OilFx(this.group, track, game.envMap);
    this.blastFx = new BlastFx(this.group, track, game);
    this.smokeWall = new SmokeWall(this.group, track);
    this.beams = new Map();      // Magnet-Strahlen je Auto
    this.bolts = [];             // EMP-Blitze
  }

  // Zufallsgewinn; rankFrac: 0 = Führender, 1 = Letzter
  roll(rankFrac, car) {
    const w = { ...WEIGHTS[rankFrac < 0.34 ? 0 : rankFrac < 0.67 ? 1 : 2] };
    const st = car.stats;
    if (st.body < 60 || st.engine < 60) w.repair = (w.repair || 0) + 3;
    else if (st.body > 92) delete w.repair;
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    let r = Math.random() * tot;
    for (const [k, v] of Object.entries(w)) if ((r -= v) <= 0) return k;
    return 'nitro';
  }

  // cars: [{car, rankFrac, isPlayer}]
  update(dt, cars) {
    this.time += dt;
    const t = this.time;
    // Kisten: drehen, schweben, einsammeln
    for (const b of this.boxes) {
      if (b.off > 0) { b.off -= dt; b.mesh.visible = b.off <= 0; if (b.off <= 0) b.mesh.scale.setScalar(0.01); }
      if (b.mesh.visible) {
        b.mesh.rotation.set(t * 0.9 + b.phase, t * 1.3 + b.phase, 0);
        b.mesh.position.y = b.pos.y + Math.sin(t * 2.2 + b.phase) * 0.15;
        const sc = b.mesh.scale.x; if (sc < 1) b.mesh.scale.setScalar(Math.min(1, sc + dt * 3));
      }
      if (b.off > 0) continue;
      for (const c of cars) {
        if (!this.owned(c.car)) continue;
        const p = c.car.body.translation();
        if (Math.abs(p.x - b.pos.x) > 2.3 || Math.abs(p.z - b.pos.z) > 2.3 || Math.abs(p.y - b.pos.y) > 3) continue;
        this.hideBox(this.boxes.indexOf(b));
        this.emit?.({ type: 'box', i: this.boxes.indexOf(b) });
        if (!c.car.item) {
          c.car.item = this.roll(c.rankFrac, c.car);
          c.car.itemRoll = c.isPlayer ? 1.1 : 0;
        }
        this.events.push({ type: 'pickup', car: c.car });
        break;
      }
    }
    for (const c of cars) if (c.car.itemRoll > 0) { c.car.itemRoll = Math.max(0, c.car.itemRoll - dt); if (c.car.itemRoll === 0) this.events.push({ type: 'rolled', car: c.car }); }

    this.oilFx?.update(dt);
    this.blastFx?.update(dt);
    this.smokeWall?.update(dt);
    this.updateBeams(dt, cars);
    // Gefahren: Ölflecken + Sprengfässer
    for (let k = this.hazards.length - 1; k >= 0; k--) {
      const h = this.hazards[k];
      h.age += dt;
      if (h.type === 'oil') {
        // Lache läuft erst aus und breitet sich aus
        const gr = 1 - Math.pow(1 - clamp((h.age - 0.12) / 1.1, 0, 1), 3);
        h.grow = gr;
        const sc = 0.06 + 0.94 * gr;
        h.mesh.scale.set(sc, 1, sc);
        if (h.mesh.userData.film) h.mesh.userData.film.material.opacity = 0.8 * clamp((h.life - h.age) / 3, 0, 1) * (0.75 + 0.25 * Math.sin(t * 1.7 + h.pos.x));
      }
      if (h.type === 'barrel') {
        this.matBlink.emissiveIntensity = Math.sin(t * 12) > 0 ? 4 : 0;
        h.mesh.rotation.y += dt * 0.4;
      }
      if (h.type === 'oil') h.mesh.material.opacity = 0.92 * clamp((h.life - h.age) / 3, 0, 1);
      if (h.type === 'ramp' && h.age > h.life - 1.4) {
        // versinkt am Ende im Boden
        const k = (h.age - (h.life - 1.4)) / 1.4;
        h.mesh.position.y = h.pos.y - k * (RAMP.h + 0.3);
        if (h.body && k > 0.3) { this.g.world.removeRigidBody(h.body); h.body = null; }
      }
      if (h.type === 'spikes') h.mesh.position.y = h.pos.y + Math.min(0, (h.age - 0.25) * 0.4);
      let gone = h.age > h.life;
      if (!gone && h.age > 0.45 && h.type !== 'ramp') {
        for (const c of cars) {
          if (!this.owned(c.car)) continue;
          if (c.car.ghostT > 0) continue;          // Geister fahren durch alles hindurch
          if (c.car === h.owner && h.age < 1.6) continue;
          if (h.type === 'spikes') {
            if (h.hit.has(c.car)) continue;
            const p = c.car.body.translation();
            const dx = p.x - h.pos.x, dz = p.z - h.pos.z, cy = Math.cos(h.yaw), sy = Math.sin(h.yaw);
            const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;   // ins Nagelband-System drehen
            if (Math.abs(lx) < h.w / 2 + 0.4 && Math.abs(lz) < 0.9 + c.car.p.dims.l * 0.1 && Math.abs(p.y - h.pos.y) < 2) {
              h.hit.add(c.car);
              c.car.flatT = 6;
              this.events.push({ type: 'spiked', car: c.car });
              this.g.fx.sparks.burst(new THREE.Vector3(p.x, h.pos.y + 0.2, p.z), 24, { speed: 6, spread: 1, life: 0.5 });
            }
            continue;
          }
          const p = c.car.body.translation();
          const d = Math.hypot(p.x - h.pos.x, p.z - h.pos.z);
          if (Math.abs(p.y - h.pos.y) > 2.5) continue;
          if (h.type === 'oil' && d < h.r * Math.max(0.35, h.grow ?? 1)) {
            if (c.car.oilT <= 0) { c.car.spinDir = Math.random() < 0.5 ? -1 : 1; this.events.push({ type: 'oil', car: c.car }); }
            c.car.oilT = 1.5;
          }
          if (h.type === 'barrel' && d < 2.6) { this.explode(h.pos, 7, 1.15, h.owner); this.emit?.({ type: 'boom', hz: h.id, pos: [h.pos.x, h.pos.y, h.pos.z], r: 7, k: 1.15 }); gone = true; break; }
        }
      }
      if (gone) { this.group.remove(h.mesh); if (h.body) this.g.world.removeRigidBody(h.body); this.hazards.splice(k, 1); }
    }

    // Raketen
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      r.age += dt;
      let aim = null;
      if (r.target && !r.target.disposed && r.target.ghostT <= 0) { const q = r.target.body.translation(); aim = new THREE.Vector3(q.x, q.y + 0.2, q.z); }
      else {
        // ohne Ziel: der Strecke folgen
        const n = this.track.nearest(r.pos.x, r.pos.z, 2);
        if (n.i >= 0) { const j = (n.i + 25) % this.track.N; aim = this.track.pts[j].clone(); aim.y += 1.2; }
      }
      if (aim) {
        const want = aim.sub(r.pos).normalize();
        r.dir.lerp(want, Math.min(1, dt * (r.age < 0.3 ? 2 : 6))).normalize();
      }
      r.pos.addScaledVector(r.dir, r.speed * dt);
      const gy = this.track.heightAt(r.pos.x, r.pos.z) + 0.5;
      if (r.pos.y < gy) r.pos.y += (gy - r.pos.y) * Math.min(1, dt * 10);
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.dir);
      updateFlame(r.flame, 0.8 + Math.random() * 0.2, t);
      r.smokeAcc += dt * 40;
      while (r.smokeAcc > 1) {
        r.smokeAcc -= 1;
        const b = r.pos.clone().addScaledVector(r.dir, -0.7);
        this.g.fx.smoke.emit(b.x, b.y, b.z, (Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6, { color: 0xd8d8d8, size0: 0.3, size1: 1.4, life: 0.9, rise: 0.4 });
      }
      let hit = false;
      for (const c of cars) {
        if (!this.owned(c.car)) continue;
        if (c.car === r.owner && r.age < 0.5) continue;
        if (c.car.ghostT > 0) continue;   // Raketen fliegen durch Geister
        const p = c.car.body.translation();
        if (Math.hypot(p.x - r.pos.x, p.y - r.pos.y, p.z - r.pos.z) < 2.4) { hit = true; break; }
      }
      if (hit || r.age > 5.5) {
        this.explode(r.pos, 5.5, hit ? 1.0 : 0.6, r.owner);
        if (hit) this.emit?.({ type: 'boom', rk: r.id, pos: [r.pos.x, r.pos.y, r.pos.z], r: 5.5, k: 1.0 });
        this.group.remove(r.mesh);
        this.rockets.splice(k, 1);
      }
    }

    // Schockwellen-Ringe
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.age += dt;
      const e = r.age / 0.55;
      r.mesh.scale.setScalar(1 + e * r.max);
      r.mesh.material.opacity = Math.max(0, 0.85 * (1 - e));
      if (e >= 1) { this.group.remove(r.mesh); this.rings.splice(k, 1); }
    }

    // Panzer-Leuchten
    for (const c of cars) {
      const car = c.car;
      const on = car.armorT > 0;
      if (on || car._armorGlow) {
        const pulse = on ? 0.35 + Math.sin(t * 10) * 0.2 + (car.armorT < 1.5 ? Math.sin(t * 30) * 0.2 : 0) : 0;
        car.mats.paint.emissive.setRGB(1, 0.75, 0.25);
        car.mats.paint.emissiveIntensity = pulse;
        car._armorGlow = on;
      }
    }
  }

  // Explosion: Stoß + Schaden für alle Autos im Radius
  explode(pos, radius, power, owner) {
    const fx = this.g.fx;
    fx.sparks.burst(pos, 60, { speed: 14, spread: 1, life: 0.9 });
    fx.chunks.burst(pos, 14, { dir: new THREE.Vector3(0, 1, 0), speed: 8, colors: [0x2a2a2a, 0x555555, 0xd9322b] });
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      fx.smoke.emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s,
        { color: k < 9 ? 0xff9a3a : 0x3a3633, size0: 0.8, size1: 3.6 + Math.random() * 2, life: k < 9 ? 0.5 : 1.8 + Math.random(), rise: 1.2 });
    }
    this.events.push({ type: 'boom', pos: pos.clone(), power });
    this.flash(pos, 0xff8a2a, radius * 0.9);
    this.blastFx?.blast(pos, radius);
    for (const car of this.g.cars?.() || []) {
      if (!this.owned(car) || car.ghostT > 0) continue;
      const p = car.body.translation();
      const d = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z);
      if (d > radius) continue;
      const k = (1 - d / radius) * power;
      const m = car.p.mass;
      const dir = new THREE.Vector3(p.x - pos.x, 0, p.z - pos.z);
      if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize();
      car.body.applyImpulse({ x: dir.x * m * 5 * k, y: m * (6.5 * k + 1.5), z: dir.z * m * 5 * k }, true);
      car.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 2.5 * k, y: (Math.random() - 0.5) * m * 6 * k, z: (Math.random() - 0.5) * m * 2.5 * k }, true);
      const hitP = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(dir, -car.p.dims.w * 0.5);
      car.applyImpact(hitP, dir, 6 + 13 * k);
      this.events.push({ type: 'hit', car, by: owner, kind: 'boom' });
    }
  }

  flash(pos, color, size) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    mesh.position.copy(pos);
    mesh.position.y += 0.4;
    this.group.add(mesh);
    this.rings.push({ mesh, age: 0, max: size });
  }

  hideBox(i) {
    const b = this.boxes[i];
    if (!b || b.off > 0) return;
    b.off = 3.2; b.mesh.visible = false;
    this.g.fx.sparks.burst(b.pos, 22, { speed: 7, spread: 1, life: 0.6 });
  }

  // ---- Erzeuger (lokal und für Ereignisse anderer Spieler)
  spawnOil(pos, id, owner) {
    const r = 3.6;
    const mesh = this.oilFx.puddle(pos, r, this.matOil.clone());
    mesh.position.copy(pos).y += 0.07;
    this.group.add(mesh);
    this.oilFx.stream(owner, 0.65);   // Öl spritzt aus dem Heck
    this.hazards.push({ type: 'oil', id, pos: pos.clone(), r, mesh, age: 0, life: 22, owner });
  }
  spawnBarrel(pos, id, owner) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10), this.matBarrel);
    body.position.y = 0.55; body.castShadow = true;
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.14, 10), this.matStripe); s1.position.y = 0.75;
    const s2 = s1.clone(); s2.position.y = 0.35;
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.matBlink); blink.position.y = 1.16;
    grp.add(body, s1, s2, blink);
    grp.position.copy(pos);
    this.group.add(grp);
    this.hazards.push({ type: 'barrel', id, pos: pos.clone().setY(pos.y + 0.6), mesh: grp, age: 0, life: 45, owner });
    while (this.hazards.filter((h) => h.type === 'barrel').length > 8) { const old = this.hazards.find((h) => h.type === 'barrel'); this.group.remove(old.mesh); this.hazards.splice(this.hazards.indexOf(old), 1); }
  }
  spawnRocket(start, dir, speed, owner, target, id) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8).rotateX(Math.PI / 2), this.matRocket);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8).rotateX(Math.PI / 2), this.matFin); nose.position.z = 0.75;
    grp.add(body, nose);
    for (let k = 0; k < 4; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.3), this.matFin);
      fin.position.set(0, 0, -0.42); fin.rotation.z = (k * Math.PI) / 2; fin.translateY(0.2);
      grp.add(fin);
    }
    const flame = createFlame();
    flame.rotation.y = Math.PI; flame.position.z = -0.6;
    flame.scale.setScalar(0.8);
    grp.add(flame);
    grp.position.copy(start);
    this.group.add(grp);
    this.rockets.push({ id, pos: start.clone(), dir: dir.clone().normalize(), speed, mesh: grp, flame, age: 0, owner, target, smokeAcc: 0 });
  }
  shockAt(pos, owner) {
    this.blastFx.shock(pos, 16);
    for (const o of this.g.cars?.() || []) {
      if (o === owner || !this.owned(o)) continue;
      const p = o.body.translation();
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d > 16 || Math.abs(p.y - pos.y) > 4) continue;
      const k = 1 - d / 16;
      const dir = new THREE.Vector3(p.x - pos.x, 0, p.z - pos.z).normalize();
      const om = o.p.mass;
      o.body.applyImpulse({ x: dir.x * om * (4 + 10 * k), y: om * (2.5 + 3 * k), z: dir.z * om * (4 + 10 * k) }, true);
      o.body.applyTorqueImpulse({ x: 0, y: (Math.random() - 0.5) * om * 5 * k, z: 0 }, true);
      o.applyImpact(new THREE.Vector3(p.x, p.y, p.z).addScaledVector(dir, -o.p.dims.w * 0.5), dir, 5 + 9 * k);
      this.events.push({ type: 'hit', car: o, by: owner, kind: 'shock' });
    }
    this.g.fx.sparks.burst(pos, 30, { speed: 12, spread: 1, life: 0.45, color: 0x9fe4ff });
  }

  // Power-up einsetzen; ahead: Auto direkt vor dem Nutzer (Raketenziel)
  spawnSpikes(pos, yaw, id, owner) {
    const w = 4.6;
    const mesh = buildSpikeStrip(w);
    mesh.position.copy(pos); mesh.position.y -= 0.25; mesh.rotation.y = yaw;
    // dem Gelände folgen (leicht kippen)
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const hl = this.track.heightAt(pos.x - fx * w / 2, pos.z - fz * w / 2), hr = this.track.heightAt(pos.x + fx * w / 2, pos.z + fz * w / 2);
    mesh.rotation.z = Math.atan2(hr - hl, w);
    this.group.add(mesh);
    this.hazards.push({ type: 'spikes', id, mesh, pos: pos.clone(), yaw, w, owner, age: 0, life: 25, hit: new Set() });
  }
  spawnRamp(pos, yaw, id, owner) {
    const mesh = buildRamp();
    mesh.position.copy(pos); mesh.rotation.y = yaw;
    // Neigung des Geländes in Fahrtrichtung übernehmen
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const hf = this.track.heightAt(pos.x + fx * RAMP.l / 2, pos.z + fz * RAMP.l / 2), hb = this.track.heightAt(pos.x - fx * RAMP.l / 2, pos.z - fz * RAMP.l / 2);
    mesh.rotation.x = Math.atan2(hf - hb, RAMP.l);
    this.group.add(mesh);
    mesh.updateMatrixWorld(true);
    const R = this.g.RAPIER;
    const q = mesh.quaternion;
    const body = this.g.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y - 0.02, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    const col = R.ColliderDesc.convexHull(rampHull());
    if (col) { col.setFriction(0.9); this.g.world.createCollider(col, body); }
    this.hazards.push({ type: 'ramp', id, mesh, body, pos: pos.clone(), yaw, owner, age: 0, life: 22 });
  }
  // EMP trifft ein Auto: Motor kurz tot, Nitro weg (nur das eigene Auto wird verändert)
  empHit(car, by) {
    const t = car.root.position;
    this.bolts.push({ bolt: new Bolt(this.group, 0x8fd0ff, 0.5, 14), car, age: 0, dur: 0.45, sky: new THREE.Vector3(t.x + (Math.random() - 0.5) * 6, t.y + 26, t.z + (Math.random() - 0.5) * 6) });
    this.g.fx.sparks.burst(t.clone().setY(t.y + 0.8), 30, { speed: 6, spread: 1, life: 0.5, color: 0x9fdcff });
    if (car.ghostT > 0) return;
    if (this.owned(car)) { car.empT = 2.2; car.nitro = 0; car.miniTurbo = 0; }
    this.events.push({ type: 'emp', car, by });
  }
  updateBeams(dt, cars) {
    const cam = this.g.camera?.position || new THREE.Vector3(0, 50, 0);
    // Magnet: Strahl vom Auto zum Ziel
    for (const c of this.g.cars?.() || []) {
      let b = this.beams.get(c);
      const on = c.magnetT > 0 && c.magnetTarget && !c.magnetTarget.disposed;
      if (on) {
        if (!b) { b = { a: new Bolt(this.group, 0xc69bff, 0.45, 18), b: new Bolt(this.group, 0x7fd6ff, 0.22, 18) }; this.beams.set(c, b); }
        const p1 = c.root.position.clone(), p2 = c.magnetTarget.root.position.clone();
        p1.y += 0.8; p2.y += 0.8;
        const op = Math.min(1, c.magnetT * 3);
        b.a.set(p1, p2, cam, 1.2, op * 0.9); b.b.set(p1, p2, cam, 0.7, op);
      } else if (b) { b.a.dispose(); b.b.dispose(); this.beams.delete(c); }
    }
    // EMP-Blitze aus dem Himmel
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const e = this.bolts[k];
      e.age += dt;
      const t = e.car.root.position.clone(); t.y += 0.6;
      const op = e.age < e.dur ? (Math.random() < 0.75 ? 1 : 0.25) : 0;
      e.bolt.set(e.sky, t, cam, 4, op);
      if (e.age > e.dur) { e.bolt.dispose(); this.bolts.splice(k, 1); }
    }
  }
  // Dichte der Nebelwand an einem Punkt (für Bots und den Sicht-Schleier)
  smokeAt(p) { return this.smokeWall ? this.smokeWall.density(p) : 0; }
  use(car, ahead = null, aheadAll = []) {
    const it = car.item;
    if (!it || car.itemRoll > 0) return null;
    car.item = null;
    const b = car.body;
    const t = b.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(car.root.quaternion);
    const flatF = fwd.clone().setY(0).normalize();
    const behind = pos.clone().addScaledVector(flatF, -(car.p.dims.l / 2 + 1.6));
    behind.y = this.track.heightAt(behind.x, behind.z);
    const id = (car.netId || 'x') + ':' + ++this.seq;
    const ev = { type: 'use', id: car.netId, item: it, hid: id };
    if (it === 'nitro') car.nitro = 2.6;
    else if (it === 'jump') {
      const v = b.linvel();
      b.setLinvel({ x: v.x + flatF.x * 2.5, y: Math.max(v.y, 0) + 8.8, z: v.z + flatF.z * 2.5 }, true);
      const a = b.angvel();
      b.setAngvel({ x: 0, y: a.y * 0.5, z: 0 }, true);
      this.g.fx.smoke.emit(t.x, t.y - 0.4, t.z, 0, 0.5, 0, { color: 0xeeeeee, size0: 1, size1: 3, life: 0.7, rise: 0.2 });
    } else if (it === 'oil') { this.spawnOil(behind, id, car); ev.pos = [behind.x, behind.y, behind.z]; }
    else if (it === 'barrel') { this.spawnBarrel(behind, id, car); ev.pos = [behind.x, behind.y, behind.z]; }
    else if (it === 'rocket') {
      const start = pos.clone().addScaledVector(flatF, car.p.dims.l / 2 + 1.2); start.y += 0.6;
      const v = b.linvel();
      const speed = Math.max(62, Math.hypot(v.x, v.z) + 34);
      this.spawnRocket(start, flatF, speed, car, ahead, id);
      Object.assign(ev, { pos: [start.x, start.y, start.z], dir: [flatF.x, flatF.y, flatF.z], speed, target: ahead?.netId || null });
    } else if (it === 'shock') { this.shockAt(pos, car); ev.pos = [pos.x, pos.y, pos.z]; }
    else if (it === 'armor') car.armorT = 7;
    else if (it === 'smoke') this.smokeWall.start(car, 2.4);
    else if (it === 'spikes') {
      const yaw = Math.atan2(-flatF.x, -flatF.z);
      this.spawnSpikes(behind, yaw, id, car); Object.assign(ev, { pos: [behind.x, behind.y, behind.z], yaw });
    } else if (it === 'ramp') {
      const yaw = Math.atan2(-flatF.x, -flatF.z);
      const rp = pos.clone().addScaledVector(flatF, -(car.p.dims.l / 2 + RAMP.l / 2 + 2.2));
      rp.y = this.track.heightAt(rp.x, rp.z);
      this.spawnRamp(rp, yaw, id, car); Object.assign(ev, { pos: [rp.x, rp.y, rp.z], yaw });
    } else if (it === 'ram') car.ramT = 10;
    else if (it === 'magnet') { car.magnetT = 3.2; car.magnetTarget = ahead && ahead.ghostT <= 0 ? ahead : null; ev.target = car.magnetTarget?.netId || null; }
    else if (it === 'emp') {
      const targets = (aheadAll || []).filter((c) => c && c !== car).slice(0, 7);
      for (const tc of targets) this.empHit(tc, car);
      ev.targets = targets.map((c) => c.netId).filter(Boolean);
      this.g.fx && this.blastFx.dome(pos.clone(), 0x7fb8ff, 7, 0.4);
    } else if (it === 'ghost') car.ghostT = 4;
    this.events.push({ type: 'use', car, item: it });
    this.emit?.(ev);
    return it;
  }

  // Ereignis eines anderen Spielers nachbilden; byId: Netz-ID → Auto
  remote(e, byId) {
    const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    if (e.type === 'box') { this.hideBox(e.i); return; }
    if (e.type === 'use') {
      const car = byId(e.id);
      if (e.item === 'oil' && e.pos) this.spawnOil(V(e.pos), e.hid, car);
      else if (e.item === 'barrel' && e.pos) this.spawnBarrel(V(e.pos), e.hid, car);
      else if (e.item === 'rocket' && e.pos) this.spawnRocket(V(e.pos), V(e.dir), e.speed, car, e.target ? byId(e.target) : null, e.hid);
      else if (e.item === 'shock' && e.pos) this.shockAt(V(e.pos), car);
      else if (e.item === 'smoke' && car) this.smokeWall.start(car, 2.4);
      else if (e.item === 'spikes' && e.pos) this.spawnSpikes(V(e.pos), e.yaw, e.hid, car);
      else if (e.item === 'ramp' && e.pos) this.spawnRamp(V(e.pos), e.yaw, e.hid, car);
      else if (e.item === 'magnet' && car) { car.magnetT = 3.2; car.magnetTarget = e.target ? byId(e.target) : null; }
      else if (e.item === 'emp') { for (const id of e.targets || []) { const tc = byId(id); if (tc) this.empHit(tc, car); } if (car) this.blastFx.dome(car.root.position.clone(), 0x7fb8ff, 7, 0.4); }
      if (car) this.events.push({ type: 'use', car, item: e.item, remote: true });
      return;
    }
    if (e.type === 'boom') {
      const pos = V(e.pos);
      if (e.hz) { const h = this.hazards.find((x) => x.id === e.hz); if (!h) return; this.group.remove(h.mesh); this.hazards.splice(this.hazards.indexOf(h), 1); }
      if (e.rk) { const r = this.rockets.find((x) => x.id === e.rk); if (!r) return; this.group.remove(r.mesh); this.rockets.splice(this.rockets.indexOf(r), 1); }
      this.explode(pos, e.r || 6, e.k || 1, byId(e.id));
    }
  }

  clear() {
    for (const h of this.hazards) { this.group.remove(h.mesh); if (h.body) { try { this.g.world.removeRigidBody(h.body); } catch { /* Welt schon weg */ } h.body = null; } }
    for (const r of this.rockets) this.group.remove(r.mesh);
    for (const r of this.rings) this.group.remove(r.mesh);
    this.hazards = []; this.rockets = []; this.rings = [];
    this.oilFx?.clear(); this.blastFx?.clear(); this.smokeWall?.clear();
    for (const b of this.beams.values()) { b.a.dispose(); b.b.dispose(); } this.beams.clear();
    for (const e of this.bolts) e.bolt.dispose(); this.bolts = [];
    for (const b of this.boxes) { b.off = 0; b.mesh.visible = true; }
  }

  dispose() {
    this.clear();
    this.oilFx?.dispose(); this.blastFx?.dispose(); this.smokeWall?.dispose();
    this.g.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
