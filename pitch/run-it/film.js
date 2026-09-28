'use strict';
/*
 * KANMANI · RUN IT
 *
 * "Don't trust us. Run it." A CRT terminal session. Every command is one you can run, and every
 * output line is what the live site, the chain or the repository actually returned (checked
 * 2026-09-28; the prove.sh run is the one recorded in docs/25-PROOF.md). Lines starting with #
 * are annotations, typed like a person narrating at a prompt.
 *
 * The phosphor is a cool white, not green and not amber: on this project green means `true` and
 * amber reads as a warning, so neither may be used as decoration. Verdict colours appear only on
 * verdict values, and PASS takes the brand violet because it is a statement about our build.
 *
 * 120 BPM, 60 bars of 2 s.
 */
const DUR = 120, BPM = 120;
const C = { bg: '#06080e', text: '#d9e0f2', dim: '#6f7d99', faint: '#46526a', violet: '#8b76ff', cyan: '#22d3ee', white: '#ffffff', green: '#34d399', red: '#f87171', slate: '#94a3b8', key: '#aab6d6' };
const FS = 26, LH = 37, X0 = 132, Y0 = 128, ROWS = 23;
const MONO = (w = 500) => font(FS, 'JetBrains Mono', w);
let CW, COLS, SCAN, BEZEL, GRAIN, VIG, SCR, SCRG;
const LINES = [], CLEARS = [0];
let SCREEN = 0;

/* ---------------------------------------------------------------- authoring */
const PROMPT = [['kanmani', C.violet], [' ~ ', C.dim], ['$ ', C.text]];
function cmd(text, t0, cps = 26) {
  const times = typeTimes(text, t0 + 0.35, cps, strSeed(text));
  const enter = times.end + 0.18;
  LINES.push({ type: 'cmd', t: t0, text, times, enter, screen: SCREEN });
  times.forEach((tc) => cue('key', tc)); cue('enter', enter);
  return enter;
}
function note(text, t0, cps = 44) { return cmd('# ' + text, t0, cps); }
function out(spans, t, extra = {}) { LINES.push({ type: 'out', t, spans: typeof spans === 'string' ? [[spans, C.text]] : spans, screen: SCREEN, ...extra }); }
function big(text, t, color, cell = 14, rows = 12, color2) { LINES.push({ type: 'big', t, text, color, color2, cell, rows, screen: SCREEN, m: null }); cue('big', t); }
function clear(t) { CLEARS.push(t); SCREEN++; cue('glitch', t); }

function blockMatrix(text, rows) {
  const f = font(Math.round(rows * 1.2), 'JetBrains Mono', 800), w = Math.ceil(textW(f, text)) + 4, h = Math.ceil(rows * 1.5);
  const c = cv(w, h), g = c.getContext('2d'); setText(g, f, { color: '#fff', base: 'alphabetic' }); g.fillText(text, 2, Math.round(rows * 1.15));
  const d = g.getImageData(0, 0, w, h).data, on = new Uint8Array(w * h);
  let top = h, bot = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 110) { on[y * w + x] = 1; top = Math.min(top, y); bot = Math.max(bot, y); }
  return { w, h, on, top, bot };
}

