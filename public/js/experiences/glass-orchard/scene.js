// The Glass Orchard: the picture. One tree of glass in a black landscape, grown note by note.
//   harp (front-left)  -> each pluck extends branches; the fresh glass glows where it grew
//   bowed (rear-right) -> translucent membranes open between branches, coloured by the harmony
//   bass               -> waves cross the black ground; the reflection ripples
//   percussion         -> glass fruit shatters and re-forms
//   high glints        -> luminous organisms along the branches
//   the droplet        -> a drop forms on a twig, shows the orchard upside down, and we pass through it
import { Program, Target, FULLSCREEN_VS, drawFullscreen } from '../../gl/gl.js';
import { v3 } from '../../gl/math.js';
import { Rng, Curve, smoothstep, clamp, lastBefore, pulse } from '../core/timeline.js';
import { DynBuffer, Spline, rgbMul, rgbMix } from '../core/gfx.js';
import { StageScene } from '../core/stage.js';
import { chordColor } from '../../viz/palette.js';

const SIDES = 7;
const sm = smoothstep;
const SWAY_GLSL = `
vec3 sway(vec3 p, float t, float amp) {
  float h = pow(max(p.y - 0.4, 0.0), 1.2) * amp;
  return vec3(sin(t * 0.61 + p.y * 1.3 + p.x * 0.7) * h, 0.0, cos(t * 0.53 + p.y * 1.1 + p.z * 0.8) * h) * 0.035;
}`;
function sway(p, t, amp) {
  const h = Math.pow(Math.max(p[1] - 0.4, 0), 1.2) * amp;
  return [p[0] + Math.sin(t * 0.61 + p[1] * 1.3 + p[0] * 0.7) * h * 0.035, p[1], p[2] + Math.cos(t * 0.53 + p[1] * 1.1 + p[2] * 0.8) * h * 0.035];
}

// ------------------------------------------------------------------------------------------ shaders
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvVP;
uniform vec3 uCam, uHorizon, uHigh;
uniform float uStars, uAurora, uTime;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec4 p = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - uCam);
  float az = atan(d.x, -d.z);
  float h = d.y;
  // low hills on the horizon, darker than the glow behind them
  float hill = 0.018 + 0.035 * vn(vec2(az * 2.2, 1.0)) + 0.02 * vn(vec2(az * 7.0, 3.0));
  vec3 col = uHorizon * exp(-max(h, 0.0) * 9.0) + uHigh * smoothstep(0.0, 0.8, h);
  col *= smoothstep(hill - 0.004, hill + 0.004, h) * 0.9 + 0.1;
  // stars
  vec2 sp = vec2(az, asin(clamp(h, -1.0, 1.0))) * 90.0;
  vec2 c = floor(sp);
  float s = h12(c);
  vec2 o = vec2(h12(c + 3.1), h12(c + 7.7)) - 0.5;
  float star = step(0.93, s) * smoothstep(0.12, 0.0, length(fract(sp) - 0.5 - o * 0.6)) * (s - 0.93) * 14.0;
  col += vec3(0.8, 0.85, 1.0) * star * uStars * smoothstep(hill, hill + 0.1, h) * (0.7 + 0.3 * sin(uTime * (1.0 + s * 4.0) + s * 50.0));
  // aurora curtains (inside the drop)
  float cur = vn(vec2(az * 3.0 + uTime * 0.03, h * 2.0)) * smoothstep(0.05, 0.25, h) * smoothstep(0.75, 0.3, h);
  float band = pow(vn(vec2(az * 6.0 - uTime * 0.05, 0.0)), 3.0);
  col += mix(vec3(0.05, 0.4, 0.3), vec3(0.4, 0.15, 0.5), vn(vec2(az * 1.5, 9.0))) * cur * band * uAurora;
  outColor = vec4(col, 1.0);
}`;

const GROUND_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
out vec3 vPos;
void main() { vPos = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;

const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vPos;
out vec4 outColor;
uniform vec3 uCam, uHorizon, uPool, uWaveCol;
uniform float uTime;
uniform float uWaveT[8];
uniform float uWaveA[8];
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 V = normalize(uCam - vPos);
  float r = length(vPos.xz);
  float fres = pow(1.0 - max(V.y, 0.0), 4.0);
  vec3 col = uHorizon * fres * 0.9;
  col += uPool * exp(-r * r * 0.35);
  float w = 0.0;
  for (int i = 0; i < 8; i++) {
    float age = uTime - uWaveT[i];
    if (age < 0.0 || age > 6.0) continue;
    float front = age * 2.6;
    float x = (r - front) / (0.12 + age * 0.05);
    w += uWaveA[i] * exp(-x * x) * exp(-age * 0.55) * (0.6 + 0.4 * cos((r - front) * 9.0));
  }
  col += uWaveCol * w * exp(-r * 0.07);
  col *= 0.92 + 0.08 * h12(floor(vPos.xz * 40.0));
  col *= exp(-length(vPos - uCam) * 0.018);
  outColor = vec4(col, 1.0);
}`;

