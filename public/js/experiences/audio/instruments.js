// Voices for the offline renderer. Every voice writes mono samples:
//   voice.process(out, i0, n) -> fills out[i0 .. i0+n) and returns false once it has finished.
// Physical-ish models (plucked strings, struck/bowed resonators, breath, formant voices) rather than
// samples: no downloads, no licensing, and every note is rendered at the exact pitch the score asks for.
import { TAU, Curve } from '../core/timeline.js';
import {
  Noise, OnePole, SVF, Delay, Wavetable, cachedTable, harmonics, sinCycle, t60ToMul, allpassPhaseDelay, Biquad,
} from './dsp.js';

const DENORMAL = 1e-18;

/** Linear-attack / hold / exponential-release envelope evaluated sample by sample. */
class ASR {
  constructor(sr, attack, hold, release, shape = 'sine') {
    this.aN = Math.max(1, Math.round(attack * sr));
    this.hN = Math.max(0, Math.round(hold * sr));
    this.rMul = t60ToMul(Math.max(0.005, release), sr);
    this.shape = shape;
    this.i = 0;
    this.v = 0;
    this.releasing = false;
  }

  next() {
    const i = this.i++;
    if (i < this.aN) {
      const x = i / this.aN;
      this.v = this.shape === 'sine' ? 0.5 - 0.5 * Math.cos(Math.PI * x) : x;
    } else if (i < this.aN + this.hN && !this.releasing) {
      this.v = 1;
    } else {
      this.v *= this.rMul;
    }
    return this.v;
  }

  release() {
    this.releasing = true;
  }

  get done() {
    return this.i > this.aN + this.hN && this.v < 1e-4;
  }
}

// ======================================================================= plucked string
/**
 * Karplus-Strong string with exact tuning (fractional allpass), brightness-controlled loop filter,
 * pick-position comb and optional stiffness (dispersion) for wire/metal strings.
 * opts: freq, vel, decay (T60 at the fundamental, s), bright 0..1, pick 0..0.5, stiff 0..1, dur (damped after), seed
 */
export class Pluck {
  constructor(sr, o) {
    this.sr = sr;
    const f = o.freq;
    const P = sr / f;
    this.vel = o.vel ?? 0.8;
    const bright = Math.min(1, Math.max(0, o.bright ?? 0.6));
    this.S = 0.5 - 0.46 * bright; // two-point average weight
    this.stiff = Math.min(0.95, (o.stiff || 0) * 0.85);
    this.nStiff = this.stiff > 0 ? 2 : 0;
    const w = (TAU * f) / sr;
    // phase delays at the fundamental
    const dLp = Math.atan2(this.S * Math.sin(w), 1 - this.S + this.S * Math.cos(w)) / w;
    const dSt = this.nStiff ? this.nStiff * allpassPhaseDelay(-this.stiff, w) : 0;
    let rest = P - dLp - dSt;
    let L = Math.floor(rest - 0.15);
    if (L < 2) L = 2;
    const frac = rest - L; // 0.15 .. 1.15
    this.c = (1 - frac) / (1 + frac); // tuning allpass coefficient
    this.L = L;
    this.line = new Delay(L + 8);
    // loop gain for the requested T60 at the fundamental (the lowpass adds a little more damping)
    const decay = o.decay ?? 3;
    const lpMag = Math.hypot(1 - this.S + this.S * Math.cos(w), this.S * Math.sin(w));
    this.g = Math.min(0.99999, Math.pow(10, -3 / (f * decay)) / Math.max(0.5, lpMag));
    this.dampAt = o.dur ? Math.round(o.dur * sr) : Infinity;
    this.gDamp = Math.pow(10, -3 / (f * (o.damp ?? 0.12)));
    // excitation: low-passed noise, one period long, through a pick-position comb
    const noise = new Noise(o.seed || 7);
    const n = Math.round(P);
    const exc = new Float32Array(n);
    const lp = new OnePole(1200 + 11000 * bright * (0.4 + 0.6 * this.vel), sr);
    for (let i = 0; i < n; i++) exc[i] = lp.lp(noise.white());
    const pk = Math.max(1, Math.round((o.pick ?? 0.15) * n));
    const shaped = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      shaped[i] = exc[i] - (i >= pk ? exc[i - pk] : 0);
      mean += shaped[i];
    }
    mean /= n;
    let peak = 1e-9;
    for (let i = 0; i < n; i++) {
      shaped[i] -= mean;
      peak = Math.max(peak, Math.abs(shaped[i]));
    }
    for (let i = 0; i < n; i++) shaped[i] /= peak;
    for (let i = 0; i < L; i++) this.line.write(shaped[i % n]);
    this.exc = shaped;
    this.prev = 0;
    this.apX = 0;
    this.apY = 0;
    this.st = new Float32Array(4); // stiffness allpass states x1,y1 pairs
    this.i = 0;
    this.env = 1;
    this.dc = new OnePole(20, sr);
    this.max = (o.maxDur ?? decay * 1.6 + 0.5) * sr;
  }

  process(out, i0, n) {
    const line = this.line, L = this.L, S = this.S, c = this.c, nExc = this.exc.length;
    const st = this.st, a = -this.stiff, nSt = this.nStiff;
    let prev = this.prev, apX = this.apX, apY = this.apY, peak = 0;
    const amp = this.vel * 0.55;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const g = i >= this.dampAt ? this.gDamp : this.g;
      const y = line.readInt(L);
      let v = (1 - S) * y + S * prev;
      prev = y;
      if (nSt) {
        // two first-order allpasses with a < 0: high partials run sharp
        let x = v;
        let o1 = a * x + st[0] - a * st[1];
        st[0] = x; st[1] = o1;
        x = o1;
        o1 = a * x + st[2] - a * st[3];
        st[2] = x; st[3] = o1;
        v = o1;
      }
      const t = c * v + apX - c * apY;
      apX = v;
      apY = t;
      const fb = t * g;
      line.write(fb + DENORMAL);
      const s = y - this.dc.lp(y);
      out[i0 + k] = s * amp;
      const ab = s < 0 ? -s : s;
      if (ab > peak) peak = ab;
    }
    this.prev = prev;
    this.apX = apX;
    this.apY = apY;
    this.env = this.env * 0.9 + peak * 0.1;
    return !(this.i > nExc * 4 && peak < 2e-5) && this.i < this.max;
  }
}

