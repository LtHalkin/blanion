(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = null; try { token = sessionStorage.getItem('blanion.admin'); } catch {}
  let overview = null;

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token) { logout(); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Error'), { data: j });
    return j;
  }
  function toast(msg, bad) { const t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 4500); }
  const when = ms => new Date(ms).toLocaleString('en-IE', { dateStyle: 'short', timeStyle: 'medium' });
  const field = (label, input) => h('div', {}, h('label', {}, label), input);

  /* ------------------------------------------------------------ auth */
  $('loginForm').onsubmit = async e => {
    e.preventDefault(); $('loginErr').textContent = '';
    try { const r = await api('/api/admin/login', { password: $('pw').value }); token = r.token; try { sessionStorage.setItem('blanion.admin', token); } catch {} boot(); }
    catch (err) { $('loginErr').textContent = err.message; }
  };
  function logout() { token = null; try { sessionStorage.removeItem('blanion.admin'); } catch {} $('shell').classList.add('hidden'); $('login').classList.remove('hidden'); }
  $('logout').onclick = logout;

  const TABS = ['review', 'flagged', 'answers', 'stats', 'audit'];
  const loaders = { review: renderReview, flagged: renderFlagged, answers: renderAnswers, stats: renderStats, audit: renderAudit };
  let tab = 'review';
  function setTab(t) {
    tab = t;
    TABS.forEach(x => { $('t-' + x).classList.toggle('hidden', x !== t); });
    document.querySelectorAll('#tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    loaders[t]();
  }
  document.querySelectorAll('#tabs button[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));

  async function boot() {
    if (!token) return;
    try { overview = await api('/api/admin/overview'); } catch { return; }
    $('login').classList.add('hidden'); $('shell').classList.remove('hidden');
    $('bReview').textContent = overview.counts.pending; $('bFlag').textContent = overview.counts.flaggedAnswers;
    setTab(tab);
  }
  async function refreshBadges() { overview = await api('/api/admin/overview'); $('bReview').textContent = overview.counts.pending; $('bFlag').textContent = overview.counts.flaggedAnswers; }

  const areas = () => [...overview.coverage.core, ...(overview.includeExtended ? overview.coverage.extended : [])];

  /* ---------------------------------------------------- ANSWER REVIEW */
  async function renderReview() {
    const root = $('t-review'); root.textContent = '';
    const sel = h('select', { id: 'rvFilter' }, ...[['pending', 'Pending'], ['research', 'Flagged for research'], ['decided', 'Decided'], ['all', 'All']].map(([v, l]) => h('option', { value: v }, l)));
    sel.value = renderReview.filter || 'pending';
    sel.onchange = () => { renderReview.filter = sel.value; renderReview(); };
    root.append(h('h2', {}, 'ANSWER REVIEW'), h('div', { class: 'toolbar' }, sel, h('span', { class: 'meta' }, 'Nothing is auto-accepted. Approving needs a source and an in-boundary area; every decision is written to the audit log and rescores players automatically.')));
    const { groups } = await api('/api/admin/review?status=' + sel.value);
    if (!groups.length) root.append(h('p', { class: 'meta' }, 'Nothing here. The harbour is quiet.'));
    for (const g of groups) root.append(await reviewCard(g));
  }

  async function reviewCard(g) {
    const open = g.status === 'pending' || g.status === 'research';
    const card = h('div', { class: 'card ' + g.status });
    const first = g.raws[0].raw;
    card.append(h('div', { class: 'top' },
      h('div', { class: 'raw' }, g.raws.map(r => r.raw + (r.n > 1 ? ' ×' + r.n : '')).join('  /  '), ' ', h('small', {}, 'Q' + g.q)),
      h('div', {}, h('span', { class: 'tag ' + g.status }, g.status.toUpperCase()), g.auto ? h('span', { class: 'tag' }, 'AUTO-RULE') : null)));
    card.append(h('div', { class: 'meta' }, g.qText, ' · ', g.players + ' player' + (g.players === 1 ? '' : 's'), ' · first ', when(g.firstAt), ' · last ', when(g.lastAt)));
    if (g.reason) card.append(h('div', { class: 'meta' }, 'Reason: ', g.reason));
    if (g.resolved) card.append(h('div', { class: 'meta' }, 'Resolved to: ', g.resolved));
    if (g.suggestion) card.append(h('div', { class: 'sug' }, 'Suggested canonical: ', h('b', {}, g.suggestion.canonical), ' (' + g.suggestion.confidence + '% similar — possible duplicate / alternative spelling)'));
    if (g.proposedSource) card.append(h('div', { class: 'meta' }, 'Proposed source: ', h('a', { href: g.proposedSource, target: '_blank', rel: 'noopener noreferrer' }, g.proposedSource)));
    g.appeals.forEach(a => card.append(h('div', { class: 'appeal' }, 'PLAYER APPEAL (' + when(a.at) + '): ' + a.note)));
    if (!open) return card;

    const all = (await api('/api/admin/answers?q=' + g.q)).answers.filter(a => a.active);
    const canonical = h('input', { value: g.suggestion && g.suggestion.confidence >= 80 ? '' : first.replace(/\b\w/g, c => c.toUpperCase()) });
    const aliases = h('input', { placeholder: 'comma separated: alt spellings, abbreviations' });
    const area = h('select', {}, h('option', { value: '' }, '— choose area —'), ...areas().map(a => h('option', {}, a)));
    const loc = h('input', { placeholder: 'verified address / description (optional)' });
    const lat = h('input', { placeholder: 'lat (optional)' }), lng = h('input', { placeholder: 'lng (optional)' });
    const src = h('input', { placeholder: 'https://… (required to approve)', value: g.proposedSource || '' });
    const note = h('input', { placeholder: 'internal note (optional)' });
    const reason = h('input', { placeholder: 'reason (required to reject)' });
    const merge = h('select', {}, h('option', { value: '' }, '— merge into existing —'), ...all.map(a => h('option', { value: a.id, ...(g.suggestion && g.suggestion.answerId === a.id ? { selected: true } : {}) }, a.canonical)));
    const decide = async (action, extra) => {
      try {
        const r = await api('/api/admin/review/decide', { key: g.key, action, note: note.value, ...extra });
        toast('Done — ' + action + '. ' + r.affected + ' player(s) rescored.'); await refreshBadges(); renderReview();
      } catch (e) { toast(e.message, true); }
    };
    card.append(
      h('div', { class: 'grid' }, field('CANONICAL ANSWER', canonical), field('ALIASES / ABBREVIATIONS', aliases), field('AREA (must be inside boundary)', area), field('LOCATION / ADDRESS', loc), field('LATITUDE', lat), field('LONGITUDE', lng), field('SOURCE URL', src), field('MERGE TARGET', merge), field('REJECT REASON', reason), field('NOTE', note)),
      h('div', { class: 'act' },
        h('button', { class: 'btn ok', onclick: () => decide('approve', { canonical: canonical.value, aliases: aliases.value, area: area.value, location: loc.value, lat: lat.value, lng: lng.value, source: src.value }) }, 'APPROVE (NEW ANSWER)'),
        h('button', { class: 'btn alt', onclick: () => merge.value ? decide('merge', { mergeInto: merge.value, aliases: aliases.value, source: src.value }) : toast('Pick an answer to merge into.', true) }, 'MERGE'),
        h('button', { class: 'btn no', onclick: () => decide('reject', { reason: reason.value }) }, 'REJECT'),
        h('button', { class: 'btn meh', onclick: () => decide('research', {}) }, 'FLAG FOR RESEARCH')));
    return card;
  }

  /* ------------------------------------------------------------ FLAGGED */
  async function renderFlagged() {
    const root = $('t-flagged'); root.textContent = '';
    root.append(h('h2', {}, 'FLAGGED CURATED ANSWERS'), h('p', { class: 'meta' }, 'These came from the editor-supplied list but their identity or location needs checking against the boundary. They are accepted until you suspend them. Confirming needs a source URL.'));
    const { answers } = await api('/api/admin/answers?flagged=1');
    if (!answers.length) root.append(h('p', { class: 'meta' }, 'No flagged answers.'));
    for (const a of answers) root.append(answerCard(a, true));
  }

  function answerCard(a, flagged) {
    const src = h('input', { placeholder: 'verifying source URL', value: '' });
    const reason = h('input', { placeholder: 'reason (required, recorded in audit log)' });
    const area = h('select', {}, ...areasAll().map(x => h('option', { ...(x === a.area ? { selected: true } : {}) }, x)));
    const alias = h('input', { placeholder: 'add alternative spellings, comma separated' });
    const go = async (extra, msg) => { try { const r = await api('/api/admin/answer', { id: a.id, reason: reason.value, ...extra }); toast(msg || 'Saved.'); await refreshBadges(); loaders[tab](); } catch (e) { toast(e.message, true); } };
    const card = h('div', { class: 'card' },
      h('div', { class: 'top' }, h('div', { class: 'raw' }, a.canonical, ' ', h('small', {}, 'Q' + a.q + ' · ' + a.area)), h('div', {}, h('span', { class: 'tag ' + (a.status === 'suspended' ? 'suspended' : a.flag && !a.flagCleared ? 'flagged' : a.status) }, (a.status === 'suspended' ? 'SUSPENDED' : a.flag && !a.flagCleared ? 'FLAGGED' : a.status).toUpperCase()), !a.inBoundary ? h('span', { class: 'tag rejected' }, 'OUTSIDE BOUNDARY') : null)),
      a.flag && !a.flagCleared ? h('div', { class: 'sug' }, a.flag) : null,
      h('div', { class: 'meta' }, 'Aliases: ' + (a.aliases.concat(a.abbreviations || []).join(', ') || '—')),
      h('div', { class: 'meta' }, 'Source: ', h('a', { href: a.source, target: '_blank', rel: 'noopener noreferrer' }, a.source), ' · ' + a.verification + ' · ' + a.coordPrecision + ' (' + a.lat.toFixed(4) + ', ' + a.lng.toFixed(4) + ') · verified ' + a.verifiedAt + ' · prior ' + (a.prior * 100).toFixed(1) + '% · ' + a.affected + ' player(s) hold this answer'),
      h('div', { class: 'grid' }, field('SOURCE URL', src), field('AREA', area), field('ADD ALIASES', alias), field('REASON', reason)),
      h('div', { class: 'act' },
        flagged ? h('button', { class: 'btn ok', onclick: () => go({ confirm: true, addSource: src.value, area: area.value }, 'Confirmed.') }, 'CONFIRM (VERIFIED)') : null,
        h('button', { class: 'btn alt', onclick: () => go({ addAliases: alias.value.split(','), addSource: src.value || undefined, area: area.value !== a.area ? area.value : undefined }) }, 'SAVE ALIASES / SOURCE / AREA'),
        a.status === 'suspended' ? h('button', { class: 'btn ok', onclick: () => go({ status: 'curated' }, 'Restored — scores recalculated.') }, 'RESTORE') : h('button', { class: 'btn no', onclick: () => go({ status: 'suspended' }, 'Suspended — scores recalculated.') }, 'SUSPEND (SCORES 0)')));
    return card;
  }
  const areasAll = () => [...overview.coverage.core, ...overview.coverage.extended];

  /* ---------------------------------------------------------- ANSWERS */
  async function renderAnswers() {
    const root = $('t-answers'); root.textContent = '';
    const sel = h('select', {}, ...overview.questions.map(q => h('option', { value: q.n }, 'Q' + q.n + ' — ' + q.text)));
    sel.value = renderAnswers.q || 1; sel.onchange = () => { renderAnswers.q = sel.value; renderAnswers(); };
    root.append(h('h2', {}, 'ANSWER DATABASE'), h('div', { class: 'toolbar' }, sel));
    const { answers } = await api('/api/admin/answers?q=' + sel.value);
    const tbl = h('table', {}, h('thead', {}, h('tr', {}, ...['ANSWER', 'ALIASES', 'AREA', 'STATUS', 'PRIOR', 'SOURCE'].map(x => h('th', {}, x)))));
    const tb = h('tbody'); tbl.append(tb);
    answers.forEach(a => {
      const tr = h('tr', { style: 'cursor:pointer' }, h('td', {}, a.canonical), h('td', {}, a.aliases.concat(a.abbreviations || []).join(', ')), h('td', {}, a.area), h('td', {}, h('span', { class: 'tag ' + (a.status === 'suspended' ? 'suspended' : a.flag && !a.flagCleared ? 'flagged' : a.status) }, a.status === 'suspended' ? 'SUSPENDED' : a.flag && !a.flagCleared ? 'FLAGGED' : a.status.toUpperCase())), h('td', {}, (a.prior * 100).toFixed(1) + '%'), h('td', {}, h('a', { href: a.source, target: '_blank', rel: 'noopener noreferrer' }, 'link')));
      tr.onclick = e => { if (e.target.tagName === 'A') return; const nxt = tr.nextSibling; if (nxt && nxt.dataset.edit) { nxt.remove(); return; } const ed = h('tr', { 'data-edit': 1 }, h('td', { colspan: 6 }, answerCard(a, !!(a.flag && !a.flagCleared)))); tr.after(ed); };
      tb.append(tr);
    });
    root.append(tbl, h('p', { class: 'meta' }, 'Click a row to edit. There is deliberately no way to edit a player’s score directly.'));
  }

  /* ------------------------------------------------------------ STATS */
  async function renderStats() {
    const root = $('t-stats'); root.textContent = '';
    const s = await api('/api/admin/stats');
    const t = overview.today;
    const reasonClose = h('input', { placeholder: 'reason for closing the day now' });
    const reasonCov = h('input', { placeholder: 'reason for changing coverage' });
    const ext = h('input', { type: 'checkbox', ...(overview.includeExtended ? { checked: true } : {}) });
    root.append(h('h2', {}, 'DAY ' + String(s.day).padStart(3, '0') + (s.final ? ' · FINAL' : ' · LIVE (provisional)')),
      h('p', { class: 'meta' }, s.divers + ' divers · ' + s.finished + ' finished · closes ' + when(t.closesAt) + ' · launch date ' + overview.launchDate),
      h('div', { class: 'card' }, h('h2', {}, 'CLOSE DAY EARLY'), h('p', { class: 'meta' }, 'Locks rarity tiers from the actual answer counts so far. Cannot be undone.'), h('div', { class: 'grid' }, field('REASON', reasonClose)), h('div', { class: 'act' }, h('button', { class: 'btn no', disabled: s.final, onclick: async () => { try { await api('/api/admin/day/close', { day: s.day, reason: reasonClose.value }); toast('Day closed and finalised.'); renderStats(); } catch (e) { toast(e.message, true); } } }, 'CLOSE & FINALISE'))),
      h('div', { class: 'card' }, h('h2', {}, 'COVERAGE BOUNDARY'), h('p', { class: 'meta' }, 'Core: ' + overview.coverage.core.join(', ') + '.'), h('p', { class: 'meta' }, 'Extended Dublin 15 townlands (needed by several Day 001 answers): ' + overview.coverage.extended.join(', ') + '.'), h('label', {}, ext, ' INCLUDE EXTENDED TOWNLANDS (answers outside the core 7 areas score 0 when off)'), h('div', { class: 'grid' }, field('REASON', reasonCov)), h('div', { class: 'act' }, h('button', { class: 'btn alt', onclick: async () => { try { await api('/api/admin/coverage', { includeExtended: ext.checked, reason: reasonCov.value }); toast('Coverage updated; scores recalculated.'); await boot(); } catch (e) { toast(e.message, true); } } }, 'SAVE COVERAGE'))));
    s.questions.forEach(q => {
      const tbl = h('table', {}, h('thead', {}, h('tr', {}, ...['ANSWER', 'COUNT', 'SHARE', 'TIER'].map(x => h('th', {}, x)))), h('tbody', {}, ...q.rows.map(r => h('tr', {}, h('td', {}, r.canonical), h('td', {}, r.count), h('td', {}, r.share + '%'), h('td', {}, r.tier)))));
      root.append(h('div', { class: 'card' }, h('div', { class: 'top' }, h('b', {}, 'Q' + q.n + ' · ' + q.text), h('span', { class: 'meta' }, q.total + ' valid · ' + q.pending + ' unresolved')), q.rows.length ? tbl : h('p', { class: 'meta' }, 'No valid answers yet.')));
    });
  }

  /* ------------------------------------------------------------ AUDIT */
  async function renderAudit() {
    const root = $('t-audit'); root.textContent = '';
    const a = await api('/api/admin/audit');
    root.append(h('h2', {}, 'AUDIT LOG'), h('p', { class: a.verify.ok ? 'ver ok' : 'ver bad' }, a.verify.ok ? 'HASH CHAIN VERIFIED · ' + a.verify.entries + ' entries' : 'CHAIN BROKEN AT #' + a.verify.brokenAt));
    root.append(h('table', {}, h('thead', {}, h('tr', {}, ...['#', 'WHEN', 'ACTOR', 'ACTION', 'TARGET', 'DETAIL'].map(x => h('th', {}, x)))), h('tbody', {}, ...a.entries.map(e => h('tr', {}, h('td', {}, e.seq), h('td', {}, when(e.at)), h('td', {}, e.actor), h('td', {}, e.action), h('td', {}, e.target), h('td', {}, h('code', {}, JSON.stringify(e.detail))))))));
  }

  boot();
})();
