#!/usr/bin/env python3
"""
Synthesize an original test track with a precisely known structure.

Used two ways:
  * as demo content, so the app works before you add real music
  * as ground truth for the analyzer tests (tempo, beats, downbeats,
    section boundaries and drops are all known exactly)

Everything here is generated from scratch (no samples), so it is free to ship.

    python3 scripts/synth_song.py media/music/neon-cathedral.flac
"""
import argparse
import json
import subprocess
import sys

import numpy as np
from scipy import signal

SR = 44100
BPM = 124.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
LEAD_IN = 0.5  # seconds of silence before bar 1

# (name, bars, progression)
MAIN = [(45, [57, 60, 64]), (41, [53, 57, 60]), (48, [55, 60, 64]), (43, [55, 59, 62])]   # Am F C G
BREAK = [(41, [53, 57, 60]), (43, [55, 59, 62]), (40, [52, 55, 59]), (45, [57, 60, 64])]  # F G Em Am
SECTIONS = [
    ("intro", 8, MAIN),
    ("verse", 16, MAIN),
    ("build", 8, MAIN),
    ("drop", 16, MAIN),
    ("break", 8, BREAK),
    ("build", 4, BREAK),
    ("drop", 16, MAIN),
    ("outro", 8, MAIN),
]

rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def butter(kind, fc, order=2):
    if isinstance(fc, (list, tuple)):
        wn = [f / (SR / 2) for f in fc]
    else:
        wn = fc / (SR / 2)
    return signal.butter(order, wn, btype=kind)


def filt(x, kind, fc, order=2):
    b, a = butter(kind, fc, order)
    return signal.lfilter(b, a, x).astype(np.float32)


def saw(freq, t, phase=0.0):
    return (2.0 * ((freq * t + phase) % 1.0) - 1.0).astype(np.float32)


# ---------------------------------------------------------------- instruments
def kick():
    t = t_axis(0.45)
    f = 44 + 120 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.17)
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.0025) * 0.35
    return (body + click).astype(np.float32)


def clap(gain=1.0):
    t = t_axis(0.3)
    n = filt(rng.standard_normal(len(t)), "bandpass", [900, 6000])
    env = np.zeros_like(t)
    for off in (0.0, 0.011, 0.022):
        env += np.where(t >= off, np.exp(-(t - off) / (0.012 if off < 0.02 else 0.09)), 0)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.04) * 0.5
    return ((n * env * 1.6 + tone) * gain).astype(np.float32)


def snare(gain=1.0):
    t = t_axis(0.18)
    n = filt(rng.standard_normal(len(t)), "bandpass", [1200, 7000])
    tone = np.sin(2 * np.pi * 200 * t) * np.exp(-t / 0.03)
    return ((n * np.exp(-t / 0.05) * 1.2 + tone * 0.6) * gain).astype(np.float32)


def hat(open_=False):
    dur, tau = (0.35, 0.11) if open_ else (0.07, 0.014)
    t = t_axis(dur)
    n = filt(rng.standard_normal(len(t)), "highpass", 7500, order=4)
    return (n * np.exp(-t / tau)).astype(np.float32)


def crash():
    t = t_axis(2.5)
    n = filt(rng.standard_normal(len(t)), "highpass", 4000, order=2)
    return (n * np.exp(-t / 0.9) * 0.8).astype(np.float32)


def bass(m, dur):
    t = t_axis(dur)
    f = hz(m)
    x = saw(f, t) * 0.6 + saw(f * 0.5, t) * 0.4
    x = filt(x, "lowpass", 420, order=4)
    env = np.minimum(1, t / 0.004) * np.minimum(1, (dur - t) / 0.03).clip(0, 1)
    return (x * env).astype(np.float32)


def pad(notes, dur, cutoff=1800):
    t = t_axis(dur)
    L = np.zeros_like(t, dtype=np.float32)
    R = np.zeros_like(t, dtype=np.float32)
    for m in notes:
        f = hz(m)
        for det, side in ((-0.007, 0), (0.0, 2), (0.0071, 1)):
            v = saw(f * (1 + det), t, rng.random())
            if side in (0, 2):
                L += v
            if side in (1, 2):
                R += v
    env = np.minimum(1, t / 0.25) * np.clip((dur - t) / 0.35, 0, 1)
    L = filt(L, "lowpass", cutoff, order=2) * env / (len(notes) * 2)
    R = filt(R, "lowpass", cutoff, order=2) * env / (len(notes) * 2)
    return np.stack([L, R], axis=1).astype(np.float32)