// ======================================================================= modal (struck resonators)
/** Mode tables: [ratio, relative amplitude, relative T60]. */
export const MODES = {
  wood: [[1, 1, 1], [2.53, 0.5, 0.55], [4.17, 0.32, 0.4], [6.79, 0.16, 0.28]],
  woodLow: [[1, 1, 1], [2.08, 0.45, 0.7], [3.73, 0.3, 0.5], [5.9, 0.14, 0.3]],
  glass: [[1, 1, 1], [2.32, 0.42, 0.75], [4.25, 0.22, 0.55], [6.63, 0.11, 0.4], [9.38, 0.05, 0.28]],
  tine: [[1, 1, 1], [6.27, 0.22, 0.22], [17.55, 0.05, 0.08]],
  kalimba: [[1, 1, 1], [5.92, 0.3, 0.25], [7.08, 0.12, 0.2], [16.9, 0.04, 0.06]],
  marimba: [[1, 1, 1], [3.99, 0.28, 0.32], [9.94, 0.08, 0.14]],
  vibes: [[1, 1, 1], [3.98, 0.3, 0.55], [9.95, 0.1, 0.25]],
  bell: [[0.5, 0.33, 1.6], [1, 1, 1], [1.183, 0.42, 0.8], [1.506, 0.34, 0.7], [2.0, 0.38, 0.6], [2.514, 0.2, 0.45],
    [3.011, 0.14, 0.35], [4.166, 0.08, 0.25], [5.43, 0.05, 0.18]],
  chime: [[1, 1, 1], [2.76, 0.5, 0.7], [5.4, 0.3, 0.5], [8.93, 0.15, 0.35]],
  membrane: [[1, 1, 1], [1.594, 0.62, 0.7], [2.136, 0.46, 0.6], [2.296, 0.36, 0.5], [2.653, 0.3, 0.45], [2.918, 0.2, 0.4],
    [3.156, 0.16, 0.35], [3.501, 0.1, 0.3]],
  plate: [[1, 1, 1], [1.41, 0.72, 0.9], [2.17, 0.55, 0.8], [2.63, 0.48, 0.7], [3.14, 0.36, 0.6], [3.91, 0.3, 0.52],
    [4.48, 0.22, 0.42], [5.32, 0.16, 0.35], [6.17, 0.1, 0.3], [7.4, 0.07, 0.24]],
  bowl: [[1, 1, 1], [1.003, 0.6, 1], [2.71, 0.5, 0.8], [2.716, 0.3, 0.8], [5.15, 0.28, 0.6], [8.26, 0.12, 0.4]],
  metalTick: [[1, 1, 1], [1.47, 0.8, 0.8], [2.09, 0.6, 0.6], [2.9, 0.45, 0.5], [3.7, 0.3, 0.4]],
  stone: [[1, 1, 1], [1.73, 0.6, 0.6], [2.61, 0.4, 0.45], [3.47, 0.25, 0.35]],
};

/**
 * Bank of 2-pole resonators driven by mallet strikes (half-sine pulses + a little noise).
 * opts: freq, modes (name or table), t60 (s, for the fundamental), vel, hard 0..1 (mallet hardness),
 * strikes [[delay s, gain]], noise (contact noise amount), detune (spread in cents), seed, bright
 */
