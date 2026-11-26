// The Passenger: the shared timeline. A cat quietly takes over the theater.
//
//   0:00  the ordinary room; a collar bell somewhere behind the couch, soft paws walking left to right
//   0:10  a wiggle, a jump: the cat appears on top of the backrest, looks around, hops down onto the empty seat
//   0:13  kneading, and a small purr; it turns around twice and settles into a curl
//   0:25  the purr grows; the cat falls asleep; the room goes warm and dim
//   0:39  the dream: the walls drift away; enormous strands of wool float through a warm amber void, dust glows,
//         a lullaby; the purr is the heartbeat, felt through the subwoofer
//   1:30  one ear twitches: the dream is gone; the cat lifts its head, looks at you, and asks a question ("mrrp?")
//
// The cat's movements, its breathing and the sounds it makes all come from here (scene.js poses the cat with
// catState(t); audio.js places the bell, paws, purr and chirp where it is).
import { Score, Rng, Curve, clamp, smoothstep, lerp, note, mtof } from '../core/timeline.js';

export const SEAT = [0.425, 0.447, 0.235]; // the right-hand seat cushion (room.json couch)
export const BACKREST = [0.43, 1.045, 0.64];
// curled up with its face towards the camera; awake, it turns to look at you
const SLEEP_YAW = 2.45 + Math.PI * 4;
const WAKE_YAW = 0.25 + Math.PI * 4;

const DUR = 101;

