"""Small, dependency-light DSP toolkit (numpy + scipy)."""
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from scipy import signal
from scipy.ndimage import maximum_filter1d, uniform_filter1d

try:  # scipy.fft is faster and multithreaded
    from scipy import fft as _fft

    def _rfft(x, n=None):
        return _fft.rfft(x, n=n, axis=-1, workers=-1)
except Exception:  # pragma: no cover
    def _rfft(x, n=None):
        return np.fft.rfft(x, n=n, axis=-1)

EPS = 1e-10


def hann(n):
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)).astype(np.float32)


def stft_mag(x, n_fft, hop, max_bin=None, chunk=512):
    """Centered-frame magnitude STFT -> (frames, bins). Frame k is centered at k*hop samples."""
    pad = n_fft // 2
    xp = np.pad(np.asarray(x, np.float32), (pad, pad))
    if len(xp) < n_fft:
        xp = np.pad(xp, (0, n_fft - len(xp)))
    view = sliding_window_view(xp, n_fft)[::hop]
    n_frames = view.shape[0]
    nb = n_fft // 2 + 1 if max_bin is None else min(max_bin, n_fft // 2 + 1)
    out = np.empty((n_frames, nb), np.float32)
    w = hann(n_fft)
    for s in range(0, n_frames, chunk):
        e = min(n_frames, s + chunk)
        out[s:e] = np.abs(_rfft(view[s:e] * w))[:, :nb]
    return out


def frame_rms(x, frame, hop, n_frames):
    """RMS of centered frames, aligned with stft_mag frame k (center k*hop)."""
    x = np.asarray(x, np.float32)
    pad = frame // 2
    xp = np.pad(x * x, (pad, pad + frame))
    c = np.concatenate([[0.0], np.cumsum(xp, dtype=np.float64)])
    starts = np.arange(n_frames) * hop
    ends = np.minimum(starts + frame, len(xp))
    return np.sqrt(np.maximum(0, (c[ends] - c[starts]) / frame)).astype(np.float32)


def bin_freqs(sr, n_fft, n_bins=None):
    n = n_fft // 2 + 1 if n_bins is None else n_bins
    return np.arange(n) * sr / n_fft


def log_filterbank(sr, n_fft, fmin, fmax, n_bands, n_bins=None):
    """Triangular filters with centers spaced evenly in log-frequency. Returns (bands, bins), centers."""
    freqs = bin_freqs(sr, n_fft, n_bins)
    edges = np.geomspace(fmin, fmax, n_bands + 2)
    fb = np.zeros((n_bands, len(freqs)), np.float32)
    for i in range(n_bands):
        lo, c, hi = edges[i], edges[i + 1], edges[i + 2]
        up = (freqs - lo) / (c - lo)
        down = (hi - freqs) / (hi - c)
        fb[i] = np.maximum(0.0, np.minimum(up, down))
        if fb[i].sum() < 1.0:  # narrower than ~a bin: spread over nearest bin(s)
            k = np.argmin(np.abs(freqs - c))
            fb[i, k] = max(fb[i, k], 1.0)
    return fb, edges[1:-1]


def mel_filterbank(sr, n_fft, n_mels=40, fmin=30.0, fmax=11000.0, n_bins=None):
    def mel(f):
        return 2595.0 * np.log10(1.0 + f / 700.0)

    def imel(m):
        return 700.0 * (10 ** (m / 2595.0) - 1.0)

    freqs = bin_freqs(sr, n_fft, n_bins)
    pts = imel(np.linspace(mel(fmin), mel(min(fmax, sr / 2)), n_mels + 2))
    fb = np.zeros((n_mels, len(freqs)), np.float32)
    for i in range(n_mels):
        lo, c, hi = pts[i], pts[i + 1], pts[i + 2]
        fb[i] = np.maximum(0, np.minimum((freqs - lo) / (c - lo), (hi - freqs) / (hi - c)))
        s = fb[i].sum()
        if s > 0:
            fb[i] /= s
        else:
            fb[i, np.argmin(np.abs(freqs - c))] = 1.0
    return fb


def robust_unit(x, lo=5.0, hi=98.0):
    """Map x into [0, 1] using percentiles (resistant to outliers)."""
    a, b = np.percentile(x, [lo, hi])
    if b - a < EPS:
        return np.zeros_like(x, dtype=np.float32)
    return np.clip((x - a) / (b - a), 0.0, 1.0).astype(np.float32)