/* ---------------------------------------------------------------- the session */
function script() {
  // A. boot
  out([['KANMANI', C.white], ['  settlement and trust for agent work on Monad', C.dim]], 1.25);
  out([['rpc   ', C.dim], ['https://rpc.monad.xyz', C.cyan], ['   chain 143', C.dim]], 1.45);
  out([['site  ', C.dim], ['https://kanmani.xyz', C.cyan]], 1.6);
  out([['stack ', C.dim], ['9 of 9 layers live', C.violet]], 1.75);
  out('', 1.8);
  big("DON'T TRUST US.", 2.4, C.white, 12, 12);
  big('RUN IT.', 4.3, C.violet, 20, 12);
  note('every claim in this film is a command. run it yourself.', 6.0, 46);
  clear(8.0);
  // B. the registry
  let e = cmd('curl -sL kanmani.xyz/llms.txt | grep "agents indexed"', 8.2, 30);
  out([['- ', C.dim], ['10,262', C.white], [" agents indexed. The registry's own counter slot says ", C.text], ['10,262', C.white], ['.', C.text]], e + 0.5);
  e = note('every integrity tool asks one question: do the bytes match the hash?', e + 1.2);
  for (let r = 0; r < 3; r++) out([['  ' + Array(6).fill('✓ hash matches').join('  '), C.dim]], e + 0.35 + r * 0.45, { fill: 0.45 });
  e = note('all of them pass. none of them look at the payment.', e + 1.9);
  big('HASH != TRUTH', e + 0.35, C.white, 14, 12);
  clear(21.5);
  // C. the verdicts
  e = cmd('curl -sL kanmani.xyz/feed.json | jq .data.summary', 21.7, 30);
  const J = [
    [['{', C.dim]], [['  "paymentClaims": ', C.key], ['85', C.white], [',', C.dim]], [['  "resolve": ', C.key], ['12', C.green], [',', C.dim]],
    [['  "doNotResolve": ', C.key], ['73', C.red], [',', C.dim]], [['  "assertNoPayment": ', C.key], ['1095', C.white], [',', C.dim]],
    [['  "couldNotCheck": {', C.key]], [['    "total": ', C.key], ['12', C.slate], [',', C.dim]], [['    "documentWouldNotAnswer": ', C.key], ['2', C.slate], [',', C.dim]],
    [['    "bytesNoLongerMatchTheirCommitment": ', C.key], ['10', C.slate], [',', C.dim]], [['    "noMappingReadTheShape": ', C.key], ['0', C.slate]], [['  },', C.key]],
    [['  "claimsWithAUriAndNoVerdict": ', C.key], ['95', C.white]], [['}', C.dim]],
  ];
  J.forEach((s, i) => out(s, e + 0.45 + i * 0.05));
  const b0 = e + 1.6;
  out([['  true     ', C.green], ['BAR:12:' + C.green, ''], ['  12 on the chain they name', C.dim]], b0);
  out([['  false    ', C.red], ['BAR:73:' + C.red, ''], ['  73 not on the chain they name', C.dim]], b0 + 0.3);
  out([['  unknown  ', C.slate], ['BAR:12:' + C.slate, ''], ['  12 could not check. never false.', C.dim]], b0 + 0.6);
  e = cmd('grep "of those 73" README.md', b0 + 2.4, 28);
  out([['| **of those 73, real transactions on a different chain** | **', C.text], ['64', C.cyan], ['** |', C.text]], e + 0.35);
  out([['| **of those 73, found on no chain at all** | **', C.text], ['9', C.red], ['** |', C.text]], e + 0.45);
  e = note('64 real payments, filed under the wrong chain. one wrong field, fixable in one edit.', e + 1.3);
  clear(38.0);
  // D. the dead document, and the rule
  e = cmd('curl -sL kanmani.xyz/llms.txt | grep "ONE document"', 38.2, 30);
  out([['- 8,640 agents point at a document that returns a deletion. ', C.text], ['8,093', C.white], [' of them share ONE document, registered by ', C.text], ['7,962', C.white], [' distinct wallets.', C.text]], e + 0.4);
  e = note("an expired preview deployment. nobody's misconduct. we could not look, so:", e + 1.2);
  e = cmd('sed -n 31,37p components/ui.tsx', e + 0.5, 30);
  const CODE = [
    [['  if ', C.violet], ['(value === ', C.text], ['null', C.cyan], [' || value === ', C.text], ['undefined', C.cyan], [') {', C.text]],
    [['    return ', C.violet], ['(', C.text]],
    [['      <span ', C.text], ['className', C.key], ['=', C.text], ['"unknown-value"', C.cyan], [' title', C.key], ['={title ?? ', C.text], ['"This value could not be read. It is not zero."', C.cyan], ['}>', C.text]],
    [['        unknown', C.slate]], [['      </span>', C.text]], [['    );', C.text]], [['  }', C.text]],
  ];
  CODE.forEach((s, i) => out([[String(31 + i).padStart(2) + '  ', C.faint], ...s], e + 0.35 + i * 0.06));
  note('unknown is never false. a null is never 0. in the types, the contract, the SQL and the UI.', e + 1.3, 50);
  clear(50.0);
  // E. the fix
  big('THE PAYMENT', 50.3, C.white, 12, 12);
  big('WRITES THE RECEIPT.', 51.4, C.violet, 10, 12, C.cyan);
  e = note('priced endpoints answer 402 with an x402 challenge before they do any work:', 53.2);
  e = cmd('curl -sL -o /dev/null -w "%{http_code}\\n" kanmani.xyz/api/service/sentinel', e + 0.3, 34);
  out([['402', C.white]], e + 0.5); cue('beep', e + 0.5);
  e = note('the thing that audits payments is paid for over the rail it audits.', e + 1.0, 50);
  e = cmd('cast balance 0x27a8ae37f59BDcd147b09dDc1F35Ac64697c1F92 --rpc-url https://rpc.monad.xyz', e + 0.4, 38);
  out([['0', C.white]], e + 0.6);
  note("the buyer's MON balance, start to finish.", e + 0.9, 50);
  clear(66.0);
  // F. one complete job
  e = note('one job, settled on mainnet in real USDC. our own agent: it proves the rail, not demand.', 66.2, 52);
  const T = [['escrow ', '0x2b879b52…17b57e ', '1.40 USDC locked, two cents a call'], ['deliver', '0xc259c7a6…82a6724', '30 of 70 calls used'], ['settle ', '0x10d03f31…9fce6c5', '0.60 to the agent · 0.80 back · 0 kept'], ['x402   ', '0xf044c754…ee526d8a', 'paid without a wallet']];
  T.forEach(([a, b, c], i) => { out([['  ' + a + '  ', C.white], [b + '  ', C.cyan], [c, C.text]], e + 0.4 + i * 0.5); cue('blip', e + 0.4 + i * 0.5); });
  big('ONE TX.', e + 2.7, C.cyan, 18, 12);
  note('the receipt is emitted by the settlement itself. it cannot disagree with the payment.', e + 4.6, 50);
  clear(78.0);
  // G. prove.sh, the recorded run
  e = cmd('./scripts/prove.sh', 78.2, 24);
  let t = e + 0.4;
  const hdr = [[['Kanmani proof run', C.white]], [['  at   2026-09-28T07:39:12Z', C.dim]], [['  site https://kanmani.xyz', C.dim]], [['  rpc  https://rpc.monad.xyz', C.dim]], [['  head 108693752', C.dim]], [['', C.dim]]];
  hdr.forEach((s, i) => out(s, t + i * 0.06)); t += 0.6;
  const RUN = [
    ['1. Retina  ·  index the evidence  ·  expected LIVE', ['the index answers and holds 1287 checkable claims']],
    ['2. Fovea  ·  verify the claim  ·  expected LIVE', ['verdicts exist: 85 payment claims, 12 resolve, 73 do not']],
    ['3. Aqueous  ·  escrow the job  ·  expected LIVE', ['escrow deployed, 10901 bytes at 0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32']],
    ['4. Iris · x402  ·  pay without a wallet  ·  expected LIVE', ['the priced endpoint answers 402 with an x402 challenge']],
    ['5. Optic  ·  answer on chain  ·  expected LIVE', ['validation registry live at 0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58, 130 bytes (minimal proxy)']],
    ['6. Sclera  ·  bond the promise  ·  expected LIVE', ['agent 10256 carries a bond: active 10000 floor 8000bps', 'the contract agrees: state 1 Active', 'the ownership guard holds: postBond reverts NotAgentOwner() for an agent we do not own']],
    ['7. Chiasm  ·  read every chain at once  ·  expected LIVE', ['BSC indexed beside Monad: 359,571 agents on chain 56']],
    ['8. Intents  ·  fund from any chain  ·  expected LIVE', ['a cross-chain fund landed in the escrow: 115558 USDC units from the intermediary into Aqueous'], true],
    ['9. Self-heal  ·  heal a fixed record  ·  expected LIVE', ['a repaired document is reflected in the index, so URIUpdated is being captured', 'the optional Alchemy delivery path is deployed and answering (200)']],
  ];
  RUN.forEach(([head, passes, hot]) => {
    out([[head, C.white]], t); t += 0.9 + (strSeed(head) % 7) * 0.08;
    passes.forEach((p) => { out([['  PASS  ', C.violet], [p, C.text]], t, hot ? { hot: 1 } : {}); cue('pass', t); t += 0.28; });
    if (hot) { out([['        source 0.12 USDT on BSC, destination tx 0x738af85c…a440b558', C.cyan]], t, { hot: 1 }); t += 0.3; }
    t += 0.35;
  });
  out([['-------------------------------------------------------------', C.faint]], t);
  out([['PASS 12   FAIL 0   SKIP 0', C.violet]], t + 0.3); cue('pass', t + 0.3);
  out([['All nine layers live. If a FAIL appears above, the claim on the site is wrong.', C.text]], t + 0.45);
  big('9/9 LIVE', t + 1.2, C.violet, 22, 12);
  clear(104.0);
  // H. the close
  e = note('a block every 266 ms: the verdict lands while there is still something to lose.', 104.2, 52);
  e = note('so an agent can stake USDC on its own record, and a signed verdict can slash it.', e + 0.3, 52);
  e = note('trust stops being a badge.', e + 0.4, 36);
  big('IT BECOMES', e + 0.4, C.white, 18, 12);
  big('A PRICE.', e + 1.3, C.violet, 18, 12, C.cyan);
  cmd('open https://kanmani.xyz', e + 3.0, 16);
}

