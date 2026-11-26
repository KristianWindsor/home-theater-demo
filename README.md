# KW 5.1

A home-theater showcase that runs in a browser on the machine connected to the TV/receiver:

- **3D home screen**: a model of the room (couch, four towers, center, the subwoofer, the TV, the Hue
  lights). Click a speaker and a sound plays from **only that speaker**; click the sub for a sub drop; click
  the TV for movies; click the couch to sit down. Speakers move and lights glow with the actual output levels.
- **Demos**: *Shows* (seven composed surround experiences where the music, where each sound sits in the room,
  the picture and the lights all come from one score, plus a helicopter orbiting the couch and a thunderstorm
  with lightning in the lights), *Setup* (channel check, a 120→18 Hz sub sweep) and your own demo clips.
  The shows have a real transport: pause, restart, previous/next chapter, and a timeline you can click or drag
  along ("wait, play that part again"). See [Experiences](#experiences).
- **Trailers**: the Dolby, DTS and THX trailers that play before a film in the cinema, one section per brand.
  *Play all* runs them back to back.
- **Movies**: MKV/MP4 library with **curated scene lists** you jump straight to, one row of scenes per film,
  scene fades. A long scene can have a **highlight**, a 2–3 minute cut its tile plays first (the podrace start
  rather than all 15 minutes), with the **full sequence** a button away. The player's timeline spans the clip
  playing, so it's easy to scrub; **T** switches it to the whole film. Mark scenes while watching with **B**
  (start) and **E** (end).
- **Music visualizer**: each song is analyzed once (beats, downbeats, drums, harmony, key, sections, builds,
  drops). The visuals are then **choreographed for the whole song**, like a pre-programmed light show, and
  rendered live in WebGL with the live spectrum layered on top. Unanalyzed tracks react live until their analysis
  is done. Songs with a **music video** show the video instead, in sync, while the lights keep following the music.
  Every song carries a badge for its **audio quality** (Hi-Res, Lossless, or the codec and bitrate). Songs show
  as one grid, or by album. Music keeps playing while you browse, with a **Now Playing** bar on the home and
  library screens.
- **Back where you were**: coming back from a show, a scene or a song lands on the tile you started it from,
  with each screen scrolled where you left it, which makes the remote much nicer to use.

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
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/media:/media" kw51:latest python3 scripts/make_test_media.py /media
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
- **Picture quality**: *Settings → Picture → Quality*. **Native** renders the room, the shows and the visualizer at
  every pixel of the screen (full 4K on a 4K TV). **Auto** (the default) starts at High and goes up to native while
  frames stay on time at the display's refresh rate, down when they don't. Turn on the **Performance overlay** there
  to see, on the real machine, the rendered resolution, frame times, dropped video frames and the GPU in use.
- **HDR**: HEVC/HDR10 plays in Chrome/Edge on Windows with a GPU that decodes HEVC; turn on HDR in Windows
  display settings. The movie page tells you when a file can't play in the current browser and why.
- **Streaming over the internet**: files are sent byte-for-byte (no transcoding), so a 4K remux needs its full
  bitrate (often 50–80 Mbps, peaks higher) from your server's upload. A 1080p remux needs roughly 25–40 Mbps.

## Media folders

```
media/
  demos/    demo clips (video) or surround music demos (audio, plays with the visualizer)
  movies/   films, MKV or MP4 (sub-folders fine). Optional poster: same name .jpg, or poster.jpg in the folder
  music/    any common audio format, one folder per album works best; cover.jpg/folder.jpg or embedded art.
            A video with the same name as a song ("My Girls.opus" + "My Girls.webm") is its music video
  trailers/ Dolby/DTS/THX trailers (video), one folder per brand (trailers/Dolby/Spheres.mp4). Optional poster:
            same name .jpg
  sounds/   optional speaker clicks for the 3D room, in place of the synthesized ones: one per speaker (FL.flac,
            FR.flac, FC.flac, SL.flac, SR.flac, LFE.flac) or mains.flac for any without its own. Any level: the
            app sets it. Settings → Speaker sounds → Original plays the synthesized ones
```

New files show up automatically (the library rescans every couple of minutes, or *Settings → Rescan*).
Music is analyzed in the background, about 5–15 s per song on a modest CPU, one at a time by default.

> **Volume, not image.** `docker-compose.yml` mounts `./media` into the container. Copying a movie library
> into the image makes every build push tens or hundreds of GB of layers; with a mount, adding a film is just
> copying a file. If you really want a self-contained image, add `COPY media/ /media/` to a derived Dockerfile
> and add `!media` to `.dockerignore`.

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

## Scenes

Scenes live in `config/catalog.json`, keyed by file name:

```json
"The Dark Knight (2008).mp4": {
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
- The Movies page has a row of scenes per film; starred scenes (`"star": true`, or the star in *Edit scenes*)
  are the highlights of each row. Click one to play just that scene. A movie's page lists all of its scenes
  and has *Play all* to run them back to back.
- A long scene can carry a `"highlight"`, a short cut inside it:
  `"highlight": { "start": "0:58:56", "end": "1:01:50", "note": "\"Start your engines\"..." }`. Its tile plays the
  highlight (and shows its length), the player has **Full sequence** to carry on into the whole scene, and
  *Play all* plays the highlights. The shipped highlights were picked from the soundtrack (where the subwoofer,
  the surrounds and the loudness are busiest), with their ends on cuts and outside lines of dialogue.
- MKV chapters are listed too, so you can jump around before you've curated anything.

The shipped catalog has a frame-checked scene list for The Dark Knight, keyed `The Dark Knight (2008).mp4`:
name your copy to match. If its studio logos run longer or shorter, shift the times (or fix them with B/E).

## Experiences

**Demos → Shows.** Each piece is one score that drives the music, the position of every sound in the
room, the picture and the Hue lights, so they can't drift apart.

| | |
|---|---|
| **Awakening** · 1:41 · in the 3D room | A wooden tick behind your shoulder, an answer from across the room, then each tower joins with its own instrument, a melody travels around the couch, the walls and ceiling fold away into a vast space, and it all folds back. |
| **Glass Orchard** · 2:34 | A glass tree grown by the music: plucks grow branches, chords become membranes, the bass ripples the ground, percussion shatters fruit. A droplet falls *through* the camera mid-way. Each instrument lives in its own corner. |
| **Under the Ice** · 2:08 | A frozen lake creaks; a fracture races from the front-right speaker to behind your left shoulder; something the size of the room passes underneath on the sub; a whale calls and is answered from around the room; the deep lights up. |
| **Lighthouse** · 2:12 | Waves around the seats, a lighthouse signalling from the center speaker into silence. Then an answer from behind you, then many; the lights become a constellation and the horizon rises with a choir. |
| **Marble Machine** · 1:44 | A machine drawn in light around your seat. The marble rolls off the right edge of the screen and you hear it circle behind you; every pendulum, xylophone, string, drum and glass wheel it touches keeps playing, so it composes the groove. A tube fires it over your head into a spiral around the room, it taps one tiny button, and the vast machine around the room wakes for one enormous chord. |
| **Cold Start** · 2:30 | A dim pit garage. The tubes flicker on, a relay clicks behind your right shoulder, the fuel pump primes, the starter struggles and a V10 catches with a cold-start flare that shakes the light fittings. Two blips (pops, a bang), the roller door rises onto a night circuit, launch control at the pit exit, then the drive: shifts, rev-matched downshifts, kerbs, a tunnel at full throttle. Then you're standing by the track as it comes at you at 270 km/h, screams past and brakes behind you. Back in the garage: engine off, fans, cooling metal ticking in the silence. |
| **The Passenger** · 1:41 · in the 3D room | A collar bell behind the couch, soft paws, a jump: a cat appears on the backrest, hops down onto the empty seat beside you, kneads, turns around twice and curls up. Its purr (felt in the subwoofer) carries it into a dream: the walls drift away and enormous strands of wool float through warm amber light. One ear twitches, the dream is gone, and it asks you a question. *(Click the sleeping cat.)* |

- **Every sound is synthesized** (plucked and bowed strings, struck glass, wood and metal, voices, waves, ice,
  whale song, the rolling marble): no samples, nothing downloaded, nothing to license. The car is a physical
  model of a V10 (ten cylinders firing in the real order through each bank's exhaust pipes, intake, valvetrain,
  pops, shifts) driven by a lap simulation, heard from the cockpit or from the trackside with real propagation
  delay (so real Doppler); the cat's purr is ~23 laryngeal pulses a second through inhale and exhale, with its
  fundamental sent to the subwoofer. When a piece starts, a
  background worker renders the soundtrack for *your* speaker angles from `config/room.json` (it runs several
  times faster than real time) and streams it while it plays.
- **Discrete 5.1.** With the OS device set to 5.1 (see above) every channel goes to its own speaker and the
  badge in the controls says **5.1**. On stereo output it says *(folded down)* and the surrounds are mixed into
  L/R. Move the mouse to show the controls: the speaker map lights each speaker with its own channel's level,
  which is the quickest way to check that sound behind you really comes from behind you.
- **LFE** is written 10 dB down on the LFE channel (the film convention; the receiver adds the 10 dB back).
- **Lights**: the pieces drive the light rig (the virtual Hue lights in the 3D room) with their own cues.
- **Levels**: *Settings → Shows level* sets all the shows (100% plays them as composed); *Speaker clicks & tests*
  is separate, for the room's speaker clicks, Channel Check and Subwoofer Sweep.
- **Controls**: Esc/Backspace or the back button stops; the timeline shows chapters; if the TV delays the
  picture, *Settings → A/V offset* shifts the visuals.
- **Hear a mix without the TV**: `node scripts/render_experience.mjs marble-eventually` writes exactly what the
  app plays as a 6-channel 24-bit WAV (FL FR FC LFE SL SR) for your `room.json`; `--stereo` writes the
  fold-down, `--list` lists the pieces.

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

Visualizer keys: **Space** play/pause · **←/→** seek · **N/P** next/previous · **V** pick a world, or the music
video (**A** back to auto, or to the video) · **I** analysis HUD · **T** title card · **Esc** back (the music keeps
playing; the TV in the 3D room shows the visuals and the room's lights follow it).

**Sync**: TVs delay the picture and receivers delay the sound. *Settings → Audio/video sync* plays a click
track with a flashing dot through the same path the music uses; slide until they line up. *Settings → Intensity*
scales how hard the visuals hit; **Reduce flashing** tames full-screen flashes for anyone sensitive to them.

## Music videos

Put a video next to a song under the same name and the song plays with its video instead of the visualizer:

```
media/music/Animal Collective/My Girls.opus   the song: analyzed, and played through the speakers like any track
media/music/Animal Collective/My Girls.webm   its music video (picture only; any audio track in it is ignored)
media/music/Animal Collective/My Girls.jpg    cover art (optional: without it, a frame of the video is used)
```

- **The song stays the sound.** The video plays muted and follows the song's clock: a small drift is caught up by
  playing the picture up to 8 % faster or slower, a big one (a seek, a stall) makes it jump. It follows the same
  clock as the visualizer, so *Settings → Audio/video sync* lines it up too. The *Performance overlay* shows how far
  apart they are (`mvideo … ms from the song`).
- **The lights still follow the music's choreography**, and the TV in the 3D room plays the video while you're in
  the room.
- **V** switches between the video and the visualizer's worlds; the choice holds for the rest of what's queued.
- A browser that can't decode the video (VP9/AV1 on an older iPhone) shows the visualizer instead.
- Videos are stored with the music, on the server's media volume: roughly 50–200 MB for a 1080p video.

**From YouTube**: `scripts/fetch_music_video.py` makes all three files from a YouTube link:

```bash
python3 scripts/fetch_music_video.py "https://www.youtube.com/watch?v=zol2MJf6XNE" \
    --artist "Animal Collective" --title "My Girls" --album "Merriweather Post Pavilion" --year 2009 --track 2
python3 scripts/fetch_music_video.py URL --list    # every stream YouTube has, and which ones it would take
```

Nothing is re-encoded: it keeps YouTube's best audio (Opus, about 130 kbps; never the dynamic-range-compressed
copies) and the video at its highest native resolution. YouTube's "Premium" 1080p, a separate encode at about twice
the usual bitrate, is taken when offered (it downloads without an account); "AI-upscaled" copies of low-resolution
videos are skipped unless you pass `--upscaled`. At the same size VP9 is preferred, which nearly every GPU decodes
in hardware (`--codec av1` or `h264` to change that). Needs `yt-dlp` (`brew install yt-dlp`, which brings the `deno`
it needs for YouTube) and ffmpeg.

## Audio quality

Every song in *Music* and in the visualizer's controls carries a badge for what the file holds:

| Badge | Means |
|---|---|
| **Hi-Res 24/96** (gold) | lossless and beyond CD: more than 16 bits or more than 48 kHz (24/48, 24/96, 24/192, DSD) |
| **Lossless 16/44.1** (blue) | every sample of the master at CD quality (or 16/48) |
| **Opus 127 kbps**, **AAC 256 kbps**, **MP3 320 kbps** | lossy, by codec and bitrate |

Surround files add their layout (**Hi-Res 5.1 24/48**). Hover a badge for the details. Music videos carry a second
badge with the video's resolution.

## The 3D room

`config/room.json` describes it: room size, TV size, where each speaker stands (a clock position and distance
from the listener, `"clock": 10` = 10 o'clock, or `"x"` and `"z"` in meters, with `"z": "tv"` for in line with
the TV stand and `"z": "couch"` for level with the couch), which way it faces (towards the listener,
`"facing": "forward"` parallel to the front wall, or `"across"` parallel to its side wall), the sub's corner,
size and gap from the walls, an optional fireplace sticking out of the front wall (the TV and its stand back onto
it), and which Hue light sits behind what. Edit it to match the real room; the same placement
(`public/js/room/layout.js`) gives the speaker angles the experiences are rendered for. The speakers' `channel`
(FL, FR, FC, LFE, SL, SR) is what their easter egg plays on. On the home screen: drag to orbit, scroll to zoom, keys **1–6** trigger speakers, **C** sits on the couch.

## Keys (keyboard or remote)

| Where | Keys |
|---|---|
| Everywhere | Arrows move between buttons, Enter selects, Esc/Backspace goes back |
| Player | Space/K play-pause · ←/→ ±10 s (Shift ±60) · N/P next/previous scene · T timeline: this clip / whole film · B mark scene start · E mark scene end · F fullscreen · +/− volume |
| Visualizer | see above |
| Home | 1–6 speakers · C couch |
| Shows | Space/K pause · ←/→ previous/next chapter (← once: back to this chapter's start) · J/L ±10 s · R from the start · Esc stops · any key or the mouse shows the controls |

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | 8080 | |
| `MEDIA_DIR` | `/media` | `demos/`, `movies/`, `music/`, `trailers/` |
| `DATA_DIR` | `/data` | scores, thumbnails, covers, FLAC fallbacks, scene edits |
| `CONFIG_DIR` | `/app/config` | `catalog.json`, `room.json` |
| `ANALYZE_ON_START` | `true` | analyze new music in the background |
| `ANALYZER_CONCURRENCY` | 1 | songs analyzed in parallel |
| `RESCAN_SECONDS` | 120 | library freshness when the app asks for it |
| `THUMB_CONCURRENCY` | 2 | parallel ffmpeg thumbnail jobs |
| `ALLOW_SCENE_EDITS` | `true` | set `false` to make scene lists read-only |
| `PYTHON`, `FFMPEG`, `FFPROBE` | from `PATH` | tool locations when running outside Docker |
| `MEDIA_BUCKET` | | read movies from this S3 bucket (`movies/…`) instead of `MEDIA_DIR/movies`; needs `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` with `s3:ListBucket` and `s3:GetObject` |
| `MEDIA_BUCKET_REGION` | `AWS_REGION` or `us-east-1` | the bucket's region |
| `MEDIA_CDN_URL`, `MEDIA_CDN_KEY_PAIR_ID`, `MEDIA_CDN_PRIVATE_KEY` | | play bucket movies through CloudFront signed URLs (CloudFront domain, public key ID, the private key PEM itself); without them the browser gets presigned S3 links |
| `MEDIA_LINK_HOURS` | 12 | how long a movie link handed to the browser stays valid |

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

## Deployment (https://home-theater.kwk8s.tech)

Runs on the kwk8s k3s server (`k8s/`). Pushing to `main` builds the image and rolls it out (GitHub Actions);
changes under `k8s/` are applied by hand with `kubectl apply -f k8s/`.

Media isn't in git or the image. It lives in the private S3 bucket `kwk8s-home-theater-files`, laid out like
`media/` (`demos/`, `movies/`, `music/`, `trailers/`).

- **Movies never touch the server.** The app lists and probes them in the bucket, and the browser plays them from
  CloudFront (`https://home-theater-media.kwk8s.tech`) through signed links that expire after `MEDIA_LINK_HOURS`.
  `/media/movies/…` answers with a redirect to a fresh link. The bytes are the file's, untouched, as before.
  New movies show up within a couple of minutes, no restart needed.
- **Music, demos, trailers and sounds** are synced onto the media volume by an init container when the pod starts. Music has to
  be same-origin: it plays through Web Audio, which hears a cross-origin source without CORS as silence. The bucket is the source of truth: files deleted from it are deleted from the server on the
  next restart. New songs are analyzed on the server after the restart.

```bash
aws s3 sync media/ s3://kwk8s-home-theater-files/ --exclude README.md --exclude '*.DS_Store'   # add --delete to remove files too
kubectl rollout restart deployment/home-theater                                             # only for new music/demos/trailers/sounds
```

CloudFront caches files for up to a day; after replacing a movie under the same name, run
`aws cloudfront create-invalidation --distribution-id E1MHJ4UQCS4J29 --paths '/movies/*'`.

The pod reads its AWS keys (IAM user `home-theater`, read-only on the bucket) and the CloudFront signing key from
the `home-theater-media` secret, created by hand:

```bash
kubectl create secret generic home-theater-media \
  --from-file=aws-access-key-id=… --from-file=aws-secret-access-key=… \
  --from-file=cdn-private-key.pem=…   # its public key is CloudFront key KA673EAIJBHY4 (key group home-theater-media)
```

The AWS side (bucket, CloudFront, certificate, DNS, IAM user) is described in the kwk8s.tech repo's Terraform.

## Layout

```
server/          zero-dependency Node server: library + ffprobe cache, byte-range streaming, analysis queue,
                 thumbnails/covers, lossless fallbacks, scene saving, server-sent events, S3 + CloudFront
                 signed links for movies kept in a bucket (bucket.js)
analyzer/        the music analyzer (Python) and its tests
scripts/         prepare_media.py, fetch_music_video.py, make_test_media.py, synth_song.py, render_experience.mjs
config/          catalog.json (scenes), room.json (3D room)
public/js/
  core/          router, spatial navigation, API, settings, codec compatibility
  audio/         audio engine (per-speaker routing, meters, upmix), procedural sounds, demos, music player
  viz/           score decoding, live analysis, director, palette, visualizer, worlds/
  room/          3D room renderer, meshes, picking
  lights/        virtual Hue light rig (+ the planned Hue sink)
  experiences/   composed pieces: core/ (timeline, runner, stage), audio/ (DSP, instruments, studio,
                 worker renderer) and one folder per piece (score.js, audio.js, scene.js)
  screens/       home, movies, player, demos, trailers, experience, music, visualizer, settings
```

## Roadmap

Spotify and Philips Hue are designed in but not built; see [ARCHITECTURE.md](ARCHITECTURE.md) for how each
plugs in and the constraints that shape them.
