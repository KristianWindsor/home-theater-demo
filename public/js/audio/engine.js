// Audio engine: one AudioContext for everything that isn't a movie.
//
// Movies and demo videos play through the browser's native media path (no Web Audio), so their
// multichannel audio reaches the OS/receiver exactly as the browser decodes it.
// Music, test signals and the room's easter eggs go through here, which lets us:
//   * address individual speakers (channel merger -> discrete output channels)
//   * meter every output channel (the 3D room's woofers move with real levels)
//   * tap the music for the visualizer's live FFT

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

  /** Must be called from a user gesture the first time (autoplay rules). */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this;
    }
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
    // per-speaker bus
    this.merger = ctx.createChannelMerger(this.channels);
    this.merger.connect(this.master);
    this.speakers = {};
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
   */
  speaker(role) {
    if (this.speakers[role]) return this.speakers[role];
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.channelCount = 1;
    input.channelCountMode = 'explicit';
    const out = { input, virtual: false };
    const ch = this.channelOf(role);
    const send = (node, index, gain = 1) => {
      const gg = ctx.createGain();
      gg.gain.value = gain * (this.settings.fxLevel ?? 0.5);
      node.connect(gg);
      gg.connect(this.merger, 0, index);
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
    this.speakers[role] = out;
    return out;
  }

  setFxLevel(v) {
    this.settings.fxLevel = v;
    this.speakers = {}; // rebuilt lazily with the new level
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

  _routeMusic(node) {
    if (this._upmix) {
      for (const n of this._upmix) n.disconnect();
      this._upmix = null;
    }
    try { node.disconnect(this.musicGain); } catch { /* not connected yet */ }
    this.musicNode = node;
    const wantUpmix = this.settings.upmix && this.channels >= 6;
    if (!wantUpmix) {
      node.connect(this.musicGain);
      return;
    }
    // Passive-matrix style upmix: fronts as mastered, a high-passed phantom-center anchor,
    // decorrelated difference signal to the surrounds, low-passed sum to the LFE.
    const ctx = this.ctx;
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(this.channels);
    node.connect(split);
    const g = (v) => {
      const x = ctx.createGain();
      x.gain.value = v;
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
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 150;
    const cg = g(0.55);
    sum.connect(hp).connect(cg).connect(merge, 0, this.channelOf('FC'));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 100;
    sum.connect(lp).connect(g(0.8)).connect(merge, 0, this.channelOf('LFE'));
    const diffL = g(0.5), diffR = g(-0.5);
    L.connect(diffL);
    R.connect(diffR);
    const diff = g(1);
    diffL.connect(diff);
    diffR.connect(diff);
    const sLp = ctx.createBiquadFilter();
    sLp.type = 'lowpass';
    sLp.frequency.value = 7000;
    diff.connect(sLp);
    const dl = ctx.createDelay(0.05);
    dl.delayTime.value = 0.012;
    const dr = ctx.createDelay(0.05);
    dr.delayTime.value = 0.017;
    const inv = g(-1);
    sLp.connect(dl).connect(g(0.8)).connect(merge, 0, this.channelOf('SL'));
    sLp.connect(inv).connect(dr).connect(g(0.8)).connect(merge, 0, this.channelOf('SR'));
    merge.connect(this.musicGain);
    this._upmix = [split, merge];
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
