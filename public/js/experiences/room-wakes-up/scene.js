// The Room Wakes Up: the picture. Takes over the 3D room on the home screen: marbles that land on each speaker
// exactly when it plays (marbles.js), a metronome and the notes to come on the TV (tv.js), threads of light between
// the speakers, beads that travel the threads and land exactly when their note sounds; then, with the chord, walls
// that slide out, a ceiling that opens onto the sky, and the threads becoming rings spinning over the couch.
import { Program } from '../../gl/gl.js';
import { v3, m4 } from '../../gl/math.js';
import { Curve, smoothstep, clamp, lerp, lastBefore, pulse, Rng } from '../core/timeline.js';
import { DynBuffer, Spline, spriteProgram, rgbMul, rgbMix } from '../core/gfx.js';
import { SPK } from './score.js';
import { Marbles } from './marbles.js';
import { TVMetronome } from './tv.js';

const COL = {
  pluck: [1.0, 0.58, 0.2], glass: [0.4, 0.8, 1.0], box: [0.78, 0.48, 1.0], air: [0.36, 1.0, 0.66],
  hum: [1.0, 0.76, 0.4], sub: [1.0, 0.2, 0.08], lead: [1.0, 0.9, 0.7], tick: [1.0, 0.86, 0.62], star: [0.75, 0.85, 1.0],
};
const ROLE_INST = { FL: 'pluck', FR: 'glass', SR: 'box', SL: 'air', FC: 'hum', C: 'hum', LFE: 'sub' };
const THREADS = [['FL', 'FR', 0.5], ['FR', 'SR', 0.55], ['SR', 'SL', 0.55], ['SL', 'FL', 0.55], ['FL', 'SR', 0.95], ['FR', 'SL', 0.95], ['FC', 'FL', 0.35], ['FC', 'FR', 0.35]];
const NPTS = 96;
const RING_C = [0, 2.2, -0.7]; // the rings spin over the couch, between it and the TV

const RIBBON_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aT;
layout(location = 2) in vec2 aUS;
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uWidth;
out vec2 vUS;
void main() {
  vec3 V = normalize(uCam - aP);
  vec3 B = cross(aT, V);
  float l = length(B);
  B = l > 1e-5 ? B / l : vec3(0.0, 1.0, 0.0);
  float d = length(uCam - aP);
  gl_Position = uVP * vec4(aP + B * aUS.y * uWidth * (1.0 + d * 0.035), 1.0);
  vUS = aUS;
}`;

const RIBBON_FS = `#version 300 es
precision highp float;
in vec2 vUS;
out vec4 outColor;
uniform vec3 uColA, uColB;
uniform float uBright, uTime, uClosed, uFlow;
uniform float uBead[6];
uniform float uBeadAmp[6];
void main() {
  float s = vUS.y;
  float core = exp(-s * s * 26.0);
  float glow = exp(-s * s * 3.5) * 0.22;
  float b = 0.0;
  for (int i = 0; i < 6; i++) {
    float d = vUS.x - uBead[i];
    b += uBeadAmp[i] * exp(-d * d * 1400.0);
  }
  float flow = 0.72 + 0.28 * sin(vUS.x * 70.0 - uTime * uFlow);
  float ends = mix(smoothstep(0.0, 0.06, vUS.x) * smoothstep(1.0, 0.94, vUS.x), 1.0, uClosed);
  vec3 col = mix(uColA, uColB, smoothstep(0.15, 0.85, vUS.x));
  outColor = vec4(col * (core * 1.7 + glow) * (uBright * flow + b * 4.0) * ends, 1.0);
}`;

const RIPPLE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aCol;
layout(location = 3) in float aW;
uniform mat4 uVP;
out vec2 vUV;
out vec4 vCol;
out float vW;
void main() {
  vUV = aUV;
  vCol = aCol;
  vW = aW;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const RIPPLE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vCol;
in float vW;
out vec4 outColor;
void main() {
  float r = length(vUV);
  float x = (r - 0.86) / vW;
  float ring = exp(-x * x) * (1.0 - smoothstep(0.97, 1.0, r));
  outColor = vec4(vCol.rgb * vCol.a * ring, 1.0);
}`;

const sm = smoothstep;

