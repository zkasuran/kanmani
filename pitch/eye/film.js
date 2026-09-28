'use strict';
/*
 * KANMANI · THE EYE
 *
 * கண்மணி (kanmani) is Tamil for the pupil, "the apple of the eye", the thing you hold safe. The
 * whole stack is named for the eye (Cornea, Aqueous, Iris, Retina, Fovea, Optic, Chiasm, Sclera),
 * because each part does the job its namesake does. This film follows one payment claim as a
 * ray of light through that eye.
 *
 *   0:00  the name            a point of light becomes an iris; கண்மணி
 *   0:12  what the registry sees  10,262 agents, out of focus; every tool checks the hash
 *   0:27  focus               85 claims read against their chain: 12 true, 73 false; 64 real elsewhere, 9 nowhere
 *   0:42  the blind spot      8,093 agents, 7,962 wallets, one document that stopped answering
 *   0:51  so we built an eye
 *   0:54  anatomy             the claim travels cornea > aqueous > iris > retina > fovea > optic > chiasm; sclera, blink, intents (all nine live)
 *   1:39  seen on mainnet     the settlement figures; a pulse every 266 ms
 *   1:51  the close           unknown is never false; the iris becomes the mark; trust becomes a price
 *
 * 80 BPM, 40 bars of 3 s. Every figure is one the project publishes.
 */
const DUR = 120, BPM = 80, BEAT = 60 / BPM, BAR = 4 * BEAT;
const C = {
  bg: '#030409', violet: '#8b76ff', violetDeep: '#3a2b9c', cyan: '#22d3ee', white: '#f2f5fb', mist: '#c9d2e3',
  dim: '#8b98a9', green: '#34d399', red: '#f87171', slate: '#94a3b8',
};
const F = {
  tamil: (s) => font(s, 'Noto Sans Tamil', 500),
  sans: (s, w = 500) => font(s, 'Space Grotesk', w),
  serif: (s) => font(s, 'Instrument Serif'),
  italic: (s) => font(s, 'Instrument Serif', '', 'italic'),
  mono: (s, w = 500) => font(s, 'JetBrains Mono', w),
};
let IRIS, SOFT, SHARP, LINES_W, LINES_S, GRAIN, VIG, DUST, PTS, CLAIMS, CLUSTER;

/* ---------------------------------------------------------------- the iris, grown once */
function makeIris(size, seed) {
  const c = cv(size, size), g = c.getContext('2d'), r = rng(seed), R = size / 2;
  const base = g.createRadialGradient(R, R, R * 0.16, R, R, R);
  base.addColorStop(0, '#07051a'); base.addColorStop(0.28, '#231870'); base.addColorStop(0.5, '#3527a6');
  base.addColorStop(0.72, '#123f73'); base.addColorStop(0.9, '#08182a'); base.addColorStop(1, 'rgba(3,4,9,0)');
  g.fillStyle = base; g.beginPath(); g.arc(R, R, R, 0, 7); g.fill();
  g.globalCompositeOperation = 'lighter';
  const pal = ['#8b76ff', '#22d3ee', '#4f7cff', '#dfe8ff', '#6b5cff', '#1fb5d6'];
  for (let i = 0; i < 11000; i++) {
    const a = r() * Math.PI * 2, r0 = R * (0.19 + r() * 0.07), r1 = R * (0.5 + r() * 0.46), wig = (r() - 0.5) * 0.09, col = pal[(r() * pal.length) | 0];
    g.strokeStyle = rgba(col, 0.025 + r() * 0.06); g.lineWidth = 0.6 + r() * 1.7; g.beginPath();
    for (let k = 0; k <= 9; k++) { const u = k / 9, rad = lerp(r0, r1, u), aa = a + wig * Math.sin(u * 6.28 + i); k ? g.lineTo(R + Math.cos(aa) * rad, R + Math.sin(aa) * rad) : g.moveTo(R + Math.cos(aa) * rad, R + Math.sin(aa) * rad); }
    g.stroke();
  }
  // the collarette: a bright, uneven ring a third of the way out
  for (let i = 0; i < 700; i++) {
    const a = (i / 700) * Math.PI * 2, rad = R * (0.36 + 0.035 * Math.sin(a * 7 + r()) + (r() - 0.5) * 0.02);
    g.fillStyle = rgba(r() < 0.5 ? '#b6a8ff' : '#7fe7ff', 0.08 + r() * 0.1); g.beginPath(); g.arc(R + Math.cos(a) * rad, R + Math.sin(a) * rad, 1 + r() * 3.5, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 38; i++) { // crypts
    const a = r() * Math.PI * 2, rad = R * (0.42 + r() * 0.4);
    g.save(); g.translate(R + Math.cos(a) * rad, R + Math.sin(a) * rad); g.rotate(a); g.fillStyle = `rgba(2,2,10,${0.2 + r() * 0.3})`;
    g.beginPath(); g.ellipse(0, 0, 6 + r() * 20, 3 + r() * 7, 0, 0, 7); g.fill(); g.restore();
  }
  const limb = g.createRadialGradient(R, R, R * 0.8, R, R, R);
  limb.addColorStop(0, 'rgba(0,0,0,0)'); limb.addColorStop(0.75, 'rgba(1,2,8,0.75)'); limb.addColorStop(1, 'rgba(1,2,8,0)');
  g.fillStyle = limb; g.fillRect(0, 0, size, size);
  return c;
}
function drawIris(g, cx, cy, R, pupil, t, { reveal = 1, alpha = 1, glow = 1 } = {}) {
  if (reveal <= 0 || alpha <= 0) return;
  g.save(); g.globalAlpha = alpha;
  const halo = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.5);
  halo.addColorStop(0, rgba(C.violet, 0.12 * glow)); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);
  g.save(); g.beginPath(); g.arc(cx, cy, R * reveal, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(t * 0.01); g.drawImage(IRIS, -R, -R, R * 2, R * 2); g.restore();
  const pr = R * pupil, pg = g.createRadialGradient(cx, cy, pr * 0.82, cx, cy, pr * 1.08);
  pg.addColorStop(0, '#000'); pg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = pg; g.beginPath(); g.arc(cx, cy, pr * 1.1, 0, 7); g.fill();
  g.strokeStyle = rgba(C.cyan, 0.18 * glow); g.lineWidth = R * 0.012; g.beginPath(); g.arc(cx, cy, pr * 1.02, 0, 7); g.stroke();
  if (reveal < 1) { g.strokeStyle = rgba(C.cyan, 0.5 * (1 - reveal)); g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R * reveal, 0, 7); g.stroke(); }
  g.globalCompositeOperation = 'lighter'; // speculars: the window and the soft top light
  const sp = g.createRadialGradient(cx - R * 0.32, cy - R * 0.36, 0, cx - R * 0.32, cy - R * 0.36, R * 0.22);
  sp.addColorStop(0, `rgba(255,255,255,${0.55 * reveal})`); sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.fillStyle = `rgba(255,255,255,${0.75 * reveal})`; rr(g, cx - R * 0.28, cy - R * 0.46, R * 0.1, R * 0.07, R * 0.02); g.fill();
  g.restore();
}
function blink(g, amount) {
  if (amount <= 0) return;
  const k = E.inOutCubic(clamp(amount)), h = (H / 2 + 80) * k;
  g.save(); g.fillStyle = '#000';
  g.beginPath(); g.moveTo(-10, -10); g.lineTo(W + 10, -10); g.lineTo(W + 10, h - 60); g.quadraticCurveTo(W / 2, h + 70, -10, h - 60); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-10, H + 10); g.lineTo(W + 10, H + 10); g.lineTo(W + 10, H - h + 60); g.quadraticCurveTo(W / 2, H - h - 70, -10, H - h + 60); g.closePath(); g.fill();
  g.restore();
}

