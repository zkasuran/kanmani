'use strict';
/*
 * The camera, the light and the frame. renderFrame(t) is a pure function of t.
 */
const main = document.getElementById('c'), G = main.getContext('2d');
const BLUR = cv(W, H), BG = BLUR.getContext('2d');
const LM = cv(480, 270), LG = LM.getContext('2d');
let SURF = null, PILLAR_C = null, VIG = null, KICKS = [];
const GRAIN = [];

/* ---------------------------------------------------------------- camera */
function camAt(t) {
  const k = CAMK, n = k.length;
  if (t <= k[0].t) return k[0];
  if (t >= k[n - 1].t) return k[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (k[mid].t <= t) lo = mid; else hi = mid; }
  const a = k[lo], b = k[hi], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const e = b.ease === 'whip' ? E.inOutQuint(u) : E.inOutCubic(u);
  return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: lerp(a.z, b.z, e) };
}
function partAt(bar) { for (const [name, a, b] of ARRANGEMENT.parts) if (bar >= a && bar < b) return name; return 'stop'; }
const stepTime = (bar, s) => bar * BAR + s * STEP + (s % 2 ? (SWING - 0.5) * 2 * STEP : 0);
function computeKicks() {
  const out = [];
  for (let bar = 0; bar < 44; bar++) {
    const p = partAt(bar);
    if (p === 'groove' || p === 'lift') { out.push([stepTime(bar, 0), 0.0045], [stepTime(bar, 7), 0.0022], [stepTime(bar, 10), 0.003]); if (bar % 4 === 3) out.push([stepTime(bar, 14), 0.002]); }
    else if (p === 'halftime') out.push([stepTime(bar, 0), 0.005], [stepTime(bar, 11), 0.0025]);
    else if (p === 'breakdown' && bar < 19) out.push([stepTime(bar, 0), 0.003]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
function pulse(t) {
  let p = 0;
  for (const [kt, a] of KICKS) { if (kt > t) break; const dt = t - kt; if (dt < 0.3) p = Math.max(p, a * Math.exp(-dt * 13)); }
  return 1 + p;
}
function shake(t) {
  let x = 3.2 * Math.sin(t * 0.9 + 0.3) + 1.8 * Math.sin(t * 2.1 + 1.7), y = 2.4 * Math.sin(t * 1.3 + 2.1) + 1.2 * Math.sin(t * 2.9);
  const r = 0.0016 * Math.sin(t * 0.6 + 0.8);
  for (let i = 0; i < SHAKES.length; i++) {
    const s = SHAKES[i], dt = t - s.t; if (dt < 0 || dt > 0.6) continue;
    const k = s.amp * Math.exp(-dt * 11); x += k * Math.sin(dt * 62 + i); y += k * 0.7 * Math.cos(dt * 55 + i * 2);
  }
  return { x, y, r };
}

/* ---------------------------------------------------------------- light */
function lightState(t) {
  if (t < 3.0) return { amb: '5,5,9', lamp: 0, flash: P(t, 0.25, 0.5) };
  const on = (t < 3.1) || (t >= 3.18 && t < 3.3) || t >= 3.34;
  if (!on) return { amb: '8,8,12', lamp: 0, flash: 1 };
  if (t < 3.34) return { amb: '70,70,90', lamp: 0.75, flash: 1 };
  const flick = 1 - 0.02 * (0.5 + 0.5 * Math.sin(t * 37) * Math.sin(t * 13));
  return { amb: '140,142,168', lamp: (0.85 + 0.15 * P(t, 3.34, 0.5)) * flick, flash: 1 - P(t, 3.3, 0.5) };
}
function buildLight(t, cam, z) {
  const L = lightState(t);
  LG.globalCompositeOperation = 'source-over'; LG.fillStyle = `rgb(${L.amb})`; LG.fillRect(0, 0, 480, 270);
  LG.globalCompositeOperation = 'lighter';
  const toS = (wx, wy) => [((wx - cam.x) * z + W / 2) / 4, ((wy - cam.y) * z + H / 2) / 4];
  if (L.lamp > 0) for (const s of SECTIONS) for (const lx of s.lamps) {
    const [sx, sy] = toS(s.x + lx, WALL_TOP + 170), rad = (1250 * z) / 4;
    if (sx < -rad || sx > 480 + rad) continue;
    const gr = LG.createRadialGradient(sx, sy, 0, sx, sy, rad);
    gr.addColorStop(0, `rgba(255,196,140,${0.62 * L.lamp})`); gr.addColorStop(0.55, `rgba(200,150,120,${0.25 * L.lamp})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    LG.fillStyle = gr; LG.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }
  if (L.flash > 0) {
    const fx = SECTIONS[0].x + lerp(260, 1650, E.inOutSine(P(t, 0.3, 2.8))) + 50 * Math.sin(t * 2.2), fy = 520 + 80 * Math.sin(t * 1.6 + 0.4);
    const [sx, sy] = toS(fx, fy), rad = 120;
    const gr = LG.createRadialGradient(sx, sy, 0, sx, sy, rad);
    gr.addColorStop(0, `rgba(255,246,230,${0.95 * L.flash})`); gr.addColorStop(0.6, `rgba(200,190,170,${0.35 * L.flash})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    LG.fillStyle = gr; LG.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }
}
function applyLight(g, alpha) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = alpha; g.globalCompositeOperation = 'multiply';
  g.drawImage(LM, 0, 0, W, H); g.restore();
}

/* ---------------------------------------------------------------- wall */
function clipRect(s, v) {
  const x0 = Math.max(v.x0, s.x), x1 = Math.min(v.x1, s.x + s.w), y0 = Math.max(v.y0, WALL_TOP), y1 = Math.min(v.y1, WALL_TOP + WALL_H);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}
function drawSurface(g, s, v) {
  const r = clipRect(s, v); if (!r) return; const [x0, y0, x1, y1] = r, tex = SURF[s.surface];
  g.drawImage(tex.color, s.off + x0 - s.x, y0 - WALL_TOP, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  g.drawImage(s.decor, (x0 - s.x) / 2, (y0 - WALL_TOP) / 2, (x1 - x0) / 2, (y1 - y0) / 2, x0, y0, x1 - x0, y1 - y0);
}
function drawRelief(g, s, v, alpha) {
  const r = clipRect(s, v); if (!r) return; const [x0, y0, x1, y1] = r, tex = SURF[s.surface];
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = alpha;
  g.drawImage(tex.relief, (s.off + x0 - s.x) / 2, (y0 - WALL_TOP) / 2, (x1 - x0) / 2, (y1 - y0) / 2, x0, y0, x1 - x0, y1 - y0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}
function drawPillars(g, v) {
  for (let i = 0; i < SECTIONS.length - 1; i++) {
    const x = SECTIONS[i].x + SECTIONS[i].w; if (x > v.x1 || x + PILLAR < v.x0) continue;
    g.drawImage(PILLAR_C, x, WALL_TOP);
    const sh = g.createLinearGradient(x + PILLAR, 0, x + PILLAR + 90, 0); sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(x + PILLAR, WALL_TOP, 90, WALL_H);
  }
}
function motionBlur(len) {
  BG.globalCompositeOperation = 'copy'; BG.drawImage(main, 0, 0); BG.globalCompositeOperation = 'source-over';
  const n = 9;
  for (let i = 1; i < n; i++) { G.globalAlpha = 1 / (i + 1); G.drawImage(BLUR, (i / (n - 1) - 0.5) * len, 0); }
  G.globalAlpha = 1;
}
function endCard(t) {
  const u = E.outCubic(P(t, END_T + 0.12, 0.7));
  G.fillStyle = '#050508'; G.fillRect(0, 0, W, H);
  const gr = G.createRadialGradient(960, 440, 0, 960, 440, 760); gr.addColorStop(0, `rgba(131,110,249,${0.2 * u})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  G.fillStyle = gr; G.fillRect(0, 0, W, H);
  G.save(); G.globalAlpha = u; G.translate(960, 400); const s = 0.9 + 0.1 * u; G.scale(s, s); drawMark(G, 0, 0, 190, PAL.violet, PAL.cyan); G.restore();
  G.save(); G.globalAlpha = E.outCubic(P(t, END_T + 0.4, 0.6)); G.textAlign = 'center'; G.textBaseline = 'alphabetic';
  G.fillStyle = PAL.white; G.font = '700 110px "Space Grotesk"'; G.letterSpacing = '-2px'; G.fillText('kanmani', 960, 615);
  G.fillStyle = PAL.cyan; G.font = '700 38px "JetBrains Mono"'; G.letterSpacing = '1px'; G.fillText('kanmani.xyz', 960, 685);
  G.fillStyle = '#8b98a9'; G.font = '700 29px "Space Grotesk"'; G.letterSpacing = '0px'; G.fillText('the settlement and trust layer for agent work on Monad', 960, 748);
  G.restore();
}

/* ---------------------------------------------------------------- the frame */
function renderFrame(t) {
  G.setTransform(1, 0, 0, 1, 0, 0); G.globalAlpha = 1; G.globalCompositeOperation = 'source-over'; G.filter = 'none';
  G.fillStyle = '#040406'; G.fillRect(0, 0, W, H);
  if (t < END_T) {
    const cam = camAt(t), sh = shake(t), z = cam.z * pulse(t);
    G.translate(W / 2 + sh.x, H / 2 + sh.y); G.rotate(sh.r); G.scale(z, z); G.translate(-cam.x, -cam.y);
    const m = 140 / z, v = { x0: cam.x - W / 2 / z - m, x1: cam.x + W / 2 / z + m, y0: cam.y - H / 2 / z - m, y1: cam.y + H / 2 / z + m };
    const vis = SECTIONS.filter((s) => s.x < v.x1 && s.x + s.w > v.x0);
    for (const s of vis) drawSurface(G, s, v);
    for (const s of vis) drawRelief(G, s, v, 0.55);
    drawPillars(G, v);
    // The wall takes the night fully. Paint goes on after and takes about half of it, the way
    // fresh paint catches a street lamp: the wall stays moody, the message stays legible.
    buildLight(t, cam, z); applyLight(G, 1);
    for (const sc of SCENES) {
      if (!vis.includes(sc.sec)) continue;
      const s = sc.sec, lx0 = v.x0 - s.x, lx1 = v.x1 - s.x;
      G.save(); G.translate(s.x, 0);
      for (const el of sc.els) { if (el.x + el.hw < lx0 || el.x - el.hw > lx1) continue; el.draw(G, t); }
      G.restore();
    }
    for (const s of vis) drawRelief(G, s, v, 0.3);
    applyLight(G, 0.42);
    G.setTransform(1, 0, 0, 1, 0, 0);
    // Screen pixels travelled in one frame. A 180-degree shutter smears about half of that.
    const vel = (camAt(t + 0.5 / FPS).x - camAt(t - 0.5 / FPS).x) * cam.z;
    if (Math.abs(vel) > 30) motionBlur(Math.sign(vel) * Math.min(Math.abs(vel) * 0.45, 480));
    G.drawImage(VIG, 0, 0);
  } else endCard(t);
  G.globalCompositeOperation = 'overlay'; G.globalAlpha = 0.16;
  G.drawImage(GRAIN[Math.floor((t * FPS) / 2) % GRAIN.length], 0, 0, W, H);
  G.globalAlpha = 1; G.globalCompositeOperation = 'source-over';
  let black = 0;
  if (t < 0.35) black = 1 - t / 0.35;
  if (t > DURATION - 0.45) black = Math.max(black, (t - (DURATION - 0.45)) / 0.45);
  if (black > 0) { G.fillStyle = `rgba(0,0,0,${clamp(black)})`; G.fillRect(0, 0, W, H); }
}

async function init() {
  const fams = ['Rubik Wet Paint', 'Rubik Spray Paint', 'Sedgwick Ave Display', 'Permanent Marker', 'Rock Salt', 'Big Shoulders Stencil', 'Space Grotesk', 'JetBrains Mono'];
  await Promise.all(fams.map((f) => document.fonts.load(`700 40px "${f}"`)));
  await document.fonts.ready;
  const missing = fams.filter((f) => !document.fonts.check(`700 40px "${f}"`));
  if (missing.length) console.error('fonts missing: ' + missing.join(', '));
  SURF = { brick: makeBrick(1), concrete: makeConcrete(2), shutter: makeShutter(3) };
  PILLAR_C = makePillar();
  buildStory();
  for (const s of SECTIONS) { s.off = Math.floor(rng(s.seed)() * (TEXW - s.w)); s.decor = makeDecor(s.w, s.seed); }
  CAMK.sort((a, b) => a.t - b.t);
  KICKS = computeKicks();
  for (const c of CUES) {
    if (c.x == null) { c.pan = 0; continue; }
    const cam = camAt(c.t); c.pan = clamp(((c.x - cam.x) * cam.z) / 1100, -0.75, 0.75);
  }
  VIG = cv(W, H); const vg = VIG.getContext('2d'), gr = vg.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 1250);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.62)'); vg.fillStyle = gr; vg.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const c = cv(960, 540), g = c.getContext('2d'), id = g.createImageData(960, 540), d = id.data, r = rng(900 + i);
    for (let p = 0; p < d.length; p += 4) { const n = 128 + (r() - 0.5) * 120; d[p] = d[p + 1] = d[p + 2] = n; d[p + 3] = 255; }
    g.putImageData(id, 0, 0); GRAIN.push(c);
  }
  return true;
}
window.film = {
  W, H, FPS, DURATION, renderFrame,
  ready: init(),
  frame: (t, type = 'image/png', q) => { renderFrame(t); return main.toDataURL(type, q); },
  cues: () => ({ arrangement: ARRANGEMENT, cues: CUES }),
};
