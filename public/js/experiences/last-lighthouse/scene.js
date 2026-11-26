// The Last Lighthouse: the picture. A ray-marched night sea under a huge sky. The lamp flashes with every note
// of its phrase and its beam sweeps the room's lights; answering lights appear on the horizon and pulse with
// their voices; from above they form a constellation drawn on the water; then the horizon lifts.
import { Program, FULLSCREEN_VS, drawFullscreen } from '../../gl/gl.js';
import { v3 } from '../../gl/math.js';
import { Rng, Curve, smoothstep, lastBefore, pulse } from '../core/timeline.js';
import { Spline, rgbMul, rgbMix } from '../core/gfx.js';
import { StageScene } from '../core/stage.js';

const sm = smoothstep;
const NL = 48; // lights on the sea
const NS = 24; // constellation lines

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform float uTime, uSea, uBeamAng, uBeamI, uLamp, uLines, uRise, uRiseT, uStarsI, uChoir;
uniform vec4 uL[${NL}];       // xyz position, intensity
uniform vec3 uLC[${NL}];      // colour
uniform vec4 uSeg[${NS}];     // x0, z0, x1, z1 (on the sea)
uniform float uSegA[${NS}];

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return v; }

const vec3 LAMP = vec3(0.0, 23.5, -180.0);

float waves(vec2 p, float detail) {
  float t = uTime;
  float h = 0.0;
  h += 0.42 * sin(dot(p, vec2(0.031, 0.022)) - t * 0.55);
  h += 0.25 * sin(dot(p, vec2(-0.018, 0.041)) - t * 0.72 + 1.3);
  h += 0.12 * sin(dot(p, vec2(0.07, -0.05)) - t * 1.1 + 2.1);
  h += detail * (0.08 * sin(dot(p, vec2(0.17, 0.11)) - t * 1.7) + 0.05 * sin(dot(p, vec2(-0.13, 0.21)) - t * 2.1 + 0.7));
  return h * uSea;
}

// the lighthouse and its rock (tiny SDF)
float sdCyl(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float tower(vec3 p) {
  p -= vec3(0.0, 0.0, -180.0);
  float rock = length(p * vec3(1.0, 2.2, 1.0) + vec3(0.0, 1.5, 0.0)) - 9.0 + 1.5 * vn(p.xz * 0.3);
  float r = mix(2.3, 1.55, clamp(p.y / 22.0, 0.0, 1.0));
  float body = sdCyl(p - vec3(0.0, 11.0, 0.0), r, 11.0);
  float gallery = sdCyl(p - vec3(0.0, 22.2, 0.0), 2.2, 0.25);
  float lamp = sdCyl(p - vec3(0.0, 23.5, 0.0), 1.35, 1.2);
  float roof = sdCyl(p - vec3(0.0, 25.0, 0.0), 1.5 - (p.y - 24.7) * 1.4, 0.45);
  return min(min(rock, body), min(min(gallery, lamp), roof));
}

// the structures that rise out of the sea
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xy) - t.x, p.z); return length(q) - t.y; }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float structures(vec3 p, out float seam) {
  float rise = uRise;
  float d = 1e9;
  seam = 0.0;
  // a vast ring, arches, monoliths
  vec3 q = p - vec3(-60.0, -260.0 + 250.0 * smoothstep(0.0, 0.8, rise), -1300.0);
  float ring = sdTorus(q, vec2(220.0, 16.0));
  d = min(d, ring);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = -700.0 + fi * 470.0;
    float z = -900.0 - abs(fi - 1.5) * 220.0;
    float hgt = 140.0 + 60.0 * fract(fi * 0.37);
    float lift = smoothstep(fi * 0.12, 0.6 + fi * 0.12, rise);
    vec3 m = p - vec3(x, -hgt * 1.1 + hgt * 1.1 * lift, z);
    float mono = sdBox(m - vec3(0.0, hgt * 0.5, 0.0), vec3(18.0 + fi * 3.0, hgt * 0.5, 14.0));
    d = min(d, mono);
  }
  vec3 a = p - vec3(420.0, -200.0 + 200.0 * smoothstep(0.15, 0.85, rise), -1100.0);
  float arch = max(sdTorus(a, vec2(150.0, 12.0)), -a.y);
  d = min(d, arch);
  // glowing seams: horizontal bands that light up from the waterline as they rise
  seam = smoothstep(0.92, 1.0, abs(fract(p.y * 0.02 + 0.5) - 0.5) * 2.0) * smoothstep(-5.0, 40.0, p.y);
  return d;
}

