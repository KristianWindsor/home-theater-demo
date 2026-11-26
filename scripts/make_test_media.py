#!/usr/bin/env python3
"""
Generate original, copyright-free test media so KW5.1 works before you add your own files.

    python3 scripts/make_test_media.py media

Creates
  music/KW5.1 Synth Lab/Neon Cathedral.flac   124 BPM EDM track with builds and drops
  music/KW5.1 Synth Lab/Glass Tide.flac       beatless ambient piece
  demos/Channel Identification 5.1.mp4          each speaker in turn, AAC 5.1 (plays everywhere)
  movies/Countdown Test Film (2026).mkv         H.264 + TrueHD 5.1 (default) + AC-3 5.1 + chapters:
                                                the typical Blu-ray rip that browsers can't play
  movies/Countdown Test Film (2026).mp4         the same, run through prepare_media.py (FLAC 5.1)
Needs: python3, numpy, scipy, ffmpeg.
"""
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import synth_song  # noqa: E402

SR = 48000
FONTS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
         "/usr/share/fonts/opentype/inter/Inter-Bold.otf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
         "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf",
         "C:/Windows/Fonts/arialbd.ttf"]


def font():
    for f in FONTS:
        if os.path.exists(f):
            return f
    try:
        out = subprocess.run(["fc-match", "-f", "%{file}", "sans:bold"], capture_output=True, text=True)
        if out.returncode == 0 and os.path.exists(out.stdout.strip()):
            return out.stdout.strip()
    except FileNotFoundError:
        pass
    return None


