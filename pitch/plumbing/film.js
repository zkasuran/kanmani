'use strict';
/*
 * KANMANI · THE PLUMBING
 *
 * "This is a plumbing problem, not a lying problem." The film is an engineering drawing: a
 * blueprint sheet with four figures in piping-and-instrumentation style, drawn stroke by stroke.
 *
 *   0:00  sheet            the drawing unrolls; title block; THE PLUMBING
 *   0:10  FIG. 1           the registry as built: 10,262 taps, every hash gauge reads OK; flow test of 85 claims
 *   0:30  FIG. 2           one dead document: 8,093 agents, 7,962 wallets, one tank that stopped answering
 *   0:42  FIG. 3           Kanmani, re-plumbed: passkey inlet, escrow tank, meter, settle tee, receipt, bond
 *   1:25  FIG. 4           pressure test on Monad mainnet: every run a real transaction
 *   1:45  approval         9 of 9 live; the receipt cannot disagree with the payment; it becomes a price
 *
 * 96 BPM, 48 bars of 2.5 s. Verdict colours only on verdicts: green true, red false, slate unknown.
 */
const DUR = 120, BPM = 96, BEAT = 60 / BPM, BAR = 4 * BEAT;
const C = { paper: '#0b3a6e', paper2: '#0a3160', ink: '#e8f1ff', faint: '#9ec3ee', cyan: '#7fe7ff', violet: '#c3b8ff', green: '#34d399', red: '#f87171', slate: '#94a3b8', amber: '#ffd27a' };
const F = { hand: (s) => font(s, 'Architects Daughter'), mono: (s, w = 600) => font(s, 'JetBrains Mono', w), sans: (s, w = 700) => font(s, 'Space Grotesk', w) };
let PAPER, GRAIN, VIG, CAM;
const PANEL = { title: [0, 0], fig1: [2200, 0], fig2: [4400, 0], fig3: [2200, 1300], fig4: [4400, 1300] };

