'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSeedAnswers } = require('../lib/day001');
const E = require('../lib/engine');

const answers = buildSeedAnswers('2026-01-01');
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
