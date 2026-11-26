// The home screen: a 3D model of the theater, lit by its (virtual) Hue lights.
// Built from config/room.json so it can be matched to the real room.
import { Program, Target, FULLSCREEN_VS, drawFullscreen } from '../gl/gl.js';
import { Post } from '../gl/post.js';
import { Resolution } from '../gl/resolution.js';
import { m4, v3, clamp, lerp, easeInOut, fitFov } from '../gl/math.js';
import { roundedBox, cylinder, speakerCone, torus, plane, quad } from './meshes.js';

const MAX_LIGHTS = 16;

const STD_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUV;
uniform mat4 uModel, uViewProj;
uniform mat3 uNormalMat;
out vec3 vPos;
out vec3 vNor;
out vec2 vUV;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vPos = w.xyz;
  vNor = normalize(uNormalMat * aNor);
  vUV = aUV;
  gl_Position = uViewProj * w;
}`;

const STD_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNor;
in vec2 vUV;
out vec4 outColor;
uniform vec3 uCam;
uniform vec3 uAlbedo, uEmissive, uAmbSky, uAmbGround;
uniform float uRough, uMetal, uHover, uTime;
uniform int uPattern;
uniform int uLightCount;
uniform vec3 uLPos[${MAX_LIGHTS}];
uniform vec3 uLCol[${MAX_LIGHTS}];
uniform vec4 uLDir[${MAX_LIGHTS}];   // xyz spot direction, w = cos(outer angle); w <= -1 means omni
uniform float uLRange[${MAX_LIGHTS}];
uniform sampler2D uTex;
uniform float uUseTex, uTexGain;
uniform vec3 uGrid;      // infinite floor grid glow
uniform vec2 uFade;      // infinite floor fade distances
uniform vec4 uRib;       // wall ribs: rgb glow, a = spacing (0 = off)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec3 N = normalize(vNor);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vPos);
  vec3 albedo = uAlbedo;
  float rough = uRough;
  vec3 extra = vec3(0.0);
  if (uPattern == 1) {            // carpet
    float n = vnoise(vUV * 180.0) * 0.5 + vnoise(vUV * 37.0) * 0.5;
    albedo *= 0.8 + 0.4 * n;
  } else if (uPattern == 2) {     // fabric wall panels
    vec2 g = vUV * vec2(1.0 / 1.2, 1.0 / 1.4);
    vec2 f = abs(fract(g) - 0.5);
    float seam = smoothstep(0.495, 0.5, max(f.x, f.y));
    albedo *= (0.85 + 0.25 * vnoise(vUV * 90.0)) * (1.0 - 0.6 * seam);
  } else if (uPattern == 3) {     // leather
    albedo *= 0.85 + 0.3 * vnoise(vUV * 60.0);
    rough = clamp(rough + 0.2 * (vnoise(vUV * 140.0) - 0.5), 0.2, 1.0);
  } else if (uPattern == 4) {     // rug: soft border + pattern
    vec2 q = abs(vUV / vec2(3.0, 2.4) - 0.5);
    float border = smoothstep(0.43, 0.44, max(q.x, q.y)) - smoothstep(0.47, 0.48, max(q.x, q.y));
    albedo = mix(albedo, albedo * 2.2, border) * (0.85 + 0.3 * vnoise(vUV * 120.0));
  } else if (uPattern == 5) {     // the floor beyond the room: polished black with a faint grid of light
    vec2 g = abs(fract(vPos.xz / 2.0) - 0.5);
    float line = smoothstep(0.488, 0.5, max(g.x, g.y));
    float d = length(vPos.xz - uCam.xz);
    float fade = 1.0 - smoothstep(uFade.x, uFade.y, d);
    float room = step(3.4, abs(vPos.x)) + step(2.9, vPos.z) + step(vPos.z, -3.9);
    extra += uGrid * line * fade * min(room, 1.0);
    albedo *= fade;
  }
  if (uRib.a > 0.0) {             // light seams on the walls (vertical) and ceiling (coffers) of the expanded hall
    if (abs(N.y) > 0.5) {
      vec2 g = abs(fract(vPos.xz / uRib.a) - 0.5);
      extra += uRib.rgb * smoothstep(0.485, 0.5, max(g.x, g.y)) * 0.8;
    } else {
      vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)));
      float u = dot(vPos, T) / uRib.a;
      float rib = smoothstep(0.485, 0.5, abs(fract(u) - 0.5));
      extra += uRib.rgb * rib * exp(-vPos.y * 0.12);
    }
  }
  float shin = mix(180.0, 6.0, rough);
  float specK = mix(0.6, 0.03, rough);
  vec3 f0 = mix(vec3(0.04), albedo, uMetal);
  vec3 col = albedo * (1.0 - uMetal) * mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 L = uLPos[i] - vPos;
    float d = length(L);
    L /= max(d, 1e-4);
    float x = clamp(1.0 - pow(d / uLRange[i], 4.0), 0.0, 1.0);
    float att = x * x / (d * d + 0.3);
    if (uLDir[i].w > -1.0) att *= smoothstep(uLDir[i].w, uLDir[i].w + 0.25, dot(-L, uLDir[i].xyz));
    float ndl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), shin) * specK * (shin + 8.0) / 25.0;
    vec3 fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    col += uLCol[i] * att * (albedo * (1.0 - uMetal) * ndl + spec * fres * ndl);
  }
  if (uUseTex > 0.5) col = pow(texture(uTex, vUV).rgb, vec3(2.2)) * uTexGain + col * 0.15;
  col += uEmissive + extra;
  col += uHover * vec3(0.05, 0.08, 0.12) * (0.4 + pow(1.0 - max(dot(N, V), 0.0), 2.0) * 3.0);
  outColor = vec4(col, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform float uStrength;
void main() {
  vec2 q = vUV * 2.0 - 1.0;
  float a = (1.0 - smoothstep(0.2, 1.0, length(q))) * uStrength;
  outColor = vec4(vec3(1.0 - a), 1.0);
}`;