export class Scene {
  constructor(app, score, run) {
    this.app = app;
    this.room = app.room;
    this.gl = app.gl;
    this.score = score;
    this.run = run;
    this.M = score.marks;
    this.T = score.T;
    this.rng = new Rng(7);
    const ev = score.events;
    // events the picture reacts to
    this.notes = ev.filter((e) => e.spk && ['tick', 'pluck', 'glass', 'box', 'air', 'hum', 'lead', 'click'].includes(e.inst));
    this.byRole = {};
    for (const e of this.notes) (this.byRole[e.spk] = this.byRole[e.spk] || []).push(e);
    this.subs = ev.filter((e) => e.inst === 'sub');
    this.ticks = ev.filter((e) => e.inst === 'tick');
    this.hums = ev.filter((e) => e.inst === 'hum');
    this.stars = ev.filter((e) => e.inst === 'star');
    this.bells = ev.filter((e) => e.inst === 'bell');
    this.groove = ev.filter((e) => e.spk && e.t >= this.M.C && e.t < this.M.D && ['pluck', 'glass', 'box', 'air', 'tick'].includes(e.inst));
    // beads: a note that travels from one tower to the next lands exactly when it sounds
    this.beads = [];
    const travelers = ev.filter((e) => e.from && e.to);
    travelers.forEach((e, i) => {
      const prev = travelers[i - 1];
      const gap = prev ? e.t - prev.t : 0.6;
      const travel = clamp(gap * 0.95, 0.14, e.inst === 'lead' ? 0.6 : 0.55);
      this.beads.push({ t0: e.t - travel, t1: e.t, from: e.from, to: e.to, inst: e.inst === 'lead' ? 'lead' : ROLE_INST[e.to], vel: e.vel, lead: e.inst === 'lead', idx: i });
    });
    this.tc = this.M.chord;
    this.tDrop = this.M.drop;
  }

  /** The sub's drop: how held the breath is (0..1, the beat before it) and how hard it just hit (decaying). */
  _drop(t) {
    const M = this.M;
    if (M.drop === undefined) return { breath: 0, hit: 0, build: 0 };
    const breath = sm(M.breath, M.breath + 0.12, t) * (1 - sm(M.drop - 0.01, M.drop, t));
    const build = sm(M.build, M.breath, t) * (1 - sm(M.breath, M.breath + 0.1, t));
    const hit = t >= M.drop ? Math.exp(-(t - M.drop) / 0.45) : 0;
    return { breath, hit, build };
  }

  async init() {
    const gl = this.gl;
    const room = this.room;
    this.ribbonProg = new Program(gl, RIBBON_VS, RIBBON_FS, 'rwu-ribbon');
    this.rippleProg = new Program(gl, RIPPLE_VS, RIPPLE_FS, 'rwu-ripple');
    this.spriteProg = spriteProgram(gl);
    this.ribbonBuf = new DynBuffer(gl, [[0, 3], [1, 3], [2, 2]], (NPTS + 1) * 2 * 11);
    this.rippleBuf = new DynBuffer(gl, [[0, 3], [1, 2], [2, 4], [3, 1]], 6 * 64);
    this.spriteBuf = new DynBuffer(gl, [[0, 3], [1, 4]], 1400);
    // speaker anchor points (driver height, a little in front of the baffle)
    this.anchor = {};
    for (const id in room.speakers) {
      const sp = room.speakers[id];
      const fwd = [Math.sin(sp.rotY), 0, Math.cos(sp.rotY)];
      const role = sp.role === 'FC' ? 'FC' : sp.role;
      const y = sp.type === 'center' ? sp.pos[1] + 0.13 : sp.type === 'subwoofer' ? 0.45 : 0.82;
      this.anchor[role] = [sp.pos[0] + fwd[0] * 0.22, y, sp.pos[2] + fwd[2] * 0.22];
      sp.glowColor = COL[ROLE_INST[role]] || [0.3, 0.5, 1.0];
    }
    this.anchor.C = this.anchor.FC;
    this.marbles = new Marbles(gl, this.score, room, COL);
    this.tv = new TVMetronome(gl, this.score, COL);
    // threads as Bezier curves arcing around the couch
    const L = [0, 1.0, 0.3];
    this.threads = THREADS.filter(([a, b]) => this.anchor[a] && this.anchor[b]).map(([a, b, lift], i) => {
      const A = this.anchor[a], B = this.anchor[b];
      const c1 = v3.add(v3.lerp(A, L, 0.28), [0, lift, 0]);
      const c2 = v3.add(v3.lerp(B, L, 0.28), [0, lift, 0]);
      const pts = [];
      for (let k = 0; k <= NPTS; k++) {
        const u = k / NPTS, w = 1 - u;
        pts.push([0, 1, 2].map((d) => w * w * w * A[d] + 3 * w * w * u * c1[d] + 3 * w * u * u * c2[d] + u * u * u * B[d]));
      }
      return { a, b, pts, colA: COL[ROLE_INST[a]], colB: COL[ROLE_INST[b]], idx: i, charge: 0, axisSeed: i * 1.7 + 0.4 };
    });
    // motes of dust that catch the light
    this.motes = [];
    for (let i = 0; i < 520; i++) {
      this.motes.push([this.rng.range(-3, 3), this.rng.range(0.15, 2.6), this.rng.range(-3.5, 2.6), this.rng.range(0, 100), this.rng.range(0.4, 1)]);
    }
    // camera: from wherever the home view is now, down behind the couch, up to the rings, back home
    const e0 = room.eye();
    const t0 = room.cam.target.slice();
    const ov = room.presets.overview;
    const ovEye = [ov.target[0] + ov.radius * Math.cos(ov.phi) * Math.sin(ov.theta), ov.target[1] + ov.radius * Math.sin(ov.phi),
      ov.target[2] + ov.radius * Math.cos(ov.phi) * Math.cos(ov.theta)];
    const k = (t, eye, target, fov, hold = false) => ({ t, eye, target, fov, hold });
    const keys = [
      k(0, e0, t0, 0.75, true), k(8.5, e0, t0, 0.75, true),
      k(18, [2.3, 3.2, 5.3], [0, 0.85, -0.7], 0.8),
      k(27, [-1.9, 3.3, 5.5], [0, 0.65, -0.7], 0.86),
      k(40, [-0.9, 3.05, 5.9], [0, 0.75, -1.1], 0.9),
      // the chord: down behind the couch and looking up, so the opened room is the floor and the rest is sky, with
      // the rings over the couch in front of it; then home
      k(this.tc - 0.4, [-0.5, 3.0, 6.0], [0, 0.85, -1.0], 0.92),
      k(this.tc + 3.2, [0.35, 1.75, 6.6], [0, 2.55, -2.5], 1.12),
      k(this.M.F, [0.15, 1.85, 6.3], [0, 2.45, -2.4], 1.1),
      k(this.M.F + 4, ovEye, ov.target, 0.75, true), k(this.score.duration, ovEye, ov.target, 0.75, true),
    ];
    this.camEye = new Spline(keys.map((x) => ({ t: x.t, v: x.eye, hold: x.hold })));
    this.camTgt = new Spline(keys.map((x) => ({ t: x.t, v: x.target, hold: x.hold })));
    this.camFov = new Spline(keys.map((x) => ({ t: x.t, v: [x.fov], hold: x.hold })));
    const M = this.M, tc = this.tc, home = M.F + 4;
    this.c = {
      ambient: new Curve([[0, 1], [4, 0.22, 'inOut'], [M.C, 0.22], [M.C + 4, 0.32], [tc - 0.1, 0.3], [tc + 0.2, 0.9], [tc + 5, 0.35], [M.F + 1, 0.3], [home, 1, 'inOut']]),
      tv: new Curve([[0, 1], [tc, 0.85], [tc + 2.5, 0, 'inOut'], [M.F + 1.5, 0], [home, 1, 'inOut']]),
      sky: new Curve([[0, 0], [tc - 0.1, 0], [tc + 2.6, 1, 'inOut'], [M.F + 0.5, 1], [M.F + 3.4, 0, 'inOut']]),
      threads: new Curve([[0, 0], [M.C - 0.5, 0], [M.C + 5, 0.28, 'out'], [tc - 1, 0.4], [tc, 0.7]]),
      ribs: new Curve([[0, 0]]), // (the walls sink away now: nothing to light)
      exposure: new Curve([[0, 1.75], [5, 1.6], [tc - 0.1, 1.75], [tc + 0.15, 2.9], [tc + 4, 2.1], [home, 1.75]]),
      bloom: new Curve([[0, 0.12], [M.C, 0.2], [tc - 0.1, 0.24], [tc + 0.1, 0.45], [tc + 5, 0.26], [home, 0.12]]),
    };
    room.layers.push(this);
    room.tvGain = 1;
  }