vec3 skyCol(vec3 d, float starMul) {
  float h = d.y;
  vec3 col = mix(vec3(0.0025, 0.0035, 0.008), vec3(0.0006, 0.0008, 0.0025), smoothstep(0.0, 0.6, h));
  col += vec3(0.008, 0.01, 0.018) * exp(-max(h, 0.0) * 14.0);
  vec2 sp = vec2(atan(d.x, -d.z), asin(clamp(h, -1.0, 1.0)));
  float bx = (h - 0.35 * sin(sp.x * 0.8 + 0.6) - 0.25) * 3.0;
  float band = exp(-bx * bx);
  col += vec3(0.018, 0.02, 0.032) * band * smoothstep(0.3, 0.9, fbm(sp * 6.0)) * uStarsI * starMul;
  // stars at several scales
  for (int k = 0; k < 3; k++) {
    float sc = 90.0 + float(k) * 110.0;
    vec2 c = floor(sp * sc);
    float s = h12(c + float(k) * 17.0);
    vec2 o = vec2(h12(c + 3.1), h12(c + 7.7)) - 0.5;
    float star = step(0.972 - float(k) * 0.008, s) * smoothstep(0.14, 0.0, length(fract(sp * sc) - 0.5 - o * 0.6));
    col += vec3(0.75, 0.82, 1.0) * star * (s - 0.96) * 30.0 * uStarsI * starMul * smoothstep(-0.01, 0.06, h) * (0.75 + 0.25 * sin(uTime * (1.0 + s * 5.0) + s * 60.0));
  }
  return col;
}

// glow of every light seen in a direction (vertical stretch > 1 gives the long reflections on water)
vec3 lightsIn(vec3 ro, vec3 d, float stretch, float sharp) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${NL}; i++) {
    vec4 L = uL[i];
    if (L.w <= 0.001) continue;
    vec3 to = L.xyz - ro;
    float dist = length(to);
    to /= dist;
    float dAz = atan(d.x, -d.z) - atan(to.x, -to.z);
    dAz = mod(dAz + 3.14159, 6.28318) - 3.14159;
    float dEl = (d.y - to.y) / stretch;
    float a2 = dAz * dAz + dEl * dEl;
    float size = max(0.4 / dist, 0.0011);
    col += uLC[i] * L.w * (exp(-a2 / (size * size * sharp)) * 2.5 + exp(-a2 / (size * size * 60.0)) * 0.18);
  }
  return col;
}

