/* BLANION RACER — low-poly race cars. Each car is a flat-shaded, vertex-coloured hull lofted from a few cross-sections (so it has a proper
 * aerodynamic silhouette), plus wings, splitters, mirrors, lights, racing wheels and a numbered livery. Forward is +z, the car is ~4.4 m long. */
import * as T from '/vendor/three-lite.min.js';

/* ------------------------------------------------------------------------------------------- geometry helpers */
class Soup {
  constructor() { this.pos = []; this.col = []; this._c = new T.Color(); }
  rgb(hex) { this._c.set(hex); return [this._c.r, this._c.g, this._c.b]; }
  tri(a, b, c, hex) { const k = this.rgb(hex); for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(k[0], k[1], k[2]); } }
  quad(a, b, c, d, hex) { this.tri(a, b, c, hex); this.tri(a, c, d, hex); }
  box(cx, cy, cz, sx, sy, sz, hex, rx = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, c = Math.cos(rx), s = Math.sin(rx);
    const P = (x, y, z) => [cx + x, cy + y * c - z * s, cz + y * s + z * c];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) this.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], hex);
  }
  /** join consecutive rings (arrays of [x,y] with the same length) at depths z. colours[e] colours edge e; seg(i,e) may override. */
  loft(rings, colours, seg, cap) {
    const n = rings[0].pts.length, V = (r, i) => [r.pts[i % n][0], r.pts[i % n][1], r.z];
    for (let s = 0; s < rings.length - 1; s++) for (let e = 0; e < n; e++) {
      const A = rings[s], B = rings[s + 1], col = (seg && seg(s, e, rings.length - 1)) || colours[e];
      this.quad(V(A, e), V(A, e + 1), V(B, e + 1), V(B, e), col);
    }
    if (cap) for (const [r, flip] of [[rings[0], true], [rings[rings.length - 1], false]]) for (let e = 1; e < n - 1; e++) this.tri(V(r, 0), V(r, flip ? e + 1 : e), V(r, flip ? e : e + 1), cap);
  }
  mesh(mat) {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); return new T.Mesh(g, mat);
  }
}

// body cross-section: sill, belt, shoulder and a stripe strip along the middle of the bonnet/roof
const body = (z, w, yb, ys, ym, yh, yt, sw) => ({ z, pts: [[w * 0.84, yb], [w, ys], [w, ym], [w * 0.93, yh], [sw, yt], [-sw, yt], [-w * 0.93, yh], [-w, ym], [-w, ys], [-w * 0.84, yb]] });
// greenhouse cross-section: side glass, roof, stripe
const cab = (z, wb, y0, rw, y1, sw) => ({ z, pts: [[wb, y0], [rw, y1], [sw, y1 + 0.005], [-sw, y1 + 0.005], [-rw, y1], [-wb, y0]] });