const BRANCH_VS = `#version 300 es
layout(location = 0) in vec3 aC;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec3 aPrev;
layout(location = 3) in vec4 aInfo;   // radius, birth, u, depth
layout(location = 4) in float aId;
uniform mat4 uVP;
uniform float uTime, uGrow, uMirror, uSway, uScale, uWave, uPxScale;
uniform float uFlashAge[96];
uniform float uFlashAmp[96];
uniform float uWaveT[8];
uniform float uWaveA[8];
out vec3 vPos;
out vec3 vN;
out float vAge;
out float vU;
out float vDepth;
out float vFlash;
out float vRad;
out float vThin;
${SWAY_GLSL}
void main() {
  float g = clamp((uTime - (aInfo.y - uGrow)) / uGrow, 0.0, 1.0);
  vRad = aInfo.x;
  vec3 c = mix(aPrev, aC, g);
  float rad = aInfo.x * smoothstep(0.0, 1.0, g);
  // twigs thinner than a pixel would break up into dots: keep them a pixel wide and dim them instead
  vec4 cc = uVP * vec4(c * uScale, 1.0);
  float minR = 0.75 * max(cc.w, 0.02) * uPxScale / uScale;
  float rr = rad > 0.0005 ? max(rad, minR) : rad;
  vThin = rad / max(rr, 1e-6);
  vec3 p = (c + aN * rr) * uScale;
  p += sway(c, uTime, uSway) * uScale;
  vPos = p;
  vN = aN;
  vAge = uTime - aInfo.y;
  vU = aInfo.z;
  vDepth = aInfo.w;
  int id = int(aId + 0.5);
  float fa = uFlashAge[id];
  float fx = (aInfo.z - fa * 1.6) * 4.0;
  vFlash = uFlashAmp[id] * exp(-fx * fx) * exp(-fa * 0.8);
  if (uMirror > 0.5) {
    // reflection in the black ground, rippled by the bass waves
    float r = length(p.xz);
    float w = 0.0;
    for (int i = 0; i < 8; i++) {
      float age = uTime - uWaveT[i];
      if (age < 0.0 || age > 6.0) continue;
      float rx = (r - age * 2.6) * 1.5;
      w += uWaveA[i] * sin((r - age * 2.6) * 7.0) * exp(-rx * rx) * exp(-age * 0.55);
    }
    p.xz += normalize(p.xz + 1e-4) * w * uWave;
    p.y = -p.y;
    vN.y = -vN.y;
  }
  gl_Position = uVP * vec4(p, 1.0);
}`;

const BRANCH_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vN;
in float vAge;
in float vU;
in float vDepth;
in float vFlash;
in float vRad;
in float vThin;
out vec4 outColor;
uniform vec3 uCam, uGlassA, uGlassB, uFresh, uKey, uFlashCol;
uniform float uMirror, uBright;
void main() {
  if (vAge < -0.4) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vPos);
  float ndv = abs(dot(N, V));
  float fres = pow(max(1.0 - ndv, 0.0), 2.6);
  vec3 glass = mix(uGlassA, uGlassB, clamp(vDepth / 3.0 + vU * 0.25, 0.0, 1.0));
  vec3 L = normalize(vec3(-0.5, 0.8, 0.4));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 80.0);
  float fresh = exp(-max(vAge, 0.0) / 0.7) * smoothstep(-0.4, 0.0, vAge) * mix(0.35, 1.2, smoothstep(0.06, 0.012, vRad));
  vec3 col = glass * (0.045 + 1.25 * fres) + uKey * spec * 0.7 + uFresh * fresh * (1.2 + fres) + uFlashCol * vFlash * 1.6;
  col *= uBright * (0.25 + 0.75 * vThin);
  if (uMirror > 0.5) col *= 0.32 * exp(vPos.y * 0.45);
  outColor = vec4(col, 1.0);
}`;

const MEM_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec4 aInfo;   // birth, v (along), w (across), membrane id
uniform mat4 uVP;
uniform float uTime, uSway, uScale, uMirror;
uniform float uOpen[24];
out vec3 vPos;
out vec3 vN;
out float vOpen;
out float vV;
out float vBirth;
out float vW;
flat out int vId;
${SWAY_GLSL}
void main() {
  int id = int(aInfo.w + 0.5);
  vW = aInfo.z;
  vec3 p = (aP + sway(aP, uTime, uSway)) * uScale;
  vOpen = uOpen[id];
  vPos = p;
  vN = aN;
  vV = aInfo.y;
  vBirth = aInfo.x;
  vId = id;
  if (uMirror > 0.5) { p.y = -p.y; vN.y = -vN.y; }
  gl_Position = uVP * vec4(p, 1.0);
}`;

const MEM_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vN;
in float vOpen;
in float vV;
in float vBirth;
in float vW;
flat in int vId;
out vec4 outColor;
uniform vec3 uCam;
uniform vec3 uCol[24];
uniform float uTime, uMirror;
void main() {
  if (uTime < vBirth || vOpen < 0.002) discard;
  // the membrane unfurls from its fork towards the tips as it opens
  if (vV > vOpen * 1.15) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vPos);
  float ndv = abs(dot(N, V));
  vec3 base = uCol[vId];
  // thin-film sheen: hue drifts with the viewing angle
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + ndv * 1.3 + vV * 0.4 + uTime * 0.03));
  float edge = smoothstep(vOpen * 1.15 - 0.06, vOpen * 1.15, vV);
  // veins like a dragonfly wing: arcs across, ribs along
  float arcs = smoothstep(0.92, 1.0, abs(fract(vV * 5.0 + vW * 0.6) - 0.5) * 2.0);
  float ribs = smoothstep(0.9, 1.0, abs(fract(vW * 4.0) - 0.5) * 2.0);
  float veins = max(arcs, ribs * 0.7);
  float fade = smoothstep(0.0, 0.15, vW) * smoothstep(1.0, 0.85, vW) * smoothstep(0.25, 0.45, vV);
  vec3 col = (base * (0.018 + 0.3 * (1.0 - ndv) * (1.0 - ndv)) + film * base * 0.05 + base * veins * 0.32) * vOpen * fade + base * edge * 0.45 * vOpen * fade;
  if (uMirror > 0.5) col *= 0.3 * exp(vPos.y * 0.45);
  outColor = vec4(col, 1.0);
}`;

const ORB_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;   // rgb, size (m)
layout(location = 2) in float aKind; // 0 glow, 1 glass sphere
uniform mat4 uVP;
uniform float uPx;
out vec3 vCol;
out float vKind;
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  float px = aCol.a * uPx / max(c.w, 0.05);
  gl_PointSize = clamp(px, 1.5, 240.0);
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
    float a = exp(-r2 * 4.5) * (1.0 - smoothstep(0.75, 1.0, r2));
    outColor = vec4(vCol * a, 1.0);
    return;
  }
  if (r2 > 1.0) discard;
  // a glass sphere: bright rim, a caustic core, one sharp highlight
  vec3 n = vec3(q, sqrt(1.0 - r2));
  float rim = pow(max(1.0 - n.z, 0.0), 2.2);
  float core = exp(-dot(q - vec2(0.15, -0.2), q - vec2(0.15, -0.2)) * 6.0) * 0.5;
  float hl = pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 60.0) * 2.5;
  outColor = vec4(vCol * (rim * 1.3 + core + 0.05) + vec3(hl), 1.0);
}`;

