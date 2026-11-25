// The Director: turns musical facts into a choreography.
//
// With a score (lookahead) it composes the whole song up front, like a programmed light show:
//  * each distinct section label gets its own world + palette, so repeats look like repeats
//  * transitions land on section boundaries: dissolves over a bar, hard cuts into drops
//  * builds close cinematic letterbox bars, increase feedback and desaturate; the last bar
//    before a drop "inhales" (dims, zooms out); the drop flashes, shockwaves and blows the bars open
// Without a score (live input) it improvises: switches worlds on phrase-length energy changes.
import { WORLDS, WORLD_BY_ID, affinity } from './worlds/index.js';
import { rng, hashString, clamp, smoothstep } from '../gl/math.js';
import { sectionPalette, chordColor, mixRGB, pitchHue } from './palette.js';
import { upperBound } from './score.js';

const GOLDEN = 2.39996;

export class Director {
  constructor(settings) {
    this.settings = settings;
    this.score = null;
    this.plan = null;
    this.chord = [0.5, 0.5, 0.5];
    this.clarity = 0;
    this.palette = null;
    this.live = { world: 'nebula', since: 0, energy: 0, variant: 0, lastSwitchBar: -99 };
    this.override = null; // world id forced by the user
    this.fade = null;
    this.state = {
      a: 'nebula', b: null, mix: 0, variantA: 0, variantB: 0, pal: null, chord: [0.5, 0.5, 0.5], clarity: 0,
      seed: 0, feedback: { amount: 0.5, zoom: 1.003, rot: 0, hue: 0 }, post: {},
    };
  }

  setScore(score, title = '') {
    this.score = score;
    const seed = hashString(`${title}|${score.duration.toFixed(1)}`);
    const R = rng(seed);
    const g = score.global;
    const hasBeat = score.beatT.length > 8;
    const sections = score.sections.length ? score.sections : [{ start: 0, end: score.duration, label: 0, kind: 'verse', intensity: 0.5 }];
    // aggregate per label
    const labels = new Map();
    for (const s of sections) {
      const L = labels.get(s.label) || { label: s.label, n: 0, inten: 0, kinds: {}, first: s.start };
      L.n++;
      L.inten += s.intensity;
      L.kinds[s.kind] = (L.kinds[s.kind] || 0) + 1;
      labels.set(s.label, L);
    }
    const used = new Map();
    const worldFor = new Map();
    const order = [...labels.values()].sort((a, b) => a.first - b.first);
    // the most intense label gets first pick so the climax gets a showpiece
    const byEnergy = [...order].sort((a, b) => b.inten / b.n - a.inten / a.n);
    for (const L of byEnergy) {
      const kind = Object.entries(L.kinds).sort((a, b) => b[1] - a[1])[0][0];
      const ctx = { intensity: L.inten / L.n, kind, hasBeat, hasScore: true };
      let best = null, bestS = -1e9;
      for (const w of WORLDS) {
        const s = affinity(w, ctx) + R() * 0.3 - (used.get(w.id) || 0) * 0.9;
        if (s > bestS) {
          bestS = s;
          best = w.id;
        }
      }
      used.set(best, (used.get(best) || 0) + 1);
      worldFor.set(L.label, best);
    }
    const seen = new Map();
    const bar = (g.beatPeriod || 0.5) * (g.meter || 4);
    this.plan = sections.map((s, i) => {
      const occ = seen.get(s.label) || 0;
      seen.set(s.label, occ + 1);
      const labelIdx = order.findIndex((L) => L.label === s.label);
      const world = worldFor.get(s.label);
      const prev = i > 0 ? worldFor.get(sections[i - 1].label) : null;
      const fadeDur = hasBeat ? clamp(bar, 1.2, 4) : 3.5;
      return {
        start: s.start, end: s.end, label: s.label, kind: s.kind, intensity: s.intensity, world,
        variant: (labelIdx * 2 + occ) % 6, seed: ((seed % 997) / 997 + labelIdx * 0.137) % 1,
        transIn: i === 0 ? 'none' : s.kind === 'drop' ? 'cut' : prev === world ? 'none' : 'fade',
        fadeDur,
        palette: sectionPalette({
          keyIndex: g.keyIndex || 0, mode: g.mode, valence: g.valence, intensity: s.intensity,
          labelShift: ((labelIdx * GOLDEN) % 1.2) - 0.6, variant: labelIdx,
        }),
      };
    });
    this.planStarts = Float64Array.from(this.plan.map((p) => p.start));
    this.palette = this.plan[0].palette.map((c) => c.slice());
  }

