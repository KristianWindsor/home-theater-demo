// LiveSource: real-time features from a Web Audio AnalyserNode, with online beat tracking.
// Used when a track hasn't been analyzed yet — and the path a future Spotify / line-in source takes
// (no lookahead there, so no sections, builds or drops: the director improvises instead).
import { SPEC_BANDS, BAND_GROUPS } from './score.js';

const HIST = 480; // onset history (frames, ~8 s at 60 fps)

export class LiveSource {
  constructor(analyser) {
    this.an = analyser;
    this.sr = analyser.context.sampleRate;
    const bins = analyser.frequencyBinCount;
    this.freq = new Float32Array(bins);
    this.time = new Float32Array(analyser.fftSize);
    this.binHz = this.sr / analyser.fftSize;
    // 32 log bands (same spacing as the analyzer)
    const edges = [];
    for (let i = 0; i < SPEC_BANDS + 2; i++) edges.push(30 * Math.pow(16000 / 30, i / (SPEC_BANDS + 1)));
    this.bandBins = [];
    for (let b = 0; b < SPEC_BANDS; b++) {
      const lo = Math.max(1, Math.floor(Math.sqrt(edges[b] * edges[b + 1]) / this.binHz));
      const hi = Math.max(lo + 1, Math.ceil(Math.sqrt(edges[b + 1] * edges[b + 2]) / this.binHz));
      this.bandBins.push([lo, Math.min(bins, hi)]);
    }
    this.prevBand = new Float32Array(SPEC_BANDS);
    this.bandLo = new Float32Array(SPEC_BANDS).fill(-80);
    this.bandHi = new Float32Array(SPEC_BANDS).fill(-30);
    this.loudLo = -50;
    this.loudHi = -15;
    this.intensity = 0;
    // pitch class map
    this.pcBins = [];
    for (let k = 1; k < bins; k++) {
      const f = k * this.binHz;
      if (f < 110 || f > 4200) continue;
      const p = 69 + 12 * Math.log2(f / 440);
      const n = Math.round(p);
      this.pcBins.push([k, ((n % 12) + 12) % 12, Math.cos(Math.PI * (p - n)) ** 2]);
    }
    // onset / tempo state
    this.hist = new Float32Array(HIST);
    this.histI = 0;
    this.kickAvg = 0;
    this.snareAvg = 0;
    this.hatAvg = 0;
    this.env = { kick: 0, snare: 0, hat: 0, onset: 0 };
    this.period = 0.5;
    this.periods = [];
    this.nextBeat = 0;
    this.beatIndex = 0;
    this.lastBeat = 0;
    this.lastT = 0;
    this.frameCount = 0;
    this.confidence = 0;
  }

  frameAt(t, fr) {
    const dt = Math.min(0.1, Math.max(0.001, t - this.lastT || 1 / 60));
    this.lastT = t;
    this.an.getFloatFrequencyData(this.freq);
    this.an.getFloatTimeDomainData(this.time);
    fr.t = t;
    fr.hasScore = false;
    fr.live = true;
    // loudness
    let ss = 0;
    for (let i = 0; i < this.time.length; i++) ss += this.time[i] * this.time[i];
    const db = 10 * Math.log10(ss / this.time.length + 1e-12);
    this.loudHi = Math.max(db, this.loudHi - dt * 0.6);
    this.loudLo = Math.min(db, this.loudLo + dt * 0.4);
    if (this.loudHi - this.loudLo < 18) this.loudLo = this.loudHi - 18;
    fr.loudRaw = Math.max(0, (db + 70) / 70);
    fr.loud = Math.min(1, Math.max(0, (db - this.loudLo) / (this.loudHi - this.loudLo)));
    this.intensity += (fr.loud - this.intensity) * Math.min(1, dt / 3);
    fr.intensity = this.intensity;
    // bands
    let flux = 0, lowFlux = 0, midFlux = 0, hiFlux = 0, num = 0, den = 0, logSum = 0, cnt = 0;
    for (let b = 0; b < SPEC_BANDS; b++) {
      const [lo, hi] = this.bandBins[b];
      let p = 0;
      for (let k = lo; k < hi; k++) p += Math.pow(10, this.freq[k] / 10);
      const v = 10 * Math.log10(p + 1e-12);
      const d = Math.max(0, v - this.prevBand[b]);
      this.prevBand[b] = v;
      flux += d;
      if (b <= 5) lowFlux += d;
      else if (b >= 18 && b <= 25) midFlux += d;
      else if (b >= 27) hiFlux += d;
      this.bandHi[b] = Math.max(v, this.bandHi[b] - dt * 1.5);
      this.bandLo[b] = Math.min(v, this.bandLo[b] + dt * 1.0);
      if (this.bandHi[b] - this.bandLo[b] < 15) this.bandLo[b] = this.bandHi[b] - 15;
      fr.spec[b] = Math.pow(Math.min(1, Math.max(0, (v - this.bandLo[b]) / (this.bandHi[b] - this.bandLo[b]))), 1.25);
      fr.specBal[b] = Math.min(1, Math.max(0, (v + 90) / 70));
      const fc = 30 * Math.pow(16000 / 30, (b + 1) / (SPEC_BANDS + 1));
      num += fc * p;
      den += p;
      logSum += Math.log(p + 1e-12);
      cnt++;
    }
    for (let g = 0; g < BAND_GROUPS.length; g++) {
      const [s, e] = BAND_GROUPS[g];
      let m = 0;
      for (let b = s; b <= e; b++) m += fr.spec[b];
      fr.bands[g] = m / (e - s + 1);
    }
    const centroidHz = num / (den + 1e-12);
    fr.centroid = Math.min(1, Math.max(0, (Math.log2(Math.max(1, centroidHz)) - Math.log2(100)) / (Math.log2(10000) - Math.log2(100))));
    fr.flat = Math.min(1, Math.max(0, 1 + (10 * (logSum / cnt - Math.log(den / cnt + 1e-12)) / Math.LN10) / 50));
    fr.flux = Math.min(1, flux / 60);
    fr.perc = Math.min(1, (lowFlux + midFlux + hiFlux) / 40);
    fr.width = 0.2;
    fr.pan = 0;
    // chroma
    fr.chroma.fill(0);
    for (const [k, pc, w] of this.pcBins) fr.chroma[pc] += w * Math.pow(10, this.freq[k] / 20);
    let mx = 0;
    for (let k = 0; k < 12; k++) mx = Math.max(mx, fr.chroma[k]);
    const sorted = Array.from(fr.chroma).sort((a, b) => a - b);
    const med = (sorted[5] + sorted[6]) / 2;
    const clarity = Math.min(1, 1.6 * (mx - med) / (mx + 1e-9));
    for (let k = 0; k < 12; k++) fr.chroma[k] = Math.max(0, (fr.chroma[k] - med) / (mx - med + 1e-9)) * clarity * Math.min(1, fr.loud * 2);
    // drum envelopes with adaptive thresholds
    const hit = (name, val, avgKey, k, decay) => {
      this[avgKey] += (val - this[avgKey]) * Math.min(1, dt * 2.5);
      if (val > this[avgKey] * k + 2.5 && val > 4) this.env[name] = Math.max(this.env[name], Math.min(1, val / (this[avgKey] * k * 3 + 6)) * 0.5 + 0.5);
      this.env[name] *= Math.exp(-dt / decay);
      return this.env[name];
    };
    fr.kick = hit('kick', lowFlux, 'kickAvg', 1.8, 0.16);
    fr.snare = hit('snare', midFlux * fr.flat * 2, 'snareAvg', 1.8, 0.13);
    fr.hat = hit('hat', hiFlux, 'hatAvg', 1.7, 0.06);
    fr.onset = Math.max(fr.kick, fr.snare * 0.8);
    this._tempo(t, lowFlux * 1.5 + flux * 0.5, dt, fr);
    fr.section = null;
    fr.sectionIndex = -1;
    fr.sectionKind = '';
    fr.build = 0;
    fr.preDrop = 0;
    fr.drop = 0;
    fr.impact = 0;
    fr.nextDropIn = Infinity;
    fr.timeToNext = Infinity;
    return fr;
  }

