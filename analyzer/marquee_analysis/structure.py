"""Musical form: self-similarity, novelty segmentation, repeated-section labels, builds and drops."""
import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.ndimage import uniform_filter1d

from .dsp import EPS, robust_unit


def beat_sync(feat, frame_times, beat_times, end_time):
    """Mean of frame features over each beat interval [b_i, b_{i+1})."""
    bounds = np.concatenate([beat_times, [end_time]])
    idx = np.searchsorted(frame_times, bounds)
    out = np.empty((len(beat_times),) + feat.shape[1:], dtype=np.float32)
    for i in range(len(beat_times)):
        a, b = idx[i], max(idx[i] + 1, idx[i + 1])
        a = min(a, len(feat) - 1)
        out[i] = feat[a:b].mean(axis=0)
    return out


def _cos_ssm(X):
    n = np.linalg.norm(X, axis=1, keepdims=True) + EPS
    Y = X / n
    return np.clip(Y @ Y.T, 0, 1)


def _rbf_ssm(X):
    d2 = np.maximum(0, (X ** 2).sum(1)[:, None] + (X ** 2).sum(1)[None, :] - 2 * X @ X.T)
    med = np.median(d2[np.triu_indices(len(X), 1)]) if len(X) > 1 else 1.0
    return np.exp(-d2 / (med + EPS))


def _path_enhance(S, length=8):
    """Average along diagonals (centered, so boundaries are not shifted): emphasizes
    repeated sequences over isolated coincidences."""
    n = len(S)
    out = np.zeros_like(S)
    cnt = np.zeros_like(S)
    half = length // 2
    for k in range(-half, length - half):
        if k >= 0:
            out[: n - k, : n - k] += S[k:, k:]
            cnt[: n - k, : n - k] += 1
        else:
            out[-k:, -k:] += S[: n + k, : n + k]
            cnt[-k:, -k:] += 1
    return out / np.maximum(cnt, 1)


def foote_novelty(S, half):
    n = len(S)
    a = np.arange(-half, half) + 0.5
    g = np.exp(-0.5 * (a / (half * 0.5)) ** 2)
    sign = np.sign(a)
    kernel = np.outer(sign, sign) * np.outer(g, g)
    P = np.pad(S, half, mode="edge")
    nov = np.empty(n)
    for i in range(n):
        nov[i] = (P[i: i + 2 * half, i: i + 2 * half] * kernel).sum()
    nov = np.maximum(nov, 0)
    return nov / (nov.max() + EPS)


