// Music playback: queue, stream selection, score loading, live fallback, timing for the visuals.
import { api } from '../core/api.js';
import { canPlayAudioFile } from '../core/compat.js';
import { Score, ScoreSource } from '../viz/score.js';
import { LiveSource } from '../viz/live.js';
import { settings } from '../core/settings.js';

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

  async playQueue(items, start = 0) {
    this.queue = items.slice();
    this.index = Math.max(0, Math.min(start, items.length - 1));
    await this.load(this.queue[this.index]);
  }

  async load(item, autoplay = true) {
    const app = this.app;
    await app.engine.init();
    this.item = item;
    this.usingCompat = !canPlayAudioFile(item);
    this.el.src = this.usingCompat ? item.compatUrl : item.url;
    this.el.currentTime = 0;
    const analyser = app.engine.attachMusic(this.el);
    app.viz().setAnalyser(analyser);
    this.live = new LiveSource(analyser);
    this.source = this.live;
    app.viz().setSource(this.live, item.title);
    this._emit('track');
    if (autoplay) this.el.play().catch((e) => console.warn('[music] play()', e));
    await this._loadScore(item);
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
    if (this.el.paused) this.el.play().catch(() => {});
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
    this._emit('stop');
  }
}