const LENS_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uC;
uniform float uR, uAspect, uK, uRim;
void main() {
  vec3 col = texture(uScene, vUv).rgb;
  vec2 d = (vUv - uC) * vec2(uAspect, 1.0);
  float r = length(d);
  if (uR > 0.0 && r < uR) {
    float x = r / uR;
    // a water drop is a tiny fish-eye lens: what is behind it appears inverted and shrunk
    float k = uK * (1.0 + 0.55 * x * x * x);
    vec3 inner;
    for (int c = 0; c < 3; c++) {
      float kk = k * (1.0 + (float(c) - 1.0) * 0.025 * x);
      vec2 uv2 = clamp(uC - d * kk / vec2(uAspect, 1.0), 0.0, 1.0);
      inner[c] = texture(uScene, uv2)[c];
    }
    float rim = smoothstep(0.82, 1.0, x) * uRim;
    vec2 hp = d / uR - vec2(-0.32, 0.34);
    float hl = exp(-dot(hp, hp) * 70.0) * 3.0 * uRim;
    col = inner * (1.0 - 0.35 * pow(x, 8.0)) + vec3(0.7, 0.85, 1.0) * rim * 0.5 + vec3(hl);
  }
  outColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------------------------------ the tree
function buildTree(rng) {
  const branches = [];
  const add = (b) => {
    b.id = branches.length;
    b.children = [];
    branches.push(b);
    if (b.parent) b.parent.children.push(b);
    return b;
  };
  const curve = (start, dir, len, segs, upPull, wiggle) => {
    const pts = [start.slice()];
    let d = v3.norm(dir);
    let p = start.slice();
    for (let k = 1; k <= segs; k++) {
      const r = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
      d = v3.norm(v3.add(v3.add(d, [0, upPull, 0]), v3.scale(r, wiggle)));
      p = v3.add(p, v3.scale(d, len / segs));
      pts.push(p);
    }
    return pts;
  };
  const at = (b, u) => {
    const f = u * (b.pts.length - 1);
    const i = Math.min(b.pts.length - 2, Math.floor(f));
    return { p: v3.lerp(b.pts[i], b.pts[i + 1], f - i), d: v3.norm(v3.sub(b.pts[i + 1], b.pts[i])), r: b.r0 + (b.r1 - b.r0) * Math.pow(u, 0.8) };
  };
  const trunk = add({ depth: 0, parent: null, u0: 0, r0: 0.12, r1: 0.045, pts: curve([0, 0, 0], [0.05, 1, 0.02], 2.6, 13, 0.02, 0.08) });
  for (let i = 0; i < 7; i++) {
    const u = 0.4 + i * 0.085;
    const base = at(trunk, u);
    const az = i * 2.39996 + 0.3;
    const el = 0.42 + i * 0.07 + rng.range(-0.08, 0.08);
    const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const len = 2.3 - i * 0.16 + rng.range(-0.15, 0.15);
    const pr = add({ depth: 1, parent: trunk, u0: u, r0: base.r * 0.62, r1: 0.012, pts: curve(base.p, dir, len, 11, 0.09, 0.16) });
    for (let j = 0; j < 4; j++) {
      const v = 0.32 + j * 0.17 + rng.range(-0.03, 0.03);
      const b2 = at(pr, v);
      const side = j % 2 ? 1 : -1;
      const perp = v3.norm(v3.cross(b2.d, [0, 1, 0]));
      const d2 = v3.norm(v3.add(v3.add(b2.d, v3.scale(perp, side * 0.9)), [0, 0.35, 0]));
      const sec = add({ depth: 2, parent: pr, u0: v, r0: b2.r * 0.7, r1: 0.006, pts: curve(b2.p, d2, 0.85 + rng.range(-0.2, 0.35), 9, 0.12, 0.22) });
      for (let k = 0; k < 2; k++) {
        const w = 0.5 + k * 0.3;
        const b3 = at(sec, w);
        const perp3 = v3.norm(v3.cross(b3.d, [rng.range(-1, 1), 1, rng.range(-1, 1)]));
        const d3 = v3.norm(v3.add(b3.d, v3.scale(perp3, (k ? 1 : -1) * 0.8)));
        add({ depth: 3, parent: sec, u0: w, r0: b3.r * 0.7, r1: 0.003, pts: curve(b3.p, d3, 0.3 + rng.range(0, 0.25), 7, 0.14, 0.3) });
      }
    }
  }
  for (const b of branches) b.at = (u) => at(b, u);
  return branches;
}

/** Ring births: each harp note grows a ring on a few branches; forks open when the parent reaches them. */
function scheduleGrowth(branches, harp) {
  for (const b of branches) {
    b.birth = new Float32Array(b.pts.length).fill(1e9);
    b.grown = 0;
    b.started = false;
  }
  const trunk = branches[0];
  const active = [];
  const start = (b, t) => {
    b.started = true;
    b.birth[0] = t;
    b.grown = 1;
    active.push(b);
  };
  start(trunk, harp.length ? harp[0].t : 0);
  for (const n of harp) {
    if (!active.length) break;
    const k = n === harp[0] ? 1 : 4;
    active.sort((a, b) => a.depth - b.depth || a.id - b.id);
    const pick = active.slice(0, k);
    pick.forEach((b, j) => {
      if (b.grown >= b.pts.length) return;
      b.birth[b.grown] = n.t + j * 0.03;
      b.grown++;
      const frac = (b.grown - 1) / (b.pts.length - 1);
      for (const c of b.children) if (!c.started && frac >= c.u0) start(c, n.t + 0.05);
    });
    for (let i = active.length - 1; i >= 0; i--) if (active[i].grown >= active[i].pts.length) active.splice(i, 1);
  }
}

function tubeMesh(branches) {
  const verts = [];
  const idx = [];
  let base = 0;
  for (const b of branches) {
    const n = b.pts.length;
    for (let k = 0; k < n; k++) {
      const p = b.pts[k];
      const prev = b.pts[Math.max(0, k - 1)];
      const t = v3.norm(v3.sub(b.pts[Math.min(n - 1, k + 1)], b.pts[Math.max(0, k - 1)]));
      const helper = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const n1 = v3.norm(v3.cross(t, helper));
      const n2 = v3.cross(t, n1);
      const u = k / (n - 1);
      const r = b.r0 + (b.r1 - b.r0) * Math.pow(u, 0.8);
      for (let j = 0; j <= SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const nn = v3.add(v3.scale(n1, Math.cos(a)), v3.scale(n2, Math.sin(a)));
        verts.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], prev[0], prev[1], prev[2], r, b.birth[k], u, b.depth, b.id);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let j = 0; j < SIDES; j++) {
        const a = base + k * (SIDES + 1) + j, c = a + SIDES + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    base += n * (SIDES + 1);
  }
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

function membraneMesh(branches) {
  // a translucent sheet between each pair of neighbouring secondary branches
  const pairs = [];
  for (const b of branches) {
    if (b.depth !== 1) continue;
    const kids = b.children.filter((c) => c.depth === 2);
    for (let i = 0; i < kids.length - 1; i++) pairs.push([kids[i], kids[i + 1]]);
  }
  const verts = [];
  const idx = [];
  const R = 10, Cc = 6;
  pairs.slice(0, 24).forEach(([A, B], m) => {
    const base = verts.length / 10;
    for (let i = 0; i <= R; i++) {
      const v = i / R;
      const a = A.at(v), b = B.at(v);
      const ia = Math.min(A.pts.length - 1, Math.round(v * (A.pts.length - 1)));
      const ib = Math.min(B.pts.length - 1, Math.round(v * (B.pts.length - 1)));
      const birth = Math.max(A.birth[ia], B.birth[ib]);
      const across = v3.sub(b.p, a.p);
      const nrm = v3.norm(v3.cross(across, v3.add(a.d, b.d)));
      for (let j = 0; j <= Cc; j++) {
        const w = j / Cc;
        const p = v3.add(v3.lerp(a.p, b.p, w), v3.scale(nrm, Math.sin(Math.PI * w) * 0.06 * Math.sin(Math.PI * v)));
        verts.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], birth, v, w, m);
      }
    }
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < Cc; j++) {
        const a = base + i * (Cc + 1) + j, c = a + Cc + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
  });
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx), count: Math.min(24, pairs.length) };
}

