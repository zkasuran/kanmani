'use strict';
/*
 * The paint shop: wall textures and every mark that goes on a wall.
 *
 * Everything here is deterministic. Randomness comes from seeded generators and every draw(g, t)
 * depends only on t, so any frame can be rendered alone and frames can be rendered in parallel.
 */
const W = 1920, H = 1080, FPS = 30, DURATION = 120;
const BPM = 90, BEAT = 60 / BPM, BAR = 4 * BEAT, STEP = BEAT / 4, SWING = 0.58;
const WALL_TOP = -260, WALL_H = 1600, TEXW = 4096, PILLAR = 150;
const END_T = 44 * BAR;

const PAL = {
  black: '#08080d', white: '#f6f3ec', violet: '#8b76ff', cyan: '#22d3ee', green: '#34d399',
  red: '#f87171', slate: '#94a3b8', marker: '#eef1f5', dim: '#b9c3d0',
};

const CUES = [], SHAKES = [];
function cue(type, t, props = {}) { CUES.push({ type, t, ...props }); }
function shakeAt(t, amp) { SHAKES.push({ t, amp }); }

/* ---------------------------------------------------------------- utilities */
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
const E = {
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
function cv(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function noiseFill(g, w, h, amount, seed) {
  const id = g.getImageData(0, 0, w, h), d = id.data, r = rng(seed);
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
}
function sparkle(g, x, y, s) {
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s); g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s); g.fill();
}
/* The Kanmani aperture on its 32-unit geometry: two rails around one proof node. */
function drawMark(g, cx, cy, size, rail, node) {
  const s = size / 32;
  g.save(); g.translate(cx - 16 * s, cy - 16 * s); g.scale(s, s);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = rail;
  g.beginPath(); g.moveTo(13, 7); g.lineTo(4.5, 16); g.lineTo(13, 25); g.moveTo(19, 7); g.lineTo(27.5, 16); g.lineTo(19, 25); g.stroke();
  g.fillStyle = node; g.beginPath(); g.arc(16, 16, 2.35, 0, 7); g.fill();
  g.restore();
}

