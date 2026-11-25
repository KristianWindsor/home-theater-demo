// Particle worlds: Spectral Galaxy (stateless, analytic) and Cymatics (GPU-simulated sand).
import { Program, Target, FULLSCREEN_VS, drawFullscreen } from '../../gl/gl.js';
import { m4, rng } from '../../gl/math.js';
import { header, UNIFORMS, LIB, UNIFORM_LIB } from './common.js';

// ===================================================================== Spectral Galaxy
const GALAXY_VS = `#version 300 es
precision highp float;
${UNIFORMS}
uniform mat4 uViewProj;
uniform float uPointScale;
out vec3 vCol;
${LIB}
${UNIFORM_LIB}
void main() {
  float fi = float(gl_VertexID);
  float h1 = hash11(fi * 0.1031 + 0.11), h2 = hash11(fi * 0.7313 + 3.7);
  float h3 = hash11(fi * 1.3711 + 9.1), h4 = hash11(fi * 2.1733 + 1.3);
  float g = (h3 + hash11(fi * 3.31 + 0.7) + hash11(fi * 5.17 + 2.2)) / 3.0 - 0.5;   // ~gaussian
  float kind = h4;                // < 0.12 bulge, < 0.3 disk, else arms
  float arms = 2.0 + mod(uVariant, 3.0);
  float arm = floor(h2 * arms);
  float r = kind < 0.12 ? pow(h1, 2.2) * 0.25 : kind < 0.3 ? pow(h1, 0.8) : 0.08 + 0.92 * pow(h1, 0.9);
  float spiral = log(r * 14.0 + 1.0) * (2.4 + 0.5 * sin(uSeed * 6.0));
  float spread = kind < 0.3 ? h3 * TAU : g * (0.25 + 0.55 * r) * (1.0 + uWidth);
  float rotSpeed = (0.03 + 0.06 * uIntensity) * (1.0 - 0.55 * r);
  float ang = (kind < 0.3 ? 0.0 : arm / arms * TAU + spiral) + spread + uTime * rotSpeed;
  float since = uBeat * uBeatPeriod;
  float expand = 1.0 + 0.45 * uDrop + 0.1 * uBuild - 0.15 * uPreDrop;
  float R = (r + g * 0.04) * 5.2 * expand;
  float thick = g * (kind < 0.12 ? 1.2 : 0.22 * (1.0 - 0.6 * r)) * (1.0 + 1.5 * uBass);
  vec3 pos = vec3(cos(ang) * R, thick, sin(ang) * R);
  float e = specA(clamp(r, 0.0, 0.98));
  float ripR = since * 7.5;
  float ripple = exp(-pow((R - ripR) * 2.2, 2.0)) * uHasBeat * (0.4 + uBeatPulse);
  float knot = kind >= 0.3 ? pow(vnoise(vec2(arm * 13.0 + r * 28.0, spread * 4.0)), 4.0) * 3.0 : 0.0;
  vec3 c = mix(pal(r * 0.85 + h3 * 0.15 + uTime * 0.01), uChord, 0.35 * uClarity);
  c = mix(c, uC3, kind < 0.12 ? 0.6 : ripple * 0.6);
  float bright = kind < 0.12 ? 0.6 + 1.6 * uKick + 0.8 * uBass : (kind < 0.3 ? 0.12 : 0.22) + 1.1 * e + knot * (0.3 + e);
  bright += 1.4 * ripple + 0.8 * uHat * step(0.94, h3) * r;
  vCol = c * bright * (0.35 + 0.8 * uLoud) * 0.4;
  gl_Position = uViewProj * vec4(pos, 1.0);
  gl_PointSize = clamp((0.9 + 2.0 * e + 2.5 * ripple + knot) * uPointScale / gl_Position.w, 1.0, 24.0);
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d));
  outColor = vec4(vCol * a * a, 1.0);
}`;

const SPACE_FS = header() + `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uC0 * 0.25 * (0.6 + 0.4 * fbm3(p * 2.0 + uTime * 0.02));
  col += uC1 * 0.08 * exp(-length(p) * 2.5) * (1.0 + uBass);
  vec2 sp = p * 80.0;
  float h = hash12(floor(sp));
  col += step(0.994, h) * smoothstep(0.2, 0.0, length(fract(sp) - 0.5)) * 0.6;
  outColor = vec4(col, 1.0);
}`;

export class GalaxyWorld {
  constructor(ctx) {
    this.ctx = ctx;
    const gl = ctx.gl;
    this.points = new Program(gl, GALAXY_VS, POINT_FS, 'galaxy');
    this.bg = new Program(gl, FULLSCREEN_VS, SPACE_FS, 'galaxy-bg');
    this.vao = gl.createVertexArray();
    this.count = ctx.quality === 'low' ? 60000 : ctx.quality === 'medium' ? 110000 : 180000;
  }

