// A cat, by physics rather than recordings. The purr is what the larynx actually does: the vocal folds open and
// snap shut about 25 times a second, all the way through both breathing out and breathing in (the in-breath a
// little higher and breathier, the sound dipping at each turn of the breath), each puff ringing the closed-mouth
// vocal tract and the body; a separate pure layer carries the fundamental to the subwoofer. Around it: the collar
// bell (a ball rattling in a small spherical shell: inharmonic partials up high), paws, the jump and landing,
// kneading, the ear flick, and the questioning trill ("mrrp?").
import { Noise, OnePole, Biquad, SVF, sinCycle } from './dsp.js';
import { Rng, TAU, Curve, clamp } from '../core/timeline.js';

// ---------------------------------------------------------------- purr
/**
 * opts: dur, level (number | fn(t)) 0..1 loudness, f0 (Hz, exhale), sleep (fn(t) 0..1: slower, softer breathing),
 *       seed, rise (fn(t) multiplier on f0: used by the purr->engine morph), brightness (fn(t) 0..1)
 * get(abs, n) -> { main, sub } for taps (PurrVoice) that start together.
 */
export class PurrCore {
  constructor(sr, o) {
    this.sr = sr;
    this.dur = o.dur ?? 20;
    this.level = typeof o.level === 'function' ? o.level : () => o.level ?? 1;
    this.sleep = o.sleep || (() => 0);
    this.rise = o.rise || (() => 1);
    this.bright = o.brightness || (() => 0.5);
    this.f0 = o.f0 ?? 23.6;
    this.rng = new Rng(o.seed || 91);
    this.noise = new Noise(o.seed || 91);
    this.t0 = o.t0 || 0; // score time of sample 0 (for the curves above, which take score time)
    this.pos = 0;
    // breathing: alternate exhale / inhale with natural variation, or follow the score's schedule
    this.breaths = o.breaths || null; // [{ t, dur, phase }] in score time (shared with the picture)
    this.bi = 0;
    this.phase = 0; // 0 exhale, 1 inhale
    this.phT = 0;
    this.phDur = 1.25;
    this._nextBreath(true);
    this.ph = 0;
    this.pulses = [];
    this.f1 = new SVF(420, 2.2, sr);
    this.f2 = new SVF(1150, 3, sr);
    this.f3 = new SVF(2500, 3.5, sr);
    this.bodyBp = new Biquad('bandpass', 62, 1.6, sr);
    this.breathBp = new SVF(1400, 0.6, sr);
    this.lp = new OnePole(3600, sr);
    this.hp = new OnePole(18, sr);
    this.subPh = 0;
    this.env = 0;
    this.jit = 1;
    this.pos = 0;
    this.cacheStart = -1;
    this.out = { main: new Float32Array(4096), sub: new Float32Array(4096) };
  }

  _nextBreath(first = false) {
    const r = this.rng;
    const sl = clamp(this.sleep(this.t0 + this.pos / this.sr), 0, 1);
    if (!first) this.phase ^= 1;
    // exhale a little longer than inhale; both slow down as the cat drifts off
    const base = this.phase === 0 ? 1.3 : 1.05;
    this.phDur = base * (1 + 0.55 * sl) * r.range(0.86, 1.16);
    this.phT = 0;
    this.phAmp = (this.phase === 0 ? 1 : 0.72) * r.range(0.9, 1.08);
    this.phF = this.phase === 0 ? 1 : 1.055; // in-breath sits ~1.3 Hz higher
  }

  get(abs, n) {
    if (abs === this.cacheStart) return this.out;
    while (this.pos < abs) this._produce(Math.min(2048, abs - this.pos));
    this._produce(n);
    this.cacheStart = abs;
    return this.out;
  }

