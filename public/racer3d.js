/* BLANION RACER — the 3D view. A flat-shaded "low-poly" look: the whole circuit (road, kerbs, barriers, ground, trees, rocks, supports)
 * is built from coloured triangles into a handful of merged meshes, so it draws fast on phones. Physics lives in racer-core.js. */
import * as T from '/vendor/three-lite.min.js';
const Core = window.RacerCore;                                   // classic script (UMD) so Node tests can load it too

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------------------------------------- merged, vertex-coloured geometry */
class Mesher {
  constructor() { this.pos = []; this.col = []; this._c = new T.Color(); }
  rgb(hex) { this._c.set(hex); return [this._c.r, this._c.g, this._c.b]; }
  tri(a, b, c, color) { const k = this.rgb(color); for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(k[0], k[1], k[2]); } }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  box(cx, cy, cz, sx, sy, sz, color, ry = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) this.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], color);
  }
  cone(cx, cy, cz, r, h, color, seg = 6, rot = 0) {
    const top = [cx, cy + h, cz];
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
  mesh(mat) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere(); const m = new T.Mesh(g, mat); m.frustumCulled = false; return m;
  }
}

function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

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
function bannerTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  for (let i = 0; i < 32; i++) for (let j = 0; j < 6; j++) { g.fillStyle = (i + j) % 2 ? '#101820' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); }
  g.fillStyle = 'rgba(8,16,32,.82)'; g.fillRect(96, 18, 320, 60); g.fillStyle = '#ffd54f'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.fillText('START / FINISH', 256, 60);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}

/* ---------------------------------------------------------------------- the car model */
export const CAR_COLORS = ['#ff5d4a', '#ffd54f', '#35e0b0', '#4aa8ff', '#c77dff', '#f4f4f4'];
function carModel(color, ghost) {
  const g = new T.Group(), mats = [];
  const M = (c, extra) => { const m = ghost ? new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.38, depthWrite: false }) : new T.MeshLambertMaterial({ color: c, flatShading: true, ...extra }); mats.push(m); return m; };
  const add = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new T.BoxGeometry(1.9, 0.5, 4.2), M(color), 0, 0.62, 0);
  add(new T.BoxGeometry(1.7, 0.32, 1.1), M(color), 0, 0.92, 1.35).rotation.x = 0.16;       // bonnet slope
  add(new T.BoxGeometry(1.52, 0.5, 1.9), M('#16202e'), 0, 1.07, -0.35);                 // cabin / glass
  add(new T.BoxGeometry(1.56, 0.12, 1.5), M(color), 0, 1.35, -0.35);                    // roof
  add(new T.BoxGeometry(2.0, 0.1, 0.55), M('#101820'), 0, 1.28, -2.0);                  // wing
  add(new T.BoxGeometry(0.1, 0.4, 0.3), M('#101820'), -0.6, 1.05, -1.95); add(new T.BoxGeometry(0.1, 0.4, 0.3), M('#101820'), 0.6, 1.05, -1.95);
  add(new T.BoxGeometry(1.4, 0.12, 0.3), M('#101820'), 0, 0.4, 2.15);                   // splitter
  if (!ghost) {
    add(new T.BoxGeometry(0.36, 0.14, 0.08), new T.MeshBasicMaterial({ color: '#fff6c2' }), -0.6, 0.72, 2.12); add(new T.BoxGeometry(0.36, 0.14, 0.08), new T.MeshBasicMaterial({ color: '#fff6c2' }), 0.6, 0.72, 2.12);
    add(new T.BoxGeometry(0.4, 0.12, 0.08), new T.MeshBasicMaterial({ color: '#ff3b30' }), -0.62, 0.78, -2.12); add(new T.BoxGeometry(0.4, 0.12, 0.08), new T.MeshBasicMaterial({ color: '#ff3b30' }), 0.62, 0.78, -2.12);
  }
  const wheels = [];
  for (const [x, z] of [[-1, 1.35], [1, 1.35], [-1, -1.3], [1, -1.3]]) {
    const pivot = new T.Group(); pivot.position.set(x * 1.0, 0.42, z); g.add(pivot);
    const w = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.36, 8), M('#10151c')); w.rotation.z = Math.PI / 2; pivot.add(w);
    const hub = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.38, 6), M('#cfd8e3')); hub.rotation.z = Math.PI / 2; pivot.add(hub);
    wheels.push({ pivot, spin: w, hub, front: z > 0 });
  }
  g.userData = { wheels, mats, body: mats[0] };
  return g;
}

