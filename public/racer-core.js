/* BLANION RACER — track geometry, arcade car physics, race rules and an AI driver. Pure maths: no DOM, no WebGL, so Node can test it.
 * Units: metres and seconds. Heading h: forward = (sin h, cos h), right = (cos h, -sin h). Physics runs at a fixed 120 Hz so a race is
 * identical at any frame rate (and a recorded ghost replays exactly). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.RacerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DT = 1 / 120;
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const CAR = {
    ACC: 26, VMAX: 46, BRAKE: 44, VREV: 11, ROLL: 0.5, AERO: 0.0011,
    ALAT: 24,            // max cornering acceleration (m/s^2) on tarmac
    YAW: 2.7,            // max yaw rate at low speed (rad/s)
    GRIP: 10, GRIP_HB: 1.5, OFF_DRAG: 1.1, OFF_CAP: 0.5,
    HALF_LEN: 2.1, RESTITUTION: 0.2,
  };

  /* ----------------------------------------------------------------------------------------------- tracks */
  const TRACKS = [
    { id: 'coral', name: 'Coral Loop', blurb: 'Wide, flowing and friendly. A good warm-up.', width: 16, laps: 3, level: 'EASY',
      pts: [[0, -130], [100, -105], [150, -20], [120, 75], [35, 120], [-65, 95], [-135, 30], [-125, -65], [-60, -115]],
      elev: { amp: 3, waves: [[1, 0], [2, 1.3]] },
      pal: { sky: ['#3aa0e8', '#9fd8fa', '#e8f7ff'], fog: '#bfe6fb', ground: '#79c98a', ground2: '#5fb877', road: '#6b7686', road2: '#737f90', kerbA: '#ff5d4a', kerbB: '#f7f7f7', wall: '#e8f1f8', tree: '#2f9e62', tree2: '#43b873', trunk: '#8a5a3c', rock: '#9aa7b4' } },
    { id: 'tidewater', name: 'Tidewater Run', blurb: 'A hairpin, a chicane and a long drag back.', width: 14, laps: 3, level: 'MEDIUM',
      pts: [[0, 0], [100, -25], [200, -15], [265, 60], [225, 150], [135, 140], [110, 190], [190, 268], [90, 340], [-60, 295], [-80, 190], [-150, 120], [-130, 20], [-65, -20]],
      elev: { amp: 5, waves: [[1, 0.6], [3, 2.1]] },
      pal: { sky: ['#f0884a', '#f7b96d', '#ffe7b8'], fog: '#f6c98c', ground: '#d9b97a', ground2: '#cba76a', road: '#5d6572', road2: '#656e7c', kerbA: '#2b6cff', kerbB: '#ffe27a', wall: '#fff0d0', tree: '#3c8f58', tree2: '#58ad6c', trunk: '#7a4b2b', rock: '#b59a78' } },
    { id: 'trench', name: 'Deep Trench', blurb: 'Narrow, twisty and hilly. Brake early.', width: 12, laps: 3, level: 'HARD',
      pts: [[0, 0], [90, -45], [185, -5], [260, -75], [345, -45], [370, 40], [300, 105], [215, 80], [170, 150], [250, 225], [175, 315], [50, 270], [0, 180], [-95, 195], [-160, 120], [-125, 35], [-75, -25]],
      elev: { amp: 8, waves: [[2, 0.2], [3, 1.7], [5, 0.9]] },
      pal: { sky: ['#0b1f4d', '#1c4a8f', '#3f86c7'], fog: '#1c4a8f', ground: '#1f6f6a', ground2: '#195c5a', road: '#4a5462', road2: '#515b6a', kerbA: '#35e0b0', kerbB: '#0f2740', wall: '#7fe7d1', tree: '#14a085', tree2: '#35e0b0', trunk: '#1d3b52', rock: '#4a7d9a' } },
  ];

  /* seeded RNG */
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  const PALS = [TRACKS[0].pal, TRACKS[1].pal, TRACKS[2].pal];

  /** Closed random circuit from a seed. May fail validation; use randomTrack() which retries. */
  function randomDef(seed) {
    const r = rng(seed * 7919 + 13), n = 9 + Math.floor(r() * 4), pts = [];
    const base = 95 + r() * 40, wob = 0.25 + r() * 0.2;
    const ph = [r() * TAU, r() * TAU, r() * TAU];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (r() - 0.5) * 0.28;
      const k = 1 + wob * Math.sin(2 * a + ph[0]) + wob * 0.6 * Math.sin(3 * a + ph[1]) + (r() - 0.5) * 0.18;
      pts.push([Math.cos(a) * base * k * (1 + 0.25 * Math.sin(a + ph[2])), Math.sin(a) * base * k * 0.9]);
    }
    return { id: 'r' + seed, name: 'Random #' + seed, blurb: 'A fresh circuit from code ' + seed + '.', width: 14, laps: 3, level: 'RANDOM', pts, elev: { amp: 2 + r() * 5, waves: [[1 + Math.floor(r() * 2), r() * TAU], [2 + Math.floor(r() * 3), r() * TAU]] }, pal: PALS[seed % 3], seed };
  }

  /* Closed Catmull-Rom through the control points, resampled every ~2 m with tangent, curvature and height. */
  function buildTrack(def) {
    const P = def.pts, n = P.length, dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i + n - 1) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let k = 0; k < 48; k++) {
        const t = k / 48, t2 = t * t, t3 = t2 * t;
        dense.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    const m = dense.length, cum = [0];
    for (let i = 1; i <= m; i++) { const a = dense[i - 1], b = dense[i % m]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const len0 = cum[m], N = Math.max(60, Math.round(len0 / 2)), ds = len0 / N, pts = [];
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * ds; while (cum[j + 1] < s) j++;
      const a = dense[j], b = dense[(j + 1) % m], f = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      pts.push({ x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f });
    }
    for (let i = 0; i < N; i++) {
      const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      pts[i].tx = dx / l; pts[i].tz = dz / l;
    }
    for (let i = 0; i < N; i++) {
      const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
      let d = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz); while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      pts[i].k = d / (2 * ds);                                      // signed curvature (1/m); + = turning right
    }
    const el = def.elev || { amp: 0, waves: [] };
    for (let i = 0; i < N; i++) {
      let y = 0; for (const [f, ph] of el.waves) y += Math.sin((i / N) * TAU * f + ph) / el.waves.length;
      pts[i].y = y * el.amp;
    }
    // smooth the height so the road never kinks, and pin the start/finish straight to a gentle grade
    for (let pass = 0; pass < 3; pass++) { const ys = pts.map(p => p.y); for (let i = 0; i < N; i++) pts[i].y = (ys[(i + N - 1) % N] + 2 * ys[i] + ys[(i + 1) % N]) / 4; }
    const track = { def, id: def.id, name: def.name, width: def.width, laps: def.laps || 3, pts, N, ds, len: ds * N, half: def.width / 2, barrier: def.width / 2 + 2.6, pal: def.pal };
    // speed profile (what a good driver could carry), used by the AI and for medal times
    const vc = pts.map(p => Math.min(CAR.VMAX, Math.sqrt(CAR.ALAT * 0.86 / Math.max(Math.abs(p.k), 1e-4))));
    const vp = vc.slice();
    for (let pass = 0; pass < 3; pass++) for (let i = N * 2 - 1; i >= 0; i--) { const a = i % N, b = (i + 1) % N; vp[a] = Math.min(vp[a], Math.sqrt(vp[b] * vp[b] + 2 * 30 * ds)); }
    track.vp = vp;
    return track;
  }

  /** nearest centreline position. hint = previous index (fast local search); omit for a full scan. */
  function nearest(track, x, z, hint) {
    const { pts, N, ds } = track; let bi = 0, bd = 1e18, bt = 0;
    const scan = i0 => {
      const i = ((i0 % N) + N) % N, a = pts[i], b = pts[(i + 1) % N], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1), cx = a.x + dx * t, cz = a.z + dz * t, d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d < bd) { bd = d; bi = i; bt = t; }
    };
    if (hint == null || hint < 0) for (let i = 0; i < N; i++) scan(i); else for (let k = -24; k <= 24; k++) scan(hint + k);
    const a = track.pts[bi], b = track.pts[(bi + 1) % N];
    const cx = a.x + (b.x - a.x) * bt, cz = a.z + (b.z - a.z) * bt;
    let tx = a.tx + (b.tx - a.tx) * bt, tz = a.tz + (b.tz - a.tz) * bt; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = tz, rz = -tx;
    return { i: bi, t: bt, s: (bi + bt) * ds, cx, cz, tx, tz, rx, rz, lat: (x - cx) * rx + (z - cz) * rz, y: a.y + (b.y - a.y) * bt };
  }

  /** every sampled point must stay clear of every non-neighbouring part of the road: no crossings, no tight pinches */
  function validate(track) {
    const { pts, N, ds, width } = track; let minGap = 1e9, minR = 1e9;
    const skip = Math.ceil((width * 2.6) / ds) + 6;
    for (let i = 0; i < N; i++) {
      minR = Math.min(minR, 1 / Math.max(Math.abs(pts[i].k), 1e-6));
      for (let j = i + skip; j < N - skip + (i === 0 ? 0 : 0); j++) { if (j >= N) break; const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z); if (d < minGap) minGap = d; }
    }
    return { minGap, minRadius: minR, ok: minGap > width + 2 * 2.6 + 8 && minR > Math.max(14, width) };
  }

  function randomTrack(seed) {
    let s = Math.abs(Math.floor(seed)) || 1;
    for (let tries = 0; tries < 400; tries++, s++) { const t = buildTrack(randomDef(s)); if (validate(t).ok) { t.seed = s; return t; } }
    return buildTrack(TRACKS[0]);
  }

  /* ----------------------------------------------------------------------------------------------- the car */
  function newCar(track, lane) {
    const p = track.pts[track.N - 5], h = Math.atan2(p.tx, p.tz);
    return { x: p.x + p.tz * (lane || 0), z: p.z - p.tx * (lane || 0), h, vx: 0, vz: 0, steer: 0, slip: 0, off: false, hit: 0, idx: track.N - 5, y: p.y, lat: 0, speed: 0, vf: 0, drift: 0 };
  }

  /** advance one fixed step. input: { thr 0..1, brk 0..1, str -1..1 (right +), hb bool } */
  function stepCar(c, inp, track, dt) {
    dt = dt || DT;
    const fx = Math.sin(c.h), fz = Math.cos(c.h), rx = Math.cos(c.h), rz = -Math.sin(c.h);
    let vf = c.vx * fx + c.vz * fz, vl = c.vx * rx + c.vz * rz;
    const thr = clamp(inp.thr || 0, 0, 1), brk = clamp(inp.brk || 0, 0, 1), str = clamp(inp.str || 0, -1, 1), hb = !!inp.hb;
    const cap = c.off ? CAR.VMAX * CAR.OFF_CAP : CAR.VMAX;
    // longitudinal
    let a = 0;
    if (thr > 0) a += thr * CAR.ACC * Math.max(0, 1 - Math.max(0, vf) / cap);
    if (brk > 0) { if (vf > 0.6) a -= brk * CAR.BRAKE; else a -= brk * CAR.ACC * 0.45 * Math.max(0, 1 - Math.max(0, -vf) / CAR.VREV); }
    if (hb) a -= 6 * Math.sign(vf);
    a -= Math.sign(vf) * CAR.ROLL + vf * Math.abs(vf) * CAR.AERO;
    if (c.off) a -= vf * CAR.OFF_DRAG;
    if (vf > cap) a -= (vf - cap) * 2.5;
    const nvf = vf + a * dt;
    if (a !== 0 && thr === 0 && brk === 0 && Math.sign(nvf) !== Math.sign(vf)) vf = 0; else vf = nvf;
    // lateral grip: sideways speed bleeds away; the handbrake lets the tail swing out
    const grip = (hb ? CAR.GRIP_HB : CAR.GRIP) * (c.off ? 0.7 : 1);
    vl *= Math.exp(-grip * dt);
    // steering: yaw rate limited by what the tyres can take
    const sp = Math.abs(vf), lim = Math.min(CAR.YAW, CAR.ALAT / Math.max(sp, 1)), ramp = clamp(sp / 5, 0, 1);
    const target = str * lim * ramp * Math.sign(vf || 1) * (hb ? 1.4 : 1);
    c.steer += (target - c.steer) * Math.min(1, dt * 12);
    c.h += c.steer * dt;
    // recompose velocity in the new heading
    const nfx = Math.sin(c.h), nfz = Math.cos(c.h), nrx = Math.cos(c.h), nrz = -Math.sin(c.h);
    c.vx = nfx * vf + nrx * vl; c.vz = nfz * vf + nrz * vl;
    c.x += c.vx * dt; c.z += c.vz * dt;
    // track surface and barriers
    const q = nearest(track, c.x, c.z, c.idx); c.idx = q.i; c.lat = q.lat; c.y = q.y;
    c.off = Math.abs(q.lat) > track.half + 0.6;
    c.hit = 0;
    const lim2 = track.barrier - 1.1;
    if (Math.abs(q.lat) > lim2) {
      const sgn = Math.sign(q.lat), nx = q.rx * sgn, nz = q.rz * sgn;                        // outward normal
      c.x = q.cx + q.rx * sgn * lim2; c.z = q.cz + q.rz * sgn * lim2;
      const vn = c.vx * nx + c.vz * nz;
      if (vn > 0) {
        c.vx -= (1 + CAR.RESTITUTION) * vn * nx; c.vz -= (1 + CAR.RESTITUTION) * vn * nz;
        { const k = 1 - Math.min(0.5, vn * 0.015); c.vx *= k; c.vz *= k; } c.hit = vn;
        // nose swings back along the wall
        let d = Math.atan2(q.tx, q.tz) - c.h; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
        if (Math.abs(d) < Math.PI * 0.62) c.h += d * Math.min(1, 14 * dt);
      }
    }
    c.vf = c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h); c.speed = Math.hypot(c.vx, c.vz);
    c.drift = Math.abs(vl);
    return c;
  }

  /* ----------------------------------------------------------------------------------------------- a race */
  function newRace(track, laps) {
    const car = newCar(track, 0), st = nearest(track, car.x, car.z, -1);
    return { track, laps: laps || track.laps, car, ticks: 0, total: st.s - track.len, last: st.s, lapTimes: [], lapStart: 0, done: false, hits: 0, bestLap: Infinity, time: 0 };
  }
  /** one fixed step of a race; returns events: 'lap' (with time) / 'finish' */
  function stepRace(r, inp) {
    if (r.done) return [];
    stepCar(r.car, inp, r.track, DT); r.ticks++;
    const ev = [], q = r.track.len, sNow = nearest(r.track, r.car.x, r.car.z, r.car.idx).s;
    let d = sNow - r.last; if (d > q / 2) d -= q; else if (d < -q / 2) d += q;
    const before = r.total; r.total += d; r.last = sNow; r.time = r.ticks * DT;
    if (r.car.hit > 4) r.hits++;
    const cross = need => (need - before) / ((r.total - before) || 1);
    if (before < 0 && r.total >= 0) r.lapStart = (r.ticks - 1 + cross(0)) * DT;           // lap 1 starts when the car first crosses the line
    const need = q * (r.lapTimes.length + 1);                                              // each completed lap adds one track length
    if (before < need && r.total >= need) {
      const tCross = (r.ticks - 1 + cross(need)) * DT, lt = tCross - r.lapStart;
      r.lapTimes.push(lt); r.lapStart = tCross; r.bestLap = Math.min(r.bestLap, lt); ev.push({ type: 'lap', n: r.lapTimes.length, time: lt });
      if (r.lapTimes.length >= r.laps) { r.done = true; r.finishTime = tCross; ev.push({ type: 'finish', time: tCross }); }
    }
    return ev;
  }
  /** lap 0 starts when the car first crosses the line (start grid is behind it) */
  function started(r) { return r.total >= 0; }

  /* ----------------------------------------------------------------------------------------------- AI driver */
  function bot(track, skill) {
    const k = skill == null ? 1 : skill;
    return function drive(c) {
      const { pts, N, ds, vp } = track, v = Math.max(c.speed, 0.1);
      const L = clamp(Math.round((7 + 0.45 * v) / ds), 3, 40), T = pts[(c.idx + L) % N];
      const dx = T.x - c.x, dz = T.z - c.z, fx = Math.sin(c.h), fz = Math.cos(c.h), rx = Math.cos(c.h), rz = -Math.sin(c.h);
      const alpha = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      const str = clamp(alpha * 1.9, -1, 1);
      const ahead = Math.round(clamp(v * 0.35, 4, 60) / ds), vt = vp[(c.idx + ahead) % N] * k;
      return { thr: c.vf < vt ? 1 : 0, brk: c.vf > vt * 1.05 ? clamp((c.vf - vt) / 6, 0.3, 1) : 0, str, hb: false };
    };
  }

  /** drive a full race with the AI; returns the Race (used by tests and for medal times) */
  function simulate(track, laps, skill, maxSeconds) {
    const r = newRace(track, laps), drive = bot(track, skill), maxT = Math.round((maxSeconds || 400) / DT);
    while (!r.done && r.ticks < maxT) stepRace(r, drive(r.car));
    return r;
  }
  const medalTimes = (track, laps) => { const r = simulate(track, laps || track.laps, 1, 600), t = r.done ? r.finishTime : 999; return { gold: t * 1.03, silver: t * 1.14, bronze: t * 1.32, bot: t }; };

  const fmt = t => { if (!isFinite(t)) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(3); };

  return { DT, CAR, TRACKS, buildTrack, randomTrack, randomDef, validate, nearest, newCar, stepCar, newRace, stepRace, started, bot, simulate, medalTimes, fmt, rng };
});
