'use strict';
/*
 * The storyboard. One long night wall; the camera walks it. 45 bars at 90 BPM = 120 seconds.
 *
 *  bars  0-3   cold open        a flashlight finds a wall; the lights buzz on; KANMANI goes up
 *  bars  3-7   the registry     10,258 agents, and every integrity tool stamps VERIFIED
 *  bars  7-13  the check        85 claims: 12 true, 73 false; 64 real on another chain, 9 nowhere
 *  bars 13-17  the dead doc     8,093 agents, 7,962 wallets, one document that stopped answering
 *  bars 17-20  not fraud        the buff rolls over it: NOT FRAUD. PLUMBING.  (breakdown)
 *  bars 20-26  the fix          the payment writes the receipt: escrow, deliver, settle, price it
 *  bars 26-32  the stack        nine HELLO-my-name-is slaps, eight live, one built
 *  bars 32-38  proof            the mainnet receipt; a block every 266 ms vs 12 s finality
 *  bars 38-41  the rule         UNKNOWN is never FALSE, and a null is never 0  (halftime)
 *  bars 41-45  the close        trust stops being a badge. it becomes a price. kanmani.xyz
 *
 * Every figure is the project's own published number (README, /feed.json, the mainnet run).
 */
const SECTIONS = [], SCENES = [], CAMK = [];
let WORLD_X = 0;
const ARRANGEMENT = {
  bpm: BPM, swing: SWING, duration: DURATION, end: END_T,
  parts: [['intro', 0, 3], ['groove', 3, 17], ['breakdown', 17, 20], ['lift', 20, 38], ['halftime', 38, 41], ['groove', 41, 44], ['stop', 44, 45]],
};
function section(w, surface, seed, lamps) {
  const s = { x: WORLD_X, w, surface, seed, lamps, off: 0, decor: null };
  WORLD_X += w + PILLAR; SECTIONS.push(s); return s;
}
function scene(sec, bar0, bars, build) {
  const sc = { sec, t0: bar0 * BAR, t1: (bar0 + bars) * BAR, els: [] };
  const at = (b) => sc.t0 + b * BEAT;
  const add = (el) => { el.wx = sec.x + (el.x || 0); if (el.build) el.build(); sc.els.push(el); return el; };
  const cam = (t, x, y, z = 1, ease = 'io') => CAMK.push({ t, x: sec.x + x, y, z, ease });
  build({ at, add, cam, t0: sc.t0, t1: sc.t1 });
  SCENES.push(sc); return sc;
}
/* A whip pan out of a scene: the camera throws itself down the wall, the DJ cuts the record. */
function whip(sc) { cue('whoosh', sc.t1 - 0.28, { dur: 0.56 }); cue('scratch', sc.t1 - 0.34); }

const piece = (o) => new Paint({ kind: 'piece', ...o });
const tag = (o) => new Paint({ kind: 'tag', ...o });
const mark = (o) => new Paint({ kind: 'marker', fill: [PAL.marker], ...o });
const BRAND = { fill: ['#a594ff', '#22d3ee'], extrudeColor: '#16123f' };
const CHALK = { fill: ['#ffffff', '#d3dae4'], extrudeColor: '#1d2230' };