def esc(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\u2019")


def drawtext(text, size, y, start=None, end=None, color="white", fontfile=None):
    if not fontfile:
        return None
    en = f":enable='between(t,{start},{end})'" if start is not None else ""
    return (f"drawtext=fontfile='{fontfile}':text='{esc(text)}':fontsize={size}:fontcolor={color}"
            f":x=(w-text_w)/2:y={y}{en}")


def pink(n, rng):
    """Voss-McCartney-ish pink noise via spectral shaping."""
    w = rng.standard_normal(n)
    f = np.fft.rfft(w)
    k = np.arange(len(f))
    k[0] = 1
    f /= np.sqrt(k)
    x = np.fft.irfft(f, n)
    return (x / (np.max(np.abs(x)) + 1e-9)).astype(np.float32)


def run_ffmpeg(args, audio=None):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-thread_queue_size", "64"] + args,
                       input=audio, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("ffmpeg failed:\n" + r.stderr.decode(errors="replace")[-1500:])


def channel_id(path, fontfile):
    """5.1 channel identification: pink noise (LFE: 30-80 Hz rumble) in one speaker at a time."""
    order = [("FRONT LEFT", 0), ("CENTER", 2), ("FRONT RIGHT", 1), ("SURROUND RIGHT", 5), ("SURROUND LEFT", 4),
             ("SUBWOOFER (LFE)", 3)]
    seg = 4.0
    total = seg * len(order) + 1.0
    rng = np.random.default_rng(1)
    n = int(total * SR)
    audio = np.zeros((n, 6), np.float32)
    from scipy import signal
    for i, (_, ch) in enumerate(order):
        a, b = int((i * seg + 0.4) * SR), int((i * seg + seg - 0.4) * SR)
        x = pink(b - a, rng) * 0.35
        if ch == 3:
            sos = signal.butter(4, [30 / (SR / 2), 80 / (SR / 2)], "bandpass", output="sos")
            x = signal.sosfilt(sos, rng.standard_normal(b - a)).astype(np.float32)
            x = x / np.max(np.abs(x)) * 0.5
        env = np.minimum(1, np.minimum(np.arange(b - a), np.arange(b - a)[::-1]) / (0.05 * SR))
        audio[a:b, ch] = x * env
    filters = []
    for i, (label, _) in enumerate(order):
        f1 = drawtext(label, 84, "(h/2)-70", i * seg, (i + 1) * seg, fontfile=fontfile)
        f2 = drawtext(f"channel {i + 1} of 6", 30, "(h/2)+40", i * seg, (i + 1) * seg, "0x8899aa", fontfile)
        filters += [f for f in (f1, f2) if f]
    vf = ",".join(filters) or "null"
    run_ffmpeg(["-f", "lavfi", "-i", f"color=c=0x0b0d12:s=1280x720:r=30:d={total}",
                "-f", "f32le", "-ar", str(SR), "-ac", "6", "-channel_layout", "5.1(side)", "-i", "-",
                "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "384k", "-shortest", "-movflags", "+faststart",
                "-metadata", "title=Channel Identification 5.1", path], audio.tobytes())


def soundtrack(seconds):
    """A 5.1 mix: the EDM test track spread into the room plus a fly-around effect."""
    y, _ = synth_song.render()
    from scipy import signal
    y = signal.resample_poly(y, 160, 147, axis=0).astype(np.float32)  # 44.1k -> 48k
    y = y[: int(seconds * SR)]
    n = len(y)
    L, R = y[:, 0], y[:, 1]
    mono = (L + R) * 0.5
    lfe = signal.sosfilt(signal.butter(4, 100 / (SR / 2), "lowpass", output="sos"), mono).astype(np.float32)
    d = int(0.012 * SR)
    sl = np.concatenate([np.zeros(d, np.float32), L[:-d]]) * 0.55
    sr = np.concatenate([np.zeros(d, np.float32), R[:-d]]) * 0.55
    out = np.stack([L * 0.8, R * 0.8, mono * 0.45, lfe * 0.9, sl, sr], axis=1)
    # fly-around between 30 s and 60 s: a whooshing tone circling FL -> FR -> SR -> SL
    t = np.arange(n) / SR
    m = (t >= 30) & (t < 60)
    tt = t[m] - 30
    rng = np.random.default_rng(3)
    noise = signal.sosfilt(signal.butter(2, [400 / (SR / 2), 3000 / (SR / 2)], "bandpass", output="sos"),
                           rng.standard_normal(m.sum())).astype(np.float32)
    src = (np.sin(2 * np.pi * (220 + 60 * np.sin(tt * 3)) * tt) * 0.3 + noise * 0.6) * 0.5
    ang = tt * 2 * np.pi / 6.0  # one lap every 6 s
    spk = np.array([-30, 30, 110, -110]) * np.pi / 180  # FL FR SR SL azimuths
    chans = [0, 1, 5, 4]
    for az, ch in zip(spk, chans):
        g = np.clip(np.cos(ang - az), 0, 1) ** 2
        out[m, ch] += src * g
    out /= max(1.0, np.max(np.abs(out)) / 0.95)
    return out.astype(np.float32)


def movie(path_mkv, fontfile):
    seconds = 150
    chapters = [(0, "Opening Titles"), (30, "Fly-Around"), (60, "The Drop"), (93, "Breakdown"), (116, "Second Drop")]
    audio = soundtrack(seconds)
    tmpdir = tempfile.mkdtemp()
    meta = os.path.join(tmpdir, "chapters.txt")
    with open(meta, "w") as f:
        f.write(";FFMETADATA1\ntitle=Countdown Test Film\n")
        for i, (s, title) in enumerate(chapters):
            e = chapters[i + 1][0] if i + 1 < len(chapters) else seconds
            f.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={s * 1000}\nEND={e * 1000}\ntitle={title}\n")
    filters = []
    for i, (s, title) in enumerate(chapters):
        e = chapters[i + 1][0] if i + 1 < len(chapters) else seconds
        f = drawtext(title.upper(), 64, "h-150", s, e, fontfile=fontfile)
        if f:
            filters.append(f)
    tc = drawtext("%{pts\\:hms}", 40, "40", fontfile=fontfile)
    if tc:
        filters.append(tc.replace(esc("%{pts\\:hms}"), "%{pts\\:hms}"))
    vf = ",".join(filters) or "null"
    run_ffmpeg(["-f", "lavfi", "-i", f"testsrc2=s=1280x720:r=24:d={seconds}",
                "-f", "f32le", "-ar", str(SR), "-ac", "6", "-channel_layout", "5.1(side)", "-i", "-",
                "-i", meta, "-map", "0:v", "-map", "1:a", "-map", "1:a", "-map_metadata", "2", "-map_chapters", "2",
                "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
                "-c:a:0", "truehd", "-strict", "-2", "-c:a:1", "ac3", "-b:a:1", "640k",
                "-metadata:s:a:0", "title=TrueHD 5.1", "-metadata:s:a:0", "language=eng",
                "-metadata:s:a:1", "title=Dolby Digital 5.1", "-metadata:s:a:1", "language=eng",
                "-disposition:a:0", "default", "-disposition:a:1", "0", path_mkv], audio.tobytes())
    shutil.rmtree(tmpdir, ignore_errors=True)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "media"
    for d in ("music/KW5.1 Synth Lab", "demos", "movies"):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    fontfile = font()
    if not fontfile:
        print("note: no TTF font found; videos will have no captions", file=sys.stderr)

    p = os.path.join(out, "music/KW5.1 Synth Lab/Neon Cathedral.flac")
    print("music: Neon Cathedral")
    y, _ = synth_song.render()
    synth_song.encode(y, p, "Neon Cathedral", "Synthesized test track (124 BPM, A minor)")
    p = os.path.join(out, "music/KW5.1 Synth Lab/Glass Tide.flac")
    print("music: Glass Tide")
    synth_song.encode(synth_song.render_ambient(), p, "Glass Tide", "Synthesized beatless ambient piece")

    print("demo: Channel Identification 5.1")
    channel_id(os.path.join(out, "demos/Channel Identification 5.1.mp4"), fontfile)

    mkv = os.path.join(out, "movies/Countdown Test Film (2026).mkv")
    print("movie: Countdown Test Film (TrueHD MKV)")
    movie(mkv, fontfile)
    print("movie: browser-ready copy via prepare_media.py")
    subprocess.run([sys.executable, os.path.join(HERE, "prepare_media.py"), mkv, "-o", os.path.join(out, "movies"),
                    "--verify"], check=True)
    print("\ndone. Start the server and open the app.")


if __name__ == "__main__":
    main()
