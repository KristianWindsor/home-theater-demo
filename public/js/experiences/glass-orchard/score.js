// The Glass Orchard: 76 BPM, E major. A tree of glass grown by the music.
//
//   Seed     0:00  a point of light in the dark; first harp harmonics
//   Growth   0:09  harp arpeggios (front-left) grow branches; bowed glass (rear-right) spreads membranes;
//                  the bass ripples the ground; the theme passes from the harp to the bowed voice
//   Tension  0:47  minor key; glass percussion shatters fruit that reforms; the orchard tightens and cools
//   Droplet  1:25  everything thins to one held harmonic; a drop forms on a branch tip... and we pass through
//   Bloom    1:38  the orchard inside the drop: the whole ensemble, choir, the theme circling the room
//   Outro    2:16  the harp alone, the light rising out of the branches
import { Score } from '../core/timeline.js';

const C = {
  Emaj9: { bass: 40, pad: [52, 56, 59, 63, 66], arp: [64, 71, 75, 78, 80, 78, 75, 71] },
  Csm9: { bass: 37, pad: [49, 56, 59, 63, 64], arp: [61, 68, 71, 75, 76, 75, 71, 68] },
  Amaj7s11: { bass: 33, pad: [45, 52, 56, 61, 63], arp: [57, 64, 68, 73, 75, 73, 68, 64] },
  B6sus: { bass: 35, pad: [47, 52, 56, 59, 61], arp: [59, 64, 68, 71, 73, 71, 68, 64] },
  B: { bass: 35, pad: [47, 54, 59, 63, 66], arp: [59, 63, 66, 71, 75, 71, 66, 63] },
  Csm: { bass: 37, pad: [49, 56, 61, 64, 68], arp: [61, 68, 73, 76, 80, 76, 73, 68] },
  AoCs: { bass: 37, pad: [49, 57, 61, 64, 69], arp: [61, 69, 73, 76, 81, 76, 73, 69] },
  Fsm9: { bass: 42, pad: [42, 49, 52, 56, 57], arp: [54, 61, 64, 68, 69, 68, 64, 61] },
  Gs7: { bass: 44, pad: [44, 51, 54, 60, 63], arp: [56, 63, 66, 72, 75, 72, 66, 63] },
  Bmaj7: { bass: 35, pad: [47, 54, 58, 63, 66], arp: [59, 66, 70, 75, 78, 75, 70, 66] },
  Amaj7: { bass: 33, pad: [45, 52, 56, 61, 64], arp: [57, 64, 68, 73, 76, 73, 68, 64] },
  Gssus: { bass: 44, pad: [44, 49, 51, 56, 61], arp: [56, 61, 63, 68, 73, 68, 63, 61] },
  Fsm11: { bass: 42, pad: [42, 49, 52, 57, 59, 64], arp: [54, 61, 64, 69, 71, 69, 64, 61] },
  EoGs: { bass: 44, pad: [44, 52, 59, 64, 68], arp: [56, 64, 68, 71, 76, 71, 68, 64] },
  Amaj9: { bass: 45, pad: [45, 52, 56, 59, 64, 71], arp: [57, 64, 68, 71, 76, 71, 68, 64] },
  B13sus: { bass: 47, pad: [47, 52, 57, 61, 64, 68], arp: [59, 64, 69, 73, 76, 73, 69, 64] },
  E: { bass: 40, pad: [52, 56, 59, 64, 68, 71], arp: [64, 68, 71, 76, 80, 76, 71, 68] },
  BoDs: { bass: 39, pad: [51, 54, 59, 63, 66, 71], arp: [63, 66, 71, 75, 78, 75, 71, 66] },
  Csm7: { bass: 37, pad: [49, 56, 59, 64, 68], arp: [61, 64, 68, 71, 76, 71, 68, 64] },
  Aadd9: { bass: 33, pad: [45, 52, 57, 59, 61, 64], arp: [57, 61, 64, 71, 73, 71, 64, 61] },
  B7sus: { bass: 35, pad: [47, 52, 57, 59, 64], arp: [59, 64, 69, 71, 76, 71, 69, 64] },
  B7: { bass: 35, pad: [47, 51, 57, 59, 63], arp: [59, 63, 69, 71, 75, 71, 69, 63] },
};

// the theme (harp) and its answer (bowed voice): [beat, note, beats]
const THEME = [[0, 71, 1], [1, 76, 1], [2, 78, 1], [3, 80, 1], [4, 83, 2], [6, 80, 1], [7, 78, 1],
  [8, 76, 1], [9, 78, 1], [10, 80, 0.5], [10.5, 81, 0.5], [11, 83, 1], [12, 85, 1.5], [13.5, 83, 0.5], [14, 81, 1], [15, 78, 1]];
