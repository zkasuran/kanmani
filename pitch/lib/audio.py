"""
Shared synthesis and mixing for the pitch films. No samples: every sound is generated, seeded.

    from audio import Mix
    m = Mix(duration=120, seed=7)
    m.place(m.bus('drums'), sound, t, gain, pan)
"""
import json
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000


def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, btype=kind, fs=SR, output="sos"), x, axis=0)


def lp(x, f, o=2): return filt(x, "lowpass", f, o)
def hp(x, f, o=2): return filt(x, "highpass", f, o)
def bp(x, lo, hi, o=2): return filt(x, "bandpass", [lo, hi], o)
def tt(d): return np.arange(int(max(d, 0) * SR)) / SR
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)


def env_ar(n, a, r):
    t = np.arange(n) / SR; d = n / SR
    return np.clip(t / max(a, 1e-4), 0, 1) * np.clip((d - t) / max(r, 1e-4), 0, 1)


def rms_db(x):
    m = np.abs(x).max(axis=-1) > 1e-4 if x.ndim > 1 else np.abs(x) > 1e-4
    return 20 * np.log10(np.sqrt((x[m] ** 2).mean()) + 1e-12) if m.any() else -120.0


def level(x, target_db):
    return x * 10 ** ((target_db - rms_db(x)) / 20) if np.abs(x).max() > 0 else x


