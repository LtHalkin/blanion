/* BLANION WEIGH-IN — low-poly 3D models built from primitives (no external assets).
 * buildModel(id) -> Group, normalised so its largest dimension is 1 and it stands on y = 0, centred on x/z. Animals face +x. */
import * as T from '/vendor/three-lite.min.js';

const UP = new T.Vector3(0, 1, 0);
const mats = new Map();
function mat(color, o) {
  const key = color + (o ? JSON.stringify(o) : '');
  if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, flatShading: true, ...(o || {}) }));
  return mats.get(key);
}
const place = (m, p) => { if (p) m.position.set(p[0], p[1], p[2]); return m; };
const box = (w, h, d, c, p, o) => place(new T.Mesh(new T.BoxGeometry(w, h, d), mat(c, o)), p);
const ball = (r, c, p, s, o) => { const m = place(new T.Mesh(new T.SphereGeometry(r, 12, 9), mat(c, o)), p); if (s) m.scale.set(s[0], s[1], s[2]); return m; };
const cyl = (rt, rb, h, c, p, o, seg) => place(new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 12), mat(c, o)), p);
const cone = (r, h, c, p, seg) => place(new T.Mesh(new T.ConeGeometry(r, h, seg || 9), mat(c)), p);
const torus = (r, t, c, p, o) => place(new T.Mesh(new T.TorusGeometry(r, t, 6, 16), mat(c, o)), p);
/** tapered cylinder between two points */
function seg(a, b, ra, rb, c, o) {
  const A = new T.Vector3(...a), B = new T.Vector3(...b), dir = B.clone().sub(A), len = dir.length();
  const m = new T.Mesh(new T.CylinderGeometry(rb, ra, len, 9), mat(c, o));
  m.position.copy(A).addScaledVector(dir, 0.5); m.quaternion.setFromUnitVectors(UP, dir.normalize()); return m;
}
const rot = (m, x, y, z) => { m.rotation.set(x || 0, y || 0, z || 0); return m; };
/** add a child and return the CHILD (Group.add returns the group, which is a classic trap) */
const put = (g, m) => { g.add(m); return m; };
const group = (...kids) => { const g = new T.Group(); kids.flat().forEach(k => k && g.add(k)); return g; };
const eye = (x, y, z, r) => ball(r || 0.035, '#12161d', [x, y, z]);

/* ------------------------------------------------------------------ animals */
function quad(o) {
  const { c, L = 1.6, H = 0.8, W = 0.7, legL = 0.6, legR = 0.12, leg = c, hr = 0.28, neck = [0.25, 0.25], neckR = 0.2, headScale = [1, 1, 1] } = o;
  const g = new T.Group(), by = legL + H * 0.5;
  g.add(ball(1, c, [0, by, 0], [L / 2, H / 2, W / 2]));
  for (const x of [-L * 0.3, L * 0.3]) for (const z of [-W * 0.32, W * 0.32]) {
    g.add(seg([x, by - H * 0.15, z], [x, legR * 0.8, z], legR * 1.15, legR * 0.9, leg));
    g.add(ball(legR * 1.05, o.hoof || leg, [x + legR * 0.35, legR * 0.7, z], [1.35, 0.7, 1]));
  }
  const sh = [L * 0.4, by + H * 0.2, 0], hd = [sh[0] + neck[0], sh[1] + neck[1], 0];
  if (neck[1] > 0.05 || neck[0] > 0.05) g.add(seg(sh, hd, neckR * 1.2, neckR, c));
  g.add(ball(hr, o.headC || c, hd, headScale));
  if (o.snout) g.add(ball(o.snout.r, o.snout.c || o.headC || c, [hd[0] + o.snout.dx, hd[1] + (o.snout.dy || -0.05), 0], o.snout.s || [1.2, 0.85, 0.9]));
  g.add(eye(hd[0] + hr * 0.62, hd[1] + hr * 0.3, hr * 0.5, hr * 0.14)); g.add(eye(hd[0] + hr * 0.62, hd[1] + hr * 0.3, -hr * 0.5, hr * 0.14));
  if (o.ear) for (const z of [-1, 1]) g.add(ball(o.ear.r, o.ear.c || c, [hd[0] - hr * 0.1 + (o.ear.dx || 0), hd[1] + (o.ear.dy ?? hr * 0.7), z * hr * (o.ear.dz || 0.8)], o.ear.s || [0.7, 1, 0.5]));
  if (o.tail !== false) { const t = o.tail || {}; g.add(seg([-L * 0.46, by + H * 0.15, 0], [-L * 0.46 - (t.dx ?? 0.3), by + H * 0.15 - (t.dy ?? 0.25), 0], 0.06, 0.035, t.c || c)); if (t.tuft) g.add(ball(0.07, t.tuft, [-L * 0.46 - (t.dx ?? 0.3), by + H * 0.15 - (t.dy ?? 0.25) - 0.05, 0])); }
  if (o.extras) o.extras(g, { by, L, H, W, legL, sh, hd, hr });
  return g;
}

