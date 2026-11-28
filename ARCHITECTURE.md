# Architecture

```
                    ┌──────────────────────────── server (Docker) ────────────────────────────┐
  media/ (ro) ────► │ library.js  scan + ffprobe cache + catalog.json merge + scene edits       │
                    │ media.js    byte-exact Range streaming, thumbnails, covers, FLAC fallbacks │
  S3 bucket ──────► │ bucket.js   movies: S3 listing, presigned reads, CloudFront signed links   │
                    │ analysis.js queue ─► python3 analyzer/analyze.py ─► data/scores/<id>.json  │
                    │ index.js    HTTP API + server-sent events (analysis progress, library)    │
                    └────────────────────────────────────────────────────────────────────────────┘
                                   │ HTTP (files untouched)          │ SSE
                    ┌──────────────▼──────────────── browser on the theater PC ─────────────────┐
                    │ <video> ──────────────────────────────────────────► OS ─► receiver (5.1)   │
                    │ <audio> ─► AudioEngine (Web Audio) ── merger ── master ─► OS ─► receiver   │
                    │               │ analyser                   ▲ per-speaker sounds, demos     │
                    │   Score/Live source ─► Director ─► Visualizer (WebGL2) ─► canvas / TV tex  │
                    │                                 └─► LightRig ─► sinks: 3D room (+ Hue)     │
                    └────────────────────────────────────────────────────────────────────────────┘
```

Movies deliberately bypass Web Audio: the `<video>` element's audio goes straight through the browser's
native path, which handles every channel layout and downmix correctly. Music, test signals and the room's
easter eggs go through the `AudioEngine`, which is what makes per-speaker routing, metering and the
visualizer tap possible.

## Music videos

A song's music video (`server/library.js` pairs a video with the audio file of the same name, as
`item.musicVideo`) is a second, muted element: `<video id="musicvideo">`. The `<audio>` element stays the only
thing that makes sound, so the song's analysis, routing, upmix and FLAC fallback don't change. `MusicPlayer.syncVideo()`
runs every frame and keeps the picture on `visualTime` (the song's clock minus *Audio/video sync*, the same clock as
the visualizer): drift under 15 ms is left alone, up to 250 ms is caught up by nudging `playbackRate` (at most ±8 %),
anything more makes the picture jump, aimed ahead by the measured time a jump takes. Muxing audio and video into one
element routed through Web Audio would be simpler, but the browser would then sync them itself, before Web Audio's
output latency, with no way for the A/V setting to correct it.

In the visualizer the video takes the canvas's place (`#musicvideo.on`; the canvas isn't drawn) and the director keeps
running, so the lights still follow the score. In the room, `App._videoTexture()` uploads each new video frame to the
TV's texture, which needs the video to be same-origin (music is served by this server, see `bucket.js`).

## The score (analyzer output)

`format: "kw51-score"` (scores written before the rename say `"marquee-score"`; both load), `version: 1`. Times in seconds.

| Key | Contents |
|---|---|
| `global` | bpm, meter, tempoClarity, pulse, key/keyIndex/mode/keyConfidence, tuningCents, loudnessLUFS, dynamicRange, energy, brightness, percussiveness, danceability, valence (the last few are heuristics) |
| `frames` | 50 fps, each a base64 uint8 array: `loud` (−70..0 dB), `spec` (32 log bands 30 Hz–16 kHz, −90..0 dB), `centroid`, `flatness`, `flux`, `perc` (percussive ratio), `chroma` (12, magnitude = confidence), `width`, `pan`, `intensity`, optional `channels` (per-channel levels + layout for surround music) |
| `beats` | `t`, `s` (strength), `pos` (position in bar, 0 = downbeat) |
| `events` | `kick`, `snare`, `hat`, `onset`: `{t[], s[]}` |
| `sections` | start, end, label (equal labels = repeated material), kind (intro/verse/chorus/build/drop/break/peak/outro), intensity, trend… |
| `builds`, `drops`, `moments` | the story beats the Director choreographs around |

The front end derives everything else (per-band normalization, band groups) so the analyzer stays a
description of the music, not of the visuals.

## Extension point 1: feature sources (Spotify)

Visuals never read audio directly. They ask a **source** for a `Frame` at a time `t`:

```js
source.frameAt(t, frame)   // fills loud, spec[32], bands[5], chroma[12], beat phase, kick/snare/hat, sections…
source.score               // present only when the whole song is known in advance (lookahead)
```

- `ScoreSource` (`viz/score.js`) answers from a precomputed score: full lookahead, so the Director can
  compose sections, anticipate drops and run Horizon's "future terrain".
