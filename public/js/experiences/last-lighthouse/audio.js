// The Last Lighthouse: the sound. The sea wraps around the seats (every speaker has its own waves, rolling
// around the room); the lighthouse speaks from the center; the answers come from wherever their lights are.
import { Modal, Bed, Bowed, Air, Vox, Pad, Glide, Creak, SubPulse, Layer } from '../audio/instruments.js';
import { Wavetable } from '../audio/dsp.js';
import { mtof } from '../core/timeline.js';

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  let seed = 11;
  const S = () => (seed = (seed * 1103515245 + 12345) >>> 0) % 100000 + 1;
  st.set('master', 0.95);
  st.set('space', 1);
  st.set('t60B', [[0, 5.5], [M.lift, 6.5], [M.choir, 7.5], [M.last, 6]]);
  st.set('hfB', 0.45);

  // ---------------------------------------------------------------- the sea, around the seats
  const ring = [-60, 60, 120, -120, 0];
  ring.forEach((az, k) => {
    const period = 7.2 + k * 0.9;
    const phase = k * 1.7;
    const wave = (t) => {
      const x = ((t + phase) % period) / period;
      return Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 2) * (0.7 + 0.3 * Math.sin(t * 0.05 + k));
    };
    const calm = (t) => (t > M.lift && t < M.after ? 0.75 : 1) * Math.min(1, t / 3) * (1 - Math.max(0, (t - 128) / 4));
    st.note(0, Bed, { dur: 132, color: 'pink', type: 'lp', q: 0.6, cutoff: (t) => 280 + 2200 * wave(t), gain: (t) => (0.03 + 0.11 * wave(t)) * calm(t), fade: 2, seed: S() },
      { az, dist: 1.4, width: 50, rev: 0.12 });
    st.note(0, Bed, { dur: 132, color: 'white', type: 'hp', q: 0.6, cutoff: 3500, gain: (t) => 0.025 * Math.pow(wave(t), 3) * calm(t), fade: 2, seed: S() },
      { az, dist: 1.4, width: 40, rev: 0.1 });
  });
  st.note(0, Bed, { dur: 132, color: 'brown', type: 'lp', q: 0.7, cutoff: 90, gain: (t) => 0.22 * Math.min(1, t / 4), fade: 3, seed: S() }, { spk: 'LFE', lfe: 1 });
  st.note(0, Bed, { dur: 132, color: 'pink', type: 'bp', q: 0.8, cutoff: (t) => 600 + 400 * Math.sin(t * 0.09), gain: (t) => 0.035 + 0.02 * Math.sin(t * 0.21), fade: 4, seed: S() },
    { az: 0, width: 360, rev: 0.2 });

  const brass = new Wavetable([1, 0.75, 0.55, 0.4, 0.3, 0.2, 0.14, 0.1, 0.07, 0.05], 2048);
  const I = {
    creak(e) {
      st.note(e.t, Creak, { dur: 1.6, rate: [[0, 12], [0.5, 30], [1, 8]], body: 380, q: 10, vel: e.vel * 0.25, seed: S() }, { az: -8, dist: 3.2, rev: 0.4, gain: 0.9 });
      st.note(e.t + 1.5, Modal, { freq: 900, modes: 'metalTick', t60: 0.06, hard: 0.9, vel: e.vel * 0.4, strikes: [[0, 1], [0.05, 0.5]], seed: S() }, { az: -8, dist: 3.2, rev: 0.4 });
    },
    signal(e) {
      // a glass horn: warm, a little lonely, unmistakably from the lighthouse
      const f = mtof(e.n);
      st.play(e.t, () => new Layer([
        new Pad(sr, { freq: f, dur: e.dur, vel: e.vel, cutoff: 1400, kind: 'organ', attack: 0.06, release: 1.6, detune: 5, vib: 0.06 }),
        new Bowed(sr, { freq: f, dur: e.dur, vel: e.vel, attack: 0.08, release: 2.2, partials: [[1, 1], [2, 0.4], [3, 0.2], [4.02, 0.08]], beat: 0.4, noise: 0.02, seed: S() }),
        new Modal(sr, { freq: f * 2, modes: 'bell', t60: 3, hard: 0.5, vel: e.vel * 0.5, seed: S() }),
      ], [0.6, 0.7, 0.35]), { spk: 'C', rev: 0.45, gain: 0.8 });
    },
    answer(e) {
      const v = score.voices[e.voice] || { az: e.az ?? -40, dist: e.dist ?? 1.4, kind: 'soprano' };
      const az = e.az ?? v.az, dist = e.dist ?? v.dist;
      const f = mtof(e.n);
      const place = { az, dist, rev: e.close ? 0.35 : 0.6, gain: e.close ? 0.55 : 0.42 };
      switch (v.kind) {
        case 'horn':
          st.note(e.t, Glide, { dur: e.dur + 0.5, f: [[0, f * 0.97], [0.12, f], [e.dur + 0.5, f]], a: [[0, 0], [0.12, 1], [e.dur, 0.8], [e.dur + 0.5, 0]], table: brass, vib: 0.05, formant: 900, formantQ: 1.5, vel: e.vel, seed: S() }, place);
          break;
        case 'flute':
          st.note(e.t, Air, { freq: f, dur: e.dur, vel: e.vel, breath: 0.3, vib: 0.14, attack: 0.08, release: 0.6, seed: S() }, { ...place, gain: 0.62 });
          break;
        case 'cello':
          st.note(e.t, Pad, { freq: f, dur: e.dur, vel: e.vel, cutoff: 1100, attack: 0.18, release: 1.2, vib: 0.18, detune: 4 }, { ...place, gain: 0.6 });
          break;
        case 'bells':
          st.note(e.t, Modal, { freq: f, modes: 'chime', t60: 4, hard: 0.6, vel: e.vel, seed: S() }, { ...place, gain: 0.7 });
          break;
        default: {
          const reg = v.kind === 'tenor' ? 'tenor' : v.kind === 'alto' ? 'alto' : 'soprano';
          st.note(e.t, Vox, { freq: f, dur: e.dur + 0.2, vowel: 'u', toVowel: 'o', register: reg, vel: e.vel, attack: 0.12, release: 1.2, vib: 0.22, seed: S() }, { ...place, gain: e.close ? 0.9 : 0.5 });
        }
      }
    },
    rise(e) {
      const dur = e.dur;
      // the sea gives way: a long rumble, stone moving far away, water pouring off rising shapes
      st.note(e.t, Bed, { dur, color: 'brown', type: 'lp', q: 0.9, cutoff: (t) => 45 + 30 * Math.min(1, t / 8), steep: true, gain: (t) => 1.1 * Math.sin(Math.PI * Math.min(1, t / dur)), fade: 2, seed: S() },
        { spk: 'LFE', lfe: 1 });
      st.note(e.t + 2, Bed, { dur: dur - 2, color: 'pink', type: 'bp', q: 0.6, cutoff: (t) => 900 + 1400 * Math.min(1, t / 10), gain: (t) => 0.24 * Math.sin(Math.PI * Math.min(1, t / (dur - 2))), fade: 2, seed: S() },
        { az: 0, width: 200, dist: 3.5, rev: 0.6 });
      st.note(e.t + 1, Creak, { dur: dur - 4, rate: [[0, 6], [0.5, 14], [1, 5]], body: 120, q: 5, vel: 0.25, seed: S() }, { az: -20, dist: 4, rev: 0.6, lfe: 0.3 });
      st.note(e.t + 3, Creak, { dur: dur - 6, rate: [[0, 5], [0.5, 11], [1, 4]], body: 95, q: 5, vel: 0.25, seed: S() }, { az: 30, dist: 4.5, rev: 0.6, lfe: 0.3 });
    },
    choir(e) {
      e.pad.forEach((n, k) => {
        const reg = n < 48 ? 'bass' : n < 56 ? 'tenor' : n < 64 ? 'alto' : 'soprano';
        for (let v = 0; v < 3; v++) {
          st.note(e.t, Vox, { freq: mtof(n), dur: e.dur, vowel: e.last ? 'a' : 'o', toVowel: e.last ? 'o' : undefined, register: reg, vel: e.vel, detune: (v - 1) * 7,
            attack: e.i === 0 ? 1.2 : 0.4, release: e.last ? 4 : 1.2, vib: 0.2, seed: S() },
          { az: -175 + ((k * 3 + v) * 350) / (e.pad.length * 3), dist: 1.6, rev: 0.6, gain: 0.26 });
        }
      });
    },
    lead(e) {
      st.note(e.t, Vox, { freq: mtof(e.n), dur: e.dur, vowel: 'a', register: 'soprano', vel: e.vel, attack: 0.15, release: 1.8, vib: 0.25, seed: S() }, { spk: 'C', rev: 0.5, gain: 0.85 });
      st.note(e.t, Bowed, { freq: mtof(e.n), dur: e.dur, vel: e.vel * 0.7, attack: 0.2, release: 2, partials: [[1, 1], [2, 0.35], [3, 0.15]], seed: S() }, { az: 0, width: 80, rev: 0.5, gain: 0.5 });
    },
    deep(e) {
      st.note(e.t, SubPulse, { freq: mtof(e.n), dur: e.dur, vel: e.vel, attack: e.swell ? 2 : 0.4, drop: 0, texture: 0.3, seed: S() }, { spk: 'LFE', lfe: 1 });
      st.note(e.t, Pad, { freq: mtof(e.n + 12), dur: e.dur, vel: e.vel * 0.8, cutoff: 260, kind: 'organ', attack: e.swell ? 2 : 0.6, release: 3 }, { az: 0, width: 160, rev: 0.4, gain: 0.45 });
    },
    bell(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: 'glass', t60: 3, hard: 0.6, vel: e.vel, seed: S() }, { az: e.az, dist: 1.8, rev: 0.7, gain: 0.6 });
    },
  };
  for (const e of score.events) {
    const fn = I[e.inst];
    if (fn) fn(e);
  }
}
