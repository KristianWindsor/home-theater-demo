// A Marble, Eventually: 100 BPM, A minor -> one enormous A major chord.
// One marble runs a machine; every mechanism it touches starts a loop, so the machine composes the groove.
//
//   0:03  release. It rolls off the right edge of the screen... and is heard going all the way around behind you
//   0:09  CLANG on a plate (left). Wooden steps, the pendulum starts ticking (front-left / front-right)
//   0:14  a xylophone ramp: every bounce a note, and little hammers keep the riff going
//   0:19  a funnel, a bridge of strings (the bass line), the drum (the kick), spinning glass discs (the harmony),
//         pneumatic gates (the hats) and a tube that fires it over your head
//   0:34  the long spiral down a tower built around your seat; it crosses the screen on every other downbeat
//   0:58  a quiet bridge... it slows... and taps a tiny button, dead centre
//   1:06  the whole vast machine wakes around you, catch after catch
//   1:12  one magnificent chord
//   1:30  and it dispenses another marble
import { Score } from '../core/timeline.js';

export const BPM = 100;

export function compose() {
  const s = new Score({ duration: 104, bpm: BPM, seed: 77 });
  const T = s.tempo; // bar = 2.4 s, beat = 0.6 s
  const B = T.beat;
  const rng = s.rng;
  const add = (t, inst, o) => s.add({ t, inst, ...o });
  const at = (bar, beat = 0) => T.t(bar, beat);
  Object.assign(s.marks, {
    release: 3, offscreen: 4.6, plate: at(4), pendulum: at(5), xylo: at(6), funnel: at(8), strings: at(9), drum: at(10), discs: at(11),
    tube: at(13), spiral: at(14), bridge: at(24), button: at(27, 2), wake: at(27, 2) + 0.2, chord: at(30), dispense: 89.5, end: 104,
  });
  const M = s.marks;
  s.chapter(0, 'Release');
  s.chapter(M.plate, 'Clang');
  s.chapter(M.xylo, 'The machine plays');
  s.chapter(M.spiral, 'The spiral');
  s.chapter(M.bridge, 'Eventually');
  s.chapter(M.wake, 'Everything wakes');
  s.chapter(M.chord, 'One chord');
  s.chapter(M.dispense, 'Again');

  // ------------------------------------------------------------ the marble's journey (drives sound and picture)
  // roll segments carry a room position path for the rolling sound: [[t, az, dist], ...]
  add(M.release, 'release', {});
  add(M.release + 0.05, 'roll', { dur: M.offscreen - M.release, mat: 'wood', path: [[0, -20, 1.2], [1.6, 50, 1.2]] });
  // (bearings are unwrapped: the panner takes any angle, and interpolating 180 -> 230 must not cross the front)
  const LOOP = [[0, 60, 1.2], [1.4, 110, 1.15], [2.6, 180, 1.1], [3.8, 230, 1.15], [4.95, 285, 1.2]];
  const loopAz = (x) => {
    let i = 0;
    while (i < LOOP.length - 2 && LOOP[i + 1][0] <= x) i++;
    const a = LOOP[i], b = LOOP[i + 1];
    return a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
  };
  add(M.offscreen, 'roll', { dur: M.plate - M.offscreen - 0.05, mat: 'metal', path: LOOP });
  for (let k = 0; k < 7; k++) add(M.offscreen + 0.35 + k * 0.62, 'joint', { az: loopAz(0.35 + k * 0.62), vel: 0.25, k });
  add(M.plate, 'plate', { az: -70, vel: 1 });
  [0, 0.75, 1.3].forEach((d, k) => add(M.plate + 0.55 + d, 'step', { az: -62 + k * 10, n: [64, 62, 60][k], vel: 0.6 - k * 0.08, k }));
  add(M.pendulum, 'catch', { az: -22, vel: 0.6 });

  // ------------------------------------------------------------ the groove, layer by layer
  const prog = ['Am', 'F', 'C', 'G'];
  const ROOT = { Am: 45, F: 41, C: 48, G: 43 };
  const FIFTH = { Am: 52, F: 48, C: 55, G: 50 };
  const DISC = { Am: [72, 76], F: [69, 77], C: [67, 76], G: [71, 74] };
  const RIFF = [69, 72, 76, 81, 79, 76, 72, 74, 76, 79, 76, 72, 74, 72, 71, 67];
  const lastGrooveBar = 26; // the bridge thins everything out
  for (let bar = 5; bar < 27; bar++) {
    const ch = prog[(bar - 6 + 400) % 4];
    const thin = bar >= 24;
    // L1 pendulum: tick-tock, front-left / front-right
    for (let b = 0; b < 4; b++) add(at(bar, b), 'tick', { spk: b % 2 ? 'FR' : 'FL', vel: (b === 0 ? 0.55 : 0.45) * (thin ? 0.8 : 1), layer: 1 });
    if (thin) continue;
    // L2 xylophone riff (the marble plays the first two bars itself)
    if (bar >= 6) {
      for (let k = 0; k < 8; k++) {
        const n = RIFF[((bar - 6) % 2) * 8 + k];
        const byMarble = bar < 8;
        const key = ((bar - 6) % 2) * 8 + k; // sixteen keys across the front, one per note of the riff
        add(at(bar, k * 0.5), 'xylo', { n, vel: byMarble ? 0.62 : 0.42 + (k % 2 ? 0 : 0.06), az: -45 + key * 5, bar: k, key, marble: byMarble, layer: 2 });
      }
    }
    // L3 bass strings
    if (bar >= 9) {
      add(at(bar, 0), 'bass', { n: ROOT[ch], vel: 0.7, layer: 3, str: 0 });
      add(at(bar, 1.5), 'bass', { n: FIFTH[ch], vel: 0.5, layer: 3, str: 1 });
      add(at(bar, 2.5), 'bass', { n: ROOT[ch] + 12, vel: 0.45, layer: 3, str: 2 });
      add(at(bar, 3.5), 'bass', { n: FIFTH[ch], vel: 0.4, layer: 3, str: 3 });
    }
    // L4 kick: half time, then four on the floor from the spiral on
    if (bar >= 10) for (const b of bar >= 14 ? [0, 1, 2, 3] : [0, 2]) add(at(bar, b), 'kick', { vel: b === 0 ? 0.8 : 0.65, layer: 4 });
    // L5 glass discs: the harmony
    if (bar >= 11) DISC[ch].forEach((n, k) => add(at(bar, 0), 'disc', { n, dur: T.bar * 0.98, vel: 0.45, layer: 5, disc: (bar * 2 + k) % 6 }));
    // L6 pneumatic gates: air hats on the offbeats, a clack on 2 and 4
    if (bar >= 13) {
      for (let k = 0; k < 8; k++) if (k % 2) add(at(bar, k * 0.5), 'air', { vel: 0.35, az: k % 4 === 1 ? 110 : -110, layer: 6, gate: k });
      for (const b of [1, 3]) add(at(bar, b), 'clack', { vel: 0.55, layer: 6 });
    }
    // the lead over the spiral
    if (bar >= 16 && bar < 24) {
      const lead = [[[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 2]], [[0, 77, 1], [1, 76, 1], [2, 72, 1], [3, 69, 1]], [[0, 76, 3], [3, 79, 1]], [[0, 79, 1.5], [1.5, 77, 0.5], [2, 74, 2]]][(bar - 16) % 4];
      for (const [b, n, d] of lead) add(at(bar, b), 'lead', { n: n + (bar >= 20 ? 12 : 0), dur: d * B, vel: 0.55 + (bar >= 20 ? 0.08 : 0) });
    }
  }
  // the marble's own moments inside the groove
  add(M.funnel, 'whirl', { dur: B * 4, vel: 0.7 });
  [0, 0.6, 1.2, 1.8].forEach((d, k) => add(M.strings + d, 'pluckBy', { k, vel: 0.6 }));
  add(M.drum, 'boom', { vel: 1 });
  add(M.discs, 'chime', { vel: 0.7 });
  add(M.tube, 'shoot', { dur: 2.4, vel: 0.9 });
  // the spiral: five turns, each one circling the room
  // it enters behind you (where the tube lands) and passes dead centre on every other downbeat
  add(M.spiral, 'roll', { dur: M.bridge - M.spiral, mat: 'metal', spiral: 5, path: Array.from({ length: 41 }, (_, i) => [i * (M.bridge - M.spiral) / 40, (i / 40) * 5 * 360 + 180, 1.25]) });
  add(M.bridge, 'roll', { dur: M.button - M.bridge - 0.6, mat: 'wood', slow: true, path: [[0, 180, 1.2], [4, 280, 1.1], [M.button - M.bridge - 0.6, 352, 0.95]] });
  add(M.button - 0.6, 'roll', { dur: 0.6, mat: 'wood', crawl: true, path: [[0, 352, 0.95], [0.6, 360, 0.9]] });
  add(M.button, 'button', { az: 0, vel: 0.9 });

  // ------------------------------------------------------------ the machine wakes
  const N = 90;
  for (let i = 0; i < N; i++) {
    const x = i / N;
    const t = M.wake + 0.35 + 5.6 * (1 - Math.pow(1 - x, 1.8)) + rng.range(-0.05, 0.05);
    add(t, 'catch', { az: rng.range(-180, 180), vel: 0.25 + 0.45 * x, wake: true, idx: i, kind: rng.pick(['ratchet', 'latch', 'gear', 'spring']) });
  }
  add(M.wake, 'riser', { dur: M.chord - M.wake, vel: 0.9 });
  add(M.chord, 'chord', { dur: 14, vel: 1 });
  add(M.dispense + 7.6, 'plink', { vel: 0.5 });
  // the dispenser
  add(M.dispense, 'hatch', { vel: 0.7 });
  add(M.dispense + 0.9, 'release', {});
  add(M.dispense + 1.0, 'roll', { dur: 6, mat: 'wood', path: [[0, -20, 1.2], [6, 60, 1.6]], fade: true });
  void lastGrooveBar;
  return s.done();
}
