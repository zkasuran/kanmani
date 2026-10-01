import { test } from "node:test";
import assert from "node:assert/strict";
import { qrMatrix, encodeQr, QR_QUIET_ZONE } from "./qr.ts";

/**
 * A QR a buyer scans money off is proved, not trusted. These decode the matrix the encoder produced,
 * independently of the encoder: a fresh GF(256), a fresh zigzag read, a Reed-Solomon syndrome check and
 * a byte-mode payload decode. If the bytes come back out and the syndromes are all zero, a real reader
 * would read it too. Plus the structural invariants (finder patterns, timing, quiet zone) and
 * determinism.
 */

/* -------- an independent GF(256) and Reed-Solomon syndrome, written fresh for the cross-check -------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a]! + LOG[b]!) % 255]!);

/** All syndromes zero means the codeword (data + ecc) is a valid RS codeword for `nsym` roots. */
function syndromesZero(codewords: number[], nsym: number): boolean {
  for (let j = 0; j < nsym; j++) {
    const r = EXP[j]!;
    let s = 0;
    for (const b of codewords) s = mul(s, r) ^ b;
    if (s !== 0) return false;
  }
  return true;
}

/* -------- reservation map, written fresh so a placement bug is not mirrored -------- */

const LEVEL_M: Record<number, { ec: number; data: number }> = {
  1: { ec: 10, data: 16 },
  3: { ec: 26, data: 44 },
};
const ALIGN: Record<number, number[]> = { 1: [], 3: [6, 22] };

function reservedMap(version: number): boolean[][] {
  const size = 4 * version + 17;
  const f = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) f[y]![x] = true;
  };
  // Timing.
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  // Finders + separators (9x9 centred at the three corners).
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  }
  // Alignment.
  const pos = ALIGN[version]!;
  for (const ay of pos) {
    for (const ax of pos) {
      const nf = (ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6);
      if (nf) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(ax + dx, ay + dy);
    }
  }
  // Format areas + dark module.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      mark(8, i);
      mark(i, 8);
    }
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  mark(8, size - 8);
  return f;
}

function readMask(m: boolean[][]): number {
  // First format copy: bit i lives where drawFormat put it.
  const read = (x: number, y: number) => (m[y]![x] ? 1 : 0);
  let bits = 0;
  const put = (i: number, b: number) => (bits |= b << i);
  for (let i = 0; i <= 5; i++) put(i, read(8, i));
  put(6, read(8, 7));
  put(7, read(8, 8));
  put(8, read(7, 8));
  for (let i = 9; i < 15; i++) put(i, read(14 - i, 8));
  const unmasked = bits ^ 0x5412;
  return (unmasked >> 10) & 0b111;
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

/** Decode a single-block level-M byte-mode QR matrix back to its string, or throw. */
function decode(m: boolean[][], version: number): string {
  const size = m.length;
  const info = LEVEL_M[version]!;
  const func = reservedMap(version);
  const mask = readMask(m);
  // Walk the zigzag, de-masking data modules into a bit stream.
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (!func[y]![x]) {
          let bit = m[y]![x] ? 1 : 0;
          if (maskCondition(mask, x, y)) bit ^= 1;
          bits.push(bit);
        }
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]!;
    codewords.push(b);
  }
  const all = codewords.slice(0, info.data + info.ec);
  assert.ok(syndromesZero(all, info.ec), "Reed-Solomon syndromes must be zero for a valid codeword");
  // Byte-mode payload: 4-bit mode, 8-bit count, then the bytes.
  const dataBits = bits.slice(0, info.data * 8);
  const take = (start: number, len: number) => {
    let val = 0;
    for (let i = 0; i < len; i++) val = (val << 1) | dataBits[start + i]!;
    return val;
  };
  assert.equal(take(0, 4), 0b0100, "mode must be byte");
  const count = take(4, 8);
  const bytes: number[] = [];
  for (let i = 0; i < count; i++) bytes.push(take(12 + i * 8, 8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/* ------------------------------------------------------------------ the proofs */

test("a short string round-trips through an independent decode (version 1, single block)", () => {
  const text = "HELLO WORLD";
  const r = encodeQr(text);
  assert.equal(r.version, 1);
  assert.equal(r.size, 21);
  assert.equal(decode(r.matrix, 1), text);
});

test("a 42-char EVM address round-trips (version 3, the real deposit-address case)", () => {
  const text = "0xDB6c6340342e71A63cD11Ebac2185204b7777777";
  assert.equal(text.length, 42);
  const r = encodeQr(text);
  assert.equal(r.version, 3);
  assert.equal(r.size, 29);
  assert.equal(decode(r.matrix, 3), text);
});

test("the read-back mask matches the mask the encoder chose", () => {
  const r = encodeQr("0xDB6c6340342e71A63cD11Ebac2185204b7777777");
  assert.equal(readMask(r.matrix), r.mask);
});

test("the three finder patterns are the exact 7x7 shape", () => {
  const r = encodeQr("HELLO WORLD");
  const m = r.matrix;
  const size = r.size;
  const dark = (x: number, y: number) => m[y]![x] === true;
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    // Corners and centre dark, the inner ring light.
    assert.ok(dark(ox, oy) && dark(ox + 6, oy) && dark(ox, oy + 6) && dark(ox + 6, oy + 6), "finder corners dark");
    assert.equal(dark(ox + 1, oy + 1), false, "finder ring light");
    assert.ok(dark(ox + 3, oy + 3), "finder centre dark");
  }
});

test("qrMatrix wraps the code in a quiet zone that is entirely light", () => {
  const grid = qrMatrix("HELLO WORLD");
  const size = 21 + QR_QUIET_ZONE * 2;
  assert.equal(grid.length, size);
  assert.equal(grid[0]!.length, size);
  for (let i = 0; i < size; i++) {
    for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]] as const) {
      assert.equal(grid[y]![x], false, "quiet-zone module must be light");
    }
  }
});

test("encoding is deterministic", () => {
  const a = qrMatrix("0xDB6c6340342e71A63cD11Ebac2185204b7777777");
  const b = qrMatrix("0xDB6c6340342e71A63cD11Ebac2185204b7777777");
  assert.deepEqual(a, b);
});

test("an empty string is refused rather than encoding nothing", () => {
  assert.throws(() => qrMatrix(""));
});

test("a string too long for a version-6 level-M byte code is refused", () => {
  assert.throws(() => encodeQr("x".repeat(200)));
});
