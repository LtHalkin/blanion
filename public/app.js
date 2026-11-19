(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const TC = { plankton: '#9bb8d8', too_clever: '#4fc3f7', schooler: '#5be3a1', rare: '#ffd54f', deep_cut: '#ff9f43', one_in_blanion: '#e056fd' };
  const EMOJI = { plankton: '⬜', too_clever: '🟦', schooler: '🟩', rare: '🟨', deep_cut: '🟧', one_in_blanion: '🟪' };
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status });
    return j;
  }

  let cfg, me = LS.get('blanion.player'), play = null, skew = 0;
  let deadline = 0, timerRaf = 0, submitting = false, autoRaf = 0, revealIdx = -1;
  const pad3 = n => String(n).padStart(3, '0');
  const fmtTime = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(x => String(x).padStart(2, '0')).join(':'); };
  const serverNow = () => Date.now() + skew;

  /* ----------------------------------------------------------- views */
  const VIEWS = ['home', 'game', 'results', 'board'];
  function show(v) {
    VIEWS.forEach(x => $('v-' + x).classList.toggle('hidden', x !== v));
    window.scrollTo(0, 0);
  }
  const panel = name => ['qPanel', 'revealPanel', 'readyPanel'].forEach(p => $(p).classList.toggle('hidden', p !== name));
  const depthOf = p => (p ? p.score / p.maxScore : 0);

  /* ------------------------------------------------------------ home */
  function renderHome() {
    const t = cfg.today;
    $('dayChip').textContent = t.label + ' · ' + t.date;
    const st = $('homeStatus'), btn = $('diveBtn');
    $('nickWrap').classList.toggle('hidden', !!me && !!play);
    if (me && !$('nick').value) $('nick').value = me.nickname || '';
    btn.disabled = false;
    if (play && play.done) { btn.textContent = 'SEE RESULTS'; st.textContent = 'You finished today’s dive with ' + play.score + ' points.'; }
    else if (play) { btn.textContent = 'RESUME DIVE'; st.textContent = 'You are on question ' + (play.index + 1) + ' of ' + t.questionCount + '.'; }
    else if (t.status === 'open') { btn.textContent = 'DIVE'; st.textContent = t.divers ? t.divers + ' diver' + (t.divers === 1 ? ' has' : 's have') + ' gone down today.' : 'Be the first diver of the day.'; }
    else if (t.status === 'upcoming') { btn.textContent = 'COMING SOON'; btn.disabled = true; st.textContent = 'The first dive has not opened yet.'; }
    else { btn.textContent = 'VIEW LEADERBOARD'; st.textContent = 'Today’s dive is closed. The next one is being written.'; }
    Ocean.setDepth(play && play.done ? depthOf(play) : 0);
    tick();
  }
  function tick() {
    const t = cfg && cfg.today; if (!t) return;
    const left = (t.status === 'open' ? t.closesAt : t.nextDayAt) - serverNow();
    const txt = t.status === 'open' ? 'Today’s dive closes in ' + fmtTime(left) : t.hasNextDay ? 'Next dive in ' + fmtTime(left) : 'Next dive being prepared — check back soon';
    $('homeCountdown').textContent = txt;
    $('resCountdown').textContent = t.status === 'open' ? 'Final scores lock in ' + fmtTime(left) : txt;
  }
  setInterval(tick, 1000);

  async function diveClicked() {
    const t = cfg.today;
    if (!play && t.status !== 'open') return openBoard();
    const b = $('diveBtn'); b.disabled = true;
    try {
      const r = await api('/api/play/start', { playerId: me && me.playerId, nickname: $('nick').value });
      me = { playerId: r.playerId, nickname: r.nickname }; LS.set('blanion.player', me);
      setPlay(r.play); LS.set('blanion.play.' + r.play.day, r.play.id);
      route();
    } catch (e) { $('homeStatus').textContent = e.message; b.disabled = false; }
  }

  function setPlay(p) {
    play = p;
    $('hudScore').textContent = p.score;
    $('hudQ').textContent = Math.min(p.index + 1, p.total) + '/' + p.total;
    $('hudDepth').textContent = p.depth.metres + 'm';
  }

  /* ----------------------------------------------------------- game */
  function route() {
    if (play.done) return showResults();
    show('game'); Ocean.setDepth(depthOf(play));
    if (play.question) return showQuestion();
    showReady();
  }

  function showReady() {
    panel('readyPanel');
    const first = play.index === 0;
    $('readyTitle').textContent = 'Question ' + (play.index + 1) + ' of ' + play.total;
    $('readyText').textContent = first ? 'You have 25 seconds per question. The rarer your answer, the deeper you sink. The clock starts when you press the button.' : 'Welcome back. The clock for this question starts when you press the button.';
    $('goBtn').textContent = first ? 'START THE CLOCK' : 'NEXT QUESTION';
    $('goBtn').disabled = false;
    setTimeout(() => $('goBtn').focus(), 50);
  }

  async function begin() {
    $('goBtn').disabled = true; $('nextBtn').disabled = true;
    try {
      const r = await api('/api/play/begin', { playId: play.id });
      setPlay(r.play);
      if (r.play.done) return showResults();
      if (r.play.question) return showQuestion();
      showReady();
    } catch (e) {
      $('readyText').textContent = e.message; panel('readyPanel');
    } finally { $('goBtn').disabled = false; $('nextBtn').disabled = false; }
  }

  function showQuestion() {
    const q = play.question;
    panel('qPanel'); show('game');
    $('qText').textContent = q.text; $('qCat').textContent = q.category.toUpperCase();
    $('answer').value = ''; $('hint').textContent = ''; $('clarify').classList.add('hidden'); $('clarify').textContent = '';
    submitting = false; $('submitBtn').disabled = false;
    deadline = performance.now() + q.remainingMs;
    cancelAnimationFrame(timerRaf); timerLoop();
    setTimeout(() => $('answer').focus(), 40);
  }

  function timerLoop() {
    const left = deadline - performance.now();
    const frac = Math.max(0, left / cfg.limitMs);
    $('timerBar').style.transform = 'scaleX(' + frac + ')';
    const s = Math.ceil(Math.max(0, left) / 1000);
    $('secs').textContent = s;
    const low = left < 8000;
    $('timerBar').classList.toggle('low', low); $('secs').classList.toggle('low', low);
    if (left <= 0) return onExpire();
    timerRaf = requestAnimationFrame(timerLoop);
  }

  function onExpire() {
    if (submitting) return;
    if ($('answer').value.trim()) return submit();
    submitting = true; $('submitBtn').disabled = true; $('hint').textContent = 'Time’s up…';
    setTimeout(async () => {
      try {
        const s = await api('/api/play/state?playId=' + play.id);
        setPlay(s.play);
        const resp = s.play.responses[s.play.index - 1];
        if (resp) showReveal(resp);
      } catch (e) { $('hint').textContent = e.message; }
    }, 1800);
  }

  async function submit(textOverride) {
    if (submitting) return;
    const text = (textOverride != null ? textOverride : $('answer').value).trim();
    if (!text) { $('hint').textContent = 'Type an answer first.'; return; }
    submitting = true; $('submitBtn').disabled = true;
    try {
      const r = await api('/api/play/answer', { playId: play.id, answer: text });
      if (r.outcome === 'invalid') { $('hint').textContent = r.message; submitting = false; $('submitBtn').disabled = false; return; }
      if (r.outcome === 'ambiguous') {
        $('hint').textContent = r.message;
        const box = $('clarify'); box.textContent = ''; box.classList.remove('hidden');
        r.options.forEach(o => { const b = document.createElement('button'); b.type = 'button'; b.textContent = o; b.onclick = () => { $('answer').value = o; submit(o); }; box.appendChild(b); });
        submitting = false; $('submitBtn').disabled = false; return;
      }
      cancelAnimationFrame(timerRaf);
      setPlay(r.play); showReveal(r.response);
    } catch (e) {
      $('hint').textContent = e.message; submitting = false; $('submitBtn').disabled = false;
      if (e.status === 409 || e.status === 404) { try { const s = await api('/api/play/state?playId=' + play.id); setPlay(s.play); route(); } catch { /* ignore */ } }
    }
  }

  function showReveal(resp) {
    if (revealIdx === play.index && !$('revealPanel').classList.contains('hidden')) return;
    revealIdx = play.index;
    cancelAnimationFrame(timerRaf);
    panel('revealPanel');
    const tier = $('rvTier'), pts = $('rvPoints'), tc = resp.tier ? TC[resp.tier] : resp.status === 'pending' ? '#ffd9a0' : '#ff8a80';
    tier.parentElement.style.setProperty('--tc', tc);
    tier.className = 'reveal-tier' + (resp.tier === 'one_in_blanion' ? ' t-one_in_blanion' : '');
    $('appealBox').classList.add('hidden'); $('appealText').value = '';
    if (resp.status === 'correct') {
      tier.textContent = resp.tierName.toUpperCase();
      pts.textContent = '+' + resp.points;
      $('rvName').textContent = resp.canonical;
      const bits = [];
      if (resp.note) bits.push(resp.note);
      if (resp.share != null) bits.push(resp.share + '% of divers gave this answer.');
      else if (resp.provisional) bits.push('Provisional rarity — final scores lock when the day closes.');
      bits.push(resp.known + ' known answers — and more are waiting to be found.');
      $('rvNote').textContent = bits.join(' ');
    } else if (resp.status === 'pending') {
      tier.textContent = 'UNDER REVIEW'; pts.textContent = '?'; $('rvName').textContent = '“' + resp.raw + '”'; $('rvNote').textContent = resp.message;
    } else if (resp.status === 'timeout') {
      tier.textContent = 'TIME’S UP'; pts.textContent = '0'; $('rvName').textContent = ''; $('rvNote').textContent = resp.message;
    } else {
      tier.textContent = 'NOT ACCEPTED'; pts.textContent = '0'; $('rvName').textContent = resp.raw ? '“' + resp.raw + '”' : ''; $('rvNote').textContent = resp.message;
    }
    const canAppeal = (resp.status === 'pending' || resp.status === 'rejected') && resp.canAppeal;
    $('appealBtn').classList.toggle('hidden', !canAppeal);
    $('nextBtn').textContent = play.done ? 'SEE RESULTS' : 'NEXT';
    $('nextBtn').disabled = false;
    Ocean.setDepth(depthOf(play));
    if (resp.points) Ocean.burst(Math.round(resp.points / 8), resp.points >= 80);
    setTimeout(() => $('nextBtn').focus(), 50);
    runAuto(canAppeal ? 12000 : 6500);
  }

  function runAuto(ms) {
    cancelAnimationFrame(autoRaf);
    const t0 = performance.now(), bar = $('autoBar');
    (function step() {
      const f = (performance.now() - t0) / ms;
      bar.style.width = Math.min(100, f * 100) + '%';
      if (f >= 1) return next();
      autoRaf = requestAnimationFrame(step);
    })();
  }
  const stopAuto = () => { cancelAnimationFrame(autoRaf); $('autoBar').style.width = '0'; };

  function next() {
    stopAuto();
    if ($('revealPanel').classList.contains('hidden')) return;
    if (play.done) return showResults();
    panel('readyPanel'); $('readyTitle').textContent = 'Question ' + (play.index + 1) + ' of ' + play.total; $('readyText').textContent = 'Get ready…';
    begin();
  }

  /* --------------------------------------------------------- appeal */
  async function sendAppeal() {
    const note = $('appealText').value.trim();
    try {
      const idx = play.index - 1;
      const r = await api('/api/play/appeal', { playId: play.id, index: idx, note });
      setPlay(r.play);
      $('appealBox').classList.add('hidden'); $('appealBtn').classList.add('hidden');
      $('rvNote').textContent = 'Appeal sent. The Harbour Masters will check it — if it is approved your score updates automatically.';
      runAuto(6000);
    } catch (e) { $('rvNote').textContent = e.message; }
  }

  /* -------------------------------------------------------- results */
  function showResults() {
    cancelAnimationFrame(timerRaf); stopAuto();
    show('results');
    const p = play;
    Ocean.setDepth(depthOf(p));
    $('resDay').textContent = cfg.today.label;
    $('resZone').textContent = p.depth.zone.toUpperCase();
    $('resScore').textContent = p.score;
    $('resDepth').textContent = p.depth.metres + 'm deep';
    const prov = $('resProv');
    prov.className = 'res-prov' + (p.final ? ' final' : '');
    prov.textContent = p.final ? 'FINAL SCORE — rarity locked from real answer counts.' : 'PROVISIONAL — final scores lock when the day closes (midnight, Dublin time).';
    const ol = $('resList'); ol.textContent = '';
    p.responses.forEach(r => {
      const li = document.createElement('li');
      li.style.setProperty('--tc', r.tier ? TC[r.tier] : r.status === 'pending' ? '#ffd9a0' : '#7a8aa5');
      const n = document.createElement('span'); n.className = 'qn'; n.textContent = 'Q' + r.n;
      const nm = document.createElement('span'); nm.className = 'nm';
      nm.textContent = r.canonical || (r.raw ? '“' + r.raw + '”' : '—');
      const sm = document.createElement('small');
      sm.textContent = r.status === 'correct' ? r.tierName + (r.share != null ? ' · ' + r.share + '%' : '') : r.status === 'pending' ? 'Under review' : r.status === 'timeout' ? 'Too slow' : 'Not accepted';
      nm.appendChild(sm);
      const pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = r.points ? '+' + r.points : r.status === 'pending' ? '?' : '0';
      li.append(n, nm, pt); ol.appendChild(li);
    });
    $('resRank').textContent = '';
    api('/api/leaderboard?playId=' + p.id).then(b => { if (b.me) $('resRank').textContent = 'Rank #' + b.me.rank + ' of ' + b.count + (b.provisional ? ' (provisional)' : ''); }).catch(() => {});
    $('shareHint').textContent = '';
    tick();
  }

  function shareText() {
    const p = play;
    const grid = p.responses.map(r => r.tier ? EMOJI[r.tier] : r.status === 'pending' ? '⏳' : '⬛').join('');
    return 'BLANION ' + cfg.today.label + ' — ' + p.score + '/700 🫧\n' + p.depth.metres + 'm deep · ' + p.depth.zone + '\n' + grid + '\n' + location.origin;
  }
  async function share() {
    const text = shareText();
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text); $('shareHint').textContent = 'Copied! Paste it anywhere.';
    } catch { $('shareHint').textContent = 'Could not copy automatically — select and copy:\n' + text; }
  }

  /* ---------------------------------------------------------- board */
  async function openBoard() {
    show('board');
    const list = $('boardList'); list.textContent = '';
    try {
      const b = await api('/api/leaderboard?day=' + cfg.today.day + (play ? '&playId=' + play.id : ''));
      $('boardProv').textContent = (b.final ? 'FINAL' : 'PROVISIONAL') + ' · DAY ' + pad3(b.day) + ' · ' + b.count + ' DIVER' + (b.count === 1 ? '' : 'S');
      $('boardProv').className = 'res-prov' + (b.final ? ' final' : '');
      if (!b.rows.length) { const li = document.createElement('li'); li.textContent = 'No finished dives yet. Be the first!'; list.appendChild(li); }
      b.rows.forEach(r => {
        const li = document.createElement('li'); if (r.me) li.className = 'me';
        const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = '#' + r.rank;
        const nm = document.createElement('span'); nm.textContent = r.nickname; const z = document.createElement('small'); z.textContent = r.zone; nm.appendChild(z);
        const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = r.score;
        li.append(rk, nm, sc); list.appendChild(li);
      });
    } catch (e) { const li = document.createElement('li'); li.textContent = e.message; list.appendChild(li); }
    Ocean.setDepth(play ? depthOf(play) : 0.15);
  }

  /* ------------------------------------------------------------ how */
  function fillHow() {
    const tb = $('tierTable'); tb.textContent = '';
    cfg.tiers.forEach(t => {
      const tr = document.createElement('tr'); tr.style.setProperty('--tc', TC[t.id]);
      const a = document.createElement('td'); a.textContent = t.name.toUpperCase();
      const b = document.createElement('td'); b.textContent = t.minShare ? 'given by ≥ ' + Math.round(t.minShare * 100) + '% of divers' : 'rarest answers';
      b.style.fontFamily = 'inherit'; b.style.textAlign = 'left'; b.style.fontSize = '19px'; b.style.color = 'var(--mute)';
      const c = document.createElement('td'); c.textContent = t.points;
      tr.append(a, b, c); tb.appendChild(tr);
    });
    $('coverageText').textContent = 'Core: ' + cfg.coverage.core.join(', ') + '.' + (cfg.coverage.extended.length ? ' Also counted (nearby Dublin 15 townlands): ' + cfg.coverage.extended.join(', ') + '.' : '');
  }

  /* ----------------------------------------------------------- init */
  async function init() {
    Mascot.mount($('logoMascot'), 3);
    try {
      cfg = await api('/api/config');
    } catch (e) { $('homeStatus').textContent = 'Could not reach the deep: ' + e.message; return; }
    skew = cfg.today.now - Date.now();
    fillHow();
    const pid = LS.get('blanion.play.' + cfg.today.day);
    if (pid) { try { play = (await api('/api/play/state?playId=' + pid)).play; setPlay(play); } catch { play = null; } }
    renderHome(); show('home');
  }

  $('diveBtn').onclick = () => { if (play && !play.done) return diveClicked(); if (play && play.done) return showResults(); diveClicked(); };
  $('goBtn').onclick = begin;
  $('nextBtn').onclick = next;
  $('answerForm').onsubmit = e => { e.preventDefault(); submit(); };
  $('appealBtn').onclick = () => { stopAuto(); $('appealBox').classList.remove('hidden'); $('appealBtn').classList.add('hidden'); $('appealText').focus(); };
  $('appealCancel').onclick = () => { $('appealBox').classList.add('hidden'); $('appealBtn').classList.remove('hidden'); runAuto(8000); };
  $('appealSend').onclick = sendAppeal;
  $('shareBtn').onclick = share;
  $('resBoardBtn').onclick = openBoard;
  $('boardBtn').onclick = $('navBoard').onclick = openBoard;
  $('boardBack').onclick = () => { if (play && play.done) showResults(); else if (play) route(); else { renderHome(); show('home'); } };
  $('logoBtn').onclick = () => { if (play && !play.done && !$('v-game').classList.contains('hidden')) return; renderHome(); show('home'); };
  const how = $('how');
  $('howBtn').onclick = $('navHow').onclick = () => how.showModal();
  $('howClose').onclick = () => how.close();
  how.addEventListener('click', e => { if (e.target === how) how.close(); });

  init();
})();
