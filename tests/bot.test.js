'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { blankState, appendAudit, verifyChain } = require('../lib/state');
const { createApp } = require('../lib/core');
const Bot = require('../lib/bot');

/* ---- in-memory store implementing the store interface ---- */
function memStore() {
  const db = blankState();
  const idx = new Map();
  return {
    get db() { return db; }, save() {}, flush() {}, touch() {},
    audit: (a, b, c, d) => appendAudit(db, a, b, c, d), verifyAudit: () => verifyChain(db),
    addSubmission(s) { s.id = 's_' + (idx.size + 1); db.submissions.push(s); idx.set(s.id, s); return s; },
    getSubmission: id => idx.get(id),
  };
}
const hit = (name, category, type, lat, lon, suburb, id = 1) => ({ osm_type: 'node', osm_id: id, name, category, type, lat: String(lat), lon: String(lon), address: { suburb }, extratags: {} });
/* ---- mock Nominatim: key = "query|bounded" ---- */
const FIX = {
  'Test Valley National School|b': [hit('Test Valley National School', 'amenity', 'school', 53.395, -6.405, 'Hartstown', 11)],
  'Mulhuddart Karaoke Pub|b': [hit('Mulhuddart Karaoke Pub', 'amenity', 'pub', 53.404, -6.398, 'Mulhuddart', 12)],
  'Lucan Grammar School|b': [],
  'Lucan Grammar School|w': [hit('Lucan Grammar School', 'amenity', 'school', 53.357, -6.449, 'Lucan', 13)],
  'Border Lane National School|b': [hit('Border Lane National School', 'amenity', 'school', 53.372, -6.34, 'Ashtown', 14)],
  'Edge Weir Sports Club|b': [hit('Edge Weir Sports Club', 'club', 'sport', 53.3596, -6.361, 'Blanchardstown', 17)],
  'Twin Hill National School|b': [hit('Twin Hill National School', 'amenity', 'school', 53.395, -6.405, 'Hartstown', 15), hit('Twin Hill National School B', 'amenity', 'school', 53.41, -6.39, 'Mulhuddart', 16)],
};
let calls = [];
const mockFetch = async url => {
  const u = new URL(url); const key = u.searchParams.get('q') + '|' + (u.searchParams.get('bounded') ? 'b' : 'w');
  calls.push({ key, ua: undefined });
  return { ok: true, json: async () => FIX[key] || [] };
};

function setup() {
  const store = memStore();
  const app = createApp({ store, adminPassword: 'pw', fetch: mockFetch, sleep: async () => {} });
  const call = async (method, path, body, token) => app.handle({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, ip: 'test', json: async () => body || {} }, new URL('http://x' + path));
  return { store, app, call };
}
async function playerWithUnknownQ4(call, nick, unknown) {
  const st = (await call('POST', '/api/play/start', { nickname: nick })).body;
  const pid = st.play.id;
  const say = async a => { await call('POST', '/api/play/begin', { playId: pid }); return (await call('POST', '/api/play/answer', { playId: pid, answer: a })).body; };
  await say('tolka'); await say('coolmine'); await say('hartstown park');
  const r = await say(unknown);
  assert.equal(r.outcome, 'pending', unknown + ' should be unknown to the bank');
  return pid;
}
const scoreOf = async (call, pid) => (await call('GET', '/api/play/state?playId=' + pid)).body.play.score;

test('bot auto-approves an exact OpenStreetMap match inside the boundary and the player is rescored', async () => {
  const { call, app, store } = setup();
  const pid = await playerWithUnknownQ4(call, 'A', 'Test Valley National School');
  const before = await scoreOf(call, pid);
  const r = await app.runBot();
  assert.equal(r.approved, 1);
  const ans = store.db.answers.find(a => a.canonical === 'Test Valley National School');
  assert.ok(ans, 'answer created');
  assert.equal(ans.verification, 'bot-verified'); assert.equal(ans.addedBy, 'bot'); assert.equal(ans.area, 'Hartstown');
  assert.match(ans.source, /openstreetmap\.org\/node\/11/); assert.ok(ans.botConfidence >= 70);
  assert.ok((await scoreOf(call, pid)) > before, 'score rose after bot approval');
  assert.ok(store.db.audit.some(e => e.actor === 'bot' && e.action === 'review.approve'), 'audited as bot');
  assert.equal(store.verifyAudit().ok, true);
});

test('bot auto-rejects a real place that OpenStreetMap puts outside the boundary', async () => {
  const { call, app, store } = setup();
  await playerWithUnknownQ4(call, 'B', 'Lucan Grammar School');
  const r = await app.runBot();
  assert.equal(r.rejected, 1);
  const sub = store.db.submissions.find(s => s.raw === 'Lucan Grammar School');
  assert.equal(sub.status, 'rejected'); assert.match(sub.reason, /outside the BLANION boundary/);
});

test('wrong place type is never approved (a pub is not a school)', async () => {
  const { call, app, store } = setup();
  await playerWithUnknownQ4(call, 'C', 'Mulhuddart Karaoke Pub');
  const r = await app.runBot();
  assert.equal(r.approved, 0); assert.equal(r.recommendedOnly, 1);
  const sub = store.db.submissions.find(s => s.raw === 'Mulhuddart Karaoke Pub');
  assert.equal(sub.status, 'pending'); assert.equal(sub.bot.recommendation, 'research');
});

