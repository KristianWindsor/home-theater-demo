// The car in "Cold Start": a mid-engine, naturally aspirated V10 with a 7-speed dual-clutch gearbox.
// Pure, deterministic maths shared by the sound (what the engine is doing) and the picture (where the car is,
// what the rev counter shows). Everything is sampled into a ControlTrack that both sides read.
import { Rng, clamp, lerp, smoothstep } from './timeline.js';

export const CAR = {
  idle: 960,
  coldIdle: 1380,
  redline: 8500,
  limiter: 8700,
  shiftUp: 8250,
  shiftDown: 5600,
  // overall ratios (gear x final drive): top speeds at 8500 rpm of 70, 110, 150, 190, 230, 275, 320 km/h
  ratios: [15.8, 10.0, 7.37, 5.82, 4.81, 4.02, 3.45],
  wheel: 0.345, // m
  mass: 1620, // kg with driver
  cda: 0.72, // drag area (m^2)
  crr: 0.013,
  grip: 1.12, // longitudinal traction (g, all-wheel drive)
  brake: 1.32, // g
  lateral: 1.28, // g
  eff: 0.9,
};

const G = 9.81;

/** Full-load torque (N·m) of the V10: 410 at 1000 rpm, 600 at 6500, 540 at the limiter. */
export function torque(rpm) {
  const x = rpm / 1000;
  if (x < 1) return 410 * Math.max(0, x);
  if (x < 6.5) return 410 + (600 - 410) * smoothstep(1, 6.5, x);
  return 600 - (600 - 540) * clamp((x - 6.5) / 2.2, 0, 1) - (x > 8.7 ? 400 * (x - 8.7) : 0);
}

export const rpmAt = (v, gear) => ((v / CAR.wheel) * CAR.ratios[gear] * 60) / (2 * Math.PI);
export const speedAt = (rpm, gear) => (((rpm * 2 * Math.PI) / 60) * CAR.wheel) / CAR.ratios[gear];

/** Best full-throttle acceleration (m/s^2) at speed v: highest wheel force over the usable gears, traction-limited. */
export function accelAt(v) {
  let best = 0;
  for (let g = 0; g < CAR.ratios.length; g++) {
    const rpm = Math.max(CAR.idle * 1.4, rpmAt(v, g));
    if (rpm > CAR.shiftUp + 200) continue;
    const F = (torque(rpm) * CAR.ratios[g] * CAR.eff) / CAR.wheel;
    best = Math.max(best, F);
  }
  best = Math.min(best, CAR.grip * CAR.mass * G);
  const drag = 0.5 * 1.2 * CAR.cda * v * v + CAR.crr * CAR.mass * G;
  return (best - drag) / CAR.mass;
}

/**
 * A path from segments: { len } straight, { r, ang } arc (degrees, + turns right), optional flags (tunnel, pit).
 * Heading 0 drives towards -z (the screen); + turns clockwise (to +x). Sampled every ds metres.
 */
export function buildPath(segs, { ds = 1, x = 0, z = 0, heading = 0 } = {}) {
  const pts = [{ s: 0, x, z, h: heading, k: 0, flags: {} }];
  let s = 0, h = heading;
  for (const sg of segs) {
    const L = sg.len ?? (Math.abs(sg.ang) * Math.PI * sg.r) / 180;
    const k = sg.r ? Math.sign(sg.ang) / sg.r : 0;
    const n = Math.max(1, Math.ceil(L / ds));
    const d = L / n;
    for (let i = 0; i < n; i++) {
      const hm = h + (k * d) / 2;
      x += Math.sin(hm) * d;
      z -= Math.cos(hm) * d;
      h += k * d;
      s += d;
      pts.push({ s, x, z, h, k, flags: sg });
    }
  }
  return new Path(pts);
}

export class Path {
  constructor(pts) {
    this.p = pts;
    this.length = pts[pts.length - 1].s;
    this.ds = pts.length > 1 ? pts[1].s - pts[0].s : 1;
  }

