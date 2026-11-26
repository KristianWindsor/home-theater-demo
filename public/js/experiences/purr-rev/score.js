// Purr / Rev: a hidden 40-second piece (click the sleeping cat in The Passenger).
//
//   0:00  the cat asleep on the seat, purring
//   0:04  the purr speeds up and hardens until it is an idling V10 (its pulses from ~23 to ~40 a second: the
//         idle's rhythm, one bank's firing); the whiskers become the markings of a rev counter; the seat goes red
//   0:11  a couple of blips, then one short pull through two gears
//   0:24  off the throttle: crackles, the revs fall back to idle
//   0:31  the idle slows and softens back into the purr... and the cat opens one eye
import { Score, Curve, Rng, clamp, smoothstep } from '../core/timeline.js';
import { CAR, ControlTrack, freeRev, overrunPops } from '../core/motor.js';

const DUR = 40;

export function compose() {
  const s = new Score({ duration: DUR, seed: 9 });
  const M = s.marks;
  M.morph0 = 4;
  M.morph1 = 10.5;
  M.blip1 = 11.6;
  M.blip2 = 13.1;
  M.pull = 15.0;
  M.shift1 = 17.0;
  M.shift2 = 19.6;
  M.lift = 22.2;
  M.back0 = 30.5;
  M.back1 = 36.0;
  M.eye = 36.4;
  M.end = DUR;
  s.chapter(0, 'Purr');
  s.chapter(M.morph0, 'Purr / Rev');
  s.chapter(M.pull, 'Rev');
  s.chapter(M.back0, 'Purr again');

  const ctl = new ControlTrack(DUR + 1);
  // the engine idles (silently) under the purr, so the idle is already turning when it fades in
  const idle = CAR.idle;
  const lifts = freeRev(ctl, 0, M.pull, (t) => (t >= M.blip1 && t < M.blip1 + 0.28 ? 0.6 : t >= M.blip2 && t < M.blip2 + 0.42 ? 0.9 : 0), { rpm0: idle, idle: () => idle });
  // one short pull: 1st gear to near the limiter, a crack, 2nd, a crack, 3rd, then lift
  const pull = new Curve([[M.pull, idle], [M.pull + 0.35, 3200, 'out'], [M.shift1, 8350, 'in'], [M.shift1 + 0.12, 5300, 'out'], [M.shift2, 8300, 'in'],
    [M.shift2 + 0.12, 5900, 'out'], [M.lift, 8100, 'in']]);
  ctl.write('rpm', M.pull, M.lift, (t) => pull.at(t));
  ctl.write('load', M.pull, M.lift, (t) => (Math.abs(t - M.shift1 - 0.04) < 0.05 || Math.abs(t - M.shift2 - 0.04) < 0.05 ? 0.05 : 0.95));
  ctl.write('fuel', M.pull, M.lift, (t) => (Math.abs(t - M.shift1 - 0.04) < 0.05 || Math.abs(t - M.shift2 - 0.04) < 0.05 ? 0 : 1));
  const lifts2 = freeRev(ctl, M.lift, DUR + 1, () => 0, { rpm0: 8100, idle: () => idle });
  lifts2.unshift({ t: M.lift + 0.02, rpm: 8100 });
  ctl.write('valve', 0, DUR + 1, (t) => (t > M.morph1 && t < M.back0 + 2 ? 1 : 0.2));
  const rng = new Rng(31);
  s.pops = overrunPops(lifts.concat(lifts2.slice(0, 1)), rng, { bang: 0.8 }).concat([
    { t: M.shift1 + 0.07, bank: 0, I: 0.5 }, { t: M.shift2 + 0.07, bank: 1, I: 0.45 },
  ]).sort((a, b) => a.t - b.t);
  s.shifts = [M.shift1, M.shift2];
  s.ctl = ctl;
  // how much of each we hear, and how fast the purr pulses
  s.purrLevel = new Curve([[0, 1], [M.morph0, 1], [M.morph1 - 1.2, 0.55, 'inOut'], [M.morph1 + 0.6, 0, 'in'], [M.back0 + 0.8, 0], [M.back1 - 1.5, 0.6, 'out'], [M.back1, 1], [DUR, 1]]);
  s.engineLevel = new Curve([[0, 0], [M.morph0 + 2, 0], [M.morph1, 1, 'in'], [M.back0 + 1, 1], [M.back1 - 0.6, 0, 'inOut']]);
  // the purr's pulse rate climbs to the idle's bank rhythm (rpm / 24: 40 Hz) and comes back down
  s.purrRise = new Curve([[0, 1], [M.morph0, 1], [M.morph1, (idle / 24) / 23.4, 'inOut'], [M.back0 + 0.5, (idle / 24) / 23.4], [M.back1, 1, 'inOut']]);
  s.morph = new Curve([[0, 0], [M.morph0, 0], [M.morph1, 1, 'inOut'], [M.back0, 1], [M.back1, 0, 'inOut']]);
  // breathing for the purr and the cat (slow, asleep)
  s.breaths = [];
  {
    const brng = new Rng(77);
    let t = 0, phase = 0;
    while (t < DUR + 2) {
      const d = (phase === 0 ? 1.8 : 1.5) * brng.range(0.9, 1.1);
      s.breaths.push({ t, dur: d, phase });
      t += d;
      phase ^= 1;
    }
  }
  s.breathAt = (t) => {
    const b = s.breaths;
    let i = 0;
    while (i < b.length - 1 && b[i + 1].t <= t) i++;
    const B = b[i];
    const x = clamp((t - B.t) / B.dur, 0, 1);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * x);
    return B.phase === 0 ? 1 - 2 * e : -1 + 2 * e;
  };
  void smoothstep;
  return s.done();
}