export class Modal {
  constructor(sr, o) {
    this.sr = sr;
    const table = typeof o.modes === 'string' ? MODES[o.modes] : o.modes || MODES.glass;
    const f0 = o.freq;
    const t60 = o.t60 ?? 2;
    const hard = o.hard ?? 0.5;
    const bright = o.bright ?? 1;
    const rng = new Noise(o.seed || 11);
    // mallet: a half-sine contact pulse whose length is a fraction of the fundamental's period
    const width = Math.min(0.005 * sr, Math.max(2.5, (sr / f0) * (0.08 + 0.7 * (1 - hard))));
    const pulse = new Float32Array(Math.ceil(width));
    for (let i = 0; i < pulse.length; i++) pulse[i] = Math.sin((Math.PI * (i + 0.5)) / width);
    const X = (w) => {
      let re = 0, im = 0;
      for (let i = 0; i < pulse.length; i++) {
        re += pulse[i] * Math.cos(w * i);
        im -= pulse[i] * Math.sin(w * i);
      }
      return Math.hypot(re, im);
    };
    const X0 = X(0);
    this.modes = [];
    for (const [ratio, amp, rel] of table) {
      const det = o.detune ? 1 + (rng.white() * o.detune) / 1731 : 1;
      const f = f0 * ratio * det;
      if (f > sr * 0.45 || f < 10) continue;
      const w = (TAU * f) / sr;
      const r = t60ToMul(t60 * rel, sr);
      // brighter mallets and harder strikes excite high modes more
      const tilt = Math.pow(ratio, (bright - 1) * 0.8 + (hard - 0.5) * 0.6);
      const a = amp * tilt;
      // each mode rings at amplitude ~a regardless of how well the pulse excites it
      this.modes.push({ c1: 2 * r * Math.cos(w), c2: r * r, g: (a * Math.sin(w)) / Math.max(X(w), 0.05 * X0), y1: 0, y2: 0 });
    }
    this.n = this.modes.length;
    this.c1 = new Float64Array(this.n);
    this.c2 = new Float64Array(this.n);
    this.g = new Float64Array(this.n);
    this.y1 = new Float64Array(this.n);
    this.y2 = new Float64Array(this.n);
    this.modes.forEach((m, i) => {
      this.c1[i] = m.c1;
      this.c2[i] = m.c2;
      this.g[i] = m.g;
    });
    // excitation
    const strikes = o.strikes || [[0, 1]];
    let len = 0;
    for (const [d] of strikes) len = Math.max(len, Math.round(d * sr) + width + 2);
    const exc = new Float32Array(Math.ceil(len) + 1);
    const nz = o.noise ?? 0.15;
    for (const [d, gain] of strikes) {
      const s0 = Math.round(d * sr);
      for (let i = 0; i < pulse.length; i++) {
        const p = pulse[i];
        exc[s0 + i] += gain * (p + nz * rng.white() * p);
      }
    }
    this.exc = exc;
    this.vel = (o.vel ?? 0.8) * (o.gain ?? 1) * 0.16;
    this.i = 0;
    this.max = Math.round((t60 * 1.3 + 0.1 + len / sr) * sr);
    // optional contact click (bright, very short)
    this.click = (o.click ?? 0) * (o.vel ?? 0.8);
    this.clickN = Math.round(0.0015 * sr);
    this.hp = new OnePole(3000, sr);
    this.cn = new Noise((o.seed || 11) + 101);
  }

  process(out, i0, n) {
    const { c1, c2, g, y1, y2, exc } = this;
    const nm = this.n, nExc = exc.length, vel = this.vel;
    let peak = 0;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const x = i < nExc ? exc[i] : 0;
      let s = 0;
      for (let m = 0; m < nm; m++) {
        const y = c1[m] * y1[m] - c2[m] * y2[m] + g[m] * x;
        y2[m] = y1[m];
        y1[m] = y;
        s += y;
      }
      s *= vel;
      if (this.click && i < this.clickN) s += this.hp.hp(this.cn.white()) * this.click * (1 - i / this.clickN);
      out[i0 + k] = s;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    return !(this.i > nExc && peak < 1.5e-5) && this.i < this.max;
  }
}

// ======================================================================= bowed glass / singing partials
/**
 * Sustained additive partials with a slow bowed attack, gentle beating and friction noise:
 * glass harmonica, bowed bowls, wine glass rims.
 * opts: freq, dur, vel, attack, release, partials [[ratio, amp]], beat (Hz), noise, vib (cents), seed
 */
export class Bowed {
  constructor(sr, o) {
    this.sr = sr;
    const parts = o.partials || [[1, 1], [2.32, 0.28], [4.25, 0.08], [6.63, 0.03]];
    this.osc = [];
    const beat = o.beat ?? 0.6;
    for (const [ratio, amp] of parts) {
      const f = o.freq * ratio;
      if (f > sr * 0.45) continue;
      this.osc.push({ inc: f / sr, ph: Math.random(), amp });
      if (ratio === 1 && beat) this.osc.push({ inc: (f + beat) / sr, ph: 0.3, amp: amp * 0.45 });
    }
    this.env = new ASR(sr, o.attack ?? 0.4, Math.max(0, (o.dur ?? 2) - (o.attack ?? 0.4)), o.release ?? 1.4);
    this.vel = (o.vel ?? 0.7) * 0.14;
    this.noise = new Noise(o.seed || 3);
    this.bp = new SVF(o.freq, 22, sr);
    this.nAmt = o.noise ?? 0.05;
    this.vib = (o.vib ?? 0) / 1731;
    this.vibInc = (o.vibRate ?? 4.5) / sr;
    this.vph = Math.random();
    this.swell = o.swell ?? 0.15;
    this.i = 0;
  }

