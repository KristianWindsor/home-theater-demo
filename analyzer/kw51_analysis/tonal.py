"""Tuning, chroma (treble + bass) and key estimation."""
import numpy as np
from scipy.ndimage import median_filter

from .dsp import EPS, bin_freqs, resample, stft_mag

NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
# Krumhansl-Kessler key profiles
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimate_tuning(S, sr, n_fft, fmin=150.0, fmax=2500.0):
    """Deviation of the recording from A440 in cents, from magnitude-weighted spectral peaks."""
    freqs = bin_freqs(sr, n_fft, S.shape[1])
    lo = int(np.searchsorted(freqs, fmin))
    hi = int(np.searchsorted(freqs, fmax))
    X = np.log(S[::4, lo - 1: hi + 1] + EPS)
    if X.shape[0] == 0 or X.shape[1] < 3:
        return 0.0
    a, b, c = X[:, :-2], X[:, 1:-1], X[:, 2:]
    peak = (b > a) & (b >= c)
    mag = np.exp(b)
    frame_max = mag.max(axis=1, keepdims=True)
    peak &= mag > 0.1 * frame_max
    den = a - 2 * b + c
    delta = np.where(np.abs(den) > EPS, 0.5 * (a - c) / np.where(np.abs(den) > EPS, den, 1), 0)
    k = np.arange(lo, hi)[None, :] + np.clip(delta, -0.5, 0.5)
    f = k * sr / n_fft
    sel = peak & (f > 0)
    if sel.sum() < 20:
        return 0.0
    cents = 1200 * np.log2(f[sel] / 440.0)
    dev = ((cents + 50) % 100) - 50
    ang = 2 * np.pi * dev / 100.0
    w = mag[sel]
    mean = np.arctan2((w * np.sin(ang)).sum(), (w * np.cos(ang)).sum())
    return float(mean * 100.0 / (2 * np.pi))


def _pitch_matrix(freqs, tuning_cents, p_lo, p_hi):
    """(pitches, bins) pooling weights: each bin contributes to its nearest semitone with a cos^2 taper."""
    W = np.zeros((p_hi - p_lo + 1, len(freqs)), np.float32)
    ok = freqs > 0
    p = np.full(len(freqs), -100.0)
    p[ok] = 69 + 12 * np.log2(freqs[ok] / 440.0) - tuning_cents / 100.0
    nearest = np.round(p).astype(int)
    w = np.cos(np.pi * (p - nearest)) ** 2
    sel = (nearest >= p_lo) & (nearest <= p_hi)
    W[nearest[sel] - p_lo, np.flatnonzero(sel)] = w[sel]
    return W


HARMONICS = [(2, 12), (3, 19), (4, 24), (5, 28), (6, 31), (7, 34), (8, 36), (9, 38), (10, 40)]


def harmonic_part(S, time_kernel=17):
    """Median filter along time (keeps sustained partials; removes drum hits)."""
    return median_filter(S, size=(time_kernel, 1), mode="nearest")


def _tier(mono, sr, sr_t, n_fft, fps, n_frames, tuning, p_lo, p_hi, med=9):
    hop = int(round(sr_t / fps))
    y = resample(mono, sr, sr_t)
    S = stft_mag(y, n_fft, hop)
    S = median_filter(S, size=(med, 1), mode="nearest")  # harmonic emphasis
    if len(S) < n_frames:
        S = np.vstack([S, np.repeat(S[-1:], n_frames - len(S), axis=0)])
    S = S[:n_frames] / (n_fft / 4.0)  # -> sinusoid amplitude
    W = _pitch_matrix(bin_freqs(sr_t, n_fft, S.shape[1]), tuning, p_lo, p_hi)
    return S @ W.T


def pitch_spectrum(mono, sr, n_frames, tuning, fps=50.0, p_lo=33, p_split=60, p_hi=96):
    """Semitone-resolution amplitude spectrum (frames, pitches) for MIDI p_lo..p_hi.

    Two resolution tiers so neighbouring semitones never share a window main lobe:
      bass   55-247 Hz from a 2 kHz signal, 1024-pt window (1.95 Hz bins, 0.5 s)
      treble 262 Hz-2.1 kHz from an 8 kHz signal, 2048-pt window (3.9 Hz bins, 0.26 s)
    """
    bass = _tier(mono, sr, 2000, 1024, fps, n_frames, tuning, p_lo, p_split - 1)
    treb = _tier(mono, sr, 8000, 2048, fps, n_frames, tuning, p_split, p_hi, med=7)
    return np.hstack([bass, treb]), p_lo


def suppress_harmonics(X, strength=0.9):
    """Walk pitches upward and subtract the expected harmonic series of each one from the pitches
    above it, so overtones (e.g. the 5th harmonic of A = C#) don't masquerade as chord tones."""
    Y = X.copy()
    n = Y.shape[1]
    for i in range(n):
        src = Y[:, i]
        if not src.any():
            continue
        for h, o in HARMONICS:
            j = i + o
            if j >= n:
                break
            np.maximum(Y[:, j] - src * (strength / h), 0, out=Y[:, j])
    return Y


def chroma_from_pitches(Y, p_lo, compress=0.7):
    T, n = Y.shape
    C = np.zeros((T, 12), np.float32)
    Yc = Y ** compress
    for i in range(n):
        C[:, (p_lo + i) % 12] += Yc[:, i]
    return C / (C.max(axis=1, keepdims=True) + EPS)


def estimate_key(chroma, weights=None):
    """Return (tonic index, 'major'|'minor', confidence 0..1)."""
    if weights is None:
        weights = np.ones(len(chroma))
    v = (chroma * weights[:, None]).sum(0)
    if v.sum() < EPS:
        return 0, "major", 0.0
    v = v / v.sum()
    scores = []
    for mode, prof in (("major", KK_MAJOR), ("minor", KK_MINOR)):
        for k in range(12):
            r = np.corrcoef(v, np.roll(prof, k))[0, 1]
            scores.append((r, k, mode))
    scores.sort(reverse=True)
    best, second = scores[0], scores[1]
    # confidence: correlation strength and margin to the runner-up (relative major/minor aside)
    conf = float(np.clip(best[0], 0, 1) * np.clip((best[0] - second[0]) * 8 + 0.4, 0, 1))
    return best[1], best[2], conf
