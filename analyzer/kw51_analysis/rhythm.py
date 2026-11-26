"""Onsets, tempo, beat tracking (Ellis 2007 dynamic programming), downbeats, drum events."""
import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d

from .dsp import EPS, hann, log_filterbank, parabolic_offset, pick_peaks, stft_mag

# Empirical latency of the flux peak relative to the true onset (seconds); calibrated on
# synthetic material with sample-accurate ground truth (see tests/test_analyzer.py).
ONSET_LATENCY = 0.0


class OnsetData:
    """Spectral-flux onset envelopes at ~100 fps."""

    def __init__(self, mono, sr):
        self.hop = int(round(sr / 100.0))
        self.fps = sr / self.hop
        n_fft = 2048 if sr >= 32000 else 1024
        S = stft_mag(mono, n_fft, self.hop)
        fb, centers = log_filterbank(sr, n_fft, 30.0, min(16000.0, sr * 0.45), 96, n_bins=S.shape[1])
        L = np.log1p(S @ fb.T)
        # SuperFlux-style: compare against a frequency-max-filtered, 2-frames-earlier reference
        ref = maximum_filter1d(L, size=3, axis=1)
        lag = 2
        d = np.zeros_like(L)
        d[lag:] = L[lag:] - ref[:-lag]
        np.maximum(d, 0, out=d)
        self.centers = centers
        self.n = len(L)
        self.times = np.arange(self.n) / self.fps - ONSET_LATENCY
        self.env = d.sum(axis=1)

        def sel(lo, hi):
            return (centers >= lo) & (centers < hi)

        m_low, m_mid, m_high, m_bb = sel(30, 150), sel(1500, 6000), sel(7000, 16500), sel(1000, 8000)
        low = d[:, m_low].sum(axis=1)
        mid = d[:, m_mid]
        high = d[:, m_high]
        bb = d[:, m_bb]

        def coverage(block):
            if block.shape[1] == 0:
                return np.zeros(self.n)
            thr = np.percentile(block, 75) + EPS
            return (block > thr).mean(axis=1)

        # Kick: low-band flux, slightly favoured when a broadband beater "click" coincides.
        self.low = low * (0.6 + 0.4 * coverage(bb))
        # Snare/clap: noisy mid-band burst that *sustains* for tens of ms (a kick click doesn't),
        # and isn't mostly above 7 kHz (that's a hat).
        e_mid = np.log(np.exp(L[:, m_mid]).sum(axis=1) + EPS) if m_mid.any() else np.zeros(self.n)
        after = np.zeros(self.n)
        before = np.zeros(self.n)
        for k in range(2, 7):
            after += np.roll(e_mid, -k)
        for k in range(1, 5):
            before += np.roll(e_mid, k)
        sustain = np.maximum(0, after / 5 - before / 4)
        sustain /= np.percentile(sustain, 98) + EPS
        mid_sum = mid.sum(axis=1)
        high_sum = high.sum(axis=1)
        ratio = mid_sum / (mid_sum + high_sum + EPS)
        self.snare = mid_sum * coverage(mid) ** 2 * np.clip(sustain, 0, 1) * np.clip((ratio - 0.25) / 0.25, 0, 1)
        # Hat: high-band flux with wide coverage up there.
        self.hat = high_sum * coverage(high)

    def at(self, env, t, before=0.03, after=0.05):
        """Max of an envelope near time t."""
        i0 = max(0, int((t - before + ONSET_LATENCY) * self.fps))
        i1 = min(self.n, int((t + after + ONSET_LATENCY) * self.fps) + 1)
        return float(env[i0:i1].max()) if i1 > i0 else 0.0


def _normalized_env(env, fps):
    x = env - uniform_filter1d(env, size=max(3, int(fps * 0.5)), mode="nearest")
    x = np.maximum(x, 0)
    s = x.std()
    return x / (s + EPS)