function buildStory() {
  const s1 = section(2400, 'brick', 11, [1250]);
  const s2 = section(2600, 'concrete', 23, [700, 1900]);
  const s3 = section(4000, 'brick', 37, [700, 2000, 3300]);
  const s4 = section(2700, 'concrete', 41, [800, 2000]);
  const s6 = section(3900, 'shutter', 53, [800, 2100, 3300]);
  const s7 = section(2800, 'brick', 67, [800, 2100]);
  const s8 = section(3300, 'concrete', 71, [900, 2400]);
  const s9 = section(2400, 'shutter', 83, [1200]);
  const s10 = section(2600, 'brick', 97, [1300]);

  /* ------------------------------------------------ 1. cold open */
  whip(scene(s1, 0, 3, ({ add, cam, t1 }) => {
    cam(0, 1000, 560, 1.18); cam(3.2, 1120, 540, 1.12); cam(t1 - 0.22, 1240, 540, 1.04);
    add(piece({ text: 'KANMANI', size: 270, x: 1200, y: 430, ...BRAND, extrudeColor: '#171141', t0: 3.6, dur: 2.1, maxW: 1400 }));
    add(tag({ text: 'hold it safe.', size: 100, x: 1330, y: 690, rot: -0.04, fill: [PAL.white], t0: 5.75, dur: 1.0 }));
    add(mark({ text: 'monad mainnet · chain 143', size: 44, x: 1330, y: 800, fill: ['#aebdd0'], t0: 6.75, dur: 0.8 }));
    cue('click', 3.0); cue('click', 3.18); cue('click', 3.34); cue('buzz', 3.0, { dur: 5.2 });
  }));

  /* ------------------------------------------------ 2. the registry */
  whip(scene(s2, 3, 4, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.22, 1300, 470, 1.12, 'whip'); cam(at(3.5), 1300, 500, 1.02); cam(at(9), 1300, 560, 0.98); cam(t1 - 0.22, 1300, 600, 0.95);
    add(new Stencil({ text: '10,258', size: 330, x: 1300, y: 400, t0: at(0.25) }));
    add(mark({ text: "AGENTS ON MONAD'S ERC-8004 REGISTRY", size: 62, x: 1300, y: 615, fill: [PAL.cyan], t0: at(2), dur: 1.3 }));
    for (const [text, x, y, rot, b] of [['VERIFIED', 560, 250, -0.12, 4], ['HASH MATCHES', 2040, 235, 0.09, 5], ['INTEGRITY OK', 560, 790, 0.07, 6], ['VERIFIED', 2040, 800, -0.08, 7], ['BYTES MATCH', 1300, 135, -0.03, 7.5]])
      add(new Stamp({ text, x, y, rot, tI: at(b) }));
    add(mark({ text: 'every tool checks the hash.', size: 58, x: 1300, y: 770, fill: [PAL.white], t0: at(8.5), dur: 1.2 }));
    add(tag({ text: 'but did the payment happen?', size: 104, x: 1300, y: 935, fill: ['#a08fff'], outline: PAL.white, t0: at(10.5), dur: 1.8, maxW: 1600 }));
  }));

  /* ------------------------------------------------ 3. the check */
  whip(scene(s3, 7, 6, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.22, 960, 560, 1.05, 'whip'); cam(at(7.4), 960, 590, 1.0); cam(at(8.2), 1700, 640, 1.0); cam(at(11.6), 1760, 660, 1.0);
    cam(at(12.4), 2450, 650, 1.0); cam(at(16.6), 2520, 660, 1.0); cam(at(17.3), 3320, 560, 1.12); cam(t1 - 0.22, 3340, 560, 1.16);
    add(tag({ text: 'WE CHECKED EVERY', size: 92, x: 900, y: 200, fill: [PAL.white], t0: at(0.3), dur: 1.0 }));
    add(tag({ text: 'PAYMENT CLAIM', size: 92, x: 900, y: 310, fill: [PAL.white], t0: at(1.8), dur: 0.9 }));
    add(mark({ text: 'against the chain it names', size: 50, x: 900, y: 405, fill: [PAL.cyan], t0: at(3.2), dur: 0.9 }));
    add(new Stencil({ text: '85', size: 420, x: 900, y: 690, t0: at(4.5) }));
    add(mark({ text: 'payment claims that exist at all', size: 44, x: 900, y: 955, fill: [PAL.white], t0: at(6), dur: 1.0 }));
    add(arrow(1180, 620, 1520, 470, -60, { t0: at(8), dur: 0.5 }));
    add(arrow(1180, 760, 1520, 820, 50, { t0: at(9), dur: 0.5 }));
    add(piece({ text: '12', size: 250, x: 1780, y: 430, fill: ['#a7f3d0', '#34d399'], extrudeColor: '#053b2d', t0: at(8.3), dur: 0.9 }));
    add(mark({ text: 'TRUE: on the chain they name', size: 50, x: 1780, y: 590, fill: [PAL.green], t0: at(9.0), dur: 0.9 }));
    add(piece({ text: '73', size: 250, x: 1780, y: 800, fill: ['#fecaca', '#f87171'], extrudeColor: '#5f1515', t0: at(9.5), dur: 0.9 }));
    add(mark({ text: 'FALSE: not on the chain they name', size: 50, x: 1780, y: 962, fill: [PAL.red], t0: at(10.3), dur: 1.0 }));
    add(ellipse(1780, 800, 210, 150, { color: PAL.white, t0: at(12), dur: 0.7 }));
    add(arrow(2000, 740, 2330, 560, -40, { color: PAL.cyan, t0: at(12.6), dur: 0.45 }));
    add(arrow(2000, 860, 2330, 880, 30, { t0: at(14.6), dur: 0.4 }));
    add(piece({ text: '64', size: 250, x: 2560, y: 470, fill: ['#cffafe', '#22d3ee'], extrudeColor: '#0b4050', t0: at(13), dur: 0.9 }));
    add(mark({ text: 'REAL TX, WRONG CHAIN', size: 46, x: 2560, y: 630, fill: [PAL.white], t0: at(13.8), dur: 0.9 }));
    add(mark({ text: 'one wrong field. fixable in one edit.', size: 36, x: 2560, y: 692, fill: [PAL.cyan], t0: at(15), dur: 0.9 }));
    add(piece({ text: '9', size: 220, x: 2560, y: 860, fill: ['#fecaca', '#f87171'], extrudeColor: '#5f1515', t0: at(15.5), dur: 0.6 }));
    add(mark({ text: 'found on no chain at all', size: 40, x: 2560, y: 1000, fill: [PAL.red], t0: at(16), dur: 0.8 }));
    add(piece({ text: 'HASH INTEGRITY', size: 130, x: 3360, y: 380, ...CHALK, t0: at(17.2), dur: 1.4, maxW: 1000 }));
    add(notEqual(3360, 565, { color: PAL.cyan, t0: at(19.2), dur: 0.5 }));
    add(piece({ text: 'CLAIM TRUTH', size: 130, x: 3360, y: 750, ...BRAND, t0: at(19.9), dur: 1.3, maxW: 1000 }));
  }));

  /* ------------------------------------------------ 4. the dead document */
  scene(s4, 13, 4, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.22, 1000, 560, 1.12, 'whip'); cam(at(1.2), 1250, 560, 1.0); cam(at(9), 1300, 580, 0.95); cam(t1, 1300, 590, 0.95);
    add(new Grid({ x0: 330, y0: 150, cols: 10, rows: 10, cell: 76, gap: 8, tp: at(0.2), td: at(7), dead: 79 }));
    add(new Stencil({ text: '8,093', size: 280, x: 1850, y: 300, t0: at(1.5) }));
    add(mark({ text: 'AGENTS ACROSS 7,962 WALLETS', size: 50, x: 1850, y: 505, fill: [PAL.cyan], t0: at(3), dur: 1.0 }));
    add(tag({ text: 'ONE DEAD DOCUMENT', size: 88, x: 1850, y: 640, fill: [PAL.white], t0: at(4.5), dur: 1.1, maxW: 1000 }));
    add(mark({ text: 'that no longer answers', size: 46, x: 1850, y: 745, fill: [PAL.white], t0: at(6), dur: 0.9 }));
    add(mark({ text: '79 in every 100', size: 44, x: 746, y: 1045, fill: [PAL.slate], t0: at(9.5), dur: 0.8 }));
    add(mark({ text: "an expired preview deployment. nobody's misconduct.", size: 34, x: 1850, y: 870, fill: [PAL.dim], t0: at(10), dur: 1.4, maxW: 1060 }));
  });

  /* ------------------------------------------------ 5. not fraud (same wall, the buff goes over) */
  whip(scene(s4, 17, 3, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.9, 920, 590, 1.05); cam(at(11), 920, 600, 1.12); cam(t1 - 0.22, 925, 600, 1.13);
    add(new Buff({ x0: 300, y0: 100, w: 900, h: 985, stripes: 6, t0: at(0), step: 0.33, d: 0.42 }));
    add(piece({ text: 'NOT FRAUD.', size: 140, x: 750, y: 420, ...CHALK, t0: at(3.3), dur: 1.3, maxW: 820 }));
    add(piece({ text: 'PLUMBING.', size: 140, x: 750, y: 650, fill: ['#a5f3fc', '#8b76ff'], extrudeColor: '#16123f', t0: at(6), dur: 1.3, maxW: 820 }));
    add(mark({ text: "a registry can't keep a true", size: 44, x: 750, y: 850, fill: [PAL.white], t0: at(8.6), dur: 0.8 }));
    add(mark({ text: 'statement true.', size: 44, x: 750, y: 910, fill: [PAL.white], t0: at(9.4), dur: 0.6 }));
  }));

  /* ------------------------------------------------ 6. the fix */
  whip(scene(s6, 20, 6, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.22, 1000, 560, 1.05, 'whip'); cam(at(5.8), 1000, 560, 1.0); cam(at(6.6), 2450, 520, 1.1); cam(at(11.5), 2700, 520, 1.1);
    cam(at(14.6), 3150, 520, 1.1); cam(at(16.8), 2935, 600, 0.95); cam(t1 - 0.22, 2935, 600, 0.97);
    add(new Logo({ x: 420, y: 460, size: 330, t0: at(0.2), t1: at(0.9), tn: at(1.7) }));
    add(tag({ text: 'kanmani', size: 96, x: 420, y: 740, fill: [PAL.white], t0: at(2.2), dur: 0.8 }));
    add(piece({ text: 'THE PAYMENT', size: 110, x: 1320, y: 420, ...CHALK, t0: at(2.6), dur: 1.1, maxW: 900 }));
    add(piece({ text: 'WRITES THE RECEIPT.', size: 104, x: 1320, y: 610, ...BRAND, t0: at(4.0), dur: 1.4, maxW: 1180 }));
    add(mark({ text: 'not written about it afterwards.', size: 46, x: 1320, y: 765, fill: [PAL.cyan], t0: at(5.6), dur: 1.0 }));
    const ST = [
      ['ESCROW', ['#a08fff'], PAL.white, 'buyer locks USDC', 'against the terms'],
      ['DELIVER', [PAL.white], '#7862f3', 'the agent does the job', 'either side can exit'],
      ['SETTLE', [PAL.cyan], PAL.white, 'payment + receipt', 'in one transaction'],
      ['PRICE IT', ['#a594ff', '#22d3ee'], PAL.white, 'the track record', 'sets the bond'],
    ];
    ST.forEach(([word, fill, outline, c1, c2], k) => {
      const x = 2200 + k * 490, b = 6.3 + k * 2.6;
      add(new Stencil({ text: '0' + (k + 1), size: 110, x, y: 330, color: PAL.violet, t0: at(b) }));
      add(tag({ text: word, size: 90, x, y: 470, fill, outline, t0: at(b + 0.5), dur: 0.8, maxW: 430 }));
      add(mark({ text: c1, size: 38, x, y: 575, fill: [PAL.white], t0: at(b + 1.2), dur: 0.6 }));
      add(mark({ text: c2, size: 38, x, y: 622, fill: [PAL.dim], t0: at(b + 1.7), dur: 0.6 }));
      if (k < 3) add(arrow(x + 95, 330, x + 395, 330, -30, { t0: at(b + 2.2), dur: 0.4, width: 16 }));
    });
    add(tag({ text: "THE EVIDENCE CAN'T DISAGREE WITH THE PAYMENT.", size: 70, x: 2935, y: 830, fill: [PAL.white], t0: at(17), dur: 1.8, maxW: 1650 }));
  }));

  /* ------------------------------------------------ 7. the stack */
  whip(scene(s7, 26, 6, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.22, 1000, 560, 1.12, 'whip');
    add(new Stencil({ text: '9 LAYERS', size: 150, x: 520, y: 400, t0: at(0.3) }));
    add(mark({ text: 'one primitive underneath:', size: 40, x: 520, y: 545, fill: [PAL.cyan], t0: at(1.3), dur: 0.9 }));
    add(tag({ text: 'A PROVEN', size: 84, x: 520, y: 660, fill: ['#a08fff'], outline: PAL.white, t0: at(2.0), dur: 0.6 }));
    add(tag({ text: 'TRACK RECORD', size: 84, x: 520, y: 765, fill: ['#a08fff'], outline: PAL.white, t0: at(2.6), dur: 0.8, maxW: 560 }));
    const L = [
      ['RETINA', 'indexes the evidence', 'live'], ['FOVEA', 'verifies the claim', 'live'], ['AQUEOUS', 'escrows the job', 'live'],
      ['IRIS · x402', 'pays without a wallet', 'live'], ['OPTIC', 'answers on chain', 'live'], ['SCLERA', 'bonds the promise', 'live'],
      ['CHIASM', 'reads every chain', 'live'], ['INTENTS', 'funds from any chain', 'built'], ['SELF-HEAL', 'heals a fixed record', 'live'],
    ];
    let prev = [1000, 560, 1.12];
    L.forEach(([name, sub, status], k) => {
      const px = 1080 + (k % 3) * 400, py = 354 + Math.floor(k / 3) * 286, tI = at(3.4 + 2 * k);
      add(new Sticker({ name, sub, status, x: px, y: py, rot: (rng(k + 40)() - 0.5) * 0.12, tI, scale: 0.82 }));
      const target = [lerp(px, 1480, 0.3), lerp(py, 640, 0.3), 1.3];
      cam(tI - 0.45, ...prev); cam(tI - 0.03, ...target); prev = target;
    });
    cam(at(19.4) + 0.5, ...prev); cam(at(20.1), 1450, 610, 0.75); cam(t1 - 0.22, 1450, 610, 0.77);
    add(new Stencil({ text: '8 LIVE', size: 120, x: 2400, y: 520, color: PAL.violet, t0: at(20.4) }));
    add(new Stencil({ text: '1 BUILT', size: 120, x: 2400, y: 700, color: PAL.slate, t0: at(21.3) }));
    add(mark({ text: 'status checked against the artifact', size: 34, x: 2400, y: 835, fill: [PAL.white], t0: at(22), dur: 1.0, maxW: 600 }));
  }));

  /* ------------------------------------------------ 8. proof */
  whip(scene(s8, 32, 6, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.22, 1000, 560, 1.05, 'whip'); cam(at(2.6), 1000, 560, 1.02); cam(at(3.2), 1330, 580, 1.22); cam(at(10.2), 1330, 620, 1.12);
    cam(at(10.9), 2600, 580, 1.08); cam(at(16.2), 2600, 610, 1.02); cam(t1 - 0.22, 2450, 610, 0.92);
    add(piece({ text: 'PROOF.', size: 190, x: 560, y: 300, ...CHALK, t0: at(0.3), dur: 0.9 }));
    add(tag({ text: 'ON MAINNET.', size: 80, x: 560, y: 470, fill: [PAL.cyan], t0: at(1.5), dur: 0.7 }));
    add(mark({ text: 'no testnet screenshots.', size: 40, x: 560, y: 560, fill: [PAL.white], t0: at(2.3), dur: 0.8 }));
    add(new Receipt({ x: 1330, y: 590, rot: 0.02, tp: at(3.2), tl: at(4.0) }));
    add(mark({ text: 'the buyer never held MON.', size: 40, x: 1330, y: 1062, fill: [PAL.cyan], t0: at(10.2), dur: 0.9 }));
    add(new Stencil({ text: 'MONAD', size: 100, x: 2600, y: 300, t0: at(10.6) }));
    add(new Blocks({ x: 2600, y: 420, t0: at(11.2), tb: at(13.4), end: t1 }));
    add(mark({ text: 'a block every 266 ms', size: 40, x: 2600, y: 530, fill: [PAL.cyan], t0: at(11.6), dur: 0.9 }));
    add(new Stencil({ text: '12S FINALITY', size: 80, x: 2600, y: 660, color: PAL.slate, t0: at(13) }));
    add(mark({ text: 'a false claim is paid and gone before the verdict lands.', size: 36, x: 2600, y: 860, fill: [PAL.dim], t0: at(14.5), dur: 1.4, maxW: 980 }));
    add(mark({ text: 'one bond: posted, held, matured, returned.', size: 42, x: 2600, y: 950, fill: [PAL.white], t0: at(16.5), dur: 1.4, maxW: 980 }));
    add(new Label({ text: '537 tests passing', x: 3020, y: 170, rot: 0.07, tI: at(19) }));
  }));

  /* ------------------------------------------------ 9. the rule */
  whip(scene(s9, 38, 3, ({ at, add, cam, t0, t1 }) => {
    cam(t0 + 0.22, 1200, 520, 1.1, 'whip'); cam(at(5), 1200, 580, 1.0); cam(t1 - 0.22, 1200, 600, 0.96);
    add(piece({ text: 'UNKNOWN', size: 190, x: 1200, y: 300, fill: ['#e2e8f0', '#94a3b8'], extrudeColor: '#1e293b', t0: at(0.4), dur: 1.2, maxW: 1300 }));
    add(mark({ text: 'is never', size: 84, x: 1200, y: 480, fill: [PAL.white], t0: at(2.2), dur: 0.6 }));
    add(piece({ text: 'FALSE.', size: 220, x: 1200, y: 690, fill: ['#fecaca', '#f87171'], extrudeColor: '#5f1515', t0: at(3.2), dur: 1.0 }));
    add(new Stencil({ text: 'AND A NULL IS NEVER 0', size: 80, x: 1200, y: 915, t0: at(6.5) }));
  }));

  /* ------------------------------------------------ 10. the close */
  scene(s10, 41, 4, ({ at, add, cam, t0 }) => {
    cam(t0 + 0.22, 1300, 520, 1.08, 'whip'); cam(at(4.3), 1300, 600, 1.0); cam(at(8.5), 1300, 640, 0.92); cam(END_T, 1300, 650, 0.94); cam(DURATION + 1, 1300, 650, 0.94);
    add(new Logo({ x: 1300, y: 300, size: 300, t0: at(0.2), t1: at(0.8), tn: at(1.5) }));
    add(tag({ text: 'TRUST STOPS BEING A BADGE.', size: 92, x: 1300, y: 600, fill: [PAL.white], t0: at(2.4), dur: 1.6, maxW: 1500 }));
    add(piece({ text: 'IT BECOMES A PRICE.', size: 150, x: 1300, y: 805, ...BRAND, t0: at(4.6), dur: 1.6, maxW: 1750 }));
    add(new Stencil({ text: 'KANMANI.XYZ', size: 80, x: 1300, y: 1010, t0: at(7.6) }));
    cue('click', END_T);
  });
  shakeAt(3 * BAR, 9);
}