  process(out, i0, n) {
    const osc = this.osc, no = osc.length;
    for (let k = 0; k < n; k++) {
      const e = this.env.next();
      this.vph += this.vibInc;
      const vm = 1 + this.vib * sinCycle(this.vph);
      let s = 0;
      for (let m = 0; m < no; m++) {
        const o = osc[m];
        o.ph += o.inc * vm;
        s += o.amp * sinCycle(o.ph);
      }
      // the bow: friction noise ringing at the fundamental, strongest while the tone builds
      const nz = this.bp.tick(this.noise.white()) * this.nAmt * 6;
      const sw = 1 + this.swell * Math.sin(this.i++ * 1.3e-4);
      out[i0 + k] = (s * sw + nz) * e * this.vel;
    }
    return !this.env.done;
  }
}

// ======================================================================= breath (flute / pan pipe / airy tone)
/** opts: freq, dur, vel, attack, release, breath 0..1, vib (semitones), vibRate, chiff, glide [[t, ratio]] */
export class Air {
  constructor(sr, o) {
    this.sr = sr;
    this.inc = o.freq / sr;
    this.env = new ASR(sr, o.attack ?? 0.12, Math.max(0, (o.dur ?? 1) - (o.attack ?? 0.12)), o.release ?? 0.4);
    this.vel = (o.vel ?? 0.7) * 0.19;
    this.breath = o.breath ?? 0.25;
    this.vib = (o.vib ?? 0.12) / 12;
    this.vibInc = (o.vibRate ?? 4.8) / sr;
    this.vibDelay = Math.round(0.35 * sr);
    this.noise = new Noise(o.seed || 5);
    this.bp = new SVF(o.freq, 7, sr);
    this.bp2 = new SVF(o.freq * 2.6, 3, sr);
    this.hp = new OnePole(4000, sr);
    this.chiff = o.chiff ?? 0.4;
    this.chiffN = Math.round(0.05 * sr);
    this.glide = o.glide ? new Curve(o.glide) : null;
    this.h2 = o.h2 ?? 0.22;
    this.h3 = o.h3 ?? 0.06;
    this.ph = 0;
    this.vph = 0;
    this.i = 0;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const e = this.env.next();
      this.vph += this.vibInc;
      const vd = Math.min(1, Math.max(0, (i - this.vibDelay) / (0.5 * sr)));
      let ratio = 1 + this.vib * vd * 0.6931 * sinCycle(this.vph);
      if (this.glide) ratio *= this.glide.at(i / sr);
      this.ph += this.inc * ratio;
      const p = this.ph;
      const tone = sinCycle(p) + this.h2 * sinCycle(2 * p + 0.1) + this.h3 * sinCycle(3 * p + 0.2);
      const w = this.noise.white();
      const br = this.bp.tick(w) * 2.2 + this.hp.hp(w) * 0.08;
      let s = tone * (1 - this.breath * 0.5) + br * this.breath * 1.6;
      if (i < this.chiffN) s += this.bp2.tick(w) * this.chiff * 2 * (1 - i / this.chiffN);
      out[i0 + k] = s * e * this.vel;
    }
    return !this.env.done;
  }
}

// ======================================================================= formant voices (choir, hum)
const FORMANTS = {
  soprano: {
    a: [[800, 0, 80], [1150, -6, 90], [2900, -32, 120], [3900, -20, 130], [4950, -50, 140]],
    e: [[350, 0, 60], [2000, -20, 100], [2800, -15, 120], [3600, -40, 150], [4950, -56, 200]],
    i: [[270, 0, 60], [2140, -12, 90], [2950, -26, 100], [3900, -26, 120], [4950, -44, 120]],
    o: [[450, 0, 70], [800, -11, 80], [2830, -22, 100], [3800, -22, 130], [4950, -50, 135]],
    u: [[325, 0, 50], [700, -16, 60], [2700, -35, 170], [3800, -40, 180], [4950, -60, 200]],
  },
  alto: {
    a: [[800, 0, 80], [1150, -4, 90], [2800, -20, 120], [3500, -36, 130], [4950, -60, 140]],
    e: [[400, 0, 60], [1600, -24, 80], [2700, -30, 120], [3300, -35, 150], [4950, -60, 200]],
    i: [[350, 0, 50], [1700, -20, 100], [2700, -30, 120], [3700, -36, 150], [4950, -60, 200]],
    o: [[450, 0, 70], [800, -9, 80], [2830, -16, 100], [3500, -28, 130], [4950, -55, 135]],
    u: [[325, 0, 50], [700, -12, 60], [2530, -30, 170], [3500, -40, 180], [4950, -64, 200]],
  },
  tenor: {
    a: [[650, 0, 80], [1080, -6, 90], [2650, -7, 120], [2900, -8, 130], [3250, -22, 140]],
    e: [[400, 0, 70], [1700, -14, 80], [2600, -12, 100], [3200, -14, 120], [3580, -20, 120]],
    i: [[290, 0, 40], [1870, -15, 90], [2800, -18, 100], [3250, -20, 120], [3540, -30, 120]],
    o: [[400, 0, 40], [800, -10, 80], [2600, -12, 100], [2800, -12, 120], [3000, -26, 120]],
    u: [[350, 0, 40], [600, -20, 60], [2700, -17, 100], [2900, -14, 120], [3300, -26, 120]],
  },
  bass: {
    a: [[600, 0, 60], [1040, -7, 70], [2250, -9, 110], [2450, -9, 120], [2750, -20, 130]],
    e: [[400, 0, 40], [1620, -12, 80], [2400, -9, 100], [2800, -12, 120], [3100, -18, 120]],
    i: [[250, 0, 60], [1750, -30, 90], [2600, -16, 100], [3050, -22, 120], [3340, -28, 120]],
    o: [[400, 0, 40], [750, -11, 80], [2400, -21, 100], [2600, -20, 120], [2900, -40, 120]],
    u: [[350, 0, 40], [600, -20, 80], [2400, -32, 100], [2675, -28, 120], [2950, -36, 120]],
  },
};

