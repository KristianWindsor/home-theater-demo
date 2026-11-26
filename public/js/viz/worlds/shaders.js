// Four full-screen shader worlds.
import { ShaderWorld } from './common.js';

// ------------------------------------------------------------------ Chromatic Ink
// Domain-warped noise (ink in water / interstellar gas). Bass bends space, mids steer the flow,
// highs and snares light the filaments, hats make stars twinkle, chords tint the highlights.
const NEBULA = `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float v = mod(uVariant, 3.0);
  float t = uTime * (0.03 + 0.05 * uIntensity) + uSeed * 10.0;
  p *= 1.0 - (0.05 * uBeatPulse + 0.07 * uKick) * uTrip + 0.25 * uPreDrop;
  p *= rot(0.15 * sin(uTime * 0.04) + v * 1.3);
  p *= 1.2 + 0.3 * v;
  float warp = (0.65 + 1.6 * uBass + 1.2 * uBuild + 1.0 * uDrop) * uTrip;
  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, 1.3) - t * 0.7));
  vec2 r = vec2(fbm(p * 1.3 + warp * q + vec2(1.7, 9.2) + t * 1.3 + uMid * 0.4),
                fbm(p * 1.3 + warp * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.5 + warp * r);
  float d = clamp(f * 1.6 - 0.35, 0.0, 1.0);                 // gas density: most of space stays dark
  vec3 gas = mix(uC1, uC2, smoothstep(0.25, 0.95, length(q)));
  gas = mix(gas, uChord, 0.55 * uClarity * smoothstep(0.3, 0.8, r.y));
  vec3 col = uC0 * (0.12 + 0.25 * fbm3(p * 3.0 - t));
  col += gas * pow(d, 2.0) * (0.5 + 1.8 * uLoud);
  col += mix(gas, uC3, 0.35) * pow(d, 7.0) * (1.0 + 3.0 * uHigh + 2.5 * uSnare);   // hot cores
  float fil = pow(max(1.0 - abs(f - 0.58) * 3.0, 0.0), 12.0);
  col += gas * 1.5 * fil * (0.2 + 1.2 * uMid + 0.8 * uPerc);                     // filaments
  col *= 0.6 + 0.5 * uBeatPulse * uHasBeat;
  vec2 sp = p * 38.0;
  vec2 id = floor(sp);
  vec2 fd = fract(sp) - 0.5;
  float h = hash12(id + 3.1);
  float star = smoothstep(0.06, 0.0, length(fd + (hash22(id) - 0.5) * 0.7)) * step(0.984, h);
  star *= 0.3 + 3.0 * uHat * (0.5 + 0.5 * sin(uTime * 9.0 + h * 60.0)) + 0.6 * uAir;
  col += star * mix(uC3, vec3(1.0), 0.4) * 2.0;
  col *= 1.0 + 1.4 * uImpact + 0.9 * uDrop;
  col = mix(col, vec3(dot(col, vec3(0.3))), 0.45 * uBuild);
  outColor = vec4(max(col, 0.0), 1.0);
}`;