/* ------------------------------------------------------------------------------------------- the four cars */
export const CAR_MODELS = {
  gt: { // GT3-style coupe: long low bonnet, rear-set cabin, big wing
    body: [[-2.3, .80, .30, .38, .58, .74, .80, .16], [-1.9, .97, .26, .36, .64, .88, .96, .16], [-0.8, 1.0, .24, .34, .60, .80, .86, .16], [0.5, .98, .22, .32, .56, .70, .74, .16], [1.6, .93, .20, .30, .50, .62, .64, .16], [2.15, .82, .18, .28, .42, .52, .52, .16], [2.4, .60, .22, .30, .36, .40, .40, .12]],
    cabin: [[-1.5, .82, .86, .50, 1.02, .14], [-1.1, .84, .88, .60, 1.20, .14], [-0.1, .82, .78, .58, 1.22, .14], [0.55, .80, .70, .48, 1.04, .14], [0.95, .78, .60, .36, .84, .12]],
    wheels: { f: { z: 1.42, x: 1.0, r: .40, w: .38 }, r: { z: -1.35, x: 1.03, r: .43, w: .52 } },
    wing: { z: -2.18, y: 1.22, w: 2.0, d: .5, post: .72, plates: true }, splitter: { z: 2.32, w: 1.84, d: .55 }, diffuser: true,
    lights: { z: 2.22, y: .47, x: .56, w: .42, h: .09, slim: true }, tail: { z: -2.31, y: .68, w: 1.5 },
    mirror: { z: .5, y: 1.0, x: .98 }, num: { doorZ: -0.35, doorY: .66, hood: { z: 1.35, y: .6 } }, flare: true,
  },
  tourer: { // touring-car saloon: tall greenhouse, boot lip spoiler, wide arches
    body: [[-2.25, .88, .30, .40, .66, .80, .84, .18], [-1.9, .95, .26, .38, .68, .84, .88, .18], [-0.6, .98, .24, .36, .64, .80, .84, .18], [1.0, .96, .22, .34, .60, .74, .76, .18], [1.85, .88, .20, .32, .52, .60, .62, .18], [2.25, .70, .22, .32, .44, .48, .48, .14]],
    cabin: [[-1.4, .86, .86, .58, 1.10, .16], [-0.95, .88, .88, .70, 1.34, .16], [0.35, .86, .82, .70, 1.34, .16], [1.0, .84, .72, .50, 1.06, .16], [1.3, .80, .64, .38, .84, .14]],
    wheels: { f: { z: 1.4, x: 1.0, r: .39, w: .36 }, r: { z: -1.35, x: 1.0, r: .40, w: .4 } },
    wing: { z: -2.12, y: .98, w: 1.7, d: .3, post: 0, lip: true }, splitter: { z: 2.22, w: 1.7, d: .4 }, diffuser: false,
    lights: { z: 2.15, y: .55, x: .62, w: .4, h: .13 }, tail: { z: -2.24, y: .72, w: 1.6 }, pillars: true,
    mirror: { z: .72, y: 1.04, x: .96 }, num: { doorZ: 0.0, doorY: .7, hood: { z: 1.35, y: .62 } },
  },
  proto: { // Le Mans prototype: narrow nose, bubble canopy forward, dorsal fin, tall rear wing
    body: [[-2.4, .70, .28, .34, .46, .58, .60, .10], [-1.6, .93, .22, .30, .50, .70, .78, .10], [-0.2, .98, .20, .28, .48, .62, .66, .10], [1.2, .90, .18, .26, .40, .50, .50, .12], [2.1, .60, .16, .22, .30, .34, .34, .12], [2.5, .36, .16, .20, .24, .26, .26, .10]],
    cabin: [[-0.95, .56, .62, .32, .94, .10], [-0.4, .62, .58, .44, 1.08, .10], [0.45, .6, .50, .40, .98, .10], [1.1, .56, .40, .20, .64, .08]],
    wheels: { f: { z: 1.55, x: 1.0, r: .38, w: .42 }, r: { z: -1.45, x: 1.05, r: .43, w: .58 } },
    wing: { z: -2.4, y: 1.15, w: 2.05, d: .5, post: .82, plates: true, double: true }, splitter: { z: 2.5, w: 1.6, d: .6 }, diffuser: true, fin: { z0: -2.2, z1: -0.8, h: 1.2 },
    lights: { z: 2.1, y: .36, x: .5, w: .36, h: .07, slim: true }, tail: { z: -2.42, y: .5, w: 1.1 },
    mirror: { z: .3, y: .95, x: .62 }, num: { doorZ: -0.45, doorY: .55, hood: { z: 1.4, y: .38 } }, openWheels: true,
  },
  hatch: { // hot hatch: short, upright, roof spoiler, round lights
    body: [[-1.85, .86, .30, .40, .66, .80, .84, .2], [-1.5, .92, .26, .38, .68, .88, .90, .2], [0, .94, .24, .36, .62, .76, .78, .2], [1.2, .92, .22, .34, .56, .66, .68, .2], [1.75, .80, .20, .32, .46, .52, .52, .16], [1.95, .62, .22, .32, .40, .44, .44, .14]],
    cabin: [[-1.78, .84, .88, .62, 1.26, .16], [-1.45, .86, .90, .70, 1.42, .16], [0, .86, .82, .70, 1.44, .16], [0.8, .84, .72, .56, 1.22, .14], [1.2, .80, .64, .40, .84, .12]],
    wheels: { f: { z: 1.2, x: .98, r: .36, w: .36 }, r: { z: -1.2, x: .98, r: .37, w: .4 } },
    wing: { z: -1.85, y: 1.55, w: 1.5, d: .35, post: 0, roof: true }, splitter: { z: 1.95, w: 1.6, d: .4 }, diffuser: false,
    lights: { z: 1.86, y: .56, x: .62, w: .3, h: .3, round: true }, tail: { z: -1.88, y: .72, w: 1.5 }, pillars: true,
    mirror: { z: .55, y: 1.06, x: .94 }, num: { doorZ: 0.0, doorY: .66, hood: { z: 1.1, y: .56 } },
  },
};

export const LIVERIES = [
  { name: 'Coral', body: '#ff5470', stripe: '#ffffff', accent: '#17142b' },
  { name: 'Mint', body: '#1fe0c4', stripe: '#17142b', accent: '#ffffff' },
  { name: 'Tangerine', body: '#ff9a3c', stripe: '#17142b', accent: '#ffffff' },
  { name: 'Indigo', body: '#5b6cff', stripe: '#ffffff', accent: '#ff5470' },
  { name: 'Cream', body: '#f4efe6', stripe: '#ff5470', accent: '#17142b' },
];

