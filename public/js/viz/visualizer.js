// Visualizer: feature source -> director -> world(s) -> transition -> feedback trails -> post.
import { Program, Target, DataTexture, FULLSCREEN_VS, drawFullscreen } from '../gl/gl.js';
import { Post } from '../gl/post.js';
import { WORLD_BY_ID } from './worlds/index.js';
import { Director } from './director.js';
import { createFrame, SPEC_BANDS } from './score.js';
import { LIB } from './worlds/common.js';

const MIX_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uA, uB;
uniform float uMix, uSeed, uTime;
uniform vec2 uRes;
uniform vec3 uC3;
${LIB}
void main() {
  vec3 a = texture(uA, vUv).rgb;
  vec3 b = texture(uB, vUv).rgb;
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float n = fbm(p * 3.5 + uSeed * 17.0 + uTime * 0.05) * 0.7 + length(p) * 0.5;
  float x = uMix * 1.5 - 0.25;
  float m = smoothstep(n - 0.04, n + 0.04, x);
  float edge = smoothstep(0.03, 0.0, abs(x - n)) * (1.0 - abs(uMix * 2.0 - 1.0));
  outColor = vec4(mix(a, b, m) + uC3 * edge * 0.8, 1.0);
}`;

const FEEDBACK_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCur, uPrev;
uniform float uAmount, uZoom, uRot, uHue;
uniform vec2 uRes;
${LIB}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 d = vUv - 0.5;
  d.x *= aspect;
  d = rot(uRot) * d / uZoom;
  d.x /= aspect;
  vec3 prev = texture(uPrev, 0.5 + d).rgb;
  prev = max(hueShift(prev, uHue), 0.0) * uAmount;
  vec3 cur = texture(uCur, vUv).rgb;
  outColor = vec4(max(cur, prev), 1.0);
}`;

const QUALITY = { high: { maxW: 2560, scale: 1.0 }, medium: { maxW: 1920, scale: 0.8 }, low: { maxW: 1280, scale: 0.6 } };

class TargetSet {
  constructor(gl) {
    this.gl = gl;
    const o = { hdr: true, depth: true };
    this.a = new Target(gl, 4, 4, o);
    this.b = new Target(gl, 4, 4, o);
    this.mix = new Target(gl, 4, 4, { hdr: true });
    this.fb = [new Target(gl, 4, 4, { hdr: true }), new Target(gl, 4, 4, { hdr: true })];
    this.cur = 0;
  }

  resize(w, h) {
    for (const t of [this.a, this.b, this.mix, ...this.fb]) t.resize(w, h);
  }
}

export class Visualizer {
  constructor(gl, caps, settings) {
    this.gl = gl;
    this.settings = settings;
    this.ctx = { gl, caps, quality: settings.quality === 'auto' ? 'high' : settings.quality };
    this.post = new Post(gl);
    this.mixProg = new Program(gl, FULLSCREEN_VS, MIX_FS, 'viz-mix');
    this.fbProg = new Program(gl, FULLSCREEN_VS, FEEDBACK_FS, 'viz-feedback');
    this.sets = { main: new TargetSet(gl), thumb: new TargetSet(gl) };
    this.worlds = new Map();
    this.tex = {
      spec: new DataTexture(gl, SPEC_BANDS, 2),
      fft: new DataTexture(gl, 256, 1),
      wave: new DataTexture(gl, 512, 1),
    };
    // raw WebGLTexture handles handed to worlds
    this.texH = { spec: this.tex.spec.tex, fft: this.tex.fft.tex, wave: this.tex.wave.tex };
    this.frame = createFrame();
    this.director = new Director(settings);
    this.source = null;
    this.analyser = null;
    this.visTime = 0;
    this.scale = 1;
    this.frameMs = 16;
    this.fftTmp = null;
    this.waveTmp = null;
    this.errors = new Set();
  }

  world(id) {
    if (!this.worlds.has(id)) {
      const def = WORLD_BY_ID[id];
      try {
        this.worlds.set(id, def.create(this.ctx));
      } catch (e) {
        console.error(`[viz] world ${id} failed to build`, e);
        this.errors.add(id);
        this.worlds.set(id, null);
      }
    }
    return this.worlds.get(id);
  }

  /** Pre-compile every world (avoids a hitch the first time each appears). */
  warmup() {
    for (const id of Object.keys(WORLD_BY_ID)) this.world(id);
  }

  setSource(source, title = '') {
    this.source = source;
    if (source && source.score) this.director.setScore(source.score, title);
    else this.director.setLive();
  }

  setAnalyser(an) {
    this.analyser = an;
    this.fftTmp = an ? new Float32Array(an.frequencyBinCount) : null;
    this.waveTmp = an ? new Float32Array(an.fftSize) : null;
  }

  /** Advance the music state. Call once per animation frame. */
  update(musicTime, dt, playing) {
    const fr = this.frame;
    fr.dt = dt;
    fr.playing = playing;
    if (this.source) this.source.frameAt(musicTime, fr);
    else fr.t = musicTime;
    if (!playing) {
      // freeze rhythmic motion when paused; let things settle
      fr.beatPulse *= 0.2;
      fr.kick = fr.snare = fr.hat = fr.onset = 0;
    }
    this.visTime += dt * (playing ? 1 : 0.25);
    this.state = this.director.update(fr, dt);
    this._uploadTextures();
    return fr;
  }

