// A Marble, Eventually: the picture. The machine is drawn in light around your seat, at the bearings the sound
// uses, so the marble you see is the marble you hear: it rolls off the right edge of the screen, circles behind
// you, drops onto a plate at your left and starts the pendulum, the xylophone, the strings, the drum and the glass
// wheel, which keep the groove going. A tube fires it over your head into a spiral built around the room; a slow
// bridge brings it to one tiny button, dead centre. Then the camera rises: the vast machine around the room wakes
// catch by catch (each one triggered down a chain from the last), the chord lights all of it, and a new marble
// drops.
import { Rng, Curve, smoothstep, clamp, lastBefore, pulse } from '../core/timeline.js';
import { Spline, LineBatch, Orbs, rgbMix, rgbMul } from '../core/gfx.js';
import { StageScene } from '../core/stage.js';
import { speakersFromRoom } from '../core/speakers.js';

const sm = smoothstep;
const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const polar = (az, r, y) => [Math.sin(az * D2R) * r, y, -Math.cos(az * D2R) * r];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const azOf = (p) => Math.atan2(p[0], -p[2]) / D2R;
const radial = (az) => [Math.sin(az * D2R), 0, -Math.cos(az * D2R)];
const tangentAz = (az) => [Math.cos(az * D2R), 0, Math.sin(az * D2R)]; // direction of increasing bearing
const UP = [0, 1, 0];
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

const C = {
  ink: [0.05, 0.14, 0.33],
  inkDim: [0.05, 0.13, 0.28],
  grid: [0.03, 0.07, 0.15],
  warm: [1.0, 0.58, 0.24],
  gold: [1.0, 0.78, 0.42],
  white: [1.0, 0.95, 0.88],
  cyan: [0.3, 0.8, 1.0],
  red: [1.0, 0.3, 0.12],
  violet: [0.7, 0.42, 1.0],
  rose: [1.0, 0.45, 0.65],
};

// brightness / reveal groups (LineBatch supports 32)
const G = { ALWAYS: 0, GRID: 1, HOME: 2, LOOP: 3, PLATE: 4, PEND: 5, XYLO: 6, FUNNEL: 7, STRINGS: 8, DRUM: 9, WHEEL: 10, TUBE: 11, SPIRAL: 12, BRIDGE: 13, GIANT: 14, MECH0: 20 };
// the machine drafts itself while the marble waits, and finishes as it starts to roll
const REVEAL = { GRID: [0, 4.2], HOME: [0, 1.4], LOOP: [0.15, 2.0], PLATE: [1.2, 3.4], PEND: [1.6, 4.0], XYLO: [2.0, 4.4], FUNNEL: [2.4, 4.6], STRINGS: [2.6, 4.8], DRUM: [2.8, 5.0], WHEEL: [3.0, 5.2], TUBE: [2.6, 5.2], SPIRAL: [2.4, 5.6], BRIDGE: [3.2, 5.8] };

// ------------------------------------------------------------------ geometry helpers
function circle(c, u, v, r, n = 48, a0 = 0, a1 = TAU) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    pts.push([c[0] + u[0] * ca + v[0] * sa, c[1] + u[1] * ca + v[1] * sa, c[2] + u[2] * ca + v[2] * sa]);
  }
  return pts;
}

function catmull(ctrl, n = 12) {
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(ctrl[ctrl.length - 1].slice());
  return out;
}

/** Arc-length parameterised polyline. */
class Poly {
  constructor(pts) {
    this.p = pts;
    this.s = [0];
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + len(sub(pts[i], pts[i - 1])));
    this.L = this.s[this.s.length - 1] || 1;
  }

  at(u) {
    const s = clamp(u, 0, 1) * this.L;
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.s[m] <= s) lo = m;
      else hi = m;
    }
    return mix(this.p[lo], this.p[hi], (s - this.s[lo]) / (this.s[hi] - this.s[lo] || 1));
  }

  slice(u0, u1, n = 24) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push(this.at(u0 + ((u1 - u0) * i) / n));
    return out;
  }

  /** Offset copy (sideways/up in the local frame) for twin rails. */
  offset(side, up) {
    return this.p.map((p, i) => {
      const a = this.p[Math.max(0, i - 1)], b = this.p[Math.min(this.p.length - 1, i + 1)];
      const t = norm(sub(b, a));
      const s = norm(cross(t, UP));
      return [p[0] + s[0] * side, p[1] + up, p[2] + s[2] * side];
    });
  }
}

const ballistic = (p0, p1, T, g = 9.8) => {
  const vy = (p1[1] - p0[1] + 0.5 * g * T * T) / T;
  return (tau) => [p0[0] + ((p1[0] - p0[0]) * tau) / T, p0[1] + vy * tau - 0.5 * g * tau * tau, p0[2] + ((p1[2] - p0[2]) * tau) / T];
};

const R = 0.11; // the marble (a large glass marble, so it reads from across the room)
const LOOP_R = 4.6;
const loopY = (az) => 4.8 - (0.6 * (az + 20)) / 300;

// ------------------------------------------------------------------ the scene
export class Scene extends StageScene {
  constructor(app, score, run) {
    super(app, score, run);
    this.M = score.marks;
    const ev = score.events;
    const of = (k) => ev.filter((e) => e.inst === k);
    this.E = {
      tick: of('tick'), xylo: of('xylo'), bass: of('bass'), pluckBy: of('pluckBy'), kick: of('kick'), disc: of('disc'), air: of('air'),
      clack: of('clack'), lead: of('lead'), joint: of('joint'), step: of('step'), wake: of('catch').filter((e) => e.wake), rolls: of('roll'),
    };
    this.E.strings = [...this.E.bass.map((e) => ({ t: e.t, k: e.str, vel: e.vel })), ...this.E.pluckBy.map((e) => ({ t: e.t, k: e.k, vel: e.vel }))].sort((a, b) => a.t - b.t);
    this.E.kicks = [...this.E.kick, { t: this.M.drum, vel: 1.3 }].sort((a, b) => a.t - b.t);
    try {
      this.spk = speakersFromRoom((app.library && app.library.room) || {});
    } catch {
      this.spk = null;
    }
  }

  async init() {
    const gl = this.gl;
    this.stat = new LineBatch(gl, 90000);
    this.dyn = new LineBatch(gl, 110000);
    this.orbs = new Orbs(gl, 2000);
    this._layout();
    this._path();
    this._mechanisms();
    this._static();
    this._cameraKeys();
  }

  // ---------------------------------------------------------------- where everything is
  _layout() {
    const L = (this.L = {});
    L.S = polar(-20, LOOP_R, loopY(-20));
    L.plate = polar(-70, 4.95, 3.85);
    L.steps = [0, 1, 2].map((k) => polar(-62 + 12 * k, 5.3 + 0.55 * k, 3.6 - 0.25 * k));
    L.piv = [0, 5.65, -7.4];
    L.pl = 3.55;
    L.pa = 45 * D2R;
    L.bobR = 0.27;
    const bobLeft = add(L.piv, [-Math.sin(L.pa) * L.pl, -Math.cos(L.pa) * L.pl, 0]);
    L.contact = add(bobLeft, [-(L.bobR + R), 0, 0]);
    L.chute = new Poly(catmull([[-2.95, 3.0, -7.0], [-3.3, 2.95, -6.6], [-3.6, 2.88, -5.6], [-3.75, 2.8, -4.6], [-3.45, 2.72, -3.6]], 10));
    // sixteen keys, one per note of the riff, across the front
    const riff = [];
    this.E.xylo.forEach((e) => {
      if (riff[e.key] === undefined) riff[e.key] = e.n;
    });
    L.keys = Array.from({ length: 16 }, (_, j) => {
      const az = -45 + 5 * j;
      const n = riff[j] ?? 72;
      return { az, n, c: polar(az, 4.3, 2.55 - 0.075 * j), len: 0.95 - (n - 67) * 0.03, col: keyCol(n) };
    });
    L.fc = polar(19, 5.5, 0);
    L.funnelY = (r) => 1.0 + 0.35 * Math.pow(clamp((r - 0.09) / 0.86, 0, 1), 0.6);
    L.strAz = [18, 12, 6, 0];
    L.railY = 0.86;
    L.dc = polar(-6, 5.6, 0);
    L.drumR = 0.85;
    L.skinY = 0.5;
    L.wc = polar(40, 5.8, 1.7);
    L.wheelR = 1.15;
    L.wRight = tangentAz(40);
    L.tube = new Poly(catmull([add(L.wc, [0, L.wheelR - 0.05, 0]), add(L.wc, [0, 1.45, 0]), polar(46, 5.0, 4.0), polar(70, 3.2, 5.2), polar(110, 1.2, 5.7), polar(150, 3.6, 5.5), polar(172, 7.0, 5.3 + R), polar(180, 9.0, 5.2 + R)], 14));
    L.spR = 9;
    L.gates = [polar(110, 6, 3.0), polar(-110, 6, 3.0)];
  }