def segment(beat_times, beat_pos, meter, feats, duration, frame_times, intensity_curve, onset_times,
            bass_curve=None):
    """Return a list of section dicts covering [0, duration]."""
    nb = len(beat_times)
    if nb < 24:
        return [dict(start=0.0, end=duration, label=0, intensity=float(np.mean(intensity_curve)), kind="section",
                     beats=[0, nb])]
    chroma_b = feats["chroma"]
    mfcc_b = (feats["mfcc"] - feats["mfcc"].mean(0)) / (feats["mfcc"].std(0) + EPS)
    energy_b = feats["energy"]
    energy_b = (energy_b - energy_b.mean(0)) / (energy_b.std(0) + EPS)

    S = 0.30 * _cos_ssm(chroma_b) + 0.40 * _rbf_ssm(mfcc_b) + 0.30 * _rbf_ssm(energy_b)
    S = _path_enhance(S, length=4)

    beats_per_bar = meter
    nov = foote_novelty(S, half=4 * beats_per_bar) + 0.6 * foote_novelty(S, half=2 * beats_per_bar)
    nov /= nov.max() + EPS

    # candidate boundaries: local maxima over +-2 bars above an adaptive threshold
    w = 2 * beats_per_bar
    cands = []
    for i in range(1, nb - 1):
        lo, hi = max(0, i - w), min(nb, i + w + 1)
        if nov[i] >= nov[lo:hi].max() and nov[i] > np.median(nov) + 0.18 * (nov.max() - np.median(nov)):
            cands.append(i)
    # snap to downbeats (within one beat either side) and enforce a minimum length of 3 bars
    down = np.flatnonzero(beat_pos == 0)
    snapped = []
    for i in sorted(cands, key=lambda j: -nov[j]):
        if len(down):
            near = down[np.abs(down - i) <= beats_per_bar // 2]
            if len(near):
                i = int(near[np.argmax(nov[near] - 0.02 * np.abs(near - i))])
        if i < 2 * beats_per_bar or i > nb - 2 * beats_per_bar:
            continue
        if all(abs(i - s) >= 3 * beats_per_bar for s in snapped):
            snapped.append(i)
    bounds = [0] + sorted(snapped) + [nb]

    # section-level similarity for labels: normalized block means of the (unenhanced) SSM
    segs = [(bounds[k], bounds[k + 1]) for k in range(len(bounds) - 1)]
    m = len(segs)
    labels = list(range(m))
    if m > 1:
        block = np.zeros((m, m))
        for a, (a0, a1) in enumerate(segs):
            for b, (b0, b1) in enumerate(segs):
                block[a, b] = S[a0:a1, b0:b1].mean()
        dself = np.sqrt(np.outer(np.diag(block), np.diag(block)))
        sim = block / (dself + EPS)
        dist = np.clip(1 - sim, 0, None)
        iu = np.triu_indices(m, 1)
        cond = dist[iu]
        Z = linkage(cond, method="average")
        thr = min(0.10, 0.45 * float(np.median(cond)))
        raw = fcluster(Z, t=max(thr, 1e-3), criterion="distance")
        remap = {}
        labels = []
        for r in raw:
            remap.setdefault(r, len(remap))
            labels.append(remap[r])

    # build output with times, intensity and descriptors
    sections = []
    for k, (a, b) in enumerate(segs):
        start = 0.0 if a == 0 else float(beat_times[a])
        end = duration if b >= nb else float(beat_times[b])
        fm = (frame_times >= start) & (frame_times < end)
        inten = float(intensity_curve[fm].mean()) if fm.any() else 0.0
        seg_len = max(end - start, 1e-3)
        dens = float(((onset_times >= start) & (onset_times < end)).sum() / seg_len)
        # trend: intensity over the last third vs first third
        third = max(1, fm.sum() // 3)
        curve = intensity_curve[fm] if fm.any() else np.zeros(3)
        trend = float(curve[-third:].mean() - curve[:third].mean()) if len(curve) >= 3 else 0.0
        sections.append(dict(start=round(start, 3), end=round(end, 3), label=int(labels[k]),
                             intensity=round(inten, 3), density=round(dens, 2), trend=round(trend, 3),
                             beats=[int(a), int(b)], novelty=round(float(nov[a]) if a > 0 else 1.0, 3)))
    _classify(sections, intensity_curve, frame_times, bass_curve if bass_curve is not None else intensity_curve)
    return sections


def _classify(sections, curve, frame_times, bass):
    """Heuristic section roles. Drops are recognised by the bass coming back in hard;
    builds by rising intensity/brightness into a drop or a clearly bigger section."""
    if not sections:
        return
    hi_thr = np.percentile(curve, 66)
    med = np.median(curve)
    counts = {}
    for s in sections:
        counts[s["label"]] = counts.get(s["label"], 0) + 1

    def mean_in(sig, a, b):
        m = (frame_times >= a) & (frame_times < b)
        return float(sig[m].mean()) if m.any() else 0.0

    n = len(sections)
    for i, s in enumerate(sections):
        prv = sections[i - 1] if i > 0 else None
        s["entryJump"] = round(mean_in(curve, s["start"], s["start"] + 4) - mean_in(curve, s["start"] - 4, s["start"]), 3) if prv else 0.0
        s["bassJump"] = round(mean_in(bass, s["start"], s["start"] + 4) - mean_in(bass, s["start"] - 4, s["start"]), 3) if prv else 0.0
        s["bass"] = round(mean_in(bass, s["start"], s["end"]), 3)
    for i, s in enumerate(sections):
        s["kind"] = None
        nxt = sections[i + 1] if i + 1 < n else None
        if nxt and s["trend"] > 0.1 and nxt["intensity"] >= s["intensity"] - 0.05 and \
                (nxt["bassJump"] >= 0.15 or nxt["entryJump"] >= 0.1):
            s["kind"] = "build"
    for i, s in enumerate(sections):
        if s["kind"]:
            continue
        prv = sections[i - 1] if i > 0 else None
        after_build = bool(prv) and prv["kind"] == "build" and (s["bassJump"] >= 0.1 or s["entryJump"] >= 0.05)
        slam = bool(prv) and s["trend"] <= 0.1 and s["intensity"] >= hi_thr - 0.05 and \
            (s["bassJump"] >= 0.35 or s["entryJump"] >= 0.3)
        if s["intensity"] >= med and (after_build or slam):
            s["kind"] = "drop"
    for i, s in enumerate(sections):
        if s["kind"]:
            continue
        prv = sections[i - 1] if i > 0 else None
        nxt = sections[i + 1] if i + 1 < n else None
        kind = "verse"
        if i == 0 and s["intensity"] < max(med, 0.5):
            kind = "intro"
        elif i == n - 1 and (s["intensity"] < med or s["trend"] < -0.1):
            kind = "outro"
        elif prv and nxt and s["intensity"] < min(prv["intensity"], nxt["intensity"]) - 0.1:
            kind = "break"
        elif s["intensity"] >= hi_thr and counts[s["label"]] > 1:
            kind = "chorus"
        elif s["intensity"] >= hi_thr:
            kind = "peak"
        s["kind"] = kind
    # trailing sections that only fade out are the outro
    for s in reversed(sections[1:]):
        if s["kind"] in ("verse", "outro", "break") and (s["trend"] < -0.08 or s["intensity"] < med):
            s["kind"] = "outro"
        else:
            break


def builds_and_drops(sections):
    builds, drops = [], []
    for i, s in enumerate(sections):
        if s["kind"] == "build":
            builds.append(dict(start=s["start"], end=s["end"], strength=round(min(1.0, max(0.2, s["trend"] * 2.5)), 3)))
        if s["kind"] == "drop":
            jump = max(s.get("entryJump", 0), s.get("bassJump", 0))
            drops.append(dict(t=s["start"], strength=round(float(np.clip(0.35 + jump * 1.2, 0.3, 1.0)), 3)))
    return builds, drops


def intensity_curve(loud_db, bass_db, bright, onset_env_50, fps):
    """Frame-level 0..1 musical intensity (honest within the track)."""
    dens = uniform_filter1d(onset_env_50, size=max(1, int(fps * 2.0)), mode="nearest")
    lo = robust_unit(uniform_filter1d(loud_db, size=max(1, int(fps * 0.5)), mode="nearest"), 3, 99)
    ba = robust_unit(uniform_filter1d(bass_db, size=max(1, int(fps * 0.5)), mode="nearest"), 3, 99)
    de = robust_unit(dens, 3, 99)
    br = robust_unit(uniform_filter1d(bright, size=max(1, int(fps * 1.0)), mode="nearest"), 3, 99)
    return (0.45 * lo + 0.25 * ba + 0.18 * de + 0.12 * br).astype(np.float32)


def find_moments(sections, drops, onset_events, frame_times, loud_db, duration, max_per_minute=6):
    moments = [dict(t=d["t"], s=d["strength"], type="drop") for d in drops]
    t, s = onset_events
    if len(t):
        # impacts: strongest onsets with a sharp loudness rise
        thr = np.percentile(s, 92) if len(s) > 20 else s.max()
        cand = []
        for ti, si in zip(t, s):
            if si < thr:
                continue
            i = int(np.searchsorted(frame_times, ti))
            j0 = max(0, i - 12)
            rise = float(loud_db[min(len(loud_db) - 1, i + 3)] - loud_db[j0: i].mean()) if i > j0 else 0.0
            if rise > 5.0:
                cand.append((si * min(1.0, rise / 15.0), ti))
        cand.sort(reverse=True)
        limit = max(1, int(duration / 60.0 * max_per_minute))
        taken = [m["t"] for m in moments]
        for score, ti in cand:
            if len([m for m in moments if m["type"] == "impact"]) >= limit:
                break
            if all(abs(ti - x) > 4.0 for x in taken):
                moments.append(dict(t=round(float(ti), 3), s=round(float(min(1.0, score + 0.3)), 3), type="impact"))
                taken.append(ti)
    if sections:
        top = max(sections, key=lambda x: x["intensity"])
        if all(abs(top["start"] - m["t"]) > 2.0 for m in moments) and top["start"] > 0:
            moments.append(dict(t=top["start"], s=0.8, type="climax"))
    moments.sort(key=lambda m: m["t"])
    return moments
