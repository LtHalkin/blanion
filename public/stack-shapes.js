/* BLANION STACK — shared block catalogue + daily sequence. Loaded by the browser (stack.js) AND by the server (to sanity-check
 * submitted scores against the same blocks). UMD: window.StackShapes / require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.StackShapes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TOTAL = 20, PX_PER_M = 8;

  // kind: rect {w,h} · poly {v:[[x,y]...]} (convex) · circle {r} · hex {r} · compound {parts:[[x,y,w,h]...]}
  // tag: 'hard' = awkward to balance (limited to 3 per game) · 'friendly' = easy to build with (at least 7 per game)
  const SHAPES = [
    { name: 'plank',     kind: 'rect', w: 58, h: 9,  tag: 'friendly' },
    { name: 'beam',      kind: 'rect', w: 42, h: 12, tag: 'friendly' },
    { name: 'slab',      kind: 'rect', w: 30, h: 17, tag: 'friendly' },
    { name: 'brick',     kind: 'rect', w: 24, h: 12, tag: 'friendly' },
    { name: 'cube',      kind: 'rect', w: 22, h: 22, tag: 'friendly' },
    { name: 'big cube',  kind: 'rect', w: 32, h: 32, tag: 'friendly' },
    { name: 'post',      kind: 'rect', w: 16, h: 32 },
    { name: 'pillar',    kind: 'rect', w: 19, h: 28 },
    { name: 'triangle',  kind: 'poly', v: [[-21, 12], [21, 12], [0, -12]] },
    { name: 'small tri', kind: 'poly', v: [[-13, 10], [13, 10], [0, -10]], tag: 'hard' },
    { name: 'wedge',     kind: 'poly', v: [[-19, 8], [19, 8], [19, -8]], tag: 'hard' },
    { name: 'trapezoid', kind: 'poly', v: [[-23, 9], [23, 9], [12, -9], [-12, -9]], tag: 'friendly' },
    { name: 'hexagon',   kind: 'hex', r: 15 },
    { name: 'wheel',     kind: 'circle', r: 12, tag: 'hard' },
    { name: 'T',         kind: 'compound', parts: [[0, -11, 46, 10], [0, 4, 12, 22]] },
    { name: 'L',         kind: 'compound', parts: [[-7, 0, 12, 36], [6, 12, 26, 12]] },
    { name: 'plus',      kind: 'compound', parts: [[0, 0, 36, 12], [0, 0, 12, 36]] },
  ];
  const COLORS = ['#ff7a59', '#ffd54f', '#5be3a1', '#4fc3f7', '#e056fd', '#ff9f43', '#9bb8d8'];

  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** 20 blocks: never the same shape twice in a row, at most 3 awkward ones, at least 7 easy ones. Deterministic for a given RNG. */
  function makeSequence(rand) {
    let seq;
    for (let attempt = 0; attempt < 300; attempt++) {
      seq = []; let last = -1;
      while (seq.length < TOTAL) {
        let i; do { i = Math.floor(rand() * SHAPES.length); } while (i === last);
        seq.push({ shape: i, color: COLORS[Math.floor(rand() * COLORS.length)] }); last = i;
      }
      const hard = seq.filter(p => SHAPES[p.shape].tag === 'hard').length, easy = seq.filter(p => SHAPES[p.shape].tag === 'friendly').length;
      if (hard <= 3 && easy >= 7) break;
    }
    return seq;
  }
  const sequenceFor = key => makeSequence(mulberry32(hashStr('blanion-stack:' + key)));

  function points(def) {
    if (def.kind === 'rect') { const a = def.w / 2, b = def.h / 2; return [[-a, -b], [a, -b], [a, b], [-a, b]]; }
    if (def.kind === 'poly') return def.v;
    if (def.kind === 'circle' || def.kind === 'hex') return [[-def.r, 0], [def.r, 0]];
    return def.parts.flatMap(([x, y, w, h]) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]]);
  }
  /** largest distance between two points of the block: the most height it can possibly add to a tower */
  function diameter(def) {
    const p = points(def); let d = 0;
    for (const a of p) for (const b of p) d = Math.max(d, Math.hypot(a[0] - b[0], a[1] - b[1]));
    return d;
  }
  /** physical upper bound (metres) for a tower built from a sequence — used to reject impossible submitted scores */
  const maxHeightMetres = seq => seq.reduce((s, p) => s + diameter(SHAPES[p.shape]), 0) / PX_PER_M;

  return { TOTAL, PX_PER_M, SHAPES, COLORS, mulberry32, hashStr, makeSequence, sequenceFor, diameter, maxHeightMetres };
});