/* ---------------------------------------------------------------- walls */
function weather(g, w, h, r) {
  for (let i = 0; i < 70; i++) {
    const x = r() * w, sw = 16 + r() * 110, sh = 160 + r() * 900, y = r() * 300;
    const gr = g.createLinearGradient(0, y, 0, y + sh);
    gr.addColorStop(0, `rgba(0,0,0,${0.06 + r() * 0.16})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x, y, sw, sh);
  }
  for (let i = 0; i < 46; i++) {
    const x = r() * w, y = r() * h, rad = 80 + r() * 320, a = 0.04 + r() * 0.12;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, r() < 0.6 ? `rgba(0,0,0,${a})` : `rgba(255,236,210,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const gb = g.createLinearGradient(0, h - 600, 0, h);
  gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, 'rgba(6,5,4,0.62)');
  g.fillStyle = gb; g.fillRect(0, h - 600, w, 600);
}
function makeBrick(seed) {
  const c = cv(TEXW, WALL_H), g = c.getContext('2d'), rel = cv(TEXW / 2, WALL_H / 2), q = rel.getContext('2d'), r = rng(seed);
  g.fillStyle = '#3d3634'; g.fillRect(0, 0, TEXW, WALL_H); q.fillStyle = '#8c8c8c'; q.fillRect(0, 0, TEXW / 2, WALL_H / 2);
  const bw = 124, bh = 42, m = 7;
  for (let row = 0; row * bh < WALL_H; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < TEXW + bw; x += bw) {
      const k = 0.7 + r() * 0.38, tone = r() - 0.5, bx = x + off + m / 2, by = row * bh + m / 2, w = bw - m, h = bh - m;
      g.fillStyle = `rgb(${(126 * k + tone * 30) | 0},${(58 * k + tone * 12) | 0},${(45 * k) | 0})`; g.fillRect(bx, by, w, h);
      g.fillStyle = 'rgba(255,225,200,0.07)'; g.fillRect(bx, by, w, 3);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(bx, by + h - 4, w, 4);
      if (r() < 0.1) { g.fillStyle = '#3d3634'; g.beginPath(); g.arc(bx + (r() < 0.5 ? 2 : w - 2), by + (r() < 0.5 ? 2 : h - 2), 5 + r() * 9, 0, 7); g.fill(); }
      const L = (212 + r() * 43) | 0; q.fillStyle = `rgb(${L},${L},${L})`; q.fillRect(bx / 2, by / 2, w / 2, h / 2);
    }
  }
  noiseFill(g, TEXW, WALL_H, 36, seed + 1); noiseFill(q, TEXW / 2, WALL_H / 2, 44, seed + 2);
  weather(g, TEXW, WALL_H, r);
  return { color: c, relief: rel };
}
function makeConcrete(seed) {
  const c = cv(TEXW, WALL_H), g = c.getContext('2d'), rel = cv(TEXW / 2, WALL_H / 2), q = rel.getContext('2d'), r = rng(seed);
  g.fillStyle = '#6a6c70'; g.fillRect(0, 0, TEXW, WALL_H); q.fillStyle = '#e4e4e4'; q.fillRect(0, 0, TEXW / 2, WALL_H / 2);
  for (let i = 0; i < 140; i++) {
    const x = r() * TEXW, y = r() * WALL_H, rad = 60 + r() * 260, a = 0.03 + r() * 0.08;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let x = 300 + r() * 400; x < TEXW; x += 820) {
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, 0, 4, WALL_H); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 4, 0, 2, WALL_H);
    q.fillStyle = '#707070'; q.fillRect(x / 2, 0, 2.5, WALL_H / 2);
  }
  for (const y of [90, 630, 1170]) {
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y, TEXW, 4); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y + 4, TEXW, 2);
    q.fillStyle = '#707070'; q.fillRect(0, y / 2, TEXW / 2, 2.5);
  }
  for (let x = 102; x < TEXW; x += 205) for (let y = 360; y < WALL_H; y += 270) {
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke();
    q.fillStyle = '#6a6a6a'; q.beginPath(); q.arc(x / 2, y / 2, 3, 0, 7); q.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1.3;
  for (let i = 0; i < 14; i++) {
    let x = r() * TEXW, y = r() * WALL_H; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 30; k++) { x += (r() - 0.5) * 30; y += r() * 24; g.lineTo(x, y); } g.stroke();
  }
  noiseFill(g, TEXW, WALL_H, 30, seed + 1); noiseFill(q, TEXW / 2, WALL_H / 2, 34, seed + 2);
  weather(g, TEXW, WALL_H, r);
  return { color: c, relief: rel };
}
function makeShutter(seed) {
  const c = cv(TEXW, WALL_H), g = c.getContext('2d'), rel = cv(TEXW / 2, WALL_H / 2), q = rel.getContext('2d'), r = rng(seed);
  const slat = 30;
  for (let y = 0; y < WALL_H; y += slat) {
    const gr = g.createLinearGradient(0, y, 0, y + slat);
    gr.addColorStop(0, '#9aa1a9'); gr.addColorStop(0.18, '#7c838c'); gr.addColorStop(0.75, '#5c626a'); gr.addColorStop(1, '#30343a');
    g.fillStyle = gr; g.fillRect(0, y, TEXW, slat);
    const gq = q.createLinearGradient(0, y / 2, 0, (y + slat) / 2);
    gq.addColorStop(0, '#ffffff'); gq.addColorStop(0.75, '#d0d0d0'); gq.addColorStop(1, '#8a8a8a');
    q.fillStyle = gq; q.fillRect(0, y / 2, TEXW / 2, slat / 2);
  }
  for (let i = 0; i < 60; i++) {
    const x = r() * TEXW, y = r() * WALL_H, rad = 40 + r() * 200;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(120,60,25,${0.08 + r() * 0.16})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let x = 900; x < TEXW; x += 1365) {
    const gr = g.createLinearGradient(x, 0, x + 38, 0);
    gr.addColorStop(0, '#1f2226'); gr.addColorStop(0.4, '#6f757c'); gr.addColorStop(1, '#1a1c20');
    g.fillStyle = gr; g.fillRect(x, 0, 38, WALL_H);
  }
  noiseFill(g, TEXW, WALL_H, 24, seed + 1); noiseFill(q, TEXW / 2, WALL_H / 2, 20, seed + 2);
  weather(g, TEXW, WALL_H, r);
  return { color: c, relief: rel };
}
function makePillar() {
  const c = cv(PILLAR, WALL_H), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, PILLAR, 0);
  gr.addColorStop(0, '#111214'); gr.addColorStop(0.15, '#4d5056'); gr.addColorStop(0.5, '#62656b'); gr.addColorStop(0.85, '#3e4146'); gr.addColorStop(1, '#0e0f11');
  g.fillStyle = gr; g.fillRect(0, 0, PILLAR, WALL_H);
  noiseFill(g, PILLAR, WALL_H, 26, 99);
  const px = PILLAR / 2 - 21, pg = g.createLinearGradient(px, 0, px + 42, 0);
  pg.addColorStop(0, '#24272b'); pg.addColorStop(0.35, '#80858c'); pg.addColorStop(0.55, '#aeb3ba'); pg.addColorStop(1, '#24272b');
  g.fillStyle = pg; g.fillRect(px, 0, 42, WALL_H);
  for (let y = 120; y < WALL_H; y += 380) { g.fillStyle = '#1d2024'; g.fillRect(px - 6, y, 54, 14); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(px - 6, y, 54, 2); }
  return c;
}
/* Old, faded writing and buff patches, so every wall has a history before our paint lands. */
const OLD = ['KAZE', 'REMO', 'ONEK', 'SIGH', 'TOXE', 'FLUX', 'DOSE', 'KRAY', 'MUTE', 'ZEPH', 'NOVA', 'OKER', 'SUMO', 'VEKS', 'RUST', 'HUSH'];
function makeDecor(w, seed) {
  const c = cv(w / 2, WALL_H / 2), g = c.getContext('2d'), r = rng(seed * 31 + 7);
  g.scale(0.5, 0.5); g.translate(0, -WALL_TOP);
  for (let i = 0; i < 5; i++) {
    const x = r() * w, y = r() * 1000, bw = 200 + r() * 600, bh = 120 + r() * 400, k = (86 + r() * 40) | 0;
    g.fillStyle = `rgba(${k},${k + 2},${k + 6},${0.35 + r() * 0.3})`; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s <= 10; s++) g.lineTo(x + (bw * s) / 10, y + (r() - 0.5) * 16);
    for (let s = 0; s <= 10; s++) g.lineTo(x + bw + (r() - 0.5) * 16, y + (bh * s) / 10);
    for (let s = 10; s >= 0; s--) g.lineTo(x + (bw * s) / 10, y + bh + (r() - 0.5) * 16);
    g.closePath(); g.fill();
  }
  for (let i = 0; i < 4; i++) {
    g.save(); g.translate(r() * w, 100 + r() * 900); g.rotate((r() - 0.5) * 0.2);
    g.fillStyle = `rgba(230,222,200,${0.1 + r() * 0.12})`; g.fillRect(0, 0, 120 + r() * 200, 160 + r() * 200); g.restore();
  }
  const fonts = ['Sedgwick Ave Display', 'Rock Salt', 'Rubik Wet Paint', 'Rubik Spray Paint'];
  const cols = ['#c9a0dc', '#7fb3d5', '#e5d3b3', '#f4a261', '#a3c4bc', '#d6d6d6', '#e76f51'];
  for (let i = 0; i < 11; i++) {
    const word = OLD[(r() * OLD.length) | 0], s = 50 + r() * 130, col = cols[(r() * cols.length) | 0];
    g.save(); g.translate(r() * w, 80 + r() * 1000); g.rotate((r() - 0.5) * 0.3);
    g.font = `${s | 0}px "${fonts[(r() * fonts.length) | 0]}"`; g.globalAlpha = 0.045 + r() * 0.08;
    if (r() < 0.4) { g.strokeStyle = col; g.lineWidth = s * 0.05; g.strokeText(word, 0, 0); } else { g.fillStyle = col; g.fillText(word, 0, 0); }
    g.restore();
  }
  return c;
}