/* ---------------------------------------------------------------- layout and drawing */
function rowsAt(t) {
  let sc = 0; while (sc + 1 < CLEARS.length && CLEARS[sc + 1] <= t) sc++;
  const lines = LINES.filter((l) => l.screen === sc && l.t <= t), rows = [];
  const push = (spans, extra = {}) => rows.push({ spans, ...extra });
  const wrapSpans = (spans) => {
    const out = [[]]; let n = 0;
    for (const [s, c] of spans) { let rest = s; while (rest.length) { const room = COLS - n; if (room <= 0) { out.push([]); n = 0; continue; } const part = rest.slice(0, room); out[out.length - 1].push([part, c]); n += part.length; rest = rest.slice(room); } }
    return out;
  };
  let cursor = null;
  lines.forEach((l, i) => {
    if (l.type === 'cmd') {
      const n = typedCount(l.times, t), typed = l.text.slice(0, n), isNote = l.text.startsWith('#');
      const spans = [...PROMPT, [typed, isNote ? C.dim : C.text]];
      const wr = wrapSpans(spans); wr.forEach((s) => push(s));
      if (t < l.enter) { const len = wr[wr.length - 1].reduce((a, [s]) => a + s.length, 0); cursor = { row: rows.length - 1, col: len, solid: n < l.text.length }; }
    } else if (l.type === 'out') {
      let spans = l.spans;
      if (spans.some(([s]) => s.startsWith('BAR:'))) spans = spans.map(([s, c]) => { if (!s.startsWith('BAR:')) return [s, c]; const [, v, col] = s.split(':'), u = E.outCubic(P(t, l.t, 0.9)), cells = Math.round((Number(v) / 73) * 44 * u); return ['█'.repeat(cells) + ' '.repeat(46 - cells), col]; });
      if (l.fill) { const u = P(t, l.t, l.fill), total = spans.reduce((a, [s]) => a + s.length, 0), k = Math.floor(total * u); let left = k; spans = spans.map(([s, c]) => { const p = s.slice(0, Math.max(0, left)); left -= s.length; return [p, c]; }); }
      wrapSpans(spans).forEach((s) => push(s, { hot: l.hot, born: l.t }));
    } else if (l.type === 'big') {
      if (!l.m) l.m = blockMatrix(l.text, l.rows);
      const hpx = (l.m.bot - l.m.top + 1) * l.cell, n = Math.ceil(hpx / LH) + 1;
      push([], { big: l }); for (let k = 1; k < n; k++) push([], { spacer: 1 });
    }
  });
  const last = lines[lines.length - 1], next = LINES.find((l) => l.screen === sc && l.t > t);
  const idle = last && !(last.type === 'cmd' && t < last.enter) && t - (last.type === 'cmd' ? last.enter : last.t) > 0.25;
  if (idle && (!next || next.type === 'cmd')) { push([...PROMPT]); cursor = { row: rows.length - 1, col: 'kanmani ~ $ '.length, solid: false }; }
  return { rows, cursor, sc };
}
function drawBig(g, l, x, y, t) {
  const m = l.m, cs = l.cell, u = P(t, l.t, 0.45), cols = m.w, shown = Math.ceil(cols * E.outCubic(u));
  g.save();
  for (const pass of [0, 1]) {
    for (let cx = 0; cx < Math.min(cols, shown); cx++) for (let cy = m.top; cy <= m.bot; cy++) {
      if (!m.on[cy * m.w + cx]) continue;
      const px = x + cx * cs, py = y + (cy - m.top) * cs;
      if (pass === 0) { g.fillStyle = rgba(l.color, 0.18); g.fillRect(px + cs * 0.4, py + cs * 0.4, cs - 1, cs - 1); }
      else { g.fillStyle = l.color2 ? mixHex(l.color, l.color2, cx / cols) : l.color; g.fillRect(px, py, cs - 2, cs - 2); }
    }
  }
  if (u < 1) { const hx = x + shown * cs; g.fillStyle = rgba(C.white, 0.8); g.fillRect(hx, y, 3, (m.bot - m.top + 1) * cs); }
  g.restore();
}
function drawScreen(g, t) {
  const { rows, cursor } = rowsAt(t), scroll = Math.max(0, rows.length - ROWS);
  g.save(); g.font = MONO(500); g.textBaseline = 'alphabetic'; g.letterSpacing = '0px';
  for (let r = scroll; r < rows.length; r++) {
    const row = rows[r], y = Y0 + (r - scroll) * LH;
    if (row.big) { drawBig(g, row.big, X0, y - LH * 0.72, t); continue; }
    if (row.hot) { const a = 0.14 * (0.6 + 0.4 * Math.sin(t * 5)); g.fillStyle = rgba(C.cyan, a); g.fillRect(X0 - 14, y - LH * 0.74, COLS * CW + 28, LH); }
    for (const [dx, col, al] of [[-1.3, '#ff3b6b', 0.28], [1.3, '#3bb7ff', 0.28], [0, null, 1]]) {
      let x = X0 + dx; g.globalAlpha = al;
      for (const [s, c] of row.spans) { if (!s) continue; g.fillStyle = col || c; g.fillText(s, x, y); x += s.length * CW; }
    }
    g.globalAlpha = 1;
  }
  if (cursor && cursor.row >= scroll) {
    const on = cursor.solid || Math.floor(t * 1.9) % 2 === 0;
    if (on) { g.fillStyle = C.text; g.fillRect(X0 + cursor.col * CW + 1, Y0 + (cursor.row - scroll) * LH - LH * 0.7, CW - 2, LH * 0.86); }
  }
  g.restore();
}
function glitch(g, t) {
  let k = -1; for (const c of CLEARS.slice(1)) if (t >= c && t < c + 0.28) k = c; if (k < 0) return;
  const r = rng(frameSeed(t, 77)), amt = 1 - (t - k) / 0.28;
  SCRG.globalCompositeOperation = 'copy'; SCRG.drawImage(g.canvas, 0, 0);
  for (let i = 0; i < 10; i++) {
    const y = r() * H, h = 8 + r() * 90, dx = (r() - 0.5) * 140 * amt;
    g.drawImage(SCR, 0, y, W, h, dx, y, W, h);
    if (r() < 0.5) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 * amt; g.drawImage(SCR, 0, y, W, h, dx + 8, y, W, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  }
  g.fillStyle = `rgba(255,255,255,${0.08 * amt})`; g.fillRect(0, 0, W, H);
}
function crt(g, t) {
  const on = P(t, 0.1, 0.9), off = P(t, 118.6, 0.9);
  if (on < 1) {
    const u = on, lineW = E.outCubic(clamp(u / 0.45)) * W, hh = u < 0.45 ? 3 : E.outCubic(clamp((u - 0.45) / 0.55)) * H;
    g.save(); g.globalCompositeOperation = 'destination-in'; g.fillStyle = '#000'; g.fillRect((W - lineW) / 2, (H - hh) / 2, lineW, Math.max(3, hh)); g.restore();
    g.fillStyle = `rgba(230,236,255,${0.85 * (1 - u)})`; g.fillRect((W - lineW) / 2, H / 2 - 2, lineW, 4);
  }
  if (off > 0) {
    const hh = off < 0.5 ? lerp(H, 4, E.inCubic(off / 0.5)) : 4, ww = off < 0.5 ? W : lerp(W, 6, E.inCubic((off - 0.5) / 0.5));
    g.save(); g.globalCompositeOperation = 'destination-in'; g.fillStyle = '#000'; g.fillRect((W - ww) / 2, (H - hh) / 2, ww, hh); g.restore();
    g.fillStyle = `rgba(230,236,255,${0.9 * clamp(off * 2)})`; g.fillRect((W - ww) / 2, (H - hh) / 2, ww, hh);
    if (off >= 1) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
  }
}
function render(g, t, main) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const gl = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 1100); gl.addColorStop(0, 'rgba(60,70,120,0.16)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H);
  drawScreen(g, t);
  glitch(g, t);
  bloom(g, main, 0.55, 5);
  g.globalCompositeOperation = 'multiply'; g.drawImage(SCAN, 0, 0); g.globalCompositeOperation = 'source-over';
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.14; g.drawImage(GRAIN[Math.floor(t * FPS) % GRAIN.length], 0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const fl = 0.025 * (0.5 + 0.5 * Math.sin(t * 61) * Math.sin(t * 7.3)); g.fillStyle = `rgba(0,0,0,${fl})`; g.fillRect(0, 0, W, H);
  crt(g, t);
  g.drawImage(VIG, 0, 0); g.drawImage(BEZEL, 0, 0);
  if (t > DUR - 0.3) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
}
async function init() {
  await fontsReady([MONO(500), font(40, 'JetBrains Mono', 800)]);
  CW = textW(MONO(500), 'M'); COLS = Math.floor((W - X0 * 2) / CW);
  SCR = cv(W, H); SCRG = SCR.getContext('2d');
  SCAN = cv(W, H); { const g = SCAN.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1); }
  BEZEL = cv(W, H); { const g = BEZEL.getContext('2d'); g.fillStyle = '#020203'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'destination-out'; rr(g, 46, 34, W - 92, H - 68, 58); g.fill(); g.globalCompositeOperation = 'source-over'; g.strokeStyle = 'rgba(160,170,210,0.10)'; g.lineWidth = 3; rr(g, 46, 34, W - 92, H - 68, 58); g.stroke(); const gl = g.createLinearGradient(0, 34, 0, 420); gl.addColorStop(0, 'rgba(255,255,255,0.05)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; rr(g, 60, 44, W - 120, 380, 52); g.fill(); }
  GRAIN = makeGrain(6, 960, 540, 90, 31); VIG = makeVignette(520, 1250, 0.65);
  script();
  cue('crtOn', 0.1); cue('crtOff', 118.6);
}
registerFilm({ duration: DUR, arrangement: { bpm: BPM, bars: 60, film: 'run-it', clears: CLEARS }, init, render });