  // ---------------------------------------------------------------- the marble's journey, as functions of time
  _path() {
    const L = this.L, M = this.M;
    const segs = (this.segs = []);
    const seg = (t0, t1, f) => segs.push({ t0, t1, f });
    const onTrack = (az) => polar(az, LOOP_R, loopY(az) + R);
    seg(-10, 3.05, () => onTrack(-20));
    const loopAz = new Curve([[3.05, -20], [4.6, 55, 'in'], [6.0, 110], [7.2, 180], [8.4, 230], [9.4, 280]]);
    seg(3.05, 9.4, (t) => onTrack(loopAz.at(t)));
    // off the end of the loop onto the plate, then down the steps to the pendulum's latch
    const hits = [[9.4, onTrack(280)], [9.6, add(L.plate, [0, R + 0.02, 0])], ...L.steps.map((s, k) => [[10.15, 10.9, 11.45][k], add(s, [0, R, 0])]), [12.0, L.contact]];
    for (let i = 0; i < hits.length - 1; i++) {
      const [t0, p0] = hits[i], [t1, p1] = hits[i + 1];
      const f = ballistic(p0, p1, t1 - t0);
      seg(t0, t1, (t) => f(t - t0));
    }
    // the chute to the xylophone
    const ch0 = add(L.chute.at(0), [0, R, 0]);
    const f1 = ballistic(L.contact, ch0, 0.18);
    seg(12.0, 12.18, (t) => f1(t - 12.0));
    seg(12.18, 14.25, (t) => {
      const x = (t - 12.18) / 2.07;
      return add(L.chute.at(x * 0.85 + x * x * 0.15), [0, R, 0]);
    });
    const keyTop = (j) => add(L.keys[j].c, [0, 0.03 + R, 0]);
    const f2 = ballistic(add(L.chute.at(1), [0, R, 0]), keyTop(0), 0.15);
    seg(14.25, 14.4, (t) => f2(t - 14.25));
    for (let j = 0; j < 15; j++) {
      const t0 = 14.4 + 0.3 * j;
      const f = ballistic(keyTop(j), keyTop(j + 1), 0.3);
      seg(t0, t0 + 0.3, (t) => f(t - t0));
    }
    // into the funnel and round
    const k15 = keyTop(15);
    const dir = norm([k15[0] - L.fc[0], 0, k15[2] - L.fc[2]]);
    const phi0 = Math.atan2(dir[2], dir[0]);
    const rimR = 0.86;
    const funnelPos = (x) => {
      const r = 0.09 + (rimR - 0.09) * Math.pow(1 - x, 1.15);
      const phi = phi0 - TAU * 2.25 * Math.pow(x, 1.2);
      return [L.fc[0] + Math.cos(phi) * r, L.funnelY(r) + R, L.fc[2] + Math.sin(phi) * r];
    };
    this.funnelPos = funnelPos;
    const f3 = ballistic(k15, funnelPos(0), 0.3);
    seg(18.9, 19.2, (t) => f3(t - 18.9));
    seg(19.2, 21.5, (t) => funnelPos((t - 19.2) / 2.3));
    // across the strings
    const railAz = (t) => 18 - (6 * (t - 21.6)) / 0.6;
    const railPos = (az) => polar(az, 5.5, L.railY + R);
    const f4 = ballistic(funnelPos(1), railPos(18), 0.1);
    seg(21.5, 21.6, (t) => f4(t - 21.5));
    seg(21.6, 23.7, (t) => railPos(railAz(t)));
    // the drum: two bounces, then up into a cup on the glass wheel
    const skin = (off) => add(L.dc, [off[0], L.skinY + R, off[1]]);
    const toWheel = norm([L.wc[0] - L.dc[0], 0, L.wc[2] - L.dc[2]]);
    const b0 = skin([0, 0]), b1 = skin([toWheel[0] * 0.3, toWheel[2] * 0.3]);
    const cup = (t) => this._cupPos(0, t);
    const hops = [[23.7, railPos(railAz(23.7))], [24.0, b0], [25.2, b1], [26.4, cup(26.4)]];
    for (let i = 0; i < hops.length - 1; i++) {
      const [t0, p0] = hops[i], [t1, p1] = hops[i + 1];
      const f = ballistic(p0, p1, t1 - t0);
      seg(t0, t1, (t) => f(t - t0));
    }
    seg(26.4, 31.2, (t) => cup(t));
    // the pneumatic tube: over your head and into the spiral behind you
    seg(31.2, 33.6, (t) => {
      const x = (t - 31.2) / 2.4;
      return add(L.tube.at(0.25 * sm(0, 1, x) + 0.75 * x), [0, 0, 0]);
    });
    const spY = (t) => 5.2 - (4.3 * (t - M.spiral)) / (M.bridge - M.spiral);
    this.spAz = (t) => 180 + 75 * (t - M.spiral);
    seg(33.6, 57.6, (t) => polar(this.spAz(t), L.spR, spY(t) + R));
    // the slow bridge, the crawl, the button
    const bridge = this.E.rolls.find((e) => e.slow);
    const crawl = this.E.rolls.find((e) => e.crawl);
    const bAz = new Curve(bridge.path.map(([x, az]) => [bridge.t + x, az]));
    const bR = new Curve([[bridge.t, 9], [bridge.t + 4, 6.5], [bridge.t + bridge.dur, 3.75]]);
    const bY = new Curve([[bridge.t, 0.9], [bridge.t + 4, 0.7], [bridge.t + bridge.dur, 0.56]]);
    // (same timing as the sound; it slows by itself as the bridge tightens towards the button)
    this.bridgeAt = (t) => polar(bAz.at(t), bR.at(t), bY.at(t) + R);
    seg(bridge.t, crawl.t, (t) => this.bridgeAt(t));
    const cEnd = crawl.t + crawl.dur;
    seg(crawl.t, cEnd, (t) => {
      const x = 1 - Math.pow(1 - (t - crawl.t) / crawl.dur, 2);
      return polar(352 + 7.2 * x, 3.75 - 0.13 * x, 0.56 + R);
    });
    const rest = polar(359.2, 3.62, 0.56 + R);
    seg(cEnd, 999, () => rest);
    L.rest = rest;
    L.bridgePath = new Poly([...Array.from({ length: 70 }, (_, i) => this.bridgeAt(bridge.t + (bridge.dur * i) / 69)), ...Array.from({ length: 6 }, (_, i) => polar(352 + 7.2 * (i / 5), 3.75 - 0.13 * (i / 5), 0.56 + R))].map((p) => [p[0], p[1] - R, p[2]]));
    const tdir = tangentAz(359.2);
    L.button = add(rest, mul(tdir, R + 0.035));
    L.buttonDir = tdir;
    // the second marble
    const m2 = this.E.rolls.find((e) => e.fade);
    this.m2 = { t: m2.t, dur: m2.dur };
    const az2 = new Curve(m2.path.map(([x, az]) => [m2.t + x, az, 'in']));
    const hop0 = add(L.S, [0, 0.95, 0]);
    const f5 = ballistic(hop0, onTrack(-20), 0.45);
    this.m2At = (t) => {
      if (t < M.dispense + 0.45) return hop0;
      if (t < m2.t - 0.1) return f5(Math.min(0.45, t - (M.dispense + 0.45)));
      if (t < m2.t) return onTrack(-20);
      if (t < m2.t + m2.dur) return onTrack(az2.at(t));
      return onTrack(60 + 13.3 * (t - m2.t - m2.dur));
    };
  }

  /** Cup k on the glass wheel at time t (marble centre). */
  _cupPos(k, t) {
    const L = this.L;
    const th = (this._wheelAngle(t) + 30 + 60 * k) * D2R;
    const r = L.wheelR - 0.05;
    return add(L.wc, add(mul(L.wRight, Math.cos(th) * r), [0, Math.sin(th) * r, 0]));
  }

  _wheelAngle(t) {
    // still until the marble arrives, then 1.25 turns (clockwise as you see it) delivering it to the tube
    const t0 = this.M.discs;
    if (t < t0) return 150;
    return 150 - (450 / 4.8) * (t - t0);
  }

  marbleAt(t) {
    const s = this.segs;
    let i = this._si || 0;
    if (i >= s.length || s[i].t0 > t) i = 0;
    while (i < s.length - 1 && s[i].t1 <= t) i++;
    this._si = i;
    return s[i].f(Math.min(Math.max(t, s[i].t0), s[i].t1));
  }

  // ---------------------------------------------------------------- the vast machine around the room
  _mechanisms() {
    const L = this.L;
    const wakes = this.E.wake;
    const N = wakes.length;
    this.mech = wakes.map((e, i) => {
      const rng = new Rng(500 + i * 7);
      const x = i / Math.max(1, N - 1);
      const dist = 13 + 31 * Math.pow(x, 0.85) + rng.range(-1.5, 1.5);
      const size = 0.9 + 2.8 * x + rng.range(0, 1.4);
      const elev = rng.next() < 0.45 ? 0 : rng.range(1.5, 4 + 12 * x);
      const hubY = elev + size + 0.4;
      const hub = polar(e.az, dist, hubY);
      const kind = e.kind;
      let u, v; // drawing plane
      if (kind === 'ratchet') {
        u = tangentAz(e.az);
        v = radial(e.az);
      } else {
        u = tangentAz(e.az + rng.range(-35, 35));
        v = UP;
      }
      const m = {
        i, t: e.t, az: e.az, dist, size, hub, kind, u, v, elev,
        speed: rng.range(0.35, 1.0) * (rng.next() < 0.5 ? -1 : 1) * (kind === 'ratchet' ? 0.8 : 1) / Math.sqrt(size),
        phase: rng.range(0, TAU),
        teeth: Math.round(10 + size * 5),
        col: rgbMix(C.gold, rng.pick([C.warm, C.rose, C.gold, C.white, C.cyan]), 0.35),
        group: G.MECH0 + Math.min(9, Math.floor((i / N) * 10)),
      };
      // the local outline, rotated each frame
      m.shape = buildShape(m, rng);
      return m;
    });
    // each one is triggered down a chain from the nearest that woke before it (the first from the button)
    this.mech.forEach((m, i) => {
      let best = -1, bd = 1e9;
      for (let j = 0; j < i; j++) {
        const d = len(sub(this.mech[j].hub, m.hub));
        if (d < bd && this.mech[j].t < m.t - 0.12) {
          bd = d;
          best = j;
        }
      }
      m.parent = best;
      const a = best >= 0 ? this.mech[best].hub : add(L.button, [0, 0.05, 0]);
      const b = m.hub;
      const sag = Math.min(3, len(sub(a, b)) * 0.06);
      const pts = [];
      for (let k = 0; k <= 20; k++) {
        const x = k / 20;
        const p = mix(a, b, x);
        p[1] -= Math.sin(Math.PI * x) * sag;
        pts.push(p);
      }
      m.chain = new Poly(pts);
      m.chainT0 = Math.max(this.M.wake, m.t - Math.min(0.5, 0.08 + m.chain.L * 0.02));
    });
  }

