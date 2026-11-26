// Beneath the Ice: the picture. One full-screen ray-marched shader looks down through clear lake ice:
// bubbles frozen in layers, hairline cracks that flash when the ice ticks, the fracture running across,
// light shafts into dark water, a creature you only see as a shadow against the faint glow of the deep,
// and finally the deep itself lighting up. Sprites add rising bubbles and the living lights.
import { Program, FULLSCREEN_VS, drawFullscreen } from '../../gl/gl.js';
import { v3 } from '../../gl/math.js';
import { Rng, Curve, smoothstep, clamp, lastBefore, pulse } from '../core/timeline.js';
import { DynBuffer, Spline, spriteProgram, rgbMul, rgbMix } from '../core/gfx.js';
import { StageScene } from '../core/stage.js';

const sm = smoothstep;
const ICE_T = 0.45; // ice thickness (m)

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform float uTime;
uniform vec4 uCrack[16];      // x, z, reveal time, starts a new path (1)
uniform int uCrackN;
uniform float uCrackGlow;
uniform vec4 uMicro[8];       // x, z, age, strength
uniform vec4 uBeast;          // x, y, z, length
uniform vec3 uBeastDir;
uniform float uBeastGlow, uReveal, uRevealT, uDeep, uShaft, uFlash, uSurface;
uniform vec3 uWater;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return v; }

// voronoi edge distance (hairline cracks)
float vedge(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = h22(n + g);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}

// frozen bubbles: flattened white discs in a layer
vec4 bubbles(vec2 p, float scale, float density, float seed) {
  vec2 q = p * scale;
  vec2 c = floor(q);
  vec2 f = fract(q);
  float h = h12(c + seed);
  // bubbles freeze in streams and patches (seeps), with a few loners in between
  float seep = smoothstep(0.52, 0.72, fbm(c / scale * 0.22 + seed * 0.37));
  if (h > density * (0.08 + 1.6 * seep)) return vec4(0.0);
  vec2 o = h22(c + seed * 1.7) * 0.6 + 0.2;
  float r = 0.08 + 0.22 * h12(c + seed * 3.1);
  vec2 d = (f - o) / vec2(1.0, 0.55 + 0.4 * h12(c + 9.0));
  float l = length(d) / r;
  if (l > 1.0) return vec4(0.0);
  float rim = smoothstep(0.6, 1.0, l) * (1.0 - smoothstep(0.92, 1.0, l));
  float a = (0.35 + 0.65 * rim) * (1.0 - smoothstep(0.95, 1.0, l));
  return vec4(vec3(0.75, 0.85, 0.95) * (0.4 + 0.8 * rim), a);
}

float segDist(vec2 p, vec2 a, vec2 b, out float u) {
  vec2 pa = p - a, ba = b - a;
  u = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * u);
}

// the fracture: distance to the revealed part of the crack network, plus how fresh it is
vec2 fracture(vec2 p) {
  float best = 100.0, fresh = 0.0;
  for (int i = 1; i < 16; i++) {
    if (i >= uCrackN) break;
    vec4 b = uCrack[i];
    if (b.w > 0.5) continue;
    vec4 a = uCrack[i - 1];
    float u;
    // jagged: offset the point with noise along the crack
    vec2 pj = p + (vec2(vn(p * 3.0), vn(p * 3.0 + 7.0)) - 0.5) * 0.25;
    float d = segDist(pj, a.xy, b.xy, u);
    float tr = mix(a.z, b.z, u);
    if (uTime < tr) continue;
    if (d < best) { best = d; fresh = exp(-(uTime - tr) * 0.9); }
  }
  return vec2(best, fresh);
}

// the creature, in its own frame: x forward, y up, z sideways (all scaled by its length)
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); return (k0 - 1.0) * min(min(r.x, r.y), r.z); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float beast(vec3 p) {
  float sw = sin(uTime * 0.9 - p.x * 2.4) * 0.03 * smoothstep(0.0, -0.5, p.x);
  p.y -= sw;
  float body = sdEll(p - vec3(0.02, 0.0, 0.0), vec3(0.38, 0.07, 0.085));
  float tail = sdEll(p - vec3(-0.38, 0.0, 0.0), vec3(0.2, 0.035, 0.04));
  float fluke = sdEll(p - vec3(-0.56, 0.0, 0.0), vec3(0.05, 0.012, 0.15));
  vec3 q = p; q.z = abs(q.z);
  q.x += q.z * 0.6;
  float fin = sdEll(q - vec3(0.12, -0.03, 0.1), vec3(0.06, 0.01, 0.075));
  float d = smin(body, tail, 0.06);
  d = smin(d, fluke, 0.04);
  d = smin(d, fin, 0.03);
  return d;
}