/* ---------------------------------------------------------------- text that arrives like focus */
function say(g, s, x, y, f, color, t, t0, t1, { align = 'center', ls = 0, drift = 16, inD = 0.9, outD = 0.7, lsDrift = 5 } = {}) {
  const a = life(t, t0, t1, inD, outD); if (a <= 0) return;
  const u = E.outCubic(P(t, t0, 1.1));
  g.save(); g.globalAlpha = a; if (u < 1) g.filter = `blur(${((1 - u) * 7).toFixed(2)}px)`;
  setText(g, f, { align, ls: ls + (1 - u) * lsDrift, color }); g.fillText(s, x, y + (1 - u) * drift); g.restore();
}
function saySpans(g, spans, x, y, f, t, t0, t1, opts = {}) {
  const a = life(t, t0, t1, 0.9, 0.7); if (a <= 0) return;
  const u = E.outCubic(P(t, t0, 1.1));
  g.save(); if (u < 1) g.filter = `blur(${((1 - u) * 7).toFixed(2)}px)`;
  drawSpans(g, spans, x, y + (1 - u) * 16, f, { align: 'center', alpha: a, ...opts }); g.restore();
}
function band(g, y, h, a) { const gr = g.createLinearGradient(0, y - h, 0, y + h); gr.addColorStop(0, 'rgba(3,4,9,0)'); gr.addColorStop(0.5, `rgba(3,4,9,${a})`); gr.addColorStop(1, 'rgba(3,4,9,0)'); g.fillStyle = gr; g.fillRect(0, y - h, W, h * 2); }

/* ---------------------------------------------------------------- the population, as light */
function buildField() {
  const r = rng(10262); PTS = [];
  for (let i = 0; i < 10262; i++) {
    const a = r() * Math.PI * 2, arm = Math.sin(a * 2 + r() * 0.6) * 0.18, rad = Math.sqrt(-2 * Math.log(1 - r() * 0.995)) * 250 * (1 + arm);
    PTS.push([960 + Math.cos(a) * rad * 1.65, 540 + Math.sin(a) * rad * 0.85, r()]);
  }
  const pal = ['#8b76ff', '#22d3ee', '#dfe8ff', '#6b8cff'];
  SOFT = cv(W, H); SHARP = cv(W, H);
  const sg = SOFT.getContext('2d'), hg = SHARP.getContext('2d'); sg.globalCompositeOperation = hg.globalCompositeOperation = 'lighter';
  for (const [x, y, k] of PTS) {
    const col = pal[Math.floor(k * 4)], rad = 2 + k * 6;
    const gr = sg.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(col, 0.2)); gr.addColorStop(0.7, rgba(col, 0.12)); gr.addColorStop(1, rgba(col, 0));
    sg.fillStyle = gr; sg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    hg.fillStyle = rgba(col, 0.45 + k * 0.4); hg.fillRect(x - 0.8, y - 0.8, 1.6 + k, 1.6 + k);
  }
  // 85 payment claims, near the core; 12 resolve; of the 73 that do not, 64 are real elsewhere, 9 nowhere
  const core = PTS.map((p, i) => [Math.hypot((p[0] - 960) / 1.65, (p[1] - 540) / 0.85), i]).sort((a, b) => a[0] - b[0]);
  const pick = []; for (let k = 0; k < 85; k++) pick.push(core[40 + k * 23][1]);
  const trueSet = new Set([...Array(12).keys()].map((k) => Math.round(k * 7.08 + 3) % 85));
  const falses = [...Array(85).keys()].filter((i) => !trueSet.has(i));
  const nowhere = new Set([...Array(9).keys()].map((k) => falses[Math.round(k * 8.1 + 4)]));
  CLAIMS = pick.map((idx, i) => {
    const a = (i / 85) * Math.PI * 2 - Math.PI / 2;
    return { p: PTS[idx], q: [960 + Math.cos(a) * 300, 520 + Math.sin(a) * 300], a, v: trueSet.has(i) ? 'true' : nowhere.has(i) ? 'nowhere' : 'elsewhere', i };
  });
  // 8,093 agents behind one registration document
  const order = [...Array(PTS.length).keys()]; for (let i = order.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
  CLUSTER = order.slice(0, 8093);
  LINES_W = cv(W, H); LINES_S = cv(W, H);
  for (const [cvs, col] of [[LINES_W, '#dfe8ff'], [LINES_S, '#94a3b8']]) {
    const g = cvs.getContext('2d'); g.globalCompositeOperation = 'lighter'; g.strokeStyle = rgba(col, 0.03); g.lineWidth = 1;
    for (const i of CLUSTER) { const [x, y] = PTS[i]; g.beginPath(); g.moveTo(x, y); g.lineTo(960, 540); g.stroke(); }
    g.fillStyle = rgba(col, 0.6); for (const i of CLUSTER) { const [x, y] = PTS[i]; g.fillRect(x - 1, y - 1, 2, 2); }
  }
}