  // ---------------------------------------------------------------- everything that doesn't move, uploaded once
  _static() {
    const L = this.L, s = this.stat;
    s.begin();
    // a polar blueprint grid on the floor, centred on your seat
    for (let r = 2; r <= 60; r += 2) {
      const k = Math.exp(-r / 30) * (r % 10 === 0 ? 1.6 : 1);
      s.add(circle([0, 0.002, 0], [1, 0, 0], [0, 0, 1], r, Math.min(180, 24 + r * 3)), mul(C.grid, k), 0.012, G.GRID);
    }
    for (let a = 0; a < 360; a += 15) {
      const pts = [];
      for (let r = 1.2; r <= 60; r += 3) pts.push(polar(a, r, 0.002));
      s.add(pts, (u) => mul(C.grid, (a % 90 === 0 ? 1.5 : 0.8) * Math.exp(-u * 2.2)), 0.012, G.GRID);
    }
    // home: the couch you are sitting on and your speakers, to scale
    const box = (c, hx, hz, h, az, col, grp, w = 0.012) => {
      const u = tangentAz(az), v = radial(az);
      const corner = (sx, sz, y) => add(c, add(add(mul(u, sx * hx), mul(v, sz * hz)), [0, y, 0]));
      const ring = (y) => [corner(-1, -1, y), corner(1, -1, y), corner(1, 1, y), corner(-1, 1, y)];
      s.add(ring(0), col, w, grp, true);
      s.add(ring(h), col, w, grp, true);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.add([corner(sx, sz, 0), corner(sx, sz, h)], col, w, grp);
    };
    box([0, 0, 0.35], 1.05, 0.45, 0.42, 0, mul(C.ink, 0.8), G.HOME);
    box([0, 0, 0.72], 1.05, 0.12, 0.85, 0, mul(C.ink, 0.8), G.HOME);
    this.spkPos = [];
    const spk = this.spk || {};
    for (const [role, def] of Object.entries({ FL: [-30, 2.6], FR: [30, 2.6], C: [0, 2.4], SL: [-110, 2.2], SR: [110, 2.2] })) {
      const sp = spk[role] || spk[role === 'C' ? 'FC' : role];
      const az = sp && sp.az !== undefined ? sp.az : def[0];
      const d = sp && sp.dist ? sp.dist : def[1];
      const c = polar(az, d, 0);
      if (role === 'C') box(c, 0.32, 0.12, 0.22, az, mul(C.ink, 0.8), G.HOME);
      else box(c, 0.13, 0.15, 1.1, az, mul(C.ink, 0.8), G.HOME);
      this.spkPos.push({ role, p: add(c, [0, role === 'C' ? 0.11 : 0.95, 0]), az });
    }
    const lfe = spk.LFE || { az: -140, dist: 2.4 };
    const sub0 = polar(lfe.az, lfe.dist, 0);
    box(sub0, 0.36, 0.36, 0.72, lfe.az, mul(C.ink, 0.8), G.HOME);
    this.spkPos.push({ role: 'LFE', p: add(sub0, [0, 0.36, 0]), az: lfe.az });

    // the start: a ledge under a hopper of marbles, and the loop that goes all the way round you
    const ink = C.ink;
    const loopPts = [];
    for (let az = -27; az <= 282; az += 2) loopPts.push(polar(az, LOOP_R, loopY(az)));
    const loop = new Poly(loopPts);
    s.add(loop.offset(0.075, 0), ink, 0.014, G.LOOP);
    s.add(loop.offset(-0.075, 0), ink, 0.014, G.LOOP);
    for (let az = -20; az <= 280; az += 20) {
      const p = polar(az, LOOP_R, loopY(az) - 0.02);
      s.add([[p[0], 0, p[2]], p], mul(ink, 0.45), 0.008, G.LOOP);
      s.add([add(p, mul(tangentAz(az), -0.25)), p, add(p, mul(tangentAz(az), 0.25))], mul(ink, 0.45), 0.008, G.LOOP);
    }
    // the joints the marble clicks over behind you
    this.joints = this.E.joint.map((e) => ({ t: e.t, p: this.marbleAt(e.t) }));
    for (const j of this.joints) {
      const az = azOf(j.p);
      s.add(circle(sub(j.p, [0, R, 0]), radial(az), UP, 0.12, 12), mul(ink, 1.2), 0.012, G.LOOP);
    }
    // the hopper
    const hop = add(L.S, [0, 0.55, 0]);
    for (const [y, r] of [[0.2, 0.12], [0.55, 0.3], [0.95, 0.46], [1.05, 0.48]]) s.add(circle(add(hop, [0, y, 0]), [1, 0, 0], [0, 0, 1], r, 28), ink, 0.012, G.LOOP);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      s.add([add(hop, [Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12]), add(hop, [Math.cos(a) * 0.48, 1.05, Math.sin(a) * 0.48])], mul(ink, 0.7), 0.01, G.LOOP);
    }
    for (const sx of [-1, 1]) s.add([add(hop, [sx * 0.42, 0.9, 0]), [hop[0] + sx * 0.6, 0, hop[2]]], mul(ink, 0.5), 0.01, G.LOOP);
    // ledge
    const sl = L.S;
    const st = tangentAz(-20), sr = radial(-20);
    s.add([add(sl, add(mul(st, -0.45), mul(sr, -0.2))), add(sl, add(mul(st, 0.1), mul(sr, -0.2))), add(sl, add(mul(st, 0.1), mul(sr, 0.2))), add(sl, add(mul(st, -0.45), mul(sr, 0.2)))], ink, 0.014, G.LOOP, true);

    // the plate on its stand, and the steps
    const pAz = -70;
    s.add(circle(add(L.plate, [0, -0.02, 0]), tangentAz(pAz), radial(pAz), 0.55, 40), C.ink, 0.016, G.PLATE);
    for (const sx of [-1, 1]) {
      const p = add(L.plate, mul(tangentAz(pAz), sx * 0.75));
      s.add([[p[0], 0, p[2]], add(p, [0, 0.6, 0])], mul(ink, 0.7), 0.012, G.PLATE);
    }
    s.add([add(L.plate, add(mul(tangentAz(pAz), -0.75), [0, 0.6, 0])), add(L.plate, add(mul(tangentAz(pAz), 0.75), [0, 0.6, 0]))], mul(ink, 0.7), 0.012, G.PLATE);
    for (let k = 0; k < 2; k++) {
      const a = add(L.plate, mul(tangentAz(pAz), (k ? 1 : -1) * 0.55));
      s.add([a, add(L.plate, add(mul(tangentAz(pAz), (k ? 1 : -1) * 0.75), [0, 0.6, 0]))], mul(ink, 0.5), 0.01, G.PLATE);
    }
    L.steps.forEach((c, k) => {
      const az = -62 + 12 * k;
      boxLines(s, add(c, [0, -0.12, 0]), tangentAz(az), radial(az), 0.24, 0.17, 0.12, mul(C.warm, 0.45), G.PLATE);
      s.add([[c[0], 0, c[2]], add(c, [0, -0.12, 0])], mul(ink, 0.5), 0.01, G.PLATE);
    });

    // the pendulum's arch
    const P = L.piv;
    for (const sx of [-1, 1]) s.add([[sx * 3.4, 0, P[2] - 0.3], [sx * 3.4, P[1] + 0.25, P[2]], [sx * 3.4, 0, P[2] + 0.3]], ink, 0.012, G.PEND);
    s.add([[-3.6, P[1] + 0.25, P[2]], [3.6, P[1] + 0.25, P[2]]], ink, 0.012, G.PEND);
    s.add([[-3.6, P[1] + 0.4, P[2]], [3.6, P[1] + 0.4, P[2]]], mul(ink, 0.6), 0.01, G.PEND);
    for (let x = -3.4; x < 3.4; x += 0.4) s.add([[x, P[1] + 0.25, P[2]], [x + 0.2, P[1] + 0.4, P[2]], [x + 0.4, P[1] + 0.25, P[2]]], mul(ink, 0.35), 0.006, G.PEND);
    s.add(circle(add(P, [0, 0, 0.01]), [1, 0, 0], UP, L.pl + L.bobR + 0.1, 40, -Math.PI / 2 - L.pa - 0.1, -Math.PI / 2 + L.pa + 0.1), mul(ink, 0.35), 0.008, G.PEND);
    // the chute
    s.add(L.chute.offset(0.07, 0), ink, 0.012, G.PEND);
    s.add(L.chute.offset(-0.07, 0), ink, 0.012, G.PEND);
    for (let x = 0.1; x < 1; x += 0.2) {
      const p = L.chute.at(x);
      s.add([[p[0], 0, p[2]], p], mul(ink, 0.45), 0.008, G.PEND);
    }

    // the xylophone frame and keys
    const rail = (dr, dy) => L.keys.map((k) => add(polar(k.az, 4.3 + dr, 0), [0, k.c[1] + dy, 0]));
    s.add(catmull(rail(-0.28, -0.05), 4), ink, 0.012, G.XYLO);
    s.add(catmull(rail(0.28, -0.05), 4), ink, 0.012, G.XYLO);
    for (let j = 0; j < 16; j += 3) {
      const a = polar(L.keys[j].az, 4.02, 0), b = polar(L.keys[j].az, 4.58, 0);
      s.add([a, add(a, [0, L.keys[j].c[1] - 0.05, 0])], mul(ink, 0.5), 0.01, G.XYLO);
      s.add([b, add(b, [0, L.keys[j].c[1] - 0.05, 0])], mul(ink, 0.5), 0.01, G.XYLO);
    }
    L.keys.forEach((k) => {
      boxLines(s, add(k.c, [0, 0, 0]), tangentAz(k.az), radial(k.az), 0.065, k.len / 2, 0.03, mul(k.col, 0.4), G.XYLO);
      // the hammer's post
      const hp = add(k.c, mul(radial(k.az), k.len / 2 + 0.08));
      s.add([add(hp, [0, -0.05, 0]), add(hp, [0, 0.32, 0])], mul(ink, 0.6), 0.008, G.XYLO);
    });