void main() {
  vec4 pw = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(pw.xyz / pw.w - uCam);
  vec3 ro = uCam;
  vec3 col = vec3(0.0);
  // sky (only where we look above the horizon)
  if (rd.y >= -0.001) {
    col = vec3(0.004, 0.006, 0.012) + vec3(0.01, 0.014, 0.022) * exp(-rd.y * 6.0);
    outColor = vec4(col, 1.0);
    return;
  }
  // ---- ice surface
  float tIce = -ro.y / rd.y;
  vec3 p0 = ro + rd * tIce;
  float cosI = -rd.y;
  float fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
  vec3 moon = normalize(vec3(-0.35, 0.42, -1.0));
  float ma = max(dot(rr, moon), 0.0);
  vec3 refl = (vec3(0.006, 0.01, 0.02) + vec3(0.5, 0.6, 0.75) * pow(ma, 10.0) * 0.03) * (0.6 + 0.4 * fbm(p0.xz * 0.2)) * uSurface;
  float frost = fbm(p0.xz * 3.0) * fbm(p0.xz * 11.0 + 3.0);
  vec3 dI = refract(rd, vec3(0.0, 1.0, 0.0), 1.0 / 1.31);
  // ---- inside the ice: bubble layers, hairline cracks, the fracture
  vec3 iceCol = vec3(0.0);
  float iceA = 0.0;
  for (int k = 0; k < 5; k++) {
    float depth = 0.04 + float(k) * 0.085;
    vec3 pk = p0 + dI * (depth / -dI.y);
    vec4 b = bubbles(pk.xz, 1.6 + float(k) * 0.9, 0.18 + 0.05 * float(k), float(k) * 13.7);
    float lit = 0.35 + 0.65 * uShaft;
    iceCol += b.rgb * b.a * (1.0 - iceA) * lit * (1.0 - float(k) * 0.15) * 0.22;
    iceA += b.a * (1.0 - iceA) * 0.5;
  }
  vec3 pc = p0 + dI * (0.2 / -dI.y);
  float hair = smoothstep(0.03, 0.0, vedge(pc.xz * 0.6)) * smoothstep(0.5, 0.75, fbm(pc.xz * 0.25 + 4.0));
  float micro = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 m = uMicro[i];
    float d = length(pc.xz - m.xy);
    micro += m.w * exp(-d * d * 1.5) * exp(-m.z * 6.0);
  }
  iceCol += vec3(0.6, 0.85, 1.0) * hair * (0.012 + 1.4 * micro + 0.3 * uFlash);
  vec2 fr = fracture(pc.xz);
  float crackLine = exp(-fr.x * fr.x * 900.0);
  float crackGlow = exp(-fr.x * fr.x * 25.0);
  iceCol += vec3(0.55, 0.85, 1.0) * (crackLine * (0.5 + 3.0 * fr.y) + crackGlow * fr.y * 0.6) * uCrackGlow;
  iceCol += vec3(0.45, 0.7, 0.9) * frost * 0.02;
  // ---- the water below
  vec3 pb = p0 + dI * (${ICE_T.toFixed(2)} / -dI.y);
  vec3 dW = normalize(refract(dI, vec3(0.0, 1.0, 0.0), 1.31 / 1.333));
  float sigma = 0.045, kd = 0.11;
  float dy = -dW.y;
  float S = (32.0 - ${ICE_T.toFixed(2)}) / max(dy, 0.05);
  // the creature
  float tHit = 1e9, minD = 1.0;
  vec3 bN = vec3(0.0), bP = vec3(0.0);
  {
    vec3 fwd = normalize(uBeastDir);
    vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(side, fwd);
    float L = uBeast.w;
    vec3 rel = pb - uBeast.xyz;
    vec3 lo = vec3(dot(rel, fwd), dot(rel, up), dot(rel, side)) / L;
    vec3 ld = vec3(dot(dW, fwd), dot(dW, up), dot(dW, side));
    // bounding sphere of radius 0.62 (in body lengths)
    float bq = dot(lo, ld), cq = dot(lo, lo) - 0.62 * 0.62;
    float disc = bq * bq - cq;
    if (disc > 0.0 && L > 0.1) {
      float t0 = max(0.0, -bq - sqrt(disc)), t1 = -bq + sqrt(disc);
      float t = t0;
      for (int i = 0; i < 48; i++) {
        vec3 q = lo + ld * t;
        float d = beast(q);
        minD = min(minD, d);
        if (d < 0.0015) { tHit = t * L; bP = q; break; }
        t += max(d * 0.85, 0.002);
        if (t > t1) break;
      }
      if (tHit < 1e8) {
        vec2 e = vec2(0.002, 0.0);
        vec3 n = normalize(vec3(beast(bP + e.xyy) - beast(bP - e.xyy), beast(bP + e.yxy) - beast(bP - e.yxy), beast(bP + e.yyx) - beast(bP - e.yyx)));
        bN = n.x * fwd + n.y * up + n.z * side;
      }
    }
  }
  float Seg = min(S, tHit);
  // light: falls off with depth, broken into shafts by the ice
  vec3 inscat = vec3(0.0);
  float trans = 1.0;
  float stepL = Seg / 14.0;
  for (int i = 0; i < 14; i++) {
    float s = (float(i) + 0.5) * stepL;
    vec3 q = pb + dW * s;
    float depth = -q.y;
    float mask = 0.55 + 0.9 * fbm(q.xz * 0.18 + vec2(uTime * 0.01, 0.0)) * smoothstep(0.0, 10.0, depth);
    vec2 fq = fracture(q.xz);
    mask += exp(-fq.x * fq.x * 3.0) * uCrackGlow * 0.8;
    float L0 = uShaft * mask * exp(-depth * kd);
    // living light in the water (the reveal)
    // once the deep wakes up, the water itself carries a faint green-blue glow
    float wave = clamp((uRevealT * 6.0 - length(q.xz) + 8.0) / 8.0, 0.0, 1.0);
    float plank = uReveal * wave * (0.35 + 0.65 * fbm(q.xz * 0.08 + depth * 0.05 + uTime * 0.01));
    vec3 lightCol = uWater * L0 + vec3(0.005, 0.03, 0.036) * plank;
    inscat += lightCol * trans * stepL * sigma * 1.1;
    trans *= exp(-sigma * stepL);
  }
  vec3 water = inscat;
  if (tHit < 1e8) {
    // the creature: almost black; only its back catches the light from above, until it starts to glow
    float rim = pow(max(bN.y, 0.0), 2.0) * uShaft * exp(-(-pb.y - dW.y * tHit) * kd) * 0.12;
    // a lateral line of light along each flank, faint chevrons, and round photophores
    float lateral = smoothstep(0.01, 0.0, abs(abs(bP.z) - 0.055 - 0.01 * sin(bP.x * 30.0))) * smoothstep(0.35, 0.2, abs(bP.x));
    float chev = smoothstep(0.985, 1.0, sin(bP.x * 55.0 + abs(bP.z) * 30.0)) * 0.35;
    vec2 g = fract(bP.xz * 90.0) - 0.5;
    float spots = step(0.86, h12(floor(bP.xz * 90.0))) * smoothstep(0.3, 0.12, length(g));
    vec3 lum = vec3(0.2, 0.95, 1.0) * (lateral * 1.2 + chev) + vec3(0.85, 0.55, 1.0) * spots * 0.8;
    water += (uWater * rim + lum * uBeastGlow) * trans;
  } else {
    // the deep: a faint glow far below (what the creature blocks), and later a living landscape
    vec3 pd = pb + dW * S;
    float glow = uDeep * (0.55 + 0.6 * fbm(pd.xz * 0.04 + 3.0)) * (0.8 + 0.4 * sin(uTime * 0.2 + pd.x * 0.05));
    vec3 deep = vec3(0.05, 0.25, 0.45) * glow;
    if (uReveal > 0.0) {
      float ground = fbm(pd.xz * 0.06);
      vec2 cell = floor(pd.xz * 1.3);
      float hh = h12(cell);
      vec2 o = h22(cell) - 0.5;
      float dot1 = smoothstep(0.35, 0.0, length(fract(pd.xz * 1.3) - 0.5 - o * 0.6)) * step(0.55, hh);
      float wave = clamp((uRevealT * 6.5 - length(pd.xz) + 10.0) / 10.0, 0.0, 1.0);
      vec3 bio = mix(vec3(0.1, 0.9, 0.8), mix(vec3(0.7, 0.3, 1.0), vec3(1.0, 0.75, 0.3), step(0.85, hh)), step(0.7, hh));
      float tw = 0.6 + 0.4 * sin(uTime * (0.7 + hh * 2.0) + hh * 30.0);
      deep += (bio * dot1 * tw * 2.2 + vec3(0.02, 0.12, 0.16) * ground * 0.6) * uReveal * wave;
      // fields of glowing stalks between the lights
      float stalk = smoothstep(0.08, 0.0, abs(fract(pd.x * 0.35 + vn(pd.xz * 0.2) * 0.8) - 0.5)) * step(0.5, vn(pd.xz * 0.15));
      deep += vec3(0.1, 0.6, 0.5) * stalk * 0.3 * uReveal * wave;
    }
    // a ray that grazes the creature still loses some of the light behind it: soft edges
    water += deep * trans * smoothstep(0.0, 0.035, minD);
  }
  // ---- compose: reflection on top, the ice's contents, the water through it
  vec3 under = water * (1.0 - iceA * 0.6) + iceCol;
  col = refl * fres + under * (1.0 - fres);
  col += vec3(0.7, 0.9, 1.0) * uFlash * 0.15;
  outColor = vec4(col, 1.0);
}`;

export class Scene extends StageScene {
  constructor(app, score, run) {
    super(app, score, run);
    this.M = score.marks;
    const ev = score.events;
    this.crackles = ev.filter((e) => e.inst === 'crackle');
    this.bubbleEv = ev.filter((e) => e.inst === 'bubble');
    this.calls = ev.filter((e) => e.inst === 'call');
    this.glows = ev.filter((e) => e.inst === 'glow');
    this.sings = ev.filter((e) => e.inst === 'sing');
    this.booms = ev.filter((e) => e.inst === 'boom');
    this.rng = new Rng(5);
    // the crack network with reveal times (front-right first, then under you, branches as it passes)
    const { t0, speed, paths } = score.crack;
    const pts = [];
    const timeAt = new Map();
    paths.forEach((path, pi) => {
      let t = pi === 0 ? t0 : timeAt.get(path[0].join(',')) ?? t0;
      path.forEach((p, i) => {
        if (i > 0) t += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) / speed;
        if (pi === 0) timeAt.set(p.join(','), t);
        pts.push([p[0], p[1], t, i === 0 ? 1 : 0]);
      });
    });
    this.crack = new Float32Array(64);
    pts.slice(0, 16).forEach((p, i) => this.crack.set(p, i * 4));
    this.crackN = Math.min(16, pts.length);
  }

  async init() {
    const gl = this.gl;
    this.prog = new Program(gl, FULLSCREEN_VS, FS, 'ice');
    this.sprites = spriteProgram(gl);
    this.buf = new DynBuffer(gl, [[0, 3], [1, 4]], 4000);
    const rng = this.rng;
    this.motes = Array.from({ length: 700 }, () => [rng.range(-14, 14), -rng.range(0.6, 14), rng.range(-24, 6), rng.next() * 6.28]);
    this.lights = Array.from({ length: 3200 }, () => {
      const r = Math.sqrt(rng.next()) * 34;
      const a = rng.next() * 6.28;
      return [Math.sin(a) * r, -rng.range(2, 24), -Math.cos(a) * r - 6, rng.next() * 6.28, rng.next()];
    });
    this.callLights = this.calls.map((c) => {
      const a = (c.az * Math.PI) / 180;
      return [Math.sin(a) * 9, -11, -Math.cos(a) * 9 + 3.5];
    });
    const M = this.M;
    const K = (t, eye, tgt, fov, hold) => ({ t, v: [...eye, ...tgt, fov], hold });
    const keys = [
      K(0, [0, 3.0, 4.6], [0, -2.0, -2.6], 0.95, true),
      K(30, [0.6, 2.7, 4.3], [0.3, -2.4, -2.4], 0.97),
      K(M.crack, [0.4, 2.6, 4.2], [0.1, -2.6, -2.0], 0.98),
      K(52, [-0.2, 2.9, 4.4], [0, -2.9, -1.8], 1.0),
      K(M.under, [-0.4, 3.6, 4.6], [-0.3, -3.6, -0.6], 1.05),
      K(M.stop, [-0.3, 3.4, 4.6], [-0.2, -3.2, -1.2], 1.02, true),
      K(M.reveal, [-0.3, 3.4, 4.6], [-0.2, -3.2, -1.2], 1.02),
      K(116, [0, 3.0, 5.0], [0, -1.6, -5.0], 1.05),
      K(128, [0.4, 2.6, 5.4], [0, -0.8, -7.0], 1.05, true),
    ];
    this.camS = new Spline(keys);
    const C = this.score.creature;
    this.beastPath = new Curve([[C.t0, [C.x0, -C.depth, C.z0]], [C.t1, [C.x1, -C.depth - 2, C.z1]]]);
    this.c = {
      shaft: new Curve([[0, 0.5], [M.crack, 0.55], [M.crack + 0.3, 1.4], [M.crack + 6, 0.7], [M.creature + 5, 0.55], [M.under, 0.25], [M.stop, 0.15], [M.call, 0.2], [M.reveal, 0.35]]),
      deep: new Curve([[0, 0.5], [M.creature - 5, 0.6], [M.creature + 3, 1.3], [M.under + 6, 1.1], [M.stop, 0.35], [M.call, 0.6], [M.reveal, 0.9]]),
      reveal: new Curve([[0, 0], [M.reveal, 0], [M.reveal + 9, 1, 'inOut'], [126, 1], [128, 0.85]]),
      exposure: new Curve([[0, 1.6], [M.crack, 1.7], [M.stop, 1.6], [M.reveal, 1.8], [127, 1.8], [128, 1.2]]),
    };
  }

  update(t, dt) {
    this.t = t;
    this.dt = dt;
  }

  _beast(t) {
    const C = this.score.creature;
    if (t >= 101) {
      // it comes back once the deep is lit: slower, deeper, wearing its own lights
      const x = (t - 101) / 27;
      return { p: [-38 + 70 * x, -19, -16 + 6 * x], dir: v3.norm([1, 0, 0.09]), L: C.length * 1.15 };
    }
    if (t < C.t0 || t > C.t1) return null;
    const p = this.beastPath.at(t);
    const dir = v3.norm([C.x1 - C.x0, -0.02, C.z1 - C.z0]);
    return { p, dir, L: C.length };
  }

  draw(t, dt, target) {
    const gl = this.gl;
    const w = target.w, h = target.h;
    const k = this.camS.at(t);
    const M = this.M;
    const shake = pulse(t, M.crack, 0.01, 0.4) * 0.05 + pulse(t, M.under, 0.5, 3) * 0.015;
    const jitter = [Math.sin(t * 53) * shake, Math.cos(t * 47) * shake, 0];
    const cam = this.camera(v3.add(k.slice(0, 3), jitter), k.slice(3, 6), k[6], w, h, { far: 200 });
    this.cam = cam;
    const micro = new Float32Array(32);
    let mi = 0;
    for (let i = lastBefore(this.crackles, t); i >= 0 && mi < 8 && t - this.crackles[i].t < 0.8; i--) {
      const e = this.crackles[i];
      micro.set([e.x, e.z, t - e.t, e.vel * 2], mi * 4);
      mi++;
    }
    const beast = this._beast(t);
    const reveal = this.c.reveal.at(t);
    const flash = pulse(t, M.crack, 0.005, 0.25) * 1.2 + pulse(t, M.crack + 0.9, 0.01, 0.2) * 0.4;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.prog.use().setAll({
      uInvVP: cam.invVP, uCam: cam.eye, uTime: t, uCrack: this.crack, uCrackN: this.crackN,
      uCrackGlow: t < M.crack ? 0 : 0.35 + 0.65 * Math.exp(-(t - M.crack) / 10) + reveal * 0.3,
      uMicro: micro, uBeast: beast ? [...beast.p, beast.L] : [0, -50, 0, 0], uBeastDir: beast ? beast.dir : [0, 0, 1],
      uBeastGlow: sm(M.reveal + 2, M.reveal + 10, t), uReveal: reveal, uRevealT: Math.max(0, t - M.reveal),
      uDeep: this.c.deep.at(t), uShaft: this.c.shaft.at(t), uFlash: flash, uSurface: 1, uWater: [0.014, 0.05, 0.075],
    });
    drawFullscreen(gl);
    this._sprites(t, cam);
    return target;
  }

  _sprites(t, cam) {
    const gl = this.gl;
    const d = this.buf.data;
    let n = 0;
    const push = (p, c, s) => {
      if (n >= this.buf.max) return;
      const o = n * 7;
      d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
      d[o + 3] = c[0]; d[o + 4] = c[1]; d[o + 5] = c[2]; d[o + 6] = s;
      n++;
    };
    const M = this.M;
    const atten = (y) => Math.exp(y * 0.09);
    // bubbles: rise from the dark and gather under the ice
    for (let i = lastBefore(this.bubbleEv, t); i >= 0 && t - this.bubbleEv[i].t < 7; i--) {
      const e = this.bubbleEv[i];
      const age = t - e.t + 1.4; // they are already rising when we hear them pop free
      const rise = Math.min(1, age / 2.2);
      const y = -ICE_T - 0.03 - (1 - rise) * (1 - rise) * 5;
      const k = Math.min(1, age * 2) * (1 - sm(4, 7, t - e.t));
      push([e.x + Math.sin(age * 4 + e.f) * 0.05 * (1 - rise), y, e.z], rgbMul([0.6, 0.8, 0.95], 0.5 * k * atten(y)), 0.04 + 0.03 * (e.f % 3) / 3);
    }
    // drifting particles in the water
    const shaft = this.c.shaft.at(t);
    for (const m of this.motes) {
      const y = m[1] + Math.sin(t * 0.05 + m[3]) * 0.4;
      push([m[0] + Math.sin(t * 0.03 + m[3]) * 0.6, y, m[2] + t * 0.05 % 2], rgbMul([0.4, 0.7, 0.8], 0.03 * shaft * atten(y)), 0.05);
    }
    // calls: a light far below, where each voice is
    this.calls.forEach((c, i) => {
      const k = c.kind === 'long' ? pulse(t, c.t, 1.5, 6) : pulse(t, c.t, 0.2, 1.6);
      if (k < 0.01) return;
      const p = c.kind === 'long' ? [0, -16, -6] : this.callLights[i];
      push(p, rgbMul([0.3, 0.9, 1.0], 1.2 * k), c.kind === 'long' ? 3 : 1.2);
      push(p, rgbMul([0.6, 1.0, 1.0], 2.2 * k), 0.25);
    });
    // the reveal: thousands of living lights switching on in a wave from the middle
    const reveal = this.c.reveal.at(t);
    if (reveal > 0) {
      const rt = t - M.reveal;
      for (const L of this.lights) {
        const dist = Math.hypot(L[0], L[2] + 6);
        const on = clamp((rt * 4.2 - dist + 6) / 6, 0, 1) * reveal;
        if (on < 0.01) continue;
        const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + L[4] * 2) + L[3] * 9);
        const col = L[4] < 0.6 ? [0.2, 1.0, 0.85] : L[4] < 0.85 ? [0.7, 0.4, 1.0] : [1.0, 0.8, 0.35];
        const y = L[1] + Math.sin(t * 0.2 + L[3]) * 0.3;
        push([L[0], y, L[2]], rgbMul(col, 1.3 * on * tw * atten(y) * 3), 0.09 + L[4] * 0.1);
      }
      for (let i = lastBefore(this.glows, t); i >= 0 && t - this.glows[i].t < 2.5; i--) {
        const e = this.glows[i];
        const a = (e.az * Math.PI) / 180;
        const k = pulse(t, e.t, 0.02, 0.8);
        push([Math.sin(a) * e.dist * 6, -5 - e.dist * 3, -Math.cos(a) * e.dist * 6 + 3.5], rgbMul([0.6, 1.0, 0.95], 2 * k * e.vel * 4), 0.3);
      }
    }
    this.buf.upload(n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.sprites.use().setAll({ uVP: cam.vp, uPx: cam.h / (2 * Math.tan(cam.fov / 2)) });
    this.buf.draw(gl.POINTS);
    gl.disable(gl.BLEND);
  }

  postParams(t) {
    const M = this.M;
    return {
      exposure: this.c.exposure.at(t), bloomStrength: 0.22 + 0.2 * this.c.reveal.at(t), threshold: 0.4, vignette: 0.6, grain: 0.03, saturation: 1.05,
      flash: rgbMul([0.6, 0.85, 1.0], 0.3 * pulse(t, M.crack, 0.005, 0.2)),
      shock: [0.62, 0.62, Math.max(0, (t - M.crack) * 0.8)], shockStrength: pulse(t, M.crack, 0.01, 0.6) * 1.4,
      letterbox: 0.1 * (1 - sm(4, 10, t)),
    };
  }

  // ---------------------------------------------------------------- Hue
  light(f, t) {
    const M = this.M;
    const az = f.anchor === 'tv' ? 0 : f.az ?? 0;
    const reveal = this.c.reveal.at(t);
    let c = [0.02, 0.05, 0.09].map((v) => v * (t < M.stop ? 1 : 0.4));
    const add = (col, k) => {
      c = [c[0] + col[0] * k, c[1] + col[1] * k, c[2] + col[2] * k];
    };
    const near = (a, w = 60) => Math.max(0, 1 - Math.abs(((a - az + 540) % 360) - 180) / w);
    // ice ticks: tiny flashes in the light nearest the sound
    for (let i = lastBefore(this.crackles, t); i >= 0 && t - this.crackles[i].t < 0.4; i--) {
      const e = this.crackles[i];
      const a = (Math.atan2(e.x, -(e.z - 3.5)) * 180) / Math.PI;
      add([0.6, 0.85, 1], pulse(t, e.t, 0.003, 0.08) * e.vel * 0.8 * near(a, 70));
    }
    // the fracture runs front-right -> rear-left
    if (t > M.crack - 0.1 && t < M.crack + 4) {
      const head = 60 - Math.min(180, (t - M.crack) * 120);
      add([0.7, 0.9, 1.0], 2.2 * near(head, 70) * Math.exp(-(t - M.crack) / 1.5));
    }
    // the creature takes the light away as it passes
    const C = this.score.creature;
    const dim = sm(C.t0 + 4, M.under, t) * (1 - sm(M.under, M.stop, t));
    c = c.map((v) => v * (1 - 0.85 * dim));
    add([0.02, 0.12, 0.3], 0.6 * pulse(t, M.under, 1.5, 2.5));
    // calls
    for (const e of this.calls) {
      if (t < e.t || t > e.t + 12) continue;
      const k = e.kind === 'long' ? pulse(t, e.t, 1.5, 4) : pulse(t, e.t, 0.2, 1.2);
      add([0.25, 0.8, 1.0], (e.kind === 'long' ? 0.8 * (f.anchor === 'tv' ? 1 : 0.4) : 1.2 * near(e.az, 70)) * k);
    }
    // the reveal: slow bioluminescent colour, different in every light
    if (reveal > 0) {
      const ph = t * 0.18 + az * 0.02;
      const col = rgbMix([0.1, 0.9, 0.75], rgbMix([0.6, 0.3, 1.0], [1.0, 0.7, 0.3], 0.5 + 0.5 * Math.sin(ph * 1.7)), 0.5 + 0.5 * Math.sin(ph));
      add(col, 0.55 * reveal);
    }
    return rgbMul(c, 1 - sm(126.5, 128, t));
  }

  dispose() {
    super.dispose();
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog.prog);
    if (this.sprites) gl.deleteProgram(this.sprites.prog);
    if (this.buf) this.buf.dispose();
  }
}

void clamp;
