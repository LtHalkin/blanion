(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = null; try { token = sessionStorage.getItem('blanion.reviewer'); } catch {}
  let filter = 'pending';

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token) logout();
    if (!r.ok) throw Object.assign(new Error(j.error || 'Error'), { data: j });
    return j;
  }
  const when = ms => new Date(ms).toLocaleString('en-IE', { dateStyle: 'short', timeStyle: 'medium' });

  $('loginForm').onsubmit = async e => {
    e.preventDefault(); $('loginErr').textContent = '';
    try { const r = await api('/api/reviewer/login', { password: $('pw').value }); token = r.token; try { sessionStorage.setItem('blanion.reviewer', token); } catch {} load(); }
    catch (err) { $('loginErr').textContent = err.message; }
  };
  function logout() { token = null; try { sessionStorage.removeItem('blanion.reviewer'); } catch {} $('shell').classList.add('hidden'); $('login').classList.remove('hidden'); }
  $('logout').onclick = logout;
  $('refresh').onclick = () => load();

  async function load() {
    if (!token) return;
    let d;
    try { d = await api('/api/reviewer/review?status=' + filter); } catch { return; }
    $('login').classList.add('hidden'); $('shell').classList.remove('hidden');
    const root = $('list'); root.textContent = '';
    const sel = h('select', {}, ...[['pending', 'Pending (' + d.counts.pending + ')'], ['research', 'Flagged for research (' + d.counts.research + ')'], ['decided', 'Decided (' + d.counts.decided + ')'], ['all', 'All']].map(([v, l]) => h('option', { value: v }, l)));
    sel.value = filter; sel.onchange = () => { filter = sel.value; load(); };
    root.append(h('h2', {}, 'ANSWER REVIEW'), h('div', { class: 'toolbar' }, sel, h('span', { class: 'meta' }, 'View only — you cannot approve, reject or change anything from this panel.')));
    if (!d.groups.length) root.append(h('p', { class: 'meta' }, 'Nothing here. The harbour is quiet.'));
    for (const g of d.groups) root.append(card(g));
  }

  function card(g) {
    const c = h('div', { class: 'card ' + g.status });
    c.append(h('div', { class: 'top' },
      h('div', { class: 'raw' }, g.raws.map(r => r.raw + (r.n > 1 ? ' ×' + r.n : '')).join('  /  '), ' ', h('small', {}, 'Q' + g.q)),
      h('div', {}, h('span', { class: 'tag ' + g.status }, g.status.toUpperCase()), g.auto ? h('span', { class: 'tag' }, 'AUTO-RULE') : null)));
    c.append(h('div', { class: 'meta' }, g.qText, ' · ', g.players + ' player' + (g.players === 1 ? '' : 's'), ' · first ', when(g.firstAt), ' · last ', when(g.lastAt)));
    if (g.reason) c.append(h('div', { class: 'meta' }, 'Reason: ', g.reason));
    if (g.resolved) c.append(h('div', { class: 'meta' }, 'Resolved to: ', g.resolved));
    if (g.suggestion) c.append(h('div', { class: 'sug' }, 'Suggested canonical: ', h('b', {}, g.suggestion.canonical), ' (' + g.suggestion.confidence + '% similar)'));
    if (g.proposedSource) c.append(h('div', { class: 'meta' }, 'Proposed source: ', h('a', { href: g.proposedSource, target: '_blank', rel: 'noopener noreferrer' }, g.proposedSource)));
    if (g.bot) {
      const b = g.bot, tone = b.recommendation === 'approve' ? 'approved' : b.recommendation === 'reject' ? 'rejected' : b.recommendation === 'merge' ? 'merged' : 'research';
      c.append(h('div', { class: 'sug' },
        h('span', { class: 'tag ' + tone }, 'BOT: ' + b.recommendation.toUpperCase() + ' ' + b.confidence + '%'), b.applied ? h('span', { class: 'tag' }, 'APPLIED: ' + b.applied) : null, ' ', h('span', { class: 'meta' }, 'checked ' + when(b.checkedAt)),
        ...(b.reasons || []).map(r => h('div', { class: 'meta' }, '• ' + r)),
        ...(b.candidates || []).map(x => h('div', { class: 'meta' }, '→ ', h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.name), ' · ' + x.kind + ' · ' + (x.area || 'no approved area')))));
    }
    g.appeals.forEach(a => c.append(h('div', { class: 'appeal' }, 'PLAYER APPEAL (' + when(a.at) + '): ' + a.note)));
    return c;
  }

  load();
  setInterval(() => { if (token && !$('shell').classList.contains('hidden')) load(); }, 60000);
})();
