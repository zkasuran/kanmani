'use strict';
/*
 * Shared film core: deterministic randomness, easing, canvas helpers, keyframe tracks, typing,
 * sound cues and the window.film contract that pitch/render.mjs drives.
 *
 * A film calls registerFilm({ duration, arrangement, init, render }). render(g, t) must depend only
 * on t, so any frame can be rendered alone and frames can render in parallel.
 */
const W = 1920, H = 1080, FPS = 30;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
const frameSeed = (t, s) => ((Math.round(t * FPS) * 7919) ^ Math.imul(s | 0, 104729)) >>> 0;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const P = (t, t0, d) => clamp((t - t0) / d);
/* 0 before t0, rises over `inD`, holds, falls over `outD` ending at t1. For text that comes and goes. */
const life = (t, t0, t1, inD = 0.5, outD = 0.5) => Math.min(P(t, t0, inD), 1 - P(t, t1 - outD, outD));
const E = {
  lin: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
function cv(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
function mixHex(a, b, u) { const x = hexRgb(a), y = hexRgb(b); return '#' + x.map((v, i) => Math.round(lerp(v, y[i], u)).toString(16).padStart(2, '0')).join(''); }
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function noiseFill(g, w, h, amount, seed) {
  const id = g.getImageData(0, 0, w, h), d = id.data, r = rng(seed);
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
}
function polyPath(pts) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, lens, L: lens[lens.length - 1] };
}
function pointAt(path, L) {
  const { pts, lens } = path; if (L <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) if (lens[i] >= L) { const u = (L - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]); return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]; }
  return pts[pts.length - 1];
}
/* Strokes a polyline from length L0 to L1. */
function strokeSpan(g, path, L0, L1) {
  const { pts, lens } = path; if (L1 <= L0) return;
  g.beginPath(); let started = false;
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] < L0) continue;
    if (!started) { const p = pointAt(path, L0); g.moveTo(p[0], p[1]); started = true; }
    if (lens[i] >= L1) { const p = pointAt(path, L1); g.lineTo(p[0], p[1]); break; }
    g.lineTo(pts[i][0], pts[i][1]);
  }
  g.stroke();
}
function sampleCurve(fn, n) { const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(i / n)); return pts; }
/* The Kanmani aperture on its 32-unit geometry: two rails around one proof node. */
function drawMark(g, cx, cy, size, rail, node, lw = 2.6, spread = 0) {
  const s = size / 32;
  g.save(); g.translate(cx - 16 * s, cy - 16 * s); g.scale(s, s);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = rail;
  g.beginPath(); g.moveTo(13 - spread, 7); g.lineTo(4.5 - spread, 16); g.lineTo(13 - spread, 25);
  g.moveTo(19 + spread, 7); g.lineTo(27.5 + spread, 16); g.lineTo(19 + spread, 25); g.stroke();
  if (node) { g.fillStyle = node; g.beginPath(); g.arc(16, 16, 2.35, 0, 7); g.fill(); }
  g.restore();
}

/* ---------------------------------------------------------------- text */
function font(size, family, weight = '', style = '') { return `${style} ${weight} ${size}px "${family}"`.replace(/\s+/g, ' ').trim(); }
function setText(g, f, { align = 'left', base = 'alphabetic', ls = 0, color } = {}) {
  g.font = f; g.textAlign = align; g.textBaseline = base; g.letterSpacing = ls + 'px'; if (color) g.fillStyle = color;
}
const MC = cv(8, 8).getContext('2d');
function textW(f, s, ls = 0) { MC.font = f; MC.letterSpacing = ls + 'px'; return MC.measureText(s).width; }
/* Spans: [[text, color], ...] drawn on one baseline, anchored by align. */
function drawSpans(g, spans, x, y, f, { align = 'left', ls = 0, alpha = 1 } = {}) {
  const ws = spans.map(([s]) => textW(f, s, ls)), total = ws.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  g.save(); g.globalAlpha *= alpha; setText(g, f, { ls });
  spans.forEach(([s, c], i) => { g.fillStyle = c; g.fillText(s, cx, y); cx += ws[i]; });
  g.restore(); return total;
}

