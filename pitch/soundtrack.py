#!/usr/bin/env python3
"""
The score and the foley, synthesised from nothing: no samples, nothing to license.

    python3 pitch/soundtrack.py pitch/out/cues.json pitch/out/soundtrack.wav

A 90 BPM boom-bap beat in A minor (Am9 - Fmaj9 - Dm9 - E7#9), arranged on the film's own bar map,
plus every spray, rattle, stamp, slap, roller and whip the film asked for in cues.json, panned to
where on screen it happens. Everything is seeded, so a re-run gives the same file.
"""
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
cfg = json.load(open(sys.argv[1]))
ARR, CUES = cfg["arrangement"], cfg["cues"]
BPM = ARR["bpm"]; BEAT = 60 / BPM; BAR = 4 * BEAT; STEP = BEAT / 4; SWING = ARR["swing"]
DUR, END = ARR["duration"], ARR["end"]
N = int(SR * (DUR + 0.2))
R = np.random.default_rng(143)
X = np.arange(N) / SR


def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, btype=kind, fs=SR, output="sos"), x, axis=0)


def lp(x, f, o=2): return filt(x, "lowpass", f, o)
def hp(x, f, o=2): return filt(x, "highpass", f, o)
def bp(x, lo, hi, o=2): return filt(x, "bandpass", [lo, hi], o)
def tt(d): return np.arange(int(d * SR)) / SR
def wn(n): return R.standard_normal(n)
def midi(n): return 440 * 2 ** ((n - 69) / 12)
def bus(): return np.zeros((N, 2))


def place(b, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)], 1) * np.sqrt(2)
    if i < 0:
        sig, i = sig[-i:], 0
    if i >= N:
        return
    j = min(N, i + len(sig))
    b[i:j] += sig[: j - i] * gain


def part(bar):
    for name, a, b in ARR["parts"]:
        if a <= bar < b:
            return name
    return "stop"


def st(bar, s): return bar * BAR + s * STEP + ((SWING - 0.5) * 2 * STEP if s % 2 else 0)
def hum(): return R.normal(0, 0.0035)


# Each section of the film starts its chord cycle on the tonic.
ANCH = [0, 3, 7, 13, 17, 20, 26, 32, 38, 41, 44]
def chord_idx(bar): return (bar - max(a for a in ANCH if a <= bar)) % 4


CH = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [50, 53, 57, 60, 64], [52, 56, 62, 67]]
ROOT = [33, 29, 38, 28]

# ------------------------------------------------------------------ drums
def kick():
    t = tt(0.55); f = 44 + 120 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.2)
    click = hp(wn(len(t)) * np.exp(-t * 320), 1800) * 0.3
    return np.tanh(2.4 * (body + click)) * 0.95


def snare():
    t = tt(0.5)
    tone = np.sin(2 * np.pi * 182 * t) * np.exp(-t * 24) * 0.55 + np.sin(2 * np.pi * 329 * t) * np.exp(-t * 34) * 0.22
    body = bp(wn(len(t)), 1100, 8500) * np.exp(-t * 13) * 0.95
    crack = hp(wn(len(t)), 3500) * np.exp(-t * 70) * 0.5
    return np.tanh(1.6 * (tone + body + crack)) * 0.8


def hat(open_=False):
    t = tt(0.55 if open_ else 0.08)
    return hp(wn(len(t)), 7500, 4) * np.exp(-t * (8 if open_ else 65)) * 0.55


def crash():
    t = tt(2.6); x = hp(wn(len(t)), 4200) * np.exp(-t * 1.5)
    ring = sum(np.sin(2 * np.pi * f * t + R.random() * 6) for f in (3140, 4530, 5870, 7210)) * 0.05 * np.exp(-t * 2.2)
    return (x + ring) * 0.5


def swell(d=1.6):
    c = crash()[: int(d * SR)][::-1]
    return c * np.linspace(0, 1, len(c)) ** 2


