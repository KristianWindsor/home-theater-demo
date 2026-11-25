#!/usr/bin/env python3
"""
prepare_media.py - make movie files browser-playable WITHOUT losing quality.

Browsers can't decode Dolby TrueHD or DTS(-HD MA), which is the default audio track on most
Blu-ray/UHD rips, and Chrome/Firefox also skip AC-3/E-AC-3. They also play only the
first/default audio track of a file. This tool writes a copy where:

  * the video stream is copied bit-for-bit (no re-encode, HDR metadata kept)
  * the best audio track is chosen (lossless > lossy, most channels, not commentary)
  * that track is copied if browsers can decode it, otherwise decoded and stored as FLAC
    with the same channel layout and bit depth. TrueHD and DTS-HD MA are lossless codecs,
    so this conversion is lossless too (verify it with --verify).
  * chapters and tags are kept; text subtitles are extracted next to the file as .vtt
  * the result is an MP4 with the index at the front (fast seeking when streamed)

What you do lose: Dolby Atmos / DTS:X object metadata (you get the 7.1 bed the decoder
renders). For a room without height speakers that is what your receiver would play anyway.

Examples
    python3 scripts/prepare_media.py "/srv/rips/The Dark Knight (2008).mkv" -o media/movies
    python3 scripts/prepare_media.py /srv/rips -o media/movies --verify
    python3 scripts/prepare_media.py film.mkv -o out --audio 2          # force audio stream #2
    python3 scripts/prepare_media.py film.mkv -o out --downmix 5.1      # fold 7.1 into 5.1
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

VIDEO_EXT = {".mkv", ".mp4", ".m4v", ".mov", ".ts", ".m2ts", ".webm", ".avi"}
BROWSER_AUDIO = {"aac", "mp3", "flac", "opus"}          # decodable in Chrome, Edge, Firefox and Safari
DOLBY_LOSSY = {"ac3", "eac3"}                             # Edge & Safari only
BROWSER_VIDEO = {"h264", "hevc", "av1", "vp9"}            # hevc/av1 depend on the device's hardware
LOSSLESS = {"truehd", "mlp", "flac", "alac"}
TEXT_SUBS = {"subrip", "ass", "ssa", "mov_text", "webvtt", "text"}


def ffprobe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format",
                          "-show_chapters", path], capture_output=True, check=True)
    return json.loads(out.stdout)


def describe(s):
    t = s.get("tags") or {}
    bits = [s.get("codec_name", "?")]
    if s.get("profile"):
        bits.append(f"({s['profile']})")
    if s.get("channels"):
        bits.append(f"{s.get('channel_layout') or str(s['channels']) + 'ch'}")
    if t.get("language"):
        bits.append(t["language"])
    if t.get("title"):
        bits.append(f'"{t["title"]}"')
    return " ".join(bits)


def is_lossless(s):
    c = s.get("codec_name", "")
    return c in LOSSLESS or c.startswith("pcm_") or (c == "dts" and "MA" in (s.get("profile") or ""))


def score_audio(s, lang):
    t = s.get("tags") or {}
    title = (t.get("title") or "").lower()
    score = 0.0
    score += 100 if is_lossless(s) else 0
    score += 10 * (s.get("channels") or 0)
    score += 5 if (s.get("disposition") or {}).get("default") else 0
    if lang and (t.get("language") or "").lower().startswith(lang.lower()):
        score += 50
    if any(w in title for w in ("commentary", "comment", "descriptive", "description")):
        score -= 500
    return score


def bit_depth(s):
    raw = int(s.get("bits_per_raw_sample") or 0)
    if raw:
        return raw
    fmt = s.get("sample_fmt", "")
    return 16 if fmt.startswith("s16") else 24


DOWNMIX_51 = ("pan=5.1(side)|FL=FL+0.707*FLC|FR=FR+0.707*FRC|FC=FC|LFE=LFE|"
              "SL=0.707*SL+0.707*BL|SR=0.707*SR+0.707*BR")


def plan(path, args):
    info = ffprobe(path)
    streams = info.get("streams", [])
    video = [s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    subs = [s for s in streams if s.get("codec_type") == "subtitle"]
    if not video:
        raise SystemExit(f"{path}: no video stream")
    if not audio:
        raise SystemExit(f"{path}: no audio stream")
    v = video[0]
    if args.audio is not None:
        cand = [s for s in audio if s["index"] == args.audio]
        if not cand:
            raise SystemExit(f"{path}: no audio stream with index {args.audio}")
        a = cand[0]
    else:
        a = max(audio, key=lambda s: score_audio(s, args.lang))
    copy_audio = a.get("codec_name") in BROWSER_AUDIO or (args.allow_dolby and a.get("codec_name") in DOLBY_LOSSY)
    if args.downmix and (a.get("channels") or 0) > 6:
        copy_audio = False
    return info, v, a, subs, copy_audio


def build_cmd(path, out, v, a, copy_audio, args):
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", path, "-map", f"0:{v['index']}", "-map", f"0:{a['index']}",
           "-map_metadata", "0", "-map_chapters", "0", "-c:v", "copy"]
    if v.get("codec_name") == "hevc":
        cmd += ["-tag:v", "hvc1"]  # Apple/Chrome-on-Mac want hvc1 in MP4
    if copy_audio:
        cmd += ["-c:a", "copy"]
    else:
        depth = bit_depth(a)
        cmd += ["-c:a", "flac", "-compression_level", "8"]
        cmd += ["-sample_fmt", "s32", "-bits_per_raw_sample", "24"] if depth > 16 else ["-sample_fmt", "s16"]
        if args.downmix and (a.get("channels") or 0) > 6:
            cmd += ["-af", DOWNMIX_51]
    cmd += ["-disposition:a:0", "default", "-movflags", "+faststart", "-f", "mp4", out]
    return cmd


def extract_subs(path, subs, out_base):
    written = []
    for i, s in enumerate(subs):
        if s.get("codec_name") not in TEXT_SUBS:
            continue
        t = s.get("tags") or {}
        lang = t.get("language") or f"s{i}"
        forced = ".forced" if (s.get("disposition") or {}).get("forced") else ""
        dst = f"{out_base}.{lang}{forced}.vtt"
        r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", path, "-map", f"0:{s['index']}",
                            "-c:s", "webvtt", dst], capture_output=True)
        if r.returncode == 0:
            written.append(dst)
    return written


def pcm_md5(path, stream_spec, downmix=False):
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-map", stream_spec]
    if downmix:
        cmd += ["-af", DOWNMIX_51]
    cmd += ["-c:a", "pcm_s24le", "-f", "md5", "-"]  # 24-bit is the stored precision
    r = subprocess.run(cmd, capture_output=True, check=True)
    return r.stdout.decode().strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="video files or folders")
    ap.add_argument("-o", "--out-dir", required=True, help="where to write the browser-ready files")
    ap.add_argument("--audio", type=int, help="use this ffprobe stream index for audio")
    ap.add_argument("--lang", default="eng", help="preferred audio language (default: eng)")
    ap.add_argument("--allow-dolby", action="store_true",
                    help="copy AC-3/E-AC-3 instead of converting (only Edge and Safari can play it)")
    ap.add_argument("--downmix", choices=["5.1"], help="fold 7.1 into 5.1 (default keeps the original layout)")
    ap.add_argument("--verify", action="store_true", help="decode both and prove the audio samples are identical")
    ap.add_argument("--dry-run", action="store_true", help="show the plan without writing anything")
    args = ap.parse_args()

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit("ffmpeg and ffprobe must be on PATH")
    files = []
    for p in args.inputs:
        if os.path.isdir(p):
            for root, _, names in os.walk(p):
                files += [os.path.join(root, n) for n in sorted(names) if os.path.splitext(n)[1].lower() in VIDEO_EXT]
        else:
            files.append(p)
    os.makedirs(args.out_dir, exist_ok=True)
    failed = 0
    for path in files:
        base = os.path.splitext(os.path.basename(path))[0]
        out = os.path.join(args.out_dir, base + ".mp4")
        if os.path.abspath(out) == os.path.abspath(path):
            out = os.path.join(args.out_dir, base + " [browser].mp4")
        try:
            info, v, a, subs, copy_audio = plan(path, args)
        except (subprocess.CalledProcessError, SystemExit) as e:
            print(f"!! {path}: {e}", file=sys.stderr)
            failed += 1
            continue
        print(f"\n== {os.path.basename(path)}")
        print(f"   video  #{v['index']}: {describe(v)}  -> copy (bit-exact)")
        if v.get("codec_name") not in BROWSER_VIDEO:
            print(f"   !! {v.get('codec_name')} video is not playable in browsers; re-encode it separately.")
        for s in [x for x in info["streams"] if x.get("codec_type") == "audio"]:
            mark = "->" if s["index"] == a["index"] else "  "
            print(f"   {mark} audio #{s['index']}: {describe(s)}")
        if copy_audio:
            print("   audio: copied as-is (already browser-decodable)")
        else:
            extra = " (Atmos/DTS:X objects not kept; 7.1 bed is)" if "Atmos" in (a.get("profile") or "") or \
                "DTS:X" in (a.get("profile") or "") else ""
            lossy = "" if is_lossless(a) else " (source is lossy: FLAC stores its decoded output exactly, no further loss)"
            print(f"   audio: decode -> FLAC {bit_depth(a)}-bit, {a.get('channel_layout') or a.get('channels')}"
                  f"{' -> 5.1' if args.downmix and (a.get('channels') or 0) > 6 else ''}{extra}{lossy}")
        print(f"   out:   {out}")
        if args.dry_run:
            continue
        cmd = build_cmd(path, out + ".part.mp4", v, a, copy_audio, args)
        r = subprocess.run(cmd + ["-loglevel", "error", "-stats"])
        if r.returncode != 0:
            print(f"!! ffmpeg failed for {path}", file=sys.stderr)
            failed += 1
            continue
        os.replace(out + ".part.mp4", out)
        vtts = extract_subs(path, subs, os.path.splitext(out)[0])
        for v_ in vtts:
            print(f"   subs:  {v_}")
        if [s for s in subs if s.get("codec_name") not in TEXT_SUBS]:
            print("   note:  image-based subtitles (PGS/VobSub) can't be shown in a browser and were skipped")
        if args.verify:
            if copy_audio:
                print("   verify: audio was stream-copied (identical by construction)")
            else:
                src = pcm_md5(path, f"0:{a['index']}", downmix=bool(args.downmix and (a.get("channels") or 0) > 6))
                dst = pcm_md5(out, "0:a:0")
                same = src == dst
                print(f"   verify: {'IDENTICAL' if same else 'MISMATCH'} PCM ({src[-12:]} vs {dst[-12:]})")
                if not same:
                    failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