class IndexedMesh {
  constructor(gl, layout, verts, idx) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const stride = layout.reduce((a, [, n]) => a + n, 0) * 4;
    let off = 0;
    for (const [loc, n] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
      off += n * 4;
    }
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = idx.length;
    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}

const chromaOf = (notes) => {
  const c = new Array(12).fill(0);
  notes.forEach((n, i) => (c[n % 12] += i === 0 ? 1.4 : 1));
  return c;
};

// ------------------------------------------------------------------------------------------ scene
export class Scene extends StageScene {
  constructor(app, score, run) {
    super(app, score, run);
    this.M = score.marks;
    this.T = score.T;
    const ev = score.events;
    this.harp = ev.filter((e) => e.inst === 'harp');
    this.bowed = ev.filter((e) => e.inst === 'bowed');
    this.kal = ev.filter((e) => e.inst === 'kalimba' || e.inst === 'lead');
    this.bass = ev.filter((e) => e.inst === 'bass');
    // ground waves: every bass note, plus the first harmonics rippling out from the seed
    this.waves = [...this.bass, ...ev.filter((e) => e.inst === 'harp' && e.harmonic && e.t < 12).map((e) => ({ t: e.t, vel: e.vel * 0.7, soft: true }))]
      .sort((a, b) => a.t - b.t);
    this.perc = ev.filter((e) => e.inst === 'perc');
    this.glints = ev.filter((e) => e.inst === 'glint');
    this.chords = ev.filter((e) => e.inst === 'chord').map((e) => ({ ...e, col: chordColor(chromaOf(e.pad), 0.72).rgb }));
    this.rng = new Rng(99);
  }