/* ---------------------------------------------------------------- anatomy, in world units */
const EX = 980, EY = 540, ER = 380;
const deg = (d) => (d * Math.PI) / 180;
const circ = (cx, cy, r, a0, a1, n = 120) => sampleCurve((u) => [cx + Math.cos(lerp(a0, a1, u)) * r, cy + Math.sin(lerp(a0, a1, u)) * r], n);
const ANAT = {};
function buildAnatomy() {
  ANAT.sclera = polyPath(circ(EX, EY, ER, deg(-143.9), deg(143.9), 200));
  ANAT.cornea = polyPath(circ(EX - 235, EY, 235, deg(107.9), deg(252.1), 90));
  ANAT.irisU = polyPath([[EX - 290, EY - 232], [EX - 286, EY - 150], [EX - 290, EY - 62]]);
  ANAT.irisL = polyPath([[EX - 290, EY + 232], [EX - 286, EY + 150], [EX - 290, EY + 62]]);
  ANAT.lens = polyPath(sampleCurve((u) => [EX - 245 + Math.cos(u * 6.2832) * 44, EY + Math.sin(u * 6.2832) * 150], 80));
  ANAT.retina = polyPath(sampleCurve((u) => { const a = deg(lerp(-120, 120, u)), dip = 12 * Math.exp(-((a / 0.05) ** 2)); return [EX + Math.cos(a) * (362 - dip), EY + Math.sin(a) * (362 - dip)]; }, 240));
  const disc = [EX + 380 * Math.cos(deg(20)), EY + 380 * Math.sin(deg(20))];
  ANAT.disc = disc; ANAT.fovea = [EX + 350, EY]; ANAT.chiasm = [EX + 700, EY + 235]; ANAT.registry = [EX + 800, EY + 70];
  ANAT.nerve = polyPath([disc, [EX + 430, EY + 152], [EX + 520, EY + 185], [EX + 620, EY + 212], ANAT.chiasm]);
  ANAT.nerve2 = polyPath([[EX + 610, EY + 620], [EX + 650, EY + 470], [EX + 680, EY + 340], ANAT.chiasm]);
  ANAT.tract = polyPath([ANAT.chiasm, [EX + 745, EY + 175], [EX + 780, EY + 115], ANAT.registry]);
  const toDisc = sampleCurve((u) => { const a = deg(lerp(0, 20, u)); return [EX + Math.cos(a) * 356, EY + Math.sin(a) * 356]; }, 20);
  ANAT.ray = polyPath([[-240, EY - 70], [EX - 462, EY - 32], [EX - 290, EY - 12], [EX - 245, EY - 4], [EX + 346, EY], ...toDisc, ...ANAT.nerve.pts.slice(1), ...ANAT.tract.pts.slice(1)]);
  const at = (pt) => { let best = 0, bd = 1e9; ANAT.ray.pts.forEach((p, i) => { const d = Math.hypot(p[0] - pt[0], p[1] - pt[1]); if (d < bd) { bd = d; best = i; } }); return ANAT.ray.lens[best]; };
  ANAT.L = { cornea: at([EX - 462, EY - 32]), aqueous: at([EX - 290, EY - 12]) - 60, iris: at([EX - 290, EY - 12]), retina: at([EX + 346, EY]) - 260, fovea: at([EX + 346, EY]), chiasm: at(ANAT.chiasm), registry: ANAT.ray.L };
}
function glow(g, path, color, w, u0, u1, a = 1) {
  if (u1 <= u0) return;
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [k, al] of [[5, 0.06], [2.2, 0.18], [1, 0.95]]) { g.strokeStyle = rgba(color, al * a); g.lineWidth = w * k; strokeSpan(g, path, path.L * u0, path.L * u1); }
  g.restore();
}
/* The nine stops of the tour. Screen-space lower third, leader line to the part. */
const STOPS = [
  { t: 57.5, name: 'CORNEA', what: 'the surface', line: 'kanmani.xyz: every claim, with the command to re-derive it', chip: 'SITE', at: () => [EX - 462, EY - 32], cam: [EX - 420, EY - 20, 2.1], L: 'cornea' },
  { t: 62.0, name: 'AQUEOUS', what: 'escrow the job', line: 'USDC held in escrow until the work lands', chip: 'LIVE', at: () => [EX - 360, EY + 40], cam: [EX - 360, EY, 2.0], L: 'aqueous' },
  { t: 66.5, name: 'IRIS · x402', what: 'pay without a wallet', line: 'one passkey is the whole account. the buyer needs no MON', chip: 'LIVE', at: () => [EX - 290, EY - 110], cam: [EX - 300, EY - 10, 2.0], L: 'iris' },
  { t: 71.0, name: 'RETINA', what: 'index the evidence', line: 'every evidence pointer on chain, indexed so it can be checked', chip: 'LIVE', at: () => [EX + 256, EY - 256], cam: [EX + 200, EY - 30, 1.35], L: 'retina' },
  { t: 75.5, name: 'FOVEA', what: 'verify the claim', line: 'the sharpest point: read the chain the document names, at a block', chip: 'LIVE', at: () => [EX + 350, EY], cam: [EX + 330, EY + 10, 2.5], L: 'fovea' },
  { t: 80.0, name: 'OPTIC', what: 'answer on chain', line: "the verdict, written into ERC-8004's Validation Registry", chip: 'LIVE', at: () => ANAT.registry, cam: [EX + 610, EY + 130, 1.45], L: 'registry' },
  { t: 84.5, name: 'CHIASM', what: 'read every chain at once', line: "BSC beside Monad, merged on the document's content hash", chip: 'LIVE', at: () => ANAT.chiasm, cam: [EX + 660, EY + 330, 1.6], L: 'registry' },
  { t: 89.0, name: 'SCLERA', what: 'bond the promise', line: 'USDC staked on a claim-truth floor. a signed verdict slashes it', chip: 'LIVE', at: () => [EX + 270, EY + 270], cam: [EX + 60, EY + 20, 0.98], L: 'registry' },
  { t: 93.0, name: 'SELF-HEAL', what: 'heal a fixed record', line: 'repair the document and the record re-reads itself', chip: 'LIVE', at: () => [ANAT.registry[0] + 100, ANAT.registry[1] + 20], cam: [EX + 905, EY + 40, 2.1], L: 'registry' },
  { t: 96.6, name: 'INTENTS', what: 'fund from any chain', line: '0.12 USDT left BSC. the escrow on Monad funded itself', chip: 'LIVE', at: () => [EX - 700, EY - 330], cam: [EX + 120, EY - 40, 0.94], L: 'registry' },
];
let CAM6, RAYL;
function anatomy(g, t) {
  const cam = CAM6(t), z = cam.z;
  g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-cam.x, -cam.y);
  const d = (t0, d = 1.6) => E.inOutCubic(P(t, t0, d));
  const k = life(t, 54, 99.6, 1, 0.8);
  g.globalAlpha = k;
  // aqueous glow, then the escrow fill while Aqueous is on stage
  const fill = P(t, 62.4, 2.2);
  g.save(); g.beginPath(); g.arc(EX - 235, EY, 235, 0, 7); g.clip(); g.beginPath(); g.rect(EX - 520, EY - 260, 230, 520); g.clip();
  const aq = g.createRadialGradient(EX - 380, EY, 0, EX - 380, EY, 240); aq.addColorStop(0, rgba(C.cyan, 0.08 + 0.2 * fill)); aq.addColorStop(1, rgba(C.violet, 0.02 + 0.08 * fill));
  g.fillStyle = aq; g.fillRect(EX - 520, EY - 260, 240, 520);
  if (fill > 0) { const r = rng(7); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 70; i++) { const x = EX - 470 + r() * 180, y = EY - 220 + ((r() * 440 + t * (8 + r() * 14)) % 440); g.fillStyle = rgba(r() < 0.5 ? C.cyan : C.violet, 0.5 * fill); g.beginPath(); g.arc(x, y, 1.5 + r() * 2.5, 0, 7); g.fill(); } }
  g.restore();
  const sw = 3 + 7 * life(t, 89.2, 93.0, 0.6, 0.8);
  const sc = life(t, 89.3, 93.0, 0.6, 0.6);
  if (sc > 0) { g.save(); g.globalCompositeOperation = 'lighter'; for (let q = 0; q < 3; q++) { const age = ((t - 89.3) * 0.8 + q / 3) % 1; g.strokeStyle = rgba('#e7ecff', 0.35 * sc * (1 - age)); g.lineWidth = 2; g.beginPath(); g.arc(EX, EY, ER + 8 + age * 70, deg(-143.9), deg(143.9)); g.stroke(); } g.setLineDash([10, 10]); g.strokeStyle = rgba(C.violet, 0.8 * sc); g.lineWidth = 2.5; g.beginPath(); g.arc(EX, EY, ER * 0.8, deg(-120), deg(120)); g.stroke(); g.setLineDash([]); setText(g, F.mono(20, 700), { color: C.violet, ls: 2, align: 'center' }); g.globalAlpha = sc; g.fillText('FLOOR 80%', EX + 40, EY - ER * 0.8 + 34); g.restore(); }
  glow(g, ANAT.sclera, t > 89 && t < 93 ? '#e7ecff' : '#9fb0d8', sw, 0, d(54.0, 1.8));
  glow(g, ANAT.cornea, C.cyan, 3.2, 0, d(54.3, 1.2));
  const open = 1 + 0.5 * life(t, 66.8, 70.8, 0.8, 1.0);
  const iu = polyPath([[EX - 290, EY - 232], [EX - 286, EY - 150], [EX - 290, EY - 62 * open]]), il = polyPath([[EX - 290, EY + 232], [EX - 286, EY + 150], [EX - 290, EY + 62 * open]]);
  glow(g, iu, C.violet, 11, 0, d(54.6, 0.9)); glow(g, il, C.violet, 11, 0, d(54.6, 0.9));
  glow(g, ANAT.lens, '#b8c6ff', 2.4, 0, d(54.9, 1.0));
  glow(g, ANAT.retina, C.violet, 3.4, 0, d(55.1, 1.4));
  // retina receptors light up in sequence while Retina is on stage
  const rs = P(t, 71.2, 2.4);
  if (rs > 0) { g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 160; i++) { const p = pointAt(ANAT.retina, (i / 160) * ANAT.retina.L), on = clamp((rs * 160 - i) / 12); if (on <= 0) continue; g.fillStyle = rgba(C.cyan, 0.8 * on * (0.6 + 0.4 * Math.sin(t * 3 + i))); g.beginPath(); g.arc(p[0] - 10, p[1], 2.6, 0, 7); g.fill(); } g.restore(); }
  glow(g, ANAT.nerve, C.violet, 9, 0, d(55.5, 1.0), 0.8);
  glow(g, ANAT.tract, C.violet, 7, 0, d(80.2, 1.0), 0.9);
  glow(g, ANAT.nerve2, C.cyan, 8, 0, d(84.8, 1.4), 0.9);
  // fovea: a reticle closes onto the sharpest point
  const fv = life(t, 75.7, 80.0, 0.3, 0.6);
  if (fv > 0) { g.save(); g.globalCompositeOperation = 'lighter'; const rad = lerp(60, 14, E.outCubic(P(t, 75.8, 1.4))); g.strokeStyle = rgba(C.white, 0.8 * fv); g.lineWidth = 1.4; g.beginPath(); g.arc(ANAT.fovea[0], ANAT.fovea[1], rad, 0, 7); g.stroke(); for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2; g.beginPath(); g.moveTo(ANAT.fovea[0] + Math.cos(a) * (rad + 6), ANAT.fovea[1] + Math.sin(a) * (rad + 6)); g.lineTo(ANAT.fovea[0] + Math.cos(a) * (rad + 18), ANAT.fovea[1] + Math.sin(a) * (rad + 18)); g.stroke(); } g.fillStyle = rgba(C.white, fv); g.beginPath(); g.arc(ANAT.fovea[0], ANAT.fovea[1], 3.4, 0, 7); g.fill(); g.restore(); }
  // the registry, where the optic tract ends: a block that gains a row
  const rg = P(t, 80.6, 0.8);
  if (rg > 0) {
    const [x, y] = ANAT.registry; g.save(); g.globalAlpha = k * rg;
    g.fillStyle = 'rgba(12,14,28,0.92)'; rr(g, x - 10, y - 70, 250, 120, 12); g.fill(); g.strokeStyle = rgba(C.violet, 0.9); g.lineWidth = 2; g.stroke();
    setText(g, F.mono(15, 700), { color: C.violet, ls: 1 }); g.fillText('ERC-8004', x + 8, y - 44);
    setText(g, F.mono(14, 500), { color: C.mist }); g.fillText('Validation Registry', x + 8, y - 24);
    const row = P(t, 81.6, 0.5), heal = t > 93.9 && t < 95.6;
    const reread = P(t, 94.7, 0.9), rowC = heal ? (t < 94.7 ? C.slate : mixHex(C.slate, C.cyan, reread)) : C.cyan;
    g.fillStyle = rgba(rowC, 0.9 * row); g.fillRect(x + 8, y - 8, 214 * row * (heal && t >= 94.7 ? reread : 1), 12);
    if (t > 93.9 && t < 96.4) { setText(g, F.mono(14, 700), { color: t < 94.7 ? C.slate : C.cyan, ls: 1 }); g.globalAlpha = k * life(t, 93.9, 96.4, 0.2, 0.4); g.fillText(t < 94.7 ? 'stale verdict: back to unknown' : 're-read from the event stream', x + 8, y + 42); g.globalAlpha = k * rg; }
    const row2 = P(t, 86.0, 0.5); g.fillStyle = rgba(C.cyan, 0.55 * row2); g.fillRect(x + 8, y + 14, 150 * row2, 12);
    g.restore();
  }
  if (t > 84.6) { const a = life(t, 84.8, 99.6, 0.8, 0.8); g.save(); g.globalAlpha = a * k; setText(g, F.mono(17, 700), { color: C.cyan, ls: 1 }); g.fillText('BSC · chain 56', EX + 740, EY + 400); setText(g, F.mono(17, 700), { color: C.violet }); g.fillText('Monad · chain 143', EX + 480, EY + 140); g.restore(); }
  // Intents: money held on another chain arrives in the escrow. Live since the BSC fund landed.
  const it = life(t, 96.4, 99.6, 0.4, 0.6);
  if (it > 0) {
    const u = E.inOutCubic(P(t, 96.6, 1.3)), x1 = lerp(EX - 900, EX - 390, u), y1 = lerp(EY - 480, EY - 20, u);
    g.save(); g.globalAlpha = it * k; g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const [w, a] of [[16, 0.08], [6, 0.3], [2.5, 1]]) { g.strokeStyle = rgba(C.cyan, a); g.lineWidth = w; g.beginPath(); g.moveTo(EX - 900, EY - 480); g.lineTo(x1, y1); g.stroke(); }
    const land = P(t, 97.9, 0.9); if (land > 0 && land < 1) { const gr = g.createRadialGradient(EX - 390, EY - 20, 0, EX - 390, EY - 20, 40 + 200 * land); gr.addColorStop(0, rgba(C.cyan, 0.6 * (1 - land))); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(EX - 640, EY - 270, 500, 500); }
    g.globalCompositeOperation = 'source-over'; setText(g, F.mono(17, 700), { color: C.cyan, ls: 1 }); g.fillText('BSC · 0.12 USDT', EX - 880, EY - 500); g.restore();
  }
  // the claim itself: a packet of light along the ray, with a comet trail
  const L = RAYL(t).L;
  if (t > 55.6) {
    g.save(); g.globalCompositeOperation = 'lighter';
    const trail = 260; for (let s = 0; s < 14; s++) { const a = (1 - s / 14) ** 2; g.strokeStyle = rgba(s < 3 ? C.white : C.cyan, 0.4 * a); g.lineWidth = 5 * (1 - s / 14) + 1; strokeSpan(g, ANAT.ray, Math.max(0, L - (trail * (s + 1)) / 14), Math.max(0, L - (trail * s) / 14)); }
    const p = pointAt(ANAT.ray, L), gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], 42); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.25, rgba(C.cyan, 0.6)); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(p[0] - 42, p[1] - 42, 84, 84);
    if (t > 84.8) { const L2 = ANAT.nerve2.L * E.inOutCubic(P(t, 85.0, 1.6)), q = pointAt(ANAT.nerve2, L2), g2 = g.createRadialGradient(q[0], q[1], 0, q[0], q[1], 34); g2.addColorStop(0, 'rgba(255,255,255,0.9)'); g2.addColorStop(0.3, rgba(C.cyan, 0.5)); g2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = g2; g.fillRect(q[0] - 34, q[1] - 34, 68, 68); }
    g.restore();
  }
  g.restore();
  blink(g, t > 93.1 && t < 93.95 ? Math.sin(Math.PI * P(t, 93.1, 0.85)) : 0);
  // lower-third caption for the current stop, with a leader line to the part
  for (let i = 0; i < STOPS.length; i++) {
    const s = STOPS[i], t1 = i + 1 < STOPS.length ? STOPS[i + 1].t : 99.2, a = life(t, s.t + 0.2, t1, 0.6, 0.5); if (a <= 0) continue;
    const [px, py] = s.at(), sx = (px - cam.x) * z + W / 2, sy = (py - cam.y) * z + H / 2, bx = 96, by = 820;
    g.save(); g.globalAlpha = a * k;
    const gr = g.createLinearGradient(0, 700, 0, H); gr.addColorStop(0, 'rgba(3,4,9,0)'); gr.addColorStop(0.45, 'rgba(3,4,9,0.82)'); gr.addColorStop(1, 'rgba(3,4,9,0.92)');
    g.fillStyle = gr; g.fillRect(0, 700, W, H - 700);
    const lu = E.outCubic(P(t, s.t + 0.3, 0.7)); g.strokeStyle = rgba(C.mist, 0.55); g.lineWidth = 1.5; g.setLineDash([4, 6]);
    g.beginPath(); g.moveTo(bx + 6, by - 20); g.lineTo(lerp(bx + 6, sx, lu), lerp(by - 20, sy, lu)); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.white; g.beginPath(); g.arc(sx, sy, 5 * lu, 0, 7); g.fill(); g.strokeStyle = rgba(C.white, 0.5 * lu); g.beginPath(); g.arc(sx, sy, 12 + 6 * Math.sin(t * 4), 0, 7); g.stroke();
    const u = E.outCubic(P(t, s.t + 0.2, 0.8)), dx = (1 - u) * -30;
    setText(g, F.sans(64, 600), { color: s.chip === 'BUILT' ? C.slate : C.violet, ls: 2 }); g.fillText(s.name, bx + dx, by + 40);
    const nw = textW(F.sans(64, 600), s.name, 2);
    const chipC = s.chip === 'BUILT' ? C.slate : s.chip === 'SITE' ? C.mist : C.violet;
    g.strokeStyle = chipC; g.lineWidth = 2; rr(g, bx + nw + 28 + dx, by - 4, 112, 38, 19); g.stroke();
    setText(g, F.mono(21, 700), { color: chipC, ls: 3, align: 'center' }); g.fillText(s.chip, bx + nw + 84 + dx, by + 23);
    setText(g, F.mono(27, 600), { color: C.cyan, ls: 4 }); g.fillText(s.what.toUpperCase(), bx + dx * 0.6, by + 90);
    setText(g, F.italic(44), { color: C.white }); g.fillText(s.line, bx + dx * 0.3, by + 148);
    g.restore();
  }
}