def estimate_tempo(env, fps, prior_bpm=120.0, sigma_oct=1.0, bpm_lo=55.0, bpm_hi=215.0):
    """Return (bpm, clarity). Averages normalized windowed autocorrelations (a tempogram),
    then scores each candidate period with a harmonic comb and a log-normal tempo prior."""
    x = _normalized_env(env, fps)
    win = int(8 * fps)
    hop = int(2 * fps)
    if len(x) < win:
        win = max(int(fps * 2), len(x))
    acf = np.zeros(win)
    w = hann(win)
    count = 0
    for s in range(0, max(1, len(x) - win + 1), hop):
        seg = x[s: s + win]
        if len(seg) < win:
            seg = np.pad(seg, (0, win - len(seg)))
        seg = (seg - seg.mean()) * w
        f = np.fft.rfft(seg, 2 * win)
        ac = np.fft.irfft(np.abs(f) ** 2)[:win]
        if ac[0] > EPS:
            acf += ac / ac[0]
            count += 1
    if count == 0:
        return prior_bpm, 0.0
    acf /= count
    lags = np.arange(win)
    cand = np.arange(60.0 * fps / bpm_hi, 60.0 * fps / bpm_lo, 0.25)
    score = np.zeros(len(cand))
    for k, wk in ((1, 1.0), (2, 0.5), (3, 0.33), (4, 0.25)):
        L = cand * k
        ok = L < win - 2
        # tolerate small period drift: max over +-1 lag
        v = np.maximum.reduce([np.interp(L + o, lags, acf) for o in (-1, 0, 1)])
        score += np.where(ok, v, 0) * wk
    bpm = 60.0 * fps / cand
    prior = np.exp(-0.5 * (np.log2(bpm / prior_bpm) / sigma_oct) ** 2)
    total = score * prior
    i = int(np.argmax(total))
    # refine with parabola on the score curve
    off = parabolic_offset(total, i)
    lag = cand[i] + off * 0.25
    clarity = float(np.clip(np.interp(lag, lags, acf), 0, 1))
    return float(60.0 * fps / lag), clarity


