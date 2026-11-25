// Horizon: you drive down a road through a landscape made of the *upcoming* music.
// Each row of terrain is a slice of the spectrum at a future time (bass makes the far-side
// mountains, highs ripple near the road), so drops rise on the horizon before you hear them.
// Beat lines cross the road exactly on each beat; gates mark upcoming section changes.
import { Program, DataTexture, FULLSCREEN_VS, drawFullscreen } from '../../gl/gl.js';
import { m4 } from '../../gl/math.js';
import { header, UNIFORMS, LIB, UNIFORM_LIB } from './common.js';
import { SPEC_BANDS } from '../score.js';

const ROWS = 256;
const PAST = 1.0;
const FUTURE = 9.0;
const COLS_MESH = 110;
const ROWS_MESH = 220;
const WIDTH = 15.0;
const DEPTH = 64.0;

const TERRAIN_VS = `#version 300 es
precision highp float;
in vec2 aUV;
uniform mat4 uViewProj;
uniform sampler2D uTerrain;
uniform float uHeight;
uniform float uNowV;
out vec2 vUV;
out float vH;
out float vSide;
out vec3 vPos;
void main() {
  float side = abs(aUV.x - 0.5) * 2.0;
  float band = 1.0 - clamp((side - 0.08) / 0.92, 0.0, 1.0);
  float h = texture(uTerrain, vec2(band, aUV.y)).r;
  float road = smoothstep(0.05, 0.16, side);
  float lift = mix(0.15, 1.8, smoothstep(0.12, 1.0, side));
  float y = h * uHeight * lift * road + road * side * side * 0.6;
  vec3 pos = vec3((aUV.x - 0.5) * ${WIDTH.toFixed(1)}, y, -(aUV.y - uNowV) * ${DEPTH.toFixed(1)});
  vUV = aUV;
  vH = h * road;
  vSide = side;
  vPos = pos;
  gl_Position = uViewProj * vec4(pos, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vH;
in float vSide;
in vec3 vPos;
out vec4 outColor;
${UNIFORMS}
uniform float uSpan, uPast;
uniform vec4 uGates;
uniform vec4 uGateDrop;
uniform vec3 uFogCol;
${LIB}
${UNIFORM_LIB}
float gridLine(float x, float w) {
  float d = abs(fract(x - 0.5) - 0.5);
  return 1.0 - smoothstep(0.0, fwidth(x) * w, d);
}
void main() {
  float tau = vUV.y * uSpan - uPast;
  float cols = 44.0;
  float colL = gridLine(vUV.x * cols, 1.3);
  float bpos = uHasBeat > 0.5 ? tau / max(uBeatPeriod, 0.05) + uBeat : tau;
  float beatL = gridLine(bpos, 1.6);
  float n = floor(bpos + 0.5);
  float down = uHasBeat > 0.5 ? 1.0 - step(0.5, mod(n + uBeatInBar, max(uMeter, 1.0))) : 0.0;
  float sub = gridLine(bpos * 2.0, 1.0) * 0.35;
  float hgt = clamp(vH, 0.0, 1.0);
  vec3 lineC = mix(uC1, uC2, smoothstep(0.1, 0.8, hgt));
  lineC = mix(lineC, uC3, smoothstep(0.75, 1.0, hgt));
  vec3 col = mix(uC0 * 0.05, uC1 * 0.12, hgt * hgt);
  col += lineC * colL * (0.12 + 1.4 * hgt * hgt) * (0.5 + uLoud);
  col += mix(uC2, uC3, down * 0.6) * (beatL * (0.5 + 1.2 * down) + sub * 0.6) * (0.25 + 1.2 * hgt + 0.4 * step(vSide, 0.12));
  // road
  if (vSide < 0.12) {
    float lane = gridLine(vUV.x * cols * 0.5, 1.0) * step(0.5, fract(bpos * 2.0));
    col = mix(uC0 * 0.08, col, 0.35) + uC3 * lane * 0.4 * (0.4 + uBeatPulse * 2.0);
    col += uChord * smoothstep(0.12, 0.0, vSide) * 0.08;
  }
  // the present moment: a glowing line where the music is now
  col += uChord * exp(-abs(tau) * 10.0) * (0.5 + 1.2 * uBeatPulse);
  // gates for upcoming section changes
  for (int i = 0; i < 4; i++) {
    float g = uGates[i];
    if (g > 0.0) {
      float d = abs(tau - g);
      vec3 gc = mix(uC3, vec3(1.0, 0.25, 0.12), uGateDrop[i]);
      col += gc * exp(-d * 18.0) * (1.4 + 2.0 * uGateDrop[i]);
    }
  }
  float fog = exp(-max(tau, 0.0) * 0.17);
  col = mix(uFogCol, col, fog);
  col *= smoothstep(-0.7, 0.0, tau);
  outColor = vec4(max(col, 0.0), 1.0);
}`;

