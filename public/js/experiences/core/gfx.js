// Small WebGL helpers shared by the experience scenes.
import { Program } from '../../gl/gl.js';

/** A vertex buffer rewritten every frame. layout: [[location, size], ...] interleaved floats. */
export class DynBuffer {
  constructor(gl, layout, maxVerts) {
    this.gl = gl;
    this.stride = layout.reduce((a, [, n]) => a + n, 0);
    this.data = new Float32Array(maxVerts * this.stride);
    this.max = maxVerts;
    this.vao = gl.createVertexArray();
    this.buf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    let off = 0;
    for (const [loc, n] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, this.stride * 4, off * 4);
      off += n;
    }
    gl.bindVertexArray(null);
    this.count = 0;
  }

  /** Upload the first n vertices of this.data. */
  upload(n) {
    const gl = this.gl;
    this.count = Math.min(n, this.max);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count * this.stride));
  }

  draw(mode, first = 0, count = this.count) {
    if (count <= 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(mode, first, count);
  }

  dispose() {
    this.gl.deleteBuffer(this.buf);
    this.gl.deleteVertexArray(this.vao);
  }
}

/** Static buffer from interleaved data. */
export class StaticBuffer extends DynBuffer {
  constructor(gl, layout, data) {
    super(gl, layout, data.length / layout.reduce((a, [, n]) => a + n, 0));
    this.data.set(data);
    this.upload(this.max);
  }
}

/** Hermite spline through timed keys {t, v:[...], hold?} (hold = arrive and leave at rest). */
export class Spline {
  constructor(keys) {
    this.k = keys.slice().sort((a, b) => a.t - b.t);
    const k = this.k;
    const dim = k[0].v.length;
    this.m = k.map((key, i) => {
      if (key.hold || i === 0 || i === k.length - 1) return new Array(dim).fill(0);
      const a = k[i - 1], b = k[i + 1];
      return key.v.map((_, d) => (b.v[d] - a.v[d]) / (b.t - a.t));
    });
  }

  at(t) {
    const k = this.k;
    if (t <= k[0].t) return k[0].v.slice();
    if (t >= k[k.length - 1].t) return k[k.length - 1].v.slice();
    let i = 0;
    while (i < k.length - 2 && k[i + 1].t <= t) i++;
    const a = k[i], b = k[i + 1];
    const dt = b.t - a.t;
    const x = (t - a.t) / dt;
    const x2 = x * x, x3 = x2 * x;
    const h00 = 2 * x3 - 3 * x2 + 1, h10 = x3 - 2 * x2 + x, h01 = -2 * x3 + 3 * x2, h11 = x3 - x2;
    const ma = this.m[i], mb = this.m[i + 1];
    return a.v.map((v, d) => h00 * v + h10 * dt * ma[d] + h01 * b.v[d] + h11 * dt * mb[d]);
  }
}

export const SPRITE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;   // rgb, size (meters)
uniform mat4 uVP;
uniform float uPx;
out vec3 vCol;
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  float px = aCol.a * uPx / max(c.w, 0.05);
  gl_PointSize = clamp(px, 1.5, 220.0);
  // keep tiny points from flickering: trade size for brightness
  vCol = aCol.rgb * min(1.0, px / 1.5);
}`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 outColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  float a = exp(-r2 * 4.5) * (1.0 - smoothstep(0.75, 1.0, r2));
  outColor = vec4(vCol * a, 1.0);
}`;

export function spriteProgram(gl) {
  return new Program(gl, SPRITE_VS, SPRITE_FS, 'xp-sprites');
}

