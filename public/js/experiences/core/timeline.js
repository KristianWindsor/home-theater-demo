// Shared by the audio worker and the visuals: one score drives sound, picture and lights.
// Everything here is deterministic (seeded) so both sides compute the identical timeline.

export const TAU = Math.PI * 2;

/** Deterministic PRNG (mulberry32) with a few conveniences. */
export class Rng {
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }

  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(p) {
    return this.next() < p;
  }

  /** Approximately normal (sum of uniforms). */
  gauss(sd = 1) {
    return (this.next() + this.next() + this.next() + this.next() - 2) * sd * 1.7320508;
  }

  fork(salt) {
    return new Rng((this.s ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  }
}

// ------------------------------------------------------------------ music

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f) => 69 + 12 * Math.log2(f / 440);

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'D4' -> 62, 'F#5' -> 78, 'Bb1' -> 34. Numbers pass through. */
export function note(n) {
  if (typeof n === 'number') return n;
  const m = /^([A-G])([#b]*)(-?\d)$/.exec(n);
  if (!m) throw new Error(`bad note ${n}`);
  let pc = PC[m[1]];
  for (const c of m[2]) pc += c === '#' ? 1 : -1;
  return 12 * (Number(m[3]) + 1) + pc;
}

export const notes = (s) => s.trim().split(/\s+/).map((x) => (x === '-' || x === '.' ? null : note(x)));

/** Tempo map with a constant tempo: bars/beats <-> seconds. */
export class Tempo {
  constructor(bpm, beatsPerBar = 4, offset = 0) {
    this.bpm = bpm;
    this.bpb = beatsPerBar;
    this.offset = offset;
    this.beat = 60 / bpm;
    this.bar = this.beat * beatsPerBar;
  }

  /** Seconds at bar b (0-based), beat k (0-based, may be fractional). */
  t(b, k = 0) {
    return this.offset + b * this.bar + k * this.beat;
  }

  /** Bar position (fractional) at time t. */
  barAt(t) {
    return (t - this.offset) / this.bar;
  }

  beatAt(t) {
    return (t - this.offset) / this.beat;
  }
}

// ------------------------------------------------------------------ curves

export const EASE = {
  linear: (x) => x,
  in: (x) => x * x,
  out: (x) => 1 - (1 - x) * (1 - x),
  inOut: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  in3: (x) => x * x * x,
  out3: (x) => 1 - Math.pow(1 - x, 3),
  inOut3: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  smooth: (x) => x * x * (3 - 2 * x),
  step: (x) => (x < 1 ? 0 : 1),
  sine: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
  expo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
};

/**
 * Piecewise curve: [[t, value, ease?], ...] (ease applies to the segment ending at that point).
 * Values may be numbers or arrays (component-wise). Holds the end values outside the range.
 */
export class Curve {
  constructor(points) {
    this.p = points.slice().sort((a, b) => a[0] - b[0]);
    this.i = 0;
  }

  at(t) {
    const p = this.p;
    if (!p.length) return 0;
    if (t <= p[0][0]) return p[0][1];
    if (t >= p[p.length - 1][0]) return p[p.length - 1][1];
    let i = this.i;
    if (i >= p.length - 1 || p[i][0] > t) i = 0;
    while (i < p.length - 2 && p[i + 1][0] <= t) i++;
    this.i = i;
    const a = p[i], b = p[i + 1];
    const x = (EASE[b[2] || 'linear'] || EASE.linear)((t - a[0]) / (b[0] - a[0] || 1));
    if (Array.isArray(a[1])) return a[1].map((v, k) => v + (b[1][k] - v) * x);
    return a[1] + (b[1] - a[1]) * x;
  }
}

export const curve = (points) => new Curve(points);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 0 -> 1 over [a, b] then 1 -> 0 over [c, d]. */
export const window4 = (x, a, b, c, d) => smoothstep(a, b, x) * (1 - smoothstep(c, d, x));

/** Attack/decay pulse for an event at time t0: 0 before, 1 at t0 + attack, then exponential decay. */
export function pulse(t, t0, attack = 0.01, decay = 0.4) {
  const d = t - t0;
  if (d < 0) return 0;
  if (d < attack) return d / attack;
  return Math.exp(-(d - attack) / decay);
}

// ------------------------------------------------------------------ score

/**
 * Collects timed events. An event is a plain object with at least { t, inst }.
 * `pos` is where it plays: a speaker role ('FL', 'FR', 'C', 'SL', 'SR', 'LFE') or { az, dist, width }.
 * The audio side turns events into voices; the visual side reads the same list.
 */
export class Score {
  constructor({ duration, bpm = 120, beatsPerBar = 4, offset = 0, seed = 1 } = {}) {
    this.duration = duration;
    this.tempo = new Tempo(bpm, beatsPerBar, offset);
    this.rng = new Rng(seed);
    this.events = [];
    this.chapters = [];
    this.marks = {};
    this.callouts = [];
  }

  add(ev) {
    this.events.push(ev);
    return ev;
  }

  chapter(t, title) {
    this.chapters.push({ t, title });
  }

  mark(name, t) {
    this.marks[name] = t;
  }

  /** Name a speaker on screen from t for dur seconds (a room piece: the label floats over that speaker in the 3D room). */
  callout(t, role, text, dur = 2.4) {
    this.callouts.push({ t, role, text, dur });
  }

  /** Sort and index; call once after composing. */
  done() {
    this.events.sort((a, b) => a.t - b.t);
    this.chapters.sort((a, b) => a.t - b.t);
    this.callouts.sort((a, b) => a.t - b.t);
    return this;
  }

  /** Events matching a predicate (cached by key). */
  select(key, fn) {
    if (!this._sel) this._sel = new Map();
    if (!this._sel.has(key)) this._sel.set(key, this.events.filter(fn));
    return this._sel.get(key);
  }
}

/** Events with t in [t0, t1) from a sorted list (binary search). */
export function between(list, t0, t1) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t0) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo; i < list.length && list[i].t < t1; i++) out.push(list[i]);
  return out;
}

/** Index of the last event with t <= time, or -1. */
export function lastBefore(list, time) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

// Default speaker azimuths (degrees, 0 = screen, clockwise). The real ones come from config/room.json.
export const DEFAULT_AZ = { FL: -60, FR: 60, C: 0, FC: 0, SL: -120, SR: 120 };