const SKY_FS = header(`uniform vec2 uSun; uniform float uSunR; uniform vec3 uFogCol;`) + `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 s = (uSun - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float hy = s.y;
  vec3 col = mix(uFogCol, uC0 * 0.5, smoothstep(hy, hy + 0.7, p.y));
  col = mix(col, uC0 * 0.15, smoothstep(hy + 0.3, hy + 1.0, p.y));
  vec2 sp = p * 90.0;
  vec2 id = floor(sp);
  float h = hash12(id);
  col += step(0.992, h) * smoothstep(0.15, 0.0, length(fract(sp) - 0.5)) * (0.4 + 2.0 * uHat) * smoothstep(hy + 0.1, hy + 0.5, p.y);
  vec2 d = p - s;
  float r = length(d);
  float R = uSunR * (1.0 + 0.12 * uBass + 0.08 * uKick + 0.4 * uDrop);
  float body = smoothstep(R, R - 0.004, r);
  float y01 = clamp((d.y + R) / (2.0 * R), 0.0, 1.0);
  float stripes = step(0.5, fract(y01 * 9.0 + uBeat * uHasBeat + uTime * 0.05 * (1.0 - uHasBeat)));
  float cut = mix(1.0, stripes, smoothstep(0.55, 0.15, y01));
  vec3 sunC = mix(uC2 * 2.2, uC3 * 2.6, y01);
  col += sunC * body * cut * (0.6 + 0.9 * uLoud);
  col += mix(uC2, uC1, 0.5) * exp(-max(r - R, 0.0) * 9.0) * (0.25 + 0.8 * uLoud) * 0.6;
  col *= step(hy - 0.002, p.y) + (1.0 - step(hy - 0.002, p.y)) * 0.3;
  outColor = vec4(max(col, 0.0), 1.0);
}`;

