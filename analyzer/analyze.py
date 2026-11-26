#!/usr/bin/env python3
"""
KW 5.1 analyzer: audio file -> choreography score JSON for the visualizer.

    python3 analyzer/analyze.py song.flac -o song.score.json
    python3 analyzer/analyze.py media/music --out-dir data/scores     # whole folder (by file name)

The server runs this automatically for new tracks; you only need the CLI to
pre-analyze a library or to inspect results (use --summary).
"""
import argparse
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kw51_analysis.pipeline import analyze  # noqa: E402

AUDIO_EXT = {".flac", ".mp3", ".m4a", ".aac", ".wav", ".aif", ".aiff", ".ogg", ".opus", ".wma", ".alac", ".ape",
             ".wv", ".dsf", ".dff", ".mka"}


def write_atomic(path, data):
    d = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, path)


def summarize(score):
    g = score["global"]
    lines = [
        f"{score['tags'].get('artist') or '?'} - {score['tags'].get('title') or score['source']['file']}",
        f"  {g['bpm']} BPM ({g['meter']}/4, clarity {g['tempoClarity']}), key {g['key']} {g['mode']} "
        f"(conf {g['keyConfidence']}), tuning {g['tuningCents']:+} c",
        f"  {g['loudnessLUFS']} LUFS, DR {g['dynamicRange']} dB, energy {g['energy']}, valence~{g['valence']}",
        f"  {len(score['beats']['t'])} beats, " + ", ".join(f"{len(v['t'])} {k}" for k, v in score["events"].items()),
        "  sections:",
    ]
    for s in score["sections"]:
        lines.append(f"    {s['start']:7.2f}-{s['end']:7.2f}  [{chr(65 + s['label'] % 26)}] {s['kind']:<7} "
                     f"intensity {s['intensity']:.2f} trend {s['trend']:+.2f}")
    for d in score["drops"]:
        lines.append(f"  drop @ {d['t']:.2f} (strength {d['strength']})")
    for b in score["builds"]:
        lines.append(f"  build {b['start']:.2f}-{b['end']:.2f}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="audio file or folder")
    ap.add_argument("-o", "--output", help="output JSON (single file mode)")
    ap.add_argument("--out-dir", help="output folder (folder mode); files are named <input name>.score.json")
    ap.add_argument("--progress", action="store_true", help="emit JSON progress lines on stdout")
    ap.add_argument("--summary", action="store_true", help="print a human-readable summary")
    args = ap.parse_args()

    def emit(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    def cb(stage, p):
        if args.progress:
            emit({"type": "progress", "stage": stage, "progress": round(p, 3)})

    if os.path.isdir(args.input):
        out_dir = args.out_dir or args.input
        files = []
        for root, _, names in os.walk(args.input):
            for n in sorted(names):
                if os.path.splitext(n)[1].lower() in AUDIO_EXT:
                    files.append(os.path.join(root, n))
        for i, f in enumerate(files):
            out = os.path.join(out_dir, os.path.relpath(f, args.input) + ".score.json")
            t0 = time.time()
            try:
                score = analyze(f)
                write_atomic(out, score)
                print(f"[{i + 1}/{len(files)}] {f} ({time.time() - t0:.1f}s)", file=sys.stderr)
                if args.summary:
                    print(summarize(score), file=sys.stderr)
            except Exception as e:  # keep going on bad files
                print(f"[{i + 1}/{len(files)}] FAILED {f}: {e}", file=sys.stderr)
        return 0

    out = args.output or (args.input + ".score.json")
    t0 = time.time()
    try:
        score = analyze(args.input, cb)
    except Exception as e:
        if args.progress:
            emit({"type": "error", "message": str(e)})
        print(f"analysis failed: {e}", file=sys.stderr)
        return 1
    write_atomic(out, score)
    if args.progress:
        emit({"type": "done", "output": out, "seconds": round(time.time() - t0, 2)})
    if args.summary:
        print(summarize(score), file=sys.stderr)
        print(f"  ({time.time() - t0:.1f}s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
