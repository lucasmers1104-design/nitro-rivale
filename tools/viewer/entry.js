import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCarModel, deformMesh } from '../../src/car.js';
import { CARS } from '../../src/presets.js';

const q = new URLSearchParams(location.search);
const id = q.get('car') || 'brutus';
const color = '#' + (q.get('color') || CARS[id].colors[0].slice(1));
const dmg = q.get('dmg');
const views = (q.get('views') || '35,18;145,18;90,6;0,10;180,10;40,55').split(';').map((s) => s.split(',').map(Number));
const cols = +(q.get('cols') || 3), rows = Math.ceil(views.length / cols);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa3b8);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x54584f, 0.9));
const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
sun.position.set(-6, 9, -5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun);
const p = CARS[id];
const m = buildCarModel(p, color, env);
for (const w of m.wheels) w.hold.position.y = -p.wheel.rest * 0.5;
const gy = m.anchorY - p.wheel.rest * 0.5 - p.wheel.r;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b5e63, roughness: 0.9 }));
ground.position.y = gy; ground.receiveShadow = true;
scene.add(ground, m.root);
if (q.get('steer')) for (const w of m.wheels) if (w.front) w.pivot.rotation.y = +q.get('steer');
let tris = 0, verts = 0, meshes = 0;
m.root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; verts += g.attributes.position.count; } });
window.__info = { tris, verts, meshes, deform: m.deformables.length, parts: m.parts.map((x) => x.id) };
if (q.get('lose')) for (const id of q.get('lose').split(',')) { const pt = m.parts.find((x) => x.id === id); if (pt) pt.obj.visible = false; }
if (q.get('loose')) for (const id of q.get('loose').split(',')) { const pt = m.parts.find((x) => x.id === id); if (pt) pt.pivot.rotation[pt.axis] = pt.looseAngle; }
if (dmg) {
  m.root.updateMatrixWorld(true);
  const hits = { front: [[0.3, 0, -p.dims.l / 2], [0, 0, 1], 0.45, 1.3], side: [[p.dims.w / 2, 0, 0.2], [-1, 0, 0], 0.4, 1.2], rear: [[-0.4, 0.1, p.dims.l / 2], [0, 0, -1], 0.4, 1.2], roof: [[0, 1, p.dims.cabinZ], [0, -1, 0], 0.3, 1.1] };
  for (const k of dmg.split(',')) { const [pos, dir, depth, rad] = hits[k]; for (const d of m.deformables) deformMesh(d, new THREE.Vector3(...pos), new THREE.Vector3(...dir), depth, rad); }
}
const cam = new THREE.PerspectiveCamera(+(q.get('fov') || 32), 1, 0.1, 100);
const look = (q.get('look') || '0,0.05,0').split(',').map(Number);
const W = innerWidth / cols, H = innerHeight / rows, dist = +(q.get('dist') || 9.5);
renderer.setScissorTest(true);
views.forEach(([az, el, d], i) => {
  const c = i % cols, r = Math.floor(i / cols);
  renderer.setViewport(c * W, innerHeight - (r + 1) * H, W, H);
  renderer.setScissor(c * W, innerHeight - (r + 1) * H, W, H);
  cam.aspect = W / H; cam.updateProjectionMatrix();
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, dd = d || dist;
  cam.position.set(look[0] + Math.sin(a) * Math.cos(e) * dd, look[1] + Math.sin(e) * dd, look[2] - Math.cos(a) * Math.cos(e) * dd);
  cam.lookAt(look[0], look[1], look[2]);
  renderer.render(scene, cam);
});
window.__done = true;
