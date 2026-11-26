// Cold Start: the picture. A night circuit built from the same path the sound drives along: a pit garage
// (fluorescent tubes, a roller door), the pit lane, the track with its kerbs, barriers, lamp posts and grandstands,
// a tunnel lit in sodium orange. Seen from the driver's seat (a cockpit drawn in screen space: wheel, shift lights,
// a live rev counter) and, for one pass, from the side of the track. The Hue lights carry the engine (behind you),
// the lamps flicking past, the tunnel's rhythm and the car's head- and tail-lights as it goes by.
import { Program, FULLSCREEN_VS, drawFullscreen } from '../../gl/gl.js';
import { m4, v3 } from '../../gl/math.js';
import { Rng, smoothstep, clamp, lerp, lastBefore, pulse } from '../core/timeline.js';
import { StaticBuffer, DynBuffer, spriteProgram, rgbMul, rgbMix } from '../core/gfx.js';
import { StageScene } from '../core/stage.js';
import { CAR } from '../core/motor.js';

const sm = smoothstep;
const MAXL = 16;

// ---------------------------------------------------------------- materials (albedo, rough | emissive, pattern)
const MAT = {
  grass: [[0.016, 0.022, 0.014], 0.95, [0, 0, 0], 3],
  asphalt: [[0.075, 0.075, 0.08], 0.62, [0, 0, 0], 1],
  pit: [[0.07, 0.07, 0.075], 0.6, [0, 0, 0], 1],
  kerb: [[0.5, 0.06, 0.05], 0.5, [0, 0, 0], 2],
  concrete: [[0.2, 0.2, 0.21], 0.8, [0, 0, 0], 4],
  apron: [[0.11, 0.11, 0.115], 0.7, [0, 0, 0], 4],
  wall: [[0.32, 0.34, 0.37], 0.85, [0, 0, 0], 6],
  wallDark: [[0.07, 0.075, 0.085], 0.85, [0, 0, 0], 6],
  door: [[0.36, 0.37, 0.39], 0.45, [0, 0, 0], 5],
  doorOther: [[0.14, 0.15, 0.17], 0.45, [0, 0, 0], 5],
  ceiling: [[0.05, 0.05, 0.055], 0.9, [0, 0, 0], 0],
  tube: [[0.9, 0.95, 1], 0.4, [1, 1, 1], 0],
  bench: [[0.18, 0.12, 0.07], 0.7, [0, 0, 0], 0],
  chest: [[0.42, 0.03, 0.02], 0.3, [0, 0, 0], 7],
  tyre: [[0.02, 0.02, 0.022], 0.75, [0, 0, 0], 0],
  armco: [[0.38, 0.4, 0.42], 0.3, [0, 0, 0], 8],
  tunnel: [[0.34, 0.33, 0.3], 0.55, [0, 0, 0], 9],
  sodium: [[1, 0.6, 0.25], 0.5, [1, 1, 1], 0],
  lampHead: [[0.9, 0.9, 0.85], 0.5, [1, 1, 1], 0],
  pole: [[0.12, 0.12, 0.13], 0.5, [0, 0, 0], 0],
  stand: [[0.13, 0.14, 0.16], 0.8, [0, 0, 0], 10],
  facade: [[0.16, 0.17, 0.19], 0.7, [0, 0, 0], 11],
  paint: [[0.85, 0.32, 0.04], 0.12, [0, 0, 0], 12],
  glass: [[0.01, 0.012, 0.015], 0.05, [0, 0, 0], 0],
  carDark: [[0.02, 0.02, 0.022], 0.4, [0, 0, 0], 0],
  headlamp: [[1, 1, 1], 0.2, [1, 1, 1], 0],
  taillamp: [[1, 0.1, 0.05], 0.3, [1, 1, 1], 0],
  sign: [[0.1, 0.1, 0.1], 0.5, [1, 1, 1], 0],
  pitLight: [[1, 0.1, 0.05], 0.5, [1, 1, 1], 0],
};
const MAT_IDS = Object.keys(MAT);
const MID = Object.fromEntries(MAT_IDS.map((k, i) => [k, i]));