/* ---------------------------------------------------------------- scenes */
function sceneName(g, t) {
  const push = E.inCubic(P(t, 10.1, 1.9)), s = 1 + push * 18, cx = 960, cy = 420;
  g.save(); g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy);
  const spark = life(t, 0.3, 2.4, 0.6, 1.0);
  if (spark > 0) { g.save(); g.globalCompositeOperation = 'lighter'; const rad = 6 + 3 * Math.sin(t * 5); const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad * 8); gr.addColorStop(0, rgba(C.white, 0.9 * spark)); gr.addColorStop(0.2, rgba(C.cyan, 0.5 * spark)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(cx - rad * 8, cy - rad * 8, rad * 16, rad * 16); g.restore(); }
  const rev = E.outCubic(P(t, 1.2, 3.4)), pupil = lerp(0.62, 0.34, E.inOutCubic(P(t, 2.4, 2.4))) + 0.012 * Math.sin(t * 1.3);
  drawIris(g, cx, cy, 300, pupil, t, { reveal: rev });
  g.restore();
  const out = 1 - P(t, 9.8, 0.8);
  say(g, 'கண்மணி', 960, 850, F.tamil(104), C.white, t, 3.2, 10.6, { ls: 0, lsDrift: 0 });
  say(g, 'kanmani · the apple of the eye', 960, 932, F.italic(52), C.mist, t, 4.6, 10.4);
  say(g, 'the thing you hold safe.', 960, 998, F.italic(46), C.mist, t, 6.4, 10.4);
  if (push > 0.6) { g.fillStyle = `rgba(0,0,0,${clamp((push - 0.6) / 0.35)})`; g.fillRect(0, 0, W, H); }
}
function fieldLayer(g, t, a, focus) {
  if (a <= 0) return;
  g.save(); g.globalAlpha = a; g.translate(960, 540); g.rotate(0.02 * Math.sin(t * 0.05) + (t - 12) * 0.002); g.scale(1 + (t - 12) * 0.003, 1 + (t - 12) * 0.003); g.translate(-960, -540);
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * (1 - focus); g.drawImage(SOFT, 0, 0); g.globalAlpha = a * focus; g.drawImage(SHARP, 0, 0);
  g.restore();
}
function sceneRegistry(g, t) {
  const dark = 1 - 0.55 * life(t, 21.6, 27.2, 0.8, 0.1);
  fieldLayer(g, t, P(t, 12.0, 1.8) * dark * (1 - P(t, 27.0, 1.2) * 0.8), E.inOutCubic(P(t, 23.4, 2.6)));
  const tick = life(t, 18.2, 21.6, 0.3, 0.6);
  if (tick > 0) { const r = rng(88); g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; for (let i = 0; i < 42; i++) { const p = PTS[(r() * PTS.length) | 0], on = clamp((t - 18.2 - i * 0.05) / 0.25) * tick; if (on <= 0) continue; g.strokeStyle = rgba(C.white, 0.85 * on); g.lineWidth = 2.4; g.beginPath(); g.moveTo(p[0] - 7, p[1]); g.lineTo(p[0] - 2, p[1] + 5); g.lineTo(p[0] + 8, p[1] - 7); g.stroke(); } g.restore(); }
  band(g, 510, 150, 0.55 * life(t, 12.6, 27, 0.6, 0.6));
  say(g, '10,262', 960, 520, F.sans(210, 300), C.white, t, 12.8, 17.4, { ls: -4 });
  say(g, "agents registered on Monad's ERC-8004 registry", 960, 600, F.italic(48), C.mist, t, 13.6, 17.4);
  say(g, 'Every tool checks the hash.', 960, 510, F.sans(68, 500), C.white, t, 17.8, 21.4);
  say(g, 'All of them pass.', 960, 590, F.italic(52), C.mist, t, 19.0, 21.4);
  band(g, 300, 90, 0.7 * life(t, 21.6, 26.6, 0.6, 0.6)); say(g, 'None of them look at the payment.', 960, 320, F.sans(66, 500), C.white, t, 21.8, 26.4);
  const cl = life(t, 23.6, 27.6, 0.8, 0.2);
  if (cl > 0) { g.save(); g.globalCompositeOperation = 'lighter'; for (const c of CLAIMS) { const [x, y] = c.p; const gr = g.createRadialGradient(x, y, 0, x, y, 12); gr.addColorStop(0, rgba(C.white, 0.9 * cl)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 12, y - 12, 24, 24); } g.restore(); }
  say(g, '85 payment claims', 960, 960, F.mono(40, 600), C.white, t, 24.2, 27.2, { ls: 6 });
}
function sceneFocus(g, t) {
  fieldLayer(g, t, 0.2 * (1 - P(t, 40.5, 1.5)), 1);
  const scan0 = 28.6, scanD = 4.0, ang = ((t - scan0) / scanD) * Math.PI * 2 - Math.PI / 2, scanning = t > scan0 && t < scan0 + scanD + 0.2;
  const fade = 1 - P(t, 40.2, 1.6);
  if (scanning) {
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 24; k++) { const a = ang - k * 0.035; g.strokeStyle = rgba(C.cyan, 0.35 * (1 - k / 24)); g.lineWidth = 2; g.beginPath(); g.moveTo(960, 520); g.lineTo(960 + Math.cos(a) * 340, 520 + Math.sin(a) * 340); g.stroke(); }
    g.restore();
  }
  g.save(); g.globalAlpha = fade; g.strokeStyle = rgba(C.mist, 0.18); g.lineWidth = 1; g.beginPath(); g.arc(960, 520, 300, 0, 7); g.stroke();
  const outer = life(t, 36.4, 42, 0.8, 0.6);
  if (outer > 0) { g.setLineDash([3, 8]); g.strokeStyle = rgba(C.cyan, 0.4 * outer); g.beginPath(); g.arc(960, 520, 420, 0, 7); g.stroke(); g.setLineDash([]); setText(g, F.mono(20, 600), { color: C.cyan, ls: 4, align: 'center' }); g.globalAlpha = fade * outer; g.fillText('ANOTHER CHAIN', 960, 520 - 440); }
  g.restore();
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const c of CLAIMS) {
    const m = E.inOutCubic(P(t, 27.0 + c.i * 0.012, 1.4)), x = lerp(c.p[0], c.q[0], m), y = lerp(c.p[1], c.q[1], m);
    const scannedAt = scan0 + ((c.a + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * scanD, sc = P(t, scannedAt, 0.25);
    let col = C.white; if (sc > 0) col = mixHex(C.white, c.v === 'true' ? C.green : C.red, sc);
    const hollow = c.v === 'nowhere' ? P(t, 37.4, 0.8) : 0, rad = 7 + 5 * Math.exp(-(t - scannedAt) * 6) * (t > scannedAt ? 1 : 0);
    g.globalAlpha = fade;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad * 2.2); gr.addColorStop(0, rgba(col, 0.9 * (1 - hollow * 0.85))); gr.addColorStop(0.45, rgba(col, 0.35 * (1 - hollow * 0.6))); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad * 2.2, y - rad * 2.2, rad * 4.4, rad * 4.4);
    if (hollow > 0) { g.strokeStyle = rgba(C.red, 0.9 * hollow); g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); }
    if (c.v === 'elsewhere') {
      const e = E.outCubic(P(t, 36.6 + (c.i % 16) * 0.05, 0.9)); if (e > 0) {
        const ox = 960 + Math.cos(c.a) * lerp(300, 420, e), oy = 520 + Math.sin(c.a) * lerp(300, 420, e);
        g.strokeStyle = rgba(C.cyan, 0.35 * e); g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(ox, oy); g.stroke();
        g.fillStyle = rgba(C.cyan, 0.9 * e); g.beginPath(); g.arc(ox, oy, 4, 0, 7); g.fill();
      }
    }
  }
  g.restore();
  say(g, 'we read the chain each claim names', 960, 970, F.italic(46), C.mist, t, 28.4, 32.8);
  saySpans(g, [['12', C.green], [' true', C.mist]], 960, 505, F.sans(96, 600), t, 33.0, 36.3);
  saySpans(g, [['73', C.red], [' false', C.mist]], 960, 610, F.sans(96, 600), t, 33.4, 36.3);
  saySpans(g, [['64', C.cyan], [' are real, on another chain', C.mist]], 960, 505, F.sans(54, 500), t, 36.6, 39.9);
  saySpans(g, [['9', C.red], [' exist nowhere at all', C.mist]], 960, 585, F.sans(54, 500), t, 37.2, 39.9);
  say(g, 'hash integrity is not claim truth.', 960, 560, F.italic(84), C.white, t, 40.0, 43.2);
}
function sceneBlind(g, t) {
  const a = life(t, 42.4, 51.2, 1.4, 0.8), rev = E.outCubic(P(t, 42.4, 2.2)), dead = E.inOutCubic(P(t, 45.8, 1.4));
  if (a > 0) {
    g.save(); g.beginPath(); g.arc(960, 540, 1300 * rev, 0, 7); g.clip();
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * (1 - dead); g.drawImage(LINES_W, 0, 0); g.globalAlpha = a * dead * 0.7; g.drawImage(LINES_S, 0, 0);
    g.restore();
    const hub = g.createRadialGradient(960, 540, 0, 960, 540, 60); const hc = dead > 0.5 ? C.slate : C.white;
    hub.addColorStop(0, rgba(hc, (1 - dead * 0.7) * a)); hub.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = hub; g.fillRect(900, 480, 120, 120);
    g.fillStyle = `rgba(3,4,9,${0.9 * dead * a})`; g.beginPath(); g.arc(960, 540, 10, 0, 7); g.fill();
    if (dead > 0) { g.save(); g.globalAlpha = a * dead; band(g, 452, 34, 0.8); setText(g, F.mono(30, 700), { color: C.slate, align: 'center', ls: 4 }); g.fillText('NO ANSWER', 960, 462); g.restore(); }
  }
  band(g, 930, 120, 0.85 * a);
  say(g, '8,093 agents · 7,962 wallets', 960, 915, F.sans(60, 500), C.white, t, 43.0, 47.2);
  say(g, 'share one document that no longer answers', 960, 985, F.italic(46), C.mist, t, 43.9, 47.2);
  say(g, 'Not fraud.', 960, 915, F.sans(68, 600), C.white, t, 47.4, 50.6);
  say(g, 'A registry has no way to keep a true statement true.', 960, 985, F.italic(46), C.mist, t, 48.0, 50.6);
  blink(g, P(t, 50.2, 0.7));
}
function sceneBuilt(g, t) {
  const open = 1 - P(t, 51.0, 0.7), a = life(t, 51.0, 54.6, 0.4, 0.9);
  drawIris(g, 960, 460, 380, lerp(0.5, 0.3, E.outCubic(P(t, 51.1, 1.6))) + 0.01 * Math.sin(t * 2), t, { alpha: a, glow: 1.4 });
  say(g, 'So we built an eye.', 960, 975, F.serif(84), C.white, t, 51.4, 54.5);
  blink(g, open);
}
function sceneMainnet(g, t) {
  const a = life(t, 99.2, 111.4, 1.0, 0.8);
  if (a <= 0) return;
  const beat = t > 103.2 ? ((t - 103.2) % 0.266) / 0.266 : 1;
  drawIris(g, 960, 470, 250, 0.33 + 0.02 * (1 - E.outCubic(beat)), t, { alpha: a });
  if (t > 103.2) { g.save(); g.globalCompositeOperation = 'lighter'; for (let k = 0; k < 6; k++) { const age = ((t - 103.2) % 0.266) + k * 0.266, rad = 83 + age * 420, al = Math.max(0, 1 - age / 1.6); if (al <= 0) continue; g.strokeStyle = rgba(C.cyan, 0.5 * al * a); g.lineWidth = 2; g.beginPath(); g.arc(960, 470, rad, 0, 7); g.stroke(); } g.restore(); }
  say(g, 'seen on mainnet', 960, 110, F.sans(56, 600), C.white, t, 99.4, 104.2, { ls: 2 });
  const L = [['1.40', ' USDC escrowed', 100.8], ['30 of 70', ' calls used', 101.4], ['0.60', ' to the agent', 102.0]], R = [['0.80', ' returned, same tx', 102.6], ['0', ' retained', 103.2], ['0 MON', ' ever held by the buyer', 103.8]];
  L.forEach(([n, w, t0], i) => saySpans(g, [[n, C.white], [w, C.dim]], 380, 380 + i * 90, F.mono(36, 600), t, t0, 110.8));
  R.forEach(([n, w, t0], i) => saySpans(g, [[n, C.white], [w, C.dim]], 1560, 380 + i * 90, F.mono(36, 600), t, t0, 110.8));
  say(g, 'a block every 266 ms', 960, 880, F.mono(38, 600), C.cyan, t, 104.6, 110.8, { ls: 3 });
  say(g, 'fast enough for a verdict to land while there is still something to lose', 960, 950, F.italic(44), C.mist, t, 105.6, 110.8);
  say(g, '537 tests passing · contracts verified on Sourcify', 960, 1030, F.mono(27, 500), C.mist, t, 107.8, 110.8, { ls: 2 });
}
function sceneClose(g, t) {
  saySpans(g, [['unknown', C.slate], [' is never ', C.white], ['false', C.red], ['.', C.white]], 960, 560, F.italic(96), t, 111.0, 113.9);
  const form = E.inOutCubic(P(t, 113.9, 1.4)), a = P(t, 113.8, 0.5);
  if (a > 0) {
    drawIris(g, 960, 420, lerp(160, 34, form), 0.34, t, { alpha: a * (1 - form * 0.6) });
    g.save(); g.globalAlpha = a; g.globalCompositeOperation = 'lighter';
    const s = 320 / 32, spread = lerp(24, 0, form);
    drawMark(g, 960, 420, 320, rgba(C.violet, form), null, 2.6, spread);
    const nr = 2.35 * s * form; if (nr > 0) { const gr = g.createRadialGradient(960, 420, 0, 960, 420, nr * 3); gr.addColorStop(0, rgba(C.cyan, 1)); gr.addColorStop(0.35, rgba(C.cyan, 0.9)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(900, 360, 120, 120); }
    g.restore();
  }
  say(g, 'Trust stops being a badge.', 960, 705, F.sans(62, 500), C.white, t, 115.2, 121);
  const pu = P(t, 116.2, 1.1);
  if (pu > 0) {
    g.save(); g.globalAlpha = E.outCubic(pu); if (pu < 1) g.filter = `blur(${((1 - pu) * 6).toFixed(2)}px)`;
    setText(g, F.sans(76, 600), { align: 'center', ls: -1 }); const w = textW(F.sans(76, 600), 'It becomes a price.', -1);
    const gr = g.createLinearGradient(960 - w / 2, 0, 960 + w / 2, 0); gr.addColorStop(0, C.violet); gr.addColorStop(1, C.cyan); g.fillStyle = gr; g.fillText('It becomes a price.', 960, 800);
    g.restore();
  }
  say(g, 'kanmani.xyz', 960, 905, F.mono(38, 600), C.cyan, t, 117.2, 121, { ls: 2 });
}

/* ---------------------------------------------------------------- the frame */
function dust(g, t) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const d of DUST) { const x = (d.x + t * d.vx) % (W + 80) - 40, y = (d.y + t * d.vy + 40 * Math.sin(t * 0.2 + d.p)) % (H + 80) - 40, a = d.a * (0.6 + 0.4 * Math.sin(t * 0.7 + d.p)); const gr = g.createRadialGradient(x, y, 0, x, y, d.r); gr.addColorStop(0, rgba(d.c, a)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - d.r, y - d.r, d.r * 2, d.r * 2); }
  g.restore();
}
function render(g, t, main) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const bgGlow = g.createRadialGradient(960, 540, 0, 960, 540, 1100); bgGlow.addColorStop(0, 'rgba(40,30,110,0.16)'); bgGlow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = bgGlow; g.fillRect(0, 0, W, H);
  dust(g, t);
  if (t < 12.2) sceneName(g, t);
  if (t >= 11.8 && t < 27.8) sceneRegistry(g, t);
  if (t >= 26.8 && t < 43.4) sceneFocus(g, t);
  if (t >= 42.2 && t < 51.2) sceneBlind(g, t);
  if (t >= 50.9 && t < 54.8) sceneBuilt(g, t);
  if (t >= 53.8 && t < 99.8) anatomy(g, t);
  if (t >= 53.8 && t < 57.6) { say(g, 'every layer is named for the part of the eye that does its job', 960, 110, F.italic(46), C.mist, t, 54.4, 57.4); }
  if (t >= 96.8 && t < 99.8) { saySpans(g, [['9 of 9', C.violet], [' layers live', C.mist]], 960, 96, F.mono(42, 700), t, 97.4, 99.6, { ls: 4 }); }
  if (t >= 99 && t < 111.6) sceneMainnet(g, t);
  if (t >= 110.8) sceneClose(g, t);
  bloom(g, main, 0.42, 6);
  g.drawImage(VIG, 0, 0);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.1; g.drawImage(GRAIN[Math.floor((t * FPS) / 2) % GRAIN.length], 0, 0, W, H);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const black = Math.max(1 - t / 0.4, P(t, DUR - 0.6, 0.6));
  if (black > 0) { g.fillStyle = `rgba(0,0,0,${clamp(black)})`; g.fillRect(0, 0, W, H); }
}