const ANSWER = [[0, 80, 2], [2, 78, 1], [3, 76, 1], [4, 73, 2], [6, 76, 1], [7, 80, 1],
  [8, 78, 1.5], [9.5, 76, 0.5], [10, 75, 1], [11, 76, 1], [12, 78, 4]];
const DARK = [ // tension: phrases handed between kalimba (front-right) and the bowed voice (rear-right)
  [[0, 80, 1.5], [1.5, 76, 0.5], [2, 73, 2]], [[0, 76, 1], [1, 78, 1], [2, 80, 1], [3, 81, 1]],
  [[0, 80, 2], [2, 76, 1], [3, 73, 1]], [[0, 72, 2], [2, 75, 1], [3, 78, 1]],
  [[0, 80, 1.5], [1.5, 83, 0.5], [2, 85, 2]], [[0, 82, 2], [2, 78, 2]],
  [[0, 80, 1], [1, 76, 1], [2, 73, 1], [3, 76, 1]], [[0, 75, 2], [2, 72, 2]],
  [[0, 73, 1], [1, 76, 1], [2, 80, 1], [3, 81, 1]], [[0, 80, 1], [1, 83, 1], [2, 85, 1], [3, 88, 1]],
  [[0, 85, 2], [2, 88, 2]], [[0, 88, 4]],
];

export const POS = { harp: 'FL', bowed: 'SR', kalimba: 'FR' };