/* ---------------------------------------------------------------- drawing kit */
function ink(g, pts, t, t0, d, w = 3, color = C.ink) {
  const path = pts.L ? pts : polyPath(pts), u = E.inOutCubic(P(t, t0, d)); if (u <= 0) return path;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = rgba(color, 0.18); g.lineWidth = w * 3.2; strokeSpan(g, path, 0, path.L * u);
  g.strokeStyle = color; g.lineWidth = w; strokeSpan(g, path, 0, path.L * u);
  if (u < 1) { const p = pointAt(path, path.L * u); g.fillStyle = '#fff'; g.beginPath(); g.arc(p[0], p[1], w * 1.4, 0, 7); g.fill(); }
  g.restore(); return path;
}
function flow(g, pts, t, t0, color = C.cyan, w = 5, speed = 120, alpha = 1) {
  const a = P(t, t0, 0.6) * alpha; if (a <= 0) return;
  const path = polyPath(pts);
  g.save(); g.globalAlpha = a; g.lineCap = 'round'; g.strokeStyle = color; g.lineWidth = w; g.setLineDash([18, 22]); g.lineDashOffset = -(t - t0) * speed;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.stroke();
  g.setLineDash([]); const e = pts[pts.length - 1], q = pts[pts.length - 2], ang = Math.atan2(e[1] - q[1], e[0] - q[0]);
  g.fillStyle = color; g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(e[0] - Math.cos(ang - 0.45) * 22, e[1] - Math.sin(ang - 0.45) * 22); g.lineTo(e[0] - Math.cos(ang + 0.45) * 22, e[1] - Math.sin(ang + 0.45) * 22); g.closePath(); g.fill();
  g.restore(); return path;
}
function lettering(g, s, x, y, f, color, t, t0, cps = 38, align = 'left') {
  const n = Math.floor((t - t0) * cps); if (n <= 0) return;
  g.save(); setText(g, f, { align, color }); g.fillText(s.slice(0, n), x, y); g.restore();
}
function hand(g, s, x, y, size, color, t, t0, d = 0.9, align = 'left', rot = -0.015) {
  const u = P(t, t0, d); if (u <= 0) return;
  g.save(); g.translate(x, y); g.rotate(rot); setText(g, F.hand(size), { align, color });
  const w = textW(F.hand(size), s); const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  g.beginPath(); g.rect(x0 - 10, -size * 1.2, (w + 20) * u, size * 1.8); g.clip(); g.fillText(s, 0, 0); g.restore();
}
function bubble(g, x, y, tag, t, t0) {
  const u = P(t, t0, 0.5); if (u <= 0) return;
  ink(g, sampleCurve((v) => [x + Math.cos(v * 6.2832 - 1.57) * 34, y + Math.sin(v * 6.2832 - 1.57) * 34], 40), t, t0, 0.5, 2.5);
  g.save(); g.globalAlpha = P(t, t0 + 0.3, 0.3); g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 34, y); g.lineTo(x + 34, y); g.stroke();
  setText(g, F.mono(17, 700), { align: 'center', color: C.ink }); g.fillText(tag[0], x, y - 8); g.fillText(tag[1], x, y + 24); g.restore();
}
function valve(g, x, y, t, t0, vertical = false, open = 1) {
  const s = 26, a = vertical ? [[x - s, y - s], [x + s, y - s], [x - s, y + s], [x + s, y + s], [x - s, y - s]] : [[x - s, y - s], [x - s, y + s], [x + s, y - s], [x + s, y + s], [x - s, y - s]];
  ink(g, a, t, t0, 0.6, 3);
  if (open < 1 && t > t0 + 0.6) { g.save(); g.fillStyle = rgba(C.ink, 0.9 * (1 - open)); g.beginPath(); a.slice(0, 4).forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); g.restore(); }
  ink(g, [[x, y], [x, y - 48], [x - 22, y - 48], [x + 22, y - 48]], t, t0 + 0.4, 0.4, 3);
}
function tank(g, x, y, w, h, t, t0, level = 0, color = C.cyan, label = '') {
  const r = 34, pts = [[x + r, y], [x + w - r, y], ...sampleCurve((v) => [x + w - r + Math.cos(-1.5708 + v * 1.5708) * r, y + r + Math.sin(-1.5708 + v * 1.5708) * r], 10), [x + w, y + h - r], ...sampleCurve((v) => [x + w - r + Math.cos(v * 1.5708) * r, y + h - r + Math.sin(v * 1.5708) * r], 10), [x + r, y + h], ...sampleCurve((v) => [x + r + Math.cos(1.5708 + v * 1.5708) * r, y + h - r + Math.sin(1.5708 + v * 1.5708) * r], 10), [x, y + r], ...sampleCurve((v) => [x + r + Math.cos(3.1416 + v * 1.5708) * r, y + r + Math.sin(3.1416 + v * 1.5708) * r], 10)];
  ink(g, pts, t, t0, 1.2, 3.5);
  if (level > 0) {
    g.save(); rr(g, x + 6, y + 6, w - 12, h - 12, r - 6); g.clip();
    const ly = y + h - 6 - (h - 12) * level, wave = 6 * Math.sin(t * 3);
    g.fillStyle = rgba(color, 0.2); g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, ly + wave); for (let k = 0; k <= 20; k++) g.lineTo(x + (w * k) / 20, ly + Math.sin(t * 3 + k * 0.7) * 5); g.lineTo(x + w, y + h); g.closePath(); g.fill();
    g.strokeStyle = rgba(color, 0.55); g.lineWidth = 2; for (let k = -h; k < w + h; k += 18) { g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); g.stroke(); }
    g.restore();
    g.save(); g.globalCompositeOperation = 'destination-over'; g.restore();
  }
  if (label) lettering(g, label, x + w / 2, y - 18, F.mono(20, 700), C.ink, t, t0 + 0.8, 40, 'center');
}
function dimension(g, x1, x2, y, label, t, t0) {
  ink(g, [[x1, y - 14], [x1, y + 14]], t, t0, 0.2, 2); ink(g, [[x2, y - 14], [x2, y + 14]], t, t0, 0.2, 2);
  ink(g, [[x1, y], [x2, y]], t, t0 + 0.1, 0.7, 2);
  if (t > t0 + 0.4) { g.save(); g.fillStyle = C.ink; for (const [x, d] of [[x1, 1], [x2, -1]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16 * d, y - 6); g.lineTo(x + 16 * d, y + 6); g.closePath(); g.fill(); } g.restore(); }
  const mid = (x1 + x2) / 2, w = textW(F.mono(22, 700), label) + 30, u = P(t, t0 + 0.5, 0.3);
  if (u > 0) { g.save(); g.fillStyle = C.paper; g.fillRect(mid - w / 2, y - 18, w, 36); g.restore(); lettering(g, label, mid, y + 8, F.mono(22, 700), C.ink, t, t0 + 0.5, 50, 'center'); }
}
function figTitle(g, x, y, n, s, t, t0) {
  lettering(g, `FIG. ${n}`, x, y, F.mono(26, 700), C.faint, t, t0, 30);
  lettering(g, s, x, y + 52, F.sans(48, 700), C.ink, t, t0 + 0.3, 36);
  ink(g, [[x, y + 74], [x + textW(F.sans(48, 700), s), y + 74]], t, t0 + 0.9, 0.8, 2);
}
function stamp(g, s, x, y, t, tI, color = C.violet, rot = -0.08, size = 44) {
  if (t < tI - 0.12) return; const u = P(t, tI - 0.12, 0.12), k = t < tI ? lerp(1.8, 1, E.inQuad(u)) : 1;
  const w = textW(F.mono(size, 700), s, 4) + 60, h = size * 2;
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(k, k); g.globalAlpha = 0.92 * Math.min(1, u * 1.5);
  g.strokeStyle = color; g.lineWidth = 6; rr(g, -w / 2, -h / 2, w, h, 10); g.stroke(); g.lineWidth = 2; rr(g, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 6); g.stroke();
  setText(g, F.mono(size, 700), { align: 'center', ls: 4, color }); g.fillText(s, 0, size * 0.36); g.restore();
}
function check(g, x, y, t, t0, color = C.ink) { const u = P(t, t0, 0.25); if (u <= 0) return; g.save(); g.strokeStyle = color; g.lineWidth = 4; g.lineCap = 'round'; strokeSpan(g, polyPath([[x - 10, y], [x - 3, y + 8], [x + 12, y - 10]]), 0, 40 * u); g.restore(); }
function cross(g, x, y, t, t0, color = C.red) { const u = P(t, t0, 0.3); if (u <= 0) return; g.save(); g.strokeStyle = color; g.lineWidth = 5; g.lineCap = 'round'; g.globalAlpha = u; g.beginPath(); g.moveTo(x - 14, y - 14); g.lineTo(x + 14, y + 14); g.moveTo(x + 14, y - 14); g.lineTo(x - 14, y + 14); g.stroke(); g.restore(); }