drums = bus()
K, S, HC, HO, CR = kick(), snare(), hat(), hat(True), crash()
for bar in range(44):
    p = part(bar)
    if p in ("groove", "lift"):
        for s, v in ((0, 1.0), (7, 0.62), (10, 0.9)):
            place(drums, K, st(bar, s) + hum(), v)
        if bar % 4 == 3:
            place(drums, K, st(bar, 14) + hum(), 0.5)
        for s in (4, 12):
            place(drums, S, st(bar, s) + hum(), 0.92, 0.05)
        if bar % 2:
            place(drums, S, st(bar, 15) + hum(), 0.2, 0.05)
        for s in range(16):
            place(drums, HC, st(bar, s) + hum(), (0.5 if s % 4 == 0 else 0.4) if s % 2 == 0 else 0.15, 0.22)
        if bar % 2 == 0:
            place(drums, HO, st(bar, 14), 0.28, 0.25)
    elif p == "halftime":
        place(drums, K, st(bar, 0), 1.0); place(drums, K, st(bar, 11), 0.6); place(drums, S, st(bar, 8), 1.0, 0.05)
        for s in range(0, 16, 2):
            place(drums, HC, st(bar, s) + hum(), 0.3, 0.22)
    elif p == "breakdown":
        if bar < 19:
            place(drums, K, st(bar, 0), 0.8)
        else:
            for s in range(16):
                place(drums, S, st(bar, s), 0.15 + 0.6 * s / 15, 0.05)
            for s in range(12, 16):
                place(drums, S, st(bar, s) + STEP / 2, 0.4 + 0.1 * (s - 12), 0.05)
    elif p == "intro" and bar == 2:
        for s in range(8, 16):
            place(drums, S, st(bar, s), 0.1 + 0.5 * (s - 8) / 7, 0.05)
for b in (3, 20, 41):
    place(drums, CR, b * BAR, 0.8, -0.2); place(drums, swell(), b * BAR - 1.6, 0.5, 0.2)
for b in (7, 13, 26, 32, 38):
    place(drums, CR, b * BAR, 0.4, 0.3)

# ------------------------------------------------------------------ bass
def bassnote(f, d, v):
    t = tt(d + 0.08)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    env = np.minimum(1, t / 0.006) * np.where(t < d, 1, np.exp(-(t - d) * 40)) * np.exp(-t * 0.8)
    return np.tanh(1.4 * x * env) * v


bass = bus()
for bar in range(44):
    p = part(bar); f = midi(ROOT[chord_idx(bar)])
    if p in ("groove", "lift", "halftime"):
        pat = ((0, 10, 1.0), (11, 4, 0.7)) if p == "halftime" else ((0, 6, 1.0), (7, 2, 0.7), (10, 5, 0.85))
        for s, d, v in pat:
            place(bass, bassnote(f, d * STEP, v), st(bar, s))
bass = lp(bass, 320)

# ------------------------------------------------------------------ keys, bells, pads
def rhodes(f, d, v):
    t = tt(d + 1.3); I = 1.7 * np.exp(-t * 4) + 0.22
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * t)) + np.sin(2 * np.pi * f * 14.03 * t) * np.exp(-t * 28) * 0.07
    env = np.minimum(1, t / 0.004) * np.exp(-t * 1.0) * np.where(t < d, 1, np.exp(-(t - d) * 5))
    return y * env * v


keys = bus()
for bar in range(44):
    ch, p = CH[chord_idx(bar)], part(bar)
    for k, n in enumerate(ch):
        pan = -0.35 + 0.7 * k / (len(ch) - 1)
        place(keys, rhodes(midi(n), 1.9 * BEAT, 0.16), st(bar, 0) + k * 0.011, 1, pan)
        if p not in ("intro", "breakdown"):
            place(keys, rhodes(midi(n), 0.9 * BEAT, 0.09), st(bar, 10) + k * 0.009, 1, pan)
for k, n in enumerate(CH[0]):  # the button under the end card
    place(keys, rhodes(midi(n), 3.5, 0.14), END + 0.3 + k * 0.03, 1, -0.3 + 0.15 * k)
