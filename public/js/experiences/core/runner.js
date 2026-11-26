// Plays one experience: the worker renders the soundtrack for this exact speaker layout and streams it in;
// the scene draws in step with the audio clock and drives the lights. Rendered audio is kept, so a show can
// pause, restart and jump between chapters at once (a 2.5-minute piece is about 170 MB in 5.1); jumping ahead
// of what the worker has rendered waits for it to get there.
import { EXPERIENCE_BY_ID } from '../index.js';
import { speakersFromRoom } from './speakers.js';
import { settings } from '../../core/settings.js';

const PREBUFFER = 2.5; // seconds of audio rendered before playback starts
const AHEAD = 14; // seconds the worker may render ahead of the playhead

export class ExperienceRunner {
  constructor(app, id) {
    this.app = app;
    this.id = id;
    this.def = EXPERIENCE_BY_ID[id];
    this.kind = this.def ? this.def.kind : 'stage';
    this.listeners = new Map();
    this.state = 'idle';
    this.loaded = 0; // 0..1 prebuffer progress
    this.sources = [];
    this.chunks = []; // every chunk rendered so far, in order: { start (frame), buf }
    this.T0 = null; // context time of score time 0 while playing
    this.pausedAt = 0; // score time held while paused or waiting for audio (seeking)
    this.buffered = 0; // frames received
    this.visT = 0;
    this.renderSpeed = 0;
  }

  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev).add(fn);
    return () => this.listeners.get(ev).delete(fn);
  }

  emit(ev, d) {
    for (const fn of this.listeners.get(ev) || []) fn(d);
  }

  get duration() {
    return this.score ? this.score.duration : this.def ? this.def.duration : 0;
  }

  get chapters() {
    return this.score ? this.score.chapters : [];
  }

  /** Where playback is (score seconds): moving while playing, held while paused or seeking. */
  get position() {
    if (this.state === 'paused' || this.state === 'seeking') return this.pausedAt;
    if (this.T0 === null) return 0;
    return Math.min(this.duration, Math.max(0, this.ctx.currentTime - this.T0));
  }

  /** Index of the chapter playing at score time t. */
  chapterAt(t) {
    const ch = this.chapters;
    let i = 0;
    for (let k = 0; k < ch.length; k++) if (ch[k].t <= t + 0.05) i = k;
    return i;
  }

  /** Device channel order expressed as the roles the renderer produces. */
  _deviceRoles() {
    const eng = this.app.engine;
    const back = (settings.surroundMap || 'side') === 'back';
    return eng.order.map((ch) => {
      if (eng.channels === 8) {
        if (back) return ch === 'BL' ? 'SL' : ch === 'BR' ? 'SR' : ch === 'SL' || ch === 'SR' ? `x${ch}` : ch;
        return ch === 'BL' || ch === 'BR' ? `x${ch}` : ch;
      }
      return ch;
    });
  }

  async start() {
    const app = this.app;
    const eng = app.engine;
    this.state = 'loading';
    this.emit('state', this.state);
    await eng.init();
    const ctx = eng.ctx;
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    const [scoreMod, sceneMod] = await Promise.all([import(`../${this.id}/score.js`), import(`../${this.id}/scene.js`)]);
    if (this.state === 'stopped') return;
    this.score = scoreMod.compose();
    this.scene = new sceneMod.Scene(app, this.score, this);
    if (this.scene.init) await this.scene.init();
    if (this.state === 'stopped') return;
    // output bus: discrete channels into the shows bus (Settings → Shows level), then the master
    this.bus = ctx.createGain();
    this.bus.channelCount = eng.channels;
    this.bus.channelCountMode = 'explicit';
    this.bus.channelInterpretation = 'discrete';
    this.bus.connect(eng.showInput || eng.master);
    this.deviceRoles = this._deviceRoles();
    this.worker = new Worker(new URL('../audio/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._msg(e.data);
    this.worker.onerror = (e) => this._fail(e.message || 'worker failed');
    this.worker.postMessage({
      type: 'start', id: this.id, sr: this.sr, speakers: speakersFromRoom(app.library.room || {}),
      deviceRoles: this.deviceRoles, chunk: 12288, credit: Math.round((PREBUFFER + AHEAD) * this.sr),
    });
    this._creditTimer = setInterval(() => this._credit(), 400);
  }

  _fail(msg) {
    console.error('[experience]', msg);
    this.state = 'error';
    this.error = msg;
    this.emit('state', this.state);
  }

  _credit() {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'credit', frames: Math.round((this.position + PREBUFFER + AHEAD) * this.sr) });
  }

  _msg(m) {
    if (this.state === 'stopped') return;
    if (m.type === 'meta') {
      this.frames = m.frames;
      this.channels = m.channels;
    } else if (m.type === 'chunk') {
      const buf = this.ctx.createBuffer(m.data.length, m.frames, this.sr);
      for (let c = 0; c < m.data.length; c++) buf.copyToChannel(m.data[c], c);
      this.buffered = m.start + m.frames;
      this.renderSpeed = (m.frames / this.sr) / Math.max(0.001, m.ms / 1000);
      const item = { start: m.start, buf };
      this.chunks.push(item);
      if (this.T0 === null) {
        this.loaded = Math.min(1, this.buffered / (PREBUFFER * this.sr));
        this.emit('progress', this.loaded);
        if (this.buffered >= PREBUFFER * this.sr || this.buffered >= this.frames) this._go(0);
      } else if (this.state === 'playing') this._startChunk(item);
      else if (this.state === 'seeking') this._seekProgress();
    } else if (m.type === 'done') {
      this.renderDone = true;
      if (this.T0 === null) this._go(0);
      else if (this.state === 'seeking') this._seekProgress();
    } else if (m.type === 'error') this._fail(m.message);
  }

  /** Enough audio rendered to play from score time t: a prebuffer's worth, or everything left. */
  _ready(t) {
    return this.renderDone || this.buffered >= Math.min(this.frames || Infinity, Math.floor(t * this.sr) + PREBUFFER * this.sr);
  }

  /** Fade out and stop whatever is playing (the chunks stay, for playing again). */
  _halt() {
    if (!this.bus) return;
    const now = this.ctx.currentTime, g = this.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.04);
    for (const s of this.sources.splice(0)) {
      try { s.stop(now + 0.05); } catch { /* not started */ }
    }
  }

  /** Play from score time t: every kept chunk from there on is scheduled; later ones follow as they arrive. */
  _go(t) {
    const ctx = this.ctx, now = ctx.currentTime;
    const first = this.T0 === null;
    const fading = this.sources.length > 0;
    if (fading) this._halt();
    const when = first ? Math.ceil((now + 0.12) * this.sr) / this.sr : now + (fading ? 0.07 : 0.03);
    if (!first) {
      const g = this.bus.gain;
      g.setValueAtTime(0, when);
      g.linearRampToValueAtTime(1, when + 0.02);
    }
    this.T0 = when - t;
    this.visT = t;
    const from = Math.round(t * this.sr);
    for (const c of this.chunks) if (c.start + c.buf.length > from) this._startChunk(c, from);
    if (this.state !== 'playing') {
      this.state = 'playing';
      this.emit('state', this.state);
    }
  }

  _startChunk(item, from = 0) {
    const ctx = this.ctx;
    const off = Math.max(0, from - item.start);
    if (off >= item.buf.length) return;
    let when = this.T0 + (item.start + off) / this.sr;
    if (when < ctx.currentTime + 0.01) {
      // the renderer fell behind: slip the timeline (picture follows, since it reads the same clock)
      const slip = ctx.currentTime + 0.25 - when;
      this.T0 += slip;
      when += slip;
      this.underruns = (this.underruns || 0) + 1;
      console.warn(`[experience] audio underrun, slipped ${slip.toFixed(2)} s`);
    }
    const src = ctx.createBufferSource();
    src.buffer = item.buf;
    src.connect(this.bus);
    src.start(when, off / this.sr);
    src.onended = () => {
      const i = this.sources.indexOf(src);
      if (i >= 0) this.sources.splice(i, 1);
      src.disconnect();
    };
    this.sources.push(src);
  }

  // ---------------------------------------------------------------- transport
  /** Jump to score time t (seconds). play: true starts playback, false holds it, undefined keeps what it was doing. */
  seek(t, play) {
    if (!this.score || this.T0 === null || this.state === 'stopped' || this.state === 'error') return;
    t = Math.max(0, Math.min(this.duration - 0.05, t));
    const go = play ?? (this.state === 'playing' || this.state === 'ended' || (this.state === 'seeking' && this._resume));
    if (this._ready(t) && go) this._go(t);
    else {
      this._halt();
      this.pausedAt = t;
      this.visT = t;
      this._resume = go;
      const st = this._ready(t) ? 'paused' : 'seeking';
      if (st === 'seeking') this._credit();
      if (this.state !== st) {
        this.state = st;
        this.emit('state', st);
      }
    }
    this.emit('seek', t);
  }

  /** Audio for a far jump has arrived: carry on (playing or paused, as asked). */
  _seekProgress() {
    if (!this._ready(this.pausedAt)) return;
    if (this._resume) this._go(this.pausedAt);
    else {
      this.state = 'paused';
      this.emit('state', this.state);
    }
  }

  pause() {
    if (this.state === 'seeking') this._resume = false;
    if (this.state !== 'playing') return;
    this.pausedAt = this.position;
    this._halt();
    this.state = 'paused';
    this.emit('state', this.state);
  }

  resume() {
    if (this.state === 'paused') this.seek(this.pausedAt, true);
    else if (this.state === 'seeking') this._resume = true;
    else if (this.state === 'ended') this.seek(0, true);
  }

  toggle() {
    if (this.state === 'playing') this.pause();
    else this.resume();
  }

  restart() {
    this.seek(0, true);
  }

  /** Fade the sound out over `seconds` (the showcase ends shows early this way); resolves once it's silent. */
  fadeOut(seconds = 1.5) {
    if (!this.bus || !this.ctx) return Promise.resolve();
    const now = this.ctx.currentTime, g = this.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  /** Previous (dir -1: the start of this chapter, or the one before when already near it) or next chapter. */
  jumpChapter(dir) {
    const ch = this.chapters;
    if (!ch.length) return;
    const t = this.position;
    let i = this.chapterAt(t);
    if (dir < 0) {
      if (t - ch[i].t < 2.5 && i > 0) i--;
    } else {
      if (i >= ch.length - 1) return;
      i++;
    }
    this.seek(ch[i].t);
  }

  /** Score time currently being heard (seconds), following the audio hardware clock. */
  time(dt = 0) {
    if (this.T0 === null) return 0;
    if (this.state === 'paused' || this.state === 'seeking') {
      this.visT = this.pausedAt;
      return this.pausedAt;
    }
    const ctx = this.ctx;
    let heard = ctx.currentTime - (ctx.outputLatency || 0);
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) heard = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    const target = heard - this.T0 - (settings.avOffsetMs || 0) / 1000;
    // smooth the clock: advance by frame time, nudge toward the hardware clock
    const next = this.visT + dt;
    this.visT = Math.abs(target - next) > 0.08 ? target : next + (target - next) * 0.12;
    return Math.max(0, this.visT);
  }

  /** Called by the app every animation frame while the experience owns the screen. */
  frame(w, h, dt) {
    const s = this.scene;
    if (!s) return;
    const held = this.state === 'paused' || this.state === 'seeking';
    let t = held || this.state === 'playing' || this.state === 'ended' ? this.time(dt) : 0;
    if (this.peek !== undefined && this.peek !== null) t = this.peek; // devtools: kw51.experience.peek = 42
    this.t = t;
    if (held) dt = 0; // paused: the picture holds too
    s.update(t, dt, this.state);
    s.render(w, h, t, dt);
    if (this.state === 'playing' && t > this.duration + 0.4) {
      this.state = 'ended';
      this.emit('state', this.state);
      this.emit('end');
    }
  }

  /** Light colour for a fixture at the current time (LightRig "script" mode). */
  light(f) {
    if (!this.scene || !this.scene.light) return null;
    return this.scene.light(f, this.t || 0);
  }

  stop() {
    if (this.state === 'stopped') return;
    const prev = this.state;
    this.state = 'stopped';
    clearInterval(this._creditTimer);
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'stop' });
      } catch { /* gone */ }
      setTimeout(() => this.worker && this.worker.terminate(), 200);
    }
    if (this.bus && this.ctx) {
      const now = this.ctx.currentTime;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setValueAtTime(this.bus.gain.value, now);
      this.bus.gain.linearRampToValueAtTime(0, now + (prev === 'ended' ? 0.05 : 0.45));
      const sources = this.sources.slice();
      const bus = this.bus;
      setTimeout(() => {
        for (const s of sources) try { s.stop(); } catch { /* already */ }
        bus.disconnect();
      }, 550);
    }
    this.chunks = [];
    if (this.scene && this.scene.dispose) {
      try {
        this.scene.dispose();
      } catch (e) {
        console.warn(e);
      }
    }
    this.emit('state', this.state);
  }
}
