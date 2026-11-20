import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CARS, CAR_ORDER, SOUNDS } from './presets.js';
import { Car, buildCarModel, paintMesh } from './car.js';
import { buildWorld, Props, gridSlot, Track } from './world.js';
import { LEVELS, LEVEL_ORDER, THEMES } from './levels.js';
import { FX } from './fx.js';
import { GameAudio } from './audio.js';
import { Cluster, DamageView } from './hud.js';
import { Race } from './race.js';
import { BotDriver } from './bot.js';
import { Items, ITEMS, ITEM_ORDER } from './items.js';
import { ITEM_ICONS, UI_ICONS } from './icons.js';
import { Net, defaultServerUrl, packCar, unpackCar } from './net.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (t) => {
  if (t == null || !isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const BOT_NAMES = ['Turbo-Tina', 'Blech-Bernd', 'Drift-Dieter', 'Rost-Rudi', 'Schrott-Svenja', 'Vollgas-Volker', 'Kolben-Klaus', 'Delle-Dana', 'Auspuff-Anni', 'Kupplungs-Kurt', 'Nitro-Nina', 'Beule-Benno', 'Getriebe-Gerda', 'Funken-Fritz'];
const THEME_NAMES = { meadow: 'Wiese', desert: 'Wüste', snow: 'Schnee', coast: 'Küste' };

// ---------------------------------------------------------------- Einstellungen
const store = {
  load() { try { return JSON.parse(localStorage.getItem('nitrorivale') || localStorage.getItem('blechschaden') || '{}'); } catch { return {}; } }, // alter Name: Einstellungen übernehmen
  save(d) { try { localStorage.setItem('nitrorivale', JSON.stringify(d)); } catch { /* privat */ } },
};

async function main() {
  const saved = store.load();
  const cfg = Object.assign({ name: 'Fahrer ' + (10 + Math.floor(Math.random() * 89)), vol: 85, gfx: 'hoch', cam: 0, shake: 1, keys: 1, best: {}, car: null, sp: null, server: '' }, saved);
  const persist = () => store.save(cfg);
  // Mehrspieler-Zustand
  const mp = { net: null, online: false, me: null, room: null, inRace: false, raceInfo: null, waiting: false, ended: false, ghosts: new Map(), sendT: 0, pendingJoin: false };

  // ------------------------------------------------------------ Skalierung der Oberfläche
  const setScale = () => document.documentElement.style.setProperty('--s', clamp(Math.min(innerWidth / 1600, innerHeight / 900), 0.5, 1.5).toFixed(4));
  setScale();
  for (const el of $$('[data-ic]')) el.innerHTML = (el.dataset.set === 'item' ? ITEM_ICONS : UI_ICONS)[el.dataset.ic] || ITEM_ICONS[el.dataset.ic] || '';
  const setLoad = (p, msg) => { $('loadBar').style.width = Math.round(p * 100) + '%'; if (msg) $('loadMsg').textContent = msg; };
  setLoad(0.1, 'Physik wird gestartet …');
  await RAPIER.init();

  // ------------------------------------------------------------ Renderer + Bloom
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  $('stage').appendChild(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe2c9a6, 260, 1500);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4500);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a7c45, 0.85);
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.95);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 420 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.35);
  fill.position.set(0.5, 0.4, 0.7).multiplyScalar(100);
  const exhaustLight = new THREE.PointLight(0xff8a2a, 0, 9, 1.6);
  scene.add(hemi, sun, sun.target, fill, exhaustLight);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.5, 0.4, 2.0);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  function applyGfx() {
    const g = cfg.gfx;
    const pr = g === 'hoch' ? Math.min(window.devicePixelRatio, 1.75) : g === 'mittel' ? 1 : 0.75;
    renderer.setPixelRatio(pr);
    composer.setPixelRatio?.(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = g !== 'niedrig';
    sun.castShadow = g !== 'niedrig';
    const ms = g === 'hoch' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    bloom.enabled = g !== 'niedrig';
  }
  applyGfx();

  // ------------------------------------------------------------ Showroom (Podium)
  const show = new THREE.Scene();
  show.background = new THREE.Color(0x1b2a5a);
  show.fog = new THREE.Fog(0x1b2a5a, 18, 46);
  const showCam = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 100);
  showCam.position.set(-1.4, 2.25, 9.8);
  showCam.lookAt(-1.4, 0.9, 0);
  {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x223468, roughness: 0.35, metalness: 0.5, envMap, envMapIntensity: 0.35 }));
    floor.receiveShadow = true;
    show.add(floor);
    const podMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.45, metalness: 0.1 });
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.95, 0.42, 64), podMat);
    pod.position.y = 0.21;
    pod.receiveShadow = true; pod.castShadow = true;
    show.add(pod);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(3.55, 3.55, 0.03, 64), new THREE.MeshStandardMaterial({ color: 0xffc43a, roughness: 0.5 }));
    top.position.y = 0.43;
    top.receiveShadow = true;
    show.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.86, 0.05, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.3), toneMapped: false }));
    ring.position.y = 0.33;
    show.add(ring);
    for (let i = 0; i < 18; i++) {
      const a = Math.PI + (i / 17 - 0.5) * 2.2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 7, 0.12), new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? new THREE.Color(1.8, 1.0, 0.25) : new THREE.Color(0.35, 0.55, 1.4), toneMapped: false }));
      bar.position.set(Math.sin(a) * 15, 3.5, Math.cos(a) * 15);
      show.add(bar);
    }
    const key = new THREE.SpotLight(0xfff1de, 150, 30, 0.42, 0.6, 1.6);
    key.position.set(3.5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    show.add(key, key.target);
    const rimA = new THREE.PointLight(0xff9a40, 22, 14, 2); rimA.position.set(-5, 2.2, -3.5);
    const rimB = new THREE.PointLight(0x5aa8ff, 22, 14, 2); rimB.position.set(5, 2.2, -3.5);
    show.add(rimA, rimB, new THREE.HemisphereLight(0xa8b8e8, 0x1b2a5a, 0.8));
  }
  const turntable = new THREE.Group();
  turntable.position.y = 0.445;
  show.add(turntable);
  let showModel = null, outgoing = null, slide = null;
  function makeShowModel(id, color) {
    const p = CARS[id];
    const m = buildCarModel(p, color, envMap);
    for (const w of m.wheels) w.hold.position.y = -p.wheel.rest * 0.45;
    const g = new THREE.Group();
    m.root.position.y = -(m.anchorY - p.wheel.rest * 0.45 - p.wheel.r);
    m.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(m.root);
    g.userData.model = m;
    return g;
  }

  // ------------------------------------------------------------ Spielwelt (je Strecke neu)
  const GRAV = 13.2;
  const game = { RAPIER, world: null, scene, gravity: GRAV, owners: new Map(), debris: [], envMap, track: null };
  game.heightAt = (x, z) => (game.track ? game.track.heightAt(x, z) : 0);
  game.fx = new FX(scene, (x, z) => game.heightAt(x, z));
  game.cars = () => allCars();
  let eventQueue = null, level = null, props = null, items = null, race = null;
  let minimapBg = null;

  function applyTheme(T) {
    hemi.color.set(T.hemi[0]); hemi.groundColor.set(T.hemi[1]); hemi.intensity = T.hemi[2];
    sun.color.set(T.sun[0]); sun.intensity = T.sun[1];
    fill.color.set(T.fill);
    scene.fog.color.set(T.fog[0]); scene.fog.near = T.fog[1]; scene.fog.far = T.fog[2];
    renderer.toneMappingExposure = T.exposure;
  }

  async function loadLevel(id) {
    if (level && level.level.id === id) return;
    $('loading').classList.remove('hidden');
    setLoad(0.35, `Strecke „${LEVELS[id].name}“ wird gebaut …`);
    state.loading = true;
    await nextFrame();
    race = null;
    clearCars();
    removeRam();
    while (game.debris.length) removeDebris(game.debris.shift());
    items?.dispose(); items = null;
    props?.dispose(); props = null;
    level?.dispose(); level = null;
    audio?.rivalsClear();
    if (game.world) game.world.free();
    game.owners.clear();
    game.fx.skids.clear();
    game.world = new RAPIER.World({ x: 0, y: -GRAV, z: 0 });
    game.world.timestep = 1 / 120;
    eventQueue = new RAPIER.EventQueue(true);
    await nextFrame();
    level = buildWorld(game, id);
    game.track = level.track;
    game.level = level;
    applyTheme(level.theme);
    setLoad(0.85, 'Pylonen werden aufgestellt …');
    await nextFrame();
    props = new Props(game, level.track);
    minimapBg = null;
    setLoad(1);
    state.loading = false;
    await nextFrame();
    $('loading').classList.add('hidden');
  }

  // ------------------------------------------------------------ Autos
  let uid = 0;
  const spawnHeight = (preset, x, z) => game.heightAt(x, z) + preset.dims.h / 2 - 0.16 + preset.wheel.rest * 0.55 + preset.wheel.r + 0.25;
  const makeCar = (id, color, opts) => { const c = new Car(game, CARS[id], color, opts); c.uid = ++uid; return c; };
  const sel = Object.assign({ idx: 0, colors: Object.fromEntries(CAR_ORDER.map((id) => [id, CARS[id].colors[0]])), sounds: Object.fromEntries(CAR_ORDER.map((id) => [id, CARS[id].sound])) }, cfg.car || {});
  const soundOf = (id) => sel.sounds[id];
  const selId = () => CAR_ORDER[sel.idx];
  let player = null;
  let bots = []; // { car, driver, name }
  let dummies = [];
  let ram = null;
  let playerAuto = null;
  const allCars = () => { const a = []; if (player) a.push(player); for (const b of bots) a.push(b.car); for (const d of dummies) a.push(d); for (const g of mp.ghosts.values()) a.push(g.car); return a; };

  function disposeCar(c) { if (!c) return; c.dispose(); c.disposed = true; }
  function clearCars() {
    disposeCar(player); player = null;
    for (const b of bots) disposeCar(b.car);
    bots = [];
    for (const d of dummies) disposeCar(d);
    dummies = [];
    for (const g of mp.ghosts.values()) disposeCar(g.car);
    mp.ghosts.clear();
    playerAuto = null;
    audio?.rivalsClear();
  }
  function placeCar(c, pos, yaw) {
    const p = pos.clone();
    p.y = spawnHeight(c.p, p.x, p.z);
    c.spawn(p, yaw);
  }
  function spawnDummies() {
    for (const d of dummies) disposeCar(d);
    dummies = [];
    const A = game.track.extras.arena;
    if (!A) return;
    const ids = ['brutus', 'rhino', 'kaze', 'brutus', 'rhino'];
    ids.forEach((id, i) => {
      const a = (i / ids.length) * Math.PI * 2 + 0.4;
      const r = 15 + Math.random() * 6;
      const pos = new THREE.Vector3(A.x + Math.cos(a) * r, 0, A.z + Math.sin(a) * r);
      const preset = CARS[id];
      const c = makeCar(id, pick(preset.colors), { isPlayer: false });
      c.input = { throttle: 0, brake: 1, steer: 0, handbrake: 1 };
      placeCar(c, pos, -a + Math.PI / 2 + (Math.random() - 0.5) * 1.2);
      dummies.push(c);
    });
  }
  const removeDebris = (d) => { game.owners.delete(d.col.handle); game.world?.removeRigidBody(d.body); scene.remove(d.obj); };
  game.addDebris = (obj, half, v, mass, opts = {}) => {
    const p = obj.position, q = obj.quaternion;
    const body = game.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(v.x, v.y, v.z).setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 })
        .setLinearDamping(0.15).setAngularDamping(0.35).setCcdEnabled(true)
    );
    let desc;
    if (opts.wheel) { const s = Math.SQRT1_2; desc = RAPIER.ColliderDesc.cylinder(opts.w / 2, opts.r).setRotation({ x: 0, y: 0, z: s, w: s }); }
    else desc = RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]);
    desc.setMass(mass).setFriction(0.75).setRestitution(opts.wheel ? 0.35 : 0.15);
    const col = game.world.createCollider(desc, body);
    game.owners.set(col.handle, { type: 'debris', body });
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    game.debris.push({ obj, body, col });
    if (game.debris.length > 90) removeDebris(game.debris.shift());
  };

  // Auto neu aufbauen (Reparatur-Power-up / F): gleiche Lage, gleiche Fahrt
  function rebuildCar(old) {
    const t = old.body.translation(), r = old.body.rotation(), lv = old.body.linvel(), av = old.body.angvel();
    const c = makeCar(old.p.id, old.color, { isPlayer: old.isPlayer, ai: old.ai, remote: old.remote, name: old.name });
    c.body.setTranslation(t, true); c.body.setRotation(r, true);
    if (!old.remote) { c.body.setLinvel(lv, true); c.body.setAngvel(av, true); }
    c.netId = old.netId; c.netOwned = old.netOwned; c.netSound = old.netSound;
    if (old.onImpact) c.onImpact = (p, d, sp) => sendImpact(c, p, d, sp);
    if (old.nameTag) c.setNameTag(old.name, old.color);
    for (const g of mp.ghosts.values()) if (g.car === old) g.car = c;
    if (c.netOwned && mp.net) mp.net.send('ev', { e: { type: 'rep', id: c.netId } });
    c.gear = Math.max(1, old.gear); c.rpm = old.rpm; c.item = old.item; c.itemRoll = old.itemRoll;
    c.syncVisual();
    disposeCar(old);
    if (old === player) { player = c; if (playerAuto) playerAuto.car = c; if (audio?.engine) { /* Klang liest das Auto jedes Bild neu */ } }
    for (const b of bots) if (b.car === old) { b.car = c; b.driver.car = c; }
    if (race) { const e = race.entryOf(old); if (e) e.car = c; }
    if (items) for (const rk of items.rockets) if (rk.target === old) rk.target = c;
    game.fx.sparks.burst(new THREE.Vector3(t.x, t.y + 1, t.z), 30, { speed: 5, spread: 1, life: 0.7, color: 0x7dff6a });
    return c;
  }

  // ------------------------------------------------------------ Zustand
  let audio = null;
  let soundBanks = false;
  const clock = {
    last: performance.now(), elapsedTime: 0,
    getDelta() { const n = performance.now(); const d = (n - this.last) / 1000; this.last = n; this.elapsedTime += d; return d; },
  };
  const state = {
    mode: 'none', screen: 'menu', paused: false, cam: Number(cfg.cam) || 0, timeScale: 1, labDrive: false, orbit: { yaw: 0.9, pitch: 0.42, dist: 11 },
    intro: null, attract: null, resultsShown: false, lastRace: null, menuReturn: 'menu',
  };
  const lap = { start: 0, last: null, best: null, count: 1 };
  const drift = { active: false, score: 0, time: 0, idle: 0, total: 0, mult: 1 };
  const cluster = new Cluster($('cluster'));
  document.fonts?.ready.then(() => { cluster.bgKey = null; });
  const damageView = new DamageView($('dmg'));

  // ------------------------------------------------------------ Kollisionen -> Schaden
  const cooldown = new Map();
  const tv1 = new THREE.Vector3(), tv2 = new THREE.Vector3(), tdir = new THREE.Vector3(), tc = new THREE.Vector3();
  const bodyVel = (collider, p, out) => {
    const o = game.owners.get(collider.handle);
    if (o?.type === 'ram' && o.ref.prev) return out.copy(o.ref.prev);
    const b = collider.parent(); if (!b) return out.set(0, 0, 0);
    const v = b.velocityAtPoint(p); return out.set(v.x, v.y, v.z);
  };
  let frameCrash = null;
  function handleContacts(now) {
    const world = game.world;
    eventQueue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1(), h2 = ev.collider2();
      const o1 = game.owners.get(h1), o2 = game.owners.get(h2);
      const car1 = o1?.type === 'car' ? o1.car : null, car2 = o2?.type === 'car' ? o2.car : null;
      if (!car1 && !car2) return;
      if (car1 && car1 === car2) return;
      const c1 = world.getCollider(h1), c2 = world.getCollider(h2);
      if (!c1 || !c2) return;
      let point = null, normal = null;
      world.contactPair(c1, c2, (m) => {
        if (point || m.numSolverContacts() === 0) return;
        const p = m.solverContactPoint(0), n = m.normal();
        point = new THREE.Vector3(p.x, p.y, p.z);
        normal = new THREE.Vector3(n.x, n.y, n.z);
      });
      if (!point) return;
      const vA = car1 ? car1.velocityAtPrev(point, tv1) : bodyVel(c1, point, tv1);
      const vB = car2 ? car2.velocityAtPrev(point, tv2) : bodyVel(c2, point, tv2);
      const impactSpeed = Math.abs(tv1.copy(vA).sub(vB).dot(normal));
      const sides = [];
      if (car1) sides.push([car1, o2, h2, c2]);
      if (car2) sides.push([car2, o1, h1, c1]);
      for (const [car, other, oh, oc] of sides) {
        if (car.remote) continue; // Schaden meldet der Besitzer
        const key = car.uid * 100000 + oh;
        if (now - (cooldown.get(key) ?? -9) < 0.2) continue;
        const t = car.body.translation();
        tc.set(t.x, t.y, t.z);
        tdir.copy(normal);
        if (tdir.dot(tc.clone().sub(point)) < 0) tdir.negate();
        let eff = impactSpeed;
        const type = other?.type;
        if (type === 'ground') {
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(car.root.quaternion);
          const under = tdir.dot(up) > 0.6;
          if (impactSpeed > 3 && car.speedMs > 4) game.fx.sparks.burst(point, 8, { speed: 4, spread: 0.7, life: 0.4 });
          if (under) { if (car === player && impactSpeed > 4) audio?.scrape(); eff = impactSpeed > 11 ? (impactSpeed - 8) * 0.6 : 0; }
        } else if (type === 'car' || type === 'ram') {
          const om = type === 'car' ? other.car.p.mass : other.body.mass();
          eff = impactSpeed * clamp(om / car.p.mass, 0.6, 1.8);
          if (type === 'car' && other.car.armorT > 0) eff *= 1.7;
        } else if (type === 'prop' || type === 'debris') {
          const b = oc.parent(), om = b ? b.mass() : 50;
          if (car === player && impactSpeed > 3.5) audio?.bump(clamp(om / 60, 0.2, 1));
          eff = impactSpeed * Math.min(1, (om / car.p.mass) * 2.5);
        }
        if (eff > 2.4) {
          const s = car.applyImpact(point, tdir, eff);
          cooldown.set(key, now);
          if (s > 0) {
            car.lastHit = { speed: impactSpeed * 3.6, s };
            const d = camera.position.distanceTo(point);
            const loud = s * (car === player || other?.car === player || type === 'ram' ? 1 : 1 / (1 + d / 30));
            if (!frameCrash || loud > frameCrash.loud) frameCrash = { loud, s };
            if (car === player) game.fx.shake = Math.min(1.3, game.fx.shake + s * 0.9);
          }
        }
      }
    });
  }

  // ------------------------------------------------------------ Crash-Labor: Rammbock
  const lab = { zone: 'front', speed: 60, mass: 1600 };
  const ZONES = { front: [0, -1], rear: [0, 1], left: [-1, 0], right: [1, 0], fl: [-0.7, -0.7], fr: [0.7, -0.7], rl: [-0.7, 0.7], rr: [0.7, 0.7], roof: null };
  function removeRam() {
    if (!ram) return;
    game.owners.delete(ram.col.handle);
    game.world?.removeRigidBody(ram.body);
    scene.remove(ram.mesh);
    ram = null;
  }
  function makeRamMesh(w, h, l, heavy) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshStandardMaterial({ color: heavy ? 0x2d5fb5 : 0xf2c43a, flatShading: true, roughness: 0.6 }));
    g.add(body);
    const face = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.7, 0.5), new THREE.MeshStandardMaterial({ color: 0x9da1a8, flatShading: true, roughness: 0.4, metalness: 0.6 }));
    face.position.z = -l / 2 - 0.2;
    g.add(face);
    for (let k = 0; k < 4; k++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, h * 1.01, 0.35), new THREE.MeshStandardMaterial({ color: 0x16171b, flatShading: true }));
      st.position.z = -l / 2 + 0.6 + k * 0.9;
      g.add(st);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  function labSpot() { const L = game.track.extras.lab; return new THREE.Vector3(L.x, 0, L.z); }
  function fireRam() {
    if (state.mode !== 'lab') return;
    removeRam();
    const car = player;
    if (!state.labDrive) placeCar(car, labSpot(), Math.PI / 2);
    const v = lab.speed / 3.6;
    const heavy = lab.mass > 3000;
    const w = heavy ? 2.4 : 1.9, h = heavy ? 2.2 : 1.35, l = heavy ? 5.5 : 4.0;
    const t = car.body.translation();
    const q = car.root.quaternion;
    let pos, vel, rot;
    if (lab.zone === 'roof') {
      pos = new THREE.Vector3(t.x, t.y + 9, t.z);
      vel = new THREE.Vector3(0, -Math.max(4, v * 0.6), 0);
      rot = q.clone();
    } else {
      const [lx, lz] = ZONES[lab.zone];
      const { w: cw, l: cl } = car.p.dims;
      const target = new THREE.Vector3(lx * cw * 0.5, 0, lz * cl * 0.5).applyQuaternion(q).add(new THREE.Vector3(t.x, 0, t.z));
      const dir = new THREE.Vector3(lx, 0, lz).normalize().applyQuaternion(q).setY(0).normalize();
      pos = target.clone().addScaledVector(dir, 13 + l / 2);
      pos.y = game.heightAt(pos.x, pos.z) + h / 2 + 0.1;
      vel = dir.clone().multiplyScalar(-v);
      rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().negate());
    }
    const body = game.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .setLinvel(vel.x, vel.y, vel.z).lockRotations().setCcdEnabled(true).setGravityScale(lab.zone === 'roof' ? 1 : 0));
    const col = game.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, l / 2).setMass(lab.mass).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.05), body);
    const mesh = makeRamMesh(w, h, l, heavy);
    scene.add(mesh);
    ram = { body, col, mesh, t: 0, prev: null };
    game.owners.set(col.handle, { type: 'ram', body, ref: ram });
    audio?.ui();
  }

  // ------------------------------------------------------------ Eingabe
  const keys = new Set();
  const ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  let padPrev = [];
  const driving = () => ['race', 'free', 'arena'].includes(state.mode) || (state.mode === 'lab' && state.labDrive);
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    const sc = state.screen;
    if (sc === 'garage') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') switchCar(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') switchCar(1);
      if (e.code === 'Enter') closeGarage();
      if (e.code === 'Escape') closeGarage();
      return;
    }
    if (e.code === 'KeyM') { toggleMute(); return; }
    if (['menu', 'sp', 'mp', 'lobby', 'info', 'settings', 'results'].includes(sc)) {
      if (e.code === 'Escape') backFrom(sc);
      if (e.code === 'Enter' && sc === 'sp') startFromSp();
      return;
    }
    if (sc === 'pause') { if (e.code === 'Escape') setPause(false); return; }
    switch (e.code) {
      case 'KeyE': case 'ShiftLeft': case 'ShiftRight': useItem(); break;
      case 'KeyR': resetPlayer(); break;
      case 'KeyF': if (state.mode !== 'race') { if (state.mode === 'lab' && !state.labDrive) { spawnLabCar(); } else rebuildCar(player); toast('Repariert', 'good'); } break;
      case 'KeyC': state.cam = (state.cam + 1) % 3; break;
      case 'KeyN': if (state.mode === 'arena') resetArena(); break;
      case 'KeyT': if (state.mode === 'lab' || state.mode === 'free' || state.mode === 'arena') setSlowmo(state.timeScale === 1); break;
      case 'KeyH': cfg.keys = cfg.keys ? 0 : 1; persist(); applyHudPrefs(); break;
      case 'Space': if (state.mode === 'lab' && !state.labDrive) fireRam(); break;
      case 'Escape': if (state.mode === 'lab') goMenu(); else setPause(true); break;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); if (!mp.inRace && ['race', 'free', 'arena'].includes(state.mode) && state.screen === 'hud') setPause(true); });

  function readInput(dt) {
    const k = (...c) => c.some((x) => keys.has(x));
    let th = k('KeyW', 'ArrowUp') ? 1 : 0;
    let br = k('KeyS', 'ArrowDown') ? 1 : 0;
    let st = (k('KeyA', 'ArrowLeft') ? 1 : 0) - (k('KeyD', 'ArrowRight') ? 1 : 0);
    let hb = k('Space') ? 1 : 0;
    let analog = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.1) { st = -Math.sign(ax) * ((Math.abs(ax) - 0.1) / 0.9) ** 1.3; analog = true; }
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0);
      th = Math.max(th, b(7)); br = Math.max(br, b(6)); hb = Math.max(hb, b(0));
      const pressed = (i) => b(i) > 0.5 && !(padPrev[i] > 0.5);
      if (state.screen === 'garage') {
        if (pressed(14)) switchCar(-1);
        if (pressed(15)) switchCar(1);
        if (pressed(0) || pressed(9)) closeGarage();
      } else if (state.screen === 'hud') {
        if (pressed(3)) resetPlayer();
        if (pressed(1)) state.cam = (state.cam + 1) % 3;
        if (pressed(2) || pressed(5)) useItem();
        if (pressed(9)) setPause(true);
      } else if (state.screen === 'pause') {
        if (pressed(9) || pressed(0)) setPause(false);
      }
      padPrev = pad.buttons.map((x) => x.value || (x.pressed ? 1 : 0));
    }
    const ramp = (cur, tgt, up, down) => cur + clamp(tgt - cur, -down * dt, up * dt);
    ctl.throttle = ramp(ctl.throttle, th, 6, 10);
    ctl.brake = ramp(ctl.brake, br, 8, 12);
    ctl.steer = analog ? st : ramp(ctl.steer, st, 9, 12);
    ctl.handbrake = hb;
  }

  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { if (state.mode === 'lab' && !state.labDrive) drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.orbit.yaw -= (e.clientX - drag.x) * 0.006;
    state.orbit.pitch = clamp(state.orbit.pitch + (e.clientY - drag.y) * 0.004, 0.05, 1.35);
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => (drag = null));
  renderer.domElement.addEventListener('wheel', (e) => { if (state.mode === 'lab') state.orbit.dist = clamp(state.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 4, 30); }, { passive: true });

  // ------------------------------------------------------------ Oberfläche: Bildschirme
  const SCREENS = ['menu', 'sp', 'mp', 'lobby', 'info', 'settings', 'garage', 'hud', 'pause', 'results'];
  function showScreen(name) {
    state.screen = name;
    for (const s of SCREENS) $(s).classList.toggle('on', s === name || (name === 'pause' && s === 'hud') || (name === 'results' && s === 'hud'));
    const garage = name === 'garage';
    renderPass.scene = garage ? show : scene;
    renderPass.camera = garage ? showCam : camera;
    $('labPanel').classList.toggle('hidden', !(state.mode === 'lab' && (name === 'hud' || name === 'pause')));
    document.body.dataset.screen = name;
  }
  function toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 1900);
    setTimeout(() => el.remove(), 2400);
  }
  let bigT = null;
  function bigMsg(html, cls = '', dur = 1.6) {
    const el = $('bigMsg');
    el.innerHTML = html;
    el.className = 'out ' + cls;
    clearTimeout(bigT);
    bigT = setTimeout(() => el.classList.add('off'), dur * 1000);
  }
  const ui = () => audio?.ui();
  for (const b of $$('button')) b.addEventListener('click', () => { if (audio) ui(); });

  // ---- Hauptmenü
  function backFrom(sc) {
    if (sc === 'info') $('infoBack').onclick();
    else if (sc === 'sp' || sc === 'mp' || sc === 'settings') showScreen('menu');
    else if (sc === 'lobby') showScreen('mp');
    else if (sc === 'results') goMenu();
  }
  $('mSingle').onclick = () => openSp();
  $('mMulti').onclick = () => openMp();
  $('mGarage').onclick = () => openGarage('menu');
  $('mLab').onclick = () => startLab();
  $('mHelp').onclick = () => openInfo('keys');
  $('ibHelp').onclick = () => openInfo('keys');
  $('ibSettings').onclick = () => openSettings();
  $('dSettings').onclick = () => openSettings();
  $('dGarage').onclick = () => openGarage('menu');
  $('ibSound').onclick = () => toggleMute();
  $('ibFull').onclick = () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch { /* */ } };
  $('promoTracks').onclick = () => openInfo('tracks');
  $('promoItems').onclick = () => openInfo('items');
  $('nameInput').value = cfg.name;
  $('nameInput').oninput = (e) => { cfg.name = e.target.value.trim() || 'Fahrer'; $('mpName').value = cfg.name; persist(); };
  function toggleMute() {
    ensureAudio(false);
    if (!audio) return;
    audio.setMuted(!audio.muted);
    $('ibSound').innerHTML = UI_ICONS[audio.muted ? 'mute' : 'sound'];
    toast(audio.muted ? 'Ton aus' : 'Ton an');
  }
  function renderDriver() {
    const id = selId(), c = CARS[id];
    $('driverCar').textContent = `${c.name} · ${c.tag.split('·')[0].trim()}`;
    for (const el of [$('driverAvatar'), $('spAvatar')]) el.style.color = sel.colors[id];
    $('spCar').textContent = c.name;
    $('driverBest').innerHTML = LEVEL_ORDER.map((lid) => `<div>${LEVELS[lid].name}<b>${cfg.best[lid] ? fmt(cfg.best[lid]) : '–'}</b></div>`).join('');
  }

  // ---- Strecken-Vorschau
  const trackCache = {};
  const trackOf = (id) => (trackCache[id] ||= new Track(LEVELS[id]));
  function drawTrack(cv, id, { bg = null, line = '#ffffff', width = 0.07 } = {}) {
    const tr = trackOf(id), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of tr.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const sc = Math.min((W * 0.84) / (x1 - x0), (H * 0.84) / (z1 - z0));
    const ox = W / 2 - ((x0 + x1) / 2) * sc, oz = H / 2 - ((z0 + z1) / 2) * sc;
    const path = () => { ctx.beginPath(); tr.pts.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * sc, oz + p.z * sc) : ctx.moveTo(ox + p.x * sc, oz + p.z * sc))); ctx.closePath(); };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    path(); ctx.strokeStyle = '#23264a'; ctx.lineWidth = Math.min(W, H) * width + 10; ctx.stroke();
    path(); ctx.strokeStyle = line; ctx.lineWidth = Math.min(W, H) * width; ctx.stroke();
    const p0 = tr.pts[0], t0 = tr.tan[0];
    ctx.save(); ctx.translate(ox + p0.x * sc, oz + p0.z * sc); ctx.rotate(Math.atan2(t0.z, t0.x));
    ctx.fillStyle = '#23264a'; ctx.fillRect(-6, -Math.min(W, H) * width * 0.8, 12, Math.min(W, H) * width * 1.6);
    ctx.fillStyle = '#ffd23e'; ctx.fillRect(-3, -Math.min(W, H) * width * 0.65, 6, Math.min(W, H) * width * 1.3);
    ctx.restore();
    return { sc, ox, oz };
  }
  function trackFacts(id) {
    const L = LEVELS[id], tr = trackOf(id);
    const ys = tr.roadY;
    let corners = 0, inC = false;
    for (let i = 0; i < tr.N; i++) { const c = Math.abs(tr.curv[i]) > 0.3; if (c && !inC) corners++; inC = c; }
    const dots = [1, 2, 3].map((k) => `<i class="${k <= L.diff ? 'on' : ''}"></i>`).join('');
    return `<span>${(tr.length / 1000).toFixed(1).replace('.', ',')} km</span><span>${corners} Kurven</span><span>${Math.round(Math.max(...ys) - Math.min(...ys))} m Höhe</span><span>${THEME_NAMES[L.theme]}</span><span>Schwierigkeit <span class="dots">${dots}</span></span>`;
  }

  // ---- Einzelspieler
  const sp = Object.assign({ mode: 'race', level: 0, laps: 3, bots: 5, skill: 'normal', items: true }, cfg.sp || {});
  function renderSp() {
    const id = LEVEL_ORDER[sp.level], L = LEVELS[id];
    $$('[data-spmode]').forEach((b) => b.classList.toggle('on', b.dataset.spmode === sp.mode));
    $('trCard').style.background = `linear-gradient(135deg, ${L.card[0]}, ${L.card[1]})`;
    drawTrack($('trCanvas'), id);
    $('trName').textContent = L.name;
    $('trSub').textContent = L.sub;
    $('trFacts').innerHTML = trackFacts(id);
    $('vLaps').textContent = sp.laps; $('vBots').textContent = sp.bots;
    for (const v of $$('.vLaps')) v.textContent = sp.laps;
    $$('#segSkill button, #segSkill2 button').forEach((b) => b.classList.toggle('on', b.dataset.v === sp.skill));
    $$('#segItems button, #segItems2 button').forEach((b) => b.classList.toggle('on', b.dataset.v === (sp.items ? '1' : '0')));
    const arena = sp.mode === 'arena';
    $('spOpts').classList.toggle('hidden', sp.mode !== 'race');
    $('spInfo').classList.toggle('hidden', sp.mode === 'race');
    $('spInfo').innerHTML = sp.mode === 'free'
      ? '<b>Freies Fahren:</b> Allein auf der Strecke, Rundenzeiten jagen, driften und Power-up-Kisten ausprobieren. Mit <kbd>F</kbd> reparierst du jederzeit.'
      : '<b>Crash-Arena:</b> Fünf stehende Autos in der Arena am Grünen Tal warten darauf, zerlegt zu werden. Daneben gibt es eine Sprungschanze. <kbd>N</kbd> stellt alles neu auf.';
    $('trPrev').disabled = $('trNext').disabled = arena;
    $('trCard').style.opacity = arena ? 0.55 : 1;
    cfg.sp = { ...sp }; persist();
    if (state.screen === 'lobby') mpSendSettings();
  }
  function openSp() { state.menuReturn = 'menu'; renderSp(); renderDriver(); showScreen('sp'); }
  $$('[data-spmode]').forEach((b) => (b.onclick = () => { sp.mode = b.dataset.spmode; if (sp.mode === 'arena') sp.level = 0; renderSp(); }));
  $('trPrev').onclick = () => { sp.level = (sp.level + LEVEL_ORDER.length - 1) % LEVEL_ORDER.length; renderSp(); };
  $('trNext').onclick = () => { sp.level = (sp.level + 1) % LEVEL_ORDER.length; renderSp(); };
  $$('[data-step]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.step, d = Number(b.dataset.d);
    if (k === 'laps') sp.laps = clamp(sp.laps + d, 1, 10);
    if (k === 'bots') sp.bots = clamp(sp.bots + d, 0, 7);
    renderSp();
  }));
  $$('#segSkill button, #segSkill2 button').forEach((b) => (b.onclick = () => { sp.skill = b.dataset.v; renderSp(); }));
  $$('#segItems button, #segItems2 button').forEach((b) => (b.onclick = () => { sp.items = b.dataset.v === '1'; renderSp(); }));
  $('spBack').onclick = () => showScreen('menu');
  $('spGarage').onclick = () => openGarage('sp');
  $('spStart').onclick = () => startFromSp();
  function startFromSp() {
    const id = LEVEL_ORDER[sp.level];
    if (sp.mode === 'race') startRace({ mode: 'race', level: id, laps: sp.laps, skill: sp.skill, items: sp.items, opponents: sp.bots });
    else if (sp.mode === 'free') startRace({ mode: 'free', level: id, items: sp.items, opponents: 0 });
    else startArena();
  }

  // ---- Mehrspieler: Code eingeben
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codeInputs = [];
  for (let i = 0; i < 5; i++) {
    const inp = document.createElement('input');
    inp.maxLength = 1; inp.placeholder = '•'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.oninput = () => {
      inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      inp.classList.toggle('filled', !!inp.value);
      if (inp.value && i < 4) codeInputs[i + 1].focus();
      $('codeMsg').textContent = '';
    };
    inp.onkeydown = (e) => {
      if (e.key === 'Backspace' && !inp.value && i > 0) { codeInputs[i - 1].focus(); codeInputs[i - 1].value = ''; codeInputs[i - 1].classList.remove('filled'); }
      if (e.key === 'Enter') joinRoom();
      if (e.key === 'Escape') showScreen('menu');
    };
    inp.onpaste = (e) => {
      const t = (e.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (!t) return;
      e.preventDefault();
      [...t].forEach((ch, k) => { codeInputs[k].value = ch; codeInputs[k].classList.add('filled'); });
      codeInputs[Math.min(4, t.length)].focus();
    };
    codeInputs.push(inp);
    $('codeBox').appendChild(inp);
  }
  $('mpName').value = cfg.name;
  $('mpName').oninput = (e) => { cfg.name = e.target.value.trim() || 'Fahrer'; $('nameInput').value = cfg.name; persist(); };
  $('mpName').onkeydown = (e) => e.stopPropagation();
  $('nameInput').onkeydown = (e) => e.stopPropagation();
  function openMp(prefill = '') {
    for (const [k, c] of codeInputs.entries()) { c.value = prefill[k] || ''; c.classList.toggle('filled', !!c.value); }
    $('codeMsg').textContent = ''; $('codeMsg').className = 'codeMsg';
    $('mpName').value = cfg.name;
    showScreen('mp');
    setTimeout(() => codeInputs[Math.min(4, prefill.length)].focus(), 50);
    if (prefill.length === 5) joinRoom();
  }
  const codeMsg = (html, ok = false) => { const m = $('codeMsg'); m.className = 'codeMsg' + (ok ? ' ok' : ''); m.innerHTML = html; };
  async function joinRoom() {
    const code = codeInputs.map((c) => c.value).join('').toUpperCase();
    if (code.length < 5) {
      codeMsg('Gib alle 5 Zeichen des Codes ein');
      $('codeBox').classList.remove('shake'); void $('codeBox').offsetWidth; $('codeBox').classList.add('shake');
      audio?.sfx('error');
      return;
    }
    codeMsg(`<span class="spin"></span>Suche Raum ${code} …`, true);
    if (!(await netConnect())) { codeMsg('Der Spielserver ist nicht erreichbar. Läuft das Spiel über deinen eigenen Server?'); audio?.sfx('error'); return; }
    mp.pendingJoin = true;
    mp.net.send('join', { code, ...profile() });
  }
  $('mpJoin').onclick = () => joinRoom();
  $('mpCreate').onclick = () => createRoom();
  $('mpBack').onclick = () => { netLeave(); showScreen('menu'); };

  // ---- Lobby (online über den Server, sonst offline mit Bots)
  const lobby = { code: '', bots: [], level: 0, mode: 'race', fill: true };
  const profile = () => ({ name: cfg.name, car: selId(), color: sel.colors[selId()], sound: sel.sounds[selId()] });
  async function createRoom() {
    codeMsg('<span class="spin"></span>Raum wird erstellt …', true);
    if (await netConnect()) {
      mp.net.send('create', profile());
      return; // weiter, sobald der Server den Raum meldet
    }
    // Kein Server: Raum nur lokal mit Bots
    mp.online = false;
    codeMsg('');
    toast('Kein Spielserver erreichbar – Raum nur mit Bots', 'bad');
    lobby.code = Array.from({ length: 5 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
    lobby.bots = [];
    lobby.level = sp.level;
    renderLobby();
    state.menuReturn = 'lobby';
    showScreen('lobby');
  }
  function newBot(taken = lobby.bots) {
    const used = new Set(taken.map((b) => b.name));
    const name = pick(BOT_NAMES.filter((n) => !used.has(n))) || 'Bot';
    const car = pick(CAR_ORDER);
    return { name, car, color: pick(CARS[car].colors) };
  }
  const isHost = () => !mp.online || mp.room?.host === mp.me;
  function renderLobby() {
    const online = mp.online && mp.room;
    const R = online ? mp.room : null;
    const host = isHost();
    if (online) {
      const st = R.settings;
      lobby.level = Math.max(0, LEVEL_ORDER.indexOf(st.level));
      lobby.mode = st.mode; lobby.fill = st.fill; lobby.code = R.code; lobby.bots = R.bots.map((b) => ({ ...b }));
      if (!host) { sp.laps = st.laps; sp.skill = st.skill; sp.items = st.items; }
    }
    const L = LEVELS[LEVEL_ORDER[lobby.level]];
    $('roomCode').textContent = lobby.code;
    const humans = online ? R.players : [{ id: 'me', ...profile() }];
    const n = humans.length + lobby.bots.length;
    $('lbSub').textContent = `${n}/8 Fahrer · ${online ? (host ? 'Freunde treten mit dem Code bei' : 'Der Gastgeber startet das Rennen') : 'Offline – nur mit Bots'}`;
    $('lbTrack').textContent = L.name;
    $('lbModeTxt').textContent = lobby.mode === 'race' ? 'RENNEN' : 'FREIES FAHREN';
    const hostId = online ? R.host : 'me';
    let html = '';
    for (const p of humans) {
      const mine = online ? p.id === mp.me : true;
      const car = CARS[p.car] || CARS.brutus;
      html += `<div class="slot ${mine ? 'mine' : ''}" ${mine ? 'data-me="1" title="Auto ändern"' : ''}><div class="avatar" style="color:${p.color}">${UI_ICONS.car}</div><div class="nm">${escapeHtml(p.name)}${mine && online ? ' (du)' : ''}</div><div class="cr">${car.name}</div>${p.id === hostId ? `<div class="host"><i>${UI_ICONS.crown}</i>Gastgeber</div>` : '<div class="bot">Spieler</div>'}</div>`;
    }
    const skillTxt = sp.skill[0].toUpperCase() + sp.skill.slice(1);
    lobby.bots.forEach((b, k) => {
      html += `<div class="slot">${host ? `<button class="x" data-rm="${k}">✕</button>` : ''}<div class="avatar" style="color:${b.color}">${UI_ICONS.robot}</div><div class="nm">${escapeHtml(b.name)}</div><div class="cr">${(CARS[b.car] || CARS.brutus).name}</div><div class="bot">Bot · ${skillTxt}</div></div>`;
    });
    for (let k = n; k < 8; k++) html += `<div class="slot empty" ${host ? 'data-add="1"' : ''}><div class="plus">${UI_ICONS.plus}</div><div>Freund einladen${host ? '<br><small>oder Bot hinzufügen</small>' : ''}</div></div>`;
    $('slots').innerHTML = html;
    const setBots = (list) => { if (online) mp.net.send('bots', { list }); else { lobby.bots = list; renderLobby(); } };
    $$('[data-rm]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const list = lobby.bots.slice(); list.splice(Number(b.dataset.rm), 1); ui(); setBots(list); }));
    $$('[data-add]').forEach((b) => (b.onclick = () => { ui(); setBots([...lobby.bots, newBot()]); }));
    $$('[data-me]').forEach((b) => (b.onclick = () => openGarage('lobby')));
    $$('#segFill button').forEach((b) => b.classList.toggle('on', b.dataset.v === (lobby.fill ? '1' : '0')));
    for (const id of ['lbPrev', 'lbNext', 'lbMode', 'lbCustom']) $(id).disabled = !host;
    $('lbStart').disabled = !host;
    $('lbStart').firstElementChild.textContent = host ? 'START' : 'WARTEN …';
    renderSp();
  }
  // Einstellungen des Gastgebers an den Server (nur wenn sich etwas ändert)
  function mpSendSettings() {
    if (!mp.online || !mp.room || !isHost()) return;
    const want = { level: LEVEL_ORDER[lobby.level], laps: sp.laps, items: sp.items, skill: sp.skill, mode: lobby.mode, fill: lobby.fill };
    const cur = mp.room.settings;
    if (Object.keys(want).some((k) => want[k] !== cur[k])) mp.net.send('settings', want);
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('lbPrev').onclick = () => { lobby.level = (lobby.level + LEVEL_ORDER.length - 1) % LEVEL_ORDER.length; mpSendSettings(); renderLobby(); };
  $('lbNext').onclick = () => { lobby.level = (lobby.level + 1) % LEVEL_ORDER.length; mpSendSettings(); renderLobby(); };
  $('lbMode').onclick = () => { lobby.mode = lobby.mode === 'race' ? 'free' : 'race'; mpSendSettings(); renderLobby(); };
  $('lbCustom').onclick = () => $('lbSettings').classList.toggle('hidden');
  $('lbSetOk').onclick = () => $('lbSettings').classList.add('hidden');
  $$('#segFill button').forEach((b) => (b.onclick = () => { lobby.fill = b.dataset.v === '1'; mpSendSettings(); renderLobby(); }));
  $('lbBack').onclick = () => { netLeave(); state.menuReturn = 'menu'; showScreen('mp'); };
  $('lbLeave').onclick = () => { netLeave(); state.menuReturn = 'menu'; showScreen('menu'); };
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
  const inviteLink = () => (mp.online && /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}?raum=${lobby.code}` : '');
  $('codeBadge').onclick = async () => toast((await copyText(lobby.code)) ? `Code ${lobby.code} kopiert` : `Code: ${lobby.code}`, 'gold');
  $('lbInvite').onclick = async () => {
    const link = inviteLink();
    const text = link ? `Komm zu Nitro Rivale in meinen Raum! ${link}` : `Komm zu Nitro Rivale in meinen Raum! Code: ${lobby.code}`;
    toast((await copyText(text)) ? 'Einladung kopiert – schick sie deinen Freunden!' : `Sag deinen Freunden den Code: ${lobby.code}`, 'gold');
  };
  $('lbStart').onclick = () => {
    if (!isHost()) return;
    const list = [...lobby.bots];
    const humans = mp.online && mp.room ? mp.room.players.length : 1;
    if (lobby.mode === 'race' && lobby.fill) while (list.length + humans < 8) list.push(newBot(list));
    if (mp.online) { mp.net.send('start', { bots: list }); return; }
    lobby.bots = list;
    startRace({ mode: lobby.mode, level: LEVEL_ORDER[lobby.level], laps: sp.laps, skill: sp.skill, items: sp.items, opponents: lobby.mode === 'race' ? list.length : 0, roster: list, fromLobby: true });
  };

  // ---- Info-Panels
  function openInfo(kind) {
    const body = $('infoBody');
    if (kind === 'items') {
      $('infoTitle').textContent = 'POWER-UPS';
      $('infoSub').textContent = 'Fahr durch eine ?-Kiste und drück E (Gamepad: X oder RB)';
      body.innerHTML = `<div class="itemGrid">${ITEM_ORDER.map((k) => `<div><i>${ITEM_ICONS[k]}</i><span><b>${ITEMS[k].name}</b>${ITEMS[k].hint}</span></div>`).join('')}</div>
        <div class="modeInfo">Vorne bekommst du eher Verteidigung (Ölfleck, Sprengfass), hinten eher Aufholhilfen (Nitro, Rakete). Ist dein Auto stark beschädigt, kommt öfter die Reparatur.</div>`;
    } else if (kind === 'tracks') {
      $('infoTitle').textContent = 'STRECKEN';
      $('infoSub').textContent = 'Klick auf eine Strecke, um direkt loszulegen';
      body.innerHTML = `<div class="trackList">${LEVEL_ORDER.map((id, k) => `<div class="trackCard" data-tr="${k}" style="background:linear-gradient(135deg, ${LEVELS[id].card[0]}, ${LEVELS[id].card[1]})"><canvas width="360" height="244"></canvas><div><h3>${LEVELS[id].name}</h3><div class="sub">${LEVELS[id].sub}</div><div class="facts">${trackFacts(id)}</div></div></div>`).join('')}</div>`;
      $$('[data-tr]').forEach((el) => { drawTrack(el.querySelector('canvas'), LEVEL_ORDER[Number(el.dataset.tr)]); el.onclick = () => { sp.level = Number(el.dataset.tr); sp.mode = 'race'; openSp(); }; });
    } else {
      $('infoTitle').textContent = 'STEUERUNG';
      $('infoSub').textContent = 'Tastatur oder Gamepad';
      body.innerHTML = `<div class="keysGrid">
        <span><kbd>W</kbd><kbd>S</kbd></span><span>Gas · Bremse / Rückwärts</span>
        <span><kbd>A</kbd><kbd>D</kbd></span><span>Lenken (Pfeiltasten gehen auch)</span>
        <span><kbd>Leertaste</kbd></span><span>Handbremse: antippen = Drift, Gas halten = Drift halten</span>
        <span><kbd>E</kbd> oder <kbd>Shift</kbd></span><span>Power-up einsetzen</span>
        <span><kbd>R</kbd></span><span>Zurück auf die Strecke</span>
        <span><kbd>F</kbd></span><span>Reparieren (nicht im Rennen)</span>
        <span><kbd>C</kbd></span><span>Kamera: nah, weit, Cockpit</span>
        <span><kbd>Esc</kbd></span><span>Pause</span>
        <span><kbd>M</kbd> · <kbd>H</kbd></span><span>Ton an/aus · Tasten-Hinweise</span>
        <span>Gamepad</span><span>RT Gas, LT Bremse, Stick lenken, A Handbremse, X/RB Power-up, Y Zurücksetzen, B Kamera, Start Pause</span>
        <span>Start</span><span>Bei Grün mit halbem Gas (Drehzahl in der Mitte) gibt es einen Turbo-Start!</span>
      </div>`;
    }
    showScreen('info');
  }
  $('infoBack').onclick = () => showScreen(state.menuReturn === 'lobby' ? 'lobby' : state.mode !== 'menu' && state.paused ? 'pause' : 'menu');

  // ---- Einstellungen
  function renderSettings() {
    $('setVol').value = cfg.vol;
    $$('#segGfx button').forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.gfx));
    $$('#segCam button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === Number(cfg.cam)));
    $$('#segShake button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === Number(cfg.shake)));
    $$('#segKeys button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === Number(cfg.keys)));
  }
  function openSettings() { renderSettings(); showScreen('settings'); }
  $('setBack').onclick = () => showScreen('menu');
  $('setVol').oninput = (e) => { cfg.vol = Number(e.target.value); audio?.setVolume(cfg.vol / 100); persist(); };
  $$('#segGfx button').forEach((b) => (b.onclick = () => { cfg.gfx = b.dataset.v; applyGfx(); renderSettings(); persist(); }));
  $$('#segCam button').forEach((b) => (b.onclick = () => { cfg.cam = Number(b.dataset.v); state.cam = cfg.cam; renderSettings(); persist(); }));
  $$('#segShake button').forEach((b) => (b.onclick = () => { cfg.shake = Number(b.dataset.v); renderSettings(); persist(); }));
  $$('#segKeys button').forEach((b) => (b.onclick = () => { cfg.keys = Number(b.dataset.v); renderSettings(); applyHudPrefs(); persist(); }));
  $('setServer').value = cfg.server || '';
  $('setServer').onkeydown = (e) => e.stopPropagation();
  $('setServer').onchange = (e) => { cfg.server = e.target.value.trim(); persist(); netLeave(); toast(cfg.server ? 'Server gespeichert' : 'Server: automatisch'); };
  function applyHudPrefs() { $('hudKeys').classList.toggle('hidden', !cfg.keys); }
  applyHudPrefs();

  // ---- Garage
  let garageFrom = 'menu';
  function renderCarInfo() {
    const id = selId(), c = CARS[id];
    $('carName').textContent = c.name;
    $('carTag').textContent = c.tag;
    $('carIdx').textContent = `${sel.idx + 1} / ${CAR_ORDER.length}`;
    const bars = [['Topspeed', c.stats.speed], ['Beschleunigung', c.stats.accel], ['Handling', c.stats.handling], ['Panzerung', c.stats.armor]];
    $('carStats').innerHTML = bars.map(([l, v]) => `<div class="stat"><span>${l}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`).join('');
    const sw = $('colors');
    sw.innerHTML = '';
    for (const col of c.colors) {
      const b = document.createElement('button');
      b.className = 'swatch' + (sel.colors[id] === col ? ' active' : '');
      b.style.background = col;
      b.setAttribute('aria-label', 'Farbe ' + col);
      b.onclick = () => {
        sel.colors[id] = col;
        const m = showModel?.userData.model;
        if (m) { m.paintColor.set(col); m.mats.mirror.color.set(col); for (const d of m.deformables) if (d.userData.dmg) paintMesh(d); }
        renderCarInfo(); saveCar(); ui();
      };
      sw.appendChild(b);
    }
    $('soundSel').innerHTML = SOUNDS.map(([sid, label]) => `<option value="${sid}" ${sel.sounds[id] === sid ? 'selected' : ''}>${label}</option>`).join('');
  }
  const saveCar = () => { cfg.car = { idx: sel.idx, colors: sel.colors, sounds: sel.sounds }; persist(); renderDriver(); };
  function switchCar(dir) {
    if (slide) return;
    sel.idx = (sel.idx + dir + CAR_ORDER.length) % CAR_ORDER.length;
    outgoing = showModel;
    showModel = makeShowModel(selId(), sel.colors[selId()]);
    turntable.add(showModel);
    slide = { t: 0, dir };
    renderCarInfo(); saveCar(); ui();
  }
  function openGarage(from) { garageFrom = from; renderCarInfo(); showScreen('garage'); }
  function closeGarage() {
    saveCar();
    if (garageFrom === 'sp') { renderSp(); showScreen('sp'); }
    else if (garageFrom === 'lobby') { if (mp.online) mp.net?.send('profile', profile()); renderLobby(); showScreen('lobby'); }
    else showScreen('menu');
  }
  $('gBack').onclick = closeGarage;
  $('garageGo').onclick = closeGarage;
  $('prevCar').onclick = () => switchCar(-1);
  $('nextCar').onclick = () => switchCar(1);
  $('soundSel').onchange = (e) => { sel.sounds[selId()] = e.target.value; saveCar(); previewSound(); };
  async function previewSound() {
    await ensureAudio(false);
    if (soundBanks) audio.preview(sel.sounds[selId()]);
    else toast('Sounddateien nicht gefunden');
  }
  $('previewBtn').onclick = () => previewSound();
  showModel = makeShowModel(selId(), sel.colors[selId()]);
  turntable.add(showModel);

  // ---- Pause + Ergebnis
  function setPause(on) {
    if (on && state.screen !== 'hud') return;
    state.paused = on && !mp.inRace;
    showScreen(on ? 'pause' : 'hud');
    $('pRestart').classList.toggle('hidden', state.mode === 'arena' || state.mode === 'lab' || mp.inRace);
    clock.getDelta();
  }
  $('pResume').onclick = () => setPause(false);
  $('pRestart').onclick = () => { state.paused = false; if (state.lastRace) startRace(state.lastRace); };
  $('pHelp').onclick = () => { openInfo('keys'); };
  $('pMenu').onclick = () => { if (mp.online) netLeave(); goMenu(); };
  $('rMenu').onclick = () => { if (mp.online) netLeave(); goMenu(); };
  $('rAgain').onclick = () => { if (mp.online) backToLobby(); else if (state.lastRace) startRace(state.lastRace); };
  $('rTrack').onclick = () => { goMenu(); if (state.lastRace?.fromLobby) showScreen('lobby'); else openSp(); };

  // ------------------------------------------------------------ Audio
  async function ensureAudio(withEngine = true) {
    if (!audio) {
      try {
        audio = new GameAudio();
        audio.setVolume(cfg.vol / 100);
        soundBanks = await audio.loadManifest();
      } catch (err) { console.warn('Audio nicht verfügbar', err); }
    }
    try { await audio?.resume(); } catch { /* blockiert */ }
    if (withEngine && audio && player && !audio.engine) attachSound(true);
  }
  window.addEventListener('pointerdown', () => ensureAudio(false), { once: true });
  function attachSound(start) {
    if (!audio || !player) return;
    const p = player.p;
    if (!audio.engine) audio.createEngine(p);
    if (soundBanks) audio.useSound(p, soundOf(p.id), start);
  }

  // ------------------------------------------------------------ Spielmodi
  function setMode(mode) {
    state.mode = mode;
    state.snapCam = true;
    state.paused = false;
    state.timeScale = 1;
    state.resultsShown = false;
    playerAuto = null;
    const isRace = mode === 'race', isFree = mode === 'free';
    $('raceBox').classList.toggle('hidden', !(isRace || isFree));
    $('posBox').classList.toggle('hidden', !isRace);
    $('standings').classList.toggle('hidden', !isRace);
    $('timeCard').classList.toggle('hidden', !(isRace || isFree));
    $('freeInfo').classList.toggle('hidden', !(isFree || mode === 'arena'));
    $('itemSlot').classList.toggle('hidden', !((isRace || isFree) && items?.enabled));
    $('minimap').parentElement.classList.toggle('hidden', !(isRace || isFree));
    $('standings').innerHTML = '';
    $('lights').classList.add('hidden');
    $('bigMsg').classList.add('off');
    $('labPanel').classList.toggle('hidden', mode !== 'lab');
    $('hudKeys').classList.toggle('hidden', !cfg.keys || mode === 'lab');
    for (const m of level?.startLights || []) { m.emissive.set(0xff2010); m.emissiveIntensity = 0; }
    drift.total = 0; drift.active = false;
  }

  function spawnPlayerAt(pos, yaw) {
    disposeCar(player);
    player = makeCar(selId(), sel.colors[selId()], { isPlayer: true, name: cfg.name });
    placeCar(player, pos, yaw);
    if (audio) { audio.disposeEngine?.(); attachSound(true); }
    damageView.lastBody = 100;
  }

  async function startRace(opt) {
    state.lastRace = opt;
    clearTimeout(resT);
    showScreen('hud');
    $('hud').classList.add('hidden');
    await ensureAudio(false);
    await loadLevel(opt.level);
    $('hud').classList.remove('hidden');
    clearCars();
    removeRam();
    while (game.debris.length) removeDebris(game.debris.shift());
    items?.dispose();
    items = new Items(game, game.track, { enabled: opt.items !== false });
    props.reset();
    game.fx.skids.clear();
    const tr = game.track;
    race = new Race(tr, { laps: opt.laps || 3, mode: opt.mode });
    const n = opt.opponents || 0;
    const roster = opt.roster ? opt.roster.slice(0, n) : [];
    const usedNames = new Set(roster.map((r) => r.name));
    while (roster.length < n) {
      const name = pick(BOT_NAMES.filter((x) => !usedNames.has(x)));
      usedNames.add(name);
      const car = CAR_ORDER[roster.length % CAR_ORDER.length];
      roster.push({ name, car, color: pick(CARS[car].colors) });
    }
    roster.forEach((r, k) => {
      const c = makeCar(r.car, r.color, { ai: true, name: r.name });
      const s = gridSlot(tr, k);
      placeCar(c, s.pos, s.yaw);
      const driver = new BotDriver(c, tr, opt.skill || 'normal', Math.random());
      bots.push({ car: c, driver, name: r.name });
      race.add(c, { name: r.name, bot: driver, color: r.color });
    });
    const ps = gridSlot(tr, n);
    spawnPlayerAt(ps.pos, ps.yaw);
    race.add(player, { name: cfg.name, isPlayer: true, color: sel.colors[selId()] });
    setMode(opt.mode);
    $('itemSlot').classList.toggle('hidden', !items.enabled);
    lap.start = 0; lap.best = null; lap.last = null; lap.count = 1;
    if (opt.mode === 'race') {
      race.start(2.4);
      state.intro = { t: 0, dur: 2.4 };
      $('lights').classList.remove('hidden');
      for (const l of $$('#lights .lamp')) l.className = 'lamp';
      $('lightsTxt').textContent = '';
    } else {
      race.start(0);
      race.cd = 2.99; // ohne Ampel losfahren
      state.intro = null;
    }
    if (audio && !audio.engine) attachSound(true);
    clock.getDelta();
  }

  async function startArena() {
    state.lastRace = null;
    await ensureAudio(false);
    showScreen('hud');
    await loadLevel('tal');
    clearCars(); removeRam();
    while (game.debris.length) removeDebris(game.debris.shift());
    items?.dispose(); items = null; race = null;
    props.reset();
    const A = game.track.extras.arena;
    spawnDummies();
    spawnPlayerAt(new THREE.Vector3(A.x, 0, A.z - A.r - 16), Math.PI);
    setMode('arena');
    toast('Crash-Arena: zerleg die fünf Autos!', 'gold');
    clock.getDelta();
  }
  function resetArena() {
    spawnDummies();
    props.reset();
    while (game.debris.length) removeDebris(game.debris.shift());
    toast('Arena zurückgesetzt');
  }

  function spawnLabCar() { spawnPlayerAt(labSpot(), Math.PI / 2); }
  async function startLab() {
    state.lastRace = null;
    await ensureAudio(false);
    showScreen('hud');
    await loadLevel('tal');
    clearCars(); removeRam();
    items?.dispose(); items = null; race = null;
    spawnLabCar();
    state.labDrive = false;
    state.orbit = { yaw: 0.9, pitch: 0.42, dist: 11 };
    setMode('lab');
    showScreen('hud');
    updateLabUi();
    clock.getDelta();
  }
  function setSlowmo(on) {
    state.timeScale = on ? 0.25 : 1;
    $('slowBtn')?.classList.toggle('on', on);
    toast(on ? 'Zeitlupe an' : 'Zeitlupe aus');
  }
  function updateLabUi() {
    $$('[data-zone]').forEach((b) => b.classList.toggle('active', b.dataset.zone === lab.zone));
    $$('[data-mass]').forEach((b) => b.classList.toggle('active', Number(b.dataset.mass) === lab.mass));
    $('speedVal').textContent = lab.speed + ' km/h';
    $('driveBtn').classList.toggle('on', state.labDrive);
    $('driveBtn').firstElementChild.textContent = state.labDrive ? 'Fahren: AN' : 'Selbst fahren';
  }
  $$('[data-zone]').forEach((b) => (b.onclick = () => { lab.zone = b.dataset.zone; updateLabUi(); }));
  $$('[data-mass]').forEach((b) => (b.onclick = () => { lab.mass = Number(b.dataset.mass); updateLabUi(); }));
  $('speed').oninput = (e) => { lab.speed = Number(e.target.value); updateLabUi(); };
  $('crashBtn').onclick = () => fireRam();
  $('repairBtn').onclick = () => { spawnLabCar(); state.labDrive = false; updateLabUi(); toast('Repariert', 'good'); };
  $('slowBtn').onclick = () => setSlowmo(state.timeScale === 1);
  $('driveBtn').onclick = () => { state.labDrive = !state.labDrive; updateLabUi(); };
  $('labBack').onclick = () => goMenu();
  function updateLabReadout() {
    const st = player.stats;
    const h = player.lastHit;
    $('labHit').textContent = h ? `${Math.round(h.speed)} km/h · Schwere ${Math.round(Math.min(1, h.s / 1.5) * 100)}%` : '–';
    $('labLoose').textContent = st.loose.length ? st.loose.join(', ') : '–';
    $('labLost').textContent = st.lost.length ? st.lost.join(', ') : '–';
    $('labTop').textContent = `~${Math.round(player.p.stats.speed * 330 * (0.55 + 0.45 * st.power / 100))} km/h`;
  }

  // ---- Hauptmenü mit Bot-Rennen im Hintergrund
  async function goMenu() {
    clearTimeout(resT);
    if (mp.online) netLeave();
    mp.inRace = false;
    state.paused = false;
    state.menuReturn = 'menu';
    showScreen('menu');
    renderDriver();
    if (audio) { audio.disposeEngine?.(); audio.rivalsClear(); }
    await loadLevel(level ? level.level.id : 'tal');
    startAttract();
  }
  function startAttract() {
    clearCars(); removeRam();
    while (game.debris.length) removeDebris(game.debris.shift());
    items?.dispose();
    items = new Items(game, game.track, { enabled: true });
    props.reset();
    const tr = game.track;
    race = new Race(tr, { laps: 99, mode: 'free' });
    for (let k = 0; k < 6; k++) {
      const id = CAR_ORDER[k % 3];
      const c = makeCar(id, pick(CARS[id].colors), { ai: true, name: BOT_NAMES[k] });
      const s = gridSlot(tr, k);
      placeCar(c, s.pos, s.yaw);
      const driver = new BotDriver(c, tr, k % 2 ? 'profi' : 'normal', Math.random());
      bots.push({ car: c, driver, name: BOT_NAMES[k] });
      race.add(c, { name: BOT_NAMES[k], bot: driver });
    }
    race.start(0); race.cd = 2.99;
    state.mode = 'menu';
    state.attract = { k: 0, t: 0, shot: 0, fixed: null };
    state.snapCam = true;
  }

  // ------------------------------------------------------------ Rennen: Ereignisse
  let resT = null;
  function useItem() {
    if (!player || !items || !player.item) return;
    if (player.itemRoll > 0) return;
    const e = race?.entryOf(player);
    const ahead = e && race.sorted ? race.sorted.find((o) => o.place === e.place - 1)?.car : null;
    items.use(player, ahead || null);
  }
  function resetPlayer() {
    if (!player) return;
    if (state.mode === 'lab' && !state.labDrive) { spawnLabCar(); toast('Auto zurückgesetzt'); return; }
    if ((state.mode === 'race' || state.mode === 'free') && race) {
      if (race.phase === 'countdown') return;
      const e = race.entryOf(player);
      const r = race.respawnPose(e, 4);
      placeCar(player, r.pos, r.yaw);
      player.gear = 1;
      toast('Zurück auf der Strecke');
      return;
    }
    player.resetUpright();
  }
  function respawnBot(car) {
    const e = race?.entryOf(car);
    if (!e) { car.resetUpright(); return; }
    const r = race.respawnPose(e, 6);
    placeCar(car, r.pos, r.yaw);
    car.gear = 1;
  }

  function handleRaceEvents() {
    if (!race) return;
    const inMenu = state.mode === 'menu';
    for (const ev of race.events) {
      if (inMenu) continue;
      if (ev.type === 'light') {
        $$('#lights .lamp').forEach((l, k) => (l.className = 'lamp' + (k < ev.n ? ' red' : '')));
        $('lightsTxt').textContent = String(4 - ev.n);
        const pods = [2, 4, 5][ev.n - 1];
        level.startLights.forEach((m, k) => { m.emissive.set(0xff2010); m.emissiveIntensity = k < pods ? 4 : 0; });
        audio?.sfx('beep');
      } else if (ev.type === 'go') {
        $$('#lights .lamp').forEach((l) => (l.className = 'lamp green'));
        $('lightsTxt').textContent = 'LOS!';
        level.startLights.forEach((m) => { m.emissive.set(0x30ff40); m.emissiveIntensity = 4; });
        audio?.sfx('go');
        setTimeout(() => $('lights').classList.add('hidden'), 1100);
        setTimeout(() => level?.startLights.forEach((m) => { m.emissiveIntensity = 0; }), 4000);
        // Start-Turbo
        if (player && state.mode === 'race') {
          const x = player.rpm / player.p.engine.redline;
          if (ctl.throttle > 0.3 && x > 0.5 && x < 0.86) { player.nitro = 1.3; bigMsg('PERFEKTER START!', '', 1.3); audio?.sfx('nitro'); }
          else if (x > 0.95) toast('Zu viel Gas beim Start!', 'bad');
        }
        for (const b of bots) if (Math.random() < 0.35) b.car.nitro = 0.8 + Math.random() * 0.5;
        lap.start = 0;
      } else if (ev.type === 'lap' && ev.e.isPlayer) {
        if (state.mode === 'free') {
          lap.last = ev.time; lap.count++;
          if (lap.best == null || ev.time < lap.best) lap.best = ev.time;
        }
        if (ev.best && (cfg.best[level.level.id] == null || ev.time < cfg.best[level.level.id])) { cfg.best[level.level.id] = ev.time; persist(); toast(`Streckenrekord ${fmt(ev.time)}!`, 'gold'); }
        else toast(`Runde ${fmt(ev.time)}`, ev.best ? 'gold' : '');
        if (state.mode === 'race' && ev.lap < race.laps - 1) audio?.sfx('lap');
      } else if (ev.type === 'final' && ev.e.isPlayer) {
        bigMsg('LETZTE RUNDE!', '', 1.8);
        audio?.sfx('final');
      } else if (ev.type === 'finish') {
        // Mehrspieler: eigene Autos melden ihren Zieleinlauf dem Server
        if (race.net && !ev.net && !ev.e.remote) mp.net?.send('fin', { id: ev.e.netId, time: ev.e.finishTime, best: ev.e.bestLap });
        if (ev.e.isPlayer && !ev.net) {
          const pl = ev.e.finishPlace;
          bigMsg(`ZIEL!<small>Platz ${pl} von ${race.entries.length}</small>`, '', 3);
          audio?.sfx('finish');
          playerAuto = new BotDriver(player, game.track, 'normal', 0.5);
          resT = setTimeout(showResults, 3200);
        } else if (ev.net && ev.e.remote && !ev.e.bot) toast(`${ev.e.name} ist im Ziel!`, 'gold');
        if (state.resultsShown) renderResults();
      } else if (ev.type === 'done') {
        if (!state.resultsShown) { clearTimeout(resT); resT = setTimeout(showResults, 600); }
      }
    }
    race.events.length = 0;
  }
  function handleItemEvents() {
    if (!items) return;
    const inMenu = state.mode === 'menu';
    for (const ev of items.events) {
      if (ev.type === 'boom') {
        const d = camera.position.distanceTo(ev.pos);
        if (!inMenu) { audio?.sfx('boom', ev.power * (1 / (1 + d / 40))); game.fx.shake = Math.min(1.4, game.fx.shake + Math.max(0, 1 - d / 35)); }
      }
      if (inMenu) continue;
      if (ev.type === 'pickup' && ev.car === player) { audio?.sfx('pickup'); }
      else if (ev.type === 'rolled' && ev.car === player) { audio?.sfx('got'); $('itemBox').classList.remove('ready'); void $('itemBox').offsetWidth; $('itemBox').classList.add('ready'); }
      else if (ev.type === 'use') {
        const near = ev.car === player || camera.position.distanceTo(ev.car.root.position) < 40;
        if (ev.item === 'repair' && !ev.remote) { const c = rebuildCar(ev.car); if (c === player) { toast('Repariert!', 'good'); } if (near) audio?.sfx('repair'); }
        if (!near) continue;
        if (ev.item === 'nitro') audio?.sfx('nitro');
        else if (ev.item === 'jump') audio?.sfx('jump');
        else if (ev.item === 'oil' || ev.item === 'barrel') audio?.sfx('drop');
        else if (ev.item === 'rocket') audio?.sfx('rocket');
        else if (ev.item === 'shock') { audio?.sfx('shock'); game.fx.shake = Math.min(1.2, game.fx.shake + 0.5); }
        else if (ev.item === 'armor') audio?.sfx('armor');
        if (ev.car === player && ev.item !== 'repair') toast(ITEMS[ev.item].name + '!', 'gold');
      } else if (ev.type === 'oil' && ev.car === player) { audio?.sfx('oil'); toast('Öl! Gegenlenken!', 'bad'); }
      else if (ev.type === 'hit' && ev.by === player && ev.car !== player) toast(`Treffer: ${ev.car.name || 'Gegner'}!`, 'good');
      else if (ev.type === 'hit' && ev.car === player && ev.by && ev.by !== player) toast(`Erwischt von ${ev.by.name || 'Gegner'}!`, 'bad');
    }
    items.events.length = 0;
  }
  function showResults() {
    if (state.resultsShown || state.mode !== 'race') return;
    state.resultsShown = true;
    renderResults();
    showScreen('results');
  }
  function renderResults() {
    if (!race) return;
    const res = race.results();
    const online = mp.online && race.net;
    $('rTrack').classList.toggle('hidden', !!online);
    $('rAgain').firstElementChild.textContent = online ? (mp.ended ? 'ZUR LOBBY' : 'RENNEN LÄUFT …') : 'NOCHMAL';
    $('rAgain').disabled = !!online && !mp.ended;
    const me = res.find((r) => r.isPlayer);
    const place = me ? me.place : 0;
    $('resPlace').textContent = place + '.';
    $('resTitle').textContent = place === 1 ? 'SIEG!' : place <= 3 ? 'PODIUM!' : place <= res.length / 2 ? 'STARK GEFAHREN!' : 'NÄCHSTES MAL!';
    $('resSub').textContent = `${LEVELS[level.level.id].name} · ${race.laps} ${race.laps === 1 ? 'Runde' : 'Runden'} · ${res.length} Fahrer`;
    $('resHead').querySelector('.trophy').style.visibility = place <= 3 ? 'visible' : 'hidden';
    const lead = res[0]?.time || 0;
    $('resTable').innerHTML = `<div class="h"><span>Platz</span><span>Fahrer</span><span>Auto</span><span>Zeit</span><span>Beste Runde</span></div>` +
      res.map((r, k) => `<div class="${r.isPlayer ? 'me' : ''}"><em>${r.place}</em><span class="nm"><i style="background:${r.color}"></i>${escapeHtml(r.name)}</span><span>${r.car}</span><span class="t">${k === 0 ? fmt(r.time) : (r.est ? '≈ ' : '') + '+' + (r.time - lead).toFixed(1) + ' s'}</span><span class="t">${fmt(r.best)}</span></div>`).join('');
  }

  // ------------------------------------------------------------ Mehrspieler
  async function netConnect() {
    if (mp.net?.connected) return true;
    const url = defaultServerUrl(cfg.server);
    if (!url) return false;
    let net = null;
    for (let k = 0; k < 2 && !net; k++) {
      const n = new Net();
      try { await n.connect(url, 6000); net = n; } catch { /* nochmal versuchen */ }
    }
    if (!net) return false;
    if (mp.net?.connected) { net.close(); return true; } // zwischenzeitlich doppelt geklickt
    mp.net = net; mp.me = net.id; mp.online = true; mp.room = null;
    net.on('room', onRoom).on('error', onNetError).on('load', (m) => startNetRace(m.race)).on('countdown', onCountdown)
      .on('s', onStates).on('ev', onNetEvent).on('fin', onNetFinish).on('end', onNetEnd).on('left', onLeft).on('close', onNetClose);
    return true;
  }
  function netLeave() {
    if (mp.net) { mp.net.send('leave'); mp.net.close(); }
    mp.net = null; mp.online = false; mp.room = null; mp.inRace = false; mp.pendingJoin = false; mp.raceInfo = null;
    for (const g of mp.ghosts.values()) disposeCar(g.car);
    mp.ghosts.clear();
  }
  function onRoom(m) {
    const first = !mp.room;
    mp.room = m;
    mp.pendingJoin = false;
    if (first) { state.menuReturn = 'lobby'; codeMsg(''); $('lbSettings').classList.add('hidden'); }
    if (first || state.screen === 'mp') showScreen('lobby');
    if (state.screen === 'lobby') renderLobby();
  }
  function onNetError(m) {
    audio?.sfx('error');
    if (state.screen === 'mp') codeMsg(escapeHtml(m.msg || 'Fehler'));
    else toast(m.msg || 'Fehler', 'bad');
  }
  function onNetClose() {
    const wasRace = mp.inRace;
    mp.net = null; mp.online = false; mp.room = null; mp.inRace = false;
    toast('Verbindung zum Server verloren', 'bad');
    if (wasRace || ['lobby', 'mp'].includes(state.screen)) goMenu();
  }
  const carByNet = (id) => race?.entries.find((x) => x.netId === id)?.car || null;
  function sendImpact(car, p, d, sp) {
    if (!mp.net || !mp.inRace) return;
    car.root.updateMatrixWorld(true);
    const lp = car.root.worldToLocal(p.clone());
    const inv = new THREE.Matrix4().copy(car.root.matrixWorld).invert();
    const ld = d.clone().transformDirection(inv);
    const r2 = (v) => Math.round(v * 100) / 100;
    mp.net.send('ev', { e: { type: 'imp', id: car.netId, p: [r2(lp.x), r2(lp.y), r2(lp.z)], d: [r2(ld.x), r2(ld.y), r2(ld.z)], s: r2(sp) } });
  }
  async function startNetRace(info) {
    mp.raceInfo = info; mp.inRace = true; mp.ended = false;
    state.lastRace = null;
    clearTimeout(resT);
    showScreen('hud');
    $('hud').classList.add('hidden');
    await ensureAudio(false);
    await loadLevel(info.level);
    if (!mp.inRace || mp.raceInfo !== info) return;
    $('hud').classList.remove('hidden');
    clearCars(); removeRam();
    while (game.debris.length) removeDebris(game.debris.shift());
    items?.dispose();
    items = new Items(game, game.track, { enabled: info.items });
    items.owned = (c) => !!c.netOwned;
    items.emit = (e) => mp.net?.send('ev', { e });
    props.reset();
    game.fx.skids.clear();
    const tr = game.track;
    race = new Race(tr, { laps: info.laps, mode: info.mode });
    race.net = true;
    for (const g of info.grid) {
      const slot = gridSlot(tr, g.slot);
      const mine = g.owner === mp.me;
      let car, driver = null;
      if (mine && !g.bot) { player = makeCar(g.car, g.color, { isPlayer: true, name: g.name }); car = player; }
      else if (mine) {
        car = makeCar(g.car, g.color, { ai: true, name: g.name });
        driver = new BotDriver(car, tr, info.skill, Math.random());
        bots.push({ car, driver, name: g.name });
      } else {
        car = makeCar(g.car, g.color, { remote: true, name: g.name });
        car.setNameTag(g.name, g.color);
        mp.ghosts.set(g.id, { car, snaps: [], offset: null, owner: g.owner, bot: g.bot, pose: null });
      }
      car.netId = g.id; car.netOwned = mine; car.netSound = g.sound || null;
      if (mine) car.onImpact = (p, d, sp) => sendImpact(car, p, d, sp);
      placeCar(car, slot.pos, slot.yaw);
      const e = race.add(car, { name: g.name, isPlayer: mine && !g.bot, bot: driver, color: g.color, remote: !mine, netId: g.id });
      e.bot = driver; e.isBot = g.bot;
    }
    if (player && audio) { audio.disposeEngine?.(); attachSound(true); }
    damageView.lastBody = 100;
    setMode(info.mode);
    $('itemSlot').classList.toggle('hidden', !items.enabled);
    race.start(999); // alle stehen, bis der Server die Ampel freigibt
    state.intro = null;
    mp.waiting = true;
    bigMsg('<small>Warte auf die anderen Fahrer …</small>', '', 120);
    mp.net?.send('ready', { race: info.id });
    clock.getDelta();
  }
  function onCountdown(m) {
    if (!race || !mp.inRace) return;
    for (const id of m.gone || []) removeNetCar(id);
    mp.waiting = false;
    $('bigMsg').classList.add('off');
    if (race.mode === 'race') {
      race.cd = -2.4;
      state.intro = { t: 0, dur: 2.4 };
      $('lights').classList.remove('hidden');
      for (const l of $$('#lights .lamp')) l.className = 'lamp';
      $('lightsTxt').textContent = '';
    } else race.cd = 2.99;
  }
  function onStates(m) {
    const now = performance.now();
    for (const raw of m.c) {
      const g = mp.ghosts.get(raw[0]);
      if (!g) continue;
      const st = unpackCar(raw);
      st.rt = now;
      const off = now - st.t;
      g.offset = g.offset == null ? off : Math.min(off, g.offset + 0.4);
      const last = g.snaps[g.snaps.length - 1];
      if (last && st.t <= last.t) continue;
      g.snaps.push(st);
      if (g.snaps.length > 30) g.snaps.shift();
      if (st.engineHp != null) g.car.engineHp = st.engineHp;
    }
  }
  // Lage eines entfernten Autos zur Zeit t (lokale ms): 110 ms Puffer, kurz hochrechnen
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  function ghostPose(g, t) {
    const S = g.snaps;
    if (!S.length || g.offset == null) return null;
    const target = t - 110 - g.offset;
    let a = S[0], b = null;
    for (let i = S.length - 1; i >= 0; i--) if (S[i].t <= target) { a = S[i]; b = S[i + 1] || null; break; }
    const out = g.tmp || (g.tmp = { p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), av: new THREE.Vector3() });
    if (b) {
      const k = (target - a.t) / Math.max(1, b.t - a.t);
      out.p.set(a.p.x + (b.p.x - a.p.x) * k, a.p.y + (b.p.y - a.p.y) * k, a.p.z + (b.p.z - a.p.z) * k);
      _q1.set(a.q.x, a.q.y, a.q.z, a.q.w); _q2.set(b.q.x, b.q.y, b.q.z, b.q.w);
      out.q.copy(_q1).slerp(_q2, k);
      out.v.set(b.v.x, b.v.y, b.v.z); out.av.set(b.av.x, b.av.y, b.av.z);
      Object.assign(out, { steer: b.steer, throttle: b.throttle, rpm: b.rpm, gear: b.gear, flame: b.flame, flags: b.flags });
    } else {
      const dt = Math.min(0.25, Math.max(0, (target - a.t) / 1000));
      out.p.set(a.p.x + a.v.x * dt, a.p.y + a.v.y * dt, a.p.z + a.v.z * dt);
      out.q.set(a.q.x, a.q.y, a.q.z, a.q.w);
      out.v.set(a.v.x, a.v.y, a.v.z); out.av.set(a.av.x, a.av.y, a.av.z);
      Object.assign(out, { steer: a.steer, throttle: a.throttle, rpm: a.rpm, gear: a.gear, flame: a.flame, flags: a.flags });
    }
    return out;
  }
  function onNetEvent(m) {
    const e = m.e;
    if (!race || !mp.inRace) return;
    if (e.type === 'imp') {
      const g = mp.ghosts.get(e.id);
      if (!g) return;
      const car = g.car;
      car.root.updateMatrixWorld(true);
      const wp = new THREE.Vector3(...e.p).applyMatrix4(car.root.matrixWorld);
      const wd = new THREE.Vector3(...e.d).transformDirection(car.root.matrixWorld);
      const sv = car.applyImpact(wp, wd, e.s);
      if (sv > 0) { const d = camera.position.distanceTo(wp); const loud = sv / (1 + d / 30); if (!frameCrash || loud > frameCrash.loud) frameCrash = { loud, s: sv }; }
      car.events.length = 0;
    } else if (e.type === 'rep') {
      const g = mp.ghosts.get(e.id);
      if (g) rebuildCar(g.car);
    } else items?.remote(e, carByNet);
  }
  function onNetFinish(m) {
    if (!race) return;
    const e = race.entries.find((x) => x.netId === m.id);
    race.netFinish(e, m.time, m.best, m.place);
  }
  function onNetEnd(m) {
    if (!race || !mp.inRace) return;
    for (const f of m.finished || []) onNetFinish(f);
    mp.ended = true;
    race.phase = 'done';
    clearTimeout(resT);
    if (state.resultsShown) renderResults();
    else resT = setTimeout(showResults, 900);
  }
  function removeNetCar(id) {
    const g = mp.ghosts.get(id);
    if (!g) return;
    const e = race?.entries.find((x) => x.netId === id);
    if (e) race.remove(e);
    disposeCar(g.car);
    mp.ghosts.delete(id);
  }
  function onLeft(m) {
    if (!mp.inRace || !race) return;
    const gone = [...mp.ghosts.entries()].filter(([id, g]) => id === m.id || (g.bot && g.owner === m.id)).map(([id]) => id);
    const name = race.entries.find((x) => x.netId === m.id)?.name;
    for (const id of gone) removeNetCar(id);
    if (name) toast(`${name} hat das Rennen verlassen`, 'bad');
  }
  async function backToLobby() {
    clearTimeout(resT);
    mp.inRace = false; mp.raceInfo = null;
    state.resultsShown = false;
    for (const g of mp.ghosts.values()) disposeCar(g.car);
    mp.ghosts.clear();
    startAttract();
    state.menuReturn = 'lobby';
    showScreen('lobby');
    renderLobby();
  }

  // ------------------------------------------------------------ HUD
  const mm = { cv: $('minimap'), ctx: $('minimap').getContext('2d') };
  function drawMinimap() {
    const tr = game.track; if (!tr) return;
    const W = mm.cv.width;
    if (!minimapBg) {
      minimapBg = document.createElement('canvas'); minimapBg.width = minimapBg.height = W;
      minimapBg.map = drawTrack(minimapBg, level.level.id, { line: '#ffffff', width: 0.055 });
    }
    const ctx = mm.ctx;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(minimapBg, 0, 0);
    const { sc, ox, oz } = minimapBg.map;
    if (items) for (const b of items.boxes) if (b.mesh.visible) { ctx.fillStyle = '#ffbf2e'; ctx.fillRect(ox + b.pos.x * sc - 4, oz + b.pos.z * sc - 4, 8, 8); }
    const list = race ? race.entries : [];
    for (const e of [...list].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0))) {
      const p = e.car.root.position;
      const x = ox + p.x * sc, y = oz + p.z * sc;
      if (e.isPlayer) {
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(e.car.root.quaternion);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(f.z, f.x));
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-12, 12); ctx.lineTo(-6, 0); ctx.lineTo(-12, -12); ctx.closePath();
        ctx.fillStyle = '#ffd23e'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#23264a'; ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = e.color || '#ff5a4a'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#23264a'; ctx.stroke();
      }
    }
  }
  let standT = 0, lastItemKey = '';
  function updateHud(dt) {
    if (!player) return;
    damageView.draw(player, dt);
    if (driving()) cluster.draw(player, dt);
    $('cluster').parentElement.classList.toggle('hidden', !driving());
    $('hint').classList.toggle('show', player.flipTimer > 1.2);
    const isRace = state.mode === 'race', isFree = state.mode === 'free';
    if ((isRace || isFree) && race) {
      const e = race.entryOf(player);
      if (e) {
        const lapNo = clamp(e.lap + 1, 1, race.laps);
        $('lapPill').textContent = isRace ? `RUNDE ${lapNo}/${race.laps}` : `RUNDE ${Math.max(1, e.lap + 1)}`;
        $('posBig').textContent = e.place + '.';
        $('posOf').textContent = '/ ' + race.entries.length;
        const tNow = race.phase === 'countdown' ? 0 : e.finished ? e.finishTime : race.time;
        $('tNow').textContent = isRace ? fmt(tNow) : fmt(race.phase === 'countdown' ? 0 : race.time - e.lapStart);
        $('tLast').textContent = fmt(e.lastLap);
        $('tBest').textContent = fmt(e.bestLap);
        if (e.wrong && !e.finished && race.phase === 'running') {
          if (!state.wrongShown) { bigMsg('FALSCHE RICHTUNG!', 'bad', 1.5); audio?.sfx('wrong'); state.wrongShown = true; setTimeout(() => (state.wrongShown = false), 1600); }
        }
      }
      standT -= dt;
      if (isRace && standT <= 0) {
        standT = 0.25;
        $('standings').innerHTML = (race.sorted || race.entries).map((o) => `<div class="${o.isPlayer ? 'me' : ''}"><em>${o.place}</em><i style="background:${o.color}"></i><span>${escapeHtml(o.name)}</span><small>${o.finished ? '🏁' : ''}</small></div>`).join('');
      }
      drawMinimap();
      // Power-up-Feld
      let key = 'empty';
      if (player.item) key = player.itemRoll > 0 ? 'roll' : 'item:' + player.item;
      if (key === 'roll') {
        const it = ITEM_ORDER[Math.floor(performance.now() / 90) % ITEM_ORDER.length];
        $('itemIcon').innerHTML = ITEM_ICONS[it];
        if (Math.floor(performance.now() / 90) !== state.lastTick) { state.lastTick = Math.floor(performance.now() / 90); audio?.sfx('tick'); }
      }
      if (key !== lastItemKey) {
        lastItemKey = key;
        const box = $('itemBox');
        box.classList.toggle('empty', key === 'empty');
        box.classList.toggle('rolling', key === 'roll');
        if (key === 'empty') { $('itemIcon').innerHTML = ''; $('itemName').textContent = ''; }
        else if (key.startsWith('item:')) { $('itemIcon').innerHTML = ITEM_ICONS[player.item]; $('itemName').textContent = ITEMS[player.item].name; }
        else $('itemName').textContent = '';
        $('itemKey').classList.toggle('hidden', !key.startsWith('item:'));
      }
    }
    if (isFree || state.mode === 'arena') $('driftTotal').textContent = drift.total.toLocaleString('de-DE');
    if (state.mode === 'lab') updateLabReadout();
  }
  function updateDrift(dt) {
    const el = $('drift');
    if (!(state.mode === 'free' || state.mode === 'arena')) { el.classList.remove('on'); return; }
    if (player.time - player.lastImpact < 0.05 && drift.active) {
      drift.active = false; drift.score = 0; drift.time = 0;
      el.classList.remove('on');
      toast('Drift verloren!', 'bad');
      return;
    }
    if (player.driftAngle > 12 && player.speed > 30 && !player.onGrass) {
      if (!drift.active) { drift.active = true; drift.score = 0; drift.time = 0; }
      drift.idle = 0;
      drift.time += dt;
      drift.mult = Math.min(5, 1 + Math.floor(drift.time / 1.8));
      drift.score += dt * player.driftAngle * player.speedMs * 0.09 * drift.mult;
    } else if (drift.active) {
      drift.idle += dt;
      if (drift.idle > 0.75) {
        drift.active = false;
        const pts = Math.round(drift.score);
        if (pts > 50) { drift.total += pts; toast(`+${pts.toLocaleString('de-DE')} Driftpunkte`, 'gold'); }
        drift.score = 0;
      }
    }
    el.classList.toggle('on', drift.active && drift.score > 20);
    if (drift.active) {
      $('driftScore').textContent = Math.round(drift.score).toLocaleString('de-DE');
      $('driftMult').textContent = '×' + drift.mult;
      $('driftAngle').textContent = Math.round(player.driftAngle) + '°';
    }
  }

  // ------------------------------------------------------------ Kamera
  const camPos = new THREE.Vector3(0, 10, 20);
  const camLook = new THREE.Vector3();
  const tmpF = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpS = new THREE.Vector3();
  function chaseTarget(car, out, look, far = false) {
    tmpF.set(0, 0, -1).applyQuaternion(car.root.quaternion).setY(0).normalize();
    const lin = car.body.linvel();
    tmpV.set(lin.x, 0, lin.z);
    const sp = tmpV.length();
    tmpD.copy(tmpF);
    if (sp > 4 && car.vLong > 1) tmpD.lerp(tmpV.normalize(), 0.3).normalize();
    const p = car.root.position;
    const stretch = clamp(car.accLong * 0.07, -0.5, 1.1);
    const dist = (far ? 9.8 : 6.6) + stretch, hgt = (far ? 3.9 : 2.6) - stretch * 0.15;
    out.copy(p).addScaledVector(tmpD, -dist);
    out.y = p.y + hgt;
    look.copy(p).addScaledVector(tmpD, 4);
    look.y = p.y - 0.55;
  }
  function updateCamera(dt) {
    let fovT = 60;
    if (state.mode === 'menu' && bots.length) {
      // Kino-Kamera: wechselnde Einstellungen
      const A = state.attract;
      A.t += dt;
      const tgt = bots[A.k % bots.length].car;
      const p = tgt.root.position;
      if (A.t > 7 || (A.shot === 1 && A.fixed && A.fixed.distanceTo(p) > 75 && A.t > 2)) {
        A.t = 0; A.k = (A.k + 1 + Math.floor(Math.random() * 2)) % bots.length; A.shot = (A.shot + 1) % 4; A.fixed = null; state.snapCam = true;
      }
      const car = bots[A.k % bots.length].car, cp = car.root.position;
      tmpF.set(0, 0, -1).applyQuaternion(car.root.quaternion).setY(0).normalize();
      tmpS.set(-tmpF.z, 0, tmpF.x);
      if (A.shot === 0) { tmpV.copy(cp).addScaledVector(tmpF, -7.5).addScaledVector(tmpS, 2.2); tmpV.y = cp.y + 1.8; camLook.copy(cp).addScaledVector(tmpF, 6); }
      else if (A.shot === 1) {
        if (!A.fixed) {
          const tr = game.track, n = tr.nearest(cp.x, cp.z, 2), j = (Math.max(0, n.i) + 70) % tr.N;
          A.fixed = tr.pts[j].clone().addScaledVector(tr.side[j], (tr.width / 2 + 5) * (Math.random() < 0.5 ? -1 : 1));
          A.fixed.y = tr.heightAt(A.fixed.x, A.fixed.z) + 1.6 + Math.random() * 2;
        }
        tmpV.copy(A.fixed); camLook.copy(cp);
      } else if (A.shot === 2) { tmpV.copy(cp).addScaledVector(tmpF, 9).addScaledVector(tmpS, -2.5); tmpV.y = cp.y + 1.3; camLook.copy(cp); }
      else { tmpV.copy(cp).addScaledVector(tmpF, -16).addScaledVector(tmpS, 10); tmpV.y = cp.y + 11; camLook.copy(cp).addScaledVector(tmpF, 10); }
      camPos.lerp(tmpV, state.snapCam ? 1 : A.shot === 1 ? 1 : 1 - Math.exp(-dt * 5));
      state.snapCam = false;
      camPos.y = Math.max(camPos.y, game.heightAt(camPos.x, camPos.z) + 0.8);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      fovT = A.shot === 1 ? 42 : 58;
    } else if (state.mode === 'lab' && !state.labDrive) {
      const p = player.root.position, o = state.orbit;
      tmpV.set(p.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, p.y + Math.sin(o.pitch) * o.dist, p.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
      tmpV.y = Math.max(tmpV.y, game.heightAt(tmpV.x, tmpV.z) + 0.5);
      camPos.lerp(tmpV, state.snapCam ? 1 : 1 - Math.exp(-dt * 8));
      state.snapCam = false;
      camera.position.copy(camPos);
      camLook.set(p.x, p.y + 0.2, p.z);
      camera.lookAt(camLook);
      fovT = 50;
    } else if (player) {
      const car = player;
      if (state.intro && state.intro.t < state.intro.dur + 2.2) {
        // Startaufstellung: von vorne an das Auto heranfliegen
        const I = state.intro;
        I.t += dt;
        const k = easeInOut(clamp((I.t - 0.4) / (I.dur + 1.4), 0, 1));
        chaseTarget(car, tmpV, camLook);
        tmpF.set(0, 0, -1).applyQuaternion(car.root.quaternion).setY(0).normalize();
        tmpS.set(-tmpF.z, 0, tmpF.x);
        const p = car.root.position;
        tmpD.copy(p).addScaledVector(tmpF, 11).addScaledVector(tmpS, 5); tmpD.y = p.y + 3.2;
        camPos.copy(tmpD).lerp(tmpV, k);
        camera.position.copy(camPos);
        tmpD.copy(p); tmpD.y += 0.4;
        camera.lookAt(tmpD.lerp(camLook, k));
        state.snapCam = false;
      } else if (state.cam === 2) {
        state.intro = null;
        const d = car.p.dims;
        camera.position.set(0, d.h / 2 + d.cabinH * 0.75, d.cabinZ - d.cabinL * 0.15);
        car.root.localToWorld(camera.position);
        tmpV.set(0, d.h / 2 + d.cabinH * 0.55, -30);
        car.root.localToWorld(tmpV);
        camera.lookAt(tmpV);
        camPos.copy(camera.position);
      } else {
        state.intro = null;
        const far = state.cam === 1;
        chaseTarget(car, tmpV, camLook, far);
        camPos.lerp(tmpV, state.snapCam ? 1 : 1 - Math.exp(-dt * (far ? 4.5 : 7)));
        state.snapCam = false;
        camPos.y = Math.max(camPos.y, game.heightAt(camPos.x, camPos.z) + 0.6);
        camera.position.copy(camPos);
        camera.lookAt(camLook);
      }
      fovT = 60 + clamp(car.speed - 40, 0, 220) * 0.095 + clamp(car.accLong, 0, 12) * 0.45 + (car.nitro > 0 ? 9 : 0);
      if (cfg.shake && car.speed > 110 && state.cam !== 2) camera.position.add(tmpV.set(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar((car.speed - 110) * 0.00025));
    }
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3);
    const sh = game.fx.shake;
    if (sh > 0) camera.position.add(tmpV.set((Math.random() - 0.5) * sh * 0.3, (Math.random() - 0.5) * sh * 0.25, (Math.random() - 0.5) * sh * 0.3));
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ Hauptschleife
  let acc = 0, hudT = 0, rivalT = 0;
  const botCtx = { cars: [], myProg: 0, running: false, rubber: 1, water: null, respawn: respawnBot, useItem: null };
  function frame() {
    requestAnimationFrame(frame);
    const rdt = Math.min(clock.getDelta(), 0.05);
    const now = clock.elapsedTime;
    readInput(rdt);

    if (state.screen === 'garage') {
      turntable.rotation.y += rdt * 0.32;
      if (slide) {
        slide.t = Math.min(1, slide.t + rdt / 0.6);
        const e = easeInOut(slide.t);
        const tr = turntable.rotation.y;
        const toLocal = (x) => new THREE.Vector3(x, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -tr);
        if (outgoing) outgoing.position.copy(toLocal(-slide.dir * 12 * e));
        showModel.position.copy(toLocal(slide.dir * 12 * (1 - e)));
        if (slide.t >= 1) { if (outgoing) turntable.remove(outgoing); outgoing = null; showModel.position.set(0, 0, 0); slide = null; }
      }
      composer.render();
      return;
    }
    if (!game.world || !level || state.loading) { if (level && !state.loading) composer.render(); return; }

    const paused = state.paused || state.screen === 'loading';
    const dt = paused ? 0 : rdt * state.timeScale * (state.simMul || 1);
    if (dt > 0) {
      // Eingaben
      if (player) {
        if (playerAuto) { /* nach dem Ziel fährt der Bot */ }
        else if (driving()) Object.assign(player.input, ctl);
        else Object.assign(player.input, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
        if (state.mode === 'race' && race?.phase === 'countdown') Object.assign(player.input, { throttle: ctl.throttle, brake: 0, steer: 0, handbrake: 0 });
      }
      // Rennen + Bots
      if (race) {
        race.update(dt);
        const N = game.track.N;
        botCtx.cars = race.entries.map((o) => ({ car: o.car, prog: race.progressM(o) }));
        botCtx.running = race.phase === 'running' || race.phase === 'done';
        botCtx.water = game.waterLevel ?? null;
        const pe = race.entryOf(player);
        for (const e of race.entries) {
          const drv = e.isPlayer ? playerAuto : e.bot;
          if (!drv) continue;
          botCtx.myProg = race.progressM(e);
          botCtx.rubber = 1;
          if (pe && !e.isPlayer && state.mode === 'race' && !mp.inRace) {
            const gap = (e.total - pe.total) * 0.8;
            botCtx.rubber = gap > 140 ? 0.94 : gap < -160 ? 1.05 : 1;
          }
          botCtx.rev = race.phase === 'countdown' && Math.random() < 0.3 ? Math.random() : 0;
          botCtx.useItem = (c) => {
            const ahead = race.sorted ? race.sorted.find((o) => o.place === e.place - 1)?.car : null;
            items?.use(c, ahead || null);
          };
          drv.update(dt, botCtx);
          if (e.isPlayer && (player.flipTimer > 1.5)) resetPlayer();
        }
        void N;
      }
      if (items) {
        const n = race ? race.entries.length : 1;
        const list = race ? race.entries.map((e) => ({ car: e.car, rankFrac: (e.place - 1) / Math.max(1, n - 1), isPlayer: e.isPlayer })) : [];
        items.update(dt, list);
      }
      // Physik
      acc += dt;
      const h = game.world.timestep;
      let steps = 0;
      const cars = allCars().filter((c) => !c.remote);
      const maxSteps = 8 * (state.simMul || 1);
      const nSteps = Math.min(maxSteps, Math.floor(acc / h + 1e-9));
      const tNow = performance.now();
      while (acc >= h && steps < maxSteps) {
        for (const c of cars) { c.storePreStep(); c.physicsStep(h); }
        for (const g of mp.ghosts.values()) { const ps = ghostPose(g, tNow - (nSteps - 1 - steps) * h * 1000); if (ps) { g.car.setNetPose(ps.p, ps.q); g.pose = ps; } }
        if (ram) { const v = ram.body.linvel(); ram.prev = new THREE.Vector3(v.x, v.y, v.z); }
        game.world.step(eventQueue);
        handleContacts(now);
        acc -= h;
        steps++;
      }
      if (steps >= maxSteps) acc = 0;
      for (const g of mp.ghosts.values()) if (g.pose) g.car.ghostPrep(g.pose, dt);
      for (const c of allCars()) c.update(dt);
      props.update();
      for (const d of game.debris) {
        const t = d.body.translation(), r = d.body.rotation();
        d.obj.position.set(t.x, t.y, t.z);
        d.obj.quaternion.set(r.x, r.y, r.z, r.w);
      }
      if (ram) {
        ram.t += dt;
        const t = ram.body.translation(), r = ram.body.rotation();
        ram.mesh.position.set(t.x, t.y, t.z);
        ram.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        if (ram.t > 4) removeRam();
      }
      game.fx.update(dt);
    }
    level.update(rdt, now, camera);
    // Eigene Autos an die anderen schicken (20× pro Sekunde)
    if (mp.inRace && mp.net && race) {
      mp.sendT -= rdt;
      if (mp.sendT <= 0) {
        mp.sendT = 0.05;
        const t = performance.now(), c = [];
        for (const e of race.entries) if (!e.remote && e.netId && !e.car.disposed) c.push(packCar(e.netId, e.car, t));
        if (c.length) mp.net.send('s', { c });
      }
    }

    // Ereignisse -> Sound + Meldungen
    const inMenu = state.mode === 'menu';
    for (const c of allCars()) {
      for (const e of c.events) {
        if (c !== player || inMenu) continue;
        const real = audio?.engine?.kind === 'loops';
        if (e.type === 'pop') { if (!real) audio?.pop(e.strength); }
        else if (e.type === 'blowoff') { if (!real) audio?.blowoff(e.amount, e.flutter); }
        else if (e.type === 'shift') audio?.shift(e.up);
        else if (e.type === 'glass') audio?.glass();
        else if (e.type === 'scrape') audio?.scrape();
        else if (e.type === 'crash' && state.mode !== 'race') for (const l of e.labels) toast(l, 'bad');
      }
      c.events.length = 0;
    }
    handleRaceEvents();
    handleItemEvents();
    if (frameCrash) { if (!inMenu) audio?.crash(frameCrash.loud); frameCrash = null; }
    if (audio && player && !inMenu) audio.update(player, !paused, rdt);
    else if (audio && audio.engine && inMenu) audio.disposeEngine?.();
    // Gegner-Motoren
    rivalT -= rdt;
    if (audio && rivalT <= 0) {
      rivalT = 1 / 20;
      if (inMenu || paused || !player || !soundBanks) audio.rivalUpdate([], 0);
      else {
        const pp = player.root.position;
        const cand = allCars().filter((c) => c !== player && !dummies.includes(c)).map((c) => ({ car: c, d: c.root.position.distanceTo(pp) })).filter((r) => r.d < 120).sort((a, b) => a.d - b.d);
        const keepNow = audio.rivals ? [...audio.rivals.keys()] : [];
        const sel3 = cand.filter((r, k) => k < 3 || (keepNow.includes(r.car) && r.d < 130 && k < 4));
        audio.rivalUpdate(sel3.map((r) => ({ car: r.car, d: r.d, id: r.car.netSound || r.car.p.sound })), 1 / 20);
      }
    }

    if (player) {
      exhaustLight.intensity = player.flame * 6;
      if (player.exhausts.length) { exhaustLight.position.copy(player.exhausts[0]); player.root.localToWorld(exhaustLight.position); }
      if (state.mode === 'free' || state.mode === 'arena') updateDrift(dt);
    }
    hudT -= rdt;
    if (hudT <= 0 && !inMenu) { hudT = 1 / 30; updateHud(1 / 30); }

    updateCamera(rdt);
    const focus = player ? player.root.position : camLook;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(game.sunDir, 220);
    composer.render();
  }

  window.addEventListener('resize', () => {
    setScale();
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = showCam.aspect = w / h;
    camera.updateProjectionMatrix();
    showCam.updateProjectionMatrix();
  });

  renderDriver();
  await loadLevel('tal');
  startAttract();
  showScreen('menu');
  // Einladungslink: ?raum=CODE öffnet direkt den Beitritt
  const invite = new URLSearchParams(location.search).get('raum');
  if (invite && /^[A-Za-z0-9]{5}$/.test(invite)) openMp(invite.toUpperCase());
  window.__game = {
    game, get player() { return player; }, get audio() { return audio; }, get race() { return race; }, get items() { return items; }, state, lab, sp, lobby,
    fireRam, startRace, startLab, startArena, goMenu, switchCar, openSp, openMp, createRoom, openGarage, openInfo, openSettings, showResults, keys, ctl, setPause,
    bots: () => bots, setSlowmo, useItem, mp,
    autopilot: (skill = 'profi') => { playerAuto = new BotDriver(player, game.track, skill, 0.3); },
    set simMul(v) { state.simMul = v; },
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) { el.classList.remove('hidden'); el.innerHTML = '<div class="err">Das Spiel konnte nicht starten.<br><small>' + String(err && err.message ? err.message : err) + '</small></div>'; }
});