dark = lp(keys, 700)
o = np.clip((X - 7.4) / 0.6, 0, 1)
b0, b1 = 17 * BAR, 20 * BAR
o = np.where((X > b0) & (X < b1), 0.4 + 0.6 * np.clip((X - (b1 - 1.2)) / 1.2, 0, 1), o)
o = np.where(X > END, 0.55, o)
keys = dark * (1 - o[:, None]) + keys * o[:, None]


def bell(f, v):
    t = tt(1.6)
    return np.sin(2 * np.pi * f * t + 1.2 * np.exp(-t * 6) * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 3.2) * np.minimum(1, t / 0.002) * v


bells = bus()
MEL = [(0, 76), (3, 79), (6, 81), (10, 84), (16, 79), (19, 76), (22, 74), (26, 76)]
for bar in range(20, 38, 2):
    for s, n in MEL:
        place(bells, bell(midi(n), 0.13), bar * BAR + s * STEP + ((SWING - 0.5) * 2 * STEP if s % 2 else 0), 1, 0.3 if s % 4 else -0.3)
d = int(0.75 * BEAT * SR); echo = np.zeros_like(bells); echo[d:] = bells[:-d] * 0.35; bells += echo[:, ::-1]


def pad(notes, dur):
    t = tt(dur + 1.0); y = np.zeros(len(t))
    for n in notes:
        for det in (-0.08, 0.0, 0.08):
            for h in range(1, 7):
                y += np.sin(2 * np.pi * midi(n + det) * h * t + R.random() * 6) / h
    return y * np.minimum(1, t / 0.9) * np.where(t < dur, 1, np.exp(-(t - dur) * 3))


pads = bus()
for bar in list(range(0, 3)) + list(range(17, 20)):
    place(pads, pad([n - 12 for n in CH[chord_idx(bar)][:3]], BAR), bar * BAR, 1, 0)
pads = lp(pads, 1400)

# ------------------------------------------------------------------ texture
cr = np.zeros(N); idx = R.integers(0, N, int(DUR * 22)); cr[idx] = wn(len(idx)) * R.uniform(0.05, 1, len(idx)) ** 3
cr = hp(cr, 1200); hiss = hp(wn(N), 4000) * 0.006
vinyl = np.stack([cr + hiss, np.roll(cr, 37) + hiss], 1)
amb = lp(np.stack([wn(N), wn(N)], 1), 260) * (0.25 + 0.75 * np.clip(1 - (X - 8) / 2, 0, 1) + 0.4 * ((X > b0) & (X < b1)))[:, None]

# ------------------------------------------------------------------ foley
def env_ar(n, a, r):
    t = np.arange(n) / SR; d = n / SR
    return np.clip(t / a, 0, 1) * np.clip((d - t) / r, 0, 1)


def s_spray(d):
    n = int((d + 0.15) * SR); t = np.arange(n) / SR
    fl = np.clip(1 + 0.14 * np.sin(2 * np.pi * (7 + R.random() * 5) * t) + lp(wn(n), 10) * 8, 0.3, 1.8)
    return bp(wn(n), 2400, 12000) * env_ar(n, 0.02, 0.12) * fl * (1 + 1.1 * np.exp(-t * 16)) * 0.2


def s_rattle():
    out = np.zeros(int(0.55 * SR))
    for k in range(5):
        i = max(0, int((k * 0.085 + R.normal(0, 0.006)) * SR)); t = tt(0.06)
        ping = sum(np.sin(2 * np.pi * f * (1 + R.normal(0, 0.02)) * t) for f in (3100, 4700, 6900)) * np.exp(-t * 95) * 0.3
        seg = (ping + hp(wn(len(t)), 2000) * np.exp(-t * 220) * 0.5 + bp(wn(len(t)), 500, 1600) * np.exp(-t * 45) * 0.35) * (0.7 + 0.3 * R.random())
        out[i:i + len(seg)] += seg[: len(out) - i]
    return out * 0.45