def track_beats(env, fps, bpm, tightness=100.0):
    """Dynamic-programming beat tracker. Returns beat frame indices (float, sub-frame refined)."""
    period = 60.0 * fps / bpm
    onset = _normalized_env(env, fps)
    k = np.arange(-int(period), int(period) + 1)
    kernel = np.exp(-0.5 * (k * 32.0 / period) ** 2)
    full = np.convolve(onset, kernel, mode="full")
    local = full[len(kernel) // 2: len(kernel) // 2 + len(onset)]  # centered, same length as onset
    n = len(local)
    if n < 3 * period:  # too short to have a meaningful pulse
        return np.array([], float)
    window = np.arange(-int(round(2 * period)), -int(round(period / 2)) + 1)
    txwt = -tightness * np.log(-window / period) ** 2
    cum = np.zeros(n)
    back = -np.ones(n, dtype=int)
    started = False
    thresh = 0.01 * local.max()
    for t in range(n):
        z = t + window
        valid = z >= 0
        if not valid.any():
            cum[t] = local[t]
            continue
        sc = txwt[valid] + cum[z[valid]]
        j = int(np.argmax(sc))
        cum[t] = local[t] + sc[j]
        if not started and local[t] < thresh:
            back[t] = -1
        else:
            back[t] = z[valid][j]
            started = True
    # last beat: last local maximum of cum that is reasonably large
    peaks = np.flatnonzero((cum[1:-1] > cum[:-2]) & (cum[1:-1] >= cum[2:])) + 1
    if len(peaks) == 0:
        return np.array([], float)
    med = np.median(cum[peaks])
    last = peaks[cum[peaks] >= 0.5 * med][-1]
    beats = [last]
    while back[beats[-1]] >= 0:
        beats.append(back[beats[-1]])
    beats = np.array(beats[::-1], dtype=int)
    # trim weak beats at both ends (silence, fades)
    strength = local[beats]
    th = 0.5 * np.sqrt(np.mean(strength ** 2))
    good = np.flatnonzero(strength >= th)
    if len(good):
        beats = beats[good[0]: good[-1] + 1]
    # sub-frame refinement toward a nearby onset peak (only small moves)
    refined = []
    for b in beats:
        lo, hi = max(1, b - 2), min(n - 2, b + 2)
        if hi < lo:
            refined.append(float(b))
            continue
        j = lo + int(np.argmax(onset[lo: hi + 1]))
        if onset[j] > 0.5 and abs(j - b) <= 2:
            refined.append(j + parabolic_offset(onset, j))
        else:
            refined.append(float(b))
    refined = np.array(refined)
    # tiny smoothing of the beat grid: average with linear neighbours (removes jitter, keeps drift)
    if len(refined) > 4:
        mid = 0.5 * (refined[:-2] + refined[2:])
        refined[1:-1] = 0.7 * refined[1:-1] + 0.3 * mid
    return refined


def estimate_downbeats(beat_times, onset_data, chroma_fn, loud_fn):
    """Pick meter (4 or 3) and bar phase. Returns (meter, positions array)."""
    nb = len(beat_times)
    if nb < 8:
        return 4, np.arange(nb) % 4
    kick = np.array([onset_data.at(onset_data.low, t) for t in beat_times])
    # harmonic change across each beat: chroma of the following beat vs the preceding beat
    ch = chroma_fn(beat_times)  # (nb, 12), beat-synchronous chroma (interval starting at each beat)
    prev = np.vstack([ch[:1], ch[:-1]])
    num = (ch * prev).sum(1)
    den = np.linalg.norm(ch, axis=1) * np.linalg.norm(prev, axis=1) + EPS
    hchange = 1 - num / den
    loud = loud_fn(beat_times)
    lchange = np.maximum(0, loud - np.concatenate([[loud[0]], loud[:-1]]))

    def z(v):
        return (v - v.mean()) / (v.std() + EPS)

    score = 0.35 * z(kick) + 1.0 * z(hchange) + 0.35 * z(lchange)
    best = (-1e9, 4, 0)
    for meter, bonus in ((4, 0.12), (3, 0.0)):
        for p in range(meter):
            s = score[p::meter].mean() + bonus
            if s > best[0]:
                best = (s, meter, p)
    _, meter, phase = best
    pos = (np.arange(nb) - phase) % meter
    return meter, pos


def drum_events(od):
    """Kick / snare / hat event lists: (times, strengths 0..1)."""
    out = {}
    specs = {
        "kick": (od.low, dict(window=0.05, avg=0.5, mult=1.25, min_gap=0.09, rel=0.35)),
        "snare": (od.snare, dict(window=0.02, avg=0.5, mult=1.3, min_gap=0.045, rel=0.12)),
        "hat": (od.hat, dict(window=0.025, avg=0.4, mult=1.3, min_gap=0.05, rel=0.15)),
        "onset": (od.env, dict(window=0.03, avg=0.4, mult=1.2, min_gap=0.05, rel=0.2)),
    }
    floors = {"kick": 14.0, "snare": 3.0, "hat": 2.5, "onset": 20.0}  # absolute flux floors (see tests)
    for name, (env, kw) in specs.items():
        scale = max(np.percentile(env, 99.5), floors[name] * 2.5) + EPS
        x = env / scale
        idx = pick_peaks(x, od.fps, delta=0.06, **kw)
        idx = idx[env[idx] >= floors[name]]
        times = []
        strengths = []
        for i in idx:
            times.append((i + parabolic_offset(x, i)) / od.fps - ONSET_LATENCY)
            strengths.append(min(1.0, float(x[i])))
        out[name] = (np.array(times), np.array(strengths))
    return out


def pulse_salience(env, fps, beat_frames):
    """How much stronger onsets are on the beats than halfway between them (1.0 = no pulse)."""
    if len(beat_frames) < 8:
        return 1.0
    on = _normalized_env(env, fps)
    n = len(on)

    def peak(i):
        i = int(round(i))
        return on[max(0, i - 2): min(n, i + 3)].max() if 0 <= i < n else 0.0

    beats = np.mean([peak(b) for b in beat_frames])
    mids = np.mean([peak((a + b) / 2) for a, b in zip(beat_frames[:-1], beat_frames[1:])])
    return float(beats / (mids + EPS))
