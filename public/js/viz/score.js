// Decodes an analyzer score and answers "what is the music doing at time t?" — including the
// future, which is what lets the visuals anticipate builds, drops and section changes.

export const SPEC_BANDS = 32;
// groups of the 32 log bands (36 Hz .. 13 kHz): bass, low-mid, mid, high, air
export const BAND_GROUPS = [[0, 6], [7, 12], [13, 19], [20, 26], [27, 31]];

function b64u8(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** First index i with arr[i] > x (arr sorted ascending). */
export function upperBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentile(values, p) {
  const s = Float32Array.from(values).sort();
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

export function createFrame() {
  return {
    t: 0, dt: 0, playing: false, hasScore: false, live: false,
    loud: 0, loudRaw: 0, intensity: 0, centroid: 0, flat: 0, flux: 0, perc: 0, width: 0, pan: 0,
    spec: new Float32Array(SPEC_BANDS), specBal: new Float32Array(SPEC_BANDS),
    bands: new Float32Array(5), chroma: new Float32Array(12),
    bpm: 0, hasBeat: false, beatPeriod: 0.5, beatPhase: 0, barPhase: 0, beatIndex: 0, barIndex: 0, beatInBar: 0,
    meter: 4, beatPulse: 0, barPulse: 0, beatStrength: 0,
    kick: 0, snare: 0, hat: 0, onset: 0,
    section: null, sectionIndex: -1, sectionT: 0, sectionLabel: 0, sectionKind: '', nextSection: null,
    timeToNext: Infinity, build: 0, preDrop: 0, drop: 0, impact: 0, nextDropIn: Infinity,
    key: '', keyIndex: 0, mode: 'major', energy: 0.5, valence: 0.5, seed: 0, duration: 0,
    channels: null, channelLevels: null,
  };
}

const SCORE_FORMAT = 'kw51-score'; // what analyzer/kw51_analysis writes
const LEGACY_SCORE_FORMAT = 'marquee-score'; // scores written before the app was renamed KW 5.1

export class Score {
  constructor(json) {
    if (json.format !== SCORE_FORMAT && json.format !== LEGACY_SCORE_FORMAT) throw new Error(`not a ${SCORE_FORMAT} file`);
    this.json = json;
    const f = json.frames;
    this.fps = f.fps;
    this.count = f.count;
    this.duration = json.source.duration;
    this.global = json.global;
    this.tags = json.tags || {};
    this.loud = b64u8(f.loud.data);
    this.spec = b64u8(f.spec.data);
    this.centroid = b64u8(f.centroid.data);
    this.flat = b64u8(f.flatness.data);
    this.flux = b64u8(f.flux.data);
    this.perc = b64u8(f.perc.data);
    this.chroma = b64u8(f.chroma.data);
    this.width = b64u8(f.width.data);
    this.pan = b64u8(f.pan.data);
    this.intensity = b64u8(f.intensity.data);
    this.channelLayout = f.channels ? f.channels.layout : null;
    this.channels = f.channels ? b64u8(f.channels.data) : null;

    const B = json.beats || { t: [], s: [], pos: [] };
    this.beatT = Float64Array.from(B.t);
    this.beatS = Float32Array.from(B.s);
    this.beatPos = Int8Array.from(B.pos);
    this.meter = json.global.meter || 4;
    this.events = {};
    for (const [k, v] of Object.entries(json.events || {})) {
      this.events[k] = { t: Float64Array.from(v.t), s: Float32Array.from(v.s) };
    }
    this.sections = json.sections || [];
    this.sectionStarts = Float64Array.from(this.sections.map((s) => s.start));
    this.builds = json.builds || [];
    this.drops = (json.drops || []).slice().sort((a, b) => a.t - b.t);
    this.dropT = Float64Array.from(this.drops.map((d) => d.t));
    this.moments = (json.moments || []).filter((m) => m.type !== 'drop').sort((a, b) => a.t - b.t);
    this.momentT = Float64Array.from(this.moments.map((m) => m.t));
    this.downbeats = Float64Array.from(B.t.filter((_, i) => B.pos[i] === 0));
    this._normalize();
  }

  _normalize() {
    // per-band activity range (honest per track), and the track's loudest band level for balance
    const n = this.count, nb = SPEC_BANDS;
    this.bandLo = new Float32Array(nb);
    this.bandHi = new Float32Array(nb);
    let maxAll = 0;
    const col = new Float32Array(n);
    for (let b = 0; b < nb; b++) {
      for (let i = 0; i < n; i++) col[i] = this.spec[i * nb + b];
      let lo = percentile(col, 8), hi = percentile(col, 99.2);
      if (hi - lo < 34) lo = Math.max(0, hi - 34); // never stretch less than ~12 dB to full scale
      this.bandLo[b] = lo;
      this.bandHi[b] = hi;
      if (hi > maxAll) maxAll = hi;
    }
    this.balRef = maxAll;
    const L = Float32Array.from(this.loud);
    this.loudLo = percentile(L, 3);
    this.loudHi = Math.max(this.loudLo + 20, percentile(L, 99.5));
  }

  /** Interpolated continuous features at time t into frame. */
  sample(t, fr) {
    const x = Math.max(0, Math.min(this.count - 1.001, t * this.fps));
    const i = Math.floor(x);
    const a = x - i;
    const j = i + 1;
    const lerp = (arr) => (arr[i] + (arr[j] - arr[i]) * a) / 255;
    const loudRaw = this.loud[i] + (this.loud[j] - this.loud[i]) * a;
    fr.loudRaw = loudRaw / 255;
    fr.loud = Math.min(1, Math.max(0, (loudRaw - this.loudLo) / (this.loudHi - this.loudLo)));
    fr.intensity = lerp(this.intensity);
    fr.centroid = lerp(this.centroid);
    fr.flat = lerp(this.flat);
    fr.flux = lerp(this.flux);
    fr.perc = lerp(this.perc);
    fr.width = lerp(this.width);
    fr.pan = lerp(this.pan) * 2 - 1;
    const nb = SPEC_BANDS;
    const balSpan = (60 / 90) * 255; // show 60 dB below the track's loudest band
    for (let b = 0; b < nb; b++) {
      const v = this.spec[i * nb + b] + (this.spec[j * nb + b] - this.spec[i * nb + b]) * a;
      const bal = Math.min(1, Math.max(0, (v - (this.balRef - balSpan)) / balSpan));
      let act = Math.min(1, Math.max(0, (v - this.bandLo[b]) / (this.bandHi[b] - this.bandLo[b])));
      act = Math.pow(act, 1.25) * (0.35 + 0.65 * Math.min(1, Math.max(0, (bal - 0.15) / 0.45)));
      fr.specBal[b] = bal;
      fr.spec[b] = act;
    }
    for (let g = 0; g < BAND_GROUPS.length; g++) {
      const [s, e] = BAND_GROUPS[g];
      let m = 0, mx = 0;
      for (let b = s; b <= e; b++) {
        m += fr.spec[b];
        if (fr.spec[b] > mx) mx = fr.spec[b];
      }
      fr.bands[g] = 0.6 * (m / (e - s + 1)) + 0.4 * mx;
    }
    for (let k = 0; k < 12; k++) fr.chroma[k] = (this.chroma[i * 12 + k] + (this.chroma[j * 12 + k] - this.chroma[i * 12 + k]) * a) / 255;
    if (this.channels) {
      const nc = this.channelLayout.length;
      if (!fr.channelLevels || fr.channelLevels.length !== nc) fr.channelLevels = new Float32Array(nc);
      for (let c = 0; c < nc; c++) fr.channelLevels[c] = (this.channels[i * nc + c] + (this.channels[j * nc + c] - this.channels[i * nc + c]) * a) / 255;
      fr.channels = this.channelLayout;
    }
  }

  /** Decaying envelope of the most recent event of `kind` (strength-scaled). */
  envelope(kind, t, decay = 0.15, attack = 0.008) {
    const ev = this.events[kind];
    if (!ev || !ev.t.length) return 0;
    const k = upperBound(ev.t, t) - 1;
    if (k < 0) return 0;
    const d = t - ev.t[k];
    const s = ev.s[k];
    if (d < attack) return s * (d / attack);
    return s * Math.exp(-(d - attack) / decay);
  }

  beat(t, fr) {
    const bt = this.beatT;
    const n = bt.length;
    fr.meter = this.meter;
    if (n < 2) {
      fr.hasBeat = false;
      fr.bpm = 0;
      fr.beatPeriod = 2.0;
      const ph = t / 2.0;
      fr.beatIndex = Math.floor(ph);
      fr.beatPhase = ph - fr.beatIndex;
      fr.barPhase = (t / 8.0) % 1;
      fr.barIndex = Math.floor(t / 8.0);
      fr.beatInBar = fr.beatIndex % 4;
      fr.beatPulse = 0;
      fr.barPulse = 0;
      fr.beatStrength = 0;
      return;
    }
    fr.hasBeat = true;
    fr.bpm = this.global.bpm;
    let k = upperBound(bt, t) - 1;
    let period, start, pos, strength;
    if (k < 0) {
      period = bt[1] - bt[0];
      const back = Math.ceil((bt[0] - t) / period);
      start = bt[0] - back * period;
      pos = ((this.beatPos[0] - back) % this.meter + this.meter) % this.meter;
      strength = 0;
      k = -back;
    } else if (k >= n - 1) {
      period = bt[n - 1] - bt[n - 2];
      const fwd = Math.floor((t - bt[n - 1]) / period);
      start = bt[n - 1] + fwd * period;
      pos = (this.beatPos[n - 1] + fwd) % this.meter;
      strength = fwd === 0 ? this.beatS[n - 1] : 0;
      k = n - 1 + fwd;
    } else {
      period = bt[k + 1] - bt[k];
      start = bt[k];
      pos = this.beatPos[k];
      strength = this.beatS[k];
    }
    const since = t - start;
    fr.beatPeriod = period;
    fr.beatPhase = Math.min(0.9999, Math.max(0, since / period));
    fr.beatIndex = k;
    fr.beatInBar = pos;
    fr.barPhase = (pos + fr.beatPhase) / this.meter;
    fr.barIndex = Math.floor((k - pos) / this.meter);
    fr.beatStrength = strength;
    const accent = pos === 0 ? 1 : 0.65;
    fr.beatPulse = Math.min(1, (0.35 + 0.65 * strength) * accent * Math.exp(-since / (0.28 * period)));
    const sinceBar = since + pos * period;
    fr.barPulse = Math.exp(-sinceBar / (0.9 * period));
  }

  structure(t, fr) {
    const S = this.sections;
    if (!S.length) return;
    const k = Math.max(0, upperBound(this.sectionStarts, t) - 1);
    const s = S[k];
    fr.section = s;
    fr.sectionIndex = k;
    fr.sectionLabel = s.label;
    fr.sectionKind = s.kind;
    fr.sectionT = Math.min(1, Math.max(0, (t - s.start) / Math.max(0.001, s.end - s.start)));
    fr.nextSection = S[k + 1] || null;
    fr.timeToNext = fr.nextSection ? fr.nextSection.start - t : Infinity;
    const bar = (fr.beatPeriod || 0.5) * (fr.meter || 4);
    fr.build = 0;
    for (const b of this.builds) {
      if (t >= b.start && t < b.end) fr.build = Math.pow((t - b.start) / (b.end - b.start), 1.6) * (b.strength || 1);
    }
    fr.preDrop = 0;
    fr.drop = 0;
    fr.nextDropIn = Infinity;
    const di = upperBound(this.dropT, t);
    if (di < this.drops.length) {
      const lead = this.drops[di].t - t;
      fr.nextDropIn = lead;
      if (lead < bar) fr.preDrop = 1 - lead / bar;
    }
    if (di > 0) {
      const d = this.drops[di - 1];
      const since = t - d.t;
      if (since < bar * 4) fr.drop = d.strength * Math.exp(-since / (bar * 0.9));
    }
    fr.impact = 0;
    const mi = upperBound(this.momentT, t) - 1;
    if (mi >= 0) {
      const m = this.moments[mi];
      const since = t - m.t;
      fr.impact = m.s * Math.exp(-since / 0.4);
    }
  }

  /** Everything at once. */
  frameAt(t, fr) {
    fr.t = t;
    fr.hasScore = true;
    fr.live = false;
    fr.duration = this.duration;
    this.sample(t, fr);
    this.beat(t, fr);
    fr.kick = this.envelope('kick', t, 0.16);
    fr.snare = this.envelope('snare', t, 0.13);
    fr.hat = this.envelope('hat', t, 0.06);
    fr.onset = this.envelope('onset', t, 0.1);
    this.structure(t, fr);
    const g = this.global;
    fr.key = g.key;
    fr.keyIndex = g.keyIndex;
    fr.mode = g.mode;
    fr.energy = g.energy;
    fr.valence = g.valence;
    return fr;
  }

  /** Spectral activity only (fast path), written into out[offset..offset+32). */
  specActivity(t, out, offset = 0) {
    const nb = SPEC_BANDS;
    if (t < 0 || t > this.duration) {
      out.fill(0, offset, offset + nb);
      return;
    }
    const x = Math.min(this.count - 1.001, t * this.fps);
    const i = Math.floor(x);
    const a = x - i;
    const balSpan = (60 / 90) * 255;
    for (let b = 0; b < nb; b++) {
      const v0 = this.spec[i * nb + b];
      const v = v0 + (this.spec[i * nb + nb + b] - v0) * a;
      const bal = Math.min(1, Math.max(0, (v - (this.balRef - balSpan)) / balSpan));
      const act = Math.min(1, Math.max(0, (v - this.bandLo[b]) / (this.bandHi[b] - this.bandLo[b])));
      out[offset + b] = Math.pow(act, 1.25) * (0.35 + 0.65 * Math.min(1, Math.max(0, (bal - 0.15) / 0.45)));
    }
  }

  /** Future (and recent past) spectrum rows for the Horizon terrain: rows evenly spaced in time. */
  fillSpectrogram(t0, dtRow, rows, out) {
    for (let r = 0; r < rows; r++) this.specActivity(t0 + r * dtRow, out, r * SPEC_BANDS);
  }

  /** Section boundaries (and whether they are drops) within the next `horizon` seconds. */
  upcomingBoundaries(t, horizon) {
    const out = [];
    for (const s of this.sections) {
      if (s.start > t && s.start - t < horizon) out.push({ dt: s.start - t, drop: s.kind === 'drop', label: s.label });
    }
    return out;
  }
}

/** Feature source backed by a pre-computed score (full lookahead). */
export class ScoreSource {
  constructor(score) {
    this.score = score;
  }

  frameAt(t, fr) {
    return this.score.frameAt(t, fr);
  }
}