def zscore(x, axis=0):
    m = x.mean(axis=axis, keepdims=True)
    s = x.std(axis=axis, keepdims=True)
    return (x - m) / (s + EPS)


def smooth(x, size):
    size = max(1, int(size))
    if size <= 1:
        return x
    return uniform_filter1d(x, size=size, axis=0, mode="nearest")


def pick_peaks(x, fps, window=0.05, avg=0.5, mult=1.0, delta=0.05, min_gap=0.06, rel=0.0, rel_span=1.0):
    """Adaptive peak picker. Returns frame indices sorted by time.

    A peak must be the max within +-window seconds and exceed
    mult * local_mean(+-avg seconds) + delta, and rel * local_max(+-rel_span seconds).
    Peaks closer than min_gap keep the stronger one.
    """
    w = max(1, int(round(window * fps)))
    a = max(1, int(round(avg * fps)))
    local_max = maximum_filter1d(x, size=2 * w + 1, mode="nearest")
    local_avg = uniform_filter1d(x, size=2 * a + 1, mode="nearest")
    ok = (x >= local_max) & (x > mult * local_avg + delta)
    if rel > 0:
        span = max(1, int(round(rel_span * fps)))
        ok &= x >= rel * maximum_filter1d(x, size=2 * span + 1, mode="nearest")
    cand = np.flatnonzero(ok)
    if len(cand) == 0:
        return cand
    gap = max(1, int(round(min_gap * fps)))
    order = cand[np.argsort(-x[cand])]
    taken = np.zeros(len(x) + 2 * gap + 2, bool)
    keep = []
    for i in order:
        if not taken[i: i + 2 * gap + 1].any():  # window centered on i (shifted by gap)
            keep.append(i)
            taken[i + gap] = True
    return np.sort(np.array(keep, dtype=int))


def parabolic_offset(y, i):
    """Sub-sample peak offset in [-0.5, 0.5] using a parabola through y[i-1], y[i], y[i+1]."""
    if i <= 0 or i >= len(y) - 1:
        return 0.0
    a, b, c = float(y[i - 1]), float(y[i]), float(y[i + 1])
    den = a - 2 * b + c
    if abs(den) < EPS:
        return 0.0
    return float(np.clip(0.5 * (a - c) / den, -0.5, 0.5))


def resample(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x
    g = np.gcd(int(sr_in), int(sr_out))
    return signal.resample_poly(x, int(sr_out) // g, int(sr_in) // g).astype(np.float32)


def biquad(kind, fc, sr, q=0.7071, gain_db=0.0):
    """RBJ cookbook biquad -> (b, a)."""
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * fc / sr
    alpha = np.sin(w0) / (2 * q)
    cw = np.cos(w0)
    if kind == "highpass":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "highshelf":
        sA = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sA), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sA)]
        a = [(A + 1) - (A - 1) * cw + sA, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sA]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]
    a = np.array(a) / a[0]
    return b, a


def k_weight(x, sr):
    """ITU-R BS.1770 K-weighting (pre-filter shelf + RLB high-pass)."""
    b1, a1 = biquad("highshelf", 1681.97, sr, q=0.7072, gain_db=3.9998)
    b2, a2 = biquad("highpass", 38.135, sr, q=0.5003)
    y = signal.lfilter(b1, a1, x, axis=0)
    return signal.lfilter(b2, a2, y, axis=0).astype(np.float32)


def integrated_loudness(x_stereo, sr):
    """Gated integrated loudness (LUFS) per BS.1770-4, for 1..N channels (no surround weights)."""
    y = k_weight(x_stereo, sr)
    block = int(0.4 * sr)
    step = int(0.1 * sr)
    if len(y) < block:
        return -70.0
    ms = []
    for s in range(0, len(y) - block + 1, step):
        seg = y[s: s + block]
        ms.append(np.sum(np.mean(seg.astype(np.float64) ** 2, axis=0)))
    ms = np.array(ms)
    lk = -0.691 + 10 * np.log10(ms + EPS)
    g = ms[lk > -70]
    if len(g) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(g)) - 10
    g2 = ms[(lk > -70) & (lk > rel)]
    if len(g2) == 0:
        return -70.0
    return float(-0.691 + 10 * np.log10(np.mean(g2)))