const GLOW_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec2 aUV;
uniform mat4 uViewProj;
uniform vec3 uCenter, uRight, uUp;
uniform vec2 uSize;
out vec2 vUV;
void main() {
  vUV = aUV;
  vec3 p = uCenter + uRight * aPos.x * uSize.x + uUp * aPos.y * uSize.y;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const GLOW_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform vec3 uColor;
uniform float uFalloff;
void main() {
  float r = length(vUV * 2.0 - 1.0);
  float a = exp(-r * r * uFalloff) * (1.0 - smoothstep(0.85, 1.0, r));
  outColor = vec4(uColor * a, 1.0);
}`;

const TV_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCard;
uniform float uTime;
void main() {
  vec3 c = texture(uCard, vUv).rgb;
  float sx = (vUv.x - vUv.y * 0.35) - fract(uTime * 0.06) * 1.8 + 0.4;
  float sweep = exp(-sx * sx * 40.0);
  c *= 0.85 + 0.15 * sin(uTime * 0.7);
  c += vec3(0.12, 0.16, 0.24) * sweep * 0.5;
  outColor = vec4(c, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvVP;
uniform vec3 uCam, uTop, uHorizon, uGlow;
uniform float uAmount, uTime, uStars;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float stars(vec2 p, float scale, float thr) {
  vec2 c = floor(p * scale);
  vec2 f = fract(p * scale) - 0.5;
  float h = hash12(c);
  vec2 o = vec2(hash12(c + 7.1), hash12(c + 3.3)) - 0.5;
  float d = length(f - o * 0.7);
  float tw = 0.75 + 0.25 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
  return step(thr, h) * smoothstep(0.09, 0.0, d) * tw * (h - thr) / (1.0 - thr);
}
void main() {
  vec4 p = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - uCam);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.45, h));
  col += uGlow * exp(-abs(h) * 7.0);
  vec2 sp = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0)));
  float by = (d.y - 0.3 * sin(sp.x + 0.7) - 0.15) * 3.6;
  float band = exp(-by * by);
  float neb = vnoise(sp * 3.0 + 4.0) * 0.6 + vnoise(sp * 9.0) * 0.4;
  col += vec3(0.05, 0.06, 0.12) * band * smoothstep(0.35, 0.9, neb) * 0.9;
  float s = stars(sp, 60.0, 0.86) + stars(sp, 140.0, 0.92) * 0.7 + stars(sp, 23.0, 0.965) * 2.0;
  col += vec3(0.85, 0.9, 1.0) * s * uStars * smoothstep(-0.05, 0.1, h) * (0.5 + band);
  outColor = vec4(col * uAmount, 1.0);
}`;

export class Mesh {
  constructor(gl, geo) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = (data, loc, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    buf(geo.pos, 0, 3);
    buf(geo.nor, 1, 3);
    buf(geo.uv, 2, 2);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
    this.type = geo.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.count = geo.idx.length;
    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.type, 0);
  }
}

const MAT = {
  carpet: { albedo: [0.05, 0.046, 0.044], rough: 0.97, pattern: 1 },
  wall: { albedo: [0.05, 0.055, 0.07], rough: 0.92, pattern: 2 },
  frontWall: { albedo: [0.02, 0.02, 0.024], rough: 0.95 },
  rug: { albedo: [0.06, 0.04, 0.032], rough: 0.98, pattern: 4 },
  gloss: { albedo: [0.022, 0.022, 0.026], rough: 0.2 },
  satin: { albedo: [0.03, 0.03, 0.034], rough: 0.45 },
  cone: { albedo: [0.025, 0.025, 0.028], rough: 0.55 },
  surround: { albedo: [0.012, 0.012, 0.012], rough: 0.7 },
  trim: { albedo: [0.55, 0.55, 0.58], rough: 0.3, metal: 1 },
  copper: { albedo: [0.55, 0.3, 0.17], rough: 0.35, metal: 1 },
  horn: { albedo: [0.008, 0.008, 0.009], rough: 0.35 },
  walnut: { albedo: [0.09, 0.05, 0.03], rough: 0.5 },
  bezel: { albedo: [0.006, 0.006, 0.007], rough: 0.15 },
  diffuser: { albedo: [0.6, 0.6, 0.6], rough: 0.6 },
};