  _produce(n) {
    const sr = this.sr;
    const t = this.t0 + this.pos / sr;
    const lvl = Math.max(0, this.level(t));
    const rise = this.rise(t);
    const br = this.bright(t);
    this.lp.set(2200 + 3200 * br, sr);
    const nz = this.noise, rng = this.rng;
    const M = this.out.main, S = this.out.sub;
    for (let k = 0; k < n; k++) {
      // breathing envelope: swells through each phase, dips (not to zero) at the turn
      let x;
      if (this.breaths) {
        const tt = t + k / sr;
        const B = this.breaths;
        while (this.bi < B.length - 1 && B[this.bi + 1].t <= tt) {
          this.bi++;
          this.phase = B[this.bi].phase;
          this.phAmp = (this.phase === 0 ? 1 : 0.72) * (0.92 + 0.14 * ((this.bi * 0.618) % 1));
          this.phF = this.phase === 0 ? 1 : 1.055;
        }
        const cur = B[this.bi];
        x = clamp((tt - cur.t) / cur.dur, 0, 1);
      } else {
        this.phT += 1 / sr;
        if (this.phT >= this.phDur) this._nextBreath();
        x = this.phT / this.phDur;
      }
      const swell = 0.16 + 0.84 * Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.04)), 0.7);
      const target = swell * this.phAmp * lvl;
      this.env += (target - this.env) * 0.0016;
      // laryngeal cycles: glottal puffs at f0 with jitter
      const f = this.f0 * this.phF * rise * this.jit;
      this.ph += f / sr;
      if (this.ph >= 1) {
        this.ph -= 1;
        this.jit = 1 + 0.022 * rng.gauss();
        this.pulses.push({ age: 0, A: 0.8 + 0.4 * rng.next(), noise: this.phase ? 1.35 : 1 });
      }
      let ex = 0, nexc = 0, thump = 0;
      const w = nz.white();
      for (let j = this.pulses.length - 1; j >= 0; j--) {
        const P = this.pulses[j];
        const a = P.age++ / sr;
        if (a > 0.03) {
          this.pulses[j] = this.pulses[this.pulses.length - 1];
          this.pulses.pop();
          continue;
        }
        const g = (a / 0.0018) * Math.exp(1 - a / 0.0018); // the fold snapping open
        ex += P.A * g;
        nexc += P.A * P.noise * Math.exp(-a / 0.0055);
        thump += P.A * Math.exp(-a / 0.009);
      }
      const src = ex * 0.9 + w * nexc * 0.55;
      this.f1.tick(src);
      this.f2.tick(src);
      this.f3.tick(src);
      const tract = this.f1.bp * 1.3 + this.f2.bp * 0.55 * (0.6 + br) + this.f3.bp * 0.22 * br;
      const body = this.bodyBp.tick(thump) * 2.2;
      // continuous airflow noise, gated by the folds
      this.breathBp.tick(w);
      const breath = this.breathBp.bp * (0.12 + 0.6 * nexc) * (this.phase ? 0.5 : 0.32);
      M[k] = this.hp.hp(this.lp.lp(tract + body + breath)) * this.env;
      // the subwoofer layer: fundamental and octave, following the same breath
      this.subPh += f / sr;
      S[k] = (sinCycle(this.subPh) * 0.8 + sinCycle(2 * this.subPh + 0.1) * 0.35) * this.env;
    }
    this.pos += n;
  }
}

/** A tap on a PurrCore: 'main' (the purr itself) or 'sub' (its fundamental, for the LFE). */
export class PurrVoice {
  constructor(sr, o) {
    this.sr = sr;
    this.core = o.core;
    this.tap = o.tap || 'main';
    this.start = Math.round(o.t0 * sr);
    this.done = 0;
    this.max = Math.round((o.dur ?? this.core.dur) * sr);
    this.gain = o.gain ?? 1;
  }

  process(out, i0, n) {
    const b = this.core.get(this.start + this.done, n)[this.tap];
    for (let k = 0; k < n; k++) out[i0 + k] = b[k] * this.gain;
    this.done += n;
    return this.done < this.max;
  }
}

// ---------------------------------------------------------------- the collar
/**
 * A small jingle bell and a name tag: each strike rings a few inharmonic partials (3-11 kHz), slightly different
 * every time. opts: strikes [[t, vel], ...] (s from the start), seed, size (1 = default; bigger = lower)
 */
