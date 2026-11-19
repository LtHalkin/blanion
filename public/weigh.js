/* BLANION WEIGH-IN — game flow, animation and sound. Data + scoring: weigh-data.js · 3D balance scale: weigh3d.js */
(function () {
  'use strict';
  const W = WeighData;
  const $ = id => document.getElementById(id);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const EMOJI = s => s >= 90 ? '🎯' : s >= 70 ? '🟩' : s >= 40 ? '🟨' : s >= 10 ? '🟧' : '🟥';
  const TITLES = [[0, 'Off the Scale'], [150, 'In the Right Zip Code'], [250, 'Good Ballpark'], [350, 'Sharp Eye'], [450, 'Human Scales']];
  const fmtInt = n => Math.round(n).toLocaleString('en-IE');
  const grade = p => p >= 90 ? 'perfect' : p >= 70 ? 'g2' : p >= 40 ? 'g3' : 'g4';

  let stage = null, handle = null;
  let mode, key, pairs, round, results, locked;                 // results: [{guess, truth, points, pair}]

  /* ----------------------------------------------------------------- sound */
  let actx = null, muted = LS.get('blanion.weigh.mute') === true;
  function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } if (actx.state === 'suspended') actx.resume(); return actx; }
  function tone(f0, f1, dur, type, vol, delay) {
    if (muted) return; const a = audio(); if (!a) return;
    const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  let lastTick = 0;
  const sfx = {
    tick() { const n = performance.now(); if (n - lastTick < 45) return; lastTick = n; tone(900, 1000, 0.025, 'square', 0.012); },
    lock() { tone(300, 520, 0.09, 'square', 0.04); },
    creak() { tone(180, 90, 0.5, 'sawtooth', 0.018); },
    thud() { tone(120, 50, 0.16, 'triangle', 0.07); },
    good() { [523, 659, 784].forEach((f, i) => tone(f, f * 1.01, 0.1, 'square', 0.035, i * 0.09)); },
    perfect() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f * 1.01, 0.11, 'square', 0.04, i * 0.08)); },
    bad() { tone(220, 110, 0.35, 'sawtooth', 0.04); },
    finish() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.13, 'square', 0.04, i * 0.1)); },
  };
  function setMuteUI() { $('bMute').classList.toggle('off', muted); $('bMute').setAttribute('aria-pressed', String(muted)); }
  $('bMute').onclick = () => { muted = !muted; LS.set('blanion.weigh.mute', muted); setMuteUI(); if (!muted) sfx.lock(); };
  setMuteUI();

  /* ------------------------------------------------------------- animation */
  function countUp(el, from, to, ms, fmt, done) {
    if (reduced) { el.textContent = fmt(to); if (done) done(); return; }
    const t0 = performance.now();
    (function step(now) {
      const f = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - f, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (f < 1) requestAnimationFrame(step); else if (done) done();
    })(t0);
  }
  const flash = el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };

  const cv = $('confetti'), cx = cv.getContext('2d'); let bits = [], confettiOn = false;
  function confetti(n, ox, oy) {
    if (reduced) return;
    cv.width = innerWidth; cv.height = innerHeight;
    const cols = ['#ffd54f', '#5be3a1', '#4fc3f7', '#ff9f43', '#e056fd', '#ffffff'];
    for (let i = 0; i < n; i++) bits.push({ x: ox == null ? innerWidth / 2 : ox, y: oy == null ? innerHeight * 0.35 : oy, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 11 - 3, r: 4 + Math.random() * 5, c: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, life: 1 });
    if (!confettiOn) { confettiOn = true; requestAnimationFrame(confettiStep); }
  }
  function confettiStep() {
    cx.clearRect(0, 0, cv.width, cv.height);
    bits = bits.filter(b => b.life > 0 && b.y < cv.height + 20);
    for (const b of bits) { b.vy += 0.38; b.x += b.vx; b.y += b.vy; b.vx *= 0.99; b.rot += b.vr; b.life -= 0.006; cx.save(); cx.globalAlpha = Math.max(0, Math.min(1, b.life * 2)); cx.translate(b.x, b.y); cx.rotate(b.rot); cx.fillStyle = b.c; cx.fillRect(-b.r / 2, -b.r / 2, b.r, b.r * 0.6); cx.restore(); }
    if (bits.length) requestAnimationFrame(confettiStep); else { confettiOn = false; cx.clearRect(0, 0, cv.width, cv.height); }
  }

  /* ---------------------------------------------------------------- slider */
  const LOG_MAX = 9;
  const parseGuess = str => Number(String(str).replace(/[,\s_]/g, '').replace(/^~/, ''));
  function syncFromSlider() { $('guess').value = Math.round(Math.pow(10, Number($('slider').value))).toLocaleString('en-IE'); sfx.tick(); }
  function syncFromInput() { const n = parseGuess($('guess').value); if (n > 0 && isFinite(n)) $('slider').value = String(Math.max(0, Math.min(LOG_MAX, Math.log10(n)))); }
  $('slider').addEventListener('input', syncFromSlider);
  $('guess').addEventListener('input', () => { syncFromInput(); $('hint').textContent = ''; });
  $('guess').addEventListener('blur', () => { const n = parseGuess($('guess').value); if (n > 0 && isFinite(n)) $('guess').value = fmtInt(n); });
  $('guess').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  document.querySelectorAll('.nudge button').forEach(b => b.addEventListener('click', () => {
    let n = parseGuess($('guess').value); if (!(n > 0)) n = Math.pow(10, Number($('slider').value));
    n = Math.max(1, Math.min(1e9, n * Number(b.dataset.f))); $('guess').value = fmtInt(n); syncFromInput(); sfx.tick();
  }));

  /* ------------------------------------------------------------------- HUD */
  function hudUpdate(bump) {
    const total = results.reduce((a, r) => a + r.points, 0);
    $('hMode').textContent = mode === 'daily' ? 'DAILY' : 'RANDOM';
    const el = $('hScore'), from = Number(el.dataset.v || 0); el.dataset.v = total;
    if (bump && total !== from) { countUp(el, from, total, 700, v => String(Math.round(v))); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } else el.textContent = total;
    const pips = $('pips').children;
    for (let i = 0; i < pips.length; i++) {
      const r = results[i];
      pips[i].className = r ? grade(r.points) + (r.points >= 90 ? ' perfect' : '') : i === round ? 'now' : '';
      if (r && !pips[i].dataset.done) { pips[i].dataset.done = 1; pips[i].classList.add('pop'); setTimeout(() => pips[i].classList.remove('pop'), 350); }
      if (!r) delete pips[i].dataset.done;
    }
  }
  const show = id => { ['intro', 'play', 'end'].forEach(x => $(x).classList.toggle('hidden', x !== id)); $('stageCard').classList.toggle('hidden', id === 'end'); if (id !== 'end') { const v = $(id); v.classList.remove('view'); void v.offsetWidth; v.classList.add('view'); } };

  /* ------------------------------------------------------------- captions */
  function captions(p, phase, g) {
    const big = W.BIG[p.big], small = W.SMALL[p.small];
    $('capLi').textContent = big.emoji; $('capLn').textContent = big.a; $('capRi').textContent = small.emoji; $('capRn').textContent = small.pl;
    $('eBig').textContent = big.emoji; $('eSmall').textContent = small.emoji;
    if (!phase) { $('capLv').textContent = '?'; $('capRv').textContent = ''; }
  }

  /* ------------------------------------------------------------------ flow */
  function start(m) {
    audio(); mode = m; key = m === 'daily' ? dateKey() : 'random-' + Math.random();
    pairs = W.pairsFor(key); round = 0; results = []; $('hScore').dataset.v = 0;
    askRound();
  }

  function askRound() {
    const p = pairs[round], big = W.BIG[p.big], small = W.SMALL[p.small];
    captions(p);
    $('roundTag').textContent = 'ROUND ' + (round + 1) + ' OF ' + W.ROUNDS;
    const q = $('qText'); q.textContent = 'How many ' + small.pl + ' does ' + big.a + ' weigh?'; q.style.animation = 'none'; void q.offsetWidth; q.style.animation = '';
    $('qDesc').textContent = '(' + big.desc + ' vs. ' + small.desc + ')';
    $('guess').value = ''; $('slider').value = '3'; $('hint').textContent = '';
    $('guessBox').classList.remove('hidden'); $('weighing').classList.add('hidden'); $('reveal').classList.add('hidden'); $('skip').classList.add('hidden');
    locked = false; show('play'); hudUpdate();
    if (stage) { stage.setRound(p.big, p.small); setTimeout(sfx.thud, 520); }
    setTimeout(() => $('guess').focus({ preventScroll: true }), 60);
  }

  const pinPos = n => Math.max(0, Math.min(1, Math.log10(Math.max(1, n)) / LOG_MAX)) * 100 + '%';

  function submit() {
    if (locked) return;
    const g = parseGuess($('guess').value);
    if (!(g > 0) || !isFinite(g)) { $('hint').textContent = 'Type a number first (or drag the slider).'; shakeBox(); return; }
    if (g > 1e12) { $('hint').textContent = 'That is a bit big. Try something under a trillion.'; shakeBox(); return; }
    locked = true; sfx.lock();
    const p = pairs[round], big = W.BIG[p.big], small = W.SMALL[p.small];
    const actual = W.truth(p), points = W.score(g, actual);
    results.push({ guess: g, truth: actual, points, pair: p.id });

    $('guessBox').classList.add('hidden');
    $('rErr').textContent = W.describeError(g, actual).toUpperCase() + ' · YOU SAID ' + fmtInt(g);
    $('rTrue').textContent = W.fmtCount(actual); $('rUnit').textContent = small.pl;
    $('rMasses').textContent = '≈ ' + W.fmtMass(big.kg) + ' ÷ ≈ ' + W.fmtMass(small.kg) + ' each';
    $('rFact').textContent = big.fact;
    $('next').textContent = round + 1 >= W.ROUNDS ? 'SEE RESULTS' : 'NEXT';

    const finishReveal = () => {
      $('weighing').classList.add('hidden'); $('skip').classList.add('hidden');
      $('rPoints').className = 'r-points' + (points >= 90 ? ' perfect' : '');
      $('reveal').classList.remove('hidden');
      countUp($('rPoints'), 0, points, 700, v => '+' + Math.round(v));
      $('pTruth').style.left = '0%'; $('pYou').style.left = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => { $('pTruth').style.left = pinPos(actual); $('pYou').style.left = pinPos(g); }));
      hudUpdate(true);
      if (points >= 90) { sfx.perfect(); confetti(90); } else if (points >= 70) { sfx.good(); confetti(26); } else if (points < 10) sfx.bad();
      setTimeout(() => $('next').focus({ preventScroll: true }), 80);
    };

    if (!stage) { $('capRv').textContent = '× ' + W.fmtCount(actual); $('capLv').textContent = '≈ ' + W.fmtMass(big.kg); return finishReveal(); }
    $('weighing').classList.remove('hidden'); $('skip').classList.remove('hidden');
    $('capLv').textContent = '?'; $('capRv').textContent = '';
    handle = stage.reveal({
      guess: g, truth: actual, points,
      onGuess() { flash($('capR')); countUp($('capRv'), 1, g, 900, v => 'YOUR GUESS ×' + fmtInt(v)); sfx.creak(); },
      onTruth() { flash($('capR')); flash($('capL')); $('capLv').textContent = '≈ ' + W.fmtMass(big.kg); countUp($('capRv'), g, actual, 900, v => 'ANSWER ×' + W.fmtCount(v)); sfx.thud(); },
      onDone: finishReveal,
    });
  }
  function shakeBox() { const b = $('guessBox'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); sfx.bad(); }

  function next() { round++; if (round >= W.ROUNDS) return finish(); askRound(); }

  function finish() {
    const total = results.reduce((a, r) => a + r.points, 0);
    const title = [...TITLES].reverse().find(t => total >= t[0])[1];
    show('end'); round = W.ROUNDS;
    $('endChip').textContent = mode === 'daily' ? 'TODAY’S FIVE' : 'RANDOM FIVE';
    $('endTitle').textContent = title.toUpperCase();
    countUp($('endScore'), 0, total, 1200, v => String(Math.round(v)));
    const ol = $('endList'); ol.textContent = '';
    results.forEach(r => {
      const [bk, sk] = r.pair.split('/'), big = W.BIG[bk], small = W.SMALL[sk];
      const li = document.createElement('li');
      li.style.setProperty('--tc', r.points >= 90 ? '#5be3a1' : r.points >= 70 ? '#4fc3f7' : r.points >= 40 ? '#ffd54f' : '#ff8a80');
      const n = document.createElement('span'); n.className = 'qn'; n.textContent = big.emoji;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = big.a.replace(/^(an?|the) /, '').replace(/^./, c => c.toUpperCase()) + ' in ' + small.pl;
      const sm = document.createElement('small'); sm.textContent = 'You: ' + fmtInt(r.guess) + ' · Answer: ' + W.fmtCount(r.truth); nm.appendChild(sm);
      const pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = '+' + r.points;
      li.append(n, nm, pt); ol.appendChild(li);
    });
    let msg = '';
    const bestAll = LS.get('blanion.weigh.best') || 0;
    if (total > bestAll) LS.set('blanion.weigh.best', total);
    if (mode === 'daily') { LS.set('blanion.weigh.' + key, { results, total }); msg = 'Come back tomorrow for five new ones. '; }
    msg += 'ALL-TIME BEST ' + Math.max(bestAll, total) + '/500' + (total > bestAll ? ' · NEW BEST!' : '');
    $('endBest').className = 'res-prov' + (total > bestAll ? ' final' : ''); $('endBest').textContent = msg;
    $('copyHint').textContent = '';
    hudUpdate();
    if (total >= 350) { sfx.finish(); confetti(120); } else sfx.finish();
  }

  $('copy').onclick = async () => {
    const total = results.reduce((a, r) => a + r.points, 0);
    const text = 'BLANION WEIGH-IN ' + (mode === 'daily' ? key : 'random') + ' — ' + total + '/500 ⚖️\n' + results.map(r => EMOJI(r.points)).join('') + '\n' + location.origin + '/weigh';
    try { await navigator.clipboard.writeText(text); $('copyHint').textContent = 'Copied! Paste it anywhere.'; } catch { $('copyHint').textContent = text; }
  };

  $('startDaily').onclick = () => start('daily');
  $('startRandom').onclick = () => start('random');
  $('again').onclick = () => start('random');
  $('submit').onclick = submit;
  $('next').onclick = next;
  $('stageCard').addEventListener('click', () => { if (stage && stage.busy) stage.skip(); });

  /* ------------------------------------------------------------------ init */
  async function init() {
    Mascot.mount($('logoMascot'), 3);
    try {
      const mod = await import('/weigh3d.js');
      stage = mod.createStage($('stage'), { reduced });
    } catch (e) {                                           // no WebGL / old browser: fall back to the emoji duel
      stage = null; $('stage').classList.add('hidden'); $('duel').classList.remove('hidden'); console.warn('3D stage unavailable:', e && e.message);
    }
    const saved = LS.get('blanion.weigh.' + dateKey());
    mode = 'daily'; results = []; round = 0;
    if (saved && saved.results && saved.results.length === W.ROUNDS) {
      key = dateKey(); pairs = W.pairsFor(key); results = saved.results; $('hScore').dataset.v = 0; hudUpdate(); finish();
    } else {
      const demo = { big: 'elephant', small: 'egg' };
      captions(demo); $('capLv').textContent = ''; $('capRv').textContent = '';
      if (stage) stage.setDemo('elephant', 'egg', 30);
      hudUpdate(); show('intro');
    }
    window.__weigh = { get stage() { return stage; }, get results() { return results; }, get round() { return round; } };
  }
  init();
})();
