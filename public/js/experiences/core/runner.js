// Plays one experience: the worker renders the soundtrack for this exact speaker layout and streams it in;
// the scene draws in step with the audio clock and drives the lights.
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
    this.pending = [];
    this.T0 = null;
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
    const played = this.T0 === null ? 0 : Math.max(0, (this.ctx.currentTime - this.T0) * this.sr);
    this.worker.postMessage({ type: 'credit', frames: Math.round(played + (PREBUFFER + AHEAD) * this.sr) });
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
      if (this.T0 === null) {
        this.pending.push(item);
        this.loaded = Math.min(1, this.buffered / (PREBUFFER * this.sr));
        this.emit('progress', this.loaded);
        if (this.buffered >= PREBUFFER * this.sr || this.buffered >= this.frames) this._begin();
      } else this._schedule(item);
    } else if (m.type === 'done') {
      this.renderDone = true;
      if (this.T0 === null) this._begin();
    } else if (m.type === 'error') this._fail(m.message);
  }

  _begin() {
    const ctx = this.ctx;
    this.T0 = Math.ceil((ctx.currentTime + 0.12) * this.sr) / this.sr;
    this.state = 'playing';
    for (const it of this.pending) this._schedule(it);
    this.pending = [];
    this.emit('state', this.state);
  }

  _schedule(item) {
    const ctx = this.ctx;
    let when = this.T0 + item.start / this.sr;
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
    src.start(when);
    src.onended = () => {
      const i = this.sources.indexOf(src);
      if (i >= 0) this.sources.splice(i, 1);
      src.disconnect();
    };
    this.sources.push(src);
  }

  /** Score time currently being heard (seconds), following the audio hardware clock. */
  time(dt = 0) {
    if (this.T0 === null) return 0;
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
    let t = this.state === 'playing' || this.state === 'ended' ? this.time(dt) : 0;
    if (this.peek !== undefined && this.peek !== null) t = this.peek; // devtools: kw51.experience.peek = 42
    this.t = t;
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
