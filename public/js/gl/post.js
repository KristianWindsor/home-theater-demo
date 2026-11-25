// HDR post-processing: physically-based bloom (Jimenez 2014 down/up chain), shockwave distortion,
// chromatic aberration, flash, ACES tonemap, vignette, grain and dithering.
import { Program, Target, FULLSCREEN_VS, drawFullscreen } from './gl.js';

const COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
`;

const DOWN_FS = COMMON + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 c) { return c / (1.0 + luma(c)); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + t * vec2(-2, 2)).rgb;
  vec3 b = texture(uSrc, vUv + t * vec2(0, 2)).rgb;
  vec3 c = texture(uSrc, vUv + t * vec2(2, 2)).rgb;
  vec3 d = texture(uSrc, vUv + t * vec2(-2, 0)).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 f = texture(uSrc, vUv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, vUv + t * vec2(-2, -2)).rgb;
  vec3 h = texture(uSrc, vUv + t * vec2(0, -2)).rgb;
  vec3 i = texture(uSrc, vUv + t * vec2(2, -2)).rgb;
  vec3 j = texture(uSrc, vUv + t * vec2(-1, 1)).rgb;
  vec3 k = texture(uSrc, vUv + t * vec2(1, 1)).rgb;
  vec3 l = texture(uSrc, vUv + t * vec2(-1, -1)).rgb;
  vec3 m = texture(uSrc, vUv + t * vec2(1, -1)).rgb;
  vec3 col;
  if (uFirst > 0.5) {
    // Karis average on the first pass suppresses single-pixel fireflies
    vec3 g0 = karis((a + b + d + e) * 0.25) * 0.125;
    vec3 g1 = karis((b + c + e + f) * 0.25) * 0.125;
    vec3 g2 = karis((d + e + g + h) * 0.25) * 0.125;
    vec3 g3 = karis((e + f + h + i) * 0.25) * 0.125;
    vec3 g4 = karis((j + k + l + m) * 0.25) * 0.5;
    col = g0 + g1 + g2 + g3 + g4;
    col /= max(1.0 - luma(col), 0.05);
    // soft knee so only bright light blooms strongly
    float br = luma(col);
    float soft = clamp(br - uThreshold * 0.5, 0.0, uThreshold);
    soft = soft * soft / (4.0 * uThreshold + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  outColor = vec4(max(col, 0.0), 1.0);
}`;

const UP_FS = COMMON + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += (texture(uSrc, vUv + vec2(-t.x, 0)).rgb + texture(uSrc, vUv + vec2(t.x, 0)).rgb +
        texture(uSrc, vUv + vec2(0, -t.y)).rgb + texture(uSrc, vUv + vec2(0, t.y)).rgb) * 2.0;
  s += texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb +
       texture(uSrc, vUv + vec2(-t.x, t.y)).rgb + texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  outColor = vec4(s / 16.0, 1.0);
}`;

const COMPOSITE_FS = COMMON + `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uCA;
uniform float uVignette;
uniform float uGrain;
uniform vec3 uFlash;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShock;          // xy: center (uv), z: radius
uniform float uShockStrength;
uniform float uLetterbox;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 aces(vec3 x) {
  // Narkowicz ACES fit, with a touch of shoulder room
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  if (uShockStrength > 0.001) {
    vec2 d = uv - uShock.xy;
    d.x *= aspect;
    float r = length(d);
    float w = 0.06 + 0.1 * uShock.z;
    float ring = smoothstep(uShock.z - w, uShock.z, r) * (1.0 - smoothstep(uShock.z, uShock.z + w, r));
    vec2 n = d / max(r, 1e-4);
    n.x /= aspect;
    uv -= n * ring * uShockStrength * 0.035;
  }
  vec2 dir = uv - 0.5;
  float ca = uCA * 0.01 * (0.3 + dot(dir, dir) * 2.0);
  vec3 col;
  col.r = texture(uScene, uv - dir * ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv + dir * ca).b;
  vec3 bl = texture(uBloom, uv).rgb;
  col = col + bl * uBloomStrength;
  col *= uExposure;
  col += uFlash;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * dot(q, q) * 1.8;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (hash12(vUv * uRes + fract(uTime) * 517.0) - 0.5) * uGrain;
  col += (hash12(gl_FragCoord.xy + 0.37) - 0.5) / 255.0;
  if (uLetterbox > 0.0) {
    float bar = uLetterbox * 0.5;
    col *= smoothstep(0.0, 0.002, vUv.y - bar) * smoothstep(0.0, 0.002, 1.0 - bar - vUv.y);
  }
  outColor = vec4(col, 1.0);
}`;

export const DEFAULT_POST = {
  bloomStrength: 0.08,
  bloomRadius: 1.0,
  threshold: 0.9,
  exposure: 1.0,
  ca: 0.0,
  vignette: 0.35,
  grain: 0.025,
  flash: [0, 0, 0],
  saturation: 1.0,
  contrast: 1.0,
  shock: [0.5, 0.5, 0],
  shockStrength: 0,
  letterbox: 0,
};

export class Post {
  constructor(gl) {
    this.gl = gl;
    this.down = new Program(gl, FULLSCREEN_VS, DOWN_FS, 'bloom-down');
    this.up = new Program(gl, FULLSCREEN_VS, UP_FS, 'bloom-up');
    this.comp = new Program(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');
    this.levels = [];
    this.w = 0;
    this.h = 0;
  }

  _ensure(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const t of this.levels) t.dispose();
    this.levels = [];
    let lw = Math.max(1, w >> 1);
    let lh = Math.max(1, h >> 1);
    for (let i = 0; i < 6 && lw >= 4 && lh >= 4; i++) {
      this.levels.push(new Target(this.gl, lw, lh, { hdr: true }));
      lw >>= 1;
      lh >>= 1;
    }
  }

  /** Run bloom on `sceneTex` (w x h) and composite to `out` (Target) or the canvas when out is null. */
  run(sceneTex, w, h, outW, outH, params, time, out = null) {
    const gl = this.gl;
    const p = { ...DEFAULT_POST, ...params };
    this._ensure(w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    // down chain
    let src = sceneTex;
    let sw = w, sh = h;
    this.down.use();
    for (let i = 0; i < this.levels.length; i++) {
      const L = this.levels[i];
      L.bind();
      this.down.tex('uSrc', src).set('uTexel', [1 / sw, 1 / sh]).set('uFirst', i === 0 ? 1 : 0)
        .set('uThreshold', p.threshold);
      drawFullscreen(gl);
      src = L.tex;
      sw = L.w;
      sh = L.h;
    }
    // up chain (additive into the larger level)
    this.up.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.levels.length - 1; i > 0; i--) {
      const from = this.levels[i];
      const to = this.levels[i - 1];
      to.bind();
      this.up.tex('uSrc', from.tex).set('uTexel', [1 / from.w, 1 / from.h]).set('uRadius', p.bloomRadius);
      drawFullscreen(gl);
    }
    gl.disable(gl.BLEND);
    // composite
    if (out) out.bind();
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, outW, outH);
    }
    this.comp.use()
      .tex('uScene', sceneTex)
      .tex('uBloom', this.levels.length ? this.levels[0].tex : sceneTex)
      .setAll({
        uRes: [outW, outH], uTime: time, uBloomStrength: p.bloomStrength, uExposure: p.exposure, uCA: p.ca,
        uVignette: p.vignette, uGrain: p.grain, uFlash: p.flash, uSaturation: p.saturation, uContrast: p.contrast,
        uShock: p.shock, uShockStrength: p.shockStrength, uLetterbox: p.letterbox,
      });
    drawFullscreen(gl);
  }
}
