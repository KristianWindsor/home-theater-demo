// The Glass Orchard: the sound. Each instrument keeps its corner (harp front-left, kalimba front-right,
// bowed voice rear-right, organisms all around) so you can point at every part of the tree.
import { Pluck, Modal, Bowed, Vox, Pad, SubPulse, Bed, Layer, Drum, Air } from '../audio/instruments.js';
import { mtof } from '../core/timeline.js';
import { POS } from './score.js';

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  let seed = 7;
  const S = () => (seed = (seed * 1103515245 + 12345) >>> 0) % 100000 + 1;

  st.set('master', 1.05);
  st.set('space', [[0, 0.95], [M.growth, 0.8], [M.tension, 0.6], [M.drop, 1], [M.pass, 0.85], [M.outro, 1]]);
  st.set('t60A', 0.9);
  st.set('t60B', [[0, 5.5], [M.growth, 4.2], [M.tension, 3.2], [M.build, 3.6], [M.drop, 7], [M.pass, 4.6], [M.outro, 6]]);
  st.set('hfB', [[0, 0.5], [M.tension, 0.38], [M.drop, 0.6], [M.pass, 0.48]]);

  const at = (e, extra) => (e.spk ? { spk: e.spk, ...extra } : e.pos ? { ...e.pos, ...extra } : extra);
  const bowedString = (f, dur, vel, vib = 0.16) => new Layer([
    new Pad(sr, { freq: f, dur, vel, cutoff: Math.min(5200, f * 7), attack: Math.min(0.45, dur * 0.3), release: 0.9, detune: 4, vib }),
    new Bowed(sr, { freq: f, dur, vel: vel * 0.8, attack: Math.min(0.5, dur * 0.35), release: 1.2, partials: [[1, 1], [2, 0.35], [3, 0.12]], beat: 0.35, noise: 0.03, seed: S() }),
  ], [0.85, 0.6]);

  const I = {
    harp(e) {
      const f = mtof(e.n);
      if (e.harmonic) {
        st.play(e.t, () => new Layer([
          new Modal(sr, { freq: f, modes: 'tine', t60: 3.2, hard: 0.35, vel: e.vel, seed: S() }),
          new Pluck(sr, { freq: f, decay: 3, bright: 0.25, pick: 0.5, vel: e.vel * 0.6, seed: S() }),
        ], [0.7, 0.6]), { spk: POS.harp, rev: 0.55, gain: 0.9 });
        return;
      }
      st.note(e.t, Pluck, {
        freq: f, vel: e.vel, decay: e.arp ? 2.6 : e.drop ? 5 : 4, bright: e.arp ? 0.48 : 0.58, pick: 0.2, stiff: 0.04, seed: S(),
        dur: e.arp && e.sec !== 'bloom' ? e.dur * 1.8 : undefined, damp: 0.4,
      }, { spk: POS.harp, rev: e.drop ? 0.55 : 0.32, gain: e.arp ? 0.62 : 0.95 });
    },
    bowed(e) {
      st.play(e.t, () => bowedString(mtof(e.n), e.dur, e.vel, e.pad ? 0.08 : 0.16), { spk: POS.bowed, rev: 0.4, gain: e.pad ? 0.42 : 0.7 });
    },
    kalimba(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: 'kalimba', t60: 2.2, hard: 0.7, vel: e.vel, seed: S() }, { spk: POS.kalimba, rev: 0.35, gain: 1.1 });
    },
    lead(e) {
      const f = mtof(e.n);
      st.play(e.t, () => new Layer([
        bowedString(f, e.dur, e.vel, 0.18),
        new Modal(sr, { freq: f, modes: 'kalimba', t60: 2, hard: 0.6, vel: e.vel, seed: S() }),
        new Vox(sr, { freq: f, dur: e.dur, vowel: 'o', register: 'soprano', vel: e.vel * 0.6, attack: 0.12, release: 0.8, vib: 0.2, seed: S() }),
      ], [0.6, 0.55, 0.5]), { spk: e.spk, rev: 0.45, gain: e.last ? 0.9 : 0.75 });
    },
    bass(e) {
      const f = mtof(e.n);
      st.note(e.t, SubPulse, { freq: f, dur: Math.min(e.dur, 2.8), vel: e.vel * (e.soft ? 0.7 : 1), drop: 0.12, texture: 0.2, attack: e.soft ? 0.04 : 0.012, seed: S() },
        { spk: 'LFE', lfe: 1 });
      st.note(e.t, Pad, { freq: f * (f < 50 ? 2 : 1), dur: e.dur, vel: e.vel * 0.9, cutoff: 320, kind: 'organ', attack: 0.05, release: 1.0 },
        { az: 0, width: 110, rev: 0.25, gain: e.soft ? 0.3 : 0.48 });
    },
    chord() {},
    drone(e) {
      st.note(e.t, Pad, { freq: mtof(e.n), dur: e.dur, vel: e.vel, cutoff: 700, kind: 'organ', attack: 2.5, release: 3 }, { az: 0, width: 200, rev: 0.6, gain: 0.6 });
    },
    choir(e) {
      e.pad.forEach((n, k) => {
        const reg = n < 50 ? 'bass' : n < 57 ? 'tenor' : n < 63 ? 'alto' : 'soprano';
        for (let v = 0; v < 2; v++) {
          st.note(e.t, Vox, { freq: mtof(n), dur: e.dur, vowel: 'a', toVowel: 'o', register: reg, vel: e.vel, detune: v ? 7 : -6, attack: 0.5, release: 1.6, vib: 0.2, seed: S() },
            { az: -165 + ((k * 2 + v) * 330) / (e.pad.length * 2), dist: 1.6, rev: 0.6, gain: 0.3 });
        }
      });
    },
    strings(e) {
      e.pad.forEach((n, k) => st.note(e.t, Pad, { freq: mtof(n + 12), dur: e.dur, vel: e.vel, cutoff: 2400, attack: 0.9, release: 2, vib: 0.08 },
        { az: k % 2 ? -110 : 110, width: 120, rev: 0.5, gain: 0.34 }));
    },
    perc(e) {
      const pos = at(e, { rev: 0.38 });
      if (e.kind === 'bowl') st.note(e.t, Modal, { freq: mtof(71), modes: 'bowl', t60: 2.6, hard: 0.6, vel: e.vel, seed: S() }, { ...pos, gain: 0.85 });
      else if (e.kind === 'glass') st.note(e.t, Modal, { freq: mtof(88 + (S() % 3) * 2), modes: 'glass', t60: 0.9, hard: 0.9, vel: e.vel, click: 0.3, seed: S() }, { ...pos, gain: 0.8 });
      else st.note(e.t, Modal, { freq: mtof(69), modes: 'woodLow', t60: 0.18, hard: 0.8, vel: e.vel, click: 0.2, seed: S() }, { ...pos, gain: 1.1 });
    },
    kick(e) {
      st.note(e.t, Drum, { freq: 46, from: 105, decay: 0.55, vel: e.vel, click: 0.12, seed: S() }, { spk: 'C', rev: 0.15, lfe: 0.7, gain: 0.8 });
    },
    tick(e) {
      st.note(e.t, Modal, { freq: 6200, modes: 'metalTick', t60: 0.025, hard: 1, vel: e.vel, noise: 0.9, seed: S() }, at(e, { rev: 0.2, gain: 0.7 }));
    },
    glint(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: S() % 2 ? 'tine' : 'glass', t60: 1.4, hard: 0.7, vel: e.vel, seed: S() }, at(e, { rev: 0.55, gain: 0.7 }));
    },
    harmonic(e) {
      st.note(e.t, Bowed, { freq: mtof(e.n), dur: e.dur, vel: e.vel, attack: 2.5, release: 2, partials: [[1, 1], [2.32, 0.15]], beat: 0.25, noise: 0.01, seed: S() },
        { spk: 'C', rev: 0.7, gain: 0.55 });
      st.note(e.t, Air, { freq: mtof(e.n - 12), dur: e.dur, vel: 0.35, breath: 0.5, attack: 2, release: 1.5, vib: 0.05, seed: S() }, { az: 0, width: 60, rev: 0.7, gain: 0.35 });
    },
    inhale(e) {
      const dur = e.dur;
      st.note(e.t, Bed, { dur, color: 'white', type: 'bp', q: 1.1, cutoff: (t) => 600 * Math.pow(12, Math.min(1, t / dur)), gain: (t) => 0.32 * e.vel * Math.pow(Math.min(1, t / dur), 3), fade: 0.005, seed: S() },
        { az: 0, width: 300, rev: 0.25 });
    },
    pass(e) {
      // through the surface of the drop: a rush from the screen to behind you, a soft impact, a spray of light
      st.note(e.t, Bed, { dur: 2.4, color: 'pink', type: 'bp', q: 0.8, cutoff: (t) => 4000 * Math.exp(-t * 1.2) + 300, gain: (t) => 0.55 * Math.exp(-t * 1.6), fade: 0.003, seed: S() },
        { path: (t) => ({ az: Math.min(180, t * 260), dist: 0.6, width: 70 }), rev: 0.5 });
      st.note(e.t, Drum, { freq: 40, from: 85, decay: 1.6, vel: 0.85, click: 0.1, seed: S() }, { az: 0, width: 200, rev: 0.5, lfe: 1, gain: 0.8 });
      st.note(e.t, SubPulse, { freq: 41.2, dur: 4, vel: 0.9, drop: 0.3, texture: 0.4, seed: S() }, { spk: 'LFE', lfe: 1 });
      for (let i = 0; i < 28; i++) {
        const f = mtof([88, 90, 92, 95, 97, 100][i % 6]);
        st.note(e.t + 0.05 + i * 0.045 + (S() % 40) / 1000, Modal, { freq: f, modes: i % 2 ? 'glass' : 'tine', t60: 1.6, hard: 0.8, vel: 0.35 * Math.exp(-i / 14) + 0.06, seed: S() },
          { az: -180 + ((i * 137) % 360), dist: 1.3, rev: 0.6, gain: 0.7 });
      }
    },
  };
  for (const e of score.events) {
    const fn = I[e.inst];
    if (fn) fn(e);
  }
  // night air over the landscape
  st.note(0.3, Bed, { dur: 153, color: 'pink', type: 'bp', q: 0.5, cutoff: 1400, gain: (t) => 0.006 + 0.004 * Math.sin(t * 0.21), seed: S() }, { az: 0, width: 360, rev: 0 });
}