  async init() {
    const gl = this.gl;
    const rng = this.rng;
    this.branches = buildTree(rng);
    scheduleGrowth(this.branches, this.harp.filter((e) => e.t >= this.M.growth - 0.5));
    const tube = tubeMesh(this.branches);
    this.tree = new IndexedMesh(gl, [[0, 3], [1, 3], [2, 3], [3, 4], [4, 1]], tube.verts, tube.idx);
    const mem = membraneMesh(this.branches);
    this.mem = new IndexedMesh(gl, [[0, 3], [1, 3], [2, 4]], mem.verts, mem.idx);
    this.memCount = mem.count;
    this.prog = {
      sky: new Program(gl, FULLSCREEN_VS, SKY_FS, 'go-sky'),
      ground: new Program(gl, GROUND_VS, GROUND_FS, 'go-ground'),
      branch: new Program(gl, BRANCH_VS, BRANCH_FS, 'go-branch'),
      mem: new Program(gl, MEM_VS, MEM_FS, 'go-membrane'),
      orb: new Program(gl, ORB_VS, ORB_FS, 'go-orbs'),
      lens: new Program(gl, FULLSCREEN_VS, LENS_FS, 'go-lens'),
    };
    const g = 70;
    this.groundMesh = new IndexedMesh(gl, [[0, 3]], new Float32Array([-g, 0, -g, g, 0, -g, g, 0, g, -g, 0, g]), new Uint16Array([0, 2, 1, 0, 3, 2]));
    this.orbs = new DynBuffer(gl, [[0, 3], [1, 4], [2, 1]], 2600);
    this.lensTarget = new Target(gl, 4, 4, { hdr: true });
    // flashes: once a branch is fully grown, notes run light along it
    this.flashes = this.branches.map(() => []);
    const done = (b) => b.birth[b.pts.length - 1];
    const leaves = this.branches.filter((b) => b.depth >= 2);
    let li = 0;
    for (const n of this.harp) {
      for (let tries = 0; tries < 6; tries++) {
        const b = leaves[(li++ * 7) % leaves.length];
        if (done(b) < n.t - 0.3) {
          this.flashes[b.id].push({ t: n.t, a: n.vel });
          break;
        }
      }
    }
    for (const n of this.kal) {
      const b = this.branches[1 + Math.floor(rng.next() * 7)];
      this.flashes[b.id].push({ t: n.t, a: n.vel * 0.8 });
    }
    for (const f of this.flashes) f.sort((a, b) => a.t - b.t);
    // membranes open with the bowed voice, round-robin
    this.memEvents = Array.from({ length: 24 }, () => []);
    this.bowed.forEach((e, i) => {
      const k = (i * 5) % this.memCount;
      this.memEvents[k].push(e);
      if (e.pad) this.memEvents[(k + 11) % this.memCount].push(e);
    });
    // fruit on twig tips; each chord change hangs a new one; percussion breaks one
    const twigs = this.branches.filter((b) => b.depth === 3);
    this.fruits = [];
    const chordTimes = this.chords.map((c) => c.t);
    twigs.forEach((tw, i) => {
      if (i % 2) return;
      const ripe = Math.max(done(tw) + 0.5, chordTimes[this.fruits.length] ?? 1e9);
      const end = tw.pts[tw.pts.length - 1];
      this.fruits.push({ pos: v3.add(end, [0, -0.05, 0]), born: ripe, r: 0.05 + rng.next() * 0.04, hits: [], col: [rng.range(0.6, 1), rng.range(0.6, 1), rng.range(0.7, 1)] });
    });
    let fi = 0;
    for (const p of this.perc) {
      for (let tries = 0; tries < this.fruits.length; tries++) {
        const f = this.fruits[(fi++ * 5) % this.fruits.length];
        if (f.born < p.t) {
          f.hits.push(p);
          break;
        }
      }
    }
    this.shardDirs = Array.from({ length: 14 }, () => v3.norm([rng.range(-1, 1), rng.range(-0.6, 1), rng.range(-1, 1)]));
    // organisms: points on the glass surfaces
    this.orgs = [];
    for (const b of this.branches) {
      const n = b.depth === 0 ? 30 : b.depth === 1 ? 14 : b.depth === 2 ? 6 : 3;
      for (let i = 0; i < n; i++) {
        const u = rng.next();
        const k = Math.min(b.pts.length - 1, Math.round(u * (b.pts.length - 1)));
        const s = b.at(u);
        const perp = v3.norm(v3.cross(s.d, [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]));
        this.orgs.push({ b: b.id, pos: v3.add(s.p, v3.scale(perp, s.r * 1.1)), born: b.birth[k], ph: rng.next() * 6.28 });
      }
    }
    this.glintBranch = this.glints.map(() => Math.floor(rng.next() * this.branches.length));
    // the droplet hangs from the highest twig facing the camera's path
    let best = null;
    for (const tw of twigs) {
      const e = tw.pts[tw.pts.length - 1];
      const score = e[1] + 0.6 * e[2] - 0.2 * Math.abs(e[0]);
      if (!best || score > best.s) best = { s: score, e };
    }
    this.dropTip = best.e;
    this._buildCurves();
  }

