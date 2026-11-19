/* "Blinny" — the BLANION mascot: a little deep-sea angler with a lantern that glows brighter the deeper it dives. */
(function (root) {
  'use strict';
  const PAL = { o: '#0a1530', B: '#ff7a59', L: '#ffd0a6', w: '#ffffff', k: '#0a1530', y: '#fff27a', Y: '#ffffff', s: '#c2412d', f: '#ff9d6f', t: '#ffffff' };
  const BODY = [
    '.........yyy..',
    '........yYYYy.',
    '.........yyy..',
    '.......s......',
    '....ooooso....',
    '..ooBBBBBBoo..',
    '.oBBBBBBBBBBo.',
    'oBBBBBBBBwkBBo',
    'oBBBBBBBBBBBBo',
    'oBBBBBBBBBttBo',
    '.oLLLLLLLLLLo.',
    '..ooLLLLLLoo..',
    '....oooooo....',
  ];
  const W = 14, H = 13, TAIL_W = 4;

  /** draw sprite with its body's top-left at (x,y); px = size of one sprite pixel. t = seconds (for tail wiggle). */
  function draw(ctx, x, y, t, px) {
    px = px || 1;
    x = Math.round(x); y = Math.round(y);
    const rect = (cx, cy, c) => { ctx.fillStyle = c; ctx.fillRect(x + cx * px, y + cy * px, px, px); };
    // tail (animated)
    const wig = Math.sin(t * 7);
    for (let i = 0; i < TAIL_W; i++) {
      const half = [3, 2, 1, 0][i];
      const c = 8 + Math.round(wig * (3 - i) / 1.5);
      for (let r = -half; r <= half; r++) rect(i - TAIL_W, c + r, Math.abs(r) === half && half > 0 ? PAL.s : PAL.f);
    }
    // top & bottom fins
    rect(5, 4, PAL.s); rect(6, 3, PAL.f);
    // body
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const ch = BODY[r][c];
      if (ch !== '.') rect(c, r, PAL[ch]);
    }
    // blink
    if (Math.sin(t * 1.3) > 0.985) rect(9, 7, PAL.B);
  }
  /** Lantern position (sprite px) relative to body top-left, for glow effects. */
  const LANTERN = { x: 10.5, y: 1.5 };

  /** Animate the mascot into a small DOM canvas (logo, results, etc.) */
  function mount(canvas, px) {
    px = px || 3;
    canvas.width = (W + TAIL_W) * px; canvas.height = (H + 2) * px;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function tick() {
      const t = performance.now() / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(ctx, TAIL_W * px, (1 + (reduce ? 0 : Math.round(Math.sin(t * 2)))) * px, t, px);
    }
    tick();
    if (!reduce) setInterval(tick, 110);
  }

  const api = { draw, mount, W, H, TAIL_W, LANTERN, PAL, BODY };
  if (typeof module !== 'undefined') module.exports = api; else root.Mascot = api;
})(typeof window !== 'undefined' ? window : globalThis);