  // ---------------------------------------------------------------- per frame
  update(t, dt, state) {
    const room = this.room;
    const M = this.M;
    this.t = t;
    this.dt = dt;
    if (state === 'playing' && !this.run.chromeHidden && t > 0.15 && t < M.chrome) {
      this.run.chromeHidden = true;
      this.run.emit('chrome', false);
    }
    if (this.run.chromeHidden && t >= M.chrome) {
      this.run.chromeHidden = false;
      this.run.emit('chrome', true);
    }
    // camera, room shape, sky, light levels
    const fov = this.camFov.at(t)[0];
    room.camOverride = { eye: this.camEye.at(t), target: this.camTgt.at(t), fov, far: 140 };
    const shape = this.score.room(t);
    const ribs = this.c.ribs.at(t);
    shape.ribs = ribs > 0.001 ? rgbMul([0.16, 0.12, 0.07], ribs * (0.8 + 0.2 * Math.sin(t * 0.7)) * (1 + 2 * pulse(t, this.tc, 0.05, 2))) : null;
    shape.ribSpacing = 2.2;
    room.setShape(shape);
    const sky = this.c.sky.at(t);
    room.sky.amount = sky;
    room.sky.stars = 1 + 1.8 * sky; // a properly starry night once the room is open
    room.sky.glow = rgbMul([0.03, 0.02, 0.012], sm(this.tc - 0.5, this.tc + 2, t) * (1 - this._collapse(t)) * (1 + 4 * pulse(t, this.tc, 0.05, 2.5)));
    const drop = this._drop(t);
    room.ambient = this.c.ambient.at(t) * (1 - 0.65 * drop.breath) + 0.5 * drop.hit;
    room.tvGain = this.c.tv.at(t);
    // the TV: the metronome and the notes to come, until the chord; then the room's own card again
    if (t < this.tc + 3) room.setTVSource(this.tv.draw(t, sm(0, 1.2, t)), [0.03, 0.035, 0.05]);
    else if (room.tvSource) room.setTVSource(null, [0.05, 0.07, 0.12]);
    room.postOverride = {
      exposure: this.c.exposure.at(t) * (1 - 0.3 * drop.breath) + 1.2 * drop.hit * drop.hit, bloomStrength: this.c.bloom.at(t) + 0.35 * drop.hit,
      threshold: 0.6, vignette: 0.55,
      shock: this._shock(t), shockStrength: this._shockStrength(t),
    };
    // the sub shakes the picture a little
    let shake = 0;
    for (let i = lastBefore(this.subs, t); i >= 0 && t - this.subs[i].t < 0.4; i--) shake = Math.max(shake, pulse(t, this.subs[i].t, 0.01, 0.12) * this.subs[i].vel);
    shake = Math.max(shake, drop.hit * 5.5); // the drop shakes the whole room
    room.shake = Math.max(room.shake * 0.8, shake * 0.012);
    this._lights(t);
    const eng = this.app.engine;
    const lv = eng.ready ? eng.levels() : null;
    room.update(dt, lv ? (role) => eng.levelOf(role) * 2.6 : null);
  }