  _buildCurves() {
    const M = this.M, T = this.T;
    const D = this.dropTip;
    const dropPos = [D[0], D[1] - 0.11, D[2]];
    this.dropPos = dropPos;
    const toCam = v3.norm([D[0] * 0.4, 0.15, 1]);
    const near = v3.add(dropPos, v3.scale(toCam, 0.42));
    const inside = v3.add(dropPos, v3.scale(toCam, 0.06));
    const orbit = (ang, r, y) => [Math.sin(ang) * r, y, Math.cos(ang) * r];
    const K = (t, eye, tgt, fov, hold) => ({ t, eye, tgt, fov, hold });
    const keys = [
      K(0, [0.4, 0.35, 2.2], [0, 0.15, 0], 0.75, true),
      K(9, [0.8, 0.9, 3.6], [0, 0.6, 0], 0.8),
      K(20, orbit(0.9, 5.2, 1.6), [0, 1.2, 0], 0.85),
      K(34, orbit(1.9, 6.2, 2.0), [0, 1.7, 0], 0.88),
      K(M.tension, orbit(2.8, 6.0, 1.8), [0, 1.9, 0], 0.85),
      K(64, orbit(3.9, 4.4, 1.3), [0, 2.0, 0], 0.72),
      K(T.t(27), orbit(4.6, 4.0, 1.6), [0, 2.2, 0], 0.7),
      K(T.t(28.3), v3.add(dropPos, v3.scale(toCam, 1.6)), dropPos, 0.75),
      K(T.t(30.5), near, dropPos, 0.8),
      K(M.pass, inside, dropPos, 0.82, true),
    ];
    this.camA = { eye: new Spline(keys.map((k) => ({ t: k.t, v: k.eye, hold: k.hold }))), tgt: new Spline(keys.map((k) => ({ t: k.t, v: k.tgt, hold: k.hold }))),
      fov: new Spline(keys.map((k) => ({ t: k.t, v: [k.fov], hold: k.hold }))) };
    const keysB = [
      K(M.pass, [0.6, 2.6, 2.2], [0, 2.4, -1], 0.9, true),
      K(M.pass + 6, orbit(0.6, 6.5, 2.0), [0, 2.0, 0], 0.95),
      K(M.finale, orbit(2.2, 7.5, 2.6), [0, 2.2, 0], 0.95),
      K(M.outro, orbit(3.4, 7.0, 3.2), [0, 2.4, 0], 0.92),
      K(150, orbit(4.2, 6.0, 7.5), [0, 2.6, 0], 0.95, true),
    ];
    this.camB = { eye: new Spline(keysB.map((k) => ({ t: k.t, v: k.eye, hold: k.hold }))), tgt: new Spline(keysB.map((k) => ({ t: k.t, v: k.tgt, hold: k.hold }))),
      fov: new Spline(keysB.map((k) => ({ t: k.t, v: [k.fov], hold: k.hold }))) };
    this.c = {
      horizon: new Curve([[0, [0.002, 0.006, 0.007]], [M.growth, [0.006, 0.016, 0.018]], [M.tension, [0.012, 0.008, 0.026]], [M.drop, [0.004, 0.004, 0.01]],
        [M.pass, [0.03, 0.016, 0.03]], [M.finale, [0.05, 0.026, 0.02]], [M.outro, [0.06, 0.04, 0.025]], [152, [0.01, 0.008, 0.006]]]),
      glassA: new Curve([[0, [0.1, 0.45, 0.42]], [M.tension, [0.2, 0.3, 0.75]], [M.drop, [0.25, 0.4, 0.7]], [M.pass, [0.55, 0.4, 0.75]], [M.finale, [0.8, 0.5, 0.45]], [M.outro, [0.9, 0.75, 0.5]]]),
      glassB: new Curve([[0, [0.55, 0.95, 0.85]], [M.tension, [0.55, 0.6, 1.0]], [M.pass, [0.9, 0.8, 1.0]], [M.finale, [1.0, 0.85, 0.65]]]),
      bright: new Curve([[0, 0.9], [M.tension, 0.85], [M.drop, 0.7], [M.pass, 1.15], [M.finale, 1.3], [M.outro, 1.1], [149, 1.4], [154, 0]]),
      sway: new Curve([[0, 0.4], [M.tension, 0.9], [M.drop, 0.25], [M.pass, 0.6], [M.outro, 0.35]]),
      exposure: new Curve([[0, 1.5], [M.growth, 1.6], [M.tension, 1.55], [M.drop, 1.6], [M.pass - 0.05, 1.8], [M.pass + 0.1, 3.4], [M.pass + 2, 1.8], [M.finale, 1.9], [151, 1.6], [154, 0.6]]),
    };
  }

  _cam(t, w, h) {
    const M = this.M;
    const inner = t >= M.pass;
    const C = inner ? this.camB : this.camA;
    const roll = inner ? Math.PI * (1 - sm(M.pass, M.pass + 2.8, t)) : 0;
    return this.camera(C.eye.at(t), C.tgt.at(t), C.fov.at(t)[0], w, h, { roll, near: 0.01, far: 300 });
  }

  _chordAt(t) {
    const i = lastBefore(this.chords, t);
    return i >= 0 ? this.chords[i] : null;
  }

  update(t, dt) {
    this.t = t;
    this.dt = dt;
  }