- `LiveSource` (`viz/live.js`) answers from a Web Audio `AnalyserNode`: online beat tracking, no lookahead;
  the Director improvises.

**Spotify**, when it comes, is a new way to *play* plus one of these two sources:

- The Web Playback SDK plays DRM-protected audio; pages can't route it into Web Audio, so there's nothing to
  analyze from the stream itself.
- Spotify's `audio-analysis` / `audio-features` endpoints (which used to give beats and sections) are closed to
  apps registered after 27 Nov 2024.
- So the plan is: (a) if the playing track matches a local file (ISRC or artist+title), use that file's score
  with Spotify's playback position as `t`; otherwise (b) run `LiveSource` on a live capture of the output
  (a loopback input device on the theater PC, or tab/system audio capture).

## Extension point 2: light sinks (Philips Hue)

`LightRig` (`lights/rig.js`) owns the fixtures and decides their colours every frame (music, demos, bias
light during movies, lightning). **Sinks** only display them: today the 3D room, tomorrow
`HueSink` (`lights/hue-sink.js`, stub).

Music-synced Hue needs the **Hue Entertainment API**: colour frames streamed over DTLS/UDP to the bridge at
25–50 Hz. Browsers can't open DTLS/UDP sockets, and the bridge lives on the theater's LAN, not next to this
server. The plan is a tiny relay on the LAN (Raspberry Pi, the HTPC itself):

```
LightRig ─► HueSink ──ws://hue-relay.local:7070──► hue-relay ──DTLS/UDP:2100──► Hue bridge
             {"type":"frame","lights":[{"id":"hue-tv","rgb":[r,g,b]}…]}
```

The relay owns the bridge credentials, maps fixture ids (from `room.json`) to entertainment-area channels,
applies brightness limits and gamma, and keeps the session alive between songs. Chrome asks the user once
before a page talks to a local-network address (Local Network Access), so the first connection shows a
permission prompt.

## Extension point 3: playback targets

The player drives an `HTMLVideoElement`. A future "external player" target could send the same
`{file, start, end}` instructions to Kodi (JSON-RPC) or another player on the theater PC, which *can*
bitstream TrueHD Atmos / DTS:X to the receiver. Scenes and the UI wouldn't change.

## Extension point 4: remote control

Screens are driven by routes (`#/play/<id>?scene=2`, `#/viz/<id>`) and `app.runDemo(id)` /
`app.music.*`. A phone remote would be a second page sending those same commands to the theater browser over a
small relay channel on the server (the SSE stream already pushes server→browser; add a POST to send).

## Adding a visual world

1. Write a class with `render(target, U, tex, frame, extra)` (or a fragment body for `ShaderWorld`) in
   `public/js/viz/worlds/`. `U` holds the shared uniforms (beat phase, pulses, bands, palette, chord colour,
   build/drop state…); `UNIFORMS`/`LIB` in `worlds/common.js` give you the GLSL declarations and helpers.
2. Register it in `worlds/index.js` with the energy range and section kinds it suits. The Director starts
   casting it automatically; **V** in the visualizer previews it.

## Experiences (composed pieces)

```
experiences/<id>/score.js   compose() ─► { duration, events[], marks, chapters }   deterministic, seeded
          │                                          │
          ▼  module Worker (audio/worker.js)         ▼  main thread
audio.js  setup(studio, score)                    scene.js  new Scene(app, score, runner)
  Studio: voices ─► ring panner at the room.json speaker angles (+ distance, air absorption)
        ─► early reflections from a virtual shoebox ─► two FDN reverbs (small ↔ large via `space`)
        ─► LFE bus (LR4 low-pass at 110 Hz, written −10 dB) ─► 6 role channels FL FR FC LFE SL SR
        ─► fold-down matrix to the device layout ─► linked look-ahead limiter
  chunks (transferable Float32Arrays, credit-based back-pressure)
        ─► AudioBufferSourceNodes ─► engine show bus (Sound check level; discrete channels) ─► master ─► OS ─► receiver
                                                    scene.draw(t) on the audio clock · scene.light(fixture, t)
```

- **One score, two readers.** The audio module turns events into voices; the scene reads the same events and
  marks to animate. Nothing is analysed at run time, so picture and sound can't drift. The scene's clock is the
  audio output clock (`getOutputTimestamp()`, smoothed) minus *Settings → A/V offset*.
