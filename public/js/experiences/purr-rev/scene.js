// Purr / Rev: the picture. The sleeping cat on the seat; its whiskers light up and swing out into the markings of
// a rev counter, the seat turns racing red, the room flexes with the revs and the lights follow them; then it all
// settles back into a sleeping cat, which opens one eye.
import { v3 } from '../../gl/math.js';
import { smoothstep, clamp, lerp, pulse } from '../core/timeline.js';
import { LineBatch, rgbMul, rgbMix } from '../core/gfx.js';
import { CatRenderer } from '../core/cat.js';
import { CAR } from '../core/motor.js';

const sm = smoothstep;
const SEAT = [0.425, 0.447, 0.235];
const SLEEP_YAW = 2.45;

export class Scene {
  constructor(app, score, run) {
    this.app = app;
    this.room = app.room;
    this.gl = app.gl;
    this.score = score;
    this.run = run;
    this.M = score.marks;
  }

  async init() {
    const gl = this.gl;
    const room = this.room;
    this.cat = new CatRenderer(gl, { fur: [0.4, 0.31, 0.22], stripe: [0.09, 0.065, 0.05], white: [0.84, 0.82, 0.78] });
    this.dial = new LineBatch(gl, 6000);
    // the couch's leather, to dye it racing red (put back on dispose)
    this.leather = room.nodes.filter((n) => n.mat && n.mat.pattern === 3);
    this.leatherBase = this.leather.map((n) => n.mat.albedo.slice());
    room.layers.push(this);
  }

  update(t, dt, state) {
    const room = this.room;
    const M = this.M;
    this.t = t;
    if (state === 'playing' && !this.run.chromeHidden && t > 0.1 && t < M.end - 2.5) {
      this.run.chromeHidden = true;
      this.run.emit('chrome', false);
    }
    if (this.run.chromeHidden && t >= M.end - 2.5) {
      this.run.chromeHidden = false;
      this.run.emit('chrome', true);
    }
    const ctl = this.score.ctl;
    const rpm = ctl.at('rpm', t);
    const morph = this.score.morph.at(t);
    const rev = clamp((rpm - 1200) / (CAR.limiter - 1200), 0, 1) * morph;
    this.rev = rev;
    // camera: the close-up on the sleeping cat, pulled back and shaken by the revs
    const shake = rev * 0.004 + (rpm > 300 ? 0.0006 * morph : 0);
    const j = (f) => Math.sin(t * f) + 0.6 * Math.sin(t * f * 1.7 + 1.1);
    const eye = v3.add([1.0 + 0.25 * rev, 0.95 + 0.12 * rev, -0.62 - 0.35 * rev], [j(53) * shake, j(47) * shake, j(59) * shake]);
    room.camOverride = { eye, target: [0.42, 0.5 + 0.03 * rev, 0.27], fov: 0.62 + 0.12 * rev, far: 120 };
    // the room flexes with the engine
    let shift = 0;
    for (const s of this.score.shifts) shift = Math.max(shift, pulse(t, s + 0.07, 0.01, 0.25));
    const k = rev * 0.6 + shift * 0.4;
    room.setShape(k > 0.002 ? { left: k, right: k, front: k * 0.6, back: k, height: 1 + 0.08 * k, ribs: [0.5, 0.03, 0.02].map((x) => x * (rev * 0.5 + shift)), ribSpacing: 0.9 } : null);
    room.shake = Math.max(room.shake * 0.85, shift * 0.02);
    room.ambient = lerp(0.45, 0.12, morph);
    room.tvGain = lerp(0.3, 0.05, morph);
    room.postOverride = { exposure: 1.8 + 0.25 * rev, bloomStrength: 0.14 + 0.3 * rev + 0.4 * shift, threshold: 0.6, vignette: 0.6 + 0.15 * rev,
      shock: [0.55, 0.45, Math.max(0, (t - (this.score.shifts.find((s) => t > s) || 0)) * 1.2)], shockStrength: shift * 1.4, saturation: 1.05 + 0.15 * morph };
    // the seat dyed red
    this.leather.forEach((n, i) => {
      n.mat.albedo = rgbMix(this.leatherBase[i], [0.17, 0.01, 0.008], morph * 0.9);
    });
    // light: warm over the cat; red with the revs
    const L = [{ pos: [0.5, 1.9, 0.1], col: rgbMul([1.0, 0.62, 0.3], 0.55 * (1 - morph * 0.6)), dir: [0, -1, 0], cos: Math.cos(0.9), range: 5 }];
    if (morph > 0.01) L.push({ pos: [0.6, 0.9, -0.4], col: rgbMul([1.0, 0.08, 0.04], 0.25 * morph + 1.1 * rev + 1.4 * shift), dir: [0, 0, 0], cos: -2, range: 4 });
    room.extraLights = L;
    const eng = this.app.engine;
    const lv = eng.ready ? eng.levels() : null;
    room.update(dt, lv ? (role) => eng.levelOf(role) * 2.6 : null);
  }

  _catState(t) {
    const M = this.M;
    const open = sm(M.eye, M.eye + 0.35, t) * 0.75;
    return { t, pos: SEAT.slice(), yaw: SLEEP_YAW, lie: 1, breath: this.score.breathAt(t), eyeL: 0, eyeR: open, shine: open, earL: 0, earR: 0.5 * pulse(t, M.morph0 + 0.3, 0.02, 0.15) };
  }