  _shock(t) {
    // the chord ripples the picture from the rings' centre
    return [0.5, 0.55, Math.max(0, (t - this.tc) * 0.9)];
  }

  _shockStrength(t) {
    return pulse(t, this.tc, 0.02, 0.9) * 1.6;
  }

  /** Point lights for the room shader: the brightest beads in flight, the hum, the sub. */
  _lights(t) {
    const room = this.room;
    const L = [];
    for (const b of this._activeBeads(t)) {
      if (b.pos) L.push({ pos: b.pos, col: rgbMul(COL[b.inst], 1.6 * b.amp), dir: [0, 0, 0], cos: -2, range: 2.6, w: b.amp });
    }
    const hum = this._humLevel(t);
    if (hum > 0.01 && this.anchor.FC) L.push({ pos: v3.add(this.anchor.FC, [0, 0.15, 0.5]), col: rgbMul(COL.hum, 1.2 * hum), dir: [0, 0, 0], cos: -2, range: 2.4, w: hum * 0.8 });
    let sub = 0;
    for (let i = lastBefore(this.subs, t); i >= 0 && t - this.subs[i].t < 1.5; i--) sub = Math.max(sub, pulse(t, this.subs[i].t, 0.01, 0.35) * this.subs[i].vel);
    if (sub > 0.01 && room.speakers.sub) {
      const p = room.speakers.sub.pos;
      L.push({ pos: [p[0] + 0.7, 0.4, p[2] - 0.7], col: rgbMul(COL.sub, 1.8 * sub), dir: [0, 0, 0], cos: -2, range: 3.2, w: sub });
    }
    const drop = this._drop(t);
    const ball = this.marbles.states(t).find((s) => s.m.key === 'sub');
    if (ball && ball.flash > 0.05) L.push({ pos: ball.pos, col: rgbMul(COL.sub, 2.2 * ball.flash), dir: [0, 0, 0], cos: -2, range: 3.5, w: 2 * ball.flash });
    if (drop.hit > 0.01 && room.speakers.sub) {
      const p = room.speakers.sub.pos;
      L.push({ pos: [p[0] + 0.9, 1.2, p[2] + 0.9], col: rgbMul([1.0, 0.18, 0.05], 9 * drop.hit), dir: [0, 0, 0], cos: -2, range: 10, w: 8 * drop.hit });
    }
    if (t > this.tc - 0.5 && t < this.M.F + 4) {
      // the chord floods the opened room with warm light from above the rings
      const flood = pulse(t, this.tc, 0.08, 3) * 6;
      L.push({ pos: [0, 4.2, -0.7], col: rgbMul([1.0, 0.82, 0.55], (0.6 + flood) * (1 - this._collapse(t))), dir: [0, -1, 0.15], cos: Math.cos(1.2), range: 14, w: 3 });
    }
    L.sort((a, b) => b.w - a.w);
    room.extraLights = L.slice(0, 7);
  }

  _humLevel(t) {
    let v = 0;
    for (let i = lastBefore(this.hums, t); i >= 0 && t - this.hums[i].t < 12; i--) {
      const e = this.hums[i];
      const x = t - e.t;
      if (x < e.dur + 1.5) v = Math.max(v, Math.min(1, x / 0.9) * (x > e.dur ? Math.max(0, 1 - (x - e.dur) / 1.5) : 1) * e.vel);
    }
    return v;
  }

  _activeBeads(t) {
    if (!this._beadCache || this._beadCache.t !== t) {
      const out = [];
      for (const b of this.beads) {
        if (t < b.t0 || t > b.t1 + 0.9) continue;
        const x = clamp((t - b.t0) / (b.t1 - b.t0), 0, 1);
        const land = t > b.t1 ? Math.exp(-(t - b.t1) / 0.25) : 1;
        const amp = (0.5 + 0.5 * b.vel) * land * (0.35 + 0.65 * x);
        out.push({ ...b, x, amp, pos: this._beadPos(b, x, t) });
      }
      this._beadCache = { t, list: out };
    }
    return this._beadCache.list;
  }