class Mix:
    def __init__(self, duration, seed=1):
        self.D = duration; self.N = int(SR * (duration + 0.25)); self.R = np.random.default_rng(seed)
        self.X = np.arange(self.N) / SR; self.buses = {}

    def wn(self, n): return self.R.standard_normal(int(n))

    def bus(self, name):
        if name not in self.buses: self.buses[name] = np.zeros((self.N, 2))
        return self.buses[name]

    def place(self, b, sig, t, gain=1.0, pan=0.0):
        if isinstance(b, str): b = self.bus(b)
        i = int(round(t * SR))
        if sig.ndim == 1:
            a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
            sig = np.stack([sig * np.cos(a), sig * np.sin(a)], 1) * np.sqrt(2)
        if i < 0: sig, i = sig[-i:], 0
        if i >= self.N or len(sig) == 0: return
        j = min(self.N, i + len(sig)); b[i:j] += sig[: j - i] * gain

    def reverb(self, x, secs=2.2, decay=2.6, tone=5000):
        t = tt(secs); ir = np.stack([self.wn(len(t)), self.wn(len(t))], 1) * np.exp(-t * decay)[:, None]
        ir = lp(ir, tone); ir /= np.sqrt((ir ** 2).sum(0))
        return np.stack([fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)

    def delay(self, x, secs, fb=0.35, mix=0.35, pingpong=True):
        d = int(secs * SR); y = x.copy(); tap = x.copy()
        for k in range(1, 6):
            tap = np.roll(tap, d, axis=0); tap[:d] = 0; tap = tap * fb
            y += (tap[:, ::-1] if pingpong and k % 2 else tap) * mix / fb
        return y

    def master(self, mix, fade_in=0.2, fade_out=0.5, drive=1.3, ceiling_db=-1.0):
        mix = hp(mix, 25)
        mix = np.tanh(mix / (np.abs(mix).max() + 1e-9) * drive) / np.tanh(drive)
        f = np.clip((self.D - self.X) / fade_out, 0, 1) * np.clip(self.X / fade_in, 0, 1)
        return mix * f[:, None] * 10 ** (ceiling_db / 20)

    def write(self, mix, path):
        out = (np.clip(mix, -1, 1) * 32767).astype("<i2")[: int(self.D * SR)]
        with wave.open(path, "wb") as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
        print(f"wrote {path}: {self.D:.1f}s, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS, rms {rms_db(mix):.1f} dBFS")

    # ------------------------------------------------------------ instruments
    def fm(self, f, d, v, ratio=1.0, index=1.6, idecay=4.0, adecay=1.0, attack=0.004, release=5.0, tail=1.2):
        t = tt(d + tail); I = index * np.exp(-t * idecay) + 0.2
        y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * ratio * t))
        e = np.minimum(1, t / attack) * np.exp(-t * adecay) * np.where(t < d, 1, np.exp(-(t - d) * release))
        return y * e * v

    def pad(self, notes, d, v=1.0, attack=1.2, release=2.0, bright=6, detune=0.07):
        t = tt(d + release); y = np.zeros(len(t))
        for n in notes:
            for det in (-detune, 0, detune):
                ph = self.R.random() * 6.28
                for h in range(1, bright + 1): y += np.sin(2 * np.pi * midi(n + det) * h * t + ph * h) / h
        e = np.minimum(1, t / attack) * np.where(t < d, 1, np.exp(-(t - d) * 3 / release))
        return y * e * v / max(1, len(notes))

    def sub(self, f, d, v=1.0):
        t = tt(d + 0.3); e = np.minimum(1, t / 0.02) * np.where(t < d, 1, np.exp(-(t - d) * 10))
        return np.tanh(1.2 * (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(4 * np.pi * f * t)) * e) * v

    def kick(self, v=1.0, hi=120, lo=44, decay=5.2):
        t = tt(0.55); f = lo + hi * np.exp(-t * 32)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
        click = hp(self.wn(len(t)) * np.exp(-t * 320), 1800) * 0.3
        return np.tanh(2.4 * (body + click)) * 0.95 * v

    def snare(self, v=1.0, tone=182):
        t = tt(0.5)
        y = np.sin(2 * np.pi * tone * t) * np.exp(-t * 24) * 0.55 + bp(self.wn(len(t)), 1100, 8500) * np.exp(-t * 13) * 0.95 + hp(self.wn(len(t)), 3500) * np.exp(-t * 70) * 0.5
        return np.tanh(1.6 * y) * 0.8 * v

    def clap(self, v=1.0):
        t = tt(0.4); y = np.zeros(len(t))
        for k, off in enumerate((0, 0.011, 0.023, 0.034)):
            i = int(off * SR); seg = bp(self.wn(len(t) - i), 900, 5000) * np.exp(-np.arange(len(t) - i) / SR * (60 if k < 3 else 14))
            y[i:] += seg
        return y * 0.6 * v

    def hat(self, v=1.0, open_=False):
        t = tt(0.55 if open_ else 0.08)
        return hp(self.wn(len(t)), 7500, 4) * np.exp(-t * (8 if open_ else 65)) * 0.55 * v

    def crash(self, v=1.0):
        t = tt(2.6); x = hp(self.wn(len(t)), 4200) * np.exp(-t * 1.5)
        ring = sum(np.sin(2 * np.pi * f * t + self.R.random() * 6) for f in (3140, 4530, 5870, 7210)) * 0.05 * np.exp(-t * 2.2)
        return (x + ring) * 0.5 * v

    # ------------------------------------------------------------ designed sounds
    def boom(self, v=1.0, f0=90, f1=30, d=3.0):
        t = tt(d); f = f1 + (f0 - f1) * np.exp(-t * 3)
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.4) + lp(self.wn(len(t)), 200) * np.exp(-t * 4) * 0.8
        return np.tanh(1.8 * y) * v

    def riser(self, d=2.0, v=1.0):
        n = int(d * SR); t = np.arange(n) / SR; u = t / d
        y = np.zeros(n)
        for lo, hi in ((200, 900), (800, 3000), (2500, 9000)): y += bp(self.wn(n), lo, hi) * u ** 2
        tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * u ** 2) / SR) * 0.15 * u
        return (y * 0.4 + tone) * v

    def swell(self, d=1.6, v=1.0):
        return self.crash()[: int(d * SR)][::-1] * np.linspace(0, 1, int(d * SR)) ** 2 * v

    def whoosh(self, d=0.6, v=1.0):
        n = int(d * SR); t = np.arange(n) / SR; out = np.zeros(n)
        for k, (lo, hi) in enumerate(((150, 600), (400, 1600), (1200, 4000), (3000, 9000))):
            out += bp(self.wn(n), lo, hi) * np.exp(-((t / d - (k + 1) / 5) ** 2) / 0.02)
        return out * 0.35 * v

    def shimmer(self, notes, v=1.0, d=2.5):
        y = None
        for k, n in enumerate(notes):
            s = self.fm(midi(n), 0.2, 1.0, ratio=3.5, index=1.0, idecay=5, adecay=1.4, tail=d)
            s = np.pad(s, (int(k * 0.06 * SR), 0))
            y = s if y is None else (np.pad(y, (0, max(0, len(s) - len(y)))) + np.pad(s, (0, max(0, len(y) - len(s)))))
        return y * v * 0.3

    def click(self, v=1.0):
        t = tt(0.05)
        return (hp(self.wn(len(t)), 2500) * np.exp(-t * 400) + np.sin(2 * np.pi * 90 * t) * np.exp(-t * 60) * 0.5) * 0.5 * v

    def tick(self, v=1.0, f=2600):
        t = tt(0.04)
        return (np.sin(2 * np.pi * f * t) * np.exp(-t * 240) * 0.5 + hp(self.wn(len(t)), 5000) * np.exp(-t * 500) * 0.3) * v

    def blip(self, f=1320, d=0.07, v=1.0):
        t = tt(d); return np.sign(np.sin(2 * np.pi * f * t)) * env_ar(len(t), 0.002, 0.03) * 0.15 * v

    def pop(self, v=1.0):
        t = tt(0.12)
        return np.sin(2 * np.pi * np.cumsum(300 + 1100 * (1 - np.exp(-t * 60))) / SR) * np.exp(-t * 32) * 0.5 * v

    def thunk(self, v=1.0):
        t = tt(0.3)
        y = np.sin(2 * np.pi * np.cumsum(55 + 40 * np.exp(-t * 30)) / SR) * np.exp(-t * 16) + lp(self.wn(len(t)), 400) * np.exp(-t * 22) * 2.2 + bp(self.wn(len(t)), 900, 4500) * np.exp(-t * 60) * 0.7
        return np.tanh(1.5 * y) * 0.8 * v

    def vinyl(self, density=22, level_db=-44):
        cr = np.zeros(self.N); idx = self.R.integers(0, self.N, int(self.D * density))
        cr[idx] = self.wn(len(idx)) * self.R.uniform(0.05, 1, len(idx)) ** 3
        cr = hp(cr, 1200); hiss = hp(self.wn(self.N), 4000) * 0.006
        return level(np.stack([cr + hiss, np.roll(cr, 37) + hiss], 1), level_db)


def load_cues(path):
    cfg = json.load(open(path)); return cfg["arrangement"], sorted(cfg["cues"], key=lambda c: c["t"])
