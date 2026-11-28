// The Room Wakes Up: how the score sounds. Every instrument lives in one tower; the room itself
// (early reflections + reverb) grows as the walls slide away.
import { Pluck, Modal, Bowed, Air, Vox, Pad, SubPulse, Bed, Creak, Glide, Layer, Drum } from '../audio/instruments.js';
import { mtof, Curve } from '../core/timeline.js';

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  const T = score.T;
  let seed = 1;
  const S = () => (seed = (seed * 1103515245 + 12345) >>> 0) % 100000 + 1;

  // ---------------------------------------------------------------- the space
  // the room opens with the chord (M.D) and closes at the fold (M.F): the reverb grows and shrinks with it
  st.set('space', [[0, 0], [M.D - 0.2, 0], [M.D + 2.8, 1, 'inOut'], [M.F + 1, 1], [M.F + 4.5, 0.12, 'inOut'], [M.F + 6.5, 0]]);
  st.set('t60A', [[0, 0.35], [M.C, 0.55], [M.D, 0.9]]);
  st.set('t60B', [[0, 2.4], [M.D, 2.8], [M.D + 2.8, 6.5, 'inOut'], [M.F + 1, 6.5], [M.F + 5, 2.2, 'inOut']]);
  st.set('hfB', [[0, 0.4], [M.D + 3, 0.5], [M.F + 5, 0.35]]);
  st.set('revA', 0.85);
  // the held breath before the sub's drop: everything (reverb tails too) ducks for the beat, then the drop at full level
  st.set('master', [[0, 0.7], [M.breath, 0.7], [M.breath + 0.12, 0.22], [M.drop - 0.006, 0.22], [M.drop, 0.7]]);
  st.set('er', [[0, 0], [M.D, 0], [M.D + 2.5, 0.85], [M.F + 1.5, 0.85], [M.F + 4.5, 0]]);
  st.set('room', (t) => {
    const r = score.room(t);
    const W = 6.4 + r.left + r.right;
    const open = Math.min(1, r.split / 6);
    const walls = 1 - (r.sink || 0); // sunk into the ground, the walls stop reflecting
    return {
      w: W, front: -3.7 - r.front, back: 2.7 + r.back, h: 2.75 * r.height,
      refl: { left: 0.72 * walls, right: 0.72 * walls, front: 0.7 * (1 - open) * walls, back: 0.62 * walls, floor: 0.32, ceiling: 0.62 * (1 - r.open) },
    };
  });

  const place = (e, extra = {}) => (e.spk ? { spk: e.spk, ...extra } : { ...e.pos, ...extra });
  // LFE sends for the sub's moments. A send of 1 reaches the LFE channel about 13 dB down (the studio writes LFE
  // -10 dB, and the master is 0.7); these put the drop where Dolby's Amaze puts its bass: about -8 dBFS RMS on the
  // LFE for two seconds, peaking just under the limiter, then a long tail
  const LFE = { rise: 3.0, drop: 17, rumble: 2.0, line: 3.2, chord: 3.6 };

  // ---------------------------------------------------------------- instruments
  const I = {
    tick(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: 'wood', t60: e.last ? 0.11 : 0.08, hard: 0.85, vel: e.vel, click: 0.35, noise: 0.3, seed: S() },
        place(e, { rev: e.dry ? 0.015 : e.hall ? 0.3 : e.groove ? 0.07 : 0.05, gain: 1.3 }));
    },
    pluck(e) {
      const f = mtof(e.n);
      const decay = e.strum ? 6 : e.slow ? 4 : e.arp ? 2.2 : 2.8;
      st.note(e.t, Pluck, {
        freq: f, decay, bright: e.arp ? 0.5 : 0.68, stiff: 0.3, pick: 0.13, vel: e.vel, seed: S(),
        dur: e.arp && !e.slow ? e.dur * 1.8 : undefined, damp: 0.25,
      }, place(e, { rev: e.slow ? 0.55 : e.strum ? 0.4 : 0.22, gain: e.arp ? 0.78 : 0.9 }));
    },
    glass(e) {
      const f = mtof(e.n);
      if (e.short) {
        st.note(e.t, Modal, { freq: f, modes: 'glass', t60: 1.6, hard: 0.55, vel: e.vel, seed: S() }, place(e, { rev: 0.3, gain: 1.0 }));
        return;
      }
      st.note(e.t, Bowed, { freq: f, dur: e.dur, vel: e.vel, attack: Math.min(0.6, e.dur * 0.3), release: 1.6, noise: 0.04, beat: 0.55, seed: S() },
        place(e, { rev: 0.35, gain: 0.6 }));
      if (e.intro) st.note(e.t, Modal, { freq: f, modes: 'glass', t60: 2, hard: 0.3, vel: e.vel * 0.5, seed: S() }, place(e, { rev: 0.3, gain: 0.35 }));
    },
    box(e) {
      const f = mtof(e.n);
      st.play(e.t, () => new Layer([
        new Modal(sr, { freq: f, modes: 'tine', t60: 1.3, hard: 0.75, vel: e.vel, seed: S() }),
        new Modal(sr, { freq: 4600, modes: 'metalTick', t60: 0.014, hard: 1, vel: e.vel * 0.5, strikes: [[0, 1], [0.007, 0.35]], noise: 0.5, seed: S() }),
      ], [1, 0.45]), place(e, { rev: 0.3, gain: 1.15 }));
    },
    click(e) {
      st.note(e.t, Modal, { freq: 3300, modes: 'metalTick', t60: 0.022, hard: 1, vel: e.vel, strikes: [[0, 1], [0.0085, 0.42]], noise: 0.6, seed: S() },
        place(e, { rev: 0.06, gain: 1.3 }));
    },
    air(e) {
      st.note(e.t, Air, {
        freq: mtof(e.n), dur: e.dur, vel: e.vel, breath: e.short ? 0.3 : 0.24, vib: e.short ? 0.04 : 0.13, chiff: e.short ? 0.7 : 0.35,
        attack: e.short ? 0.025 : 0.09, release: e.hall ? 0.9 : 0.35, seed: S(),
      }, place(e, { rev: e.hall ? 0.5 : 0.3, gain: e.short ? 0.6 : 0.45 }));
    },
    hum(e) {
      for (const d of [-7, 0, 6]) {
        st.note(e.t, Vox, { freq: mtof(e.n), dur: e.dur, vowel: 'm', vel: e.vel, detune: d, vib: 0.07, attack: 0.9, release: 1.4, breath: 0.01, seed: S() },
          place(e, { rev: 0.3, gain: 0.2 }));
      }
    },
    sub(e) {
      // the sub's line (score.js LINE): each note rings about as long as it's written; the final chord's is held, and big
      st.note(e.t, SubPulse, {
        freq: mtof(e.n), dur: e.long || e.swell ? e.dur : Math.max(0.5, (e.dur ?? 0.7) * 2.1), vel: e.vel, texture: e.swell ? 0.5 : 0.32,
        drop: e.swell ? 0.05 : 0.3, attack: e.swell ? 0.6 : 0.006, seed: S(),
      }, { spk: 'LFE', lfe: e.swell ? 1 : e.long ? LFE.chord : LFE.line, rev: 0 });
      // on the strong beats the ball lands hard (marbles.js): a marble-machine kick, felt rather than heard
      if (e.kick) st.note(e.t, Drum, { freq: 44, from: 96, decay: 0.42, vel: 0.8 * e.vel, click: 0.06, seed: S() }, { spk: 'LFE', lfe: 1, rev: 0, gain: 0.8 });
    },
    riser(e) {
      // a bar of build: a tone climbing in the sub, air rising all around, both cut dead at the held breath
      const d = e.dur;
      st.note(e.t, Glide, { f: [[0, 30.9], [d, 49]], a: [[0, 0], [d * 0.85, 1], [d - 0.015, 1], [d, 0]], dur: d, vel: e.vel, seed: S() },
        { spk: 'LFE', lfe: LFE.rise, rev: 0 });
      st.note(e.t, Bed, { dur: d, color: 'pink', type: 'bp', q: 1.1, cutoff: (t) => 180 * Math.pow(18, t / d),
        gain: (t) => 0.24 * Math.pow(t / d, 2.2) * Math.min(1, Math.max(0, (d - t) / 0.02)), fade: 0.003, seed: S() }, { az: 0, width: 360, rev: 0.25 });
    },
    drop(e) {
      const f = mtof(e.n);
      // the sub: one sine, dropping from an octave and a bit above onto low D and held there, then a long tail
      st.note(e.t, Glide, { f: [[0, f * 2.3], [0.08, f * 1.08], [0.3, f], [e.dur, f]],
        a: [[0, 0], [0.004, 1], [0.25, 0.78], [2.0, 0.7], [3.6, 0.3], [6, 0.1], [e.dur, 0]], dur: e.dur, vel: 1, seed: S() },
        { spk: 'LFE', lfe: LFE.drop, rev: 0 });
      // the chest: a big kick from every speaker; the ball landing on the cabinet (front left, beside the sub)
      st.note(e.t, Drum, { freq: 44, from: 150, decay: 1.0, vel: 1, click: 0.35, noise: 0.25, noiseFreq: 380, seed: S() }, { az: 0, width: 360, rev: 0.4, gain: 1.1 });
      st.note(e.t, Modal, { freq: 92, modes: 'stone', t60: 0.7, hard: 0.95, vel: 1, seed: S() }, { az: 'FL', width: 30, rev: 0.35, gain: 0.9 });
      st.note(e.t, Bed, { dur: 0.25, color: 'white', type: 'lp', q: 0.7, cutoff: 3500, gain: (t) => 0.55 * Math.exp(-t * 22), fade: 0.002, seed: S() },
        { az: 'FL', width: 60, rev: 0.45 });
      // and the room rumbling after it
      st.note(e.t, Bed, { dur: 7, color: 'brown', type: 'lp', q: 0.7, cutoff: 95, gain: (t) => 0.9 * Math.exp(-t / 1.8), fade: 0.01, seed: S() },
        { az: 0, width: 360, rev: 0.2, lfe: LFE.rumble });
    },
    swell(e) {
      const dur = e.dur;
      st.note(e.t, Bed, {
        dur: dur + 0.05, color: 'white', type: 'bp', q: 0.9, cutoff: (t) => 1500 * Math.pow(6, Math.min(1, t / dur)),
        gain: (t) => 0.13 * e.vel * Math.pow(Math.min(1, t / dur), 2.6), fade: 0.02, seed: S(),
      }, { ...e.pos, rev: 0.35 });
    },
    star(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: e.n % 2 ? 'glass' : 'tine', t60: 1.6, hard: 0.6, vel: e.vel, seed: S() },
        { ...e.pos, rev: 0.6, gain: 0.5 });
    },
    wall(e) {
      const dur = e.dur;
      const out = e.reverse;
      const path = (t) => {
        const x = Math.min(1, Math.max(0, t / dur));
        const k = x * x * (3 - 2 * x);
        return { az: e.pos.az, width: e.pos.width || 30, dist: out ? 4.5 - 3.4 * k : 1.1 + 3.6 * k };
      };
      const env = new Curve([[0, 0], [dur * 0.18, 1, 'out'], [dur * 0.8, 0.85], [dur, 0, 'in']]);
      st.play(e.t, () => new Layer([
        new Bed(sr, { dur, color: 'brown', type: 'lp', q: 0.8, cutoff: (t) => 90 + 160 * env.at(t), gain: (t) => 0.9 * env.at(t), seed: S() }),
        new Creak(sr, { dur, rate: [[0, 18], [0.3, 46], [0.8, 30], [1, 12]], body: 190, q: 6, vel: 0.12, jitter: 0.5, seed: S() }),
        new Bowed(sr, { freq: mtof(e.n), dur: dur * 0.8, attack: dur * 0.45, release: 2.5, vel: 0.55, partials: [[1, 1], [2, 0.5], [3.01, 0.32], [4.23, 0.12], [5.4, 0.06]], beat: 0.3, noise: 0.02, seed: S() }),
      ], [1, 1, 0.9]), { path, rev: 0.5, lfe: 0.6, gain: e.vel * 0.6 });
      if (!out) {
        st.note(e.t + dur * 0.97, Drum, { freq: 42, from: 70, decay: 1.4, vel: 0.5 * e.vel, click: 0.05, seed: S() }, { az: e.pos.az, dist: 4.7, rev: 0.6, lfe: 0.8 });
        st.note(e.t + dur * 0.97, Modal, { freq: 140, modes: 'stone', t60: 0.9, hard: 0.4, vel: 0.5 * e.vel, seed: S() }, { az: e.pos.az, dist: 4.7, rev: 0.6, gain: 0.6 });
      }
    },
    bell(e) {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: 'bell', t60: 7, hard: 0.45, vel: e.vel, seed: S() }, { ...e.pos, rev: 0.7, gain: 0.6 });
    },
    resolve(e) {
      const pad = e.pad;
      pad.forEach((n, k) => {
        const reg = n < 52 ? 'tenor' : n < 62 ? 'alto' : 'soprano';
        for (let v = 0; v < 3; v++) {
          st.note(e.t, Vox, {
            freq: mtof(n), dur: 6.5, vowel: 'a', toVowel: 'o', register: reg, vel: 0.5, detune: (v - 1) * 6, attack: 0.25, release: 3.5, vib: 0.2, seed: S(),
          }, { az: -170 + ((k * 3 + v) * 340) / (pad.length * 3), dist: 1.5, rev: 0.7, gain: 0.36 });
        }
        st.note(e.t, Pad, { freq: mtof(n), dur: 7, vel: 0.5, cutoff: 2200, toCutoff: 900, attack: 0.08, release: 3.5 },
          { az: (k / pad.length) * 360, width: 120, rev: 0.6, gain: 0.28 });
      });
      st.note(e.t, Drum, { freq: 73.4, from: 120, decay: 2.6, vel: 0.75, click: 0.2, noise: 0.15, noiseFreq: 300, seed: S() }, { az: 0, width: 90, rev: 0.6, lfe: 0.7, gain: 0.85 });
      st.note(e.t, Modal, { freq: 73.4, modes: 'plate', t60: 8, hard: 0.4, vel: 0.55, seed: S() }, { az: 0, dist: 4, rev: 0.85, gain: 0.6 });
      st.note(e.t - 0.02, Bed, { dur: 7, color: 'white', type: 'hp', q: 0.7, cutoff: 6000, gain: (t) => 0.06 * Math.exp(-t / 2.5), seed: S() }, { az: 0, width: 360, rev: 0.6 });
    },
  };

  for (const e of score.events) {
    const fn = I[e.inst];
    if (fn) fn(e);
  }

  // a breath of air in the room before anything happens (so silence isn't digital silence)
  st.note(0.2, Bed, { dur: 100, color: 'pink', type: 'lp', q: 0.5, cutoff: 900, gain: (t) => 0.004 + 0.006 * Math.min(1, t / 3), seed: S() }, { az: 0, width: 360, rev: 0 });
  void T;
}
