// A Marble, Eventually: the sound. A rolling marble is a stream of tiny impacts ringing the track it rolls on;
// every mechanism is a struck or plucked resonator; the loops they start add up to the groove.
import { Pluck, Modal, Bowed, Air, Vox, Pad, SubPulse, Bed, Drum, Glide, Layer } from '../audio/instruments.js';
import { Noise, Biquad, OnePole, Wavetable } from '../audio/dsp.js';
import { mtof, Curve } from '../core/timeline.js';

/** A marble rolling: micro-impacts at a rate that follows its speed, ringing the track's resonances. */
class Roll {
  constructor(sr, o) {
    this.sr = sr;
    this.dur = o.dur;
    this.n = new Noise(o.seed || 5);
    const f = o.mat === 'metal' ? [2300, 3900, 6100] : [520, 980, 1850];
    const q = o.mat === 'metal' ? 22 : 7;
    this.res = f.map((x) => new Biquad('bandpass', x, q, sr));
    this.mix = o.mat === 'metal' ? [1, 0.7, 0.45] : [1, 0.6, 0.35];
    this.rum = new OnePole(o.mat === 'metal' ? 260 : 180, sr);
    this.rum2 = new OnePole(o.mat === 'metal' ? 260 : 180, sr);
    this.speed = o.crawl ? new Curve([[0, 0.5], [o.dur, 0.05, 'out']]) : o.slow ? new Curve([[0, 0.9], [o.dur, 0.45, 'inOut']]) : new Curve([[0, 0.7], [Math.min(1, o.dur * 0.3), 1], [o.dur, 1]]);
    this.vel = (o.vel ?? 0.6) * (o.mat === 'metal' ? 0.5 : 0.9);
    this.fadeOut = o.fade ? o.dur * 0.6 : 0.12;
    this.next = 0;
    this.i = 0;
    this.max = Math.round((o.dur + 0.2) * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const t = i / sr;
      const sp = this.speed.at(Math.min(t, this.dur));
      let x = 0;
      if (t < this.dur && i >= this.next) {
        this.next = i + sr / (25 + 110 * sp) * (0.5 + this.n.white() * 0.5 + 0.5);
        x = (0.4 + 0.6 * Math.abs(this.n.white())) * sp;
      }
      const w = this.n.white() * 0.03 * sp;
      let s = 0;
      for (let m = 0; m < 3; m++) s += this.res[m].tick(x + w) * this.mix[m];
      const r = this.rum2.lp(this.rum.lp(this.n.white())) * 3 * sp;
      const env = Math.min(1, t / 0.04) * (t > this.dur - this.fadeOut ? Math.max(0, (this.dur - t) / this.fadeOut) : 1);
      out[i0 + k] = (s * 4 + r) * env * this.vel;
    }
    return this.i < this.max;
  }
}

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  let seed = 21;
  const S = () => (seed = (seed * 1103515245 + 12345) >>> 0) % 100000 + 1;
  st.set('master', 0.9);
  st.set('space', [[0, 0.3], [M.spiral, 0.45], [M.wake, 0.8], [M.chord, 1], [M.dispense, 0.6]]);
  st.set('t60A', 1.1);
  st.set('t60B', [[0, 3], [M.chord, 6.5], [M.dispense, 4]]);
  // a big room's air
  st.note(0.2, Bed, { dur: 111, color: 'pink', type: 'lp', q: 0.5, cutoff: 700, gain: (t) => 0.006 + 0.004 * Math.sin(t * 0.2), seed: S() }, { az: 0, width: 360, rev: 0 });

  const pathOf = (pts) => {
    const c = new Curve(pts.map(([t, az, d]) => [t, [az, d]]));
    return (t) => {
      const [az, dist] = c.at(t);
      return { az, dist, width: 15 };
    };
  };
  const brass = new Wavetable([1, 0.8, 0.6, 0.45, 0.32, 0.22, 0.15, 0.1, 0.07], 2048);

  const I = {
    release(e) {
      st.note(e.t, Modal, { freq: 1400, modes: 'metalTick', t60: 0.05, hard: 1, vel: 0.6, strikes: [[0, 1], [0.03, 0.6]], seed: S() }, { az: -20, dist: 1.2, rev: 0.2, gain: 1.1 });
      st.note(e.t + 0.05, Modal, { freq: 300, modes: 'woodLow', t60: 0.12, hard: 0.7, vel: 0.6, seed: S() }, { az: -20, dist: 1.2, rev: 0.2 });
    },
    roll(e) {
      st.play(e.t, () => new Roll(sr, { dur: e.dur, mat: e.mat, crawl: e.crawl, slow: e.slow, fade: e.fade, vel: 0.7, seed: S() }), { path: pathOf(e.path), rev: 0.25, gain: 1.4 });
    },
    joint(e) {
      st.note(e.t, Modal, { freq: 2600, modes: 'metalTick', t60: 0.04, hard: 1, vel: e.vel, seed: S() }, { az: e.az, dist: 1.2, rev: 0.25, gain: 0.9 });
    },
    plate(e) {
      st.note(e.t, Modal, { freq: 180, modes: 'plate', t60: 3.2, hard: 0.9, vel: e.vel, noise: 0.4, click: 0.5, seed: S() }, { az: e.az, dist: 1.1, rev: 0.35, gain: 1.1 });
      st.note(e.t, Modal, { freq: 1240, modes: 'bell', t60: 2.4, hard: 0.8, vel: 0.5, seed: S() }, { az: e.az, dist: 1.1, rev: 0.4, gain: 0.8 });
    },
    step(e) {
      st.note(e.t, Modal, { freq: mtof(e.n + 12), modes: 'wood', t60: 0.35, hard: 0.8, vel: e.vel, seed: S() }, { az: e.az, dist: 1.1, rev: 0.3, gain: 1.2 });
    },
    catch(e) {
      if (e.wake) {
        const f = { ratchet: 3200, latch: 900, gear: 1700, spring: 520 }[e.kind];
        st.note(e.t, Modal, { freq: f * (0.8 + (S() % 40) / 100), modes: e.kind === 'spring' ? 'chime' : 'metalTick', t60: e.kind === 'spring' ? 0.9 : 0.08, hard: 1, vel: e.vel,
          strikes: e.kind === 'ratchet' ? [[0, 1], [0.04, 0.7], [0.08, 0.5], [0.12, 0.35]] : [[0, 1]], seed: S() }, { az: e.az, dist: 1.3 + (S() % 100) / 80, rev: 0.45, gain: 0.85 });
        return;
      }
      st.note(e.t, Modal, { freq: 700, modes: 'woodLow', t60: 0.2, hard: 0.8, vel: e.vel, seed: S() }, { az: e.az, dist: 1.1, rev: 0.3 });
    },
    tick(e) {
      st.note(e.t, Modal, { freq: e.spk === 'FL' ? 1050 : 1320, modes: 'wood', t60: 0.07, hard: 0.9, vel: e.vel, click: 0.3, seed: S() }, { spk: e.spk, rev: 0.12, gain: 1.15 });
    },
    xylo(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: 'marimba', t60: 0.9, hard: 0.75, vel: e.vel, seed: S() }, { az: e.az, dist: 1.05, rev: 0.25, gain: 1.15 });
    },
    bass(e) {
      st.note(e.t, Pluck, { freq: mtof(e.n), vel: e.vel, decay: 1.6, bright: 0.42, pick: 0.25, stiff: 0.02, dur: 0.5, damp: 0.12, seed: S() }, { az: 10, width: 40, rev: 0.15, lfe: 0.35, gain: 1.2 });
    },
    pluckBy(e) {
      st.note(e.t, Pluck, { freq: mtof([45, 52, 57, 64][e.k]), vel: e.vel, decay: 2.2, bright: 0.55, pick: 0.2, seed: S() }, { az: 18 - e.k * 6, dist: 1.05, rev: 0.25, gain: 1.1 });
    },
    kick(e) {
      st.note(e.t, Drum, { freq: 48, from: 120, decay: 0.45, vel: e.vel, click: 0.25, seed: S() }, { spk: 'C', rev: 0.1, lfe: 1.5, gain: 0.8 });
    },
    boom(e) {
      st.note(e.t, Drum, { freq: 42, from: 95, decay: 1.4, vel: e.vel, click: 0.3, noise: 0.15, noiseFreq: 220, seed: S() }, { az: 0, width: 60, rev: 0.45, lfe: 1.1, gain: 1.0 });
    },
    disc(e) {
      st.note(e.t, Bowed, { freq: mtof(e.n), dur: e.dur, vel: e.vel, attack: 0.25, release: 0.9, beat: 1.8, noise: 0.03, seed: S() }, { az: 40, width: 40, dist: 1.1, rev: 0.4, gain: 0.6 });
    },
    chime(e) {
      [84, 88, 91, 96].forEach((n, k) => st.note(e.t + k * 0.08, Modal, { freq: mtof(n), modes: 'glass', t60: 1.8, hard: 0.7, vel: e.vel * (1 - k * 0.15), seed: S() }, { az: 40, dist: 1.1, rev: 0.4, gain: 0.9 }));
    },
    air(e) {
      st.note(e.t, Bed, { dur: 0.09, color: 'white', type: 'hp', q: 0.7, cutoff: 5200, gain: (t) => 0.5 * e.vel * Math.exp(-t * 45), fade: 0.002, seed: S() }, { az: e.az, dist: 1.15, rev: 0.15 });
    },
    clack(e) {
      st.note(e.t, Modal, { freq: 760, modes: 'woodLow', t60: 0.12, hard: 1, vel: e.vel, noise: 0.9, click: 0.6, seed: S() }, { az: 0, width: 50, rev: 0.25, gain: 1.0 });
      st.note(e.t, Bed, { dur: 0.12, color: 'white', type: 'bp', q: 0.8, cutoff: 2400, gain: (t) => 0.35 * e.vel * Math.exp(-t * 30), fade: 0.002, seed: S() }, { az: 0, width: 60, rev: 0.25 });
    },
    lead(e) {
      st.note(e.t, Glide, { dur: e.dur + 0.15, f: [[0, mtof(e.n) * 0.985], [0.07, mtof(e.n)], [e.dur + 0.15, mtof(e.n)]], a: [[0, 0], [0.06, 1], [e.dur, 0.75], [e.dur + 0.15, 0]],
        table: brass, vib: 0.12, vibRate: 5.5, formant: 1300, formantQ: 1.4, formantMix: 0.5, vel: e.vel, seed: S() }, { spk: 'C', rev: 0.3, gain: 0.75 });
    },
    whirl(e) {
      // the funnel sits front-right of centre; the swirl sweeps across it, tighter and faster as it drains
      const sw = (t) => {
        const x = Math.min(1, Math.max(0, t / e.dur));
        return { az: 22 + 34 * (1 - x) * Math.sin(Math.PI * 4 * Math.pow(x, 0.8)), dist: 1.1 - 0.15 * x, width: 20 };
      };
      st.note(e.t, Bed, { dur: e.dur, color: 'pink', type: 'bp', q: 3, cutoff: (t) => 400 * Math.pow(6, t / e.dur), gain: (t) => 0.25 * e.vel * Math.sin(Math.PI * Math.min(1, t / e.dur)), seed: S() },
        { path: sw, rev: 0.3 });
      st.play(e.t, () => new Roll(sr, { dur: e.dur, mat: 'metal', vel: 0.6, seed: S() }), { path: sw, rev: 0.25, gain: 1.2 });
    },
    shoot(e) {
      st.note(e.t, Bed, { dur: 0.25, color: 'white', type: 'hp', q: 0.7, cutoff: 1500, gain: (t) => 0.8 * Math.exp(-t * 18), fade: 0.002, seed: S() }, { az: 40, dist: 1.0, rev: 0.25 });
      st.note(e.t + 0.05, Bed, { dur: e.dur, color: 'pink', type: 'bp', q: 1.2, cutoff: (t) => 1800 - 900 * (t / e.dur), gain: (t) => 0.35 * Math.sin(Math.PI * Math.min(1, t / e.dur)), seed: S() },
        { path: (t) => { const x = t / e.dur; return { az: 40 + 140 * x, dist: Math.abs(x - 0.5) * 2 + 0.2, width: 40 }; }, rev: 0.3 });
    },
    button(e) {
      st.note(e.t, Modal, { freq: 2400, modes: 'metalTick', t60: 0.03, hard: 1, vel: 0.9, strikes: [[0, 1], [0.012, 0.6]], seed: S() }, { az: e.az, dist: 0.9, rev: 0.1, gain: 1.3 });
    },
    riser(e) {
      const d = e.dur;
      st.note(e.t, Bed, { dur: d, color: 'white', type: 'bp', q: 1.4, cutoff: (t) => 300 * Math.pow(25, t / d), gain: (t) => 0.22 * Math.pow(t / d, 2.2), fade: 0.01, seed: S() }, { az: 0, width: 360, rev: 0.4 });
      st.note(e.t, Bed, { dur: d, color: 'brown', type: 'lp', q: 0.8, cutoff: (t) => 50 + 50 * (t / d), gain: (t) => 1.4 * Math.pow(t / d, 1.8), fade: 0.01, seed: S() }, { spk: 'LFE', lfe: 1 });
      [33, 40, 45, 52, 57].forEach((n, k) => st.note(e.t + k * 0.6, Glide, { dur: d - k * 0.6, f: [[0, mtof(n) * 0.5], [d - k * 0.6, mtof(n)]], a: [[0, 0], [d - k * 0.6, 1, 'in']], table: brass, vel: 0.35, seed: S() },
        { az: -150 + k * 75, dist: 1.4, width: 60, rev: 0.5, gain: 0.45 }));
    },
    chord(e) {
      // one magnificent chord: A major (add 9), everything in the room at once
      const pad = [33, 45, 52, 57, 61, 64, 71, 73, 76, 81];
      pad.forEach((n, k) => {
        if (n >= 45) {
          for (let v = 0; v < 2; v++) {
            const reg = n < 50 ? 'bass' : n < 57 ? 'tenor' : n < 64 ? 'alto' : 'soprano';
            st.note(e.t, Vox, { freq: mtof(n), dur: 9, vowel: 'a', toVowel: 'o', register: reg, vel: 0.6, detune: v ? 6 : -6, attack: 0.12, release: 5, vib: 0.2, seed: S() },
              { az: -170 + ((k * 2 + v) * 340) / 20, dist: 1.5, rev: 0.6, gain: 0.46 });
          }
          st.note(e.t, Glide, { dur: 10, f: [[0, mtof(n)], [10, mtof(n)]], a: [[0, 0], [0.05, 1], [3, 0.7], [10, 0]], table: brass, vib: 0.06, vel: 0.5, seed: S() },
            { az: (k * 37) % 360 - 180, width: 70, rev: 0.5, gain: 0.4 });
        }
        st.note(e.t, Pad, { freq: mtof(n), dur: 11, vel: 0.55, cutoff: 3000, toCutoff: 900, kind: n < 50 ? 'organ' : 'saw', attack: 0.04, release: 5 }, { az: (k * 73) % 360 - 180, width: 120, rev: 0.6, gain: 0.4 });
      });
      st.note(e.t, SubPulse, { freq: 55, dur: 9, vel: 1, drop: 0.25, texture: 0.4, seed: S() }, { spk: 'LFE', lfe: 1.6 });
      st.note(e.t, SubPulse, { freq: 27.5, dur: 7, vel: 0.8, drop: 0.1, texture: 0.3, attack: 0.03, seed: S() }, { spk: 'LFE', lfe: 1.2 });
      st.note(e.t, Drum, { freq: 55, from: 110, decay: 3, vel: 1, click: 0.3, noise: 0.2, noiseFreq: 200, seed: S() }, { az: 0, width: 140, rev: 0.6, lfe: 0.9, gain: 0.95 });
      [69, 76, 81, 85, 88, 93].forEach((n, k) => st.note(e.t + k * 0.04, Modal, { freq: mtof(n), modes: 'bell', t60: 8, hard: 0.6, vel: 0.5, seed: S() }, { az: -150 + k * 60, dist: 1.6, rev: 0.7, gain: 0.55 }));
    },
    plink(e) {
      st.note(e.t, Modal, { freq: mtof(93), modes: 'glass', t60: 2.5, hard: 0.8, vel: e.vel, seed: S() }, { az: 60, dist: 2.2, rev: 0.6, gain: 0.8 });
    },
    hatch(e) {
      st.note(e.t, Modal, { freq: 420, modes: 'plate', t60: 0.4, hard: 0.8, vel: e.vel, seed: S() }, { az: -20, dist: 1.3, rev: 0.4, gain: 0.8 });
      st.note(e.t + 0.25, Modal, { freq: 1600, modes: 'metalTick', t60: 0.05, hard: 1, vel: 0.5, strikes: [[0, 1], [0.04, 0.5], [0.09, 0.3]], seed: S() }, { az: -20, dist: 1.3, rev: 0.3 });
    },
  };
  for (const e of score.events) {
    const fn = I[e.inst];
    if (fn) fn(e);
  }
  void Air;
  void Layer;
}
