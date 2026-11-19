/* Ocean renderer: pixelated underwater world that darkens as the mascot dives. */
(function () {
  'use strict';
  const canvas = document.getElementById('ocean');
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speed = reduce ? 0.25 : 1;

  // [depth, top colour, bottom colour]
  const STOPS = [
    [0.00, [70, 190, 235], [18, 112, 178]],
    [0.20, [30, 150, 205], [10, 78, 138]],
    [0.45, [14, 96, 160], [8, 48, 96]],
    [0.70, [9, 48, 94], [4, 26, 56]],
    [1.00, [4, 12, 34], [1, 4, 15]],
  ];
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  const css = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a == null ? 1 : a})`;
  function zoneColors(d) {
    for (let i = 1; i < STOPS.length; i++) {
      if (d <= STOPS[i][0]) {
        const t = (d - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]);
        return [mix(STOPS[i - 1][1], STOPS[i][1], t), mix(STOPS[i - 1][2], STOPS[i][2], t)];
      }
    }
    return [STOPS[4][1], STOPS[4][2]];
  }

  let S = 4, w = 0, h = 0, W = 0, H = 0;
  const off = document.createElement('canvas');
  const o = off.getContext('2d');
  let target = 0, depth = 0, t0 = performance.now();
  let bubbles = [], snow = [], orbs = [], burst = [], kelp = [];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function resize() {
    W = innerWidth; H = innerHeight;
    S = W < 700 ? 3 : 4;
    w = Math.ceil(W / S); h = Math.ceil(H / S);
    off.width = w; off.height = h;
    canvas.width = w; canvas.height = h;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    bubbles = Array.from({ length: Math.round(w / 6) }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(1, 3.4), sp: rnd(0.12, 0.5), ph: rnd(0, 6.28) }));
    snow = Array.from({ length: Math.round(w / 2.5) }, () => ({ x: rnd(0, w), y: rnd(0, h), sp: rnd(0.04, 0.18), dr: rnd(-0.05, 0.05), a: rnd(0.2, 0.6) }));
    orbs = Array.from({ length: 22 }, () => ({ x: rnd(0, w), y: rnd(0, h), ph: rnd(0, 6.28), hue: [[120, 255, 220], [255, 120, 220], [150, 190, 255], [200, 255, 120]][(Math.random() * 4) | 0], sp: rnd(0.02, 0.08) }));
    kelp = Array.from({ length: Math.round(w / 14) }, (_, i) => ({ x: i * 14 + rnd(0, 8), hgt: rnd(14, 38), ph: rnd(0, 6.28) }));
  }
  addEventListener('resize', resize);

  function mascotPos(t) {
    const leftSpace = (W - 700) / 2;
    const cx = leftSpace > 150 ? leftSpace / 2 + 20 : 62;
    const x = cx / S - (Mascot.W + Mascot.TAIL_W) / 2 + Mascot.TAIL_W;
    const y0 = h * 0.2, y1 = h * 0.72;
    const bob = Math.sin(t * 1.6) * 1.6 * (reduce ? 0 : 1);
    return { x, y: y0 + (y1 - y0) * Math.min(1, depth) + bob };
  }

  function ring(x, y, r, col) {
    o.fillStyle = col;
    if (r < 1.6) { o.fillRect(x | 0, y | 0, 1, 1); return; }
    const n = Math.max(8, Math.round(r * 6));
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.283; o.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1); }
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    depth += (target - depth) * 0.025;
    const d = depth;
    const [top, bot] = zoneColors(d);

    // water bands (pixel-banded gradient)
    const band = 3;
    for (let y = 0; y < h; y += band) { o.fillStyle = css(mix(top, bot, y / h)); o.fillRect(0, y, w, band); }

    // surface + sky when near the top
    const surfY = h * 0.11 - d * h * 3.2;
    if (surfY > -12) {
      o.fillStyle = '#bfeaff'; o.fillRect(0, 0, w, Math.max(0, surfY));
      o.fillStyle = '#e8f8ff'; o.fillRect(0, 0, w, Math.max(0, surfY * 0.45));
      for (let x = 0; x < w; x += 2) {
        const yy = surfY + Math.sin(x * 0.18 + t * 2 * speed) * 1.6;
        o.fillStyle = '#ffffff'; o.fillRect(x, yy | 0, 2, 1);
        o.fillStyle = 'rgba(255,255,255,.35)'; o.fillRect(x, (yy | 0) + 1, 2, 2);
      }
      // sun glow
      const g = o.createRadialGradient(w * 0.78, Math.max(0, surfY) * 0.2, 0, w * 0.78, 0, w * 0.5);
      g.addColorStop(0, 'rgba(255,250,200,.5)'); g.addColorStop(1, 'rgba(255,250,200,0)');
      o.fillStyle = g; o.fillRect(0, 0, w, h * 0.7);
    }

    // light rays
    const rayA = Math.max(0, 1 - d / 0.62) * 0.11;
    if (rayA > 0.003) {
      for (let i = 0; i < 6; i++) {
        const x0 = (i / 6) * w + Math.sin(t * 0.25 * speed + i * 1.7) * 14 + 8;
        const rw = w * (0.05 + (i % 3) * 0.025);
        o.fillStyle = `rgba(255,255,255,${rayA * (0.6 + 0.4 * Math.sin(t * 0.6 + i))})`;
        o.beginPath(); o.moveTo(x0, Math.max(0, surfY)); o.lineTo(x0 + rw, Math.max(0, surfY)); o.lineTo(x0 + rw * 2.2 - h * 0.3, h); o.lineTo(x0 - h * 0.3, h); o.closePath(); o.fill();
      }
    }

    // bubbles
    const bubCol = css([255, 255, 255], 0.42 - d * 0.18);
    for (const b of bubbles) {
      b.y -= b.sp * speed; b.ph += 0.03 * speed;
      if (b.y < -6) { b.y = h + 6; b.x = rnd(0, w); }
      ring(b.x + Math.sin(b.ph) * 2, b.y, b.r, bubCol);
    }

    // marine snow
    for (const p of snow) {
      p.y += p.sp * speed; p.x += p.dr * speed;
      if (p.y > h) { p.y = -2; p.x = rnd(0, w); }
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      o.fillStyle = `rgba(220,240,255,${p.a * (0.15 + d * 0.7)})`; o.fillRect(p.x | 0, p.y | 0, 1, 1);
    }

    // seabed: kelp (shallow) → rock spires (deep)
    for (const k of kelp) {
      const green = mix([40, 170, 110], [4, 30, 44], Math.min(1, d * 1.5));
      o.fillStyle = css(green, 0.9);
      const hh = k.hgt * (1 - d * 0.35);
      for (let y = 0; y < hh; y++) { const sx = Math.sin(t * 1.2 * speed + k.ph + y * 0.18) * (1 + y * 0.07); o.fillRect((k.x + sx) | 0, (h - y) | 0, 2, 1); }
    }
    o.fillStyle = css(mix([14, 60, 90], [1, 3, 10], Math.min(1, d * 1.3)));
    for (let x = 0; x < w; x += 2) { const hh = 4 + (Math.sin(x * 0.07) + Math.sin(x * 0.21 + 2)) * 2.5 + 3; o.fillRect(x, (h - hh) | 0, 2, hh | 0); }

    // bioluminescence
    if (d > 0.42) {
      const k = Math.min(1, (d - 0.42) / 0.4);
      for (const b of orbs) {
        b.y -= b.sp * speed; if (b.y < -4) { b.y = h + 4; b.x = rnd(0, w); }
        const tw = 0.5 + 0.5 * Math.sin(t * 1.5 + b.ph);
        const a = k * tw;
        o.fillStyle = `rgba(${b.hue[0]},${b.hue[1]},${b.hue[2]},${a * 0.9})`; o.fillRect(b.x | 0, b.y | 0, 1, 1);
        o.fillStyle = `rgba(${b.hue[0]},${b.hue[1]},${b.hue[2]},${a * 0.35})`;
        o.fillRect((b.x | 0) - 1, b.y | 0, 1, 1); o.fillRect((b.x | 0) + 1, b.y | 0, 1, 1); o.fillRect(b.x | 0, (b.y | 0) - 1, 1, 1); o.fillRect(b.x | 0, (b.y | 0) + 1, 1, 1);
      }
    }

    // darkness vignette with a lit hole round the lantern
    const m = mascotPos(t);
    const lx = m.x + Mascot.LANTERN.x + 2, ly = m.y + Mascot.LANTERN.y;
    if (d > 0.04) {
      const inner = 26 + (1 - d) * 140, outer = inner + 90 + (1 - d) * 120;
      const g = o.createRadialGradient(lx, ly + 6, inner * 0.4, lx, ly + 6, outer);
      g.addColorStop(0, 'rgba(0,4,14,0)'); g.addColorStop(1, `rgba(0,4,14,${Math.min(0.78, d * 0.9)})`);
      o.fillStyle = g; o.fillRect(0, 0, w, h);
    }

    // bursts (feedback when points are earned)
    for (let i = burst.length - 1; i >= 0; i--) {
      const b = burst[i]; b.x += b.vx; b.y += b.vy; b.vy -= 0.01; b.life -= 0.02;
      if (b.life <= 0) { burst.splice(i, 1); continue; }
      if (b.spark) { o.fillStyle = css(b.col, b.life); o.fillRect(b.x | 0, b.y | 0, 1, 1); o.fillRect((b.x | 0) + 1, b.y | 0, 1, 1); }
      else ring(b.x, b.y, b.r, `rgba(255,255,255,${b.life * 0.6})`);
    }

    // lantern glow + mascot
    const gl = 8 + d * 34;
    const lg = o.createRadialGradient(lx, ly, 0, lx, ly, gl);
    lg.addColorStop(0, `rgba(255,244,150,${0.55 + 0.3 * Math.sin(t * 3)})`); lg.addColorStop(1, 'rgba(255,244,150,0)');
    o.globalCompositeOperation = 'lighter'; o.fillStyle = lg; o.fillRect(lx - gl, ly - gl, gl * 2, gl * 2); o.globalCompositeOperation = 'source-over';
    Mascot.draw(o, m.x + Mascot.TAIL_W * 0, m.y, t, 1);

    ctx.drawImage(off, 0, 0);
    gauge(d);
    requestAnimationFrame(frame);
  }

  // DOM depth gauge
  const gaugeEl = document.getElementById('gauge');
  let lastG = -1;
  function gauge(d) {
    if (!gaugeEl) return;
    const v = Math.round(d * 1000);
    if (v === lastG) return; lastG = v;
    gaugeEl.style.setProperty('--d', d.toFixed(4));
    const lab = gaugeEl.querySelector('.gauge-m'); if (lab) lab.textContent = Math.round(d * 1000) + 'm';
  }

  window.Ocean = {
    setDepth(d, instant) { target = Math.max(0, Math.min(1, d)); if (instant) depth = target; },
    get depth() { return depth; },
    burst(n, big) {
      if (reduce) return;
      const m = mascotPos((performance.now() - t0) / 1000);
      const bx = m.x + 14, by = m.y + 6;
      for (let i = 0; i < n; i++) burst.push({ x: bx, y: by, vx: rnd(-0.4, 0.8), vy: rnd(-0.7, -0.1), r: rnd(1, 3), life: rnd(0.6, 1.2) });
      if (big) for (let i = 0; i < n * 2; i++) burst.push({ x: bx, y: by, vx: rnd(-1.2, 1.4), vy: rnd(-1.2, 0.8), spark: true, col: [[255, 242, 122], [255, 160, 220], [140, 255, 230]][(Math.random() * 3) | 0], life: rnd(0.5, 1.1) });
    },
  };

  resize();
  requestAnimationFrame(frame);
})();
