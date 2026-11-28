// The Room Wakes Up: the shared timeline. 90 BPM, D major.
//
//   A  0:00  a wooden tick behind-left, an answer front-right; the conversation finds a tempo
//   B  0:11  each tower introduces itself (FL plucked wire, FR bowed glass, SR music box, SL breath),
//            then they pass the theme around the couch, faster and faster
//   C  0:27  everyone agrees on a groove, the sub's line under it; threads of light join the speakers; the center
//            hums (it's the sound check: each speaker is named on screen as it introduces itself, see the callouts)
//      0:35  the sub's big moment, Amaze-style: a bar of build, one beat of held breath, then the drop at 0:37 (low D,
//            37 Hz, as loud as the LFE channel goes for two seconds, then a long rumbling tail); the line drives on
//   D  0:45  one luminous D chord from everything: the ceiling swings open, the walls slide out and sink into the
//            ground, the room is a floor under the stars, the threads become rings spinning over the couch
//   F  0:52  the rings fold back into the TV, the room closes, the interface returns... and at 0:57 one last tick
//            behind your left shoulder. One minute in all.
//
// Every note also lands a marble on the speaker that plays it (scene: marbles.js), and the TV shows a metronome and
// the notes to come (tv.js), both read from these events.
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
  const s = new Score({ duration: 60, bpm: 90, seed: 2026 });
  const T = s.tempo; // T.t(bar, beat)
  const B = T.beat;
  const rng = s.rng;
  const add = (t, inst, o) => s.add({ t, inst, ...o });

  s.chapter(0, 'A tick');
  s.chapter(T.t(4), 'Introductions');
  s.chapter(T.t(8), 'Around the couch');
  // the chord comes straight after the groove; the fold, the interface and the last tick follow it
  const tc = T.t(17), tFold = tc + 7.2, tLast = 57.4;
  s.chapter(T.t(10), 'The groove');
  s.chapter(T.t(13), 'The drop');
  s.chapter(tc, 'One chord');
  s.chapter(tFold, 'Folding back');
  s.mark('B', T.t(4));
  s.mark('hocket', T.t(8));
  s.mark('C', T.t(10));
  s.mark('hum', T.t(12));
  s.mark('sub', T.t(14));
  s.mark('D', tc); // the room opens with the chord
  s.mark('chord', tc);
  s.mark('F', tFold);
  s.mark('chrome', tFold + 3.3);
  s.mark('lastTick', tLast);

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
  // it's the sound check: each speaker is named as it introduces itself (the center and the sub join in the groove)
  s.callout(T.t(4), 'FL', 'plucked strings', T.bar * 0.94);
  s.callout(T.t(5), 'FR', 'bowed glass', T.bar * 0.94);
  s.callout(T.t(6), 'SR', 'music box', T.bar * 0.94);
  s.callout(T.t(7), 'SL', 'breath', T.bar * 0.94);

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
  });
  // the sub's line: in with the groove, out for the build (its ball is lifted, see marbles.js), back after the drop
  // (which lands on bar 14) and busier into the chord. [beat, length in beats, velocity, kick on it]
  const LINE = {
    10: [[0, 1.2, 0.62, 1], [1.5, 0.4, 0.42], [2, 0.9, 0.55, 1]],
    11: [[0, 1.2, 0.62, 1], [1.5, 0.4, 0.42], [2, 0.9, 0.55, 1], [3.5, 0.4, 0.4]],
    12: [[0, 1.2, 0.66, 1], [1.5, 0.4, 0.45], [2, 0.9, 0.6, 1]],
    14: [[2, 0.9, 0.62, 1], [3, 0.4, 0.45], [3.5, 0.4, 0.5]],
    15: [[0, 1.2, 0.72, 1], [1.5, 0.4, 0.5], [2, 0.9, 0.66, 1], [3.5, 0.4, 0.5]],
    16: [[0, 1.2, 0.75, 1], [1.5, 0.4, 0.52], [2, 0.9, 0.7, 1], [3, 0.4, 0.55], [3.5, 0.4, 0.6]],
  };
  progC.forEach((name, i) => {
    for (const [b, len, vel, kick] of LINE[10 + i] || []) add(T.t(10 + i, b), 'sub', { spk: 'LFE', n: CH[name].sub, dur: len * B, vel, kick: !!kick });
  });
  s.callout(T.t(10), 'LFE', 'the bass line', T.bar * 1.2);
  s.callout(T.t(12), 'FC', 'hum', T.bar * 1.3);
  s.callout(T.t(14), 'LFE', 'low D, 37 Hz', T.bar * 1.3);

  // ------------------------------------------------------------ the sub's drop (bar 14)
  // a bar of build (a tone climbing in the sub, air rising all around), one beat of held breath where the groove
  // stops, then the heavy ball lands on the subwoofer with everything it has (audio.js: riser, drop)
  const tBuild = T.t(13), tBreath = T.t(13, 3), tDrop = T.t(14);
  s.mark('build', tBuild);
  s.mark('breath', tBreath);
  s.mark('drop', tDrop);
  add(tBuild, 'riser', { spk: 'LFE', dur: tBreath - tBuild, vel: 0.8 });
  add(tDrop, 'drop', { spk: 'LFE', n: 26, dur: 9, vel: 1 });
  // the breath melody (SL)
  for (const [b, n, d] of THEME) add(T.t(12, b), 'air', { spk: 'SL', n, dur: d * B * 0.95, vel: 0.6, melody: true });
  for (const [b, n, d] of THEME2) add(T.t(14, b), 'air', { spk: 'SL', n, dur: d * B * 0.95, vel: 0.64, melody: true });
  add(T.t(16, 0), 'air', { spk: 'SL', n: 85, dur: 2 * B, vel: 0.62, melody: true });
  add(T.t(16, 2), 'air', { spk: 'SL', n: 86, dur: 6 * B, vel: 0.66, melody: true });
  add(T.t(16, 2.5), 'swell', { pos: { az: 0, width: 360 }, dur: 1.4 * B + 0.4, vel: 0.5 });

  // ------------------------------------------------------------ the luminous chord (bar 17)
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
  add(tFold, 'wall', { which: 'return', dur: 3.4, pos: { az: 0, width: 300 }, n: 38, vel: 0.4, reverse: true });
  tick(tLast, 'SL', 0.72, { last: true, dry: true });

  // the held breath before the drop: nothing starts in it, and what's ringing is cut short at it
  const held = ['tick', 'click', 'pluck', 'glass', 'box', 'air', 'hum'];
  s.events = s.events.filter((e) => !(held.includes(e.inst) && e.t >= tBreath && e.t < tDrop));
  for (const e of s.events) if (held.includes(e.inst) && e.dur && e.t < tBreath && e.t + e.dur > tBreath) e.dur = tBreath - e.t;

  s.done();

  // ------------------------------------------------------------ the room's shape over time (sound + picture)
  const ease = 'inOut3';
  // the chord swings the ceiling open, then the walls slide out and sink into the ground (the TV and the furniture stay):
  // the room becomes a floor under the stars. At the fold it all comes back the other way.
  const o0 = tc - 0.05, c0 = tFold, c1 = tFold + 3.4;
  const out = (v, t0, t1) => new Curve([[0, 0], [t0, 0], [t1, v, ease], [c0 + (t0 - o0) * 0.5, v], [c1 - (t1 - o0 - 2.6) * 0.5, 0, ease]]);
  const c = {
    open: out(1, o0, o0 + 1.3),
    sides: out(3.5, o0 + 0.2, o0 + 2.6),
    back: out(3.5, o0 + 0.2, o0 + 2.6),
    split: out(2.5, o0 + 0.2, o0 + 2.6),
    front: out(1.2, o0 + 0.2, o0 + 2.6),
    sink: out(1, o0 + 0.4, o0 + 3.0),
    height: new Curve([[0, 1]]),
    ground: new Curve([[0, 0], [o0, 0], [o0 + 0.8, 1], [c1, 1], [c1 + 0.3, 0]]),
  };
  s.room = (t) => ({
    left: c.sides.at(t), right: c.sides.at(t), split: c.split.at(t), front: c.front.at(t), back: c.back.at(t),
    height: c.height.at(t), open: c.open.at(t), sink: c.sink.at(t), ground: c.ground.at(t), ceiling: 1,
  });
  s.curves = c;
  s.T = T;
  s.CH = CH;
  return s;
}
