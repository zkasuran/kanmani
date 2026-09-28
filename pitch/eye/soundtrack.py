#!/usr/bin/env python3
"""
The Eye: a cinematic score at 80 BPM in D minor (Dm9, Bbmaj9, Fmaj9, C6/9), resolving to D major
under "It becomes a price". A heartbeat pulse, glass arpeggios that read the claims, and the chain's
own 266 ms pulse near the end. Every sound is synthesised.

    python3 pitch/eye/soundtrack.py pitch/out/eye/cues.json pitch/out/eye/soundtrack.wav
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import numpy as np
from audio import Mix, SR, lp, hp, bp, tt, midi, level, env_ar, load_cues

ARR, CUES = load_cues(sys.argv[1])
BPM = ARR["bpm"]; BEAT = 60 / BPM; BAR = 4 * BEAT; D = ARR["duration"]
m = Mix(D, seed=11)
CH = [[50, 53, 57, 60, 64], [46, 50, 53, 57, 60], [53, 57, 60, 64, 67], [48, 52, 55, 57, 62]]
ROOT = [38, 34, 41, 36]
DMAJ = [50, 54, 57, 61, 64]


def sect(bar):
    if bar < 4: return "intro"
    if bar < 9: return "pulse"
    if bar < 14: return "scan"
    if bar < 17: return "blind"
    if bar < 18: return "built"
    if bar < 33: return "anatomy"
    if bar < 37: return "mainnet"
    return "close"


# ------------------------------------------------------------------ harmony
for bar in range(40):
    s = sect(bar); ch = CH[bar % 4]; t0 = bar * BAR
    if s == "close" and bar >= 38: ch = DMAJ
    lvl = {"intro": 0.8, "pulse": 0.9, "scan": 0.9, "blind": 0.6, "built": 1.2, "anatomy": 1.0, "mainnet": 0.9, "close": 1.1}[s]
    m.place("pad", m.pad(ch, BAR, lvl, attack=1.4 if bar else 3.0, release=2.4, bright=5), t0)
    if s not in ("intro", "blind"):
        m.place("bass", m.sub(midi(ROOT[bar % 4] if not (s == "close" and bar >= 38) else 38), BAR * 0.95, 0.9), t0)
    if s in ("pulse", "anatomy", "mainnet", "built"):
        for k, n in enumerate(ch[1:4] if s != "anatomy" else ch):
            m.place("keys", m.fm(midi(n + 12), 1.2, 0.12, ratio=1.0, index=1.2, adecay=1.2), t0 + k * 0.09 + (2 * BEAT if k % 2 else 0), 1, -0.3 + 0.2 * k)
    if s in ("scan", "anatomy"):
        seq = [ch[0] + 12, ch[2] + 12, ch[3] + 12, ch[4] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 12, ch[2] + 12]
        for k in range(16 if s == "anatomy" else 8):
            n = seq[k % 8] + (12 if (k // 8) and s == "anatomy" else 0)
            step = BEAT / (4 if s == "anatomy" else 2)
            m.place("arp", m.fm(midi(n), 0.08, 0.09, ratio=3.0, index=0.9, idecay=9, adecay=5, tail=0.6), t0 + k * step, 1, 0.4 if k % 2 else -0.4)

# ------------------------------------------------------------------ the heartbeat and the groove
for bar in range(40):
    s = sect(bar); t0 = bar * BAR
    if s in ("pulse", "scan", "anatomy", "mainnet"):
        m.place("drums", m.kick(0.85, hi=90, lo=40, decay=6.5), t0)
        m.place("drums", m.kick(0.55, hi=80, lo=42, decay=7.5), t0 + 0.28)
    if s in ("anatomy",):
        m.place("drums", m.kick(0.6, hi=90, lo=40, decay=6.5), t0 + 2.5 * BEAT)
        for b in (1, 3): m.place("drums", m.clap(0.45), t0 + b * BEAT, 1, 0.1)
        for k in range(8): m.place("drums", m.hat(0.3 if k % 2 else 0.18), t0 + k * BEAT / 2, 1, 0.25)
    if s == "scan":
        for k in range(8): m.place("drums", m.hat(0.25), t0 + k * BEAT / 2, 1, 0.25)
    if s == "blind" and bar == 14: m.place("drums", m.kick(0.7, hi=70, lo=36, decay=4), t0)
for b in (4, 17, 18, 33): m.place("drums", m.crash(0.5 if b != 17 else 0.8), b * BAR, 1, -0.2)
m.place("drums", m.swell(1.8, 0.5), 18 * BAR - 1.8)

# ------------------------------------------------------------------ sound design from the film's cues
for c in CUES:
    ty, t = c["type"], c["t"]
    if ty == "bloom":
        m.place("sfx", m.shimmer([74, 77, 81, 84, 88], 1.0, 3.0), t); m.place("sfx", m.swell(2.0, 0.3), t - 0.5)
    elif ty == "whoosh":
        m.place("sfx", m.riser(c["dur"], 0.5), t); m.place("sfx", m.whoosh(c["dur"], 0.7), t)
    elif ty == "boom":
        m.place("sfx", m.boom(1.3 if c.get("big") else 0.9, f0=85, f1=28, d=3.5), t)
        if c.get("big"): m.place("sfx", m.shimmer([62, 69, 74, 77, 81], 1.2, 3.0), t + 0.05)
    elif ty == "tick":
        m.place("sfx", m.tick(0.12, 3400), t, 1, np.sin(t * 7) * 0.6)
    elif ty == "scan":
        n = int(c["dur"] * SR); x = m.wn(n); u = np.arange(n) / n
        y = sum(bp(x, f, f * 1.25) * np.exp(-((u - k / 4) ** 2) / 0.02) for k, f in enumerate((600, 1100, 1900, 3200)))
        m.place("sfx", y * env_ar(n, 0.3, 0.4) * 0.5, t)
    elif ty == "pingT":
        m.place("sfx", m.fm(midi(81), 0.05, 0.07, ratio=2.0, index=0.6, idecay=10, adecay=4, tail=0.8), t, 1, np.sin(t * 3) * 0.5)
    elif ty == "pingF":
        m.place("sfx", m.fm(midi(62), 0.04, 0.05, ratio=1.41, index=1.5, idecay=20, adecay=12, tail=0.3), t, 1, np.sin(t * 3) * 0.5)
    elif ty == "powerdown":
        tq = tt(1.4); f = 60 + 700 * np.exp(-tq * 3)
        m.place("sfx", (np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25 + lp(m.wn(len(tq)), 900) * 0.3) * np.exp(-tq * 2), t)
    elif ty == "blink":
        tq = tt(0.35); m.place("sfx", lp(m.wn(len(tq)), 300) * np.sin(np.pi * tq / 0.35) * 0.9, t)
    elif ty == "draw":
        n = int(c["dur"] * SR); u = np.arange(n) / n
        m.place("sfx", np.sin(2 * np.pi * np.cumsum(500 + 1500 * u) / SR) * 0.05 * env_ar(n, 0.4, 0.8) + bp(m.wn(n), 4000, 11000) * 0.06 * env_ar(n, 0.3, 0.8), t)
    elif ty == "chime":
        m.place("sfx", m.shimmer([81, 86, 88] if c.get("name") != "INTENTS" else [81, 86, 88, 93], 0.8, 2.0), t, 1, 0.15)
    elif ty == "fluid":
        n = int(c["dur"] * SR); y = np.zeros(n)
        for k in range(26):
            i = int(m.R.random() * (n - 5000)); d = int((0.03 + m.R.random() * 0.05) * SR); tq = np.arange(d) / SR
            f0 = 400 + m.R.random() * 900; y[i:i + d] += np.sin(2 * np.pi * np.cumsum(f0 * (1 + tq * 12)) / SR) * np.exp(-tq * 60) * 0.2
        m.place("sfx", y, t)
    elif ty == "focus":
        m.place("sfx", m.click(0.6), t); m.place("sfx", m.click(0.4), t + 0.12)
        tq = tt(0.5); m.place("sfx", np.sin(2 * np.pi * np.cumsum(900 + 2200 * tq) / SR) * np.exp(-tq * 6) * 0.08, t + 0.2)
    elif ty == "pulse":
        m.place("sfx", m.tick(0.16, 1900), t, 1, 0.3 if int(t / 0.266) % 2 else -0.3)
    elif ty == "form":
        m.place("sfx", m.whoosh(1.2, 0.5)[::-1], t - 0.9); m.place("sfx", m.pop(0.6), t + 1.3)
    elif ty == "resolve":
        m.place("sfx", m.shimmer([74, 78, 81, 85, 88], 1.3, 4.0), t); m.place("sfx", m.boom(0.5, f0=70, f1=36, d=3.0), t)

# ------------------------------------------------------------------ mix
b = m.buses
pad = lp(b["pad"], 2400)
X = m.X; dark = np.clip(1 - (X - 42) / 1.0, 0, 1) * (X > 42) * (X < 51)
pad = pad * (1 - 0.5 * dark[:, None]) + lp(pad, 600) * (0.5 * dark[:, None])
pad, bass, keys, arp, drums, sfx = level(pad, -24), level(b["bass"], -26), level(b["keys"], -28), level(b["arp"], -30), level(b["drums"], -21), level(b["sfx"], -25)
music = pad + lp(bass, 220) + keys + arp + drums
music += m.reverb(pad * 0.3 + keys * 0.6 + arp * 0.6 + drums * 0.15, secs=3.2, decay=1.8) * 0.45
hush = 1 - 0.75 * np.clip((X - 110.8) / 0.4, 0, 1) * np.clip((113.9 - X) / 0.4, 0, 1) * (X < 114.4)
music *= hush[:, None]
mix = music + sfx + m.reverb(sfx * 0.4, secs=2.8, decay=2.0) * 0.35 + m.vinyl(6, -52)
m.write(m.master(mix, fade_out=0.8), sys.argv[2])