// ---------------------------------------------------------------- shaders
const WORLD_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec2 aUV;
layout(location = 3) in float aM;
uniform mat4 uVP, uModel;
out vec3 vP;
out vec3 vN;
out vec2 vUV;
flat out int vM;
void main() {
  vec4 w = uModel * vec4(aP, 1.0);
  vP = w.xyz;
  vN = mat3(uModel) * aN;
  vUV = aUV;
  vM = int(aM + 0.5);
  gl_Position = uVP * w;
}`;

const WORLD_FS = `#version 300 es
precision highp float;
in vec3 vP;
in vec3 vN;
in vec2 vUV;
flat in int vM;
out vec4 outColor;
uniform vec3 uCam;
uniform vec4 uMatA[${MAT_IDS.length}];   // albedo, rough
uniform vec4 uMatE[${MAT_IDS.length}];   // emissive, pattern
uniform int uLN;
uniform vec4 uLP[${MAXL}];   // pos, range
uniform vec4 uLC[${MAXL}];   // colour * intensity, spot cos (-2 = omni)
uniform vec3 uLD[${MAXL}];   // spot direction
uniform vec3 uAmb, uFog;
uniform float uFogD, uTime;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec4 A = uMatA[vM];
  vec4 E = uMatE[vM];
  vec3 albedo = A.rgb;
  float rough = A.a;
  int pat = int(E.a + 0.5);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 emis = E.rgb;
  float spec = 1.0;
  vec2 uv = vUV;
  if (pat == 1) {                       // asphalt: grain, edge lines, rubber on the racing line
    float g = vn(uv * vec2(9.0, 9.0)) * 0.5 + vn(uv * 41.0) * 0.5;
    albedo *= 0.75 + 0.5 * g;
    float au = abs(uv.x);
    float edge = step(au, 5.75) * step(5.45, au);
    albedo = mix(albedo, vec3(0.55), edge * (0.85 + 0.15 * vn(uv * 3.0)));
    float rubber = exp(-(uv.x * uv.x) / 6.25) * 0.35 * vn(uv * vec2(0.6, 0.05));
    albedo *= 1.0 - rubber;
    rough = mix(rough, 0.38, rubber + edge * 0.2);
  } else if (pat == 2) {                // kerb: red and white blocks
    float b = step(0.5, fract(uv.y / 3.0));
    albedo = mix(vec3(0.5, 0.05, 0.04), vec3(0.62, 0.62, 0.6), b) * (0.85 + 0.3 * vn(uv * 8.0));
  } else if (pat == 3) {                // grass
    albedo *= 0.6 + 0.8 * vn(uv * 0.4) * vn(uv * 3.1);
  } else if (pat == 4) {                // concrete: stains, tyre marks
    float n = vn(uv * 0.7) * 0.6 + vn(uv * 5.0) * 0.4;
    albedo *= 0.7 + 0.45 * n;
    float tmx = (abs(uv.x) - 0.82) / 0.12;
    float tm = exp(-tmx * tmx) * 0.5 * step(-3.0, uv.y);
    albedo *= 1.0 - tm * 0.6;
    rough = mix(rough, 0.35, n * 0.4);
  } else if (pat == 5) {                // corrugated door: ribs catch the light
    float r = fract(uv.y / 0.09);
    N = normalize(N + vec3(0.0, (r - 0.5) * 0.9, 0.0));
    albedo *= 0.85 + 0.15 * vn(uv * 3.0);
  } else if (pat == 6) {                // painted block wall
    vec2 b = fract(vec2(uv.x / 0.4 + floor(uv.y / 0.2) * 0.5, uv.y / 0.2));
    float mortar = step(0.96, b.x) + step(0.92, b.y);
    albedo *= (0.9 + 0.1 * vn(uv * 6.0)) * (1.0 - 0.25 * min(mortar, 1.0));
  } else if (pat == 7) {                // tool chest drawers
    float d = step(0.93, fract(uv.y / 0.14));
    albedo *= 1.0 - 0.5 * d;
    emis += vec3(0.02) * step(0.45, fract(uv.x)) * step(fract(uv.x), 0.55) * step(0.3, fract(uv.y / 0.14)) * step(fract(uv.y / 0.14), 0.4);
  } else if (pat == 8) {                // armco: grooves, a reflector every 4 m
    float gr = sin(uv.y * 18.0);
    N = normalize(N + vec3(0.0, gr * 0.35, 0.0));
    float refl = step(fract(uv.x / 4.0), 0.03) * step(0.35, uv.y) * step(uv.y, 0.5);
    emis += vec3(0.9, 0.55, 0.1) * refl * 0.0;
    albedo = mix(albedo, vec3(1.0, 0.6, 0.1), refl);
    rough = mix(rough, 0.05, refl);
  } else if (pat == 9) {                // tunnel tiles with grime
    vec2 t = fract(uv / vec2(0.3, 0.15));
    float m = step(0.94, t.x) + step(0.9, t.y);
    albedo *= (0.85 + 0.2 * vn(uv * 2.0)) * (1.0 - 0.3 * min(m, 1.0)) * (0.55 + 0.45 * smoothstep(0.0, 2.5, uv.y));
  } else if (pat == 10) {               // grandstand: rows of seats
    float row = fract(uv.y / 0.9);
    albedo *= 0.7 + 0.5 * step(0.5, row);
    emis += vec3(1.0, 0.75, 0.45) * 0.6 * step(0.985, fract(uv.x / 9.0)) * step(row, 0.1);
  } else if (pat == 11) {               // pit building: lit windows upstairs, garage numbers below
    vec2 w = fract(vec2(uv.x / 3.2, (uv.y - 4.1) / 2.2));
    float win = step(4.3, uv.y) * step(uv.y, 6.1) * step(0.12, w.x) * step(w.x, 0.88);
    float lit = step(0.45, h12(floor(vec2(uv.x / 3.2, 1.0))));
    emis += vec3(0.85, 0.8, 0.65) * win * lit * 0.35;
    albedo = mix(albedo, vec3(0.02, 0.025, 0.03), win);
  } else if (pat == 12) {               // paint: a little flake
    rough = 0.12 + 0.05 * vn(uv * 200.0);
    spec = 2.5;
  }
  vec3 V = normalize(uCam - vP);
  float shin = mix(220.0, 6.0, rough);
  float ks = mix(0.9, 0.03, rough) * spec;
  vec3 col = albedo * mix(uAmb * 0.4, uAmb, N.y * 0.5 + 0.5);
  for (int i = 0; i < ${MAXL}; i++) {
    if (i >= uLN) break;
    vec3 L = uLP[i].xyz - vP;
    float d = length(L);
    L /= max(d, 1e-4);
    float range = uLP[i].w;
    float x = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0);
    float att = x * x / (d * d * 0.5 + 1.0);
    float cs = uLC[i].a;
    if (cs > -1.5) att *= smoothstep(cs, cs + 0.08, dot(-L, uLD[i]));
    float ndl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), shin) * ks * (shin + 8.0) / 30.0;
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    col += uLC[i].rgb * att * (albedo * ndl + sp * mix(fres, 1.0, 0.3) * ndl);
  }
  col += emis;
  float dist = length(vP - uCam);
  float fog = 1.0 - exp(-dist * uFogD);
  col = mix(col, uFog, fog * (1.0 - min(1.0, length(emis))));
  outColor = vec4(col, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform float uTime, uAmount, uGlow;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec4 a = uInvVP * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float h = d.y;
  vec3 col = mix(vec3(0.010, 0.013, 0.028), vec3(0.0015, 0.002, 0.006), smoothstep(-0.02, 0.5, h));
  // the city's glow and the circuit's own haze on the horizon
  col += vec3(0.05, 0.03, 0.018) * exp(-max(h, 0.0) * 22.0) * uGlow;
  vec2 sp = vec2(atan(d.x, -d.z), asin(clamp(h, -1.0, 1.0)));
  for (int k = 0; k < 2; k++) {
    float sc = 140.0 + float(k) * 160.0;
    vec2 c = floor(sp * sc);
    float s = h12(c + float(k) * 17.0);
    vec2 o = vec2(h12(c + 3.1), h12(c + 7.7)) - 0.5;
    float star = step(0.978, s) * (1.0 - smoothstep(0.0, 0.16, length(fract(sp * sc) - 0.5 - o * 0.6)));
    col += vec3(0.75, 0.82, 1.0) * star * (s - 0.96) * 18.0 * smoothstep(0.02, 0.15, h);
  }
  // a distant skyline of tiny lights below the glow
  float sky = step(h, 0.012 + 0.008 * h12(vec2(floor(sp.x * 90.0), 1.0))) * step(-0.02, h);
  col = mix(col, vec3(0.006, 0.006, 0.008), sky);
  vec2 wc = floor(vec2(sp.x * 700.0, h * 700.0));
  col += vec3(1.0, 0.8, 0.5) * step(0.93, h12(wc)) * sky * 0.25;
  outColor = vec4(col * uAmount, 1.0);
}`;

// the cockpit, in screen space: roof, pillars, mirror, the hood through the glass, dash, cluster, wheel and LEDs
const COCKPIT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform vec2 uShake;
uniform float uSteer, uDash, uLeds, uBlink, uHood, uAmbient, uTime, uAlpha;
uniform vec3 uHoodCol, uEnv;
uniform sampler2D uCluster;
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float inside(float d, float w) { return 1.0 - smoothstep(-w, w, d); } // 1 where d < 0, antialiased
float sq(float x) { return x * x; }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec4 over(vec4 a, vec4 b) { return vec4(b.rgb * b.a + a.rgb * (1.0 - b.a), b.a + a.a * (1.0 - b.a)); }
void main() {
  // on a portrait screen the cockpit shrinks to fit the width and stays anchored at the bottom
  float asp0 = uRes.x / uRes.y;
  float sc = clamp(asp0 / 1.6, 0.42, 1.0);
  vec2 p = (vUv - 0.5) * vec2(asp0, 1.0) / sc + vec2(0.0, (1.0 / sc - 1.0) * 0.5) + uShake;
  float asp = asp0 / sc;
  float px = 1.5 / uRes.y / sc;
  vec4 o = vec4(0.0);
  vec3 dark = vec3(0.006, 0.006, 0.007) + uEnv * 0.04;
  // the hood and the tops of the front wings, through the windscreen
  float wing = smoothstep(0.18, 0.62, abs(p.x) / asp * 2.0);
  float hoodTop = -0.235 + 0.07 * wing * wing - 0.012 * cos(p.x * 3.0);
  float hood = inside(p.y - hoodTop, px);
  float band = exp(-sq((p.y - hoodTop + 0.02 + 0.015 * wing) / 0.012));
  vec3 paint = vec3(0.85, 0.32, 0.04);
  vec3 hoodC = paint * (0.012 + 0.05 * length(uEnv)) * (0.7 + 0.3 * sin(p.x * 2.0 + 1.0)) + uHoodCol * band * 0.6 + dark * 0.5;
  o = over(o, vec4(hoodC, hood));
  // dash: a hump over the instruments
  float hump = exp(-sq(sq(p.x / 0.36)) * sq(p.x / 0.36));
  float dashTop = -0.31 + 0.1 * hump - 0.04 * smoothstep(0.4, 1.0, abs(p.x) / asp * 2.0);
  float dash = inside(p.y - dashTop, px);
  vec3 dashC = dark * 1.2 + vec3(0.02, 0.03, 0.045) * uDash * exp(-sq((p.y - dashTop) / 0.02)) * hump;
  o = over(o, vec4(dashC, dash));
  // the instrument screen, inset in the hump
  vec2 cq = (p - vec2(0.0, -0.283)) / vec2(0.3, 0.066);
  float cl = inside(sdBox(cq * vec2(0.3, 0.066), vec2(0.3, 0.066), 0.02), px * 2.0);
  vec3 cc = texture(uCluster, vec2(cq.x * 0.5 + 0.5, 0.5 - cq.y * 0.5)).rgb * uDash;
  o = over(o, vec4(cc + vec3(0.002), cl * smoothstep(-1.02, -0.98, -abs(cq.x)) * smoothstep(-1.02, -0.98, -abs(cq.y))));
  // A-pillars and roof, raked
  float lp = (p.x + asp * 0.5) - (0.035 + 0.2 * (p.y + 0.5));
  float rp = (asp * 0.5 - p.x) - (0.035 + 0.2 * (p.y + 0.5));
  float pil = max(inside(lp, px), inside(rp, px));
  float roof = smoothstep(0.405 - 0.035 * p.x * p.x - px, 0.405 - 0.035 * p.x * p.x + px, p.y);
  o = over(o, vec4(vec3(0.0025, 0.0025, 0.003) + uEnv * 0.004 * (0.5 + 0.5 * p.y), max(pil, roof)));
  // mirror
  float mr = sdBox(p - vec2(0.0, 0.37), vec2(0.13, 0.034), 0.02);
  vec3 mc = vec3(0.003) + uEnv * 0.02 * (0.7 + 0.3 * sin(p.x * 9.0 + uTime * 0.3)) * (0.6 + 0.4 * (p.y - 0.337) / 0.07);
  o = over(o, vec4(mc, inside(mr, px)));
  // steering wheel: thick rim, spokes, a stripe at twelve o'clock, LEDs along the top
  vec2 wc = p - vec2(0.0, -0.87);
  float cs = cos(uSteer), sn = sin(uSteer);
  vec2 q = vec2(cs * wc.x + sn * wc.y, -sn * wc.x + cs * wc.y);
  float R = 0.5;
  float rim = abs(length(q * vec2(1.0, 1.08)) - R) - 0.034;
  float spokes = min(sdBox(q - vec2(0.0, -0.03), vec2(R, 0.022), 0.01), sdBox(q - vec2(0.0, -0.2), vec2(0.03, 0.2), 0.02));
  float hub = sdBox(q - vec2(0.0, -0.04), vec2(0.14, 0.085), 0.05);
  float wheel = min(rim, min(spokes, hub));
  float ang = atan(q.x, q.y);
  vec3 wcol = vec3(0.012, 0.012, 0.014) + uEnv * 0.03 + vec3(0.03, 0.04, 0.06) * uDash * smoothstep(0.0, R, -q.y + R) * 0.0;
  wcol += vec3(0.04, 0.05, 0.07) * uDash * exp(-sq((length(q) - R + 0.02) / 0.015)) * step(0.0, q.y) * 0.6;
  wcol = mix(wcol, vec3(0.5, 0.35, 0.02), step(abs(ang), 0.035) * step(R - 0.04, length(q)) * smoothstep(0.0, px, -rim));
  o = over(o, vec4(wcol, inside(wheel, px)));
  // shift lights: ten LEDs on the top of the rim, green -> red -> blue, flashing at the shift point
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float a = mix(-0.3, 0.3, fi / 9.0);
    vec2 lp2 = vec2(sin(a), cos(a)) * (R + 0.002) * vec2(1.0, 1.0 / 1.08);
    float d = length(q - lp2);
    float on = step(fi + 0.5, uLeds * 10.0);
    vec3 lc = fi < 4.0 ? vec3(0.1, 1.0, 0.2) : fi < 8.0 ? vec3(1.0, 0.1, 0.05) : vec3(0.2, 0.4, 1.0);
    if (uBlink > 0.5) lc = vec3(0.25, 0.45, 1.0);
    float led = 1.0 - smoothstep(0.0045, 0.0065, d);
    o.rgb += lc * on * (led * 2.2 + exp(-d * d / 0.00012) * 0.25) * uDash * (uBlink > 0.5 ? step(0.5, fract(uTime * 9.0)) : 1.0);
    o.rgb += vec3(0.02) * led * (1.0 - on) * uDash;
  }
  o.rgb += dark * 0.0;
  outColor = vec4(o.rgb * uAlpha, o.a * uAlpha);
}`;

