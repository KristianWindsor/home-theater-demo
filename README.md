# Marquee

A home-theater showcase that runs in a browser on the machine connected to the TV/receiver:

- **3D home screen**: a model of the room (couch, four towers, center, the subwoofer, the TV, the Hue
  lights). Click a speaker and a sound plays from **only that speaker**; click the sub for a sub drop; click
  the TV for movies; click the couch to sit down. Speakers move and lights glow with the actual output levels.
- **Demos**: built-in synthesized experiences (channel check, a helicopter orbiting the couch, a thunderstorm
  with lightning in the lights, a 120→18 Hz sub sweep) plus your own demo clips (Dolby/DTS trailers etc.).
- **Movies**: MKV/MP4 library with **curated scene lists** you jump straight to, scene fades, and **reels**
  (scenes from different films back to back). Mark scenes while watching with **B** (start) and **E** (end).
- **Music visualizer**: each song is analyzed once (beats, downbeats, drums, harmony, key, sections, builds,
  drops). The visuals are then **choreographed for the whole song**, like a pre-programmed light show, and
  rendered live in WebGL with the live spectrum layered on top. Unanalyzed tracks react live until their analysis
  is done.

No accounts, no login, no third-party services. Everything is served from your own box.

---

## Quick start

```bash
docker compose up -d --build                    # http://<server>:8080
```

No files yet? Generate original test media (a 124 BPM track with builds and drops, an ambient track,
a 5.1 channel-ID video, and a "Blu-ray style" test film with a TrueHD track plus its browser-ready copy):

```bash
python3 scripts/make_test_media.py media        # needs python3, numpy, scipy, ffmpeg on the host
# or with the image you just built (writes into ./media):
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/media:/media" marquee:latest python3 scripts/make_test_media.py /media
```

Open the page on the theater PC, click **Enter** (that also starts audio and goes fullscreen), then use the mouse,
arrow keys or a remote.

## The playback machine matters

The server only stores and streams files; **decoding happens in the browser on the theater PC**, so that's
where quality is decided.

- **Use Chrome or Edge on a PC or Mac connected by HDMI to the receiver.** Smart-TV browsers are slow at
  WebGL and usually output stereo only.
- **Set the OS playback device to 5.1** (Windows: Sound settings → the receiver/HDMI device → Configure →
  5.1). The app shows what it detects in *Settings → Speakers*. With stereo output the speaker
  easter eggs are simulated on L/R and say so.
- **Bitstreaming isn't possible from a browser.** Browsers decode audio themselves and send multichannel PCM.
  That's lossless for FLAC/PCM, but browsers can't decode **Dolby TrueHD or DTS(-HD MA)** at all (and
  Chrome/Firefox also skip AC-3/E-AC-3). `prepare_media.py` (below) solves this without losing quality.
  What you do lose is Atmos/DTS:X *object* metadata. In a 5.1 room without height speakers that makes no
  practical difference: the 7.1 bed is decoded and the receiver/OS folds it into your 5.1.
- **HDR**: HEVC/HDR10 plays in Chrome/Edge on Windows with a GPU that decodes HEVC; turn on HDR in Windows
  display settings. The movie page tells you when a file can't play in the current browser and why.
- **Streaming over the internet**: files are sent byte-for-byte (no transcoding), so a 4K remux needs its full
  bitrate (often 50–80 Mbps, peaks higher) from your server's upload. A 1080p remux needs roughly 25–40 Mbps.

## Media folders

```
media/
  demos/    demo clips (video) or surround music demos (audio, plays with the visualizer)
  movies/   films, MKV or MP4 (sub-folders fine). Optional poster: same name .jpg, or poster.jpg in the folder
  music/    any common audio format, one folder per album works best; cover.jpg/folder.jpg or embedded art
```

New files show up automatically (the library rescans every couple of minutes, or *Settings → Rescan*).
Music is analyzed in the background, about 5–15 s per song on a modest CPU, one at a time by default.

> **Volume, not image.** `docker-compose.yml` mounts `./media` into the container. Copying a movie library
> into the image makes every build push tens or hundreds of GB of layers; with a mount, adding a film is just
> copying a file. If you really want a self-contained image, add `COPY media/ /media/` to a derived Dockerfile
> and remove `media` from `.dockerignore`.

## Making movies browser-playable (losslessly)

Most Blu-ray/UHD rips have TrueHD or DTS-HD MA as the default audio track, which no browser decodes (the
picture would play silently). One pass fixes it:

