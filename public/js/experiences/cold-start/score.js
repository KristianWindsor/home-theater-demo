// Cold Start: the shared timeline. One car, one engine, one night.
//
//   0:00  a dim garage; the tubes flicker on; a relay clicks behind your right shoulder, the fuel pump primes,
//         the starter struggles through a few turns, and the V10 catches with a cold-start flare
//   0:24  two blips (pops, a bang); the roller door rises onto a night circuit
//   0:37  out of the garage, down the pit lane, onto the track: through the gears, a hairpin-ish right, kerbs,
//         a tunnel at full throttle, a fast sweeper, onto the back straight...
//   ~1:25 ...where you're now standing by the track: the car comes at you, screams past, brakes behind you and goes
//   ~1:42 back in the garage: engine off; fans, then cooling metal ticking in the silence
//
// Everything about the car (rpm, load, gear, speed, where it is) is simulated here once (core/motor.js) and read
// by the sound (audio.js), the picture and the lights (scene.js).
import { Score, Rng, Curve, clamp, smoothstep, lerp } from '../core/timeline.js';
import { CAR, buildPath, speedProfile, drive, freeRev, overrunPops, ControlTrack } from '../core/motor.js';

// the circuit, from the garage door: [segment, ...] (straights in metres, arcs: radius, degrees, + = right)
export const SEGMENTS = [
  { len: 10, name: 'garage' },
  { r: 7, ang: 90, name: 'pitIn' },
  { len: 125, name: 'pit', pit: true },
  { r: 210, ang: -18, name: 'merge1' },
  { r: 210, ang: 18, name: 'merge2' },
  { len: 420, name: 'main' },
  { r: 46, ang: 90, name: 'T1', corner: true },
  { len: 240, name: 'short' },
  { r: 230, ang: -28, name: 'T2', corner: true },
  { len: 45, name: 'preTunnel' },
  { len: 330, name: 'tunnel', tunnel: true },
  { len: 45, name: 'postTunnel' },
  { r: 175, ang: 75, name: 'T3', corner: true },
  { len: 920, name: 'back' },
  { r: 25, ang: -160, name: 'T4', corner: true },
  { len: 520, name: 'exit' },
];

const DUR = 156;

