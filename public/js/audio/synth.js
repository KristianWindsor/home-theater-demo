// Procedural sounds (no samples), each routable to a single speaker.

export class Synth {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.pink = this._pinkBuffer(4);
    this.white = this._whiteBuffer(4);
  }

  _pinkBuffer(sec) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  _whiteBuffer(sec) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noise(kind = 'pink') {
    const s = this.ctx.createBufferSource();
    s.buffer = kind === 'pink' ? this.pink : this.white;
    s.loop = true;
    s.loopStart = Math.random() * 2;
    return s;
  }

  _env(gain, t0, attack, hold, release, peak = 1) {
    const g = gain.gain;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    g.setValueAtTime(peak, t0 + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    return t0 + attack + hold + release;
  }

  _out(role) {
    return this.engine.speaker(role).input;
  }

  /** Play a named sound on one speaker. Returns { stop, duration }. */
  play(role, name, opts = {}) {
    const fn = this[`_${name}`];
    if (!fn) throw new Error(`unknown sound ${name}`);
    return fn.call(this, this._out(role), this.ctx.currentTime + 0.01, opts);
  }

  _finish(nodes, end) {
    return {
      duration: end - this.ctx.currentTime,
      stop: () => {
        for (const n of nodes) {
          try { n.stop(); } catch { /* already stopped */ }
        }
      },
    };
  }

  _pinkBurst(out, t0, { dur = 1.6, level = 0.35 } = {}) {
    const src = this._noise('pink');
    const g = this.ctx.createGain();
    src.connect(g).connect(out);
    const end = this._env(g, t0, 0.03, dur, 0.08, level);
    src.start(t0);
    src.stop(end + 0.05);
    return this._finish([src], end);
  }

  _lfeRumble(out, t0, { dur = 1.6, level = 0.6 } = {}) {
    const src = this._noise('white');
    const bp1 = this.ctx.createBiquadFilter();
    bp1.type = 'lowpass';
    bp1.frequency.value = 80;
    bp1.Q.value = 0.7;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 28;
    const g = this.ctx.createGain();
    src.connect(bp1).connect(hp).connect(g).connect(out);
    const end = this._env(g, t0, 0.05, dur, 0.15, level * 2.2);
    src.start(t0);
    src.stop(end + 0.05);
    return this._finish([src], end);
  }

  _zap(out, t0, { pitch = 1 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2200 * pitch, t0);
    o.frequency.exponentialRampToValueAtTime(90 * pitch, t0 + 0.42);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(3000 * pitch, t0);
    f.frequency.exponentialRampToValueAtTime(200, t0 + 0.42);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(1100 * pitch, t0);
    o2.frequency.exponentialRampToValueAtTime(60, t0 + 0.3);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    const g = ctx.createGain();
    o.connect(f).connect(g);
    o2.connect(g2).connect(g);
    g.connect(out);
    const end = this._env(g, t0, 0.004, 0.08, 0.4, 0.5);
    o.start(t0);
    o2.start(t0);
    o.stop(end);
    o2.stop(end);
    return this._finish([o, o2], end);
  }

  _chime(out, t0, { base = 660 } = {}) {
    const ctx = this.ctx;
    const nodes = [];
    const g = ctx.createGain();
    g.connect(out);
    [[1, 0.5], [2.76, 0.18], [5.4, 0.08], [1.5, 0.22]].forEach(([ratio, amp], i) => {
      const c = ctx.createOscillator();
      c.frequency.value = base * ratio;
      const m = ctx.createOscillator();
      m.frequency.value = base * ratio * 3.5;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(base * ratio * 2.2, t0);
      mg.gain.exponentialRampToValueAtTime(1, t0 + 1.2);
      m.connect(mg).connect(c.frequency);
      const a = ctx.createGain();
      a.gain.setValueAtTime(0, t0 + i * 0.09);
      a.gain.linearRampToValueAtTime(amp, t0 + i * 0.09 + 0.005);
      a.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 2.2);
      c.connect(a).connect(g);
      c.start(t0 + i * 0.09);
      m.start(t0 + i * 0.09);
      c.stop(t0 + 2.6);
      m.stop(t0 + 2.6);
      nodes.push(c, m);
    });
    return this._finish(nodes, t0 + 2.6);
  }

  _whoosh(out, t0, { dur = 1.3 } = {}) {
    const ctx = this.ctx;
    const src = this._noise('white');
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.8;
    f.frequency.setValueAtTime(300, t0);
    f.frequency.exponentialRampToValueAtTime(4500, t0 + dur * 0.55);
    f.frequency.exponentialRampToValueAtTime(500, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.7, t0 + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return this._finish([src], t0 + dur);
  }

  /** The "ungodly subwoofer" button: a cinematic sub drop. */
  _boom(out, t0, { dur = 3.2 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(64, t0);
    o.frequency.exponentialRampToValueAtTime(24, t0 + dur);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 110;
    const g = ctx.createGain();
    o.connect(shaper).connect(lp).connect(g).connect(out);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + 0.02);
    g.gain.setTargetAtTime(0.0001, t0 + 0.6, dur / 3.5);
    const thump = this._noise('white');
    const tl = ctx.createBiquadFilter();
    tl.type = 'lowpass';
    tl.frequency.value = 160;
    const tg = ctx.createGain();
    thump.connect(tl).connect(tg).connect(out);
    this._env(tg, t0, 0.003, 0.02, 0.35, 1.4);
    o.start(t0);
    thump.start(t0);
    o.stop(t0 + dur + 1);
    thump.stop(t0 + 0.5);
    return this._finish([o, thump], t0 + dur);
  }

  _tone(out, t0, { freq = 1000, dur = 1, level = 0.3 } = {}) {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    o.connect(g).connect(out);
    const end = this._env(g, t0, 0.01, dur, 0.05, level);
    o.start(t0);
    o.stop(end + 0.02);
    return this._finish([o], end);
  }

  _click(out, t0, { level = 0.8 } = {}) {
    const o = this.ctx.createOscillator();
    o.frequency.value = 1800;
    const g = this.ctx.createGain();
    o.connect(g).connect(out);
    g.gain.setValueAtTime(level, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    o.start(t0);
    o.stop(t0 + 0.05);
    return this._finish([o], t0 + 0.05);
  }

  /** Logarithmic sine sweep (subwoofer test). */
  _sweep(out, t0, { from = 120, to = 18, dur = 22, level = 0.5 } = {}) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = this.ctx.createGain();
    o.connect(g).connect(out);
    const end = this._env(g, t0, 0.5, dur - 1, 0.5, level);
    o.start(t0);
    o.stop(end + 0.05);
    return this._finish([o], end);
  }
}

