/* BLANION MINI GOLF — course data + 2D physics (top-down). No rendering here, so it runs in Node for tests. UMD: window.GolfPhysics / require().
 * Coordinates are metres-ish: x to the right, y "up the course". A ball is a circle; walls are line segments. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.GolfPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BALL_R = 0.1, HOLE_R = 0.17;
  const V_MAX = 9.5;              // fastest putt (units/s)
  const GREEN_FRIC = 3.0;         // rolling deceleration on grass (units/s^2)
  const SAND_FRIC = 15;           // ...in sand
  const REST_SPEED = 0.07;
  const WALL_E = 0.74;            // wall restitution
  const MAX_STROKES = 8;

  /* ------------------------------------------------------------------ the three holes */
  const HOLES = [
    {
      id: 1, name: 'Gentle Dogleg', par: 2, blurb: 'Warm-up: bend it round the corner.',
      outline: [[-1.2, -1.0], [1.2, -1.0], [1.2, 3.6], [6.6, 3.6], [6.6, 6.2], [-1.2, 6.2]],
      tee: [0, 0], cup: [5.5, 4.9], view: { yaw: 90 },
      bumpers: [{ x: 3.4, y: 4.9, r: 0.28, kick: 1.08 }],
    },
    {
      id: 2, name: 'Spinner Alley', par: 3, blurb: 'Time the spinning arms. Mind the sand.',
      outline: [[-1.15, -1.0], [1.15, -1.0], [1.15, 11.0], [-1.15, 11.0]],
      tee: [0, 0], cup: [0, 9.6],
      spinners: [{ x: 0, y: 6.0, len: 1.0, arms: 4, omega: 1.6, phase: 0.3, w: 0.05, hub: 0.2 }],
      sand: [{ type: 'circle', x: -0.8, y: 9.1, r: 0.5 }, { type: 'circle', x: 0.8, y: 9.1, r: 0.5 }],
    },
    {
      id: 3, name: 'Pond Crossing', par: 3, blurb: 'Use the bridge. Splash = one stroke penalty.',
      outline: [[-2.4, -1.0], [2.4, -1.0], [2.4, 9.5], [-2.4, 9.5]],
      tee: [-1.5, 0.2], cup: [-1.5, 8.2],
      water: [{ type: 'poly', pts: [[-2.4, 3.2], [1.0, 3.2], [1.0, 5.2], [-2.4, 5.2]] }],
      bumpers: [{ x: 1.7, y: 6.3, r: 0.3, kick: 1.08 }],
      slopes: [{ zone: { type: 'poly', pts: [[-2.4, 6.8], [2.4, 6.8], [2.4, 9.5], [-2.4, 9.5]] }, ax: 0.9, ay: 0 }],
    },
  ];

  /* ------------------------------------------------------------------ geometry helpers */
  function pointInPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inZone = (z, x, y) => (z.type === 'circle' ? (x - z.x) ** 2 + (y - z.y) ** 2 <= z.r * z.r : pointInPoly(z.pts, x, y));

  function holeSegments(h) {
    const segs = [], push = pts => { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push([a[0], a[1], b[0], b[1]]); } };
    push(h.outline);
    for (const b of h.blocks || []) push(b.pts);
    return segs;
  }

  /* ------------------------------------------------------------------ simulation */
  function createSim(hole, opts = {}) {
    const segs = holeSegments(hole);
    const sim = {
      hole, t: 0,
      ball: { x: hole.tee[0], y: hole.tee[1], vx: 0, vy: 0 },
      state: 'rest',                    // rest | rolling | sinking | sunk | water
      sink: { t: 0 }, events: [], restPos: [hole.tee[0], hole.tee[1]],
      spinners: (hole.spinners || []).map(s => ({ ...s, angle: s.phase || 0 })),
    };

    function emit(type, speed, x, y, extra) { sim.events.push({ type, speed: speed || 0, x, y, ...(extra || {}) }); }

    /** circle vs segment; returns true on contact */
    function collideSegment(b, ax, ay, bx, by, e, kind) {
      const abx = bx - ax, aby = by - ay, len2 = abx * abx + aby * aby;
      let u = len2 ? ((b.x - ax) * abx + (b.y - ay) * aby) / len2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = ax + abx * u, py = ay + aby * u;
      let dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy);
      if (d >= BALL_R) return false;
      if (d < 1e-9) { const l = Math.sqrt(len2) || 1; dx = -aby / l; dy = abx / l; d = 1e-9; } else { dx /= d; dy /= d; }
      b.x = px + dx * BALL_R; b.y = py + dy * BALL_R;
      const vn = b.vx * dx + b.vy * dy;
      if (vn < 0) {
        b.vx -= (1 + e) * vn * dx; b.vy -= (1 + e) * vn * dy;
        const tx = -dy, ty = dx, vt = b.vx * tx + b.vy * ty; b.vx -= vt * 0.03 * tx; b.vy -= vt * 0.03 * ty;
        if (-vn > 0.25) emit(kind || 'wall', -vn, px, py);
      }
      return true;
    }

    function collideStatic(b, emitEvents = true) {
      let hit = false;
      for (const s of segs) { if (collideSegment(b, s[0], s[1], s[2], s[3], WALL_E)) hit = true; }
      for (const m of hole.bumpers || []) {
        const dx = b.x - m.x, dy = b.y - m.y, d = Math.hypot(dx, dy), rr = m.r + BALL_R;
        if (d < rr) {
          const nx = dx / (d || 1), ny = dy / (d || 1); b.x = m.x + nx * rr; b.y = m.y + ny * rr;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) { const e = m.kick || 1; b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; if (emitEvents && -vn > 0.25) emit('bumper', -vn, m.x + nx * m.r, m.y + ny * m.r, { bumper: m }); }
          hit = true;
        }
      }
      for (const s of sim.spinners) {                                   // the hub is solid
        if (!s.hub) continue;
        const dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy), rr = s.hub + BALL_R;
        if (d < rr) { const nx = dx / (d || 1), ny = dy / (d || 1); b.x = s.x + nx * rr; b.y = s.y + ny * rr; const vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; if (emitEvents && -vn > 0.25) emit('wall', -vn, s.x + nx * s.hub, s.y + ny * s.hub); } }
      }
      return hit;
    }

    function collideSpinners(b) {
      for (const s of sim.spinners) {
        const w = s.omega, hubVx = 0, hubVy = 0;
        for (let k = 0; k < s.arms; k++) {
          const a = s.angle + (k * 2 * Math.PI) / s.arms, ex = s.x + Math.cos(a) * s.len, ey = s.y + Math.sin(a) * s.len;
          const abx = ex - s.x, aby = ey - s.y, len2 = abx * abx + aby * aby;
          let u = ((b.x - s.x) * abx + (b.y - s.y) * aby) / len2; u = u < 0 ? 0 : u > 1 ? 1 : u;
          const px = s.x + abx * u, py = s.y + aby * u, dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy), rr = BALL_R + s.w;
          if (d >= rr) continue;
          const nx = dx / (d || 1), ny = dy / (d || 1);
          b.x = px + nx * rr; b.y = py + ny * rr;
          const sx = -w * (py - s.y) + hubVx, sy = w * (px - s.x) + hubVy;      // surface velocity of the arm at the contact point
          const rvx = b.vx - sx, rvy = b.vy - sy, vn = rvx * nx + rvy * ny;
          if (vn < 0) { b.vx = sx + rvx - 1.85 * vn * nx; b.vy = sy + rvy - 1.85 * vn * ny; emit('blade', -vn, px, py); }
          else { b.vx += nx * 0.0; }
        }
      }
    }

    function frictionAt(x, y) {
      for (const z of hole.sand || []) if (inZone(z, x, y)) return SAND_FRIC;
      return GREEN_FRIC;
    }

    /** advance by dt seconds (internally sub-stepped so the ball cannot tunnel) */
    sim.step = function (dt) {
      const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
      for (let i = 0; i < n; i++) micro(h);
    };

    function micro(h) {
      sim.t += h;
      for (const s of sim.spinners) s.angle += s.omega * h;
      const b = sim.ball;
      if (sim.state === 'sinking') {
        sim.sink.t += h; const k = Math.min(1, sim.sink.t / 0.35);
        b.x += (hole.cup[0] - b.x) * Math.min(1, h * 18); b.y += (hole.cup[1] - b.y) * Math.min(1, h * 18);
        if (k >= 1) { sim.state = 'sunk'; emit('sunk', 0, hole.cup[0], hole.cup[1]); }
        return;
      }
      if (sim.state === 'sunk' || sim.state === 'water') return;
      if (sim.state === 'rest') { collideSpinners(b); collideStatic(b, false); if (Math.hypot(b.vx, b.vy) > 0) sim.state = 'rolling'; else return; }

      b.x += b.vx * h; b.y += b.vy * h;
      collideStatic(b); collideSpinners(b);

      const sp = Math.hypot(b.vx, b.vy);
      // surface: friction, slopes
      let ax = 0, ay = 0;
      for (const s of hole.slopes || []) if (inZone(s.zone, b.x, b.y)) { ax += s.ax; ay += s.ay; }
      const f = frictionAt(b.x, b.y);
      if (sp > 1e-6) { const d = Math.min(sp, f * h); b.vx -= (b.vx / sp) * d; b.vy -= (b.vy / sp) * d; }
      b.vx += ax * h; b.vy += ay * h;

      // water
      for (const z of hole.water || []) if (inZone(z, b.x, b.y)) { sim.state = 'water'; emit('water', sp, b.x, b.y); return; }

      // the cup
      const dc = Math.hypot(b.x - hole.cup[0], b.y - hole.cup[1]), sp2 = Math.hypot(b.vx, b.vy);
      if (dc < HOLE_R * 1.5 && sp2 < 2.4) { const pull = 7 * (1 - dc / (HOLE_R * 1.5)); b.vx += ((hole.cup[0] - b.x) / (dc || 1)) * pull * h; b.vy += ((hole.cup[1] - b.y) / (dc || 1)) * pull * h; }
      if (dc < HOLE_R * 0.85 && sp2 < 3.0) { sim.state = 'sinking'; sim.sink.t = 0; emit('cup', sp2, b.x, b.y); return; }

      // resting?
      const moving = Math.hypot(b.vx, b.vy);
      const onSlope = (hole.slopes || []).some(s => inZone(s.zone, b.x, b.y));
      if (moving < REST_SPEED && (!onSlope || moving < 0.02)) { b.vx = b.vy = 0; sim.state = 'rest'; sim.restPos = [b.x, b.y]; emit('rest', 0, b.x, b.y); }
    }

    /** putt: dir is a unit vector, speed in units/s */
    sim.shoot = function (dx, dy, speed) {
      if (sim.state !== 'rest') return false;
      const l = Math.hypot(dx, dy) || 1, v = Math.max(0, Math.min(V_MAX, speed));
      sim.ball.vx = (dx / l) * v; sim.ball.vy = (dy / l) * v; sim.state = 'rolling'; sim.restPos = [sim.ball.x, sim.ball.y];
      emit('putt', v, sim.ball.x, sim.ball.y); return true;
    };
    /** after a splash: put the ball back where it was hit from */
    sim.respawn = function () { sim.ball.x = sim.restPos[0]; sim.ball.y = sim.restPos[1]; sim.ball.vx = sim.ball.vy = 0; sim.state = 'rest'; };
    sim.drain = function () { const e = sim.events; sim.events = []; return e; };

    /** run until the ball stops / sinks / splashes (for the solver and tests) */
    sim.settle = function (maxT = 14, dt = 1 / 120) {
      let T = 0; while ((sim.state === 'rolling' || sim.state === 'sinking') && T < maxT) { sim.step(dt); T += dt; } return sim.state;
    };

    /** guide line for aiming: where would a putt go (walls and bumpers only), for `maxLen` units of travel */
    sim.predict = function (dx, dy, speed, maxLen = 3.4) {
      const b = { x: sim.ball.x, y: sim.ball.y, vx: 0, vy: 0 }, l = Math.hypot(dx, dy) || 1;
      b.vx = (dx / l) * Math.min(V_MAX, speed); b.vy = (dy / l) * Math.min(V_MAX, speed);
      const pts = [[b.x, b.y]]; let travelled = 0, since = 0; const h = 1 / 200;
      for (let i = 0; i < 4000 && travelled < maxLen; i++) {
        const px = b.x, py = b.y; b.x += b.vx * h; b.y += b.vy * h; const hit = collideStatic(b, false);
        const sp = Math.hypot(b.vx, b.vy); if (sp < 0.15) break;
        const d = Math.hypot(b.x - px, b.y - py); travelled += d; since += d;
        const f = frictionAt(b.x, b.y); b.vx -= (b.vx / sp) * Math.min(sp, f * h); b.vy -= (b.vy / sp) * Math.min(sp, f * h);
        if (hit || since > 0.22) { pts.push([b.x, b.y]); since = 0; }
      }
      pts.push([b.x, b.y]); return pts;
    };

    return sim;
  }

  /** result name for a score */
  function scoreName(strokes, par) {
    if (strokes === 1) return 'HOLE IN ONE!';
    const d = strokes - par;
    return d <= -3 ? 'ALBATROSS!' : d === -2 ? 'EAGLE!' : d === -1 ? 'BIRDIE!' : d === 0 ? 'PAR' : d === 1 ? 'BOGEY' : d === 2 ? 'DOUBLE BOGEY' : '+' + d;
  }

  return { HOLES, BALL_R, HOLE_R, V_MAX, MAX_STROKES, GREEN_FRIC, SAND_FRIC, createSim, pointInPoly, inZone, holeSegments, scoreName };
});
