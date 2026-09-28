#!/usr/bin/env python3
"""
Run It: 120 BPM E-minor darksynth (Em9, Cmaj9, G6, D6/9) with a side-chained 16th bassline, and the
session's own foley: every keystroke, every enter, the glitch on each clear, CRT power on and off.

    python3 pitch/run-it/soundtrack.py pitch/out/run-it/cues.json pitch/out/run-it/soundtrack.wav
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import numpy as np
from audio import Mix, SR, lp, hp, bp, tt, midi, level, env_ar, load_cues

ARR, CUES = load_cues(sys.argv[1])
BPM = ARR["bpm"]; BEAT = 60 / BPM; BAR = 4 * BEAT; STEP = BEAT / 4; D = ARR["duration"]
m = Mix(D, seed=31)
CH = [[52, 55, 59, 62, 66], [48, 52, 55, 59, 62], [43, 50, 55, 59, 64], [50, 54, 57, 59, 64]]
ROOT = [28, 36, 31, 38]
CUT = 117.6


def sect(t):
    if t < 8: return "intro"
    if t < 38: return "A"
    if t < 50: return "break"
    if t < 78: return "B"
    if t < 104: return "drive"
    if t < CUT: return "final"
    return "off"


def saw(f, d, v, cutoff=1800, harm=10):
    t = tt(d + 0.05); y = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, harm + 1) if f * k < cutoff * 2.5)
    return y * env_ar(len(t), 0.003, 0.04) * v


kicks = []
for bar in range(60):
    t0 = bar * BAR; s = sect(t0 + 0.01); i = bar % 4; ch = CH[i]
    if s == "off": continue
    lv = {"intro": 0.5, "A": 0.7, "break": 0.9, "B": 0.75, "drive": 0.85, "final": 1.0}[s]
    m.place("pad", m.pad(ch, BAR, lv, attack=0.3 if s != "break" else 0.8, release=1.0, bright=7, detune=0.12), t0)
    if s in ("A", "B", "drive", "final"):
        for b in range(4):
            if s == "final" and b % 2: continue
            m.place("drums", m.kick(1.0, hi=150, lo=46, decay=7), t0 + b * BEAT); kicks.append(t0 + b * BEAT)
        for b in (1, 3):
            if t0 >= 12 or s != "A": m.place("drums", m.snare(0.8, tone=200), t0 + b * BEAT, 1, 0.05)
        for k in range(8): m.place("drums", m.hat(0.35 if k % 2 else 0.15, open_=(s == "drive" and k % 4 == 2)), t0 + k * BEAT / 2, 1, 0.25)
        n16 = 16 if s != "final" else 8
        for k in range(n16):
            f = midi(ROOT[i] + (12 if k % 4 == 2 else 0)); step = BAR / n16
            m.place("bass", saw(f, step * 0.85, 0.5, cutoff=900 if s == "A" else 1400), t0 + k * step)
    if s == "break":
        m.place("bass", saw(midi(ROOT[i]), BAR * 0.95, 0.5, cutoff=500), t0)
        for k in range(0, 8, 2): m.place("drums", m.hat(0.12), t0 + k * BEAT / 2, 1, 0.2)
    if s in ("B", "drive", "final"):
        seq = [ch[0] + 12, ch[2] + 12, ch[4] + 12, ch[2] + 24, ch[3] + 12, ch[2] + 12, ch[1] + 12, ch[4]]
        for k in range(16):
            n = seq[k % 8] + (12 if s == "drive" and k >= 8 else 0)
            m.place("arp", saw(midi(n), STEP * 0.7, 0.14, cutoff=4000, harm=6), t0 + k * STEP, 1, 0.45 if k % 2 else -0.45)
    if s == "intro":
        for k in range(4): m.place("arp", m.fm(midi(ch[k % 4] + 12), 0.4, 0.08, ratio=2.0, index=0.8, adecay=2.5, tail=1.0), t0 + k * BEAT, 1, -0.3 + 0.2 * k)
for t in (8.0, 50.0, 78.0, 104.0): m.place("drums", m.crash(0.6), t, 1, -0.2)
for t in (8.0, 38.0, 50.0, 78.0): m.place("drums", m.swell(1.2, 0.35), t - 1.2)

# ------------------------------------------------------------------ side-chain pump
X = m.X; duck = np.ones(m.N)
for k in kicks:
    i = int(k * SR); n = min(int(0.45 * SR), m.N - i)
    if n > 0: duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.6 * np.exp(-np.arange(n) / SR * 9))

# ------------------------------------------------------------------ the session's foley
def keyclick():
    t = tt(0.045); f = 2600 + 900 * m.R.random()
    y = hp(m.wn(len(t)), 1800) * np.exp(-t * 320) * 0.7 + np.sin(2 * np.pi * f * t) * np.exp(-t * 260) * 0.15 + np.sin(2 * np.pi * 180 * t) * np.exp(-t * 90) * 0.25
    return y * (0.55 + 0.45 * m.R.random())


for c in CUES:
    ty, t = c["type"], c["t"]
    if ty == "key": m.place("keys", keyclick(), t, 1, m.R.uniform(-0.15, 0.15))
    elif ty == "enter": m.place("keys", keyclick() * 1.6, t); m.place("keys", m.thunk(0.35), t)
    elif ty == "glitch":
        n = int(0.28 * SR); x = m.wn(n); crushed = np.repeat(x[::40], 40)[:n] * env_ar(n, 0.005, 0.2)
        sweep = np.sin(2 * np.pi * np.cumsum(2400 * np.exp(-np.arange(n) / SR * 9)) / SR) * env_ar(n, 0.005, 0.25) * 0.25
        m.place("sfx", crushed * 0.35 + sweep, t)
    elif ty == "big": m.place("sfx", m.boom(0.7, f0=110, f1=40, d=1.6), t); m.place("sfx", m.whoosh(0.4, 0.4)[::-1], t - 0.35)
    elif ty == "pass": m.place("sfx", m.blip(1320, 0.05, 0.45), t, 1, 0.2)
    elif ty == "blip": m.place("sfx", m.blip(990, 0.06, 0.5), t, 1, -0.2)
    elif ty == "beep": m.place("sfx", m.blip(880, 0.12, 0.8), t); m.place("sfx", m.blip(660, 0.14, 0.8), t + 0.14)
    elif ty == "crtOn":
        tq = tt(1.6); whine = np.sin(2 * np.pi * 9000 * tq) * np.exp(-tq * 2.5) * 0.02
        m.place("sfx", m.thunk(0.9), t); m.place("sfx", whine + hp(m.wn(len(tq)), 3000) * np.exp(-tq * 5) * 0.12, t)
    elif ty == "crtOff":
        tq = tt(1.1); f = 9000 * np.exp(-tq * 4) + 60
        m.place("sfx", np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tq * 3) * 0.05 + m.thunk(0.6)[: len(tq)] if len(m.thunk(0.6)) >= len(tq) else np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tq * 3) * 0.05, t)
        m.place("sfx", m.thunk(0.7), t + 0.85)

b = m.buses
pad = level(lp(b["pad"], 2600), -26) * duck[:, None]
bass = level(lp(b["bass"], 1200), -22) * duck[:, None]
arp, drums, keys, sfx = level(b["arp"], -29), level(b["drums"], -19), level(b["keys"], -27), level(b["sfx"], -25)
music = pad + bass + arp + drums
music += m.reverb(pad * 0.2 + arp * 0.5 + drums * 0.12, secs=2.0, decay=2.4) * 0.4
music = m.delay(music * 0 + arp * 0.0, 0.375) * 0 + music
cut = np.where(X < CUT, 1.0, np.clip(1 - (X - CUT) / 0.25, 0, 1))
music *= cut[:, None]
mix = music + keys + sfx + m.reverb(sfx * 0.25 + keys * 0.08, secs=1.2) * 0.25 + m.vinyl(3, -56)
m.write(m.master(mix, fade_out=0.3), sys.argv[2])