test('hard boundary gate: a perfect name match that cannot be placed in an approved area is never approved', async () => {
  const { call, app, store } = setup();
  await playerWithUnknownQ4(call, 'D', 'Border Lane National School');
  const r = await app.runBot();
  assert.equal(r.approved, 0);
  const sub = store.db.submissions.find(s => s.raw === 'Border Lane National School');
  assert.equal(sub.status, 'pending'); assert.equal(sub.bot.confidence, 0);
});

test('ambiguity lowers confidence', async () => {
  const { call, app, store } = setup();
  await playerWithUnknownQ4(call, 'E', 'Twin Hill National School');
  const r = await app.runBot();
  const sub = store.db.submissions.find(s => s.raw === 'Twin Hill National School');
  assert.ok(sub.bot.confidence < 100, 'rival match reduces confidence, got ' + sub.bot.confidence);
});

test('near-duplicate of an existing answer is merged (alias added), not duplicated', async () => {
  const { call, app, store } = setup();
  await playerWithUnknownQ4(call, 'F', 'Castaheeny Educate Togethr National Schol');
  const r = await app.runBot();
  assert.equal(r.merged, 1);
  const target = store.db.answers.find(a => a.canonical === 'Castaheany Educate Together National School');
  assert.ok(target.aliases.includes('Castaheeny Educate Togethr National Schol'));
});

test('settings: auto-approve off or a higher threshold only recommends', async () => {
  const { call, app, store } = setup();
  const tok = (await call('POST', '/api/admin/login', { password: 'pw' })).body.token;
  const set = await call('POST', '/api/admin/bot/settings', { enabled: true, autoApprove: false, autoMerge: true, autoReject: true, threshold: 70, reason: 'test' }, tok);
  assert.equal(set.code, 200);
  await playerWithUnknownQ4(call, 'G', 'Test Valley National School');
  const r = await app.runBot();
  assert.equal(r.approved, 0); assert.equal(r.recommendedOnly, 1);
  const sub = store.db.submissions.find(s => s.raw === 'Test Valley National School');
  assert.equal(sub.status, 'pending'); assert.equal(sub.bot.recommendation, 'approve'); assert.ok(sub.bot.apply.source.includes('openstreetmap.org'));
  // admin sees the recommendation, can accept it, and the settings change is audited
  const rv = (await call('GET', '/api/admin/review?status=pending', null, tok)).body.groups.find(g => g.raws[0].raw === 'Test Valley National School');
  assert.equal(rv.bot.recommendation, 'approve');
  assert.ok(store.db.audit.some(e => e.action === 'bot.settings'));
  assert.equal((await call('POST', '/api/admin/bot/settings', { enabled: true, autoApprove: true, autoMerge: true, autoReject: true, threshold: 20, reason: 'x' }, tok)).code, 422, 'threshold floor 50');
  const off = await call('POST', '/api/admin/bot/settings', { enabled: false, autoApprove: true, autoMerge: true, autoReject: true, threshold: 70, reason: 'off' }, tok);
  assert.deepEqual((await app.runBot()).skipped, 'The bot is switched off.');
});

test('does not re-check a group it already examined', async () => {
  const { call, app } = setup();
  await playerWithUnknownQ4(call, 'H', 'Mulhuddart Karaoke Pub');
  await app.runBot(); const n = calls.length; calls = [];
  const again = await app.runBot();
  assert.equal(again.checked, 0); assert.equal(calls.length, 0);
});

test('scoring primitives', () => {
  assert.equal(Bot.nameSim('Hazel Lawn Tennis Club', 'Hazel Lawn Tennis Club'), 1);
  assert.ok(Bot.nameSim('Hazel Lawn Tennis Club Dublin 15', 'Hazel Lawn Tennis Club') >= 0.9);
  assert.ok(Bot.nameSim('Hazel Lawn', 'Hazel Lawn Tennis Club') >= 0.8);
  assert.equal(Bot.nameSim('Totally Different Place', 'Hazel Lawn Tennis Club'), 0);
  assert.ok(Bot.nameSim('Hazel Lawn Tenis Club', 'Hazel Lawn Tennis Club') > 0.9, 'typo');
  assert.equal(Bot.typeFit(4, { category: 'amenity', type: 'pub', name: 'x' }), 0);
  assert.equal(Bot.typeFit(7, { category: 'leisure', type: 'pitch', name: 'Some Pitch' }), 0, 'a bare pitch is not a club');
  assert.equal(Bot.typeFit(7, { category: 'leisure', type: 'pitch', name: 'Foo Rovers FC Pitch' }), 0.85);
});

test('edge-of-boundary places are recommended, never auto-approved', async () => {
  const { call, app, store } = setup();
  const st = (await call('POST', '/api/play/start', { nickname: 'Z' })).body; const pid = st.play.id;
  const say = async a => { await call('POST', '/api/play/begin', { playId: pid }); return (await call('POST', '/api/play/answer', { playId: pid, answer: a })).body; };
  for (const a of ['tolka', 'coolmine', 'hartstown park', 'tyrrelstown educate together', 'luttrellstown castle', 'blanchardstown']) await say(a);
  assert.equal((await say('Edge Weir Sports Club')).outcome, 'pending');
  const r = await app.runBot();
  assert.equal(r.approved, 0);
  const sub = store.db.submissions.find(s => s.raw === 'Edge Weir Sports Club');
  assert.equal(sub.bot.recommendation, 'research'); assert.match(sub.bot.reasons.join(' '), /edge of the BLANION boundary/);
});
