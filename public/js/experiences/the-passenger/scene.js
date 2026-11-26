// The Passenger: the picture. Plays in the 3D room: the camera finds the couch, a cat appears on the backrest,
// hops down onto the empty seat, kneads, turns twice and curls up; as it sleeps the room opens into its dream
// (the walls drift away, enormous strands of wool float through warm amber air, dust glows), until one ear
// twitches. The lights breathe with the purr. Click the sleeping cat for a surprise.
import { Program } from '../../gl/gl.js';
import { v3, m4 } from '../../gl/math.js';
import { Curve, smoothstep, clamp, lerp, pulse, Rng } from '../core/timeline.js';
import { DynBuffer, Spline, spriteProgram, rgbMul, rgbMix } from '../core/gfx.js';
import { CatRenderer } from '../core/cat.js';

const sm = smoothstep;
const NS = 64; // points per strand

// thick, soft strands of wool: camera-facing tubes with a ply twist and a fuzzy edge
const WOOL_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aT;
layout(location = 2) in vec4 aS;   // side (-1/1), u along, radius, strand index
uniform mat4 uVP;
uniform vec3 uCam;
out vec2 vSU;
out float vR;
out float vI;
out vec3 vP;
out vec3 vB;
out vec3 vV;
void main() {
  vec3 V = normalize(uCam - aP);
  vec3 B = normalize(cross(aT, V));
  vec3 p = aP + B * aS.x * aS.z * 1.35;
  vSU = vec2(aS.x * 1.35, aS.y);
  vR = aS.z;
  vI = aS.w;
  vP = aP;
  vB = B;
  vV = V;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const WOOL_FS = `#version 300 es
precision highp float;
in vec2 vSU;
in float vR;
in float vI;
in vec3 vP;
in vec3 vB;
in vec3 vV;
out vec4 outColor;
uniform vec3 uCol[9];
uniform float uLen[9];
uniform float uAmt, uTime;
uniform vec3 uKey, uKeyCol;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  float s = vSU.x;
  int i = int(vI + 0.5);
  float len = uLen[i];
  float core = 1.0 - s * s;
  // fuzz: fibres sticking out past the edge
  float fib = h12(floor(vec2(vSU.y * len * 260.0, (s + 2.0) * 9.0)));
  float edge = (1.0 - smoothstep(0.72, 1.0, abs(s))) + step(abs(s), 1.32) * step(0.86, fib) * 0.55;
  if (edge < 0.02) discard;
  vec3 N = normalize(vB * s + vV * sqrt(max(core, 0.0)));
  // plies twisting around the strand
  float ply = sin((vSU.y * len * 26.0 + s * 2.2) * 3.14159);
  float strands = 0.75 + 0.25 * smoothstep(-0.6, 0.9, ply);
  vec3 base = uCol[i] * strands;
  vec3 L = normalize(uKey - vP);
  float diff = max(0.0, dot(N, L) * 0.6 + 0.4);
  float rim = pow(1.0 - max(0.0, dot(N, vV)), 2.5);
  // ends taper away
  float taper = smoothstep(0.0, 0.06, vSU.y) * (1.0 - smoothstep(0.9, 1.0, vSU.y));
  vec3 col = base * (uKeyCol * diff * 0.6 + vec3(0.05, 0.035, 0.025)) + base * rim * 0.35 * uKeyCol;
  float a = clamp(edge, 0.0, 1.0) * taper * uAmt;
  outColor = vec4(col * a, a);
}`;

export class Scene {
  constructor(app, score, run) {
    this.app = app;
    this.room = app.room;
    this.gl = app.gl;
    this.score = score;
    this.run = run;
    this.M = score.marks;
    this.rng = new Rng(11);
    this.glints = score.events.filter((e) => e.inst === 'glint');
  }

  async init() {
    const gl = this.gl;
    const room = this.room;
    const M = this.M;
    this.cat = new CatRenderer(gl, { fur: [0.4, 0.31, 0.22], stripe: [0.09, 0.065, 0.05], white: [0.84, 0.82, 0.78] });
    this.woolProg = new Program(gl, WOOL_VS, WOOL_FS, 'passenger-wool');
    this.woolBuf = new DynBuffer(gl, [[0, 3], [1, 3], [2, 4]], this.score.strands.length * (NS * 2 + 2) + 8);
    this.spriteProg = spriteProgram(gl);
    this.spriteBuf = new DynBuffer(gl, [[0, 3], [1, 4]], 900);
    this.motes = [];
    for (let i = 0; i < 700; i++) this.motes.push([this.rng.range(-7, 7), this.rng.range(0.1, 5), this.rng.range(-7, 6), this.rng.range(0, 100), this.rng.range(0.4, 1)]);
    // camera: from the home view to the couch, onto the cat, round it in the dream, face to face at the end
    const e0 = room.eye();
    const t0 = room.cam.target.slice();
    const ov = room.presets.overview;
    const ovEye = [ov.target[0] + ov.radius * Math.cos(ov.phi) * Math.sin(ov.theta), ov.target[1] + ov.radius * Math.sin(ov.phi),
      ov.target[2] + ov.radius * Math.cos(ov.phi) * Math.cos(ov.theta)];
    const C = [0.42, 0.52, 0.25];
    const orbit = (a, r, y) => [C[0] + Math.sin(a) * r, y, C[2] - Math.cos(a) * r];
    const k = (t, eye, target, fov, hold = false) => ({ t, eye, target, fov, hold });
    const keys = [
      k(0, e0, t0, 0.75, true), k(0.6, e0, t0, 0.75, true),
      k(5.6, [1.85, 1.75, -1.75], [0.2, 0.8, 0.55], 0.8),
      k(10.4, [1.55, 1.55, -1.45], [0.35, 0.85, 0.55], 0.78),
      k(13.2, [1.35, 1.25, -1.05], [0.42, 0.62, 0.35], 0.74),
      k(M.turn1, [1.2, 1.12, -0.92], [0.42, 0.56, 0.3], 0.72),
      k(M.settled + 4, [1.0, 0.95, -0.62], [0.42, 0.5, 0.27], 0.64),
      k(M.dream0, [0.9, 0.86, -0.5], [0.42, 0.5, 0.26], 0.6),
      k(M.dream + 6, orbit(0.75, 1.9, 1.45), [0.42, 0.75, 0.25], 0.78),
      k(M.dream + 20, orbit(0.1, 2.6, 2.1), [0.42, 1.0, 0.25], 0.86),
      k(M.dream + 34, orbit(-0.8, 2.4, 1.3), [0.42, 0.7, 0.25], 0.84),
      k(M.twitch - 4, orbit(-0.35, 1.5, 0.95), [0.42, 0.55, 0.25], 0.72),
      k(M.twitch + 1.1, orbit(0.12, 1.0, 0.78), [0.42, 0.55, 0.25], 0.62, true),
      k(M.down + 0.5, orbit(0.12, 1.0, 0.78), [0.42, 0.55, 0.25], 0.62),
      k(M.end - 0.4, [1.3, 1.2, -1.4], [0.35, 0.65, 0.3], 0.7),
    ];
    this.camEye = new Spline(keys.map((x) => ({ t: x.t, v: x.eye, hold: x.hold })));
    this.camTgt = new Spline(keys.map((x) => ({ t: x.t, v: x.target, hold: x.hold })));
    this.camFov = new Spline(keys.map((x) => ({ t: x.t, v: [x.fov], hold: x.hold })));
    this.ovEye = ovEye;
    this.c = {
      ambient: new Curve([[0, 1], [3, 0.6, 'inOut'], [M.settled, 0.5], [M.dream0, 0.3, 'inOut'], [M.dream, 0.08, 'inOut'], [M.twitch, 0.08], [M.twitch + 0.8, 0.55, 'out'], [M.end - 0.5, 1, 'inOut']]),
      tv: new Curve([[0, 1], [3, 0.35, 'inOut'], [M.dream0, 0.25], [M.dream, 0, 'inOut'], [M.twitch, 0], [M.twitch + 1, 0.35], [M.end - 0.5, 1, 'inOut']]),
      exposure: new Curve([[0, 1.75], [M.settled, 1.8], [M.dream, 2.1, 'inOut'], [M.twitch, 2.1], [M.twitch + 0.6, 1.8], [M.end, 1.75]]),
    };
    room.layers.push(this);
    room.tvGain = 1;
  }

  // ---------------------------------------------------------------- per frame
  update(t, dt, state) {
    const room = this.room;
    const M = this.M;
    this.t = t;
    if (state === 'playing' && !this.run.chromeHidden && t > 0.15 && t < M.chrome) {
      this.run.chromeHidden = true;
      this.run.emit('chrome', false);
    }
    if (this.run.chromeHidden && t >= M.chrome) {
      this.run.chromeHidden = false;
      this.run.emit('chrome', true);
    }
    // a faint sway on the dream camera
    const d = this.score.dreamAmt.at(t);
    const fov = this.camFov.at(t)[0];
    const eye = v3.add(this.camEye.at(t), [Math.sin(t * 0.31) * 0.04 * d, Math.sin(t * 0.23) * 0.03 * d, 0]);
    room.camOverride = { eye, target: this.camTgt.at(t), fov, far: 160 };
    // the dream opens the room
    const a = d * d * (3 - 2 * d);
    room.setShape(a > 0.001 ? { left: 14 * a, right: 14 * a, front: 7 * a, back: 13 * a, split: 13 * a, height: 1 + 3.2 * a, open: a, ceiling: 1, ground: 0 } : null);
    room.sky.amount = a;
    room.sky.top = [0.05, 0.026, 0.014];
    room.sky.horizon = [0.24, 0.12, 0.045];
    room.sky.glow = [0.22, 0.1, 0.03].map((x) => x * (0.85 + 0.15 * this.score.breathAt(t)));
    room.sky.stars = 0.18;
    room.ambient = this.c.ambient.at(t);
    room.tvGain = this.c.tv.at(t);
    room.postOverride = { exposure: this.c.exposure.at(t), bloomStrength: 0.14 + 0.2 * d, threshold: 0.6, vignette: 0.55 + 0.1 * d, saturation: 1.05 + 0.1 * d };
    // a warm light over the sleeping cat, breathing with it; the dream glows from all around
    const br = this.score.breathAt(t);
    const sleep = this.score.sleep.at(t);
    const L = [];
    const warm = sm(M.settle, M.settled + 6, t) * (1 - sm(M.twitch, M.twitch + 1.2, t));
    if (warm > 0.01) L.push({ pos: [0.5, 1.9, 0.1], col: rgbMul([1.0, 0.62, 0.3], warm * (0.55 + 0.12 * br * sleep) + 1.1 * d), dir: [0, -1, 0], cos: Math.cos(0.9), range: 5 });
    if (d > 0.01) {
      L.push({ pos: [-2.5, 2.5, -2], col: rgbMul([1.0, 0.55, 0.25], 2.2 * d), dir: [0, 0, 0], cos: -2, range: 9 });
      L.push({ pos: [3, 1.5, 2.5], col: rgbMul([0.95, 0.5, 0.45], 1.6 * d), dir: [0, 0, 0], cos: -2, range: 9 });
    }
    // the chirp: a little catch-light in its eyes from the screen
    if (t > M.twitch) L.push({ pos: [0.42, 1.0, -0.8], col: rgbMul([0.6, 0.65, 0.75], 0.35 * sm(M.lift, M.lift + 1, t) * (1 - sm(M.down + 1, M.down + 2.5, t))), dir: [0, 0, 0], cos: -2, range: 2.5 });
    room.extraLights = L;
    const eng = this.app.engine;
    const lv = eng.ready ? eng.levels() : null;
    room.update(dt, lv ? (role) => eng.levelOf(role) * 2.6 : null);
  }

  // ---------------------------------------------------------------- the room layer
  draw(ctx) {
    const t = this.t || 0;
    this.vp = ctx.vp;
    this.eye = ctx.eye;
    const room = this.room;
    const fov = room.camOverride ? room.camOverride.fov : 0.75;
    const st = this.score.catState(t);
    st.breath = this.score.breathAt(t) * (st.lie > 0.5 ? 1 : 0.4);
    this.catNow = st;
    const lights = room._lights(this.app.rig.fixtures || []).map((l) => ({ pos: l.pos, col: l.col, dir: l.dir, cos: l.cos, range: l.range }));
    const amb = (1.6 + room.flash * 12) * room.ambient;
    const skyAmb = room.sky.amount * 0.6;
    const ambient = [[0.014 * amb + 0.02 * skyAmb + 0.03, 0.016 * amb + 0.014 * skyAmb + 0.024, 0.024 * amb + 0.008 * skyAmb + 0.02], [0.006 * amb + 0.01, 0.005 * amb + 0.008, 0.005 * amb + 0.007]];
    // only once it's out from behind the couch (the backrest hides it until the jump anyway)
    this.cat.draw(ctx, st, lights, { fov, amb: ambient, gain: st.gain, shadowY: st.pos[1] > 0.4 ? (st.pos[1] > 0.9 ? 1.04 : 0.447) : 0.004, whiskers: 0.8 });
    this._drawWool(ctx, t);
    this._drawDust(ctx, t, fov);
  }

  _strandPoints(sd, t) {
    const pts = [];
    for (let k = 0; k < NS; k++) {
      const u = k / (NS - 1);
      const th = sd.ph + t * sd.spin * 6.283 + u * sd.loops * 6.283;
      const R = sd.R * (0.8 + 0.2 * Math.sin(u * 5 + sd.ph + t * 0.1));
      const y = sd.cy + sd.ay * Math.sin(u * 8.2 + t * sd.fy * 6.283 + sd.ph) + (u - 0.5) * sd.rise;
      pts.push([0.42 + Math.cos(th) * R, y, 0.25 + Math.sin(th) * R]);
    }
    return pts;
  }

  _drawWool(ctx, t) {
    const d = this.score.dreamAmt.at(t);
    if (d < 0.01) return;
    const gl = this.gl;
    const buf = this.woolBuf;
    const data = buf.data;
    let n = 0;
    const put = (p, tg, side, u, r, i) => {
      const o = n * 10;
      data[o] = p[0]; data[o + 1] = p[1]; data[o + 2] = p[2];
      data[o + 3] = tg[0]; data[o + 4] = tg[1]; data[o + 5] = tg[2];
      data[o + 6] = side; data[o + 7] = u; data[o + 8] = r; data[o + 9] = i;
      n++;
    };
    const cols = new Float32Array(27), lens = new Float32Array(9);
    this.score.strands.forEach((sd, i) => {
      cols.set(sd.col, i * 3);
      lens[i] = sd.len;
      const pts = this._strandPoints(sd, t);
      // grow in as the dream arrives, shrink to nothing when it ends
      const r = sd.r * d;
      if (n > 0) put(pts[0], [1, 0, 0], -1, 0, r, i);
      for (let k = 0; k < NS; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(NS - 1, k + 1)];
        const tg = v3.norm(v3.sub(b, a));
        const u = k / (NS - 1);
        if (k === 0 && n > 0) put(pts[0], tg, -1, u, r, i);
        put(pts[k], tg, -1, u, r, i);
        put(pts[k], tg, 1, u, r, i);
      }
      put(pts[NS - 1], [1, 0, 0], 1, 1, r, i);
    });
    buf.upload(n);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.woolProg.use().setAll({ uVP: ctx.vp, uCam: ctx.eye, uCol: cols, uLen: lens, uAmt: Math.min(1, d * 1.3), uTime: t, uKey: [0.5, 2.6, -1.2], uKeyCol: [0.62, 0.5, 0.38] });
    buf.draw(gl.TRIANGLE_STRIP, 0, n);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _drawDust(ctx, t, fov) {
    const d = this.score.dreamAmt.at(t);
    const M = this.M;
    // a little dust catches the light over the cat even before the dream; the dream fills the air with it
    const pre = sm(M.settled, M.dream0, t) * (1 - sm(M.twitch, M.twitch + 0.6, t)) * 0.35;
    const k = Math.max(d, pre);
    if (k < 0.01) return;
    const gl = this.gl;
    const data = this.spriteBuf.data;
    let n = 0;
    const count = Math.floor(this.motes.length * (0.25 + 0.75 * d));
    for (let i = 0; i < count; i++) {
      const [x, y, z, ph, b] = this.motes[i];
      const tt = t * 0.12 + ph;
      const fall = d < 0.99 && t > M.twitch ? (t - M.twitch) * 1.5 : 0;
      const p = [x + Math.sin(tt * 0.9) * 0.4, ((y + tt * 0.08) % 5) - fall * (0.3 + 0.7 * b), z + Math.cos(tt * 0.7) * 0.4];
      if (d < 0.2 && Math.hypot(p[0] - 0.42, p[1] - 0.9, p[2] - 0.2) > 1.4) continue;
      const tw = 0.6 + 0.4 * Math.sin(t * (1 + b * 3) + ph * 10);
      const c = rgbMul([1.0, 0.72, 0.38], 0.5 * b * tw * k);
      data.set([p[0], p[1], p[2], c[0], c[1], c[2], 0.012 + 0.02 * b], n * 7);
      n++;
    }
    for (const g of this.glints) {
      if (t < g.t || t > g.t + 1.2) continue;
      const a = (g.az * Math.PI) / 180;
      const p = [Math.sin(a) * g.dist * 1.4, 1.2 + (g.n % 7) * 0.12, -Math.cos(a) * g.dist * 1.4];
      const c = rgbMul([1, 0.85, 0.6], pulse(t, g.t, 0.01, 0.35) * g.vel * 4);
      data.set([p[0], p[1], p[2], c[0], c[1], c[2], 0.09], n * 7);
      n++;
    }
    if (!n) return;
    this.spriteBuf.upload(n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    const px = ctx.h / (2 * Math.tan(fov / 2));
    this.spriteProg.use().setAll({ uVP: ctx.vp, uPx: px });
    this.spriteBuf.draw(gl.POINTS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  render(w, h) {
    this.room.render(w, h, this.app.rig.fixtures, null);
  }

  /** The easter egg: click the sleeping cat. */
  onClick(nx, ny) {
    const M = this.M;
    const t = this.t || 0;
    if (t < M.settled + 1 || t > M.twitch - 0.5 || !this.vp) return false;
    const inv = m4.invert(this.vp);
    const a = m4.transformPoint(inv, [nx, ny, -1]), b = m4.transformPoint(inv, [nx, ny, 1]);
    const dir = v3.norm(v3.sub(b, a));
    const c = [this.score.SEAT[0], this.score.SEAT[1] + 0.09, this.score.SEAT[2]];
    const oc = v3.sub(a, c);
    const bb = v3.dot(oc, dir);
    const cc = v3.dot(oc, oc) - 0.24 * 0.24;
    if (bb * bb - cc < 0) return false;
    this.app.runExperience('purr-rev');
    return true;
  }

  // ---------------------------------------------------------------- Hue
  light(f, t) {
    const M = this.M;
    const room = this.room;
    const amb = this.app.rig._ambient(f);
    const d = this.score.dreamAmt.at(t);
    const sleep = this.score.sleep.at(t);
    const br = this.score.breathAt(t);
    // the room settles into a low, warm night light while the cat is here
    let c = rgbMix(amb, [0.07, 0.05, 0.035], sm(0.5, 4, t) * (1 - sm(M.end - 3, M.end - 0.2, t)));
    const sp = f.anchor === 'tv' ? null : room.speakers[f.anchor];
    const az = sp ? sp.az : 0;
    // the purr breathes in the lights nearest the cat (to the right and behind)
    const nearCat = Math.max(0, Math.cos(((az - 110) * Math.PI) / 180));
    const purr = this.score.purr.at(t);
    c = c.map((x, i) => x + [0.3, 0.14, 0.04][i] * purr * (0.55 + 0.45 * br) * (0.25 + 0.75 * nearCat) * (0.4 + 0.6 * sleep));
    // the dream: every light a colour of wool, slowly moving round the room
    if (d > 0.01) {
      const wool = [[1.0, 0.72, 0.4], [0.95, 0.45, 0.45], [0.5, 0.62, 0.95], [0.62, 0.82, 0.5], [0.95, 0.6, 0.85]];
      const ph = t * 0.05 + az / 360;
      const i0 = Math.floor(((ph % 1) + 1) * wool.length) % wool.length;
      const i1 = (i0 + 1) % wool.length;
      const x = ((ph * wool.length) % 1 + 1) % 1;
      const w = rgbMix(wool[i0], wool[i1], x * x * (3 - 2 * x));
      c = rgbMix(c, w.map((v) => v * (0.35 + 0.15 * br)), d * 0.85);
    }
    // the chirp: a tiny wink from the light beside the cat
    if (t > M.chirp - 0.1 && t < M.chirp + 1) c = c.map((x, i) => x + [0.5, 0.4, 0.25][i] * pulse(t, M.chirp, 0.02, 0.25) * nearCat);
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
    room.sky.top = [0.0015, 0.002, 0.006];
    room.sky.horizon = [0.006, 0.008, 0.02];
    room.sky.glow = [0, 0, 0];
    room.sky.stars = 1;
    room.ambient = 1;
    room.tvGain = 1;
    room.shake = 0;
    const ov = room.presets.overview;
    room.cam = { ...ov, target: ov.target.slice() };
    room.camT = undefined;
    room.preset = 'overview';
    room.idleBase = undefined;
    room.lastInteract = room.time;
    const gl = this.gl;
    this.cat.dispose();
    for (const b of [this.woolBuf, this.spriteBuf]) if (b) b.dispose();
    for (const p of [this.woolProg, this.spriteProg]) if (p) gl.deleteProgram(p.prog);
  }
}

void lerp;
void clamp;
