/* BLANION RACER — game flow, input, HUD, sound, ghost, medals. Physics: racer-core.js · 3D: racer3d.js */
(function () {
  'use strict';
  const C = window.RacerCore, DT = C.DT;
  const $ = id => document.getElementById(id);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode or full */ } },
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const LIV = [{ n: 'Coral', body: '#ff5470', stripe: '#ffffff' }, { n: 'Mint', body: '#1fe0c4', stripe: '#17142b' }, { n: 'Tangerine', body: '#ff9a3c', stripe: '#17142b' }, { n: 'Indigo', body: '#5b6cff', stripe: '#ffffff' }, { n: 'Cream', body: '#f4efe6', stripe: '#ff5470' }];   // keep in step with LIVERIES in racer-cars.js

  let view = null, track = null, race = null, phase = 'menu', paused = false, last = performance.now(), acc = 0, simT = 0;
  let sel = LS.get('blanion.racer.sel') || 'seaside', seed = LS.get('blanion.racer.seed') || 1234, carIdx = clamp(LS.get('blanion.racer.car') | 0, 0, C.CARS.length - 1), livIdx = clamp(LS.get('blanion.racer.liv') | 0, 0, LIV.length - 1), raceNum = clamp(LS.get('blanion.racer.num') | 0 || 7, 1, 99), tab = 'track';
  let testLaps = 0, auto = null, rec = null, ghost = null, ghostIdx = 0, countT = 0, lastCount = 4, flashT = 0, finishInfo = null;
  const bests = LS.get('blanion.racer.best') || {};
  const medals = {};

  /* ----------------------------------------------------------------- sound */
  let actx = null, muted = LS.get('blanion.racer.mute') === true, eng = null;
  const audio = () => { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } if (actx.state === 'suspended') actx.resume(); return actx; };
  function tone(f0, f1, dur, type, vol, delay) {
    if (muted) return; const a = audio(); if (!a) return;
    const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function engine(on) {
    const a = audio(); if (!a) return;
    if (on && !eng) {
      const o = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(a.destination); o.start(); o2.start(); eng = { o, o2, g, f };
    } else if (!on && eng) { try { eng.g.gain.setTargetAtTime(0, a.currentTime, 0.05); eng.o.stop(a.currentTime + 0.2); eng.o2.stop(a.currentTime + 0.2); } catch { /* already stopped */ } eng = null; }
  }
  function engineUpdate(speed, thr) {
    if (!eng || !actx) return; const t = actx.currentTime, f = 48 + speed * 5.2;
    eng.o.frequency.setTargetAtTime(f, t, 0.04); eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    eng.f.frequency.setTargetAtTime(500 + speed * 28 + thr * 500, t, 0.05); eng.g.gain.setTargetAtTime(muted ? 0 : 0.018 + thr * 0.02, t, 0.06);
  }
  let lastHit = 0;
  const sfx = {
    count(go) { tone(go ? 880 : 440, go ? 880 : 440, go ? 0.4 : 0.15, 'square', 0.05); },
    hit(v) { const n = performance.now(); if (n - lastHit < 120) return; lastHit = n; tone(160, 60, 0.12, 'sawtooth', clamp(v * 0.01, 0.02, 0.08)); },
    lap() { [660, 880].forEach((f, i) => tone(f, f, 0.12, 'triangle', 0.05, i * 0.1)); },
    best() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.14, 'square', 0.04, i * 0.09)); },
    fin(big) { (big ? [523, 659, 784, 1047, 1319, 1568] : [392, 494, 587]).forEach((f, i) => tone(f, f * 1.01, 0.16, 'square', 0.04, i * 0.1)); },
    click() { tone(900, 1100, 0.03, 'square', 0.02); },
  };
  const setMuteUI = () => { $('bMute').classList.toggle('off', muted); $('bMute').setAttribute('aria-pressed', String(muted)); };
  $('bMute').onclick = () => { muted = !muted; LS.set('blanion.racer.mute', muted); setMuteUI(); if (muted) engine(false); else if (phase === 'race') engine(true); };
  setMuteUI();

  /* ----------------------------------------------------------------- input */
  const keys = new Set(), touch = { l: false, r: false, g: false, b: false };
  addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    keys.add(k);
    if (k === 'escape' && (phase === 'race' || phase === 'countdown')) togglePause();
    else if (k === 'r' && (phase === 'race' || phase === 'countdown' || phase === 'finish')) startRace();
    else if (k === 't' && phase === 'race') respawn();
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); touch.l = touch.r = touch.g = touch.b = false; if (phase === 'race' && !paused) togglePause(); });
  const bindHold = (id, key) => { const b = $(id); const on = e => { e.preventDefault(); touch[key] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch { /* ok */ } }, off = () => { touch[key] = false; b.classList.remove('on'); }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off); };
  bindHold('tL', 'l'); bindHold('tR', 'r'); bindHold('tG', 'g'); bindHold('tB', 'b');
  function readInput() {
    if (auto && race && phase === 'race') return auto(race.car);
    const L = keys.has('arrowleft') || keys.has('a') || touch.l, R = keys.has('arrowright') || keys.has('d') || touch.r;
    return { thr: keys.has('arrowup') || keys.has('w') || touch.g ? 1 : 0, brk: keys.has('arrowdown') || keys.has('s') || touch.b ? 1 : 0, str: (R ? 1 : 0) - (L ? 1 : 0), hb: keys.has(' ') };
  }

  /* ----------------------------------------------------------------- tracks & records */
  const trackFor = id => id === 'random' ? C.randomTrack(seed) : C.buildTrack(C.TRACKS.find(t => t.id === id) || C.TRACKS[0]);
  const keyFor = tr => tr.def.seed ? 'r' + tr.seed : tr.id;
  function medalFor(tr, time) { const k = keyFor(tr); if (!medals[k]) medals[k] = C.medalTimes(tr, tr.laps); const m = medals[k]; return { medal: time <= m.gold ? 'GOLD' : time <= m.silver ? 'SILVER' : time <= m.bronze ? 'BRONZE' : null, m }; }
  const medalIcon = m => ({ GOLD: '🥇', SILVER: '🥈', BRONZE: '🥉' }[m] || '');

  const thumbs = {};
  function drawThumb(cv, tr) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const p of tr.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const s = Math.min((W - 14) / (maxX - minX), (H - 14) / (maxZ - minZ)), ox = (W - (maxX - minX) * s) / 2 - minX * s, oz = (H - (maxZ - minZ) * s) / 2 - minZ * s;
    g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); tr.pts.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](p.x * s + ox, p.z * s + oz)); g.closePath();
    g.strokeStyle = '#4a4584'; g.lineWidth = 7; g.stroke(); g.strokeStyle = '#f7f1e5'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ff9a3c'; g.beginPath(); g.arc(tr.pts[0].x * s + ox, tr.pts[0].z * s + oz, 4, 0, 7); g.fill();
  }
  function renderMenu() {
    const ul = $('trackList'); ul.textContent = '';
    const items = C.TRACKS.map(d => ({ id: d.id, name: d.name, blurb: d.blurb, level: d.level, def: d })).concat([{ id: 'random', name: 'Random Track', blurb: 'A brand-new circuit from a code. Share the code with friends.', level: 'RANDOM' }]);
    for (const it of items) {
      const li = document.createElement('li'); li.className = it.id === sel ? 'sel' : ''; li.tabIndex = 0; li.setAttribute('role', 'button');
      const key = it.id === 'random' ? 'r' + seed : it.id, b = bests[key];
      const cv = document.createElement('canvas'); cv.width = 192; cv.height = 144;
      let tr = thumbs[key]; if (!tr) tr = thumbs[key] = it.id === 'random' ? C.randomTrack(seed) : C.buildTrack(it.def); drawThumb(cv, tr);
      const box = document.createElement('div');
      const n = document.createElement('div'); n.className = 'rc-tn'; n.textContent = it.id === 'random' ? 'Random Track #' + (tr.seed || seed) : it.name; const lv = document.createElement('span'); lv.className = 'rc-tl ' + it.level; lv.textContent = it.level; n.append(lv);
      const d = document.createElement('div'); d.className = 'rc-td'; d.textContent = it.blurb + ' ' + Math.round(tr.len) + ' m · ' + tr.laps + ' laps';
      const bt = document.createElement('div'); bt.className = 'rc-tb'; bt.textContent = b ? 'BEST ' + C.fmt(b.race) + (b.medal ? ' ' + medalIcon(b.medal) : '') + ' · LAP ' + C.fmt(b.lap) : 'NO TIME SET YET';
      box.append(n, d, bt);
      if (it.id === 'random') {
        const row = document.createElement('div'); row.className = 'rc-rnd'; const inp = document.createElement('input'); inp.type = 'number'; inp.min = 1; inp.max = 99999; inp.value = seed; inp.setAttribute('aria-label', 'Track code');
        const go = document.createElement('button'); go.className = 'rc-mini-btn'; go.textContent = 'ROLL'; go.type = 'button';
        inp.onclick = e => e.stopPropagation(); inp.onkeydown = e => e.stopPropagation(); inp.onchange = () => { seed = clamp(parseInt(inp.value, 10) || 1, 1, 99999); LS.set('blanion.racer.seed', seed); select('random'); };
        go.onclick = e => { e.stopPropagation(); seed = 1 + Math.floor(Math.random() * 99999); LS.set('blanion.racer.seed', seed); select('random'); };
        row.append(document.createTextNode('CODE'), inp, go); box.append(row);
      }
      li.append(cv, box);
      const pick = () => { sfx.click(); select(it.id); }; li.onclick = pick; li.onkeydown = e => { if (e.key === 'Enter') pick(); };
      ul.append(li);
    }
    // cars
    const cl = $('carList'); cl.textContent = '';
    C.CARS.forEach((c, i) => { const li = document.createElement('li'); li.className = i === carIdx ? 'sel' : ''; li.tabIndex = 0; const b = document.createElement('b'); b.textContent = c.name; const sp = document.createElement('span'); sp.textContent = c.tag; li.append(b, sp); const pick = () => { carIdx = i; LS.set('blanion.racer.car', i); sfx.click(); applyCar(); renderMenu(); }; li.onclick = pick; li.onkeydown = e => { if (e.key === 'Enter') pick(); }; cl.append(li); });
    const st = $('carStats'); st.textContent = ''; const m = C.CARS[carIdx].mods;
    for (const [lab, v] of [['SPEED', m.vmax], ['ACCEL', m.acc], ['GRIP', m.alat]]) { const n = clamp(Math.round(3 + (v - 1) * 40), 1, 5); const row = document.createElement('div'); row.className = 'rc-stat'; const l = document.createElement('span'); l.textContent = lab; const bars = document.createElement('div'); bars.className = 'rc-bars'; for (let k = 0; k < 5; k++) { const i = document.createElement('i'); if (k < n) i.className = 'on'; bars.append(i); } row.append(l, bars); st.append(row); }
    const sw = $('liveries'); sw.textContent = '';
    LIV.forEach((l, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rc-sw' + (i === livIdx ? ' sel' : ''); b.style.background = l.body; b.title = l.n; b.setAttribute('aria-label', 'Livery ' + l.n); const st2 = document.createElement('i'); st2.style.cssText = 'position:absolute;left:0;right:0;top:50%;height:6px;transform:translateY(-50%);background:' + l.stripe; b.append(st2); b.onclick = () => { livIdx = i; LS.set('blanion.racer.liv', i); sfx.click(); applyCar(); renderMenu(); }; sw.append(b); });
    $('numIn').value = raceNum;
    const b = bests[sel === 'random' ? 'r' + seed : sel]; $('bestLine').textContent = b ? 'YOUR BEST ' + C.fmt(b.race) + (b.medal ? ' ' + medalIcon(b.medal) + ' ' + b.medal : '') : 'SET A TIME TO UNLOCK YOUR GHOST';
  }
  function applyCar() { if (view) view.setCar(C.CARS[carIdx].id, livIdx, raceNum); }
  function setTab(t) { tab = t; $('paneTrack').classList.toggle('hidden', t !== 'track'); $('paneCar').classList.toggle('hidden', t !== 'car'); $('tabTrack').classList.toggle('on', t === 'track'); $('tabCar').classList.toggle('on', t === 'car'); }
  $('tabTrack').onclick = () => { sfx.click(); setTab('track'); }; $('tabCar').onclick = () => { sfx.click(); setTab('car'); };
  const setNum = n => { raceNum = clamp(n | 0 || 1, 1, 99); LS.set('blanion.racer.num', raceNum); $('numIn').value = raceNum; applyCar(); };
  $('numMinus').onclick = () => setNum(raceNum - 1); $('numPlus').onclick = () => setNum(raceNum + 1); $('numIn').onchange = () => setNum(parseInt($('numIn').value, 10)); $('numIn').onkeydown = e => e.stopPropagation();
  function select(id) { sel = id; LS.set('blanion.racer.sel', id); track = trackFor(id); if (view) { view.setTrack(track); view.resetCamera(); } renderMenu(); drawMini(); }

  /* ----------------------------------------------------------------- ghost */
  const ghostKey = tr => 'blanion.racer.ghost.' + keyFor(tr);
  function loadGhost() { const g = LS.get(ghostKey(track)); ghost = g && g.x && g.x.length > 10 ? g : null; ghostIdx = 0; if (ghost && view) view.setGhostCar(ghost.car || 'gt'); $('hGhostWrap').classList.toggle('hidden', !ghost); }
  function ghostPose(t) {
    if (!ghost) return null; const f = t * 30, i = Math.floor(f); if (i >= ghost.x.length - 1) return null;
    const u = f - i, x = (ghost.x[i] + (ghost.x[i + 1] - ghost.x[i]) * u) / 10, z = (ghost.z[i] + (ghost.z[i + 1] - ghost.z[i]) * u) / 10;
    let h0 = ghost.h[i] / 1000, h1 = ghost.h[i + 1] / 1000; while (h1 - h0 > Math.PI) h1 -= Math.PI * 2; while (h1 - h0 < -Math.PI) h1 += Math.PI * 2;
    ghostIdx = C.nearest(track, x, z, ghostIdx || -1).i; return { x, z, h: h0 + (h1 - h0) * u, y: track.pts[ghostIdx].y };
  }
  function ghostTimeAt(progress) { // seconds the ghost needed to reach this much progress
    const p = ghost.p; let lo = 0, hi = p.length - 1; if (progress <= p[0]) return 0; if (progress >= p[hi]) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m] <= progress) lo = m; else hi = m; }
    return (lo + (progress - p[lo]) / ((p[hi] - p[lo]) || 1)) / 30;
  }

  /* ----------------------------------------------------------------- flow */
  const show = id => { for (const s of ['menu', 'results', 'pause', 'noGL']) $(s).classList.toggle('hidden', s !== id); };
  const hudOn = on => { for (const id of ['hud', 'speedo', 'mini', 'keysHint']) $(id).classList.toggle('hidden', !on); $('touch').classList.toggle('hidden', !(on && matchMedia('(pointer: coarse)').matches)); };
  function flash(text, cls) { const f = $('flash'); f.textContent = text; f.className = 'rc-flash ' + (cls || ''); clearTimeout(flashT); flashT = setTimeout(() => f.classList.add('hidden'), 1800); f.style.animation = 'none'; void f.offsetWidth; f.style.animation = ''; }

  function startRace() {
    if (!view) return;
    if (!track || keyFor(track) !== (sel === 'random' ? 'r' + (track.seed || seed) : sel)) track = trackFor(sel);
    view.setTrack(track); view.resetCamera(); applyCar();
    race = C.newRace(track, testLaps || track.laps, C.CARS[carIdx].mods); rec = { x: [], z: [], h: [], p: [] }; loadGhost(); finishInfo = null;
    phase = 'countdown'; paused = false; countT = 0; lastCount = 4; simT = 0; acc = 0;
    show(null); $('flash').classList.add('hidden'); hudOn(true); drawMini(); engine(true);
    $('hLap').textContent = '1/' + race.laps; $('hTime').textContent = C.fmt(0); $('hBest').textContent = '--'; $('hDelta').textContent = '--'; $('hDelta').style.color = '';
  }
  function respawn() {
    if (phase !== 'race' || race.done) return; const c = race.car, q = C.nearest(track, c.x, c.z, c.idx), p = track.pts[q.i];
    c.x = q.cx; c.z = q.cz; c.h = Math.atan2(p.tx, p.tz); c.vx = c.vz = 0; c.steer = 0; c.off = false; c.speed = c.vf = 0; race.ticks += 600; flash('RESPAWN +5s', 'bad');
  }
  function togglePause() { if (phase === 'menu' || phase === 'finish') return; paused = !paused; $('pause').classList.toggle('hidden', !paused); engine(!paused && phase !== 'menu'); }
  $('bPause').onclick = () => { sfx.click(); togglePause(); };
  $('resume').onclick = () => togglePause();
  $('restart').onclick = () => startRace();
  $('quit').onclick = () => { paused = false; toMenu(); };
  $('start').onclick = () => { audio(); sfx.click(); startRace(); };
  $('again').onclick = () => { sfx.click(); startRace(); };
  $('toMenu').onclick = () => toMenu();
  function toMenu() { applyCar(); phase = 'menu'; paused = false; engine(false); hudOn(false); $('count').classList.add('hidden'); $('flash').classList.add('hidden'); renderMenu(); show('menu'); }

  function finish() {
    phase = 'finish'; engine(false); hudOn(false);
    const total = race.finishTime, best = race.bestLap, k = sel === 'random' ? 'r' + track.seed : sel, prev = bests[k];
    const { medal, m } = medalFor(track, total), isBest = !prev || total < prev.race;
    const lapBest = !prev || best < prev.lap;
    bests[k] = { race: isBest ? total : prev.race, lap: lapBest ? best : prev.lap, medal: bestMedal(prev && prev.medal, medal) }; LS.set('blanion.racer.best', bests);
    if (isBest) { const n = rec.x.length; LS.set(ghostKey(track), { time: total, car: C.CARS[carIdx].id, x: rec.x, z: rec.z, h: rec.h, p: rec.p }); void n; }
    finishInfo = { total, medal, isBest, laps: race.lapTimes.slice(), best, m };
    $('rTrack').textContent = track.name.toUpperCase();
    $('rTitle').textContent = isBest ? 'NEW BEST!' : 'FINISHED!';
    $('rMedal').textContent = medal ? medalIcon(medal) + ' ' + medal + ' MEDAL' : 'NO MEDAL — GOLD IS ' + C.fmt(m.gold);
    $('rTotal').textContent = C.fmt(total);
    $('rVs').textContent = prev && !isBest ? 'best ' + C.fmt(prev.race) : isBest && prev ? 'was ' + C.fmt(prev.race) : '';
    const tb = $('rRows'); tb.textContent = '';
    race.lapTimes.forEach((t, i) => { const tr = document.createElement('tr'); [String(i + 1), C.fmt(t), t === best ? '★' : ''].forEach(x => { const td = document.createElement('td'); td.textContent = x; tr.append(td); }); tb.append(tr); });
    $('rBest').textContent = medal === 'GOLD' ? 'Gold! Try the next track.' : 'Gold: ' + C.fmt(m.gold) + ' · Silver: ' + C.fmt(m.silver) + ' · Bronze: ' + C.fmt(m.bronze);
    $('copyHint').textContent = ''; sfx.fin(medal === 'GOLD' || isBest);
    setTimeout(() => { if (phase === 'finish') show('results'); }, reduced ? 0 : 900);
  }
  const rank = { GOLD: 3, SILVER: 2, BRONZE: 1 }; const bestMedal = (a, b) => (rank[a] || 0) >= (rank[b] || 0) ? a || null : b;
  $('copy').onclick = async () => {
    if (!finishInfo) return;
    const txt = `BLANION RACER · ${track.name} · ${C.fmt(finishInfo.total)} ${medalIcon(finishInfo.medal)}` + (track.def.seed ? ` · code ${track.seed}` : '') + `\n${location.origin}/racer`;
    try { await navigator.clipboard.writeText(txt); $('copyHint').textContent = 'COPIED!'; } catch { $('copyHint').textContent = txt; }
  };

  /* ----------------------------------------------------------------- minimap */
  function drawMini() {
    const cv = $('mini'); if (!cv || !track) return; const g = cv.getContext('2d', { willReadFrequently: true }), W = cv.width; g.clearRect(0, 0, W, W);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const p of track.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const s = (W - 20) / Math.max(maxX - minX, maxZ - minZ), ox = (W - (maxX - minX) * s) / 2 - minX * s, oz = (W - (maxZ - minZ) * s) / 2 - minZ * s;
    drawMini.t = { s, ox, oz };
    g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = '#04122c'; g.lineWidth = 8; g.beginPath(); track.pts.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](p.x * s + ox, p.z * s + oz)); g.closePath(); g.stroke();
    g.strokeStyle = '#cfe5ff'; g.lineWidth = 4; g.stroke(); drawMini.base = g.getImageData(0, 0, W, W);
  }
  function drawMiniCar() {
    const cv = $('mini'), g = cv.getContext('2d', { willReadFrequently: true }), t = drawMini.t; if (!t || !drawMini.base) return; g.putImageData(drawMini.base, 0, 0);
    const dot = (x, z, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(x * t.s + t.ox, z * t.s + t.oz, r, 0, 7); g.fill(); };
    const gp = ghost && ghostPose(race.time); if (gp) dot(gp.x, gp.z, '#ffffff99', 4);
    dot(race.car.x, race.car.z, LIV[livIdx].body, 5); const p0 = track.pts[0]; dot(p0.x, p0.z, '#ffd54f', 3);
  }

  /* ----------------------------------------------------------------- main loop */
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; simT += dt;
    if (!view) return;
    if (phase === 'menu' || phase === 'noGL') { view.frame(null, null, dt, 'showcase', simT); return; }
    if (paused) { view.frame(race.car, ghostPose(race.time), 0.0001, 'race', simT); return; }
    const inp = readInput();
    if (phase === 'countdown') {
      countT += dt; const n = 3 - Math.floor(countT);
      if (n !== lastCount && n >= 1) { lastCount = n; const el = $('count'); el.textContent = n; el.className = 'rc-count'; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; sfx.count(false); }
      if (countT >= 3) { phase = 'race'; const el = $('count'); el.textContent = 'GO!'; el.className = 'rc-count go'; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; sfx.count(true); setTimeout(() => $('count').classList.add('hidden'), 900); acc = 0; }
      else if (countT < 3 && countT > 0) $('count').classList.remove('hidden');
      view.frame(race.car, ghostPose(0), dt, 'race', simT); engineUpdate(0, inp.thr * 0.6); return;
    }
    acc += dt; let guard = 0;
    while (acc >= DT && guard++ < 24 && phase === 'race') {
      acc -= DT; const prevLaps = race.lapTimes.length, ev = C.stepRace(race, phase === 'race' ? inp : {});
      if (race.ticks % 4 === 0) { rec.x.push(Math.round(race.car.x * 10)); rec.z.push(Math.round(race.car.z * 10)); rec.h.push(Math.round(race.car.h * 1000)); rec.p.push(Math.round(race.total)); }
      if (race.car.hit > 4) sfx.hit(race.car.hit);
      for (const e of ev) {
        if (e.type === 'lap' && e.n < race.laps) { const bl = e.time <= race.bestLap + 1e-9; sfx.lap(); flash('LAP ' + e.n + ' · ' + C.fmt(e.time) + (bl && e.n > 1 ? ' · BEST' : ''), bl ? 'good' : ''); $('hLap').textContent = (e.n + 1) + '/' + race.laps; $('hBest').textContent = C.fmt(race.bestLap); }
        if (e.type === 'finish') { finish(); break; }
      }
      void prevLaps;
    }
    // HUD
    const c = race.car;
    $('hTime').textContent = C.fmt(race.time); $('sKmh').textContent = Math.round(c.speed * 3.6); $('sBar').style.width = Math.round(clamp(c.speed / C.CAR.VMAX, 0, 1) * 100) + '%';
    if (ghost && race.total > 5) { const gt = ghostTimeAt(race.total); if (gt != null) { const d = race.time - gt, el = $('hDelta'); el.textContent = (d > 0 ? '+' : '-') + Math.abs(d).toFixed(2); el.style.color = d > 0 ? '#ff8a70' : '#5be3a1'; } }
    drawMiniCar(); engineUpdate(c.speed, inp.thr);
    view.frame(c, ghost && phase !== 'finish' ? ghostPose(race.time) : null, dt, 'race', simT);
  }

  /* ----------------------------------------------------------------- boot */
  async function boot() {
    renderMenu(); setMuteUI();
    try {
      const mod = await import('/racer3d.js');
      const lowQ = (navigator.hardwareConcurrency || 4) <= 4 && matchMedia('(pointer: coarse)').matches;
      view = mod.createView($('gl'), { reduced, lowQuality: lowQ, maxDpr: lowQ ? 1.5 : 2 });
      applyCar(); select(sel); setTab(tab);
    } catch (err) { console.error(err); show('noGL'); return; }
    window.__racer = { get phase() { return phase; }, get race() { return race; }, get track() { return track; }, core: C, start: startRace, setLaps(n) { testLaps = n; }, autopilot(on) { auto = on ? C.bot(track, 1) : null; }, setInput(i) { keys.clear(); if (i.thr) keys.add('w'); if (i.brk) keys.add('s'); if (i.str < 0) keys.add('a'); if (i.str > 0) keys.add('d'); } };
    requestAnimationFrame(t => { last = t; tick(t); });
  }
  boot();
})();
