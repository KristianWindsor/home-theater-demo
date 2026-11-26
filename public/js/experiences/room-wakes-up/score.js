// The Room Wakes Up: the shared timeline. 90 BPM, D major.
//
//   A  0:00  a wooden tick behind-left, an answer front-right; the conversation finds a tempo
//   B  0:11  each tower introduces itself (FL plucked wire, FR bowed glass, SR music box, SL breath),
//            then they pass the theme around the couch, faster and faster
//   C  0:27  everyone agrees on a groove; threads of light join the speakers; the center hums, the sub pulses
//   D  0:45  the walls slide away, the front wall parts, the ceiling opens; the reverb grows with the room
//   E  1:04  the full passage: the theme circles the room; a deep B-flat as the largest ring locks in;
//            everything resolves into one luminous D chord
//   F  1:25  the room folds back, the interface returns... and one last tick behind your left shoulder
import { Score, Tempo, Curve, note } from '../core/timeline.js';

export const SPK = ['FL', 'FR', 'SR', 'SL']; // clockwise around the couch, starting front-left
export const INST_OF = { FL: 'pluck', FR: 'glass', SR: 'box', SL: 'air' };
const N = (s) => note(s);

// chord table: bass note, pad voicing, 8-step arpeggio, glass line, sub note
const CH = {
  Dmaj9: { bass: 38, pad: [50, 57, 61, 64, 66], arp: [74, 69, 76, 69, 78, 69, 76, 69], sub: 26 },
  Bm7: { bass: 35, pad: [47, 54, 57, 62, 66], arp: [71, 66, 74, 66, 76, 66, 74, 66], sub: 35 },
  Gmaj7: { bass: 31, pad: [43, 50, 54, 59, 62], arp: [71, 67, 74, 67, 78, 67, 74, 67], sub: 31 },
  Aadd9: { bass: 33, pad: [45, 52, 57, 59, 61, 64], arp: [73, 69, 76, 69, 71, 69, 76, 69], sub: 33 },
  Bm11: { bass: 35, pad: [47, 54, 57, 62, 64], arp: [71, 66, 74, 66, 76, 66, 78, 66], sub: 35 },
  Gmaj7s11: { bass: 31, pad: [43, 50, 54, 59, 61], arp: [71, 67, 74, 67, 73, 67, 78, 67], sub: 31 },
  DaddA: { bass: 33, pad: [45, 50, 57, 64, 66] },
  Em9: { bass: 28, pad: [40, 47, 54, 55, 62] },
  Bmadd9: { bass: 35, pad: [47, 54, 59, 61, 62] },
  Gmaj9: { bass: 31, pad: [43, 50, 54, 57, 59] },
  Fsm7: { bass: 30, pad: [42, 49, 52, 57, 61] },
  A13sus: { bass: 33, pad: [45, 52, 55, 59, 66] },
  D: { bass: 38, pad: [50, 57, 62, 66, 69], arp: [74, 69, 78, 69, 81, 69, 78, 69], sub: 26 },
  AoverCs: { bass: 37, pad: [49, 57, 64, 69, 71], arp: [73, 69, 76, 69, 81, 69, 76, 69], sub: 33 },
  Gadd9: { bass: 31, pad: [43, 50, 57, 59, 62], arp: [71, 67, 74, 67, 81, 67, 74, 67], sub: 31 },
  DoverFs: { bass: 30, pad: [42, 50, 57, 62, 66], arp: [74, 69, 78, 69, 81, 69, 78, 69], sub: 30 },
  A7sus: { bass: 33, pad: [45, 52, 55, 62, 64], arp: [74, 69, 76, 69, 74, 69, 76, 69], sub: 33 },
  Bbadd9: { bass: 34, pad: [46, 53, 58, 60, 62, 65], arp: [70, 65, 72, 65, 74, 65, 77, 65], sub: 22 },
  D69: { bass: 38, pad: [50, 57, 59, 64, 66, 69, 74], sub: 26 },
};