    // the funnel
    for (const r of [0.95, 0.8, 0.62, 0.46, 0.32, 0.2, 0.09]) s.add(circle([L.fc[0], L.funnelY(r), L.fc[2]], [1, 0, 0], [0, 0, 1], r, 40), mul(C.cyan, 0.32), 0.012, G.FUNNEL);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      const pts = [];
      for (let r = 0.09; r <= 0.951; r += 0.0715) pts.push([L.fc[0] + Math.cos(a) * r, L.funnelY(r), L.fc[2] + Math.sin(a) * r]);
      s.add(pts, mul(C.cyan, 0.22), 0.008, G.FUNNEL);
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.4;
      s.add([[L.fc[0] + Math.cos(a) * 0.9, L.funnelY(0.9), L.fc[2] + Math.sin(a) * 0.9], [L.fc[0] + Math.cos(a) * 1.1, 0, L.fc[2] + Math.sin(a) * 1.1]], mul(ink, 0.5), 0.01, G.FUNNEL);
    }

    // the string bridge
    const arcAt = (r, y, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => polar(a0 + ((a1 - a0) * i) / n, r, y));
    for (const r of [4.5, 6.5]) {
      s.add(arcAt(r, 0.8, 22, -4), ink, 0.016, G.STRINGS);
      s.add(arcAt(r, 0.72, 22, -4), mul(ink, 0.6), 0.01, G.STRINGS);
      for (const az of [22, 9, -4]) s.add([polar(az, r, 0), polar(az, r, 0.8)], mul(ink, 0.5), 0.01, G.STRINGS);
    }
    s.add(arcAt(5.5, L.railY, 21, -3), mul(C.warm, 0.5), 0.012, G.STRINGS);
    for (const az of [21, -3]) s.add([polar(az, 5.5, 0), polar(az, 5.5, L.railY)], mul(ink, 0.5), 0.01, G.STRINGS);

    // the drum
    const D = L.dc;
    s.add(circle(add(D, [0, 0.01, 0]), [1, 0, 0], [0, 0, 1], L.drumR, 48), mul(C.red, 0.4), 0.014, G.DRUM);
    s.add(circle(add(D, [0, L.skinY, 0]), [1, 0, 0], [0, 0, 1], L.drumR, 48), mul(C.red, 0.6), 0.016, G.DRUM);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, b = ((k + 0.5) / 16) * TAU;
      s.add([add(D, [Math.cos(a) * L.drumR, 0.02, Math.sin(a) * L.drumR]), add(D, [Math.cos(b) * L.drumR, L.skinY, Math.sin(b) * L.drumR])], mul(C.red, 0.28), 0.008, G.DRUM);
    }

    // the glass wheel's stand and axle
    const W = L.wc, wr = L.wRight, wn = radial(40);
    for (const sx of [-1, 1]) s.add([add(add([W[0], 0, W[2]], mul(wr, sx * 0.7)), mul(wn, 0.25)), add(W, mul(wn, 0.25))], ink, 0.014, G.WHEEL);
    s.add([add(W, mul(wn, 0.25)), add(W, mul(wn, -0.1))], ink, 0.014, G.WHEEL);

    // the tube (a glass pipe: rails and rings)
    const tube = L.tube;
    for (const [a, b] of [[0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]]) s.add(tube.offset(a, b), mul(C.cyan, 0.28), 0.008, G.TUBE);
    this.tubeRings = [];
    for (let x = 0.0; x <= 1.0001; x += 0.0125) {
      const p = tube.at(x);
      const tg = norm(sub(tube.at(Math.min(1, x + 0.003)), tube.at(Math.max(0, x - 0.003))));
      const a = norm(cross(tg, Math.abs(tg[1]) > 0.9 ? [1, 0, 0] : UP));
      const b = cross(tg, a);
      this.tubeRings.push({ x, p, a, b });
      s.add(circle(p, a, b, 0.13, 14), mul(C.cyan, 0.32), 0.008, G.TUBE);
    }
    // its supports
    for (const x of [0.12, 0.3, 0.75, 0.9]) {
      const p = tube.at(x);
      s.add([[p[0], 0, p[2]], p], mul(ink, 0.4), 0.008, G.TUBE);
    }
    // the gates (air valves) at your sides
    for (const gp of L.gates) {
      boxLines(s, gp, tangentAz(azOf(gp)), radial(azOf(gp)), 0.25, 0.25, 0.4, mul(C.white, 0.25), G.TUBE);
      s.add([[gp[0], 0, gp[2]], gp], mul(ink, 0.4), 0.01, G.TUBE);
    }

    // the spiral tower round the room
    const spR = L.spR;
    for (const dr of [-0.08, 0.08]) {
      const pts = [];
      for (let a = 180; a <= 180 + 1800 + 10; a += 4) {
        const t = this.M.spiral + (a - 180) / 75;
        pts.push(polar(a, spR + dr, 5.2 - (4.3 * (t - this.M.spiral)) / (this.M.bridge - this.M.spiral)));
      }
      s.add(pts, mul(C.gold, 0.2), 0.011, G.SPIRAL);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 360 + 15;
      const p0 = polar(a, spR + 0.35, 0), p1 = polar(a, spR + 0.35, 5.9);
      s.add([p0, p1], mul(ink, 0.45), 0.01, G.SPIRAL);
      // brackets to the rail at every turn
      for (let turn = 0; turn < 5; turn++) {
        const aa = a + 360 * turn + (a < 180 ? 360 : 0);
        const t = this.M.spiral + (aa - 180) / 75;
        if (t < this.M.spiral || t > this.M.bridge) continue;
        const y = 5.2 - (4.3 * (t - this.M.spiral)) / (this.M.bridge - this.M.spiral);
        s.add([polar(a, spR + 0.35, y - 0.05), polar(a, spR + 0.05, y - 0.05)], mul(ink, 0.35), 0.008, G.SPIRAL);
      }
    }
    s.add(circle([0, 5.9, 0], [1, 0, 0], [0, 0, 1], spR + 0.35, 120), mul(ink, 0.4), 0.01, G.SPIRAL);

    // the bridge and the button's block
    const bp = L.bridgePath;
    s.add(bp.offset(0.06, 0), mul(C.warm, 0.22), 0.008, G.BRIDGE);
    s.add(bp.offset(-0.06, 0), mul(C.warm, 0.22), 0.008, G.BRIDGE);
    for (let x = 0.02; x < 0.98; x += 0.035) {
      const p = bp.at(x);
      s.add([[p[0], 0, p[2]], p], mul(ink, 0.35), 0.008, G.BRIDGE);
    }
    const bd = L.buttonDir;
    boxLines(s, add(L.button, add(mul(bd, 0.09), [0, -0.17, 0])), bd, radial(359.2), 0.07, 0.1, 0.3, mul(C.ink, 0.9), G.BRIDGE);

    // stands and towers for the vast machine (lit with their wave)
    for (const m of this.mech) {
      const base = [m.hub[0], 0, m.hub[2]];
      const below = add(m.hub, [0, -m.size * (m.kind === 'ratchet' ? 0.1 : 0.75), 0]);
      if (m.elev > 0.5) {
        const w = 0.25 + m.size * 0.12;
        const u = tangentAz(m.az), v = radial(m.az);
        const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(mul(u, a * w), mul(v, b * w)));
        for (const l of legs) s.add([add(base, l), add([base[0], below[1], base[2]], l)], mul(m.col, 0.4), 0.02, m.group);
        const h = below[1];
        for (let y = 0; y < h - 0.6; y += 1.2) {
          s.add([add([base[0], y, base[2]], legs[0]), add([base[0], y + 1.2, base[2]], legs[1]), add([base[0], y + 1.2, base[2]], legs[2]), add([base[0], y, base[2]], legs[3]), add([base[0], y, base[2]], legs[0])], mul(m.col, 0.18), 0.012, m.group);
        }
        s.add([add([base[0], h, base[2]], legs[0]), add([base[0], h, base[2]], legs[1]), add([base[0], h, base[2]], legs[2]), add([base[0], h, base[2]], legs[3])], mul(m.col, 0.35), 0.015, m.group, true);
        s.add([[base[0], h, base[2]], m.hub], mul(m.col, 0.4), 0.02, m.group);
      } else {
        const u = m.kind === 'ratchet' ? tangentAz(m.az) : m.u;
        s.add([add(base, mul(u, -m.size * 0.7)), m.hub, add(base, mul(u, m.size * 0.7))], mul(m.col, 0.4), 0.02, m.group);
      }
    }
    this.stat.dirty = true;
  }

  // ---------------------------------------------------------------- the camera
  _cameraKeys() {
    const K = (t, eye, tgt, fov, hold) => ({ t, v: [...eye, ...tgt, fov], hold });
    const L = this.L;
    this.cam = new Spline([
      K(0, [-0.75, 3.55, -1.1], add(L.S, [0, 0.2, 0]), 0.6, true),
      K(2.6, [-0.55, 3.25, -0.55], add(L.S, [0.1, 0.1, 0]), 0.7),
      K(4.3, [0, 2.45, 0.4], [0.7, 4.0, -6], 0.98),
      K(6.0, [0, 2.45, 0.4], [0, 3.9, -6], 0.98),
      K(8.7, [0, 2.45, 0.3], [-4.2, 3.8, -4.9], 0.98),
      K(10.6, [0, 2.5, 0.25], [-3.9, 3.45, -5.2], 0.98),
      K(12.2, [0, 2.5, 0.4], [-1.7, 3.0, -6.0], 0.95),
      K(14.4, [0, 2.5, 0.6], [-1.2, 2.4, -5.5], 0.95),
      K(17.5, [0.2, 2.4, 0.6], [0.8, 1.9, -5.5], 0.95),
      K(19.6, [0.4, 2.2, 0.45], [1.5, 1.25, -5.2], 0.9),
      K(22.6, [0.2, 2.0, 0.25], [0.6, 0.95, -5.4], 0.9),
      K(24.4, [0.2, 2.0, 0.2], [0.5, 1.0, -5.5], 0.92),
      K(26.6, [0.4, 2.1, 0.2], [2.5, 1.6, -5.0], 0.95),
      K(30.7, [0.4, 2.1, 0.2], [2.8, 2.2, -4.8], 0.95),
      K(32.3, [0.2, 1.8, 0.4], [1.0, 6.6, -1.8], 1.0),
      K(33.9, [0, 2.0, 0.7], [0, 3.6, -8], 1.0),
      K(44, [0, 2.3, 1.3], [0, 2.9, -9], 1.0),
      K(55, [0, 1.8, 1.5], [0, 1.5, -9], 1.0),
      K(58.6, [0, 1.8, 1.0], [-1.3, 1.2, -7], 0.95),
      K(61.8, [-0.4, 1.45, -0.5], [-3.3, 0.8, -3.4], 0.88),
      K(64.8, [-0.45, 1.0, -2.25], [-0.12, 0.62, -3.62], 0.6),
      K(66.15, [-0.42, 0.98, -2.32], [-0.06, 0.63, -3.62], 0.58, true),
      K(67.7, [-0.3, 4.2, 2.2], [0, 0.6, -3.4], 0.85),
      K(70.0, [0, 26, 17], [0, 0, -4], 0.95),
      K(72.6, [0, 57, 25], [0, 0, -4], 1.0),
      K(80, [-17, 51, 25], [0, 0, -2], 1.0),
      K(85.6, [-10, 19, 16], [0, 3, -6], 0.95),
      K(89.3, [-0.65, 3.35, -0.75], add(L.S, [0, 0.55, 0]), 0.66),
      K(93.5, [-0.2, 2.8, 0.2], [0.4, 4.2, -5.5], 0.88),
      K(104, [0, 2.8, 0.4], [0.7, 4.1, -6], 0.9, true),
    ]);
  }

  update(t, dt) {
    this.t = t;
    this.dt = dt;
  }

  // ---------------------------------------------------------------- per-frame helpers
  _env(list, t, decay = 0.25, look = 2) {
    let k = 0;
    for (let i = lastBefore(list, t); i >= 0 && t - list[i].t < look; i--) k = Math.max(k, (list[i].vel ?? 1) * pulse(t, list[i].t, 0.005, decay));
    return k;
  }

  _reveal(name, t) {
    const [a, b] = REVEAL[name];
    return clamp((t - a) / (b - a), 0, 1);
  }

  /** Overall brightness: everything dims to black at the very end. */
  _master(t) {
    return 1 - sm(99.5, 103.8, t);
  }

  draw(t, dt, target) {
    const gl = this.gl;
    const L = this.L, M = this.M;
    const w = target.w, h = target.h;
    const k = this.cam.at(t);
    // a little life in the camera: breathing drift, and the kick drum shakes it
    const kick = this._env(this.E.kicks, t, 0.12);
    const shake = kick * 0.006 * (t < M.wake ? 1 : 0);
    const eye = [k[0] + Math.sin(t * 0.37) * 0.02, k[1] + Math.sin(t * 0.29) * 0.015 + shake, k[2]];
    const cam = this.camera(eye, [k[3], k[4] - shake * 0.5, k[5]], k[6], w, h, { near: 0.05, far: 600 });
    this.lastCam = cam;
    const mst = this._master(t);
    const marble = this.marbleAt(t);
    this.marble = marble;

    // ----- static group brightness
    const sg = this.stat.groups, rv = this.stat.reveal;
    const chordFlare = pulse(t, M.chord, 0.02, 2.5);
    const chordHold = sm(M.chord - 0.3, M.chord + 0.5, t) * (1 - 0.55 * sm(M.chord + 3, M.dispense, t));
    const wakeK = sm(M.wake, M.chord, t);
    const near = (t0, t1) => sm(t0 - 0.4, t0, t) * (1 - sm(t1, t1 + 2.5, t));
    const loopsOn = (t0) => sm(t0, t0 + 0.5, t) * (1 - 0.6 * sm(M.bridge, M.bridge + 4, t));
    const base = 0.45 + 0.3 * chordHold + 0.5 * chordFlare;
    sg[G.ALWAYS] = mst;
    sg[G.GRID] = (0.9 + 1.4 * wakeK + 1.2 * chordFlare) * mst;
    sg[G.HOME] = (0.06 + 1.6 * wakeK) * mst;
    sg[G.LOOP] = (base + 0.9 * near(0, 9.6) + 0.6 * near(M.dispense, M.dispense + 8)) * mst;
    sg[G.PLATE] = (base + 0.9 * near(9.4, 12) + 1.5 * pulse(t, M.plate, 0.005, 0.8)) * mst;
    sg[G.PEND] = (base + 0.7 * near(11.5, 14.4) + 0.25 * loopsOn(M.pendulum) * this._env(this.E.tick, t, 0.2)) * mst;
    sg[G.XYLO] = (base + 0.8 * near(14.3, 19.2) + 0.25 * loopsOn(M.xylo) * this._env(this.E.xylo, t, 0.2)) * mst;
    sg[G.FUNNEL] = (base + 1.4 * near(19.0, 21.6)) * mst;
    sg[G.STRINGS] = (base + 0.8 * near(21.4, 23.8) + 0.3 * loopsOn(M.strings) * this._env(this.E.strings, t, 0.3)) * mst;
    sg[G.DRUM] = (base + 0.6 * near(23.8, 26.4) + 1.4 * kick) * mst;
    sg[G.WHEEL] = (base + 0.8 * near(26.2, 31.2)) * mst;
    sg[G.TUBE] = (base + 1.2 * near(31.1, 33.8) + 0.5 * loopsOn(M.tube) * this._env(this.E.air, t, 0.1)) * mst;
    sg[G.SPIRAL] = (base + 0.5 * near(33.4, 57.6) + 0.35 * this._env(this.E.lead, t, 0.5) * near(M.spiral, M.bridge)) * mst;
    sg[G.BRIDGE] = (base + 0.9 * near(57.4, 66.2)) * mst;
    for (const n of Object.keys(REVEAL)) rv[G[n]] = this._reveal(n, t);
    // the vast machine's stands: invisible until their wave wakes
    for (let g = 0; g < 10; g++) {
      const first = this.mech.find((m) => m.group === G.MECH0 + g);
      const tw = first ? first.t : M.wake;
      sg[G.MECH0 + g] = (0.02 + 0.9 * sm(tw - 0.1, tw + 0.6, t) * (0.6 + 0.5 * chordHold + 0.7 * chordFlare) * (1 - 0.7 * sm(M.chord + 6, M.dispense + 4, t))) * mst;
    }

    // ----- dynamic geometry
    const d = this.dyn;
    d.begin();
    const o = this.orbs;
    o.begin();
    const mirrorOrbs = [];
    const glow = (p, c, size, mir = 0.25) => {
      o.add(p, c, size, 0);
      if (mir > 0 && p[1] > 0) mirrorOrbs.push([p, c, size, mir]);
    };

    this._drawMarbles(t, d, o, glow, mst);
    this._drawStations(t, d, glow, mst, kick);
    this._drawMachine(t, d, glow, mst, chordFlare, chordHold);
    for (const [p, c, size, mir] of mirrorOrbs) o.add([p[0], -p[1], p[2]], mul(c, mir), size, 0);

    // ----- lights that tint the lines: the marble, impacts, the chord
    const lights = [{ p: marble, c: mul(C.gold, 0.9 * mst), r: 0.9 }];
    const clang = pulse(t, M.plate, 0.005, 0.7);
    if (clang > 0.01) lights.push({ p: L.plate, c: mul(C.white, 2.5 * clang), r: 2.2 });
    if (kick > 0.01 && t < M.wake) lights.push({ p: add(L.dc, [0, 0.6, 0]), c: mul(C.red, kick * 1.2), r: 1.5 });
    if (t > M.wake) lights.push({ p: [0, 8, -4], c: mul(C.gold, (0.15 * wakeK + 0.6 * chordFlare) * mst), r: 30 });
    this.stat.setLights(lights);
    this.dyn.setLights(lights);
    this.stat.litK = 0.6;
    this.dyn.litK = 0.35;

    // ----- render: floor reflection first, then the machine, then the glass and glows
    gl.clearColor(0.004, 0.007, 0.015, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const keepGrid = sg[G.GRID], keepHome = sg[G.HOME];
    sg[G.GRID] = 0;
    sg[G.HOME] = 0;
    this.stat.draw(cam, { mirror: true });
    sg[G.GRID] = keepGrid;
    sg[G.HOME] = keepHome;
    this.dyn.draw(cam, { mirror: true });
    this.stat.draw(cam);
    this.dyn.draw(cam);
    o.draw(cam);
    gl.disable(gl.BLEND);
    return target;
  }

  // ---------------------------------------------------------------- the marble(s)
  _drawMarbles(t, d, o, glow, mst) {
    const M = this.M, L = this.L;
    const p = this.marble;
    // a light trail: where it was a moment ago (the path is a function of time, so no history is needed)
    const trail = [];
    const span = t > M.spiral && t < M.bridge ? 0.5 : 0.35;
    for (let i = 12; i >= 0; i--) trail.push(this.marbleAt(Math.max(0, t - (span * i) / 12)));
    this.marbleAt(t);
    const moving = len(sub(trail[0], trail[12])) > 0.05;
    if (moving) d.add(trail, (u) => mul(C.gold, u * u * 0.9 * mst), 0.028);
    const lead = this._env(this.E.lead, t, 0.4) * sm(M.spiral, M.spiral + 1, t) * (1 - sm(M.bridge - 1, M.bridge, t));
    const pressed = pulse(t, M.button, 0.005, 0.4);
    const k = (0.9 + 0.5 * lead + 1.5 * pressed + 0.6 * sm(M.chord - 0.2, M.chord + 0.3, t)) * mst;
    o.add(p, mul([1.0, 0.86, 0.66], k), 2 * R, 1);
    glow(p, mul(C.warm, 0.2 * k), 1.15, 0.5);
    o.add([p[0], -p[1], p[2]], mul([1.0, 0.86, 0.66], 0.3 * k), 2 * R, 1);
    // the hopper's spare marbles, and the one it drops at the end
    const hop = add(L.S, [0, 0.55, 0]);
    const spare = [[-0.1, 0.38, 0.05], [0.12, 0.42, -0.04], [0.0, 0.62, 0.12]];
    spare.forEach((q, i) => {
      if (i === 0 && t > M.dispense + 0.3) return;
      const pp = add(hop, q);
      o.add(pp, mul([0.75, 0.82, 1.0], 0.35 * mst * this._reveal('LOOP', t)), 2 * R, 1);
    });
    if (t > M.dispense + 0.3) {
      const p2 = this.m2At(t);
      const fade = 1 - sm(this.m2.t + this.m2.dur - 1.5, this.m2.t + this.m2.dur + 1.0, t);
      o.add(p2, mul([1.0, 0.86, 0.66], 0.9 * fade * mst), 2 * R, 1);
      glow(p2, mul(C.warm, 0.15 * fade * mst), 0.9, 0.5);
      const tr = [];
      for (let i = 10; i >= 0; i--) tr.push(this.m2At(Math.max(M.dispense + 0.3, t - (0.35 * i) / 10)));
      if (len(sub(tr[0], tr[10])) > 0.05) d.add(tr, (u) => mul(C.gold, u * u * 0.8 * fade * mst), 0.026);
    }
    // the hatch: a flap under the hopper that swings open at the end
    const open = sm(M.dispense, M.dispense + 0.25, t) * (1 - sm(M.dispense + 1.2, M.dispense + 1.6, t));
    const hb = add(hop, [0, 0.2, 0]);
    const ang = open * 1.6;
    d.add([add(hb, [-0.12, 0, 0]), add(hb, [-0.12 + Math.cos(ang) * 0.24, -Math.sin(ang) * 0.24, 0])], mul(C.warm, (0.5 + open) * mst * this._reveal('LOOP', t)), 0.014);
  }

  // ---------------------------------------------------------------- the stations
  _drawStations(t, d, glow, mst, kick) {
    const o = this.orbs;
    const M = this.M, L = this.L;
    const rv = (n) => this._reveal(n, t);

    // joints behind you click as it passes
    for (const j of this.joints) {
      const k = pulse(t, j.t, 0.005, 0.25);
      if (k > 0.02) glow(sub(j.p, [0, R, 0]), mul(C.white, 0.5 * k * mst), 0.5);
    }

    // the plate: rings of sound and a ringing rim
    const clang = pulse(t, M.plate, 0.005, 1.0);
    if (t > M.plate - 0.01 && t < M.plate + 4) {
      const ring = pulse(t, M.plate, 0.005, 1.6);
      const wob = 0.55 + 0.015 * Math.sin((t - M.plate) * 90) * ring;
      d.add(circle(add(L.plate, [0, 0.0, 0]), tangentAz(-70), radial(-70), wob, 40), mul(C.white, (0.2 + 1.6 * ring) * mst), 0.016);
      for (let i = 0; i < 3; i++) {
        const x = (t - M.plate - i * 0.18) / 1.6;
        if (x <= 0 || x >= 1) continue;
        d.add(circle(L.plate, tangentAz(-70), radial(-70), 0.6 + x * 3.2, 56), mul(C.white, (1 - x) * (1 - x) * 0.6 * mst), 0.012);
      }
      glow(add(L.plate, [0, 0.05, 0]), mul(C.white, 2.2 * clang * mst), 1.8);
    }
    L.steps.forEach((s, k) => {
      const e = this.E.step[k];
      const p = pulse(t, e ? e.t : 0, 0.005, 0.3);
      if (p > 0.02) {
        boxLines(d, add(s, [0, -0.12, 0]), tangentAz(-62 + 12 * k), radial(-62 + 12 * k), 0.24, 0.17, 0.12, mul(C.warm, 1.6 * p * mst));
        glow(add(s, [0, 0.05, 0]), mul(C.warm, 0.8 * p * mst), 0.7);
      }
    });

    // the pendulum (held by a latch until the marble knocks it free)
    const P = L.piv;
    let th = -L.pa;
    if (t >= M.pendulum) {
      const amp = L.pa * (1 - 0.65 * sm(M.button, 104, t));
      th = -amp * Math.cos((Math.PI * (t - M.pendulum)) / 0.6);
    }
    const bob = add(P, [Math.sin(th) * L.pl, -Math.cos(th) * L.pl, 0]);
    const pr = rv('PEND');
    const tick = this._env(this.E.tick, t, 0.15);
    d.add([P, bob], mul(C.gold, (0.35 + 0.4 * tick) * mst * pr), 0.016);
    d.add(circle(bob, [1, 0, 0], UP, L.bobR, 36), mul(C.gold, (0.55 + 0.9 * tick) * mst * pr), 0.02);
    d.add(circle(bob, [1, 0, 0], UP, L.bobR * 0.55, 24), mul(C.gold, (0.25 + 0.6 * tick) * mst * pr), 0.012);
    glow(bob, mul(C.gold, (0.12 + 0.5 * tick) * mst * pr), 1.2);
    glow(P, mul(C.gold, 0.15 * mst * pr), 0.35, 0);
    // the latch flips away
    const lp = add(L.contact, [0.02, -0.18, 0]);
    const la = -0.6 - 2.0 * sm(M.pendulum, M.pendulum + 0.12, t);
    d.add([add(lp, [-0.25, -0.3, 0]), lp, add(lp, [Math.cos(la) * 0.22, Math.sin(la) * 0.22, 0])], mul(C.warm, (0.6 + 1.2 * pulse(t, M.pendulum, 0.005, 0.3)) * mst * pr), 0.014);

    // xylophone: keys light when struck; hammers keep the riff going once the marble has passed
    const xr = rv('XYLO');
    const keyHit = new Float32Array(16);
    const hammer = new Float32Array(16).fill(-0.25); // arm elevation (rad): rest, lift, strike, rebound
    for (let i = lastBefore(this.E.xylo, t + 0.2); i >= 0 && t - this.E.xylo[i].t < 0.8; i--) {
      const e = this.E.xylo[i];
      const x = t - e.t;
      if (x >= 0) keyHit[e.key] = Math.max(keyHit[e.key], e.vel * Math.exp(-x / 0.22));
      if (e.marble || x < -0.18 || x > 0.25) continue;
      let b;
      if (x < -0.05) b = -0.25 + 0.35 * sm(-0.18, -0.05, x);
      else if (x < 0) b = 0.1 - 0.82 * ((x + 0.05) / 0.05);
      else b = -0.72 + 0.47 * (1 - Math.pow(1 - Math.min(1, x / 0.25), 2));
      hammer[e.key] = b;
    }
    L.keys.forEach((kk, j) => {
      const hit = keyHit[j];
      if (hit > 0.02) {
        boxLines(d, kk.c, tangentAz(kk.az), radial(kk.az), 0.065, kk.len / 2, 0.03, mul(kk.col, 2.4 * hit * mst));
        glow(add(kk.c, [0, 0.05, 0]), mul(kk.col, 0.7 * hit * mst), 0.6);
      }
      {
        // hammer: pivot on the post above the far end, arm reaching back over the key
        const rad = radial(kk.az);
        const pv = add(add(kk.c, mul(rad, kk.len / 2 + 0.08)), [0, 0.3, 0]);
        const a = hammer[j];
        const dir = add(mul(rad, -Math.cos(a)), [0, Math.sin(a), 0]);
        const head = add(pv, mul(dir, 0.34));
        const hc = mul(C.gold, (0.35 + 1.2 * keyHit[j]) * mst * xr * sm(M.xylo + 3.5, M.xylo + 4.6, t));
        d.add([pv, head], hc, 0.01);
        d.add(circle(head, rad, UP, 0.045, 10), hc, 0.012);
      }
    });

    // the funnel's swirl
    if (t > 19.0 && t < 21.7) {
      const pts = [];
      const x1 = clamp((t - 19.2) / 2.3, 0, 1);
      for (let i = 0; i <= 30; i++) pts.push(this.funnelPos(Math.max(0, x1 - 0.22 + (0.22 * i) / 30)));
      d.add(pts, (u) => mul(C.cyan, u * 1.3 * mst), 0.02);
    }

    // strings: four of them, ringing on every pluck
    const sr = rv('STRINGS');
    for (let s = 0; s < 4; s++) {
      let amp = 0, ph = 0;
      for (let i = lastBefore(this.E.strings, t); i >= 0 && t - this.E.strings[i].t < 2.5; i--) {
        const e = this.E.strings[i];
        if (e.k !== s) continue;
        const a = e.vel * Math.exp(-(t - e.t) / 0.55);
        if (a > amp) {
          amp = a;
          ph = t - e.t;
        }
      }
      const az = L.strAz[s];
      const a0 = polar(az, 4.5, 0.8), a1 = polar(az, 6.5, 0.8);
      const pts = [];
      const wv = Math.sin(ph * TAU * (7 + s * 1.7)) * amp * 0.07;
      for (let i = 0; i <= 24; i++) {
        const x = i / 24;
        const p = mix(a0, a1, x);
        p[1] += Math.sin(Math.PI * x) * wv;
        pts.push(p);
      }
      d.add(pts, mul(C.cyan, (0.35 + 2.2 * amp) * mst * sr), 0.012);
      if (amp > 0.05) glow(mix(a0, a1, 0.5), mul(C.cyan, 0.35 * amp * mst), 0.9);
    }

    // the drum skin breathes with the kick; a ring runs out across the floor
    const D = L.dc;
    const dr = rv('DRUM');
    for (const [r, kk] of [[0.3, 1], [0.55, 0.8], [0.8, 0.5]]) {
      const dip = 0.07 * kick * (1 - r / L.drumR);
      d.add(circle(add(D, [0, L.skinY - dip, 0]), [1, 0, 0], [0, 0, 1], r, 36), mul(C.red, (0.18 + 1.6 * kick) * kk * mst * dr), 0.012);
    }
    for (let i = lastBefore(this.E.kicks, t); i >= 0 && t - this.E.kicks[i].t < 0.9; i--) {
      const x = (t - this.E.kicks[i].t) / 0.9;
      d.add(circle(add(D, [0, 0.01, 0]), [1, 0, 0], [0, 0, 1], L.drumR + x * (this.E.kicks[i].vel > 1 ? 5 : 2.4), 48), mul(C.red, (1 - x) * (1 - x) * 0.9 * mst * dr), 0.014);
    }
    if (kick > 0.02) glow(add(D, [0, L.skinY + 0.1, 0]), mul(C.red, 0.9 * kick * mst), 1.6);

    // the glass wheel: rim, spokes, six discs (the harmony) and the cups that carry the marble
    const W = L.wc, wr = L.wRight;
    const wa = this._wheelAngle(t) * D2R;
    const wcol = (k) => mul(C.violet, k * mst * rv('WHEEL'));
    const at = (a, r) => add(W, add(mul(wr, Math.cos(a) * r), [0, Math.sin(a) * r, 0]));
    d.add(circle(W, wr, UP, L.wheelR, 64), wcol(0.6), 0.016);
    d.add(circle(W, wr, UP, 0.16, 16), wcol(0.6), 0.012);
    const discLvl = new Float32Array(6);
    for (let i = lastBefore(this.E.disc, t); i >= 0 && t - this.E.disc[i].t < 4; i--) {
      const e = this.E.disc[i];
      const x = t - e.t;
      const env = Math.min(1, x / 0.25) * (x < e.dur ? 1 : Math.exp(-(x - e.dur) / 0.6));
      discLvl[e.disc] = Math.max(discLvl[e.disc], env);
    }
    for (let k = 0; k < 6; k++) {
      const a = wa + (k * TAU) / 6;
      d.add([at(a, 0.16), at(a, L.wheelR)], wcol(0.35), 0.01);
      const dc = at(a, 0.68);
      const lv = discLvl[k];
      const col = rgbMix(C.violet, k % 2 ? C.cyan : C.rose, 0.5);
      d.add(circle(dc, wr, UP, 0.3, 28), mul(col, (0.3 + 1.6 * lv) * mst * rv('WHEEL')), 0.014);
      d.add(circle(dc, wr, UP, 0.18, 20), mul(col, (0.12 + 1.1 * lv) * mst * rv('WHEEL')), 0.01);
      if (lv > 0.02) glow(dc, mul(col, 0.45 * lv * mst), 1.0);
      // cups between the discs (the marble rides in one)
      const ca = a + TAU / 12;
      const rd = [Math.cos(ca), Math.sin(ca)], tg = [-Math.sin(ca), Math.cos(ca)];
      const q = (r, s2) => add(W, add(mul(wr, rd[0] * r + tg[0] * s2), [0, rd[1] * r + tg[1] * s2, 0]));
      d.add([q(L.wheelR + 0.04, -0.13), q(L.wheelR - 0.1, -0.08), q(L.wheelR - 0.12, 0), q(L.wheelR - 0.1, 0.08), q(L.wheelR + 0.04, 0.13)], wcol(0.6), 0.01);
    }
    const chime = pulse(t, M.discs, 0.005, 0.8);
    if (chime > 0.02) glow(W, mul(C.white, 1.4 * chime * mst), 2.4);

    // the tube: its rings flash as the marble shoots through; air gates puff on the hats
    if (t > M.tube - 0.1 && t < M.spiral + 0.4) {
      const x = clamp((t - 31.2) / 2.4, 0, 1);
      const u = 0.25 * sm(0, 1, x) + 0.75 * x;
      for (const r of this.tubeRings) {
        const dd = Math.abs(r.x - u);
        if (dd < 0.08) d.add(circle(r.p, r.a, r.b, 0.13, 14), mul(C.cyan, (1 - dd / 0.08) * 1.6 * mst), 0.012);
      }
      const puff = pulse(t, M.tube, 0.005, 0.3);
      if (puff > 0.02) glow(L.tube.at(0.02), mul(C.white, 1.6 * puff * mst), 1.2);
    }
    for (let i = lastBefore(this.E.air, t); i >= 0 && t - this.E.air[i].t < 0.4; i--) {
      const e = this.E.air[i];
      const gp = L.gates[e.az > 0 ? 0 : 1];
      const x = t - e.t;
      glow(add(gp, [0, 0.3 + x * 1.2, 0]), mul(C.white, 0.6 * Math.exp(-x / 0.1) * mst), 0.5 + x * 2);
    }

    // the spiral: the rail behind the marble glows; the posts flash as it passes
    if (t > M.spiral - 0.1 && t < M.bridge + 1.5) {
      const tt = Math.min(t, M.bridge);
      const a1 = this.spAz(tt);
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const a = a1 - 70 + (70 * i) / 40;
        const tp = M.spiral + (a - 180) / 75;
        if (tp < M.spiral) continue;
        pts.push(polar(a, L.spR, 5.2 - (4.3 * (tp - M.spiral)) / (M.bridge - M.spiral) - 0.02));
      }
      const fade = 1 - sm(M.bridge, M.bridge + 1.5, t);
      if (pts.length > 1) d.add(pts, (u) => mul(C.gold, u * u * 1.3 * mst * fade), 0.02);
      const post = Math.round(a1 / 15) * 15;
      const pp = polar(post, L.spR + 0.35, 0);
      const pk = Math.exp(-angDiff(a1, post) / 4) * fade;
      d.add([pp, add(pp, [0, 5.9, 0])], mul(C.gold, 0.6 * pk * mst), 0.014);
    }

    // the button
    const pressed = sm(M.button - 0.02, M.button + 0.02, t);
    const bd = L.buttonDir;
    const bp = add(L.button, mul(bd, 0.02 * pressed));
    const bc = rgbMix(C.red, C.gold, pressed);
    const br = (1.2 + 3 * pulse(t, M.button, 0.005, 0.5)) * mst * this._reveal('BRIDGE', t);
    d.add(circle(bp, radial(359.2), UP, 0.04, 14), mul(bc, br), 0.014);
    d.add(circle(bp, radial(359.2), UP, 0.022, 10), mul(bc, br * 0.8), 0.012);
    o.add(bp, mul(bc, 0.6 * br), 0.07, 0);
    glow(bp, mul(bc, (0.3 + 2.5 * pulse(t, M.button, 0.005, 0.35)) * mst * this._reveal('BRIDGE', t)), 0.45);
  }

  // ---------------------------------------------------------------- the vast machine wakes; the chord
  _drawMachine(t, d, glow, mst, chordFlare, chordHold) {
    const M = this.M;
    if (t < M.wake - 0.5) return;
    const spin = 1 + 0.8 * sm(M.chord - 0.5, M.chord + 1, t) - 0.6 * sm(M.chord + 6, 104, t);
    for (const m of this.mech) {
      // the chain that triggers it: a pulse runs down it just before it wakes
      const awake = sm(m.t - 0.05, m.t + 0.5, t);
      if (t > m.chainT0) {
        const x = clamp((t - m.chainT0) / (m.t - m.chainT0), 0, 1);
        const parentLit = m.parent < 0 ? 1 : sm(this.mech[m.parent].t, this.mech[m.parent].t + 0.3, t);
        d.add(m.chain.slice(0, x, 20), mul(C.gold, (0.08 + 0.25 * chordHold + 0.5 * chordFlare) * parentLit * mst), 0.02);
        if (x < 1) glow(m.chain.at(x), mul(C.white, 1.2 * mst), 0.9, 0.15);
      }
      // the mechanism: dark outline until it wakes, then a flash, then it turns
      const flash = pulse(t, m.t, 0.005, 0.5);
      const settle = 1 - 0.75 * sm(M.chord + 6, M.dispense + 4, t);
      const bright = (0.03 + awake * (0.45 + 0.35 * chordHold) * settle + 1.8 * flash + 0.6 * chordFlare * awake) * mst;
      if (bright < 0.01) continue;
      const tw = Math.max(0, t - m.t);
      const ang = m.phase + m.speed * spin * (tw > 1.2 ? tw - 0.6 : (tw * tw) / 2.4);
      const col = mul(rgbMix(C.ink, m.col, awake), bright);
      drawShape(d, m, ang, t, col);
      if (awake > 0.01) glow(m.hub, mul(m.col, (0.22 * settle + 1.5 * flash + 0.4 * chordFlare) * awake * mst), 0.8 + m.size * 0.5, 0.15);
    }
    // the chord: three colossal rings ignite round the whole machine and a shockwave crosses the floor
    if (t > M.chord - 0.1) {
      const x = t - M.chord;
      d.groups[G.GIANT] = mst;
      d.reveal[G.GIANT] = clamp(x / 1.6, 0, 1);
      const rings = [[46, 0.35, 0.0, 0.12], [39, -0.5, 1.2, -0.09], [33, 0.9, 2.3, 0.07]];
      rings.forEach(([r, tilt, yaw, w], i) => {
        const ca = Math.cos(yaw), sa = Math.sin(yaw);
        const tlt = tilt + 0.15 * Math.sin(x * 0.2 + i);
        const u = [ca, 0, sa];
        const v = norm([-sa * Math.sin(tlt), Math.cos(tlt), ca * Math.sin(tlt)]);
        const spinA = x * w;
        const c = [0, 14, -2];
        const k = (0.5 + 0.9 * chordFlare) * (1 - 0.45 * sm(M.chord + 4, M.dispense + 4, t));
        d.add(circle(c, u, v, r, 220, spinA, spinA + TAU), mul(rgbMix(C.gold, C.white, 0.3), k), 0.08, G.GIANT);
        d.add(circle(c, u, v, r * 0.965, 220, spinA, spinA + TAU), mul(C.warm, k * 0.5), 0.04, G.GIANT);
        for (let q = 0; q < 48; q++) {
          const a = spinA + (q / 48) * TAU;
          const p0 = add(c, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)));
          const p1 = add(c, add(mul(u, Math.cos(a) * r * 0.965), mul(v, Math.sin(a) * r * 0.965)));
          d.add([p0, p1], mul(C.gold, k * 0.6), 0.04, G.GIANT);
        }
      });
      // the dial on the floor
      const kd = (0.25 + 1.2 * chordFlare) * (1 - 0.5 * sm(M.chord + 4, M.dispense + 4, t));
      d.add(circle([0, 0.02, 0], [1, 0, 0], [0, 0, 1], 54, 240, x * 0.03, x * 0.03 + TAU), mul(C.gold, kd), 0.1, G.GIANT);
      for (let q = 0; q < 120; q++) {
        const a = x * 0.03 + (q / 120) * TAU;
        const l = q % 10 === 0 ? 3 : q % 5 === 0 ? 1.8 : 0.9;
        d.add([[Math.cos(a) * 54, 0.02, Math.sin(a) * 54], [Math.cos(a) * (54 - l), 0.02, Math.sin(a) * (54 - l)]], mul(C.gold, kd * 0.8), 0.06, G.GIANT);
      }
      // shockwave
      if (x < 4) {
        const rr = 2 + 70 * Math.pow(x / 4, 0.7);
        d.add(circle([0, 0.03, 0], [1, 0, 0], [0, 0, 1], rr, 200), mul(C.white, 1.6 * (1 - x / 4) * (1 - x / 4) * mst), 0.15);
      }
    }
    // your speakers light with the chord
    if (this.spkPos) {
      for (const s of this.spkPos) glow(s.p, mul(C.gold, (0.25 * sm(M.wake, M.chord, t) + 1.2 * chordFlare) * mst), s.role === 'LFE' ? 0.9 : 0.6, 0);
    }
  }

  postParams(t) {
    const M = this.M;
    const flare = pulse(t, M.chord, 0.02, 1.2);
    return {
      exposure: 1.45 + 0.25 * sm(M.wake, M.chord, t) - 0.2 * sm(M.chord + 4, M.dispense, t),
      bloomStrength: 0.38 + 0.15 * flare, bloomRadius: 1.0, threshold: 0.3, vignette: 0.55, grain: 0.025, saturation: 1.1,
      flash: [0.08 * flare, 0.06 * flare, 0.035 * flare],
      shock: [0.5, 0.45, Math.max(0, (t - M.chord) * 0.9)], shockStrength: pulse(t, M.chord, 0.01, 0.7) * 0.9,
      letterbox: 0,
    };
  }

  // ---------------------------------------------------------------- Hue: the lights follow the marble round the room
  light(f, t) {
    const M = this.M;
    const az = f.anchor === 'tv' ? 0 : f.az ?? 0;
    let c = [0.006, 0.012, 0.03];
    const put = (col, k) => {
      c = [c[0] + col[0] * k, c[1] + col[1] * k, c[2] + col[2] * k];
    };
    const p = this.marbleAt(t);
    const maz = azOf(p);
    const dd = angDiff(maz, az);
    // the light nearest the marble follows it (while it's rolling around the room)
    const roaming = t > 3 && t < M.button + 0.2 ? 1 : 0;
    put(C.gold, 0.7 * roaming * Math.exp(-(dd * dd) / (2 * 35 * 35)));
    if (f.anchor === 'fl' || f.anchor === 'fr') {
      for (let i = lastBefore(this.E.tick, t); i >= 0 && t - this.E.tick[i].t < 0.6; i--) {
        const e = this.E.tick[i];
        if (e.spk.toLowerCase() === f.anchor) put(C.warm, 0.35 * pulse(t, e.t, 0.005, 0.18));
      }
    }
    if (f.anchor === 'tv') put(C.red, 0.45 * this._env(this.E.kicks, t, 0.15) * (t < M.wake ? 1 : 0));
    put(C.white, 1.2 * pulse(t, M.plate, 0.005, 0.6) * Math.max(0, 1 - angDiff(-70, az) / 90));
    // the glass wheel's harmony on the right
    let disc = 0;
    for (let i = lastBefore(this.E.disc, t); i >= 0 && t - this.E.disc[i].t < 4; i--) {
      const e = this.E.disc[i];
      const x = t - e.t;
      disc = Math.max(disc, Math.min(1, x / 0.25) * (x < e.dur ? 1 : Math.exp(-(x - e.dur) / 0.6)));
    }
    put(C.violet, 0.3 * disc * Math.max(0, 1 - angDiff(40, az) / 80) * (1 - sm(M.bridge, M.bridge + 2, t)));
    // the wake: sparkles where each catch is
    for (let i = lastBefore(this.E.wake, t); i >= 0 && t - this.E.wake[i].t < 0.5; i--) {
      const e = this.E.wake[i];
      put(C.gold, 0.6 * pulse(t, e.t, 0.005, 0.15) * Math.max(0, 1 - angDiff(e.az, az) / 60));
    }
    // the chord: everything, warm and full
    const chord = sm(M.chord - 0.1, M.chord + 0.2, t) * (1 - 0.9 * sm(M.chord + 2, M.dispense + 2, t));
    put(rgbMix(C.gold, C.white, 0.35), 1.1 * chord);
    put(C.gold, 0.3 * sm(M.wake, M.chord, t) * (1 - sm(M.chord, M.chord + 0.5, t)));
    // the second marble, briefly
    if (t > M.dispense) {
      const p2 = this.m2At(t);
      put(C.gold, 0.5 * (1 - sm(this.m2.t + this.m2.dur - 1.5, this.m2.t + this.m2.dur, t)) * Math.exp(-(angDiff(azOf(p2), az) ** 2) / (2 * 35 * 35)));
    }
    return rgbMul(c, this._master(t));
  }

  dispose() {
    super.dispose();
    this.stat?.dispose();
    this.dyn?.dispose();
    this.orbs?.dispose();
  }
}