export function compose() {
  const s = new Score({ duration: DUR, bpm: 66, seed: 77 });
  const M = s.marks;
  const rng = s.rng;
  const add = (t, inst, o) => s.add({ t, inst, ...o });

  M.jingle = 3.0;
  M.walk0 = 3.4;
  M.walk1 = 9.0;
  M.turnToCouch = 9.0;
  M.wiggle = 9.55;
  M.jump1 = 10.2;
  M.land1 = 10.62;
  M.jump2 = 12.55;
  M.land2 = 12.95;
  M.knead0 = 13.4;
  M.knead1 = 19.4;
  M.turn0 = 19.6;
  M.turn1 = 23.5;
  M.settle = 23.6;
  M.settled = 25.6;
  M.dream0 = 38.5;
  M.dream = 44.0;
  M.twitch = 90.0;
  M.lift = 91.2;
  M.chirp = 94.6;
  M.blink = 96.3;
  M.down = 98.0;
  M.end = DUR;
  M.chrome = 96.5;
  s.chapter(0, 'Behind the couch');
  s.chapter(M.land2, 'The empty seat');
  s.chapter(M.settle, 'Settling in');
  s.chapter(M.dream0, 'The dream');
  s.chapter(M.twitch, 'Awake');

  // ------------------------------------------------------------ where the cat is
  const behind0 = [-1.35, 0, 1.28], behind1 = [0.46, 0, 1.14];
  s.catState = (t) => catState(t, M, behind0, behind1);

  // footfalls behind the couch (each paw lands; the bell rattles on some)
  const steps = [];
  for (let t = M.walk0; t < M.walk1; t += 0.165 + rng.range(-0.02, 0.02)) steps.push(t);
  s.steps = steps;
  for (const t of steps) {
    const x = (t - M.walk0) / (M.walk1 - M.walk0);
    const p = lerp3(behind0, behind1, x);
    add(t, 'paw', { pos: p, vel: rng.range(0.25, 0.5), surface: 'carpet' });
  }
  // turning around on the cushion
  for (let t = M.turn0 + 0.1; t < M.turn1; t += 0.24 + rng.range(-0.03, 0.03)) add(t, 'paw', { pos: SEAT, vel: rng.range(0.2, 0.4), surface: 'cushion', seat: true });
  // the bell: a first jingle in the dark, then along the walk, on the jumps, on the turns
  s.bell = [];
  s.bell.push([M.jingle, 0.55], [M.jingle + 0.06, 0.3], [M.jingle + 0.4, 0.2]);
  for (const t of steps) if (rng.chance(0.55)) s.bell.push([t + rng.range(0.01, 0.04), rng.range(0.2, 0.6)]);
  s.bell.push([M.jump1 + 0.02, 0.5], [M.land1, 0.9], [M.land1 + 0.05, 0.5], [M.land1 + 0.12, 0.25], [M.jump2, 0.4], [M.land2, 0.7], [M.land2 + 0.07, 0.4]);
  for (let t = M.turn0; t < M.turn1; t += 0.3 + rng.range(0, 0.2)) s.bell.push([t, rng.range(0.15, 0.4)]);
  s.bell.push([M.settle + 0.4, 0.25], [M.settle + 1.2, 0.18], [M.lift + 0.2, 0.35], [M.lift + 0.3, 0.2], [M.chirp - 0.1, 0.15]);
  s.bell.sort((a, b) => a[0] - b[0]);

  // ------------------------------------------------------------ breathing (sound and picture share it)
  // exhale a bit longer than inhale; slower and deeper as the cat falls asleep
  s.breaths = [];
  {
    const brng = new Rng(4242);
    let t = M.knead0 + 0.4, phase = 0;
    while (t < DUR + 2) {
      const sleep = clamp((t - M.settled) / 30, 0, 1) * (t < M.twitch ? 1 : 0.3);
      const d = (phase === 0 ? 1.3 : 1.05) * (1 + 0.55 * sleep) * brng.range(0.88, 1.14);
      s.breaths.push({ t, dur: d, phase });
      t += d;
      phase ^= 1;
    }
  }
  s.breathAt = (t) => {
    // -1 (empty) .. 1 (full); exhale empties, inhale fills
    const b = s.breaths;
    let lo = 0, hi = b.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (b[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    const B = b[lo];
    if (!B || t < B.t) return 0;
    const x = clamp((t - B.t) / B.dur, 0, 1);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * x);
    return B.phase === 0 ? 1 - 2 * e : -1 + 2 * e;
  };
  // how loud the purr is: small while kneading, a pause to turn, then growing as it settles; it stops dead
  // when the ear twitches, and comes back very softly at the end
  s.purr = new Curve([[M.knead0 + 0.3, 0], [M.knead0 + 1.2, 0.32], [M.knead1, 0.38], [M.turn0 + 0.3, 0.22], [M.turn1, 0.25], [M.settled, 0.45],
    [M.settled + 12, 0.82, 'inOut'], [M.dream, 1.0, 'inOut'], [M.twitch - 0.02, 1.0], [M.twitch + 0.06, 0], [M.down + 0.2, 0], [M.down + 1.8, 0.3, 'inOut'], [DUR, 0.25]]);
  s.sleep = new Curve([[0, 0], [M.settled, 0], [M.settled + 30, 1, 'inOut'], [M.twitch, 1], [M.twitch + 0.3, 0], [M.down + 1, 0.4]]);

  // ------------------------------------------------------------ the dream
  s.dreamAmt = new Curve([[0, 0], [M.dream0, 0], [M.dream, 1, 'inOut'], [M.twitch, 1], [M.twitch + 1.3, 0, 'out']]);
  const T = s.tempo;
  // a lullaby in F: four chords, a music-box melody that moves around the room, a hummed answer
  const prog = [
    { bass: note('F2'), pad: ['F3', 'C4', 'G4', 'A4', 'E5'] },
    { bass: note('D2'), pad: ['D3', 'A3', 'E4', 'F4', 'C5'] },
    { bass: note('Bb1'), pad: ['Bb2', 'F3', 'C4', 'D4', 'A4'] },
    { bass: note('C2'), pad: ['C3', 'G3', 'D4', 'F4', 'A4'] },
  ];
  const bar0 = Math.ceil(T.barAt(M.dream0 + 3.5));
  const bars = Math.floor(T.barAt(M.twitch - 0.5)) - bar0;
  const mel = [
    [0, 'C6', 1.5], [1.5, 'A5', 0.5], [2, 'G5', 1], [3, 'F5', 1],
    [4, 'A5', 1.5], [5.5, 'G5', 0.5], [6, 'F5', 1], [7, 'D5', 1],
    [8, 'F5', 1.5], [9.5, 'G5', 0.5], [10, 'A5', 1], [11, 'C6', 1],
    [12, 'Bb5', 1.5], [13.5, 'A5', 0.5], [14, 'G5', 2],
  ];
  for (let b = 0; b < bars; b++) {
    const ch = prog[b % 4];
    const t = T.t(bar0 + b);
    add(t, 'chord', { dur: T.bar, bass: ch.bass, pad: ch.pad.map(note), fade: b === bars - 1 });
    if (b >= 2) {
      const cycle = Math.floor((b - 2) / 4) % 2;
      const off = ((b - 2) % 4) * 4;
      for (const [beat, n, d] of mel) {
        if (beat < off || beat >= off + 4) continue;
        const nn = note(n) + (cycle ? 12 : 0);
        add(t + (beat - off) * T.beat, 'box', { n: nn, dur: d * T.beat, vel: 0.5 + 0.1 * rng.next(), az: ((b * 4 + beat) * 37) % 360 - 180 });
      }
    }
    if (b >= 6 && b % 2 === 0) add(t + T.beat * 0.5, 'hum', { n: note(prog[b % 4].pad[3]) - 12, dur: T.bar * 1.8, vel: 0.4 });
  }
  M.music0 = T.t(bar0);
  // strands of wool drifting past (soft whooshes), glints of dust
  s.strands = [];
  {
    const srng = new Rng(99);
    const cols = [[0.95, 0.82, 0.62], [0.92, 0.55, 0.55], [0.55, 0.7, 0.92], [0.7, 0.85, 0.62], [0.98, 0.9, 0.78], [0.85, 0.62, 0.85]];
    // loose loops of yarn circling the couch at different heights and distances, drifting slowly round
    for (let i = 0; i < 9; i++) {
      const R = srng.range(1.4, 4.2), loops = srng.range(0.22, 0.5);
      s.strands.push({
        col: cols[i % cols.length], r: srng.range(0.045, 0.1), R, loops, len: 2 * Math.PI * R * loops,
        cy: srng.range(0.7, 2.8), ay: srng.range(0.2, 0.7), rise: srng.range(-1.2, 1.2),
        spin: srng.range(0.008, 0.022) * (srng.chance(0.5) ? 1 : -1), fy: srng.range(0.02, 0.05), ph: srng.range(0, 6.28),
      });
    }
  }
  for (let t = M.dream + 1; t < M.twitch - 3; t += rng.range(3.5, 6.5)) add(t, 'drift', { dur: rng.range(3, 5), from: rng.range(-180, 180), sweep: rng.range(60, 160) * (rng.chance(0.5) ? 1 : -1), vel: rng.range(0.4, 0.8) });
  for (let t = M.dream; t < M.twitch - 1; t += rng.range(0.3, 1.1)) add(t, 'glint', { n: rng.pick([84, 86, 89, 91, 93, 96, 98]), az: rng.range(-180, 180), dist: rng.range(1.5, 3.5), vel: rng.range(0.1, 0.3) });
  add(M.twitch, 'flick', {});
  add(M.chirp, 'chirp', {});
  s.done();
  s.SEAT = SEAT;
  return s;
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sm = smoothstep;

/** A parabolic hop from a to b (peak `h` above the higher end) over [t0, t1]. */
function hop(t, t0, t1, a, b, h) {
  const x = clamp((t - t0) / (t1 - t0), 0, 1);
  const p = lerp3(a, b, x);
  const top = Math.max(a[1], b[1]) + h;
  // a parabola through a.y, top, b.y
  const y0 = a[1], y1 = b[1];
  const k = 4 * (top - (y0 + y1) / 2);
  p[1] = y0 + (y1 - y0) * x + k * x * (1 - x);
  return p;
}

/** The cat's rig state at time t (see core/cat.js catPose). */
export function catState(t, M, behind0, behind1) {
  const st = { t, gain: smoothstep(2.9, 3.3, t), pos: behind0.slice(), yaw: Math.PI / 2, lie: 0, loaf: 0, walk: 0, walkPh: 0, knead: 0, kneadPh: 0, headYaw: 0, headPitch: 0, headTilt: 0,
    tailUp: 0.85, tailSwish: 0, earL: 0, earR: 0, eyeL: 1, eyeR: 1, shine: 0, breath: 0, stretch: 0, crouch: 0, visible: 1 };
  // ---- the walk behind the couch
  if (t < M.walk1) {
    const x = clamp((t - M.walk0) / (M.walk1 - M.walk0), 0, 1);
    st.pos = lerp3(behind0, behind1, x);
    st.walk = sm(M.walk0 - 0.2, M.walk0 + 0.2, t) * (1 - sm(M.walk1 - 0.3, M.walk1, t));
    st.walkPh = (t - M.walk0) * 1.55;
    st.headYaw = 0.25 * Math.sin(t * 1.3);
    return st;
  }
  // ---- turn to the couch, wiggle, jump onto the backrest
  if (t < M.jump1) {
    st.pos = behind1.slice();
    st.yaw = lerp(Math.PI / 2, 0, sm(M.turnToCouch, M.turnToCouch + 0.5, t));
    st.walk = 0.5 * (1 - sm(M.turnToCouch + 0.2, M.turnToCouch + 0.5, t));
    st.walkPh = (t - M.walk0) * 1.55;
    st.crouch = sm(M.wiggle, M.wiggle + 0.25, t);
    st.pos = [st.pos[0] + 0.012 * Math.sin((t - M.wiggle) * 38) * st.crouch, 0, st.pos[2]];
    st.headPitch = -0.35 * st.crouch;
    st.tailUp = 0.85 - 0.6 * st.crouch;
    st.tailSwish = Math.sin(t * 9) * st.crouch;
    return st;
  }
  const BR = [BACKREST[0], BACKREST[1], BACKREST[2]];
  if (t < M.land1) {
    st.pos = hop(t, M.jump1, M.land1, behind1, BR, 0.12);
    st.yaw = 0;
    const x = (t - M.jump1) / (M.land1 - M.jump1);
    st.stretch = Math.sin(Math.PI * x);
    st.tailUp = 0.3;
    return st;
  }
  // ---- on the backrest: looks around, then hops down onto the seat
  if (t < M.jump2) {
    st.pos = BR.slice();
    st.yaw = 0;
    const x = t - M.land1;
    st.crouch = 0.35 * (1 - sm(0, 0.3, x)) + 0.4 * sm(M.jump2 - M.land1 - 0.35, M.jump2 - M.land1, x);
    st.headYaw = -0.7 * sm(0.3, 0.8, x) * (1 - sm(1.0, 1.5, x)) + 0.55 * sm(1.0, 1.5, x) * (1 - sm(1.6, 1.9, x));
    st.headPitch = -0.25 * sm(1.6, 1.9, x);
    st.earR = 0.4 * Math.max(0, Math.sin(x * 9)) * (x < 0.7 ? 1 : 0);
    st.tailUp = 0.75;
    st.tailSwish = 0.4 * Math.sin(t * 2.3);
    return st;
  }
  const SEATP = [SEAT[0], SEAT[1], SEAT[2]];
  if (t < M.land2) {
    st.pos = hop(t, M.jump2, M.land2, BR, SEATP, 0.05);
    st.yaw = 0;
    st.stretch = 0.6 * Math.sin(Math.PI * (t - M.jump2) / (M.land2 - M.jump2));
    st.tailUp = 0.4;
    return st;
  }
  // ---- on the seat
  st.pos = SEATP.slice();
  st.yaw = 0.45;
  st.tailUp = 0.75;
  // kneading
  const kn = sm(M.knead0, M.knead0 + 0.4, t) * (1 - sm(M.knead1 - 0.3, M.knead1, t));
  st.knead = kn;
  st.kneadPh = (t - M.knead0) * 1.1;
  st.eyeL = st.eyeR = 1 - 0.55 * kn;
  st.crouch = 0.25 * sm(M.land2, M.land2 + 0.15, t) * (1 - sm(M.land2 + 0.2, M.land2 + 0.6, t));
  // turning around twice
  if (t >= M.turn0) {
    const x = clamp((t - M.turn0) / (M.turn1 - M.turn0), 0, 1);
    const e = x * x * (3 - 2 * x);
    st.yaw = 0.45 + e * (SLEEP_YAW - 0.45);
    st.walk = 0.85 * Math.sin(Math.PI * x);
    st.walkPh = (t - M.turn0) * 2.1;
    st.pos = [SEATP[0] + Math.sin(st.yaw) * 0.025 * Math.sin(Math.PI * x), SEATP[1], SEATP[2] - Math.cos(st.yaw) * 0.025 * Math.sin(Math.PI * x)];
    st.tailUp = 0.75 - 0.35 * x;
    st.headPitch = -0.15 * Math.sin(Math.PI * x);
  }
  // settling into a curl
  if (t >= M.settle) {
    st.yaw = SLEEP_YAW;
    st.walk = 0;
    st.lie = sm(M.settle, M.settled, t);
    st.tailUp = 0.4 * (1 - st.lie);
    st.eyeL = st.eyeR = 1 - st.lie;
    st.headPitch = 0;
  }
  // ---- awake again: the head comes up, looks at you, asks, blinks slowly, goes back down
  if (t >= M.twitch) {
    const x = t - M.twitch;
    st.earL = Math.max(0, Math.sin(x * 26)) * (x < 0.3 ? 1 : 0) + Math.max(0, Math.sin((x - 0.45) * 30)) * (x > 0.45 && x < 0.6 ? 0.6 : 0);
    st.loaf = sm(M.lift, M.lift + 1.3, t) * (1 - 0.55 * sm(M.down, M.down + 2.2, t));
    // uncurling turns the face towards you
    st.yaw = lerp(SLEEP_YAW, WAKE_YAW, sm(M.lift, M.lift + 1.3, t));
    const open = sm(M.twitch + 0.4, M.twitch + 0.9, t);
    const blink = 1 - Math.sin(Math.PI * clamp((t - M.blink) / 1.1, 0, 1)) * 0.95;
    const close = 1 - sm(M.down + 0.8, M.down + 2.4, t);
    st.eyeL = open * blink * close;
    st.eyeR = sm(M.twitch + 0.9, M.twitch + 1.6, t) * blink * close;
    st.shine = 0.8 * open * close;
    st.headTilt = 0.32 * sm(M.chirp - 0.15, M.chirp + 0.1, t) * (1 - sm(M.chirp + 1.2, M.chirp + 2.0, t));
    st.headYaw = -0.25 * sm(M.lift + 0.6, M.lift + 1.4, t) * (1 - sm(M.down, M.down + 2, t));
    st.headPitch = -0.12 * sm(M.lift, M.lift + 1.2, t);
  }
  return st;
}

void mtof;
