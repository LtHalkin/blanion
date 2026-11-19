'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../public/golf-physics.js');
const { run } = require('../scripts/golf-solve.js');

const flat = () => ({ id: 0, name: 'flat', par: 2, outline: [[-1.5, -1], [1.5, -1], [1.5, 12], [-1.5, 12]], tee: [0, 0], cup: [0, 10] });

test('rolling: a putt decelerates at the green friction and stops where physics says', () => {
  const sim = G.createSim(flat()); sim.shoot(0, 1, 4);
  assert.equal(sim.settle(), 'rest');
  const expected = (4 * 4) / (2 * G.GREEN_FRIC);
  assert.ok(Math.abs(sim.ball.y - expected) < 0.12, `rolled ${sim.ball.y.toFixed(2)}, expected ~${expected.toFixed(2)}`);
  assert.ok(Math.abs(sim.ball.x) < 1e-6, 'straight line');
});

test('walls reflect the ball with restitution and the ball never leaves the course', () => {
  const sim = G.createSim(flat()); sim.ball.y = 2; sim.shoot(1, 0, 6);      // straight at the right wall
  let maxX = 0, bounced = false;
  for (let i = 0; i < 2400 && sim.state === 'rolling'; i++) { sim.step(1 / 120); maxX = Math.max(maxX, sim.ball.x); if (sim.ball.vx < 0) bounced = true; }
  assert.ok(bounced, 'came back'); assert.ok(maxX <= 1.5 - G.BALL_R + 1e-6, 'stayed inside: ' + maxX);
  const ev = sim.drain(); assert.ok(ev.some(e => e.type === 'wall' && e.speed > 3));
});

test('no tunnelling at maximum speed in any hole, from any angle', () => {
  for (const hole of G.HOLES) for (let a = 0; a < 360; a += 15) {
    const sim = G.createSim(hole); const r = a * Math.PI / 180; sim.shoot(Math.cos(r), Math.sin(r), G.V_MAX); sim.settle();
    assert.ok(Number.isFinite(sim.ball.x) && Number.isFinite(sim.ball.y));
    assert.ok(G.pointInPoly(hole.outline, sim.ball.x, sim.ball.y), `hole ${hole.id} angle ${a}: ball escaped to ${sim.ball.x.toFixed(2)},${sim.ball.y.toFixed(2)}`);
  }
});

test('the cup: a gentle putt drops, a fast one skips over', () => {
  let sim = G.createSim(flat()); sim.shoot(0, 1, Math.sqrt(2 * G.GREEN_FRIC * 10.15)); sim.settle();
  assert.equal(sim.state, 'sunk'); assert.ok(sim.drain().some(e => e.type === 'cup'));
  // fast: arrives at the cup at ~4.6 u/s (> the 3.0 capture limit), so the first pass must not sink
  sim = G.createSim(flat()); sim.shoot(0, 1, 9);
  while (sim.ball.y < 10.6 && sim.state === 'rolling') sim.step(1 / 240);
  assert.ok(sim.ball.y >= 10.6, 'reached the far side of the cup'); assert.ok(!['sinking', 'sunk'].includes(sim.state), 'must not sink at speed');
});

test('water: entering the pond splashes; respawn returns the ball to where it was hit from', () => {
  const hole = G.HOLES[2], sim = G.createSim(hole);
  const dx = hole.cup[0] - hole.tee[0], dy = hole.cup[1] - hole.tee[1];
  sim.shoot(dx, dy, 7); assert.equal(sim.settle(), 'water');
  assert.ok(sim.drain().some(e => e.type === 'water'));
  sim.respawn(); assert.equal(sim.state, 'rest'); assert.deepEqual([sim.ball.x, sim.ball.y], hole.tee);
});

test('sand slows the ball far more than grass', () => {
  const hole = { ...flat(), sand: [{ type: 'circle', x: 0, y: 3, r: 1.2 }] };
  const a = G.createSim(flat()), b = G.createSim(hole);
  a.shoot(0, 1, 5); b.shoot(0, 1, 5); a.settle(); b.settle();
  assert.ok(b.ball.y < a.ball.y - 1.5, `sand ${b.ball.y.toFixed(2)} vs grass ${a.ball.y.toFixed(2)}`);
});

test('slopes deflect a moving ball (a resting ball stays put: the slope is gentler than the grip)', () => {
  const hole = { ...flat(), slopes: [{ zone: { type: 'poly', pts: [[-1.5, 0.5], [1.5, 0.5], [1.5, 8], [-1.5, 8]] }, ax: 1.2, ay: 0 }] };
  const sim = G.createSim(hole); sim.shoot(0, 1, 4.5); sim.settle();
  assert.ok(sim.ball.x > 0.15, 'drifted sideways: ' + sim.ball.x.toFixed(3));
  const still = G.createSim(hole); still.ball.y = 3; still.restPos = [0, 3]; for (let i = 0; i < 240; i++) still.step(1 / 120);
  assert.equal(still.ball.x, 0);
});

test('spinner arms knock the ball away and never let it through', () => {
  const hole = G.HOLES[1], sim = G.createSim(hole), s = sim.spinners[0];
  sim.ball.x = s.x + 0.5; sim.ball.y = s.y + 0.5; sim.restPos = [sim.ball.x, sim.ball.y];       // sitting in the arms' path
  let blade = false;
  for (let i = 0; i < 2400; i++) { sim.step(1 / 120); if (sim.drain().some(e => e.type === 'blade')) blade = true; assert.ok(Number.isFinite(sim.ball.x)); }
  assert.ok(blade, 'an arm hit the ball');
  const fast = G.createSim(hole); fast.shoot(0, 1, G.V_MAX); fast.settle();
  assert.ok(G.pointInPoly(hole.outline, fast.ball.x, fast.ball.y));
});

test('determinism: the same shots give exactly the same result', () => {
  const shots = [[135, 0.95, 0], [30, 0.7, 0]];
  assert.deepEqual(run(G.HOLES[0], shots), run(G.HOLES[0], shots));
});

test('every hole is fair: a par-or-better solution exists (found by scripts/golf-solve.js)', () => {
  const solutions = [
    [[135, 0.95, 0], [30, 0.7, 0]],     // hole 1: two strokes, par 2
    [[84, 0.82, 1.2]],                  // hole 2: a timed hole in one (par 3)
    [[45, 0.95, 0], [18, 0.95, 0]],     // hole 3: bank, then over the bridge (par 3)
  ];
  G.HOLES.forEach((h, i) => { const r = run(h, solutions[i]); assert.ok(r.sunk, `hole ${h.id} solution no longer sinks: ${JSON.stringify(r.rests)}`); assert.ok(r.strokes <= h.par, `hole ${h.id}: ${r.strokes} strokes > par ${h.par}`); });
});

test('score names', () => {
  assert.equal(G.scoreName(1, 3), 'HOLE IN ONE!'); assert.equal(G.scoreName(2, 4), 'EAGLE!'); assert.equal(G.scoreName(2, 3), 'BIRDIE!');
  assert.equal(G.scoreName(3, 3), 'PAR'); assert.equal(G.scoreName(4, 3), 'BOGEY'); assert.equal(G.scoreName(5, 3), 'DOUBLE BOGEY'); assert.equal(G.scoreName(7, 3), '+4');
});