export function compose() {
  const s = new Score({ duration: 154, bpm: 76, seed: 1717 });
  const T = s.tempo;
  const B = T.beat;
  const rng = s.rng;
  const add = (t, inst, o) => s.add({ t, inst, ...o });
  const bars = (b) => T.t(b);

  s.chapter(0, 'Seed');
  s.chapter(bars(3), 'Growth');
  s.chapter(bars(15), 'Tension');
  s.chapter(bars(27), 'The droplet');
  s.chapter(bars(31), 'Bloom');
  s.chapter(bars(43), 'Light');
  Object.assign(s.marks, {
    growth: bars(3), theme: bars(7), answer: bars(11), tension: bars(15), build: bars(23), drop: bars(27), held: bars(30.5),
    pass: bars(31), bloom: bars(31), finale: bars(39), outro: bars(43), end: 154,
  });

  // ------------------------------------------------------------ seed: harmonics in the dark
  [[1.2, 83], [3.4, 88], [5.2, 80], [6.9, 76], [8.3, 71]].forEach(([t, n], i) => add(t, 'harp', { n, dur: 3, vel: 0.5 + i * 0.04, harmonic: true }));
  add(0.5, 'drone', { n: 40, dur: 9.5, vel: 0.35 });
  add(4.5, 'drone', { n: 47, dur: 5.5, vel: 0.25 });

  // ------------------------------------------------------------ the harmonic plan
  const plan = [];
  const put = (bar, name, beats = 4, b0 = 0) => plan.push({ bar, b0, beats, name, ch: C[name] });
  // growth (bars 3-14)
  for (let r = 0; r < 3; r++) {
    put(3 + r * 4, 'Emaj9'); put(4 + r * 4, 'Csm9'); put(5 + r * 4, 'Amaj7s11'); put(6 + r * 4, 'B6sus', 2); put(6 + r * 4, 'B', 2, 2);
  }
  // tension (15-26)
  ['Csm', 'AoCs', 'Fsm9', 'Gs7', 'Csm', 'Bmaj7', 'Amaj7', 'Gssus', 'Fsm11', 'EoGs', 'Amaj9', 'B13sus'].forEach((n, i) => put(15 + i, n));
  // bloom (31-42)
  ['E', 'BoDs', 'Csm7', 'Aadd9', 'EoGs', 'Amaj7', 'Fsm11', 'B7sus', 'E', 'BoDs', 'Csm7', 'Aadd9'].forEach((n, i) => {
    if (n === 'B7sus') {
      put(31 + i, 'B7sus', 2);
      put(31 + i, 'B7', 2, 2);
    } else if (i === 11) {
      put(42, 'Aadd9', 2);
      put(42, 'B7', 2, 2);
    } else put(31 + i, n);
  });

  for (const p of plan) {
    const t = T.t(p.bar, p.b0);
    const dur = p.beats * B;
    const sec = p.bar < 15 ? 'growth' : p.bar < 27 ? 'tension' : 'bloom';
    const ch = p.ch;
    s.add({ t, inst: 'chord', name: p.name, dur, pad: ch.pad, bass: ch.bass, sec });
    // harp arpeggio: 8ths (growth: lighter in the theme bars, which carry the melody on top)
    const steps = p.beats * 2;
    for (let k = 0; k < steps; k++) {
      const n = ch.arp[(k + p.b0 * 2) % 8];
      const vel = (k % 2 ? 0.42 : 0.52) + (sec === 'bloom' ? 0.08 : 0) + (k === 0 ? 0.06 : 0);
      add(T.t(p.bar, p.b0 + k * 0.5), 'harp', { n: n + (sec === 'bloom' && k % 4 === 3 ? 12 : 0), dur: B * 1.2, vel, arp: true, sec });
    }
    // bowed sustains -> membranes
    if (sec !== 'growth' || p.bar >= 5) {
      add(t, 'bowed', { n: ch.pad[ch.pad.length - 1] + 12, dur: dur * 0.98, vel: sec === 'bloom' ? 0.5 : 0.42, pad: true, sec });
      if (sec !== 'growth') add(t, 'bowed', { n: ch.pad[ch.pad.length - 2] + 12, dur: dur * 0.98, vel: 0.34, pad: true, sec });
    }
    // bass -> ground waves
    if (p.bar >= 5 || sec !== 'growth') {
      add(t, 'bass', { n: ch.bass - 12 >= 28 ? ch.bass - 12 : ch.bass, dur: dur * 0.95, vel: sec === 'bloom' ? 0.8 : 0.62, sec });
      if (sec !== 'growth' && p.beats === 4) add(T.t(p.bar, 2), 'bass', { n: ch.bass - 12 >= 28 ? ch.bass - 12 : ch.bass, dur: 2 * B * 0.9, vel: 0.45, sec, soft: true });
    }
    // choir and strings in the bloom
    if (sec === 'bloom') add(t, 'choir', { pad: ch.pad, dur, vel: p.bar >= 39 ? 0.62 : 0.5 });
    if (sec === 'tension' && p.bar >= 23) add(t, 'strings', { pad: ch.pad, dur, vel: 0.35 + 0.08 * (p.bar - 23) });
  }

  // ------------------------------------------------------------ melodies
  for (const [b, n, d] of THEME) add(T.t(7, b), 'harp', { n, dur: d * B * 1.5, vel: 0.72, melody: true, sec: 'growth' });
  for (const [b, n, d] of ANSWER) add(T.t(11, b), 'bowed', { n, dur: d * B * 0.98, vel: 0.62, melody: true, sec: 'growth' });
  // kalimba counter-line under the answer
  [[11, 0, 88], [11, 2.5, 87], [12, 0, 85], [12, 2.5, 83], [13, 0, 81], [13, 2, 83], [14, 0, 85], [14, 2, 83]].forEach(([bar, b, n]) =>
    add(T.t(bar, b), 'kalimba', { n, dur: 1.2, vel: 0.5, sec: 'growth' }));
  DARK.forEach((phrase, i) => {
    const bar = 15 + i;
    const inst = i >= 8 ? 'bowed' : i % 2 ? 'bowed' : 'kalimba';
    for (const [b, n, d] of phrase) add(T.t(bar, b), inst, { n, dur: d * B * (inst === 'kalimba' ? 1.6 : 0.98), vel: 0.6 + (i >= 8 ? 0.06 * (i - 8) : 0), melody: true, sec: 'tension' });
    if (i >= 8) for (const [b, n, d] of phrase) add(T.t(bar, b), 'harp', { n: n - 12, dur: d * B, vel: 0.5, melody: true, sec: 'tension' });
  });
  // bloom: the theme in octaves, handed around the room (harp FL -> kalimba FR -> bowed SR -> choir SL)
  const ring = ['FL', 'FR', 'SR', 'SL'];
  const bloomLine = [...THEME.map(([b, n, d]) => [31, b, n, d]), ...ANSWER.map(([b, n, d]) => [35, b, n, d]), ...THEME.map(([b, n, d]) => [39, b, n + 12, d])];
  bloomLine.forEach(([bar, b, n, d], i) => {
    const spk = ring[Math.floor(i / 2) % 4];
    add(T.t(bar, b), 'lead', { n, dur: d * B * 1.1, vel: 0.62 + (bar >= 39 ? 0.08 : 0), spk, sec: 'bloom' });
  });
  add(T.t(43), 'lead', { n: 88, dur: 6, vel: 0.7, spk: 'FL', sec: 'bloom', last: true });

  // ------------------------------------------------------------ percussion -> fruit
  const hit = (bar, beat, vel, kind) => add(T.t(bar, beat), 'perc', { vel, kind, pos: { az: rng.range(-35, 35), dist: rng.range(1.0, 1.4) }, sec: bar < 27 ? 'tension' : 'bloom' });
  for (let bar = 15; bar < 27; bar++) {
    const pat = bar < 19 ? [0, 2.5] : bar < 23 ? [0, 1.5, 2.5, 3.25] : [0, 0.75, 1.5, 2.5, 3, 3.5];
    pat.forEach((b, k) => hit(bar, b, 0.45 + (k === 0 ? 0.15 : 0) + (bar - 15) * 0.015, k === 0 ? 'bowl' : k % 2 ? 'glass' : 'wood'));
    if (bar >= 19) for (const b of [0, 2]) add(T.t(bar, b), 'kick', { vel: 0.45 + (bar - 19) * 0.04, sec: 'tension' });
    if (bar >= 23) for (let k = 0; k < 16; k++) add(T.t(bar, k / 4), 'tick', { vel: 0.15 + (k % 4 === 2 ? 0.08 : 0) + (bar - 23) * 0.03, pos: { az: k % 2 ? 110 : -110, dist: 1.2 } });
  }
  for (let bar = 31; bar < 43; bar++) {
    [0, 1, 2.75, 3.5].forEach((b, k) => hit(bar, b, 0.5 + (k === 0 ? 0.12 : 0), k === 0 ? 'bowl' : k === 2 ? 'wood' : 'glass'));
    for (const b of [0, 2]) add(T.t(bar, b), 'kick', { vel: 0.55, sec: 'bloom' });
    for (let k = 0; k < 8; k++) add(T.t(bar, k / 2 + 0.25), 'tick', { vel: 0.14 + (k % 2) * 0.04, pos: { az: k % 2 ? 120 : -120, dist: 1.1 } });
  }

  // ------------------------------------------------------------ luminous organisms (high detail)
  const density = (bar) => (bar < 3 ? 0 : bar < 15 ? 1.2 : bar < 27 ? 3 : bar < 31 ? 0.6 : bar < 43 ? 6 : 2);
  for (let bar = 3; bar < 48; bar++) {
    const n = Math.round(density(bar) * (0.7 + rng.next() * 0.6));
    const ch = plan.find((p) => p.bar === bar) || plan[0];
    for (let k = 0; k < n; k++) {
      const pool = ch.ch.arp.map((x) => x + 24);
      add(T.t(bar, rng.range(0, 4)), 'glint', { n: rng.pick(pool), vel: rng.range(0.12, 0.32), pos: { az: rng.range(-180, 180), dist: rng.range(1.1, 2.4) } });
    }
  }

  // ------------------------------------------------------------ the droplet
  const dropNotes = [88, 83, 80, 76, 75, 71, 68, 64, 63, 59];
  dropNotes.forEach((n, i) => add(T.t(27) + i * B * (1 + i * 0.12), 'harp', { n, dur: 3, vel: 0.62 - i * 0.03, drop: true, sec: 'drop' }));
  add(T.t(27), 'harmonic', { n: 95, dur: T.t(31) - T.t(27) + 0.2, vel: 0.5 });
  add(T.t(27), 'drone', { n: 40, dur: T.t(30.5) - T.t(27), vel: 0.3 });
  add(T.t(30.5) - 0.3, 'inhale', { dur: T.t(31) - T.t(30.5) + 0.3, vel: 0.6 });
  add(T.t(31), 'pass', { dur: 3.5, vel: 0.9 });

  // ------------------------------------------------------------ outro: the harp alone, light rising
  const outro = [[43, 0, 71], [43, 1, 76], [43, 2, 78], [43, 3, 80], [44, 0, 83], [44, 2, 80], [45, 0, 76], [45, 1, 80], [45, 2, 83], [45, 3, 88],
    [46, 0, 87], [46, 2, 83], [47, 0, 80], [47, 1.5, 76], [47, 3, 71]];
  for (const [bar, b, n] of outro) add(T.t(bar, b), 'harp', { n, dur: 4, vel: 0.55, melody: true, sec: 'outro' });
  [[43, 'Emaj9'], [45, 'Amaj7s11'], [47, 'Emaj9']].forEach(([bar, name]) => {
    s.add({ t: T.t(bar), inst: 'chord', name, dur: 2 * T.bar, pad: C[name].pad, bass: C[name].bass, sec: 'outro' });
    add(T.t(bar), 'strings', { pad: C[name].pad, dur: 2 * T.bar, vel: 0.3 });
    add(T.t(bar), 'bass', { n: C[name].bass, dur: 2 * T.bar, vel: 0.4, sec: 'outro', soft: true });
  });
  add(T.t(48), 'harp', { n: 64, dur: 6, vel: 0.5, sec: 'outro', final: true });
  add(T.t(48) + 0.05, 'harp', { n: 76, dur: 6, vel: 0.45, sec: 'outro', final: true });
  add(T.t(48) + 0.1, 'harp', { n: 83, dur: 6, vel: 0.42, harmonic: true, sec: 'outro', final: true });

  s.done();
  s.T = T;
  s.plan = plan;
  return s;
}