/* ---------------------------------------------------------------- text art */
const MC = cv(8, 8).getContext('2d');
const fontStr = (o) => `${o.weight || ''} ${o.size}px "${o.font}"`.trim();
function setFont(g, o) {
  g.font = fontStr(o); g.letterSpacing = (o.ls || 0) + 'px'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.lineJoin = 'round'; g.lineCap = 'round'; g.miterLimit = 2;
}
function measure(o) {
  setFont(MC, o); const m = MC.measureText(o.text);
  return { left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
}
/* A painted word, pre-rendered once: a 3D piece, a sprayed tag or a marker line. */
function textArt(o) {
  const mt = measure(o), s = o.size, kind = o.kind, T = o.text;
  const tw = mt.left + mt.right, asc = mt.asc, desc = mt.desc;
  const ow = kind === 'piece' ? s * 0.075 : kind === 'tag' ? s * 0.05 : 0;
  const ex = kind === 'piece' ? o.extrude || [s * 0.05, s * 0.065] : [0, 0];
  const pad = Math.ceil(s * 0.3 + ow * 3 + Math.max(ex[0], ex[1]));
  const w = Math.ceil(tw + pad * 2), h = Math.ceil(asc + desc + pad * 2);
  const c = cv(w, h), g = c.getContext('2d'); setFont(g, o);
  const bx = pad + mt.left, by = pad + asc, f0 = o.fill[0], f1 = o.fill[1] || o.fill[0];
  if (kind === 'piece') {
    g.save(); g.filter = `blur(${Math.round(s * 0.1)}px)`; g.strokeStyle = rgba(f0, 0.3); g.lineWidth = ow * 5; g.strokeText(T, bx + ex[0] / 2, by + ex[1] / 2); g.restore();
    const steps = Math.max(3, Math.ceil(Math.hypot(ex[0], ex[1]) / 1.5));
    g.strokeStyle = o.outline || PAL.black; g.lineWidth = ow * 2.6;
    for (let i = 0; i <= steps; i++) g.strokeText(T, bx + (ex[0] * i) / steps, by + (ex[1] * i) / steps);
    g.fillStyle = g.strokeStyle = o.extrudeColor || '#15121f'; g.lineWidth = ow * 0.7;
    for (let i = steps; i >= 1; i--) { const dx = (ex[0] * i) / steps, dy = (ex[1] * i) / steps; g.strokeText(T, bx + dx, by + dy); g.fillText(T, bx + dx, by + dy); }
    g.strokeStyle = o.outline || PAL.black; g.lineWidth = ow * 1.3; g.strokeText(T, bx, by);
    g.strokeStyle = o.cut || '#ffffff'; g.lineWidth = ow * 0.5; g.strokeText(T, bx, by);
    const face = cv(w, h), fg = face.getContext('2d'); setFont(fg, o);
    const gr = fg.createLinearGradient(0, by - asc, 0, by + desc); gr.addColorStop(0, f0); gr.addColorStop(1, f1);
    fg.fillStyle = gr; fg.fillText(T, bx, by);
    fg.globalCompositeOperation = 'source-atop';
    const band = fg.createLinearGradient(0, by - asc * 0.45, 0, by + desc);
    band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(1, 'rgba(0,0,0,0.25)'); fg.fillStyle = band; fg.fillRect(0, 0, w, h);
    const r = rng(strSeed(T) + 5); fg.strokeStyle = 'rgba(255,255,255,0.8)'; fg.lineWidth = Math.max(2, s * 0.03);
    for (let i = 0; i < T.length * 1.4; i++) {
      const x = pad + r() * tw, y = by - asc * (0.55 + r() * 0.3);
      fg.beginPath(); fg.moveTo(x, y); fg.lineTo(x + s * 0.06, y - s * 0.06); fg.stroke();
    }
    g.drawImage(face, 0, 0);
    for (let i = 0; i < 3; i++) sparkle(g, pad + r() * tw, by - asc * (0.75 + r() * 0.35), s * (0.05 + r() * 0.05));
  } else if (kind === 'tag') {
    g.save(); g.filter = `blur(${Math.max(2, Math.round(s * 0.05))}px)`; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(T, bx + s * 0.03, by + s * 0.05); g.restore();
    g.save(); g.filter = `blur(${Math.max(3, Math.round(s * 0.07))}px)`; g.fillStyle = rgba(f0, 0.35); g.fillText(T, bx, by); g.restore();
    if (o.outline) { g.strokeStyle = o.outline; g.lineWidth = s * 0.1; g.strokeText(T, bx, by); }
    if (f1 !== f0) { const gr = g.createLinearGradient(pad, 0, pad + tw, 0); gr.addColorStop(0, f0); gr.addColorStop(1, f1); g.fillStyle = gr; } else g.fillStyle = f0;
    g.fillText(T, bx, by);
  } else {
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(T, bx + 2, by + 3); g.fillStyle = f0; g.fillText(T, bx, by);
  }
  return { c, w, h, tw, pad, bx, by, asc, desc, ax: pad + tw / 2, ay: by - (asc - desc) / 2 };
}

/* ---------------------------------------------------------------- spray reveal machinery */
const SCR = cv(2600, 900), SG = SCR.getContext('2d');
const MS = 0.25, MSK = cv(2600 * MS, 900 * MS), MG = MSK.getContext('2d');
function revealDraw(g, a, maskFn) {
  MG.setTransform(1, 0, 0, 1, 0, 0); MG.clearRect(0, 0, MSK.width, MSK.height); MG.setTransform(MS, 0, 0, MS, 0, 0); maskFn(MG);
  SG.globalCompositeOperation = 'copy'; SG.drawImage(a.c, 0, 0);
  SG.globalCompositeOperation = 'destination-in'; SG.drawImage(MSK, 0, 0, a.w * MS, a.h * MS, 0, 0, a.w, a.h);
  SG.globalCompositeOperation = 'source-over';
  g.drawImage(SCR, 0, 0, a.w, a.h, 0, 0, a.w, a.h);
}
function polyPath(pts) {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, lens, L: lens[lens.length - 1] };
}
/* Strokes a polyline up to length L and returns where the nozzle is. */
function pathTo(g, path, L) {
  const { pts, lens } = path; let end = pts[0];
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= L) { g.lineTo(pts[i][0], pts[i][1]); end = pts[i]; continue; }
    const u = (L - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
    end = [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]; g.lineTo(end[0], end[1]); break;
  }
  g.stroke(); return end;
}
function pointAt(path, L) {
  const { pts, lens } = path;
  for (let i = 1; i < pts.length; i++) if (lens[i] >= L) { const u = (L - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]); return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]; }
  return pts[pts.length - 1];
}
/* The nozzle's fog: a live, flickering spray of fine dots around the tip. */
function mist(g, x, y, rad, color, seed, n = 70) {
  const r = rng(seed); g.save();
  const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(color, 0.16)); gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  g.fillStyle = color;
  for (let i = 0; i < n; i++) { const a = r() * 6.283, d = Math.abs(gauss(r)) * rad * 0.45, s = 0.8 + r() * 2.2; g.globalAlpha = 0.2 + r() * 0.45; g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, s, s); }
  g.restore();
}
function findDrips(a, n, seed, size, t0, dur, color, wk = 1) {
  const d = a.c.getContext('2d').getImageData(0, 0, a.w, a.h).data, r = rng(seed), out = [];
  for (let k = 0; k < n * 4 && out.length < n; k++) {
    const x = Math.floor(a.pad + r() * a.tw); let y = a.h - 1;
    for (; y > 0; y--) if (d[(y * a.w + x) * 4 + 3] > 200) break;
    if (y < a.by - a.asc * 0.5) continue;
    const frac = (x - a.pad) / Math.max(1, a.tw);
    out.push({ x, y: y - 2, len: size * (0.1 + r() * 0.45), w: Math.max(2.5, size * (0.016 + r() * 0.02) * wk), t: t0 + dur * frac + 0.2 + r() * 0.6, d: 1 + r() * 1.6, color });
  }
  return out;
}
function drawDrip(g, d, t) {
  const u = P(t, d.t, d.d); if (u <= 0) return;
  const L = d.len * E.outCubic(u);
  g.strokeStyle = d.color; g.lineWidth = d.w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x, d.y + L); g.stroke();
  g.fillStyle = d.color; g.beginPath(); g.arc(d.x, d.y + L, d.w * 0.75, 0, 6.283); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = Math.max(1, d.w * 0.22);
  g.beginPath(); g.moveTo(d.x - d.w * 0.2, d.y + 2); g.lineTo(d.x - d.w * 0.2, d.y + Math.max(2, L - d.w * 0.4)); g.stroke();
}