async function init() {
  await fontsReady([F.tamil(40), F.sans(40, 500), F.sans(40, 300), F.serif(40), F.italic(40), F.mono(40, 600)]);
  IRIS = makeIris(1400, 143); buildField(); buildAnatomy();
  GRAIN = makeGrain(4); VIG = makeVignette(380, 1200, 0.7);
  const r = rng(5); DUST = [...Array(70)].map(() => ({ x: r() * W, y: r() * H, vx: 4 + r() * 10, vy: -3 - r() * 6, r: 4 + r() * 22, a: 0.03 + r() * 0.07, p: r() * 6, c: r() < 0.5 ? C.violet : C.cyan }));
  const keys = [{ t: 53.8, x: EX + 190, y: EY, z: 0.94 }, { t: 56.9, x: EX + 190, y: EY, z: 0.96 }];
  STOPS.forEach((s, i) => { const hold = i + 1 < STOPS.length ? STOPS[i + 1].t - 0.9 : 98.6; keys.push({ t: s.t + 0.9, x: s.cam[0], y: s.cam[1], z: s.cam[2] }, { t: hold, x: s.cam[0] + 12, y: s.cam[1], z: s.cam[2] * 1.02 }); });
  keys.push({ t: 99.8, x: EX + 150, y: EY, z: 0.9 });
  CAM6 = track(keys);
  const rk = [{ t: 55.6, L: 0 }, { t: 57.0, L: 0 }];
  STOPS.forEach((s, i) => rk.push({ t: s.t + 1.1, L: ANAT.L[s.L] }, { t: (i + 1 < STOPS.length ? STOPS[i + 1].t : 99) + 0.2, L: ANAT.L[s.L] }));
  RAYL = track(rk);
  // sound cues
  cue('bloom', 1.2); cue('whoosh', 10.4, { dur: 1.8 }); cue('boom', 12.0);
  for (let i = 0; i < 42; i++) cue('tick', 18.2 + i * 0.05, { soft: 1 });
  cue('scan', 28.6, { dur: 4.2 }); CLAIMS.forEach((c) => cue(c.v === 'true' ? 'pingT' : 'pingF', 28.6 + ((c.a + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 4.0));
  cue('powerdown', 45.8); cue('blink', 50.3); cue('boom', 51.0, { big: 1 }); cue('blink', 51.0);
  cue('draw', 54.0, { dur: 2.4 }); STOPS.forEach((s) => cue('chime', s.t + 0.2, { name: s.name }));
  cue('fluid', 62.4, { dur: 3.0 }); cue('focus', 75.8); cue('blink', 93.1);
  for (let t = 103.2; t < 110.8; t += 0.266) cue('pulse', t);
  cue('form', 113.9); cue('resolve', 115.2);
}
registerFilm({ duration: DUR, arrangement: { bpm: BPM, bars: 40, film: 'eye' }, init, render });
