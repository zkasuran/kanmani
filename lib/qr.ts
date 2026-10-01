/**
 * A byte-mode QR encoder, vendored so a deposit address never leaves the box to a QR image service.
 *
 * Error-correction level M, versions 1 to 6 (byte capacity up to 106 chars, which covers every USDC
 * deposit address Intents Connect hands back, EVM or NEAR). Returns the module matrix as `boolean[][]`,
 * so `fund-flow.tsx` renders it as inline `<rect>` elements in one `<svg>`: no new dependency, no new
 * CSP host, no `dangerouslySetInnerHTML`. Money is scanned off this, so `qr.test.ts` round-trips the
 * encoded matrix back to the input through a Reed-Solomon check rather than trusting it.
 *
 * The algorithm is ISO/IEC 18004: GF(256) with primitive 0x11d, Reed-Solomon ECC, the standard data
 * placement and the eight data masks scored by the four penalty rules. No external reference is copied;
 * the structure is the spec and the test proves the bytes come back out.
 */

const PRIMITIVE = 0x11d;
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIMITIVE;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255]!;
}

function rsGeneratorPoly(nsym: number): number[] {
  let g = [1];
  for (let i = 0; i < nsym; i++) {
    const ng = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      ng[j]! ^= g[j]!;
      ng[j + 1]! ^= gfMul(g[j]!, GF_EXP[i]!);
    }
    g = ng;
  }
  return g;
}

function rsEcc(data: number[], nsym: number): number[] {
  const gen = rsGeneratorPoly(nsym);
  const res = new Array<number>(nsym).fill(0);
  for (const d of data) {
    const factor = d ^ res[0]!;
    res.shift();
    res.push(0);
    for (let j = 0; j < gen.length - 1; j++) {
      res[j]! ^= gfMul(gen[j + 1]!, factor);
    }
  }
  return res;
}

/** Level M block structure for versions 1 to 6. All single-group (uniform blocks), so no mixed sizes. */
type VerInfo = { ecPerBlock: number; blocks: number; dataPerBlock: number };
const LEVEL_M: Record<number, VerInfo> = {
  1: { ecPerBlock: 10, blocks: 1, dataPerBlock: 16 },
  2: { ecPerBlock: 16, blocks: 1, dataPerBlock: 28 },
  3: { ecPerBlock: 26, blocks: 1, dataPerBlock: 44 },
  4: { ecPerBlock: 18, blocks: 2, dataPerBlock: 32 },
  5: { ecPerBlock: 24, blocks: 2, dataPerBlock: 43 },
  6: { ecPerBlock: 16, blocks: 4, dataPerBlock: 27 },
};

/** Alignment-pattern centre coordinates per version (ISO 18004 Annex E), versions 1 to 6. */
const ALIGN_POS: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

export const QR_QUIET_ZONE = 4;

function totalData(v: VerInfo): number {
  return v.blocks * v.dataPerBlock;
}

function pickVersion(byteLen: number): number {
  for (let version = 1; version <= 6; version++) {
    if (totalData(LEVEL_M[version]!) - 2 >= byteLen) return version;
  }
  throw new Error(`text of ${byteLen} bytes does not fit a version 1-6 level-M byte-mode QR`);
}

/** Byte-mode bitstream: mode 0100, 8-bit count, the data bytes, terminator, pad to codewords, pad bytes. */
function buildCodewords(bytes: number[], version: number): number[] {
  const info = LEVEL_M[version]!;
  const capacityBits = totalData(info) * 8;
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // count, 8 bits for versions 1-9
  for (const b of bytes) push(b, 8);
  // Terminator up to 4 bits, then pad to a byte boundary.
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    codewords.push(b);
  }
  const pad = [0xec, 0x11];
  let p = 0;
  while (codewords.length < totalData(info)) codewords.push(pad[p++ % 2]!);
  return codewords;
}

/** Split into blocks, compute ECC per block, interleave data then ECC (uniform blocks). */
function interleave(dataCodewords: number[], version: number): number[] {
  const info = LEVEL_M[version]!;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < info.blocks; b++) {
    const block = dataCodewords.slice(b * info.dataPerBlock, (b + 1) * info.dataPerBlock);
    dataBlocks.push(block);
    ecBlocks.push(rsEcc(block, info.ecPerBlock));
  }
  const out: number[] = [];
  for (let i = 0; i < info.dataPerBlock; i++) for (const blk of dataBlocks) if (i < blk.length) out.push(blk[i]!);
  for (let i = 0; i < info.ecPerBlock; i++) for (const blk of ecBlocks) out.push(blk[i]!);
  return out;
}

/* MARKER-QR-MATRIX */

type Grid = boolean[][];