// the theme, as [beat, note, beats]
const THEME = [[0, 78, 1], [1, 76, 0.5], [1.5, 74, 0.5], [2, 69, 1], [3, 74, 0.5], [3.5, 76, 0.5],
  [4, 78, 1.5], [5.5, 81, 0.5], [6, 79, 1], [7, 76, 1]];
const THEME2 = [[0, 78, 1], [1, 76, 0.5], [1.5, 74, 0.5], [2, 69, 1], [3, 74, 0.5], [3.5, 76, 0.5],
  [4, 78, 1], [5, 81, 1], [6, 83, 1], [7, 81, 0.5], [7.5, 78, 0.5]];

export function compose() {
  const s = new Score({ duration: 101, bpm: 90, seed: 2026 });
  const T = s.tempo; // T.t(bar, beat)
  const B = T.beat;
  const rng = s.rng;
  const add = (t, inst, o) => s.add({ t, inst, ...o });

  s.chapter(0, 'A tick');
  s.chapter(T.t(4), 'Introductions');
  s.chapter(T.t(8), 'Around the couch');
  s.chapter(T.t(10), 'The groove');
  s.chapter(T.t(17), 'The walls');
  s.chapter(T.t(24), 'The instrument');
  s.chapter(T.t(31), 'One chord');
  s.chapter(T.t(32.5), 'Folding back');
  s.mark('B', T.t(4));
  s.mark('hocket', T.t(8));
  s.mark('C', T.t(10));
  s.mark('hum', T.t(12));
  s.mark('sub', T.t(14));
  s.mark('D', T.t(17));
  s.mark('E', T.t(24));
  s.mark('bass', T.t(30));
  s.mark('chord', T.t(31));
  s.mark('F', T.t(32));
  s.mark('chrome', 92.4);
  s.mark('lastTick', 98.2);

  // ------------------------------------------------------------ A: the ticks find each other
  const tick = (t, spk, vel = 0.6, extra = {}) => add(t, 'tick', { spk, n: spk === 'SL' ? N('D6') : spk === 'FR' ? N('A6') : spk === 'FL' ? N('E6') : N('F#6'), vel, ...extra });
  tick(2.4, 'SL', 0.62);
  tick(3.95, 'FR', 0.55);
  tick(5.5, 'SL', 0.6);
  tick(6.12, 'FR', 0.55);
  tick(7.33, 'SL', 0.58);
  tick(7.66, 'FR', 0.55);
  for (let k = 0; k < 4; k++) tick(T.t(3, k), k % 2 ? 'FR' : 'SL', 0.52 + (k === 0 ? 0.06 : 0));

  // ------------------------------------------------------------ B: introductions (bars 4-7)
  for (let bar = 4; bar < 10; bar++) {
    for (let k = 0; k < 4; k++) {
      if (bar === 9 && k >= 2) continue; // make room for the spin
      tick(T.t(bar, k), k % 2 ? 'FR' : 'SL', 0.3 + (k === 0 ? 0.05 : 0));
    }
  }
  const part1 = THEME.slice(0, 6), part2 = THEME.slice(6);
  for (const [b, n, d] of part1) add(T.t(4, b), 'pluck', { spk: 'FL', n, dur: d * B, vel: 0.72, intro: true });
  add(T.t(5, 0), 'glass', { spk: 'FR', n: 78, dur: 1.6 * B, vel: 0.62, intro: true });
  add(T.t(5, 1.5), 'glass', { spk: 'FR', n: 81, dur: 0.9 * B, vel: 0.55, intro: true });
  add(T.t(5, 2), 'glass', { spk: 'FR', n: 79, dur: 1.1 * B, vel: 0.58, intro: true });
  add(T.t(5, 3), 'glass', { spk: 'FR', n: 76, dur: 2.6 * B, vel: 0.6, intro: true });
  for (const [b, n, d] of part1) add(T.t(6, b), 'box', { spk: 'SR', n: n + 12, dur: d * B, vel: 0.62, intro: true });
  for (const [b, n, d] of part2) add(T.t(7, b - 4), 'air', { spk: 'SL', n, dur: (d + (b === 7 ? 1.2 : 0.1)) * B, vel: 0.66, intro: true });

  // ------------------------------------------------------------ B: the theme passes around the couch (bars 8-9)
  const hocket = [
    [8, 0, 78, 1], [8, 1, 76, 1], [8, 2, 74, 1], [8, 3, 69, 1],
    [9, 0, 74, 0.5], [9, 0.5, 76, 0.5], [9, 1, 78, 0.5], [9, 1.5, 81, 0.5],
    [9, 2, 79, 0.25], [9, 2.25, 78, 0.25], [9, 2.5, 76, 0.25], [9, 2.75, 74, 0.25],
    [9, 3, 81, 0.25], [9, 3.25, 78, 0.25], [9, 3.5, 86, 0.25], [9, 3.75, 81, 0.25],
  ];
  hocket.forEach(([bar, b, n, d], i) => {
    const spk = SPK[i % 4];
    const from = SPK[(i + 3) % 4];
    add(T.t(bar, b), INST_OF[spk], { spk, n, dur: Math.max(0.2, d * B * 1.4), vel: 0.62 + 0.15 * (i / hocket.length), short: true, hocket: true, from, to: spk });
  });
  // a breath of everything at the end of the spin
  add(T.t(9, 3.6), 'swell', { pos: { az: 0, width: 360 }, dur: 0.6, vel: 0.35 });

  // ------------------------------------------------------------ C: the groove (bars 10-16)
  const progC = ['Dmaj9', 'Bm7', 'Gmaj7', 'Aadd9', 'Dmaj9', 'Bm11', 'Gmaj7s11'];
  const glassC = [85, 83, 83, 85, 85, 86, 85];
  progC.forEach((name, i) => {
    const bar = 10 + i, ch = CH[name];
    s.add({ t: T.t(bar), inst: 'chord', name, dur: T.bar, bass: ch.bass, pad: ch.pad });
    for (let k = 0; k < 4; k++) tick(T.t(bar, k), k % 2 ? 'FR' : 'SL', k === 0 ? 0.5 : 0.4, { groove: true });
    for (let k = 0; k < 4; k++) add(T.t(bar, k + 0.5), 'click', { spk: 'SR', vel: 0.28 + (k % 2) * 0.06 });
    ch.arp.forEach((n, k) => add(T.t(bar, k * 0.5), 'pluck', { spk: 'FL', n, dur: 0.5 * B, vel: k % 2 ? 0.42 : 0.55, arp: true }));
    add(T.t(bar), 'glass', { spk: 'FR', n: glassC[i], dur: 3.7 * B, vel: 0.5 });
    add(T.t(bar, 3.5), 'box', { spk: 'SR', n: ch.arp[(i * 3) % 8] + 12, dur: 0.5 * B, vel: 0.45 });
    if (bar >= 12) {
      add(T.t(bar), 'hum', { spk: 'C', n: ch.bass + 12 + (ch.bass < 33 ? 12 : 0), dur: T.bar * 1.02, vel: 0.5 + 0.06 * (bar - 12) });
      add(T.t(bar), 'hum', { spk: 'C', n: ch.bass + 19 + (ch.bass < 33 ? 12 : 0), dur: T.bar * 1.02, vel: 0.35 + 0.04 * (bar - 12) });
    }
    if (bar >= 14) for (const k of [0, 2]) add(T.t(bar, k), 'sub', { spk: 'LFE', n: ch.sub, dur: 1.1, vel: 0.55 + 0.1 * (bar - 14) + (k ? -0.08 : 0) });
  });
  // the breath melody (SL)
  for (const [b, n, d] of THEME) add(T.t(12, b), 'air', { spk: 'SL', n, dur: d * B * 0.95, vel: 0.6, melody: true });
  for (const [b, n, d] of THEME2) add(T.t(14, b), 'air', { spk: 'SL', n, dur: d * B * 0.95, vel: 0.64, melody: true });
  add(T.t(16, 0), 'air', { spk: 'SL', n: 85, dur: 2 * B, vel: 0.62, melody: true });
  add(T.t(16, 2), 'air', { spk: 'SL', n: 86, dur: 6 * B, vel: 0.66, melody: true });
  add(T.t(16, 2.5), 'swell', { pos: { az: 0, width: 360 }, dur: 1.4 * B + 0.4, vel: 0.5 });

  // ------------------------------------------------------------ D: the walls (bars 17-23)
  const progD = [['DaddA', 0, 4], ['Gmaj7s11', 0, 4], ['Em9', 0, 4], ['Bmadd9', 0, 4], ['Gmaj9', 0, 4], ['Fsm7', 0, 4], ['Em9', 0, 2], ['A13sus', 2, 2]];
  let barD = 17;
  for (const [name, b0, beats] of progD) {
    const ch = CH[name];
    const t = T.t(barD, b0);
    s.add({ t, inst: 'chord', name, dur: beats * B, bass: ch.bass, pad: ch.pad, hall: true });
    if (beats === 4) {
      ch.pad.slice(-4).forEach((n, k) => add(T.t(barD, k), 'pluck', { spk: 'FL', n: n + 24, dur: B * 1.5, vel: 0.36, arp: true, slow: true }));
      add(t, 'glass', { spk: 'FR', n: ch.pad[ch.pad.length - 1] + 12, dur: beats * B, vel: 0.42 });
    }
    add(t, 'sub', { spk: 'LFE', n: ch.bass - 12 < 22 ? ch.bass : ch.bass - 12, dur: beats * B * 0.8, vel: 0.35, swell: true });
    if (b0 + beats >= 4) barD++;
  }
  const melD = [[17, 0, 86, 4], [18, 0, 85, 2], [18, 2, 81, 2], [19, 0, 83, 4], [20, 0, 78, 2], [20, 2, 81, 2], [21, 0, 83, 2], [21, 2, 86, 2], [22, 0, 85, 4], [23, 0, 83, 2], [23, 2, 81, 2]];
  for (const [bar, b, n, d] of melD) add(T.t(bar, b), 'air', { spk: 'SL', n, dur: d * B * 0.98, vel: 0.5, melody: true, hall: true });
  // stars: music-box sparkles from everywhere as the ceiling opens
  for (let i = 0; i < 70; i++) {
    const t = T.t(19) + rng.range(0, T.t(24) - T.t(19)) * Math.pow(rng.next(), 0.7);
    const pool = [74, 76, 78, 81, 83, 85, 86, 88, 90, 93];
    add(t, 'star', { pos: { az: rng.range(-180, 180), dist: rng.range(1.2, 3) }, n: rng.pick(pool) + 12, vel: rng.range(0.15, 0.4) });
  }
  // the walls: the sounds of the architecture moving (also drives the picture, see room())
  add(T.t(17), 'wall', { which: 'sides', dur: 5.2, pos: { az: -90 }, n: 38, vel: 0.7 });
  add(T.t(17), 'wall', { which: 'sides', dur: 5.2, pos: { az: 90 }, n: 45, vel: 0.7 });
  add(T.t(18.5), 'wall', { which: 'front', dur: 4.6, pos: { az: 0 }, n: 33, vel: 0.8 });
  add(T.t(19.5), 'wall', { which: 'back', dur: 4.6, pos: { az: 180 }, n: 40, vel: 0.65 });
  add(T.t(20.5), 'rise', { dur: 6.5, vel: 0.6 });
  add(T.t(21.5), 'ceiling', { dur: 5.5, vel: 0.6 });
  add(T.t(23, 2), 'swell', { pos: { az: 0, width: 360 }, dur: 2 * B + 0.3, vel: 0.6 });

  // ------------------------------------------------------------ E: the instrument (bars 24-30)
  const progE = [['D', 0, 4], ['AoverCs', 0, 4], ['Bm7', 0, 4], ['Gadd9', 0, 4], ['DoverFs', 0, 4], ['Gmaj7', 0, 2], ['A7sus', 2, 2], ['Bbadd9', 0, 4]];
  let barE = 24;
  for (const [name, b0, beats] of progE) {
    const ch = CH[name];
    const t = T.t(barE, b0);
    const big = name === 'Bbadd9';
    s.add({ t, inst: 'chord', name, dur: beats * B, bass: ch.bass, pad: ch.pad, hall: true, big });
    for (let k = b0; k < b0 + beats; k++) {
      if (!big) tick(T.t(barE, k), k % 2 ? 'FR' : 'SL', k === 0 ? 0.58 : 0.46, { groove: true, hall: true });
      add(T.t(barE, k + 0.5), 'click', { spk: 'SR', vel: 0.3 });
    }
    const arp = ch.arp || CH.D.arp;
    for (let k = b0 * 2; k < (b0 + beats) * 2; k++) add(T.t(barE, k * 0.5), 'pluck', { spk: 'FL', n: arp[k % 8], dur: 0.5 * B, vel: k % 2 ? 0.45 : 0.58, arp: true });
    add(t, 'glass', { spk: 'FR', n: ch.pad[ch.pad.length - 1] + 12, dur: beats * B * 0.95, vel: 0.48 });
    add(t, 'hum', { spk: 'C', n: ch.bass + 12 + (ch.bass < 33 ? 12 : 0), dur: beats * B * 1.02, vel: 0.62 });
    add(t, 'hum', { spk: 'C', n: ch.bass + 19 + (ch.bass < 33 ? 12 : 0), dur: beats * B * 1.02, vel: 0.45 });
    if (!big) {
      for (let k = b0; k < b0 + beats; k += 2) add(T.t(barE, k), 'sub', { spk: 'LFE', n: ch.sub, dur: 1.2, vel: 0.75 });
      if (b0 === 0) add(t, 'bell', { pos: { az: rng.range(-25, 25), dist: 5 }, n: ch.bass + 24, vel: 0.5, ring: barE - 24 });
    }
    if (b0 + beats >= 4) barE++;
  }
  // the theme circles the room: each note from the next tower, clockwise
  const melE = [...THEME.map(([b, n, d]) => [24, b, n, d]), ...THEME2.map(([b, n, d]) => [26, b, n, d]),
    [28, 0, 81, 1], [28, 1, 83, 1], [28, 2, 85, 1], [28, 3, 86, 1], [29, 0, 88, 2], [29, 2, 86, 1], [29, 3, 85, 1], [30, 0, 86, 4]];
  melE.forEach(([bar, b, n, d], i) => {
    const spk = SPK[i % 4];
    add(T.t(bar, b), 'lead', { spk, n, dur: d * B * 1.05, vel: 0.62 + (bar >= 28 ? 0.08 : 0), from: SPK[(i + 3) % 4], to: spk, hall: true });
  });
  // the deep B-flat: the largest ring moves into place
  add(T.t(30), 'deep', { n: 34, dur: 2.67 * 1.15, vel: 0.95 });
  add(T.t(30, 2), 'swell', { pos: { az: 0, width: 360 }, dur: 2 * B + 0.2, vel: 0.75 });
  for (let k = 0; k < 8; k++) add(T.t(30, 2 + k * 0.25), 'box', { spk: SPK[k % 4], n: [70, 74, 77, 81, 82, 86, 89, 93][k], dur: 0.4, vel: 0.35 + k * 0.03, short: true, from: SPK[(k + 3) % 4], to: SPK[k % 4] });

  // ------------------------------------------------------------ the luminous chord (bar 31)
  const tc = T.t(31);
  add(tc, 'resolve', { dur: 9.5, vel: 1, pad: CH.D69.pad });
  // a strum from front-left, then the same chord answered by every tower
  [50, 57, 62, 66, 69, 76, 81].forEach((n, k) => add(tc + k * 0.035, 'pluck', { spk: 'FL', n, dur: 6, vel: 0.7, strum: true }));
  [81, 88, 90].forEach((n, k) => add(tc + 0.05 * k, 'glass', { spk: 'FR', n, dur: 7.5, vel: 0.5 }));
  [86, 90, 93, 98].forEach((n, k) => add(tc + 0.11 * k, 'box', { spk: 'SR', n, dur: 1, vel: 0.45 }));
  add(tc, 'air', { spk: 'SL', n: 90, dur: 6.5, vel: 0.6, melody: true, hall: true });
  add(tc, 'hum', { spk: 'C', n: 50, dur: 7.5, vel: 0.7 });
  add(tc, 'hum', { spk: 'C', n: 57, dur: 7.5, vel: 0.5 });
  add(tc, 'sub', { spk: 'LFE', n: 26, dur: 6, vel: 0.95, swell: false, long: true });
  [62, 69, 74].forEach((n, k) => add(tc + 0.02, 'bell', { pos: { az: [-30, 0, 30][k], dist: 4 }, n, vel: 0.55, ring: 7 + k }));
  for (let i = 0; i < 40; i++) {
    add(tc + 0.3 + i * 0.13 + rng.range(0, 0.08), 'star', { pos: { az: rng.range(-180, 180), dist: rng.range(1.1, 2.5) }, n: [86, 88, 90, 93, 95, 98][i % 6], vel: 0.3 * Math.exp(-i / 18) + 0.08 });
  }

  // ------------------------------------------------------------ F: folding back, and one more tick
  add(T.t(32.6), 'wall', { which: 'return', dur: 5, pos: { az: 0, width: 300 }, n: 38, vel: 0.45, reverse: true });
  tick(98.2, 'SL', 0.72, { last: true, dry: true });

  s.done();

  // ------------------------------------------------------------ the room's shape over time (sound + picture)
  const ease = 'inOut3';
  const c = {
    sides: new Curve([[0, 0], [T.t(17), 0], [T.t(17) + 5.2, 13, ease], [T.t(32.6) + 1.5, 13], [T.t(32.6) + 6, 0, ease]]),
    split: new Curve([[0, 0], [T.t(18.5), 0], [T.t(18.5) + 4.6, 12.5, ease], [T.t(32.6) + 1.5, 12.5], [T.t(32.6) + 6, 0, ease]]),
    front: new Curve([[0, 0], [T.t(18.5), 0], [T.t(18.5) + 4.6, 5, ease], [T.t(32.6) + 1.5, 5], [T.t(32.6) + 6, 0, ease]]),
    back: new Curve([[0, 0], [T.t(19.5), 0], [T.t(19.5) + 4.6, 12, ease], [T.t(32.6) + 1.5, 12], [T.t(32.6) + 6, 0, ease]]),
    height: new Curve([[0, 1], [T.t(20.5), 1], [T.t(20.5) + 6.5, 4.6, ease], [T.t(32.6), 4.6], [T.t(32.6) + 4.5, 1, ease]]),
    open: new Curve([[0, 0], [T.t(21.5), 0], [T.t(21.5) + 5.5, 1, ease], [T.t(32.3), 1], [T.t(32.3) + 3.5, 0, ease]]),
    ground: new Curve([[0, 0], [T.t(17), 0], [T.t(17) + 4, 1], [T.t(32.6) + 5, 1], [T.t(32.6) + 7, 0]]),
  };
  s.room = (t) => ({
    left: c.sides.at(t), right: c.sides.at(t), split: c.split.at(t), front: c.front.at(t), back: c.back.at(t),
    height: c.height.at(t), open: c.open.at(t), ground: c.ground.at(t), ceiling: 1,
  });
  s.curves = c;
  s.T = T;
  s.CH = CH;
  return s;
}