// ---------------------------------------------------------------- mesh building
class MB {
  constructor() {
    this.d = [];
  }

  tri(a, b, c, n, ua, ub, uc, m) {
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]]) this.d.push(p[0], p[1], p[2], n[0], n[1], n[2], u[0], u[1], m);
  }

  /** Quad a b c d (counter-clockwise seen from the front), uv per corner. */
  quad(a, b, c, d, m, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(d, a)));
    this.tri(a, b, c, n, uv[0], uv[1], uv[2], m);
    this.tri(a, c, d, n, uv[0], uv[2], uv[3], m);
  }

  /** Box centred at c (x, y, z), size s, rotated rotY (model convention: -heading). uv in metres. */
  box(c, s, m, rotY = 0, { skipBottom = true, skip = [] } = {}) {
    const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
    const cy = Math.cos(rotY), sy = Math.sin(rotY);
    const P = (x, y, z) => [c[0] + x * cy + z * sy, c[1] + y, c[2] - x * sy + z * cy];
    const faces = [
      ['px', [hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], s[2], s[1]],
      ['nx', [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], s[2], s[1]],
      ['pz', [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], s[0], s[1]],
      ['nz', [hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], s[0], s[1]],
      ['py', [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], s[0], s[2]],
      ['ny', [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], s[0], s[2]],
    ];
    for (const [k, a, b, cc, d, w, h] of faces) {
      if ((k === 'ny' && skipBottom) || skip.includes(k)) continue;
      this.quad(P(...a), P(...b), P(...cc), P(...d), m, [[0, 0], [w, 0], [w, h], [0, h]]);
    }
  }

  /** Vertical cylinder at c (base), radius r, height h. */
  cyl(c, r, h, m, seg = 12) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [c[0] + Math.cos(a0) * r, c[1], c[2] + Math.sin(a0) * r];
      const p1 = [c[0] + Math.cos(a1) * r, c[1], c[2] + Math.sin(a1) * r];
      this.quad(p1, p0, [p0[0], c[1] + h, p0[2]], [p1[0], c[1] + h, p1[2]], m, [[a1 * r, 0], [a0 * r, 0], [a0 * r, h], [a1 * r, h]]);
      this.tri([c[0], c[1] + h, c[2]], [p1[0], c[1] + h, p1[2]], [p0[0], c[1] + h, p0[2]], [0, 1, 0], [0, 0], [1, 0], [0, 1], m);
    }
  }

  /** A strip along the path between lateral offsets u0..u1 (+ = right), at height y; uv = (u, s). */
  ribbon(path, s0, s1, u0, u1, m, { y = 0, ds = 2, uOff = () => 0 } = {}) {
    for (let s = s0; s < s1; s += ds) {
      const sb = Math.min(s1, s + ds);
      const a0 = path.point(s, u0 + uOff(s), y), a1 = path.point(s, u1 + uOff(s), y);
      const b0 = path.point(sb, u0 + uOff(sb), y), b1 = path.point(sb, u1 + uOff(sb), y);
      // up-facing: a0 -> a1 -> b1 -> b0 must be counter-clockwise from above
      this.quad(a0, b0, b1, a1, m, [[u0, s], [u0, sb], [u1, sb], [u1, s]]);
    }
  }

  /** A vertical wall along the path at lateral u, from y0 to y1, facing towards facing (+1 right / -1 left). */
  wallAlong(path, s0, s1, u, y0, y1, m, facing, ds = 3) {
    for (let s = s0; s < s1; s += ds) {
      const sb = Math.min(s1, s + ds);
      const a = path.point(s, u, y0), b = path.point(sb, u, y0), c = path.point(sb, u, y1), d = path.point(s, u, y1);
      if (facing > 0) this.quad(a, b, c, d, m, [[s, y0], [sb, y0], [sb, y1], [s, y1]]);
      else this.quad(b, a, d, c, m, [[sb, y0], [s, y0], [s, y1], [sb, y1]]);
    }
  }

  build(gl) {
    return new StaticBuffer(gl, [[0, 3], [1, 3], [2, 2], [3, 1]], new Float32Array(this.d));
  }
}

// ---------------------------------------------------------------- the scene
export class Scene extends StageScene {
  constructor(app, score, run) {
    super(app, score, run);
    this.M = score.marks;
    this.ctl = score.ctl;
    this.path = score.path;
    this.seg = score.segAt;
  }

  async init() {
    const gl = this.gl;
    this.prog = new Program(gl, WORLD_VS, WORLD_FS, 'cold-world');
    this.sky = new Program(gl, FULLSCREEN_VS, SKY_FS, 'cold-sky');
    this.cockpit = new Program(gl, FULLSCREEN_VS, COCKPIT_FS, 'cold-cockpit');
    this.sprites = spriteProgram(gl);
    this.spriteBuf = new DynBuffer(gl, [[0, 3], [1, 4]], 1200);
    this.lamps = [];
    this.tunnelLamps = [];
    this._buildWorld();
    this._buildCar();
    this._buildDoor();
    // material uniforms
    this.matA = new Float32Array(MAT_IDS.length * 4);
    this.matE = new Float32Array(MAT_IDS.length * 4);
    MAT_IDS.forEach((k, i) => {
      const [a, r, e, p] = MAT[k];
      this.matA.set([...a, r], i * 4);
      this.matE.set([...e, p], i * 4);
    });
    this.baseE = this.matE.slice();
    // the rev counter, drawn on a little canvas and shown on the dash
    this.cv = document.createElement('canvas');
    this.cv.width = 768;
    this.cv.height = 180;
    this.cg = this.cv.getContext('2d');
    this.ctex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.ctex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._cluster(0, true);
    this.lbuf = { P: new Float32Array(MAXL * 4), C: new Float32Array(MAXL * 4), D: new Float32Array(MAXL * 3) };
    this.shifts = this.score.shifts;
    this.bangs = this.score.bangs;
    this.pops = this.score.pops;
  }