function blank(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

/** Draw the function patterns (finders, separators, timing, alignment, dark module) and mark them. */
function drawFunction(modules: Grid, isFunc: Grid, version: number): void {
  const size = modules.length;
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y]![x] = dark;
    isFunc[y]![x] = true;
  };

  // Timing patterns on row 6 and column 6.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Three finder patterns with their separators, centred at the three corners.
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  // Alignment patterns at every centre pair that does not collide with a finder.
  const pos = ALIGN_POS[version]!;
  for (const ay of pos) {
    for (const ax of pos) {
      const nearFinder = (ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve the format-information modules and the always-dark module, so data placement skips them.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, false);
      set(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true); // always dark
}

/** Write the 15 format bits for a mask (EC level M = 0b00) in both copies. */
function drawFormat(modules: Grid, mask: number): void {
  const size = modules.length;
  const data = mask; // (M formatBits 0b00 << 3) | mask
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const set = (x: number, y: number, bit: number) => {
    modules[y]![x] = (bit & 1) !== 0;
  };
  for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i) ? 1 : 0);
  set(8, 7, getBit(bits, 6) ? 1 : 0);
  set(8, 8, getBit(bits, 7) ? 1 : 0);
  set(7, 8, getBit(bits, 8) ? 1 : 0);
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i) ? 1 : 0);

  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i) ? 1 : 0);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i) ? 1 : 0);
  modules[size - 8]![8] = true; // always dark
}

/** Zigzag data placement over non-function modules, two columns at a time, skipping the timing column. */
function placeData(modules: Grid, isFunc: Grid, codewords: number[]): void {
  const size = modules.length;
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the timing column is skipped by stepping the pair itself, not a local
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (!isFunc[y]![x]) {
          let dark = false;
          if (bit < total) {
            dark = getBit(codewords[bit >>> 3]!, 7 - (bit & 7));
            bit++;
          }
          modules[y]![x] = dark;
        }
      }
    }
  }
}

function maskCondition(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(modules: Grid, isFunc: Grid, mask: number): void {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunc[y]![x] && maskCondition(mask, x, y)) modules[y]![x] = !modules[y]![x];
    }
  }
}

/** The four penalty rules, so the mask with the lowest score is chosen. */
function penalty(modules: Grid): number {
  const size = modules.length;
  let score = 0;
  // Rule 1: runs of 5+ same-colour modules in a row or column.
  for (let y = 0; y < size; y++) {
    let runColor = modules[y]![0]!;
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (modules[y]![x] === runColor) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        runColor = modules[y]![x]!;
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let x = 0; x < size; x++) {
    let runColor = modules[0]![x]!;
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (modules[y]![x] === runColor) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        runColor = modules[y]![x]!;
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y]![x]!;
      if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) score += 3;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 patterns with a 4-module quiet run, in rows and columns.
  const line = (get: (i: number) => boolean) => {
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    for (let i = 0; i <= size - 11; i++) {
      let m1 = true;
      let m2 = true;
      for (let k = 0; k < 11; k++) {
        const b = get(i + k);
        if (b !== pat1[k]) m1 = false;
        if (b !== pat2[k]) m2 = false;
      }
      if (m1) score += 40;
      if (m2) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((i) => modules[y]![i]!);
  for (let x = 0; x < size; x++) line((i) => modules[i]![x]!);
  // Rule 4: deviation of dark-module proportion from 50%.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y]![x]) dark++;
  const percent = (dark * 100) / (size * size);
  const prev = Math.floor(percent / 5) * 5;
  score += Math.min(Math.abs(prev - 50), Math.abs(prev + 5 - 50)) / 5 * 10;
  return score;
}

export type QrResult = {
  size: number;
  version: number;
  mask: number;
  /** The module matrix without a quiet zone. True is a dark module. */
  matrix: Grid;
};

/** Encode a string as a level-M byte-mode QR, choosing the version and the lowest-penalty mask. */
export function encodeQr(text: string): QrResult {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  const size = 4 * version + 17;
  const codewords = interleave(buildCodewords(bytes, version), version);

  const base = blank(size);
  const isFunc = blank(size);
  drawFunction(base, isFunc, version);
  placeData(base, isFunc, codewords);

  let best: Grid | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const trial = base.map((row) => row.slice());
    applyMask(trial, isFunc, mask);
    drawFormat(trial, mask);
    const score = penalty(trial);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      best = trial;
    }
  }
  return { size, version, mask: bestMask, matrix: best! };
}

/** Add a quiet zone of white modules around a matrix. */
function withQuietZone(matrix: Grid, quiet: number): Grid {
  const size = matrix.length;
  const out = blank(size + quiet * 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y + quiet]![x + quiet] = matrix[y]![x]!;
  return out;
}

/**
 * The deposit-address QR as a boolean matrix with a quiet zone, ready to render as `<rect>` cells.
 * True is a dark module. Byte mode, level M.
 */
export function qrMatrix(text: string): Grid {
  if (text.length === 0) throw new Error("qrMatrix needs a non-empty string");
  return withQuietZone(encodeQr(text).matrix, QR_QUIET_ZONE);
}