function vowelEnvelope(register, vowel) {
  const reg = FORMANTS[register] || FORMANTS.alto;
  if (vowel === 'm') {
    // a closed-mouth hum: low first formant, everything above heavily damped
    return reg.u.map(([f, a, bw], i) => [i === 0 ? f * 0.85 : f, i === 0 ? 0 : a - 14, bw]);
  }
  return reg[vowel] || reg.a;
}

/** Wavetable for one sung note: glottal source (-6 dB/oct net) shaped by the vowel's formants. */
export function voxTable(register, vowel, f0, sr, soft = 0.3) {
  const key = `vox:${register}:${vowel}:${Math.round(f0 * 4)}:${soft}`;
  return cachedTable(key, () => {
    const env = vowelEnvelope(register, vowel);
    const amps = harmonics(f0, Math.min(6500, sr * 0.45), (k, f) => {
      let e = 0.004;
      for (const [F, A, BW] of env) {
        const x = (f - F) / (BW * 0.5);
        e += Math.pow(10, A / 20) / (1 + x * x);
      }
      return e / Math.pow(k, 1 + soft);
    });
    return new Wavetable(amps, 2048);
  });
}

/**
 * One sung (or hummed) voice. opts: freq, dur, vowel ('a','e','i','o','u','m'), toVowel, register,
 * vel, attack, release, vib (semitones), vibRate, detune (cents), breath, soft, glide [[t, ratio]], seed
 */
export class Vox {
  constructor(sr, o) {
    this.sr = sr;
    const f0 = o.freq * Math.pow(2, (o.detune || 0) / 1200);
    this.f0 = f0;
    const reg = o.register || (f0 < 160 ? 'bass' : f0 < 300 ? 'tenor' : f0 < 520 ? 'alto' : 'soprano');
    this.ta = voxTable(reg, o.vowel || 'a', f0, sr, o.soft ?? 0.3);
    this.tb = o.toVowel ? voxTable(reg, o.toVowel, f0, sr, o.soft ?? 0.3) : null;
    this.na = 0.22 / Math.max(0.05, this.ta.rms);
    this.nb = this.tb ? 0.22 / Math.max(0.05, this.tb.rms) : 0;
    const dur = o.dur ?? 2;
    this.durN = dur * sr;
    this.env = new ASR(sr, o.attack ?? 0.35, Math.max(0, dur - (o.attack ?? 0.35)), o.release ?? 0.9);
    this.vel = (o.vel ?? 0.6) * 0.75;
    this.inc = f0 / sr;
    this.vib = (o.vib ?? 0.22) / 12 * 0.6931;
    this.vibInc = ((o.vibRate ?? 5.2) + (Math.random() - 0.5) * 0.6) / sr;
    this.vph = Math.random();
    this.noise = new Noise(o.seed || 9);
    this.jit = new OnePole(3, sr);
    this.breath = o.breath ?? 0.04;
    this.bp = new SVF(Math.min(sr * 0.4, 1200 + f0 * 2), 2.5, sr);
    this.glide = o.glide ? new Curve(o.glide) : null;
    this.ph = Math.random();
    this.i = 0;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const e = this.env.next();
      this.vph += this.vibInc;
      const vd = Math.min(1, i / (0.9 * sr));
      const j = this.jit.lp(this.noise.white()) * 0.25; // slow pitch drift
      let r = 1 + this.vib * vd * sinCycle(this.vph) + j * 0.004;
      if (this.glide) r *= this.glide.at(i / sr);
      this.ph += this.inc * r;
      let s = this.ta.read(this.ph) * this.na;
      if (this.tb) {
        const m = Math.min(1, i / this.durN);
        s = s * (1 - m) + this.tb.read(this.ph) * this.nb * m;
      }
      s += this.bp.tick(this.noise.white()) * this.breath * 3;
      out[i0 + k] = s * e * this.vel;
    }
    return !this.env.done;
  }
}

