// A cat for the room: ray-marched from a signed distance field (spine, head, cheeks, muzzle, ears, legs, tail,
// all smoothly blended), posed from JS every frame. The rig blends a standing and a curled-up sleeping pose and
// layers on walking, kneading, breathing, the head looking about, ear twitches, blinks and a tail. Fur: tabby
// stripes, white chest and paws, wrapped diffuse light with a soft sheen, fuzzy edges, eyes that catch the light.
// Drawn into the room's HDR target with real depth, so the couch hides it where it should.
import { Program } from '../../gl/gl.js';
import { m4, v3 } from '../../gl/math.js';
import { StaticBuffer, LineBatch } from './gfx.js';
import { clamp, lerp, smoothstep } from './timeline.js';

const NB = 5; // spine spheres
const NT = 8; // tail points

const VS = `#version 300 es
layout(location = 0) in vec3 aP;
uniform mat4 uVP, uModel;
out vec3 vW;
void main() {
  vec4 w = uModel * vec4(aP, 1.0);
  vW = w.xyz;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vW;
out vec4 outColor;
uniform mat4 uVP, uInv, uModel;
uniform vec3 uEye;
uniform vec4 uBody[${NB}];
uniform vec4 uLeg[12];
uniform vec4 uTail[${NT}];
uniform vec4 uHead;           // centre, radius (cat space)
uniform mat3 uHeadRot;        // cat space -> head space
uniform vec4 uEar;            // left twitch, right twitch, -, -
uniform vec4 uEye2;           // open L, open R, shine, -
uniform vec3 uFur, uStripe, uWhite;
uniform int uLN;
uniform vec4 uLP[10];
uniform vec4 uLC[10];
uniform vec3 uLD[10];
uniform vec3 uAmbSky, uAmbGround;
uniform float uTime, uPx, uGain;

float ss(float e0, float e1, float x) { return e0 < e1 ? smoothstep(e0, e1, x) : 1.0 - smoothstep(e1, e0, x); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float rcone(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float ear(vec3 hp, float side, float tw) {
  vec3 b = vec3(0.027 * side, 0.034, -0.006);
  vec3 tip = vec3(0.041 * side + tw * 0.018 * side, 0.083 - tw * 0.012, 0.004 - tw * 0.02);
  vec3 q = hp - b;
  q.z *= 2.3;                       // thin flaps
  return rcone(q + b, b, tip, 0.019, 0.0025);
}

float headSDF(vec3 p, out float part) {
  vec3 hp = uHeadRot * (p - uHead.xyz);
  float r = uHead.w;
  float d = length(hp * vec3(1.0, 1.07, 0.97)) - r;
  d = smin(d, length((hp - vec3(0.026, -0.017, 0.022))) - 0.03, 0.022);
  d = smin(d, length((hp - vec3(-0.026, -0.017, 0.022))) - 0.03, 0.022);
  d = smin(d, length((hp - vec3(0.0, -0.023, 0.047)) / vec3(0.025, 0.017, 0.021)) * 0.017 - 0.017, 0.012);
  d = smin(d, length(hp - vec3(0.0, -0.036, 0.034)) - 0.011, 0.01);
  float e = min(ear(hp, 1.0, uEar.x), ear(hp, -1.0, uEar.y));
  part = e < d ? 2.0 : 1.0;
  return smin(d, e, 0.006);
}

float map(vec3 p, out float part) {
  float d = 1e3;
  for (int i = 0; i < ${NB - 1}; i++) d = smin(d, rcone(p, uBody[i].xyz, uBody[i + 1].xyz, uBody[i].w, uBody[i + 1].w), 0.035);
  part = 0.0;
  float hp;
  float h = headSDF(p, hp);
  float leg = 1e3;
  for (int i = 0; i < 4; i++) {
    leg = smin(leg, rcone(p, uLeg[i * 3].xyz, uLeg[i * 3 + 1].xyz, uLeg[i * 3].w, uLeg[i * 3 + 1].w), 0.015);
    leg = smin(leg, rcone(p, uLeg[i * 3 + 1].xyz, uLeg[i * 3 + 2].xyz, uLeg[i * 3 + 1].w, uLeg[i * 3 + 2].w), 0.012);
  }
  float tail = 1e3;
  for (int i = 0; i < ${NT - 1}; i++) tail = smin(tail, rcone(p, uTail[i].xyz, uTail[i + 1].xyz, uTail[i].w, uTail[i + 1].w), 0.01);
  float body = d;
  d = smin(d, leg, 0.028);
  d = smin(d, tail, 0.018);
  float all = smin(d, h, 0.04);
  part = h < body && h < leg && h < tail ? hp : leg < body && leg < tail ? 3.0 : tail < body ? 4.0 : 0.0;
  return all;
}

float mapD(vec3 p) { float x; return map(p, x); }

vec3 nrm(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0012;
  return normalize(k.xyy * mapD(p + k.xyy * e) + k.yyx * mapD(p + k.yyx * e) + k.yxy * mapD(p + k.yxy * e) + k.xxx * mapD(p + k.xxx * e));
}

void main() {
  vec3 roW = uEye;
  vec3 rdW = normalize(vW - uEye);
  vec3 ro = (uInv * vec4(roW, 1.0)).xyz;
  vec3 rd = normalize((uInv * vec4(rdW, 0.0)).xyz);
  float t = max(0.0, dot(vW - uEye, rdW) - 0.002);
  float tEnd = t + 1.6;
  float best = 1e3, bestT = t;
  bool hit = false;
  float part = 0.0;
  for (int i = 0; i < 90; i++) {
    vec3 p = ro + rd * t;
    float d = map(p, part);
    float px = uPx * t;
    float cov = d / max(px, 1e-5);
    if (cov < best) { best = cov; bestT = t; }
    if (d < px * 0.35) { hit = true; break; }
    t += max(d * 0.9, px * 0.3);
    if (t > tEnd) break;
  }
  // coverage: solid where we hit, a soft fringe where the ray only grazed the fur
  float alpha = hit ? 1.0 : clamp(1.0 - (best - 0.4) / 1.6, 0.0, 1.0);
  if (alpha < 0.01) discard;
  float tt = hit ? t : bestT;
  vec3 p = ro + rd * tt;
  vec3 N = nrm(p);
  float mp;
  map(p, mp);
  // fur: fine direction noise in the normal, a little colour variation
  vec3 fn = vec3(n3(p * 900.0), n3(p * 900.0 + 7.1), n3(p * 900.0 + 3.3)) - 0.5;
  vec3 Nf = normalize(N + fn * 0.35);
  // markings
  vec3 hp = uHeadRot * (p - uHead.xyz);
  float under = ss(0.02, -0.03, p.y - (uBody[2].y - 0.035));
  float stripes = ss(0.25, 0.75, sin((p.z * 0.75 + p.x * 0.66) * 52.0 + n3(p * 34.0) * 5.5)) * (1.0 - under);
  vec3 col = mix(uFur, uStripe, stripes * 0.85);
  col = mix(col, uWhite, under * 0.9);
  if (mp == 3.0) col = mix(col, uWhite, ss(0.06, 0.02, p.y));            // white socks
  if (mp == 4.0) col = mix(uFur, uStripe, ss(-0.2, 0.6, sin(dot(p, vec3(0.6, 0.5, 0.6)) * 95.0))); // ringed tail
  if (mp == 1.0 || mp == 2.0) {
    float muzzle = ss(0.0, -0.022, hp.y) * ss(0.0, 0.03, hp.z);
    col = mix(uFur, uStripe, ss(0.3, 0.8, sin(hp.x * 140.0) * 0.5 + 0.5) * ss(0.02, 0.05, hp.y) * 0.7);
    col = mix(col, uWhite, muzzle * 0.95);
    col = mix(col, vec3(0.75, 0.42, 0.42), ss(0.011, 0.004, length(hp - vec3(0.0, -0.006, 0.061)))); // nose
    if (mp == 2.0) col = mix(col, vec3(0.6, 0.38, 0.38), ss(0.0, -0.004, hp.z + 0.002) * 0.7);  // inside the ears
  }
  col *= 0.88 + 0.24 * n3(p * 300.0);
  // eyes: almonds that open and close, with a slit pupil and the shine of a cat's eye
  vec3 emis = vec3(0.0);
  for (int s = 0; s < 2; s++) {
    float side = s == 0 ? 1.0 : -1.0;
    float open = s == 0 ? uEye2.x : uEye2.y;
    vec3 ec = vec3(0.022 * side, 0.009, 0.047);
    vec2 q = (hp.xy - ec.xy) / vec2(0.0125, 0.0095 * max(open, 0.04));
    float inEye = ss(1.05, 0.9, length(q)) * step(0.0, hp.z - 0.03);
    float lid = ss(1.25, 1.0, length((hp.xy - ec.xy) / vec2(0.0135, 0.0105))) * step(0.0, hp.z - 0.03);
    vec3 iris = mix(vec3(0.55, 0.62, 0.12), vec3(0.85, 0.72, 0.2), ss(0.0, 1.0, length(q)));
    float pupil = ss(0.32, 0.18, abs(q.x)) ;
    vec3 eye = mix(iris, vec3(0.005), pupil);
    col = mix(col, uStripe * 0.25, lid * (1.0 - inEye) * 0.8);
    col = mix(col, eye, inEye * step(0.05, open));
    emis += vec3(0.35, 0.85, 0.35) * inEye * step(0.05, open) * uEye2.z * (0.4 + 0.6 * (1.0 - pupil));
  }
  // lighting: the room's own lights, wrapped (fur scatters), with a sheen at grazing angles
  vec3 pW = (uModel * vec4(p, 1.0)).xyz;
  vec3 NW = normalize(mat3(uModel) * Nf);
  vec3 V = -rdW;
  float ao = 0.0;
  {
    float sc = 1.0;
    for (int k = 1; k <= 4; k++) { float hh = 0.012 * float(k); ao += (hh - mapD(p + N * hh)) * sc; sc *= 0.6; }
    ao = clamp(1.0 - ao * 9.0, 0.25, 1.0);
  }
  vec3 c = col * mix(uAmbGround, uAmbSky, NW.y * 0.5 + 0.5) * ao * 1.6;
  for (int i = 0; i < 10; i++) {
    if (i >= uLN) break;
    vec3 L = uLP[i].xyz - pW;
    float d = length(L);
    L /= max(d, 1e-4);
    float x = clamp(1.0 - pow(d / uLP[i].w, 4.0), 0.0, 1.0);
    float att = x * x / (d * d + 0.3);
    if (uLC[i].a > -1.5) att *= ss(uLC[i].a, uLC[i].a + 0.25, dot(-L, uLD[i]));
    float wrap = max(0.0, (dot(NW, L) + 0.45) / 1.45);
    float sheen = pow(1.0 - max(dot(NW, V), 0.0), 3.0) * 0.45;
    c += uLC[i].rgb * att * (col * wrap * ao + sheen * col * 0.8 + vec3(0.02) * pow(max(dot(NW, normalize(L + V)), 0.0), 18.0));
  }
  c += emis;
  vec4 clip = uVP * vec4(pW, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
  outColor = vec4(c * alpha * uGain, alpha * uGain);
}`;