function obbHit(ro, rd, box) {
  // ray vs oriented box (rotation about y only)
  const c = Math.cos(-box.rotY), s = Math.sin(-box.rotY);
  const tr = (p) => [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
  const o = tr(v3.sub(ro, box.center));
  const d = tr(rd);
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (Math.abs(o[i]) > box.half[i]) return null;
      continue;
    }
    let t1 = (-box.half[i] - o[i]) / d[i];
    let t2 = (box.half[i] - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmax < 0 ? null : Math.max(tmin, 0);
}

export class Room {
  constructor(gl, caps, config) {
    this.gl = gl;
    this.config = config;
    this.std = new Program(gl, STD_VS, STD_FS, 'room-std');
    this.shadowProg = new Program(gl, STD_VS, SHADOW_FS, 'room-shadow');
    this.glowProg = new Program(gl, GLOW_VS, GLOW_FS, 'room-glow');
    this.tvProg = new Program(gl, FULLSCREEN_VS, TV_FS, 'room-tv');
    this.skyProg = new Program(gl, FULLSCREEN_VS, SKY_FS, 'room-sky');
    this.post = new Post(gl);
    this.target = new Target(gl, 4, 4, { hdr: true, depth: true });
    this.res = new Resolution('room', { high: { maxW: 1920 }, medium: { maxW: 1600 }, low: { maxW: 1280 } });
    this.tvTarget = new Target(gl, 640, 360, { hdr: false });
    this.cardTex = gl.createTexture();
    this.meshCache = new Map();
    this.nodes = [];
    this.cones = [];
    this.shadows = [];
    this.picks = [];
    this.glows = [];
    this.speakers = {};
    this.activity = {};
    this.hover = null;
    this.time = 0;
    this.orb = null;
    this.flash = 0;
    this.shake = 0;
    this.tvSource = null; // external texture (visualizer) or null for the card
    this.tvColor = [0.05, 0.07, 0.12];
    this.fixtures = [];
    this.lightLevels = {};
    this.cam = { theta: 0.42, phi: 0.5, radius: 8.0, target: [0, 0.8, -0.9] };
    this.camGoal = { ...this.cam, target: this.cam.target.slice() };
    this.presets = {};
    this.lastInteract = -1e9;
    // hooks for experiences that take over the room (see experiences/room-wakes-up/scene.js)
    this.camOverride = null;   // { eye, target, fov }
    this.extraLights = [];     // [{ pos, col, dir, cos, range }]
    this.layers = [];          // [{ draw(ctx) }] drawn into the HDR target after the room
    this.postOverride = null;  // merged into the post-processing parameters
    this.sky = { amount: 0, top: [0.0015, 0.002, 0.006], horizon: [0.006, 0.008, 0.02], glow: [0.0, 0.0, 0.0], stars: 1 };
    this.ambient = 1;          // scales the room's own (non-Hue) lights
    this.walls = {};
    this.build(config);
    this.setCard('MARQUEE', 'Home Theater');
  }

  mesh(key, fn) {
    if (!this.meshCache.has(key)) this.meshCache.set(key, new Mesh(this.gl, fn()));
    return this.meshCache.get(key);
  }

  add(mesh, mat, model, extra = {}) {
    const n = { mesh, mat: { rough: 0.5, metal: 0, emissive: [0, 0, 0], pattern: 0, ...mat }, model, ...extra };
    n.normal = m4.normalMatrix(model);
    this.nodes.push(n);
    return n;
  }

  /** Model matrix of a child placed in a parent's local frame. */
  local(parent, pos, rotY = 0, rotX = 0) {
    return m4.multiply(parent, m4.compose(pos, rotY, [1, 1, 1], rotX));
  }

  build(cfg) {
    const R = cfg.room || {};
    const W = R.width || 6.4;
    const front = R.front ?? -3.7;
    const back = R.back ?? 2.7;
    const H = R.height || 2.75;
    const D = back - front;
    const midZ = (front + back) / 2;
    this.bounds = { W, front, back, H };
    // floor, rug, walls
    this.add(this.mesh(`floor${W}x${D}`, () => plane(W, D)), MAT.carpet, m4.compose([0, 0, midZ]));
    const cz = cfg.couch?.z ?? 0.3;
    this.add(this.mesh('rug', () => plane(3.0, 2.4)), MAT.rug, m4.compose([0, 0.004, cz - 0.2]));
    const wall = (name, w, h, pos, rotY, mat) => {
      const n = this.add(this.mesh(`wall${w}x${h}`, () => quad(w, h)), { ...mat }, m4.compose(pos, rotY), { wall: true, uvScale: [w, h] });
      n.base = { pos, rotY };
      this.walls[name] = n;
      return n;
    };
    // the front wall is two halves so it can part like doors (they meet invisibly behind the TV)
    wall('frontL', W / 2, H, [-W / 4, H / 2, front], 0, MAT.frontWall);
    wall('frontR', W / 2, H, [W / 4, H / 2, front], 0, MAT.frontWall);
    wall('left', D, H, [-W / 2, H / 2, midZ], Math.PI / 2, MAT.wall);
    wall('right', D, H, [W / 2, H / 2, midZ], -Math.PI / 2, MAT.wall);
    wall('back', W, H, [0, H / 2, back], Math.PI, MAT.wall);
    // a ceiling (two hinged panels) and an endless floor, both hidden unless an experience uses them
    this.ceiling = ['L', 'R'].map((side) => this.add(this.mesh(`ceil${W / 2}x${D}`, () => quad(W / 2, D)),
      { albedo: [0.03, 0.032, 0.04], rough: 0.9 }, m4.identity(), { hidden: true, ceilingSide: side }));
    this.ground = this.add(this.mesh('ground', () => plane(400, 400)), { albedo: [0.012, 0.012, 0.015], rough: 0.22, pattern: 5 },
      m4.compose([0, -0.004, 0]), { hidden: true });
    this.shape = null;
    // TV
    const inches = cfg.tv?.diagonalInches || 100;
    const tvW = inches * 0.0254 * 0.8716, tvH = inches * 0.0254 * 0.4903;
    const tvY = cfg.tv?.centerHeight || 1.35;
    const tvZ = front + 0.06;
    this.tv = { w: tvW, h: tvH, y: tvY, z: tvZ };
    this.add(this.mesh(`bezel${inches}`, () => roundedBox(tvW + 0.024, tvH + 0.024, 0.035, 0.006, 2)), MAT.bezel, m4.compose([0, tvY, tvZ]));
    this.screen = this.add(this.mesh(`screen${inches}`, () => quad(tvW, tvH)), { albedo: [0, 0, 0], rough: 0.1 }, m4.compose([0, tvY, tvZ + 0.0181]), { screen: true });
    this.picks.push({ id: 'tv', label: cfg.tv?.label || 'TV', center: [0, tvY, tvZ], rotY: 0, half: [tvW / 2, tvH / 2, 0.06] });
    // console
    const con = cfg.console || { width: 2.4, height: 0.42, depth: 0.48 };
    const conZ = front + 0.05 + con.depth / 2;
    this.add(this.mesh('console', () => roundedBox(con.width, con.height, con.depth, 0.015, 2)), MAT.walnut, m4.compose([0, con.height / 2, conZ]));
    this.shadows.push({ pos: [0, conZ], size: [con.width + 0.3, con.depth + 0.4], s: 0.6 });
    // speakers
    for (const s of cfg.speakers || []) this.buildSpeaker(s, { con, conZ, front, back, W });
    this.buildCouch(cfg.couch || {}, cz);
    // Hue fixtures
    this.fixtures = [];
    for (const h of cfg.hue || []) {
      if (h.anchor === 'tv') {
        this.fixtures.push({ id: h.id, label: h.label, anchor: 'tv', pos: [0, tvY, front + 0.28], az: 0, side: 0, rear: false,
          dir: [0, 0, -1], cos: Math.cos(1.25), range: 3.2, gain: 1.3 });
        continue;
      }
      const sp = this.speakers[h.anchor];
      if (!sp) continue;
      const out = v3.norm([sp.pos[0], 0, sp.pos[2]]);
      const p = [sp.pos[0] + out[0] * 0.3, 0.12, sp.pos[2] + out[2] * 0.3];
      this.fixtures.push({ id: h.id, label: h.label, anchor: h.anchor, pos: p, az: sp.az, side: Math.sign(sp.pos[0]), rear: sp.pos[2] > 0,
        dir: v3.norm([out[0] * 0.55, 1, out[2] * 0.55]), cos: Math.cos(0.75), range: 3.4, gain: 1.0 });
      this.add(this.mesh('hueBody', () => cylinder(0.065, 0.12, 24)), { ...MAT.diffuser }, m4.compose([p[0], 0.06, p[2]], 0, [1, 1, 1], -Math.PI / 2), { fixture: h.id });
    }
    this.presets = {
      overview: { theta: 0.42, phi: 0.5, radius: 8.0, target: [0, 0.8, -0.9] },
      couch: { theta: 0, phi: 0.04, radius: front * -1 + 0.55, target: [0, tvY, tvZ] },
      tv: { theta: 0, phi: 0.0, radius: 1.9, target: [0, tvY, tvZ] },
      wide: { theta: -0.75, phi: 0.75, radius: 9.5, target: [0, 0.5, -0.3] },
      top: { theta: 0.0, phi: 1.25, radius: 9, target: [0, 0, -0.4] },
    };
  }

  buildSpeaker(s, ctx) {
    const { con, conZ, front, back, W } = ctx;
    let pos, rotY, type = s.type || 'tower';
    let az = 0;
    if (type === 'center') {
      pos = [0, con.height, conZ + con.depth / 2 - 0.2];
      rotY = 0;
    } else if (type === 'subwoofer') {
      const size = s.size || 0.85;
      const corner = s.corner || 'back-left';
      const x = (corner.includes('left') ? -1 : 1) * (W / 2 - size / 2 - 0.25);
      const z = corner.includes('back') ? back - size / 2 - 0.25 : front + size / 2 + 0.35;
      pos = [x, 0, z];
      rotY = Math.atan2(-x, -z);
      az = (Math.atan2(x, -z) * 180) / Math.PI;
    } else {
      const th = (((s.clock ?? 12) - 12) * 30 * Math.PI) / 180;
      const d = s.distance || 2.5;
      pos = [Math.sin(th) * d, 0, -Math.cos(th) * d];
      rotY = Math.atan2(-pos[0], -pos[2]);
      az = (th * 180) / Math.PI;
    }
    if (s.position) pos = s.position;
    const base = m4.compose(pos, rotY);
    const sp = { id: s.id, role: s.channel, label: s.label, detail: s.detail || '', pos, rotY, az, type, glow: 0 };
    this.speakers[s.id] = sp;
    const driver = (x, y, z, r, accent = false) => {
      const mat = this.local(base, [x, y, z]);
      this.add(this.mesh(`surround${r}`, () => torus(r * 1.02, r * 0.09, 40, 8)), MAT.surround, mat);
      this.add(this.mesh(`trim${r}`, () => torus(r * 1.16, r * 0.035, 40, 6)), accent ? MAT.copper : MAT.trim, mat);
      const cone = this.add(this.mesh(`cone${r}`, () => speakerCone(r * 0.98, 0.32)), MAT.cone, mat, { owner: s.id });
      this.cones.push({ node: cone, base: mat, role: s.channel, r, speaker: s.id });
    };
    if (type === 'tower') {
      const h = s.height || 1.1;
      this.add(this.mesh('plinth', () => roundedBox(0.37, 0.035, 0.47, 0.01, 2)), MAT.satin, this.local(base, [0, 0.0175, 0]));
      this.add(this.mesh(`tower${h}`, () => roundedBox(0.3, h, 0.4, 0.028, 4)), MAT.gloss, this.local(base, [0, 0.035 + h / 2, 0]));
      const top = 0.035 + h;
      this.add(this.mesh('horn', () => roundedBox(0.25, 0.15, 0.03, 0.012, 3)), MAT.horn, this.local(base, [0, top - 0.13, 0.2]));
      this.add(this.mesh('throat', () => cylinder(0.022, 0.02, 24)), MAT.trim, this.local(base, [0, top - 0.13, 0.215]));
      driver(0, top - 0.34, 0.2, 0.082, true);
      driver(0, top - 0.57, 0.2, 0.082, true);
      driver(0, top - 0.8, 0.2, 0.082, true);
      this.shadows.push({ pos: [pos[0], pos[2]], size: [0.75, 0.85], s: 0.75 });
      this.picks.push({ id: s.id, label: s.label, center: v3.add(pos, [0, h / 2, 0]), rotY, half: [0.2, h / 2 + 0.05, 0.25] });
      sp.top = [pos[0], top, pos[2]];
    } else if (type === 'center') {
      const cw = s.width || 0.95;
      this.add(this.mesh(`center${cw}`, () => roundedBox(cw, 0.26, 0.36, 0.022, 4)), MAT.gloss, this.local(base, [0, 0.13, 0]));
      this.add(this.mesh('hornC', () => roundedBox(0.17, 0.12, 0.025, 0.01, 3)), MAT.horn, this.local(base, [0, 0.13, 0.18]));
      this.add(this.mesh('throat', () => cylinder(0.022, 0.02, 24)), MAT.trim, this.local(base, [0, 0.13, 0.19]));
      driver(-cw * 0.31, 0.13, 0.18, 0.075, true);
      driver(cw * 0.31, 0.13, 0.18, 0.075, true);
      this.picks.push({ id: s.id, label: s.label, center: v3.add(pos, [0, 0.13, 0]), rotY, half: [cw / 2, 0.15, 0.2] });
      sp.top = [pos[0], pos[1] + 0.26, pos[2]];
    } else if (type === 'subwoofer') {
      const size = s.size || 0.85;
      this.add(this.mesh(`sub${size}`, () => roundedBox(size, size, size, 0.03, 4)), MAT.satin, this.local(base, [0, size / 2, 0]));
      const r = size * 0.33;
      driver(0, size * 0.52, size / 2 + 0.004, r, false);
      this.add(this.mesh(`port${size}`, () => roundedBox(size * 0.6, 0.05, 0.02, 0.01, 2)), MAT.horn, this.local(base, [0, size * 0.1, size / 2]));
      this.add(this.mesh('led', () => cylinder(0.006, 0.004, 12)), { albedo: [0, 0, 0], emissive: [0.6, 0.12, 0.05] },
        this.local(base, [size * 0.4, size * 0.08, size / 2 + 0.003]), { led: s.id });
      this.shadows.push({ pos: [pos[0], pos[2]], size: [size + 0.5, size + 0.5], s: 0.8 });
      this.picks.push({ id: s.id, label: s.label, center: v3.add(pos, [0, size / 2, 0]), rotY, half: [size / 2 + 0.03, size / 2 + 0.03, size / 2 + 0.03] });
      sp.top = [pos[0], size, pos[2]];
    }
  }

  buildCouch(c, z) {
    const base = m4.compose([0, 0, z], Math.PI); // front faces -z (towards the TV)
    const leather = { albedo: (c.color || [0.045, 0.032, 0.026]).map((v) => v * 1.8), rough: 0.42, pattern: 3 };
    const seats = c.seats || 2;
    const seatW = 0.6, arm = 0.2, mid = 0.25;
    const total = seats * seatW + 2 * arm + (seats - 1) * mid;
    const L = (p, rx = 0) => this.local(base, p, 0, rx);
    this.add(this.mesh(`couchBase${total}`, () => roundedBox(total, 0.28, 0.95, 0.04, 3)), { ...leather, albedo: leather.albedo.map((v) => v * 0.7) }, L([0, 0.14, 0]));
    let x = -total / 2 + arm;
    for (let i = 0; i < seats; i++) {
      const cx = x + seatW / 2;
      this.add(this.mesh('seat', () => roundedBox(seatW, 0.17, 0.72, 0.07, 5)), leather, L([cx, 0.36, 0.06]));
      this.add(this.mesh('back', () => roundedBox(seatW - 0.02, 0.6, 0.24, 0.1, 5)), leather, L([cx, 0.72, -0.34], 0.14));
      this.add(this.mesh('pillow', () => roundedBox(seatW - 0.08, 0.2, 0.17, 0.08, 5)), leather, L([cx, 0.98, -0.26], 0.2));
      x += seatW;
      if (i < seats - 1) {
        const mx = x + mid / 2;
        this.add(this.mesh('console2', () => roundedBox(mid, 0.55, 0.92, 0.05, 4)), leather, L([mx, 0.275, -0.01]));
        for (const cz of [0.22, 0.36]) {
          this.add(this.mesh('cup', () => cylinder(0.042, 0.012, 24)), MAT.horn, L([mx, 0.556, cz], Math.PI / 2));
          this.add(this.mesh('cupLed', () => torus(0.044, 0.004, 24, 5)), { albedo: [0, 0, 0], emissive: [0.05, 0.25, 0.9] }, L([mx, 0.558, cz], Math.PI / 2), { cupLed: true });
        }
        x += mid;
      }
    }
    for (const sx of [-1, 1]) {
      this.add(this.mesh('arm', () => roundedBox(arm, 0.62, 0.95, 0.07, 4)), leather, L([sx * (total / 2 - arm / 2), 0.31, -0.01]));
    }
    this.shadows.push({ pos: [0, z], size: [total + 0.6, 1.5], s: 0.85 });
    this.picks.push({ id: 'couch', label: 'Couch', center: [0, 0.5, z], rotY: 0, half: [total / 2, 0.55, 0.5] });
  }

  /** Draw a title card for the TV (idle screen, demo names). */
  setCard(title, subtitle = '') {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 576;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(512, 300, 40, 512, 300, 620);
    grd.addColorStop(0, '#16233d');
    grd.addColorStop(0.6, '#070b14');
    grd.addColorStop(1, '#020305');
    g.fillStyle = grd;
    g.fillRect(0, 0, 1024, 576);
    g.fillStyle = '#e8eefc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '300 88px "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
    const spaced = title.split('').join(String.fromCharCode(8202));
    g.fillText(spaced, 512, 262);
    g.fillStyle = 'rgba(160, 185, 230, 0.55)';
    g.fillRect(452, 330, 120, 2);
    g.font = '400 30px "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(subtitle.toUpperCase(), 512, 380);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cardTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Show an external texture (the visualizer) on the TV, or null for the title card. */
  setTVSource(tex, color = null) {
    this.tvSource = tex;
    if (color) this.tvColor = color;
  }

  goTo(name, seconds = 1.6) {
    const p = typeof name === 'string' ? this.presets[name] : name;
    if (!p) return;
    this.camFrom = { ...this.cam, target: this.cam.target.slice() };
    this.camGoal = { ...p, target: p.target.slice() };
    this.camT = 0;
    this.camDur = seconds;
    this.preset = typeof name === 'string' ? name : null;
  }

  focusSpeaker(id) {
    const sp = this.speakers[id];
    if (!sp) return;
    const th = Math.atan2(sp.pos[0], sp.pos[2]);
    this.goTo({ theta: th + 0.35, phi: 0.25, radius: 2.6, target: [sp.pos[0], 0.65, sp.pos[2]] }, 1.2);
  }

  /** User drag / zoom. */
  orbit(dx, dy) {
    this.camT = undefined;
    this.cam.theta -= dx * 0.005;
    this.cam.phi = clamp(this.cam.phi + dy * 0.004, -0.05, 1.4);
    this.lastInteract = this.time;
  }

  zoom(delta) {
    this.camT = undefined;
    this.cam.radius = clamp(this.cam.radius * Math.exp(delta * 0.001), 1.5, 14);
    this.lastInteract = this.time;
  }

  eye() {
    const c = this.cam;
    const drift = this.time - this.lastInteract > 6 && this.camT === undefined ? 0 : 0;
    const th = c.theta + drift;
    return [c.target[0] + c.radius * Math.cos(c.phi) * Math.sin(th), c.target[1] + c.radius * Math.sin(c.phi),
      c.target[2] + c.radius * Math.cos(c.phi) * Math.cos(th)];
  }

  _viewProj(w, h) {
    const o = this.camOverride;
    const eye = o ? o.eye : this.eye();
    const sh = this.shake;
    const tgt = v3.add(o ? o.target : this.cam.target, [(Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 0]);
    const view = m4.lookAt(eye, tgt, o && o.up ? o.up : [0, 1, 0]);
    const proj = m4.perspective(fitFov(o && o.fov ? o.fov : 0.75, w / h), w / h, 0.05, o && o.far ? o.far : 60);
    return { vp: m4.multiply(proj, view), eye, view, target: tgt, proj };
  }

  /** Which pickable object is under the pointer (NDC coords). */
  pick(ndcX, ndcY, w, h) {
    const { vp, eye } = this._viewProj(w, h);
    const inv = m4.invert(vp);
    const near = m4.transformPoint(inv, [ndcX, ndcY, -1]);
    const far = m4.transformPoint(inv, [ndcX, ndcY, 1]);
    const rd = v3.norm(v3.sub(far, near));
    let best = null, bestT = Infinity;
    for (const p of this.picks) {
      const t = obbHit(eye, rd, p);
      if (t !== null && t < bestT) {
        bestT = t;
        best = p;
      }
    }
    return best;
  }

  /** Screen position (CSS px) of a world point, for labels. */
  project(p, w, h) {
    const { vp } = this._viewProj(w, h);
    const q = m4.transformPoint(vp, p);
    return { x: (q[0] * 0.5 + 0.5) * w, y: (1 - (q[1] * 0.5 + 0.5)) * h, visible: q[2] < 1 };
  }

  update(dt, levelOf) {
    this.time += dt;
    // camera tween / idle drift
    if (this.camT !== undefined) {
      this.camT += dt / this.camDur;
      const k = easeInOut(Math.min(1, this.camT));
      const a = this.camFrom, b = this.camGoal;
      let dth = b.theta - a.theta;
      if (dth > Math.PI) dth -= Math.PI * 2;
      if (dth < -Math.PI) dth += Math.PI * 2;
      this.cam.theta = a.theta + dth * k;
      this.cam.phi = lerp(a.phi, b.phi, k);
      this.cam.radius = lerp(a.radius, b.radius, k);
      this.cam.target = v3.lerp(a.target, b.target, k);
      if (this.camT >= 1) {
        this.camT = undefined;
        this.idleBase = this.cam.theta;
        this.idleStart = this.time;
      }
    } else if (this.time - this.lastInteract > 8 && this.preset === 'overview') {
      if (this.idleBase === undefined || this.idleStart === undefined) {
        this.idleBase = this.cam.theta;
        this.idleStart = this.time;
      }
      this.cam.theta = this.idleBase + Math.sin((this.time - this.idleStart) * 0.07) * 0.35;
    }
    // speaker activity -> cone excursion and glow
    for (const id in this.speakers) {
      const sp = this.speakers[id];
      const lvl = Math.max(levelOf ? levelOf(sp.role) : 0, this.activity[id] || 0);
      sp.glow += (Math.min(1, lvl * 3) - sp.glow) * Math.min(1, dt * (lvl * 3 > sp.glow ? 25 : 6));
      if (this.activity[id]) this.activity[id] = Math.max(0, this.activity[id] - dt * 0.2);
    }
    for (const c of this.cones) {
      const sp = this.speakers[c.speaker];
      const hz = sp.type === 'subwoofer' ? 7 : 13;
      const amp = sp.type === 'subwoofer' ? 0.035 : 0.009;
      const exc = sp.glow * amp * Math.sin(this.time * Math.PI * 2 * hz);
      c.node.model = m4.multiply(c.base, m4.compose([0, 0, exc]));
    }
    this.flash *= Math.exp(-dt / 0.12);
    this.shake *= Math.exp(-dt / 0.25);
  }

  setActivity(id, v) {
    this.activity[id] = v;
  }

  /**
   * Reshape the room (experiences): walls slide out and grow, the front wall parts, the ceiling hinges open.
   * shape = { left, right, front, back (meters outward), split (front halves apart), height (wall scale),
   *           ceiling: 0..1 shown, open: 0..1 hinge, ground: 0..1, ribs: [r,g,b], ribSpacing } or null to reset.
   */
  setShape(shape) {
    this.shape = shape;
    const { W, H, front, back } = this.bounds;
    const midZ = (front + back) / 2, D = back - front;
    const sh = shape || {};
    const hs = sh.height || 1;
    const lift = (H * hs) / 2;
    const place = (n, pos) => {
      n.model = m4.compose(pos, n.base.rotY, [1, hs, 1]);
    };
    place(this.walls.left, [-W / 2 - (sh.left || 0), lift, midZ]);
    place(this.walls.right, [W / 2 + (sh.right || 0), lift, midZ]);
    place(this.walls.back, [0, lift, back + (sh.back || 0)]);
    place(this.walls.frontL, [-W / 4 - (sh.split || 0), lift, front - (sh.front || 0)]);
    place(this.walls.frontR, [W / 4 + (sh.split || 0), lift, front - (sh.front || 0)]);
    // side walls get longer as the room grows so the corners stay closed
    const grow = (D + (sh.front || 0) + (sh.back || 0)) / D;
    for (const k of ['left', 'right']) {
      const n = this.walls[k];
      const z = midZ + ((sh.back || 0) - (sh.front || 0)) / 2;
      n.model = m4.multiply(m4.compose([n.model[12], lift, z], n.base.rotY), m4.compose([0, 0, 0], 0, [grow, hs, 1]));
    }
    const wide = (W + (sh.left || 0) + (sh.right || 0)) / W;
    const bw = this.walls.back;
    bw.model = m4.multiply(m4.compose([((sh.right || 0) - (sh.left || 0)) / 2, lift, back + (sh.back || 0)], Math.PI), m4.compose([0, 0, 0], 0, [wide, hs, 1]));
    // ceiling panels hinge on the side walls' top edges and swing up and out
    const showCeil = (sh.ceiling || 0) > 0.001;
    const open = (sh.open || 0) * 2.05;
    for (const n of this.ceiling) {
      n.hidden = !showCeil;
      const sgn = n.ceilingSide === 'L' ? -1 : 1;
      const hingeX = sgn * (W / 2 + (n.ceilingSide === 'L' ? sh.left || 0 : sh.right || 0));
      const span = W / 2 + (n.ceilingSide === 'L' ? sh.left || 0 : sh.right || 0);
      const a = -sgn * open; // the inner edge lifts
      const c = Math.cos(a), si = Math.sin(a);
      const rz = new Float32Array([c, si, 0, 0, -si, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      const toCenter = m4.compose([-sgn * span / 2, 0, 0], 0, [span / (W / 2), 1, grow], Math.PI / 2);
      n.model = m4.multiply(m4.multiply(m4.compose([hingeX, H * hs, midZ + ((sh.back || 0) - (sh.front || 0)) / 2]), rz), toCenter);
      n.mat.emissive = [0, 0, 0];
    }
    this.ground.hidden = !((sh.ground || 0) > 0.001);
    this.groundGlow = (sh.ground || 0);
    this.ribs = sh.ribs || null;
    this.ribSpacing = sh.ribSpacing || 1.6;
    for (const n of this.nodes) if (n.model !== n._nmFor) n.normal = m4.normalMatrix(n.model);
  }

  idForRole(role) {
    for (const id in this.speakers) if (this.speakers[id].role === role) return id;
    return null;
  }

  _lights(fixtures) {
    const L = [];
    const tvc = this.tvColor;
    const amb = this.ambient;
    L.push({ pos: [0, this.tv.y - 0.1, this.tv.z + 1.1], col: tvc.map((v) => v * 9), dir: [0, -0.25, 1], cos: Math.cos(1.0), range: 7 });
    L.push({ pos: [0, 2.6, -0.2], col: [0.75, 0.6, 0.45].map((v) => v * amb * (1 + this.flash * 12)), dir: [0, -1, 0], cos: Math.cos(1.25), range: 8 });
    L.push({ pos: [0.5, 2.3, 2.4], col: [0.16, 0.2, 0.3].map((v) => v * amb * (1 + this.flash * 8)), dir: [0, 0, 0], cos: -2, range: 9 });
    for (const f of fixtures) {
      L.push({ pos: f.pos, col: f.color.map((v) => v * 4.5 * (f.gain || 1)), dir: f.dir, cos: f.cos, range: f.range });
    }
    if (this.orb) L.push({ pos: this.orb.pos, col: [1.1, 0.85, 0.55], dir: [0, 0, 0], cos: -2, range: 3.2 });
    for (const x of this.extraLights) L.push(x);
    return L.slice(0, MAX_LIGHTS);
  }

  _renderTV(viz) {
    const gl = this.gl;
    if (this.tvSource) return this.tvSource;
    this.tvTarget.bind();
    this.tvProg.use().tex('uCard', this.cardTex).set('uTime', this.time);
    drawFullscreen(gl);
    return this.tvTarget.tex;
  }

  render(w, h, fixtures, hoverId = null) {
    const gl = this.gl;
    const tvTex = this._renderTV();
    const r = this.res.size(w, h);
    this.target.resize(r.w, r.h);
    this.target.bind();
    gl.clearColor(0.004, 0.004, 0.006, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const { vp, eye, view, target } = this._viewProj(this.target.w, this.target.h);
    if (this.sky.amount > 0.001) {
      // the world beyond the walls (only visible once an experience opens the room up)
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      const k = this.sky;
      this.skyProg.use().setAll({ uInvVP: m4.invert(vp), uCam: eye, uTop: k.top, uHorizon: k.horizon, uGlow: k.glow,
        uAmount: k.amount, uTime: this.time, uStars: k.stars });
      drawFullscreen(gl);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }
    const lights = this._lights(fixtures || []);
    const n = lights.length;
    const lp = new Float32Array(MAX_LIGHTS * 3), lc = new Float32Array(MAX_LIGHTS * 3);
    const ld = new Float32Array(MAX_LIGHTS * 4), lr = new Float32Array(MAX_LIGHTS);
    lights.forEach((l, i) => {
      lp.set(l.pos, i * 3);
      lc.set(l.col, i * 3);
      const d = l.dir && v3.len(l.dir) > 0 ? v3.norm(l.dir) : [0, -1, 0];
      ld.set([...d, l.dir && v3.len(l.dir) > 0 ? l.cos : -2], i * 4);
      lr[i] = l.range;
    });
    const amb = (1.6 + this.flash * 12) * this.ambient;
    const skyAmb = this.sky.amount * 0.6; // moonlight once the room is open to the sky
    const P = this.std.use();
    P.setAll({
      uViewProj: vp, uCam: eye, uLightCount: n, uLPos: lp, uLCol: lc, uLDir: ld, uLRange: lr, uTime: this.time,
      uAmbSky: [0.014 * amb + 0.02 * skyAmb, 0.016 * amb + 0.026 * skyAmb, 0.024 * amb + 0.05 * skyAmb], uAmbGround: [0.006 * amb, 0.005 * amb, 0.005 * amb],
      uGrid: [0.025, 0.045, 0.085].map((v) => v * (this.groundGlow || 0)), uFade: [8, 45],
    });
    const ribs = this.ribs ? [...this.ribs, this.ribSpacing] : [0, 0, 0, 0];
    P.tex('uTex', tvTex); // every draw samples a valid texture (never the target we render into)
    for (const node of this.nodes) {
      if (node.hidden) continue;
      const m = node.mat;
      let emissive = m.emissive || [0, 0, 0];
      if (node.fixture) {
        const f = (fixtures || []).find((x) => x.id === node.fixture);
        if (f) emissive = f.color.map((v) => 0.08 + v * 2.2);
      }
      if (node.cupLed) emissive = [0.03, 0.18, 0.7];
      if (node.led) emissive = this.speakers[node.led] && this.speakers[node.led].glow > 0.05 ? [2.5, 0.25, 0.08] : [0.5, 0.06, 0.02];
      const owner = node.owner ? this.speakers[node.owner] : null;
      if (owner && owner.glow > 0.01) emissive = [owner.glow * 0.02, owner.glow * 0.03, owner.glow * 0.05];
      if (node.wall) gl.enable(gl.CULL_FACE);
      P.setAll({
        uModel: node.model, uNormalMat: node.model === node._nmFor ? node.normal : (node.normal = m4.normalMatrix(node.model), node._nmFor = node.model, node.normal),
        uAlbedo: m.albedo, uRough: m.rough, uMetal: m.metal || 0, uEmissive: emissive, uPattern: m.pattern || 0,
        uHover: hoverId && (node.owner === hoverId || node.fixture === hoverId) ? 1 : 0,
        uUseTex: node.screen ? 1 : 0, uTexGain: 1.6 * (this.tvGain ?? 1),
        uRib: node.wall || node.ceilingSide ? ribs : [0, 0, 0, 0],
      });
      node.mesh.draw();
    }
    gl.disable(gl.CULL_FACE);
    // contact shadows (multiply)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -4);
    const S = this.shadowProg.use();
    const sq = this.mesh('shadowQuad', () => plane(1, 1));
    for (const s of this.shadows) {
      const model = m4.compose([s.pos[0], 0.006, s.pos[1]], 0, [s.size[0], 1, s.size[1]]);
      S.setAll({ uModel: model, uNormalMat: m4.normalMatrix(model), uViewProj: vp, uStrength: s.s });
      sq.draw();
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // glows (additive)
    gl.blendFunc(gl.ONE, gl.ONE);
    const G = this.glowProg.use();
    const right = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]];
    G.setAll({ uViewProj: vp, uRight: right, uUp: up });
    const gq = this.mesh('glowQuad', () => quad(2, 2));
    const glow = (pos, size, color, falloff = 4) => {
      G.setAll({ uCenter: pos, uSize: [size, size], uColor: color, uFalloff: falloff });
      gq.draw();
    };
    for (const f of fixtures || []) {
      if (f.anchor === 'tv') continue;
      glow(v3.add(f.pos, [0, 0.1, 0]), 0.55, f.color.map((v) => v * 0.9), 5);
    }
    for (const id in this.speakers) {
      const sp = this.speakers[id];
      if (sp.glow > 0.02 && sp.top) {
        // a soft halo in front of the drivers, as if the sound itself glowed
        const fwd = [Math.sin(sp.rotY), 0, Math.cos(sp.rotY)];
        const mid = [sp.pos[0] + fwd[0] * 0.32, Math.max(0.25, sp.top[1] * 0.6), sp.pos[2] + fwd[2] * 0.32];
        glow(mid, 0.28 + sp.glow * 0.22, (sp.glowColor || [0.3, 0.5, 1.0]).map((v) => v * sp.glow * 0.35), 4);
      }
    }
    if (this.orb) {
      glow(this.orb.pos, 0.16, [3.0, 2.3, 1.5], 5);
      glow(this.orb.pos, 0.55, [0.35, 0.25, 0.15], 3);
      if (this.orbTrail) for (const [i, p] of this.orbTrail.entries()) glow(p, 0.1, [0.25, 0.18, 0.1].map((v) => v * (i / this.orbTrail.length)), 5);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    if (this.layers.length) {
      const lctx = { gl, vp, eye, view, target, right, up, time: this.time, w: this.target.w, h: this.target.h, room: this };
      for (const L of this.layers) {
        try {
          L.draw(lctx);
        } catch (e) {
          if (!L._err) console.error('[room layer]', e);
          L._err = e;
        }
      }
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.disable(gl.DEPTH_TEST);
    this.post.run(this.target.tex, this.target.w, this.target.h, w, h, {
      bloomStrength: 0.12, threshold: 0.7, exposure: 1.75, vignette: 0.5, grain: 0.018, saturation: 1.05,
      flash: [this.flash * 0.25, this.flash * 0.27, this.flash * 0.32], ...(this.postOverride || {}),
    }, this.time);
  }

  setOrb(o) {
    if (!o || !o.on) {
      this.orb = null;
      this.orbTrail = null;
      return;
    }
    const th = (o.angle * Math.PI) / 180;
    const r = o.radius || 1.6;
    this.orb = { pos: [Math.sin(th) * r, o.height || 1.8, -Math.cos(th) * r + 0.2] };
    this.orbTrail = (this.orbTrail || []).concat([this.orb.pos]).slice(-14);
  }
}