// ------------------------------------------------------------------ Mandala
// Kaleidoscopic fold of a Kali-set fractal. The mirror wheel turns one notch per beat (eased),
// kicks punch the zoom, bass morphs the fractal constant, the spectrum draws a ring.
const KALEIDO = `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float segs = 6.0 + 2.0 * mod(uVariant, 4.0);
  float stepA = TAU / segs;
  float notch = (uBeatIndex + easeBeat(uBeat)) * stepA * 0.5 * uHasBeat;
  p *= rot(notch + uTime * 0.03);
  float zoom = 1.0 + (0.14 * uKick + 0.3 * uDrop) * uTrip - 0.25 * uPreDrop;
  p /= zoom;
  float r = length(p);
  float a = atan(p.y, p.x);
  a = mod(a, stepA);
  a = abs(a - stepA * 0.5);
  vec2 k = vec2(cos(a), sin(a)) * r;
  vec2 z = k * (1.15 + 0.25 * sin(uTime * 0.07 + uSeed * 6.0));
  vec2 c = vec2(-0.74 + 0.14 * uBass * uTrip + 0.05 * sin(uTime * 0.11 + uSeed),
                -0.88 + 0.10 * uMid + 0.05 * cos(uTime * 0.13));
  float trap = 1e9;
  float acc = 0.0;
  float orbit = 0.0;
  for (int i = 0; i < 9; i++) {
    z = abs(z) / max(dot(z, z), 1e-4) + c;
    float d = abs(length(z) - 0.8 - 0.25 * uBeatPulse);
    trap = min(trap, d);
    acc += exp(-d * 10.0);
    orbit += atan(z.y, z.x);
  }
  float hueT = orbit * 0.04 + uTime * 0.015 + uBar * 0.25;
  vec3 col = pal(hueT) * pow(acc * 0.1, 2.2) * 0.55;
  col += mix(uChord, uC2, 0.3) * exp(-trap * 70.0) * (0.25 + 1.4 * uHigh) * (0.5 + uClarity);
  col += uC3 * exp(-trap * 160.0) * (0.1 + 2.0 * uSnare + 1.0 * uHat);
  float ringR = 0.30 + 0.22 * specA(a / (stepA * 0.5)) * (0.4 + uLoud);
  col += uC2 * smoothstep(0.012, 0.0, abs(r - ringR)) * (0.5 + 2.0 * uBeatPulse);
  col *= 0.3 + 0.75 * uLoud + 0.35 * uBeatPulse;
  col *= smoothstep(1.1, 0.1, r);
  col *= 1.0 + uDrop * 1.2 + uImpact;
  outColor = vec4(max(col, 0.0), 1.0);
}`;

// ------------------------------------------------------------------ Wormhole
// The tunnel advances exactly one ring per beat, so each ring reaches the edge of the screen
// on its beat (downbeat rings burn brighter). Panels light up with the spectrum.
const TUNNEL = `
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  p += vec2(sin(uTime * 0.31), cos(uTime * 0.23)) * (0.03 + 0.04 * uBass);
  float r = length(p) + 1e-4;
  float a = atan(p.y, p.x);
  float travel = uHasBeat > 0.5 ? (uBeatIndex + uBeat) : uTime * 0.7;
  float hyper = 1.0 + 3.0 * uDrop + 1.5 * uBuild;
  float z = 0.3 / r;
  float v = z / hyper + travel;
  float ang = a / TAU + z * (0.015 + 0.03 * uBass) * uTrip + uTime * 0.006 * (1.0 + mod(uVariant, 2.0));
  float nCols = 24.0 + 8.0 * mod(uVariant, 3.0);
  vec2 g = vec2(ang * nCols, v * 4.0);
  vec2 gi = floor(g);
  vec2 gf = fract(g);
  float cell = hash12(gi + floor(uSeed * 37.0));
  float edge = max(abs(gf.x - 0.5), abs(gf.y - 0.5));
  float panel = smoothstep(0.47, 0.43, edge);
  float frame = smoothstep(0.5, 0.46, edge) - panel;
  float band = abs(fract(ang * 2.0) - 0.5) * 2.0;
  float e = specA(band);
  float lit = step(1.0 - (0.1 + 0.45 * e), cell);
  vec3 wallC = pal(cell * 0.5 + floor(v) * 0.07);
  vec3 col = wallC * panel * lit * (0.08 + 0.8 * e) * (0.3 + uLoud);
  col += uC0 * 0.6 * panel * (1.0 - lit);
  col += mix(uC1, uC2, 0.5) * frame * 0.25 * (0.3 + uMid);
  float streak = pow(vnoise(vec2(ang * 120.0, v * 0.5)), 8.0) * (0.5 + 5.0 * uDrop + 2.0 * uBuild);
  col += uC3 * streak * (0.2 + uHigh * 1.5);
  float n = floor(v + 0.5);
  float ringDist = abs(v - n);
  float ringW = 0.012 + 0.02 / (1.0 + z);
  float barStart = uBeatIndex - uBeatInBar;
  float down = 1.0 - step(0.5, mod(n - barStart, max(uMeter, 1.0)));
  float ringI = smoothstep(ringW, 0.0, ringDist) * uHasBeat * (0.5 + 1.5 * down);
  col += mix(uChord, uC3, down * 0.4) * ringI * (1.2 + 3.0 * uSnare) * (0.4 + uLoud);
  col *= smoothstep(0.0, 0.45, r);
  col += uChord * 0.02 / (r + 0.03) * (0.3 + uLoud + 2.0 * uPreDrop);
  col *= 1.0 + 1.2 * uImpact + 0.4 * uKick * uTrip;
  outColor = vec4(max(col, 0.0), 1.0);
}`;

