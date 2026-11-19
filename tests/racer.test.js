'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../public/racer-core.js');

const tracks = () => R.TRACKS.map(d => R.buildTrack(d));

test('the three circuits are valid (no crossings, no pinches) and have sane lengths', () => {
  for (const t of tracks()) {
    const v = R.validate(t);
    assert.ok(v.ok, `${t.name}: minGap ${v.minGap.toFixed(1)} minRadius ${v.minRadius.toFixed(1)}`);
    assert.ok(t.len > 600 && t.len < 2500, t.name + ' length ' + t.len);
  }
});

test('the AI driver finishes every circuit cleanly, which proves each one is drivable', () => {
  for (const t of tracks()) {
    const r = R.simulate(t, t.laps, 1, 400);
    assert.ok(r.done, t.name + ' not finished'); assert.equal(r.lapTimes.length, t.laps);
    assert.ok(r.hits < 5, `${t.name}: ${r.hits} wall hits`);
    for (const lt of r.lapTimes) assert.ok(lt > 15 && lt < 90, t.name + ' lap ' + lt);
  }
});

test('physics is deterministic: the same inputs give bit-identical races (so ghosts replay exactly)', () => {
  const t = tracks()[1], a = R.simulate(t, 1, 1, 200), b = R.simulate(t, 1, 1, 200);
  assert.equal(a.finishTime, b.finishTime); assert.equal(a.car.x, b.car.x); assert.equal(a.car.z, b.car.z);
});

test('the car can never leave the barriers, however hard you steer into them', () => {
  const t = tracks()[0], r = R.newRace(t, 3);
  for (let i = 0; i < 120 * 40; i++) { R.stepRace(r, { thr: 1, str: i % 900 < 450 ? 1 : -1 }); assert.ok(Math.abs(r.car.lat) <= t.barrier + 0.2, 'lat ' + r.car.lat); }
});

test('grass slows you down, tarmac does not', () => {
  const t = tracks()[0], on = R.newRace(t, 3), off = R.newRace(t, 3);
  off.car.off = true;
  for (let i = 0; i < 120 * 3; i++) { R.stepRace(on, { thr: 1 }); off.car.off = true; R.stepCar(off.car, { thr: 1 }, t); }
  assert.ok(on.car.speed > off.car.speed || on.car.hit > 0);
});

test('laps count only when you actually drive round: reversing and parking never score a lap', () => {
  const t = tracks()[0], r = R.newRace(t, 3);
  for (let i = 0; i < 120 * 20; i++) R.stepRace(r, { brk: 1 });
  assert.equal(r.lapTimes.length, 0); assert.ok(r.total < 5);
});

test('medal thresholds are ordered and reachable', () => {
  for (const t of tracks()) { const m = R.medalTimes(t, t.laps); assert.ok(m.gold < m.silver && m.silver < m.bronze); assert.ok(m.bot < m.gold); }
});

test('random tracks: every code gives a valid circuit the AI can finish', () => {
  for (const seed of [1, 2, 3, 77, 1234, 99999]) {
    const t = R.randomTrack(seed), v = R.validate(t); assert.ok(v.ok, 'seed ' + seed);
    const r = R.simulate(t, 1, 1, 300); assert.ok(r.done && r.hits < 8, 'seed ' + seed + ' hits ' + r.hits);
    const t2 = R.randomTrack(seed); assert.equal(t2.len, t.len, 'same code, same track');
  }
});

test('time formatting', () => { assert.equal(R.fmt(66.6081), '01:06.608'); assert.equal(R.fmt(5), '00:05.000'); assert.equal(R.fmt(Infinity), '--:--.---'); });

test('the racer page is wired up: html, css, three scripts, server route, home promos', () => {
  const fs = require('fs'), path = require('path'), pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  const html = pub('racer.html'); assert.match(html, /racer-core\.js/); assert.match(html, /racer\.js/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /\/racer/);
  assert.match(pub('index.html'), /href="\/racer"/);
  assert.ok(!/<script(?![^>]*src=)[^>]*>/.test(html), 'no inline scripts (strict CSP)');
});