// a soft contact shadow under the cat (multiplied into the cushion)
const SH_VS = `#version 300 es
layout(location = 0) in vec3 aP;
uniform mat4 uVP, uModel;
out vec2 vQ;
void main() { vQ = aP.xz; gl_Position = uVP * (uModel * vec4(aP, 1.0)); }`;
const SH_FS = `#version 300 es
precision highp float;
in vec2 vQ;
out vec4 outColor;
uniform float uK;
void main() { float a = (1.0 - smoothstep(0.15, 1.0, length(vQ))) * uK; outColor = vec4(vec3(1.0 - a), 1.0); }`;

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * The rig. State (all optional, smoothly animated by the caller):
 *   pos [x,y,z] world (ground point), yaw (radians, 0 faces -z), lie 0..1 (standing -> curled up asleep),
 *   loaf 0..1 (lying with the head up instead of tucked), walk 0..1 + walkPh (cycles), knead 0..1 + kneadPh,
 *   headYaw, headPitch, headTilt, tailUp 0..1, tailSwish, earL/earR 0..1, eyeL/eyeR 0..1 open, shine 0..1,
 *   breath -1..1, stretch 0..1 (mid-jump), crouch 0..1 (about to jump)
 */
export function catPose(s) {
  const lie = clamp(s.lie || 0, 0, 1);
  const loaf = clamp(s.loaf || 0, 0, 1);
  const br = s.breath || 0;
  const crouch = s.crouch || 0, stretch = s.stretch || 0;
  // standing spine
  const stand = [[0, 0.185, -0.15, 0.072], [0, 0.2, -0.06, 0.085], [0, 0.205, 0.035, 0.086], [0, 0.195, 0.115, 0.074], [0, 0.235, 0.16, 0.05]];
  // curled, asleep: the spine on an arc around the middle of the cushion
  const R = 0.115;
  const arc = (a, y, r) => [Math.sin((a * Math.PI) / 180) * R, y, Math.cos((a * Math.PI) / 180) * R, r];
  const curled = [arc(-150, 0.075, 0.072), arc(-95, 0.087, 0.086), arc(-35, 0.09, 0.086), arc(20, 0.082, 0.074), arc(62, 0.07, 0.05)];
  // loaf: lying straight with the legs tucked, head up
  const loafP = [[0, 0.085, -0.14, 0.074], [0, 0.1, -0.055, 0.088], [0, 0.105, 0.035, 0.088], [0, 0.098, 0.11, 0.076], [0, 0.135, 0.155, 0.052]];
  const lying = curled.map((c, i) => lerp3(c, loafP[i], loaf).concat(lerp(c[3], loafP[i][3], loaf)));
  const body = stand.map((p, i) => {
    let q = lerp3(p, lying[i], lie);
    let r = lerp(p[3], lying[i][3], lie);
    if (i === 1 || i === 2) r *= 1 + 0.045 * br;
    if (crouch) q = add3(q, [0, -0.06 * crouch * (i < 2 ? 1.3 : 0.7), -0.02 * crouch]);
    if (stretch) q = [q[0], q[1] + 0.01 * stretch, q[2] * (1 + 0.18 * stretch)];
    return [...q, r];
  });
  // head: forward and up when standing; tucked against the hips when curled; up when loafing
  const headStand = [0, 0.29, 0.215];
  const headCurl = [Math.sin((108 * Math.PI) / 180) * R * 0.95, 0.062, Math.cos((108 * Math.PI) / 180) * R * 0.95];
  const headLoaf = [0, 0.2, 0.2];
  let head = lerp3(headStand, lerp3(headCurl, headLoaf, loaf), lie);
  if (crouch) head = add3(head, [0, -0.07 * crouch, 0.01]);
  if (stretch) head = add3(head, [0, 0.01, 0.05 * stretch]);
  if (s.knead) head = add3(head, [0, -0.02 * s.knead, -0.01 * s.knead]);
  // head orientation: base facing (curled: the face turned towards the tail and down), plus look-about
  const baseYaw = lerp(0, lerp(2.05, 0, loaf), lie);
  const basePitch = lerp(0, lerp(0.35, 0, loaf), lie);
  const yaw = baseYaw + (s.headYaw || 0);
  const pitch = basePitch + (s.headPitch || 0);
  const tilt = (s.headTilt || 0) + lerp(0, lerp(0.6, 0, loaf), lie);
  // legs (side +1 / -1): standing positions, tucked positions
  const legs = [];
  const walk = s.walk || 0, wph = (s.walkPh || 0) * Math.PI * 2;
  const knead = s.knead || 0, kph = (s.kneadPh || 0) * Math.PI * 2;
  for (const [front, side] of [[1, 1], [1, -1], [0, 1], [0, -1]]) {
    let a, b, c;
    if (front) {
      a = [side * 0.042, 0.17, 0.115, 0.03];
      b = [side * 0.045, 0.095, 0.12, 0.02];
      c = [side * 0.043, 0.016, 0.135, 0.018];
    } else {
      a = [side * 0.048, 0.165, -0.14, 0.04];
      b = [side * 0.05, 0.075, -0.2, 0.021];
      c = [side * 0.047, 0.016, -0.16, 0.019];
    }
    // tucked under the body when lying
    const ti = front ? 3 : 0;
    const anchor = lying[ti];
    const tuck = (q, dy, f) => [anchor[0] * 0.85 + side * 0.03 * (1 - loaf * 0.2) + (front ? lerp(0.02, 0, loaf) : 0), Math.max(0.02, anchor[1] - dy), anchor[2] + f];
    const la = tuck(a, 0.0, 0), lb = tuck(b, 0.035, front ? 0.03 : 0.0), lc = tuck(c, 0.06, front ? lerp(0.05, 0.07, loaf) : 0.03);
    a = [...lerp3(a, la, lie), a[3]];
    b = [...lerp3(b, lb, lie), lerp(b[3], 0.022, lie)];
    c = [...lerp3(c, lc, lie), c[3]];
    if (crouch) {
      a = [a[0], a[1] - 0.06 * crouch, a[2], a[3]];
      b = [b[0], b[1] - 0.04 * crouch, b[2] + (front ? 0 : 0.03 * crouch), b[3]];
    }
    if (stretch) {
      const dir = front ? 1 : -1;
      b = [b[0], b[1] + 0.03 * stretch, b[2] + dir * 0.06 * stretch, b[3]];
      c = [c[0], c[1] + 0.06 * stretch, c[2] + dir * 0.14 * stretch, c[3]];
    }
    // gait: diagonal pairs
    if (walk) {
      const ph = wph + (front ? 0 : Math.PI) + (side > 0 ? 0 : Math.PI);
      const lift = Math.max(0, Math.sin(ph)) * 0.035 * walk;
      const swing = Math.cos(ph) * 0.035 * walk;
      c = [c[0], c[1] + lift, c[2] + swing, c[3]];
      b = [b[0], b[1] + lift * 0.6, b[2] + swing * 0.5, b[3]];
    }
    // kneading: front paws press in turn
    if (knead && front) {
      const ph = kph + (side > 0 ? 0 : Math.PI);
      const lift = Math.max(0, Math.sin(ph)) * 0.028 * knead;
      c = [c[0], c[1] + lift, c[2] + 0.012 * Math.cos(ph) * knead, c[3]];
      b = [b[0], b[1] + lift * 0.7, b[2] + 0.02 * knead, b[3]];
    }
    legs.push(a, b, c);
  }
  // tail: up like a question mark when standing; wrapped around the body when curled
  const tail = [];
  const up = clamp(s.tailUp ?? 0.7, 0, 1);
  const sw = (s.tailSwish || 0);
  for (let i = 0; i < NT; i++) {
    const x = i / (NT - 1);
    const r = lerp(0.022, 0.014, x);
    // standing: rises and hooks over at the tip, or trails low
    const st = [Math.sin(x * 2.2 + (s.t || 0) * 1.3) * 0.02 * x + sw * x * x * 0.08, lerp(0.2, lerp(0.16, 0.5, up), x) + up * Math.sin(x * Math.PI) * 0.04 - (x > 0.8 ? up * (x - 0.8) * 0.25 : 0),
      -0.205 - x * lerp(0.26, 0.08, up) + (x > 0.75 ? up * (x - 0.75) * 0.25 : 0)];
    const a = -168 - x * 120;
    const rr = 0.165 + 0.012 * x;
    const cu = [Math.sin((a * Math.PI) / 180) * rr, 0.045 + 0.015 * Math.sin(x * Math.PI), Math.cos((a * Math.PI) / 180) * rr];
    const lo = [0.05 + x * 0.12, 0.04, -0.2 + x * 0.24];
    const q = lerp3(st, lerp3(cu, lo, loaf), lie);
    tail.push([...q, r]);
  }
  return { body, head: [...head, 0.056], yaw, pitch, tilt, legs, tail, ear: [s.earL || 0, s.earR || 0], eyes: [s.eyeL ?? 1, s.eyeR ?? 1, s.shine || 0] };
}

