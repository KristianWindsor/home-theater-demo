#!/usr/bin/env python3
"""
fetch_music_video.py - add a song to the music library from its YouTube music video.

YouTube sends the sound and the picture as separate streams. This keeps both exactly as YouTube serves
them (nothing is re-encoded) and writes them side by side under one name, which is how the app pairs a
song with its video:

    <out>/<Artist>/<Title>.opus   the song: tagged, analyzed and played through the speakers like any track
    <out>/<Artist>/<Title>.webm   its music video, picture only: shown instead of the visualizer, in sync
    <out>/<Artist>/<Title>.jpg    cover art: the video's thumbnail, or a frame when YouTube only has a small one

Which streams it takes:
  * audio: the best one, Opus over AAC at similar bitrates (Opus ~130 kbps for most videos); never the
    dynamic-range-compressed "DRC" copies. YouTube Premium accounts also get Opus at ~256 kbps: pass
    --cookies-from-browser chrome (or safari, firefox...) to sign in as you.
  * video: the highest *native* resolution and frame rate, HDR when there is one, YouTube's "Premium"
    1080p when it's offered (its own encode at about twice the usual bitrate; it downloads without an
    account), then VP9 over AV1 over H.264 at the same size (VP9 decodes in hardware on nearly every GPU;
    --codec changes that). YouTube's "AI-upscaled" copies of low-resolution videos are skipped unless
    --upscaled.

Needs yt-dlp with a JavaScript runtime (`brew install yt-dlp` brings deno along) and ffmpeg.

Examples
    python3 scripts/fetch_music_video.py "https://www.youtube.com/watch?v=zol2MJf6XNE" \\
        --artist "Animal Collective" --title "My Girls" --album "Merriweather Post Pavilion" --year 2009 --track 2
    python3 scripts/fetch_music_video.py URL --list                   # what's there and what would be picked
    python3 scripts/fetch_music_video.py URL --artist A --title T --upscaled --force   # redo it with the AI upscale
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

VIDEO_EXT = (".webm", ".mp4", ".mkv", ".mov", ".m4v")
CODEC_ORDER = {
    "vp9": ("vp9", "av01", "avc1"),
    "av1": ("av01", "vp9", "avc1"),
    "h264": ("avc1", "vp9", "av01"),
}


def run(cmd, capture=False):
    try:
        if capture:
            return subprocess.run(cmd, check=True, capture_output=True).stdout
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        sys.exit(f"error: {cmd[0]} not found (brew install yt-dlp ffmpeg)")
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode(errors="replace").strip() if capture else ""
        sys.exit(f"error: {cmd[0]} failed{': ' + err[-800:] if err else ''}")
    return None


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                          capture=True))


# ---------------------------------------------------------------------------------------------- picking streams
def is_upscaled(f):
    return "upscal" in (f.get("format_note") or "").lower() or str(f.get("format_id", "")).endswith("-sr")


def is_drc(f):
    return "drc" in (f.get("format_note") or "").lower() or "-drc" in str(f.get("format_id", ""))


def codec_family(vcodec):
    v = (vcodec or "").lower()
    if v.startswith(("vp9", "vp09")):
        return "vp9"
    if v.startswith("av01"):
        return "av01"
    if v.startswith(("avc1", "h264")):
        return "avc1"
    return v


def video_formats(info, allow_upscaled):
    out = []
    for f in info.get("formats") or []:
        if f.get("vcodec") in (None, "none") or f.get("acodec") not in (None, "none"):
            continue  # audio-only, or a muxed (low quality) format
        if not f.get("width") or not f.get("height") or f.get("protocol") == "mhtml":
            continue  # storyboards
        if is_upscaled(f) and not allow_upscaled:
            continue
        out.append(f)
    return out


def pick_video(info, codec, allow_upscaled):
    order = CODEC_ORDER[codec]

    def key(f):
        fam = codec_family(f.get("vcodec"))
        rank = len(order) - order.index(fam) if fam in order else 0
        hdr = 1 if (f.get("dynamic_range") or "SDR") != "SDR" else 0
        # "Premium" (1080p, enhanced bitrate) is its own encode at about twice the bitrate, and it downloads
        # without an account. The other HLS formats repeat the plain ones bit for bit, and their bitrate is the
        # peak rather than the average, so the plain download wins those ties.
        premium = 1 if "premium" in (f.get("format_note") or "").lower() else 0
        plain = 1 if f.get("protocol") == "https" else 0
        return (f["width"] * f["height"], f.get("fps") or 0, hdr, premium, rank, plain, f.get("tbr") or 0)

    fmts = video_formats(info, allow_upscaled)
    return max(fmts, key=key) if fmts else None


def audio_formats(info):
    return [f for f in info.get("formats") or []
            if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none") and not is_drc(f)]


def pick_audio(info):
    def key(f):
        abr = f.get("abr") or f.get("tbr") or 0
        opus = (f.get("acodec") or "").startswith("opus")
        # the original-language track first (dubbed videos), then quality: Opus sounds better than AAC at the
        # same bitrate, so it wins unless the AAC stream has clearly more bits
        return (f.get("language_preference") or 0, abr * (1.25 if opus else 1.0), f.get("asr") or 0)

    fmts = audio_formats(info)
    return max(fmts, key=key) if fmts else None


def describe(f):
    if f.get("vcodec") not in (None, "none"):
        note = f" [{f['format_note']}]" if f.get("format_note") else ""
        return (f"{f['format_id']}: {codec_family(f.get('vcodec'))} {f['width']}x{f['height']} {f.get('fps') or '?'} fps "
                f"{f.get('dynamic_range') or 'SDR'} ~{round(f.get('tbr') or 0)} kbps{note}")
    return (f"{f['format_id']}: {(f.get('acodec') or '').split('.')[0]} ~{round(f.get('abr') or f.get('tbr') or 0)} kbps "
            f"{(f.get('asr') or 0) / 1000:g} kHz {f.get('audio_channels') or '?'}ch")


# ---------------------------------------------------------------------------------------------- writing files
def safe_name(s):
    s = re.sub(r'[/\\:*?"<>|\x00-\x1f]', "-", s).strip().strip(".")
    return re.sub(r"\s+", " ", s) or "untitled"


def write_audio(src, dst_base, tags, info):
    codec = probe(src)["streams"][0]["codec_name"]
    ext, extra = {"opus": (".opus", []), "aac": (".m4a", ["-movflags", "+faststart"])}.get(codec, (".mka", []))
    meta = []
    for k, v in tags.items():
        if v:
            meta += ["-metadata", f"{k}={v}"]
    meta += ["-metadata", f"comment=From {info.get('webpage_url') or ''}".strip()]
    dst = dst_base + ext
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", src, "-map", "0:a:0", "-c", "copy", "-map_metadata", "-1",
         "-map_chapters", "-1", *meta, *extra, dst])
    return dst


def write_video(src, dst_base):
    codec = probe(src)["streams"][0]["codec_name"]
    if codec == "vp9":
        dst, extra = dst_base + ".webm", ["-cues_to_front", "1"]
    else:
        dst, extra = dst_base + ".mp4", ["-movflags", "+faststart"]
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", src, "-map", "0:v:0", "-c", "copy", "-map_metadata", "-1",
         "-map_chapters", "-1", *extra, dst])
    return dst


def write_cover(thumb, video, dst):
    """YouTube's thumbnail when it's a proper 16:9 picture; a representative frame from the video otherwise."""
    if thumb:
        s = probe(thumb)["streams"][0]
        if s.get("width", 0) >= 1280 and abs(s["width"] / s["height"] - 16 / 9) < 0.05:
            run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", thumb, "-frames:v", "1", "-q:v", "2", dst])
            return dst, "thumbnail"
    duration = float(probe(video)["format"].get("duration") or 0)
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", f"{duration * 0.3:.2f}", "-i", video,
         "-vf", "thumbnail=96,scale='min(1920,iw)':-2", "-frames:v", "1", "-q:v", "2", dst])
    return dst, "frame from the video"


def size(path):
    return f"{os.path.getsize(path) / 1e6:.1f} MB"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("--artist")
    ap.add_argument("--title")
    ap.add_argument("--album", default="")
    ap.add_argument("--year", default="")
    ap.add_argument("--track", default="")
    ap.add_argument("-o", "--out", default="media/music", help="music folder (default: media/music)")
    ap.add_argument("--codec", choices=sorted(CODEC_ORDER), default="vp9", help="preferred video codec at equal size")
    ap.add_argument("--upscaled", action="store_true", help="allow YouTube's AI-upscaled video")
    ap.add_argument("--cookies-from-browser", metavar="BROWSER", help="sign in as you (YouTube Premium streams)")
    ap.add_argument("--list", action="store_true", help="show the streams and the picks, download nothing")
    ap.add_argument("--force", action="store_true", help="replace files that are already there")
    args = ap.parse_args()

    ytdlp = ["yt-dlp", "--no-playlist", "--no-warnings"]
    if args.cookies_from_browser:
        ytdlp += ["--cookies-from-browser", args.cookies_from_browser]
    info = json.loads(run([*ytdlp, "-J", args.url], capture=True))
    video = pick_video(info, args.codec, args.upscaled)
    audio = pick_audio(info)
    print(f"{info.get('title')}  ({info.get('channel') or info.get('uploader')}, {info.get('duration')} s)")
    if args.list:
        print("video streams:")
        for f in sorted(video_formats(info, True), key=lambda f: (f["width"] * f["height"], f.get("tbr") or 0)):
            print(f"  {'*' if f is video else ' '} {describe(f)}")
        print("audio streams:")
        for f in sorted(audio_formats(info), key=lambda f: f.get("abr") or f.get("tbr") or 0):
            print(f"  {'*' if f is audio else ' '} {describe(f)}")
        return
    if not audio:
        sys.exit("error: no audio stream")
    if not args.artist or not args.title:
        sys.exit("error: --artist and --title are required (YouTube titles are too inconsistent to guess from)")

    folder = os.path.join(args.out, safe_name(args.artist))
    base = os.path.join(folder, safe_name(args.title))
    existing = [p for p in glob.glob(glob.escape(base) + ".*") if os.path.splitext(p)[1].lower() in
                (".opus", ".m4a", ".mka", ".jpg", *VIDEO_EXT)]
    if existing and not args.force:
        sys.exit("error: already there (--force replaces it):\n  " + "\n  ".join(existing))

    print(f"audio  {describe(audio)}")
    print(f"video  {describe(video) if video else '(none)'}")
    with tempfile.TemporaryDirectory(prefix="fetch-music-video-") as tmp:
        fmt = audio["format_id"] + (f",{video['format_id']}" if video else "")
        run([*ytdlp, "-f", fmt, "--no-mtime", "--write-thumbnail", "--convert-thumbnails", "jpg",
             "-o", os.path.join(tmp, "%(format_id)s.%(ext)s"), "-o", "thumbnail:" + os.path.join(tmp, "thumb.%(ext)s"),
             args.url])
        files = {os.path.basename(p).split(".")[0]: p for p in glob.glob(os.path.join(tmp, "*"))}
        thumb = os.path.join(tmp, "thumb.jpg") if os.path.exists(os.path.join(tmp, "thumb.jpg")) else None
        os.makedirs(folder, exist_ok=True)
        for p in existing:
            os.remove(p)
        tags = {"title": args.title, "artist": args.artist, "album": args.album, "date": str(args.year),
                "track": str(args.track)}
        saved = [write_audio(files[audio["format_id"]], base, tags, info)]
        how = "thumbnail"
        if video:
            vfile = files[video["format_id"]]
            saved.append(write_video(vfile, base))
            cover, how = write_cover(thumb, vfile, base + ".jpg")
            saved.append(cover)
        elif thumb:
            shutil.copyfile(thumb, base + ".jpg")
            saved.append(base + ".jpg")
    for p in saved:
        print(f"  saved {p}  ({size(p)}{', ' + how if p.endswith('.jpg') else ''})")
    print("The app pairs them by name; the library picks them up on its next rescan.")


if __name__ == "__main__":
    main()
