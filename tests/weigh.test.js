'use strict';
const test = require('node:test');
const assert = require('node:assert');
const W = require('../public/weigh-data.js');

test('every pair is a sensible comparison (between 10 and 1 billion, objects exist, big is heavier)', () => {
  assert.ok(W.PAIRS.length >= 25);
  const ids = new Set();
  for (const p of W.PAIRS) {
    assert.ok(W.BIG[p.big], p.id + ' big'); assert.ok(W.SMALL[p.small], p.id + ' small');
    const t = W.truth(p);
    assert.ok(t >= 10 && t <= 1e9, `${p.id} answer ${t} out of range`);
    assert.ok(!ids.has(p.id), 'duplicate ' + p.id); ids.add(p.id);
  }
});
test('headline example: an elephant is about a hundred thousand eggs', () => {
  const t = W.truth({ big: 'elephant', small: 'egg' });
  assert.ok(t > 100000 && t < 107000, String(t));
});
test('daily rounds are deterministic, varied and have a range of answers', () => {
  for (let d = 1; d <= 90; d++) {
    const key = '2026-12-' + String(d).padStart(2, '0');
    const a = W.pairsFor(key), b = W.pairsFor(key);
    assert.deepEqual(a, b); assert.equal(a.length, W.ROUNDS);
    assert.equal(new Set(a.map(p => p.big)).size, W.ROUNDS, 'distinct big objects');
    assert.equal(new Set(a.map(p => p.small)).size, W.ROUNDS, 'distinct units');
  }
  assert.notDeepEqual(W.pairsFor('2026-11-19'), W.pairsFor('2026-11-20'));
});
test('scoring: exact = 100, symmetric on a log scale, 10x off = 0, junk = 0', () => {
  assert.equal(W.score(1000, 1000), 100);
  assert.equal(W.score(2000, 1000), W.score(500, 1000));
  assert.ok(W.score(1100, 1000) >= 95);
  assert.equal(W.score(10000, 1000), 0); assert.equal(W.score(100, 1000), 0); assert.equal(W.score(1e9, 1000), 0);
  assert.equal(W.score(0, 1000), 0); assert.equal(W.score(-5, 1000), 0); assert.equal(W.score(NaN, 1000), 0); assert.equal(W.score(Infinity, 1000), 0);
  assert.ok(W.score(2000, 1000) > W.score(3000, 1000));
});
test('error wording and formatting', () => {
  assert.equal(W.describeError(1000, 1000), 'Spot on!');
  assert.equal(W.describeError(2300, 1000), '2.3× too high');
  assert.equal(W.describeError(250, 1000), '4.0× too low');
  assert.equal(W.describeError(1300, 1000), '30% too high');
  assert.equal(W.fmtMass(6000), '6 tonnes'); assert.equal(W.fmtMass(0.058), '58 g'); assert.equal(W.fmtMass(0.000025), '25 mg');
  assert.equal(W.fmtCount(103448.2), '103,448');
});

test('every object in the game has a 3D model (and the gallery lists them)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'weigh-models.js'), 'utf8');
  const ids = new Set([...src.matchAll(/^  (\w+): \(/gm)].map(m => m[1]));
  for (const k of Object.keys(W.BIG)) assert.ok(ids.has(k), 'missing 3D model for big object: ' + k);
  for (const k of Object.keys(W.SMALL)) assert.ok(ids.has(k), 'missing 3D model for unit: ' + k);
  for (const k of Object.keys(W.BIG)) assert.ok(W.BIG[k].emoji && W.BIG[k].a, 'emoji/name fallback for ' + k);
});