  _tempo(t, onsetVal, dt, fr) {
    this.hist[this.histI % HIST] = onsetVal;
    this.histI++;
    this.frameCount++;
    const fps = 1 / dt;
    if (this.frameCount % 30 === 0 && this.histI > HIST / 2) {
      const n = Math.min(this.histI, HIST);
      const x = new Float32Array(n);
      let mean = 0;
      for (let i = 0; i < n; i++) {
        x[i] = this.hist[(this.histI - n + i) % HIST];
        mean += x[i];
      }
      mean /= n;
      for (let i = 0; i < n; i++) x[i] = Math.max(0, x[i] - mean);
      let best = 0, bestLag = 0, zero = 0;
      for (let i = 0; i < n; i++) zero += x[i] * x[i];
      const minLag = Math.floor(fps * 60 / 185), maxLag = Math.ceil(fps * 60 / 65);
      for (let lag = minLag; lag <= maxLag && lag < n - 1; lag++) {
        let s = 0;
        for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
        const bpm = 60 * fps / lag;
        const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120), 2));
        const v = (s / (zero + 1e-9)) * prior;
        if (v > best) {
          best = v;
          bestLag = lag;
        }
      }
      if (bestLag) {
        this.periods.push(bestLag / fps);
        if (this.periods.length > 7) this.periods.shift();
        const sorted = this.periods.slice().sort((a, b) => a - b);
        this.period = sorted[sorted.length >> 1];
        this.confidence = Math.min(1, best * 3);
      }
    }
    // phase-locked beat clock: nudge toward strong onsets near the predicted beat
    if (!this.nextBeat) this.nextBeat = t + this.period;
    const err = t - this.nextBeat;
    if (onsetVal > 8 && Math.abs(err) < this.period * 0.2) this.nextBeat += err * 0.25;
    while (t >= this.nextBeat) {
      this.lastBeat = this.nextBeat;
      this.nextBeat += this.period;
      this.beatIndex++;
    }
    const phase = Math.min(0.9999, Math.max(0, (t - this.lastBeat) / this.period));
    fr.hasBeat = this.confidence > 0.25;
    fr.bpm = 60 / this.period;
    fr.beatPeriod = this.period;
    fr.beatPhase = phase;
    fr.beatIndex = this.beatIndex;
    fr.meter = 4;
    fr.beatInBar = this.beatIndex % 4;
    fr.barPhase = (fr.beatInBar + phase) / 4;
    fr.barIndex = Math.floor(this.beatIndex / 4);
    fr.beatStrength = Math.min(1, onsetVal / 20);
    fr.beatPulse = fr.hasBeat ? (fr.beatInBar === 0 ? 1 : 0.65) * Math.exp(-(t - this.lastBeat) / (0.28 * this.period)) * Math.min(1, 0.4 + fr.loud) : 0;
    fr.barPulse = Math.exp(-(t - this.lastBeat + fr.beatInBar * this.period) / (0.9 * this.period));
  }
}