/**
 * A mono source that can be panned around a ring of speakers (pairwise constant-power).
 * ring: [{ role, az }] with az in degrees (0 = straight ahead, clockwise positive).
 */
export class RingPanner {
  constructor(engine, ring) {
    this.ctx = engine.ctx;
    this.input = this.ctx.createGain();
    this.ring = ring.slice().sort((a, b) => a.az - b.az);
    this.gains = this.ring.map((s) => {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.input.connect(g);
      g.connect(engine.speaker(s.role).input);
      return g;
    });
  }

  setAngle(deg) {
    const n = this.ring.length;
    const a = ((deg % 360) + 540) % 360 - 180;
    let i = n - 1;
    for (let k = 0; k < n; k++) if (this.ring[k].az <= a) i = k;
    const j = (i + 1) % n;
    const a0 = this.ring[i].az;
    let a1 = this.ring[j].az;
    let x = a;
    if (j <= i) {
      a1 += 360;
      if (x < a0) x += 360;
    }
    const t = Math.min(1, Math.max(0, (x - a0) / (a1 - a0 || 1)));
    const now = this.ctx.currentTime;
    this.gains.forEach((g, k) => {
      const v = k === i ? Math.cos(t * Math.PI / 2) : k === j ? Math.sin(t * Math.PI / 2) : 0;
      g.gain.setTargetAtTime(v, now, 0.02);
    });
    return { i, j, t };
  }

  disconnect() {
    this.input.disconnect();
    for (const g of this.gains) g.disconnect();
  }
}