/* ---------------------------------------------------------------- elements */
const FONT_OF = { piece: 'Rubik Wet Paint', tag: 'Sedgwick Ave Display', marker: 'Permanent Marker' };
class Paint {
  constructor(o) { Object.assign(this, { rot: 0, scale: 1 }, o); }
  build() {
    this.font = this.font || FONT_OF[this.kind];
    this.art = textArt(this);
    while ((this.maxW && this.art.tw > this.maxW) || this.art.w > 2580 || this.art.h > 880) { this.size *= 0.93; this.art = textArt(this); }
    if (this.dur == null) this.dur = this.kind === 'piece' ? 1.2 : 0.9;
    const a = this.art;
    if (this.kind === 'piece') {
      const gap = this.size * 0.24, top = a.pad * 0.3, bot = a.h - a.pad * 0.3, pts = [];
      let x = a.pad * 0.5 - gap, down = true;
      while (x <= a.w - a.pad * 0.5 + gap * 1.5) { pts.push([x, down ? top : bot]); x += gap; down = !down; }
      this.path = polyPath(pts); this.lw = gap * 3.2;
      this.drips = findDrips(a, this.dripN ?? Math.round(this.text.length * 1.1), strSeed(this.text) + 1, this.size, this.t0, this.dur, this.fill[1] || this.fill[0]);
    } else if (this.kind === 'tag') {
      this.drips = findDrips(a, this.dripN ?? 3, strSeed(this.text) + 2, this.size, this.t0, this.dur, this.fill[0], 0.7);
    }
    if (this.kind === 'marker') cue('marker', this.t0, { dur: this.dur, x: this.wx });
    else { cue('rattle', this.t0 - 0.55, { x: this.wx }); cue('spray', this.t0, { dur: this.dur, x: this.wx }); }
    this.hw = (a.w / 2) * this.scale + 60;
  }
  draw(g, t) {
    if (t < this.t0) return;
    const raw = P(t, this.t0, this.dur), a = this.art;
    g.save(); g.translate(this.x, this.y); if (this.rot) g.rotate(this.rot); if (this.scale !== 1) g.scale(this.scale, this.scale);
    g.translate(-a.ax, -a.ay);
    if (raw >= 1) g.drawImage(a.c, 0, 0);
    else if (this.kind === 'piece') {
      const L = E.inOutSine(raw) * this.path.L, lag = this.size * 1.2; let tip = this.path.pts[0];
      revealDraw(g, a, (m) => {
        m.lineCap = 'round'; m.lineJoin = 'round'; m.lineWidth = this.lw;
        m.strokeStyle = 'rgba(0,0,0,0.55)'; tip = pathTo(m, this.path, L);
        if (L > lag) { m.strokeStyle = '#000'; pathTo(m, this.path, L - lag); }
      });
      mist(g, tip[0], tip[1], this.size * 0.6, this.fill[0], frameSeed(t, strSeed(this.text)), 90);
    } else {
      const f = this.size * 0.9, L = lerp(-f * 0.2, a.w + f, raw);
      revealDraw(g, a, (m) => { const gr = m.createLinearGradient(L - f, 0, L, 0); gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)'); m.fillStyle = gr; m.fillRect(0, 0, a.w, a.h); });
      if (this.kind === 'tag') mist(g, L - f * 0.55, a.ay + (rng(frameSeed(t, 3))() - 0.5) * this.size * 0.6, this.size * 0.55, this.fill[0], frameSeed(t, 11), 50);
    }
    if (this.drips) for (const d of this.drips) drawDrip(g, d, t);
    g.restore();
  }
}

/* A cardboard stencil: slides onto the wall, gets hit with paint, peels away and leaves crisp type. */
class Stencil {
  constructor(o) { Object.assign(this, { rot: 0, color: PAL.white }, o); }
  build() {
    const o = { text: this.text, size: this.size, font: 'Big Shoulders Stencil', weight: 800, ls: this.size * 0.04 };
    const mt = measure(o), tw = mt.left + mt.right, pad = Math.ceil(this.size * 0.22);
    const w = Math.ceil(tw + pad * 2), h = Math.ceil(mt.asc + mt.desc + pad * 2), bx = pad + mt.left, by = pad + mt.asc, r = rng(strSeed(this.text) + 11);
    const paint = cv(w, h), pg = paint.getContext('2d'); setFont(pg, o);
    pg.save(); pg.filter = `blur(${Math.max(2, Math.round(this.size * 0.03))}px)`; pg.fillStyle = rgba(this.color, 0.45); pg.fillText(this.text, bx, by); pg.restore();
    pg.fillStyle = rgba(this.color, 0.16); for (let i = 0; i < (w * h) / 900; i++) pg.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    pg.fillStyle = this.color; pg.fillText(this.text, bx, by);
    pg.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < (w * h) / 160; i++) { pg.globalAlpha = r() * 0.7; pg.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5); }
    pg.globalAlpha = 1; pg.globalCompositeOperation = 'source-over';
    const cm = Math.ceil(this.size * 0.12), cw = w + cm * 2, ch = h + cm * 2;
    const card = cv(cw, ch), cg = card.getContext('2d'); setFont(cg, o);
    cg.fillStyle = '#ad8a5b'; cg.fillRect(0, 0, cw, ch); noiseFill(cg, cw, ch, 30, strSeed(this.text));
    cg.strokeStyle = 'rgba(60,40,20,0.6)'; cg.lineWidth = 4; cg.strokeRect(2, 2, cw - 4, ch - 4);
    cg.globalCompositeOperation = 'destination-out'; cg.fillText(this.text, bx + cm, by + cm); cg.globalCompositeOperation = 'source-over';
    const sprayed = cv(cw, ch), sg = sprayed.getContext('2d'); sg.drawImage(card, 0, 0);
    sg.globalCompositeOperation = 'source-atop'; sg.fillStyle = rgba(this.color, 0.42); sg.fillRect(0, 0, cw, ch);
    this.art = { paint, card, sprayed, w, h, cw, ch, ax: pad + tw / 2, ay: by - (mt.asc - mt.desc) / 2 };
    this.hw = cw / 2 + 500;
    cue('slap', this.t0 - 0.05, { x: this.wx, soft: 1 }); cue('spray', this.t0, { dur: 0.42, x: this.wx }); cue('peel', this.t0 + 0.55, { x: this.wx });
    shakeAt(this.t0 - 0.05, 5);
  }
  draw(g, t) {
    const a = this.art, t0 = this.t0; if (t < t0 - 0.35) return;
    g.save(); g.translate(this.x, this.y); if (this.rot) g.rotate(this.rot); g.translate(-a.ax, -a.ay);
    const u = P(t, t0, 0.4);
    if (u > 0) { g.globalAlpha = E.outQuad(u); g.drawImage(a.paint, 0, 0); g.globalAlpha = 1; }
    if (t < t0 + 1.0) {
      let dx = 0, dy = 0, rot = 0, al = 1;
      if (t < t0 - 0.05) { const k = E.outCubic(P(t, t0 - 0.35, 0.3)); dy = lerp(-700, 0, k); rot = lerp(-0.12, 0, k); }
      else if (t > t0 + 0.55) { const k = E.inQuad(P(t, t0 + 0.55, 0.45)); dx = 420 * k; dy = -560 * k; rot = 0.4 * k; al = 1 - k; }
      g.save(); g.globalAlpha = al; g.translate(a.w / 2 + dx, a.h / 2 + dy); g.rotate(rot); g.translate(-a.cw / 2, -a.ch / 2);
      g.drawImage(a.card, 0, 0); if (u > 0) { g.globalAlpha = al * u; g.drawImage(a.sprayed, 0, 0); }
      g.restore();
      if (u > 0 && u < 1) mist(g, a.w * (0.15 + 0.7 * ((t * 2.6) % 1)), a.h * 0.5, a.h * 0.7, this.color, frameSeed(t, 9), 120);
    }
    g.restore();
  }
}

