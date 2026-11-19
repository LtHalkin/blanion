/* BLANION RACER — the 3D view. A clean low-poly look: every circuit (road, markings, kerbs, barriers, grandstands, hills, scenery) is built from
 * flat-shaded, vertex-coloured triangles merged into a few meshes, lit by one soft sun with a shadow that follows the car.
 * Physics lives in racer-core.js, the cars in racer-cars.js. */
import * as T from '/vendor/three-lite.min.js';
import { buildCar, LIVERIES } from '/racer-cars.js';

const Core = window.RacerCore;                                   // classic script (UMD) so Node tests can load it too
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------------------------------------- merged, vertex-coloured geometry */
class Mesher {
  constructor() { this.pos = []; this.col = []; this._c = new T.Color(); }
  rgb(hex) { this._c.set(hex); return [this._c.r, this._c.g, this._c.b]; }
  tri(a, b, c, color) { const k = this.rgb(color); for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(k[0], k[1], k[2]); } }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  /** local z runs along heading ry, local x across (to the right of it) */
  box(cx, cy, cz, sx, sy, sz, color, ry = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) this.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], color);
  }
  cone(cx, cy, cz, r, h, color, seg = 6, rot = 0, lean = [0, 0]) {
    const top = [cx + lean[0], cy + h, cz + lean[1]];
    for (let i = 0; i < seg; i++) {
      const a0 = rot + (i / seg) * Math.PI * 2, a1 = rot + ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
      this.tri(p0, p1, top, color); this.tri([cx, cy, cz], p1, p0, color);
    }
  }
  rock(cx, cy, cz, r, color, rot = 0) {
    const t = [cx, cy + r * 0.9, cz], b = [cx, cy - r * 0.2, cz], ring = [];
    for (let i = 0; i < 5; i++) { const a = rot + (i / 5) * Math.PI * 2, rr = r * (0.85 + 0.3 * Math.sin(i * 2.3 + rot)); ring.push([cx + Math.cos(a) * rr, cy + r * 0.25 * Math.sin(i * 1.7), cz + Math.sin(a) * rr]); }
    for (let i = 0; i < 5; i++) { const p = ring[i], q = ring[(i + 1) % 5]; this.tri(p, q, t, color); this.tri(q, p, b, color); }
  }
  mesh(mat, cast, recv) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); const m = new T.Mesh(g, mat); m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = recv !== false; return m;
  }
}
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const shade = (hex, k) => { const c = new T.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

function skyTexture(cols) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, cols[0]); gr.addColorStop(0.55, cols[1]); gr.addColorStop(1, cols[2]); g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
function bannerTexture(pal) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  for (let i = 0; i < 32; i++) for (let j = 0; j < 6; j++) { g.fillStyle = (i + j) % 2 ? '#17142b' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); }
  g.fillStyle = 'rgba(23,20,43,.9)'; g.fillRect(80, 16, 352, 64); g.fillStyle = pal.kerbA; g.fillRect(80, 16, 352, 6); g.fillRect(80, 74, 352, 6);
  g.fillStyle = '#fff'; g.font = 'bold 38px "Chakra Petch", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('START / FINISH', 256, 50);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}