export class CatRenderer {
  constructor(gl, { fur = [0.42, 0.33, 0.24], stripe = [0.11, 0.08, 0.06], white = [0.82, 0.8, 0.76] } = {}) {
    this.gl = gl;
    this.prog = new Program(gl, VS, FS, 'cat');
    this.shProg = new Program(gl, SH_VS, SH_FS, 'cat-shadow');
    const s = 0.36, y0 = -0.01, y1 = 0.62;
    const P = [];
    const quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
    const X0 = -s, X1 = s, Z0 = -0.5, Z1 = 0.42;
    quad([X0, y0, Z1], [X1, y0, Z1], [X1, y1, Z1], [X0, y1, Z1]);
    quad([X1, y0, Z0], [X0, y0, Z0], [X0, y1, Z0], [X1, y1, Z0]);
    quad([X1, y0, Z1], [X1, y0, Z0], [X1, y1, Z0], [X1, y1, Z1]);
    quad([X0, y0, Z0], [X0, y0, Z1], [X0, y1, Z1], [X0, y1, Z0]);
    quad([X0, y1, Z1], [X1, y1, Z1], [X1, y1, Z0], [X0, y1, Z0]);
    quad([X0, y0, Z0], [X1, y0, Z0], [X1, y0, Z1], [X0, y0, Z1]);
    this.box = new StaticBuffer(gl, [[0, 3]], new Float32Array(P));
    this.shadow = new StaticBuffer(gl, [[0, 3]], new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]));
    this.lines = new LineBatch(gl, 4000);
    this.fur = fur;
    this.stripe = stripe;
    this.white = white;
    this.u = { body: new Float32Array(NB * 4), legs: new Float32Array(48), tail: new Float32Array(NT * 4), LP: new Float32Array(40), LC: new Float32Array(40), LD: new Float32Array(30) };
  }

  /** World transform of the cat (ground point + yaw, 0 = facing -z like the room's "front"). */
  model(state) {
    return m4.compose(state.pos, Math.PI - (state.yaw || 0)); // cat space faces +z
  }

  /** World position of a point in cat space. */
  toWorld(state, p) {
    return m4.transformPoint ? m4.transformPoint(this.model(state), p) : null;
  }

  /** Head centre and facing in world space (for whiskers, tach markings, clicks). */
  headWorld(state, pose) {
    const M = this.model(state);
    const h = pose.head;
    const w = [M[0] * h[0] + M[4] * h[1] + M[8] * h[2] + M[12], M[1] * h[0] + M[5] * h[1] + M[9] * h[2] + M[13], M[2] * h[0] + M[6] * h[1] + M[10] * h[2] + M[14]];
    return w;
  }

  _headRot(pose) {
    // head space from cat space: undo yaw, pitch, tilt (R = Rz(tilt) * Rx(pitch) * Ry(yaw); we want R^-1)
    const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw), cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch), ct = Math.cos(pose.tilt), st = Math.sin(pose.tilt);
    const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
    const Rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
    const Rz = [ct, st, 0, -st, ct, 0, 0, 0, 1];
    const mul = (a, b) => {
      const o = new Array(9).fill(0);
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
      return o;
    };
    const R = mul(Rz, mul(Rx, Ry)); // head -> cat (column-major)
    // inverse of a rotation = transpose
    return new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
  }

  /** Points of the head (head space) in world space. */
  headPoint(state, pose, hp) {
    const inv = this._headRot(pose); // cat -> head; its transpose is head -> cat
    const c = [inv[0] * hp[0] + inv[1] * hp[1] + inv[2] * hp[2], inv[3] * hp[0] + inv[4] * hp[1] + inv[5] * hp[2], inv[6] * hp[0] + inv[7] * hp[1] + inv[8] * hp[2]];
    const p = [pose.head[0] + c[0], pose.head[1] + c[1], pose.head[2] + c[2]];
    const M = this.model(state);
    return [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
  }

  /**
   * Draw into the room's target. ctx: the room layer context. lights: [{ pos, col, dir, cos, range }].
   * opts: gain (fade), shadowY (surface height under the cat, or null), whiskers (0..1 visibility), amb [sky, ground]
   */
  draw(ctx, state, lights, opts = {}) {
    const gl = this.gl;
    const pose = catPose(state);
    const M = this.model(state);
    const inv = m4.invert(M);
    const u = this.u;
    pose.body.forEach((b, i) => u.body.set(b, i * 4));
    pose.legs.forEach((b, i) => u.legs.set(b, i * 4));
    pose.tail.forEach((b, i) => u.tail.set(b, i * 4));
    const L = lights.slice(0, 10);
    u.LP.fill(0);
    u.LC.fill(0);
    u.LD.fill(0);
    L.forEach((l, i) => {
      u.LP.set([...l.pos, l.range], i * 4);
      const hasDir = l.dir && (l.dir[0] || l.dir[1] || l.dir[2]);
      u.LC.set([...l.col, hasDir && l.cos > -1.5 ? l.cos : -2], i * 4);
      if (hasDir) u.LD.set(v3.norm(l.dir), i * 3);
    });
    const gain = opts.gain ?? 1;
    if (gain <= 0.001) return pose;
    // contact shadow
    if (opts.shadowY !== null && opts.shadowY !== undefined) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -6);
      const sz = lerp(0.2, 0.24, clamp(state.lie || 0, 0, 1));
      const sm = m4.multiply(m4.compose([state.pos[0], opts.shadowY + 0.002, state.pos[2]], Math.PI - (state.yaw || 0)), m4.compose([0, 0, -0.01], 0, [sz, 1, sz * 1.25]));
      this.shProg.use().setAll({ uVP: ctx.vp, uModel: sm, uK: 0.55 * gain * clamp(1 - Math.abs(state.pos[1] - opts.shadowY) * 6, 0, 1) });
      this.shadow.draw(gl.TRIANGLES);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
    }
    // the cat
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    const amb = opts.amb || [[0.03, 0.032, 0.04], [0.012, 0.01, 0.01]];
    this.prog.use().setAll({
      uVP: ctx.vp, uModel: M, uInv: inv, uEye: ctx.eye, uBody: u.body, uLeg: u.legs, uTail: u.tail,
      uHead: pose.head, uHeadRot: this._headRot(pose), uEar: [pose.ear[0], pose.ear[1], 0, 0], uEye2: [pose.eyes[0], pose.eyes[1], pose.eyes[2], 0],
      uFur: this.fur, uStripe: this.stripe, uWhite: this.white, uLN: L.length, uLP: u.LP, uLC: u.LC, uLD: u.LD,
      uAmbSky: amb[0], uAmbGround: amb[1], uTime: ctx.time, uPx: (2 * Math.tan((opts.fov || 0.75) / 2)) / ctx.h, uGain: gain,
    });
    // the box is drawn front faces only; flip the winding check for a mirrored model
    gl.frontFace(gl.CCW);
    this.box.draw(gl.TRIANGLES);
    gl.disable(gl.CULL_FACE);
    // whiskers
    const wk = opts.whiskers ?? 1;
    if (wk > 0.01 && !opts.noWhiskers) {
      const lb = this.lines;
      lb.begin();
      for (const side of [1, -1]) {
        for (let k = 0; k < 3; k++) {
          const root = [side * 0.016, -0.019 + k * 0.004, 0.052];
          const pts = [];
          for (let j = 0; j <= 6; j++) {
            const x = j / 6;
            const len = 0.075 - k * 0.008;
            pts.push(this.headPoint(state, pose, [root[0] + side * x * len, root[1] + (k - 1) * 0.008 * x - 0.012 * x * x, root[2] - x * 0.012 + (k - 1) * 0.005 * x]));
          }
          lb.add(pts, [0.5, 0.5, 0.47].map((c) => c * wk * gain), 0.0006, 0);
        }
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      lb.draw({ vp: ctx.vp, eye: ctx.eye, fov: opts.fov || 0.75, h: ctx.h });
      gl.depthMask(true);
    }
    gl.disable(gl.BLEND);
    return pose;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.prog.prog);
    gl.deleteProgram(this.shProg.prog);
    this.box.dispose();
    this.shadow.dispose();
  }
}
