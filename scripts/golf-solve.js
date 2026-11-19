'use strict';
/* Brute-force solver for the mini-golf holes: finds shot sequences that sink the ball within `par` strokes.
 *   node scripts/golf-solve.js [holeIndex]      prints solutions as JSON (used as fixtures in tests/golf.test.js)
 * Shots are [angleDeg, power 0..1, waitSeconds]; waitSeconds lets the shot be timed against moving spinners. */
const G = require('../public/golf-physics.js');
const V = (p) => G.V_MAX * Math.pow(p, 1.35);          // must match the game's power curve

function run(hole, shots) {                              // replay a list of shots, return {state, strokes, rests}
  const sim = G.createSim(hole); let strokes = 0; const rests = [];
  for (const [ang, p, wait] of shots) {
    sim.step(wait || 0);
    const a = ang * Math.PI / 180; sim.shoot(Math.cos(a), Math.sin(a), V(p)); strokes++;
    const st = sim.settle(14, 1 / 120);
    if (st === 'water') { strokes++; sim.respawn(); }
    rests.push([sim.ball.x, sim.ball.y, st]);
    if (st === 'sinking' || sim.state === 'sunk') { sim.settle(1, 1 / 120); return { sunk: true, strokes, rests }; }
  }
  return { sunk: false, strokes, rests };
}

function search(hole, par, opts = {}) {
  const angStep = opts.angStep || 3, powers = opts.powers || [0.18, 0.28, 0.38, 0.48, 0.58, 0.7, 0.82, 0.95];
  const waits = hole.spinners ? [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6] : [0];
  let beam = [{ shots: [], x: hole.tee[0], y: hole.tee[1], sim: null }];
  const dist = (x, y) => Math.hypot(x - hole.cup[0], y - hole.cup[1]);
  for (let depth = 0; depth < par; depth++) {
    const next = new Map();
    for (const node of beam) {
      for (let ang = 0; ang < 360; ang += angStep) for (const p of powers) for (const w of waits) {
        const shots = node.shots.concat([[ang, p, w]]);
        const r = run(hole, shots);
        if (r.sunk && r.strokes <= par) return shots;
        const last = r.rests[r.rests.length - 1];
        if (!last || last[2] !== 'rest' || r.strokes >= par) continue;
        const key = Math.round(last[0] / 0.4) + ',' + Math.round(last[1] / 0.4);
        const score = dist(last[0], last[1]);
        if (!next.has(key) || next.get(key).score > score) next.set(key, { shots, x: last[0], y: last[1], score });
      }
    }
    beam = [...next.values()].sort((a, b) => a.score - b.score).slice(0, opts.beam || 30);
    if (!beam.length) return null;
  }
  return null;
}

if (require.main === module) {
  const only = process.argv[2] != null ? Number(process.argv[2]) : null;
  G.HOLES.forEach((h, i) => {
    if (only != null && only !== i) return;
    const t0 = Date.now();
    for (let par = 1; par <= h.par; par++) {
      const sol = search(h, par);
      console.log(`hole ${h.id} (${h.name}) par ${h.par}: ${sol ? 'solved in ' + par + ' stroke(s)' : 'no ' + par + '-stroke solution'}  ${sol ? JSON.stringify(sol) : ''}  [${Date.now() - t0} ms]`);
      if (sol) break;
    }
  });
}
module.exports = { run, search, V };