// ------------------------------------------------------------------ Silk (aurora)
// Night sky over still water. Curtains sway with the mids, brighten with loudness, shimmer with
// the highs; colours follow the harmony. For intros, breakdowns and quiet music.
const AURORA = `
vec3 sky(vec2 p, float refl) {
  vec3 col = mix(uC0 * 0.9 + vec3(0.004, 0.008, 0.02), uC0 * 0.12, smoothstep(-0.2, 0.55, p.y));
  vec2 sp = p * 70.0;
  vec2 id = floor(sp);
  float h = hash12(id);
  float star = step(0.986, h) * smoothstep(0.12, 0.0, length(fract(sp) - 0.5 + (hash22(id) - 0.5) * 0.5));
  col += star * (0.25 + 2.0 * uHat * fract(h * 13.0) + 0.5 * uAir) * (1.0 - refl * 0.6);
  vec3 aur = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = uTime * (0.05 + 0.02 * fi) * (1.0 + 0.8 * uMid);
    float x = p.x + fi * 1.7 + uSeed * 5.0;
    float fold = 0.22 * (fbm3(vec2(x * 0.7 - t * 0.4, fi * 2.0)) - 0.5);
    float base = -0.06 + 0.1 * sin(x * 1.6 + t * 0.8 + fi * 2.1) + fold + 0.07 * fi;
    float h2 = p.y - base;
    float lower = smoothstep(-0.012, 0.012, h2);
    float height = 0.12 + 0.22 * fbm3(vec2(x * 2.0 + t, fi + 7.0)) + 0.1 * uLoud;
    float rise = exp(-max(h2, 0.0) / height * 2.2);
    float rays = 0.35 + 0.65 * pow(vnoise(vec2((x + fold) * 26.0 - t * 3.0, fi * 5.0)), 2.0);
    float e = specA(fract(abs(x) * 0.11 + 0.17 * fi));
    vec3 lowC = mix(uC1, uChord, 0.45 * uClarity);
    vec3 c = mix(lowC, uC2, smoothstep(0.02, 0.3, h2));
    float edge = exp(-abs(h2) * 55.0) * lower;
    aur += c * lower * rise * rays * (0.12 + 0.9 * uLoud + 0.6 * e) * (1.0 - 0.25 * fi);
    aur += lowC * edge * (0.15 + 0.9 * uLoud + 0.8 * uSnare);
  }
  col += aur * (0.9 + 0.5 * uBeatPulse * uHasBeat + uImpact);
  float ridge = -0.19 + 0.05 * fbm3(vec2(p.x * 3.0 + uSeed * 4.0, 1.0)) + 0.02 * vnoise(vec2(p.x * 14.0, 2.0));
  col *= mix(0.03, 1.0, smoothstep(ridge - 0.003, ridge + 0.003, p.y));
  return col;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float horizon = -0.22;
  vec3 col;
  if (p.y > horizon) {
    col = sky(p, 0.0);
  } else {
    float d = horizon - p.y;
    vec2 rp = vec2(p.x + 0.004 * sin(d * 180.0 - uTime * 2.0) * (1.0 + 2.0 * uBass), horizon + 0.01 + d * 1.6);
    col = sky(rp, 1.0) * (0.55 - 0.3 * smoothstep(0.0, 0.28, d));
  }
  outColor = vec4(max(col, 0.0), 1.0);
}`;

export const NebulaWorld = (ctx) => new ShaderWorld(ctx, NEBULA, 'nebula');
export const KaleidoWorld = (ctx) => new ShaderWorld(ctx, KALEIDO, 'kaleido');
export const TunnelWorld = (ctx) => new ShaderWorld(ctx, TUNNEL, 'tunnel');
export const AuroraWorld = (ctx) => new ShaderWorld(ctx, AURORA, 'aurora');