export class HorizonWorld {
  constructor(ctx) {
    this.ctx = ctx;
    const gl = ctx.gl;
    this.terrain = new Program(gl, TERRAIN_VS, TERRAIN_FS, 'horizon-terrain');
    this.sky = new Program(gl, FULLSCREEN_VS, SKY_FS, 'horizon-sky');
    this.tex = new DataTexture(gl, SPEC_BANDS, ROWS, { channels: 1 });
    this.liveRows = new Float32Array(ROWS * SPEC_BANDS);
    // grid mesh
    const verts = new Float32Array((COLS_MESH + 1) * (ROWS_MESH + 1) * 2);
    let k = 0;
    for (let r = 0; r <= ROWS_MESH; r++) {
      for (let c = 0; c <= COLS_MESH; c++) {
        verts[k++] = c / COLS_MESH;
        verts[k++] = r / ROWS_MESH;
      }
    }
    const idx = new Uint32Array(COLS_MESH * ROWS_MESH * 6);
    k = 0;
    for (let r = 0; r < ROWS_MESH; r++) {
      for (let c = 0; c < COLS_MESH; c++) {
        const i = r * (COLS_MESH + 1) + c;
        idx[k++] = i; idx[k++] = i + 1; idx[k++] = i + COLS_MESH + 1;
        idx[k++] = i + 1; idx[k++] = i + COLS_MESH + 2; idx[k++] = i + COLS_MESH + 1;
      }
    }
    this.count = idx.length;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.terrain.prog, 'aUV');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.lastLive = 0;
  }

  _fillTerrain(frame, source) {
    const span = PAST + FUTURE;
    const dtRow = span / (ROWS - 1);
    if (source && source.score) {
      source.score.fillSpectrogram(frame.t - PAST, dtRow, ROWS, this.tex.data);
    } else {
      // live mode: no future. Scroll the measured spectrum away from the viewer instead.
      const d = this.tex.data;
      const shift = Math.max(1, Math.round((frame.t - this.lastLive) / dtRow));
      if (frame.t - this.lastLive >= dtRow) {
        d.copyWithin(SPEC_BANDS * shift, 0, d.length - SPEC_BANDS * shift);
        for (let s = 0; s < shift; s++) d.set(frame.spec, s * SPEC_BANDS);
        this.lastLive = frame.t;
      }
    }
    this.tex.upload();
  }

  render(target, U, tex, frame, extra) {
    const gl = this.ctx.gl;
    this._fillTerrain(frame, extra.source);
    const w = target.w, h = target.h;
    const aspect = w / h;
    const t = U.uTime;
    const bump = 0.12 * U.uKick * U.uTrip + 0.3 * U.uDrop;
    const eye = [Math.sin(t * 0.13) * 0.5, 1.7 + 0.15 * Math.sin(t * 0.21) + bump, 3.0];
    const look = [Math.sin(t * 0.1) * 0.3, 0.9 + 0.2 * U.uPreDrop, -30];
    const roll = (U.uPan || 0) * 0.08 + Math.sin(t * 0.17) * 0.015;
    const up = [Math.sin(roll), Math.cos(roll), 0];
    const fov = (50 + 8 * U.uDrop - 5 * U.uPreDrop) * Math.PI / 180;
    const proj = m4.perspective(fov, aspect, 0.05, 200);
    const view = m4.lookAt(eye, look, up);
    const vp = m4.multiply(proj, view);
    const sunW = [0, 6.5, -180];
    const sp = m4.transformPoint(vp, sunW);
    const sun = [(sp[0] + 1) / 2, (sp[1] + 1) / 2];
    const fog = [U.uC0[0] * 0.6 + U.uC2[0] * 0.12, U.uC0[1] * 0.6 + U.uC2[1] * 0.12, U.uC0[2] * 0.6 + U.uC2[2] * 0.12];
    target.bind();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this.sky.use().setAll(U).set('uSun', sun).set('uSunR', 0.24).set('uFogCol', fog)
      .tex('uSpec', tex.spec).tex('uFFT', tex.fft).tex('uWave', tex.wave);
    drawFullscreen(gl);
    // terrain
    const gates = [-1, -1, -1, -1];
    const drops = [0, 0, 0, 0];
    (extra.boundaries || []).slice(0, 4).forEach((b, i) => {
      gates[i] = b.dt;
      drops[i] = b.drop ? 1 : 0;
    });
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.terrain.use().setAll(U)
      .set('uViewProj', vp).set('uHeight', 2.6 * (0.7 + 0.5 * U.uTrip)).set('uNowV', PAST / (PAST + FUTURE))
      .set('uSpan', PAST + FUTURE).set('uPast', PAST).set('uGates', gates).set('uGateDrop', drops).set('uFogCol', fog)
      .tex('uTerrain', this.tex.tex).tex('uSpec', tex.spec).tex('uFFT', tex.fft).tex('uWave', tex.wave);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
}