  _uploadTextures() {
    const fr = this.frame;
    const s = this.tex.spec.data;
    s.set(fr.spec, 0);
    s.set(fr.specBal, SPEC_BANDS);
    this.tex.spec.upload();
    if (this.analyser) {
      const an = this.analyser;
      an.getFloatFrequencyData(this.fftTmp);
      const binHz = an.context.sampleRate / an.fftSize;
      const f = this.tex.fft.data;
      for (let i = 0; i < 256; i++) {
        const hz = 30 * Math.pow(16000 / 30, i / 255);
        const k = Math.min(this.fftTmp.length - 1, Math.round(hz / binHz));
        f[i] = Math.min(1, Math.max(0, (this.fftTmp[k] + 95) / 70));
      }
      this.tex.fft.upload();
      an.getFloatTimeDomainData(this.waveTmp);
      const w = this.tex.wave.data;
      const step = this.waveTmp.length / 512;
      for (let i = 0; i < 512; i++) w[i] = this.waveTmp[Math.floor(i * step)];
      this.tex.wave.upload();
    }
  }

  _uniforms(w, h) {
    const fr = this.frame;
    const S = this.state;
    return {
      uRes: [w, h], uTime: this.visTime, uMusicTime: fr.t,
      uBeat: fr.beatPhase, uBar: fr.barPhase, uBeatPulse: fr.beatPulse, uBarPulse: fr.barPulse,
      uBeatIndex: fr.beatIndex, uBeatPeriod: fr.beatPeriod, uHasBeat: fr.hasBeat ? 1 : 0,
      uBeatInBar: fr.beatInBar, uMeter: fr.meter,
      uKick: fr.kick, uSnare: fr.snare, uHat: fr.hat, uOnset: fr.onset,
      uLoud: fr.loud, uIntensity: fr.intensity, uBuild: fr.build, uPreDrop: fr.preDrop, uDrop: fr.drop, uImpact: fr.impact,
      uBass: fr.bands[0], uLowMid: fr.bands[1], uMid: fr.bands[2], uHigh: fr.bands[3], uAir: fr.bands[4],
      uCentroid: fr.centroid, uFlat: fr.flat, uFlux: fr.flux, uPerc: fr.perc, uWidth: fr.width, uPan: fr.pan,
      uC0: S.pal[0], uC1: S.pal[1], uC2: S.pal[2], uC3: S.pal[3], uChord: S.chord, uClarity: S.clarity,
      uSeed: S.seed, uSectionT: S.sectionT || 0, uVariant: S.variantA, uEnergy: fr.energy, uValence: fr.valence,
      uTrip: this.settings.trip ?? 1, uCalm: this.settings.reduceFlashing ? 1 : 0,
    };
  }

  _renderWorld(id, target, U, variant) {
    const w = this.world(id) || this.world('nebula');
    if (!w) return;
    U.uVariant = variant;
    const extra = { source: this.source, boundaries: this.source && this.source.score ? this.source.score.upcomingBoundaries(this.frame.t, 9) : [] };
    w.render(target, U, this.texH, this.frame, extra);
  }

  /**
   * Render one frame. `out` is a Target to draw into (e.g. the TV screen in the 3D room),
   * or null for the canvas (outW x outH).
   */
  render(outW, outH, out = null) {
    const gl = this.gl;
    const t0 = performance.now();
    const set = out ? this.sets.thumb : this.sets.main;
    let w, h;
    if (out) {
      w = out.w;
      h = out.h;
    } else {
      const q = QUALITY[this.settings.quality] || QUALITY.high;
      const base = Math.min(1, q.maxW / outW) * q.scale;
      w = Math.round(outW * base * this.scale);
      h = Math.round(outH * base * this.scale);
    }
    set.resize(w, h);
    const S = this.state;
    const U = this._uniforms(w, h);
    this._renderWorld(S.a, set.a, U, S.variantA);
    let result = set.a;
    if (S.b && S.mix > 0) {
      this._renderWorld(S.b, set.b, { ...U }, S.variantB);
      set.mix.bind();
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      this.mixProg.use().tex('uA', set.a.tex).tex('uB', set.b.tex)
        .setAll({ uMix: S.mix, uSeed: S.seed, uTime: this.visTime, uRes: [w, h], uC3: S.pal[3] });
      drawFullscreen(gl);
      result = set.mix;
    }
    // feedback trails
    const fb = S.feedback;
    const prev = set.fb[set.cur];
    const next = set.fb[1 - set.cur];
    next.bind();
    gl.disable(gl.BLEND);
    this.fbProg.use().tex('uCur', result.tex).tex('uPrev', prev.tex)
      .setAll({ uAmount: fb.amount, uZoom: fb.zoom, uRot: fb.rot, uHue: fb.hue, uRes: [w, h] });
    drawFullscreen(gl);
    set.cur = 1 - set.cur;
    const post = out ? { ...S.post, letterbox: 0, grain: 0, shockStrength: S.post.shockStrength * 0.5 } : S.post;
    this.post.run(next.tex, w, h, out ? out.w : outW, out ? out.h : outH, post, this.visTime, out);
    if (!out) this._adapt(performance.now() - t0);
  }

  _adapt(ms) {
    // keep a smooth frame rate on slower GPUs by trading resolution
    if (this.settings.quality !== 'auto') {
      this.scale = 1;
      return;
    }
    this.frameMs = this.frameMs * 0.95 + ms * 0.05;
    const gpuMs = this.lastInterval || 16.7;
    if (gpuMs > 21 && this.scale > 0.5) this.scale = Math.max(0.5, this.scale - 0.02);
    else if (gpuMs < 15 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.005);
  }

  dispose() {
    for (const w of this.worlds.values()) if (w && w.dispose) w.dispose();
  }
}