/* The rubber stamp every integrity tool hands out. Off-white ink: not a verdict colour. */
class Stamp {
  constructor(o) { Object.assign(this, { rot: 0, ink: '#ece6d6' }, o); }
  build() {
    const size = 50, o = { text: this.text, size, font: 'Space Grotesk', weight: 700, ls: 5 }, mt = measure(o);
    const tw = mt.left + mt.right, chk = size * 0.95, padX = 34, w = padX * 2 + chk + 18 + tw, h = size * 1.9;
    const c = cv(w + 20, h + 20), g = c.getContext('2d'), m = 10;
    g.strokeStyle = this.ink; g.fillStyle = this.ink;
    g.lineWidth = 8; rr(g, m + 4, m + 4, w - 8, h - 8, 14); g.stroke();
    g.lineWidth = 3; rr(g, m + 16, m + 16, w - 32, h - 32, 8); g.stroke();
    g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round';
    const cx0 = m + padX, cy0 = m + h / 2 + 4;
    g.beginPath(); g.moveTo(cx0, cy0 - 2); g.lineTo(cx0 + chk * 0.35, cy0 + chk * 0.3); g.lineTo(cx0 + chk * 0.95, cy0 - chk * 0.4); g.stroke();
    setFont(g, o); g.textBaseline = 'middle'; g.fillText(this.text, m + padX + chk + 18 + mt.left, m + h / 2 + 3);
    const r = rng(strSeed(this.text) + this.x);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1100; i++) { g.globalAlpha = r() * 0.85; g.fillRect(r() * c.width, r() * c.height, 1 + r() * 3, 1 + r() * 3); }
    g.lineWidth = 1.5; for (let i = 0; i < 12; i++) { g.globalAlpha = 0.6; g.beginPath(); const y = r() * c.height; g.moveTo(r() * c.width * 0.3, y); g.lineTo(c.width * (0.6 + r() * 0.4), y + (r() - 0.5) * 20); g.stroke(); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    this.c = c; this.hw = c.width / 2 + 80;
    cue('stamp', this.tI, { x: this.wx }); shakeAt(this.tI, 12);
  }
  draw(g, t) {
    if (t < this.tI - 0.16) return;
    const u = P(t, this.tI - 0.16, 0.16), s = t < this.tI ? lerp(2.3, 1, E.inQuad(u)) : 1 + 0.035 * Math.exp(-(t - this.tI) * 22);
    g.save(); g.translate(this.x, this.y); g.rotate(this.rot); g.scale(s, s); g.globalAlpha = 0.93 * Math.min(1, u * 1.4);
    g.drawImage(this.c, -this.c.width / 2, -this.c.height / 2); g.restore();
    const age = t - this.tI;
    if (age > 0 && age < 0.5) {
      const r = rng(strSeed(this.text) + 3); g.save(); g.fillStyle = '#d8d2c4';
      for (let i = 0; i < 14; i++) {
        const a = r() * 6.283, d = 120 + r() * 160 + age * 260;
        g.globalAlpha = (1 - age / 0.5) * 0.55; const sz = 3 + r() * 5;
        g.fillRect(this.x + Math.cos(a) * d * 1.3, this.y + Math.sin(a) * d * 0.45, sz, sz);
      }
      g.restore();
    }
  }
}

