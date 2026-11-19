/* BLANION STACK — drop 20 odd-shaped blocks, build the tallest tower. Physics by Matter.js (MIT, vendored). */
(function () {
  'use strict';
  const { Engine, Bodies, Body, Composite } = Matter;
  const $ = id => document.getElementById(id);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  /* ------------------------------------------------------------- constants */
  const W = 240, H = 360;            // internal (pixel-art) resolution, upscaled with CSS
  const PX_PER_M = 8;                // 8 px = 1 metre
  const TOTAL = 20;
  const PLAT_W = 96, PLAT_H = 16;    // the ledge you build on (top edge is y = 0)
  const KILL_Y = 140;                // blocks that fall below this are lost
  const STEP = Math.PI / 12;         // 15 degree rotation steps
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- blocks */
  // kind: rect {w,h} · poly {v:[[x,y]...]} (convex) · circle {r} · hex {r} · compound {parts:[[x,y,w,h]...]}
  const SHAPES = [
    { name: 'plank',     kind: 'rect', w: 58, h: 9 },
    { name: 'beam',      kind: 'rect', w: 42, h: 12 },
    { name: 'slab',      kind: 'rect', w: 30, h: 17 },
    { name: 'brick',     kind: 'rect', w: 24, h: 12 },
    { name: 'cube',      kind: 'rect', w: 22, h: 22 },
    { name: 'big cube',  kind: 'rect', w: 32, h: 32 },
    { name: 'post',      kind: 'rect', w: 14, h: 34 },
    { name: 'pillar',    kind: 'rect', w: 17, h: 30 },
    { name: 'triangle',  kind: 'poly', v: [[-21, 12], [21, 12], [0, -12]] },
    { name: 'small tri', kind: 'poly', v: [[-13, 10], [13, 10], [0, -10]] },
    { name: 'wedge',     kind: 'poly', v: [[-19, 8], [19, 8], [19, -8]] },
    { name: 'trapezoid', kind: 'poly', v: [[-23, 9], [23, 9], [12, -9], [-12, -9]] },
    { name: 'hexagon',   kind: 'hex', r: 15 },
    { name: 'wheel',     kind: 'circle', r: 12 },
    { name: 'T',         kind: 'compound', parts: [[0, -11, 46, 10], [0, 4, 12, 22]] },
    { name: 'L',         kind: 'compound', parts: [[-7, 0, 12, 38], [6, 13, 26, 12]] },
    { name: 'plus',      kind: 'compound', parts: [[0, 0, 36, 12], [0, 0, 12, 36]] },
  ];
  const COLORS = ['#ff7a59', '#ffd54f', '#5be3a1', '#4fc3f7', '#e056fd', '#ff9f43', '#9bb8d8'];

  /** Seeded RNG so "today's blocks" are identical for everyone. */
  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hashStr = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  /** 20 blocks with variety: never the same shape twice in a row, and a guaranteed mix of flat, tall and awkward pieces. */
  function makeSequence(rand) {
    const seq = []; let last = -1;
    while (seq.length < TOTAL) {
      let i; do { i = Math.floor(rand() * SHAPES.length); } while (i === last);
      seq.push({ shape: i, color: COLORS[Math.floor(rand() * COLORS.length)] }); last = i;
    }
    return seq;
  }

  function makeBody(def, x, y) {
    const opt = { friction: 1, frictionStatic: 1.6, restitution: 0, density: 0.002, slop: 0.04, frictionAir: 0.012 };
    let b;
    switch (def.kind) {
      case 'rect': b = Bodies.rectangle(x, y, def.w, def.h, opt); break;
      case 'poly': b = Bodies.fromVertices(x, y, [def.v.map(([px, py]) => ({ x: px, y: py }))], opt); break;
      case 'circle': b = Bodies.circle(x, y, def.r, opt, 18); break;
      case 'hex': b = Bodies.polygon(x, y, 6, def.r, opt); break;
      case 'compound': {
        const parts = def.parts.map(([px, py, w, h]) => Bodies.rectangle(x + px, y + py, w, h, opt));
        b = Body.create({ parts, ...opt }); Body.setPosition(b, { x, y }); break;
      }
    }
    return b;
  }

  /* ----------------------------------------------------------------- state */
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const nextCtx = $('nextCanvas').getContext('2d');
  let engine, platform, seq, mode, idx, current, hoverX, angle, phase, placed, lost, settleT, settleFrames, camTop, camTarget, finishT;
  let best = LS.get('blanion.stack.best.all') || 0;
  let dayBest = 0, seedKey = '';
  const keys = new Set();
  const bubbles = Array.from({ length: 22 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.4, s: 0.1 + Math.random() * 0.3 }));
  let lastHeight = 0;

  function newGame(m) {
    mode = m;
    const key = m === 'daily' ? dateKey() : 'random-' + Math.random();
    seedKey = key;
    seq = makeSequence(mulberry32(hashStr('blanion-stack:' + key)));
    dayBest = m === 'daily' ? (LS.get('blanion.stack.best.' + key) || 0) : 0;
    engine = Engine.create({ positionIterations: 12, velocityIterations: 10 });
    engine.gravity.y = 0.95;
    platform = Bodies.rectangle(W / 2, PLAT_H / 2, PLAT_W, PLAT_H, { isStatic: true, friction: 1, frictionStatic: 1.5, restitution: 0 });
    Composite.add(engine.world, platform);
    idx = 0; placed = []; lost = 0; current = null; phase = 'aiming'; hoverX = W / 2; angle = 0; finishT = 0; lastHeight = 0;
    camTop = camTarget = -300;
    spawn();
    hud();
  }

  const towerTopPx = () => { let top = 0; for (const b of placed) if (b.position.y < KILL_Y) top = Math.min(top, b.bounds.min.y); return -top; };
  const hoverY = () => Math.min(-110, -towerTopPx() - 100);

  function spawn() {
    const def = SHAPES[seq[idx].shape];
    current = makeBody(def, hoverX, hoverY());
    current.plugin = { color: seq[idx].color, name: def.name };
    Body.setAngle(current, angle);
    Body.setStatic(current, true);
    Composite.add(engine.world, current);
    phase = 'aiming';
    drawNext();
  }

  function drop() {
    if (phase !== 'aiming' || !current) return;
    Body.setStatic(current, false);
    Body.setVelocity(current, { x: 0, y: 0 }); Body.setAngularVelocity(current, 0);
    phase = 'falling'; settleT = 0; settleFrames = 0;
    hud();
  }

  /* --------------------------------------------------------------- physics */
  function update(dt) {
    // aiming controls
    if (phase === 'aiming' && current) {
      if (keys.has('ArrowLeft') || keys.has('a')) hoverX -= 2.4;
      if (keys.has('ArrowRight') || keys.has('d')) hoverX += 2.4;
      hoverX = Math.max(8, Math.min(W - 8, hoverX));
      Body.setPosition(current, { x: hoverX, y: hoverY() });
    }
    Engine.update(engine, dt);

    // lose blocks that fall off
    for (const b of [...placed, current]) {
      if (b && b.position.y > KILL_Y && !b.isStatic) {
        Composite.remove(engine.world, b);
        const i = placed.indexOf(b); if (i >= 0) placed.splice(i, 1);
        if (b === current) { current = null; lost++; afterSettle(true); }
        else lost++;
      }
    }

    if (phase === 'falling' && current) {
      settleT += dt;
      if (current.speed < 0.12 && Math.abs(current.angularSpeed) < 0.006) settleFrames++; else settleFrames = 0;
      if (settleFrames > 30 || settleT > 6000) { placed.push(current); current = null; afterSettle(false); }
    }
    if (phase === 'finishing') { finishT += dt; if (finishT > 2200) finish(); }
    if (phase === 'done') return;
    const h = towerTopPx();
    camTarget = Math.min(-300, hoverY() - 120, -h - 220 + 0);
    camTop += (camTarget - camTop) * (reduce ? 1 : 0.06);
    if (h !== lastHeight) { lastHeight = h; hud(); }
  }

  function afterSettle() {
    idx++;
    if (idx >= TOTAL) { phase = 'finishing'; finishT = 0; hud(); return; }
    spawn(); hud();
  }

  /* ---------------------------------------------------------------- finish */
  const TITLES = [[0, 'Pebble Pile'], [6, 'Kelp Wobble'], [10, 'Coral Spire'], [14, 'Lighthouse'], [18, 'Skyscraper'], [24, 'Reaching the Surface']];
  function finish() {
    phase = 'done';
    const m = towerTopPx() / PX_PER_M;
    const standing = placed.length;
    const prevAll = best, prevDay = dayBest;
    if (m > best) { best = m; LS.set('blanion.stack.best.all', m); }
    if (mode === 'daily' && m > dayBest) { dayBest = m; LS.set('blanion.stack.best.' + seedKey, m); }
    const title = [...TITLES].reverse().find(t => m >= t[0])[1];
    $('endChip').textContent = mode === 'daily' ? 'TODAY’S BLOCKS' : 'RANDOM BLOCKS';
    $('endTitle').textContent = title.toUpperCase();
    $('endHeight').textContent = m.toFixed(1);
    $('endStanding').textContent = standing + ' of ' + TOTAL + ' blocks still standing';
    const newBest = mode === 'daily' ? m > prevDay + 0.05 : m > prevAll + 0.05;
    $('endBest').className = 'res-prov' + (newBest ? ' final' : '');
    $('endBest').textContent = (newBest ? 'NEW BEST! ' : '') + (mode === 'daily' ? 'TODAY’S BEST ' + dayBest.toFixed(1) + 'm · ' : '') + 'ALL-TIME BEST ' + best.toFixed(1) + 'm';
    $('copyHint').textContent = '';
    $('endOverlay').classList.remove('hidden');
    LS.set('blanion.stack.last', { key: seedKey, mode, m });
    hud();
  }
  $('copy').onclick = async () => {
    const m = towerTopPx() / PX_PER_M;
    const text = 'BLANION STACK ' + (mode === 'daily' ? seedKey : 'random') + ' — ' + m.toFixed(1) + 'm tower 🧱\n' + placed.length + '/' + TOTAL + ' blocks standing\n' + location.origin + '/stack';
    try { await navigator.clipboard.writeText(text); $('copyHint').textContent = 'Copied! Paste it anywhere.'; } catch { $('copyHint').textContent = text; }
  };

  /* ------------------------------------------------------------------- HUD */
  function hud() {
    $('hBlock').textContent = Math.min(idx + 1, TOTAL) + '/' + TOTAL;
    $('hHeight').textContent = (towerTopPx() / PX_PER_M).toFixed(1) + 'm';
    $('hBest').textContent = (mode === 'daily' ? Math.max(dayBest, 0) : best).toFixed(1) + 'm';
  }

  /* ------------------------------------------------------------- rendering */
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const c = i => Math.max(0, Math.min(255, Math.round(((n >> i) & 255) * k))); return `rgb(${c(16)},${c(8)},${c(0)})`; }
  function drawBody(c, body, dx, dy, color, alpha) {
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    c.globalAlpha = alpha == null ? 1 : alpha;
    for (const p of parts) {
      c.beginPath();
      p.vertices.forEach((v, i) => (i ? c.lineTo(v.x + dx, v.y + dy) : c.moveTo(v.x + dx, v.y + dy)));
      c.closePath();
      c.fillStyle = color; c.fill();
      c.lineJoin = 'round'; c.lineWidth = 1.4; c.strokeStyle = shade(color, 0.45); c.stroke();
    }
    // highlight along the top-left of each part
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.35)';
    for (const p of parts) { const v = p.vertices; c.beginPath(); c.moveTo(v[0].x + dx + 1, v[0].y + dy + 1); c.lineTo(v[1].x + dx - 1, v[1].y + dy + 1); c.stroke(); }
    c.globalAlpha = 1;
  }

  function drawBackground(t) {
    // seabed at the bottom, light toward the surface: the higher you build, the brighter it gets
    const hgt = Math.min(1, towerTopPx() / 200);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const mix = (a, b) => Math.round(a + (b - a) * hgt);
    g.addColorStop(0, `rgb(${mix(40, 110)},${mix(120, 205)},${mix(185, 240)})`);
    g.addColorStop(0.6, `rgb(${mix(14, 40)},${mix(80, 140)},${mix(140, 200)})`);
    g.addColorStop(1, `rgb(${mix(6, 14)},${mix(32, 70)},${mix(70, 120)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // light rays
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < 4; i++) {
      const x0 = 30 + i * 62 + Math.sin(t * 0.0003 + i) * 8;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 24, 0); ctx.lineTo(x0 + 70, H); ctx.lineTo(x0 + 10, H); ctx.closePath(); ctx.fill();
    }
    // bubbles
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (const b of bubbles) { if (!reduce) { b.y -= b.s; if (b.y < -4) { b.y = H + 4; b.x = Math.random() * W; } } ctx.fillRect(b.x | 0, b.y | 0, b.r > 2 ? 2 : 1, b.r > 2 ? 2 : 1); }
  }

  function drawWorld(t) {
    const oy = -camTop;
    // seabed rock + ledge
    const gy = oy;                                            // y of platform top on screen
    ctx.fillStyle = '#0e3552';
    ctx.beginPath(); ctx.moveTo(0, gy + 40); ctx.lineTo(W / 2 - PLAT_W / 2 - 24, gy + 30); ctx.lineTo(W / 2 - PLAT_W / 2, gy + PLAT_H); ctx.lineTo(W / 2 + PLAT_W / 2, gy + PLAT_H); ctx.lineTo(W / 2 + PLAT_W / 2 + 24, gy + 30); ctx.lineTo(W, gy + 40); ctx.lineTo(W, gy + 400); ctx.lineTo(0, gy + 400); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a8aa5'; ctx.fillRect(W / 2 - PLAT_W / 2, gy, PLAT_W, PLAT_H);
    ctx.fillStyle = '#a9b8d0'; ctx.fillRect(W / 2 - PLAT_W / 2, gy, PLAT_W, 3);
    ctx.fillStyle = '#4a5a78'; ctx.fillRect(W / 2 - PLAT_W / 2, gy + PLAT_H - 3, PLAT_W, 3);
    // kelp on the seabed
    ctx.fillStyle = '#2aa874';
    for (let i = 0; i < 9; i++) { const kx = (i < 5 ? 8 + i * 16 : W - 8 - (i - 5) * 16); for (let y = 0; y < 22 + (i % 3) * 8; y++) ctx.fillRect(kx + Math.sin(t * 0.0015 + i + y * 0.2) * (1 + y * 0.05), gy + 36 - y, 2, 1); }
    // personal-best line
    const bestPx = Math.max(mode === 'daily' ? dayBest : best, 0) * PX_PER_M;
    if (bestPx > 0) {
      const by = oy - bestPx;
      if (by > -4 && by < H + 4) { ctx.fillStyle = 'rgba(255,242,122,.75)'; for (let x = 0; x < W; x += 8) ctx.fillRect(x, by | 0, 4, 1); }
    }
    // height ruler (every 5 m)
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (let m = 0; m < 80; m += 5) { const ry = oy - m * PX_PER_M; if (ry < -2 || ry > H + 2) continue; ctx.fillRect(0, ry | 0, m % 10 === 0 ? 9 : 5, 1); }
    // blocks
    for (const b of placed) drawBody(ctx, b, 0, oy, b.plugin.color);
    if (current) {
      drawBody(ctx, current, 0, oy, current.plugin.color, current.isStatic ? 0.9 : 1);
      if (current.isStatic) {   // drop guide
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        for (let y = current.bounds.max.y + 4; y < -camTop + H + 40 && y < PLAT_H + 40; y += 8) ctx.fillRect(current.position.x | 0, (y + oy) | 0, 1, 4);
      }
    }
  }

  function drawNext() {
    nextCtx.clearRect(0, 0, 40, 40);
    if (idx + 1 >= TOTAL) return;
    const def = SHAPES[seq[idx + 1].shape];
    const b = makeBody(def, 0, 0);
    const w = b.bounds.max.x - b.bounds.min.x, h = b.bounds.max.y - b.bounds.min.y;
    const k = Math.min(1, 34 / Math.max(w, h));
    nextCtx.save(); nextCtx.translate(20, 20); nextCtx.scale(k, k);
    drawBody(nextCtx, b, -(b.bounds.min.x + w / 2), -(b.bounds.min.y + h / 2), seq[idx + 1].color);
    nextCtx.restore();
  }

  let acc = 0, prev = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - prev); prev = now;
    if (phase !== 'idle') { acc += dt; let n = 0; while (acc >= 1000 / 60 && n++ < 5) { update(1000 / 60); acc -= 1000 / 60; } }
    drawBackground(now); if (engine) drawWorld(now);
    requestAnimationFrame(frame);
  }

  /* -------------------------------------------------------------- controls */
  const rect = () => canvas.getBoundingClientRect();
  const toWorldX = cx => (cx - rect().left) * (W / rect().width);
  function rotate(dir) { if (phase !== 'aiming' || !current) return; angle += dir * STEP; Body.setAngle(current, angle); }
  canvas.addEventListener('pointermove', e => { if (phase !== 'aiming') return; if (e.pointerType === 'mouse' || e.buttons) hoverX = toWorldX(e.clientX); });
  canvas.addEventListener('pointerdown', e => { if (phase !== 'aiming') return; hoverX = toWorldX(e.clientX); if (e.pointerType === 'mouse' && e.button === 0) drop(); });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); rotate(1); });
  canvas.addEventListener('wheel', e => { if (phase === 'aiming') { e.preventDefault(); rotate(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
  const overlayOpen = () => !$('startOverlay').classList.contains('hidden') || !$('endOverlay').classList.contains('hidden');
  addEventListener('keydown', e => {
    if (overlayOpen()) return;                                   // menus keep their normal keyboard behaviour
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(k)) e.preventDefault();
    keys.add(k);
    if (e.repeat && (k === ' ' || k === 'Enter' || k === 'ArrowDown')) return;
    if (k === 'q' || k === 'z') rotate(-1);
    if (k === 'e' || k === 'x' || k === 'ArrowUp' || k === 'r') rotate(1);
    if (k === ' ' || k === 'Enter' || k === 'ArrowDown') drop();
  });
  addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => keys.clear());

  function hold(btn, fn) {
    let t = null;
    const stop = () => { clearInterval(t); t = null; };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); fn(); stop(); t = setInterval(fn, 70); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
  }
  hold($('bLeft'), () => { if (phase === 'aiming') hoverX = Math.max(8, hoverX - 3); });
  hold($('bRight'), () => { if (phase === 'aiming') hoverX = Math.min(W - 8, hoverX + 3); });
  $('bRotL').addEventListener('click', () => rotate(-1));
  $('bRotR').addEventListener('click', () => rotate(1));
  $('bDrop').addEventListener('click', drop);

  /* ----------------------------------------------------------- menu / flow */
  function start(m) { $('startOverlay').classList.add('hidden'); $('endOverlay').classList.add('hidden'); newGame(m); }
  $('startDaily').onclick = () => start('daily');
  $('startRandom').onclick = () => start('random');
  $('again').onclick = () => start(mode);
  $('toMenu').onclick = () => { $('endOverlay').classList.add('hidden'); $('startOverlay').classList.remove('hidden'); };

  Mascot.mount($('logoMascot'), 3);
  phase = 'idle';
  newGame('daily'); phase = 'idle'; $('startOverlay').classList.remove('hidden');   // a calm tableau behind the menu
  hud();
  requestAnimationFrame(frame);

  // small hook for automated tests
  window.__stack = { get phase() { return phase; }, get idx() { return idx; }, get height() { return towerTopPx() / PX_PER_M; }, get lost() { return lost; }, get seq() { return seq.map(s => SHAPES[s.shape].name); }, drop, setX: x => { hoverX = x; } };
})();