  /** Interpolated point at arclength s: { x, z, h, k } (clamped to the ends). */
  at(s) {
    const p = this.p;
    if (s <= 0) return p[0];
    if (s >= this.length) return p[p.length - 1];
    // segments are not all exactly ds long: search near the estimate
    let i = Math.min(p.length - 2, Math.max(0, Math.floor(s / this.ds)));
    while (i > 0 && p[i].s > s) i--;
    while (i < p.length - 2 && p[i + 1].s < s) i++;
    const a = p[i], b = p[i + 1];
    const f = (s - a.s) / (b.s - a.s || 1);
    return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), h: lerp(a.h, b.h, f), k: f < 0.5 ? a.k : b.k, flags: b.flags };
  }

  /** World position of a point at arclength s, lateral offset u (+ = right of the direction of travel), height y. */
  point(s, u = 0, y = 0) {
    const q = this.at(s);
    return [q.x + Math.cos(q.h) * u, y, q.z + Math.sin(q.h) * u];
  }

  /** Curvature smoothed over +-w metres (what the speed limit and the racing line respond to). */
  kSmooth(s, w = 12) {
    let sum = 0, n = 0;
    for (let d = -w; d <= w; d += 2) {
      sum += this.at(s + d).k;
      n++;
    }
    return sum / n;
  }
}

/** Sampled control signals, linearly interpolated. at(name, t). */
export class ControlTrack {
  constructor(duration, rate = 200) {
    this.rate = rate;
    this.duration = duration;
    this.n = Math.ceil(duration * rate) + 2;
    this.ch = {};
  }

  channel(name, fill = 0) {
    if (!this.ch[name]) this.ch[name] = new Float32Array(this.n).fill(fill);
    return this.ch[name];
  }

  at(name, t) {
    const a = this.ch[name];
    if (!a) return 0;
    const x = clamp(t * this.rate, 0, this.n - 1.0001);
    const i = x | 0;
    return a[i] + (a[i + 1] - a[i]) * (x - i);
  }

  /** Write fn(t) into a channel over [t0, t1). */
  write(name, t0, t1, fn) {
    const a = this.channel(name);
    const i0 = Math.max(0, Math.round(t0 * this.rate)), i1 = Math.min(this.n, Math.round(t1 * this.rate));
    for (let i = i0; i < i1; i++) a[i] = fn(i / this.rate);
  }

  index(t) {
    return clamp(Math.round(t * this.rate), 0, this.n - 1);
  }
}

/**
 * A free-revving engine (clutch open): rpm follows the throttle with the inertia of a light, high-revving V10.
 * throttle: fn(t) 0..1. Writes rpm, load, fuel into the track over [t0, t1) starting from rpm0.
 * Returns the overrun moments (lift-offs from high rpm) so the caller can add pops.
 */
export function freeRev(track, t0, t1, throttle, { rpm0 = CAR.idle, idle = () => CAR.idle } = {}) {
  const dt = 1 / track.rate;
  let rpm = rpm0;
  const rpmA = track.channel('rpm'), load = track.channel('load'), fuel = track.channel('fuel', 1);
  const lifts = [];
  let prevTh = 0, peak = rpm;
  for (let i = track.index(t0); i < track.index(t1); i++) {
    const t = i * dt;
    const th = clamp(throttle(t), 0, 1);
    const id = idle(t);
    if (th > 0.02) {
      // torque against inertia: fast at first, slowing near the limiter
      const target = id + th * (CAR.limiter - id);
      const rate = 26000 * th * (1 - Math.pow(Math.max(0, rpm - id) / (CAR.limiter - id + 1), 3)) + 400;
      rpm = Math.min(target, rpm + rate * dt);
      peak = Math.max(peak, rpm);
    } else {
      // friction and pumping: quick at high rpm, settling gently onto the idle
      const fall = 900 + 0.62 * Math.max(0, rpm - id);
      rpm = Math.max(id, rpm - fall * dt * (rpm > id + 400 ? 1.6 : 1));
      if (rpm < id + 30) rpm += (id - rpm) * 0.08;
    }
    if (prevTh > 0.15 && th <= 0.02 && peak > 3200) lifts.push({ t, rpm: peak });
    if (th > 0.02 && prevTh <= 0.02) peak = rpm;
    prevTh = th;
    rpmA[i] = rpm;
    // load: the engine works hard while accelerating itself, idles near 12%, cuts fuel on the overrun
    const overrun = th <= 0.02 && rpm > id + 500;
    load[i] = th > 0.02 ? 0.25 + 0.75 * th : overrun ? 0.02 : 0.12;
    fuel[i] = overrun ? 0 : 1;
  }
  return lifts;
}

