// Beneath the Ice: a frozen lake at night, seen from above.
//
//   0:00  wind, crackling ice all around the room, bubbles rising, distant ice "singing" across the lake
//   0:38  a fracture: it starts at the front-right speaker and runs under you to behind your left shoulder,
//         branching as it goes; the ice rings for seconds afterwards
//   0:55  something enormous passes underneath: you hear the water move from the front speakers to the rear,
//         the subwoofer carries its size; you see it only because it blocks the faint blue light
//   1:15  everything stops
//   1:19  one long call from the deep, then smaller voices answer from around the room
//   1:40  the deep lights up: thousands of living lights, a whole landscape under the ice
import { Score } from '../core/timeline.js';

export function compose() {
  const s = new Score({ duration: 128, bpm: 60, seed: 4242 });
  const rng = s.rng;
  const add = (t, inst, o) => s.add({ t, inst, ...o });
  Object.assign(s.marks, { crack: 38, creature: 55, under: 66.5, stop: 75.5, call: 79, answers: 88, reveal: 100, end: 128 });
  s.chapter(0, 'The lake');
  s.chapter(38, 'Fracture');
  s.chapter(55, 'Something below');
  s.chapter(79, 'A call');
  s.chapter(100, 'The deep lights up');

  // ------------------------------------------------------------ ice life: crackles, bubbles, distant singing
  const crackleRate = (t) => (t < 4 ? 0 : t < 30 ? 1.2 + t * 0.05 : t < 38 ? 4 + (t - 30) * 1.3 : t < 55 ? 2.5 * Math.exp(-(t - 38) / 8) + 0.6 : t < 75 ? 0.3 : 0);
  for (let t = 3; t < 75; ) {
    const r = crackleRate(t);
    t += r > 0 ? -Math.log(1 - rng.next() * 0.999) / r : 0.5;
    if (r <= 0 || t >= 75) continue;
    // ice positions are on the lake plane in front of / around the camera (x right, z towards the viewer)
    const x = rng.range(-9, 9), z = rng.range(-12, 4);
    add(t, 'crackle', { x, z, vel: rng.range(0.15, 0.5), f: rng.range(2200, 6500) });
  }
  for (let t = 6; t < 74; ) {
    t += rng.range(0.6, 3.2) * (t > 55 && t < 70 ? 0.4 : 1);
    if (t >= 74) break;
    const x = rng.range(-3, 3), z = rng.range(-6, 1);
    const n = rng.int(2, 7);
    for (let k = 0; k < n; k++) add(t + k * rng.range(0.05, 0.22), 'bubble', { x: x + rng.range(-0.3, 0.3), z: z + rng.range(-0.3, 0.3), f: rng.range(350, 1300), vel: rng.range(0.25, 0.6) });
  }
  // the lake singing: long dispersive "pew" chirps travelling between distant points
  [[9, -150, 40], [15.5, 70, -60], [22, -40, 140], [27, 120, -100], [31.5, -80, 30], [34.8, 10, 160]].forEach(([t, a0, a1], i) =>
    add(t, 'sing', { a0, a1, vel: 0.35 + i * 0.05, dist: 3.5 - i * 0.2 }));
  [[12, -30], [24.5, 150], [33, 80]].forEach(([t, az]) => add(t, 'boom', { az, vel: 0.5 }));
  add(29.5, 'groan', { az: -60, dur: 3.2, vel: 0.5 });
  add(35.6, 'groan', { az: 50, dur: 2.4, vel: 0.62 });

  // ------------------------------------------------------------ the fracture (front-right -> under you -> rear-left)
  // the crack's path across the ice; az/dist describe where it sounds in the room
  const main = [[7.5, -14], [5.2, -10.5], [3.8, -7.5], [2.1, -4.6], [0.9, -2.2], [-0.4, 0.2], [-1.8, 2.6], [-3.5, 5]];
  const branchA = [[3.8, -7.5], [1.2, -9.5], [-2.6, -11.2], [-6.8, -12.5]];
  const branchB = [[0.9, -2.2], [3.4, -0.8], [6.5, 0.6]];
  s.crack = { t0: 38, speed: 9.5, paths: [main, branchA, branchB] };
  add(38, 'fracture', { vel: 1 });
  const azOf = (x, z) => (Math.atan2(x, -(z - 3.5)) * 180) / Math.PI;
  let tt = 38;
  for (let i = 1; i < main.length; i++) {
    const [x0, z0] = main[i - 1], [x1, z1] = main[i];
    tt += Math.hypot(x1 - x0, z1 - z0) / 9.5;
    const dist = Math.max(0.15, Math.hypot(x1, z1 - 3.5) / 6);
    add(tt, 'crackHead', { az: azOf(x1, z1), dist, vel: 0.85 - i * 0.04, i });
  }
  // the ice rings after the fracture
  for (let k = 0; k < 10; k++) {
    const t = 39.5 + k * 1.15 + rng.range(-0.2, 0.3);
    const a0 = rng.pick([-120, -60, 0, 60, 120]);
    add(t, 'sing', { a0, a1: a0 + rng.range(90, 200) * (k % 2 ? 1 : -1), vel: 0.55 * Math.exp(-k / 4), dist: 1.6 + k * 0.15, fast: true });
  }
  add(39.2, 'boom', { az: -110, vel: 0.85 });

  // ------------------------------------------------------------ the creature
  add(55, 'creature', { dur: 21, vel: 1 });
  s.creature = { t0: 52, t1: 80, z0: -60, z1: 55, x0: 4, x1: -6, depth: 9.5, length: 30 };

  // ------------------------------------------------------------ silence, then the calls
  add(79, 'call', { az: 0, dist: 3, vel: 0.9, kind: 'long' });
  [[88.2, -120, 1.2], [90.4, 125, 1.15], [92.6, -55, 1.3], [94.5, 60, 1.25], [96.2, 180, 1.35], [97.6, -160, 1.4]].forEach(([t, az, p], i) =>
    add(t, 'call', { az, dist: 2.2, vel: 0.55, kind: 'answer', pitch: p, i }));

  // ------------------------------------------------------------ the reveal
  const prog = [
    { t: 100, pad: [49, 56, 60, 63, 65, 68] }, // Dbmaj9
    { t: 105.5, pad: [46, 53, 56, 60, 61, 65] }, // Bbm9
    { t: 111, pad: [42, 49, 53, 56, 60, 61] }, // Gbmaj7#11
    { t: 116.5, pad: [44, 51, 56, 58, 61, 65] }, // Ab6sus
    { t: 121, pad: [49, 56, 61, 65, 68, 72], last: true }, // Db
  ];
  prog.forEach((c, i) => add(c.t, 'chord', { pad: c.pad, dur: (prog[i + 1] ? prog[i + 1].t : 128) - c.t + 1.5, vel: 0.45 + i * 0.05, last: !!c.last }));
  // the song continues, now melodic, from the creature below
  [[101.5, 68, 3], [106, 65, 2.5], [109, 72, 3.5], [113.5, 68, 3], [117.5, 70, 2.5], [121.5, 73, 5]].forEach(([t, n, d], i) =>
    add(t, 'song', { n, dur: d, vel: 0.5, az: [0, -30, 30, 0, -20, 0][i] }));
  for (let i = 0; i < 260; i++) {
    const t = 100 + Math.pow(rng.next(), 0.8) * 27;
    add(t, 'glow', { az: rng.range(-180, 180), dist: rng.range(1.1, 2.8), n: rng.pick([77, 80, 84, 85, 87, 89, 92, 96]), vel: rng.range(0.08, 0.3) * (0.4 + 0.6 * Math.min(1, (t - 100) / 8)) });
  }
  return s.done();
}