- **Rendered, not played.** The worker renders the whole piece offline for this room's speaker angles, a few
  seconds ahead of playback, and streams it; the same code runs in Node (`scripts/render_experience.mjs`), so a
  WAV from the script is the mix the app plays.
- **Transport.** The page keeps every chunk it has been sent (a 2.5-minute piece is about 170 MB in 5.1), so
  pausing, restarting and jumping back a chapter replay them at once: `runner.seek(t)` fades out, reschedules the
  kept chunks from `t` and fades in. A jump past what's rendered waits in a `seeking` state while the worker is
  given credit up to there. The scenes are pure functions of score time, so the picture follows any jump.
- **Instruments** (`audio/instruments.js`): Karplus–Strong plucks, modal resonators (wood, glass, metal, bells,
  plates, marimba) with mallet hardness, bowed glass, breath, formant voices/choir, pads, sub pulses, drums,
  glides, noise beds, bubbles, ice chirps, waves, creaks. Levels are normalized so a note at velocity 0.7 sits
  near −20 dBFS RMS; pieces balance with per-note `gain` and the `master` parameter.
- **Placement**: `{ spk: 'FL' }` is one exact speaker; `{ az, dist, width }` pans across the real speaker ring
  (degrees clockwise from the screen, unwrapped angles allowed so motion can keep going round);
  `{ path: (t) => ({ az, dist, width }) }` moves a source (t is seconds since the voice started); `lfe: k`
  also sends it to the LFE bus. Studio parameters (`master`, `space`, `t60A/B`, `er`, `room`…) take a number
  or a `[[t, value], …]` automation curve.
- **In the room.** An experience plays on the home screen and drives the 3D room through hooks (camera override,
  extra lights, extra layers, reshaping walls/ceiling/sky, post override, the TV's picture). (The full-screen kind,
  with its own screen at `#/x/<id>` and `core/stage.js`, was retired with the last full-screen piece; it's in the
  history before the Sound Check change if one is ever wanted again.)
- **Marbles and the TV.** Awakening's `marbles.js` lands a marble on a speaker at every note it plays (hops between
  landings are parabolas under real gravity, capped per marble; long gaps rest, then hop) and `tv.js` draws a
  metronome and per-speaker note lanes onto a canvas that becomes the TV's texture (`room.setTVSource`). Both are
  read from the score's events, so they're as pure in time as the scene.
- **The sub's drop** (Awakening, 0:37) is measured against Dolby's *Amaze*, whose bass section puts about −8 dBFS
  RMS at ~35 Hz on the LFE channel for two seconds, peaking at −1 dBFS, then −18 to −24 for a few seconds. In the
  studio an LFE send of 1 reaches the LFE channel about 13 dB down (written −10 dB, times the piece's master);
  `audio.js` keeps its sends in one `LFE` table. The limiter is linked across channels (ceiling −1 dBFS), so the
  drop peaks just under it rather than ducking everything.
- **Callouts.** `score.callout(t, role, text, dur)` names a speaker on screen: while score time is inside
  `[t, t + dur)` the home screen floats a label over that speaker (its name from `room.json`, then `text`, plus
  *simulated* when the output has no such channel). It's a pure function of score time, so pausing holds it and
  a jump back shows it again. Awakening uses it to be a sound check.
- **Easter eggs.** `hidden: true` in `experiences/index.js` keeps a piece off the Sound Check page; a scene with an
  `onClick(x, y)` receives clicks on the picture (a hidden piece can be started from there).
- **Lights.** While a piece runs, the light rig is in `script` mode and asks `scene.light(fixture, t)` for each
  fixture's colour (fixtures carry `anchor` and `az`), so a Hue sink gets the cues for free.

### Adding an experience

1. Make `public/js/experiences/<id>/` with `score.js` (`compose()` returns `score.done()`), `audio.js`
   (default export `setup(studio, score)`) and `scene.js` (`export class Scene`, with `init`, `update`, `draw`
   or the room hooks, and `light`).
2. Register it in `experiences/index.js` (short title, `check`: what it checks, `listen`: what to listen for,
   duration, `kind: 'room'`) and draw its icon `xp-<id>` in `core/dom.js`. It appears on the Sound Check page; give it a still from the piece as
   `public/img/shows/<id>.jpg` (960×540; the icon stands in until there is one). Put it in the showcase with a
   step in `config/showcase.json`.
3. Iterate on the sound with `node scripts/render_experience.mjs <id>` (6-channel WAV; renders ~10× real time),
   and on the picture by typing `kw51.experience.peek = 42` in the browser console to hold the visuals at
   any moment (`null` resumes).
