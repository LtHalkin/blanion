/* BLANION WEIGH-IN — the 3D stage: a balance scale. The big object sits on the left pan; a pile of the small thing grows on the
 * right. Your guess tips the scale (spring physics), then the true answer swings it level. Rendered chunky/pixelated on purpose. */
import { T, buildModel, meshCount } from '/weigh-models.js';

const L = 3.0, PIVOT_Y = 3.25, HANG = 1.95, PAN_R = 1.3;      // beam half-length, pivot height, string length, pan radius
const Q_ANGLE = -0.16;                                          // resting tilt in question mode (big side a little low)
const MAX_TILT = 0.46;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

/** how many pieces to draw for a count of N (a feel, not a measurement: the caption shows the real number) */
export const visualCount = (n, cap) => clamp(Math.round(3 + 5.5 * Math.log10(Math.max(1, n))), 2, cap);
/** beam tilt for a guess: positive = right (pile) side down. 10x too high ~ 0.4 rad */
export const tiltFor = ratio => clamp(0.4 * Math.log10(ratio), -MAX_TILT, MAX_TILT);

export function createStage(canvas, opts = {}) {
  const reduced = !!opts.reduced;
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new T.Scene();
  scene.add(new T.AmbientLight('#ffffff', 0.85));
  scene.add(new T.HemisphereLight('#cfeaff', '#456a94', 0.9));
  const sun = new T.DirectionalLight('#fff4dc', 2.1); sun.position.set(4, 9, 7); scene.add(sun);
  const rim = new T.DirectionalLight('#7fd8ff', 0.8); rim.position.set(-6, 3, -4); scene.add(rim);
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 100);

  const mat = (c, o) => new T.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0, flatShading: true, ...(o || {}) });
  const rig = new T.Group(); scene.add(rig);

  // floor shadow + base + post
  const floor = new T.Mesh(new T.CircleGeometry(4.6, 32), new T.MeshBasicMaterial({ color: 0x04122c, transparent: true, opacity: 0.3 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.scale.set(1.25, 0.55, 1); rig.add(floor);
  const base = new T.Mesh(new T.CylinderGeometry(1.1, 1.35, 0.3, 14), mat('#7b5a2e')); base.position.y = 0.15; rig.add(base);
  const post = new T.Mesh(new T.CylinderGeometry(0.1, 0.16, PIVOT_Y, 10), mat('#c99a3b')); post.position.y = PIVOT_Y / 2; rig.add(post);
  const hub = new T.Mesh(new T.SphereGeometry(0.24, 12, 9), mat('#e6b94a')); hub.position.y = PIVOT_Y; rig.add(hub);

  const beam = new T.Group(); beam.position.y = PIVOT_Y; rig.add(beam);
  beam.add(new T.Mesh(new T.BoxGeometry(L * 2 + 0.4, 0.15, 0.22), mat('#e6b94a')));
  for (const s of [-1, 1]) { const cap = new T.Mesh(new T.SphereGeometry(0.15, 10, 8), mat('#c99a3b')); cap.position.x = s * L; beam.add(cap); }
  const pointer = new T.Mesh(new T.ConeGeometry(0.07, 0.7, 6), mat('#d9453a')); pointer.position.set(0, -0.45, 0.14); pointer.rotation.x = Math.PI; beam.add(pointer);

  function makePan(color) {
    const g = new T.Group(), strings = '#d8c58a';
    const disc = new T.Mesh(new T.CylinderGeometry(PAN_R, PAN_R * 0.85, 0.14, 20), mat(color)); disc.position.y = -HANG; g.add(disc);
    const rimMesh = new T.Mesh(new T.TorusGeometry(PAN_R, 0.045, 6, 24), mat('#e6b94a')); rimMesh.rotation.x = Math.PI / 2; rimMesh.position.y = -HANG + 0.07; g.add(rimMesh);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5, x = Math.cos(a) * PAN_R * 0.95, z = Math.sin(a) * PAN_R * 0.95;
      const len = Math.hypot(HANG, x, z), m = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, len, 4), mat(strings));
      m.position.set(x / 2, -HANG / 2, z / 2); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(-x, HANG, -z).normalize()); g.add(m);
    }
    const holder = new T.Group(); holder.position.y = -HANG + 0.07; g.add(holder);
    rig.add(g); return { g, holder };
  }
  const left = makePan('#4f86c6'), right = makePan('#d9743a');

  /* ------------------------------------------------------------------ state */
  let bigObj = null, smallTpl = null, cap = 24, baseSize = 1;
  let pile = [];                                  // { mesh, tx, ty, tz, ts, ry }
  let pileN = 1, pileSize = 1;
  let angle = Q_ANGLE, vel = 0, target = Q_ANGLE, stiff = 55, damp = 6.5;
  let t = 0, last = performance.now(), spin = 0, dropT = 0;
  const sparks = [];
  let timeline = null;                            // reveal sequence
  let running = true, hasSize = false;

  /* ---------------------------------------------------------------- layout */
  function layoutPile() {
    const n = pileN, maxLayers = 4, R = PAN_R * 0.82;
    let s = Math.min(baseSize, 1.0), c;
    for (let k = 0; k < 40; k++) { c = Math.max(1, Math.floor((Math.PI * R * R) / ((s * 0.78) ** 2))); if (n <= c * maxLayers) break; s *= 0.93; }
    pileSize = s;
    for (let i = 0; i < pile.length; i++) {
      const layer = Math.floor(i / c), j = i % c, r = s * 0.8 * Math.sqrt(j + 0.5) * 0.92, th = j * 2.399963 + layer * 0.9;
      const p = pile[i]; p.tx = Math.cos(th) * Math.min(r, R); p.tz = Math.sin(th) * Math.min(r, R); p.ty = layer * s * 0.62; p.ts = s;
    }
  }
  function setPile(n, instant) {
    n = clamp(Math.round(n), 1, cap); pileN = n;
    while (pile.length < n) {
      const mesh = smallTpl.clone(true); mesh.scale.setScalar(0.001);
      mesh.position.set((Math.random() - 0.5) * 0.8, 3.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8); mesh.rotation.y = Math.random() * 6.28;
      right.holder.add(mesh); pile.push({ mesh, tx: 0, ty: 0, tz: 0, ts: 1, ry: mesh.rotation.y });
    }
    while (pile.length > n) { const p = pile.pop(); p.mesh.userData.dying = 1; dying.push(p); }
    layoutPile();
    if (instant) for (const p of pile) { p.mesh.position.set(p.tx, p.ty, p.tz); p.mesh.scale.setScalar(p.ts); }
  }
  const dying = [];

  function setRound(bigId, smallId) {
    if (bigObj) left.holder.remove(bigObj);
    for (const p of pile) right.holder.remove(p.mesh); for (const p of dying) right.holder.remove(p.mesh); pile = []; dying.length = 0;
    timeline = null; sparks.length = 0;
    bigObj = buildModel(bigId, 2.15); bigObj.position.y = 4.2; bigObj.userData.vy = 0; left.holder.add(bigObj);
    smallTpl = buildModel(smallId, 1);
    cap = clamp(Math.floor(520 / Math.max(1, meshCount(smallTpl))), 10, 36);
    baseSize = 0.95;
    setPile(1, false);
    pile[0].mesh.position.y = 5.2;                       // single unit drops in too
    target = Q_ANGLE; angle = Q_ANGLE - 0.3; vel = 0; stiff = 55; damp = 6.5; dropT = 0;
    if (reduced) { bigObj.position.y = 0; pile[0].mesh.position.set(pile[0].tx, 0, pile[0].tz); pile[0].mesh.scale.setScalar(pile[0].ts); angle = Q_ANGLE; }
  }

  /* ------------------------------------------------------------- the reveal */
  const wait = (ms, fn) => ({ ms, fn });
  function reveal({ guess, truth, onGuess, onTruth, onDone, points = 0 }) {
    const seq = [
      wait(0, () => { setPile(visualCount(guess, cap), reduced); target = tiltFor(guess / truth); stiff = 34; damp = 5.2; if (onGuess) onGuess(); }),
      wait(reduced ? 200 : 2000, () => { setPile(visualCount(truth, cap), reduced); target = 0; stiff = 48; damp = 7.5; if (onTruth) onTruth(); }),
      wait(reduced ? 200 : 1700, () => { if (points >= 70) burst(points >= 90 ? 36 : 18); if (onDone) onDone(); }),
    ];
    timeline = { seq, i: 0, clock: 0 }; seq[0].fn(); timeline.i = 1;
    return { skip() { skipTimeline(); } };
  }
  function skipTimeline() {
    if (!timeline) return;
    const tl = timeline; timeline = null;
    for (; tl.i < tl.seq.length; tl.i++) tl.seq[tl.i].fn();
    setPile(pileN, true); angle = target; vel = 0;
  }
  function burst(n) {
    if (reduced) return;
    for (let i = 0; i < n; i++) {
      const m = new T.Mesh(new T.BoxGeometry(0.12, 0.12, 0.12), new T.MeshBasicMaterial({ color: ['#ffd54f', '#5be3a1', '#4fc3f7', '#ff9f43', '#e056fd'][i % 5] }));
      m.position.set(right.g.position.x + (Math.random() - 0.5) * 1.5, right.g.position.y - HANG + 0.6, (Math.random() - 0.5) * 1.5);
      sparks.push({ m, vx: (Math.random() - 0.5) * 2.2, vy: 3 + Math.random() * 3.5, vz: (Math.random() - 0.5) * 2.2, life: 1.3 + Math.random() * 0.5 }); scene.add(m);
    }
  }

  /* -------------------------------------------------------------- the loop */
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (timeline) { timeline.clock += dt * 1000; while (timeline && timeline.i < timeline.seq.length && timeline.clock >= timeline.seq.slice(0, timeline.i).reduce((a, s) => a + s.ms, 0) + timeline.seq[timeline.i].ms) { timeline.seq[timeline.i].fn(); timeline.i++; } if (timeline && timeline.i >= timeline.seq.length) timeline = null; }

    // beam spring
    if (reduced) { angle = target; vel = 0; } else { const acc = -stiff * (angle - target) - damp * vel; vel += acc * dt; angle += vel * dt; }
    const sway = reduced || timeline ? 0 : Math.sin(t * 1.4) * 0.012;
    const a = angle + sway;
    beam.rotation.z = -a;                                   // +a = right end down (three.js z-rotation is counter-clockwise)
    left.g.position.set(-L * Math.cos(a), PIVOT_Y + L * Math.sin(a), 0);
    right.g.position.set(L * Math.cos(a), PIVOT_Y - L * Math.sin(a), 0);

    // objects: drop-in, spin, pile easing
    if (bigObj) {
      dropT += dt; const delay = reduced ? 0 : 0.05;
      if (!reduced && dropT > delay) { bigObj.userData.vy -= 26 * dt; bigObj.position.y += bigObj.userData.vy * dt; if (bigObj.position.y < 0) { bigObj.position.y = 0; bigObj.userData.vy = Math.abs(bigObj.userData.vy) > 2.2 ? -bigObj.userData.vy * 0.32 : 0; } }
      if (!reduced) spin += dt * 0.55; bigObj.rotation.y = spin + (reduced ? 0.5 : 0);
    }
    const k = 1 - Math.exp(-9 * dt);
    for (const p of pile) { const m = p.mesh; m.position.x = lerp(m.position.x, p.tx, k); m.position.z = lerp(m.position.z, p.tz, k); const ty = p.ty; if (m.position.y > ty + 0.02) { m.userData.vy = (m.userData.vy || 0) - 24 * dt; m.position.y = Math.max(ty, m.position.y + m.userData.vy * dt); if (m.position.y === ty) m.userData.vy = 0; } else m.position.y = lerp(m.position.y, ty, k); m.scale.setScalar(lerp(m.scale.x, p.ts, 1 - Math.exp(-12 * dt))); m.rotation.y = lerp(m.rotation.y, p.ry + (reduced ? 0 : t * 0.3), k * 0.2); }
    for (let i = dying.length - 1; i >= 0; i--) { const m = dying[i].mesh; m.scale.multiplyScalar(1 - 8 * dt); m.position.y += 2 * dt; if (m.scale.x < 0.02) { right.holder.remove(m); dying.splice(i, 1); } }
    for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.vy -= 9 * dt; s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt; s.m.rotation.x += dt * 6; s.life -= dt; s.m.scale.setScalar(Math.max(0.01, Math.min(1, s.life))); if (s.life <= 0) { scene.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); sparks.splice(i, 1); } }

    camera.position.x = reduced ? 0 : Math.sin(t * 0.35) * 0.5; camera.lookAt(0, camY, 0);
    if (hasSize) renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- sizing */
  let camY = 2.35;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    const pr = Math.max(0.3, Math.min(0.62, 520 / Math.max(w, 1) * 0.5));      // chunky pixels: fewer, larger
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const halfW = L + PAN_R + 0.5, halfH = 3.1, tanV = Math.tan((camera.fov * Math.PI) / 360);
    const d = Math.max(halfW / (tanV * camera.aspect), halfH / tanV);
    camera.position.set(0, camY + 1.1, d); camera.updateProjectionMatrix(); hasSize = true;
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; if (ro) ro.observe(canvas); else addEventListener('resize', resize);
  resize();
  document.addEventListener('visibilitychange', () => { if (document.hidden) running = false; else if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } });
  requestAnimationFrame(frame);

  return {
    setRound, reveal, skip: skipTimeline, resize, visualCap: () => cap,
    setLevel() { target = 0; },
    setQuestionTilt() { target = Q_ANGLE; },
    setDemo(bigId, smallId, n) { setRound(bigId, smallId); setPile(n, false); target = 0; },
    get busy() { return !!timeline; },
    get angle() { return angle; },
    dispose() { running = false; renderer.dispose(); },
  };
}