// ------------------------------------------------------------------ helpers that draw

function keyCol(n) {
  // warm low keys to cool high ones
  const x = clamp((n - 67) / 14, 0, 1);
  return x < 0.5 ? rgbMix(C.gold, C.rose, x * 2) : rgbMix(C.rose, C.cyan, (x - 0.5) * 2);
}

/** Box outline: centre c (bottom-centre for h), u/v horizontal axes with half sizes hu/hv, height h. */
function boxLines(batch, c, u, v, hu, hv, h, col, grp = 0) {
  const corner = (a, b, y) => add(c, add(add(mul(u, a * hu), mul(v, b * hv)), [0, y, 0]));
  const ring = (y) => [corner(-1, -1, y), corner(1, -1, y), corner(1, 1, y), corner(-1, 1, y)];
  batch.add(ring(0), col, 0.01, grp, true);
  if (h > 0.001) {
    batch.add(ring(h), col, 0.01, grp, true);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) batch.add([corner(a, b, 0), corner(a, b, h)], col, 0.008, grp);
  }
}

/** Local outline for a mechanism (2D points in its plane, radius ~size), rotated per frame. */
function buildShape(m, rng) {
  const s = m.size;
  const parts = [];
  if (m.kind === 'gear' || m.kind === 'ratchet') {
    const n = m.teeth;
    const rOut = s, rIn = s * (m.kind === 'gear' ? 0.88 : 0.82);
    const outline = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, da = TAU / n;
      if (m.kind === 'gear') {
        outline.push([Math.cos(a) * rIn, Math.sin(a) * rIn], [Math.cos(a + da * 0.15) * rOut, Math.sin(a + da * 0.15) * rOut], [Math.cos(a + da * 0.45) * rOut, Math.sin(a + da * 0.45) * rOut], [Math.cos(a + da * 0.6) * rIn, Math.sin(a + da * 0.6) * rIn]);
      } else {
        outline.push([Math.cos(a) * rIn, Math.sin(a) * rIn], [Math.cos(a + da * 0.9) * rOut, Math.sin(a + da * 0.9) * rOut]);
      }
    }
    parts.push({ pts: outline, closed: true, k: 1, w: 0.035 + s * 0.012 });
    parts.push({ pts: ring2(s * 0.62, 40), closed: true, k: 0.6, w: 0.025 });
    parts.push({ pts: ring2(s * 0.16, 16), closed: true, k: 0.9, w: 0.025 });
    const spokes = rng.int(3, 6);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * TAU;
      parts.push({ pts: [[Math.cos(a) * s * 0.16, Math.sin(a) * s * 0.16], [Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62]], k: 0.7, w: 0.025 });
    }
  } else if (m.kind === 'latch') {
    // a rocker: a long beam with counterweights
    const l = s * 1.4;
    parts.push({ pts: [[-l, 0], [l, 0]], k: 1, w: 0.04 + s * 0.01, rock: true });
    parts.push({ pts: ring2(s * 0.3, 20).map(([x, y]) => [x - l, y]), closed: true, k: 0.9, w: 0.03, rock: true });
    parts.push({ pts: ring2(s * 0.22, 18).map(([x, y]) => [x + l, y]), closed: true, k: 0.9, w: 0.03, rock: true });
    parts.push({ pts: [[-s * 0.3, -s * 0.5], [0, 0], [s * 0.3, -s * 0.5]], k: 0.6, w: 0.03, fixed: true });
  } else {
    // a spring with a weight that bobs on top
    parts.push({ spring: true, k: 1, w: 0.03 });
  }
  return parts;
}