/* ---------------------------------------------------------------- the sheet */
function makePaper() {
  const c = cv(W, H), g = c.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 1300); gr.addColorStop(0, '#0e4585'); gr.addColorStop(1, '#082a52');
  g.fillStyle = gr; g.fillRect(0, 0, W, H); noiseFill(g, W, H, 14, 3);
  const r = rng(9); g.strokeStyle = 'rgba(255,255,255,0.025)';
  for (let i = 0; i < 900; i++) { g.lineWidth = 0.5 + r(); g.beginPath(); const x = r() * W, y = r() * H; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.stroke(); }
  return c;
}
function grid(g, cam) {
  const s = 50, x0 = Math.floor((cam.x - W / 2 / cam.z - 200) / s) * s, x1 = cam.x + W / 2 / cam.z + 200, y0 = Math.floor((cam.y - H / 2 / cam.z - 200) / s) * s, y1 = cam.y + H / 2 / cam.z + 200;
  g.save(); g.lineWidth = 1 / cam.z;
  for (let x = x0; x < x1; x += s) { g.strokeStyle = x % 250 === 0 ? 'rgba(200,225,255,0.13)' : 'rgba(200,225,255,0.05)'; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }
  for (let y = y0; y < y1; y += s) { g.strokeStyle = y % 250 === 0 ? 'rgba(200,225,255,0.13)' : 'rgba(200,225,255,0.05)'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  g.restore();
}

/* ---------------------------------------------------------------- figures */
function titleSheet(g, t) {
  const [ox, oy] = PANEL.title;
  ink(g, [[ox + 60, oy + 60], [ox + 1860, oy + 60], [ox + 1860, oy + 1020], [ox + 60, oy + 1020], [ox + 60, oy + 60]], t, 0.4, 1.6, 3);
  ink(g, [[ox + 80, oy + 80], [ox + 1840, oy + 80], [ox + 1840, oy + 1000], [ox + 80, oy + 1000], [ox + 80, oy + 80]], t, 0.6, 1.6, 1.5);
  const bx = ox + 1150, by = oy + 780;
  ink(g, [[bx, by], [ox + 1840, by], [ox + 1840, oy + 1000], [bx, oy + 1000], [bx, by]], t, 1.4, 0.8, 2.5);
  ink(g, [[bx, by + 70], [ox + 1840, by + 70]], t, 1.9, 0.4, 2); ink(g, [[bx, by + 145], [ox + 1840, by + 145]], t, 2.0, 0.4, 2); ink(g, [[bx + 380, by + 70], [bx + 380, oy + 1000]], t, 2.1, 0.4, 2);
  lettering(g, 'PROJECT  KANMANI', bx + 20, by + 46, F.mono(26, 700), C.ink, t, 2.3);
  lettering(g, 'SETTLEMENT & TRUST FOR AGENT WORK', bx + 20, by + 120, F.mono(19, 600), C.faint, t, 2.8, 60);
  lettering(g, 'MONAD MAINNET · 143', bx + 20, by + 194, F.mono(19, 600), C.faint, t, 3.3, 60);
  lettering(g, 'SHEET 01 / 01', bx + 400, by + 120, F.mono(19, 600), C.faint, t, 3.1, 60);
  lettering(g, 'REV 9/9 LIVE', bx + 400, by + 194, F.mono(19, 700), C.violet, t, 3.6, 60);
  const u = E.outCubic(P(t, 3.8, 1.0));
  if (u > 0) { g.save(); g.globalAlpha = u; setText(g, F.sans(150, 700), { align: 'center', ls: 26 + (1 - u) * 20, color: C.ink }); g.fillText('THE PLUMBING', ox + 960, oy + 470); g.restore(); }
  dimension(g, ox + 330, ox + 1590, oy + 320, '1:1  NOT TO BE TRUSTED, TO BE CHECKED', t, 4.4);
  hand(g, "it's a plumbing problem, not a lying problem.", ox + 960, oy + 600, 50, C.cyan, t, 5.6, 1.6, 'center');
  drawMark(g, ox + 170, oy + 170, 90 * P(t, 2.0, 0.6), C.ink, C.cyan);
}
function fig1(g, t) {
  const [ox, oy] = PANEL.fig1, T0 = 10.2;
  figTitle(g, ox + 110, oy + 110, 1, 'THE REGISTRY, AS BUILT', t, T0);
  const my = oy + 300;
  ink(g, [[ox + 140, my], [ox + 1780, my]], t, T0 + 0.8, 1.4, 9, C.ink);
  lettering(g, 'ERC-8004 IDENTITY REGISTRY · MONAD', ox + 150, my - 26, F.mono(21, 700), C.faint, t, T0 + 1.6);
  for (let i = 0; i < 12; i++) {
    const x = ox + 230 + i * 128, t1 = T0 + 1.6 + i * 0.08;
    ink(g, [[x, my], [x, my + 110]], t, t1, 0.4, 5);
    const bx = [[x - 30, my + 110], [x + 30, my + 110], [x + 30, my + 170], [x - 30, my + 170], [x - 30, my + 110]]; ink(g, bx, t, t1 + 0.2, 0.4, 2.5);
    const gy = my + 225; ink(g, sampleCurve((v) => [x + Math.cos(v * 6.28) * 24, gy + Math.sin(v * 6.28) * 24], 30), t, t1 + 0.4, 0.4, 2.5);
    check(g, x, gy, t, T0 + 4.2 + i * 0.12);
  }
  dimension(g, ox + 200, ox + 1680, my + 300, '10,262 AGENTS REGISTERED', t, T0 + 2.8);
  hand(g, 'every tool reads this gauge: do the bytes match the hash?  all pass.', ox + 150, my + 385, 38, C.ink, t, T0 + 5.6, 1.8);
  // the flow test
  const fy = oy + 900, sx = ox + 260;
  lettering(g, 'FLOW TEST · 85 PAYMENT CLAIMS', sx - 60, fy - 90, F.mono(24, 700), C.ink, t, T0 + 8.4);
  ink(g, [[sx, fy], [ox + 700, fy]], t, T0 + 8.8, 0.8, 7);
  flow(g, [[sx, fy], [ox + 700, fy]], t, T0 + 9.4, C.cyan, 5);
  ink(g, [[ox + 700, fy], [ox + 820, fy - 120], [ox + 1150, fy - 120]], t, T0 + 9.8, 0.7, 6);
  ink(g, [[ox + 700, fy], [ox + 820, fy + 110], [ox + 1150, fy + 110]], t, T0 + 9.8, 0.7, 6);
  flow(g, [[ox + 700, fy], [ox + 820, fy - 120], [ox + 1150, fy - 120]], t, T0 + 10.4, C.green, 5);
  flow(g, [[ox + 700, fy], [ox + 820, fy + 110], [ox + 1130, fy + 110]], t, T0 + 10.6, C.red, 5);
  lettering(g, '12  ON THE CHAIN IT NAMES', ox + 1175, fy - 112, F.mono(24, 700), C.green, t, T0 + 11.0);
  lettering(g, '73  NOT THERE', ox + 1175, fy + 118, F.mono(24, 700), C.red, t, T0 + 11.4);
  // the 73 go two ways: 64 misrouted to a real transaction on another chain, 9 dead-end
  ink(g, [[ox + 1150, fy + 110], [ox + 1150, fy + 190], [ox + 1420, fy + 190]], t, T0 + 12.8, 0.6, 5);
  ink(g, [[ox + 1150, fy + 190], [ox + 1150, fy + 250], [ox + 1320, fy + 250]], t, T0 + 13.2, 0.5, 5);
  flow(g, [[ox + 1150, fy + 190], [ox + 1420, fy + 190]], t, T0 + 13.5, C.cyan, 4);
  ink(g, [[ox + 1320, fy + 232], [ox + 1320, fy + 268]], t, T0 + 13.6, 0.3, 8, C.red);
  lettering(g, '64  REAL TX · ANOTHER CHAIN', ox + 1440, fy + 198, F.mono(22, 700), C.cyan, t, T0 + 13.8);
  lettering(g, ' 9  NO CHAIN AT ALL', ox + 1440, fy + 258, F.mono(22, 700), C.red, t, T0 + 14.4);
  hand(g, 'the leak is one field: which chain.', ox + 1440, fy + 310, 32, C.cyan, t, T0 + 15.2, 1.2);
  stamp(g, 'HASH INTEGRITY ≠ CLAIM TRUTH', ox + 520, oy + 1150, t, T0 + 16.6, C.ink, -0.04, 34);
}
function fig2(g, t) {
  const [ox, oy] = PANEL.fig2, T0 = 30.2;
  figTitle(g, ox + 110, oy + 110, 2, 'ONE DEAD DOCUMENT', t, T0);
  tank(g, ox + 180, oy + 330, 300, 460, t, T0 + 0.8, 0, C.cyan, 'TK-001 REGISTRATION DOCUMENT');
  hand(g, 'an expired preview deployment', ox + 180, oy + 850, 34, C.faint, t, T0 + 2.0, 1.2);
  ink(g, [[ox + 480, oy + 560], [ox + 660, oy + 560]], t, T0 + 1.4, 0.4, 6);
  valve(g, ox + 570, oy + 560, t, T0 + 1.6, false, 1 - P(t, T0 + 5.0, 0.6));
  const r = rng(8093);
  for (let i = 0; i < 70; i++) {
    const y1 = oy + 250 + i * 10.5, x1 = ox + 1060 + r() * 110, t1 = T0 + 2.2 + i * 0.03;
    ink(g, [[ox + 660, oy + 560], [ox + 840, lerp(oy + 560, y1, 0.4)], [x1, y1]], t, t1, 0.5, 1.2, C.faint);
  }
  const dry = P(t, T0 + 5.4, 1.2);
  if (dry > 0) { g.save(); g.globalAlpha = dry; setText(g, F.mono(40, 700), { align: 'center', color: C.slate }); g.fillText('NO ANSWER', ox + 330, oy + 575); g.restore(); }
  lettering(g, '8,093 AGENTS', ox + 1260, oy + 420, F.sans(72, 700), C.ink, t, T0 + 3.4, 30);
  lettering(g, '7,962 WALLETS', ox + 1260, oy + 500, F.mono(36, 700), C.faint, t, T0 + 4.0, 30);
  lettering(g, 'ONE DOCUMENT BETWEEN THEM', ox + 1260, oy + 560, F.mono(26, 700), C.faint, t, T0 + 4.6, 40);
  hand(g, "nobody's misconduct. the registry shows no difference", ox + 180, oy + 1010, 36, C.ink, t, T0 + 6.6, 1.6);
  hand(g, 'between these and the live ones.', ox + 180, oy + 1060, 36, C.ink, t, T0 + 7.6, 1.2);
  stamp(g, 'UNKNOWN · NOT FALSE', ox + 1560, oy + 740, t, T0 + 9.0, C.slate, 0.05, 38);
}
function fig3(g, t) {
  const [ox, oy] = PANEL.fig3, T0 = 42.2, cy = oy + 540;
  figTitle(g, ox + 110, oy + 110, 3, 'KANMANI, RE-PLUMBED', t, T0);
  // 1. buyer inlet through the passkey valve
  ink(g, [[ox + 90, cy], [ox + 420, cy]], t, T0 + 1.0, 0.8, 8);
  lettering(g, 'BUYER', ox + 90, cy - 36, F.mono(22, 700), C.ink, t, T0 + 1.2);
  valve(g, ox + 300, cy, t, T0 + 1.6);
  bubble(g, ox + 300, cy + 110, ['IR', '402'], t, T0 + 2.2);
  hand(g, 'IRIS · x402: one passkey.', ox + 170, cy + 190, 34, C.ink, t, T0 + 2.8, 1.0);
  hand(g, 'no MON, no key we could lose.', ox + 170, cy + 232, 34, C.faint, t, T0 + 3.6, 1.0);
  flow(g, [[ox + 90, cy], [ox + 418, cy]], t, T0 + 4.0, C.cyan, 5);
  // 2. escrow tank
  const fill = E.inOutCubic(P(t, T0 + 6.6, 3.0)) * 0.72;
  tank(g, ox + 440, cy - 240, 240, 400, t, T0 + 4.8, fill, C.cyan, 'TK-101 AQUEOUS · ESCROW');
  if (fill > 0) lettering(g, (1.4 * fill / 0.72).toFixed(2) + ' USDC', ox + 560, cy + 20, F.mono(30, 700), C.ink, t, T0 + 6.6, 999, 'center');
  hand(g, 'AQUEOUS: locked before work starts.', ox + 170, cy + 296, 32, C.ink, t, T0 + 8.0, 1.2);
  hand(g, 'job id derived, never supplied.', ox + 170, cy + 336, 32, C.faint, t, T0 + 8.8, 1.0);
  // 3. meter
  ink(g, [[ox + 680, cy + 60], [ox + 900, cy + 60]], t, T0 + 10.0, 0.6, 8);
  const mx = ox + 800; ink(g, sampleCurve((v) => [mx + Math.cos(v * 6.28) * 52, cy - 70 + Math.sin(v * 6.28) * 52], 50), t, T0 + 10.3, 0.7, 3); ink(g, [[mx, cy + 60], [mx, cy - 18]], t, T0 + 10.3, 0.4, 3);
  const calls = Math.min(30, Math.floor(Math.max(0, t - (T0 + 11.2)) * 12));
  if (t > T0 + 11) { lettering(g, `${String(calls).padStart(2, '0')}/70`, mx, cy - 60, F.mono(26, 700), C.ink, t, T0 + 11, 999, 'center'); lettering(g, 'CALLS', mx, cy - 32, F.mono(15, 700), C.faint, t, T0 + 11, 999, 'center'); }
  lettering(g, 'FQ-201 METER · 0.02 / CALL', mx + 20, cy - 150, F.mono(17, 700), C.ink, t, T0 + 11.4, 50, 'center');
  flow(g, [[ox + 680, cy + 60], [ox + 900, cy + 60]], t, T0 + 11.2, C.cyan, 4);
  // 4. settle tee: one transaction, three outcomes
  const sx = ox + 1000;
  ink(g, [[ox + 900, cy + 60], [sx, cy + 60]], t, T0 + 14.0, 0.4, 8);
  ink(g, [[sx, cy + 60], [sx, cy - 150], [sx + 330, cy - 150]], t, T0 + 14.4, 0.8, 7);
  ink(g, [[sx, cy + 60], [sx, cy + 400], [ox + 120, cy + 400], [ox + 120, cy + 40]], t, T0 + 14.8, 1.2, 5);
  bubble(g, sx, cy + 60, ['ST', '1TX'], t, T0 + 14.2);
  flow(g, [[sx, cy + 60], [sx, cy - 150], [sx + 330, cy - 150]], t, T0 + 16.0, C.cyan, 5);
  flow(g, [[sx, cy + 60], [sx, cy + 400], [ox + 120, cy + 400], [ox + 120, cy + 70]], t, T0 + 16.4, C.cyan, 4);
  lettering(g, '0.60 → AGENT', sx + 40, cy - 176, F.mono(26, 700), C.ink, t, T0 + 16.2);
  lettering(g, '0.80 → BACK TO THE BUYER, SAME TX', ox + 300, cy + 444, F.mono(24, 700), C.ink, t, T0 + 16.8);
  lettering(g, '0.00 RETAINED', sx + 40, cy + 40, F.mono(24, 700), C.faint, t, T0 + 17.6);
  // 5. the receipt comes out of the settlement itself
  const px = sx + 270, py = cy - 30;
  ink(g, [[px, py], [px + 170, py], [px + 170, py + 90], [px, py + 90], [px, py]], t, T0 + 19.0, 0.6, 3);
  lettering(g, 'PR-301', px + 85, py + 55, F.mono(20, 700), C.ink, t, T0 + 19.4, 40, 'center');
  const strip = E.outCubic(P(t, T0 + 20.2, 2.0)) * 190;
  if (strip > 0) { g.save(); g.fillStyle = 'rgba(232,241,255,0.92)'; g.fillRect(px + 30, py + 90, 110, strip); g.fillStyle = C.paper; setText(g, F.mono(13, 700), { color: '#0b3a6e' }); ['RECEIPT', 'settle tx', '0x10d03f31', '0.60 / 0.80 / 0', 'chain 143'].forEach((l, i) => { if (22 + i * 30 < strip) g.fillText(l, px + 38, py + 112 + i * 30); }); g.restore(); }
  hand(g, 'the receipt IS the settlement.', px + 200, py + 180, 34, C.cyan, t, T0 + 21.4, 1.0);
  hand(g, 'it cannot disagree with the payment.', px + 200, py + 225, 34, C.cyan, t, T0 + 22.2, 1.2);
  // 6. the record prices the bond
  const bx = ox + 1500, by = cy - 330;
  ink(g, [[sx + 330, cy - 150], [bx + 30, cy - 150], [bx + 30, by + 290]], t, T0 + 24.0, 0.8, 5);
  const gx = bx + 30, gy = cy - 60; ink(g, sampleCurve((v) => [gx + Math.cos(v * 6.28) * 40, gy + Math.sin(v * 6.28) * 40], 40), t, T0 + 24.4, 0.5, 3);
  if (t > T0 + 25) { const a = lerp(-2.4, -0.7, E.outCubic(P(t, T0 + 25, 1.2))) + 0.03 * Math.sin(t * 6); g.save(); g.strokeStyle = C.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + Math.cos(a) * 32, gy + Math.sin(a) * 32); g.stroke(); g.restore(); }
  lettering(g, 'PI-401 CLAIM-TRUTH RATE', gx + 56, gy + 8, F.mono(19, 700), C.ink, t, T0 + 25.0);
  tank(g, bx - 60, by - 60, 260, 250, t, T0 + 25.6, 0.55 * P(t, T0 + 26.6, 1.5), C.violet, 'TK-501 SCLERA · BOND');
  valve(g, bx + 225, by + 20, t, T0 + 27.4, true);
  lettering(g, 'PSV · SIGNED VERDICT SLASHES', bx + 262, by + 30, F.mono(18, 700), C.ink, t, T0 + 28.0);
  lettering(g, 'NO ADMIN OVERRIDE', bx + 262, by + 58, F.mono(18, 700), C.faint, t, T0 + 28.6);
  hand(g, 'an agent stakes USDC on a floor', ox + 1600, cy + 10, 30, C.faint, t, T0 + 29.2, 1.0);
  hand(g, 'under its own claim-truth rate.', ox + 1600, cy + 50, 30, C.faint, t, T0 + 30.0, 1.0);
  // 7. the instrument rack: nine layers, all live
  const rx = ox + 110, ry = oy + 1040, names = ['RETINA', 'FOVEA', 'AQUEOUS', 'IRIS', 'OPTIC', 'SCLERA', 'CHIASM', 'INTENTS', 'SELF-HEAL'];
  names.forEach((n, i) => {
    const x = rx + i * 190, t1 = T0 + 31.0 + i * 0.45;
    ink(g, [[x, ry], [x + 170, ry], [x + 170, ry + 90], [x, ry + 90], [x, ry]], t, t1, 0.4, 2.5);
    lettering(g, n, x + 85, ry + 40, F.mono(18, 700), C.ink, t, t1 + 0.2, 60, 'center');
    if (t > t1 + 0.5) { const on = P(t, t1 + 0.5, 0.2); g.save(); g.globalAlpha = on; g.fillStyle = C.violet; g.beginPath(); g.arc(x + 58, ry + 68, 7, 0, 7); g.fill(); setText(g, F.mono(15, 700), { color: C.violet }); g.fillText('LIVE', x + 72, ry + 74); g.restore(); }
  });
  // Intents: a second inlet, from money held on BSC, straight into the escrow
  ink(g, [[ox + 560, oy + 205], [ox + 560, cy - 240]], t, T0 + 34.8, 0.8, 5);
  flow(g, [[ox + 560, oy + 205], [ox + 560, cy - 246]], t, T0 + 35.6, C.cyan, 4);
  lettering(g, 'INTENTS · 0.12 USDT FROM BSC', ox + 530, oy + 240, F.mono(20, 700), C.cyan, t, T0 + 35.2, 40, 'right');
  stamp(g, '9 OF 9 LIVE', ox + 1640, oy + 1215, t, T0 + 39.4, C.violet, -0.06, 44);
}
function fig4(g, t) {
  const [ox, oy] = PANEL.fig4, T0 = 85.2;
  figTitle(g, ox + 110, oy + 110, 4, 'PRESSURE TEST · MONAD MAINNET', t, T0);
  const rows = [
    ['ESCROW', '0x2b879b52…17b57e', '1.40 USDC locked'],
    ['DELIVER', '0xc259c7a6…82a6724', '30 of 70 calls used'],
    ['SETTLE', '0x10d03f31…9fce6c5', '0.60 agent · 0.80 back · 0 kept'],
    ['X402', '0xf044c754…ee526d8a', 'buyer held 0 MON throughout'],
    ['INTENTS', '0x738af85c…a440b558', '0.12 USDT on BSC → escrow on Monad'],
    ['BOND', 'Sclera · one bond', 'posted · held · matured · returned'],
  ];
  const tx = ox + 110, ty = oy + 260;
  ink(g, [[tx, ty], [tx + 1700, ty]], t, T0 + 0.8, 0.8, 2.5);
  ['RUN', 'TRANSACTION', 'RESULT', ''].forEach((h, i) => lettering(g, h, tx + [10, 260, 760, 1600][i], ty - 16, F.mono(20, 700), C.faint, t, T0 + 1.0));
  rows.forEach(([a, b, c], i) => {
    const y = ty + 70 + i * 72, t1 = T0 + 1.6 + i * 1.3;
    lettering(g, a, tx + 10, y, F.mono(28, 700), C.ink, t, t1); lettering(g, b, tx + 260, y, F.mono(26, 600), C.cyan, t, t1 + 0.2, 60); lettering(g, c, tx + 760, y, F.mono(26, 600), C.ink, t, t1 + 0.5, 60);
    check(g, tx + 1620, y - 8, t, t1 + 1.0);
    ink(g, [[tx, y + 22], [tx + 1700, y + 22]], t, t1 + 0.1, 0.5, 1, C.faint);
  });
  const my = oy + 820;
  lettering(g, 'BLOCK TIME', tx + 10, my, F.mono(24, 700), C.faint, t, T0 + 10.4);
  for (let k = 0; k < 18; k++) { const on = t > T0 + 10.8 && ((t - (T0 + 10.8)) / 0.266) % 18 >= k; g.save(); g.strokeStyle = C.ink; g.lineWidth = 2; g.strokeRect(tx + 200 + k * 44, my - 26, 34, 34); if (on) { g.fillStyle = rgba(C.cyan, 0.8); g.fillRect(tx + 204 + k * 44, my - 22, 26, 26); } g.restore(); }
  lettering(g, '266 ms', tx + 1010, my, F.mono(28, 700), C.cyan, t, T0 + 11.0);
  hand(g, '12 s finality would pay a false claim before the verdict lands.', tx + 10, my + 62, 32, C.faint, t, T0 + 11.8, 1.8);
  hand(g, 'our own agents on both ends: it proves the pipes, not demand.', tx + 10, my + 124, 34, C.amber, t, T0 + 14.2, 1.8);
  lettering(g, 'prove.sh  PASS 12  FAIL 0  ·  537 TESTS', tx + 10, my + 196, F.mono(26, 700), C.ink, t, T0 + 16.4, 50);
}
function closing(g, t) {
  const a = P(t, 108.2, 1.0); if (a <= 0) return;
  g.save(); g.globalAlpha = a; g.fillStyle = 'rgba(8,42,82,0.82)'; g.fillRect(0, 300, W, 470); g.restore();
  const u = E.outCubic(P(t, 108.4, 1.0));
  g.save(); g.globalAlpha = u; setText(g, F.sans(62, 700), { align: 'center', color: C.ink, ls: 2 }); g.fillText('The receipt cannot disagree with the payment.', 960, 420); g.restore();
  hand(g, 'Trust stops being a badge.', 960, 540, 64, C.ink, t, 110.4, 1.2, 'center', 0);
  const v = E.outCubic(P(t, 112.2, 1.0));
  if (v > 0) { g.save(); g.globalAlpha = v; setText(g, F.sans(96, 700), { align: 'center', color: C.cyan, ls: 1 }); g.fillText('It becomes a price.', 960, 680); g.restore(); }
  const m = P(t, 114.4, 0.8); if (m > 0) { g.save(); g.globalAlpha = m; drawMark(g, 820, 860, 90, C.ink, C.cyan); setText(g, F.mono(44, 700), { color: C.ink }); g.fillText('kanmani.xyz', 880, 876); g.restore(); }
}

