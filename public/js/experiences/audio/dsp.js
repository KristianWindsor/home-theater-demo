// Small, fast DSP building blocks for the offline experience renderer. Pure JS, no Web Audio, so the
// same code runs in a browser worker and in Node (scripts/render_experience.mjs).
import { TAU } from '../core/timeline.js';

export const SR_DEFAULT = 48000;

// ---------------------------------------------------------------- sine table
const SINE_N = 4096;
export const SINE = new Float32Array(SINE_N + 1);
for (let i = 0; i <= SINE_N; i++) SINE[i] = Math.sin((TAU * i) / SINE_N);

/** sin(2*pi*ph) for a phase in cycles (any real number). */
export function sinCycle(ph) {
  ph -= Math.floor(ph);
  const x = ph * SINE_N;
  const i = x | 0;
  return SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const t60ToMul = (t60, sr) => Math.exp(-6.907755 / Math.max(1e-4, t60 * sr));

// ---------------------------------------------------------------- noise (xorshift, fast)
export class Noise {
  constructor(seed = 1) {
    this.x = (seed * 2654435761) >>> 0 || 1;
    this.b0 = this.b1 = this.b2 = this.b3 = this.b4 = this.b5 = this.b6 = 0;
    this.br = 0;
  }

  white() {
    let x = this.x;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.x = x >>> 0;
    return (this.x / 2147483648) - 1;
  }

  /** Paul Kellet's pink filter (about -3 dB/oct), roughly unit RMS-ish scale. */
  pink() {
    const w = this.white();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const y = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return y * 0.11;
  }

  /** Brownian (-6 dB/oct), leaky so it never drifts away. */
  brown() {
    this.br = (this.br + 0.02 * this.white()) * 0.998;
    return this.br * 3.5;
  }
}

// ---------------------------------------------------------------- filters
export class OnePole {
  constructor(hz = 1000, sr = SR_DEFAULT) {
    this.y = 0;
    this.set(hz, sr);
  }

  set(hz, sr = SR_DEFAULT) {
    this.a = 1 - Math.exp((-TAU * Math.min(hz, sr * 0.49)) / sr);
    return this;
  }

  lp(x) {
    return (this.y += this.a * (x - this.y));
  }

  hp(x) {
    return x - (this.y += this.a * (x - this.y));
  }
}

/** RBJ biquad, transposed direct form II. */
export class Biquad {
  constructor(type = 'lowpass', f = 1000, q = 0.707, sr = SR_DEFAULT, gainDb = 0) {
    this.z1 = 0;
    this.z2 = 0;
    this.set(type, f, q, sr, gainDb);
  }

  set(type, f, q = 0.707, sr = SR_DEFAULT, gainDb = 0) {
    const w = (TAU * Math.min(f, sr * 0.49)) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'highpass':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': // constant 0 dB peak gain
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'notch':
        b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
      }
      default: // lowpass
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  run(buf, i0, n) {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1, z2 = this.z2;
    for (let i = i0, e = i0 + n; i < e; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

/** Zero-delay-feedback state variable filter (Cytomic). tick() returns lowpass; .bp/.hp are set too. */
export class SVF {
  constructor(f = 1000, q = 0.707, sr = SR_DEFAULT) {
    this.ic1 = 0;
    this.ic2 = 0;
    this.lp = this.bp = this.hp = 0;
    this.set(f, q, sr);
  }

  set(f, q = 0.707, sr = SR_DEFAULT) {
    const g = Math.tan((Math.PI * Math.min(Math.max(f, 5), sr * 0.49)) / sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }

  tick(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1;
    this.lp = v2;
    this.hp = x - this.k * v1 - v2;
    return v2;
  }
}

/** Linkwitz-Riley 4th-order low-pass (two cascaded Butterworth biquads): the LFE crossover. */
export class LR4 {
  constructor(f, sr, type = 'lowpass') {
    this.a = new Biquad(type, f, Math.SQRT1_2, sr);
    this.b = new Biquad(type, f, Math.SQRT1_2, sr);
  }

  run(buf, i0, n) {
    this.a.run(buf, i0, n);
    this.b.run(buf, i0, n);
  }
}

// ---------------------------------------------------------------- delay line
export class Delay {
  constructor(maxSamples) {
    let size = 16;
    while (size < maxSamples + 4) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
    this.w = 0;
  }

  write(x) {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }

  /** Sample written d samples ago (d >= 1, fractional ok, linear interpolation). */
  read(d) {
    const p = this.w - d;
    const i = Math.floor(p);
    const f = p - i;
    const a = this.buf[i & this.mask];
    return a + (this.buf[(i + 1) & this.mask] - a) * f;
  }

  readInt(d) {
    return this.buf[(this.w - d) & this.mask];
  }
}

// ---------------------------------------------------------------- wavetables
/**
 * Single-cycle table from harmonic amplitudes (index 0 = fundamental). Normalized to peak 1.
 * Phases default to alternating 0/90 deg which keeps the crest factor low.
 */
export class Wavetable {
  constructor(amps, size = 2048, phases = null) {
    this.size = size;
    const t = new Float32Array(size + 1);
    for (let h = 0; h < amps.length; h++) {
      const a = amps[h];
      if (!a) continue;
      const ph = phases ? phases[h] : (h % 2 ? 0.25 : 0) + h * h * 0.0371;
      const k = h + 1;
      for (let i = 0; i < size; i++) t[i] += a * Math.sin(TAU * (k * i / size + ph));
    }
    let peak = 1e-9;
    for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(t[i]));
    for (let i = 0; i < size; i++) t[i] /= peak;
    t[size] = t[0];
    this.t = t;
    // RMS of the normalized table, handy for level matching
    let s = 0;
    for (let i = 0; i < size; i++) s += t[i] * t[i];
    this.rms = Math.sqrt(s / size);
  }

  read(ph) {
    ph -= Math.floor(ph);
    const x = ph * this.size;
    const i = x | 0;
    const t = this.t;
    return t[i] + (t[i + 1] - t[i]) * (x - i);
  }
}

const tableCache = new Map();
/** Cached table: key must describe the spectrum exactly. */
export function cachedTable(key, make) {
  let t = tableCache.get(key);
  if (!t) {
    t = make();
    tableCache.set(key, t);
    if (tableCache.size > 600) tableCache.delete(tableCache.keys().next().value);
  }
  return t;
}

/** Harmonic amplitudes for f0 up to a frequency limit, from a function of (harmonic number, frequency). */
export function harmonics(f0, limitHz, fn) {
  const n = Math.max(1, Math.floor(limitHz / f0));
  const out = new Array(n);
  for (let k = 1; k <= n; k++) out[k - 1] = fn(k, k * f0);
  return out;
}

// ---------------------------------------------------------------- misc
export function softClip(x) {
  if (x > 1.5) return 1;
  if (x < -1.5) return -1;
  return x - (x * x * x) / 6.75;
}

/** First-order allpass phase delay (samples) at angular frequency w for coefficient a. */
export function allpassPhaseDelay(a, w) {
  const ph = Math.atan2(-Math.sin(w), a + Math.cos(w)) - Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w));
  return -ph / w;
}

/** Fill a buffer region with zeros. */
export function zero(buf, i0, n) {
  buf.fill(0, i0, i0 + n);
}
