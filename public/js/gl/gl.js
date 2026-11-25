// Thin WebGL2 helpers: programs with introspected uniforms, render targets, data textures.

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const caps = {
    floatRT: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
  gl.getExtension('EXT_color_buffer_half_float');
  return { gl, caps };
}

const SETTERS = {};
function setterFor(gl, type, size) {
  const T = gl;
  switch (type) {
    case T.FLOAT: return size > 1 ? (l, v) => gl.uniform1fv(l, v) : (l, v) => gl.uniform1f(l, v);
    case T.FLOAT_VEC2: return (l, v) => gl.uniform2fv(l, v);
    case T.FLOAT_VEC3: return (l, v) => gl.uniform3fv(l, v);
    case T.FLOAT_VEC4: return (l, v) => gl.uniform4fv(l, v);
    case T.FLOAT_MAT3: return (l, v) => gl.uniformMatrix3fv(l, false, v);
    case T.FLOAT_MAT4: return (l, v) => gl.uniformMatrix4fv(l, false, v);
    case T.INT: case T.BOOL: case T.SAMPLER_2D: case T.SAMPLER_3D:
      return size > 1 ? (l, v) => gl.uniform1iv(l, v) : (l, v) => gl.uniform1i(l, v);
    case T.INT_VEC2: return (l, v) => gl.uniform2iv(l, v);
    default: return () => {};
  }
}

export class Program {
  constructor(gl, vs, fs, name = 'program') {
    this.gl = gl;
    this.name = name;
    const prog = gl.createProgram();
    const v = compile(gl, gl.VERTEX_SHADER, vs, name);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs, name);
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`[${name}] link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    this.prog = prog;
    this.uniforms = new Map();
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      const base = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(prog, info.name);
      const isSampler = info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_3D;
      this.uniforms.set(base, { loc, type: info.type, set: setterFor(gl, info.type, info.size), unit: isSampler ? unit++ : -1 });
    }
  }

  use() {
    this.gl.useProgram(this.prog);
    return this;
  }

  set(name, value) {
    const u = this.uniforms.get(name);
    if (u && u.unit < 0) u.set(u.loc, value);
    return this;
  }

  setAll(obj) {
    for (const k in obj) this.set(k, obj[k]);
    return this;
  }

  tex(name, texture) {
    const u = this.uniforms.get(name);
    if (!u || u.unit < 0) return this;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + u.unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.loc, u.unit);
    return this;
  }
}

function compile(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) || '';
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).map((l, i) => `${+m[1] - 2 + i}: ${l}`).join('\n') : '';
    throw new Error(`[${name}] ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}\n${ctx}`);
  }
  return s;
}

/** Render target with one color texture (+ optional depth renderbuffer). */
export class Target {
  constructor(gl, w, h, { hdr = true, depth = false, linear = true, wrap = 'clamp', format } = {}) {
    this.gl = gl;
    this.opts = { hdr, depth, linear, wrap, format };
    this.fbo = gl.createFramebuffer();
    this.tex = gl.createTexture();
    this.depth = depth ? gl.createRenderbuffer() : null;
    this.w = 0;
    this.h = 0;
    this.resize(w, h);
  }

  resize(w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.w && h === this.h) return this;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    const { hdr, linear, wrap, format } = this.opts;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (format === 'rgba32f') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    else if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const filter = linear && format !== 'rgba32f' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    const wr = wrap === 'repeat' ? gl.REPEAT : wrap === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    if (this.depth) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this;
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
    return this;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.tex);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
  }
}

/** A small float texture we update from the CPU (spectra, waveforms, future spectrograms). */
export class DataTexture {
  constructor(gl, w, h, { channels = 1, linear = true } = {}) {
    this.gl = gl;
    this.w = w;
    this.h = h;
    this.channels = channels;
    this.data = new Float32Array(w * h * channels);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const [internal, format] = channels === 1 ? [gl.R16F, gl.RED] : channels === 2 ? [gl.RG16F, gl.RG] : [gl.RGBA16F, gl.RGBA];
    this.internal = internal;
    this.format = format;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, this.data);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  upload() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, this.format, gl.FLOAT, this.data);
  }
}

export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

let emptyVao = null;
/** Draw a single fullscreen triangle (no buffers needed). */
export function drawFullscreen(gl) {
  if (!emptyVao) emptyVao = gl.createVertexArray();
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Compile a fullscreen fragment-shader program. */
export function fsProgram(gl, fs, name) {
  return new Program(gl, FULLSCREEN_VS, fs, name);
}