export class Bell {
  constructor(sr, o) {
    this.sr = sr;
    const rng = new Rng(o.seed || 97);
    const k = 1 / (o.size ?? 1);
    this.modes = [[4180, 0.06, 1], [6120, 0.045, 0.7], [7930, 0.035, 0.55], [10350, 0.025, 0.35], [3120, 0.05, 0.35], [5710, 0.03, 0.3]]
      .map(([f, t60, a], i) => ({ f: f * k * rng.range(0.985, 1.015), mul: Math.exp(-6.9 / (t60 * sr)), a: a * (i >= 4 ? 0.6 : 1), y: 0, v: 0 }));
    for (const m of this.modes) {
      const w = (TAU * m.f) / sr;
      m.c = 2 * Math.cos(w);
      m.y1 = 0;
      m.y2 = 0;
    }
    this.strikes = (o.strikes || [[0, 1]]).map(([t, v]) => [Math.round(t * sr), v]).sort((a, b) => a[0] - b[0]);
    this.si = 0;
    this.noise = new Noise(o.seed || 97);
    this.click = 0;
    this.hp = new OnePole(2500, sr);
    this.i = 0;
    this.max = (this.strikes.length ? this.strikes[this.strikes.length - 1][0] : 0) + Math.round(0.25 * sr);
    this.vel = (o.vel ?? 0.5) * 0.06;
    this.rng = rng;
  }

  process(out, i0, n) {
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      let exc = 0;
      while (this.si < this.strikes.length && this.strikes[this.si][0] <= i) {
        const v = this.strikes[this.si++][1];
        exc += v;
        this.click = Math.max(this.click, v);
        // each strike excites the partials a bit differently (where the ball hits)
        for (const m of this.modes) m.hit = v * this.rng.range(0.4, 1);
      }
      let s = 0;
      for (const m of this.modes) {
        const x = m.hit ? m.hit * m.a : 0;
        m.hit = 0;
        const y = m.c * m.mul * m.y1 - m.mul * m.mul * m.y2 + x;
        m.y2 = m.y1;
        m.y1 = y;
        s += y;
      }
      this.click *= 0.6;
      s += this.hp.hp(this.noise.white() * this.click) * 2;
      out[i0 + k] = s * this.vel;
      void exc;
    }
    return this.i < this.max;
  }
}

/** Strike times for a bell carried by a walking cat: a little rattle on each step. steps: [t...] */
export function bellForSteps(steps, rng, amount = 1) {
  const out = [];
  for (const t of steps) {
    if (!rng.chance(0.85)) continue;
    const n = rng.int(1, 3);
    let tt = t + rng.range(0.01, 0.05);
    for (let i = 0; i < n; i++) {
      out.push([tt, rng.range(0.35, 1) * amount * (i ? 0.6 : 1)]);
      tt += rng.range(0.018, 0.06);
    }
  }
  return out;
}

// ---------------------------------------------------------------- paws, cushions, fur
/** A soft paw step: a low pat plus a little fabric/carpet scuff. opts: vel, surface ('carpet'|'leather'|'cushion') */
export class Paw {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.vel = o.vel ?? 0.4;
    const s = o.surface || 'carpet';
    this.noise = new Noise(o.seed || 101);
    this.pat = new Biquad('bandpass', s === 'leather' ? 190 : s === 'cushion' ? 120 : 160, 1.2, sr);
    this.scuff = new Biquad('bandpass', s === 'leather' ? 3400 : 2200, s === 'leather' ? 3 : 1.1, sr);
    this.squeak = s === 'leather' ? 0.4 : 0;
    this.ph = 0;
    this.i = 0;
    this.max = Math.round(0.16 * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const w = this.noise.white();
      const e = Math.min(1, t / 0.002) * Math.exp(-t / 0.012);
      const sc = t > 0.004 ? Math.exp(-(t - 0.004) / 0.022) * (0.5 + 0.5 * Math.abs(this.noise.white())) : 0;
      let s = this.pat.tick(w * e) * 3 + this.scuff.tick(w * sc) * 0.6;
      if (this.squeak) {
        this.ph += (900 + 300 * t / 0.05) / sr;
        s += sinCycle(this.ph) * Math.exp(-Math.pow((t - 0.03) / 0.012, 2)) * 0.06 * this.squeak;
      }
      out[i0 + k] = s * this.vel;
    }
    return this.i < this.max;
  }
}

