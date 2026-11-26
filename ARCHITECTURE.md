# Architecture

```
                    ┌──────────────────────────── server (Docker) ────────────────────────────┐
  media/ (ro) ────► │ library.js  scan + ffprobe cache + catalog.json merge + scene edits       │
                    │ media.js    byte-exact Range streaming, thumbnails, covers, FLAC fallbacks │
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

## The score (analyzer output)

`format: "marquee-score"`, `version: 1`. Times in seconds.

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
        ─► AudioBufferSourceNodes ─► engine show bus (Shows level; discrete channels) ─► master ─► OS ─► receiver
                                                    scene.draw(t) on the audio clock · scene.light(fixture, t)
```

- **One score, two readers.** The audio module turns events into voices; the scene reads the same events and
  marks to animate. Nothing is analysed at run time, so picture and sound can't drift. The scene's clock is the
  audio output clock (`getOutputTimestamp()`, smoothed) minus *Settings → A/V offset*.
- **Rendered, not played.** The worker renders the whole piece offline for this room's speaker angles, a few
  seconds ahead of playback, and streams it; the same code runs in Node (`scripts/render_experience.mjs`), so a
  WAV from the script is the mix the app plays.
- **Instruments** (`audio/instruments.js`): Karplus–Strong plucks, modal resonators (wood, glass, metal, bells,
  plates, marimba) with mallet hardness, bowed glass, breath, formant voices/choir, pads, sub pulses, drums,
  glides, noise beds, bubbles, ice chirps, waves, creaks. Levels are normalized so a note at velocity 0.7 sits
  near −20 dBFS RMS; pieces balance with per-note `gain` and the `master` parameter.
- **Placement**: `{ spk: 'FL' }` is one exact speaker; `{ az, dist, width }` pans across the real speaker ring
  (degrees clockwise from the screen, unwrapped angles allowed so motion can keep going round);
  `{ path: (t) => ({ az, dist, width }) }` moves a source (t is seconds since the voice started); `lfe: k`
  also sends it to the LFE bus. Studio parameters (`master`, `space`, `t60A/B`, `er`, `room`…) take a number
  or a `[[t, value], …]` automation curve.
- **Two kinds.** `kind: 'room'` plays on the home screen and drives the 3D room through hooks (camera override,
  extra lights, extra layers, reshaping walls/ceiling/sky, post override). `kind: 'stage'` takes the screen at
  `#/x/<id>` and extends `core/stage.js` (HDR target at adaptive resolution + the shared bloom/tonemap chain).
- **Lights.** While a piece runs, the light rig is in `script` mode and asks `scene.light(fixture, t)` for each
  fixture's colour (fixtures carry `anchor` and `az`), so a Hue sink gets the cues for free.

### Adding an experience

1. Make `public/js/experiences/<id>/` with `score.js` (`compose()` returns `score.done()`), `audio.js`
   (default export `setup(studio, score)`) and `scene.js` (`export class Scene`, with `init`, `update`, `draw`
   or the room hooks, and `light`).
2. Register it in `experiences/index.js` (short title, one-line tagline, duration, kind) and draw its card
   icon `xp-<id>` in `core/dom.js`. It appears under *Shows* on the Demos page.
3. Iterate on the sound with `node scripts/render_experience.mjs <id>` (6-channel WAV; renders ~10× real time),
   and on the picture by typing `marquee.experience.peek = 42` in the browser console to hold the visuals at
   any moment (`null` resumes).