def pluck(m, dur=0.25):
    t = t_axis(dur)
    f = hz(m)
    x = np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + saw(f * 1.003, t) * 0.5
    x = filt(x, "lowpass", 3200, order=2)
    return (x * np.exp(-t / 0.09)).astype(np.float32)


def piano(m, dur=1.2):
    t = t_axis(dur)
    f = hz(m)
    x = np.zeros_like(t)
    for k in range(1, 7):
        x += np.sin(2 * np.pi * f * k * t) / k ** 1.4 * np.exp(-t * (1.5 + k * 0.9))
    return (x * np.minimum(1, t / 0.003)).astype(np.float32)


def riser(dur):
    t = t_axis(dur)
    p = t / dur
    f = 110 * (2 ** (p * 4.5))
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) * 0.35 + np.sign(np.sin(ph * 2)) * 0.08
    noise = filt(rng.standard_normal(len(t)), "highpass", 2500, order=2)
    env = p ** 2.2
    return ((tone + noise * 0.6) * env).astype(np.float32)


# ---------------------------------------------------------------- arrangement
class Mix:
    def __init__(self, seconds):
        self.buf = np.zeros((int(seconds * SR) + SR, 2), np.float32)

    def add(self, t0, sig, gain=1.0, pan=0.0):
        i = int(round(t0 * SR))
        if i >= len(self.buf):
            return
        if sig.ndim == 1:
            a = (pan + 1) * np.pi / 4
            sig = np.stack([sig * np.cos(a), sig * np.sin(a)], axis=1) * np.sqrt(2)
        sig = sig[: len(self.buf) - i]
        self.buf[i : i + len(sig)] += sig * gain


def pump(t_rel):
    """Sidechain-style ducking envelope for a time inside a beat."""
    return 1 - 0.55 * np.exp(-t_rel / 0.09)