/** Landing on a cushion: the thump, the leather complaining, the air leaving the cushion. */
export class Landing {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.vel = o.vel ?? 0.7;
    this.noise = new Noise(o.seed || 103);
    this.thump = new Biquad('lowpass', 140, 0.9, sr);
    this.ph = 0;
    this.creak = new Biquad('bandpass', 760, 7, sr);
    this.creak2 = new Biquad('bandpass', 1730, 9, sr);
    this.air = new SVF(900, 0.7, sr);
    this.i = 0;
    this.max = Math.round(0.9 * sr);
    this.next = 0;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const t = i / sr;
      const w = this.noise.white();
      this.ph += (72 * (1 + 0.5 * Math.exp(-t / 0.02))) / sr;
      const th = sinCycle(this.ph) * Math.min(1, t / 0.004) * Math.exp(-t / 0.07) * 0.9 + this.thump.tick(w * Math.exp(-t / 0.01)) * 2.5;
      // stick-slip creak of the leather as it takes the weight
      let cr = 0;
      if (t > 0.03 && t < 0.42 && i >= this.next) {
        this.next = i + Math.round(sr / (140 + 120 * Math.sin(t * 9)) * (1 + 0.3 * w));
        cr = 0.7;
      }
      const creak = (this.creak.tick(cr) + this.creak2.tick(cr) * 0.5) * 6 * Math.max(0, 1 - t / 0.45);
      this.air.set(700 + 1600 * Math.exp(-t / 0.15), 0.7, sr);
      this.air.tick(w);
      const air = this.air.bp * 0.35 * Math.min(1, t / 0.02) * Math.exp(-t / 0.25);
      out[i0 + k] = (th + creak * 0.25 + air) * this.vel;
    }
    return this.i < this.max;
  }
}

/**
 * Kneading: paws pressing a cushion in turn, the fabric rustling, now and then a claw catching a thread.
 * opts: dur, rate (presses per second), vel, seed
 */
export class Knead {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 4;
    this.rate = o.rate ?? 2.2;
    this.vel = o.vel ?? 0.4;
    this.rng = new Rng(o.seed || 107);
    this.noise = new Noise(o.seed || 107);
    this.press = new Biquad('bandpass', 140, 1.3, sr);
    this.rustle = new Biquad('bandpass', 3300, 0.9, sr);
    this.claw = new Biquad('bandpass', 5200, 6, sr);
    this.next = 0;
    this.pe = 0;
    this.re = 0;
    this.ce = 0;
    this.i = 0;
    this.max = Math.round((this.dur + 0.3) * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const t = i / sr;
      if (t < this.dur && i >= this.next) {
        this.next = i + Math.round((sr / this.rate) * this.rng.range(0.8, 1.2));
        this.pe = this.rng.range(0.6, 1);
        this.re = this.rng.range(0.4, 1);
        if (this.rng.chance(0.3)) this.ce = this.rng.range(0.4, 1);
      }
      const w = this.noise.white();
      this.pe *= 0.9993;
      this.re *= 0.9985;
      this.ce *= 0.93;
      const s = this.press.tick(w * this.pe) * 1.6 + this.rustle.tick(w * this.re * (0.5 + 0.5 * Math.abs(this.noise.white()))) * 0.45
        + this.claw.tick(w * this.ce) * 1.2;
      out[i0 + k] = s * this.vel;
    }
    return this.i < this.max;
  }
}

/** A breath out through the nose: the sigh of a cat settling. opts: dur, vel */
export class Sigh {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 0.8;
    this.vel = o.vel ?? 0.35;
    this.noise = new Noise(o.seed || 109);
    this.bp = new SVF(1600, 1.1, sr);
    this.nasal = new SVF(330, 4, sr);
    this.i = 0;
    this.max = Math.round((this.dur + 0.05) * sr);
  }

  process(out, i0, n) {
    const sr = this.sr, D = this.dur;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const x = t / D;
      const e = Math.sin(Math.PI * Math.min(1, x)) ** 1.5 * (1 - 0.4 * x);
      this.bp.set(1900 - 900 * x, 1.1, sr);
      const w = this.noise.white();
      this.bp.tick(w);
      this.nasal.tick(w);
      out[i0 + k] = (this.bp.bp * 0.7 + this.nasal.bp * 0.5) * e * this.vel;
    }
    return this.i < this.max;
  }
}