  setLive() {
    this.score = null;
    this.plan = null;
    this.live = { world: this.live.world || 'nebula', since: 0, energy: 0, variant: 0, lastSwitchBar: -99 };
    if (!this.palette) this.palette = sectionPalette({ keyIndex: 9, mode: 'minor', intensity: 0.5 });
  }

  forceWorld(id) {
    this.override = id;
  }

  _currentPlan(frame) {
    const P = this.plan;
    const t = frame.t;
    const k = Math.max(0, upperBound(this.planStarts, t) - 1);
    const cur = P[k];
    const next = P[k + 1];
    let a = cur, b = null, mix = 0, mode = 'fade';
    if (cur.transIn === 'fade' && t - cur.start < cur.fadeDur / 2 && k > 0) {
      a = P[k - 1];
      b = cur;
      mix = 0.5 + (t - cur.start) / cur.fadeDur;
    } else if (next && next.transIn === 'fade' && next.start - t < next.fadeDur / 2) {
      b = next;
      mix = 0.5 - (next.start - t) / next.fadeDur;
    }
    if (b && a.world === b.world) {
      b = null;
      mix = 0;
    }
    return { cur, a, b, mix: clamp(mix, 0, 1), mode, k };
  }

  _improvise(frame, dt) {
    const L = this.live;
    L.energy += (frame.intensity - L.energy) * Math.min(1, dt / 6);
    const bar = frame.barIndex;
    const elapsedBars = bar - L.lastSwitchBar;
    const want = WORLDS.map((w) => ({ id: w.id, s: affinity(w, { intensity: L.energy, kind: null, hasBeat: frame.hasBeat, hasScore: false }) }))
      .sort((x, y) => y.s - x.s);
    const curScore = (want.find((w) => w.id === L.world) || { s: -9 }).s;
    const phraseEnd = frame.hasBeat ? (elapsedBars >= 16 && frame.beatInBar === 0 && frame.beatPhase < 0.2) : frame.t - L.since > 40;
    if (!this.fade && phraseEnd && (want[0].s - curScore > 0.25 || elapsedBars >= 32 || (!frame.hasBeat && frame.t - L.since > 60))) {
      const pick = want.find((w) => w.id !== L.world) || want[0];
      this.fade = { from: L.world, to: pick.id, t0: frame.t, dur: frame.hasBeat ? frame.beatPeriod * 4 : 3 };
      L.world = pick.id;
      L.lastSwitchBar = bar;
      L.since = frame.t;
      L.variant = (L.variant + 1) % 6;
    }
    let a = L.world, b = null, mix = 0;
    if (this.fade) {
      const p = (frame.t - this.fade.t0) / this.fade.dur;
      if (p >= 1 || p < 0) this.fade = null;
      else {
        a = this.fade.from;
        b = this.fade.to;
        mix = p;
      }
    }
    // palette follows the music's slowly-moving harmonic centre
    const hue = this.chordHue ?? 0;
    const keyGuess = Math.round((((hue - pitchHue(0)) / (Math.PI * 2)) * 12 + 120) % 12) * 7 % 12;
    const target = sectionPalette({ keyIndex: keyGuess, mode: 'minor', intensity: L.energy, variant: L.variant });
    return { a, b, mix, target, variant: L.variant, seed: (L.variant * 0.173) % 1 };
  }

