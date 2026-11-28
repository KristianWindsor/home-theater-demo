// Audio engine: one AudioContext for everything that isn't a movie.
//
// Movies and demo videos play through the browser's native media path (no Web Audio), so their
// multichannel audio reaches the OS/receiver exactly as the browser decodes it.
// Music, shows, test signals and the room's easter eggs go through here, which lets us:
//   * address individual speakers (channel merger -> discrete output channels)
//   * meter every output channel (the 3D room's woofers move with real levels)
//   * tap the music for the visualizer's live FFT
//
//   music ──────────────────────────────────────────────┐
//   shows (Awakening, Orbit) ───────────────── show bus ┼─► master (Volume) ─► output
//   speaker clicks, tests ─────────────────────── fx bus ─┘

// Chrome/Windows channel order for multichannel output devices
const ORDER = {
  1: ['FC'],
  2: ['FL', 'FR'],
  4: ['FL', 'FR', 'SL', 'SR'],
  6: ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
  8: ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'],
};

export const ROLE_LABEL = {
  FL: 'Front Left', FR: 'Front Right', FC: 'Center', LFE: 'Subwoofer (LFE)', SL: 'Surround Left',
  SR: 'Surround Right', BL: 'Back Left', BR: 'Back Right',
};

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.musicSources = new WeakMap();
    this.listeners = new Set();
  }

  get ready() {
    return !!this.ctx;
  }

  /**
   * Must be called from a user gesture the first time (autoplay rules). Creates the context synchronously, so
   * callers can start media in the same gesture before awaiting it.
   */
  async init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') await this.ctx.resume().catch(() => {});
      return this;
    }
    // iOS: a "playback" audio session plays through the silent switch, like a music app (Safari 17+)
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* not supported */ }
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    const dest = ctx.destination;
    const n = Math.min(8, dest.maxChannelCount || 2);
    this.channels = [8, 6, 4, 2, 1].find((c) => c <= n) || 2;
    try {
      dest.channelCount = this.channels;
      dest.channelCountMode = 'explicit';
      dest.channelInterpretation = 'speakers';
    } catch (e) {
      console.warn('[audio] could not set output channel count', e);
      this.channels = dest.channelCount;
    }
    this.order = ORDER[this.channels] || ORDER[2];
    this.master = ctx.createGain();
    this.master.channelCountMode = 'max';
    this.master.channelInterpretation = 'discrete';
    this.master.connect(dest);
    // level buses: each has a per-speaker merger and one gain, so a level change is one smooth ramp
    this.buses = {
      fx: this._bus(this.settings.fxLevel ?? 0.5),     // speaker clicks, Channel Check, Subwoofer Sweep, test tones
      show: this._bus(this.settings.showLevel ?? 1),   // Awakening and Orbit (Sound check level)
    };
    /** Where an experience's rendered channels go (already one channel per output). */
    this.showInput = this.buses.show.gain;
    this.speakers = {};
    this.musicChannels = 2;
    // meters on the final output
    this.splitter = ctx.createChannelSplitter(this.channels);
    this.master.connect(this.splitter);
    this.meters = [];
    for (let i = 0; i < this.channels; i++) {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      a.smoothingTimeConstant = 0;
      this.splitter.connect(a, i);
      this.meters.push(a);
    }
    this._meterBuf = new Float32Array(512);
    this.levelsArr = new Float32Array(this.channels);
    // music bus
    this.musicGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.musicAnalyser = ctx.createAnalyser();
    this.musicAnalyser.fftSize = 4096;
    this.musicAnalyser.smoothingTimeConstant = 0;
    this.setVolume(this.settings.volume ?? 1);
    ctx.onstatechange = () => this._emit();
    this._emit();
    return this;
  }

  _bus(level) {
    const ctx = this.ctx;
    const merger = ctx.createChannelMerger(this.channels);
    const gain = ctx.createGain();
    gain.gain.value = level;
    gain.channelCount = this.channels;
    gain.channelCountMode = 'explicit';
    gain.channelInterpretation = 'discrete';
    merger.connect(gain).connect(this.master);
    return { merger, gain };
  }

  /** Resume a suspended or interrupted context. Call from user gestures (it's cheap when already running). */
  unlock() {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  get layoutName() {
    return { 1: 'Mono', 2: 'Stereo', 4: 'Quadraphonic', 6: '5.1 surround', 8: '7.1 surround' }[this.channels] || `${this.channels} channels`;
  }

  /** Output channel index for a speaker role, or -1 if the device doesn't have it. */
  channelOf(role) {
    if (!this.order) return -1;
    let r = role;
    if (this.channels === 8) {
      const map = this.settings.surroundMap || 'side';
      if (map === 'back' && (role === 'SL' || role === 'SR')) r = role === 'SL' ? 'BL' : 'BR';
    } else if (role === 'BL' || role === 'BR') {
      r = role === 'BL' ? 'SL' : 'SR';
    }
    return this.order.indexOf(r);
  }

  /**
   * A mono input node whose sound comes out of one speaker only. On devices without that
   * channel it falls back sensibly (center -> phantom center, surrounds -> same-side front,
   * LFE -> low-passed into the fronts) and reports `virtual: true`.
   * bus: 'fx' (speaker clicks and tests) or 'show' (the built-in shows).
   */
  speaker(role, bus = 'fx') {
    const key = `${bus}:${role}`;
    if (this.speakers[key]) return this.speakers[key];
    const ctx = this.ctx;
    const merger = this.buses[bus].merger;
    // the built-in shows were mixed for the old shared level's 50% default; on the show bus 100% plays them as before
    const trim = bus === 'show' ? 0.5 : 1;
    const input = ctx.createGain();
    input.channelCount = 1;
    input.channelCountMode = 'explicit';
    const out = { input, virtual: false };
    const ch = this.channelOf(role);
    const send = (node, index, gain = 1) => {
      const gg = ctx.createGain();
      gg.gain.value = gain * trim;
      node.connect(gg);
      gg.connect(merger, 0, index);
    };
    if (ch >= 0) {
      send(input, ch);
    } else {
      out.virtual = true;
      const fl = this.channelOf('FL'), fr = this.channelOf('FR');
      if (role === 'FC') {
        send(input, fl, 0.707);
        send(input, fr, 0.707);
      } else if (role === 'LFE') {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 120;
        input.connect(lp);
        send(lp, fl, 0.707);
        send(lp, fr, 0.707);
      } else if (role === 'SL' || role === 'BL') {
        send(input, this.channelOf('SL') >= 0 ? this.channelOf('SL') : fl, 1);
      } else {
        send(input, this.channelOf('SR') >= 0 ? this.channelOf('SR') : fr, 1);
      }
    }
    this.speakers[key] = out;
    return out;
  }

  /** The engine as seen by a built-in demo: same API, but its speakers feed the given bus. */
  onBus(bus) {
    const view = Object.create(this);
    view.speaker = (role) => this.speaker(role, bus);
    return view;
  }

  setFxLevel(v) {
    this.settings.fxLevel = v;
    if (this.buses) this.buses.fx.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  setShowLevel(v) {
    this.settings.showLevel = v;
    if (this.buses) this.buses.show.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  setVolume(v) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Route an <audio> element through the engine (once per element). Returns the analyser. */
  attachMusic(el) {
    let node = this.musicSources.get(el);
    if (!node) {
      node = this.ctx.createMediaElementSource(el);
      this.musicSources.set(el, node);
      node.connect(this.musicAnalyser);
      this._routeMusic(node);
    }
    return this.musicAnalyser;
  }

  /** How many channels the current music file has (from the library's ffprobe data); re-routes if it changed. */
  setMusicChannels(n) {
    const c = Number.isFinite(n) && n > 0 ? Math.round(n) : 2;
    if (c === this.musicChannels) return;
    this.musicChannels = c;
    if (this.musicNode) this._routeMusic(this.musicNode);
  }

  /**
   * Music to the speakers:
   *   surround files (5.1, 7.1...)  every channel to its own speaker, as mastered (the upmix never touches them)
   *   stereo                        to the fronts as mastered, or upmixed to all speakers when that's switched on
   *   mono                          to both fronts (or the phantom-center anchor of the upmix)
   */
  _routeMusic(node) {
    for (const n of this._musicRoute || []) {
      try { n.disconnect(); } catch { /* already */ }
    }
    const route = (this._musicRoute = []);
    const keep = (n) => (route.push(n), n);
    try { node.disconnect(); } catch { /* not connected yet */ }
    node.connect(this.musicAnalyser);
    this.musicNode = node;
    const ctx = this.ctx;
    const src = this.musicChannels || 2;
    if (src > 2) {
      const roles = { 4: ['FL', 'FR', 'SL', 'SR'], 6: ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'], 8: ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'] }[src]; // FLAC/WAV channel order
      if (!roles || this.channels < 6) {
        // fewer speakers than channels (or an unusual layout): the browser's standard down-mix handles it
        node.connect(this.musicGain);
        return;
      }
      // channel by channel to the speaker that role belongs to (handles 7.1 devices' channel order too)
      const split = keep(ctx.createChannelSplitter(src));
      const merge = keep(ctx.createChannelMerger(this.channels));
      node.connect(split);
      roles.forEach((role, i) => {
        const ch = this.channelOf(role);
        if (ch >= 0) split.connect(merge, i, ch);
      });
      merge.connect(this.musicGain);
      return;
    }
    // mono or stereo: as a stereo pair (a mono file plays from both fronts, not just the left)
    const pair = keep(ctx.createGain());
    pair.channelCount = 2;
    pair.channelCountMode = 'explicit';
    pair.channelInterpretation = 'speakers';
    node.connect(pair);
    const wantUpmix = this.settings.upmix && this.channels >= 6;
    if (!wantUpmix) {
      pair.connect(this.musicGain);
      return;
    }
    // Passive-matrix style upmix: fronts as mastered, a high-passed phantom-center anchor,
    // decorrelated difference signal to the surrounds, low-passed sum to the LFE.
    const split = keep(ctx.createChannelSplitter(2));
    const merge = keep(ctx.createChannelMerger(this.channels));
    pair.connect(split);
    const g = (v) => {
      const x = keep(ctx.createGain());
      x.gain.value = v;
      return x;
    };
    const filter = (type, f) => {
      const x = keep(ctx.createBiquadFilter());
      x.type = type;
      x.frequency.value = f;
      return x;
    };
    const L = g(1), R = g(1);
    split.connect(L, 0);
    split.connect(R, 1);
    L.connect(merge, 0, this.channelOf('FL'));
    R.connect(merge, 0, this.channelOf('FR'));
    const sum = g(0.5);
    L.connect(sum);
    R.connect(sum);
    sum.connect(filter('highpass', 150)).connect(g(0.55)).connect(merge, 0, this.channelOf('FC'));
    sum.connect(filter('lowpass', 100)).connect(g(0.8)).connect(merge, 0, this.channelOf('LFE'));
    const diff = g(1);
    L.connect(g(0.5)).connect(diff);
    R.connect(g(-0.5)).connect(diff);
    const sLp = filter('lowpass', 7000);
    diff.connect(sLp);
    const dl = keep(ctx.createDelay(0.05));
    dl.delayTime.value = 0.012;
    const dr = keep(ctx.createDelay(0.05));
    dr.delayTime.value = 0.017;
    sLp.connect(dl).connect(g(0.8)).connect(merge, 0, this.channelOf('SL'));
    sLp.connect(g(-1)).connect(dr).connect(g(0.8)).connect(merge, 0, this.channelOf('SR'));
    merge.connect(this.musicGain);
  }

  setUpmix(on) {
    this.settings.upmix = on;
    if (this.musicNode) this._routeMusic(this.musicNode);
  }

  /** RMS level per output channel (0..1-ish), cheap enough to call every frame. */
  levels() {
    if (!this.meters) return null;
    const buf = this._meterBuf;
    for (let i = 0; i < this.meters.length; i++) {
      this.meters[i].getFloatTimeDomainData(buf);
      let s = 0;
      for (let k = 0; k < buf.length; k++) s += buf[k] * buf[k];
      this.levelsArr[i] = Math.sqrt(s / buf.length);
    }
    return this.levelsArr;
  }

  levelOf(role) {
    const ch = this.channelOf(role);
    return ch >= 0 && this.levelsArr ? this.levelsArr[ch] : 0;
  }

  /** Seconds between "now" on the audio clock and when it is heard. */
  get outputLatency() {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }
}