```bash
python3 scripts/prepare_media.py "/rips/The Dark Knight (2008).mkv" -o media/movies --verify
python3 scripts/prepare_media.py /rips -o media/movies          # a whole folder
```

It copies the **video bit-for-bit** (HDR metadata included), picks the best audio track (lossless over lossy,
most channels, not commentary; `--audio N` to choose), keeps browser-decodable tracks as they are, and
**decodes TrueHD/DTS to FLAC** with the same channel layout and bit depth. TrueHD and DTS-HD MA are lossless
codecs, so the FLAC holds exactly the same samples; `--verify` decodes both and compares checksums. Chapters
and tags are kept; text subtitles are written next to the file as `.vtt`; the MP4 index goes to the front so
seeking over the network is instant. Options: `--downmix 5.1` (fold 7.1 into 5.1), `--allow-dolby` (keep
AC-3/E-AC-3 as-is, only Edge/Safari play those), `--dry-run`.

## Scenes and reels

Scenes live in `config/catalog.json`, keyed by file name:

```json
"The Dark Knight (2008).mkv": {
  "title": "The Dark Knight",
  "scenes": [
    { "title": "Opening bank heist", "start": "0:00:45", "end": "0:06:10", "star": true },
    { "title": "Armored truck chase and the Batpod", "start": null }
  ]
}
```

- `start`/`end` take seconds or `h:mm:ss(.s)`. No `end` = play to the end of the film.
- A scene with `"start": null` appears as *no time yet*. Play the film, press **B** at the moment it starts
  (the name is pre-filled) and **E** where it ends. That's the quickest way to build a scene list.
- Scenes edited in the app (B/E in the player, or *Edit scenes* on a movie page) are saved on the server in
  `DATA_DIR/scenes.json` and override the catalog. *Revert to catalog* undoes that.
- **Reels** (in `catalog.json`) play scenes from any films back to back with fades. Every starred scene also
  goes into an automatic **Starred scenes** reel.
- MKV chapters are listed too, so you can jump around before you've curated anything.

The shipped catalog has the scene *names* for The Dark Knight with empty times, ready for B/E.

## The music visualizer

```
audio file ──(Python, once)──► score.json ──► Director ──► worlds ──► transitions ──► trails ──► bloom/tonemap
             beats, drums,      the whole      composes the      7 WebGL    ink dissolve   Milkdrop-style
             harmony, sections  song's facts   whole song        "worlds"   / hard cuts    feedback
                                                   ▲
                    live FFT + waveform (Web Audio) ┘  fine detail on top of the choreography
```

