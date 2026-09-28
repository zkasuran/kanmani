#!/usr/bin/env python3
"""
The Plumbing: 96 BPM, clockwork and marimba over a warm groove (Cmaj9, Am9, Fmaj9, G6), with the
drawing's own foley: pen on paper, typewriter lettering, valves, fluid, the meter, the printer, stamps.

    python3 pitch/plumbing/soundtrack.py pitch/out/plumbing/cues.json pitch/out/plumbing/soundtrack.wav
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import numpy as np
from audio import Mix, SR, lp, hp, bp, tt, midi, level, env_ar, load_cues

ARR, CUES = load_cues(sys.argv[1])
BPM = ARR["bpm"]; BEAT = 60 / BPM; BAR = 4 * BEAT; STEP = BEAT / 4; D = ARR["duration"]
m = Mix(D, seed=21)
CH = [[48, 52, 55, 59, 62], [45, 48, 52, 55, 59], [41, 45, 48, 52, 55], [43, 47, 50, 52, 55]]
ROOT = [36, 33, 29, 31]
DARK = [[45, 48, 52, 55], [41, 45, 48, 52], [38, 41, 45, 48], [40, 44, 47, 50]]


def sect(bar):
    if bar < 4: return "title"
    if bar < 12: return "fig1"
    if bar < 17: return "fig2"
    if bar < 34: return "fig3"
    if bar < 42: return "fig4"
    return "close"


def st(bar, s): return bar * BAR + s * STEP + (0.018 if s % 2 else 0)


def marimba(f, v):
    t = tt(0.9); y = np.sin(2 * np.pi * f * t) * np.exp(-t * 7) + 0.35 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 22) + 0.1 * np.sin(2 * np.pi * f * 10 * t) * np.exp(-t * 40)
    return y * np.minimum(1, t / 0.002) * v


def wood(v, f=1800):
    t = tt(0.08); return (np.sin(2 * np.pi * f * t) * np.exp(-t * 90) + bp(m.wn(len(t)), 1500, 4000) * np.exp(-t * 200) * 0.3) * v


def shaker(v):
    t = tt(0.07); return bp(m.wn(len(t)), 5000, 12000) * np.sin(np.pi * np.clip(t / 0.07, 0, 1)) ** 2 * v


PAT = [0, 7, 9, 12, 7, 4, 7, 11]
for bar in range(48):
    s = sect(bar); i = bar % 4; ch = DARK[i] if s == "fig2" else CH[i]; t0 = bar * BAR
    m.place("pad", m.pad(ch, BAR, 0.6 if s in ("title", "fig2") else 0.8, attack=0.5, release=1.2, bright=4), t0)
    if s != "title":
        for k, (s16, d) in enumerate(((0, 5), (6, 2), (10, 4)) if s != "fig2" else ((0, 14),)):
            m.place("bass", m.sub(midi(ROOT[i] if s != "fig2" else ch[0] - 12), d * STEP, 0.9), st(bar, s16))
    arp = [ch[0] + 12 + p for p in PAT] if s != "fig2" else []
    for k, n in enumerate(arp):
        if s == "title" and bar < 2 and k % 2: continue
        m.place("mar", marimba(midi(n + (12 if s in ("fig3", "close") and k % 4 == 3 else 0)), 0.14), st(bar, k * 2), 1, -0.35 if k % 2 else 0.35)
    if s in ("fig1", "fig3", "fig4", "close"):
        for b in (0, 8): m.place("drums", m.kick(0.9), st(bar, b))
        if bar % 2: m.place("drums", m.kick(0.5), st(bar, 14))
        for b in (4, 12): m.place("drums", m.clap(0.7), st(bar, b), 1, 0.05)
        for k in range(16): m.place("drums", shaker(0.35 if k % 2 else 0.2), st(bar, k), 1, 0.3)
        for k in (0, 3, 6, 10, 12): m.place("drums", wood(0.22), st(bar, k), 1, -0.3)
    if s == "fig2":
        m.place("drums", m.kick(0.6, hi=70, lo=40), st(bar, 0))
        for k in range(0, 16, 4): m.place("drums", wood(0.16, 1200), st(bar, k), 1, -0.2)
    if s in ("fig3", "close") and bar % 2 == 0:
        mel = [(0, 76), (3, 79), (6, 81), (8, 84), (12, 83), (14, 79)]
        for s16, n in mel: m.place("lead", m.fm(midi(n), 0.18, 0.1, ratio=2.0, index=0.8, idecay=6, adecay=3, tail=0.6), st(bar, s16), 1, 0.2)
for b in (4, 17, 34, 42): m.place("drums", m.crash(0.55), b * BAR, 1, -0.2)
m.place("drums", m.swell(1.6, 0.4), 17 * BAR - 1.6)

# ------------------------------------------------------------------ the drawing's foley
def pen(d):
    n = int(d * SR); t = np.arange(n) / SR
    strokes = 0.35 + 0.65 * np.abs(np.sin(2 * np.pi * (2.2 + m.R.random()) * t + m.R.random() * 6)) ** 0.6
    return bp(m.wn(n), 2500, 9000) * strokes * env_ar(n, 0.03, 0.08) * 0.1


def keys(d, rate=14):
    y = np.zeros(int((d + 0.2) * SR)); tq = tt(0.03); k = 0.0
    while k < d:
        i = int(k * SR); c = (hp(m.wn(len(tq)), 2000) * np.exp(-tq * 300) + np.sin(2 * np.pi * 900 * tq) * np.exp(-tq * 200) * 0.4) * (0.5 + 0.5 * m.R.random())
        y[i:i + len(c)] += c[: len(y) - i]; k += (1 / rate) * (0.6 + 0.8 * m.R.random())
    return y * 0.35


for c in CUES:
    ty, t = c["type"], c["t"]; d = c.get("dur", 0.5)
    if ty == "unroll": m.place("sfx", m.whoosh(1.2, 0.6), t); m.place("sfx", lp(m.wn(int(0.9 * SR)), 1500) * env_ar(int(0.9 * SR), 0.1, 0.6) * 0.3, t)
    elif ty == "pen": m.place("sfx", pen(d), t, 1, m.R.uniform(-0.3, 0.3))
    elif ty == "type": m.place("sfx", keys(d), t)
    elif ty == "title": m.place("sfx", m.thunk(0.8), t); m.place("sfx", m.shimmer([72, 76, 79, 83], 0.6, 2.0), t + 0.1)
    elif ty == "tick": m.place("sfx", m.tick(0.14 if c.get("soft") else 0.3, 2200 if c.get("soft") else 3000), t, 1, 0.2)
    elif ty == "valve":
        tq = tt(0.35); squeak = np.sin(2 * np.pi * np.cumsum(700 + 500 * np.sin(np.pi * tq / 0.35)) / SR) * env_ar(len(tq), 0.02, 0.1) * 0.08
        m.place("sfx", squeak, t); m.place("sfx", m.thunk(0.3), t)
    elif ty == "fluid":
        n = int(d * SR); y = lp(m.wn(n), 700) * 0.5 * env_ar(n, 0.3, 0.5)
        for k in range(int(d * 10)):
            i = int(m.R.random() * (n - 4000)); q = int((0.02 + m.R.random() * 0.04) * SR); tq = np.arange(q) / SR
            y[i:i + q] += np.sin(2 * np.pi * np.cumsum((300 + m.R.random() * 700) * (1 + tq * 14)) / SR) * np.exp(-tq * 70) * 0.35
        m.place("sfx", y * 0.5, t)
    elif ty == "meter": m.place("sfx", m.tick(0.16, 1500), t, 1, -0.1)
    elif ty == "print":
        tq = tt(d); gate = (np.sin(2 * np.pi * tq / 0.18) > -0.2).astype(float)
        m.place("sfx", bp(np.sign(np.sin(2 * np.pi * 110 * tq)), 900, 3200) * gate * 0.07, t)
    elif ty == "hiss":
        n = int(d * SR); m.place("sfx", bp(m.wn(n), 2500, 10000) * env_ar(n, 0.02, 0.6) * 0.25, t)
    elif ty == "lamp": m.place("sfx", m.click(0.4), t); m.place("sfx", m.blip(1760, 0.06, 0.6), t + 0.04, 1, 0.2)
    elif ty == "stamp": m.place("sfx", m.thunk(1.0), t)
    elif ty == "shut":
        m.place("sfx", m.thunk(0.7), t); tq = tt(1.2); m.place("sfx", np.sin(2 * np.pi * np.cumsum(80 + 400 * np.exp(-tq * 3)) / SR) * np.exp(-tq * 2.5) * 0.2, t + 0.1)
    elif ty == "swell": m.place("sfx", m.riser(1.6, 0.4), t)
    elif ty == "resolve": m.place("sfx", m.shimmer([72, 76, 79, 83, 86], 1.0, 3.0), t)

b = m.buses
pad, bass, mar, drums, lead, sfx = level(lp(b["pad"], 2200), -27), level(lp(b["bass"], 240), -24), level(b["mar"], -25), level(b["drums"], -20), level(b["lead"], -30), level(b["sfx"], -23)
music = pad + bass + mar + drums + lead
music += m.reverb(mar * 0.4 + lead * 0.6 + pad * 0.2 + drums * 0.08, secs=1.8, decay=3.0) * 0.4
X = m.X; out_end = np.clip((D - 1.5 - X) / 1.0, 0.25, 1)
mix = music * out_end[:, None] + sfx + m.reverb(sfx * 0.2, secs=1.2) * 0.2 + m.vinyl(4, -54)
m.write(m.master(mix, fade_out=1.2), sys.argv[2])