// ======================================================================= pads / strings
function padTable(f0, sr, cutoff, kind) {
  const key = `pad:${kind}:${Math.round(f0 * 4)}:${Math.round(cutoff)}`;
  return cachedTable(key, () => new Wavetable(harmonics(f0, Math.min(sr * 0.45, 12000), (k, f) => {
    const lp = 1 / (1 + Math.pow(f / cutoff, 4));
    if (kind === 'square') return (k % 2 ? 1 / k : 0.12 / k) * lp;
    if (kind === 'organ') return (k === 1 ? 1 : k === 2 ? 0.5 : k === 3 ? 0.35 : k === 4 ? 0.2 : 0.4 / (k * k)) * lp;
    return (1 / k) * lp; // saw
  }), 2048));
}

/**
 * Warm ensemble pad: three detuned copies of a filtered saw/organ table.
 * opts: freq, dur, vel, attack, release, cutoff (Hz), toCutoff (Hz at the end), detune (cents), kind, vib
 */
export class Pad {
  constructor(sr, o) {
    this.sr = sr;
    const f = o.freq;
    const kind = o.kind || 'saw';
    const c0 = o.cutoff ?? 1800;
    this.ta = padTable(f, sr, c0, kind);
    this.tb = o.toCutoff ? padTable(f, sr, o.toCutoff, kind) : null;
    const d = (o.detune ?? 9) / 1200;
    this.incs = [f * Math.pow(2, -d) / sr, f / sr, f * Math.pow(2, d) / sr];
    this.ph = [Math.random(), Math.random(), Math.random()];
    const dur = o.dur ?? 3;
    this.durN = dur * sr;
    this.env = new ASR(sr, o.attack ?? 1.2, Math.max(0, dur - (o.attack ?? 1.2)), o.release ?? 2.5);
    this.vel = (o.vel ?? 0.5) * 0.12 / Math.max(0.1, this.ta.rms * 1.7);
    this.sub = o.sub ?? 0;
    this.vib = (o.vib ?? 0.04) / 12 * 0.6931;
    this.vph = Math.random();
    this.vibInc = 4.6 / sr;
    this.i = 0;
  }

  process(out, i0, n) {
    const ta = this.ta, tb = this.tb, inc = this.incs, ph = this.ph;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const e = this.env.next();
      this.vph += this.vibInc;
      const r = 1 + this.vib * sinCycle(this.vph);
      ph[0] += inc[0] * r;
      ph[1] += inc[1] * r;
      ph[2] += inc[2] * r;
      let s = ta.read(ph[0]) + ta.read(ph[1]) + ta.read(ph[2]);
      if (tb) {
        const m = Math.min(1, i / this.durN);
        s = s * (1 - m) + (tb.read(ph[0]) + tb.read(ph[1]) + tb.read(ph[2])) * m;
      }
      if (this.sub) s += this.sub * sinCycle(ph[1] * 0.5) * 2;
      out[i0 + k] = s * e * this.vel;
    }
    return !this.env.done;
  }
}

// ======================================================================= low end
/**
 * A deep, textured pulse for the subwoofer: pitch-dropping sine + harmonic + filtered rumble.
 * opts: freq, dur, vel, drop (pitch overshoot ratio), texture, attack
 */
export class SubPulse {
  constructor(sr, o) {
    this.sr = sr;
    this.f = o.freq ?? 36.7;
    this.drop = o.drop ?? 0.35;
    this.dropTau = (o.dropTime ?? 0.05) * sr;
    this.aN = Math.max(1, (o.attack ?? 0.006) * sr);
    const dur = o.dur ?? 1;
    this.decayMul = t60ToMul(dur, sr);
    this.vel = (o.vel ?? 0.8) * 0.4;
    this.tex = o.texture ?? 0.25;
    this.h2 = o.h2 ?? 0.12;
    this.noise = new Noise(o.seed || 13);
    this.lp1 = new OnePole(this.f * 2.2, sr);
    this.lp2 = new OnePole(this.f * 2.2, sr);
    this.ph = 0;
    this.amp = 1;
    this.i = 0;
    this.max = (dur * 1.2 + 0.1) * sr;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const f = this.f * (1 + this.drop * Math.exp(-i / this.dropTau));
      this.ph += f / sr;
      let e;
      if (i < this.aN) e = Math.sin((Math.PI / 2) * (i / this.aN));
      else e = (this.amp *= this.decayMul);
      const tone = sinCycle(this.ph) + this.h2 * sinCycle(2 * this.ph);
      const rum = this.lp2.lp(this.lp1.lp(this.noise.brown())) * 4 * this.tex;
      out[i0 + k] = (tone + rum) * e * this.vel;
    }
    return this.i < this.max;
  }
}

