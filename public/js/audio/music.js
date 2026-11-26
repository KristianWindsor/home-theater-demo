// Music playback: queue, stream selection, score loading, live fallback, timing for the visuals, music videos.
import { api } from '../core/api.js';
import { canPlayAudioFile, videoCodecOk } from '../core/compat.js';
import { Score, ScoreSource } from '../viz/score.js';
import { LiveSource } from '../viz/live.js';
import { settings } from '../core/settings.js';
import { toast } from '../core/dom.js';

// A music video is a muted <video> that follows the song: the <audio> element (through Web Audio) stays the one
// thing that makes sound, and the picture follows visualTime, so Settings → Audio/video sync lines it up exactly
// like the visualizer. Small drift is caught up by playing the picture slightly faster or slower; a big one
// (a seek, a stall) makes it jump, aimed a little ahead since decoding to the new spot takes a moment.
const JUMP = 0.25;     // seconds of drift that make the picture jump instead of catching up
const NUDGE = 0.08;   // the most the picture's speed changes while catching up (±8 %)

export class MusicPlayer {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('music');
    this.queue = [];
    this.index = -1;
    this.item = null;
    this.source = null;
    this.scores = new Map();
    this.listeners = new Set();
    this.lastT = 0;
    this.lastPerf = 0;
    this.video = document.getElementById('musicvideo');
    this.video.muted = true;
    this.videoUrl = null;
    this.videoState = 'none'; // none | loading | ready | failed
    this.preferViz = false;   // switched to the visualizer during a music video; holds for the rest of the queue
    this.videoDrift = 0;      // picture minus song, seconds (the performance overlay shows it)
    this.seekLead = 0.15;     // how long a jump of the picture takes here, learned from the jumps so far
    this._jumpAt = 0;         // when the picture last jumped (at most one jump a second while playing)
    this._seekStart = 0;
    this._videoPlay = null;
    this.video.addEventListener('loadeddata', () => {
      if (this.videoState !== 'loading') return;
      this.videoState = 'ready';
      this._emit('video');
    });
    this.video.addEventListener('error', () => {
      if (!this.videoUrl) return;
      console.warn(`[music] the music video didn't play (${this.video.error && this.video.error.message}); showing the visualizer`);
      this.videoState = 'failed';
      this._emit('video');
    });
    this.video.addEventListener('seeked', () => {
      if (!this._seekStart) return;
      const took = (performance.now() - this._seekStart) / 1000;
      this.seekLead = Math.max(0.03, Math.min(1, this.seekLead * 0.5 + took * 0.5));
      this._seekStart = 0;
    });
    this.el.addEventListener('ended', () => this.next(true));
    for (const ev of ['play', 'pause', 'playing', 'waiting', 'seeked', 'loadedmetadata']) this.el.addEventListener(ev, () => this._emit(ev));
    this.el.addEventListener('error', () => {
      if (!this.item) return;
      if (!this.usingCompat && this.item.compatUrl) {
        // the browser refused the original: fall back to the lossless FLAC copy
        this.usingCompat = true;
        const t = this.el.currentTime || 0;
        this.el.src = this.item.compatUrl;
        this.el.currentTime = t;
        this.el.play().catch(() => {});
      } else {
        this._emit('error');
      }
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(type) {
    for (const fn of this.listeners) fn(type, this);
  }

  get playing() {
    return !!this.item && !this.el.paused && !this.el.ended;
  }

  get duration() {
    return this.el.duration || (this.item && this.item.duration) || 0;
  }

  /** Audio time, smoothed between media clock updates. */
  get time() {
    const t = this.el.currentTime || 0;
    const now = performance.now();
    if (t !== this.lastT || !this.playing) {
      this.lastT = t;
      this.lastPerf = now;
      return t;
    }
    return t + Math.min(0.25, (now - this.lastPerf) / 1000) * (this.el.playbackRate || 1);
  }

  /** Time the visuals should show (A/V sync offset applied). */
  get visualTime() {
    return Math.max(0, this.time - (settings.avOffsetMs || 0) / 1000);
  }

  /** The current song's music video, when this browser plays it. */
  get mv() {
    const mv = this.item && this.item.musicVideo;
    return mv && this.videoUrl === mv.url && this.videoState !== 'failed' ? mv : null;
  }

  /** The picture is the music video rather than the visualizer. */
  get videoOn() {
    return !!this.mv && !this.preferViz;
  }

  /** ...and it has a frame to show. */
  get videoFrame() {
    return this.videoOn && this.video.readyState >= 2;
  }

  /** Music video or visualizer, for this song and the rest of the queue. */
  setVideo(on) {
    this.preferViz = !on;
    this._emit('video');
  }

  async playQueue(items, start = 0) {
    this.queue = items.slice();
    this.index = Math.max(0, Math.min(start, items.length - 1));
    this.preferViz = false;
    await this.load(this.queue[this.index]);
  }

  async load(item, autoplay = true) {
    const app = this.app;
    // start the context but don't wait for it: Safari only lets media start inside the tap that asked for it,
    // and awaiting first can end that gesture (the song then stays silent)
    const ready = app.engine.init();
    this.item = item;
    this.usingCompat = !canPlayAudioFile(item);
    this.el.src = this.usingCompat ? item.compatUrl : item.url;
    this.el.currentTime = 0;
    this._loadVideo(item);
    const a0 = item.probe && item.probe.audio && item.probe.audio[0];
    app.engine.setMusicChannels(a0 && a0.channels ? a0.channels : 2);
    const analyser = app.engine.attachMusic(this.el);
    app.viz().setAnalyser(analyser);
    this.live = new LiveSource(analyser);
    this.source = this.live;
    app.viz().setSource(this.live, item.title);
    this._emit('track');
    if (autoplay) this._play();
    await ready;
    await this._loadScore(item);
  }

  _play() {
    this.app.engine.unlock();
    this.el.play().catch((e) => {
      if (e && e.name === 'NotAllowedError') {
        // the browser wants a fresh tap before it makes sound
        toast('Tap play to start the music.', 'warn', 5000);
        this._emit('pause');
      } else if (e && e.name !== 'AbortError') console.warn('[music] play()', e);
    });
  }

  async _loadScore(item) {
    let score = this.scores.get(item.id);
    if (!score) {
      try {
        const json = await api.score(item.id);
        score = new Score(json);
        this.scores.set(item.id, score);
      } catch (e) {
        // not analyzed yet: the server queued it at the front; we stay live until it's ready
        this._emit('live');
        return;
      }
    }
    if (this.item !== item) return;
    this.source = new ScoreSource(score);
    this.app.viz().setSource(this.source, item.title);
    this._emit('score');
  }

  /** SSE: analysis finished somewhere — hot-swap if it's the current track. */
  onAnalysis(ev) {
    if (ev.status === 'ready') {
      this.scores.delete(ev.id);
      if (this.item && this.item.id === ev.id && !(this.source instanceof ScoreSource)) this._loadScore(this.item);
    }
  }

  toggle() {
    if (!this.item) return;
    if (this.el.paused) this._play();
    else this.el.pause();
  }

  pause() {
    this.el.pause();
  }

  seek(t) {
    if (!this.item) return;
    this.el.currentTime = Math.max(0, Math.min(this.duration - 0.05, t));
  }

  async next(auto = false) {
    if (this.index + 1 < this.queue.length) {
      this.index++;
      await this.load(this.queue[this.index]);
    } else if (auto) {
      this._emit('end');
    }
  }

  async prev() {
    if (this.time > 3 || this.index === 0) this.seek(0);
    else {
      this.index--;
      await this.load(this.queue[this.index]);
    }
  }

  stop() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.item = null;
    this.source = null;
    this.queue = [];
    this.index = -1;
    this._loadVideo(null);
    this._emit('stop');
  }

  // ---------------------------------------------------------------- music video
  _loadVideo(item) {
    const v = this.video;
    const mv = item && item.musicVideo;
    this.videoDrift = 0;
    v.playbackRate = 1;
    if (!mv || !videoCodecOk(mv.video && mv.video.codecString)) {
      if (mv) console.info(`[music] this browser can't decode ${item.title}'s ${mv.video.codec} video; showing the visualizer`);
      if (this.videoUrl) {
        this.videoUrl = null;
        v.pause();
        v.removeAttribute('src');
        v.removeAttribute('poster');
        v.load();
      }
      this.videoState = 'none';
      return;
    }
    if (this.videoUrl === mv.url && !v.error) {
      // the same video again (replay, or a one-song queue)
      this.videoState = v.readyState >= 2 ? 'ready' : 'loading';
      v.currentTime = 0;
      return;
    }
    this.videoUrl = mv.url;
    this.videoState = 'loading';
    if (item.cover) v.poster = item.cover;
    else v.removeAttribute('poster');
    v.src = mv.url;
  }

  /** Keep the music video on the song's clock. Called every animation frame. */
  syncVideo() {
    const v = this.video;
    if (!this.mv) return;
    if (!this.videoOn) {
      // the visualizer is showing: nothing to decode (switching back makes the picture jump into place)
      if (!v.paused) v.pause();
      return;
    }
    if (v.readyState < 1 || v.seeking) return;
    const end = Math.max(0, (v.duration || this.mv.duration || 0) - 0.05);
    const rolling = this.playing && this.el.readyState >= 3 && !this.el.seeking;
    // while the song is held up (seeking, stalled) its clock stands still: `time` would run on ahead of it
    const t = rolling ? this.visualTime : Math.max(0, this.el.currentTime - (settings.avOffsetMs || 0) / 1000);
    if (!rolling || t >= end) {
      // paused, stalled, seeking, or the song outlasts its video: hold the frame that belongs to this moment
      if (!v.paused) v.pause();
      if (v.playbackRate !== 1) v.playbackRate = 1;
      const want = Math.min(t, end);
      if (Math.abs(v.currentTime - want) > 0.1) this._jump(want);
      this.videoDrift = 0;
      return;
    }
    const drift = v.currentTime - t;
    this.videoDrift = drift;
    if (Math.abs(drift) > JUMP && performance.now() - this._jumpAt > 1000) {
      this._jump(Math.min(end, t + this.seekLead));
      return;
    }
    if (v.paused) this._playVideo();
    let rate = 1;
    if (Math.abs(drift) > 0.015) rate = 1 - Math.max(-NUDGE, Math.min(NUDGE, drift));
    rate = Math.round(rate * 200) / 200; // steps of 0.5 %, so a tiny wobble doesn't set a new speed every frame
    if (v.playbackRate !== rate) v.playbackRate = rate;
  }

  _jump(t) {
    this._jumpAt = this._seekStart = performance.now();
    this.video.currentTime = Math.max(0, t);
  }

  _playVideo() {
    if (this._videoPlay) return;
    this._videoPlay = this.video.play().catch((e) => {
      // e.g. iOS in Low Power Mode, which won't play video by itself: the visualizer takes over
      if (e && e.name === 'NotAllowedError') {
        this.videoState = 'failed';
        this._emit('video');
      }
    }).finally(() => {
      this._videoPlay = null;
    });
  }
}