/* ---------------------------------------------------------------------- the view */
export function createView(canvas, opts = {}) {
  const reduced = !!opts.reduced;
  const renderer = new T.WebGLRenderer({ canvas, antialias: !opts.lowQuality, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2));
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(62, 1, 0.5, 900);
  const hemi = new T.HemisphereLight('#ffffff', '#88a', 1.0), sun = new T.DirectionalLight('#fff4dd', 1.15); sun.position.set(-60, 120, 40);
  scene.add(hemi, sun, sun.target);
  const world = new T.Group(); scene.add(world);
  const dot = softDot();

  let track = null, carColor = CAR_COLORS[0];
  const car = carModel(carColor, false), ghost = carModel('#ffffff', true), blob = new T.Mesh(new T.CircleGeometry(1.9, 16), new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; scene.add(car, ghost, blob); ghost.visible = false;
  const pool = []; for (let i = 0; i < 48; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; s.userData = { life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1 }; scene.add(s); pool.push(s); }
  let pi = 0;
  const cam = { x: 0, y: 5, z: -8, lx: 0, ly: 1, lz: 0, shake: 0, fov: 62 };
  let groundY = 0, gh = null;

  function setCarColor(hex) { carColor = hex; for (const i of [0, 1, 3]) car.userData.mats[i].color.set(hex); }

  function groundHeight(x, z) { return gh ? gh(x, z) : 0; }

  /* ------------------------------------------------------------------ build a circuit */
  function setTrack(tr) {
    track = tr; for (const c of [...world.children]) { world.remove(c); c.geometry && c.geometry.dispose(); }
    const pal = tr.pal, P = tr.pts, N = tr.N, half = tr.half, bar = tr.barrier;
    scene.background = skyTexture(pal.sky); scene.fog = new T.Fog(pal.fog, 110, 520);
    hemi.color.set(pal.sky[1]); hemi.groundColor.set(pal.ground2);
    const mat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
    let minY = 1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of P) { minY = Math.min(minY, p.y); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    groundY = minY - 0.8;
    const at = (i, off, dy = 0) => { const p = P[((i % N) + N) % N]; return [p.x + p.tz * off, p.y + dy, p.z - p.tx * off]; };

    const road = new Mesher(), kerb = new Mesher(), wall = new Mesher(), under = new Mesher();
    for (let i = 0; i < N; i++) {
      const j = i + 1;
      road.quad(at(i, -half), at(i, half), at(j, half), at(j, -half), Math.floor(i / 5) % 2 ? pal.road : pal.road2);
      for (const sd of [-1, 1]) {
        const a = sd * half, b = sd * (half + 1.0), c = sd * bar;
        kerb.quad(at(i, a, 0.03), at(i, b, 0.03), at(j, b, 0.03), at(j, a, 0.03), Math.floor(i / 2) % 2 ? pal.kerbA : pal.kerbB);
        kerb.quad(at(i, b, 0.01), at(i, c, 0.01), at(j, c, 0.01), at(j, b, 0.01), pal.ground2);                         // run-off
        const wc = Math.floor(i / 4) % 2 ? pal.wall : pal.kerbB;
        wall.quad(at(i, c, 0), at(i, c, 1.15), at(j, c, 1.15), at(j, c, 0), wc);                                          // inner face
        wall.quad(at(i, c, 1.15), at(i, c + sd * 0.7, 1.15), at(j, c + sd * 0.7, 1.15), at(j, c, 1.15), wc);                // top
        wall.quad(at(i, c + sd * 0.7, 1.15), at(i, c + sd * 0.7, -0.2), at(j, c + sd * 0.7, -0.2), at(j, c + sd * 0.7, 1.15), pal.road);
        // skirt hiding the underside of the raised road
        const top = at(i, c + sd * 0.7, 0), top2 = at(j, c + sd * 0.7, 0);
        under.quad(top, [top[0], groundY - 1, top[2]], [top2[0], groundY - 1, top2[2]], top2, '#1c2430');
      }
      if (i % 7 === 0 && P[i].y - groundY > 1.2) under.box(P[i].x, (P[i].y + groundY) / 2 - 0.1, P[i].z, 2.2, P[i].y - groundY - 0.2, 2.2, '#2a3340');
    }
    // start / finish line + arch
    const sl = new Mesher(), cols = 10;
    for (let c = 0; c < cols; c++) for (let r = 0; r < 2; r++) {
      const o0 = -half + (c / cols) * tr.width, o1 = -half + ((c + 1) / cols) * tr.width;
      sl.quad(at(r, o0, 0.05), at(r, o1, 0.05), at(r + 1, o1, 0.05), at(r + 1, o0, 0.05), (c + r) % 2 ? '#0b0f14' : '#ffffff');
    }
    world.add(road.mesh(mat), kerb.mesh(mat), wall.mesh(mat), under.mesh(mat), sl.mesh(mat));
    const a0 = P[0]; const arch = new T.Group(); arch.position.set(a0.x, a0.y, a0.z); arch.rotation.y = Math.atan2(a0.tx, a0.tz);
    const post = new T.MeshLambertMaterial({ color: '#e8f1f8', flatShading: true });
    for (const sx of [-1, 1]) { const m = new T.Mesh(new T.BoxGeometry(0.7, 8, 0.7), post); m.position.set(sx * (bar + 0.6), 4, 0); arch.add(m); }
    const bn = new T.Mesh(new T.BoxGeometry(bar * 2 + 1.4, 1.8, 0.5), new T.MeshBasicMaterial({ map: bannerTexture() })); bn.position.set(0, 8, 0); arch.add(bn);
    world.add(arch);

    // ground: low-poly hills that stay below the road, nudged up/down by noise away from the track
    const ext = 280, cells = 70, gm = new Mesher(), size = (Math.max(maxX - minX, maxZ - minZ) / 2 + ext), cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const near = new Map();                                                                                              // coarse distance field
    const cellSz = 24, key = (x, z) => Math.floor(x / cellSz) + ',' + Math.floor(z / cellSz);
    for (const p of P) { const k = key(p.x, p.z); if (!near.has(k)) near.set(k, []); near.get(k).push(p); }
    const distTrack = (x, z) => { let d = 1e9; const gx = Math.floor(x / cellSz), gz = Math.floor(z / cellSz); for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const l = near.get((gx + a) + ',' + (gz + b)); if (l) for (const p of l) d = Math.min(d, Math.hypot(p.x - x, p.z - z)); } return d; };
    gh = (x, z) => {
      const d = distTrack(x, z), far = clamp((d - bar - 8) / 70, 0, 1);
      const n = Math.sin(x * 0.018 + 1.3) * Math.cos(z * 0.021) * 9 + Math.sin(x * 0.047 + z * 0.039) * 3.5 + (hash2(Math.round(x / 14), Math.round(z / 14)) - 0.5) * 5;
      return groundY + far * far * Math.max(-1.5, n + 4) + (d > 400 ? 6 : 0) * 0;
    };
    const step = (size * 2) / cells, vx = [], H = (i, j) => { const x = cx - size + i * step, z = cz - size + j * step; return [x, gh(x, z), z]; };
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const a = H(i, j), b = H(i + 1, j), c = H(i + 1, j + 1), d = H(i, j + 1), col = hash2(i, j) > 0.5 ? pal.ground : pal.ground2;
      gm.tri(a, d, c, col); gm.tri(a, c, b, hash2(j, i) > 0.5 ? pal.ground : pal.ground2);
    }
    void vx;
    world.add(gm.mesh(mat));

    // scenery
    const sc = new Mesher(), rnd = Core.rng(tr.def.seed || tr.id.length * 977 + 31);
    let placed = 0, tries = 0;
    while (placed < 260 && tries < 2400) {
      tries++; const x = cx + (rnd() - 0.5) * size * 1.9, z = cz + (rnd() - 0.5) * size * 1.9, d = distTrack(x, z);
      if (d < bar + 6) continue; const y = gh(x, z);
      if (rnd() < 0.78) { const s = 0.8 + rnd() * 1.2; sc.box(x, y + 1.0 * s, z, 0.5 * s, 2 * s, 0.5 * s, pal.trunk); sc.cone(x, y + 1.6 * s, z, 2.1 * s, 3.2 * s, rnd() > 0.5 ? pal.tree : pal.tree2, 6, rnd() * 6); sc.cone(x, y + 3.3 * s, z, 1.5 * s, 2.7 * s, pal.tree2, 6, rnd() * 6); }
      else sc.rock(x, y, z, 1 + rnd() * 2.4, pal.rock, rnd() * 6);
      placed++;
    }
    world.add(sc.mesh(mat));
  }

  function emit(x, y, z, vx, vy, vz, color, size, life) {
    const s = pool[pi++ % pool.length]; s.visible = true; s.position.set(x, y, z); s.material.color.set(color); s.material.opacity = 0.55;
    Object.assign(s.userData, { life, max: life, vx, vy, vz, s0: size }); s.scale.setScalar(size);
  }

  const lastFx = { t: 0 };
  /** place the car, camera and effects. state: Core car; ghostPose {x,z,h,y}|null; dt seconds; mode 'race'|'orbit' */
  function frame(c, ghostPose, dt, mode, t) {
    if (!track) return;
    if (mode === 'orbit') {
      const a = t * 0.12, R = 170, mid = track.pts[(Math.floor(t * 6)) % track.N];
      camera.position.set(mid.x + Math.cos(a) * R * 0.6, mid.y + 70, mid.z + Math.sin(a) * R * 0.6); camera.lookAt(mid.x, mid.y, mid.z); camera.fov = 60; camera.updateProjectionMatrix();
      car.visible = false; blob.visible = false; ghost.visible = false; renderer.render(scene, camera); return;
    }
    car.visible = true; blob.visible = true;
    const q = Core.nearest(track, c.x, c.z, c.idx), y = q.y, fx = Math.sin(c.h), fz = Math.cos(c.h);
    const a = track.pts[(c.idx + 2) % track.N], b = track.pts[(c.idx + 7) % track.N], slope = (b.y - a.y) / (track.ds * 5);
    car.position.set(c.x, y + 0.02, c.z); car.rotation.set(0, 0, 0); car.rotation.order = 'YXZ'; car.rotation.y = c.h; car.rotation.x = -Math.atan(slope);
    car.rotation.z = clamp(-c.steer * 0.035 * clamp(c.speed / 20, 0, 1.4), -0.1, 0.1) + (c.drift > 2 ? Math.sign(c.steer) * -0.02 : 0);
    blob.position.set(c.x, y + 0.04, c.z);
    const ud = car.userData, roll = (c.vf * dt) / 0.42;
    for (const w of ud.wheels) { w.spin.rotation.x += roll; w.hub.rotation.x += roll; if (w.front) w.pivot.rotation.y = clamp(c.steer * 0.35, -0.5, 0.5); }
    if (ghostPose) { ghost.visible = true; ghost.rotation.order = 'YXZ'; ghost.position.set(ghostPose.x, ghostPose.y + 0.02, ghostPose.z); ghost.rotation.y = ghostPose.h; } else ghost.visible = false;
    // camera: springy chase
    const k = 1 - Math.exp(-dt * 6.5), sp = c.speed, back = 7.6 + sp * 0.05, up = 3.0 + sp * 0.012;
    const tx = c.x - fx * back, tz = c.z - fz * back, ty = y + up;
    cam.x = lerp(cam.x, tx, k * (cam.init ? 1 : 100)); cam.y = lerp(cam.y, ty, k); cam.z = lerp(cam.z, tz, k * (cam.init ? 1 : 100)); cam.init = true;
    cam.lx = lerp(cam.lx, c.x + fx * 7, 1 - Math.exp(-dt * 9)); cam.lz = lerp(cam.lz, c.z + fz * 7, 1 - Math.exp(-dt * 9)); cam.ly = y + 1.3;
    if (c.hit > 3 && !reduced) cam.shake = Math.min(1, c.hit / 20 + cam.shake);
    cam.shake *= Math.exp(-dt * 7);
    camera.position.set(cam.x + (Math.random() - 0.5) * cam.shake * 0.8, cam.y + (Math.random() - 0.5) * cam.shake * 0.5, cam.z + (Math.random() - 0.5) * cam.shake * 0.8);
    camera.lookAt(cam.lx, cam.ly, cam.lz);
    const fov = 60 + clamp(sp / 46, 0, 1) * 14; if (Math.abs(fov - cam.fov) > 0.05) { cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-dt * 4)); camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    // smoke / dust
    lastFx.t += dt;
    if (!reduced && lastFx.t > 0.03) {
      lastFx.t = 0;
      if (c.off && sp > 6) for (const sd of [-0.9, 0.9]) emit(c.x - fx * 2 + Math.cos(c.h) * sd, y + 0.3, c.z - fz * 2 - Math.sin(c.h) * sd, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, track.pal.ground, 1.6, 0.7);
      else if (c.drift > 3.5 && sp > 8) for (const sd of [-0.9, 0.9]) emit(c.x - fx * 1.6 + Math.cos(c.h) * sd, y + 0.25, c.z - fz * 1.6 - Math.sin(c.h) * sd, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), '#e6edf5', 1.3, 0.6);
      if (c.hit > 4) emit(c.x, y + 0.8, c.z, (Math.random() - 0.5) * 6, 3, (Math.random() - 0.5) * 6, '#ffd54f', 0.6, 0.35);
    }
    for (const s of pool) if (s.visible) { const u = s.userData; u.life -= dt; if (u.life <= 0) { s.visible = false; continue; } const f = u.life / u.max; s.position.x += u.vx * dt; s.position.y += u.vy * dt; s.position.z += u.vz * dt; s.material.opacity = 0.5 * f; s.scale.setScalar(u.s0 * (1.6 - f * 0.6)); }
    renderer.render(scene, camera);
  }
  function resetCamera() { cam.init = false; cam.shake = 0; }
  function resize() { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  return { setTrack, setCarColor, frame, resize, resetCamera, renderer, scene, camera, groundHeight, get carColor() { return carColor; } };
}
