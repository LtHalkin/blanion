'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { blankState, appendAudit, verifyChain } = require('../lib/state');
const { createApp } = require('../lib/core');

function setup() {
  const db = blankState(); const idx = new Map();
  const store = { get db() { return db; }, save() {}, flush() {}, touch() {}, audit: (a, b, c, d) => appendAudit(db, a, b, c, d), verifyAudit: () => verifyChain(db), addSubmission(s) { s.id = 's_' + (idx.size + 1); db.submissions.push(s); idx.set(s.id, s); return s; }, getSubmission: id => idx.get(id) };
  const app = createApp({ store, adminPassword: 'pw', sleep: async () => {} });
  let n = 0;
  const call = (method, path, body, ip) => app.handle({ method, headers: {}, ip: ip || 'ip' + (n++), json: async () => body || {} }, new URL('http://x' + path));
  return { store, call };
}

test('endless info lists all 16 categories with live bank sizes', async () => {
  const { call } = setup(); const r = (await call('GET', '/api/endless/info')).body;
  assert.equal(r.questions.length, 16); assert.ok(r.questions.every(q => q.known >= 3)); assert.equal(r.startLives, 3); assert.equal(r.tiers.length, 6);
});

test('answers resolve exactly like the daily game, with a rarity tier and points', async () => {
  const { call } = setup();
  let r = (await call('POST', '/api/endless/answer', { q: 1, answer: 'tolka' })).body;
  assert.equal(r.outcome, 'correct'); assert.equal(r.canonical, 'River Tolka'); assert.ok(r.points >= 10 && r.points <= 100); assert.ok(r.tier);
  r = (await call('POST', '/api/endless/answer', { q: 6, answer: 'Cruiserath' })).body;
  assert.equal(r.outcome, 'correct'); assert.equal(r.tier, 'one_in_blanion', 'a rare bank answer is a rare tier');
  assert.equal((await call('POST', '/api/endless/answer', { q: 7, answer: 'Castleknock' })).body.outcome, 'ambiguous');
  assert.ok((await call('POST', '/api/endless/answer', { q: 7, answer: 'Castleknock' })).body.options.length > 1);
  assert.equal((await call('POST', '/api/endless/answer', { q: 4, answer: 'Pizza Palace' })).body.outcome, 'unknown');
  assert.equal((await call('POST', '/api/endless/answer', { q: 6, answer: 'Dublin' })).body.outcome, 'wrong');
  assert.equal((await call('POST', '/api/endless/answer', { q: 6, answer: '' })).body.outcome, 'invalid');
  assert.equal((await call('POST', '/api/endless/answer', { q: 17, answer: 'x' })).code, 400);
});

test('tiers come from the latest finalised day when one exists', async () => {
  const { call, store } = setup();
  const a = store.db.answers.find(x => x.canonical === 'River Tolka');
  store.db.days[1] = { final: { total: { 1: 100 }, tiers: { 1: { [a.id]: 'deep_cut' } } } };
  assert.equal((await call('POST', '/api/endless/answer', { q: 1, answer: 'tolka' })).body.tier, 'deep_cut');
});

test('endless play leaves no trace in daily stats, players or scores', async () => {
  const { call, store } = setup();
  for (let i = 0; i < 5; i++) await call('POST', '/api/endless/answer', { q: 1, answer: 'tolka' });
  assert.equal(store.db.plays.length, 0); assert.equal(Object.keys(store.db.players).length, 0); assert.equal(store.db.submissions.length, 0);
});

test('suggestions go to review (never accepted), dedupe, and are rate-limited per IP', async () => {
  const { call, store } = setup();
  let r = (await call('POST', '/api/endless/suggest', { q: 4, answer: 'Totally New School' }, 'a')).body;
  assert.equal(r.ok, true); assert.equal(store.db.submissions.length, 1); assert.equal(store.db.submissions[0].status, 'pending');
  r = (await call('POST', '/api/endless/suggest', { q: 4, answer: 'totally new school' }, 'b')).body;
  assert.match(r.message, /waiting for review/); assert.equal(store.db.submissions.length, 1, 'no duplicate group member');
  r = (await call('POST', '/api/endless/suggest', { q: 1, answer: 'River Tolka' }, 'c')).body;
  assert.equal(r.ok, false, 'already-accepted answers are not queued');
  for (let i = 0; i < 15; i++) await call('POST', '/api/endless/suggest', { q: 5, answer: 'Place Number ' + i }, 'spam');
  assert.equal((await call('POST', '/api/endless/suggest', { q: 5, answer: 'One More Place' }, 'spam')).code, 429);
});

test('Day 002 exists, uses bank categories, and the admin day tester resolves answers without writing anything', async () => {
  const { call, store } = setup();
  const tok = (await call('POST', '/api/admin/login', { password: 'pw' })).body.token;
  const get = async path => { const app = createApp({ store, adminPassword: 'pw', sleep: async () => {} }); return app.handle({ method: 'GET', headers: { authorization: 'Bearer ' + tok }, ip: 'z', json: async () => ({}) }, new URL('http://x' + path)); };
  const post = async (path, body) => { const app = createApp({ store, adminPassword: 'pw', sleep: async () => {} }); return app.handle({ method: 'POST', headers: { authorization: 'Bearer ' + tok }, ip: 'z', json: async () => body }, new URL('http://x' + path)); };
  const pv = (await get('/api/admin/day/preview?day=2')).body;
  assert.equal(pv.questions.length, 7); assert.ok(pv.questions.every(q => q.known >= 5), 'every Day 002 question has a bank');
  const before = JSON.stringify(store.db.submissions) + store.db.plays.length;
  const hit = (await post('/api/admin/day/test', { day: 2, n: 4, answer: 'Kentucky Fried Chicken' })).body;
  assert.equal(hit.kind, 'match'); assert.equal(hit.canonical, 'KFC');
  assert.equal((await post('/api/admin/day/test', { day: 2, n: 4, answer: 'zzz nonsense place' })).body.kind, 'unknown');
  assert.equal(JSON.stringify(store.db.submissions) + store.db.plays.length, before, 'tester writes nothing');
});

test('a full Day 002 dive plays through the daily API using bank categories 8-16', async () => {
  const { call, store } = setup();
  const { addDays, dateKey } = require('../lib/util');
  store.db.meta.launchDate = addDays(dateKey(Date.now()), -1);   // so today is Day 002
  const st = (await call('GET', '/api/config')).body.today;
  assert.equal(st.day, 2);
  const start = (await call('POST', '/api/play/start', { nickname: 'T' }, 'p1')).body;
  let play = (await call('POST', '/api/play/begin', { playId: start.play.id }, 'p1')).body.play;
  const answers = ['The Twelfth Lock', 'St Brigid\'s Church', 'Dunnes', 'kfc', 'Ben Dunne Gym', 'JCMH', 'Castleknock Road'];
  for (let i = 0; i < 7; i++) {
    assert.equal(play.question.n, i + 1);
    const r = (await call('POST', '/api/play/answer', { playId: start.play.id, answer: answers[i] }, 'p1')).body;
    assert.equal(r.outcome, 'correct', answers[i] + ' -> ' + JSON.stringify(r.response || r));
    play = r.play;
    if (i < 6) play = (await call('POST', '/api/play/begin', { playId: start.play.id }, 'p1')).body.play;
  }
  assert.ok(play.done); assert.ok(play.score > 0); assert.deepEqual(play.responses.map(x => x.n), [1, 2, 3, 4, 5, 6, 7]);
});