export const rgbMul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const rgbAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const rgbMix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------------------------------------------------------------- glowing lines (many polylines, one draw call)
// Camera-facing ribbons with a pixel minimum width (thin lines dim instead of aliasing). Each polyline belongs to a
// brightness group (uniform array) with a "drafting" reveal (the line draws itself from u=0 to u=1 with a bright
// pen tip), and up to four point lights tint whatever passes near them. Mirror mode reflects in the floor (y = 0).
const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aT;
layout(location = 2) in vec3 aSUW;   // side, u, width (m)
layout(location = 3) in vec4 aCol;   // rgb, group
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uPxScale, uMirror, uLitK;
uniform float uGroup[32];
uniform float uReveal[32];
uniform vec4 uLP[4];   // xyz, 1/r^2
uniform vec3 uLC[4];
out vec2 vSU;
out vec3 vCol;
out float vReveal;
void main() {
  vec3 p = aP;
  vec3 t = aT;
  int g = int(aCol.a + 0.5);
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 d = p - uLP[i].xyz;
    lit += uLC[i] / (1.0 + dot(d, d) * uLP[i].w);
  }
  if (uMirror > 0.5) { p.y = -p.y; t.y = -t.y; }
  vec3 V = normalize(uCam - p);
  vec3 B = cross(t, V);
  float l = length(B);
  B = l > 1e-5 ? B / l : vec3(0.0, 1.0, 0.0);
  float d = length(uCam - p);
  float minW = 1.2 * d * uPxScale;
  float w = max(aSUW.z, minW);
  gl_Position = uVP * vec4(p + B * aSUW.x * w * 2.5, 1.0);
  vSU = aSUW.xy;
  float fade = uMirror > 0.5 ? 0.2 * exp(-abs(p.y) * 0.2) : 1.0;
  vCol = (aCol.rgb * uGroup[g] + lit * uLitK) * min(1.0, aSUW.z / w * 1.4) * fade;
  vReveal = uReveal[g];
}`;
const LINE_FS = `#version 300 es
precision highp float;
in vec2 vSU;
in vec3 vCol;
in float vReveal;
out vec4 outColor;
void main() {
  if (vSU.y > vReveal) discard;
  float s = vSU.x * 2.5;
  float core = exp(-s * s * 3.0);
  float glow = exp(-s * s * 0.45) * 0.18;
  float tip = vReveal < 0.999 ? 1.0 + 5.0 * exp(-(vReveal - vSU.y) * 60.0) : 1.0;
  outColor = vec4(vCol * (core + glow) * tip, 1.0);
}`;

export class LineBatch {
  constructor(gl, maxVerts = 60000) {
    this.gl = gl;
    this.prog = new Program(gl, LINE_VS, LINE_FS, 'xp-lines');
    this.buf = new DynBuffer(gl, [[0, 3], [1, 3], [2, 3], [3, 4]], maxVerts);
    this.n = 0;
    this.dirty = true;
    this.groups = new Float32Array(32).fill(1);
    this.reveal = new Float32Array(32).fill(1);
    this.lp = new Float32Array(16);
    this.lc = new Float32Array(12);
    this.litK = 1;
  }

  begin() {
    this.n = 0;
    this.dirty = true;
  }

  _v(x, y, z, tx, ty, tz, side, u, w, r, g, b, grp) {
    if (this.n >= this.buf.max) return;
    const d = this.buf.data, o = this.n * 13;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = tx; d[o + 4] = ty; d[o + 5] = tz;
    d[o + 6] = side; d[o + 7] = u; d[o + 8] = w;
    d[o + 9] = r; d[o + 10] = g; d[o + 11] = b; d[o + 12] = grp;
    this.n++;
  }

  /**
   * Add a polyline. pts: [[x,y,z], ...]. col: [r,g,b] or (u) => [r,g,b]. width in meters (a pixel minimum
   * applies). group: brightness/reveal slot (0-31).
   */
  add(pts, col, width = 0.02, group = 0, closed = false) {
    const P = closed ? [...pts, pts[0]] : pts;
    const m = P.length;
    if (m < 2 || this.n + 2 * m + 2 > this.buf.max) return;
    this.dirty = true;
    const colAt = typeof col === 'function' ? col : null;
    const d = this.buf.data;
    // degenerate join from the previous strip
    if (this.n > 0) {
      const o = (this.n - 1) * 13;
      this._v(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6], d[o + 7], d[o + 8], 0, 0, 0, 0);
    }
    let first = true;
    for (let k = 0; k < m; k++) {
      const a = P[k > 0 ? k - 1 : 0], b = P[k < m - 1 ? k + 1 : m - 1];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1;
      tx /= l; ty /= l; tz /= l;
      const u = k / (m - 1);
      const c = colAt ? colAt(u) : col;
      const p = P[k];
      if (first) {
        if (this.n > 0) this._v(p[0], p[1], p[2], tx, ty, tz, -1, u, width, 0, 0, 0, 0);
        first = false;
      }
      this._v(p[0], p[1], p[2], tx, ty, tz, -1, u, width, c[0], c[1], c[2], group);
      this._v(p[0], p[1], p[2], tx, ty, tz, 1, u, width, c[0], c[1], c[2], group);
    }
  }

  /** lights: [{ p:[x,y,z], c:[r,g,b], r }] (up to 4). */
  setLights(lights) {
    this.lp.fill(0);
    this.lc.fill(0);
    lights.slice(0, 4).forEach((L, i) => {
      this.lp.set([L.p[0], L.p[1], L.p[2], 1 / (L.r * L.r)], i * 4);
      this.lc.set(L.c, i * 3);
    });
  }

  draw(cam, { mirror = false } = {}) {
    if (!this.n) return;
    const gl = this.gl;
    if (this.dirty) {
      this.buf.upload(this.n);
      this.dirty = false;
    }
    this.prog.use().setAll({
      uVP: cam.vp, uCam: cam.eye, uPxScale: (2 * Math.tan(cam.fov / 2)) / cam.h, uMirror: mirror ? 1 : 0,
      uGroup: this.groups, uReveal: this.reveal, uLP: this.lp, uLC: this.lc, uLitK: this.litK,
    });
    this.buf.draw(gl.TRIANGLE_STRIP, 0, this.n);
  }

  dispose() {
    this.gl.deleteProgram(this.prog.prog);
    this.buf.dispose();
  }
}

// ---------------------------------------------------------------- glass orbs and glows as point sprites
const ORB_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;
layout(location = 2) in float aKind;
uniform mat4 uVP;
uniform float uPx;
out vec3 vCol;
out float vKind;
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  float px = aCol.a * uPx / max(c.w, 0.05);
  gl_PointSize = clamp(px, 1.5, 256.0);
  vCol = aCol.rgb * min(1.0, px / 1.5);
  vKind = aKind;
}`;
const ORB_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vKind;
out vec4 outColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float r2 = dot(q, q);
  if (vKind < 0.5) {
    outColor = vec4(vCol * exp(-r2 * 4.5) * (1.0 - smoothstep(0.75, 1.0, r2)), 1.0);
    return;
  }
  if (r2 > 1.0) discard;
  vec3 n = vec3(q, sqrt(1.0 - r2));
  float rim = pow(max(1.0 - n.z, 0.0), 2.2);
  vec2 cq = q - vec2(0.15, -0.2);
  float core = exp(-dot(cq, cq) * 6.0) * 0.5;
  float hl = pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 60.0) * 2.5;
  outColor = vec4(vCol * (rim * 1.3 + core + 0.05) + vec3(hl), 1.0);
}`;

export class Orbs {
  constructor(gl, max = 4000) {
    this.gl = gl;
    this.prog = new Program(gl, ORB_VS, ORB_FS, 'xp-orbs');
    this.buf = new DynBuffer(gl, [[0, 3], [1, 4], [2, 1]], max);
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  /** kind 0: soft glow, 1: glass sphere. size in meters. */
  add(p, c, size, kind = 0) {
    if (this.n >= this.buf.max) return;
    const d = this.buf.data, o = this.n * 8;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
    d[o + 3] = c[0]; d[o + 4] = c[1]; d[o + 5] = c[2]; d[o + 6] = size; d[o + 7] = kind;
    this.n++;
  }

  draw(cam) {
    if (!this.n) return;
    this.buf.upload(this.n);
    this.prog.use().setAll({ uVP: cam.vp, uPx: cam.h / (2 * Math.tan(cam.fov / 2)) });
    this.buf.draw(this.gl.POINTS, 0, this.n);
  }

  dispose() {
    this.gl.deleteProgram(this.prog.prog);
    this.buf.dispose();
  }
}