/** An ear flick: a soft double flap. */
export class EarFlick {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.vel = o.vel ?? 0.3;
    this.noise = new Noise(o.seed || 113);
    this.bp = new Biquad('bandpass', 1900, 1.4, sr);
    this.low = new Biquad('bandpass', 300, 1.5, sr);
    this.hits = o.double === false ? [0] : [0, 0.085];
    this.i = 0;
    this.max = Math.round(0.2 * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      let e = 0;
      for (const h of this.hits) if (t >= h) e += Math.exp(-(t - h) / 0.007) * (h ? 0.7 : 1);
      const w = this.noise.white();
      out[i0 + k] = (this.bp.tick(w * e) * 1.4 + this.low.tick(w * e) * 1.2) * this.vel;
    }
    return this.i < this.max;
  }
}

// ---------------------------------------------------------------- the voice
const TRILL_TABLE = (() => {
  // glottal source: harmonics falling ~ -12 dB/octave, computed once
  const N = 2048, amps = [];
  for (let h = 1; h <= 40; h++) amps.push(1 / (h * h * 0.6 + 0.4));
  const t = new Float32Array(N + 1);
  for (let h = 0; h < amps.length; h++) for (let i = 0; i < N; i++) t[i] += amps[h] * Math.sin((TAU * (h + 1) * i) / N + h * 0.37);
  let pk = 0;
  for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(t[i]));
  for (let i = 0; i < N; i++) t[i] /= pk;
  t[N] = t[0];
  return { t, N };
})();

/**
 * The trill: a short closed-mouth, rolled "mrrp", pitch rising (and rising again at the end if it's a question).
 * opts: dur, f ([[t, Hz]] relative to the start), vel, roll (Hz of the r), open ([[t, 0..1]] mouth opening), seed
 */
export class Trill {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 0.42;
    this.fc = new Curve(o.f || [[0, 430], [0.12, 560], [0.3, 610], [0.42, 760]]);
    this.open = new Curve(o.open || [[0, 0], [0.25, 0.15], [0.42, 0.8]]);
    this.ac = new Curve(o.a || [[0, 0], [0.03, 1], [0.3, 0.85], [this.dur - 0.02, 0.6], [this.dur, 0]]);
    this.vel = (o.vel ?? 0.6) * 0.5;
    this.roll = o.roll ?? 27;
    this.noise = new Noise(o.seed || 127);
    this.nasal = new SVF(280, 3, sr);
    this.f1 = new SVF(700, 4, sr);
    this.f2 = new SVF(1900, 6, sr);
    this.f3 = new SVF(3400, 6, sr);
    this.ph = 0;
    this.rph = 0;
    this.i = 0;
    this.max = Math.round((this.dur + 0.05) * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    const T = TRILL_TABLE;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const f = this.fc.at(t) * (1 + 0.006 * Math.sin(t * 38));
      this.ph += f / sr;
      const p = this.ph - Math.floor(this.ph);
      const x = p * T.N;
      const j = x | 0;
      const src = T.t[j] + (T.t[j + 1] - T.t[j]) * (x - j) + this.noise.white() * 0.08;
      // the rolled r: the tongue tip flutters, chopping the sound ~27 times a second
      this.rph += this.roll / sr;
      const r = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.cos(TAU * this.rph), 1.6);
      const op = this.open.at(t);
      this.f1.set(520 + 380 * op, 4, sr);
      this.f2.set(1700 + 500 * op, 6, sr);
      this.nasal.tick(src);
      this.f1.tick(src);
      this.f2.tick(src);
      this.f3.tick(src);
      const s = this.nasal.bp * (1.2 - 0.7 * op) + this.f1.bp * (0.5 + 0.9 * op) + this.f2.bp * (0.35 + 0.4 * op) + this.f3.bp * 0.15;
      out[i0 + k] = s * r * this.ac.at(t) * this.vel;
    }
    return this.i < this.max;
  }
}