function ring2(r, n) {
  return Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU) * r, Math.sin((i / n) * TAU) * r]);
}

function drawShape(d, m, ang, t, col) {
  const { hub, u, v, size } = m;
  const tw = Math.max(0, t - m.t);
  for (const part of m.shape) {
    if (part.spring) {
      // coil along v (up), squashing as the weight bobs
      const hgt = size * (1.4 + 0.25 * Math.sin(ang * 3) * Math.min(1, tw));
      const turns = 7;
      const pts = [];
      const base = add(hub, mul(v, -size * 0.9));
      const w2 = norm(cross(u, v));
      for (let i = 0; i <= turns * 16; i++) {
        const a = (i / 16) * TAU;
        const y = (i / (turns * 16)) * hgt;
        pts.push(add(base, add(add(mul(u, Math.cos(a) * size * 0.32), mul(w2, Math.sin(a) * size * 0.32)), mul(v, y))));
      }
      d.add(pts, mul(col, part.k), part.w);
      const top = add(base, mul(v, hgt + size * 0.25));
      d.add(circle(top, u, v, size * 0.28, 20), col, part.w);
      continue;
    }
    let a = ang;
    if (part.rock) a = 0.38 * Math.sin(ang * 1.6);
    if (part.fixed) a = 0;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts = part.pts.map(([x, y]) => {
      const X = x * ca - y * sa, Y = x * sa + y * ca;
      return [hub[0] + u[0] * X + v[0] * Y, hub[1] + u[1] * X + v[1] * Y, hub[2] + u[2] * X + v[2] * Y];
    });
    d.add(pts, mul(col, part.k), part.w, 0, part.closed);
  }
}
