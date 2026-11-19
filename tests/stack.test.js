'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { blankState, appendAudit, verifyChain } = require('../lib/state');
const { createApp } = require('../lib/core');
const SS = require('../public/stack-shapes.js');

function setup() {
  const db = blankState(); const idx = new Map();
  const store = { get db() { return db; }, save() {}, flush() {}, touch() {}, audit: (a, b, c, d) => appendAudit(db, a, b, c, d), verifyAudit: () => verifyChain(db), addSubmission(s) { s.id = 's_' + (idx.size + 1); db.submissions.push(s); idx.set(s.id, s); return s; }, getSubmission: id => idx.get(id), removeStack(k) { delete db.stack.scores[k]; } };
  const app = createApp({ store, adminPassword: 'pw', sleep: async () => {} });
  const call = (method, path, body, token) => app.handle({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, ip: 't', json: async () => body || {} }, new URL('http://x' + path));
  return { store, call };
}
const later = async (ms, fn) => { const real = Date.now; Date.now = () => real() + ms; try { return await fn(); } finally { Date.now = real; } };

test('shared block sequence is deterministic, fair, and bounded', () => {
  const a = SS.sequenceFor('2026-11-19'), b = SS.sequenceFor('2026-11-19'), c = SS.sequenceFor('2026-11-20');
  assert.deepEqual(a, b); assert.notDeepEqual(a, c); assert.equal(a.length, 20);
  for (let i = 1; i < 20; i++) assert.notEqual(a[i].shape, a[i - 1].shape, 'no repeats in a row');
  assert.ok(a.filter(p => SS.SHAPES[p.shape].tag === 'hard').length <= 3);
  assert.ok(a.filter(p => SS.SHAPES[p.shape].tag === 'friendly').length >= 7);
  assert.ok(SS.maxHeightMetres(a) > 30);
});

test('start -> submit -> leaderboard, best score per player kept, ranks ordered', async () => {
  const { call } = setup();
  const s1 = (await call('POST', '/api/stack/start', { nickname: 'Alice' })).body;
  const s2 = (await call('POST', '/api/stack/start', { nickname: 'Bob' })).body;
  assert.ok(s1.token && s1.playerId && /^\d{4}-\d{2}-\d{2}$/.test(s1.day));
  const r1 = await later(30000, () => call('POST', '/api/stack/submit', { token: s1.token, height: 9.4, standing: 7 }));
  assert.equal(r1.code, 200); assert.equal(r1.body.rank, 1);
  const r2 = await later(30000, () => call('POST', '/api/stack/submit', { token: s2.token, height: 12.1, standing: 9 }));
  assert.equal(r2.body.rank, 1); assert.equal(r2.body.count, 2);
  // a worse later attempt never lowers Alice's best
  const s1b = (await call('POST', '/api/stack/start', { playerId: s1.playerId })).body;
  const r3 = await later(30000, () => call('POST', '/api/stack/submit', { token: s1b.token, height: 4, standing: 3 }));
  assert.equal(r3.body.best, 9.4); assert.equal(r3.body.improved, false); assert.equal(r3.body.rank, 2);
  const lb = (await call('GET', '/api/stack/leaderboard?playerId=' + s1.playerId)).body;
  assert.deepEqual(lb.rows.map(r => [r.nickname, r.height]), [['Bob', 12.1], ['Alice', 9.4]]);
  assert.equal(lb.rows[1].me, true); assert.equal(lb.me.rank, 2);
  assert.equal(lb.rows[0].playerId, undefined, 'player ids are not exposed');
});

test('anti-cheat: too fast, impossible height, bad numbers, forged/edited tokens are rejected', async () => {
  const { call, store } = setup();
  const s = (await call('POST', '/api/stack/start', { nickname: 'Eve' })).body;
  assert.equal((await call('POST', '/api/stack/submit', { token: s.token, height: 5, standing: 5 })).code, 422, 'instant submit');
  const bound = SS.maxHeightMetres(SS.sequenceFor(s.day));
  assert.equal((await later(30000, () => call('POST', '/api/stack/submit', { token: s.token, height: bound + 1, standing: 5 }))).code, 422, 'above physical bound');
  assert.equal((await later(30000, () => call('POST', '/api/stack/submit', { token: s.token, height: 999, standing: 5 }))).code, 422);
  assert.equal((await later(30000, () => call('POST', '/api/stack/submit', { token: s.token, height: -1, standing: 5 }))).code, 422);
  assert.equal((await later(30000, () => call('POST', '/api/stack/submit', { token: s.token, height: 5, standing: 25 }))).code, 422);
  assert.equal((await later(30000, () => call('POST', '/api/stack/submit', { token: s.token, height: 'lots', standing: 5 }))).code, 422);
  const [payload, sig] = s.token.split('.');
  const forged = Buffer.from(`${s.playerId}|${s.day}|1`).toString('base64url') + '.' + sig;       // back-dated start time
  assert.equal((await call('POST', '/api/stack/submit', { token: forged, height: 5, standing: 5 })).code, 400);
  assert.equal((await call('POST', '/api/stack/submit', { token: 'x.y', height: 5, standing: 5 })).code, 400);
  assert.equal((await call('POST', '/api/stack/submit', { height: 5, standing: 5 })).code, 400);
  assert.equal(Object.keys(store.db.stack.scores).length, 0, 'nothing was recorded');
});

test('admin can remove a score (audited); non-admins cannot', async () => {
  const { call, store } = setup();
  const s = (await call('POST', '/api/stack/start', { nickname: 'Mallory' })).body;
  await later(30000, () => call('POST', '/api/stack/submit', { token: s.token, height: 20, standing: 10 }));
  assert.equal((await call('POST', '/api/admin/stack/remove', { day: s.day, playerId: s.playerId, reason: 'cheating' })).code, 401);
  const tok = (await call('POST', '/api/admin/login', { password: 'pw' })).body.token;
  const list = (await call('GET', '/api/admin/stack', null, tok)).body;
  assert.equal(list.rows[0].nickname, 'Mallory');
  assert.equal((await call('POST', '/api/admin/stack/remove', { day: s.day, playerId: s.playerId, reason: '' }, tok)).code, 422, 'reason required');
  assert.equal((await call('POST', '/api/admin/stack/remove', { day: s.day, playerId: s.playerId, reason: 'cheating' }, tok)).code, 200);
  assert.equal((await call('GET', '/api/stack/leaderboard')).body.count, 0);
  assert.ok(store.db.audit.some(e => e.action === 'stack.remove' && e.detail.reason === 'cheating'));
  assert.equal(store.verifyAudit().ok, true);
});
