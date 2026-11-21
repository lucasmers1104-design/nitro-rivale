// Entwickler-Ansicht: ein Auto aus mehreren Blickwinkeln (für Screenshots der Modelle)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCarModel } from '../src/carmodel.js';
import { CARS } from '../src/presets.js';

const q = new URLSearchParams(location.search);
const id = q.get('car') || 'brutus';
const color = q.get('color') || CARS[id].colors[0];
let tune = null;
try { tune = q.get('tune') ? JSON.parse(q.get('tune')) : null; } catch { tune = null; }
const W = +(q.get('w') || 1500), H = +(q.get('h') || 900);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8b93a6);
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa1ae, roughness: 0.8 }));
floor.receiveShadow = true;
scene.add(floor);
const key = new THREE.DirectionalLight(0xfff1de, 2.6);
key.position.set(4, 9, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
key.shadow.bias = -0.0006;
scene.add(key, new THREE.HemisphereLight(0xc8d4f0, 0x50586a, 1.2));
const fill = new THREE.DirectionalLight(0x9ab8ff, 0.8);
fill.position.set(-5, 3, -4);
scene.add(fill);

const p = CARS[id];
const m = buildCarModel(p, color, envMap, tune);
for (const w of m.wheels) w.hold.position.y = -p.wheel.rest * 0.45;
m.root.position.y = -(m.anchorY - p.wheel.rest * 0.45 - p.wheel.r);
m.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
for (const f of m.flames || []) f.visible = false;
if (m.fire) m.fire.visible = false;
scene.add(m.root);

const L = p.dims.l, cy = 0.75;
const views = [
  [[-4.6, 2.0, -5.2], [0, cy - 0.15, 0], 34],      // vorne links 3/4
  [[4.8, 2.2, 5.0], [0, cy - 0.15, 0], 34],         // hinten rechts 3/4
  [[-9.5, 1.0, 0.001], [0, cy - 0.1, 0], 30],        // Seite
  [[0.001, 1.0, -8.5], [0, cy - 0.15, 0], 26],       // vorne
  [[0.001, 1.3, 8.5], [0, cy - 0.15, 0], 26],        // hinten
  [[3.2, 6.6, -2.4], [0, 0.4, 0.1], 38],            // oben
];
const hero = q.get('view') === 'hero';
if (hero) {
  scene.background = new THREE.Color(0x1b2a5a);
  floor.material.color.set(0x2a3a70); floor.material.roughness = 0.35; floor.material.metalness = 0.4;
  const yaw = +(q.get('yaw') || 0.62);
  views.length = 0;
  const d = 7.4 * (L / 4.6) ** 0.7 * (1 + Math.max(0, p.dims.h + p.dims.cabinH - 1.1) * 0.3);
  views.push([[Math.sin(yaw) * -d, 1.55 + (p.dims.h + p.dims.cabinH) * 0.35, Math.cos(yaw) * -d], [0, 0.55 + (p.dims.h + p.dims.cabinH) * 0.18, 0], 30]);
}
const cols = hero ? 1 : 3, rows = hero ? 1 : 2, vw = W / cols, vh = H / rows;
const cam = new THREE.PerspectiveCamera(34, vw / vh, 0.1, 100);
renderer.setScissorTest(true);
views.forEach(([pos, look, fov], i) => {
  const x = (i % cols) * vw, y = H - (Math.floor(i / cols) + 1) * vh;
  renderer.setViewport(x, y, vw, vh);
  renderer.setScissor(x, y, vw, vh);
  cam.fov = fov * (L / 4.6) ** 0.35;
  cam.position.set(...pos);
  cam.lookAt(...look);
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
});
window.__done = true;