def s_stamp():
    t = tt(0.35)
    x = np.sin(2 * np.pi * np.cumsum(55 + 40 * np.exp(-t * 30)) / SR) * np.exp(-t * 16) + lp(wn(len(t)), 400) * np.exp(-t * 22) * 2.5 + bp(wn(len(t)), 900, 4500) * np.exp(-t * 60) * 0.8
    return np.tanh(1.5 * x) * 0.8


def s_slap(soft=False):
    t = tt(0.25)
    return (bp(wn(len(t)), 700, 5200) * np.exp(-t * 48) + np.sin(2 * np.pi * 120 * t) * np.exp(-t * 30) * 0.6) * (0.45 if soft else 0.75)


def s_peel():
    t = tt(0.35); crackle = (R.random(len(t)) < 0.02) * wn(len(t)) * 3
    return bp(wn(len(t)) + crackle, 1400, 7000) * np.sin(np.pi * t / 0.35) ** 2 * 0.25


def s_whoosh(d):
    n = int(d * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for k, (lo, hi) in enumerate(((150, 600), (400, 1600), (1200, 4000), (3000, 9000))):
        out += bp(wn(n), lo, hi) * np.exp(-((t / d - (k + 1) / 5) ** 2) / 0.02)
    return out * 0.35


def s_scratch():
    t = tt(0.9); src = sum(np.sin(2 * np.pi * 170 * h * t) / h for h in range(1, 14))
    src = bp(src, 500, 1400) * 2 + bp(src, 1600, 2800)
    tau = tt(0.4); pos = 0.18 * np.abs(np.sin(2 * np.pi * tau / 0.2)) * SR
    speed = np.clip(np.abs(np.gradient(pos)), 0, 1.5)
    return hp(np.interp(pos, np.arange(len(src)), src) * speed, 300) * 0.25


def s_roller(d):
    n = int((d + 0.1) * SR); t = np.arange(n) / SR
    x = lp(wn(n), 900) * (0.6 + 0.4 * np.sin(2 * np.pi * 6 * t) ** 2) * 3 + hp((R.random(n) < 0.004) * wn(n) * 0.6, 1500)
    return x * env_ar(n, 0.04, 0.08) * 0.35


def s_marker(d):
    n = int((d + 0.05) * SR); t = np.arange(n) / SR
    strokes = 0.5 + 0.5 * np.sin(2 * np.pi * (3.5 + R.random() * 2) * t + R.random() * 6) ** 2
    squeak = np.sin(2 * np.pi * np.cumsum(2400 + 300 * np.sin(2 * np.pi * 5 * t)) / SR) * 0.08
    return (bp(wn(n), 1800, 7000) * 0.12 + squeak * 0.4) * strokes * env_ar(n, 0.02, 0.05)


def s_paste(d):
    n = int((d + 0.2) * SR); t = np.arange(n) / SR
    return lp(wn(n), 1600) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 2.2 * t))) * env_ar(n, 0.05, 0.15) * 0.8


def s_print(d):
    t = tt(d); gate = (np.sin(2 * np.pi * t / 0.3) > -0.3).astype(float)
    return bp(np.sign(np.sin(2 * np.pi * 118 * t)), 900, 3200) * gate * 0.07


def s_tick():
    t = tt(0.03)
    return (np.sin(2 * np.pi * 2600 * t) * np.exp(-t * 260) * 0.5 + hp(wn(len(t)), 5000) * np.exp(-t * 500) * 0.3) * 0.3


def s_pop():
    t = tt(0.12)
    return np.sin(2 * np.pi * np.cumsum(300 + 1100 * (1 - np.exp(-t * 60))) / SR) * np.exp(-t * 32) * 0.5


def s_click():
    t = tt(0.06)
    return (hp(wn(len(t)), 2500) * np.exp(-t * 400) + np.sin(2 * np.pi * 90 * t) * np.exp(-t * 60) * 0.5) * 0.5


