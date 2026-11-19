/* BLANION MINI GOLF — the 3D view. Builds a course from hole data (golf-physics.js), draws it with soft shadows, procedural
 * textures, water, sand, bumpers, a spinner, flag and scenery, and exposes camera/aim/particle helpers to golf.js.
 * Course coordinates (x, y) map to world (x, 0, -y): "up the course" is away from the default camera. */
import * as T from '/vendor/three-lite.min.js';

const BALL_R = 0.1, HOLE_R = 0.17;
const RAIL_H = 0.17, RAIL_T = 0.14, SLAB = 0.26;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = d => (d * Math.PI) / 180;
const wx = (x, y, h = 0) => new T.Vector3(x, h, -y);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ------------------------------------------------------------------ procedural textures */
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.clamp ? T.ClampToEdgeWrapping : T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function speckle(g, w, h, n, colors, rnd, size = 2) { for (let i = 0; i < n; i++) { g.fillStyle = colors[(rnd() * colors.length) | 0]; g.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd())); } }

function makeTextures() {
  const r = rng(7), tx = {};
  tx.grass = canvasTex(512, 512, (g, w, h) => {
    const bands = 8; for (let i = 0; i < bands; i++) { g.fillStyle = i % 2 ? '#73d466' : '#62c258'; g.fillRect(0, (i * h) / bands, w, h / bands + 1); }
    speckle(g, w, h, 5000, ['rgba(255,255,255,.07)', 'rgba(0,40,0,.09)', 'rgba(150,230,110,.1)'], r, 2);
    g.strokeStyle = 'rgba(0,50,0,.05)'; for (let i = 0; i < 260; i++) { const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 5 - r() * 5); g.stroke(); }
  });
  tx.ground = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#3d8548'; g.fillRect(0, 0, w, h); speckle(g, w, h, 9000, ['rgba(255,255,255,.05)', 'rgba(0,40,0,.10)', 'rgba(170,230,110,.09)', 'rgba(90,140,60,.12)'], r, 3); });
  tx.wood = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#b07a3f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${60 + r() * 40},${30 + r() * 20},10,${0.08 + r() * 0.16})`; g.lineWidth = 1 + r() * 2; const y = r() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 6, w * 0.6, y + (r() - 0.5) * 6, w, y + (r() - 0.5) * 4); g.stroke(); }
    g.fillStyle = 'rgba(60,30,10,.35)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
  });
  tx.sand = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#ead493'; g.fillRect(0, 0, w, h); speckle(g, w, h, 4500, ['rgba(255,255,255,.35)', 'rgba(150,110,40,.25)', 'rgba(210,170,90,.3)'], r, 2); });
  tx.stripes = canvasTex(256, 64, (g, w, h) => { const n = 8; for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#fafafa' : '#e23a30'; g.fillRect((i * w) / n, 0, w / n + 1, h); } });
  tx.ball = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#fbfbfb'; g.fillRect(0, 0, w, h); g.fillStyle = '#2f80ed'; g.fillRect(0, h * 0.42, w, h * 0.16);
    g.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 6; y < h; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < w; x += 12) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); }
  }, { clamp: false });
  tx.chevron = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(w * 0.3, h * 0.2); g.lineTo(w * 0.7, h * 0.5); g.lineTo(w * 0.3, h * 0.8); g.stroke();
  });
  tx.water = canvasTex(256, 256, (g, w, h) => {          // seamless: flat colour + periodic ripple lines that wrap on both axes
    g.fillStyle = '#2a8fd8'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 14; k++) {
      const y0 = (k / 14) * h, a = 3 + (k % 3), ph = k * 1.7;
      for (const dy of [-h, 0, h]) {
        g.strokeStyle = k % 2 ? 'rgba(255,255,255,.26)' : 'rgba(10,50,110,.22)'; g.lineWidth = 2; g.beginPath();
        for (let x = 0; x <= w; x += 4) { const y = y0 + dy + Math.sin(((x / w) * Math.PI * 2 * 2) + ph) * a; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
    }
  });
  tx.flag = canvasTex(128, 80, (g, w, h) => {
    g.fillStyle = '#e63a30'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, w, 10);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.5, h * 0.5, 24, 0, 7); g.fill();
  }, { clamp: true });
  tx.cloud = canvasTex(128, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { clamp: true });
  tx.sky = canvasTex(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#4aa8ee'); gr.addColorStop(0.55, '#9ad4f7'); gr.addColorStop(1, '#e4f5ff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { clamp: true });
  return tx;
}

