/* BLANION WEIGH-IN — guess how many small things weigh the same as a big thing. Data + scoring: weigh-data.js */
(function () {
  'use strict';
  const W = WeighData;
  const $ = id => document.getElementById(id);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const EMOJI = s => s >= 90 ? '🎯' : s >= 70 ? '🟩' : s >= 40 ? '🟨' : s >= 10 ? '🟧' : '🟥';
  const TITLES = [[0, 'Off the Scale'], [150, 'In the Right Zip Code'], [250, 'Good Ballpark'], [350, 'Sharp Eye'], [450, 'Human Scales']];

  let mode, key, pairs, round, results, locked;   // results: [{guess, truth, points}]

  /* ---------------------------------------------------------------- slider */
  const LOG_MAX = 9;                                          // slider covers 1 .. 1,000,000,000
  const sliderToValue = v => Math.round(Math.pow(10, v));
  const parseGuess = str => { const n = Number(String(str).replace(/[,\s_]/g, '').replace(/^~/, '')); return n; };
  function syncFromSlider() {
    const v = sliderToValue(Number($('slider').value));
    $('guess').value = v.toLocaleString('en-IE');
  }
  function syncFromInput() {
    const n = parseGuess($('guess').value);
    if (n > 0 && isFinite(n)) $('slider').value = String(Math.max(0, Math.min(LOG_MAX, Math.log10(n))));
  }
  $('slider').addEventListener('input', syncFromSlider);
  $('guess').addEventListener('input', () => { syncFromInput(); $('hint').textContent = ''; });
  $('guess').addEventListener('blur', () => { const n = parseGuess($('guess').value); if (n > 0 && isFinite(n)) $('guess').value = Math.round(n).toLocaleString('en-IE'); });
  $('guess').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  /* ---------------------------------------------------------------- flow */
  function hudUpdate() {
    $('hRound').textContent = Math.min(round + 1, W.ROUNDS) + '/' + W.ROUNDS;
    $('hScore').textContent = results.reduce((a, r) => a + r.points, 0);
    $('hMode').textContent = mode === 'daily' ? 'DAILY' : 'RANDOM';
  }
  const show = id => ['intro', 'play', 'end'].forEach(x => $(x).classList.toggle('hidden', x !== id));

  function start(m) {
    mode = m;
    key = m === 'daily' ? dateKey() : 'random-' + Math.random();
    pairs = W.pairsFor(key);
    round = 0; results = [];
    askRound();
  }

  function askRound() {
    const p = pairs[round], big = W.BIG[p.big], small = W.SMALL[p.small];
    $('eBig').textContent = big.emoji; $('eSmall').textContent = small.emoji;
    $('qText').textContent = 'How many ' + small.pl + ' does ' + big.a + ' weigh?';
    $('qDesc').textContent = '(' + big.desc + ' vs. ' + small.desc + ')';
    $('guess').value = ''; $('slider').value = '3'; $('hint').textContent = '';
    $('guessBox').classList.remove('hidden'); $('reveal').classList.add('hidden');
    locked = false; show('play'); hudUpdate();
    setTimeout(() => $('guess').focus(), 40);
  }

  function pinPos(n) { return Math.max(0, Math.min(1, Math.log10(Math.max(1, n)) / LOG_MAX)) * 100 + '%'; }

  function submit() {
    if (locked) return;
    const g = parseGuess($('guess').value);
    if (!(g > 0) || !isFinite(g)) { $('hint').textContent = 'Type a number first (or drag the slider).'; return; }
    if (g > 1e12) { $('hint').textContent = 'That is a bit big. Try something under a trillion.'; return; }
    locked = true;
    const p = pairs[round], big = W.BIG[p.big], small = W.SMALL[p.small];
    const actual = W.truth(p), points = W.score(g, actual);
    results.push({ guess: g, truth: actual, points, pair: p.id });

    $('rPoints').textContent = '+' + points;
    $('rErr').textContent = W.describeError(g, actual).toUpperCase() + ' · YOU SAID ' + Math.round(g).toLocaleString('en-IE');
    $('rTrue').textContent = W.fmtCount(actual); $('rUnit').textContent = small.pl;
    $('pTruth').style.left = pinPos(actual); $('pYou').style.left = pinPos(g);
    $('rMasses').textContent = '≈ ' + W.fmtMass(big.kg) + ' ÷ ≈ ' + W.fmtMass(small.kg) + ' each';
    $('rFact').textContent = big.fact;
    $('next').textContent = round + 1 >= W.ROUNDS ? 'SEE RESULTS' : 'NEXT';
    $('guessBox').classList.add('hidden'); $('reveal').classList.remove('hidden');
    hudUpdate();
    setTimeout(() => $('next').focus(), 40);
  }

  function next() {
    round++;
    if (round >= W.ROUNDS) return finish();
    askRound();
  }

  function finish() {
    const total = results.reduce((a, r) => a + r.points, 0);
    const title = [...TITLES].reverse().find(t => total >= t[0])[1];
    show('end');
    $('endChip').textContent = mode === 'daily' ? 'TODAY’S FIVE' : 'RANDOM FIVE';
    $('endTitle').textContent = title.toUpperCase(); $('endScore').textContent = total;
    const ol = $('endList'); ol.textContent = '';
    results.forEach((r, i) => {
      const [bk, sk] = r.pair.split('/'), big = W.BIG[bk], small = W.SMALL[sk];
      const li = document.createElement('li');
      li.style.setProperty('--tc', r.points >= 90 ? '#5be3a1' : r.points >= 70 ? '#4fc3f7' : r.points >= 40 ? '#ffd54f' : '#ff8a80');
      const n = document.createElement('span'); n.className = 'qn'; n.textContent = big.emoji;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = big.a.replace(/^(an?|the) /, '').replace(/^./, c => c.toUpperCase()) + ' in ' + small.pl;
      const sm = document.createElement('small'); sm.textContent = 'You: ' + Math.round(r.guess).toLocaleString('en-IE') + ' · Answer: ' + W.fmtCount(r.truth); nm.appendChild(sm);
      const pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = '+' + r.points;
      li.append(n, nm, pt); ol.appendChild(li);
    });
    // persistence
    let msg = '';
    const bestAll = LS.get('blanion.weigh.best') || 0;
    if (total > bestAll) LS.set('blanion.weigh.best', total);
    if (mode === 'daily') { LS.set('blanion.weigh.' + key, { results, total }); msg = 'Come back tomorrow for five new ones. '; }
    msg += 'ALL-TIME BEST ' + Math.max(bestAll, total) + '/500' + (total > bestAll ? ' · NEW BEST!' : '');
    $('endBest').className = 'res-prov' + (total > bestAll ? ' final' : ''); $('endBest').textContent = msg;
    $('copyHint').textContent = '';
    hudUpdate();
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

  /* ----------------------------------------------------------------- init */
  Mascot.mount($('logoMascot'), 3);
  // already played today? show that result straight away (they can still play random fives)
  const saved = LS.get('blanion.weigh.' + dateKey());
  if (saved && saved.results && saved.results.length === W.ROUNDS) {
    mode = 'daily'; key = dateKey(); pairs = W.pairsFor(key); results = saved.results; round = W.ROUNDS;
    finish();
  } else { mode = 'daily'; results = []; round = 0; hudUpdate(); show('intro'); }
})();
