'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSeedAnswers, COVERAGE } = require('../lib/day001');
const { blankState, syncSeeds } = require('../lib/state');
const E = require('../lib/engine');

const answers = blankState('2026-01-01').answers;   // seed + expanded bank
const idx = q => E.buildIndex(answers, q);
const canon = (q, text) => { const r = E.resolve(idx(q), text); return r.kind === 'match' ? r.answer.canonical : r.kind; };

test('aliases and spellings resolve to one canonical answer', () => {
  assert.equal(canon(1, 'tolka'), 'River Tolka');
  assert.equal(canon(1, 'THE ROYAL CANAL'), 'Royal Canal');
  assert.equal(canon(3, 'Millennium Park'), 'Millennium Regional Park');
  assert.equal(canon(4, 'Coolmine'), 'Coolmine Community School');
  assert.equal(canon(4, 'sfx junior'), 'St Francis Xavier Junior School');
  assert.equal(canon(4, 'Scoil Oilibheir'), 'Scoil Oilibhéir National School');
  assert.equal(canon(7, 'St Peregrines'), "St Peregrine's GAA");
  assert.equal(canon(5, 'Castleknock Motte and Bailey'), 'Castleknock Castle');
});
test('typos are tolerated, wrong things are not', () => {
  assert.equal(canon(6, 'Castleknok'), 'Castleknock');
  assert.equal(canon(6, 'Mulhudart'), 'Mulhuddart');
  assert.equal(canon(6, 'Lucan'), 'blocked');
  assert.equal(canon(6, 'Dublin'), 'blocked');
  assert.equal(canon(6, 'Pizza Palace'), 'unknown');
});
test('short names that fit several answers ask which one', () => {
  assert.equal(canon(7, 'Castleknock'), 'ambiguous');
  assert.equal(canon(4, 'Castleknock'), 'ambiguous');
  assert.equal(canon(4, 'Scoil Bhride'), 'ambiguous');
});
test('no duplicate aliases across different answers within a question', () => {
  for (let q = 1; q <= 7; q++) for (const [k, ids] of idx(q).byName) assert.ok(ids.size === 1, `q${q} "${k}" maps to ${[...ids]}`);
});
test('rarity tiers follow answer share', () => {
  assert.equal(E.tierFor(300, 1000, 0.3).id, 'plankton');
  assert.equal(E.tierFor(130, 1000, 0.1).id, 'too_clever');
  assert.equal(E.tierFor(70, 1000, 0.05).id, 'schooler');
  assert.equal(E.tierFor(35, 1000, 0.03).id, 'rare');
  assert.equal(E.tierFor(15, 1000, 0.01).id, 'deep_cut');
  assert.equal(E.tierFor(1, 1000, 0.01).id, 'one_in_blanion');
  assert.equal(E.tierFor(3, 1000, 0.01).id, 'one_in_blanion');
});
test('day-one provisional tiers come from priors when nobody has played', () => {
  assert.equal(E.tierFor(0, 0, 0.40).id, 'plankton');
  assert.equal(E.tierFor(0, 0, 0.005).id, 'one_in_blanion');
});

test('expanded bank: every answer has a source, in-box coordinates and an in-boundary area', () => {
  const allowed = new Set([...COVERAGE.core, ...COVERAGE.extended]);
  assert.ok(answers.length > 130, 'bank should be well over 130 answers, got ' + answers.length);
  for (const a of answers) {
    assert.match(a.source, /^https?:\/\//, a.canonical + ' needs a source');
    assert.ok(allowed.has(a.area), `${a.canonical}: area "${a.area}" outside boundary`);
    assert.ok(a.lat >= COVERAGE.bbox.minLat && a.lat <= COVERAGE.bbox.maxLat && a.lng >= COVERAGE.bbox.minLng && a.lng <= COVERAGE.bbox.maxLng, `${a.canonical}: coords outside box`);
  }
});
test('expanded bank resolves new answers and keeps ambiguity prompts', () => {
  assert.equal(canon(6, 'Cruiserath'), 'Cruiserath');
  assert.equal(canon(6, 'Macetown'), 'ambiguous');
  assert.equal(canon(4, 'Hansfield Educate Together'), 'ambiguous');
  assert.equal(canon(4, "St Brigid's Boys National School"), 'Scoil Bhríde Boys National School');
  assert.equal(canon(5, "lady's well"), "Our Lady's Well");
  assert.equal(canon(1, 'pinkeen'), 'Pinkeen River');
  assert.equal(canon(7, 'Westmanstown Rugby'), 'Westmanstown RFC');
});
test('syncSeeds upgrades an old store without touching admin-edited answers', () => {
  const db = blankState('2026-01-01');
  const old = JSON.parse(JSON.stringify(db));
  old.answers = old.answers.filter(a => a.addedBy !== 'seed:osm');         // simulate the original 76-answer deployment
  old.meta.seedVersion = 1;
  const edited = old.answers.find(a => a.canonical === 'Hartstown Park'); edited.edited = true; edited.lat = 1;
  const legacy = old.answers.find(a => a.canonical === 'Waterville Park'); legacy.lat = 2;   // edited under the OLD code: no flag, but an audit entry
  old.audit.push({ seq: old.audit.length + 1, at: 1, actor: 'admin', action: 'answer.update', target: 'answer:' + legacy.id, detail: {}, prev: 'x', hash: 'x' });
  const r = syncSeeds(old);
  assert.equal(old.answers.find(a => a.canonical === 'Waterville Park').lat, 2, 'legacy admin edit protected via audit log');
  assert.ok(r && r.added === db.answers.length - old.answers.length + r.added && r.added > 50);
  assert.equal(old.answers.find(a => a.canonical === 'Hartstown Park').lat, 1, 'admin-edited answer left alone');
  assert.ok(old.answers.find(a => a.canonical === 'Coolmine Community School').coordPrecision === 'osm-point', 'untouched seed enriched');
  assert.equal(syncSeeds(old), null, 'idempotent');
});