/* ------------------------------------------------------------------------------- the view */
export function createView(canvas, opts = {}) {
  const lowQ = !!opts.lowQuality, reduced = !!opts.reduced;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = lowQ ? T.PCFShadowMap : T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  const tx = makeTextures();
  const scene = new T.Scene(); scene.background = tx.sky; scene.fog = new T.Fog('#d7efff', 38, 110);
  const camera = new T.PerspectiveCamera(38, 1, 0.1, 220);

  // lights
  scene.add(new T.HemisphereLight('#c7e6ff', '#6d9a58', 0.62));
  const sun = new T.DirectionalLight('#fff0d2', 2.5); sun.castShadow = true; sun.shadow.mapSize.set(lowQ ? 1024 : 2048, lowQ ? 1024 : 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; scene.add(sun, sun.target);
  const fill = new T.DirectionalLight('#9fcfff', 0.55); fill.position.set(-8, 6, -10); scene.add(fill);

  // shared materials
  const M = {
    wood: new T.MeshStandardMaterial({ map: tx.wood, roughness: 0.72, metalness: 0 }),
    woodDark: new T.MeshStandardMaterial({ color: '#6b4524', roughness: 0.8 }),
    slabSide: new T.MeshStandardMaterial({ color: '#d9d3c4', roughness: 0.95 }),
    grass: new T.MeshStandardMaterial({ map: tx.grass, roughness: 0.95 }),
    sand: new T.MeshStandardMaterial({ map: tx.sand, roughness: 1 }),
    stripes: new T.MeshStandardMaterial({ map: tx.stripes, roughness: 0.4, metalness: 0.05 }),
    ball: new T.MeshStandardMaterial({ map: tx.ball, roughness: 0.28, metalness: 0.02 }),
    steel: new T.MeshStandardMaterial({ color: '#cfd6de', roughness: 0.3, metalness: 0.85 }),
    cup: new T.MeshStandardMaterial({ color: '#17191d', roughness: 1, side: T.DoubleSide }),
    stone: new T.MeshStandardMaterial({ color: '#a8a39a', roughness: 0.95, flatShading: true }),
    pole: new T.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 }),
    gold: new T.MeshStandardMaterial({ color: '#f1c24b', roughness: 0.3, metalness: 0.7 }),
    trunk: new T.MeshStandardMaterial({ color: '#6b4a2b', roughness: 1 }),
    pine: new T.MeshStandardMaterial({ color: '#2f7a46', roughness: 1, flatShading: true }),
    pine2: new T.MeshStandardMaterial({ color: '#3b8c52', roughness: 1, flatShading: true }),
    leaf: new T.MeshStandardMaterial({ color: '#58ad4c', roughness: 1, flatShading: true }),
    leaf2: new T.MeshStandardMaterial({ color: '#6cc058', roughness: 1, flatShading: true }),
    hill: new T.MeshStandardMaterial({ color: '#58a053', roughness: 1, flatShading: true }),
    tee: new T.MeshStandardMaterial({ color: '#2a6f9c', roughness: 0.8 }),
    teeMark: new T.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 }),
    water: new T.MeshStandardMaterial({ map: tx.water, color: '#9ed4ff', transparent: true, opacity: 0.86, roughness: 0.12, metalness: 0.1 }),
    pondBed: new T.MeshStandardMaterial({ color: '#2a5a6a', roughness: 1 }),
    flag: new T.MeshStandardMaterial({ map: tx.flag, side: T.DoubleSide, roughness: 0.7 }),
    slope: new T.MeshBasicMaterial({ map: tx.chevron, transparent: true, depthWrite: false, opacity: 0.55 }),
  };
  tx.water.repeat.set(2, 2); tx.chevron.repeat.set(2, 2);
  const flowerMats = ['#ffd54f', '#ff7a8a', '#ffffff', '#c58cff'].map(c => new T.MeshStandardMaterial({ color: c, roughness: 0.7 }));

  const ground = new T.Mesh(new T.PlaneGeometry(300, 300), new T.MeshStandardMaterial({ map: tx.ground, roughness: 1 }));
  tx.ground.repeat.set(60, 60); ground.rotation.x = -Math.PI / 2; ground.position.y = -SLAB - 0.005; ground.receiveShadow = true; scene.add(ground);

  const clouds = [];
  { const r = rng(11); for (let i = 0; i < 9; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: tx.cloud, transparent: true, depthWrite: false, fog: false, opacity: 0.9 })); s.scale.set(26 + r() * 18, 10 + r() * 6, 1); s.position.set(-90 + r() * 180, 28 + r() * 14, -60 - r() * 70); scene.add(s); clouds.push(s); } }

  /* ---------------------------------------------------------------- ball + effects (persistent) */
  const ball = new T.Mesh(new T.SphereGeometry(BALL_R, 32, 22), M.ball); ball.castShadow = true; scene.add(ball);
  const aimGroup = new T.Group(); aimGroup.visible = false; scene.add(aimGroup);
  const arrowShape = new T.Shape(); arrowShape.moveTo(0, -0.07); arrowShape.lineTo(1, -0.07); arrowShape.lineTo(1, -0.17); arrowShape.lineTo(1.3, 0); arrowShape.lineTo(1, 0.17); arrowShape.lineTo(1, 0.07); arrowShape.lineTo(0, 0.07); arrowShape.closePath();
  const arrowMat = new T.MeshBasicMaterial({ color: '#7dff9a', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const arrow = new T.Mesh(new T.ShapeGeometry(arrowShape), arrowMat); arrow.rotation.x = -Math.PI / 2; arrow.renderOrder = 5; aimGroup.add(arrow);
  const dotGeo = new T.CircleGeometry(0.04, 10), dotMat = new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  const dots = []; for (let i = 0; i < 28; i++) { const d = new T.Mesh(dotGeo, dotMat); d.rotation.x = -Math.PI / 2; d.visible = false; d.renderOrder = 4; aimGroup.add(d); dots.push(d); }
  const ring = new T.Mesh(new T.RingGeometry(0.12, 0.15, 24), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })); ring.rotation.x = -Math.PI / 2; ring.renderOrder = 4; aimGroup.add(ring);

  // particle pool
  const pGeo = new T.SphereGeometry(1, 7, 5), cGeo = new T.BoxGeometry(1, 0.15, 0.6);
  const pMats = { puff: new T.MeshBasicMaterial({ color: '#d8d2bd', transparent: true, depthWrite: false }), drop: new T.MeshBasicMaterial({ color: '#9fd8ff', transparent: true }), spark: new T.MeshBasicMaterial({ color: '#fff2a0', transparent: true }) };
  const confMats = ['#ffd54f', '#5be3a1', '#4fc3f7', '#ff9f43', '#e056fd', '#ffffff', '#ff6b6b'].map(c => new T.MeshBasicMaterial({ color: c, transparent: true }));
  const parts = [];
  function spawn(kind, x, y, z, vx, vy, vz, life, size, mat) {
    let p = parts.find(q => !q.alive);
    if (!p) { if (parts.length > 260) return; const m = new T.Mesh(kind === 'conf' ? cGeo : pGeo, mat); m.frustumCulled = false; scene.add(m); p = { m, alive: false }; parts.push(p); }
    p.m.geometry = kind === 'conf' ? cGeo : pGeo; p.m.material = mat; p.kind = kind; p.alive = true; p.m.visible = true;
    p.m.position.set(x, y, z); p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = life; p.size = size; p.m.scale.setScalar(size); p.m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.spin = (Math.random() - 0.5) * 12; mat.opacity = 1;
  }
  const effects = {
    puff(x, y, n = 5) { if (reduced) return; for (let i = 0; i < n; i++) spawn('puff', x, 0.06, -y, (Math.random() - 0.5) * 0.7, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.7, 0.55, 0.05 + Math.random() * 0.03, pMats.puff); },
    splash(x, y) { for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, s = 0.6 + Math.random() * 1.4; spawn('drop', x, 0, -y, Math.cos(a) * s * 0.6, 2.2 + Math.random() * 2, Math.sin(a) * s * 0.6, 0.9, 0.035 + Math.random() * 0.03, pMats.drop); } ripples.push({ x, y, t: 0 }); },
    confetti(x, y, n = 60) { for (let i = 0; i < n; i++) spawn('conf', x, 0.2, -y, (Math.random() - 0.5) * 3.2, 2.5 + Math.random() * 3.5, (Math.random() - 0.5) * 3.2, 1.8 + Math.random() * 0.8, 0.07 + Math.random() * 0.05, confMats[i % confMats.length]); },
    sparkle(x, y) { for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28; spawn('puff', x, 0.1, -y, Math.cos(a) * 0.9, 0.8 + Math.random() * 1.2, Math.sin(a) * 0.9, 0.7, 0.03 + Math.random() * 0.02, pMats.spark); } },
    bump(x, y) { for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; spawn('puff', x, 0.15, -y, Math.cos(a) * 0.8, 0.3, Math.sin(a) * 0.8, 0.4, 0.03, pMats.spark); } },
  };
  const ripples = [];
  const rippleMat = new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false });
  const rippleMesh = []; for (let i = 0; i < 4; i++) { const m = new T.Mesh(new T.RingGeometry(0.9, 1, 32), rippleMat.clone()); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); rippleMesh.push(m); }

  /* ----------------------------------------------------------------------- per-hole course */
  let course = null, courseGroup = null, H = null, waterMeshes = [], slopeTex = [], spinnerGroups = [], trees = [], flagMesh = null, flagBase = null, cupPos = [0, 0], bounds = null;
  const flagWave = { t: 0 };

  function dispose(obj) { obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

  function orient(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a > 0 ? 1 : -1; }   // +1 = counter-clockwise
  function polyShape(pts) { const s = new T.Shape(); pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]))); s.closePath(); return s; }
  function zoneShape(z) { const sh = new T.Shape(); if (z.type === 'circle') sh.absarc(z.x, z.y, z.r, 0, Math.PI * 2, false); else { z.pts.forEach((q, i) => (i ? sh.lineTo(q[0], q[1]) : sh.moveTo(q[0], q[1]))); sh.closePath(); } return sh; }
  function zonePath(z, cls) { const p = new cls(); if (z.type === 'circle') p.absarc(z.x, z.y, z.r, 0, Math.PI * 2, false); else z.pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); if (z.type !== 'circle') p.closePath(); return p; }

  function addRails(group, pts, outer) {
    const sign = orient(pts);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], pr = pts[(i + pts.length - 1) % pts.length], nx = pts[(i + 2) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const ox = (uy * sign) * (outer ? 1 : -1), oy = (-ux * sign) * (outer ? 1 : -1);          // outward normal (away from the ball's side)
      const cross = (v1x, v1y, v2x, v2y) => v1x * v2y - v1y * v2x;
      const convA = cross(a[0] - pr[0], a[1] - pr[1], dx, dy) * sign > 0, convB = cross(dx, dy, nx[0] - b[0], nx[1] - b[1]) * sign > 0;
      const e0 = convA ? RAIL_T : 0, e1 = convB ? RAIL_T : 0, L = len + e0 + e1;
      const geo = new T.BoxGeometry(L, RAIL_H, RAIL_T);
      const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * L * 0.9);
      const m = new T.Mesh(geo, M.wood); m.castShadow = true; m.receiveShadow = true;
      const mx = (a[0] + b[0]) / 2 + ux * (e1 - e0) / 2 + ox * RAIL_T / 2, my = (a[1] + b[1]) / 2 + uy * (e1 - e0) / 2 + oy * RAIL_T / 2;
      m.position.set(mx, RAIL_H / 2, -my); m.rotation.y = Math.atan2(dy, dx);
      group.add(m);
      const cap = new T.Mesh(new T.BoxGeometry(L, 0.02, RAIL_T * 0.98), M.woodDark); cap.position.copy(m.position); cap.position.y = RAIL_H + 0.006; cap.rotation.y = m.rotation.y; group.add(cap);
      const post = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, RAIL_H + 0.02, 12), M.woodDark); post.position.set(a[0], (RAIL_H + 0.02) / 2, -a[1]); post.castShadow = true; group.add(post);
    }
  }

  function buildTree(r, kind, x, z, s) {
    const g = new T.Group();
    const trunk = new T.Mesh(new T.CylinderGeometry(0.14 * s, 0.2 * s, 1.4 * s, 7), M.trunk); trunk.position.y = 0.7 * s; trunk.castShadow = true; g.add(trunk);
    if (kind === 0) { for (let i = 0; i < 3; i++) { const c = new T.Mesh(new T.ConeGeometry((1.25 - i * 0.28) * s, (1.5 - i * 0.2) * s, 8), i % 2 ? M.pine2 : M.pine); c.position.y = (1.7 + i * 0.95) * s; c.castShadow = true; g.add(c); } }
    else { for (let i = 0; i < 4; i++) { const b = new T.Mesh(new T.IcosahedronGeometry((0.9 + r() * 0.35) * s, 1), i % 2 ? M.leaf : M.leaf2); b.position.set((r() - 0.5) * 0.9 * s, (2.0 + r() * 0.9) * s, (r() - 0.5) * 0.9 * s); b.castShadow = true; g.add(b); } }
    g.position.set(x, -SLAB, z); g.rotation.y = r() * 6.28; return g;
  }

  function loadHole(hole) {
    if (courseGroup) { scene.remove(courseGroup); dispose(courseGroup); }
    H = hole; courseGroup = new T.Group(); scene.add(courseGroup); waterMeshes = []; slopeTex = []; spinnerGroups = []; trees = [];
    const r = rng(hole.id * 977 + 13);
    const xs = hole.outline.map(p => p[0]), ys = hole.outline.map(p => p[1]);
    bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    bounds.cx = (bounds.minX + bounds.maxX) / 2; bounds.cy = (bounds.minY + bounds.maxY) / 2; bounds.w = bounds.maxX - bounds.minX; bounds.h = bounds.maxY - bounds.minY;
    cupPos = hole.cup;

    // floor slab: grass top, concrete sides, real holes for the cup and any water
    const shape = polyShape(hole.outline);
    const cupHole = new T.Path(); cupHole.absarc(hole.cup[0], hole.cup[1], HOLE_R, 0, Math.PI * 2, true); shape.holes.push(cupHole);
    for (const z of hole.water || []) shape.holes.push(zonePath(z, T.Path));
    const slabGeo = new T.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false, curveSegments: 28 });
    slabGeo.rotateX(-Math.PI / 2); slabGeo.translate(0, -SLAB, 0);
    // tile the mowing stripes: UVs from the extruder are in world units
    M.grass.map.repeat.set(1 / 4, 1 / 4);
    const slab = new T.Mesh(slabGeo, [M.grass, M.slabSide]); slab.receiveShadow = true; slab.castShadow = true; courseGroup.add(slab);

    // cup
    const cupWall = new T.Mesh(new T.CylinderGeometry(HOLE_R, HOLE_R * 0.96, SLAB, 28, 1, true), M.cup); cupWall.position.set(hole.cup[0], -SLAB / 2, -hole.cup[1]); courseGroup.add(cupWall);
    const cupBottom = new T.Mesh(new T.CircleGeometry(HOLE_R, 24), M.cup); cupBottom.rotation.x = -Math.PI / 2; cupBottom.position.set(hole.cup[0], -SLAB + 0.02, -hole.cup[1]); courseGroup.add(cupBottom);
    const cupRim = new T.Mesh(new T.TorusGeometry(HOLE_R + 0.008, 0.012, 8, 32), M.steel); cupRim.rotation.x = Math.PI / 2; cupRim.position.set(hole.cup[0], 0.004, -hole.cup[1]); courseGroup.add(cupRim);

    // rails and solid blocks
    addRails(courseGroup, hole.outline, true);
    for (const b of hole.blocks || []) { const s = polyShape(b.pts), g = new T.ExtrudeGeometry(s, { depth: RAIL_H, bevelEnabled: false }); g.rotateX(-Math.PI / 2); const m = new T.Mesh(g, M.wood); m.castShadow = m.receiveShadow = true; courseGroup.add(m); }

    // sand
    for (const z of hole.sand || []) {
      const g = new T.ExtrudeGeometry(zoneShape(z), { depth: 0.014, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.03, bevelSegments: 2, curveSegments: 32 });
      g.rotateX(-Math.PI / 2); const m = new T.Mesh(g, M.sand); m.receiveShadow = true; M.sand.map.repeat.set(1 / 1.2, 1 / 1.2); courseGroup.add(m);
    }

    // water: the slab already has a hole, so show a basin and the water surface
    for (const z of hole.water || []) {
      const sh = zoneShape(z);
      const bed = new T.Mesh(new T.ShapeGeometry(sh), M.pondBed); bed.rotation.x = -Math.PI / 2; bed.position.y = -SLAB + 0.03; courseGroup.add(bed);
      const wg = new T.ShapeGeometry(sh); const uv = wg.attributes.uv, pos = wg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.4, pos.getY(i) * 0.4);
      const w = new T.Mesh(wg, M.water); w.rotation.x = -Math.PI / 2; w.position.y = -0.07; w.receiveShadow = true; courseGroup.add(w); waterMeshes.push(w);
      // stones around the pond
      const pts = z.type === 'circle' ? Array.from({ length: 16 }, (_, i) => [z.x + Math.cos((i / 16) * 6.28) * z.r, z.y + Math.sin((i / 16) * 6.28) * z.r]) : z.pts;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(len / 0.32); for (let k = 0; k < n; k++) { const u = (k + 0.5) / n, s = new T.Mesh(new T.DodecahedronGeometry(0.075 + r() * 0.04, 0), M.stone); s.position.set(lerp(a[0], b[0], u), 0.0, -lerp(a[1], b[1], u)); s.scale.y = 0.6; s.castShadow = true; s.rotation.set(r() * 3, r() * 3, r() * 3); courseGroup.add(s); } }
    }

    // slopes (animated chevrons)
    for (const s of hole.slopes || []) {
      const g = new T.ShapeGeometry(zoneShape(s.zone)); const uv = g.attributes.uv, pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.5, pos.getY(i) * 0.5);
      const t = tx.chevron.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = T.RepeatWrapping; t.center.set(0.5, 0.5); t.rotation = -Math.atan2(s.ay, s.ax);
      const mat = M.slope.clone(); mat.map = t; const m = new T.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.y = 0.007; courseGroup.add(m); slopeTex.push({ t, ax: s.ax, ay: s.ay });
    }

    // bumpers
    for (const b of hole.bumpers || []) {
      const g = new T.Group(); g.position.set(b.x, 0, -b.y);
      const body = new T.Mesh(new T.CylinderGeometry(b.r, b.r * 1.05, 0.2, 32), M.stripes); body.position.y = 0.1; body.castShadow = body.receiveShadow = true; g.add(body);
      const top = new T.Mesh(new T.CylinderGeometry(b.r * 0.86, b.r * 0.86, 0.03, 32), new T.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.3, metalness: 0.5 })); top.position.y = 0.215; g.add(top);
      const rim = new T.Mesh(new T.TorusGeometry(b.r * 1.02, 0.02, 8, 32), new T.MeshStandardMaterial({ color: '#c92a20', roughness: 0.4 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.19; g.add(rim);
      g.userData.bumper = b; courseGroup.add(g);
    }

    // spinners
    for (const sp of hole.spinners || []) {
      const g = new T.Group(); g.position.set(sp.x, 0, -sp.y);
      const rot = new T.Group(); g.add(rot);
      for (let k = 0; k < sp.arms; k++) {
        const arm = new T.Mesh(new T.BoxGeometry(sp.len, 0.17, sp.w * 2), M.stripes); arm.position.set(sp.len / 2, 0.11, 0); arm.rotation.y = (k * 2 * Math.PI) / sp.arms; arm.castShadow = true;
        const holder = new T.Group(); holder.rotation.y = (k * 2 * Math.PI) / sp.arms; arm.rotation.y = 0; holder.add(arm);
        const tip = new T.Mesh(new T.SphereGeometry(sp.w * 1.15, 12, 8), new T.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.35, metalness: 0.4 })); tip.position.set(sp.len, 0.11, 0); holder.add(tip);
        rot.add(holder);
      }
      const hub = new T.Mesh(new T.CylinderGeometry(sp.hub, sp.hub * 1.12, 0.3, 24), new T.MeshStandardMaterial({ color: '#e23a30', roughness: 0.35, metalness: 0.2 })); hub.position.y = 0.15; hub.castShadow = true; g.add(hub);
      const cap = new T.Mesh(new T.SphereGeometry(sp.hub * 0.7, 16, 10), M.gold); cap.position.y = 0.32; g.add(cap);
      courseGroup.add(g); spinnerGroups.push({ rot, sp });
    }

    // flag
    const pole = new T.Mesh(new T.CylinderGeometry(0.012, 0.014, 1.25, 8), M.pole); pole.position.set(hole.cup[0] + 0.0, 0.625, -hole.cup[1]); pole.castShadow = true; courseGroup.add(pole);
    const knob = new T.Mesh(new T.SphereGeometry(0.03, 10, 8), M.gold); knob.position.set(hole.cup[0], 1.26, -hole.cup[1]); courseGroup.add(knob);
    const fg = new T.PlaneGeometry(0.5, 0.32, 14, 4); fg.translate(0.25, 0, 0);
    flagMesh = new T.Mesh(fg, M.flag); flagMesh.position.set(hole.cup[0], 1.08, -hole.cup[1]); flagMesh.castShadow = true; courseGroup.add(flagMesh); flagBase = fg.attributes.position.array.slice();
    // tee
    const dir = (hole.view && hole.view.yaw != null) ? rad(hole.view.yaw) : Math.atan2(hole.cup[1] - hole.tee[1], hole.cup[0] - hole.tee[0]);
    const mat = new T.Mesh(new T.BoxGeometry(0.62, 0.012, 0.42), M.tee); mat.position.set(hole.tee[0], 0.007, -hole.tee[1]); mat.rotation.y = dir; mat.receiveShadow = true; courseGroup.add(mat);
    for (const s of [-1, 1]) { const mk = new T.Mesh(new T.SphereGeometry(0.035, 12, 8), M.teeMark); mk.position.set(hole.tee[0] + Math.cos(dir + Math.PI / 2) * 0.28 * s, 0.04, -(hole.tee[1] + Math.sin(dir + Math.PI / 2) * 0.28 * s)); mk.castShadow = true; courseGroup.add(mk); }

    // scenery: trees, bushes, flowers, rocks, hills
    const R = Math.hypot(bounds.w, bounds.h) / 2, inBox = (x, y, m) => x > bounds.minX - m && x < bounds.maxX + m && y > bounds.minY - m && y < bounds.maxY + m;
    let placed = 0;
    for (let i = 0; i < 400 && placed < 38; i++) {
      const a = r() * 6.283, d = R + 2.2 + r() * 20, x = bounds.cx + Math.cos(a) * d * (0.9 + r() * 0.5), y = bounds.cy + Math.sin(a) * d * (0.9 + r() * 0.5);
      if (inBox(x, y, 3.6)) continue;
      const t = buildTree(r, r() < 0.55 ? 0 : 1, x, -y, 0.8 + r() * 0.8); courseGroup.add(t); trees.push({ t, ph: r() * 6.28 }); placed++;
    }
    for (let i = 0; i < 40; i++) { const a = r() * 6.283, d = R + 1.6 + r() * 7, x = bounds.cx + Math.cos(a) * d, y = bounds.cy + Math.sin(a) * d; if (inBox(x, y, 1.0)) continue;
      const b = new T.Mesh(new T.IcosahedronGeometry(0.25 + r() * 0.3, 1), r() < 0.5 ? M.leaf : M.leaf2); b.position.set(x, -SLAB + 0.2, -y); b.scale.y = 0.75; b.castShadow = true; courseGroup.add(b); }
    for (let i = 0; i < 70; i++) { const a = r() * 6.283, d = R + 0.8 + r() * 6, x = bounds.cx + Math.cos(a) * d, y = bounds.cy + Math.sin(a) * d; if (inBox(x, y, 0.7)) continue;
      const f = new T.Mesh(new T.SphereGeometry(0.045, 6, 5), flowerMats[(r() * 4) | 0]); f.position.set(x, -SLAB + 0.1, -y); courseGroup.add(f); }
    for (let i = 0; i < 12; i++) { const a = r() * 6.283, d = R + 1.5 + r() * 9, x = bounds.cx + Math.cos(a) * d, y = bounds.cy + Math.sin(a) * d; if (inBox(x, y, 1.0)) continue;
      const s = new T.Mesh(new T.DodecahedronGeometry(0.2 + r() * 0.3, 0), M.stone); s.position.set(x, -SLAB + 0.12, -y); s.rotation.set(r() * 3, r() * 3, 0); s.castShadow = true; courseGroup.add(s); }
    for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283 + r() * 0.4, d = 62 + r() * 18; const h = new T.Mesh(new T.IcosahedronGeometry(18 + r() * 14, 1), M.hill); h.position.set(bounds.cx + Math.cos(a) * d, -14, -(bounds.cy + Math.sin(a) * d)); h.scale.y = 0.55; courseGroup.add(h); }

    // light + shadow volume fitted to this hole
    const half = Math.max(bounds.w, bounds.h) / 2 + 3.5;
    sun.position.set(bounds.cx + 7, 13, -bounds.cy + 9); sun.target.position.set(bounds.cx, 0, -bounds.cy);
    const sc = sun.shadow.camera; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 40; sc.updateProjectionMatrix();
    ball.position.set(hole.tee[0], BALL_R, -hole.tee[1]); ball.scale.setScalar(1); ball.visible = true;
    const holeDir = Math.atan2(hole.cup[1] - hole.tee[1], hole.cup[0] - hole.tee[0]) * 180 / Math.PI;
    return { bounds, dist: clamp(Math.max(bounds.w, bounds.h) * 0.9, 5.6, 11.5), yaw: (hole.view && hole.view.yaw != null) ? hole.view.yaw : holeDir };
  }

  /* -------------------------------------------------------------------------------- camera */
  const cam = { portraitK: 1, tx: 0, ty: 0, yaw: 90, pitch: 54, dist: 8, dtx: 0, dty: 0, dyaw: 90, dpitch: 54, ddist: 8, shake: 0, intro: null, follow: true, fit: { dist: 9 } };
  function placeCamera() {
    const yaw = rad(cam.yaw), pitch = rad(cam.pitch), D = cam.dist * cam.portraitK;
    const dx = Math.cos(yaw), dy = Math.sin(yaw);                              // view direction in course coords
    const tgt = wx(cam.tx, cam.ty, 0);
    camera.position.set(tgt.x - dx * D * Math.cos(pitch), D * Math.sin(pitch), tgt.z + dy * D * Math.cos(pitch));
    camera.lookAt(tgt.x, 0, tgt.z);
    if (cam.shake > 0.001) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; }
  }
  const view = {
    renderer, scene, camera, effects,
    loadHole(hole) { const info = loadHole(hole); cam.fit = info; cam.ddist = cam.dist = info.dist; cam.dyaw = cam.yaw = info.yaw; cam.tx = cam.dtx = hole.tee[0]; cam.ty = cam.dty = hole.tee[1]; return info; },
    resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 0.8 ? 50 : 38; cam.portraitK = w / h < 0.8 ? 1.5 : 1; camera.updateProjectionMatrix(); },
    look(x, y) { cam.dtx = x; cam.dty = y; },
    setYaw(d) { cam.dyaw = d; }, nudgeYaw(d) { cam.dyaw += d; }, get yaw() { return cam.dyaw; },
    zoom(f) { cam.ddist = clamp(cam.ddist * f, 3.2, 16); }, setDist(d) { cam.ddist = d; },
    setPitch(p) { cam.dpitch = clamp(p, 30, 80); }, get pitch() { return cam.dpitch; },
    overview(on) { cam.overview = !!on; },
    get dist() { return cam.ddist; },
    get portrait() { return cam.portraitK > 1; },
    shake(a) { if (!reduced) cam.shake = Math.max(cam.shake, a); },
    /** fly from the cup back to the tee; resolves when done (or skipped) */
    intro(done) {
      if (reduced) { done && done(); return; }
      cam.intro = { t: 0, dur: 2.3, done, from: [H.cup[0], H.cup[1]], to: [H.tee[0], H.tee[1]], d0: cam.fit.dist * 1.35, d1: cam.fit.dist, p0: 62, p1: cam.pitch };
    },
    skipIntro() { if (cam.intro) { const i = cam.intro; cam.intro = null; cam.tx = cam.dtx = i.to[0]; cam.ty = cam.dty = i.to[1]; cam.dist = cam.ddist = i.d1; cam.pitch = cam.dpitch = i.p1; i.done && i.done(); } },
    get intro_active() { return !!cam.intro; },
    /** pointer → course coordinates on the green plane */
    worldFromScreen(cx, cy) {
      const r = canvas.getBoundingClientRect(); const v = new T.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      const ray = new T.Raycaster(); ray.setFromCamera(v, camera); const hit = new T.Vector3();
      return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), hit) ? { x: hit.x, y: -hit.z } : null;
    },
    screenFromWorld(x, y) { const v = wx(x, y, 0).project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; },

    /* ball */
    setBall(b, sinkK) {
      const px = ball.position.x, pz = ball.position.z;
      let y = BALL_R, s = 1;
      if (sinkK > 0) { y = BALL_R - sinkK * (SLAB * 0.8 + 0.1); s = 1 - sinkK * 0.15; }
      ball.position.set(b.x, y, -b.y); ball.scale.setScalar(s);
      const dx = b.x - px, dz = -b.y - pz, d = Math.hypot(dx, dz);
      if (d > 1e-6 && d < 1) { const axis = new T.Vector3(dz, 0, -dx).normalize(); ball.rotateOnWorldAxis(axis, d / BALL_R); }
    },
    setSpinnerAngles(list) { spinnerGroups.forEach((s, i) => { s.rot.rotation.y = list[i] != null ? list[i] : 0; }); },
    ballWorld() { return { x: ball.position.x, y: -ball.position.z }; },
    hideBall(v) { ball.visible = !v; },
    celebrate() { flagWave.boost = 1.6; },

    /* aiming overlay */
    showAim(b, dirx, diry, power, pred, pointer) {
      aimGroup.visible = true;
      const len = Math.hypot(dirx, diry) || 1, ux = dirx / len, uy = diry / len;
      arrow.visible = power > 0.01;
      arrow.position.set(b.x + ux * 0.2, 0.025, -(b.y + uy * 0.2)); arrow.rotation.z = Math.atan2(uy, ux); arrow.scale.set(0.15 + power * 1.35, 1, 1);
      arrowMat.color.setHSL(0.34 - 0.34 * power, 1, 0.5);
      ring.position.set(pointer ? pointer.x : b.x, 0.02, -(pointer ? pointer.y : b.y)); ring.visible = !!pointer;
      let k = 0; if (pred && power > 0.01) { for (let i = 1; i < pred.length && k < dots.length; i++) { const a = pred[i - 1], c = pred[i], seg = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.round(seg / 0.16)); for (let j = 0; j < n && k < dots.length; j++) { const u = j / n, d = dots[k++]; d.visible = true; d.position.set(lerp(a[0], c[0], u), 0.02, -lerp(a[1], c[1], u)); d.scale.setScalar(1 - (k / dots.length) * 0.55); } } }
      for (; k < dots.length; k++) dots[k].visible = false;
    },
    hideAim() { aimGroup.visible = false; },

    /* per frame */
    render(dt, now) {
      dt = Math.min(dt, 0.05);
      // camera
      if (cam.intro) {
        const i = cam.intro; i.t += dt; const u = clamp(i.t / i.dur, 0, 1), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        cam.tx = lerp(i.from[0], i.to[0], e); cam.ty = lerp(i.from[1], i.to[1], e); cam.dist = lerp(i.d0, i.d1, e); cam.pitch = lerp(i.p0, i.p1, e);
        if (u >= 1) { const d = i.done; cam.intro = null; cam.dtx = cam.tx; cam.dty = cam.ty; cam.ddist = cam.dist; d && d(); }
      } else {
        const k = 1 - Math.exp(-(reduced ? 40 : 4.2) * dt);
        const tx = cam.overview ? bounds.cx : cam.dtx, ty = cam.overview ? bounds.cy : cam.dty, dd = cam.overview ? cam.fit.dist * 1.55 : cam.ddist;
        cam.tx = lerp(cam.tx, tx, k); cam.ty = lerp(cam.ty, ty, k); cam.dist = lerp(cam.dist, dd, k);
        cam.yaw = lerp(cam.yaw, cam.dyaw, 1 - Math.exp(-(reduced ? 40 : 6) * dt)); cam.pitch = lerp(cam.pitch, cam.overview ? 70 : cam.dpitch, k);
      }
      cam.shake *= 0.86; placeCamera();

      // animation
      const t = now / 1000;
      for (const w of waterMeshes) { M.water.map.offset.set(t * 0.03, t * 0.021); }
      for (const s of slopeTex) { s.t.offset.x = -((t * 0.45) % 1); }   // chevrons flow the way the ball will be pushed
      for (const c of clouds) { c.position.x += dt * 0.6; if (c.position.x > 100) c.position.x = -100; }
      for (const tr of trees) tr.t.rotation.z = reduced ? 0 : Math.sin(t * 0.9 + tr.ph) * 0.018;
      if (flagMesh) {
        const pos = flagMesh.geometry.attributes.position, amp = 0.05 + (flagWave.boost || 0) * 0.05; flagWave.boost = Math.max(0, (flagWave.boost || 0) - dt * 0.6);
        for (let i = 0; i < pos.count; i++) { const x = flagBase[i * 3], y = flagBase[i * 3 + 1]; pos.setZ(i, Math.sin(x * 9 - t * 5.5) * amp * (x / 0.5) + Math.sin(y * 7 + t * 3) * 0.008); pos.setY(i, y - Math.sin(x * 9 - t * 5.5) * 0.004 * x * 10); }
        pos.needsUpdate = true; flagMesh.geometry.computeVertexNormals();
      }
      for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i]; r.t += dt; if (r.t > 1.1) { ripples.splice(i, 1); continue; } }
      rippleMesh.forEach((m, i) => { const r = ripples[i]; if (!r) { m.visible = false; return; } m.visible = true; m.position.set(r.x, -0.065, -r.y); m.scale.setScalar(0.1 + r.t * 0.9); m.material.opacity = 0.7 * (1 - r.t / 1.1); });
      for (const p of parts) {
        if (!p.alive) continue; p.life -= dt; if (p.life <= 0) { p.alive = false; p.m.visible = false; continue; }
        const g = p.kind === 'puff' ? -0.2 : p.kind === 'conf' ? -7 : -8;
        p.vy += g * dt; p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
        if (p.kind === 'drop' && p.m.position.y < -0.05) p.life = 0;
        if (p.kind === 'conf') { p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt * 0.7; p.vx *= 0.99; p.vz *= 0.99; if (p.m.position.y < 0.01) { p.m.position.y = 0.01; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; } }
        const k = p.life / p.max; p.m.material.opacity = Math.min(1, k * 2);
        if (p.kind === 'puff') p.m.scale.setScalar(p.size * (1 + (1 - k) * 2.2));
      }
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); },
  };
  view.resize();
  return view;
}