  render(target, U, tex) {
    const gl = this.ctx.gl;
    target.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.bg.use().setAll(U).tex('uSpec', tex.spec).tex('uFFT', tex.fft).tex('uWave', tex.wave);
    drawFullscreen(gl);
    const t = U.uTime;
    const tilt = 0.75 + 0.25 * Math.sin(t * 0.05 + U.uSeed * 3) + 0.2 * U.uPreDrop;
    const dist = 7.0 - 1.2 * U.uDrop - 0.4 * U.uKick * U.uTrip + 1.5 * U.uPreDrop;
    const az = t * 0.05 + U.uSeed * 6;
    const eye = [Math.cos(az) * Math.cos(tilt) * dist, Math.sin(tilt) * dist, Math.sin(az) * Math.cos(tilt) * dist];
    const proj = m4.perspective(0.9, target.w / target.h, 0.1, 100);
    const vp = m4.multiply(proj, m4.lookAt(eye, [0, 0, 0]));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.points.use().setAll(U).set('uViewProj', vp).set('uPointScale', target.h / 120)
      .tex('uSpec', tex.spec).tex('uFFT', tex.fft).tex('uWave', tex.wave);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}

// ===================================================================== Cymatics
// Particles do gradient descent toward the nodal lines (f = 0) of a vibrating plate while
// being shaken in proportion to the local vibration, exactly how sand finds Chladni figures.
const PLATE = `
uniform vec4 uModes;   // n1, m1, n2, m2
uniform float uMorph;
uniform float uPlate;  // 0 = square plate, 1 = round plate
float chladni(vec2 p, float n, float m) {
  if (uPlate < 0.5) return cos(n * PI * p.x) * cos(m * PI * p.y) - cos(m * PI * p.x) * cos(n * PI * p.y);
  float r = length(p);
  float a = atan(p.y, p.x);
  return cos(n * a) * sin(m * PI * r + 0.5 * PI * step(0.5, fract(n * 0.5)));
}
float field(vec2 p) { return mix(chladni(p, uModes.x, uModes.y), chladni(p, uModes.z, uModes.w), uMorph); }
`;

const SIM_FS = header(PLATE + `uniform sampler2D uState; uniform float uDt; uniform float uShake;`) + `
void main() {
  vec4 s = texelFetch(uState, ivec2(gl_FragCoord.xy), 0);
  vec2 p = s.xy;
  vec2 v = s.zw;
  float f = field(p);
  vec2 e = vec2(0.0025, 0.0);
  vec2 grad = vec2(field(p + e.xy) - field(p - e.xy), field(p + e.yx) - field(p - e.yx)) / (2.0 * e.x);
  vec2 force = -f * grad;
  vec2 rnd = hash22(p * 913.0 + fract(uTime * 7.3) * 100.0 + gl_FragCoord.xy * 0.01) - 0.5;
  float amp = abs(f) * (0.25 + 1.6 * uLoud + 1.2 * uBass) + uShake;
  v = v * 0.82 + force * uDt * 2.2 + rnd * amp * uDt * 3.0;
  p += v * uDt * 6.0;
  if (uPlate > 0.5) {
    float r = length(p);
    if (r > 0.98) { p *= 0.98 / r; v = -v * 0.3; }
  } else {
    p = clamp(p, vec2(-0.98), vec2(0.98));
  }
  outColor = vec4(p, v);
}`;

const SAND_VS = `#version 300 es
precision highp float;
${UNIFORMS}
uniform sampler2D uState;
uniform int uSide;
uniform vec2 uScale;
uniform float uPointSize;
out vec3 vCol;
${LIB}
${UNIFORM_LIB}
void main() {
  ivec2 ij = ivec2(gl_VertexID % uSide, gl_VertexID / uSide);
  vec4 s = texelFetch(uState, ij, 0);
  float speed = length(s.zw);
  float h = hash11(float(gl_VertexID) * 0.37);
  vec3 c = mix(mix(uC1, uChord, 0.6 * uClarity), uC2, smoothstep(0.02, 0.12, speed));
  c = mix(c, uC3, step(0.93, h) * 0.6);
  vCol = c * (0.25 + 0.9 * uLoud + 0.8 * smoothstep(0.03, 0.2, speed)) * (0.4 + h) * 1.3;
  gl_Position = vec4(s.xy * uScale, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

const PLATE_BG_FS = header(PLATE + `uniform vec2 uScale;`) + `
void main() {
  vec2 q = (vUv * 2.0 - 1.0) / uScale;
  float inside = uPlate > 0.5 ? smoothstep(1.0, 0.99, length(q)) : step(max(abs(q.x), abs(q.y)), 1.0);
  float f = field(q);
  vec3 col = uC0 * 0.25;
  col += mix(uC0, uC1, 0.5) * 0.18 * inside * (1.0 - smoothstep(0.0, 0.5, abs(f)));
  col += uC1 * inside * 0.05 * abs(f) * (0.5 + uLoud);
  float rim = uPlate > 0.5 ? abs(length(q) - 1.0) : abs(max(abs(q.x), abs(q.y)) - 1.0);
  col += uC2 * smoothstep(0.012, 0.0, rim) * (0.5 + 1.5 * uBeatPulse);
  outColor = vec4(col, 1.0);
}`;

// pattern pairs ordered around the circle of fifths so related harmonies look related
const MODES = [[1, 2], [2, 3], [1, 4], [3, 4], [2, 5], [1, 5], [3, 5], [4, 5], [2, 7], [3, 7], [4, 7], [5, 6]];

export class CymaticsWorld {
  constructor(ctx) {
    this.ctx = ctx;
    const gl = ctx.gl;
    this.side = ctx.quality === 'low' ? 160 : ctx.quality === 'medium' ? 224 : 256;
    this.sim = new Program(gl, FULLSCREEN_VS, SIM_FS, 'cymatics-sim');
    this.draw = new Program(gl, SAND_VS, POINT_FS, 'cymatics-draw');
    this.bg = new Program(gl, FULLSCREEN_VS, PLATE_BG_FS, 'cymatics-bg');
    this.state = [0, 1].map(() => new Target(gl, this.side, this.side, { format: 'rgba32f', linear: false }));
    const init = new Float32Array(this.side * this.side * 4);
    const rand = rng(1234);
    for (let i = 0; i < this.side * this.side; i++) {
      init[i * 4] = rand() * 2 - 1;
      init[i * 4 + 1] = rand() * 2 - 1;
    }
    for (const s of this.state) {
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.side, this.side, gl.RGBA, gl.FLOAT, init);
    }
    this.cur = 0;
    this.vao = gl.createVertexArray();
    this.modes = [1, 2, 2, 3];
    this.morph = 1;
    this.lastPc = -1;
    this.shake = 0;
    this.lastT = 0;
  }

  _choosePattern(frame, U) {
    let pc = 0, best = 0;
    for (let k = 0; k < 12; k++) if (frame.chroma[k] > best) { best = frame.chroma[k]; pc = k; }
    const idx = ((pc * 7) % 12 + Math.floor(U.uVariant)) % 12;
    if (best > 0.25 && idx !== this.lastPc) {
      this.lastPc = idx;
      const [n, m] = MODES[idx];
      // current blend becomes the start of the next morph
      this.modes = this.morph > 0.5 ? [this.modes[2], this.modes[3], n, m] : [this.modes[0], this.modes[1], n, m];
      this.morph = 0;
      this.shake = Math.max(this.shake, 0.35);
    }
  }

  render(target, U, tex, frame) {
    const gl = this.ctx.gl;
    const dt = Math.min(0.05, Math.max(0.001, U.uTime - this.lastT || 1 / 60));
    this.lastT = U.uTime;
    this._choosePattern(frame, U);
    this.morph = Math.min(1, this.morph + dt / 0.45);
    this.shake = Math.max(this.shake * Math.exp(-dt / 0.25), 0.3 * U.uKick * U.uTrip + 0.6 * U.uDrop + 0.5 * U.uImpact);
    const plate = Math.floor(U.uVariant) % 2;
    const aspect = target.w / target.h;
    const scale = aspect > 1 ? [0.94 / aspect, 0.94] : [0.94, 0.94 * aspect];
    const common = { uModes: this.modes, uMorph: this.morph * this.morph * (3 - 2 * this.morph), uPlate: plate };
    // simulate (2 substeps)
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    for (let s = 0; s < 2; s++) {
      const src = this.state[this.cur];
      const dst = this.state[1 - this.cur];
      dst.bind();
      this.sim.use().setAll(U).setAll(common).set('uDt', dt * 0.5).set('uShake', this.shake).tex('uState', src.tex);
      drawFullscreen(gl);
      this.cur = 1 - this.cur;
    }
    target.bind();
    this.bg.use().setAll(U).setAll(common).set('uScale', scale).tex('uSpec', tex.spec).tex('uFFT', tex.fft).tex('uWave', tex.wave);
    drawFullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.draw.use().setAll(U).set('uSide', this.side).set('uScale', scale)
      .set('uPointSize', Math.max(1.5, target.h / 420)).tex('uState', this.state[this.cur].tex)
      .tex('uSpec', tex.spec).tex('uFFT', tex.fft).tex('uWave', tex.wave);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.side * this.side);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