  update(frame, dt) {
    const S = this.state;
    const set = this.settings;
    const trip = set.trip ?? 1;
    const calm = set.reduceFlashing ? 1 : 0;
    // chord colour (smoothed)
    const cc = chordColor(frame.chroma, 0.7);
    const k = Math.min(1, dt / 0.18);
    this.chord = this.chord.map((v, i) => v + (cc.rgb[i] - v) * k);
    this.clarity += (cc.clarity - this.clarity) * k;
    if (cc.clarity > 0.2) this.chordHue = cc.hue;

    let targetPal, variantA = 0, variantB = 0, seed = 0, sectionT = frame.sectionT;
    if (this.plan) {
      const p = this._currentPlan(frame);
      S.a = p.a.world;
      S.b = p.b ? p.b.world : null;
      S.mix = p.mix;
      variantA = p.a.variant;
      variantB = p.b ? p.b.variant : 0;
      seed = p.cur.seed;
      targetPal = p.b && p.mix > 0.5 ? p.b.palette : p.a.palette;
      S.planIndex = p.k;
    } else {
      const im = this._improvise(frame, dt);
      S.a = im.a;
      S.b = im.b;
      S.mix = im.mix;
      variantA = variantB = im.variant;
      seed = im.seed;
      targetPal = im.target;
    }
    if (this.override && WORLD_BY_ID[this.override]) {
      S.a = this.override;
      S.b = null;
      S.mix = 0;
    }
    // palette glide (fast on cuts, which are drops)
    const glide = frame.drop > 0.9 ? 1 : Math.min(1, dt / 1.2);
    if (!this.palette) this.palette = targetPal.map((c) => c.slice());
    this.palette = this.palette.map((c, i) => mixRGB(c, targetPal[i], glide));
    S.pal = this.palette;
    S.chord = this.chord;
    S.clarity = this.clarity;
    S.variantA = variantA;
    S.variantB = variantB;
    S.seed = seed;
    S.sectionT = sectionT;

    // feedback ("trails") — each world has its own appetite
    const wA = WORLD_BY_ID[S.a];
    const baseFb = wA ? wA.feedback : 0.4;
    S.feedback = {
      amount: clamp((baseFb + 0.25 * frame.build + 0.2 * frame.drop) * (0.55 + 0.45 * trip), 0, 0.93),
      zoom: 1.0 + (0.002 + 0.004 * frame.intensity + 0.025 * frame.build - 0.01 * frame.preDrop + 0.02 * frame.drop) * trip,
      rot: (0.0015 * Math.sin(frame.t * 0.11) + 0.004 * (frame.beatInBar % 2 ? 1 : -1) * frame.beatPulse) * trip,
      hue: (0.004 + 0.01 * frame.intensity) * trip,
    };

    // post
    let shock = [0.5, 0.5, 0], shockStrength = 0, flash = 0;
    if (this.score) {
      const sc = this.score;
      const di = upperBound(sc.dropT, frame.t) - 1;
      if (di >= 0) {
        const since = frame.t - sc.drops[di].t;
        if (since < 1.2) {
          shock = [0.5, 0.5, since * 1.6];
          shockStrength = (1 - since / 1.2) * sc.drops[di].strength * 1.2;
          flash = Math.max(flash, Math.exp(-since / 0.09) * sc.drops[di].strength);
        }
      }
      const mi = upperBound(sc.momentT, frame.t) - 1;
      if (mi >= 0) {
        const since = frame.t - sc.moments[mi].t;
        if (since < 0.8 && shockStrength < 0.3) {
          shock = [0.5, 0.5, since * 1.8];
          shockStrength = (1 - since / 0.8) * sc.moments[mi].s * 0.6;
        }
      }
    }
    flash *= calm ? 0.15 : 0.85;
    const fc = mixRGB(this.palette[3], [1, 1, 1], 0.6).map((v) => v * flash);
    const inhale = frame.preDrop;
    S.post = {
      bloomStrength: 0.06 + 0.05 * frame.loud + 0.08 * frame.drop + 0.04 * frame.beatPulse,
      threshold: 0.8,
      exposure: (0.95 + 0.25 * frame.intensity) * (1 - 0.45 * inhale * inhale) * (1 + 0.25 * frame.impact),
      ca: (0.25 * frame.hat + 0.9 * frame.impact + 1.2 * frame.drop + 0.4 * frame.build) * (calm ? 0.3 : 1) * trip,
      flash: fc,
      shock,
      shockStrength: shockStrength * (calm ? 0.4 : 1),
      saturation: 1.05 - 0.4 * frame.build + 0.15 * frame.drop,
      contrast: 1.02 + 0.08 * frame.intensity,
      vignette: 0.35 + 0.25 * frame.build,
      grain: 0.02 + 0.02 * frame.flat,
      letterbox: this.plan ? 0.18 * smoothstep(0, 1, frame.build) * (1 - frame.drop) : 0,
    };
    return S;
  }
}
