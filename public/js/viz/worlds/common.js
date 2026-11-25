// Shared GLSL for every visual world, and a base class for full-screen shader worlds.
import { Program, FULLSCREEN_VS, drawFullscreen } from '../../gl/gl.js';

export const UNIFORMS = `
uniform vec2 uRes;
uniform float uTime, uMusicTime;
uniform float uBeat, uBar, uBeatPulse, uBarPulse, uBeatIndex, uBeatPeriod, uHasBeat, uBeatInBar, uMeter;
uniform float uKick, uSnare, uHat, uOnset;
uniform float uLoud, uIntensity, uBuild, uPreDrop, uDrop, uImpact;
uniform float uBass, uLowMid, uMid, uHigh, uAir;
uniform float uCentroid, uFlat, uFlux, uPerc, uWidth, uPan;
uniform vec3 uC0, uC1, uC2, uC3, uChord;
uniform float uClarity, uSeed, uSectionT, uVariant, uEnergy, uValence, uTrip, uCalm;
uniform sampler2D uSpec;   // 32 x 2: row 0 = activity, row 1 = balance
uniform sampler2D uFFT;    // live spectrum, 256 x 1, log-frequency
uniform sampler2D uWave;   // live waveform, 512 x 1
`;

export const LIB = `
#define PI 3.14159265
#define TAU 6.2831853
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
  return v;
}
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float easeBeat(float ph) { return 1.0 - pow(1.0 - clamp(ph, 0.0, 1.0), 3.0); }
`;

// helpers that read the shared uniforms (only valid together with UNIFORMS)
export const UNIFORM_LIB = `
float specA(float x) { return texture(uSpec, vec2(clamp(x, 0.0, 1.0), 0.25)).r; }
float specB(float x) { return texture(uSpec, vec2(clamp(x, 0.0, 1.0), 0.75)).r; }
float fft(float x) { return texture(uFFT, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float wave(float x) { return texture(uWave, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
vec3 pal(float t) {
  t = fract(t);
  vec3 a = mix(uC0, uC1, smoothstep(0.0, 0.33, t));
  a = mix(a, uC2, smoothstep(0.33, 0.66, t));
  return mix(a, uC0, smoothstep(0.66, 1.0, t));
}
`;

export function header(extra = '') {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${UNIFORMS}
${LIB}
${UNIFORM_LIB}
${extra}
`;
}

/** World made of one full-screen fragment shader. */
export class ShaderWorld {
  constructor(ctx, fragBody, name) {
    this.ctx = ctx;
    this.name = name;
    this.prog = new Program(ctx.gl, FULLSCREEN_VS, header() + fragBody, name);
  }

  render(target, U, tex) {
    const gl = this.ctx.gl;
    target.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.prog.use().setAll(U).tex('uSpec', tex.spec).tex('uFFT', tex.fft).tex('uWave', tex.wave);
    drawFullscreen(gl);
  }

  dispose() {
    this.ctx.gl.deleteProgram(this.prog.prog);
  }
}
