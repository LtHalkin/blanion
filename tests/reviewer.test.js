'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { blankState, appendAudit, verifyChain } = require('../lib/state');
const { createApp } = require('../lib/core');

function setup(opts = {}) {
  const db = blankState(); const idx = new Map();
  const store = { get db() { return db; }, save() {}, flush() {}, touch() {}, audit: (a, b, c, d) => appendAudit(db, a, b, c, d), verifyAudit: () => verifyChain(db), addSubmission(s) { s.id = 's_' + (idx.size + 1); db.submissions.push(s); idx.set(s.id, s); return s; }, getSubmission: id => idx.get(id) };
  const app = createApp({ store, adminPassword: 'adminpw', reviewerPassword: 'viewpw', sleep: async () => {}, ...opts });
  const call = (method, path, body, token) => app.handle({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, ip: 't', json: async () => body || {} }, new URL('http://x' + path));
  return { store, app, call };
}
async function seedUnknown(call) {
  const st = (await call('POST', '/api/play/start', { nickname: 'P' })).body; const pid = st.play.id;
  const say = async a => { await call('POST', '/api/play/begin', { playId: pid }); return (await call('POST', '/api/play/answer', { playId: pid, answer: a })).body; };
  await say('tolka'); await say('coolmine'); await say('hartstown park'); await say('Some Unknown School');
}

test('reviewer can log in and read the review queue, with internals stripped', async () => {
  const { call } = setup(); await seedUnknown(call);
  assert.equal((await call('POST', '/api/reviewer/login', { password: 'nope' })).code, 401);
  const tok = (await call('POST', '/api/reviewer/login', { password: 'viewpw' })).body.token;
  const r = await call('GET', '/api/reviewer/review?status=pending', null, tok);
  assert.equal(r.code, 200); assert.equal(r.body.readOnly, true);
  assert.equal(r.body.groups.length, 1); assert.equal(r.body.groups[0].raws[0].raw, 'Some Unknown School');
  assert.equal(r.body.groups[0].subIds, undefined, 'no internal ids'); assert.equal(r.body.groups[0].key, undefined, 'no decision key');
  assert.equal(r.body.counts.pending, 1);
});

test('reviewer token cannot reach ANY admin endpoint, and cannot change anything', async () => {
  const { call, store } = setup(); await seedUnknown(call);
  const tok = (await call('POST', '/api/reviewer/login', { password: 'viewpw' })).body.token;
  const before = JSON.stringify(store.db.submissions);
  for (const [m, p, b] of [['GET', '/api/admin/overview'], ['GET', '/api/admin/review'], ['POST', '/api/admin/review/decide', { key: 'x', action: 'approve' }], ['POST', '/api/admin/bot/run', {}], ['POST', '/api/admin/answers/import', { rows: [] }], ['GET', '/api/admin/audit'], ['POST', '/api/admin/day/close', { day: 1, reason: 'x' }]]) {
    assert.equal((await call(m, p, b, tok)).code, 401, `${m} ${p} must reject a reviewer token`);
  }
  assert.equal((await call('POST', '/api/reviewer/review', {}, tok)).code, 404, 'no write endpoints on the reviewer API');
  assert.equal(JSON.stringify(store.db.submissions), before, 'nothing changed');
});

test('admin token cannot be used on the reviewer API either way, and unsigned/forged tokens fail', async () => {
  const { call } = setup();
  const admin = (await call('POST', '/api/admin/login', { password: 'adminpw' })).body.token;
  assert.equal((await call('GET', '/api/reviewer/review', null, admin)).code, 401);
  const rev = (await call('POST', '/api/reviewer/login', { password: 'viewpw' })).body.token;
  const [exp] = rev.split('.');
  assert.equal((await call('GET', '/api/reviewer/review', null, exp + '.forged')).code, 401);
  assert.equal((await call('GET', '/api/reviewer/review', null, '1.' + rev.split('.')[1])).code, 401, 'expiry tampering');
});

test('same password for both roles still gives separate, non-interchangeable tokens', async () => {
  const { call } = setup({ adminPassword: 'same', reviewerPassword: 'same' });
  const a = (await call('POST', '/api/admin/login', { password: 'same' })).body.token;
  const r = (await call('POST', '/api/reviewer/login', { password: 'same' })).body.token;
  assert.equal((await call('GET', '/api/admin/overview', null, r)).code, 401);
  assert.equal((await call('GET', '/api/reviewer/review', null, a)).code, 401);
});

test('reviewer panel is disabled unless REVIEWER_PASSWORD is set', async () => {
  const { call } = setup({ reviewerPassword: '' });
  assert.equal((await call('POST', '/api/reviewer/login', { password: '' })).code, 503);
  assert.equal((await call('GET', '/api/reviewer/review', null, 'x.y')).code, 503);
});
