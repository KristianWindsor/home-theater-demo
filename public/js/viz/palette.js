// Chromesthesia: pitch -> color.
//
// Each pitch class gets a hue by its position on the circle of fifths (C red, G orange, D yellow,
// A yellow-green, E green, B teal, F# cyan-blue, C# blue, G# violet, Eb purple, Bb magenta, F rose),
// the ordering Scriabin used for his "colour organ". Harmonically close keys therefore get
// neighbouring colours, a single clear chord gives a saturated colour, and dense/atonal sound
// averages towards grey. Colours are mixed in OKLab (perceptually uniform) so blends stay clean.

const TAU = Math.PI * 2;
const HUE_C = (29 / 360) * TAU; // OKLCH hue of a pure red

export function fifthsIndex(pc) {
  return (pc * 7) % 12;
}

export function pitchHue(pc) {
  return HUE_C + (fifthsIndex(pc) / 12) * TAU;
}

export function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Yellows only read as yellow when light; lift lightness around the yellow hue (avoids olive/brown). */
function yellowLift(h) {
  const deg = ((h * 180) / Math.PI % 360 + 360) % 360;
  const d = Math.min(Math.abs(deg - 100), 360 - Math.abs(deg - 100));
  return 0.13 * Math.exp(-((d / 38) ** 2));
}

/** OKLCH -> linear sRGB, pulling chroma in until the colour fits the gamut. */
export function oklch(L, C, h) {
  if (L > 0.3 && L < 0.85) L = Math.min(0.92, L + yellowLift(h));
  let c = C;
  for (let i = 0; i < 12; i++) {
    const rgb = oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
    if (rgb.every((v) => v >= -0.001 && v <= 1.001)) return rgb.map((v) => Math.min(1, Math.max(0, v)));
    c *= 0.85;
  }
  return oklabToLinear(L, 0, 0).map((v) => Math.min(1, Math.max(0, v)));
}

/** Colour of the current harmony: hue from the chroma vector, chroma from its clarity. */
export function chordColor(chroma, L = 0.7) {
  let a = 0, b = 0, w = 0;
  for (let pc = 0; pc < 12; pc++) {
    const v = chroma[pc] * chroma[pc];
    const h = pitchHue(pc);
    a += v * Math.cos(h);
    b += v * Math.sin(h);
    w += v;
  }
  if (w < 1e-6) return { rgb: oklch(L, 0, 0), hue: 0, clarity: 0 };
  const mag = Math.hypot(a, b) / w;
  const hue = Math.atan2(b, a);
  const strength = Math.min(1, Math.sqrt(w / 3));
  const clarity = Math.min(1, mag * strength * 1.4);
  return { rgb: oklch(L, 0.03 + 0.16 * clarity, hue), hue, clarity };
}

/**
 * A 4-colour palette for a section.
 *  c0: deep base   c1: primary   c2: accent (fifth / tritone away for contrast)   c3: near-white highlight
 */
export function sectionPalette({ keyIndex = 0, mode = 'major', valence = 0.5, intensity = 0.5, labelShift = 0, variant = 0 }) {
  const h0 = pitchHue(keyIndex) + labelShift;
  const minor = mode === 'minor';
  const light = minor ? -0.05 : 0.03;
  const sat = 0.75 + 0.4 * intensity + 0.15 * (valence - 0.5);
  const accentOffset = [Math.PI * 0.83, Math.PI * 0.5, -Math.PI * 0.66][variant % 3];
  return [
    oklch(0.13 + light + 0.04 * valence, 0.06 * sat, h0 + 0.3),
    oklch(0.55 + light, 0.2 * sat, h0),
    oklch(0.62 + light, 0.2 * sat, h0 + accentOffset),
    oklch(0.9, 0.09, h0 + 0.5),
  ];
}

export function mixRGB(a, b, t) {
  const A = linearToOklab(...a), B = linearToOklab(...b);
  return oklabToLinear(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t)
    .map((v) => Math.min(1, Math.max(0, v)));
}

export function rgbToCss(rgb, alpha = 1) {
  const g = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  return `rgba(${g(rgb[0])}, ${g(rgb[1])}, ${g(rgb[2])}, ${alpha})`;
}

/** A pleasant colour for a key (used for generative album covers and list accents). */
export function keyColor(keyIndex, mode) {
  return oklch(mode === 'minor' ? 0.55 : 0.65, 0.15, pitchHue(keyIndex));
}