function humanoid(o) {
  const { skin = '#e0b48c', shirt = '#3b78c4', pants = '#2b3144', legLen = 0.9, bulk = 1, headR = 0.22, hair = '#4a3322', belly = 0, torsoLen = 0.5, armLen = 0.7, stance = 0.16, shoes = '#1d1d22' } = o;
  const g = new T.Group(), hipY = legLen, shY = legLen + torsoLen + 0.12;
  for (const z of [-1, 1]) {
    g.add(seg([0, hipY, z * stance], [0, 0.07, z * stance * 1.15], 0.1 * bulk, 0.075 * bulk, pants));
    g.add(box(0.28, 0.08, 0.13 * bulk + 0.03, shoes, [0.07, 0.04, z * stance * 1.15]));
  }
  g.add(new T.Mesh(new T.CapsuleGeometry(0.2 * bulk, torsoLen, 4, 10), mat(shirt))); g.children[g.children.length - 1].position.set(0, hipY + torsoLen / 2 + 0.12, 0); g.children[g.children.length - 1].scale.set(0.8, 1, 1.1);
  if (belly) g.add(ball(belly, shirt, [0.1, hipY + 0.28, 0], [0.95, 0.9, 1.05]));
  for (const z of [-1, 1]) {
    g.add(seg([0, shY, z * 0.24 * bulk], [0.05, shY - armLen * 0.9, z * (0.3 * bulk + 0.04)], 0.07 * bulk, 0.055, o.sleeve || shirt));
    g.add(ball(0.065, skin, [0.05, shY - armLen * 0.95, z * (0.3 * bulk + 0.04)]));
  }
  const hy = shY + headR + 0.06;
  g.add(ball(headR, skin, [0.02, hy, 0]));
  if (hair) g.add(ball(headR * 1.04, hair, [-0.015, hy + headR * 0.28, 0], [1, 0.7, 1.02]));
  g.add(eye(0.02 + headR * 0.9, hy + 0.02, 0.07, 0.025)); g.add(eye(0.02 + headR * 0.9, hy + 0.02, -0.07, 0.025));
  if (o.extras) o.extras(g, { hy, hipY, shY, headR });
  return g;
}