**The analyzer** (`analyzer/`, numpy + scipy + ffmpeg) extracts tempo and a beat grid (dynamic-programming
tracker), downbeats and meter, kick/snare/hat events, a 32-band spectrum, a harmonic/percussive split,
chroma with harmonic suppression (so overtones don't fake chord tones), tuning, key, loudness (BS.1770), stereo
width and pan, per-channel levels for surround music, and the form: section boundaries, which sections repeat,
builds and drops. Its test suite synthesizes a song with sample-exact ground truth and checks all of that
(`python3 analyzer/tests/test_analyzer.py`): tempo within 0.1 %, beats within ~2 ms, every section boundary,
both drops, the repeated chorus labelled the same.

**The Director** reads the whole song before it starts:

- each kind of section gets its own world and palette, chosen to fit its energy, so a chorus looks like
  *that chorus* every time it comes back;
- changes land on bar lines: ink-dissolves between sections, **hard cuts into drops**;
- builds close cinematic letterbox bars, add trails and drain colour; the last bar before a drop "inhales"
  (dims, pulls back); the drop flashes, shockwaves and throws the bars open;
- colour is **chromesthesia**: pitch classes are placed around the circle of fifths (C red, G orange, D
  yellow, A yellow-green, E green … F rose, Scriabin's ordering) and mixed in OKLab, so related harmonies get
  related colours, a clear chord is saturated and noisy, dense sound drifts toward grey.

**The worlds**

| World | What it does |
|---|---|
| Horizon | A road through a neon landscape made of the **upcoming** spectrum: you see the drop rise on the horizon before you hear it. Beat lines cross under you on the beat; glowing gates mark section changes (red = drop). |
| Spectral Galaxy | 180k stars; distance from the core is frequency (bass at the center), brightness is that band's level; every beat sends a ripple outward. |
| Wormhole | A tunnel that advances exactly one ring per beat, so every ring hits the edge of the screen on its beat; downbeats burn brighter. |
| Mandala | A kaleidoscopic fractal whose mirror wheel turns one notch per beat; bass morphs it, the spectrum draws its ring. |
| Cymatics | 65k grains of "sand" physically settling on the nodal lines of a vibrating Chladni plate; the mode follows the chord, kicks scatter the sand. |
| Chromatic Ink | Domain-warped ink/gas: bass bends space, harmony tints it, snares and highs light the filaments. |
| Silk | Aurora over a mountain lake, for intros, breakdowns and quiet music. |

Tracks that aren't analyzed yet (or a future live source like Spotify) run in **live mode**: online beat
tracking from the FFT, no lookahead, and the Director improvises world changes at phrase boundaries. The
moment the server finishes the analysis the track switches to full choreography without stopping.

Visualizer keys: **Space** play/pause · **←/→** seek · **N/P** next/previous · **V** pick a world (**A** back
to auto) · **I** analysis HUD · **T** title card · **Esc** back (the music keeps playing; the TV in the 3D room
shows the visuals and the room's lights follow it).

**Sync**: TVs delay the picture and receivers delay the sound. *Settings → Audio/video sync* plays a click
track with a flashing dot through the same path the music uses; slide until they line up. *Settings → Intensity*
scales how hard the visuals hit; **Reduce flashing** tames full-screen flashes for anyone sensitive to them.

## The 3D room

`config/room.json` describes it: room size, TV size, each speaker's clock position and distance from the
listener (`"clock": 10` = 10 o'clock), the sub's corner and size, and which Hue light sits behind what.
Edit it to match the real room; the speakers' `channel` (FL, FR, FC, LFE, SL, SR) is what their easter egg
plays on. On the home screen: drag to orbit, scroll to zoom, keys **1–6** trigger speakers, **C** sits on the couch.

## Keys (keyboard or remote)

| Where | Keys |
|---|---|
| Everywhere | Arrows move between buttons, Enter selects, Esc/Backspace goes back |
| Player | Space/K play-pause · ←/→ ±10 s (Shift ±60) · N/P next/previous scene · B mark scene start · E mark scene end · F fullscreen · +/− volume |
| Visualizer | see above |
| Home | 1–6 speakers · C couch |

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | 8080 | |
| `MEDIA_DIR` | `/media` | `demos/`, `movies/`, `music/` |
| `DATA_DIR` | `/data` | scores, thumbnails, covers, FLAC fallbacks, scene edits |
| `CONFIG_DIR` | `/app/config` | `catalog.json`, `room.json` |
| `ANALYZE_ON_START` | `true` | analyze new music in the background |
| `ANALYZER_CONCURRENCY` | 1 | songs analyzed in parallel |
| `RESCAN_SECONDS` | 120 | library freshness when the app asks for it |
| `THUMB_CONCURRENCY` | 2 | parallel ffmpeg thumbnail jobs |
| `ALLOW_SCENE_EDITS` | `true` | set `false` to make scene lists read-only |
| `PYTHON`, `FFMPEG`, `FFPROBE` | from `PATH` | tool locations when running outside Docker |

Audio files browsers can't decode (ALAC, AIFF, WMA, APE, DSD, DTS/TrueHD music…) are converted once to a
lossless FLAC copy in `DATA_DIR/compat` the first time they're played.

## Running without Docker

Requires Node ≥ 18, Python 3 with numpy and scipy, and ffmpeg/ffprobe on `PATH`. No `npm install`; the
server has zero dependencies and the front end has no build step.

```bash
MEDIA_DIR=./media DATA_DIR=./data node server/index.js
python3 analyzer/analyze.py "media/music/Some Album/01 Song.flac" --summary   # inspect one analysis
python3 analyzer/tests/test_analyzer.py                                       # accuracy tests
```

## Layout

```
server/          zero-dependency Node server: library + ffprobe cache, byte-range streaming, analysis queue,
                 thumbnails/covers, lossless fallbacks, scene saving, server-sent events
analyzer/        the music analyzer (Python) and its tests
scripts/         prepare_media.py, make_test_media.py, synth_song.py
config/          catalog.json (scenes, reels), room.json (3D room)
public/js/
  core/          router, spatial navigation, API, settings, codec compatibility
  audio/         audio engine (per-speaker routing, meters, upmix), procedural sounds, demos, music player
  viz/           score decoding, live analysis, director, palette, visualizer, worlds/
  room/          3D room renderer, meshes, picking
  lights/        virtual Hue light rig (+ the planned Hue sink)
  screens/       home, movies, player, demos, music, visualizer, settings
```

## Roadmap

Spotify and Philips Hue are designed in but not built; see [ARCHITECTURE.md](ARCHITECTURE.md) for how each
plugs in and the constraints that shape them.