export function compose() {
  const s = new Score({ duration: DUR, seed: 1987 });
  const rng = s.rng;
  const M = s.marks;
  const ctl = new ControlTrack(DUR + 2);
  const path = buildPath(SEGMENTS, { ds: 1 });
  // where each named segment starts and ends along the path
  const segAt = {};
  {
    let acc = 0;
    for (const sg of SEGMENTS) {
      const L = sg.len ?? (Math.abs(sg.ang) * Math.PI * sg.r) / 180;
      segAt[sg.name] = { s0: acc, s1: acc + L, sg };
      acc += L;
    }
  }
  s.segAt = segAt;
  s.path = path;

  // ------------------------------------------------------------ act 1: the garage
  M.tubes = 1.6;
  M.keyOn = 5.5;
  M.pump = 5.75;
  M.sweep = 6.0;
  M.crank = 8.6;
  M.catch = 10.9;
  M.blip1 = 24.0;
  M.blip2 = 27.2;
  M.door = 31.0;
  M.doorOpen = 36.4;
  M.rollout = 37.2;
  s.chapter(0, 'The garage');
  s.chapter(M.keyOn, 'Key on');
  s.chapter(M.catch, 'Cold start');
  s.chapter(M.door, 'The door');
  s.chapter(M.rollout, 'Out');

  const engineOff = (t0, t1) => {
    ctl.write('rpm', t0, t1, () => 0);
    ctl.write('fuel', t0, t1, () => 0);
    ctl.write('load', t0, t1, () => 0);
  };
  engineOff(0, M.crank);
  // the starter: ~205 rpm, flagging a little; two false catches before it fires
  ctl.write('crank', M.crank, M.catch, () => 1);
  ctl.write('rpm', M.crank, M.catch, (t) => 215 - 22 * (t - M.crank) / (M.catch - M.crank) + 6 * Math.sin(t * 3.1));
  ctl.write('load', M.crank, M.catch, () => 0.35);
  ctl.write('fuel', M.crank, M.catch, () => 0.4);
  // catch: a flare to ~2900, settling to a high cold idle that slowly comes down
  const idleCold = new Curve([[M.catch, 260], [M.catch + 0.45, 2900, 'out'], [M.catch + 1.9, 1700, 'inOut'], [M.catch + 4.2, 1390, 'out'], [M.blip1, 1300], [M.rollout, 1210]]);
  ctl.write('rpm', M.catch, M.blip1 - 0.5, (t) => idleCold.at(t));
  ctl.write('load', M.catch, M.blip1 - 0.5, (t) => (t < M.catch + 0.5 ? 0.75 : t < M.catch + 1.6 ? 0.3 : 0.17));
  ctl.write('fuel', M.catch, M.blip1 - 0.5, () => 1);
  const blips = (t) => {
    if (t >= M.blip1 && t < M.blip1 + 0.32) return 0.62;
    if (t >= M.blip2 && t < M.blip2 + 0.56) return 1;
    return 0;
  };
  const lifts = freeRev(ctl, M.blip1 - 0.5, M.rollout, blips, { rpm0: idleCold.at(M.blip1 - 0.5), idle: (t) => idleCold.at(t) });

  // ------------------------------------------------------------ act 2: the drive (simulated)
  // out of the garage at walking pace, down the pit lane, a stop at the exit light, a launch-control start
  const xStop = segAt.pit.s1 - 4;
  s.xStop = xStop;
  const prof = speedProfile(path, {
    v0: 0,
    vCap: (x) => (x < 26 ? 4 + x * 0.07 : x < xStop - 1 ? 17 : x < xStop + 1 ? 0 : Infinity),
    brakeG: (x) => (x < xStop + 1 ? 0.45 : CAR.brake),
    accelScale: (x) => (x < xStop ? 0.34 : 1),
  });
  const partA = drive(ctl, path, prof, M.rollout, { gear0: 0, sStop: xStop - 0.4, vMin: 0.9 });
  M.lineStop = partA.tEnd;
  M.lcOn = M.lineStop + 1.3;
  M.launch = M.lineStop + 4.2;
  // at the line: idle, then launch control holds ~4200 rpm, stuttering against its limiter
  ctl.write('speed', M.lineStop, M.launch, () => 0);
  ctl.write('s', M.lineStop, M.launch, () => xStop);
  ctl.write('gear', M.lineStop, M.launch, () => 1);
  {
    const lrng = new Rng(55);
    let hold = 4200;
    ctl.write('rpm', M.lineStop, M.launch, (t) => {
      if (t < M.lcOn) return 1050;
      if (t < M.lcOn + 0.35) return 1050 + (4200 - 1050) * smoothstep(M.lcOn, M.lcOn + 0.35, t);
      hold += (4200 + lrng.range(-260, 160) - hold) * 0.35;
      return hold;
    });
    ctl.write('load', M.lineStop, M.launch, (t) => (t < M.lcOn ? 0.11 : 0.42));
    // the limiter's ignition cuts: short and irregular
    ctl.write('fuel', M.lineStop, M.launch, (t) => (t > M.lcOn + 0.4 && Math.sin(t * 71) + 0.6 * Math.sin(t * 167) > 0.9 ? 0 : 1));
  }
  ctl.write('spin', M.launch, M.launch + 0.7, (t) => 1 - smoothstep(M.launch + 0.1, M.launch + 0.7, t));
  const partB = drive(ctl, path, prof, M.launch, { gear0: 0, s0: xStop + 0.5, until: DUR - 30 });
  const rollout = { shifts: partA.shifts.concat(partB.shifts), lifts: partA.lifts.concat(partB.lifts) };
  s.shifts = rollout.shifts;
  // when the car reaches places along the lap
  const sCh = ctl.channel('s');
  const timeAtS = (x) => {
    const i0 = ctl.index(x > xStop ? M.launch : M.rollout);
    for (let i = i0; i < ctl.n - 1; i++) if (sCh[i] >= x && i > i0) return i / ctl.rate;
    return DUR;
  };
  s.timeAtS = timeAtS;
  M.T1 = timeAtS(segAt.T1.s0);
  M.tunnelIn = timeAtS(segAt.tunnel.s0);
  M.tunnelOut = timeAtS(segAt.tunnel.s1);
  M.T3 = timeAtS(segAt.T3.s0);
  // trackside: near the end of the back straight, just before the braking zone, on the car's right
  s.sCam = segAt.back.s1 - 235;
  M.pass = timeAtS(s.sCam);
  M.cut = timeAtS(s.sCam - 560);
  M.hairpin = timeAtS(segAt.T4.s0);
  M.fade = M.pass + 9.5;
  M.black = M.fade + 2.2;
  M.back = M.black + 1.6;
  M.off = M.back + 6.4;
  M.end = Math.min(DUR, M.off + 27);
  s.duration = M.end;
  s.chapter(M.lineStop, 'Launch control');
  s.chapter(M.launch, 'The track');
  s.chapter(M.tunnelIn, 'The tunnel');
  s.chapter(M.cut, 'Trackside');
  s.chapter(M.back, 'Back in the garage');
  s.chapter(M.off, 'Engine off');

  // kerbs: inside at the apex, outside on the exit of the two tight corners
  const kerb = (side, t, d) => ctl.write(side, t, t + d, (x) => Math.sin(Math.PI * clamp((x - t) / d, 0, 1)) ** 0.5);
  {
    const a1 = timeAtS((segAt.T1.s0 + segAt.T1.s1) / 2), e1 = timeAtS(segAt.T1.s1 + 8);
    kerb('kerbR', a1 - 0.18, 0.42);
    kerb('kerbL', e1, 0.55);
    const a4 = timeAtS((segAt.T4.s0 + segAt.T4.s1) / 2);
    kerb('kerbL', a4 - 0.2, 0.5);
  }
  // how enclosed the car is (garage 1 -> door open -> outside; the tunnel)
  ctl.write('tunnel', 0, DUR, (t) => smoothstep(M.tunnelIn - 0.25, M.tunnelIn + 0.15, t) * (1 - smoothstep(M.tunnelOut - 0.2, M.tunnelOut + 0.25, t)));

  // how cold the engine is: rough and lumpy at first, smoother as it warms (and warm when it comes back)
  ctl.write('cold', 0, DUR, (t) => (t < M.catch ? 1 : t < M.black ? clamp(1 - (t - M.catch) / 40, 0.3, 1) : 0));

  // ------------------------------------------------------------ act 3: back in the garage, then off
  ctl.write('rpm', M.black, M.off, (t) => 1000 + 25 * Math.sin(t * 2.3));
  ctl.write('load', M.black, M.off, () => 0.11);
  ctl.write('fuel', M.black, M.off, () => 1);
  ctl.write('speed', M.black, DUR, () => 0);
  ctl.write('gear', M.black, DUR, () => 0);
  ctl.write('rpm', M.off, M.off + 0.75, (t) => 1000 * Math.pow(1 - (t - M.off) / 0.75, 1.6));
  engineOff(M.off + 0.75, DUR + 2);
  ctl.write('fuel', M.off, M.off + 0.75, () => 0);
  ctl.write('load', M.off, M.off + 0.75, () => 0.05);
  // exhaust flaps: open for the cold start's drama, then following load and revs
  {
    const rpmC = ctl.channel('rpm'), loadC = ctl.channel('load'), v = ctl.channel('valve');
    for (let i = 0; i < ctl.n; i++) {
      const t = i / ctl.rate;
      const auto = loadC[i] > 0.35 || rpmC[i] > 3800 ? 1 : 0.15;
      v[i] = t >= M.catch && t < M.catch + 9 ? 1 : auto;
    }
  }

  // ------------------------------------------------------------ pops, crackles, cracks
  const prng = new Rng(4404);
  let pops = overrunPops(lifts, prng, { bang: 1, density: 1.1 });
  pops = pops.concat(overrunPops(rollout.lifts.filter((l) => l.t < M.fade), prng, { bang: 0.45 }));
  // the cold start coughs: two false catches, then a sharp first bark
  pops.push({ t: M.crank + 1.0, bank: 0, I: 0.32 }, { t: M.crank + 1.63, bank: 1, I: 0.26 }, { t: M.catch + 0.02, bank: 0, I: 0.5 });
  // a dual-clutch upshift at full throttle cuts the ignition for an instant: a crack
  for (const sh of rollout.shifts) if (sh.up && sh.from >= 1 && sh.t < M.fade) pops.push({ t: sh.t + 0.07, bank: prng.int(0, 1), I: prng.range(0.32, 0.5) });
  s.pops = pops.filter((p) => p.t < M.fade || p.t > M.back).sort((a, b) => a.t - b.t);
  M.bang = (lifts[1] || lifts[0] || { t: M.blip2 + 0.6 }).t;
  // the biggest pop after the second blip lights up the garage
  s.bangs = s.pops.filter((p) => p.I > 0.7);

  // cooling ticks: hot exhaust and brakes, fast at first, slowing down
  s.ticks = [];
  {
    const trng = new Rng(777);
    let t = M.off + 1.4;
    while (t < DUR - 2.5) {
      const x = (t - M.off) / (DUR - M.off);
      const where = trng.pick([['ex', 165, 1.4], ['ex', -165, 1.4], ['ex', 180, 1.1], ['brake', -40, 1.5], ['brake', 40, 1.5], ['brake', -140, 1.5], ['brake', 140, 1.5], ['eng', 175, 0.8]]);
      s.ticks.push({ t, kind: where[0], az: where[1] + trng.range(-8, 8), dist: where[2], vel: trng.range(0.4, 1) * (1 - 0.5 * x), freq: trng.range(2400, 5200) });
      t += trng.range(0.25, 1.1) * (1 + 7 * x * x);
    }
  }

  // ------------------------------------------------------------ where the car is (sound and picture agree)
  s.racingLine = racingLine(path, segAt);
  s.carAt = (t) => {
    const x = Math.max(0, ctl.at('s', t));
    const q = path.at(x);
    const u = s.racingLine(x);
    const du = (s.racingLine(x + 2) - s.racingLine(x - 2)) / 4;
    const p = [q.x + Math.cos(q.h) * u, 0.45, q.z + Math.sin(q.h) * u];
    return { p, h: q.h + Math.atan(du), s: x, u };
  };
  {
    const q = path.at(s.sCam);
    // stand on the car's right, 13 m off the racing line's side of the track, looking back up the straight
    s.ear = [q.x + Math.cos(q.h) * 13.5, 1.35, q.z + Math.sin(q.h) * 13.5];
    // look up the track at an angle, so the car crosses the picture as it comes past
    const far = path.at(s.sCam - 38);
    s.face = Math.atan2(far.x - s.ear[0], -(far.z - s.ear[2]));
  }
  s.ctl = ctl;
  s.CAR = CAR;
  return s.done();
}

/** The racing line: lateral offset (m, + = right) - outside on entry, inside at the apex, outside on exit. */
function racingLine(path, segAt) {
  const corners = Object.values(segAt).filter((c) => c.sg.corner).map((c) => ({ s0: c.s0, s1: c.s1, side: Math.sign(c.sg.ang), w: c.sg.r < 60 ? 3.6 : 2.6 }));
  return (x) => {
    let u = 0;
    for (const c of corners) {
      const mid = (c.s0 + c.s1) / 2;
      const half = (c.s1 - c.s0) / 2;
      const lead = 70;
      if (x < c.s0 - lead || x > c.s1 + lead) continue;
      let v;
      if (x < mid) v = lerp(-1, 1, smoothstep(c.s0 - lead * 0.6, mid, x)) * smoothstep(c.s0 - lead, c.s0 - lead * 0.6, x);
      else v = lerp(1, -1, smoothstep(mid, c.s1 + lead * 0.6, x)) * (1 - smoothstep(c.s1 + lead * 0.6, c.s1 + lead, x));
      if (half < 1) v = 0;
      u += v * c.side * c.w;
    }
    return clamp(u, -4, 4);
  };
}