/**
 * Overrun pops and crackles after lift-offs (unburnt fuel lighting in the hot exhaust). Deterministic.
 * Returns [{ t, bank, I }] with I 0..1 (1 = a real bang).
 */
export function overrunPops(lifts, rng, { until = () => Infinity, bang = 0.55, density = 1 } = {}) {
  const out = [];
  for (const L of lifts) {
    const strength = clamp((L.rpm - 3000) / 5000, 0, 1);
    let t = L.t + 0.05 + rng.range(0, 0.06);
    const end = Math.min(until(L.t), L.t + 0.6 + 1.6 * strength);
    let first = true;
    while (t < end) {
      const age = (t - L.t) / (end - L.t);
      const I = first && rng.chance(bang * strength) ? rng.range(0.75, 1) : rng.range(0.06, 0.3) * (1 - 0.6 * age) * (0.5 + strength);
      out.push({ t, bank: rng.int(0, 1), I: clamp(I, 0.05, 1) });
      first = false;
      // bursts: rapid crackle, then a gap
      t += rng.chance(0.3) ? rng.range(0.12, 0.3) : rng.range(0.018, 0.07) / density;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Lap simulation along a path: corner speed limits, a forward pass at full throttle (power and traction limited)
 * and a backward pass at the braking limit. Returns per-metre arrays: v (m/s), throttle, brake.
 */
export function speedProfile(path, { v0 = 0, vEnd = null, vCap = () => Infinity, latG = CAR.lateral, brakeG = () => CAR.brake, accelScale = () => 1 } = {}) {
  const n = Math.floor(path.length) + 1;
  const v = new Float32Array(n), lim = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(path.kSmooth(i, 10));
    lim[i] = Math.min(vCap(i), k > 1e-5 ? Math.sqrt((latG * G) / k) : 200);
  }
  v[0] = Math.min(v0, lim[0]);
  for (let i = 1; i < n; i++) v[i] = Math.min(lim[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * Math.max(0, accelAt(v[i - 1]) * accelScale(i))));
  if (vEnd !== null) v[n - 1] = Math.min(v[n - 1], vEnd);
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * brakeG(i) * G));
  const throttle = new Float32Array(n), brake = new Float32Array(n);
  for (let i = 0; i < n - 1; i++) {
    const a = (v[i + 1] * v[i + 1] - v[i] * v[i]) / 2; // m/s^2 over the next metre
    const amax = accelAt(v[i]);
    if (a < -0.4) {
      brake[i] = clamp(-a / (CAR.brake * G), 0, 1);
      throttle[i] = 0;
    } else {
      const drag = (0.5 * 1.2 * CAR.cda * v[i] * v[i] + CAR.crr * CAR.mass * G) / CAR.mass;
      // fraction of the available force needed to hold this acceleration
      const need = (a + drag) / Math.max(0.5, amax + drag);
      throttle[i] = clamp(need, 0.08, 1);
    }
  }
  throttle[n - 1] = throttle[n - 2];
  return { v, throttle, brake, lim };
}

/**
 * Drive a path: turn the per-metre speed profile into a timeline (from t0) and write the car's controls:
 *   rpm, load, fuel (ignition cuts), gear, speed, s (arclength), throttle, brake, latG
 * plus discrete events: shifts [{ t, from, to, up }] and the overrun moments (for pops).
 */