void main() {
  vec4 pw = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(pw.xyz / pw.w - uCam);
  vec3 ro = uCam;
  vec3 col;
  // ---- the sea (heightfield march)
  float tSea = -1.0;
  if (rd.y < 0.0) {
    float t = 0.0;
    float hi = ro.y - 1.0;
    t = hi > 0.0 ? hi / -rd.y : 0.0;
    for (int i = 0; i < 64; i++) {
      vec3 p = ro + rd * t;
      float det = 1.0 / (1.0 + t * 0.01);
      float hh = p.y - waves(p.xz, det);
      if (hh < 0.02 * (1.0 + t * 0.02)) { tSea = t; break; }
      t += max(hh * 0.7, 0.05 + t * 0.004);
      if (t > 6000.0) break;
    }
    if (tSea < 0.0) tSea = (ro.y) / max(-rd.y, 1e-4);
  }
  // ---- the structures (only near the horizon, only while they exist)
  float tS = 1e9, seam = 0.0;
  if (uRise > 0.001 && rd.y > -0.12 && rd.z < 0.2) {
    float t = 400.0;
    for (int i = 0; i < 70; i++) {
      vec3 p = ro + rd * t;
      float sd;
      float d = structures(p, sd);
      if (d < 0.5 + t * 0.002) { tS = t; seam = sd; break; }
      t += d * 0.9;
      if (t > 3500.0) break;
    }
  }
  // the lighthouse
  float tT = 1e9;
  {
    vec3 c = vec3(0.0, 10.0, -180.0) - ro;
    float b = dot(c, rd);
    float q = dot(c, c) - b * b;
    if (b > 0.0 && q < 20.0 * 20.0) {
      float t = b - 25.0;
      for (int i = 0; i < 48; i++) {
        float d = tower(ro + rd * t);
        if (d < 0.01 * t * 0.02 + 0.01) { tT = t; break; }
        t += d;
        if (t > b + 30.0) break;
      }
    }
  }
  if (tT < 1e8 && (tSea < 0.0 || tT < tSea) && tT < tS) {
    vec3 p = ro + rd * tT;
    float h = p.y;
    vec3 base = mix(vec3(0.02, 0.02, 0.025), vec3(0.05, 0.048, 0.045), smoothstep(2.0, 4.0, h));
    float stripe = step(0.5, fract(h / 5.5)) * smoothstep(3.0, 4.0, h) * step(h, 22.0);
    col = base * (1.0 + stripe * 1.5) * (0.6 + uLamp * 0.8);
    col += vec3(1.0, 0.85, 0.55) * uLamp * 3.0 * smoothstep(22.3, 22.6, h) * step(h, 24.7);
  } else if (tS < 1e8 && (tSea < 0.0 || tS < tSea)) {
    vec3 p = ro + rd * tS;
    float fog = exp(-tS * 0.0006);
    vec3 stone = vec3(0.02, 0.022, 0.03) * (0.6 + 0.4 * fbm(p.xy * 0.02));
    float pour = smoothstep(60.0, 0.0, p.y) * fbm(vec2(p.x * 0.05, p.y * 0.02 + uRiseT * 1.6)) * (1.0 - smoothstep(0.7, 1.0, uRise));
    vec3 glow = mix(vec3(1.0, 0.7, 0.35), vec3(0.4, 0.75, 1.0), 0.5 + 0.5 * sin(p.x * 0.004 + uTime * 0.1));
    col = stone + glow * seam * (0.4 + 1.4 * uChoir) + vec3(0.6, 0.7, 0.8) * pour * 0.25;
    col = mix(skyCol(rd, 1.0), col, fog);
  } else if (tSea > 0.0) {
    vec3 p = ro + rd * tSea;
    float e = 0.4 + tSea * 0.01;
    float det = 1.0 / (1.0 + tSea * 0.01);
    vec3 n = normalize(vec3(waves(p.xz - vec2(e, 0.0), det) - waves(p.xz + vec2(e, 0.0), det), 2.0 * e,
      waves(p.xz - vec2(0.0, e), det) - waves(p.xz + vec2(0.0, e), det)));
    n = normalize(n + vec3(vn(p.xz * 0.8 + uTime * 0.3) - 0.5, 0.0, vn(p.xz * 0.8 + 9.0 - uTime * 0.25) - 0.5) * 0.08 * det);
    vec3 r = reflect(rd, n);
    r.y = abs(r.y);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    vec3 refl = skyCol(r, 0.15) + lightsIn(p, r, 7.0 + tSea * 0.004, 2.0);
    col = vec3(0.002, 0.004, 0.007) + refl * fres * 1.6;
    // the constellation drawn on the water
    if (uLines > 0.001) {
      float lines = 0.0;
      for (int i = 0; i < ${NS}; i++) {
        vec4 s = uSeg[i];
        if (uSegA[i] <= 0.001) continue;
        vec2 pa = p.xz - s.xy, ba = s.zw - s.xy;
        float u = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float dd = length(pa - ba * u);
        float w = 1.2 + tSea * 0.0015;
        lines += uSegA[i] * exp(-dd * dd / (w * w));
      }
      col += vec3(0.5, 0.7, 1.0) * lines * 0.9 * uLines;
    }
    float fog = exp(-tSea * 0.00045);
    col = mix(skyCol(vec3(rd.x, 0.0, rd.z), 0.0) * 0.8, col, fog);
  } else {
    col = skyCol(rd, 1.0);
  }
  // lights seen directly (halos), the beam
  col += lightsIn(ro, rd, 1.0, 1.0) * (tSea > 0.0 ? 0.6 : 1.0);
  {
    vec3 bd = vec3(sin(uBeamAng), -0.02, -cos(uBeamAng));
    vec3 w = ro - LAMP;
    float b = dot(rd, bd);
    float den = 1.0 - b * b;
    float s = (b * dot(w, rd) - dot(w, bd)) / max(den, 1e-4);
    vec3 pa = LAMP + bd * max(s, 0.0);
    vec3 pr = ro + rd * max(dot(pa - ro, rd), 0.0);
    float dist = length(pa - pr);
    float along = max(s, 0.0);
    float width = 1.2 + along * 0.07;
    float beam = exp(-dist * dist / (width * width)) * exp(-along * 0.0025) * step(0.0, s);
    vec3 lp = LAMP - ro;
    float la = length(cross(lp, rd)) / length(lp);
    // when the beam swings towards us the lamp blazes (a glare around the lamp, not a blob in the sky)
    float aim = pow(max(dot(normalize(ro - LAMP), bd), 0.0), 30.0);
    col += vec3(1.0, 0.88, 0.62) * beam * 0.08 * uBeamI;
    col += vec3(1.0, 0.85, 0.55) * (uLamp + aim * 2.5 * uBeamI) * (exp(-la * la * 40000.0) * 4.0 + exp(-la * la * 2500.0) * 0.12 * (1.0 + aim * 3.0));
  }
  outColor = vec4(col, 1.0);
}`;

export class Scene extends StageScene {
  constructor(app, score, run) {
    super(app, score, run);
    this.M = score.marks;
    const ev = score.events;
    this.signal = ev.filter((e) => e.inst === 'signal');
    this.answers = ev.filter((e) => e.inst === 'answer');
    this.choir = ev.filter((e) => e.inst === 'choir');
    this.bells = ev.filter((e) => e.inst === 'bell');
    this.voices = score.voices;
  }

  async init() {
    const gl = this.gl;
    this.prog = new Program(gl, FULLSCREEN_VS, FS, 'lighthouse');
    const rng = new Rng(31);
    const camZ = 40;
    const seaPos = (az, dist) => {
      const a = (az * Math.PI) / 180;
      return [Math.sin(a) * dist, 2.5, camZ - Math.cos(a) * dist];
    };
    // the voices' lights (visible ones are in front), then a constellation of smaller lights
    this.L = [];
    this.voices.forEach((v, i) => {
      const dist = 650 + i * 90;
      const col = [[0.9, 0.95, 1.0], [1.0, 0.75, 0.45], [0.6, 0.9, 1.0], [1.0, 0.85, 0.95], [1.0, 0.6, 0.4], [0.95, 0.95, 0.75], [0.7, 0.85, 1.0], [1.0, 0.8, 0.6]][i];
      this.L.push({ pos: seaPos(v.az, dist), col, voice: i, on: this.score.lightsOn[i] });
    });
    // constellation: clusters across the sea, switching on through the canon and the choir
    const shapes = [
      [[-40, 900], [-34, 1050], [-27, 960], [-21, 1120], [-14, 1000]], // a "W"
      [[8, 1300], [14, 1180], [20, 1250], [26, 1100], [24, 980], [16, 940]], // a hook
      [[-62, 1400], [-55, 1500], [-48, 1380], [-50, 1250]], // a kite
      [[38, 800], [44, 880], [50, 760], [57, 840], [64, 900]], // a chain
      [[-8, 1600], [-2, 1700], [4, 1650], [0, 1500]],
    ];
    this.segs = [];
    let k = 0;
    shapes.forEach((sh, si) => {
      const base = this.L.length;
      sh.forEach(([az, dist], j) => {
        this.L.push({ pos: seaPos(az, dist), col: rgbMix([0.85, 0.9, 1.0], [1.0, 0.85, 0.6], rng.next()), on: 62 + si * 1.3 + j * 0.45, star: true, ph: rng.next() * 6.28 });
        if (j > 0 && this.segs.length < NS) this.segs.push({ a: base + j - 1, b: base + j, on: 70 + k++ * 0.35 });
      });
    });
    while (this.L.length < NL - 1) {
      const az = rng.range(-70, 70), dist = rng.range(500, 2400);
      this.L.push({ pos: seaPos(az, dist), col: [0.9, 0.9, 1.0], on: 66 + rng.next() * 14, star: true, small: true, ph: rng.next() * 6.28 });
    }
    // the companion light at the end, close to the lighthouse
    this.L.push({ pos: [-34, 1.6, -150], col: [1.0, 0.8, 0.55], voice: 8, on: 121 });
    this.Lbuf = new Float32Array(NL * 4);
    this.LCbuf = new Float32Array(NL * 3);
    this.segBuf = new Float32Array(NS * 4);
    this.segA = new Float32Array(NS);
    this.segs.forEach((s, i) => {
      const a = this.L[s.a].pos, b = this.L[s.b].pos;
      this.segBuf.set([a[0], a[2], b[0], b[2]], i * 4);
    });
    const M = this.M;
    const K = (t, eye, tgt, fov, hold) => ({ t, v: [...eye, ...tgt, fov], hold });
    this.cam = new Spline([
      K(0, [0, 3.4, 44], [0, 14, -180], 0.62, true),
      K(30, [0, 3.6, 36], [0, 12, -180], 0.62),
      K(40, [-2, 3.8, 33], [-60, 8, -180], 0.68),
      K(46, [1, 4.2, 30], [40, 8, -180], 0.72),
      K(M.spread + 4, [0, 9, 60], [0, -20, -300], 0.8),
      K(M.lift - 2, [0, 70, 170], [0, -60, -500], 0.9),
      K(M.choir, [0, 45, 130], [0, 60, -1200], 0.9),
      K(M.after + 4, [0, 30, 110], [0, 80, -1300], 0.9),
      K(M.last - 2, [-10, 12, 40], [0, 18, -400], 0.75),
      K(M.last + 6, [-42, 4.2, -48], [-6, 14, -180], 0.68),
      K(132, [-46, 4.4, -40], [-8, 13, -180], 0.68, true),
    ]);
    this.c = {
      sea: new Curve([[0, 1], [M.lift, 1], [M.lift + 6, 1.5], [M.choir + 6, 1.3], [M.last, 0.9]]),
      rise: new Curve([[0, 0], [M.lift, 0], [M.lift + 20, 1, 'inOut']]),
      lines: new Curve([[0, 0], [69, 0], [76, 1], [M.lift + 12, 1], [M.choir + 4, 0.4], [M.last, 0]]),
      beam: new Curve([[0, 1], [M.spread, 1], [M.lift, 0.6], [M.after, 0.5], [M.last, 1]]),
      exposure: new Curve([[0, 1.7], [M.choir, 1.9], [M.after, 1.8], [131, 1.6], [132, 0.5]]),
    };
  }

  update(t, dt) {
    this.t = t;
    this.dt = dt;
  }

  _lamp(t) {
    // the lamp burns steadily and flares on every note of the signal
    let k = 0.55;
    for (let i = lastBefore(this.signal, t); i >= 0 && t - this.signal[i].t < 2.5; i--) {
      const e = this.signal[i];
      if (t < e.t + e.dur) k = Math.max(k, 1.6);
      else k = Math.max(k, 0.55 + 1.05 * Math.exp(-(t - e.t - e.dur) / 0.25));
    }
    return k;
  }

  _voiceLevel(v, t) {
    let k = 0;
    for (let i = lastBefore(this.answers, t); i >= 0 && t - this.answers[i].t < 3; i--) {
      const e = this.answers[i];
      if (e.voice !== v) continue;
      const x = t - e.t;
      k = Math.max(k, x < e.dur ? Math.min(1, x / 0.08) : Math.exp(-(x - e.dur) / 0.35));
    }
    return k;
  }

  _beamAng(t) {
    return t * 0.62 - 0.4;
  }

  draw(t, dt, target) {
    const gl = this.gl;
    const w = target.w, h = target.h;
    const k = this.cam.at(t);
    const cam = this.camera(k.slice(0, 3), k.slice(3, 6), k[6], w, h, { near: 0.1, far: 8000 });
    const M = this.M;
    const choirLvl = sm(M.choir, M.choir + 2, t) * (1 - sm(M.after + 8, M.last, t));
    this.L.forEach((L, i) => {
      let I = 0;
      if (t >= L.on) {
        const fadeIn = sm(L.on, L.on + 1.5, t);
        if (L.voice !== undefined) I = (0.35 + 1.6 * this._voiceLevel(L.voice, t)) * fadeIn;
        else I = (L.small ? 0.25 : 0.55) * fadeIn * (0.75 + 0.25 * Math.sin(t * 1.3 + (L.ph || 0)));
        I *= 1 + choirLvl * 0.6;
        if (L.voice === undefined && t > M.last) I *= 1 - sm(M.last, M.last + 5, t);
        if (L.voice !== undefined && L.voice < 8 && t > M.last) I *= 1 - sm(M.last, M.last + 5, t);
      }
      this.Lbuf.set([L.pos[0], L.pos[1], L.pos[2], I], i * 4);
      this.LCbuf.set(L.col, i * 3);
    });
    this.segs.forEach((s, i) => {
      this.segA[i] = sm(s.on, s.on + 1.2, t);
    });
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.prog.use().setAll({
      uInvVP: cam.invVP, uCam: cam.eye, uTime: t, uSea: this.c.sea.at(t), uBeamAng: this._beamAng(t), uBeamI: this.c.beam.at(t),
      uLamp: this._lamp(t), uLines: this.c.lines.at(t), uRise: this.c.rise.at(t), uRiseT: Math.max(0, t - M.lift), uStarsI: 1 + choirLvl * 0.5,
      uChoir: choirLvl, uL: this.Lbuf, uLC: this.LCbuf, uSeg: this.segBuf, uSegA: this.segA,
    });
    drawFullscreen(gl);
    return target;
  }

  postParams(t) {
    return {
      exposure: this.c.exposure.at(t), bloomStrength: 0.3, bloomRadius: 1.2, threshold: 0.35, vignette: 0.6, grain: 0.03, saturation: 1.05,
      letterbox: 0.12 * (1 - sm(4, 11, t)) + 0.06,
    };
  }

  // ---------------------------------------------------------------- Hue: the beam sweeps the room's lights
  light(f, t) {
    const M = this.M;
    const az = f.anchor === 'tv' ? 0 : f.az ?? 0;
    let c = [0.008, 0.012, 0.03];
    const add = (col, k) => {
      c = [c[0] + col[0] * k, c[1] + col[1] * k, c[2] + col[2] * k];
    };
    // the beam turns with the lighthouse; in the room it passes over each light in turn
    const beamAz = ((this._beamAng(t) * 180) / Math.PI) % 360;
    const d = Math.abs(((beamAz - az + 540) % 360) - 180);
    add([1.0, 0.85, 0.55], 0.9 * Math.exp(-(d * d) / 300) * this.c.beam.at(t));
    if (f.anchor === 'tv') add([1.0, 0.8, 0.5], (this._lamp(t) - 0.55) * 0.5);
    // answers light the fixture nearest their direction
    this.voices.forEach((v, i) => {
      const lvl = this._voiceLevel(i, t);
      if (lvl < 0.01) return;
      const dd = Math.abs(((v.az - az + 540) % 360) - 180);
      add(this.L[i].col, lvl * 0.8 * Math.max(0, 1 - dd / 75));
    });
    const lvl8 = this._voiceLevel(8, t);
    if (lvl8 > 0 && (f.anchor === 'fl' || f.anchor === 'sl')) add([1.0, 0.8, 0.55], lvl8 * 0.7);
    const choir = sm(M.choir, M.choir + 2, t) * (1 - sm(M.after + 8, M.last, t));
    add(rgbMix([0.25, 0.4, 0.9], [1.0, 0.75, 0.45], 0.5 + 0.5 * Math.sin(t * 0.3 + az * 0.02)), 0.5 * choir);
    add([0.1, 0.3, 0.6], 0.3 * this.c.rise.at(t) * (1 - choir));
    for (let i = lastBefore(this.bells, t); i >= 0 && t - this.bells[i].t < 1; i--) {
      const b = this.bells[i];
      const dd = Math.abs(((b.az - az + 540) % 360) - 180);
      add([1, 0.95, 0.85], pulse(t, b.t, 0.01, 0.3) * b.vel * 2 * Math.max(0, 1 - dd / 80));
    }
    return rgbMul(c, 1 - sm(131, 132, t));
  }

  dispose() {
    super.dispose();
    if (this.prog) this.gl.deleteProgram(this.prog.prog);
  }
}

void v3;