/* ---------------------------------------------------------------------- the view */
export function createView(canvas, opts = {}) {
  const reduced = !!opts.reduced, lowQ = !!opts.lowQuality;
  const renderer = new T.WebGLRenderer({ canvas, antialias: !lowQ, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2));
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(62, 1, 0.5, 1400);
  const hemi = new T.HemisphereLight('#ffffff', '#88a', 1.05), sun = new T.DirectionalLight('#fff4dd', 1.25);
  sun.castShadow = true; sun.shadow.mapSize.set(lowQ ? 1024 : 2048, lowQ ? 1024 : 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 320 }); sun.shadow.camera.updateProjectionMatrix();
  scene.add(hemi, sun, sun.target);
  const world = new T.Group(); scene.add(world);
  const dot = softDot(), sunDir = new T.Vector3(-0.5, 0.8, 0.35).normalize();
  const disc = new T.Mesh(new T.CircleGeometry(38, 10), new T.MeshBasicMaterial({ color: '#fff4c8', fog: false })); scene.add(disc);

  let track = null, curCar = { id: 'gt', liv: 0, num: 7 }, ghostCarId = 'gt';
  let car = buildCar(curCar.id, LIVERIES[0], curCar.num, false), ghost = buildCar('gt', LIVERIES[0], 0, true);
  scene.add(car, ghost); ghost.visible = false;
  const pool = []; for (let i = 0; i < 40; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; s.userData = { life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1 }; scene.add(s); pool.push(s); }
  let pi = 0;
  const cam = { x: 0, y: 5, z: -8, lx: 0, ly: 1, lz: 0, shake: 0, fov: 62, init: false };
  let gh = null, groundY = 0;

  function dispose(o) { o.traverse(c => { if (c.geometry) c.geometry.dispose(); }); }
  function setCar(id, liv, num) {
    curCar = { id, liv, num }; scene.remove(car); dispose(car);
    car = buildCar(id, LIVERIES[liv % LIVERIES.length], num, false); scene.add(car);
  }
  function setGhostCar(id) { if (id === ghostCarId) return; ghostCarId = id; scene.remove(ghost); dispose(ghost); ghost = buildCar(id, LIVERIES[0], 0, true); ghost.visible = false; scene.add(ghost); }

  /* ------------------------------------------------------------------ build a circuit */
  function setTrack(tr) {
    track = tr; for (const c of [...world.children]) { world.remove(c); c.geometry && c.geometry.dispose(); }
    const pal = tr.pal, P = tr.pts, N = tr.N, half = tr.half, bar = tr.barrier;
    scene.background = skyTexture(pal.sky); scene.fog = new T.Fog(pal.fog, 140, 620);
    hemi.color.set(pal.sky[1]); hemi.groundColor.set(pal.ground2); sun.color.set(pal.sun || '#fff4dd'); disc.material.color.set(pal.sun || '#fff4c8');
    const mat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
    let minY = 1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of P) { minY = Math.min(minY, p.y); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    groundY = minY - 0.8;
    const at = (i, off, dy = 0) => { const p = P[((i % N) + N) % N]; return [p.x + p.tz * off, p.y + dy, p.z - p.tx * off]; };
    const heading = i => { const p = P[((i % N) + N) % N]; return Math.atan2(p.tx, p.tz); };

    const road = new Mesher(), mark = new Mesher(), kerb = new Mesher(), wall = new Mesher(), under = new Mesher();
    for (let i = 0; i < N; i++) {
      const j = i + 1;
      road.quad(at(i, -half), at(i, half), at(j, half), at(j, -half), Math.floor(i / 6) % 2 ? pal.road : pal.road2);
      // road markings: solid edge lines and a dashed centre line
      for (const sd of [-1, 1]) mark.quad(at(i, sd * (half - 0.6), 0.03), at(i, sd * (half - 0.3), 0.03), at(j, sd * (half - 0.3), 0.03), at(j, sd * (half - 0.6), 0.03), pal.line);
      if (Math.floor(i / 4) % 2 === 0) mark.quad(at(i, -0.14, 0.03), at(i, 0.14, 0.03), at(j, 0.14, 0.03), at(j, -0.14, 0.03), pal.line);
      for (const sd of [-1, 1]) {
        const a = sd * half, b = sd * (half + 1.1), c = sd * bar;
        kerb.quad(at(i, a, 0.04), at(i, b, 0.04), at(j, b, 0.04), at(j, a, 0.04), Math.floor(i / 2) % 2 ? pal.kerbA : pal.kerbB);
        kerb.quad(at(i, b, 0.01), at(i, c, 0.01), at(j, c, 0.01), at(j, b, 0.01), pal.ground2);                         // run-off
        const wc = Math.floor(i / 6) % 4 === 0 ? pal.wallB : pal.wall;
        wall.quad(at(i, c, 0), at(i, c, 1.1), at(j, c, 1.1), at(j, c, 0), wc);
        wall.quad(at(i, c, 1.1), at(i, c + sd * 0.6, 1.1), at(j, c + sd * 0.6, 1.1), at(j, c, 1.1), shade(wc, 0.9));
        wall.quad(at(i, c + sd * 0.6, 1.1), at(i, c + sd * 0.6, -0.2), at(j, c + sd * 0.6, -0.2), at(j, c + sd * 0.6, 1.1), shade(wc, 0.78));
        const top = at(i, c + sd * 0.6, 0), top2 = at(j, c + sd * 0.6, 0);
        under.quad(top, [top[0], groundY - 1, top[2]], [top2[0], groundY - 1, top2[2]], top2, shade(pal.ground2, 0.55));
      }
      if (i % 7 === 0 && P[i].y - groundY > 1.2) under.box(P[i].x, (P[i].y + groundY) / 2 - 0.1, P[i].z, 2.2, P[i].y - groundY - 0.2, 2.2, shade(pal.ground2, 0.5));
    }
    // start grid: painted slots behind the line, and the chequered line itself
    const white = pal.line;
    for (let k = 0; k < 4; k++) {
      const i0 = N - 5 - k * 5, off = k % 2 ? 3.6 : -3.6, o = k === 0 ? 0 : off;
      for (const sd of [-1, 1]) mark.quad(at(i0 - 1, o + sd * 1.25 - 0.06, 0.035), at(i0 - 1, o + sd * 1.25 + 0.06, 0.035), at(i0 + 2, o + sd * 1.25 + 0.06, 0.035), at(i0 + 2, o + sd * 1.25 - 0.06, 0.035), white);
      { const A = at(i0 - 1, o - 1.25, 0.035), B = at(i0 - 1, o + 1.25, 0.035), tt = P[(i0 - 1 + N) % N], B2 = [B[0] + tt.tx * 0.16, B[1], B[2] + tt.tz * 0.16], A2 = [A[0] + tt.tx * 0.16, A[1], A[2] + tt.tz * 0.16]; mark.quad(A, B, B2, A2, white); }
    }
    const sl = new Mesher(), cols = 12;
    for (let c = 0; c < cols; c++) for (let r = 0; r < 2; r++) {
      const o0 = -half + (c / cols) * tr.width, o1 = -half + ((c + 1) / cols) * tr.width;
      sl.quad(at(r, o0, 0.05), at(r, o1, 0.05), at(r + 1, o1, 0.05), at(r + 1, o0, 0.05), (c + r) % 2 ? '#17142b' : '#ffffff');
    }
    world.add(road.mesh(mat, false, true), mark.mesh(mat, false, true), kerb.mesh(mat, false, true), wall.mesh(mat, true, true), under.mesh(mat, true, true), sl.mesh(mat, false, true));
    // gantry over the line
    const a0 = P[0]; const arch = new T.Group(); arch.position.set(a0.x, a0.y, a0.z); arch.rotation.y = heading(0);
    const post = new T.MeshLambertMaterial({ color: pal.wall, flatShading: true });
    for (const sx of [-1, 1]) { const m = new T.Mesh(new T.BoxGeometry(0.8, 8.5, 0.8), post); m.position.set(sx * (bar + 0.8), 4.25, 0); m.castShadow = true; arch.add(m); }
    const bn = new T.Mesh(new T.BoxGeometry(bar * 2 + 1.8, 1.9, 0.5), new T.MeshBasicMaterial({ map: bannerTexture(pal) })); bn.position.set(0, 8.2, 0); bn.castShadow = true; arch.add(bn);
    world.add(arch);

    // ground: soft low-poly hills that stay well below the road
    const ext = 300, cells = 74, gm = new Mesher(), size = (Math.max(maxX - minX, maxZ - minZ) / 2 + ext), cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const near = new Map(), cellSz = 24, key = (x, z) => Math.floor(x / cellSz) + ',' + Math.floor(z / cellSz);
    for (const p of P) { const k = key(p.x, p.z); if (!near.has(k)) near.set(k, []); near.get(k).push(p); }
    const distTrack = (x, z) => { let d = 1e9; const gx = Math.floor(x / cellSz), gz = Math.floor(z / cellSz); for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const l = near.get((gx + a) + ',' + (gz + b)); if (l) for (const p of l) d = Math.min(d, Math.hypot(p.x - x, p.z - z)); } return d; };
    gh = (x, z) => {
      const d = distTrack(x, z), far = clamp((d - bar - 10) / 80, 0, 1);
      const n = Math.sin(x * 0.016 + 1.3) * Math.cos(z * 0.019) * 10 + Math.sin(x * 0.045 + z * 0.037) * 3.5 + (hash2(Math.round(x / 16), Math.round(z / 16)) - 0.5) * 5;
      return groundY + far * far * Math.max(-1.5, n + 5);
    };
    const step = (size * 2) / cells, H = (i, j) => { const x = cx - size + i * step, z = cz - size + j * step; return [x, gh(x, z), z]; };
    const cacheH = []; for (let i = 0; i <= cells; i++) { cacheH[i] = []; for (let j = 0; j <= cells; j++) cacheH[i][j] = H(i, j); }
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const a = cacheH[i][j], b = cacheH[i + 1][j], c = cacheH[i + 1][j + 1], d = cacheH[i][j + 1];
      gm.tri(a, d, c, hash2(i, j) > 0.5 ? pal.ground : pal.ground2); gm.tri(a, c, b, hash2(j, i) > 0.5 ? pal.ground : pal.ground2);
    }
    world.add(gm.mesh(mat, false, true));

    // grandstands (start straight both sides + one more on the far side of the circuit) and billboards
    const sc = new Mesher(), rnd = Core.rng(tr.def.seed || tr.id.length * 977 + 31);
    function stand(iC, side, len, rows) {
      const p = P[iC % N], ry = heading(iC), r = [p.tz, -p.tx], t = [p.tx, p.tz], base = bar + 4.5, secs = Math.round(len / 3);
      for (let k = 0; k < rows; k++) {
        const out = base + k * 1.25 + 0.6, h = (k + 1) * 0.75;
        const cxk = p.x + r[0] * side * out, czk = p.z + r[1] * side * out;
        sc.box(cxk, p.y - 0.4 + h / 2 - 0.2, czk, 1.25, h + 0.4, len, '#cfd5e8', ry);
        for (let s = 0; s < secs; s++) {
          const v = (s - (secs - 1) / 2) * 3, sx = cxk + t[0] * v, sz = czk + t[1] * v, col = pal.stand[(s + k) % pal.stand.length];
          sc.box(sx, p.y - 0.4 + h + 0.12, sz, 0.8, 0.25, 2.7, col, ry);
          for (let q = 0; q < 3; q++) if (rnd() > 0.28) { const f = (q - 1) * 0.9; sc.box(sx + t[0] * f, p.y - 0.4 + h + 0.6, sz + t[1] * f, 0.32, 0.55, 0.32, ['#ffd166', '#f4efe6', '#ff8fa3', '#7bdff2', '#b2f7ef'][(rnd() * 5) | 0], ry); }
        }
      }
      const roofOut = base + (rows * 1.25) / 2 + 0.2, rx = p.x + r[0] * side * roofOut, rz = p.z + r[1] * side * roofOut, hh = rows * 0.75 + 3.4;
      sc.box(rx, p.y - 0.4 + hh, rz, rows * 1.25 + 2.2, 0.35, len + 2, pal.stand[0], ry);
      sc.box(rx, p.y - 0.4 + hh + 0.3, rz, rows * 1.25 + 2.4, 0.12, len + 2.2, shade(pal.stand[0], 0.75), ry);
      for (const e of [-1, 1]) for (const f of [-1, 1]) sc.box(p.x + r[0] * side * (base + (f > 0 ? rows * 1.25 + 0.6 : 0.4)) + t[0] * e * len / 2, p.y - 0.4 + hh / 2, p.z + r[1] * side * (base + (f > 0 ? rows * 1.25 + 0.6 : 0.4)) + t[1] * e * len / 2, 0.3, hh, 0.3, '#e8ecf7', ry);
    }
    stand(Math.round(15 / 1), 1, 54, 5); stand(Math.round(22), -1, 40, 4);
    // billboards on posts just outside the barrier
    for (let i = 40; i < N - 20; i += 34) {
      const p = P[i], sd = ((i / 34) | 0) % 2 ? 1 : -1, o = bar + 2.6, ry = heading(i), col = pal.stand[((i / 34) | 0) % pal.stand.length];
      sc.box(p.x + p.tz * sd * o, p.y + 1.8, p.z - p.tx * sd * o, 0.25, 3.2, 0.25, '#e8ecf7', ry); sc.box(p.x + p.tz * sd * o, p.y + 3.6, p.z - p.tx * sd * o, 0.3, 1.5, 9, col, ry); sc.box(p.x + p.tz * sd * o, p.y + 3.6, p.z - p.tx * sd * o, 0.34, 0.5, 7, '#ffffff', ry);
    }
    // scenery: a single theme per circuit, kept sparse and simple
    const theme = tr.def.theme || 'palm';
    let placed = 0, tries = 0;
    while (placed < 200 && tries < 2400) {
      tries++; const x = cx + (rnd() - 0.5) * size * 1.9, z = cz + (rnd() - 0.5) * size * 1.9, d = distTrack(x, z);
      if (d < bar + 9) continue; const y = gh(x, z), s = 0.8 + rnd() * 1.1, pick = rnd();
      if (pick < 0.62) {
        if (theme === 'palm') { sc.cone(x, y, z, 0.28 * s, 5.2 * s, pal.trunk, 5, 0, [0.5 * s, 0.3 * s]); const tx = x + 0.5 * s, tz = z + 0.3 * s, ty = y + 5.2 * s; for (let f = 0; f < 6; f++) { const a = f * 1.047 + rnd() * 0.3, L = 2.6 * s, w = 0.7 * s; sc.tri([tx, ty, tz], [tx + Math.cos(a) * L + Math.cos(a + 1.57) * w, ty - 0.9 * s, tz + Math.sin(a) * L + Math.sin(a + 1.57) * w], [tx + Math.cos(a) * L - Math.cos(a + 1.57) * w, ty - 0.9 * s, tz + Math.sin(a) * L - Math.sin(a + 1.57) * w], f % 2 ? pal.tree : pal.tree2); } }
        else if (theme === 'cactus') { sc.box(x, y + 1.6 * s, z, 0.7 * s, 3.2 * s, 0.7 * s, pal.tree); sc.box(x - 0.7 * s, y + 2.0 * s, z, 0.9 * s, 0.35 * s, 0.35 * s, pal.tree2); sc.box(x - 1.05 * s, y + 2.6 * s, z, 0.35 * s, 1.2 * s, 0.35 * s, pal.tree2); sc.box(x + 0.6 * s, y + 1.5 * s, z, 0.8 * s, 0.35 * s, 0.35 * s, pal.tree2); sc.box(x + 0.9 * s, y + 2.1 * s, z, 0.35 * s, 1.1 * s, 0.35 * s, pal.tree2); }
        else { const h = 3 + rnd() * 5; sc.cone(x, y - 0.2, z, 0.9 * s, h * s, rnd() > 0.5 ? pal.tree : pal.tree2, 4, rnd() * 3); sc.cone(x + 1.3 * s, y - 0.2, z + 0.5, 0.55 * s, h * 0.6 * s, pal.tree2, 4, rnd() * 3); }
      } else if (pick < 0.8) sc.cone(x, y, z, 1.3 * s, 1.1 * s, shade(pal.tree, 0.85), 5, rnd() * 3);                       // bush
      else if (theme === 'cactus' && rnd() > 0.5) { const w = 5 + rnd() * 6, h = 4 + rnd() * 6; sc.box(x, y + h / 2, z, w, h, w * 0.8, pal.rock, rnd() * 3); sc.box(x, y + h + 0.3, z, w * 0.8, 0.6, w * 0.65, shade(pal.rock, 1.12), 0); }  // mesa
      else sc.rock(x, y, z, 1 + rnd() * 2.2, pal.rock, rnd() * 6);
      placed++;
    }
    world.add(sc.mesh(mat, true, true));
    // a few low-poly clouds
    const cl = new Mesher();
    for (let i = 0; i < 9; i++) { const x = cx + (rnd() - 0.5) * 900, z = cz + (rnd() - 0.5) * 900, y = 150 + rnd() * 60, s = 18 + rnd() * 22; for (let k = 0; k < 3; k++) cl.rock(x + (k - 1) * s * 0.9, y + (k === 1 ? 4 : 0), z + rnd() * 6, s * (k === 1 ? 1.0 : 0.7), pal.cloud, k + i); }
    world.add(cl.mesh(new T.MeshBasicMaterial({ vertexColors: true, fog: true }), false, false));
  }

  function emit(x, y, z, vx, vy, vz, color, size, life) {
    const s = pool[pi++ % pool.length]; s.visible = true; s.position.set(x, y, z); s.material.color.set(color); s.material.opacity = 0.5;
    Object.assign(s.userData, { life, max: life, vx, vy, vz, s0: size }); s.scale.setScalar(size);
  }
  function lightFollow(x, y, z) {
    sun.position.set(x + sunDir.x * 140, y + sunDir.y * 140, z + sunDir.z * 140); sun.target.position.set(x, y, z); sun.target.updateMatrixWorld();
    disc.position.set(camera.position.x + sunDir.x * 800, camera.position.y + sunDir.y * 800, camera.position.z + sunDir.z * 800); disc.lookAt(camera.position);
  }

  const lastFx = { t: 0 }; let offsetOn = false;
  function poseCar(obj, x, y, z, h, pitch, roll) { obj.position.set(x, y + 0.02, z); obj.rotation.order = 'YXZ'; obj.rotation.set(pitch, h, roll); }

  /** modes: 'race' (chase cam), 'showcase' (menu: slow turntable around the car on the start grid) */
  function frame(c, ghostPose, dt, mode, t) {
    if (!track) return;
    if (mode === 'showcase') {
      const p = track.pts[track.N - 5], h = Math.atan2(p.tx, p.tz);
      poseCar(car, p.x, p.y, p.z, h, 0, 0); ghost.visible = false;
      for (const w of car.userData.wheels) { w.spin.rotation.x += dt * 0.4; w.pivot.rotation.y = 0; }
      const a = t * 0.35 + 0.6, R = 8.6 * (camera.aspect < 1 ? 1.7 : 1);
      camera.position.set(p.x + Math.cos(a) * R, p.y + 2.3 + Math.sin(t * 0.5) * 0.25, p.z + Math.sin(a) * R); camera.lookAt(p.x, p.y + 0.8, p.z);
      const W = canvas.clientWidth || innerWidth, Hh = canvas.clientHeight || innerHeight, wide = W > 760;
      camera.setViewOffset(W, Hh, wide ? -W * 0.2 : 0, wide ? 0 : Hh * 0.2, W, Hh); offsetOn = true;      // keep the car clear of the garage panel
      if (camera.fov !== 42) { camera.fov = 42; camera.updateProjectionMatrix(); } cam.fov = 42; cam.init = false;
      lightFollow(p.x, p.y, p.z); renderer.render(scene, camera); return;
    }
    car.visible = true; if (offsetOn) { camera.clearViewOffset(); offsetOn = false; camera.updateProjectionMatrix(); }
    const q = Core.nearest(track, c.x, c.z, c.idx), y = q.y, fx = Math.sin(c.h), fz = Math.cos(c.h);
    const a = track.pts[(c.idx + 2) % track.N], b = track.pts[(c.idx + 7) % track.N], slope = (b.y - a.y) / (track.ds * 5);
    poseCar(car, c.x, y, c.z, c.h, -Math.atan(slope), clamp(-c.steer * 0.04 * clamp(c.speed / 20, 0, 1.4), -0.1, 0.1));
    const ud = car.userData, roll = (c.vf * dt) / 0.42;
    for (const w of ud.wheels) { w.spin.rotation.x += roll / (w.r / 0.42); if (w.front) w.pivot.rotation.y = clamp(c.steer * 0.35, -0.5, 0.5); }
    if (ghostPose) { ghost.visible = true; poseCar(ghost, ghostPose.x, ghostPose.y, ghostPose.z, ghostPose.h, 0, 0); } else ghost.visible = false;
    // camera: springy chase
    const k = 1 - Math.exp(-dt * 6.5), sp = c.speed, back = 7.8 + sp * 0.05, up = 3.0 + sp * 0.012;
    const tx = c.x - fx * back, tz = c.z - fz * back, ty = y + up, snap = cam.init ? 1 : 100;
    cam.x = lerp(cam.x, tx, Math.min(1, k * snap)); cam.y = lerp(cam.y, ty, Math.min(1, k * snap)); cam.z = lerp(cam.z, tz, Math.min(1, k * snap)); cam.init = true;
    cam.lx = lerp(cam.lx, c.x + fx * 7, 1 - Math.exp(-dt * 9)); cam.lz = lerp(cam.lz, c.z + fz * 7, 1 - Math.exp(-dt * 9)); cam.ly = y + 1.3;
    if (c.hit > 3 && !reduced) cam.shake = Math.min(1, c.hit / 20 + cam.shake);
    cam.shake *= Math.exp(-dt * 7);
    camera.position.set(cam.x + (Math.random() - 0.5) * cam.shake * 0.7, cam.y + (Math.random() - 0.5) * cam.shake * 0.45, cam.z + (Math.random() - 0.5) * cam.shake * 0.7);
    camera.lookAt(cam.lx, cam.ly, cam.lz);
    const fov = 58 + clamp(sp / 46, 0, 1) * 12; if (Math.abs(fov - cam.fov) > 0.05 || camera.fov !== cam.fov) { cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-dt * 4)); camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    lightFollow(c.x, y, c.z);
    // dust and smoke: kept subtle
    lastFx.t += dt;
    if (!reduced && lastFx.t > 0.04) {
      lastFx.t = 0;
      if (c.off && sp > 6) for (const sd of [-0.9, 0.9]) emit(c.x - fx * 2 + Math.cos(c.h) * sd, y + 0.3, c.z - fz * 2 - Math.sin(c.h) * sd, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, track.pal.ground, 1.5, 0.6);
      else if (c.drift > 3.5 && sp > 8) for (const sd of [-0.9, 0.9]) emit(c.x - fx * 1.6 + Math.cos(c.h) * sd, y + 0.25, c.z - fz * 1.6 - Math.sin(c.h) * sd, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), '#f1f3fa', 1.2, 0.55);
    }
    for (const s of pool) if (s.visible) { const u = s.userData; u.life -= dt; if (u.life <= 0) { s.visible = false; continue; } const f = u.life / u.max; s.position.x += u.vx * dt; s.position.y += u.vy * dt; s.position.z += u.vz * dt; s.material.opacity = 0.45 * f; s.scale.setScalar(u.s0 * (1.6 - f * 0.6)); }
    renderer.render(scene, camera);
  }
  function resetCamera() { cam.init = false; cam.shake = 0; cam.fov = 60; }
  function resize() { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  return { setTrack, setCar, setGhostCar, frame, resize, resetCamera, renderer, scene, camera, LIVERIES };
}