def s_buzz(d):
    t = tt(d); x = sum(np.sin(2 * np.pi * 120 * h * t) / h ** 1.2 for h in range(1, 12))
    gate = np.ones(len(t)); gate[(t > 0.1) & (t < 0.18)] = 0; gate[(t > 0.3) & (t < 0.34)] = 0
    return x * gate * (0.3 + 0.7 * np.exp(-t * 0.8)) * env_ar(len(t), 0.005, 1.5) * 0.02


sfx = bus(); last_rattle = -9.0
for c in sorted(CUES, key=lambda c: c["t"]):
    ty, t, pan = c["type"], c["t"], c.get("pan", 0)
    if ty == "rattle":
        if t - last_rattle > 1.1:
            place(sfx, s_rattle(), t, 0.8, pan); last_rattle = t
        continue
    sig = {
        "spray": lambda: s_spray(c["dur"]), "stamp": s_stamp, "slap": lambda: s_slap(c.get("soft")), "peel": s_peel,
        "whoosh": lambda: s_whoosh(c["dur"]), "scratch": s_scratch, "roller": lambda: s_roller(c["dur"]),
        "marker": lambda: s_marker(c["dur"]), "paste": lambda: s_paste(c["dur"]), "print": lambda: s_print(c["dur"]),
        "tick": s_tick, "pop": s_pop, "click": s_click, "buzz": lambda: s_buzz(c["dur"]),
    }[ty]()
    place(sfx, sig, t, 1.0, 0 if ty in ("whoosh", "scratch", "click", "buzz") else pan)

# ------------------------------------------------------------------ mix
def rms_db(x):
    m = np.abs(x).max(1) > 1e-4
    return 20 * np.log10(np.sqrt((x[m] ** 2).mean()) + 1e-12) if m.any() else -120.0


def level(x, target): return x * 10 ** ((target - rms_db(x)) / 20)


drums, bass, keys = level(drums, -17), level(bass, -21), level(keys, -23)
bells, pads, vinyl, amb, sfx = level(bells, -31), level(pads, -30), level(vinyl, -42), level(amb, -34), level(sfx, -24)


def reverb(x, secs=1.6, decay=3.0):
    t = tt(secs); ir = lp(np.stack([wn(len(t)), wn(len(t))], 1) * np.exp(-t * decay)[:, None], 5000)
    ir /= np.sqrt((ir ** 2).sum(0))
    return np.stack([fftconvolve(x[:, ch], ir[:, ch])[: len(x)] for ch in range(2)], 1)


music = drums + bass + keys + bells + pads
music += reverb(drums * 0.12 + keys * 0.45 + bells * 0.55) * 0.35

# Tape stop into the end card: the whole track winds down in 0.9 s.
i0, n = int(END * SR), int(0.9 * SR)
pos = i0 + np.cumsum((1 - np.arange(n) / n) ** 1.6)
tail = np.stack([np.interp(pos, np.arange(N), music[:, ch]) for ch in range(2)], 1) * np.linspace(1, 0.4, n)[:, None]
button = music[i0 + n:].copy() * (X[i0 + n:] > END + 0.3)[:, None]  # keep the end-card chord that starts later
music[i0:i0 + n] = tail
music[i0 + n:] = 0
music[i0 + n:] += level(button, -26) if np.abs(button).max() > 0 else 0

mix = music + vinyl + amb + sfx + reverb(sfx * 0.25) * 0.25
mix = hp(mix, 25)
mix = np.tanh(mix / np.abs(mix).max() * 1.35) / np.tanh(1.35)
fade = np.clip((DUR - X) / 0.4, 0, 1) * np.clip(X / 0.2, 0, 1)
mix = mix * fade[:, None] * 10 ** (-1 / 20)

out = (np.clip(mix, -1, 1) * 32767).astype("<i2")
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out[: int(DUR * SR)].tobytes())
print(f"wrote {sys.argv[2]}: {DUR:.1f}s, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS, rms {rms_db(mix):.1f} dBFS")