/* ------------------------------------------------------------------------------------------- textures */
const numCache = new Map();
function numberTexture(n, ring) {
  const key = n + ring; if (numCache.has(key)) return numCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill(); g.strokeStyle = ring; g.lineWidth = 8; g.stroke();
  g.fillStyle = '#17142b'; g.font = 'bold ' + (String(n).length > 1 ? 64 : 78) + 'px "Chakra Petch", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 70);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; numCache.set(key, t); return t;
}

/* ------------------------------------------------------------------------------------------- builder */
const GLASS = '#3b5688', DARK = '#17142b', STEEL = '#c9d3e6';
/** returns a Group with userData { wheels:[{pivot,spin,front}], setLivery(l, number) } */
export function buildCar(id, livery, number, ghost) {
  const M = CAR_MODELS[id] || CAR_MODELS.gt, L = livery || LIVERIES[0];
  const g = new T.Group(), flat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
  const shell = new T.Group(); g.add(shell);                                   // everything that leans/bobs with the body
  const S = new Soup();
  // hull
  const rings = M.body.map(r => body(...r));
  S.loft(rings, [L.accent, L.body, L.body, L.body, L.stripe, L.body, L.body, L.body, L.accent, DARK], null, L.body);
  // greenhouse: first and last slabs are windscreens
  const cr = M.cabin.map(r => cab(...r));
  S.loft(cr, [GLASS, L.body, L.stripe, L.body, GLASS, L.body], (s, e, last) => ((s === 0 || s === last - 1) && (e === 1 || e === 3 || e === 2)) ? GLASS : null, GLASS);
  if (M.pillars) for (const sd of [-1, 1]) { const mid = cr[Math.floor(cr.length / 2)]; S.box(sd * (mid.pts[0][0] - 0.02 - (mid.pts[0][0] - mid.pts[1][0]) * 0.1), (mid.pts[0][1] + mid.pts[1][1]) / 2, mid.z - 0.1, 0.06, (mid.pts[1][1] - mid.pts[0][1]) * 0.98, 0.1, L.body); }
  // splitter + diffuser + side skirts + exhausts
  const sp = M.splitter; S.box(0, 0.17, sp.z - sp.d / 2 + 0.05, sp.w, 0.07, sp.d, DARK); S.box(0, 0.2, sp.z - sp.d + 0.15, sp.w * 0.95, 0.03, 0.12, L.accent);
  for (const sd of [-1, 1]) S.box(sd * 0.96, 0.24, 0.05, 0.07, 0.1, 2.5, DARK);
  if (M.diffuser) { S.box(0, 0.28, -2.3, 1.5, 0.1, 0.35, DARK); for (const sd of [-1, 1]) S.box(sd * 0.45, 0.22, -2.38, 0.18, 0.14, 0.1, STEEL); }
  else for (const sd of [-1, 1]) S.box(sd * 0.55, 0.26, -2.18, 0.16, 0.12, 0.12, STEEL);
  // wing / spoiler
  const w = M.wing;
  if (w.roof) { S.box(0, w.y, w.z, w.w, 0.06, w.d, L.accent, 0.14); for (const sd of [-1, 1]) S.box(sd * (w.w / 2), w.y - 0.08, w.z, 0.05, 0.2, w.d, DARK); }
  else if (w.lip) { S.box(0, w.y, w.z, w.w, 0.07, w.d, DARK, 0.3); }
  else {
    S.box(0, w.y, w.z, w.w, 0.07, w.d, L.accent, -0.08); if (w.double) S.box(0, w.y - 0.2, w.z + 0.1, w.w * 0.9, 0.05, w.d * 0.7, L.stripe, -0.06);
    if (w.plates) for (const sd of [-1, 1]) S.box(sd * (w.w / 2), w.y - 0.08, w.z, 0.05, 0.42, w.d + 0.08, L.body);
    for (const sd of [-1, 1]) S.box(sd * 0.55, (w.y + 0.45) / 2 - 0.1, w.z + 0.05, 0.08, w.y - 0.4, 0.2, DARK);
  }
  if (M.fin) S.box(0, 1.0, (M.fin.z0 + M.fin.z1) / 2, 0.06, M.fin.h * 0.5, M.fin.z1 - M.fin.z0, L.stripe);
  if (M.flare) for (const sd of [-1, 1]) for (const wz of [M.wheels.f.z, M.wheels.r.z]) S.box(sd * 1.0, 0.62, wz, 0.12, 0.1, 1.15, L.body);
  // mirrors
  for (const sd of [-1, 1]) { const m = M.mirror; S.box(sd * m.x, m.y, m.z, 0.18, 0.1, 0.12, L.body); }
  shell.add(S.mesh(flat));
  // lights (basic material: they glow)
  const lamp = new T.MeshBasicMaterial({ color: '#fff6c8' }), tail = new T.MeshBasicMaterial({ color: '#ff3d5a' }), lights = new T.Group();
  const Lt = M.lights;
  for (const sd of [-1, 1]) {
    const m = new T.Mesh(Lt.round ? new T.CylinderGeometry(Lt.w / 2, Lt.w / 2, 0.06, 8) : new T.BoxGeometry(Lt.w, Lt.h, 0.07), lamp);
    if (Lt.round) m.rotation.x = Math.PI / 2; m.position.set(sd * Lt.x, Lt.y, Lt.z); if (Lt.slim) m.rotation.y = sd * 0.35; lights.add(m);
    const rim = new T.Mesh(new T.BoxGeometry(Lt.w + 0.08, (Lt.round ? Lt.w : Lt.h) + 0.06, 0.05), new T.MeshLambertMaterial({ color: DARK, flatShading: true })); rim.position.set(sd * Lt.x, Lt.y, Lt.z - 0.03); if (Lt.slim) rim.rotation.y = sd * 0.35; lights.add(rim);
  }
  const tl = new T.Mesh(new T.BoxGeometry(M.tail.w, 0.1, 0.06), tail); tl.position.set(0, M.tail.y, M.tail.z); lights.add(tl);
  shell.add(lights);
  // racing numbers on both doors and the bonnet
  const nums = new T.Group(); shell.add(nums);
  const numMat = new T.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  function setNumber(n, ring) {
    numMat.map = numberTexture(n, ring); numMat.needsUpdate = true;
  }
  const dw = M.body[Math.max(0, M.body.findIndex(b => b[0] > M.num.doorZ) - 1)][1];
  for (const sd of [-1, 1]) { const m = new T.Mesh(new T.PlaneGeometry(0.62, 0.62), numMat); m.position.set(sd * (dw + 0.012), M.num.doorY, M.num.doorZ); m.rotation.y = sd * Math.PI / 2; nums.add(m); }
  { const m = new T.Mesh(new T.PlaneGeometry(0.55, 0.55), numMat); m.position.set(0, M.num.hood.y + 0.1, M.num.hood.z); m.rotation.x = -Math.PI / 2 + 0.12; m.rotation.z = Math.PI; /* readable from behind */ nums.add(m); }
  setNumber(number || 7, L.accent);
  // racing wheels: dark tyre, steel rim with five spokes, coloured brake caliper
  const tyre = new T.MeshLambertMaterial({ color: '#2a2748', flatShading: true }), rim = new T.MeshLambertMaterial({ color: STEEL, flatShading: true }), cal = new T.MeshLambertMaterial({ color: L.accent === DARK ? L.stripe : L.accent, flatShading: true });
  const wheels = [];
  for (const [axle, sd] of [['f', -1], ['f', 1], ['r', -1], ['r', 1]]) {
    const W = M.wheels[axle], pivot = new T.Group(), spin = new T.Group(); pivot.position.set(sd * W.x, W.r, W.z); pivot.add(spin);
    const t = new T.Mesh(new T.CylinderGeometry(W.r, W.r, W.w, 12), tyre); t.rotation.z = Math.PI / 2; spin.add(t);
    const face = new T.Mesh(new T.CylinderGeometry(W.r * 0.66, W.r * 0.66, W.w + 0.02, 10), new T.MeshLambertMaterial({ color: '#2a2745', flatShading: true })); face.rotation.z = Math.PI / 2; spin.add(face);
    for (let k = 0; k < 5; k++) { const sp = new T.Mesh(new T.BoxGeometry(W.w + 0.05, W.r * 1.18, W.r * 0.17), rim); sp.rotation.x = (k / 5) * Math.PI; spin.add(sp); }
    const hub = new T.Mesh(new T.CylinderGeometry(W.r * 0.18, W.r * 0.18, W.w + 0.08, 6), new T.MeshLambertMaterial({ color: L.stripe === DARK ? L.body : L.stripe, flatShading: true })); hub.rotation.z = Math.PI / 2; spin.add(hub);
    const c = new T.Mesh(new T.BoxGeometry(0.08, W.r * 0.5, W.r * 0.5), cal); c.position.set(-sd * (W.w / 2 - 0.1), W.r * 0.15, W.r * 0.45); pivot.add(c);
    g.add(pivot); wheels.push({ pivot, spin, front: axle === 'f', r: W.r });
  }
  if (ghost) g.traverse(o => { if (o.material) { const mm = o.material.clone(); mm.transparent = true; mm.opacity = 0.35; mm.depthWrite = false; if (mm.vertexColors) mm.vertexColors = true; o.material = mm; o.castShadow = false; } });
  g.userData = { wheels, shell, id, w: ghost ? null : null };
  g.traverse(o => { if (o.isMesh && !ghost) o.castShadow = true; });
  return g;
}
