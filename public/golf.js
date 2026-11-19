/* BLANION MINI GOLF — game flow, input, HUD, sound and scorecard. Physics: golf-physics.js · 3D: golf3d.js */
(function () {
  'use strict';
  const G = GolfPhysics;
  const $ = id => document.getElementById(id);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const MAXPULL = 2.0;                                           // world units of drag for full power
  const speedFor = p => G.V_MAX * Math.pow(p, 1.35);             // keep in step with scripts/golf-solve.js
  const TOTAL_PAR = G.HOLES.reduce((a, h) => a + h.par, 0);

  let view = null, sim = null, hole = null, idx = 0, strokes = 0, scores = [], phase = 'menu', paused = false;
  let aim = null, overview = false, firstShot = true, last = performance.now(), toastT = 0, waterT = 0, acc = 0;
  const STEP = 1 / 240;                                          // fixed physics step: identical results at any frame rate
  const ptrs = new Map(); let gesture = null, rotating = false;

  /* ----------------------------------------------------------------- sound */
  let actx = null, muted = LS.get('blanion.golf.mute') === true;
  const audio = () => { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } if (actx.state === 'suspended') actx.resume(); return actx; };
  function tone(f0, f1, dur, type, vol, delay) {
    if (muted) return; const a = audio(); if (!a) return;
    const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, hp) {
    if (muted) return; const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 200; src.buffer = buf; g.gain.value = vol; src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  }
  let lastWall = 0;
  const sfx = {
    putt(p) { tone(180 + p * 120, 70, 0.1, 'triangle', 0.05 + p * 0.08); noise(0.05, 0.05 + p * 0.05, 800); },
    wall(v) { const n = performance.now(); if (n - lastWall < 40) return; lastWall = n; tone(520 + Math.random() * 120, 300, 0.05, 'triangle', clamp(v * 0.012, 0.01, 0.06)); },
    bump() { tone(320, 760, 0.12, 'square', 0.05); },
    blade() { tone(260, 140, 0.1, 'sawtooth', 0.04); },
    splash() { noise(0.45, 0.09, 500); tone(500, 120, 0.35, 'sine', 0.05); },
    cup() { tone(700, 300, 0.12, 'triangle', 0.06); tone(300, 160, 0.2, 'triangle', 0.05, 0.1); },
    cheer(big) { (big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047]).forEach((f, i) => tone(f, f * 1.01, 0.14, 'square', 0.04, i * 0.09)); },
    meh() { tone(330, 220, 0.25, 'triangle', 0.05); },
    click() { tone(900, 1100, 0.03, 'square', 0.02); },
    tick() { tone(1000, 1000, 0.015, 'square', 0.008); },
  };
  const setMuteUI = () => { $('bMute').classList.toggle('off', muted); $('bMute').setAttribute('aria-pressed', String(muted)); };
  $('bMute').onclick = () => { muted = !muted; LS.set('blanion.golf.mute', muted); setMuteUI(); if (!muted) sfx.click(); };
  setMuteUI();

  /* ------------------------------------------------------------------- HUD */
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  function toast(msg, ok, ms) { const el = $('toast'); el.textContent = msg; el.className = 'toast' + (ok ? ' ok' : ''); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), ms || 1400); }
  function hud(bump) {
    $('hHole').textContent = (idx + 1) + '/' + G.HOLES.length; $('hPar').textContent = hole ? hole.par : '-';
    const s = $('hStrokes'); s.textContent = strokes; if (bump) { s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
    $('hTotal').textContent = scores.reduce((a, b) => a + b, 0) + strokes;
  }

  /* ------------------------------------------------------------- hole flow */
  function startRound() {
    audio(); scores = []; idx = 0; firstShot = true;
    show('menu', false); show('card', false); show('hud', true); show('camPad', true);
    loadHole(0);
  }
  function loadHole(i) {
    idx = i; hole = G.HOLES[i]; strokes = 0; sim = G.createSim(hole); overview = false; $('bView').classList.remove('on');
    const info = view.loadHole(hole); view.overview(false); view.hideAim(); view.hideBall(false);
    show('banner', false); hud();
    phase = 'intro';
    $('hiNum').textContent = 'HOLE ' + (i + 1); $('hiName').textContent = hole.name; $('hiPar').textContent = 'PAR ' + hole.par; $('hiBlurb').textContent = hole.blurb;
    const hi = $('holeIntro'); hi.classList.add('hidden'); void hi.offsetWidth; hi.classList.remove('hidden');
    syncView(0);
    view.intro(() => { phase = 'aim'; show('hint', firstShot); setTimeout(() => show('holeIntro', false), 600); });
    if (reduced) { phase = 'aim'; show('hint', firstShot); }
  }

  function finishHole(giveUp) {
    const n = giveUp ? G.MAX_STROKES : strokes;
    scores.push(n); phase = 'holed'; hud();
    const par = hole.par, name = giveUp ? 'PICK UP' : G.scoreName(n, par), good = !giveUp && n <= par;
    $('bBig').textContent = name; $('bBig').className = 'b-big' + (good ? ' good' : ''); $('bSub').textContent = (giveUp ? 'Max ' : '') + n + ' stroke' + (n === 1 ? '' : 's') + ' · par ' + par;
    $('bNext').textContent = idx + 1 >= G.HOLES.length ? 'SCORECARD' : 'NEXT HOLE';
    const b = $('banner'); b.classList.add('hidden'); void b.offsetWidth; b.classList.remove('hidden');
    if (!giveUp) { view.celebrate(); if (good) { view.effects.confetti(hole.cup[0], hole.cup[1], n === 1 ? 140 : 70); sfx.cheer(n <= par - 1); } else sfx.meh(); } else sfx.meh();
    setTimeout(() => $('bNext').focus({ preventScroll: true }), 400);
  }
  function nextHole() {
    if (phase !== 'holed') return; sfx.click();
    if (idx + 1 >= G.HOLES.length) return showCard();
    loadHole(idx + 1);
  }
  $('bNext').onclick = nextHole;

  function showCard() {
    phase = 'card'; show('banner', false); show('hud', false); show('camPad', false); show('power', false);
    const total = scores.reduce((a, b) => a + b, 0), diff = total - TOTAL_PAR;
    const title = diff <= -3 ? 'Mini Golf Legend' : diff === -2 ? 'Absolute Pro' : diff === -1 ? 'Under Par Ace' : diff === 0 ? 'Par Player' : diff <= 2 ? 'Weekend Golfer' : diff <= 5 ? 'Putt-Putt Pal' : 'Keep Practising';
    $('cTitle').textContent = title.toUpperCase(); $('cTotal').textContent = total; $('cVs').textContent = (diff === 0 ? 'level par' : diff > 0 ? '+' + diff + ' over par' : -diff + ' under par');
    const tb = $('cRows'); tb.textContent = '';
    G.HOLES.forEach((h, i) => {
      const tr = document.createElement('tr'), s = scores[i], good = s <= h.par;
      [String(h.id) + ' · ' + h.name, h.par, s].forEach((v, k) => { const td = document.createElement('td'); td.textContent = v; if (k === 2) td.className = good ? 'good' : 'bad'; tr.appendChild(td); });
      const r = document.createElement('td'); r.textContent = s >= G.MAX_STROKES ? 'PICK UP' : G.scoreName(s, h.par); r.className = good ? 'good' : 'bad'; tr.appendChild(r); tb.appendChild(tr);
    });
    const best = LS.get('blanion.golf.best'); const isBest = best == null || total < best; if (isBest) LS.set('blanion.golf.best', total);
    $('cBest').className = 'res-prov' + (isBest ? ' final' : ''); $('cBest').textContent = (isBest ? 'NEW BEST! ' : '') + 'BEST ROUND ' + Math.min(best == null ? total : best, total) + ' (PAR ' + TOTAL_PAR + ')';
    $('copyHint').textContent = ''; show('card', true); sfx.cheer(diff <= 0);
    if (diff <= 0) view.effects.confetti(hole.cup[0], hole.cup[1], 80);
  }
  $('again').onclick = () => { sfx.click(); startRound(); };
  $('copy').onclick = async () => {
    const total = scores.reduce((a, b) => a + b, 0), diff = total - TOTAL_PAR;
    const text = '⛳ BLANION MINI GOLF — ' + total + (diff ? ' (' + (diff > 0 ? '+' : '') + diff + ')' : ' (par)') + '\n' + scores.map((s, i) => 'H' + (i + 1) + ':' + s).join('  ') + '\n' + location.origin + '/golf';
    try { await navigator.clipboard.writeText(text); $('copyHint').textContent = 'Copied! Paste it anywhere.'; } catch { $('copyHint').textContent = text; }
  };

  /* ---------------------------------------------------------- sim ↔ view */
  function syncView(dt) {
    const b = sim.ball;
    const k = sim.state === 'sinking' ? clamp(sim.sink.t / 0.35, 0, 1) : sim.state === 'sunk' ? 1 : 0;
    view.setBall(b, k); view.setSpinnerAngles(sim.spinners.map(s => s.angle));
    if (!view.intro_active && phase !== 'menu' && !aim) {           // lean the camera toward the cup so you can see where you are aiming
      const dx = hole.cup[0] - b.x, dy = hole.cup[1] - b.y, d = Math.hypot(dx, dy) || 1, lean = Math.min(view.portrait ? 0.9 : 2.4, d * 0.32);
      view.look(b.x + (dx / d) * lean, b.y + (dy / d) * lean);
    }
  }
  function handleEvents() {
    for (const e of sim.drain()) {
      if (e.type === 'putt') { sfx.putt(e.speed / G.V_MAX); view.effects.puff(e.x, e.y, 6); }
      else if (e.type === 'wall') { sfx.wall(e.speed); if (e.speed > 4) { view.shake(0.03); view.effects.puff(e.x, e.y, 2); } }
      else if (e.type === 'bumper') { sfx.bump(); view.effects.bump(e.x, e.y); view.shake(0.05); }
      else if (e.type === 'blade') { sfx.blade(); view.shake(0.03); }
      else if (e.type === 'cup') sfx.cup();
      else if (e.type === 'sunk') { if (phase === 'rolling') finishHole(false); }
      else if (e.type === 'water') { sfx.splash(); view.effects.splash(e.x, e.y); view.hideBall(true); strokes++; hud(true); phase = 'water'; waterT = 1.1; toast('SPLASH! +1 STROKE'); }
      else if (e.type === 'rest') { if (phase === 'rolling') { if (strokes >= G.MAX_STROKES) { finishHole(true); } else { phase = 'aim'; } } }
    }
  }

  /* ----------------------------------------------------------------- input */
  const canAim = () => phase === 'aim' && !paused && sim && sim.state === 'rest';
  function startAim(e) {
    if (!canAim()) return;
    const p = view.worldFromScreen(e.clientX, e.clientY); if (!p) return;
    aim = { pid: e.pointerId, dx: 0, dy: 1, power: 0, ptr: p }; updateAim(e); show('power', true); show('hint', false);
  }
  function updateAim(e) {
    if (!aim) return;
    const p = view.worldFromScreen(e.clientX, e.clientY); if (!p) return;
    const b = sim.ball, vx = b.x - p.x, vy = b.y - p.y, len = Math.hypot(vx, vy);
    if (len > 1e-4) { aim.dx = vx / len; aim.dy = vy / len; }
    aim.power = clamp((len - 0.12) / (MAXPULL - 0.12), 0, 1); aim.ptr = p;
    const sp = speedFor(aim.power);
    view.showAim(b, aim.dx, aim.dy, aim.power, aim.power > 0.01 ? sim.predict(aim.dx, aim.dy, sp, 3.4) : null, p);
    $('pfill').style.width = Math.round(aim.power * 100) + '%'; $('ptxt').textContent = aim.power < 0.04 ? 'PULL BACK' : 'POWER ' + Math.round(aim.power * 100) + '%';
  }
  function cancelAim() { aim = null; view.hideAim(); show('power', false); }
  function releaseAim() {
    if (!aim) return; const a = aim; cancelAim();
    if (a.power < 0.04 || !canAim()) return;
    sim.shoot(a.dx, a.dy, speedFor(a.power)); strokes++; phase = 'rolling'; firstShot = false; hud(true);
  }

  const canvas = $('gl');
  canvas.addEventListener('pointerdown', e => {
    audio(); try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (view.intro_active) { view.skipIntro(); return; }
    if (paused || phase === 'menu') return;
    if (ptrs.size === 2) { cancelAim(); const [a, b] = [...ptrs.values()]; gesture = { ang: Math.atan2(b.y - a.y, b.x - a.x), d: Math.hypot(b.x - a.x, b.y - a.y) }; return; }
    if (e.button === 2 || e.shiftKey || e.ctrlKey) { rotating = true; return; }
    if (e.button === 0 || e.pointerType === 'touch' || e.pointerType === 'pen') startAim(e);
  });
  canvas.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (prev) { const dx = e.clientX - prev.x, dy = e.clientY - prev.y; prev.x = e.clientX; prev.y = e.clientY;
      if (gesture && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const ang = Math.atan2(b.y - a.y, b.x - a.x), d = Math.hypot(b.x - a.x, b.y - a.y); let da = ang - gesture.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; view.nudgeYaw(-da * 57.3); view.zoom(gesture.d / Math.max(d, 1)); gesture = { ang, d }; return; }
      if (rotating) { view.nudgeYaw(-dx * 0.35); view.setPitch(view.pitch - dy * 0.25); return; } }
    if (aim && e.pointerId === aim.pid) updateAim(e);
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) gesture = null; if (aim && e.pointerId === aim.pid) { e.type === 'pointercancel' ? cancelAim() : releaseAim(); } if (!ptrs.size) rotating = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom(e.deltaY > 0 ? 1.08 : 0.92); }, { passive: false });

  const held = new Set();
  addEventListener('keydown', e => {
    const k = e.key; held.add(k);
    if (k === 'Escape' || k === 'p' || k === 'P') { if (aim) return cancelAim(); if (phase !== 'menu' && phase !== 'card') setPaused(!paused); return; }
    if ((k === 'Enter' || k === ' ') && phase === 'holed') { e.preventDefault(); nextHole(); return; }
    if (k === '+' || k === '=') view.zoom(0.9); if (k === '-' || k === '_') view.zoom(1.1);
  });
  addEventListener('keyup', e => held.delete(e.key));
  $('bRotL').onclick = () => view.nudgeYaw(22); $('bRotR').onclick = () => view.nudgeYaw(-22);
  $('bZoomIn').onclick = () => view.zoom(0.86); $('bZoomOut').onclick = () => view.zoom(1.16);
  $('bView').onclick = () => { overview = !overview; view.overview(overview); $('bView').classList.toggle('on', overview); sfx.click(); };
  function setPaused(v) { paused = v; show('pause', v); if (v) cancelAim(); last = performance.now(); }
  $('bPause').onclick = () => setPaused(true); $('resume').onclick = () => setPaused(false);
  $('quit').onclick = () => { setPaused(false); toMenu(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden && ['aim', 'rolling', 'intro'].includes(phase)) setPaused(true); });
  addEventListener('resize', () => view && view.resize());

  /* ------------------------------------------------------------- main loop */
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (view) {
      if (!paused) {
        if (held.has('ArrowLeft') || held.has('a')) view.nudgeYaw(70 * dt); if (held.has('ArrowRight') || held.has('d')) view.nudgeYaw(-70 * dt);
        if (phase === 'menu') view.nudgeYaw(dt * 7);
        if (sim) {
          acc += dt; for (let n = 0; acc >= STEP && n < 14; n++) { sim.step(STEP); acc -= STEP; }
          handleEvents(); syncView(dt);
          if (phase === 'water') { waterT -= dt; if (waterT <= 0) { sim.respawn(); view.hideBall(false); phase = 'aim'; view.effects.puff(sim.ball.x, sim.ball.y, 4); } }
          if (aim && sim.state !== 'rest') cancelAim();
        }
      }
      view.render(paused ? 0 : dt, now);
    }
    requestAnimationFrame(frame);
  }

  function toMenu() {
    phase = 'menu'; cancelAim(); show('hud', false); show('camPad', false); show('banner', false); show('holeIntro', false); show('hint', false); show('card', false); show('menu', true);
    hole = G.HOLES[0]; idx = 0; strokes = 0; scores = []; sim = G.createSim(hole); view.loadHole(hole); view.setYaw(40); view.setDist(9.5); view.overview(true); syncView(0);
    const best = LS.get('blanion.golf.best'); $('bestLine').textContent = best == null ? 'Beat par to earn a title.' : 'YOUR BEST ROUND: ' + best + ' (PAR ' + TOTAL_PAR + ')';
  }

  /* ------------------------------------------------------------------ init */
  function listHoles() {
    const ul = $('holesList'); ul.textContent = ''; const cols = ['#5be3a1', '#ffd54f', '#4fc3f7'];
    G.HOLES.forEach((h, i) => { const li = document.createElement('li'); li.style.setProperty('--c', cols[i % 3]); const n = document.createElement('span'); n.className = 'n'; n.textContent = h.id; const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = h.name; const sm = document.createElement('small'); sm.textContent = h.blurb; nm.appendChild(sm); const p = document.createElement('span'); p.className = 'p'; p.textContent = 'PAR ' + h.par; li.append(n, nm, p); ul.appendChild(li); });
  }
  async function init() {
    Mascot.mount($('logoMascot'), 3); listHoles();
    try {
      const mod = await import('/golf3d.js');
      const lowQuality = matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
      view = mod.createView(canvas, { lowQuality, reduced });
    } catch (e) { console.warn('3D unavailable:', e && e.message); show('menu', false); show('noGL', true); return; }
    toMenu(); $('start').onclick = () => { sfx.click(); startRound(); };
    window.__golf = {
      get phase() { return phase; }, get strokes() { return strokes; }, get idx() { return idx; }, get scores() { return scores; }, get paused() { return paused; },
      ball: () => ({ x: sim.ball.x, y: sim.ball.y, state: sim.state }), get sim() { return sim; },
      shoot(dx, dy, p) { if (!canAim()) return false; sim.shoot(dx, dy, speedFor(p)); strokes++; phase = 'rolling'; firstShot = false; hud(true); return true; },
      skipIntro: () => view.skipIntro(), next: nextHole, view, toScreen: (x, y) => view.screenFromWorld(x, y),
    };
    requestAnimationFrame(frame);
  }
  init();
})();