/* ---------------------------------------------------------------- the frame */
function render(g, t, main) {
  g.drawImage(PAPER, 0, 0);
  const unroll = E.inOutCubic(P(t, 0, 1.2));
  const cam = CAM(t);
  g.save(); g.translate(W / 2, H / 2); g.scale(cam.z, cam.z); g.translate(-cam.x, -cam.y);
  grid(g, cam);
  titleSheet(g, t); if (t > 9.5) fig1(g, t); if (t > 29.5) fig2(g, t); if (t > 41.5) fig3(g, t); if (t > 84.5) fig4(g, t);
  if (t > 104) stamp(g, 'APPROVED · MONAD MAINNET', PANEL.title[0] + 1500, PANEL.title[1] + 700, t, 106.2, C.violet, -0.07, 40);
  g.restore();
  closing(g, t);
  if (unroll < 1) { g.fillStyle = '#05080f'; g.fillRect(0, H * unroll, W, H); const gr = g.createLinearGradient(0, H * unroll - 60, 0, H * unroll); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = gr; g.fillRect(0, H * unroll - 60, W, 60); }
  bloom(g, main, 0.22, 4);
  g.drawImage(VIG, 0, 0);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.12; g.drawImage(GRAIN[Math.floor((t * FPS) / 2) % GRAIN.length], 0, 0, W, H);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const black = P(t, DUR - 0.6, 0.6); if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, W, H); }
}
async function init() {
  await fontsReady([F.hand(40), F.mono(40, 700), F.mono(40, 600), F.sans(40, 700)]);
  PAPER = makePaper(); GRAIN = makeGrain(4, 960, 540, 70); VIG = makeVignette(500, 1300, 0.55);
  const at = (p, dx = 960, dy = 540) => [PANEL[p][0] + dx, PANEL[p][1] + dy];
  const K = (t, p, dx, dy, z, ease) => ({ t, x: at(p, dx, dy)[0], y: at(p, dx, dy)[1], z, ease });
  CAM = track([
    K(0, 'title', 960, 560, 1.12), K(9.0, 'title', 960, 540, 1.0),
    K(10.4, 'fig1', 960, 520, 1.0), K(17.5, 'fig1', 900, 420, 1.12), K(19.0, 'fig1', 1000, 900, 1.0), K(28.6, 'fig1', 1040, 920, 1.04),
    K(30.4, 'fig2', 960, 600, 1.0), K(41.0, 'fig2', 960, 610, 1.03),
    K(42.6, 'fig3', 620, 520, 1.2), K(50.0, 'fig3', 560, 640, 1.2), K(55.6, 'fig3', 820, 480, 1.25), K(60.0, 'fig3', 1000, 480, 1.2),
    K(66.4, 'fig3', 1260, 520, 1.12), K(72.0, 'fig3', 1500, 380, 1.14), K(73.2, 'fig3', 960, 1000, 1.05), K(78.4, 'fig3', 940, 640, 0.82), K(83.6, 'fig3', 960, 640, 0.82),
    K(85.6, 'fig4', 960, 540, 1.0), K(95.0, 'fig4', 960, 580, 1.0), K(104.0, 'fig4', 960, 600, 0.98),
    { t: 106.0, x: 3300, y: 1180, z: 0.36 }, { t: 120, x: 3300, y: 1180, z: 0.34 },
  ]);
  // sound cues: pen strokes, lettering, valves, flows, meter, printer, stamps
  cue('unroll', 0.1); cue('pen', 0.4, { dur: 3.2 }); cue('type', 2.3, { dur: 2.0 }); cue('title', 3.8);
  for (const [t0, d] of [[10.2, 2.0], [11.8, 2.4], [18.6, 1.2], [19.8, 1.4], [23.0, 1.6], [30.2, 1.8], [32.4, 2.4], [43.2, 1.6], [47.0, 1.4], [52.2, 1.0], [56.2, 1.6], [61.2, 1.0], [66.2, 1.4], [68.2, 1.6], [73.2, 4.4], [77.0, 1.0]]) cue('pen', t0, { dur: d });
  for (const t0 of [14.4, 15.4, 16.6, 17.8]) cue('tick', t0);
  for (const t0 of [43.8, 55.8, 61.2, 69.6]) cue('valve', t0);
  for (const [t0, d] of [[19.6, 3.0], [46.2, 2.2], [48.8, 3.4], [53.4, 3.0], [58.2, 4.0], [77.8, 3.0]]) cue('fluid', t0, { dur: d });
  for (let k = 0; k < 30; k++) cue('meter', 53.4 + k / 12);
  cue('print', 62.4, { dur: 2.0 }); cue('hiss', 69.6, { dur: 1.2 });
  for (let i = 0; i < 9; i++) cue('lamp', 73.7 + i * 0.45);
  cue('stamp', 26.8); cue('stamp', 39.2); cue('stamp', 81.6); cue('stamp', 106.2); cue('shut', 35.2);
  for (let i = 0; i < 6; i++) cue('type', 86.8 + i * 1.3, { dur: 0.9 });
  for (let t0 = 96.0; t0 < 104; t0 += 0.266) cue('tick', t0, { soft: 1 });
  cue('swell', 107.0); cue('resolve', 112.2);
}
registerFilm({ duration: DUR, arrangement: { bpm: BPM, bars: 48, film: 'plumbing' }, init, render });
