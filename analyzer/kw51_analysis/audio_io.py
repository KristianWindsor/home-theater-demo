"""Decoding and probing through ffmpeg/ffprobe (handles every format ffmpeg does)."""
import json
import subprocess

import numpy as np

# ffmpeg's native channel order for common layouts
LAYOUTS = {
    "mono": ["FC"],
    "stereo": ["FL", "FR"],
    "2.1": ["FL", "FR", "LFE"],
    "3.0": ["FL", "FR", "FC"],
    "3.1": ["FL", "FR", "FC", "LFE"],
    "quad": ["FL", "FR", "BL", "BR"],
    "quad(side)": ["FL", "FR", "SL", "SR"],
    "4.0": ["FL", "FR", "FC", "BC"],
    "4.1": ["FL", "FR", "FC", "LFE", "BC"],
    "5.0": ["FL", "FR", "FC", "BL", "BR"],
    "5.0(side)": ["FL", "FR", "FC", "SL", "SR"],
    "5.1": ["FL", "FR", "FC", "LFE", "BL", "BR"],
    "5.1(side)": ["FL", "FR", "FC", "LFE", "SL", "SR"],
    "6.1": ["FL", "FR", "FC", "LFE", "BC", "SL", "SR"],
    "7.1": ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR"],
    "7.1(wide)": ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC"],
    "7.1(wide-side)": ["FL", "FR", "FC", "LFE", "FLC", "FRC", "SL", "SR"],
}


class DecodeError(RuntimeError):
    pass


def probe(path):
    """Return basic info about the first audio stream plus container tags."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, check=True,
        )
    except FileNotFoundError as e:
        raise DecodeError("ffprobe not found on PATH") from e
    except subprocess.CalledProcessError as e:
        raise DecodeError(e.stderr.decode(errors="replace").strip() or "ffprobe failed") from e
    info = json.loads(out.stdout or b"{}")
    audio = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not audio:
        raise DecodeError("no audio stream found")
    default = [s for s in audio if (s.get("disposition") or {}).get("default")]
    a = (default or audio)[0]
    fmt = info.get("format", {})
    tags = {}
    for src in (a.get("tags") or {}, fmt.get("tags") or {}):
        for k, v in src.items():
            tags.setdefault(k.lower(), v)
    duration = float(fmt.get("duration") or a.get("duration") or 0.0)
    channels = int(a.get("channels") or 2)
    layout = a.get("channel_layout") or ("stereo" if channels == 2 else "mono" if channels == 1 else "")
    return {
        "duration": duration,
        "sample_rate": int(a.get("sample_rate") or 44100),
        "channels": channels,
        "layout": layout,
        "labels": LAYOUTS.get(layout, [f"C{i + 1}" for i in range(channels)]),
        "codec": a.get("codec_name", ""),
        "stream_index": int(a.get("index", 0)),
        "tags": {
            "title": tags.get("title", ""),
            "artist": tags.get("artist") or tags.get("album_artist", ""),
            "album": tags.get("album", ""),
        },
    }


def decode(path, sr, channels=None, stream_index=None):
    """Decode to float32 numpy array of shape (samples, channels)."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path]
    cmd += ["-map", f"0:{stream_index}" if stream_index is not None else "0:a:0"]
    cmd += ["-vn", "-sn", "-dn", "-f", "f32le", "-acodec", "pcm_f32le", "-ar", str(sr)]
    if channels:
        cmd += ["-ac", str(channels)]
    cmd += ["-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=True)
    except FileNotFoundError as e:
        raise DecodeError("ffmpeg not found on PATH") from e
    except subprocess.CalledProcessError as e:
        raise DecodeError(e.stderr.decode(errors="replace").strip() or "ffmpeg failed") from e
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if channels is None:
        raise ValueError("channels must be given")
    usable = (len(data) // channels) * channels
    return data[:usable].reshape(-1, channels)