function stickerShadow(w, h, r) {
  const c = cv(w + 80, h + 80), g = c.getContext('2d');
  g.filter = 'blur(12px)'; g.fillStyle = 'rgba(0,0,0,0.6)'; rr(g, 40, 40, w, h, r); g.fill(); return c;
}
function slapDraw(g, t, el, art, shadow, w, h) {
  if (t < el.tI - 0.18) return;
  const u = P(t, el.tI - 0.18, 0.18), after = t - el.tI;
  const s = after < 0 ? lerp(1.4, 1, E.outCubic(u)) : 1 + 0.03 * Math.sin(after * 40) * Math.exp(-after * 16);
  const lift = after < 0 ? 1 - u : 0;
  g.save(); g.translate(el.x, el.y); g.rotate(el.rot + lift * 0.3); g.scale(s * el.scale, s * el.scale); g.globalAlpha = Math.min(1, u * 3);
  g.drawImage(shadow, -w / 2 - 40 + lerp(5, 30, lift), -h / 2 - 40 + lerp(7, 40, lift));
  g.drawImage(art, -art.width / 2, -art.height / 2); g.restore();
}
/* A "HELLO my name is" slap: the classic sticker, one per layer of the stack. */
class Sticker {
  constructor(o) { Object.assign(this, { rot: 0, scale: 1 }, o); }
  build() {
    const w = 440, h = 300, o = 30, c = cv(w + o * 2, h + o * 2), g = c.getContext('2d');
    const live = this.status === 'live', band = live ? '#7862f3' : '#566175';
    rr(g, o, o, w, h, 24); g.fillStyle = '#f6f4ee'; g.fill();
    g.save(); rr(g, o, o, w, h, 24); g.clip();
    g.fillStyle = band; g.fillRect(o, o, w, 118); g.fillRect(o, o + h - 22, w, 22);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = '700 62px "Space Grotesk"'; g.letterSpacing = '4px'; g.fillText('HELLO', o + w / 2 - 36, o + 68);
    g.font = '700 22px "Space Grotesk"'; g.letterSpacing = '2px'; g.fillText('my name is', o + w / 2 - 36, o + 100);
    rr(g, o + w - 118, o + 40, 96, 34, 17); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#fff'; g.font = '700 17px "JetBrains Mono"'; g.letterSpacing = '2px'; g.fillText(live ? 'LIVE' : 'BUILT', o + w - 70, o + 63);
    let fs = 70; g.letterSpacing = '0px'; g.font = `${fs}px "Permanent Marker"`;
    while (g.measureText(this.name).width > w - 50) { fs -= 2; g.font = `${fs}px "Permanent Marker"`; }
    g.fillStyle = '#15151c'; g.fillText(this.name, o + w / 2, o + 200);
    g.font = '26px "Permanent Marker"'; g.fillStyle = '#4a4a56'; g.fillText(this.sub, o + w / 2, o + 250);
    const gl = g.createLinearGradient(o, o, o + w, o + h); gl.addColorStop(0, 'rgba(255,255,255,0.28)'); gl.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(o, o, w, h); g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.5; rr(g, o, o, w, h, 24); g.stroke();
    this.art = c; this.shadow = stickerShadow(w, h, 24); this.w = w; this.h = h; this.hw = 320;
    cue('slap', this.tI, { x: this.wx }); shakeAt(this.tI, 4);
  }
  draw(g, t) { slapDraw(g, t, this, this.art, this.shadow, this.w, this.h); }
}
class Label {
  constructor(o) { Object.assign(this, { rot: 0, scale: 1 }, o); }
  build() {
    const w = 420, h = 110, o = 30, c = cv(w + o * 2, h + o * 2), g = c.getContext('2d');
    rr(g, o, o, w, h, 12); g.fillStyle = '#f4f1e8'; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#15151c'; g.textAlign = 'center'; g.font = '46px "Permanent Marker"'; g.fillText(this.text, o + w / 2, o + 72);
    this.art = c; this.shadow = stickerShadow(w, h, 12); this.w = w; this.h = h; this.hw = 300;
    cue('slap', this.tI, { x: this.wx }); shakeAt(this.tI, 3);
  }
  draw(g, t) { slapDraw(g, t, this, this.art, this.shadow, this.w, this.h); }
}

