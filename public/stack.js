/* BLANION STACK — drop 20 odd-shaped blocks, build the tallest tower. Drag any block. Physics: Matter.js (MIT, vendored). */
(function () {
  'use strict';
  const { Engine, Bodies, Body, Composite, Constraint, Events, Query } = Matter;
  const SS = StackShapes;
  const { SHAPES, TOTAL, PX_PER_M } = SS;
  const $ = id => document.getElementById(id);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Error'), { status: r.status });
    return j;
  }

  /* ------------------------------------------------------------- constants */
  const W = 240, H = 360;            // internal (pixel-art) resolution, upscaled with CSS
  const PLAT_W = 112, PLAT_H = 16;   // the ledge you build on (top edge is y = 0) — wider than v1 to be kinder
  const KILL_Y = 150;                // blocks that fall below this are lost
  const STEP = Math.PI / 12;         // 15 degree rotation steps
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  /* ----------------------------------------------------------------- sound */
  let actx = null, muted = LS.get('blanion.stack.mute') === true;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(f0, f1, dur, type, vol, delay) {
    if (muted) return; const a = audio(); if (!a) return;
    const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol) {
    if (muted) return; const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(), g = a.createGain(); src.buffer = buf; g.gain.value = vol; src.connect(g); g.connect(a.destination); src.start();
  }
  let lastThud = 0;
  const sfx = {
    thud(v) { const t = performance.now(); if (t - lastThud < 60) return; lastThud = t; tone(150, 55, 0.12, 'triangle', Math.min(0.12, 0.03 + v * 0.012)); noise(0.05, Math.min(0.05, 0.01 + v * 0.006)); },
    drop() { tone(540, 280, 0.07, 'square', 0.03); },
    pick() { tone(520, 760, 0.05, 'square', 0.025); },
    turn() { tone(760, 880, 0.03, 'square', 0.02); },
    lost() { tone(420, 70, 0.38, 'sawtooth', 0.045); },
    best() { [523, 659, 784].forEach((f, i) => tone(f, f * 1.01, 0.09, 'square', 0.035, i * 0.08)); },
    finish() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.12, 'square', 0.04, i * 0.1)); },
  };
  function setMuteUI() { $('bMute').classList.toggle('off', muted); $('bMute').setAttribute('aria-pressed', String(muted)); }
  $('bMute').onclick = () => { muted = !muted; LS.set('blanion.stack.mute', muted); setMuteUI(); if (!muted) sfx.pick(); };
  setMuteUI();

  /* ---------------------------------------------------------------- bodies */
  function makeBody(def, x, y) {
    // grippy, soft-landing blocks: high friction, no bounce, a little water drag
    const opt = { friction: 1, frictionStatic: 1.8, restitution: 0, density: 0.002, slop: 0.05, frictionAir: 0.02 };
    switch (def.kind) {
      case 'rect': return Bodies.rectangle(x, y, def.w, def.h, opt);
      case 'poly': return Bodies.fromVertices(x, y, [def.v.map(([px, py]) => ({ x: px, y: py }))], opt);
      case 'circle': return Bodies.circle(x, y, def.r, opt, 18);
      case 'hex': return Bodies.polygon(x, y, 6, def.r, opt);
      case 'compound': {
        const parts = def.parts.map(([px, py, w, h]) => Bodies.rectangle(x + px, y + py, w, h, opt));
        const b = Body.create({ parts, ...opt }); Body.setPosition(b, { x, y }); return b;
      }
    }
  }

  /* ----------------------------------------------------------------- state */
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const nextCtx = $('nextCanvas').getContext('2d');
  let engine, platform, seq, mode, idx, current, hoverX, hoverYv, angle, phase, placed, lost, settleT, settleFrames, camTop, camTarget, finishT, startedAt;
  let best = LS.get('blanion.stack.best.all') || 0;
  let dayBest = 0, seedKey = '', session = null, paused = false, wasBest = false;
  const keys = new Set();
  const bubbles = Array.from({ length: 22 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.4, s: 0.1 + Math.random() * 0.3 }));
  let lastHeight = 0, shake = 0;
  const particles = [], floaters = [];
  let me = LS.get('blanion.player');

  function newGame(m, dayKey) {
    mode = m;
    seedKey = m === 'daily' ? dayKey : 'random-' + Math.random();
    seq = SS.sequenceFor(seedKey);
    dayBest = m === 'daily' ? (LS.get('blanion.stack.best.' + seedKey) || 0) : 0;
    if (engine) { Events.off(engine); Composite.clear(engine.world, false); }
    engine = Engine.create({ positionIterations: 12, velocityIterations: 10 });
    engine.gravity.y = 0.9;
    Events.on(engine, 'collisionStart', onCollide);
    platform = Bodies.rectangle(W / 2, PLAT_H / 2, PLAT_W, PLAT_H, { isStatic: true, friction: 1, frictionStatic: 2, restitution: 0 });
    Composite.add(engine.world, platform);
    idx = 0; placed = []; lost = 0; current = null; phase = 'aiming'; hoverX = W / 2; hoverYv = -120; angle = 0; finishT = 0; lastHeight = 0; wasBest = false;
    particles.length = 0; floaters.length = 0; shake = 0; releaseGrab(); startedAt = performance.now();
    camTop = camTarget = -300;
    spawn();
    hud();
  }

  const towerTopPx = () => { let top = 0; for (const b of placed) if (b.position.y < KILL_Y && !(grab && grab.body === b)) top = Math.min(top, b.bounds.min.y); return -top; };   // a block you are holding does not count yet
  const towerM = () => towerTopPx() / PX_PER_M;

  function spawn() {
    const def = SHAPES[seq[idx].shape];
    current = makeBody(def, hoverX, hoverYv);
    current.plugin = { color: seq[idx].color, name: def.name };
    Body.setAngle(current, angle);
    Body.setStatic(current, true);
    Composite.add(engine.world, current);
    hoverYv = -towerTopPx() - 95;                       // appears comfortably above the tower; you can drag it lower
    phase = 'aiming';
    drawNext();
  }

  function drop() {
    if (phase !== 'aiming' || !current) return;
    Body.setStatic(current, false);
    Body.setVelocity(current, { x: 0, y: 0 }); Body.setAngularVelocity(current, 0);
    phase = 'falling'; settleT = 0; settleFrames = 0;
    sfx.drop(); hud();
  }

  /* -------------------------------------------------------------- effects */
  function burst(x, y, n, color, spread) {
    if (reduce) return;
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * (spread || 1.6), vy: -Math.random() * 1.4 - 0.2, life: 1, r: Math.random() < 0.4 ? 2 : 1, color: color || 'rgba(255,255,255,.8)' });
  }
  function floatText(x, y, text, color) { floaters.push({ x, y, text, color: color || '#fff', t: 0 }); }
  let toastT = 0;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 1100); }

  function onCollide(ev) {
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (rel < 1.8) continue;
      const sp = (pair.collision && pair.collision.supports && pair.collision.supports[0]) || { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
      shake = Math.min(3, Math.max(shake, rel * 0.28));
      sfx.thud(rel);
      burst(sp.x, sp.y, Math.min(6, Math.round(rel)), 'rgba(255,255,255,.75)', 1.4);
    }
  }

  /* ----------------------------------------------------------- dragging ---
   * Any non-static block can be grabbed and moved around: a soft spring ties the block to the pointer, so it still collides
   * with everything (it can't be shoved through the tower). The block waiting at the top is dragged directly instead.      */
  let mode2 = null;          // null | 'piece' | 'grab' | 'aimx'
  let grab = null;           // { c: Constraint, body }
  let pieceDrag = null;      // { moved, startX, startY }
  const rect = () => canvas.getBoundingClientRect();
  function toWorld(e) { const r = rect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) + camTop }; }
  const grabbable = () => (phase === 'aiming' || phase === 'falling') ? (current && !current.isStatic ? [...placed, current] : placed) : [];

  function bodyAt(p) {
    const list = grabbable();
    let hit = Query.point(list, p);
    if (hit.length) return hit[hit.length - 1];
    // forgiving touch targets: 4px of slop, nearest centre wins
    let bestB = null, bd = 1e9;
    for (const b of list) {
      const bb = b.bounds;
      if (p.x < bb.min.x - 4 || p.x > bb.max.x + 4 || p.y < bb.min.y - 4 || p.y > bb.max.y + 4) continue;
      const d = Math.hypot(p.x - b.position.x, p.y - b.position.y);
      if (d < bd) { bd = d; bestB = b; }
    }
    return bestB;
  }
  const overHover = p => phase === 'aiming' && current && current.isStatic && p.x >= current.bounds.min.x - 5 && p.x <= current.bounds.max.x + 5 && p.y >= current.bounds.min.y - 5 && p.y <= current.bounds.max.y + 5;

  function startGrab(body, p) {
    releaseGrab();
    const c = Constraint.create({ pointA: { x: p.x, y: p.y }, bodyB: body, pointB: { x: p.x - body.position.x, y: p.y - body.position.y }, stiffness: 0.2, damping: 0.14, length: 0 });
    Composite.add(engine.world, c); grab = { c, body };
    $('stage').classList.add('grabbing'); sfx.pick();
  }
  function releaseGrab() {
    if (!grab) { $('stage').classList.remove('grabbing'); return; }
    Composite.remove(engine.world, grab.c);
    const v = grab.body.velocity, sp = Math.hypot(v.x, v.y);
    if (sp > 5) Body.setVelocity(grab.body, { x: v.x * 5 / sp, y: v.y * 5 / sp });   // no fling-throwing blocks across the screen
    grab = null; $('stage').classList.remove('grabbing');
  }

  canvas.addEventListener('pointerdown', e => {
    if (paused || (phase !== 'aiming' && phase !== 'falling')) return;
    canvas.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    if (overHover(p)) { mode2 = 'piece'; pieceDrag = { moved: false, sx: p.x, sy: p.y }; hoverX = p.x; return; }
    const b = bodyAt(p);
    if (b) { mode2 = 'grab'; startGrab(b, p); return; }
    if (phase === 'aiming') {
      if (e.pointerType === 'mouse') { if (e.button === 0) drop(); }       // mouse: click empty water = drop
      else { mode2 = 'aimx'; hoverX = p.x; }                                // touch: tap/drag empty water = steer
    }
  });
  canvas.addEventListener('pointermove', e => {
    const p = toWorld(e);
    if (mode2 === 'piece' && current) {
      if (Math.hypot(p.x - pieceDrag.sx, p.y - pieceDrag.sy) > 3) pieceDrag.moved = true;
      hoverX = p.x; hoverYv = p.y;
    } else if (mode2 === 'grab' && grab) { grab.c.pointA = { x: p.x, y: p.y }; }
    else if (mode2 === 'aimx') hoverX = p.x;
    else if (e.pointerType === 'mouse') {
      if (phase === 'aiming' && current && !paused) hoverX = p.x;                // mouse hover steers the waiting block
      canvas.style.cursor = (overHover(p) || bodyAt(p)) ? 'grab' : 'crosshair';
    }
  });
  const endPointer = e => {
    if (mode2 === 'piece' && pieceDrag && !pieceDrag.moved && e.pointerType === 'mouse') drop();   // click (no drag) on the waiting block = drop
    if (mode2 === 'grab') releaseGrab();
    mode2 = null; pieceDrag = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); rotate(1); });
  canvas.addEventListener('wheel', e => { if (phase === 'aiming') { e.preventDefault(); rotate(e.deltaY > 0 ? 1 : -1); } }, { passive: false });

  function rotate(dir) {
    if (paused || phase !== 'aiming' || !current) return;
    angle += dir * STEP; Body.setAngle(current, angle); sfx.turn();
  }

  /* --------------------------------------------------------------- physics */
  function update(dt) {
    // waiting block: keep it above the tower and inside the view
    if (phase === 'aiming' && current) {
      if (keys.has('ArrowLeft') || keys.has('a')) hoverX -= 2.6;
      if (keys.has('ArrowRight') || keys.has('d')) hoverX += 2.6;
      const hh = (current.bounds.max.y - current.bounds.min.y) / 2, hw = (current.bounds.max.x - current.bounds.min.x) / 2;
      hoverX = Math.max(hw + 2, Math.min(W - hw - 2, hoverX));
      hoverYv = Math.min(hoverYv, -towerTopPx() - 4 - hh);               // can get close to the tower, never inside it
      hoverYv = Math.max(hoverYv, camTop + 14 + hh);
      Body.setPosition(current, { x: hoverX, y: hoverYv });
    }
    Engine.update(engine, dt);

    // blocks that fall off the ledge are lost
    for (const b of [...placed, current]) {
      if (!b || b.isStatic || b.position.y <= KILL_Y) continue;
      if (grab && grab.body === b) releaseGrab();
      Composite.remove(engine.world, b);
      const i = placed.indexOf(b); if (i >= 0) placed.splice(i, 1);
      lost++; sfx.lost(); toast('BLOCK LOST'); $('hBlock').classList.add('flash'); setTimeout(() => $('hBlock').classList.remove('flash'), 600);
      if (b === current) { current = null; afterSettle(); }
    }

    if (phase === 'falling' && current) {
      settleT += dt;
      const held = grab && grab.body === current;
      if (!held && current.speed < 0.14 && Math.abs(current.angularSpeed) < 0.006) settleFrames++; else settleFrames = 0;
      if (settleFrames > 28 || settleT > 7000) {
        const before = lastHeight;
        placed.push(current); current = null;
        const now = towerTopPx(), gain = (now - before) / PX_PER_M;
        if (gain >= 0.4) floatText(W / 2, -now + 10, '+' + gain.toFixed(1) + 'm', '#ffe98a');
        const mm = now / PX_PER_M;
        if (!wasBest && mm > Math.max(best, dayBest) + 0.05 && mm > 2) { wasBest = true; floatText(W / 2, -now - 6, 'NEW BEST!', '#8affc8'); sfx.best(); burst(W / 2, -now, 14, '#ffe98a', 3); }
        afterSettle();
      }
    }
    if (phase === 'finishing') {
      finishT += dt;
      const still = placed.every(b => b.speed < 0.2);
      if ((finishT > 2200 && still) || finishT > 7000) finish();
    }
    if (phase === 'done') return;

    // camera: keep the tower top around two-thirds down the view
    const h = towerTopPx();
    camTarget = Math.min(-300, -h - 230);
    camTop += (camTarget - camTop) * (reduce ? 1 : 0.07);
    if (h !== lastHeight) { lastHeight = h; hud(); }

    // particles / floaters
    for (let i = particles.length - 1; i >= 0; i--) { const q = particles[i]; q.x += q.vx; q.y += q.vy; q.vy += 0.04; q.life -= 0.03; if (q.life <= 0) particles.splice(i, 1); }
    for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.t += dt; f.y -= 0.25; if (f.t > 1400) floaters.splice(i, 1); }
    shake *= 0.86; if (shake < 0.05) shake = 0;
  }

  function afterSettle() {
    idx++;
    if (idx >= TOTAL) { phase = 'finishing'; finishT = 0; releaseGrab(); mode2 = null; hud(); return; }
    spawn(); hud();
  }

  /* ---------------------------------------------------------------- finish */
  const TITLES = [[0, 'Pebble Pile'], [8, 'Kelp Wobble'], [14, 'Coral Spire'], [22, 'Lighthouse'], [32, 'Skyscraper'], [45, 'Reaching the Surface']];
  async function finish() {
    phase = 'done'; releaseGrab();
    const m = towerM(), standing = placed.length;
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
    $('copyHint').textContent = ''; $('endRank').textContent = ''; $('endBoard').textContent = '';
    $('endFull').classList.toggle('hidden', mode !== 'daily');
    hideAll(); $('endOverlay').classList.remove('hidden');
    sfx.finish(); hud();
    if (mode === 'daily' && session) {
      $('endRank').textContent = 'Saving your score…';
      try {
        const r = await api('/api/stack/submit', { token: session.token, height: m, standing });
        $('endRank').textContent = 'Rank #' + r.rank + ' of ' + r.count + ' today' + (r.improved ? '' : ' (your best is ' + r.best.toFixed(1) + 'm)');
        const b = await api('/api/stack/leaderboard?playerId=' + encodeURIComponent(session.playerId));
        renderBoard($('endBoard'), b.rows.slice(0, 5), true);
      } catch (e) { $('endRank').textContent = 'Could not save to the leaderboard: ' + e.message; }
    } else if (mode === 'daily') $('endRank').textContent = 'Offline — score not saved to the leaderboard.';
  }
  $('copy').onclick = async () => {
    const m = towerM();
    const text = 'BLANION STACK ' + (mode === 'daily' ? seedKey : 'random') + ' — ' + m.toFixed(1) + 'm tower 🧱\n' + placed.length + '/' + TOTAL + ' blocks standing\n' + location.origin + '/stack';
    try { await navigator.clipboard.writeText(text); $('copyHint').textContent = 'Copied! Paste it anywhere.'; } catch { $('copyHint').textContent = text; }
  };

  /* ----------------------------------------------------------- leaderboard */
  function renderBoard(ol, rows, compact) {
    ol.textContent = '';
    if (!rows.length) { const li = document.createElement('li'); li.textContent = 'No towers yet — be the first!'; ol.appendChild(li); return; }
    rows.forEach(r => {
      const li = document.createElement('li'); if (r.me) li.className = 'me';
      const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = '#' + r.rank;
      const nm = document.createElement('span'); nm.textContent = r.nickname; if (!compact) { const z = document.createElement('small'); z.textContent = r.standing + ' standing'; nm.appendChild(z); }
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = r.height.toFixed(1) + 'm';
      li.append(rk, nm, sc); ol.appendChild(li);
    });
  }
  async function openBoard(from) {
    hideAll(); $('boardOverlay').classList.remove('hidden'); $('boardOverlay').dataset.from = from;
    $('boardList').textContent = ''; $('boardInfo').textContent = 'LOADING…';
    try {
      const b = await api('/api/stack/leaderboard' + (me ? '?playerId=' + encodeURIComponent(me.playerId) : ''));
      $('boardInfo').textContent = b.day + ' · ' + b.count + ' PLAYER' + (b.count === 1 ? '' : 'S') + ' · SAME BLOCKS FOR EVERYONE';
      renderBoard($('boardList'), b.rows, false);
    } catch (e) { $('boardInfo').textContent = e.message; }
  }
  $('showBoard').onclick = () => openBoard('menu');
  $('endFull').onclick = () => openBoard('end');
  $('boardClose').onclick = () => { hideAll(); $($('boardOverlay').dataset.from === 'end' ? 'endOverlay' : 'startOverlay').classList.remove('hidden'); };

  /* ------------------------------------------------------------------- HUD */
  function hud() {
    $('hBlock').textContent = Math.min(idx + 1, TOTAL) + '/' + TOTAL;
    $('hHeight').textContent = towerM().toFixed(1) + 'm';
    $('hBest').textContent = (mode === 'daily' ? dayBest : best).toFixed(1) + 'm';
  }

  /* ------------------------------------------------------------- rendering */
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const c = i => Math.max(0, Math.min(255, Math.round(((n >> i) & 255) * k))); return `rgb(${c(16)},${c(8)},${c(0)})`; }
  function drawBody(c, body, dx, dy, color, alpha, glow) {
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    c.globalAlpha = alpha == null ? 1 : alpha;
    for (const p of parts) {
      c.beginPath();
      p.vertices.forEach((v, i) => (i ? c.lineTo(v.x + dx, v.y + dy) : c.moveTo(v.x + dx, v.y + dy)));
      c.closePath();
      c.fillStyle = color; c.fill();
      c.lineJoin = 'round'; c.lineWidth = glow ? 2 : 1.4; c.strokeStyle = glow ? '#ffffff' : shade(color, 0.45); c.stroke();
    }
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.35)';
    for (const p of parts) { const v = p.vertices; c.beginPath(); c.moveTo(v[0].x + dx + 1, v[0].y + dy + 1); c.lineTo(v[1].x + dx - 1, v[1].y + dy + 1); c.stroke(); }
    c.globalAlpha = 1;
  }
  function text(str, x, y, color, align) {
    ctx.font = '8px "Press Start 2P", monospace'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(2,10,28,.85)'; ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = color || '#fff'; ctx.fillText(str, x, y);
  }

  function drawBackground(t) {
    const hgt = Math.min(1, towerTopPx() / 200);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const mix = (a, b) => Math.round(a + (b - a) * hgt);
    g.addColorStop(0, `rgb(${mix(40, 110)},${mix(120, 205)},${mix(185, 240)})`);
    g.addColorStop(0.6, `rgb(${mix(14, 40)},${mix(80, 140)},${mix(140, 200)})`);
    g.addColorStop(1, `rgb(${mix(6, 14)},${mix(32, 70)},${mix(70, 120)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < 4; i++) {
      const x0 = 30 + i * 62 + Math.sin(t * 0.0003 + i) * 8;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 24, 0); ctx.lineTo(x0 + 70, H); ctx.lineTo(x0 + 10, H); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (const b of bubbles) { if (!reduce && !paused) { b.y -= b.s; if (b.y < -4) { b.y = H + 4; b.x = Math.random() * W; } } ctx.fillRect(b.x | 0, b.y | 0, b.r > 2 ? 2 : 1, b.r > 2 ? 2 : 1); }
  }

  function drawWorld(t) {
    const sx = shake ? (Math.random() - 0.5) * shake * 2 : 0, sy = shake ? (Math.random() - 0.5) * shake * 2 : 0;
    ctx.save(); ctx.translate(sx | 0, sy | 0);
    const oy = -camTop, gy = oy;
    // seabed rock + ledge
    ctx.fillStyle = '#0e3552';
    ctx.beginPath(); ctx.moveTo(-4, gy + 40); ctx.lineTo(W / 2 - PLAT_W / 2 - 24, gy + 30); ctx.lineTo(W / 2 - PLAT_W / 2, gy + PLAT_H); ctx.lineTo(W / 2 + PLAT_W / 2, gy + PLAT_H); ctx.lineTo(W / 2 + PLAT_W / 2 + 24, gy + 30); ctx.lineTo(W + 4, gy + 40); ctx.lineTo(W + 4, gy + 400); ctx.lineTo(-4, gy + 400); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a8aa5'; ctx.fillRect(W / 2 - PLAT_W / 2, gy, PLAT_W, PLAT_H);
    ctx.fillStyle = '#a9b8d0'; ctx.fillRect(W / 2 - PLAT_W / 2, gy, PLAT_W, 3);
    ctx.fillStyle = '#4a5a78'; ctx.fillRect(W / 2 - PLAT_W / 2, gy + PLAT_H - 3, PLAT_W, 3);
    ctx.fillStyle = '#2aa874';
    for (let i = 0; i < 9; i++) { const kx = (i < 5 ? 8 + i * 14 : W - 8 - (i - 5) * 14); for (let y = 0; y < 22 + (i % 3) * 8; y++) ctx.fillRect(kx + Math.sin(t * 0.0015 + i + y * 0.2) * (1 + y * 0.05), gy + 36 - y, 2, 1); }
    // personal-best line + height ruler with labels
    const bestM = mode === 'daily' ? dayBest : best;
    if (bestM > 0) { const by = oy - bestM * PX_PER_M; if (by > -6 && by < H + 6) { ctx.fillStyle = 'rgba(255,242,122,.8)'; for (let x = 0; x < W; x += 8) ctx.fillRect(x, by | 0, 4, 1); text('BEST', W - 3, by - 6, '#ffe98a', 'right'); } }
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    for (let m = 0; m <= 80; m += 5) {
      const ry = oy - m * PX_PER_M; if (ry < -6 || ry > H + 6) continue;
      ctx.fillRect(0, ry | 0, m % 10 === 0 ? 9 : 5, 1);
      if (m > 0 && m % 10 === 0) text(String(m), 11, ry, 'rgba(255,255,255,.75)', 'left');
    }
    // blocks
    for (const b of placed) drawBody(ctx, b, 0, oy, b.plugin.color, 1, grab && grab.body === b);
    if (current) {
      const waiting = current.isStatic;
      drawBody(ctx, current, 0, oy, current.plugin.color, waiting ? 0.95 : 1, waiting || (grab && grab.body === current));
      if (waiting) {
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        for (let y = current.bounds.max.y + 4; y < PLAT_H + 40; y += 8) ctx.fillRect(current.position.x | 0, (y + oy) | 0, 1, 4);
      }
    }
    // grab spring
    if (grab) { const bpos = grab.c.bodyB.position, pa = grab.c.pointA; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pa.x, pa.y + oy); ctx.lineTo(bpos.x + grab.c.pointB.x, bpos.y + grab.c.pointB.y + oy); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect((pa.x - 1) | 0, (pa.y + oy - 1) | 0, 3, 3); }
    // particles + floating text
    for (const q of particles) { ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.color; ctx.fillRect(q.x | 0, (q.y + oy) | 0, q.r, q.r); }
    ctx.globalAlpha = 1;
    for (const f of floaters) { ctx.globalAlpha = Math.max(0, 1 - f.t / 1400); text(f.text, f.x, f.y + oy, f.color, 'center'); }
    ctx.globalAlpha = 1;
    ctx.restore();
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
    if (phase !== 'idle' && !paused) { acc += dt; let n = 0; while (acc >= 1000 / 60 && n++ < 5) { update(1000 / 60); acc -= 1000 / 60; } }
    drawBackground(now); if (engine) drawWorld(now);
    requestAnimationFrame(frame);
  }

  /* -------------------------------------------------------------- controls */
  const overlayOpen = () => ['startOverlay', 'endOverlay', 'boardOverlay', 'pauseOverlay'].some(id => !$(id).classList.contains('hidden'));
  addEventListener('keydown', e => {
    if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && !e.repeat && playing()) { setPaused(!paused); return; }
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
  hold($('bLeft'), () => { if (phase === 'aiming' && !paused) hoverX -= 3; });
  hold($('bRight'), () => { if (phase === 'aiming' && !paused) hoverX += 3; });
  $('bRotL').addEventListener('click', () => rotate(-1));
  $('bRotR').addEventListener('click', () => rotate(1));
  $('bDrop').addEventListener('click', () => { if (!paused) drop(); });

  const playing = () => phase === 'aiming' || phase === 'falling' || phase === 'finishing';
  function setPaused(v) { if (v && !playing()) return; paused = v; $('pauseOverlay').classList.toggle('hidden', !v); if (v) { releaseGrab(); mode2 = null; } else prev = performance.now(); }
  $('bPause').onclick = () => setPaused(!paused);
  $('resume').onclick = () => setPaused(false);
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing()) setPaused(true); });

  /* ----------------------------------------------------------- menu / flow */
  function hideAll() { ['startOverlay', 'endOverlay', 'boardOverlay', 'pauseOverlay'].forEach(id => $(id).classList.add('hidden')); paused = false; }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  async function start(m) {
    audio();                                                     // unlock sound on this user gesture
    const buttons = ['startDaily', 'startRandom', 'again']; buttons.forEach(id => $(id).disabled = true);
    let day = dateKey(); session = null;
    if (m === 'daily') {
      try {
        const j = await withTimeout(api('/api/stack/start', { playerId: me && me.playerId, nickname: $('nick').value }), 3000);
        me = { playerId: j.playerId, nickname: j.nickname }; LS.set('blanion.player', me); session = { token: j.token, day: j.day, playerId: j.playerId }; day = j.day;
      } catch { /* offline: play anyway, just no leaderboard */ }
    }
    buttons.forEach(id => $(id).disabled = false);
    hideAll(); newGame(m, day);
  }
  $('startDaily').onclick = () => start('daily');
  $('startRandom').onclick = () => start('random');
  $('again').onclick = () => start(mode);
  $('toMenu').onclick = () => { hideAll(); $('startOverlay').classList.remove('hidden'); };

  Mascot.mount($('logoMascot'), 3);
  if (me && me.nickname) $('nick').value = me.nickname;
  phase = 'idle';
  newGame('daily', dateKey()); phase = 'idle'; hideAll(); $('startOverlay').classList.remove('hidden');   // a calm tableau behind the menu
  hud();
  requestAnimationFrame(frame);

  // hook for automated tests
  window.__stack = {
    get phase() { return phase; }, get idx() { return idx; }, get height() { return towerM(); }, get lost() { return lost; }, get seq() { return seq.map(s => SHAPES[s.shape].name); },
    get paused() { return paused; }, get grabbing() { return !!grab; }, get placed() { return placed.length; },
    drop, setX: x => { hoverX = x; }, blocks: () => placed.map(b => ({ x: b.position.x, y: b.position.y })), toScreen: (x, y) => { const r = rect(); return { x: r.left + x * r.width / W, y: r.top + (y - camTop) * r.height / H }; },
  };
})();