/** Kick / tom / frame drum: swept sine + click + optional noise body. */
export class Drum {
  constructor(sr, o) {
    this.sr = sr;
    this.f0 = o.freq ?? 50;
    this.f1 = o.from ?? this.f0 * 2.6;
    this.pTau = (o.pitchTime ?? 0.035) * sr;
    this.aMul = t60ToMul(o.decay ?? 0.5, sr);
    this.vel = (o.vel ?? 0.8) * 0.45;
    this.click = o.click ?? 0.3;
    this.nAmt = o.noise ?? 0;
    this.noise = new Noise(o.seed || 17);
    this.nbp = new SVF(o.noiseFreq ?? 1800, 0.9, sr);
    this.nMul = t60ToMul(o.noiseDecay ?? 0.15, sr);
    this.hp = new OnePole(2500, sr);
    this.ph = 0;
    this.amp = 1;
    this.na = 1;
    this.i = 0;
    this.max = ((o.decay ?? 0.5) * 1.2 + 0.05) * sr;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const f = this.f0 + (this.f1 - this.f0) * Math.exp(-i / this.pTau);
      this.ph += f / sr;
      this.amp *= this.aMul;
      this.na *= this.nMul;
      const att = Math.min(1, i / (0.0015 * sr));
      let s = sinCycle(this.ph) * this.amp * att;
      if (i < 0.004 * sr) s += this.hp.hp(this.noise.white()) * this.click * (1 - i / (0.004 * sr));
      if (this.nAmt) s += this.nbp.tick(this.noise.white()) * this.nAmt * this.na * 2;
      out[i0 + k] = s * this.vel;
    }
    return this.i < this.max;
  }
}

// ======================================================================= glides (signals, calls)
/**
 * A tone that follows pitch and level curves: whale calls, signals, sirens, sweeps.
 * opts: f [[t, Hz, ease]], a [[t, gain, ease]], dur, table (Wavetable) | spectrum [amps], vib, vibRate,
 * breath, formant (Hz, adds a resonant colour), seed
 */
export class Glide {
  constructor(sr, o) {
    this.sr = sr;
    this.fc = new Curve(o.f);
    this.ac = new Curve(o.a || [[0, 0], [0.05, 1], [Math.max(0.1, (o.dur ?? 1) - 0.1), 1], [o.dur ?? 1, 0]]);
    this.dur = o.dur ?? this.ac.p[this.ac.p.length - 1][0];
    this.table = o.table || new Wavetable(o.spectrum || [1], 2048);
    this.norm = 0.3 / Math.max(0.05, this.table.rms);
    this.vel = (o.vel ?? 0.7) * 0.5;
    this.vib = (o.vib ?? 0) / 12 * 0.6931;
    this.vibInc = (o.vibRate ?? 5) / sr;
    this.vph = 0;
    this.noise = new Noise(o.seed || 19);
    this.breath = o.breath ?? 0;
    this.form = o.formant ? new SVF(o.formant, o.formantQ ?? 3, sr) : null;
    this.formMix = o.formantMix ?? 0.6;
    this.ph = 0;
    this.i = 0;
    this.max = (this.dur + 0.02) * sr;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const f = this.fc.at(t);
      this.vph += this.vibInc;
      this.ph += (f / sr) * (1 + this.vib * sinCycle(this.vph));
      let s = this.table.read(this.ph) * this.norm;
      if (this.breath) s += this.noise.white() * this.breath;
      if (this.form) s = s * (1 - this.formMix) + this.form.tick(s) * this.formMix * 3;
      out[i0 + k] = s * this.ac.at(t) * this.vel;
    }
    return this.i < this.max;
  }
}

// ======================================================================= noise beds
/**
 * Filtered noise with time-varying cutoff and level: wind, surf, rumble, room tone, hiss.
 * opts: dur, color ('white'|'pink'|'brown'), type ('lp'|'bp'|'hp'), cutoff (Hz | fn(t)), q, gain (number | fn(t)),
 * am: { rate, depth } slow amplitude modulation, seed
 */
export class Bed {
  constructor(sr, o) {
    this.sr = sr;
    this.dur = o.dur ?? 10;
    this.color = o.color || 'pink';
    this.type = o.type || 'lp';
    this.cut = typeof o.cutoff === 'function' ? o.cutoff : () => o.cutoff ?? 1000;
    this.gain = typeof o.gain === 'function' ? o.gain : () => o.gain ?? 0.3;
    this.q = o.q ?? 0.7;
    this.f = new SVF(1000, this.q, sr);
    this.f2 = o.steep ? new SVF(1000, this.q, sr) : null;
    this.noise = new Noise(o.seed || 23);
    this.i = 0;
    this.g0 = this.gain(0);
    this.fade = (o.fade ?? 0.05) * sr;
    this.max = this.dur * sr;
  }

  process(out, i0, n) {
    const sr = this.sr;
    const t = this.i / sr;
    const fc = this.cut(t);
    this.f.set(fc, this.q, sr);
    if (this.f2) this.f2.set(fc, this.q, sr);
    const g1 = this.gain(t + n / sr);
    const g0 = this.g0;
    this.g0 = g1;
    const nz = this.noise, col = this.color, type = this.type;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const x = col === 'white' ? nz.white() * 0.43 : col === 'brown' ? nz.brown() * 0.25 : nz.pink();
      this.f.tick(x);
      let y = type === 'bp' ? this.f.bp : type === 'hp' ? this.f.hp : this.f.lp;
      if (this.f2) {
        this.f2.tick(y);
        y = type === 'bp' ? this.f2.bp : type === 'hp' ? this.f2.hp : this.f2.lp;
      }
      let fade = 1;
      if (i < this.fade) fade = i / this.fade;
      else if (i > this.max - this.fade) fade = Math.max(0, (this.max - i) / this.fade);
      out[i0 + k] = y * (g0 + (g1 - g0) * (k / n)) * fade;
    }
    return this.i < this.max;
  }
}

