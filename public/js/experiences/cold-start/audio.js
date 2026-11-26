// Cold Start: how it sounds. One engine (EngineCore) heard from the driver's seat (each exhaust bank behind you,
// the intake and the engine bay right behind your head, the weight of it in the subwoofer) and, for one pass, from
// the side of the track (PassBy: the sound arrives late and Doppler-shifted, louder once the exhaust faces you).
// The room around it changes: a concrete garage (strong early reflections), open night air, a tunnel.
import { EngineCore, EngineVoice, PassBy, Tyre, Wind, Relay, FuelPump, Fan, Tick, RollerDoor, Tube, Cricket, Paddle, Clunk, Drip, retarded, azFrom } from '../audio/vehicle.js';
import { Bed, Modal, Glide, SubPulse } from '../audio/instruments.js';
import { Rng, smoothstep, clamp } from '../core/timeline.js';

const sm = smoothstep;

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  const ctl = score.ctl;
  const D = score.duration;
  let seed = 1;
  const S = () => (seed = (seed * 1103515245 + 12345) >>> 0) % 100000 + 1;
  const rng = new Rng(2121);

  // which picture we're in: cockpit (garage and drive), trackside, cockpit again (garage)
  const cockpit = (t) => (t < M.cut ? 1 : 0) * (1 - sm(M.cut - 0.04, M.cut, t)) + sm(M.black, M.back, t);
  const trackside = (t) => sm(M.cut - 0.02, M.cut + 0.02, t) * (1 - sm(M.fade - 1.5, M.black, t));
  const outside = (t) => sm(M.door + 1, M.doorOpen + 1, t) * (1 - sm(M.black, M.back - 0.6, t));
  const garage = (t) => 1 - outside(t);
  const tunnel = (t) => ctl.at('tunnel', t);

  // ---------------------------------------------------------------- the spaces
  st.set('master', (t) => 0.82 * sm(0, 1.2, t) * (1 - sm(D - 3, D - 0.2, t)));
  st.set('space', (t) => clamp(outside(t) * (1 - tunnel(t)), 0, 1));
  st.set('t60A', (t) => 0.85 + 1.0 * tunnel(t));
  st.set('hfA', (t) => 0.45 + 0.15 * tunnel(t));
  st.set('revA', (t) => 0.9 + 0.6 * tunnel(t));
  st.set('t60B', (t) => (trackside(t) > 0.5 ? 2.1 : 1.3));
  st.set('revB', (t) => 0.55 + 0.6 * trackside(t));
  st.set('er', (t) => 0.95 * garage(t) + 0.95 * tunnel(t) + 0.12 * outside(t) * (1 - tunnel(t)));
  st.set('room', (t) => {
    const tn = tunnel(t);
    if (tn > 0.5) return { w: 10.5, front: -70, back: 70, h: 6.8, refl: { left: 0.88, right: 0.88, front: 0, back: 0, floor: 0.55, ceiling: 0.82 } };
    if (garage(t) > 0.02) {
      const open = sm(M.door, M.doorOpen, t) * (t < M.black ? 1 : 0);
      return { w: 6.2, front: -4.4, back: 3.4, h: 3.3, refl: { left: 0.86, right: 0.86, front: 0.82 * (1 - open), back: 0.84, floor: 0.62, ceiling: 0.7 } };
    }
    return { w: 30, front: -25, back: 25, h: 40, refl: { left: 0.08, right: 0.08, front: 0.04, back: 0.04, floor: 0.45, ceiling: 0 } };
  });

  // ---------------------------------------------------------------- the engine, from the driver's seat
  const core = new EngineCore(sr, { ctl, pops: score.pops, seed: 2024 });
  const inCar = (k) => (t) => k * cockpit(t);
  const tap = (mix, place, extra = {}) => st.play(0, () => new EngineVoice(sr, { core, t0: 0, dur: D, mix, ...extra }), place);
  // each bank's tail pipes, behind you to either side; the firewall takes the top off
  tap({ exL: 1 }, { az: -162, dist: 1.25, width: 20, gain: inCar(0.24), rev: 0.32 }, { lp: 5200, lowShelf: { f: 120, db: 3 } });
  tap({ exR: 1 }, { az: 162, dist: 1.25, width: 20, gain: inCar(0.24), rev: 0.32 }, { lp: 5200, lowShelf: { f: 120, db: 3 } });
  // the intake and the engine bay, right behind your head
  tap({ intake: 1 }, { az: 180, dist: 0.7, gain: inCar(0.34), rev: 0.18 }, { lp: 6500 });
  tap({ mech: 1, starter: 0.9 }, { az: 176, dist: 0.62, gain: inCar(0.42), rev: 0.12 });
  // the pressure of it: chest and subwoofer
  tap({ body: 1 }, { spk: 'LFE', lfe: 1, dry: 0, gain: (t) => 2.4 * cockpit(t) * (1 - 0.35 * outside(t)), rev: 0 });
  tap({ body: 1, exL: 0.08, exR: 0.08 }, { az: 180, width: 140, dist: 1, gain: inCar(0.32), rev: 0.05 }, { lp: 160 });

  // ---------------------------------------------------------------- the engine, from the side of the track
  const hear = (t) => retarded(score.carAt, score.ear, t);
  st.play(0, () => new PassBy(sr, { core, t0: 0, dur: D, carAt: score.carAt, ear: score.ear, ref: 12, ctl, maxDist: 2800, gain: 0.45,
    mix: { exL: 1, exR: 1, intake: 0.22, mech: 0.12, body: 0.5 } }), {
    path: (_, t) => {
      const q = hear(t);
      return { az: azFrom(score.ear, score.face, q.p), dist: 1, width: clamp(40 - q.r * 1.2, 0, 40) };
    },
    gain: (t) => trackside(t), rev: 0.06, lfe: 0.55,
  });
  // the same car as the stands hear it: a far-field feed for the reverb only
  st.play(0, () => new PassBy(sr, { core, t0: 0, dur: D, carAt: score.carAt, ear: score.ear, ref: 12, ctl, maxDist: 2800, gain: 0.35, diffuse: true,
    mix: { exL: 1, exR: 1, intake: 0.2, mech: 0.1, body: 0.3 } }), {
    path: (_, t) => ({ az: azFrom(score.ear, score.face, hear(t).p), dist: 1, width: 120 }),
    gain: (t) => trackside(t), dry: 0.25, rev: 1.6, space: 1,
  });

  // ---------------------------------------------------------------- the garage
  // room tone: a fridge-ish hum and the building breathing
  st.note(0, Bed, { dur: D, color: 'brown', type: 'lp', cutoff: 240, gain: (t) => 0.03 * (garage(t) + 0.3), seed: S() }, { az: 0, width: 360, dist: 1.5, rev: 0.2 });
  st.note(0, Bed, { dur: D, color: 'pink', type: 'bp', cutoff: 2300, q: 0.4, gain: (t) => 0.006 * garage(t), seed: S() }, { az: 180, width: 300, rev: 0.4 });
  // a slow drip in the back corner, until we leave
  for (let t = 0.8; t < M.door + 2; t += 2.35 + rng.range(-0.25, 0.3)) st.note(t, Drip, { freq: rng.range(1250, 1500), vel: 0.045 }, { az: -128, dist: 3.2, rev: 0.6 });
  for (let t = M.back + 2.6; t < D - 3; t += 2.5 + rng.range(-0.3, 0.3)) st.note(t, Drip, { freq: rng.range(1250, 1500), vel: 0.035 }, { az: 52, dist: 3.4, rev: 0.6 });
  // the tubes strike
  st.note(M.tubes, Tube, { dur: D - M.tubes, strikes: [0, 0.21, 0.36, 0.71], vel: 0.32, seed: S() }, { az: -32, dist: 2.3, rev: 0.4, gain: (t) => 0.25 + 0.75 * garage(t) });
  st.note(M.tubes + 1.05, Tube, { dur: D - M.tubes - 1.05, strikes: [0, 0.14, 0.62], vel: 0.28, seed: S() }, { az: 28, dist: 2.8, rev: 0.4, gain: (t) => 0.25 + 0.75 * garage(t) });
  // the cold-start flare shakes the light fittings
  for (let i = 0; i < 9; i++) {
    st.note(M.catch + 0.25 + i * 0.07 + rng.range(0, 0.03), Modal, { freq: rng.range(1900, 2600), modes: 'metalTick', t60: 0.05, hard: 0.9, vel: 0.25 * (1 - i / 9), seed: S() },
      { az: rng.pick([-32, 28]), dist: 2.4, rev: 0.4 });
  }
  // a spanner on the bench rattles along with the cold idle
  for (let t = M.catch + 4; t < M.catch + 9; t += 0.083 + rng.range(-0.01, 0.012)) {
    st.note(t, Modal, { freq: 3100 + rng.range(-150, 150), modes: 'metalTick', t60: 0.03, hard: 1, vel: 0.07 * Math.sin(Math.PI * (t - M.catch - 4) / 5), seed: S() },
      { az: -78, dist: 2.1, rev: 0.45 });
  }

  // ---------------------------------------------------------------- key on, prime, crank, catch
  st.note(M.keyOn, Relay, { vel: 0.3, seed: S() }, { az: 138, dist: 0.55, rev: 0.12 });
  st.note(M.keyOn + 0.32, Relay, { vel: 0.15, seed: S() }, { az: 150, dist: 0.7, rev: 0.12 });
  st.note(M.pump, FuelPump, { dur: 1.9, vel: 0.13, seed: S() }, { az: 172, dist: 0.85, rev: 0.15 });
  // the instruments sweep: a soft electronic rise and fall from the dashboard
  st.note(M.sweep, Glide, { f: [[0, 340], [0.65, 1220, 'out'], [1.3, 480, 'inOut']], dur: 1.35, vel: 0.12, spectrum: [1, 0, 0.2, 0, 0.08], breath: 0.002 },
    { az: 0, dist: 0.8, rev: 0.2 });
  st.note(M.crank - 0.04, Clunk, { freq: 140, vel: 0.5, seed: S() }, { az: 170, dist: 0.7, rev: 0.25 }); // the starter's pinion engaging
  // the flare: the whole garage takes the hit
  st.note(M.catch + 0.05, SubPulse, { freq: 31, dur: 1.4, vel: 0.85, drop: 0.25, texture: 0.4, seed: S() }, { spk: 'LFE', lfe: 1, dry: 0 });

  // ---------------------------------------------------------------- the door and the night outside
  st.note(M.door, RollerDoor, { dur: M.doorOpen - M.door, vel: 0.3, seed: S() }, { az: 0, dist: 3.6, width: 70, rev: 0.45 });
  const nightGain = (t) => 0.12 + 0.88 * outside(t);
  st.note(0, Bed, { dur: D, color: 'pink', type: 'lp', cutoff: 520, gain: (t) => 0.03 * nightGain(t) * (1 - tunnel(t)), seed: S() }, { az: 0, width: 360, dist: 2, rev: 0.3 });
  const crickets = [[-70, 7, 4500], [42, 9, 4700], [118, 8, 4380], [-148, 10, 4620], [165, 11, 4820], [-20, 14, 4250], [85, 12, 4950]];
  crickets.forEach(([az, dist, f], i) => {
    st.note(0.3 + i * 0.4, Cricket, { dur: D - 1, freq: f, vel: 0.02, rate: 1.1 + 0.4 * rng.next(), pulses: 3 + (i % 3), seed: S() },
      { az, dist, rev: 0.3, gain: (t) => (0.1 + 0.9 * outside(t)) * (1 - tunnel(t)) * (1 - 0.6 * cockpit(t) * sm(M.launch, M.launch + 2, t)) });
  });

  // ---------------------------------------------------------------- the drive: gearbox, tyres, air
  st.note(M.rollout - 0.15, Clunk, { freq: 105, vel: 0.55, seed: S() }, { az: 178, dist: 0.7, rev: 0.2 });
  for (const sh of score.shifts) {
    if (sh.t > M.cut) break;
    st.note(sh.t - 0.03, Paddle, { vel: 0.4, seed: S() }, { az: sh.up ? 24 : -24, dist: 0.55, rev: 0.05 });
    st.note(sh.t + 0.04, Clunk, { freq: 120, vel: sh.up ? 0.22 : 0.16, seed: S() }, { az: 180, dist: 0.8, rev: 0.05 });
  }
  const drv = (t) => cockpit(t) * (t > M.rollout - 1 && t < M.black ? 1 : 0);
  for (const [side, front, az] of [['L', true, -38], ['R', true, 38], ['L', false, -142], ['R', false, 142]]) {
    st.play(M.rollout, () => new Tyre(sr, { ctl, t0: M.rollout, dur: M.cut - M.rollout + 0.2, side, front, seed: S() }),
      { az, dist: 1.3, width: 30, gain: (t) => 0.45 * drv(t), rev: 0.15 });
  }
  st.play(M.rollout, () => new Wind(sr, { ctl, t0: M.rollout, dur: M.cut - M.rollout + 0.2, seed: S() }), { az: 0, width: 120, dist: 1.1, gain: (t) => 0.55 * drv(t), rev: 0.1 });
  st.play(M.rollout, () => new Wind(sr, { ctl, t0: M.rollout, dur: M.cut - M.rollout + 0.2, seed: S(), whistle: 1.6 }), { az: -40, dist: 0.9, gain: (t) => 0.2 * drv(t), rev: 0.05 });
  // launch: the rear tyres scrabble
  st.play(M.launch, () => new Tyre(sr, { ctl: { at: (k, t) => (k === 'speed' ? 12 : k === 'latG' ? -1.9 * ctl.at('spin', t) : 0) }, t0: M.launch, dur: 0.8, side: 'R', seed: S() }),
    { az: 180, width: 90, dist: 1.2, gain: 0.7, rev: 0.25 });

  // ---------------------------------------------------------------- trackside: the light towers hum, the air hits you
  st.note(M.cut, Bed, { dur: M.black - M.cut, color: 'pink', type: 'lp', cutoff: 380, gain: (t) => 0.04 * trackside(t + M.cut), seed: S() }, { az: 0, width: 360, dist: 2, rev: 0.4 });
  st.note(M.cut, Glide, { f: [[0, 120]], dur: M.black - M.cut, vel: 0.05, spectrum: [1, 0.6, 0.45, 0.2, 0.25, 0.1], a: [[0, 0], [0.5, 1], [M.black - M.cut - 1, 1], [M.black - M.cut, 0]] },
    { az: -48, dist: 4, rev: 0.3 });
  st.note(M.pass - 0.05, Bed, { dur: 1.5, color: 'white', type: 'lp', cutoff: (t) => 9000 * Math.exp(-t / 0.4) + 300, gain: (t) => 0.4 * Math.min(1, t / 0.03) * Math.exp(-t / 0.28), seed: S() },
    { path: (x) => ({ az: 70 + 100 * Math.min(1, x / 0.9), dist: 1.1, width: 60 }), rev: 0.2 });
  st.note(M.pass - 0.02, SubPulse, { freq: 34, dur: 0.9, vel: 0.6, drop: 0.2, texture: 0.5, seed: S() }, { spk: 'LFE', lfe: 1, dry: 0 });

  // ---------------------------------------------------------------- back in the garage: the door, off, cooling
  st.note(M.back + 0.4, RollerDoor, { dur: 5, vel: 0.2, seed: S() }, { az: 180, dist: 3.2, width: 70, rev: 0.45 });
  st.note(M.off + 0.7, Clunk, { freq: 62, vel: 0.6, seed: S() }, { az: 178, dist: 0.8, rev: 0.4 }); // the engine rocks back on a compression
  st.note(M.off + 0.05, Relay, { vel: 0.2, seed: S() }, { az: 138, dist: 0.55, rev: 0.12 });
  st.note(M.off + 1.1, Fan, { dur: 13.5, vel: 0.05, rps: 36, seed: S() }, { az: -34, dist: 1.9, rev: 0.35 });
  st.note(M.off + 1.25, Fan, { dur: 13.2, vel: 0.045, rps: 39, blades: 9, seed: S() }, { az: 34, dist: 1.9, rev: 0.35 });
  st.note(M.off + 14.7, Relay, { vel: 0.16, seed: S() }, { az: 25, dist: 1.6, rev: 0.3 });
  for (const k of score.ticks) {
    st.note(k.t, Tick, { vel: 0.18 * k.vel, freq: k.freq, seed: S() }, { az: k.az, dist: k.dist, rev: 0.5 });
  }
}