  /** Where a bead is: along the thread between its towers (or around its ring, once threads are rings). */
  _beadPos(b, x, t) {
    const th = this._threadFor(b.from, b.to);
    if (!th) return null;
    const u = th.rev ? 1 - x : x;
    const pts = this._threadPoints(th.thread, t);
    const f = u * NPTS;
    const i = Math.min(NPTS - 1, Math.floor(f));
    b.u = u;
    b.thread = th.thread;
    return v3.lerp(pts[i], pts[i + 1], f - i);
  }

  _threadFor(a, b) {
    for (const th of this.threads) {
      if (th.a === a && th.b === b) return { thread: th, rev: false };
      if (th.a === b && th.b === a) return { thread: th, rev: true };
    }
    return null;
  }

  // ---------------------------------------------------------------- threads -> rings
  _ringFrame(i, t) {
    // each ring spins on its own tilted axis; at the chord they all turn to face us
    const sp = (0.11 + 0.035 * i) * (i % 2 ? 1 : -1);
    const tilt = 0.5 + 0.13 * i;
    const a = t * sp + i * 0.9;
    let e1 = [Math.cos(a), Math.sin(a) * Math.sin(tilt), Math.sin(a) * Math.cos(tilt)];
    let e2 = v3.norm(v3.cross([Math.sin(tilt * 0.7 + i), Math.cos(tilt), 0.3], e1));
    e2 = v3.norm(v3.sub(e2, v3.scale(e1, v3.dot(e1, e2))));
    const align = sm(this.tc + 3, this.tc + 4.6, t);
    if (align > 0) {
      const ph = t * 0.05 + i * 0.4;
      e1 = v3.norm(v3.lerp(e1, [Math.cos(ph), Math.sin(ph), 0], align));
      e2 = v3.norm(v3.lerp(e2, [-Math.sin(ph), Math.cos(ph), 0], align));
    }
    return [e1, e2];
  }

  _ringRadius(i, t) {
    const r = 0.75 + 0.36 * i;
    const grow = 1 + 0.12 * sm(this.tc, this.tc + 6, t);
    return r * grow;
  }

  _collapse(t) {
    // the rings fold back into the TV
    return sm(this.M.F, this.M.F + 3.2, t);
  }

