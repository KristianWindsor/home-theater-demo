"""Full analysis pipeline -> score dict (see docs in README, "Score format")."""
import base64
import os
import time

import numpy as np
from scipy.fft import dct
from scipy.ndimage import median_filter, uniform_filter1d

from . import SCORE_FORMAT, SCORE_VERSION, __version__
from .audio_io import decode, probe
from .dsp import (EPS, bin_freqs, integrated_loudness, k_weight, log_filterbank, mel_filterbank, robust_unit,
                  stft_mag)
from .rhythm import OnsetData, drum_events, estimate_downbeats, estimate_tempo, pulse_salience, track_beats
from .structure import beat_sync, builds_and_drops, find_moments, intensity_curve, segment
from .tonal import NOTE_NAMES, chroma_from_pitches, estimate_key, estimate_tuning, pitch_spectrum, suppress_harmonics

FPS = 50.0
SPEC_BANDS = 32
SPEC_FMIN, SPEC_FMAX = 30.0, 16000.0


def _u8(x, lo, hi):
    v = np.clip((np.asarray(x, np.float64) - lo) / (hi - lo), 0, 1)
    return np.round(v * 255).astype(np.uint8)


def _b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr, dtype=np.uint8).tobytes()).decode("ascii")


def _db(x):
    return 10 * np.log10(np.maximum(x, 1e-12))


def _rms_at(x, sr, times, win):
    """RMS of x (n,) around each time with a centered window of `win` seconds."""
    c = np.concatenate([[0.0], np.cumsum(x.astype(np.float64) ** 2)])
    half = int(win * sr / 2)
    centers = np.round(times * sr).astype(int)
    a = np.clip(centers - half, 0, len(x))
    b = np.clip(centers + half, 0, len(x))
    n = np.maximum(b - a, 1)
    return np.sqrt((c[b] - c[a]) / n)


class Progress:
    def __init__(self, cb):
        self.cb = cb
        self.t0 = time.time()

    def __call__(self, stage, p):
        if self.cb:
            self.cb(stage, float(p))