/* ---------------------------------------------------------------- tracks */
/* Keyframes [{t, ...values, ease}] -> value at t. Each segment eases with the ease of its end key. */
function track(keys) {
  keys.sort((a, b) => a.t - b.t);
  return (t) => {
    const k = keys, n = k.length;
    if (t <= k[0].t) return k[0];
    if (t >= k[n - 1].t) return k[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (k[mid].t <= t) lo = mid; else hi = mid; }
    const a = k[lo], b = k[hi], u = (t - a.t) / Math.max(1e-6, b.t - a.t), e = (E[b.ease] || E.inOutCubic)(u), out = {};
    for (const key in a) if (key !== 't' && key !== 'ease' && typeof a[key] === 'number' && typeof b[key] === 'number') out[key] = lerp(a[key], b[key], e);
    return out;
  };
}

/* ---------------------------------------------------------------- typing */
/* Per-character times for a human typist: steady, with seeded jitter and small pauses at spaces. */
function typeTimes(text, t0, cps, seed) {
  const r = rng(seed), out = []; let t = t0;
  for (let i = 0; i < text.length; i++) {
    out.push(t);
    const ch = text[i]; let d = (1 / cps) * (0.55 + r() * 0.9);
    if (ch === ' ') d *= 1.6; if ('-/|.'.includes(ch)) d *= 1.3;
    t += d;
  }
  out.end = t; return out;
}
const typedCount = (times, t) => { let n = 0; while (n < times.length && times[n] <= t) n++; return n; };

/* ---------------------------------------------------------------- cues and finishing */
const CUES = [];
function cue(type, t, props = {}) { CUES.push({ type, t, ...props }); }
function makeGrain(n = 4, w = 960, h = 540, spread = 120, seed = 900) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = cv(w, h), g = c.getContext('2d'), id = g.createImageData(w, h), d = id.data, r = rng(seed + i);
    for (let p = 0; p < d.length; p += 4) { const v = 128 + (r() - 0.5) * spread; d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255; }
    g.putImageData(id, 0, 0); out.push(c);
  }
  return out;
}
function makeVignette(inner = 420, outer = 1250, alpha = 0.6) {
  const c = cv(W, H), g = c.getContext('2d'), gr = g.createRadialGradient(W / 2, H / 2, inner, W / 2, H / 2, outer);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${alpha})`); g.fillStyle = gr; g.fillRect(0, 0, W, H); return c;
}
/* Bloom: the frame, downsampled and blurred, added back on top. Cheap because the blur runs small. */
const BLOOM = cv(480, 270), BLG = BLOOM.getContext('2d');
function bloom(g, src, amount = 0.35, blur = 5) {
  BLG.globalCompositeOperation = 'copy'; BLG.filter = `blur(${blur}px)`; BLG.drawImage(src, 0, 0, 480, 270); BLG.filter = 'none';
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'lighter'; g.globalAlpha = amount; g.drawImage(BLOOM, 0, 0, W, H); g.restore();
}
async function fontsReady(list) {
  await Promise.all(list.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  const missing = list.filter((f) => !document.fonts.check(f));
  if (missing.length) console.error('fonts missing: ' + missing.join(' | '));
}
function registerFilm({ duration, arrangement, init, render }) {
  const main = document.getElementById('c'), G = main.getContext('2d');
  const renderFrame = (t) => {
    G.setTransform(1, 0, 0, 1, 0, 0); G.globalAlpha = 1; G.globalCompositeOperation = 'source-over'; G.filter = 'none';
    render(G, t, main);
  };
  window.film = {
    W, H, FPS, DURATION: duration, renderFrame,
    ready: init().then(() => true),
    frame: (t, type = 'image/png', q) => { renderFrame(t); return main.toDataURL(type, q); },
    cues: () => ({ arrangement: { ...arrangement, duration }, cues: CUES }),
  };
}
