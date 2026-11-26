#!/usr/bin/env python3
"""
Accuracy test against a synthesized track with sample-exact ground truth.

    python3 analyzer/tests/test_analyzer.py            # prints a report, exit 1 on regression
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))

from kw51_analysis.pipeline import analyze  # noqa: E402


def match(det, ref, tol):
    """Greedy one-to-one matching -> (hits, precision, recall, f1, abs errors)."""
    det = np.sort(np.asarray(det, float))
    used = np.zeros(len(det), bool)
    errs = []
    for r in ref:
        if len(det) == 0:
            break
        i = int(np.argmin(np.abs(det - r) + used * 1e9))
        if not used[i] and abs(det[i] - r) <= tol:
            used[i] = True
            errs.append(det[i] - r)
    hits = len(errs)
    p = hits / max(1, len(det))
    r = hits / max(1, len(ref))
    f = 2 * p * r / max(1e-9, p + r)
    return hits, p, r, f, np.abs(errs)


def main():
    tmp = tempfile.mkdtemp(prefix="kw51-test-")
    song = os.path.join(tmp, "neon.flac")
    truth_path = os.path.join(tmp, "truth.json")
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "synth_song.py"), song, "--truth", truth_path],
                   check=True)
    truth = json.load(open(truth_path))
    sc = analyze(song)
    g = sc["global"]
    failures = []

    def check(name, ok, detail):
        print(f"  [{'ok' if ok else 'FAIL'}] {name}: {detail}")
        if not ok:
            failures.append(name)

    print("KW 5.1 analyzer accuracy report")
    err = abs(g["bpm"] - truth["bpm"]) / truth["bpm"]
    check("tempo", err < 0.01, f"{g['bpm']} BPM vs {truth['bpm']} ({err * 100:.2f}% off)")

    bt = np.array(sc["beats"]["t"])
    hits, p, r, f, errs = match(bt, truth["beats"], 0.07)
    check("beats", f > 0.95 and np.median(errs) < 0.012,
          f"F={f:.3f}, median |err| {np.median(errs) * 1000:.1f} ms, p95 {np.percentile(errs, 95) * 1000:.1f} ms")

    pos = np.array(sc["beats"]["pos"])
    hits, p, r, f, _ = match(bt[pos == 0], truth["downbeats"], 0.07)
    check("downbeats", f > 0.9, f"F={f:.3f} (meter {g['meter']})")

    true_bounds = [s["start"] for s in truth["sections"][1:]]
    det_bounds = [s["start"] for s in sc["sections"][1:]]
    hits, p, r, f, errs = match(det_bounds, true_bounds, 0.5)
    check("section boundaries", r >= 0.85, f"recall {r:.2f}, precision {p:.2f}, "
                                            f"max err {errs.max() * 1000 if len(errs) else 0:.0f} ms")

    drops = [d["t"] for d in sc["drops"]]
    hits, p, r, f, _ = match(drops, truth["drops"], 0.6)
    check("drops", r == 1.0 and p >= 0.66, f"found {drops} vs {truth['drops']}")

    def label_at(t):
        for s in sc["sections"]:
            if s["start"] <= t + 0.3 < s["end"]:
                return s["label"]
        return None

    l1, l2 = label_at(truth["drops"][0]), label_at(truth["drops"][1])
    check("repeated drop shares a label", l1 is not None and l1 == l2, f"labels {l1} / {l2}")

    builds = sc["builds"]
    ok = all(any(abs(b["end"] - tb[1]) < 0.6 for b in builds) for tb in truth["builds"])
    check("builds", ok, f"found {[(b['start'], b['end']) for b in builds]} vs {truth['builds']}")

    key = f"{g['key']} {g['mode']}"
    check("key", key in ("A minor", "C major"), f"{key} (confidence {g['keyConfidence']})")

    for name, tol, need in (("kick", 0.03, 0.85), ("hat", 0.03, 0.6)):
        hits, p, r, f, errs = match(sc["events"][name]["t"], truth[name], tol)
        check(f"{name} events", f >= need,
              f"P={p:.2f} R={r:.2f} F={f:.2f} ({len(sc['events'][name]['t'])} found / {len(truth[name])} true)")
    # snare rolls at 32nd notes (60 ms apart) intentionally merge into one gesture; score the rest
    sn = np.array(truth["snare"])
    spaced = sn[np.diff(np.concatenate([[-1.0], sn])) >= 0.1]
    det = sc["events"]["snare"]["t"]
    _, p, _, _, _ = match(det, sn, 0.03)
    _, _, r, _, _ = match(det, spaced, 0.03)
    check("snare events", p >= 0.85 and r >= 0.85, f"P={p:.2f}, R={r:.2f} on hits >=100 ms apart")

    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