def analyze(path, progress_cb=None):
    prog = Progress(progress_cb)
    prog("probe", 0.01)
    info = probe(path)
    duration = info["duration"]
    sr = 44100 if duration <= 1800 else 22050

    prog("decode", 0.03)
    x = decode(path, sr, channels=2, stream_index=info["stream_index"])
    if len(x) < sr:  # under a second: pad so everything still works
        x = np.pad(x, ((0, sr - len(x)), (0, 0)))
    duration = len(x) / sr
    mono = x.mean(axis=1)

    # ---------------------------------------------------------- spectral frames @ 50 fps
    prog("spectrum", 0.12)
    hop = int(round(sr / FPS))
    fps = sr / hop
    n_fft = 4096 if sr >= 32000 else 2048
    freqs_all = bin_freqs(sr, n_fft)
    max_bin = int(np.searchsorted(freqs_all, 16500.0))
    S = stft_mag(mono, n_fft, hop, max_bin=max_bin)
    T = len(S)
    frame_times = np.arange(T) / fps
    freqs = freqs_all[:max_bin]
    P = S.astype(np.float64) ** 2
    ref_power = (n_fft / 4.0) ** 2 * 1.5  # ~ a full-scale sine summed over its main lobe

    fb, _centers = log_filterbank(sr, n_fft, SPEC_FMIN, SPEC_FMAX, SPEC_BANDS, n_bins=max_bin)
    spec_db = _db((P @ fb.T) / ref_power)  # (T, 32) dBFS-ish

    def band_db(lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        return _db(P[:, m].sum(1) / ref_power)

    bass_db = band_db(30, 150)

    # loudness: K-weighted, 50 ms windows, summed over L/R
    kw = k_weight(x, sr)
    ms = np.zeros(T)
    for ch in range(kw.shape[1]):
        ms += _rms_at(kw[:, ch], sr, frame_times, 0.05) ** 2
    loud_db = -0.691 + _db(ms)
    lufs = integrated_loudness(x, sr)
    del kw

    rng_m = (freqs >= 30) & (freqs <= 16000)
    Pm = P[:, rng_m]
    tot = Pm.sum(1) + EPS
    centroid_hz = (Pm * freqs[rng_m]).sum(1) / tot
    centroid = np.clip((np.log2(np.maximum(centroid_hz, 1)) - np.log2(100)) / (np.log2(10000) - np.log2(100)), 0, 1)
    fl_m = (freqs >= 150) & (freqs <= 12000)
    Pf = P[:, fl_m] + 1e-12
    flat_db = _db(np.exp(np.mean(np.log(Pf), axis=1)) / np.mean(Pf, axis=1))
    flux = np.zeros(T)
    flux[1:] = np.maximum(0, np.diff(spec_db, axis=0)).sum(1)
    del Pm, Pf

    # ---------------------------------------------------------- harmonic / percussive split
    prog("harmonic", 0.30)
    hp_bins = int(np.searchsorted(freqs, 11000.0))
    Sh = S[:, :hp_bins]
    H = median_filter(Sh, size=(17, 1), mode="nearest")
    Pq = median_filter(Sh, size=(1, 17), mode="nearest")
    H2, P2 = H.astype(np.float64) ** 2, Pq.astype(np.float64) ** 2
    mask_p = P2 / (H2 + P2 + EPS)
    E = Sh.astype(np.float64) ** 2
    perc_e = (mask_p * E).sum(1)
    harm_e = ((1 - mask_p) * E).sum(1)
    perc_ratio = perc_e / (perc_e + harm_e + EPS)
    del Pq, P2, mask_p, E

    # ---------------------------------------------------------- tonal
    prog("tonal", 0.45)
    tuning = estimate_tuning(S, sr, n_fft)
    pitches, p_lo = pitch_spectrum(mono, sr, T, tuning, fps=fps)
    chroma = chroma_from_pitches(suppress_harmonics(pitches), p_lo)
    # remove the flat "noise floor" of each frame; keep confidence in the vector's magnitude
    c_med = np.median(chroma, axis=1, keepdims=True)
    c_max = chroma.max(axis=1, keepdims=True)
    clarity = np.clip(1.6 * (c_max - c_med) / (c_max + EPS), 0, 1)
    chroma = np.clip((chroma - c_med) / (c_max - c_med + EPS), 0, 1) * clarity
    tonal_energy = pitches.sum(1)
    chroma *= np.clip(tonal_energy / (np.percentile(tonal_energy, 95) + EPS), 0, 1)[:, None] ** 0.5
    loud_w = robust_unit(loud_db, 10, 99)
    key_idx, mode, key_conf = estimate_key(chroma, weights=loud_w)
    del H, H2

    mel = mel_filterbank(sr, n_fft, 40, 30.0, 11000.0, n_bins=max_bin)
    mfcc = dct(np.log(P @ mel.T + 1e-10), type=2, norm="ortho", axis=1)[:, 1:13].astype(np.float32)

    # stereo image
    L, R = x[:, 0], x[:, 1]
    eL = _rms_at(L, sr, frame_times, 0.05) ** 2
    eR = _rms_at(R, sr, frame_times, 0.05) ** 2
    eM = _rms_at((L + R) * 0.5, sr, frame_times, 0.05) ** 2
    eS = _rms_at((L - R) * 0.5, sr, frame_times, 0.05) ** 2
    width = eS / (eM + eS + EPS)
    pan = (eR - eL) / (eR + eL + EPS)

    # ---------------------------------------------------------- rhythm
    prog("rhythm", 0.55)
    od = OnsetData(mono, sr)
    bpm, clarity = estimate_tempo(od.env, od.fps)
    beat_frames = track_beats(od.env, od.fps, bpm)
    beat_times = beat_frames / od.fps
    # a beat grid only counts if there is a real pulse behind it (free-time music gets none)
    salience = pulse_salience(od.env, od.fps, beat_frames)
    pulse = 0.5 * clarity / 0.45 + 0.5 * (salience - 1.0) / 0.8
    if len(beat_times) >= 8 and np.percentile(od.env, 99) > 6.0 and pulse >= 0.9:
        ibi = np.diff(beat_times)
        bpm = float(60.0 / np.median(ibi))
        regularity = float(np.clip(1 - np.std(ibi) / (np.mean(ibi) + EPS) * 5, 0, 1))
    else:
        beat_times = np.array([])
        bpm, clarity, regularity = 0.0, 0.0, 0.0

    def chroma_at_beats(bt):
        return beat_sync(chroma, frame_times, bt, duration)

    def loud_at_beats(bt):
        return beat_sync(loud_db[:, None], frame_times, bt, duration)[:, 0]

    if len(beat_times):
        meter, beat_pos = estimate_downbeats(beat_times, od, chroma_at_beats, loud_at_beats)
    else:
        meter, beat_pos = 4, np.array([], int)
    onset_norm = od.env / (np.percentile(od.env, 99) + EPS)
    beat_strength = np.array([min(1.0, od.at(onset_norm, t)) for t in beat_times])

    prog("events", 0.65)
    events = drum_events(od)

    # ---------------------------------------------------------- structure
    prog("structure", 0.72)
    env50 = np.interp(frame_times, od.times, od.env)
    curve = intensity_curve(loud_db, bass_db, centroid, env50, fps)
    sections = []
    # free-time music: segment on a 1-second pseudo grid (4 s "bars") instead of beats
    grid, grid_pos, grid_meter = (beat_times, beat_pos, meter) if len(beat_times) >= 8 else \
        (np.arange(0.0, duration, 1.0), np.arange(int(np.ceil(duration))) % 4, 4)
    if len(grid) >= 8:
        energy = np.stack([loud_db, bass_db, centroid, perc_ratio, robust_unit(flux)], axis=1).astype(np.float32)
        feats = {
            "chroma": beat_sync(chroma, frame_times, grid, duration),
            "mfcc": beat_sync(mfcc, frame_times, grid, duration),
            "energy": beat_sync(energy, frame_times, grid, duration),
        }
        bass_curve = robust_unit(uniform_filter1d(bass_db, size=int(fps * 0.5), mode="nearest"), 3, 99)
        sections = segment(grid, grid_pos, grid_meter, feats, duration, frame_times, curve,
                           events["onset"][0], bass_curve)
    if not sections:
        sections = [dict(start=0.0, end=round(duration, 3), label=0, intensity=float(curve.mean()), kind="section",
                         density=0.0, trend=0.0, beats=[0, len(beat_times)], novelty=1.0, entryJump=0.0)]
    builds, drops = builds_and_drops(sections)
    moments = find_moments(sections, drops, events["onset"], frame_times, loud_db, duration)

    # ---------------------------------------------------------- multichannel energy (surround music)
    chan_block = None
    if info["channels"] > 2:
        prog("channels", 0.86)
        nch = min(8, info["channels"])
        sr_c = 11025
        xm = decode(path, sr_c, channels=nch, stream_index=info["stream_index"])
        levels = np.stack([_db(_rms_at(xm[:, c], sr_c, frame_times, 0.05) ** 2 + 1e-12) for c in range(nch)], axis=1)
        chan_block = {"layout": info["labels"][:nch], "data": _b64(_u8(levels, -70, 0))}

    # ---------------------------------------------------------- globals
    prog("export", 0.94)
    short_term = loud_db[loud_db > -69]
    dyn = float(np.percentile(short_term, 95) - np.percentile(short_term, 10)) if len(short_term) > 10 else 0.0
    brightness = float(np.average(centroid, weights=loud_w + EPS))
    perc_mean = float(np.average(perc_ratio, weights=loud_w + EPS))
    energy_g = float(np.clip((lufs + 24) / 18.0, 0, 1))
    mode_sign = 1.0 if mode == "major" else -1.0
    valence = float(np.clip(0.5 + 0.22 * mode_sign * (0.4 + key_conf) + 0.25 * (brightness - 0.5)
                            + 0.12 * np.clip((bpm - 100) / 60, -1, 1), 0, 1))
    dance = float(np.clip(0.55 * clarity + 0.45 * regularity, 0, 1))
    key_name = NOTE_NAMES[key_idx] if key_conf > 0 else ""

    st = os.stat(path)
    score = {
        "format": SCORE_FORMAT,
        "version": SCORE_VERSION,
        "generator": f"kw51-analyzer {__version__}",
        "source": {
            "file": os.path.basename(path), "size": st.st_size, "mtime": int(st.st_mtime),
            "duration": round(duration, 3), "sampleRate": info["sample_rate"], "channels": info["channels"],
            "layout": info["layout"], "codec": info["codec"],
        },
        "tags": info["tags"],
        "global": {
            "bpm": round(bpm, 2), "beatPeriod": round(60.0 / bpm, 4) if bpm else 0.5, "meter": int(meter),
            "tempoClarity": round(clarity, 3), "pulse": round(float(pulse), 3), "key": key_name, "keyIndex": int(key_idx), "mode": mode,
            "keyConfidence": round(key_conf, 3), "tuningCents": round(tuning, 1),
            "loudnessLUFS": round(lufs, 1), "dynamicRange": round(dyn, 1), "energy": round(energy_g, 3),
            "brightness": round(brightness, 3), "percussiveness": round(perc_mean, 3),
            "danceability": round(dance, 3), "valence": round(valence, 3),
        },
        "frames": {
            "fps": fps, "count": int(T),
            "loud": {"min": -70, "max": 0, "data": _b64(_u8(loud_db, -70, 0))},
            "spec": {"bands": SPEC_BANDS, "fmin": SPEC_FMIN, "fmax": SPEC_FMAX, "min": -90, "max": 0,
                     "data": _b64(_u8(spec_db, -90, 0))},
            "centroid": {"data": _b64(_u8(centroid, 0, 1))},
            "flatness": {"min": -50, "max": 0, "data": _b64(_u8(flat_db, -50, 0))},
            "flux": {"data": _b64(_u8(robust_unit(flux, 2, 99.5), 0, 1))},
            "perc": {"data": _b64(_u8(perc_ratio, 0, 1))},
            "chroma": {"bins": 12, "data": _b64(_u8(chroma, 0, 1))},
            "width": {"data": _b64(_u8(width, 0, 1))},
            "pan": {"data": _b64(_u8((pan + 1) / 2, 0, 1))},
            "intensity": {"data": _b64(_u8(curve, 0, 1))},
        },
        "beats": {
            "t": [round(float(t), 3) for t in beat_times],
            "s": [round(float(s), 3) for s in beat_strength],
            "pos": [int(p) for p in beat_pos],
        },
        "events": {k: {"t": [round(float(a), 3) for a in v[0]], "s": [round(float(b), 3) for b in v[1]]}
                   for k, v in events.items()},
        "sections": [{k: v for k, v in s.items() if k != "beats"} for s in sections],
        "builds": builds,
        "drops": drops,
        "moments": moments,
    }
    if chan_block:
        score["frames"]["channels"] = chan_block
    prog("done", 1.0)
    return score
