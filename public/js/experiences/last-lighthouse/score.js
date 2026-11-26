// The Last Lighthouse: A minor, free time.
//
//   0:00  a black ocean all around the seats, wind, the creak of the lamp turning
//   0:10  the lighthouse sends its phrase (center speaker); the lamp flashes each note. Nothing answers.
//   0:21  again. Silence.
//   0:31  a faint answer from behind you
//   0:36  then from the far left, the far right... lights on the horizon, each pulsing with its own voice
//   0:48  the conversation spreads around the room; the camera rises: the lights are a constellation on the water
//   1:12  the horizon lifts: immense structures rise out of the sea; a deep, restrained bass
//   1:24  the phrase resolves into a full choir all around you
//   1:58  the lighthouse alone again, with one light answering close by
import { Score } from '../core/timeline.js';

// the signal: a question that ends on the second degree
export const PHRASE = [[0, 0, 0.55], [0.62, 3, 0.55], [1.24, 7, 0.85], [2.18, 5, 0.5], [2.74, 2, 1.7]];

export function compose() {
  const s = new Score({ duration: 132, bpm: 60, seed: 909 });
  const rng = s.rng;
  const add = (t, inst, o) => s.add({ t, inst, ...o });
  Object.assign(s.marks, { sig1: 10, sig2: 21, first: 31.2, sig3: 36, spread: 48, lift: 72, choir: 84, after: 100, last: 118, end: 132 });
  s.chapter(0, 'Night');
  s.chapter(10, 'The signal');
  s.chapter(31.2, 'An answer');
  s.chapter(48, 'Constellation');
  s.chapter(72, 'The horizon lifts');
  s.chapter(84, 'Choir');
  s.chapter(118, 'Two lights');

  // the voices that answer: where they are (azimuth in the room / on the sea) and how they sound
  const voices = [
    { id: 'behind', az: 180, dist: 3.4, root: 64, kind: 'alto', light: [0, -1] },
    { id: 'farLeft', az: -55, dist: 3.8, root: 62, kind: 'horn', light: [-0.55, 0.012] },
    { id: 'farRight', az: 52, dist: 3.6, root: 72, kind: 'flute', light: [0.6, 0.01] },
    { id: 'rearRight', az: 128, dist: 3.0, root: 81, kind: 'soprano', light: [0, -1] },
    { id: 'rearLeft', az: -130, dist: 3.0, root: 45, kind: 'cello', light: [0, -1] },
    { id: 'front', az: -12, dist: 4.4, root: 69, kind: 'bells', light: [-0.18, 0.006] },
    { id: 'left2', az: -85, dist: 3.4, root: 57, kind: 'tenor', light: [-0.85, 0.016] },
    { id: 'right2', az: 88, dist: 3.4, root: 76, kind: 'alto', light: [0.88, 0.014] },
  ];
  s.voices = voices;
  const phrase = (t, inst, root, extra = {}) => PHRASE.forEach(([dt, iv, d], k) => add(t + dt * (extra.stretch || 1), inst, { n: root + iv, dur: d * (extra.stretch || 1), k, ...extra }));

  // the lighthouse's own signal
  [10, 21, 36, 58.5, 118.5].forEach((t, i) => phrase(t, 'signal', 69, { vel: 0.7 + (i === 1 ? 0.05 : 0), sig: i }));
  // answers
  phrase(31.2, 'answer', voices[0].root, { voice: 0, vel: 0.24, stretch: 1.15 });
  phrase(40.2, 'answer', voices[1].root, { voice: 1, vel: 0.45 });
  phrase(44.0, 'answer', voices[2].root, { voice: 2, vel: 0.45 });
  phrase(48.5, 'answer', voices[3].root, { voice: 3, vel: 0.42 });
  phrase(51.2, 'answer', voices[4].root, { voice: 4, vel: 0.5 });
  phrase(53.8, 'answer', voices[5].root, { voice: 5, vel: 0.45 });
  // everyone at once, overlapping: a canon around the room
  [[62, 6], [62.9, 7], [63.6, 1], [64.4, 2], [65.2, 3], [66.0, 4], [66.7, 0], [67.4, 5]].forEach(([t, v]) =>
    phrase(t, 'answer', voices[v].root + (v === 4 ? 0 : 0), { voice: v, vel: 0.42 }));
  // the lights appear when their voice first sings
  s.lightsOn = voices.map((v, i) => s.events.find((e) => e.inst === 'answer' && e.voice === i)?.t ?? 999);

  // the ocean and the mechanism
  for (let t = 1.5; t < 128; t += rng.range(5.5, 8.5)) add(t, 'creak', { vel: rng.range(0.3, 0.55) * (t > 72 && t < 110 ? 0.4 : 1) });

  // the horizon lifts
  add(72, 'rise', { dur: 22, vel: 0.9 });
  // the choir: F - C/E - Dm7 - Gsus4 - G - A (the question finally answered, in A major)
  const prog = [
    { t: 84, pad: [41, 53, 57, 60, 65, 69, 72], d: 3.4 },
    { t: 87.4, pad: [40, 52, 55, 60, 64, 67, 72], d: 3.4 },
    { t: 90.8, pad: [38, 50, 57, 60, 65, 69, 72], d: 3.4 },
    { t: 94.2, pad: [43, 55, 60, 62, 67, 72, 74], d: 2.6 },
    { t: 96.8, pad: [43, 55, 59, 62, 67, 71, 74], d: 2.6 },
    { t: 99.4, pad: [45, 57, 61, 64, 69, 73, 76], d: 11, last: true },
  ];
  prog.forEach((c, i) => add(c.t, 'choir', { pad: c.pad, dur: c.d + 0.3, vel: 0.5 + i * 0.04, last: !!c.last, i }));
  // the melody over the choir: the signal phrase, now completed (ends on the root)
  [[84, 69, 1.4], [85.6, 72, 1.6], [87.4, 76, 2.4], [90.8, 74, 1.6], [92.6, 72, 1.5], [94.2, 74, 2.4], [96.8, 71, 2.4], [99.4, 73, 6], [99.4, 69, 6]].forEach(([t, n, d]) =>
    add(t, 'lead', { n, dur: d, vel: 0.55 }));
  add(99.4, 'deep', { n: 33, dur: 11, vel: 0.8 });
  add(72, 'deep', { n: 33, dur: 10, vel: 0.5, swell: true });
  add(84, 'deep', { n: 29, dur: 6.6, vel: 0.55, swell: true });
  add(90.8, 'deep', { n: 26, dur: 6, vel: 0.55, swell: true });
  add(96.8, 'deep', { n: 31, dur: 2.6, vel: 0.5, swell: true });
  for (let i = 0; i < 30; i++) add(99.6 + i * 0.18 + rng.range(0, 0.1), 'bell', { n: [81, 85, 88, 93, 97][i % 5], vel: 0.3 * Math.exp(-i / 14) + 0.05, az: rng.range(-180, 180) });
  // the last exchange: the lighthouse, and one light close by on the left
  phrase(124.2, 'answer', 76, { voice: 8, vel: 0.5, close: true, az: -40, dist: 1.4 });
  return s.done();
}