def render():
    total_bars = sum(b for _, b, _ in SECTIONS)
    dur = LEAD_IN + total_bars * BAR + 3.0
    mix = Mix(dur)
    truth = {"bpm": BPM, "beats": [], "downbeats": [], "sections": [], "drops": [], "builds": [],
             "kick": [], "snare": [], "hat": []}
    ev = lambda k, t: truth[k].append(round(t, 4))
    bar_index = 0
    K, C = kick(), crash()
    for name, nbars, prog in SECTIONS:
        s_start = LEAD_IN + bar_index * BAR
        truth["sections"].append({"name": name, "start": round(s_start, 4), "bars": nbars})
        if name == "drop":
            truth["drops"].append(round(s_start, 4))
            mix.add(s_start, C, 0.35)
        if name == "build":
            truth["builds"].append([round(s_start, 4), round(s_start + nbars * BAR, 4)])
            mix.add(s_start, riser(nbars * BAR), 0.45)
        for b in range(nbars):
            t_bar = LEAD_IN + bar_index * BAR
            root, chord = prog[b % len(prog)]
            truth["downbeats"].append(round(t_bar, 4))
            for q in range(4):
                truth["beats"].append(round(t_bar + q * BEAT, 4))
            prog_frac = b / max(1, nbars - 1)

            # pads everywhere, louder in the break
            pad_gain = {"intro": 0.30, "verse": 0.20, "build": 0.22, "drop": 0.20,
                        "break": 0.42, "outro": 0.24 * (1 - b / nbars)}[name]
            P = pad(chord, BAR + 0.3, cutoff=2600 if name == "drop" else 1500)
            if name == "drop":
                # sidechain the pad
                tt = np.arange(len(P)) / SR
                P = P * pump(tt % BEAT)[:, None]
            mix.add(t_bar, P, pad_gain)

            if name == "intro":
                for q in range(4):
                    mix.add(t_bar + q * BEAT, piano(chord[q % 3] + 12), 0.10, pan=-0.3 + 0.2 * q)

            if name in ("verse", "drop", "outro") or (name == "build" and b < nbars - 2):
                if not (name == "outro" and b >= 6):
                    g = 0.95 if name != "outro" else 0.95 * (1 - b / 8)
                    for q in range(4):
                        mix.add(t_bar + q * BEAT, K, g)
                        ev("kick", t_bar + q * BEAT)

            if name in ("verse", "outro"):
                for q in range(4):
                    mix.add(t_bar + (q + 0.5) * BEAT, hat(False), 0.22, pan=0.25)
                    ev("hat", t_bar + (q + 0.5) * BEAT)

            if name in ("verse", "drop"):
                for e in range(8):
                    m = root + (12 if e % 2 else 0)
                    seg = bass(m, BEAT / 2 * 0.92)
                    if name == "drop":
                        tt = (np.arange(len(seg)) / SR + (e % 2) * BEAT / 2)
                        seg = seg * pump(tt % BEAT)
                    mix.add(t_bar + e * BEAT / 2, seg, 0.55 if name == "drop" else 0.42)

            if name == "drop":
                for q in (1, 3):
                    mix.add(t_bar + q * BEAT, clap(), 0.55)
                    ev("snare", t_bar + q * BEAT)
                for q in range(4):
                    mix.add(t_bar + (q + 0.5) * BEAT, hat(True), 0.20, pan=-0.2)
                for s16 in range(16):
                    mix.add(t_bar + s16 * BEAT / 4, hat(False), 0.07, pan=0.4)
                    ev("hat", t_bar + s16 * BEAT / 4)
                    note = chord[s16 % 3] + 12 * (1 + (s16 // 3) % 2)
                    mix.add(t_bar + s16 * BEAT / 4, pluck(note), 0.11, pan=(-0.6 if s16 % 2 else 0.6))

            if name == "build":
                # snare roll: 8ths -> 16ths -> 32nds, rising velocity
                div = 2 if prog_frac < 0.5 else (4 if prog_frac < 0.75 else 8)
                for k in range(4 * div):
                    vel = 0.25 + 0.6 * (b + k / (4 * div)) / nbars
                    mix.add(t_bar + k * BEAT / div, snare(vel), 0.5)
                    ev("snare", t_bar + k * BEAT / div)

            if name == "break":
                for e in range(8):
                    mix.add(t_bar + e * BEAT / 2, piano(chord[(e * 2) % 3] + 12, 0.8), 0.14,
                            pan=-0.4 if e % 2 else 0.4)
            bar_index += 1

    # tail beat so the tracker has a clean end
    end = LEAD_IN + bar_index * BAR
    truth["end"] = round(end, 4)
    mix.add(end, K, 0.9)
    ev("kick", end)
    for k in ("kick", "snare", "hat"):
        truth[k] = sorted(set(truth[k]))
    mix.add(end, crash(), 0.25)

    y = mix.buf
    y = np.tanh(y * 1.1) / np.tanh(1.1)
    y *= 0.89 / np.max(np.abs(y))
    return y.astype(np.float32), truth


def render_ambient(seconds=96.0):
    """Beatless ambient piece (D major, slow chords + piano), for testing calm visuals."""
    mix = Mix(seconds + 4)
    prog = [(50, [62, 66, 69, 73]), (47, [59, 62, 66, 69]), (43, [59, 62, 67, 71]), (45, [61, 64, 69, 73])]
    chord_len = 6.0
    t = 0.0
    i = 0
    while t < seconds:
        root, notes = prog[i % len(prog)]
        P = pad(notes, chord_len + 1.5, cutoff=1300 + 500 * np.sin(i * 0.9))
        mix.add(t, P, 0.55)
        mix.add(t, bass(root - 12, chord_len) * 0.5, 0.35)
        for k in range(6):
            nt = t + k * chord_len / 6 + rng.uniform(0, 0.08)
            m = notes[(k * 2 + i) % len(notes)] + 12
            mix.add(nt, piano(m, 2.5), 0.16, pan=float(np.sin(nt * 0.7)) * 0.7)
        t += chord_len
        i += 1
    y = mix.buf[: int((seconds + 3) * SR)]
    fade = np.linspace(1, 0, int(4 * SR))
    y[-len(fade):] *= fade[:, None]
    y = np.tanh(y * 1.2)
    y *= 0.8 / np.max(np.abs(y))
    return y.astype(np.float32)


def encode(y, output, title, comment):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2",
           "-i", "-", "-c:a", "flac", "-sample_fmt", "s16",
           "-metadata", f"title={title}",
           "-metadata", "artist=KW 5.1 Synth Lab",
           "-metadata", "album=Test Signals",
           "-metadata", f"comment={comment}",
           output]
    subprocess.run(cmd, input=y.tobytes(), check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("output", help="output audio file (.flac recommended)")
    ap.add_argument("--truth", help="also write ground-truth JSON here")
    ap.add_argument("--style", choices=["edm", "ambient"], default="edm")
    args = ap.parse_args()
    if args.style == "ambient":
        y = render_ambient()
        encode(y, args.output, "Glass Tide", "Synthesized beatless ambient piece (D major)")
        print(f"wrote {args.output} ({len(y) / SR:.1f}s)", file=sys.stderr)
        return
    y, truth = render()
    encode(y, args.output, "Neon Cathedral", "Synthesized test track with known structure (124 BPM, A minor)")
    if args.truth:
        with open(args.truth, "w") as f:
            json.dump(truth, f, indent=1)
    print(f"wrote {args.output} ({len(y) / SR:.1f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