  draw(t, dt, target) {
    const gl = this.gl;
    const w = target.w, h = target.h;
    const cam = this._cam(t, w, h);
    this.cam = cam;
    const M = this.M;
    const inner = t >= M.pass;
    const ch = this._chordAt(t);
    const chordCol = ch ? ch.col : [0.3, 0.6, 0.6];
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const hor = this.c.horizon.at(t);
    this.prog.sky.use().setAll({ uInvVP: cam.invVP, uCam: cam.eye, uHorizon: hor, uHigh: rgbMul(hor, 0.12), uStars: inner ? 1 : 0.25 + 0.4 * sm(M.growth, M.tension, t),
      uAurora: inner ? 0.35 * sm(M.pass, M.pass + 6, t) * (1 - sm(150, 154, t)) : 0, uTime: t });
    drawFullscreen(gl);
    // ground with waves
    const waveT = new Float32Array(8).fill(-100), waveA = new Float32Array(8);
    let wi = 0;
    for (let i = lastBefore(this.waves, t); i >= 0 && wi < 8 && t - this.waves[i].t < 6; i--) {
      waveT[wi] = this.waves[i].t;
      waveA[wi++] = this.waves[i].vel * (this.waves[i].soft ? 0.6 : 1);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    const pool = rgbMul(chordCol, 0.05 + 0.08 * this._bassEnv(t) + (inner ? 0.06 : 0));
    this.prog.ground.use().setAll({ uVP: cam.vp, uCam: cam.eye, uHorizon: hor, uPool: pool, uWaveCol: rgbMul(rgbMix(chordCol, [0.4, 0.5, 1], 0.5), inner ? 0.5 : 0.32), uTime: t, uWaveT: waveT, uWaveA: waveA });
    this.groundMesh.draw();
    // glass: reflection first (no depth), then the tree; everything additive
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    const scale = inner ? 1.0 + 0.15 * sm(M.pass, M.pass + 10, t) : 1;
    const flashAge = new Float32Array(96).fill(100), flashAmp = new Float32Array(96);
    this.branches.forEach((b, i) => {
      const f = this.flashes[i];
      const k = lastBefore(f, t);
      if (k >= 0) {
        flashAge[i] = t - f[k].t;
        flashAmp[i] = f[k].a;
      }
    });
    const bright = this.c.bright.at(t) * (1 + 0.25 * this._bassEnv(t));
    const glassA = rgbMix(this.c.glassA.at(t), chordCol, inner ? 0.35 : 0.15);
    const common = {
      uVP: cam.vp, uCam: cam.eye, uTime: t, uGrow: 0.35, uSway: this.c.sway.at(t), uScale: scale, uWave: 0.18,
      uPxScale: (2 * Math.tan(cam.fov / 2)) / h,
      uFlashAge: flashAge, uFlashAmp: flashAmp, uWaveT: waveT, uWaveA: waveA, uGlassA: glassA, uGlassB: this.c.glassB.at(t),
      uFresh: rgbMul([0.85, 1.0, 0.95], 1.0), uKey: [0.9, 0.95, 1.0], uFlashCol: rgbMix([1, 0.9, 0.7], chordCol, 0.3), uBright: bright,
    };
    gl.disable(gl.DEPTH_TEST);
    this.prog.branch.use().setAll({ ...common, uMirror: 1 });
    this.tree.draw();
    const memOpen = new Float32Array(24), memCol = new Float32Array(72);
    for (let k = 0; k < 24; k++) {
      const [o, c] = this._membrane(k, t, inner);
      memOpen[k] = o;
      memCol.set(c, k * 3);
    }
    this.prog.mem.use().setAll({ uVP: cam.vp, uCam: cam.eye, uTime: t, uSway: common.uSway, uScale: scale, uOpen: memOpen, uCol: memCol, uMirror: 1 });
    this.mem.draw();
    gl.enable(gl.DEPTH_TEST);
    this.prog.branch.use().setAll({ ...common, uMirror: 0 });
    this.tree.draw();
    this.prog.mem.use().setAll({ uMirror: 0 });
    this.mem.draw();
    this._drawOrbs(t, cam, scale, chordCol, inner);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    // the droplet: a lens over the finished frame
    const lens = this._lens(t, cam);
    if (!lens) return target;
    this.lensTarget.resize(w, h);
    this.lensTarget.bind();
    gl.disable(gl.DEPTH_TEST);
    this.prog.lens.use().tex('uScene', target.tex).setAll({ uC: [lens.x, lens.y], uR: lens.r, uAspect: w / h, uK: lens.k, uRim: lens.rim });
    drawFullscreen(gl);
    return this.lensTarget;
  }

  _bassEnv(t) {
    let v = 0;
    for (let i = lastBefore(this.bass, t); i >= 0 && t - this.bass[i].t < 3; i--) v = Math.max(v, pulse(t, this.bass[i].t, 0.02, 0.9) * this.bass[i].vel);
    return v;
  }

  _membrane(k, t, inner) {
    let o = 0;
    let col = [0.4, 0.6, 0.8];
    const list = this.memEvents[k];
    for (let i = lastBefore(list, t); i >= 0 && t - list[i].t < 20; i--) {
      const e = list[i];
      const x = t - e.t;
      const env = Math.min(1, x / 0.6) * (x > e.dur ? Math.exp(-(x - e.dur) / 1.6) : 1) * (0.5 + e.vel);
      if (env > o) {
        o = env;
        const c = this._chordAt(e.t + 0.01);
        if (c) col = c.col;
      }
    }
    if (inner) o = Math.max(o, 0.35 + 0.15 * Math.sin(t * 0.5 + k));
    if (t >= this.M.tension && t < this.M.drop) o *= 0.75;
    return [Math.min(1, o), col];
  }

  _lens(t, cam) {
    const M = this.M, T = this.T;
    if (t < T.t(27.4) || t >= M.pass) return null;
    const grow = sm(T.t(27.4), T.t(29), t);
    const R = 0.11 * grow;
    if (R < 0.002) return null;
    const p = this.project(cam, this.dropPos);
    if (!p.visible) return null;
    const dist = v3.len(v3.sub(this.dropPos, cam.eye));
    const ang = Math.asin(Math.min(1, R / Math.max(dist, R)));
    const rScreen = dist <= R * 1.02 ? 4 : Math.tan(ang) / Math.tan(cam.fov / 2);
    // far away the drop shows a wide, tiny world; up close the inverted image fills it 1:1
    const k = 1 + 2.4 * (1 - sm(0.5, 0.12, dist));
    return { x: p.x, y: p.y, r: rScreen * 0.5 * 1.0, k, rim: 1 - sm(0.2, 0.08, dist) };
  }

  _drawOrbs(t, cam, scale, chordCol, inner) {
    const gl = this.gl;
    const d = this.orbs.data;
    let n = 0;
    const sw = this.c.sway.at(t);
    const push = (p, c, size, kind = 0) => {
      if (n >= this.orbs.max) return;
      const q = sway(p, t, sw);
      const o = n * 8;
      d[o] = q[0] * scale; d[o + 1] = q[1] * scale; d[o + 2] = q[2] * scale;
      d[o + 3] = c[0]; d[o + 4] = c[1]; d[o + 5] = c[2]; d[o + 6] = size * scale; d[o + 7] = kind;
      n++;
    };
    // the seed
    const seed = sm(0.3, 2.5, t) * (1 - sm(11, 16, t)) * (0.45 + 0.55 * this._harpEnv(t));
    if (seed > 0.01) {
      push([0, 0.035, 0], rgbMul([0.75, 1.0, 0.92], 2.2 * seed), 0.035);
      push([0, 0.035, 0], rgbMul([0.2, 0.6, 0.55], 0.6 * seed), 0.35);
      push([0, 0.035, 0], rgbMul([0.1, 0.35, 0.3], 0.25 * seed), 1.4);
    }
    // fruit: glass spheres; struck fruit bursts into shards that fly back together
    for (const f of this.fruits) {
      if (t < f.born) continue;
      const grow = sm(f.born, f.born + 1.2, t);
      let burst = 0;
      for (let i = lastBefore(f.hits, t); i >= 0 && t - f.hits[i].t < 0.9; i--) burst = Math.max(burst, Math.sin(Math.PI * Math.min(1, (t - f.hits[i].t) / 0.8)) * f.hits[i].vel * 1.6);
      const col = rgbMix(f.col, chordCol, 0.5);
      const whole = 1 - Math.min(1, burst * 1.5);
      if (whole > 0.02) push(f.pos, rgbMul(col, (0.55 + 0.25 * inner) * whole * grow), f.r * 2 * grow, 1);
      if (burst > 0.01) {
        for (const sd of this.shardDirs) push(v3.add(f.pos, v3.scale(sd, burst * 0.32)), rgbMul([1, 0.95, 0.85], 0.9 * burst), 0.025);
        push(f.pos, rgbMul(col, 1.2 * burst), 0.5);
      }
    }
    // organisms: a faint population on grown glass, flaring where the glints land
    const flare = new Map();
    for (let i = lastBefore(this.glints, t); i >= 0 && t - this.glints[i].t < 1.6; i--) {
      const b = this.glintBranch[i];
      flare.set(b, Math.max(flare.get(b) || 0, pulse(t, this.glints[i].t, 0.02, 0.5) * (0.6 + this.glints[i].vel * 3)));
    }
    const base = inner ? 0.035 : t >= this.M.growth ? 0.005 : 0;
    for (const o of this.orgs) {
      if (t < o.born + 0.5) continue;
      const fl = flare.get(o.b) || 0;
      const b = base * (0.6 + 0.4 * Math.sin(t * 2 + o.ph)) + fl;
      if (b < 0.004) continue;
      push(o.pos, rgbMul(inner ? [0.55, 1.0, 0.75] : [0.4, 0.95, 0.85], b), 0.014 + fl * 0.03);
    }
    // the drop itself (the lens draws what is inside it)
    const T = this.T;
    if (t >= T.t(27.4) && t < this.M.pass) {
      const R = 0.11 * sm(T.t(27.4), T.t(29), t);
      push(this.dropPos, [0.25, 0.35, 0.45], R * 2.05, 1);
    }
    // light rising from the branches at the end
    if (t > this.M.outro) {
      const k = sm(this.M.outro, this.M.outro + 6, t);
      for (let i = 0; i < 160; i++) {
        const o = this.orgs[(i * 13) % this.orgs.length];
        const life = ((t * 0.12 + i * 0.37) % 1);
        push(v3.add(o.pos, [0, life * 3.5, 0]), rgbMul([1, 0.85, 0.6], 0.25 * k * Math.sin(Math.PI * life)), 0.03);
      }
    }
    this.orbs.upload(n);
    const px = cam.h / (2 * Math.tan(cam.fov / 2));
    this.prog.orb.use().setAll({ uVP: cam.vp, uPx: px });
    this.orbs.draw(gl.POINTS);
  }

  _harpEnv(t) {
    let v = 0;
    for (let i = lastBefore(this.harp, t); i >= 0 && t - this.harp[i].t < 2; i--) v = Math.max(v, pulse(t, this.harp[i].t, 0.01, 0.4) * this.harp[i].vel);
    return v;
  }

  postParams(t) {
    const M = this.M;
    return {
      exposure: this.c.exposure.at(t), bloomStrength: 0.3, bloomRadius: 1.1, threshold: 0.35, vignette: 0.55, grain: 0.022, ca: 0.25,
      saturation: t >= M.tension && t < M.drop ? 0.9 : 1.1,
      flash: rgbMul([1, 0.97, 0.92], 0.6 * pulse(t, M.pass, 0.03, 0.5)),
      letterbox: 0.1 * (1 - sm(5, 12, t)),
    };
  }

  // ---------------------------------------------------------------- Hue
  light(f, t) {
    const M = this.M;
    const ch = this._chordAt(t);
    const cc = ch ? ch.col : [0.2, 0.5, 0.5];
    const inner = t >= M.pass;
    const lvl = t < M.growth ? 0.15 : t < M.tension ? 0.35 : t < M.drop ? 0.3 : t < M.pass ? 0.12 : t < M.outro ? 0.55 : 0.4;
    const fade = 1 - sm(150, 154, t);
    let c = rgbMul(cc, lvl * 0.5);
    const add = (col, k) => {
      c = [c[0] + col[0] * k, c[1] + col[1] * k, c[2] + col[2] * k];
    };
    if (f.anchor === 'tv') add(rgbMix(cc, [0.3, 0.4, 1], 0.4), this._bassEnv(t) * 0.5 + (t > this.T.t(27.4) && t < M.pass ? 0.3 * sm(this.T.t(27.4), M.pass, t) : 0));
    else if (f.anchor === 'fl') add([1.0, 0.75, 0.4], this._harpEnv(t) * 0.7);
    else if (f.anchor === 'fr') {
      for (let i = lastBefore(this.kal, t); i >= 0 && t - this.kal[i].t < 1.5; i--) add([0.7, 0.6, 1.0], pulse(t, this.kal[i].t, 0.01, 0.5) * this.kal[i].vel * 0.8);
    } else if (f.anchor === 'sr') {
      let o = 0;
      for (let k = 0; k < this.memCount; k++) o = Math.max(o, this._membrane(k, t, false)[0]);
      add(cc, o * 0.5);
    } else if (f.anchor === 'sl') {
      for (let i = lastBefore(this.glints, t); i >= 0 && t - this.glints[i].t < 1; i--) add([0.4, 1.0, 0.8], pulse(t, this.glints[i].t, 0.01, 0.3) * this.glints[i].vel * 1.6);
    }
    add([1, 1, 1], 1.4 * pulse(t, M.pass, 0.02, 0.6));
    if (inner) add(cc, 0.15);
    return rgbMul(c, fade);
  }

  dispose() {
    super.dispose();
    const gl = this.gl;
    for (const p of Object.values(this.prog || {})) gl.deleteProgram(p.prog);
    for (const m of [this.tree, this.mem, this.groundMesh, this.orbs]) if (m) m.dispose();
    if (this.lensTarget) this.lensTarget.dispose();
  }
}
