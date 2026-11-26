// Beneath the Ice: the sound. Ice is all transients and dispersion: clicks that ring at high frequencies,
// "pew" chirps that slide down as the flexural wave spreads, booms from far across the lake.
import { Modal, Bed, Bubble, Chirp, Creak, Glide, Drum, SubPulse, Vox, Pad, Layer } from '../audio/instruments.js';
import { Wavetable } from '../audio/dsp.js';
import { mtof } from '../core/timeline.js';

const LISTEN_Z = 3.5;
const azOf = (x, z) => (Math.atan2(x, -(z - LISTEN_Z)) * 180) / Math.PI;
const distOf = (x, z) => Math.max(0.6, Math.hypot(x, z - LISTEN_Z) / 6);

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  let seed = 3;
  const S = () => (seed = (seed * 1103515245 + 12345) >>> 0) % 100000 + 1;
  st.set('master', 0.95);
  st.set('space', [[0, 0.75], [M.creature, 0.9], [M.call, 1]]);
  st.set('t60A', 1.2);
  st.set('t60B', [[0, 4.5], [M.crack, 5.5], [M.call, 7.5], [M.reveal, 6]]);
  st.set('hfB', [[0, 0.5], [M.creature, 0.3], [M.call, 0.28], [M.reveal, 0.4]]);
  st.set('revB', [[0, 1], [M.stop - 0.5, 1], [M.stop + 0.5, 0.25], [M.call - 0.1, 0.25], [M.call, 1]]);

  // ---------------------------------------------------------------- beds: wind over the ice, the water below
  st.note(0.2, Bed, { dur: M.stop - 0.2, color: 'pink', type: 'bp', q: 0.6, cutoff: (t) => 700 + 300 * Math.sin(t * 0.13), fade: 3,
    gain: (t) => (0.08 + 0.04 * Math.sin(t * 0.31) * Math.sin(t * 0.07)) * Math.min(1, t / 4) * (t > M.creature ? Math.max(0.3, 1 - (t - M.creature) / 12) : 1), seed: S() },
  { az: 0, width: 360, rev: 0.1 });
  st.note(0.5, Bed, { dur: M.stop - 0.5, color: 'brown', type: 'lp', q: 0.7, cutoff: 160, gain: (t) => 0.1 * Math.min(1, t / 6), fade: 2, seed: S() },
    { az: 0, width: 360, rev: 0.2, lfe: 0.3 });

  const I = {
    crackle(e) {
      const az = azOf(e.x, e.z), dist = distOf(e.x, e.z);
      st.note(e.t, Modal, { freq: e.f, modes: 'plate', t60: 0.05 + (S() % 50) / 1000, hard: 1, vel: e.vel, noise: 0.8, click: 0.6, seed: S() },
        { az, dist, rev: 0.25, gain: 1.25 });
      if (S() % 3 === 0) st.note(e.t + 0.004, Chirp, { from: e.f * 1.4, to: e.f * 0.35, dur: 0.05 + (S() % 60) / 1000, vel: e.vel * 0.5, seed: S() }, { az, dist, rev: 0.3, gain: 0.5 });
    },
    bubble(e) {
      st.note(e.t, Bubble, { freq: e.f, tau: 0.006 + 2.2 / e.f, rise: 0.9, vel: e.vel }, { az: azOf(e.x, e.z) * 0.6, dist: 1.1, rev: 0.3, gain: 0.8 });
    },
    sing(e) {
      // a long dispersive chirp that travels across the room, with its echoes from the far shore
      const dur = e.fast ? 0.35 : 0.6;
      for (let k = 0; k < 3; k++) {
        const t = e.t + k * (e.fast ? 0.11 : 0.19);
        const a = e.a0 + (e.a1 - e.a0) * (k / 2);
        st.note(t, Chirp, { from: 5200 - k * 600, to: 180 + k * 40, dur: dur + k * 0.08, curve: 2.6, vel: e.vel * Math.pow(0.55, k), seed: S() },
          { path: (x) => ({ az: a + (e.a1 - e.a0) * 0.25 * Math.min(1, x / dur), dist: e.dist }), rev: 0.55, gain: 0.95 });
      }
    },
    boom(e) {
      st.note(e.t, Drum, { freq: 34, from: 62, decay: 2.8, vel: e.vel, click: 0.05, noise: 0.25, noiseFreq: 140, noiseDecay: 1.2, seed: S() },
        { az: e.az, dist: 3.5, rev: 0.7, lfe: 1.1, gain: 0.9 });
    },
    groan(e) {
      st.note(e.t, Creak, { dur: e.dur, rate: [[0, 9], [0.4, 22], [0.8, 14], [1, 6]], body: 165, q: 7, vel: e.vel * 0.5, jitter: 0.3, seed: S() },
        { az: e.az, dist: 2.2, rev: 0.6, lfe: 0.4, gain: 0.9 });
      st.note(e.t, Glide, { dur: e.dur, f: [[0, 70], [e.dur * 0.6, 92], [e.dur, 64]], a: [[0, 0], [e.dur * 0.3, 1], [e.dur, 0]], spectrum: [1, 0.6, 0.4, 0.25, 0.15], vel: e.vel * 0.6, seed: S() },
        { az: e.az, dist: 2.2, rev: 0.5, lfe: 0.6, gain: 0.8 });
    },
    fracture(e) {
      // the snap: right at the front-right speaker, then the run under you (crackHead events) and a sub hit
      st.note(e.t, Modal, { freq: 2600, modes: 'plate', t60: 0.6, hard: 1, vel: 1, noise: 1, click: 1, seed: S() }, { spk: 'FR', rev: 0.35, gain: 1.4 });
      st.note(e.t, Bed, { dur: 0.35, color: 'white', type: 'hp', q: 0.7, cutoff: 1800, gain: (t) => 0.9 * Math.exp(-t * 14), fade: 0.002, seed: S() }, { spk: 'FR', rev: 0.3 });
      st.note(e.t, Drum, { freq: 30, from: 80, decay: 2.2, vel: 1, click: 0.2, seed: S() }, { az: 30, width: 120, rev: 0.4, lfe: 1.3, gain: 1.0 });
      st.note(e.t + 0.02, Chirp, { from: 7000, to: 250, dur: 0.9, curve: 2.2, vel: 0.9, seed: S() }, { path: (x) => ({ az: 60 - 180 * Math.min(1, x / 0.9), dist: Math.abs(1 - x * 2.2) + 0.2, width: 30 }), rev: 0.45, gain: 1 });
    },
    crackHead(e) {
      st.note(e.t, Modal, { freq: 1800 + (S() % 1500), modes: 'plate', t60: 0.25, hard: 1, vel: e.vel, noise: 0.9, click: 0.8, seed: S() }, { az: e.az, dist: e.dist, rev: 0.3, gain: 1.1 });
      st.note(e.t, Chirp, { from: 6500, to: 300, dur: 0.4, curve: 2.4, vel: e.vel * 0.6, seed: S() }, { az: e.az, dist: e.dist, rev: 0.45, gain: 0.8 });
    },
    creature(e) {
      const dur = e.dur;
      const peak = M.under - e.t;
      // size: a sub swell that peaks as it passes directly under the couch
      st.note(e.t, Bed, { dur, color: 'brown', type: 'lp', q: 0.9, cutoff: (t) => 55 + 40 * Math.exp(-((t - peak) ** 2) / 30), steep: true,
        gain: (t) => 1.6 * Math.exp(-((t - peak) ** 2) / 26), fade: 1.5, seed: S() }, { spk: 'LFE', lfe: 1 });
      st.note(e.t + 2, Glide, { dur: dur - 3, f: [[0, 31], [peak - 2, 27], [dur - 3, 24]], a: [[0, 0], [peak - 2, 1, 'inOut'], [dur - 3, 0, 'inOut']],
        spectrum: [1, 0.5, 0.3, 0.2, 0.12, 0.08], vel: 0.9, seed: S() }, { az: 0, width: 360, dist: 0.5, rev: 0.2, lfe: 0.9, gain: 0.6 });
      // the water it pushes: front speakers first, then over and behind you
      const wash = (delay, width, gain, side) => st.note(e.t + delay, Bed, {
        dur: dur - delay, color: 'pink', type: 'bp', q: 0.7, cutoff: (t) => 260 + 700 * Math.exp(-((t - peak + delay) ** 2) / 18),
        gain: (t) => gain * Math.exp(-((t - peak + delay) ** 2) / 22), fade: 1, seed: S(),
      }, { path: (t) => { const x = (t - (peak - delay)) / 7; return { az: side + (x < 0 ? 0 : 180 * Math.min(1, x)) * (side < 0 ? -1 : 1), dist: 0.35 + Math.min(1.2, Math.abs(x)), width }; }, rev: 0.35 });
      wash(0, 120, 0.42, 0);
      wash(0.6, 60, 0.24, -40);
      wash(1.1, 60, 0.24, 40);
      // a murmur from inside it
      st.note(M.under - 3, Glide, { dur: 6, f: [[0, 62], [3, 55], [6, 50]], a: [[0, 0], [2, 1], [6, 0]], spectrum: [1, 0.8, 0.55, 0.3, 0.2, 0.1], formant: 420, vel: 0.5, seed: S() },
        { az: 0, dist: 0.6, width: 200, rev: 0.6, lfe: 0.4, gain: 0.6 });
    },
    call(e) {
      const p = e.pitch || 1;
      const table = new Wavetable([1, 0.55, 0.32, 0.2, 0.12, 0.08, 0.05], 2048);
      if (e.kind === 'long') {
        const f = [[0, 140], [1.2, 210], [3.2, 390], [4.6, 360], [5.8, 255], [8.5, 180], [10.5, 120]];
        st.note(e.t, Glide, { dur: 10.5, f, a: [[0, 0], [0.8, 0.7], [3.2, 1], [5.5, 0.85], [8.5, 0.7], [10.5, 0, 'in']], table, vib: 0.18, vibRate: 3.2, formant: 720, formantQ: 2.5, formantMix: 0.5, vel: e.vel, breath: 0.004, seed: S() },
          { az: e.az, dist: e.dist, width: 40, rev: 0.75, gain: 0.2 });
        st.note(e.t, Glide, { dur: 10.5, f: f.map(([t, hz]) => [t, hz / 2]), a: [[0, 0], [1.5, 0.6], [5, 0.8], [10.5, 0]], spectrum: [1, 0.3], vel: e.vel * 0.7, seed: S() },
          { az: 0, width: 360, dist: 0.8, rev: 0.4, lfe: 0.8, gain: 0.25 });
        return;
      }
      const base = 260 * p;
      const f = [[0, base], [0.35, base * 2.1], [0.9, base * 1.6], [1.6, base * 2.4], [2.4, base * 1.2]];
      st.note(e.t, Glide, { dur: 2.4, f, a: [[0, 0], [0.2, 1], [1.8, 0.6], [2.4, 0]], table, vib: 0.25, vibRate: 5, formant: 1100, formantQ: 2, vel: e.vel, seed: S() },
        { az: e.az, dist: e.dist, rev: 0.7, gain: 0.24 });
    },
    chord(e) {
      e.pad.forEach((n, k) => {
        const reg = n < 50 ? 'bass' : n < 57 ? 'tenor' : n < 63 ? 'alto' : 'soprano';
        for (let v = 0; v < 2; v++) {
          st.note(e.t, Vox, { freq: mtof(n), dur: e.dur, vowel: 'o', toVowel: e.last ? 'a' : 'o', register: reg, vel: e.vel, detune: v ? 6 : -6, attack: 2.2, release: 3, vib: 0.18, seed: S() },
            { az: -170 + ((k * 2 + v) * 340) / (e.pad.length * 2), dist: 1.7, rev: 0.7, gain: 0.2 });
        }
        st.note(e.t, Pad, { freq: mtof(n), dur: e.dur, vel: e.vel, cutoff: 1500, attack: 2.4, release: 3.5, vib: 0.06 }, { az: (k * 70) - 170, width: 120, rev: 0.6, gain: 0.17 });
      });
      st.note(e.t, SubPulse, { freq: mtof(e.pad[0] - 12), dur: e.dur * 0.9, vel: 0.55, attack: 1.2, drop: 0, texture: 0.15, seed: S() }, { spk: 'LFE', lfe: 1 });
    },
    song(e) {
      const f0 = mtof(e.n);
      const table = new Wavetable([1, 0.5, 0.3, 0.18, 0.1, 0.06], 2048);
      st.note(e.t, Glide, { dur: e.dur, f: [[0, f0 * 0.8], [0.35, f0], [e.dur * 0.7, f0 * 1.02], [e.dur, f0 * 0.75]], a: [[0, 0], [0.4, 1], [e.dur * 0.75, 0.8], [e.dur, 0]],
        table, vib: 0.22, vibRate: 3.6, formant: 800, formantQ: 2.4, vel: e.vel, seed: S() }, { az: e.az, dist: 2.2, rev: 0.75, gain: 0.24 });
    },
    glow(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: S() % 2 ? 'glass' : 'tine', t60: 2.2, hard: 0.55, vel: e.vel, seed: S() }, { az: e.az, dist: e.dist, rev: 0.7, gain: 0.42 });
    },
  };
  for (const e of score.events) {
    const fn = I[e.inst];
    if (fn) fn(e);
  }
  void Layer;
}
