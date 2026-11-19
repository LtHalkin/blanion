/* BLANION ENDLESS DIVE — unlimited run for the main game. Same answers, same rarity scoring, no daily cap. Stateless server (/api/endless/*). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const TC = { plankton: '#9bb8d8', too_clever: '#4fc3f7', schooler: '#5be3a1', rare: '#ffd54f', deep_cut: '#ff9f43', one_in_blanion: '#e056fd' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ZONES = [[0, 'Sunlit Shallows'], [100, 'Kelp Forest'], [250, 'Twilight Zone'], [430, 'Midnight Trench'], [600, 'The Abyss'], [900, 'Beyond the Charts']];
  const metres = s => Math.round((s / 700) * 1000);
  const depth01 = s => Math.min(1, s / 900);
  const limitFor = n => Math.max(12000, 25000 - 3000 * Math.floor(n / 8));   // the clock shrinks every 8 answers, down to 12 s

  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status });
    return j;
  }

  let info = null, run = null, deadline = 0, timerRaf = 0, autoRaf = 0, submitting = false, lastQ = 0, current = null;
  const App = () => window.BlanionApp;

  function setHearts(flash) {
    const max = info.maxLives, n = run ? run.lives : info.startLives;
    const el = $('eLives'); el.textContent = '♥'.repeat(n) + '♡'.repeat(Math.max(0, max - n));
    if (flash) { el.classList.remove('lost'); void el.offsetWidth; el.classList.add('lost'); }
  }
  function hud() {
    $('eScore').textContent = run ? run.score : 0; $('eDepth').textContent = (run ? metres(run.score) : 0) + 'm'; $('eStreak').textContent = run ? run.streak : 0;
    setHearts(false); if (window.Ocean) Ocean.setDepth(depth01(run ? run.score : 0));
  }
  const panel = name => ['eReady', 'ePanel', 'eReveal'].forEach(p => $(p).classList.toggle('hidden', p !== name));

  /* ------------------------------------------------------------- entry/exit */
  async function open() {
    try { if (!info) info = await api('/api/endless/info'); } catch (e) { alert('Endless mode needs a connection: ' + e.message); return; }
    run = null; hud(); panel('eReady'); App().show('endless');
    const best = LS.get('blanion.endless.best');
    $('eBest').textContent = best ? 'YOUR BEST RUN: ' + best.score + ' points (' + best.answers + ' answers)' : 'No runs yet. Be bold.';
    setTimeout(() => $('eStart').focus({ preventScroll: true }), 50);
  }
  function exit() { stopTimers(); App().renderHome(); App().show('home'); }
  const stopTimers = () => { cancelAnimationFrame(timerRaf); cancelAnimationFrame(autoRaf); };

  function begin() {
    run = { lives: info.startLives, score: 0, streak: 0, best: 0, answered: 0, found: {}, results: [] };
    lastQ = 0; hud(); nextQuestion();
  }

  /* --------------------------------------------------------------- questions */
  function nextQuestion() {
    let q; do { q = 1 + Math.floor(Math.random() * 7); } while (q === lastQ); lastQ = q;
    const meta = info.questions[q - 1];
    current = { q, limit: limitFor(run.answered), meta };
    $('eText').textContent = meta.text; $('eCat').textContent = meta.category.toUpperCase();
    $('eAnswer').value = ''; $('eHint').textContent = ''; $('eClarify').classList.add('hidden'); $('eClarify').textContent = '';
    submitting = false; $('eSubmit').disabled = false; panel('ePanel'); App().show('endless');
    const t = $('eText'); t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    deadline = performance.now() + current.limit; cancelAnimationFrame(timerRaf); timerLoop();
    setTimeout(() => $('eAnswer').focus({ preventScroll: true }), 40);
  }

  function timerLoop() {
    const left = deadline - performance.now(), frac = Math.max(0, left / current.limit);
    $('eTimerBar').style.transform = 'scaleX(' + frac + ')';
    $('eSecs').textContent = Math.ceil(Math.max(0, left) / 1000);
    const low = left < 8000; $('eTimerBar').classList.toggle('low', low); $('eSecs').classList.toggle('low', low);
    if (left <= 0) return onExpire();
    timerRaf = requestAnimationFrame(timerLoop);
  }
  function onExpire() {
    if (submitting) return;
    const text = $('eAnswer').value.trim();
    if (text) return submit(); lose({ status: 'timeout' });
  }

  async function submit(override) {
    if (submitting) return;
    const text = (override != null ? override : $('eAnswer').value).trim();
    if (!text) { $('eHint').textContent = 'Type an answer first.'; return; }
    submitting = true; $('eSubmit').disabled = true;
    let r;
    try { r = await api('/api/endless/answer', { q: current.q, answer: text }); }
    catch (e) { $('eHint').textContent = e.message; submitting = false; $('eSubmit').disabled = false; return; }
    const timedOut = performance.now() > deadline + 1500;
    if (r.outcome === 'invalid') { $('eHint').textContent = r.message; submitting = false; $('eSubmit').disabled = false; return; }
    if (r.outcome === 'ambiguous') {
      $('eHint').textContent = r.message; const box = $('eClarify'); box.textContent = ''; box.classList.remove('hidden');
      r.options.forEach(o => { const b = document.createElement('button'); b.type = 'button'; b.textContent = o; b.onclick = () => { $('eAnswer').value = o; submit(o); }; box.appendChild(b); });
      submitting = false; $('eSubmit').disabled = false; return;
    }
    if (timedOut) return lose({ status: 'timeout' });
    if (r.outcome === 'correct') {
      const used = (run.found[current.q] ||= new Set());
      if (used.has(r.id)) { $('eHint').textContent = 'You already used "' + r.canonical + '" this run — find a different one!'; submitting = false; $('eSubmit').disabled = false; $('eAnswer').select(); return; }
      used.add(r.id); return win(r);
    }
    lose({ status: r.outcome === 'unknown' ? 'unknown' : 'wrong', raw: text, message: r.message });
  }

  /* ------------------------------------------------------------------ results */
  function win(r) {
    cancelAnimationFrame(timerRaf);
    run.score += r.points; run.streak++; run.best = Math.max(run.best, run.streak); run.answered++;
    run.results.push({ q: current.q, canonical: r.canonical, tier: r.tier, tierName: r.tierName, points: r.points });
    let bonus = '';
    if (run.streak % 5 === 0 && run.lives < info.maxLives) { run.lives++; bonus = ' ♥ +1 LIFE for a 5-streak!'; }
    reveal({ color: TC[r.tier], tier: r.tierName.toUpperCase(), points: '+' + r.points, name: r.canonical, note: [r.note, bonus.trim()].filter(Boolean).join(' '), auto: 3000 });
    hud(); if (bonus) setHearts(false);
  }
  function lose(o) {
    cancelAnimationFrame(timerRaf); submitting = true;
    run.lives--; run.streak = 0; run.answered++; hud(); setHearts(true);
    const dead = run.lives <= 0;
    const base = { color: '#ff8a80', points: '✘', auto: 0, dead };
    if (o.status === 'timeout') reveal({ ...base, tier: 'TIME’S UP', name: '', note: 'The current carried your answer away.' });
    else if (o.status === 'unknown') reveal({ ...base, tier: 'NOT IN OUR LOG', name: '“' + o.raw + '”', note: 'It costs a life, but if it is a real local answer you can suggest it for review.', suggest: o.raw });
    else reveal({ ...base, tier: 'NOT ACCEPTED', name: '“' + (o.raw || '') + '”', note: o.message || '' });
  }

  function reveal(o) {
    panel('eReveal'); const tier = $('eTier');
    tier.parentElement.style.setProperty('--tc', o.color); tier.textContent = o.tier; tier.className = 'reveal-tier' + (o.tier === 'ONE IN A BLANION' ? ' t-one_in_blanion' : '');
    $('ePoints').textContent = o.points; $('eName').textContent = o.name; $('eNote').textContent = o.note || '';
    $('eNext').textContent = o.dead ? 'SEE RESULTS' : 'NEXT'; $('eNext').dataset.dead = o.dead ? '1' : '';
    const sg = $('eSuggest'); sg.classList.toggle('hidden', !o.suggest); sg.dataset.raw = o.suggest || ''; sg.disabled = false;
    if (o.suggest) sg.textContent = 'I THINK THAT’S RIGHT — SUGGEST IT';
    cancelAnimationFrame(autoRaf); $('eAutoBar').style.width = '0';
    if (o.auto) runAuto(o.auto, o.dead);
    if (!reduced && window.Ocean && o.color !== '#ff8a80') Ocean.burst(Math.round(parseInt(o.points.slice(1), 10) / 8) || 2, parseInt(o.points.slice(1), 10) >= 80);
    setTimeout(() => $('eNext').focus({ preventScroll: true }), 60);
  }
  function runAuto(ms, dead) {
    const t0 = performance.now(), bar = $('eAutoBar');
    (function step() { const f = (performance.now() - t0) / ms; bar.style.width = Math.min(100, f * 100) + '%'; if (f >= 1) return advance(); autoRaf = requestAnimationFrame(step); })();
  }
  function advance() {
    cancelAnimationFrame(autoRaf); $('eAutoBar').style.width = '0';
    if ($('eReveal').classList.contains('hidden')) return;
    if (run.lives <= 0) return gameOver(); nextQuestion();
  }

  async function suggest() {
    const b = $('eSuggest'); b.disabled = true; const pl = LS.get('blanion.player');
    try { const r = await api('/api/endless/suggest', { q: current.q, answer: b.dataset.raw, playerId: pl && pl.playerId }); b.textContent = r.message || 'Sent for review. Thanks!'; }
    catch (e) { b.textContent = e.message; }
  }

  function gameOver() {
    stopTimers(); const s = run.score, depth = metres(s), zone = [...ZONES].reverse().find(z => s >= z[0])[1];
    $('eZone').textContent = zone.toUpperCase(); $('eEndScore').textContent = s; $('eEndDepth').textContent = depth + 'm deep · ' + run.results.length + ' correct · best streak ' + run.best;
    const prev = LS.get('blanion.endless.best'), isBest = !prev || s > prev.score;
    if (isBest && s > 0) LS.set('blanion.endless.best', { score: s, answers: run.results.length, depth });
    $('eEndBest').className = 'res-prov' + (isBest && s > 0 ? ' final' : ''); $('eEndBest').textContent = (isBest && s > 0 ? 'NEW PERSONAL BEST! ' : '') + 'BEST RUN: ' + Math.max(s, prev ? prev.score : 0) + ' POINTS';
    const tiers = $('eTiers'); tiers.textContent = '';
    for (const t of ['one_in_blanion', 'deep_cut', 'rare', 'schooler', 'too_clever', 'plankton']) {
      const n = run.results.filter(r => r.tier === t).length; if (!n) continue;
      const sp = document.createElement('span'); sp.style.setProperty('--tc', TC[t]); const b = document.createElement('b'); b.textContent = n + '× '; sp.append(b, document.createTextNode(info.tiers.find(x => x.id === t).name.toUpperCase())); tiers.appendChild(sp);
    }
    const ol = $('eFound'); ol.textContent = '';
    [...run.results].sort((a, b) => b.points - a.points).slice(0, 12).forEach(r => {
      const li = document.createElement('li'); li.style.setProperty('--tc', TC[r.tier]);
      const n = document.createElement('span'); n.className = 'qn'; n.textContent = 'Q' + r.q;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.canonical; const sm = document.createElement('small'); sm.textContent = r.tierName; nm.appendChild(sm);
      const pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = '+' + r.points; li.append(n, nm, pt); ol.appendChild(li);
    });
    if (!run.results.length) { const li = document.createElement('li'); li.textContent = 'No correct answers this time — have another go!'; ol.appendChild(li); }
    $('eShareHint').textContent = ''; App().show('eend'); if (window.Ocean) Ocean.setDepth(depth01(s), false);
  }

  $('eShare').onclick = async () => {
    const text = 'BLANION ENDLESS DIVE — ' + run.score + ' pts · ' + run.results.length + ' answers · ' + metres(run.score) + 'm deep 🫧\nBest streak ' + run.best + '\n' + location.origin;
    try { await navigator.clipboard.writeText(text); $('eShareHint').textContent = 'Copied! Paste it anywhere.'; } catch { $('eShareHint').textContent = text; }
  };

  /* -------------------------------------------------------------------- wiring */
  $('eStart').onclick = begin; $('eAgain').onclick = () => { if (window.Ocean) Ocean.setDepth(0); begin(); };
  $('eForm').onsubmit = e => { e.preventDefault(); submit(); };
  $('eNext').onclick = advance; $('eSuggest').onclick = suggest;
  $('eExit0').onclick = exit; $('eExit1').onclick = exit;
  $('endlessBtn').onclick = open; $('resEndlessBtn').onclick = open;
  window.Endless = { open, exit, get run() { return run; }, get current() { return current; } };
})();