  // ---------------------------------------------------------------- the world
  _buildWorld() {
    const gl = this.gl;
    const P = this.path, S = this.seg;
    const mb = new MB();
    const m = MID;
    const rng = new Rng(808);
    // ground
    const c = P.point(P.length * 0.45);
    const G = 2600;
    mb.quad([c[0] - G, -0.03, c[2] + G], [c[0] + G, -0.03, c[2] + G], [c[0] + G, -0.03, c[2] - G], [c[0] - G, -0.03, c[2] - G], m.grass,
      [[0, 0], [2 * G, 0], [2 * G, 2 * G], [0, 2 * G]].map(([u, v]) => [u * 0.5, v * 0.5]));
    // the garage interior (car parked at s = 0, facing -z; door at z = -4.4)
    const gw = 6.2, gz0 = -4.4, gz1 = 3.4, gh = 3.3;
    mb.quad([-gw / 2, 0.002, gz1], [gw / 2, 0.002, gz1], [gw / 2, 0.002, gz0], [-gw / 2, 0.002, gz0], m.concrete, [[-3.1, gz1], [3.1, gz1], [3.1, gz0], [-3.1, gz0]]);
    mb.quad([gw / 2, 0, gz1], [-gw / 2, 0, gz1], [-gw / 2, gh, gz1], [gw / 2, gh, gz1], m.wall, [[6.2, 0], [0, 0], [0, gh], [6.2, gh]]); // back
    mb.quad([-gw / 2, 0, gz1], [-gw / 2, 0, gz0], [-gw / 2, gh, gz0], [-gw / 2, gh, gz1], m.wall, [[0, 0], [7.8, 0], [7.8, gh], [0, gh]]); // left
    mb.quad([gw / 2, 0, gz0], [gw / 2, 0, gz1], [gw / 2, gh, gz1], [gw / 2, gh, gz0], m.wall, [[0, 0], [7.8, 0], [7.8, gh], [0, gh]]); // right
    mb.quad([-gw / 2, gh, gz0], [gw / 2, gh, gz0], [gw / 2, gh, gz1], [-gw / 2, gh, gz1], m.ceiling); // ceiling (faces down)
    mb.quad([-gw / 2, gh, gz0 - 0.01], [gw / 2, gh, gz0 - 0.01], [gw / 2, gh + 0.4, gz0 - 0.01], [-gw / 2, gh + 0.4, gz0 - 0.01], m.wallDark); // lintel
    // tubes
    for (const [x, z] of [[-1.25, -1.6], [1.25, 1.1]]) {
      mb.box([x, gh - 0.06, z], [0.16, 0.06, 1.3], m.wallDark);
      mb.box([x, gh - 0.105, z], [0.05, 0.04, 1.2], m.tube, 0, { skipBottom: false });
    }
    // bench and shelves along the left wall, tool chest on the right, tyres in the back corner
    mb.box([-gw / 2 + 0.35, 0.45, -0.8], [0.7, 0.9, 2.6], m.bench);
    mb.box([-gw / 2 + 0.3, 1.55, -0.8], [0.5, 0.04, 2.6], m.bench);
    mb.box([-gw / 2 + 0.3, 2.05, -0.8], [0.5, 0.04, 2.6], m.bench);
    for (let i = 0; i < 7; i++) mb.box([-gw / 2 + 0.25, 1.62 + rng.range(0, 0.15), -1.9 + i * 0.36], [0.28, rng.range(0.1, 0.3), 0.22], i % 3 ? m.wallDark : m.chest);
    mb.box([gw / 2 - 0.35, 0.55, -2.4], [0.6, 1.1, 1.1], m.chest, 0);
    mb.box([gw / 2 - 0.35, 1.13, -2.4], [0.62, 0.06, 1.12], m.wallDark);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) mb.cyl([gw / 2 - 0.5 - j * 0.7, 0, gz1 - 0.5], 0.33, 0.25 + i * 0.26, m.tyre, 16);
    // workbench and pegboard on the back wall (seen when the car comes back nose-in)
    mb.box([-1.2, 0.47, gz1 - 0.35], [2.4, 0.94, 0.7], m.bench);
    mb.box([-1.2, 1.7, gz1 - 0.03], [2.4, 1.2, 0.05], m.wallDark);
    for (let i = 0; i < 14; i++) mb.box([-2.3 + (i % 7) * 0.32, 1.35 + Math.floor(i / 7) * 0.5, gz1 - 0.07], [0.04, rng.range(0.15, 0.35), 0.03], m.armco);
    mb.box([1.4, 2.25, gz1 - 0.03], [0.6, 0.6, 0.03], m.sign); // a lit sign on the back wall
    // pit building facade, with our door and the neighbours'
    const fz = gz0, fh = 7.2;
    const xs = [-160, -gw / 2, gw / 2, 260];
    mb.quad([xs[0], 0, fz], [xs[1], 0, fz], [xs[1], fh, fz], [xs[0], fh, fz], m.facade, [[xs[0], 0], [xs[1], 0], [xs[1], fh], [xs[0], fh]].map(([u, v]) => [u, v]));
    mb.quad([xs[2], 0, fz], [xs[3], 0, fz], [xs[3], fh, fz], [xs[2], fh, fz], m.facade, [[xs[2], 0], [xs[3], 0], [xs[3], fh], [xs[2], fh]]);
    mb.quad([xs[1], gh, fz], [xs[2], gh, fz], [xs[2], fh, fz], [xs[1], fh, fz], m.facade, [[xs[1], gh], [xs[2], gh], [xs[2], fh], [xs[1], fh]]);
    mb.quad([xs[0], fh, fz], [xs[3], fh, fz], [xs[3], fh, 14], [xs[0], fh, 14], m.wallDark); // roof
    for (let x = -150; x < 255; x += 8) {
      if (Math.abs(x) < 6) continue;
      mb.quad([x - 3, 0.01, fz - 0.02], [x + 3, 0.01, fz - 0.02], [x + 3, 3.2, fz - 0.02], [x - 3, 3.2, fz - 0.02], m.doorOther, [[0, 0], [6, 0], [6, 3.2], [0, 3.2]]);
      mb.box([x, 3.55, fz - 0.15], [4.5, 0.08, 0.25], rng.chance(0.6) ? m.lampHead : m.wallDark);
    }
    mb.box([0, 3.55, fz - 0.15], [4.5, 0.08, 0.25], m.lampHead);
    // apron outside our door
    mb.quad([-160, 0.004, fz], [260, 0.004, fz], [260, 0.004, fz - 8.6], [-160, 0.004, fz - 8.6], m.apron, [[-160, 0], [260, 0], [260, 8.6], [-160, 8.6]]);
    // the drive path: pit lane then the track, plus the main straight upstream of the pit exit
    mb.ribbon(P, 6, S.pitIn.s1, -4, 4, m.pit, { y: 0.006 });
    mb.ribbon(P, S.pitIn.s1, S.merge1.s0, -4.5, 4.5, m.pit, { y: 0.006 });
    mb.ribbon(P, S.merge1.s0, P.length, -6, 6, m.asphalt, { y: 0.008, ds: 2 });
    {
      const e = P.at(S.merge2.s1);
      const back = { point: (s, u, y) => [e.x + Math.sin(e.h) * (s - 700) + Math.cos(e.h) * u, y, e.z - Math.cos(e.h) * (s - 700) + Math.sin(e.h) * u] };
      mb.ribbon(back, 0, 700, -6, 6, m.asphalt, { y: 0.008, ds: 4 });
      // grandstands across the main straight, and its pit wall
      for (let k = 0; k < 6; k++) {
        const y0 = 1 + k * 1.1, u0 = -16 - k * 2.4;
        const a = back.point(300, u0, y0), b = back.point(780, u0, y0);
        const a2 = back.point(300, u0 - 2.4, y0), b2 = back.point(780, u0 - 2.4, y0);
        mb.quad(a2, b2, b, a, m.stand, [[300, k * 2.4], [780, k * 2.4], [780, k * 2.4 + 0.9], [300, k * 2.4 + 0.9]]);
        const a3 = back.point(300, u0, y0 - 1.1), b3 = back.point(780, u0, y0 - 1.1);
        mb.quad(a3, b3, b, a, m.wallDark);
      }
      const ra = back.point(300, -14, 9.5), rb = back.point(780, -14, 9.5), rc = back.point(780, -32, 11), rd = back.point(300, -32, 11);
      mb.quad(rd, rc, rb, ra, m.wallDark);
      mb.quad(ra, rb, rc, rd, m.wallDark);
      for (let s = 0; s < 700; s += 4) mb.box(back.point(s, 8.5, 0.6), [0.35, 1.2, 4.1], m.concrete, -e.h);
      for (let s = 40; s < 700; s += 60) this._lamp(mb, back.point(s, -10, 0), e.h, -1);
    }
    // pit wall between the pit lane and the track
    for (let s = S.pitIn.s1 + 4; s < S.merge1.s0 + 40; s += 4) mb.box(P.point(s, -5.6, 0.6), [0.35, 1.2, 4.1], m.concrete, -P.at(s).h);
    // kerbs on the tight corners, barriers, lamps, the tunnel
    for (const name of ['T1', 'T4', 'T3']) {
      const sg = S[name];
      const ins = Math.sign(sg.sg.ang);
      mb.ribbon(P, sg.s0 - 12, sg.s1 + 14, ins > 0 ? 5.7 : -7.1, ins > 0 ? 7.1 : -5.7, m.kerb, { y: 0.02 });
      if (sg.sg.r < 60) mb.ribbon(P, sg.s1 - 10, sg.s1 + 30, ins > 0 ? -7.1 : 5.7, ins > 0 ? -5.7 : 7.1, m.kerb, { y: 0.02 });
    }
    const tun = S.tunnel;
    const segs = [[S.merge2.s1, tun.s0 - 2], [tun.s1 + 2, P.length]];
    for (const [a, b] of segs) {
      mb.wallAlong(P, a, b, -10.5, 0.1, 0.85, m.armco, 1);
      mb.wallAlong(P, a, b, 10.5, 0.1, 0.85, m.armco, -1);
    }
    let side = 1;
    for (let s = S.pitIn.s1 + 10; s < S.merge1.s0; s += 32) this._lamp(mb, P.point(s, 6.5, 0), P.at(s).h, 1);
    for (let s = S.merge2.s1 + 20; s < P.length; s += 46) {
      if (s > tun.s0 - 15 && s < tun.s1 + 15) continue;
      this._lamp(mb, P.point(s, 12.5 * side, 0), P.at(s).h, side);
      side = -side;
    }
    // tunnel: walls, ceiling, a portal at each end, sodium lamps down the middle
    mb.wallAlong(P, tun.s0, tun.s1, -7.8, 0, 6.4, m.tunnel, 1, 4);
    mb.wallAlong(P, tun.s0, tun.s1, 7.8, 0, 6.4, m.tunnel, -1, 4);
    mb.ribbon(P, tun.s0, tun.s1, -7.8, 7.8, m.tunnel, { y: 6.4, ds: 4 });
    for (const s of [tun.s0, tun.s1]) {
      const h = P.at(s).h;
      for (const u of [-12, 12]) mb.box(P.point(s, u, 0), [8.5, 9, 1.2], m.wallDark, -h, {});
      mb.box(P.point(s, 0, 7.6), [25, 2.4, 1.2], m.wallDark, -h);
    }
    for (let s = tun.s0 + 3; s < tun.s1; s += 7) {
      const h = P.at(s).h;
      for (const u of [-3.2, 3.2]) {
        mb.box(P.point(s, u, 6.32), [0.32, 0.1, 2.6], m.sodium, -h, { skipBottom: false });
      }
      this.tunnelLamps.push({ p: P.point(s, 0, 6.1), s });
    }
    this.world = mb.build(gl);
    void gl;
  }

  _lamp(mb, base, h, side) {
    const m = MID;
    // pole on the outside, arm reaching over the track edge
    const ox = Math.cos(h) * side, oz = Math.sin(h) * side;
    mb.box([base[0], 4.6, base[2]], [0.22, 9.2, 0.22], m.pole, -h);
    const ax = base[0] - ox * 1.4, az = base[2] - oz * 1.4;
    mb.box([ax, 9.1, az], [0.12, 0.12, 2.9], m.pole, -h + Math.PI / 2);
    const hx = base[0] - ox * 2.6, hz = base[2] - oz * 2.6;
    mb.box([hx, 9.0, hz], [0.9, 0.14, 0.42], m.lampHead, -h, { skipBottom: false });
    this.lamps.push({ p: [hx, 8.85, hz], side });
  }

  /** The car (for the trackside pass): a lofted body, glass, wheels, lights. */
  _buildCar() {
    const mb = new MB();
    const m = MID;
    // stations along the car: [z (forward +), half width, top, bottom]
    const ST = [[-2.32, 0.9, 0.98, 0.32], [-2.1, 0.99, 1.04, 0.2], [-1.3, 1.02, 1.08, 0.15], [-0.45, 0.96, 1.16, 0.15], [0.25, 0.9, 1.16, 0.15],
      [0.95, 0.98, 0.86, 0.15], [1.55, 1.0, 0.72, 0.16], [2.0, 0.92, 0.5, 0.18], [2.12, 0.7, 0.38, 0.22]];
    const N = 18;
    const ring = (st) => {
      const [z, w, top, bot] = st;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI; // 0 = right bottom, PI = left bottom, over the top
        const cx = Math.cos(a), sy = Math.sin(a);
        const ex = Math.sign(cx) * Math.pow(Math.abs(cx), 0.45);
        const ey = Math.pow(Math.max(0, sy), 0.55);
        pts.push([ex * w, bot + (top - bot) * ey, z]);
      }
      return pts;
    };
    const rings = ST.map(ring);
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], B = rings[k + 1];
      for (let i = 0; i < N; i++) {
        const glassBand = ST[k][0] >= -0.45 && ST[k][0] < 0.95 && i > 3 && i < N - 3;
        const mat = glassBand ? m.glass : m.paint;
        mb.quad(A[i + 1], A[i], B[i], B[i + 1], mat, [[i, k], [i + 1, k], [i + 1, k + 1], [i, k + 1]]);
      }
    }
    const capR = rings[0], capF = rings[rings.length - 1];
    for (let i = 0; i < N; i++) {
      mb.tri([0, 0.5, capR[0][2]], capR[i], capR[i + 1], [0, 0, -1], [0, 0], [1, 0], [0, 1], m.carDark);
      mb.tri([0, 0.3, capF[0][2]], capF[i + 1], capF[i], [0, 0, 1], [0, 0], [1, 0], [0, 1], m.paint);
    }
    // wheels
    for (const z of [-1.3, 1.42]) for (const x of [-0.86, 0.86]) {
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2, r = 0.345;
        const p = (a, xx) => [xx, 0.345 + Math.sin(a) * r, z + Math.cos(a) * r];
        mb.quad(p(a0, x - 0.15), p(a1, x - 0.15), p(a1, x + 0.15), p(a0, x + 0.15), m.tyre);
      }
    }
    // lights: slim headlamps, a full-width tail light bar
    for (const x of [-0.62, 0.62]) mb.box([x, 0.62, 2.0], [0.42, 0.05, 0.08], m.headlamp, 0, { skipBottom: false });
    mb.box([0, 0.86, -2.33], [1.7, 0.045, 0.04], m.taillamp, 0, { skipBottom: false });
    this.car = mb.build(this.gl);
  }

  _buildDoor() {
    const mb = new MB();
    mb.quad([-3.1, 0, 0], [3.1, 0, 0], [3.1, 3.3, 0], [-3.1, 3.3, 0], MID.door, [[0, 0], [6.2, 0], [6.2, 3.3], [0, 3.3]]);
    mb.quad([3.1, 0, 0.01], [-3.1, 0, 0.01], [-3.1, 3.3, 0.01], [3.1, 3.3, 0.01], MID.door, [[0, 0], [6.2, 0], [6.2, 3.3], [0, 3.3]]);
    this.door = mb.build(this.gl);
  }

  // ---------------------------------------------------------------- what happens when
  _view(t) {
    const M = this.M;
    if (t >= M.cut && t < M.black) return 'track';
    if (t >= M.black && t < M.back) return 'black';
    return 'car';
  }

  _rpm(t) {
    return this.ctl.at('rpm', t);
  }

  _tubes(t) {
    const M = this.M;
    // the strike flicker, then steady; a shiver on the bang; dimmer once the door is open
    const fl = (t0, strikes) => {
      if (t < t0) return 0;
      const x = t - t0;
      for (let i = 0; i < strikes.length; i++) if (x < strikes[i]) return i % 2 ? 0.9 : 0.05;
      return 1;
    };
    const a = fl(M.tubes, [0.04, 0.21, 0.26, 0.36, 0.45, 0.71]);
    const b = fl(M.tubes + 1.05, [0.05, 0.14, 0.2, 0.62]);
    let k = 0;
    for (const bg of this.bangs) if (t > bg.t && t < bg.t + 0.4) k = Math.max(k, Math.sin((t - bg.t) * 90) > 0 ? 0.5 : 0);
    return [a * (1 - k), b * (1 - k)];
  }

  _carPose(t) {
    const M = this.M;
    if (t >= M.black) return { p: [0, 0.45, -0.55], h: Math.PI, s: 0 };
    return this.score.carAt(t);
  }

  _camera(t, w, h) {
    const M = this.M;
    const view = this._view(t);
    if (view === 'track') {
      const ear = this.score.ear;
      const face = this.score.face;
      const sway = [Math.sin(t * 0.7) * 0.03, Math.sin(t * 1.1 + 1) * 0.02];
      const eye = [ear[0] + sway[0], ear[1] + sway[1], ear[2]];
      const tgt = [ear[0] + Math.sin(face - 0.06) * 50, ear[1] - 0.9, ear[2] - Math.cos(face - 0.06) * 50];
      return this.camera(eye, tgt, 0.62, w, h, { near: 0.1, far: 3000 });
    }
    const q = this._carPose(t);
    const H = q.h;
    const fwd = [Math.sin(H), 0, -Math.cos(H)], right = [Math.cos(H), 0, Math.sin(H)];
    const v = this.ctl.at('speed', t);
    const rpm = this._rpm(t);
    // the body moves: engine shake at idle, the road at speed, pitch under braking and acceleration, roll in corners
    const idleShake = rpm > 200 && rpm < 1600 ? 0.0012 * (1 + this.ctl.at('cold', t)) : rpm > 200 ? 0.0006 : 0;
    const road = 0.0005 + 0.0035 * Math.min(1, v / 70);
    const sh = (f, a) => Math.sin(t * f) * a + Math.sin(t * f * 1.73 + 1.3) * a * 0.6;
    const brake = this.ctl.at('brake', t), th = this.ctl.at('throttle', t);
    const pitch = -0.025 * brake * (v > 2 ? 1 : 0) + 0.012 * th * (v > 2 && v < 50 ? 1 : 0);
    const lat = this.ctl.at('latG', t);
    let flare = 0;
    if (t > M.catch && t < M.catch + 1.5) flare = Math.exp(-(t - M.catch - 0.3) * 4) * 0.01;
    const eye = v3.add(v3.add(q.p, v3.scale(right, -0.36)), [sh(61, idleShake + road) + sh(7, road), 0.62 + sh(47, idleShake * 1.4 + road) + flare * Math.sin(t * 70), 0]);
    const yaw = -0.18 * Math.tanh(this.path.kSmooth(q.s + 25, 15) * 40) * (v > 5 ? 1 : 0);
    const dir = [Math.sin(H + yaw), pitch - 0.035, -Math.cos(H + yaw)];
    const tgt = v3.add(eye, dir);
    const fov = 1.0 + 0.1 * Math.min(1, v / 75);
    return this.camera(eye, tgt, fov, w, h, { roll: lat * 0.012, near: 0.05, far: 3000 });
  }

  // ---------------------------------------------------------------- lights
  _lights(t, cam) {
    const L = [];
    const M = this.M;
    const add = (p, col, range, dir = null, cos = -2) => L.push({ p, col, range, dir, cos });
    const [ta, tb] = this._tubes(t);
    const garageVis = cam.eye[2] > -30 && Math.abs(cam.eye[0]) < 40;
    if (garageVis) {
      add([-1.25, 3.1, -1.6], [2.2, 2.45, 2.7].map((x) => x * ta), 9);
      add([1.25, 3.1, 1.1], [2.2, 2.45, 2.7].map((x) => x * tb), 9);
      add([0, 3.4, -5.0], [1.4, 1.3, 1.1], 10, [0, -1, 0], Math.cos(1.1)); // the light over our door
      if (t > M.back) add([1.4, 2.25, 3.2], [0.6, 0.2, 0.1], 3);
    }
    // the car's headlamps (ours in the cockpit; the passing car's from the side of the track)
    const q = this._carPose(t);
    const on = (t > M.door + 1.5 && t < M.black) || this._view(t) === 'track';
    if (on) {
      const fwd = [Math.sin(q.h), -0.028, -Math.cos(q.h)];
      for (const s of [-0.62, 0.62]) {
        const p = v3.add(q.p, [Math.cos(q.h) * s + Math.sin(q.h) * 2.1, 0.2, Math.sin(q.h) * s - Math.cos(q.h) * 2.1]);
        add(p, [38, 36, 33].map((x) => x * (this._view(t) === 'track' ? 1.6 : 1)), 130, fwd, Math.cos(0.3));
      }
      // brake lights
      if (this.ctl.at('brake', t) > 0.1 && this._view(t) === 'track') add(v3.add(q.p, [-Math.sin(q.h) * 2.6, 0.5, Math.cos(q.h) * 2.6]), [3, 0.2, 0.1], 12);
    }
    // nearest lamps (and the tunnel's when inside)
    const near = (list, k) => list.map((x) => ({ x, d: v3.len(v3.sub(x.p, cam.eye)) })).sort((a, b) => a.d - b.d).slice(0, k);
    const inTunnel = this.ctl.at('tunnel', t) > 0.05 && this._view(t) === 'car';
    for (const { x } of near(this.lamps, inTunnel ? 4 : 10)) add(x.p, [48, 42, 33].map((c) => c * (this._view(t) === 'track' ? 2.2 : 1)), 52, [0, -1, 0], Math.cos(1.2));
    if (this._view(t) === 'track') {
      // a floodlight tower behind the photographers' spot washes the corner entry
      const e = this.score.ear, f = this.score.face;
      add([e[0] - Math.sin(f) * 18 + Math.cos(f) * 4, 22, e[2] + Math.cos(f) * 18 + Math.sin(f) * 4], [260, 240, 215], 150, [Math.sin(f) * 0.8, -1, -Math.cos(f) * 0.8], Math.cos(0.75));
    }
    if (inTunnel || near(this.tunnelLamps, 1)[0]?.d < 60) for (const { x } of near(this.tunnelLamps, 8)) add(x.p, [16, 7.5, 2.6], 18);
    return L.slice(0, MAXL);
  }

  _setLights(L) {
    const { P, C, D } = this.lbuf;
    P.fill(0);
    C.fill(0);
    D.fill(0);
    L.forEach((l, i) => {
      P.set([...l.p, l.range], i * 4);
      C.set([...l.col, l.dir ? l.cos : -2], i * 4);
      if (l.dir) D.set(v3.norm(l.dir), i * 3);
    });
  }

  // ---------------------------------------------------------------- the rev counter
  _cluster(t, force = false) {
    const now = Math.floor(t * 30);
    if (!force && now === this._cl) return;
    this._cl = now;
    const g = this.cg, W = this.cv.width, H = this.cv.height;
    const M = this.M;
    const rpm = Math.max(0, this._rpm(t));
    g.fillStyle = '#020306';
    g.fillRect(0, 0, W, H);
    const on = t > M.keyOn + 0.25 && t < M.off + 0.6;
    if (on) {
      // the startup sweep: needle to the redline and back
      let shown = rpm;
      if (t > M.sweep && t < M.sweep + 1.4) shown = 9000 * Math.sin(Math.PI * Math.min(1, (t - M.sweep) / 1.35));
      const x0 = 70, x1 = W - 70, y = 112;
      const X = (r) => x0 + (x1 - x0) * (r / 9000);
      // tick marks and numbers
      g.font = '600 26px "Segoe UI", Helvetica, Arial, sans-serif';
      g.textAlign = 'center';
      for (let k = 0; k <= 9; k++) {
        g.fillStyle = k >= 9 ? '#ff4030' : '#9fb4d8';
        g.fillRect(X(k * 1000) - 1.5, y - 42, 3, 18);
        g.fillText(String(k), X(k * 1000), y + 8);
        if (k < 9) for (let j = 1; j < 4; j++) g.fillRect(X(k * 1000 + j * 250) - 0.75, y - 36, 1.5, 10);
      }
      g.fillStyle = 'rgba(255,60,40,0.35)';
      g.fillRect(X(CAR.redline), y - 50, X(9000) - X(CAR.redline), 34);
      // the bar
      const grd = g.createLinearGradient(x0, 0, x1, 0);
      grd.addColorStop(0, '#2a6cff');
      grd.addColorStop(0.7, '#7fd0ff');
      grd.addColorStop(0.9, '#ffb030');
      grd.addColorStop(1, '#ff3020');
      g.fillStyle = grd;
      g.fillRect(x0, y - 58, Math.max(0, X(Math.min(9000, shown)) - x0), 12);
      // gear and speed
      const gear = Math.round(this.ctl.at('gear', t));
      const v = this.ctl.at('speed', t) * 3.6;
      g.font = '700 64px "Segoe UI", Helvetica, Arial, sans-serif';
      g.fillStyle = '#ffffff';
      g.fillText(gear > 0 ? String(gear) : 'N', W / 2, 172);
      g.font = '600 30px "Segoe UI", Helvetica, Arial, sans-serif';
      g.textAlign = 'right';
      g.fillStyle = '#cfe0ff';
      g.fillText(`${Math.round(v)}`, W - 40, 172);
      g.textAlign = 'left';
      g.fillStyle = '#7f93b8';
      const lc = t > M.lcOn && t < M.launch;
      g.fillText(lc ? 'LAUNCH' : `${Math.round(shown)} rpm`, 40, 172);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.ctex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cv);
  }

  update(t, dt) {
    this.t = t;
    this.dt = dt;
  }

  // ---------------------------------------------------------------- draw
  draw(t, dt, target) {
    const gl = this.gl;
    const M = this.M;
    const w = target.w, h = target.h;
    const view = this._view(t);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (view === 'black') return target;
    const cam = this._camera(t, w, h);
    // sky
    gl.disable(gl.DEPTH_TEST);
    const openSky = view === 'track' || cam.eye[2] < -4.6 || sm(M.door, M.doorOpen, t) > 0.05;
    this.sky.use().setAll({ uInvVP: cam.invVP, uCam: cam.eye, uTime: t, uAmount: openSky ? 1 : 0, uGlow: 1 });
    drawFullscreen(gl);
    // world
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    const L = this._lights(t, cam);
    this._setLights(L);
    // emissive materials that change: tubes, lamps, sodium, lights of our car
    const E = this.matE;
    E.set(this.baseE);
    const [ta, tb] = this._tubes(t);
    const setE = (k, rgb) => E.set(rgb, MID[k] * 4);
    setE('tube', [3.2, 3.5, 3.8].map((x) => x * Math.max(ta, tb)));
    setE('lampHead', [5.0, 4.4, 3.4]);
    setE('sodium', [6.0, 2.7, 0.8]);
    setE('sign', t > M.back ? [1.2, 0.35, 0.15] : [0.25, 0.08, 0.04]);
    const carOn = t > M.keyOn + 0.3 && t < M.off + 0.3;
    setE('headlamp', carOn ? [9, 9, 8.5] : [0.02, 0.02, 0.02]);
    const braking = this.ctl.at('brake', t) > 0.1;
    setE('taillamp', carOn ? (braking ? [9, 0.6, 0.3] : [2.5, 0.15, 0.08]) : [0.02, 0, 0]);
    const P = this.prog.use();
    P.setAll({
      uVP: cam.vp, uModel: m4.identity(), uCam: cam.eye, uMatA: this.matA, uMatE: E, uLN: L.length, uLP: this.lbuf.P, uLC: this.lbuf.C, uLD: this.lbuf.D,
      uAmb: view === 'track' || cam.eye[2] < -6 ? [0.03, 0.04, 0.075] : [0.02 + 0.03 * ta, 0.022 + 0.034 * ta, 0.026 + 0.04 * ta],
      uFog: [0.008, 0.01, 0.02], uFogD: 0.0026, uTime: t,
    });
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.CULL_FACE); // the generated geometry isn't consistently wound: draw both sides
    this.world.draw(gl.TRIANGLES);
    // our door rolls up into the drum (and comes down again behind us at the end)
    const open = t < M.black ? sm(M.door, M.doorOpen, t) : 1 - sm(M.back + 0.4, M.back + 5.4, t);
    P.set('uModel', m4.compose([0, open * 3.25, -4.4], 0, [1, 1 - open * 0.97, 1]));
    this.door.draw(gl.TRIANGLES);
    // the car, seen from outside
    if (view === 'track') {
      const q = this._carPose(t);
      P.set('uModel', m4.compose(q.p.map((x, i) => (i === 1 ? 0 : x)), Math.PI - q.h)); // the body is modelled nose towards +z
      this.car.draw(gl.TRIANGLES);
    }
    // glows: lamp heads, tunnel lamps, the passing car's lights, flames
    this._drawSprites(t, cam, view);
    // the cockpit
    if (view === 'car') this._drawCockpit(t, w, h, cam);
    return target;
  }

  _drawSprites(t, cam, view) {
    const gl = this.gl;
    const d = this.spriteBuf.data;
    let n = 0;
    const put = (p, c, size) => {
      if (n >= this.spriteBuf.max) return;
      d.set([p[0], p[1], p[2], c[0], c[1], c[2], size], n * 7);
      n++;
    };
    for (const l of this.lamps) {
      const dd = v3.len(v3.sub(l.p, cam.eye));
      if (dd < 900) put(l.p, [1.0, 0.85, 0.6].map((x) => x * 0.55), 2.4);
    }
    if (view === 'car' && this.ctl.at('tunnel', t) > 0.01) for (const l of this.tunnelLamps) put(l.p, [1, 0.5, 0.15].map((x) => x * 0.5), 1.6);
    const q = this._carPose(t);
    if (view === 'track') {
      const fwd = [Math.sin(q.h), 0, -Math.cos(q.h)], right = [Math.cos(q.h), 0, Math.sin(q.h)];
      const toCam = v3.norm(v3.sub(cam.eye, q.p));
      const facing = Math.max(0, v3.dot(fwd, toCam));
      for (const s of [-0.62, 0.62]) {
        const p = v3.add(v3.add(q.p, v3.scale(fwd, 2.05)), v3.add(v3.scale(right, s), [0, 0.18, 0]));
        put(p, [1, 0.97, 0.9].map((x) => x * (0.4 + 6 * Math.pow(facing, 6))), 0.9);
      }
      const back = Math.max(0, -v3.dot(fwd, toCam));
      const br = this.ctl.at('brake', t) > 0.1 ? 3 : 1;
      for (const s of [-0.7, -0.25, 0.25, 0.7]) put(v3.add(v3.add(q.p, v3.scale(fwd, -2.33)), v3.add(v3.scale(right, s), [0, 0.41, 0])), [1, 0.08, 0.04].map((x) => x * (0.3 + 1.6 * back) * br), 0.45);
      // flames on the overrun pops
      for (let i = lastBefore(this.pops, t); i >= 0 && t - this.pops[i].t < 0.12; i--) {
        const pp = this.pops[i];
        const k = pulse(t, pp.t, 0.005, 0.04) * pp.I;
        put(v3.add(v3.add(q.p, v3.scale(fwd, -2.45)), v3.add(v3.scale(right, pp.bank ? 0.35 : -0.35), [0, 0.1, 0])), [1, 0.55, 0.2].map((x) => x * k * 6), 0.7 + k);
      }
    }
    if (!n) return;
    this.spriteBuf.upload(n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    const px = cam.h / (2 * Math.tan(cam.fov / 2));
    this.sprites.use().setAll({ uVP: cam.vp, uPx: px });
    this.spriteBuf.draw(gl.POINTS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _drawCockpit(t, w, h) {
    const gl = this.gl;
    const M = this.M;
    this._cluster(t);
    const rpm = this._rpm(t);
    const v = this.ctl.at('speed', t);
    const q = this._carPose(t);
    // steering follows the road ahead (wheelbase 2.62 m, ratio 13:1)
    const k = this.path.kSmooth(q.s + 4, 5) * (v > 1 ? 1 : 0);
    const steer = clamp(Math.atan(2.62 * k) * 13, -2.4, 2.4);
    const dash = t < M.keyOn + 0.2 ? 0 : t < M.keyOn + 0.6 ? sm(M.keyOn + 0.2, M.keyOn + 0.6, t) : t > M.off ? 1 - sm(M.off + 0.3, M.off + 2.5, t) : 1;
    const leds = clamp((rpm - 5000) / (CAR.shiftUp - 5000), 0, 1) * (t > M.rollout || (t > M.blip1 && t < M.door) ? 1 : 0);
    const blink = rpm > CAR.shiftUp - 60 ? 1 : 0;
    // what the hood reflects: the tubes in the garage, lamps flicking past outside
    const [ta, tb] = this._tubes(t);
    let lampK = 0;
    for (const l of this.lamps) {
      const dd = v3.len(v3.sub(l.p, q.p));
      if (dd < 40) lampK += Math.exp(-dd / 9);
    }
    const inTun = this.ctl.at('tunnel', t);
    const garageK = t < M.cut && t < M.rollout + 4 ? (ta + tb) * 0.5 : t > M.back ? (ta + tb) * 0.5 : 0;
    const hoodCol = v3.add(v3.add(rgbMul([0.55, 0.6, 0.7], garageK * 0.5), rgbMul([0.9, 0.7, 0.45], Math.min(1, lampK) * 0.35)), rgbMul([1, 0.5, 0.15], inTun * 0.5 * (0.6 + 0.4 * Math.sin(t * v / 7 * Math.PI * 2))));
    const env = v3.add(rgbMul([0.6, 0.7, 0.8], garageK), rgbMul([1, 0.8, 0.55], Math.min(1, lampK) * 0.5 + inTun * 0.4));
    const sh = (f, a) => Math.sin(t * f) * a + Math.sin(t * f * 1.7 + 0.4) * a * 0.5;
    const shake = rpm > 200 ? 0.0012 + 0.002 * Math.min(1, v / 70) : 0;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.cockpit.use().tex('uCluster', this.ctex).setAll({
      uRes: [w, h], uShake: [sh(53, shake), sh(41, shake)], uSteer: steer, uDash: dash, uLeds: leds, uBlink: blink, uHood: 1, uAmbient: 1, uTime: t,
      uAlpha: 1, uHoodCol: hoodCol, uEnv: env,
    });
    drawFullscreen(gl);
    gl.disable(gl.BLEND);
  }

  postParams(t) {
    const M = this.M;
    let ex = 1.25;
    ex *= sm(0, 1.4, t);
    ex *= 1 - sm(M.fade, M.black, t) * (t < M.back ? 1 : 0);
    if (t >= M.black && t < M.back) ex = 0;
    if (t >= M.back) ex *= sm(M.back, M.back + 1.2, t);
    ex *= 1 - sm(M.end - 3, M.end - 0.3, t);
    const track = this._view(t) === 'track';
    let flash = 0;
    for (const b of this.bangs) flash = Math.max(flash, pulse(t, b.t, 0.005, 0.08) * 0.35 * (t < M.door + 3 ? 1 : 0));
    return {
      exposure: ex, bloomStrength: track ? 0.42 : 0.3, bloomRadius: 1.15, threshold: 0.55, vignette: 0.55, grain: 0.035, saturation: 1.05,
      contrast: 1.05, letterbox: track ? 0.1 : 0, flash: [flash, flash * 0.55, flash * 0.2],
    };
  }

  // ---------------------------------------------------------------- Hue
  light(f, t) {
    const M = this.M;
    const az = f.anchor === 'tv' ? 0 : f.az ?? 0;
    const rear = Math.abs(az) > 90;
    let c = [0, 0, 0];
    const add = (col, k) => {
      c = [c[0] + col[0] * k, c[1] + col[1] * k, c[2] + col[2] * k];
    };
    const [ta, tb] = this._tubes(t);
    const view = this._view(t);
    const inGarage = t < M.rollout + 3 || t > M.back;
    if (inGarage) add([0.55, 0.62, 0.75], 0.22 * (az < 0 ? ta : tb) * (1 - 0.6 * sm(M.door, M.doorOpen, t) * (t < M.black ? 1 : 0)));
    // outside at night: deep blue, warmer towards the pit lane lights
    const night = (t > M.door + 1 && t < M.black) ? sm(M.door + 1, M.doorOpen, t) : 0;
    add([0.02, 0.04, 0.12], night);
    const rpm = this._rpm(t);
    const load = this.ctl.at('load', t);
    if (view === 'car' && rpm > 200) {
      // the engine lives behind you: the rear lights breathe with it
      const k = clamp((rpm - 800) / 8000, 0, 1) * (0.35 + 0.65 * load);
      if (rear) add([1.0, 0.25, 0.04], 0.12 + 0.7 * k);
      else add([1.0, 0.3, 0.05], 0.05 * k);
      // lamps flicking past, the tunnel's rhythm
      if (!rear && t > M.rollout) {
        const q = this._carPose(t);
        let lk = 0;
        for (const l of this.lamps) {
          const d = v3.len(v3.sub(l.p, q.p));
          if (d < 30) lk += Math.exp(-d / 7);
        }
        add([1.0, 0.85, 0.6], Math.min(1, lk) * 0.6);
        const tn = this.ctl.at('tunnel', t);
        if (tn > 0) {
          const ph = (q.s % 7) / 7;
          add([1.0, 0.45, 0.1], tn * (0.25 + 0.6 * Math.pow(Math.max(0, Math.cos(ph * Math.PI * 2)), 4)));
        }
      }
      if (t > M.door && t < M.rollout) add([1.0, 0.85, 0.6], 0.1);
    }
    // shifts: a flash of the shift lights' blue on the screen light
    for (let i = lastBefore(this.shifts, t); i >= 0 && t - this.shifts[i].t < 0.3; i--) {
      const s = this.shifts[i];
      if (s.up && !s.soft && f.anchor === 'tv') add([0.25, 0.45, 1.0], pulse(t, s.t, 0.01, 0.12) * 1.2);
    }
    // bangs light the garage
    for (const b of this.bangs) if (t > b.t && t < b.t + 0.5) add([1.0, 0.5, 0.15], pulse(t, b.t, 0.005, 0.09) * 1.5);
    if (view === 'track') {
      // the car's lights sweep the room: white from the front as it comes, red behind as it goes
      const q = this._carPose(t);
      const ear = this.score.ear;
      const d = v3.len(v3.sub(q.p, ear));
      const caz = ((Math.atan2(Math.cos(this.score.face) * (q.p[0] - ear[0]) + Math.sin(this.score.face) * (q.p[2] - ear[2]),
        Math.sin(this.score.face) * (q.p[0] - ear[0]) - Math.cos(this.score.face) * (q.p[2] - ear[2]))) * 180) / Math.PI;
      const near = Math.exp(-d / 45);
      const dd = Math.abs(((caz - az + 540) % 360) - 180);
      const coming = t < M.pass;
      add(coming ? [1, 0.95, 0.85] : [1, 0.08, 0.03], near * 1.6 * Math.max(0, 1 - dd / 100) * (coming ? 1 : 1.3));
      add([0.03, 0.05, 0.12], 1);
      for (let i = lastBefore(this.pops, t); i >= 0 && t - this.pops[i].t < 0.2; i--) if (rear) add([1, 0.45, 0.1], pulse(t, this.pops[i].t, 0.005, 0.06) * this.pops[i].I * near * 3);
    }
    const fadeOut = (t > M.fade && t < M.back ? 1 - sm(M.fade, M.black, t) : 1) * (1 - sm(M.end - 3, M.end - 0.3, t)) * sm(0, 1.5, t);
    return rgbMul(c, fadeOut * (t >= M.black && t < M.back ? 0 : 1));
  }

  dispose() {
    super.dispose();
    const gl = this.gl;
    for (const b of [this.world, this.car, this.door, this.spriteBuf]) if (b) b.dispose();
    for (const p of [this.prog, this.sky, this.cockpit, this.sprites]) if (p) gl.deleteProgram(p.prog);
    if (this.ctex) gl.deleteTexture(this.ctex);
  }
}

void rgbMix;
void lerp;