export function drive(track, path, prof, t0, { gear0 = 0, until = Infinity, s0 = 0, sStop = Infinity, vMin = 0.3, rng = new Rng(9) } = {}) {
  const dt = 1 / track.rate;
  const n = prof.v.length;
  const ch = (k, f) => track.channel(k, f);
  const rpmA = ch('rpm'), loadA = ch('load'), fuelA = ch('fuel', 1), gearA = ch('gear'), vA = ch('speed'), sA = ch('s');
  const thA = ch('throttle'), brA = ch('brake'), latA = ch('latG');
  const shifts = [];
  const lifts = [];
  let s = s0, t = t0, gear = gear0, lastShift = -1;
  let cut = 0; // remaining ignition cut (s)
  let blip = 0; // remaining downshift blip (s)
  let rpmShown = rpmAt(Math.max(0.5, prof.v[0]), gear);
  let prevTh = 1, peak = 0, lastBrake = -10;
  let i = track.index(t0);
  const iEnd = Math.min(track.n, track.index(Math.min(until, track.duration)));
  while (i < iEnd && s < n - 1 && s < sStop) {
    const k = Math.min(n - 2, Math.floor(s));
    const f = s - k;
    const v = Math.max(vMin, lerp(prof.v[k], prof.v[k + 1], f));
    const th = lerp(prof.throttle[k], prof.throttle[k + 1], f);
    const br = lerp(prof.brake[k], prof.brake[k + 1], f);
    if (br > 0.05) lastBrake = t;
    // gear choice: up at the shift point under power, down under braking (one at a time, rev-matched)
    if (t - lastShift > 0.28) {
      const r = rpmAt(v, gear);
      if (gear < CAR.ratios.length - 1 && r > CAR.shiftUp && th > 0.5) {
        shifts.push({ t, from: gear, to: gear + 1, up: true });
        gear++;
        lastShift = t;
        cut = 0.075;
      } else if (gear < CAR.ratios.length - 1 && v < 25 && th < 0.5 && br < 0.05 && t - lastBrake > 1.5 && Math.abs(v * v * path.kSmooth(s, 6)) / G < 0.3
        && r > 4300 && rpmAt(v, gear + 1) > 2400) {
        // cruising: a quiet upshift, no ignition-cut crack
        shifts.push({ t, from: gear, to: gear + 1, up: true, soft: true });
        gear++;
        lastShift = t;
      } else if (gear > 0 && br > 0.15 && r < CAR.shiftDown && rpmAt(v, gear - 1) < CAR.redline - 1100) {
        shifts.push({ t, from: gear, to: gear - 1, up: false });
        gear--;
        lastShift = t;
        blip = 0.16;
      } else if (gear > 0 && r < 2200 && rpmAt(v, gear - 1) < 6000) {
        shifts.push({ t, from: gear, to: gear - 1, up: false });
        gear--;
        lastShift = t;
        blip = 0.12;
      }
    }
    const target = Math.max(CAR.idle * 1.05, rpmAt(v, gear));
    // the rev counter can't jump: upshifts drop over ~110 ms, blips rise over ~120 ms
    const rate = target < rpmShown ? 26000 : 30000;
    rpmShown += clamp(target - rpmShown, -rate * dt, rate * dt);
    let load = 0.1 + 0.9 * Math.pow(th, 0.9);
    let fuel = 1;
    if (br > 0.05 || th < 0.1) {
      load = 0.03;
      fuel = rpmShown > 1700 ? 0 : 1; // overrun fuel cut
    }
    if (cut > 0) {
      fuel = 0;
      load = 0.05;
      cut -= dt;
    }
    if (blip > 0) {
      load = 0.55;
      fuel = 1;
      blip -= dt;
    }
    if (prevTh > 0.4 && th < 0.12) lifts.push({ t, rpm: rpmShown });
    if (th > 0.4) peak = Math.max(peak, rpmShown);
    prevTh = th;
    rpmA[i] = rpmShown;
    loadA[i] = load;
    fuelA[i] = fuel;
    gearA[i] = gear + 1;
    vA[i] = v;
    sA[i] = s;
    thA[i] = th;
    brA[i] = br;
    latA[i] = (v * v * path.kSmooth(s, 6)) / G;
    s += v * dt;
    t += dt;
    i++;
  }
  return { shifts, lifts, tEnd: t, sEnd: s, gear, rng };
}
