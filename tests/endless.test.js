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
