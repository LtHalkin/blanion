// Developer view: every 3D model in one scene. /weigh-gallery.html (?ids=elephant,egg to show a subset)
import { buildModel, MODEL_IDS, T } from '/weigh-models.js';
const canvas = document.getElementById('c');
const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight, false); renderer.setClearColor('#0a2a52');
const scene = new T.Scene();
scene.add(new T.HemisphereLight('#bfe6ff', '#1b3a5c', 1.0)); const d = new T.DirectionalLight('#fff2d0', 1.6); d.position.set(4, 8, 6); scene.add(d);
const q = new URLSearchParams(location.search).get('ids');
const ids = q ? q.split(',') : MODEL_IDS;
const cols = Math.min(ids.length, 8), rows = Math.ceil(ids.length / cols), gap = 1.9;
const items = [];
ids.forEach((id, i) => {
  const m = buildModel(id, 1.5); m.position.set((i % cols - (cols - 1) / 2) * gap, -Math.floor(i / cols) * gap, 0); m.rotation.y = -0.6; scene.add(m);
  const l = document.createElement('div'); l.className = 'l'; l.textContent = id; document.body.appendChild(l); items.push({ m, l });
});
const cam = new T.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const w = cols * gap, h = rows * gap;
cam.position.set(0, -(rows - 1) * gap / 2 + 1.4, Math.max(w / (2 * Math.tan(15 * Math.PI / 180) * cam.aspect), h / (2 * Math.tan(15 * Math.PI / 180))) + 1.5);
cam.lookAt(0, -(rows - 1) * gap / 2 + 0.6, 0);
const v = new T.Vector3();
function render() {
  items.forEach(({ m, l }) => { v.copy(m.position); v.y -= 0.15; v.project(cam); l.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px'; l.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px'; });
  renderer.render(scene, cam); window.__ready = true;
}
render();