  draw(ctx) {
    const t = this.t || 0;
    const room = this.room;
    const fov = room.camOverride ? room.camOverride.fov : 0.75;
    const st = this._catState(t);
    const morph = this.score.morph.at(t);
    const lights = room._lights(this.app.rig.fixtures || []).map((l) => ({ pos: l.pos, col: l.col, dir: l.dir, cos: l.cos, range: l.range }));
    const amb = (1.6 + room.flash * 12) * room.ambient;
    const pose = this.cat.draw(ctx, st, lights, { fov, amb: [[0.014 * amb + 0.03, 0.016 * amb + 0.024, 0.024 * amb + 0.02], [0.006 * amb + 0.01, 0.005 * amb + 0.008, 0.005 * amb + 0.007]],
      shadowY: 0.447, whiskers: 0.8 * (1 - sm(0.05, 0.35, morph)) });
    this._drawDial(ctx, t, st, pose, morph, fov);
  }

  /** The whiskers swing out and become a rev counter around the cat's head. */
  _drawDial(ctx, t, st, pose, morph, fov) {
    if (morph < 0.01) return;
    const gl = this.gl;
    const lb = this.dial;
    lb.begin();
    const H = this.cat.headPoint(st, pose, [0, -0.01, 0.03]);
    // a plane facing the camera
    const V = v3.norm(v3.sub(ctx.eye, H));
    const R = v3.norm(v3.cross([0, 1, 0], V));
    const U = v3.cross(V, R);
    const at = (ang, r) => v3.add(H, v3.add(v3.scale(R, Math.sin(ang) * r), v3.scale(U, Math.cos(ang) * r)));
    const rpm = this.score.ctl.at('rpm', t);
    const sweep = (r) => -2.36 + 4.71 * clamp(r / 9000, 0, 1);
    const grow = (i, n) => sm(i / n * 0.7, i / n * 0.7 + 0.3, morph);
    // whiskers first: six lines from the muzzle that become the first ticks
    for (let k = 0; k <= 90; k++) {
      const rr = k * 100;
      const major = rr % 1000 === 0, mid = rr % 500 === 0;
      if (!mid && k % 2) continue;
      const g = grow(k, 90);
      if (g < 0.01) continue;
      const a = sweep(rr);
      const r0 = major ? 0.13 : 0.15, r1 = 0.18;
      const red = rr >= CAR.redline;
      const lit = rpm >= rr - 50 ? 1 : 0.35;
      const col = (red ? [1.0, 0.12, 0.05] : [0.45, 0.75, 1.0]).map((c) => c * g * lit * (major ? 2.2 : 1.1));
      lb.add([at(a, lerp(0.05, r0, g)), at(a, lerp(0.07, r1, g))], col, major ? 0.0032 : 0.0018, 0);
    }
    // the arc and the needle
    const arc = [];
    for (let k = 0; k <= 60; k++) arc.push(at(-2.36 + (4.71 * k) / 60, 0.185));
    lb.add(arc, [0.2, 0.35, 0.6].map((c) => c * morph), 0.0012, 0);
    const na = sweep(rpm);
    lb.add([at(na, 0.02), at(na, 0.17)], [2.4, 0.55, 0.2].map((c) => c * morph), 0.0035, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    lb.draw({ vp: ctx.vp, eye: ctx.eye, fov, h: ctx.h });
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  render(w, h) {
    this.room.render(w, h, this.app.rig.fixtures, null);
  }

  light(f, t) {
    const M = this.M;
    const amb = this.app.rig._ambient(f);
    const morph = this.score.morph.at(t);
    const rev = this.rev || 0;
    let c = rgbMix(amb, [0.07, 0.05, 0.035], sm(0, 1.5, t) * (1 - sm(M.end - 2.5, M.end, t)));
    c = rgbMix(c, [0.25, 0.02, 0.01], morph * 0.8);
    c = c.map((x, i) => x + [1.0, 0.12, 0.03][i] * rev * 0.9);
    for (const s of this.score.shifts) c = c.map((x, i) => x + [0.3, 0.5, 1.0][i] * pulse(t, s, 0.01, 0.18) * 1.2);
    for (const p of this.score.pops) if (t > p.t && t < p.t + 0.2) c = c.map((x, i) => x + [1.0, 0.5, 0.15][i] * pulse(t, p.t, 0.005, 0.06) * p.I);
    return c;
  }

  dispose() {
    const room = this.room;
    this.leather.forEach((n, i) => {
      n.mat.albedo = this.leatherBase[i];
    });
    room.layers = room.layers.filter((l) => l !== this);
    room.camOverride = null;
    room.extraLights = [];
    room.postOverride = null;
    room.setShape(null);
    room.ambient = 1;
    room.tvGain = 1;
    room.shake = 0;
    const ov = room.presets.overview;
    room.cam = { ...ov, target: ov.target.slice() };
    room.camT = undefined;
    room.preset = 'overview';
    room.idleBase = undefined;
    room.lastInteract = room.time;
    this.cat.dispose();
    this.dial.dispose();
  }
}
