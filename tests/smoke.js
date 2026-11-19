'use strict';
/**
 * End-to-end smoke test against a running instance (Node or Cloudflare).
 *   node tests/smoke.js http://localhost:3000 <ADMIN_PASSWORD>
 * Plays a full dive, submits an unknown answer, approves it as admin, checks rescoring + audit chain.
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const pw = process.argv[3] || process.env.ADMIN_PASSWORD;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const call = async (path, body, token) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers };
};

(async () => {
  const cfg = await call('/api/config');
  ok(cfg.s === 200 && cfg.j.tiers.length === 6, 'config + 6 tiers');
  ok(!!cfg.h.get('content-security-policy'), 'security headers present');
  const home = await fetch(base + '/'); ok(home.status === 200 && (await home.text()).includes('BLANION'), 'home page served');
  const adm = await fetch(base + '/admin'); ok(adm.status === 200 && (await adm.text()).includes('Harbour'), '/admin page served');
  if (!cfg.j.today.open) { console.log('Day is not open; stopping.'); process.exit(fails ? 1 : 0); }

  const nick = 'Smoke' + Math.floor(Math.random() * 9999);
  const st = await call('/api/play/start', { nickname: nick });
  ok(st.s === 200, 'start dive'); const pid = st.j.play.id;
  const unknown = 'Smoke Test Aquatics ' + Date.now();
  const answers = ['tolka', 'hansfield', 'waterville', 'castleknock community college', 'luttrellstown', 'castleknok', unknown];
  let last;
  for (let i = 0; i < 7; i++) {
    await call('/api/play/begin', { playId: pid });
    last = await call('/api/play/answer', { playId: pid, answer: answers[i] });
    if (i < 6) ok(last.j.outcome === 'correct', `Q${i + 1} "${answers[i]}" -> ${last.j.response && last.j.response.canonical}`);
  }
  ok(last.j.outcome === 'pending' && last.j.play.done, 'unknown answer is pending, dive complete');
  const before = last.j.play.score;
  const ap = await call('/api/play/appeal', { playId: pid, index: 6, note: 'Real club, see https://example.org/smoke' });
  ok(ap.s === 200, 'appeal accepted');

  if (!pw) { console.log('No admin password given; skipping admin checks.'); process.exit(fails ? 1 : 0); }
  const lg = await call('/api/admin/login', { password: pw }); ok(lg.s === 200 && lg.j.token, 'admin login');
  ok((await call('/api/admin/login', { password: 'nope' })).s === 401, 'wrong password rejected');
  ok((await call('/api/admin/review')).s === 401, 'admin endpoints need a token');
  const T = lg.j.token;
  const rv = await call('/api/admin/review?status=pending', null, T);
  const g = rv.j.groups.find(x => x.raws.some(r => r.raw === unknown));
  ok(!!g && g.appeals.length === 1 && g.proposedSource, 'pending group shows appeal + proposed source');
  const nosrc = await call('/api/admin/review/decide', { key: g.key, action: 'approve', canonical: 'Smoke Test Aquatics', area: 'Blanchardstown' }, T);
  ok(nosrc.s === 422, 'approve without source refused');
  const outside = await call('/api/admin/review/decide', { key: g.key, action: 'approve', canonical: 'Smoke Test Aquatics', area: 'Lucan', source: 'https://example.org/smoke' }, T);
  ok(outside.s === 422, 'approve outside boundary refused');
  const good = await call('/api/admin/review/decide', { key: g.key, action: 'approve', canonical: 'Smoke Test Aquatics', area: 'Blanchardstown', source: 'https://example.org/smoke' }, T);
  ok(good.s === 200 && good.j.affected >= 1, 'approve ok, players rescored');
  const after = await call('/api/play/state?playId=' + pid);
  ok(after.j.play.score > before, `score rose after approval (${before} -> ${after.j.play.score})`);
  const lb = await call('/api/leaderboard?playId=' + pid); ok(lb.j.rows.some(r => r.nickname === nick), 'player on leaderboard');
  const au = await call('/api/admin/audit', null, T);
  ok(au.j.verify.ok && au.j.entries.some(e => e.action === 'review.approve'), 'audit chain verified and records the decision');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