const MODELS = {
  elephant: () => quad({
    c: '#8c96a5', L: 2.3, H: 1.25, W: 1.05, legL: 0.95, legR: 0.24, hr: 0.5, neck: [0.45, 0.12], neckR: 0.36, headScale: [1, 1.05, 1.05], hoof: '#c9c3b8', tail: { dx: 0.15, dy: 0.7, c: '#7a8493', tuft: '#5d6573' },
    extras(g, { hd, hr }) {
      for (const z of [-1, 1]) { g.add(ball(0.5, '#7d8796', [hd[0] - 0.12, hd[1] + 0.1, z * (hr + 0.2)], [0.18, 1, 0.95])); g.add(cone(0.07, 0.6, '#f3ecd8', [hd[0] + 0.4, hd[1] - 0.45, z * 0.28])); g.children[g.children.length - 1].rotation.set(0, 0, -2.2); }
      let p = [hd[0] + hr * 0.8, hd[1] - 0.05, 0];
      const pts = [p, [p[0] + 0.28, p[1] - 0.3, 0], [p[0] + 0.45, p[1] - 0.65, 0], [p[0] + 0.55, p[1] - 0.95, 0], [p[0] + 0.5, p[1] - 1.1, 0]];
      for (let i = 0; i < pts.length - 1; i++) g.add(seg(pts[i], pts[i + 1], 0.17 - i * 0.025, 0.145 - i * 0.025, '#8c96a5'));
    },
  }),
  hippo: () => quad({
    c: '#a79199', L: 2.0, H: 1.0, W: 1.1, legL: 0.38, legR: 0.22, hr: 0.46, neck: [0.55, 0.02], neckR: 0.42, headScale: [1.15, 0.9, 1.15], tail: { dx: 0.15, dy: 0.1 },
    snout: { r: 0.4, dx: 0.42, dy: -0.12, s: [1.0, 0.7, 1.35], c: '#b9a1a7' },
    extras(g, { hd, hr }) { for (const z of [-1, 1]) { g.add(ball(0.09, '#a79199', [hd[0] + 0.05, hd[1] + hr * 0.95, z * 0.24])); g.add(ball(0.07, '#a79199', [hd[0] - 0.28, hd[1] + hr * 0.7, z * 0.34], [0.7, 1, 0.5])); g.add(ball(0.045, '#4a3a40', [hd[0] + 0.82, hd[1] + 0.0, z * 0.22])); } },
  }),
  giraffe: () => quad({
    c: '#e6b04c', L: 1.4, H: 0.72, W: 0.5, legL: 1.15, legR: 0.075, leg: '#e6b04c', hr: 0.17, neck: [0.55, 1.55], neckR: 0.11, headScale: [1.5, 0.9, 0.9], hoof: '#4a3322', tail: { dx: 0.05, dy: 0.5, tuft: '#4a3322' },
    snout: { r: 0.1, dx: 0.17, dy: -0.04, c: '#e6b04c' }, ear: { r: 0.08, c: '#c78a2c', dy: 0.1, dz: 1.2, s: [0.4, 1, 0.8] },
    extras(g, { by, L, hd, sh }) {
      for (const z of [-1, 1]) { g.add(cyl(0.025, 0.025, 0.16, '#4a3322', [hd[0] - 0.04, hd[1] + 0.2, z * 0.07])); g.add(ball(0.04, '#4a3322', [hd[0] - 0.04, hd[1] + 0.29, z * 0.07])); }
      const spots = [[0.1, 0.1, 0.25], [-0.25, 0.05, 0.22], [0.4, -0.1, 0.2], [-0.5, 0.15, 0.2], [0.0, -0.2, -0.24], [0.3, 0.12, -0.23], [-0.3, -0.05, -0.25], [-0.55, -0.1, -0.2]];
      for (const [x, y, z] of spots) g.add(ball(0.11, '#a8692a', [x, by + y, z], [1, 0.9, 0.35]));
      for (let i = 0; i < 6; i++) g.add(ball(0.09, '#a8692a', [sh[0] + 0.55 * (i / 6) + 0.05, sh[1] + 1.55 * (i / 6), (i % 2 ? 1 : -1) * 0.085], [1, 1.3, 0.4]));
    },
  }),
  polarbear: () => quad({
    c: '#f3f6f8', L: 1.7, H: 0.85, W: 0.8, legL: 0.5, legR: 0.19, hr: 0.3, neck: [0.4, 0.1], neckR: 0.28, headScale: [1.05, 0.95, 1], hoof: '#e4e9ee', tail: { dx: 0.1, dy: 0.05 },
    snout: { r: 0.17, dx: 0.3, dy: -0.06, s: [1.5, 0.85, 0.9] }, ear: { r: 0.07, c: '#e4e9ee', dy: 0.28, dz: 0.75, s: [0.6, 1, 1] },
    extras(g, { hd }) { g.add(ball(0.06, '#1b1d22', [hd[0] + 0.62, hd[1] - 0.04, 0])); },
  }),
  cow: () => quad({
    c: '#f4f1ea', L: 1.7, H: 0.78, W: 0.66, legL: 0.65, legR: 0.1, hr: 0.22, neck: [0.4, 0.15], neckR: 0.2, headScale: [1.2, 1, 0.95], hoof: '#3b3330', tail: { dx: 0.1, dy: 0.5, tuft: '#2a2522' },
    snout: { r: 0.14, dx: 0.25, dy: -0.06, c: '#f0b9b0', s: [1.2, 0.9, 1.05] }, ear: { r: 0.09, c: '#2a2522', dy: 0.05, dz: 1.35, s: [0.5, 0.5, 1.4] },
    extras(g, { by, L, hd }) {
      for (const z of [-1, 1]) g.add(cone(0.04, 0.16, '#efe6c8', [hd[0] - 0.02, hd[1] + 0.25, z * 0.12]));
      for (const [x, y, z, r] of [[0.1, 0.18, 0.28, 0.2], [-0.4, 0.1, -0.28, 0.24], [0.45, -0.05, -0.28, 0.16], [-0.1, -0.1, 0.3, 0.17]]) g.add(ball(r, '#26221f', [x, by + y, z], [1.1, 0.8, 0.3]));
      g.add(ball(0.12, '#f0b9b0', [-0.45, by - 0.32, 0], [1, 0.8, 1.2]));
    },
  }),
  horse: () => quad({
    c: '#8a5836', L: 1.7, H: 0.62, W: 0.48, legL: 0.95, legR: 0.075, hr: 0.14, neck: [0.34, 0.5], neckR: 0.15, headScale: [1.9, 0.9, 0.85], hoof: '#2a1d14', tail: { dx: 0.28, dy: 0.55, c: '#2a1d14', tuft: '#2a1d14' },
    snout: { r: 0.09, dx: 0.2, dy: -0.07, c: '#7a4c2d' }, ear: { r: 0.045, dy: 0.17, dz: 0.5, s: [0.6, 1.6, 0.6] },
    extras(g, { sh, hd }) { for (let i = 0; i < 6; i++) g.add(box(0.05, 0.12, 0.05, '#2a1d14', [sh[0] + 0.34 * (i / 5) - 0.1, sh[1] + 0.5 * (i / 5) + 0.12, 0])); },
  }),
  lion: () => quad({
    c: '#d9a441', L: 1.5, H: 0.6, W: 0.5, legL: 0.5, legR: 0.11, hr: 0.2, neck: [0.3, 0.22], neckR: 0.2, hoof: '#c0892f', tail: { dx: 0.3, dy: 0.15, tuft: '#7a4a1e' },
    snout: { r: 0.11, dx: 0.17, dy: -0.06, c: '#ecc778' },
    extras(g, { hd }) {
      g.add(ball(0.37, '#7a4a1e', [hd[0] - 0.08, hd[1] - 0.02, 0], [0.8, 1, 1])); g.add(ball(0.2, '#d9a441', [hd[0] + 0.06, hd[1] - 0.02, 0]));
      g.add(ball(0.1, '#ecc778', [hd[0] + 0.22, hd[1] - 0.06, 0], [1.2, 0.85, 0.9])); g.add(ball(0.035, '#1b1d22', [hd[0] + 0.31, hd[1] - 0.03, 0]));
      for (const z of [-1, 1]) { g.add(eye(hd[0] + 0.16, hd[1] + 0.06, z * 0.1)); g.add(ball(0.06, '#d9a441', [hd[0] - 0.05, hd[1] + 0.2, z * 0.18])); }
    },
  }),
  panda: () => quad({
    c: '#f6f6f4', L: 1.2, H: 0.9, W: 0.85, legL: 0.36, legR: 0.17, leg: '#1c1c20', hr: 0.37, neck: [0.34, 0.12], neckR: 0.3, tail: { dx: 0.05, dy: 0.0 },
    snout: { r: 0.13, dx: 0.3, dy: -0.1, c: '#f6f6f4', s: [1.1, 0.8, 1] }, ear: { r: 0.11, c: '#1c1c20', dy: 0.3, dz: 0.75, s: [0.7, 1, 0.7] },
    extras(g, { by, hd, hr }) {
      for (const z of [-1, 1]) { g.add(ball(0.1, '#1c1c20', [hd[0] + 0.24, hd[1] + 0.06, z * 0.17], [1, 1.3, 0.6])); g.add(eye(hd[0] + 0.31, hd[1] + 0.06, z * 0.17, 0.025)); }
      g.add(ball(0.045, '#1c1c20', [hd[0] + 0.45, hd[1] - 0.03, 0]));
      g.add(ball(1, '#1c1c20', [0.3, by + 0.02, 0], [0.2, 0.5, 0.45]));   // dark shoulder band
    },
  }),
  cat: () => quad({
    c: '#e08a3c', L: 0.95, H: 0.4, W: 0.34, legL: 0.3, legR: 0.055, hr: 0.19, neck: [0.2, 0.18], neckR: 0.13, tail: { dx: 0.12, dy: -0.55, c: '#e08a3c', tuft: '#c9741f' }, hoof: '#f2d9b8',
    snout: { r: 0.06, dx: 0.14, dy: -0.04, c: '#f2d9b8' },
    extras(g, { by, hd }) {
      for (const z of [-1, 1]) { g.add(cone(0.065, 0.14, '#e08a3c', [hd[0] - 0.03, hd[1] + 0.2, z * 0.12])); g.add(box(0.5, 0.02, 0.02, '#a85a1c', [0.0, by + 0.19, z * 0.1])); }
      g.add(ball(0.025, '#e07b8a', [hd[0] + 0.2, hd[1] - 0.02, 0]));
    },
  }),
  gorilla: () => {
    const g = new T.Group(), c = '#3a3a42';
    put(g, ball(1, c, [0, 1.0, 0], [0.55, 0.7, 0.5])).rotation.z = -0.3;
    g.add(ball(1, '#8b8b95', [-0.2, 1.15, 0], [0.4, 0.45, 0.52]));
    for (const z of [-1, 1]) {
      g.add(seg([0.1, 1.45, z * 0.45], [0.35, 0.12, z * 0.62], 0.2, 0.14, c)); g.add(ball(0.17, c, [0.38, 0.12, z * 0.62]));
      g.add(seg([-0.1, 0.45, z * 0.28], [0.0, 0.08, z * 0.3], 0.19, 0.12, c)); g.add(ball(0.14, c, [0.05, 0.08, z * 0.3], [1.3, 0.7, 1]));
    }
    g.add(ball(0.26, c, [0.5, 1.5, 0])); g.add(ball(0.16, '#25252b', [0.68, 1.43, 0], [1, 0.8, 1])); g.add(box(0.1, 0.07, 0.4, '#25252b', [0.62, 1.62, 0]));
    for (const z of [-1, 1]) g.add(eye(0.72, 1.55, z * 0.1, 0.03));
    return g;
  },
  trex: () => {
    const g = new T.Group(), c = '#5e8f4c', bel = '#b5cf86';
    const body = ball(1, c, [0, 1.2, 0], [0.95, 0.6, 0.5]); body.rotation.z = 0.25; g.add(body);
    put(g, ball(1, bel, [0.08, 1.05, 0], [0.8, 0.4, 0.45])).rotation.z = 0.25;
    for (const z of [-1, 1]) { g.add(ball(0.32, c, [0, 1.0, z * 0.32])); g.add(seg([0, 0.95, z * 0.32], [0.1, 0.25, z * 0.32], 0.2, 0.12, c)); g.add(box(0.4, 0.1, 0.18, '#47693a', [0.25, 0.06, z * 0.32])); g.add(seg([0.82, 1.28, z * 0.2], [0.98, 1.1, z * 0.2], 0.05, 0.035, c)); }
    const tail = [[-0.8, 1.35, 0], [-1.3, 1.25, 0], [-1.8, 1.1, 0], [-2.2, 0.98, 0]];
    for (let i = 0; i < 3; i++) g.add(seg(tail[i], tail[i + 1], 0.3 - i * 0.09, 0.2 - i * 0.07, c));
    g.add(seg([0.6, 1.5, 0], [1.0, 1.95, 0], 0.26, 0.22, c));
    g.add(box(0.85, 0.42, 0.46, c, [1.35, 2.0, 0])); g.add(box(0.7, 0.14, 0.4, '#47693a', [1.35, 1.72, 0])); g.add(box(0.75, 0.2, 0.44, bel, [1.35, 1.82, 0]));
    for (let i = 0; i < 5; i++) for (const z of [-1, 1]) put(g, cone(0.025, 0.09, '#f4f1e2', [1.15 + i * 0.1, 1.85, z * 0.2], 5)).rotation.x = Math.PI;
    for (const z of [-1, 1]) { g.add(eye(1.1, 2.12, z * 0.22, 0.04)); g.add(ball(0.045, '#2c4624', [1.7, 2.1, z * 0.1])); }
    return g;
  },
  whale: () => {
    const g = new T.Group();
    g.add(ball(1, '#5a7fa8', [0, 0.9, 0], [2.4, 0.85, 0.9]));
    g.add(ball(1, '#d6e5f0', [0.1, 0.55, 0], [2.1, 0.5, 0.82]));
    const tail = cone(0.55, 1.6, '#5a7fa8', [-2.9, 1.05, 0], 10); tail.rotation.z = Math.PI / 2 + 0.12; g.add(tail);
    for (const z of [-1, 1]) { const f = box(1.0, 0.07, 0.55, '#4a6c92', [-3.5, 1.2, z * 0.4]); f.rotation.y = z * -0.5; g.add(f); const p = ball(0.5, '#4a6c92', [0.8, 0.5, z * 0.85], [1.3, 0.12, 0.6]); p.rotation.set(z * 0.3, z * 0.3, -0.5); g.add(p); }
    g.add(eye(1.7, 1.0, 0.72, 0.06)); g.add(eye(1.7, 1.0, -0.72, 0.06));
    g.add(box(1.2, 0.03, 0.02, '#2f4a68', [1.45, 0.72, 0.8]));
    return g;
  },
  human: () => humanoid({ skin: '#e0b48c', shirt: '#3b78c4', pants: '#2b3144', hair: '#4a3322' }),
  baby: () => humanoid({ skin: '#f1c9a5', shirt: '#cfe6ff', pants: '#cfe6ff', sleeve: '#cfe6ff', legLen: 0.4, torsoLen: 0.3, armLen: 0.38, headR: 0.3, hair: null, bulk: 1.15, stance: 0.1, shoes: '#f1c9a5',
    extras(g, { hy }) { g.add(ball(0.04, '#f1c9a5', [0.02, hy + 0.3, 0], [1, 0.6, 1])); } }),
  sumo: () => humanoid({ skin: '#d8a984', shirt: '#d8a984', pants: '#d8a984', sleeve: '#d8a984', legLen: 0.62, torsoLen: 0.34, armLen: 0.55, bulk: 1.6, belly: 0.5, stance: 0.28, headR: 0.2, hair: '#1c1713', shoes: '#d8a984',
    extras(g, { hipY }) { const m = torus(0.5, 0.07, '#3b4a8c', [0.06, hipY + 0.25, 0]); m.rotation.x = Math.PI / 2; m.scale.set(1, 1.05, 1); g.add(m); g.add(ball(0.07, '#1c1713', [-0.02, hipY + 1.25, 0])); } }),
  car: () => {
    const g = new T.Group();
    g.add(box(2.1, 0.42, 0.95, '#d9453a', [0, 0.45, 0]));
    g.add(box(1.1, 0.42, 0.85, '#e8685d', [-0.15, 0.87, 0]));
    g.add(box(0.5, 0.1, 0.9, '#b8362d', [0.55, 0.72, 0]));                              // bonnet
    for (const z of [-1, 1]) {
      g.add(box(0.95, 0.28, 0.02, '#a9dcf2', [-0.15, 0.88, z * 0.435]));                // side windows
      for (const x of [0.7, -0.7]) { put(g, cyl(0.28, 0.28, 0.18, '#202228', [x, 0.28, z * 0.47], null, 14)).rotation.x = Math.PI / 2; put(g, cyl(0.13, 0.13, 0.2, '#c9ced6', [x, 0.28, z * 0.47], null, 8)).rotation.x = Math.PI / 2; }
      g.add(box(0.06, 0.1, 0.2, '#fff2a0', [1.06, 0.5, z * 0.3]));                       // headlights
      g.add(box(0.06, 0.1, 0.2, '#ff6a5e', [-1.06, 0.5, z * 0.3]));                      // tail lights
    }
    put(g, box(0.04, 0.3, 0.78, '#a9dcf2', [0.44, 0.88, 0])).rotation.z = 0.5;           // windscreen
    return g;
  },
  jumbo: () => {
    const g = new T.Group(), W = '#f1f4f8', B = '#2b5fa8';
    put(g, new T.Mesh(new T.CapsuleGeometry(0.42, 3.8, 4, 12), mat(W))).rotation.z = Math.PI / 2; g.children[0].position.y = 0.9;
    g.add(ball(0.5, W, [1.1, 1.18, 0], [1.4, 0.55, 0.62]));                              // the 747's hump
    put(g, new T.Mesh(new T.CapsuleGeometry(0.43, 3.7, 3, 12), mat(B))).rotation.z = Math.PI / 2; const belly = g.children[g.children.length - 1]; belly.position.set(0, 0.72, 0); belly.scale.set(1, 1, 0.97); belly.scale.x = 0.55;
    for (const z of [-1, 1]) {
      put(g, box(1.2, 0.07, 2.0, '#d5dbe3', [-0.05, 0.75, z * 1.15])).rotation.y = z * -0.5;
      put(g, cyl(0.17, 0.2, 0.55, '#8d97a5', [0.35, 0.55, z * 0.85])).rotation.z = Math.PI / 2;
      put(g, cyl(0.17, 0.2, 0.55, '#8d97a5', [-0.1, 0.5, z * 1.85])).rotation.z = Math.PI / 2;
      put(g, box(0.55, 0.05, 0.9, '#d5dbe3', [-2.15, 0.95, z * 0.5])).rotation.y = z * -0.45;
      for (let i = 0; i < 9; i++) g.add(box(0.07, 0.07, 0.02, '#3a4658', [1.0 - i * 0.28, 1.0, z * 0.405]));
    }
    put(g, box(0.8, 0.95, 0.07, B, [-2.05, 1.4, 0])).rotation.z = 0.35;
    return g;
  },
  liberty: () => {
    const g = new T.Group(), cu = '#69bfa2', st = '#bdb6a8';
    g.add(box(1.5, 0.45, 1.5, st, [0, 0.22, 0])); g.add(box(1.2, 0.55, 1.2, '#cdc7ba', [0, 0.72, 0])); g.add(box(0.95, 1.1, 0.95, st, [0, 1.55, 0])); g.add(box(1.15, 0.12, 1.15, '#cdc7ba', [0, 2.16, 0]));
    g.add(cone(0.6, 1.8, cu, [0, 3.15, 0], 12)); g.add(cyl(0.3, 0.45, 0.5, cu, [0, 4.2, 0])); g.add(ball(0.28, cu, [0, 4.6, 0]));
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI; const sp = cone(0.04, 0.32, cu, [Math.cos(a) * 0.15 * 0, 4.95, 0], 5); sp.position.set(0.0 + Math.sin(a) * 0.3, 4.92 + Math.cos(a) * 0.12, Math.cos(a) * 0.3 * 0.2 + (i - 3) * 0.08); sp.rotation.z = -Math.sin(a) * 0.9; g.add(sp); }
    g.add(seg([0.15, 4.3, 0.1], [0.7, 4.75, 0.1], 0.13, 0.1, cu)); g.add(seg([0.7, 4.75, 0.1], [0.78, 5.5, 0.1], 0.1, 0.09, cu));
    g.add(cyl(0.07, 0.09, 0.3, '#caa64a', [0.78, 5.62, 0.1])); put(g, cone(0.13, 0.4, '#ffd54f', [0.78, 5.95, 0.1], 8)).material = new T.MeshStandardMaterial({ color: '#ffd54f', emissive: '#ffb300', emissiveIntensity: 0.7, flatShading: true });
    g.add(seg([-0.2, 4.2, 0.1], [-0.45, 3.9, 0.35], 0.12, 0.09, cu)); g.add(box(0.55, 0.7, 0.1, cu, [-0.45, 3.85, 0.45]));
    return g;
  },
  container: () => {
    const g = new T.Group(), c = '#2f6db5', d = '#244f86';
    g.add(box(2.4, 1.0, 1.0, c, [0, 0.55, 0]));
    for (let i = 0; i < 14; i++) for (const z of [-1, 1]) g.add(box(0.07, 0.86, 0.04, d, [-1.05 + i * 0.162, 0.55, z * 0.51]));
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(box(0.12, 1.06, 0.12, '#1a3b64', [x * 1.18, 0.55, z * 0.44]));
    g.add(box(2.46, 0.07, 1.06, '#1a3b64', [0, 1.1, 0])); g.add(box(2.46, 0.07, 1.06, '#1a3b64', [0, 0.02, 0]));
    for (const z of [-0.18, 0.18]) g.add(cyl(0.02, 0.02, 0.9, '#c9ced6', [1.22, 0.55, z], null, 6));
    return g;
  },

  /* ----------------------------------------------------------------- small things */
  egg: () => group(ball(0.5, '#f3e6d0', [0, 0.55, 0], [0.82, 1.05, 0.82]), ball(0.3, '#f7edda', [0, 0.85, 0], [0.8, 0.9, 0.8])),
  golf: () => group(ball(0.5, '#fbfbfb', [0, 0.78, 0]), cone(0.16, 0.3, '#d9453a', [0, 0.15, 0], 8)),
  clip: () => {
    const pts = [[-0.5, -0.45], [-0.5, 0.45], [0.0, 0.62], [0.5, 0.45], [0.5, -0.4], [0.18, -0.58], [-0.1, -0.4], [-0.1, 0.3], [0.2, 0.42], [0.3, 0.3], [0.3, -0.25]].map(([x, y]) => new T.Vector3(x, y, 0));
    const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), 48, 0.045, 6), mat('#aab3bf', { roughness: 0.4 }));
    m.position.y = 0.7; return group(m);
  },
  euro: () => { const c = group(cyl(0.5, 0.5, 0.1, '#e8c258', [0, 0.25, 0], { roughness: 0.45 }, 24), cyl(0.33, 0.33, 0.12, '#d7dde4', [0, 0.25, 0], { roughness: 0.4 }, 24), box(0.1, 0.02, 0.28, '#9aa3b0', [0, 0.32, 0])); c.rotation.x = -0.6; const o = new T.Group(); o.add(c); c.position.y = 0.15; return o; },
  sugar: () => {
    const g = group(ball(0.28, '#cfd5dc', [0.15, 0.2, 0], [1.3, 0.35, 0.9], { roughness: 0.4 }), seg([-0.15, 0.2, 0], [-0.95, 0.4, 0], 0.045, 0.06, '#cfd5dc', { roughness: 0.4 }));
    for (let i = 0; i < 9; i++) g.add(box(0.07, 0.07, 0.07, '#ffffff', [0.0 + (i % 3) * 0.1 + 0.05, 0.32 + (i > 5 ? 0.07 : 0), (Math.floor(i / 3) - 1) * 0.1]));
    return g;
  },
  banana: () => {
    const pts = []; for (let i = 0; i <= 8; i++) { const a = -1 + (i / 8) * 2; pts.push(new T.Vector3(a * 0.8, 0.2 + (1 - a * a) * 0.35, 0)); }
    const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.17, 7), mat('#f2d33c'));
    m.scale.set(1, 1, 1);
    return group(m, ball(0.1, '#6b4a22', [-0.82, 0.2, 0]), ball(0.09, '#4a3322', [0.82, 0.2, 0]));
  },
  apple: () => group(ball(0.5, '#d83a34', [0, 0.5, 0], [1, 0.9, 1]), ball(0.14, '#9c2622', [0, 0.92, 0], [1, 0.6, 1]), cyl(0.02, 0.025, 0.22, '#5d3b1c', [0, 1.0, 0], null, 6), ball(0.13, '#5fb34a', [0.12, 1.02, 0], [1.5, 0.35, 0.8])),
  football: () => {
    const g = new T.Group(); g.add(ball(0.5, '#f7f7f7', [0, 0.5, 0]));
    const phi = (1 + Math.sqrt(5)) / 2, vs = []; for (const a of [-1, 1]) for (const b of [-phi, phi]) { vs.push([0, a, b], [a, b, 0], [b, 0, a]); }
    for (const v of vs) { const p = new T.Vector3(...v).normalize().multiplyScalar(0.5); const d = ball(0.17, '#1d1f24', [p.x, p.y + 0.5, p.z], [1, 1, 0.35]); d.lookAt(p.x * 2, p.y * 2 + 0.5, p.z * 2); g.add(d); }
    return g;
  },
  rugby: () => { const g = group(ball(0.5, '#7a3f22', [0, 0.45, 0], [1.4, 0.9, 0.9])); for (const x of [-0.45, 0.45]) { const t = torus(0.37, 0.025, '#f4f4f4', [x, 0.45, 0]); t.rotation.y = Math.PI / 2; t.scale.set(1, 0.95, 1); g.add(t); } g.add(box(0.35, 0.02, 0.04, '#f4f4f4', [0, 0.9, 0])); g.rotation.z = 0.35; const o = new T.Group(); o.add(g); g.position.y = 0.2; return o; },
  tennis: () => {
    const g = group(ball(0.5, '#d4e640', [0, 0.5, 0]));
    for (const s of [1, -1]) { const t = new T.Mesh(new T.TorusGeometry(0.5, 0.025, 6, 20, Math.PI * 1.1), mat('#ffffff')); t.position.set(0, 0.5, 0); t.rotation.set(0.4 * s, s * 0.9, 0); t.scale.set(1.01, 1.01, 1.01); g.add(t); }
    return g;
  },
  pint: () => group(
    cyl(0.58, 0.42, 1.5, '#cfe9ff', [0, 0.78, 0], { transparent: true, opacity: 0.32, roughness: 0.15, metalness: 0.1 }, 16),
    cyl(0.54, 0.4, 1.32, '#5aa9e6', [0, 0.72, 0], { transparent: true, opacity: 0.75, roughness: 0.2 }, 16),
    cyl(0.42, 0.42, 0.06, '#cfe9ff', [0, 0.04, 0], { transparent: true, opacity: 0.6 }, 16)),
  bowling: () => {
    const g = group(ball(0.5, '#4a2c8a', [0, 0.5, 0]));
    for (const [x, y, z] of [[0.16, 0.9, 0.2], [-0.05, 0.92, 0.22], [0.06, 0.78, 0.38]]) { const h = cyl(0.05, 0.05, 0.1, '#0f0b1a', [x * 1.0, y, z * 0.55], null, 8); h.lookAt(x * 3, y * 3 - 0.9, z * 3); h.rotateX(Math.PI / 2); g.add(h); }
    const sheen = ball(0.12, '#8a6fd0', [-0.25, 0.8, 0.2], [1, 0.6, 0.6], { transparent: true, opacity: 0.5 }); g.add(sheen); return g;
  },
  loaf: () => {
    const g = group(box(1.5, 0.42, 0.78, '#bf8236', [0, 0.23, 0]));
    const top = ball(1, '#d9a04a', [0, 0.46, 0], [0.76, 0.4, 0.4]); g.add(top);
    g.add(ball(1, '#e9bd72', [0.0, 0.5, 0], [0.7, 0.3, 0.33]));
    for (const x of [-0.45, -0.15, 0.15, 0.45]) g.add(box(0.05, 0.03, 0.5, '#a96c25', [x, 0.83, 0]));
    return g;
  },
  phone: () => { const g = group(box(0.55, 1.1, 0.07, '#1d2230', [0, 0.6, 0], { roughness: 0.5 }), box(0.48, 1.0, 0.075, '#46c0e8', [0, 0.6, 0.002]), box(0.2, 0.2, 0.02, '#ffffff', [0, 0.75, 0.045]), box(0.12, 0.12, 0.02, '#ffd54f', [-0.12, 0.5, 0.045]), box(0.12, 0.12, 0.02, '#5be3a1', [0.1, 0.5, 0.045]), ball(0.035, '#0a0c12', [0, 1.07, 0.04])); g.rotation.set(-0.25, 0, 0); const o = new T.Group(); o.add(g); return o; },
  a4: () => { const g = new T.Group(); for (let i = 0; i < 3; i++) { const s = box(0.9, 0.03, 1.25, '#ffffff', [i * 0.03, 0.03 + i * 0.035, i * 0.025]); s.rotation.y = (i - 1) * 0.12; g.add(s); } for (let l = 0; l < 6; l++) { const t = box(0.62, 0.005, 0.03, '#b7c2d6', [0.12, 0.125, -0.4 + l * 0.14]); t.rotation.y = 0.12; g.add(t); } return g; },
  aa: () => group(cyl(0.27, 0.27, 1.0, '#2c3a36', [0, 0.55, 0], { roughness: 0.6 }), cyl(0.275, 0.275, 0.36, '#d9a83a', [0, 0.55, 0], { roughness: 0.5 }), cyl(0.12, 0.12, 0.1, '#c9ced6', [0, 1.1, 0], { roughness: 0.4 }), box(0.3, 0.1, 0.02, '#e8e8e8', [0, 0.35, 0.275])),
  rice: () => { const g = new T.Group(); for (const [x, z, r] of [[-0.3, 0, 0.3], [0.25, 0.2, -0.5], [0.05, -0.3, 0.9]]) { const m = ball(0.4, '#f1ecdc', [x, 0.2, z], [1.8, 0.55, 0.55]); m.rotation.y = r; g.add(m); } return g; },
  bee: () => {
    const g = group(ball(0.4, '#f2c230', [0, 0.55, 0], [1.4, 0.85, 0.85]), ball(0.28, '#26221f', [0.6, 0.6, 0]));
    for (const x of [-0.15, 0.1, 0.35]) { const s = new T.Mesh(new T.TorusGeometry(0.3, 0.07, 5, 14), mat('#26221f')); s.rotation.y = Math.PI / 2; s.position.set(x - 0.1, 0.55, 0); s.scale.set(1, 1.05, 0.9); g.add(s); }
    for (const z of [-1, 1]) { const w = ball(0.45, '#dff2ff', [0.0, 0.98, z * 0.28], [1.1, 0.04, 0.55], { transparent: true, opacity: 0.6 }); w.rotation.set(z * 0.5, 0, 0); g.add(w); g.add(eye(0.78, 0.66, z * 0.14, 0.05)); }
    put(g, cone(0.06, 0.22, '#26221f', [-0.78, 0.5, 0], 5)).rotation.z = Math.PI / 2;
    return g;
  },
  lego: () => { const g = group(box(1.5, 0.5, 0.75, '#d9332e', [0, 0.25, 0])); for (let i = 0; i < 4; i++) for (const z of [-1, 1]) g.add(cyl(0.12, 0.12, 0.12, '#e6453f', [-0.56 + i * 0.37, 0.56, z * 0.19], null, 10)); return g; },
};
MODELS.giraffe_small = MODELS.giraffe;

export const MODEL_IDS = Object.keys(MODELS).filter(k => !k.endsWith('_small'));

/** Build, normalise (largest dimension = size) and stand on y = 0. */
export function buildModel(id, size = 1) {
  const f = MODELS[id]; if (!f) throw new Error('no model: ' + id);
  const inner = f(), outer = new T.Group(); outer.add(inner);
  const box3 = new T.Box3().setFromObject(inner), dim = new T.Vector3(); box3.getSize(dim);
  const k = size / Math.max(dim.x, dim.y, dim.z, 1e-6);
  inner.scale.multiplyScalar(k);
  const b2 = new T.Box3().setFromObject(inner), c = new T.Vector3(); b2.getCenter(c);
  inner.position.set(-c.x, -b2.min.y, -c.z);
  outer.userData.height = (b2.max.y - b2.min.y);
  return outer;
}
export function meshCount(g) { let n = 0; g.traverse(o => { if (o.isMesh) n++; }); return n; }
export { T };