/* Sprayed lines: arrows, circles, the not-equal sign, the logo's rails. */
class Strokes {
  constructor(o) {
    Object.assign(this, { width: 22, outline: 12, color: PAL.white, dur: 0.6, marker: false }, o);
    const xs = this.lines.flat().map((p) => p[0]); const x0 = Math.min(...xs), x1 = Math.max(...xs);
    this.x = (x0 + x1) / 2; this.hw = (x1 - x0) / 2 + 100;
  }
  build() {
    this.paths = this.lines.map(polyPath); this.L = this.paths.reduce((s, p) => s + p.L, 0);
    if (!this.silent) cue(this.marker ? 'marker' : 'spray', this.t0, { dur: this.dur, x: this.wx });
    const r = rng(Math.round(this.x * 7 + this.t0 * 100)); this.drips = [];
    if (!this.marker) for (let i = 0; i < (this.dripN ?? 2); i++) {
      const f = 0.15 + r() * 0.7, p = pointAt(this.paths[0], this.paths[0].L * f);
      this.drips.push({ x: p[0], y: p[1] + this.width * 0.4, len: 30 + r() * 70, w: Math.max(3, this.width * 0.3), t: this.t0 + this.dur * f + 0.25 + r() * 0.4, d: 1 + r(), color: this.color });
    }
  }
  draw(g, t) {
    if (t < this.t0) return;
    const p = E.inOutSine(P(t, this.t0, this.dur)), Ld = p * this.L;
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    const passes = this.outline ? [['rgba(8,8,13,0.9)', this.width + this.outline], [this.color, this.width]] : [[this.color, this.width]];
    let tip = null;
    for (const [col, lw] of passes) {
      g.strokeStyle = col; g.lineWidth = lw; let acc = 0;
      for (const path of this.paths) { if (acc >= Ld) break; tip = pathTo(g, path, Math.min(path.L, Ld - acc)); acc += path.L; }
    }
    if (p < 1 && tip && !this.marker) mist(g, tip[0], tip[1], this.width * 2.4, this.color, frameSeed(t, 5), 60);
    for (const d of this.drips) drawDrip(g, d, t);
    g.restore();
  }
}
function arrow(x1, y1, x2, y2, bend, o) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend, shaft = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24; shaft.push([(1 - u) ** 2 * x1 + 2 * (1 - u) * u * cx + u * u * x2, (1 - u) ** 2 * y1 + 2 * (1 - u) * u * cy + u * u * y2]); }
  const ang = Math.atan2(y2 - cy, x2 - cx), hl = 46;
  const head = [[x2 - Math.cos(ang - 0.5) * hl, y2 - Math.sin(ang - 0.5) * hl], [x2, y2], [x2 - Math.cos(ang + 0.5) * hl, y2 - Math.sin(ang + 0.5) * hl]];
  return new Strokes({ lines: [shaft, head], ...o });
}
function ellipse(x, y, rx, ry, o) {
  const pts = [], r = rng(Math.round(x + y));
  for (let i = 0; i <= 64; i++) { const a = -2.2 + (i / 64) * Math.PI * 2.25, k = 1 + 0.04 * Math.sin(a * 3 + r()); pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]); }
  return new Strokes({ lines: [pts], width: 9, outline: 0, marker: true, ...o });
}
function notEqual(x, y, o) {
  return new Strokes({ lines: [[[x - 70, y - 26], [x + 70, y - 26]], [[x - 70, y + 26], [x + 70, y + 26]], [[x + 34, y - 78], [x - 34, y + 78]]], width: 20, dripN: 1, ...o });
}
/* The mark, sprayed: left rail, right rail, then the proof node lands and pulses. */
class Logo {
  constructor(o) { Object.assign(this, o); this.hw = this.size; }
  build() {
    const s = this.size / 32, ox = this.x - 16 * s, oy = this.y - 16 * s, m = (p) => [ox + p[0] * s, oy + p[1] * s];
    this.parts = [
      new Strokes({ lines: [[[13, 7], [4.5, 16], [13, 25]].map(m)], width: 2.6 * s, outline: 1.1 * s, color: PAL.violet, t0: this.t0, dur: 0.55, dripN: 2 }),
      new Strokes({ lines: [[[19, 7], [27.5, 16], [19, 25]].map(m)], width: 2.6 * s, outline: 1.1 * s, color: PAL.violet, t0: this.t1, dur: 0.55, dripN: 2 }),
    ];
    for (const p of this.parts) { p.wx = this.wx; p.build(); }
    this.s = s; cue('pop', this.tn, { x: this.wx });
  }
  draw(g, t) {
    for (const p of this.parts) p.draw(g, t);
    const u = P(t, this.tn, 0.4); if (u <= 0) return;
    const r = 2.35 * this.s * 1.2 * E.outBack(u);
    g.save();
    for (let k = 0; k < 8; k++) {
      const age = t - (this.tn + 0.2 + k * 1.6); if (age < 0 || age > 1.4) continue;
      g.strokeStyle = rgba(PAL.cyan, (1 - age / 1.4) * 0.75); g.lineWidth = 4; g.beginPath(); g.arc(this.x, this.y, r * (1 + age * 4), 0, 7); g.stroke();
    }
    g.fillStyle = PAL.black; g.beginPath(); g.arc(this.x, this.y, r + this.s * 0.9, 0, 7); g.fill();
    g.fillStyle = PAL.cyan; g.beginPath(); g.arc(this.x, this.y, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(this.x - r * 0.3, this.y - r * 0.35, r * 0.22, 0, 7); g.fill();
    g.restore();
  }
}

/* A hundred wheatpasted agents. Seventy-nine of them point at one document that stopped answering. */
function cellArt(dead, i) {
  const s = 76, c = cv(s, s), g = c.getContext('2d'), r = rng(1000 + i * 7 + (dead ? 3 : 0));
  g.fillStyle = dead ? '#8e949c' : '#ece6d6'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 120; k++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.fillRect(r() * s, r() * s, 2, 2); }
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(r() * s, 0); g.lineTo(r() * s, s); g.stroke();
  if (!dead) {
    drawMark(g, s / 2, s / 2 - 6, 36, PAL.violet, '#0891b2');
    g.fillStyle = '#555'; g.font = '700 10px "JetBrains Mono"'; g.textAlign = 'center'; g.fillText('#' + (1000 + ((r() * 9000) | 0)), s / 2, s - 7);
  } else {
    g.globalAlpha = 0.45; drawMark(g, s / 2, s / 2 - 6, 36, '#5b616b', '#5b616b'); g.globalAlpha = 1;
    g.save(); g.translate(s / 2, s / 2 + 12); g.rotate(-0.16); g.font = '30px "Permanent Marker"'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText('404', 2, 2); g.fillStyle = '#f1f5f9'; g.fillText('404', 0, 0); g.restore();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(s, 0); g.lineTo(s - 16 - r() * 10, 0); g.lineTo(s, 14 + r() * 12); g.fill();
  }
  return c;
}
class Grid {
  constructor(o) { Object.assign(this, o); const span = this.cols * (this.cell + this.gap); this.x = this.x0 + span / 2; this.hw = span / 2 + 60; }
  build() {
    const n = this.cols * this.rows, r = rng(4242), order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    const rank = new Array(n).fill(-1); order.slice(0, this.dead).forEach((idx, k) => (rank[idx] = k));
    this.cells = [];
    for (let i = 0; i < n; i++) {
      const cx = i % this.cols, cy = (i / this.cols) | 0;
      this.cells.push({
        x: this.x0 + cx * (this.cell + this.gap) + this.cell / 2, y: this.y0 + cy * (this.cell + this.gap) + this.cell / 2,
        rot: (r() - 0.5) * 0.08, tp: this.tp + (cx + cy) * 0.065, td: rank[i] >= 0 ? this.td + rank[i] * 0.028 : Infinity,
        art: cellArt(false, i), dart: rank[i] >= 0 ? cellArt(true, i) : null,
      });
    }
    cue('paste', this.tp, { dur: 1.5, x: this.wx }); cue('marker', this.td, { dur: this.dead * 0.028 + 0.3, x: this.wx });
  }
  draw(g, t) {
    const hc = this.cell / 2;
    for (const c of this.cells) {
      const u = P(t, c.tp, 0.18); if (u <= 0) continue;
      const d = c.dart ? P(t, c.td, 0.25) : 0, s = lerp(0.55, 1, E.outBack(u));
      g.save(); g.translate(c.x, c.y); g.rotate(c.rot + d * 0.04); g.scale(s, s);
      if (d < 1) { g.globalAlpha = u * (1 - d); g.drawImage(c.art, -hc, -hc, this.cell, this.cell); }
      if (d > 0) { g.globalAlpha = d; g.drawImage(c.dart, -hc, -hc, this.cell, this.cell); }
      g.restore();
    }
  }
}
/* The buff: grey roller paint over the wall, stripe by stripe, so a new statement can go on top. */
class Buff {
  constructor(o) { Object.assign(this, o); this.x = this.x0 + this.w / 2; this.hw = this.w / 2 + 40; }
  build() {
    const tex = cv(this.w, this.h), g = tex.getContext('2d'), r = rng(77), sw = this.w / this.stripes;
    for (let k = 0; k < this.stripes; k++) { const tone = (100 + r() * 16) | 0; g.fillStyle = `rgb(${tone},${tone + 3},${tone + 8})`; g.fillRect(k * sw - 6, 0, sw + 12, this.h); }
    for (let i = 0; i < 1100; i++) { g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.02 + r() * 0.05})` : `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(r() * this.w, r() * this.h, 1 + r() * 3, 20 + r() * 140); }
    noiseFill(g, this.w, this.h, 16, 78);
    this.tex = tex; this.sw = sw;
    for (let k = 0; k < this.stripes; k++) cue('roller', this.t0 + k * this.step, { dur: this.d, x: this.wx });
  }
  draw(g, t) {
    for (let k = 0; k < this.stripes; k++) {
      const u = E.inOutSine(P(t, this.t0 + k * this.step, this.d)); if (u <= 0) continue;
      const x = Math.max(0, k * this.sw - 6), w = Math.min(this.w - x, this.sw + 12), h = this.h * u;
      g.drawImage(this.tex, x, 0, w, h, this.x0 + x, this.y0, w, h);
      if (u < 1) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(this.x0 + x, this.y0 + h - 16, w, 16); }
    }
  }
}
/* The settlement receipt, wheatpasted, printing its lines. Every figure is from the mainnet run. */
const SETTLE_TX = '0x10d03f3155478f88ce90ae1deaa6a5fbd99af9ebaffa0512c9979367c9fce6c5';
class Receipt {
  constructor(o) { Object.assign(this, { rot: 0 }, o); this.hw = 360; }
  build() {
    const w = 600, h = 820, o = 20, cw = w + o * 2, ch = h + o * 2, r = rng(55);
    const paper = cv(cw, ch), g = paper.getContext('2d');
    g.beginPath(); g.moveTo(o, o + 8);
    for (let x = 0; x <= w; x += 20) g.lineTo(o + x, o + ((x / 20) % 2 ? 0 : 10));
    g.lineTo(o + w, o + h - 10);
    for (let x = w; x >= 0; x -= 20) g.lineTo(o + x, o + h - ((x / 20) % 2 ? 0 : 12));
    g.closePath(); g.save(); g.clip();
    const gr = g.createLinearGradient(o, 0, o + w, 0);
    gr.addColorStop(0, '#dcd8cc'); gr.addColorStop(0.12, '#f2efe6'); gr.addColorStop(0.88, '#f2efe6'); gr.addColorStop(1, '#d6d2c5');
    g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * cw, r() * ch, 2, 2); }
    g.restore();
    g.save(); g.globalAlpha = 0.75; g.fillStyle = '#e6d9b0';
    for (const [x, rot] of [[o + 40, -0.3], [o + w - 40, 0.28]]) { g.save(); g.translate(x, o + 6); g.rotate(rot); g.fillRect(-55, -18, 110, 36); g.restore(); }
    g.restore();
    const print = cv(cw, ch), pg = print.getContext('2d');
    this.lines = [
      ['KANMANI  AQUEOUS ESCROW', true], ['monad mainnet  chain 143'], ['- - - - - - - - - - - - - -'],
      ['escrowed          1.40 USDC'], ['per call          0.02'], ['calls used        30 of 70'],
      ['to the agent      0.60'], ['returned          0.80'], ['retained          0.00'], ['buyer held        0 MON'],
      ['- - - - - - - - - - - - - -'], [`settle ${SETTLE_TX.slice(0, 10)}...${SETTLE_TX.slice(-8)}`], ['payment + receipt: ONE TX', true],
    ];
    this.ly = []; const x0 = o + 44;
    this.lines.forEach(([txt, bold], i) => {
      const y = o + 92 + i * 52; this.ly.push(y - 36);
      pg.font = `700 ${bold ? 29 : 26}px "JetBrains Mono"`; pg.fillStyle = bold ? '#101018' : '#26262e'; pg.fillText(txt, x0, y);
    });
    this.paper = paper; this.print = print; this.cw = cw; this.ch = ch;
    cue('paste', this.tp, { dur: 0.6, x: this.wx }); cue('print', this.tl, { dur: this.lines.length * 0.3, x: this.wx });
  }
  draw(g, t) {
    const u = E.outCubic(P(t, this.tp, 0.45)); if (u <= 0) return;
    g.save(); g.translate(this.x, this.y); g.rotate(this.rot); g.translate(-this.cw / 2, -this.ch / 2);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(24, 30, this.cw - 30, this.ch * u - 20);
    g.drawImage(this.paper, 0, 0, this.cw, this.ch * u, 0, 0, this.cw, this.ch * u);
    this.ly.forEach((y, i) => {
      const v = P(t, this.tl + i * 0.3, 0.16); if (v <= 0) return;
      g.drawImage(this.print, 0, y, this.cw * v, 52, 0, y, this.cw * v, 52);
    });
    const sheen = (1 - P(t, this.tp + 0.2, 1.6)) * 0.3;
    if (sheen > 0) { const gr = g.createLinearGradient(0, 0, this.cw, this.ch); gr.addColorStop(0, `rgba(255,255,255,${sheen})`); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, this.cw, this.ch * u); }
    g.restore();
  }
}
/* Monad's cadence drawn at its real speed, beside a 12-second finality bar that barely moves. */
class Blocks {
  constructor(o) { Object.assign(this, o); this.hw = 520; }
  build() { for (let t = this.t0; t < this.end; t += 0.266) cue('tick', t, { x: this.wx }); }
  draw(g, t) {
    const n = 12, sz = 54, gap = 12, step = sz + gap, x0 = this.x - (n * step - gap) / 2;
    g.save();
    if (t >= this.t0) {
      const k = Math.floor((t - this.t0) / 0.266) + 1, frac = ((t - this.t0) % 0.266) / 0.266;
      const scroll = k > n ? (1 - E.outCubic(Math.min(1, frac / 0.4))) * step : 0;
      for (let j = 0; j < n; j++) {
        const b = k - n + j; if (b < 0) continue;
        const newest = j === n - 1, pop = newest ? E.outBack(Math.min(1, frac / 0.3)) : 1, x = x0 + j * step + scroll, y = this.y;
        g.save(); g.translate(x + sz / 2, y + sz / 2); g.scale(pop, pop);
        g.globalAlpha = 0.45 + 0.55 * (j / (n - 1));
        g.fillStyle = PAL.black; g.fillRect(-sz / 2 - 5, -sz / 2 - 5, sz + 10, sz + 10);
        g.fillStyle = newest ? PAL.cyan : PAL.violet; g.fillRect(-sz / 2, -sz / 2, sz, sz);
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; g.strokeRect(-sz / 2 + 5, -sz / 2 + 5, sz - 10, sz - 10);
        g.restore();
      }
    }
    if (t >= this.tb) {
      const bw = n * step - gap, by = this.y + 340, u = Math.min(1, (t - this.tb) / 12);
      g.globalAlpha = Math.min(1, (t - this.tb) / 0.3);
      g.fillStyle = PAL.black; g.fillRect(x0 - 6, by - 6, bw + 12, sz + 12);
      g.fillStyle = 'rgba(148,163,184,0.18)'; g.fillRect(x0, by, bw, sz);
      g.fillStyle = PAL.slate; g.fillRect(x0, by, bw * u, sz);
      g.strokeStyle = PAL.slate; g.lineWidth = 3; g.strokeRect(x0, by, bw, sz);
    }
    g.restore();
  }
}