  _threadPoints(th, t) {
    if (th._t === t) return th._pts;
    const i = th.idx;
    const m = sm(this.tc - 0.15 + i * 0.07, this.tc + 1.5 + i * 0.07, t); // the threads lift into rings with the chord
    const pts = th._pts || th.pts.map((p) => p.slice());
    const col = this._collapse(t);
    const tvC = [0, this.room.tv.y, this.room.tv.z];
    if (m <= 0) {
      // a gentle sway once the room starts to expand
      const sway = sm(this.M.D, this.M.D + 6, t) * 0.06;
      for (let k = 0; k <= NPTS; k++) {
        const u = k / NPTS;
        const env = Math.sin(Math.PI * u);
        const p = th.pts[k];
        pts[k][0] = p[0];
        pts[k][1] = p[1] + sway * env * Math.sin(t * 1.3 + u * 5 + i);
        pts[k][2] = p[2] + sway * env * Math.cos(t * 1.1 + u * 4 + i);
      }
    } else {
      const [e1, e2] = this._ringFrame(i, t);
      const R = this._ringRadius(i, t) * (1 - col);
      const C = v3.lerp(RING_C, tvC, col);
      const lift = Math.sin(Math.PI * m) * (0.6 + i * 0.12);
      const mm = m * m * (3 - 2 * m);
      for (let k = 0; k <= NPTS; k++) {
        const u = k / NPTS;
        const a = u * Math.PI * 2 + i;
        const ring = [C[0] + R * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]), C[1] + R * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]),
          C[2] + R * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2])];
        const p = th.pts[k];
        pts[k][0] = p[0] + (ring[0] - p[0]) * mm;
        pts[k][1] = p[1] + (ring[1] - p[1]) * mm + lift * Math.sin(Math.PI * u) * (1 - mm);
        pts[k][2] = p[2] + (ring[2] - p[2]) * mm;
      }
      th.m = m;
    }
    if (m <= 0) th.m = 0;
    th._pts = pts;
    th._t = t;
    return pts;
  }

  // ---------------------------------------------------------------- drawing (called by the room)
  draw(ctx) {
    const gl = this.gl;
    const t = this.t || 0;
    this.marbles.draw(ctx, t); // solid glass first (they write depth), then everything that glows
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._drawRipples(ctx, t);
    this._drawThreads(ctx, t);
    this._drawSprites(ctx, t);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _threadCharge(th, t) {
    // threads brighten when either of their towers plays (groove), and while beads cross them
    let c = 0;
    for (const role of [th.a, th.b]) {
      const list = this.byRole[role === 'FC' ? 'C' : role];
      if (!list) continue;
      for (let i = lastBefore(list, t); i >= 0 && t - list[i].t < 1.2; i--) c = Math.max(c, pulse(t, list[i].t, 0.01, 0.35) * list[i].vel);
    }
    return c;
  }

  _drawThreads(ctx, t) {
    const gl = this.gl;
    const P = this.ribbonProg.use();
    P.setAll({ uVP: ctx.vp, uCam: ctx.eye, uTime: t });
    const base = this.c.threads.at(t);
    const beads = this._activeBeads(t);
    const fadeOut = 1 - this._collapse(t);
    const flare = 1 + 4 * pulse(t, this.tc, 0.05, 2.2);
    const draws = [];
    for (const th of this.threads) {
      const pts = this._threadPoints(th, t);
      const mine = beads.filter((b) => b.thread === th);
      // before the groove, a thread only exists while something travels along it
      const life = mine.reduce((a, b) => Math.max(a, b.amp), 0);
      th.trail = Math.max((th.trail || 0) * Math.exp(-(this.dt || 0.016) / 0.9), life * 0.5);
      const groove = t >= this.M.C ? this._threadCharge(th, t) : 0;
      const bright = (Math.max(base, th.trail * 0.6) + groove * 0.35) * flare * (th.m > 0 ? 1 + th.m * 0.6 : 1) * fadeOut;
      if (bright < 0.004 && !mine.length) continue;
      const beadU = new Float32Array(6).fill(-10), beadA = new Float32Array(6);
      mine.slice(0, 6).forEach((b, k) => {
        beadU[k] = b.u;
        beadA[k] = b.amp;
      });
      const toGold = sm(this.tc - 0.3, this.tc + 1.5, t);
      draws.push({ pts, bright, beadU, beadA, closed: th.m || 0, colA: rgbMix(th.colA, COL.lead, toGold), colB: rgbMix(th.colB, COL.lead, toGold), flow: 1.5 + 2 * (th.m || 0) });
    }
    const hum = this._humLevel(t);
    if (hum > 0.01 && this.anchor.FC) {
      const c = this.anchor.FC;
      const pts = [];
      for (let k = 0; k <= NPTS; k++) {
        const u = k / NPTS;
        const wv = Math.sin(Math.PI * u * 3) * Math.sin(t * 9.0) * 0.025 * hum;
        pts.push([c[0] - 0.5 + u, c[1] + 0.2 + wv, c[2] + 0.06]);
      }
      draws.push({ pts, bright: 0.9 * hum, beadU: new Float32Array(6).fill(-10), beadA: new Float32Array(6), closed: 0, colA: COL.hum, colB: COL.hum, flow: 6 });
    }
    // pack every ribbon into one buffer, draw each with its own uniforms
    const buf = this.ribbonBuf;
    const d = buf.data;
    let v = 0;
    const ranges = [];
    for (const dr of draws) {
      const start = v;
      const pts = dr.pts;
      for (let k = 0; k <= NPTS; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(NPTS, k + 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
        const l = Math.hypot(tx, ty, tz) || 1;
        tx /= l; ty /= l; tz /= l;
        for (const side of [-1, 1]) {
          const o = v * 8;
          d[o] = pts[k][0]; d[o + 1] = pts[k][1]; d[o + 2] = pts[k][2];
          d[o + 3] = tx; d[o + 4] = ty; d[o + 5] = tz;
          d[o + 6] = k / NPTS; d[o + 7] = side;
          v++;
        }
      }
      ranges.push([start, v - start, dr]);
    }
    buf.upload(v);
    for (const [first, count, dr] of ranges) {
      P.setAll({ uWidth: dr.closed > 0.5 ? 0.035 : 0.028, uColA: dr.colA, uColB: dr.colB, uBright: dr.bright, uClosed: dr.closed > 0.98 ? 1 : 0,
        uFlow: dr.flow, uBead: dr.beadU, uBeadAmp: dr.beadA });
      buf.draw(gl.TRIANGLE_STRIP, first, count);
    }
  }

  _drawRipples(ctx, t) {
    const gl = this.gl;
    const items = [];
    const room = this.room;
    for (let i = lastBefore(this.ticks, t); i >= 0 && t - this.ticks[i].t < 1.6; i--) {
      const e = this.ticks[i];
      const id = room.idForRole(e.spk);
      if (!id) continue;
      const p = room.speakers[id].pos;
      const age = t - e.t;
      items.push({ x: p[0], z: p[2], r: 0.25 + age * 1.1, col: COL.tick, a: Math.exp(-age / 0.45) * e.vel * 1.4, w: 0.06 });
    }
    const sp = room.speakers.sub;
    if (sp && this.tDrop !== undefined) {
      // the drop: shockwaves racing out across the floor from the subwoofer
      for (let k = 0; k < 3; k++) {
        const age = t - this.tDrop - k * 0.13;
        if (age >= 0 && age < 2.4) items.push({ x: sp.pos[0], z: sp.pos[2], r: 0.6 + age * (5.2 - k * 1.2), col: [1.0, 0.3, 0.08], a: Math.exp(-age / 0.55) * (2.6 - k * 0.6), w: 0.045 });
      }
    }
    if (sp) {
      for (let i = lastBefore(this.subs, t); i >= 0 && t - this.subs[i].t < 2.5; i--) {
        const e = this.subs[i];
        const age = t - e.t;
        items.push({ x: sp.pos[0], z: sp.pos[2], r: 0.5 + age * 1.4, col: COL.sub, a: Math.exp(-age / 0.55) * e.vel * 0.55, w: 0.045 });
      }
    }
    const age = t - this.tc; // the chord: a ring of light across the floor from under the rings
    if (age >= 0 && age < 4) items.push({ x: RING_C[0], z: RING_C[2], r: 0.5 + age * 4.5, col: [1.0, 0.85, 0.55], a: Math.exp(-age / 1.4) * 2.2, w: 0.06 });
    this.marbles.rings(t, (it) => items.push(it));
    if (!items.length) return;
    const d = this.rippleBuf.data;
    let v = 0;
    for (const it of items.slice(0, 64)) {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [u, w] of corners) {
        const o = v * 10;
        d[o] = it.x + u * it.r; d[o + 1] = it.y ?? 0.012; d[o + 2] = it.z + w * it.r;
        d[o + 3] = u; d[o + 4] = w;
        d[o + 5] = it.col[0]; d[o + 6] = it.col[1]; d[o + 7] = it.col[2]; d[o + 8] = it.a;
        d[o + 9] = it.w;
        v++;
      }
    }
    this.rippleBuf.upload(v);
    this.rippleProg.use().set('uVP', ctx.vp);
    this.rippleBuf.draw(gl.TRIANGLES);
  }

  _drawSprites(ctx, t) {
    const gl = this.gl;
    const d = this.spriteBuf.data;
    let v = 0;
    const push = (p, col, size) => {
      if (v >= this.spriteBuf.max) return;
      const o = v * 7;
      d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
      d[o + 3] = col[0]; d[o + 4] = col[1]; d[o + 5] = col[2]; d[o + 6] = size;
      v++;
    };
    const beads = this._activeBeads(t);
    for (const b of beads) {
      if (!b.pos) continue;
      push(b.pos, rgbMul(COL[b.inst], 2.2 * b.amp), 0.07 + 0.05 * b.amp);
      push(b.pos, rgbMul(COL[b.inst], 0.35 * b.amp), 0.4);
    }
    this.marbles.halos(t, push);
    // a spark at each tower when it plays (except during the full groove, where the halos say it)
    for (const role of ['FL', 'FR', 'SR', 'SL', 'C']) {
      const list = this.byRole[role];
      const a = this.anchor[role === 'C' ? 'FC' : role];
      if (!list || !a) continue;
      for (let i = lastBefore(list, t); i >= 0 && t - list[i].t < 0.8; i--) {
        const e = list[i];
        if (e.inst === 'click') continue;
        const k = pulse(t, e.t, 0.005, 0.18) * e.vel;
        push(a, rgbMul(COL[e.inst === 'tick' ? 'tick' : ROLE_INST[role]], 1.4 * k), 0.12 + 0.1 * k);
      }
    }
    // stars: the music box sparkles, out in the opened space
    const rng = this._starRng || (this._starRng = this.stars.map((e, i) => {
      const r = new Rng(1000 + i);
      const az = ((e.pos.az || 0) * Math.PI) / 180;
      const dist = 7 + r.range(0, 16);
      return [Math.sin(az) * dist, 2.5 + r.range(0, 9), -Math.cos(az) * dist];
    }));
    for (let i = lastBefore(this.stars, t); i >= 0 && t - this.stars[i].t < 2.5; i--) {
      const e = this.stars[i];
      const k = pulse(t, e.t, 0.01, 0.6) * (0.4 + e.vel * 2);
      push(rng[i], rgbMul(COL.star, 1.8 * k), 0.12 + 0.2 * k);
    }
    // motes: dust in the beam of whatever is lit
    const open = sm(this.tc, this.tc + 3, t) * (1 - this._collapse(t));
    const bead0 = beads.filter((b) => b.pos).slice(0, 6);
    const glowBase = 0.006 + 0.01 * this.c.threads.at(t) + 0.02 * pulse(t, this.tc, 0.05, 4);
    for (const m of this.motes) {
      const x = m[0] * (1 + open * 1.6) + Math.sin(t * 0.07 + m[3]) * 0.3;
      const y = m[1] * (1 + open * 1.2) + Math.sin(t * 0.05 + m[3] * 1.3) * 0.2;
      const z = m[2] * (1 + open * 1.5) + Math.cos(t * 0.06 + m[3] * 0.7) * 0.3;
      let b = glowBase;
      for (const bd of bead0) {
        const dx = x - bd.pos[0], dy = y - bd.pos[1], dz = z - bd.pos[2];
        b += (bd.amp * 0.5) / (1 + (dx * dx + dy * dy + dz * dz) * 6);
      }
      push([x, y, z], [b * 0.9, b * 0.85, b * 0.75].map((q) => q * m[4]), 0.012);
    }
    if (!v) return;
    this.spriteBuf.upload(v);
    const px = ctx.h / (2 * Math.tan((this.room.camOverride ? this.room.camOverride.fov : 0.75) / 2));
    this.spriteProg.use().setAll({ uVP: ctx.vp, uPx: px });
    this.spriteBuf.draw(gl.POINTS);
  }

  // ---------------------------------------------------------------- frame
  render(w, h) {
    const app = this.app;
    this.room.render(w, h, app.rig.fixtures, null);
  }

  // ---------------------------------------------------------------- Hue cues
  light(f, t) {
    const M = this.M;
    const room = this.room;
    let c;
    const amb = this.app.rig._ambient(f);
    const dark = [0.012, 0.012, 0.022];
    if (t < M.C) c = rgbMix(amb, dark, sm(0.3, 4, t));
    else if (t < this.tc) c = rgbMix(dark, [0.04, 0.035, 0.09], sm(M.C, M.C + 6, t));
    else c = rgbMix([0.04, 0.035, 0.09], [0.08, 0.09, 0.26], sm(this.tc, this.tc + 3, t));
    // the chord: everything warm white
    const flood = sm(this.tc - 0.05, this.tc + 0.1, t) * (1 - sm(this.tc + 2, M.F + 3, t));
    c = rgbMix(c, [1.5, 1.15, 0.72].map((x) => x * (0.45 + 0.55 * Math.exp(-(t - this.tc) / 2.5))), flood);
    // the sub's drop: the room darkens towards red through the build, holds its breath, then everything flashes red
    const drop = this._drop(t);
    c = rgbMix(c, [0.06, 0.004, 0.0], drop.build * 0.6);
    c = c.map((x) => x * (1 - 0.7 * drop.breath));
    c = c.map((x, i) => x + [1.4, 0.16, 0.04][i] * drop.hit);
    // back home
    c = rgbMix(c, amb, sm(M.F + 2, M.F + 5, t));
    // per-fixture accents
    if (f.anchor === 'tv') {
      const hum = this._humLevel(t);
      c = c.map((x, i) => x + COL.hum[i] * hum * 0.22);
      for (const b of this.bells) if (t >= b.t && t - b.t < 4) c = c.map((x, i) => x + [0.9, 0.7, 0.45][i] * pulse(t, b.t, 0.02, 1.2) * 0.6);
      return c;
    }
    const sp = room.speakers[f.anchor];
    if (!sp) return c;
    const role = sp.role;
    const list = this.byRole[role];
    if (list) {
      for (let i = lastBefore(list, t); i >= 0 && t - list[i].t < 1.6; i--) {
        const e = list[i];
        if (e.inst === 'click') continue;
        const inst = e.inst === 'tick' ? 'tick' : e.inst === 'lead' ? 'lead' : ROLE_INST[role];
        const k = pulse(t, e.t, 0.01, e.inst === 'tick' ? 0.15 : 0.45) * e.vel * (e.inst === 'tick' && t < M.B ? 0.4 : 0.9);
        c = c.map((x, j) => x + COL[inst][j] * k);
      }
    }
    for (const b of this._activeBeads(t)) {
      if (b.to === role) c = c.map((x, j) => x + COL[b.inst][j] * b.amp * 0.5 * clamp(b.x, 0, 1));
    }
    if (role === 'SL' || role === 'SR') {
      let s = 0;
      for (let i = lastBefore(this.subs, t); i >= 0 && t - this.subs[i].t < 1; i--) s = Math.max(s, pulse(t, this.subs[i].t, 0.01, 0.25) * this.subs[i].vel);
      c = c.map((x, j) => x + COL.sub[j] * s * 0.18);
    }
    return c;
  }

  dispose() {
    const room = this.room;
    room.layers = room.layers.filter((l) => l !== this);
    room.camOverride = null;
    room.extraLights = [];
    room.postOverride = null;
    room.setShape(null);
    room.sky.amount = 0;
    room.sky.stars = 1;
    room.ambient = 1;
    room.tvGain = 1;
    room.setTVSource(null, [0.05, 0.07, 0.12]);
    room.shake = 0;
    for (const id in room.speakers) delete room.speakers[id].glowColor;
    // hand the camera back exactly where the experience left it: the overview
    const ov = room.presets.overview;
    room.cam = { ...ov, target: ov.target.slice() };
    room.camT = undefined;
    room.preset = 'overview';
    room.idleBase = undefined;
    room.lastInteract = room.time;
    const gl = this.gl;
    for (const b of [this.ribbonBuf, this.rippleBuf, this.spriteBuf]) if (b) b.dispose();
    if (this.marbles) this.marbles.dispose();
    if (this.tv) this.tv.dispose();
    for (const p of [this.ribbonProg, this.rippleProg, this.spriteProg]) if (p) gl.deleteProgram(p.prog);
  }
}

void m4;
void lerp;
void SPK;