// ======================================================================= small physical sounds
/** Minnaert bubble: a decaying sine whose pitch rises as the bubble nears the surface. */
export class Bubble {
  constructor(sr, o) {
    this.sr = sr;
    this.f = o.freq ?? 900;
    this.tau = (o.tau ?? 0.012) * sr;
    this.rise = o.rise ?? 0.8;
    this.vel = (o.vel ?? 0.5) * 0.6;
    this.ph = 0;
    this.i = 0;
    this.max = this.tau * 7;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const x = i / this.tau;
      this.ph += (this.f * (1 + this.rise * x * 0.25)) / sr;
      const a = Math.exp(-x) * Math.min(1, i / (0.0008 * sr));
      out[i0 + k] = sinCycle(this.ph) * a * this.vel;
    }
    return this.i < this.max;
  }
}

/**
 * Dispersive chirp: the high-to-low "pew" of ice and long springs (high frequencies arrive first).
 * opts: from (Hz), to (Hz), dur, vel, curve (exponent), bright noise click
 */
export class Chirp {
  constructor(sr, o) {
    this.sr = sr;
    this.f0 = o.from ?? 7000;
    this.f1 = o.to ?? 250;
    this.N = (o.dur ?? 0.25) * sr;
    this.k = o.curve ?? 2.2;
    this.vel = (o.vel ?? 0.5) * 0.5;
    this.noise = new Noise(o.seed || 29);
    this.hp = new OnePole(3500, sr);
    this.ring = o.ring ?? 0.0;
    this.ph = 0;
    this.i = 0;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const x = Math.min(1, i / this.N);
      const f = this.f1 + (this.f0 - this.f1) * Math.pow(1 - x, this.k);
      this.ph += f / sr;
      const a = Math.pow(1 - x, 1.6) * Math.min(1, i / (0.0005 * sr));
      let s = sinCycle(this.ph) * a;
      if (i < 0.002 * sr) s += this.hp.hp(this.noise.white()) * (1 - i / (0.002 * sr)) * 1.2;
      out[i0 + k] = s * this.vel;
    }
    return this.i < this.N;
  }
}

/**
 * Stick-slip friction (creaks, groans, ropes, wooden mechanisms): an irregular impulse train exciting
 * a resonant body. opts: dur, rate [[t, Hz]], body (Hz), q, vel, jitter, low (adds a woody thump)
 */
export class Creak {
  constructor(sr, o) {
    this.sr = sr;
    this.dur = o.dur ?? 1;
    this.rate = new Curve(o.rate || [[0, 40], [0.5, 90], [1, 30]]);
    this.vel = (o.vel ?? 0.5);
    this.noise = new Noise(o.seed || 31);
    this.jitter = o.jitter ?? 0.35;
    const body = o.body ?? 420;
    this.res = [new Biquad('bandpass', body, o.q ?? 9, sr), new Biquad('bandpass', body * 2.37, (o.q ?? 9) * 1.2, sr),
      new Biquad('bandpass', body * 3.9, (o.q ?? 9) * 1.4, sr)];
    this.mix = [1, 0.55, 0.3];
    this.next = 0;
    this.i = 0;
    this.max = (this.dur + 0.3) * sr;
    this.env = new Curve(o.env || [[0, 0], [0.08 * this.dur, 1], [0.85 * this.dur, 0.8], [this.dur, 0]]);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const t = i / sr;
      let x = 0;
      if (t < this.dur && i >= this.next) {
        const r = Math.max(2, this.rate.at(t / this.dur));
        this.next = i + (sr / r) * (1 + this.jitter * this.noise.white());
        x = (0.6 + 0.4 * this.noise.white()) * this.env.at(t);
      }
      let s = 0;
      for (let m = 0; m < 3; m++) s += this.res[m].tick(x) * this.mix[m];
      out[i0 + k] = s * this.vel * 110;
    }
    return this.i < this.max;
  }
}

/** Sum of other voices (layering): new Layer([voiceA, voiceB], gains) */
export class Layer {
  constructor(voices, gains = null) {
    this.v = voices;
    this.g = gains || voices.map(() => 1);
    this.alive = voices.map(() => true);
    this.tmp = new Float32Array(256);
  }

  process(out, i0, n) {
    out.fill(0, i0, i0 + n);
    if (this.tmp.length < n) this.tmp = new Float32Array(n);
    let any = false;
    for (let j = 0; j < this.v.length; j++) {
      if (!this.alive[j]) continue;
      this.alive[j] = this.v[j].process(this.tmp, 0, n);
      const g = this.g[j];
      for (let k = 0; k < n; k++) out[i0 + k] += this.tmp[k] * g;
      any = any || this.alive[j];
    }
    return any;
  }
}
