// The studio: schedules voices from a score and mixes them into the room's speakers.
//
//   voices ─► placement (exact speaker, or azimuth/distance/width panned across the speaker ring)
//         ├─► dry bus (5 mains) ─► early reflections from a virtual room (walls can move!)
//         ├─► reverb sends ─► two feedback delay networks (a small room and a large hall, crossfadeable)
//         └─► LFE bus ─► 110 Hz Linkwitz-Riley ─► -10 dB (the receiver adds the +10 dB LFE gain back)
//
// Output: 6 "role" channels in the order FL FR FC LFE SL SR. render-core.js folds them into whatever
// the browser's output device has (5.1, 7.1, stereo...) and limits the result.
import { Delay, OnePole, LR4, Biquad } from './dsp.js';
import { Curve, DEFAULT_AZ } from '../core/timeline.js';

export const ROLES = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'];
const MAINS = ['FL', 'FR', 'FC', 'SL', 'SR'];
const MAIN_CH = MAINS.map((r) => ROLES.indexOf(r));
export const BLOCK = 128;
const C_SOUND = 343;

const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

// ---------------------------------------------------------------- panning
/** Pairwise constant-power panning around the ring of mains. Returns gains indexed like MAINS. */
export class RingPanner {
  constructor(az) {
    // az: { FL, FR, FC, SL, SR } in degrees
    this.ring = MAINS.map((r, i) => ({ i, az: norm180(az[r] ?? DEFAULT_AZ[r]) })).sort((a, b) => a.az - b.az);
    this.tmp = new Float64Array(5);
  }

  /** Gains for a point source at az (degrees). Adds into g (Float64Array(5)) scaled by w. */
  point(az, g, w = 1) {
    const ring = this.ring, n = ring.length;
    const a = norm180(Number.isFinite(az) ? az : 0);
    let i = n - 1;
    for (let k = 0; k < n; k++) if (ring[k].az <= a) i = k;
    const j = (i + 1) % n;
    let a0 = ring[i].az, a1 = ring[j].az, x = a;
    if (j <= i) {
      a1 += 360;
      if (x < a0) x += 360;
    }
    const t = Math.min(1, Math.max(0, (x - a0) / (a1 - a0 || 1)));
    g[ring[i].i] += w * Math.cos((t * Math.PI) / 2) ** 2;
    g[ring[j].i] += w * Math.sin((t * Math.PI) / 2) ** 2;
  }

  /** Energy-normalized gains for a source of some angular width (degrees). */
  gains(az, width, out) {
    const g = this.tmp;
    g.fill(0);
    if (width < 4) this.point(az, g, 1);
    else {
      const w = Math.min(360, width);
      const K = Math.max(2, Math.min(18, Math.round(w / 20)));
      for (let k = 0; k < K; k++) this.point(az - w / 2 + (w * (k + 0.5)) / K, g, 1 / K);
    }
    for (let k = 0; k < 5; k++) out[k] = Math.sqrt(g[k]);
    return out;
  }
}

// ---------------------------------------------------------------- reverb
const HAD8 = [];
for (let r = 0; r < 8; r++) {
  HAD8.push([]);
  for (let c = 0; c < 8; c++) {
    let b = r & c, p = 0;
    while (b) {
      p ^= b & 1;
      b >>= 1;
    }
    HAD8[r].push(p ? -1 : 1);
  }
}

/** 8-line feedback delay network, Householder feedback, frequency-dependent decay, 5 decorrelated outputs. */
export class FDN {
  constructor(sr, delaysMs, { t60 = 2, hfRatio = 0.45, predelay = 0.012, mod = 0.5 } = {}) {
    this.sr = sr;
    this.len = delaysMs.map((ms) => (ms / 1000) * sr);
    this.lines = this.len.map((l) => new Delay(l + 64));
    this.lp = new Float64Array(8);
    this.g = new Float64Array(8);
    this.p = new Float64Array(8);
    this.pre = new Delay(Math.round(0.25 * sr));
    this.predelay = predelay * sr;
    this.modDepth = (mod / 1000) * sr;
    this.modPh = this.len.map((_, i) => i * 0.77);
    this.modInc = this.len.map((_, i) => (0.11 + 0.07 * i) / sr * Math.PI * 2);
    this.inG = HAD8[7].map((s) => s * 0.35);
    this.outG = [1, 2, 3, 4, 5].map((r) => HAD8[r].map((s) => s * 0.36));
    this.hiCut = new OnePole(9000, sr);
    this.setT60(t60, hfRatio);
  }

  setT60(t60, hfRatio = 0.45) {
    if (t60 === this._t && hfRatio === this._h) return;
    this._t = t60;
    this._h = hfRatio;
    for (let k = 0; k < 8; k++) {
      const d = this.len[k];
      const gLo = Math.pow(10, (-3 * d) / (Math.max(0.05, t60) * this.sr));
      const gHi = Math.pow(10, (-3 * d) / (Math.max(0.03, t60 * hfRatio) * this.sr));
      const r = gHi / gLo;
      this.p[k] = (1 - r) / (1 + r);
      this.g[k] = gLo;
    }
  }

  /** in: mono send (n samples). outs: 5 arrays (indexed like MAINS); adds gain * reverb. */
  process(input, outs, n, gain) {
    if (gain <= 0 && this.idle) return;
    const L = this.lines, len = this.len, lp = this.lp, g = this.g, p = this.p, inG = this.inG, oG = this.outG;
    const f = this.f || (this.f = new Float64Array(8));
    let energy = 0;
    for (let i = 0; i < n; i++) {
      this.pre.write(input[i]);
      const x = this.hiCut.lp(this.pre.read(Math.max(1, this.predelay)));
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        this.modPh[k] += this.modInc[k];
        const d = len[k] + this.modDepth * (1 + Math.sin(this.modPh[k]));
        const o = L[k].read(d);
        lp[k] = g[k] * (1 - p[k]) * o + p[k] * lp[k];
        f[k] = lp[k];
        sum += lp[k];
      }
      sum *= 0.25; // 2/N
      for (let k = 0; k < 8; k++) L[k].write(f[k] - sum + x * inG[k] + 1e-20);
      for (let c = 0; c < 5; c++) {
        const row = oG[c];
        let s = 0;
        for (let k = 0; k < 8; k++) s += row[k] * f[k];
        outs[c][i] += s * gain;
      }
      energy += f[0] * f[0];
    }
    this.idle = energy < 1e-14;
  }
}

// ---------------------------------------------------------------- early reflections
const SURFACES = ['left', 'right', 'front', 'back', 'floor', 'ceiling'];

/**
 * First-order image sources of a shoebox room, applied to the speaker feeds: each main channel is treated
 * as a source at its speaker, and its six reflections arrive from their real directions with the right
 * delay. Walls that move make the echoes move.
 */
export class EarlyReflections {
  constructor(sr, panner, speakers) {
    this.sr = sr;
    this.panner = panner;
    this.lines = MAINS.map(() => new Delay(Math.round(0.6 * sr)));
    this.src = MAINS.map((r) => {
      const s = speakers[r] || { az: DEFAULT_AZ[r], dist: 2.6 };
      const a = (s.az * Math.PI) / 180;
      const d = s.dist || 2.6;
      return [Math.sin(a) * d, r === 'FC' ? 0.7 : 1.0, -Math.cos(a) * d];
    });
    this.listener = [0, 1.1, 0];
    // taps[c * 6 + s] = { d0, d1, gains[5] (current), target gains }
    this.taps = [];
    for (let c = 0; c < 5; c++) for (let s = 0; s < 6; s++) this.taps.push({ d: 1, dT: 1, g: new Float64Array(5), gT: new Float64Array(5) });
    this.tmp = new Float64Array(5);
    this.first = true;
  }

  /** room: { w, front, back, h, refl: { left, right, front, back, floor, ceiling } } */
  update(room) {
    const L = this.listener;
    const W = room.w, F = room.front, B = room.back, H = room.h;
    const R = room.refl || {};
    for (let c = 0; c < 5; c++) {
      const [sx, sy, sz] = this.src[c];
      const direct = Math.hypot(sx - L[0], sy - L[1], sz - L[2]);
      for (let s = 0; s < 6; s++) {
        let ix = sx, iy = sy, iz = sz;
        const name = SURFACES[s];
        if (name === 'left') ix = -W - sx;
        else if (name === 'right') ix = W - sx;
        else if (name === 'front') iz = 2 * F - sz;
        else if (name === 'back') iz = 2 * B - sz;
        else if (name === 'floor') iy = -sy;
        else iy = 2 * H - sy;
        const dx = ix - L[0], dy = iy - L[1], dz = iz - L[2];
        const r = Math.hypot(dx, dy, dz);
        const tap = this.taps[c * 6 + s];
        tap.dT = Math.max(1, ((r - direct) / C_SOUND) * this.sr);
        const refl = R[name] ?? (name === 'floor' ? 0.35 : 0.6);
        const amp = refl * (direct / r);
        const az = (Math.atan2(dx, -dz) * 180) / Math.PI;
        this.panner.gains(az, 25, this.tmp);
        for (let k = 0; k < 5; k++) tap.gT[k] = this.tmp[k] * amp;
        if (this.first) {
          tap.d = tap.dT;
          tap.g.set(tap.gT);
        }
      }
    }
    this.first = false;
  }

  /** dry: 5 arrays (MAINS order). outs: 5 arrays to add into. */
  process(dry, outs, n, gain) {
    const lines = this.lines, taps = this.taps;
    for (let c = 0; c < 5; c++) {
      const line = lines[c], d = dry[c];
      const base = c * 6;
      // per-sample delay glide for each tap of this source
      for (let i = 0; i < n; i++) {
        line.write(d[i]);
        for (let s = 0; s < 6; s++) {
          const tap = taps[base + s];
          const dd = tap.d + ((tap.dT - tap.d) * (i + 1)) / n;
          const v = line.read(dd) * gain;
          if (v === 0) continue;
          const g = tap.g, gT = tap.gT;
          const x = (i + 1) / n;
          for (let k = 0; k < 5; k++) {
            const gk = g[k] + (gT[k] - g[k]) * x;
            if (gk) outs[k][i] += v * gk;
          }
        }
      }
    }
    for (const tap of taps) {
      tap.d = tap.dT;
      tap.g.set(tap.gT);
    }
  }
}

// ---------------------------------------------------------------- the studio
const SMALL_ROOM = [5.3, 7.1, 9.7, 11.3, 13.9, 16.1, 18.7, 21.3];
const LARGE_HALL = [31.7, 37.1, 41.3, 47.9, 53.3, 61.1, 67.9, 79.3];

/**
 * speakers: { FL: { az, dist }, ... } from config/room.json (azimuth degrees clockwise, distance meters)
 */
export class Studio {
  constructor({ sr, speakers = {}, duration }) {
    this.sr = sr;
    this.duration = duration;
    this.frames = Math.ceil(duration * sr);
    const az = {};
    for (const r of MAINS) az[r] = speakers[r] ? speakers[r].az : DEFAULT_AZ[r];
    this.az = az;
    this.panner = new RingPanner(az);
    this.queue = [];
    this.calls = [];
    this.active = [];
    this.pos = 0;
    this.dry = MAINS.map(() => new Float32Array(BLOCK));
    this.wet = MAINS.map(() => new Float32Array(BLOCK));
    this.lfe = new Float32Array(BLOCK);
    this.sendA = new Float32Array(BLOCK);
    this.sendB = new Float32Array(BLOCK);
    this.scratch = new Float32Array(BLOCK);
    this.revA = new FDN(sr, SMALL_ROOM, { t60: 0.6, hfRatio: 0.5, predelay: 0.004 });
    this.revB = new FDN(sr, LARGE_HALL, { t60: 3.5, hfRatio: 0.42, predelay: 0.025, mod: 0.8 });
    this.er = new EarlyReflections(sr, this.panner, speakers);
    this.lfeLP = new LR4(110, sr);
    this.lfeHP = new Biquad('highpass', 17, 0.707, sr);
    this.mainHP = MAINS.map(() => new Biquad('highpass', 22, 0.6, sr));
    // automation (numbers, Curves, or functions of time)
    this.params = {
      space: 0, // 0 = small room reverb, 1 = large hall
      revA: 1, revB: 1, t60A: 0.6, t60B: 3.5, hfA: 0.5, hfB: 0.42,
      er: 0, // early reflections level
      room: { w: 6.4, front: -3.7, back: 2.7, h: 2.75 },
      master: 1,
      lfe: 0.316, // -10 dB: the receiver applies +10 dB to LFE
    };
    this.gain = 1;
  }

  /** Automate a parameter: value, Curve, [[t, v, ease]...] keyframes, or fn(t). */
  set(name, v) {
    if (Array.isArray(v) && Array.isArray(v[0])) v = new Curve(v);
    this.params[name] = v;
    return this;
  }

  _param(name, t) {
    const v = this.params[name];
    if (v instanceof Curve) return v.at(t);
    if (typeof v === 'function') return v(t);
    return v;
  }

  /**
   * Schedule a voice. make: () => voice (created when it starts). place:
   *   { spk: 'FL' } exact speaker | { az, dist, width } | { path: (t) => ({ az, dist, width }) }
   *   gain (number | fn(t)), rev (send), revB (explicit hall send), lfe (send to subwoofer), dry (default 1)
   */
  play(t, make, place = {}) {
    this.queue.push({ start: Math.max(0, Math.round(t * this.sr)), make, place });
  }

  /** Shorthand: studio.note(t, Pluck, { freq, ... }, place) */
  note(t, Cls, opts, place) {
    const sr = this.sr;
    this.play(t, () => new Cls(sr, opts), place);
  }

  /** Run fn(studio, t) at time t (lets audio modules schedule lazily). */
  at(t, fn) {
    this.calls.push({ start: Math.round(t * this.sr), fn });
  }

  prepare() {
    this.queue.sort((a, b) => a.start - b.start);
    this.calls.sort((a, b) => a.start - b.start);
    this.qi = 0;
    this.ci = 0;
  }

  _activate(end) {
    while (this.ci < this.calls.length && this.calls[this.ci].start < end) {
      const c = this.calls[this.ci++];
      c.fn(this, c.start / this.sr);
      // calls may add voices: keep the queue sorted from the current index on
      const rest = this.queue.slice(this.qi).sort((a, b) => a.start - b.start);
      this.queue.length = this.qi;
      for (const q of rest) this.queue.push(q);
    }
    while (this.qi < this.queue.length && this.queue[this.qi].start < end) {
      const q = this.queue[this.qi++];
      let voice;
      try {
        voice = q.make();
      } catch (e) {
        console.error('[studio] voice failed', e);
        continue;
      }
      if (!voice) continue;
      const p = q.place || {};
      const v = {
        voice, p, offset: Math.max(0, q.start - this.pos), t0: q.start / this.sr,
        g: new Float64Array(5), gT: new Float64Array(5), first: true,
        air: new OnePole(20000, this.sr), airOn: false,
        dry: p.dry ?? 1, rev: p.rev ?? 0.22, lfe: p.lfe ?? 0,
        static: !p.path && typeof p.gain !== 'function',
      };
      this.active.push(v);
    }
  }

  _placement(v, t) {
    const p = v.p;
    let pos = p;
    // (a voice can start part-way into a block: never hand a path negative time)
    if (p.path) pos = p.path(Math.max(0, t - v.t0), t) || p;
    const gain = typeof p.gain === 'function' ? p.gain(t) : p.gain ?? 1;
    const out = v.gT;
    if (pos.spk && pos.spk !== 'LFE') {
      out.fill(0);
      const idx = MAINS.indexOf(pos.spk === 'C' ? 'FC' : pos.spk);
      out[idx >= 0 ? idx : 2] = 1;
      v.dist = 1;
    } else if (pos.spk === 'LFE') {
      out.fill(0);
      v.dist = 1;
    } else {
      const az = typeof pos.az === 'string' ? this.az[pos.az === 'C' ? 'FC' : pos.az] : pos.az ?? 0;
      const dist = Number.isFinite(pos.dist) ? pos.dist : 1;
      let width = Number.isFinite(pos.width) ? pos.width : 0;
      if (dist < 1) width = Math.min(360, width + (1 - dist) * 300);
      this.panner.gains(az, width, out);
      v.dist = dist;
    }
    const dist = v.dist;
    const att = dist > 1 ? Math.pow(1 / dist, 0.85) : 1;
    for (let k = 0; k < 5; k++) out[k] *= gain * att * v.dry;
    v.sendGain = gain * v.rev * (1 + 0.3 * Math.max(0, dist - 1));
    v.lfeGain = gain * v.lfe;
    if (dist > 1.3) {
      v.air.set(20000 / (1 + 0.04 * (dist - 1) * (dist - 1)), this.sr);
      v.airOn = true;
    } else v.airOn = false;
    if (v.first) {
      v.g.set(out);
      v.first = false;
    }
  }

  _block(n) {
    const sr = this.sr;
    const t = this.pos / sr;
    this._activate(this.pos + n);
    for (const b of this.dry) b.fill(0, 0, n);
    for (const b of this.wet) b.fill(0, 0, n);
    this.lfe.fill(0, 0, n);
    this.sendA.fill(0, 0, n);
    this.sendB.fill(0, 0, n);
    const space = Math.min(1, Math.max(0, this._param('space', t)));
    const sc = this.scratch;
    const keep = [];
    for (const v of this.active) {
      const off = v.offset;
      v.offset = 0;
      if (off >= n) {
        v.offset = off - n;
        keep.push(v);
        continue;
      }
      if (off) sc.fill(0, 0, off);
      const alive = v.voice.process(sc, off, n - off);
      if (!v.static || v.first) this._placement(v, t);
      if (v.airOn) for (let i = off; i < n; i++) sc[i] = v.air.lp(sc[i]);
      const g = v.g, gT = v.gT;
      for (let k = 0; k < 5; k++) {
        const a = g[k], b = gT[k];
        if (a === 0 && b === 0) continue;
        const d = this.dry[k], step = (b - a) / n;
        for (let i = off; i < n; i++) d[i] += sc[i] * (a + step * i);
      }
      g.set(gT);
      const sg = v.sendGain;
      if (sg) {
        const sp = v.p.space ?? space;
        const a = sg * (1 - sp), b = sg * sp;
        if (a) for (let i = off; i < n; i++) this.sendA[i] += sc[i] * a;
        if (b) for (let i = off; i < n; i++) this.sendB[i] += sc[i] * b;
      }
      if (v.lfeGain) for (let i = off; i < n; i++) this.lfe[i] += sc[i] * v.lfeGain;
      if (alive) keep.push(v);
    }
    this.active = keep;
    // early reflections from the (possibly moving) virtual room
    const erG = this._param('er', t);
    if (erG > 0.0005) {
      this.er.update(this._param('room', t));
      this.er.process(this.dry, this.wet, n, erG);
    } else this.er.first = true;
    // reverbs
    this.revA.setT60(this._param('t60A', t), this._param('hfA', t));
    this.revB.setT60(this._param('t60B', t), this._param('hfB', t));
    this.revA.process(this.sendA, this.wet, n, this._param('revA', t));
    this.revB.process(this.sendB, this.wet, n, this._param('revB', t));
    // assemble role channels
    const g1 = this._param('master', t);
    const g0 = this.gain;
    this.gain = g1;
    const out = this.out;
    for (let k = 0; k < 5; k++) {
      const o = out[MAIN_CH[k]], d = this.dry[k], w = this.wet[k];
      for (let i = 0; i < n; i++) o[i] = d[i] + w[i];
      this.mainHP[k].run(o, 0, n);
    }
    const lo = out[3];
    lo.set(this.lfe.subarray(0, n));
    this.lfeLP.run(lo, 0, n);
    this.lfeHP.run(lo, 0, n);
    const lg = this._param('lfe', t);
    for (let i = 0; i < n; i++) lo[i] *= lg;
    if (g0 !== 1 || g1 !== 1) {
      for (const o of out) for (let i = 0; i < n; i++) o[i] *= g0 + ((g1 - g0) * i) / n;
    }
    this.pos += n;
  }

  /** Render n frames into 6 role arrays (FL FR FC LFE SL SR), starting at offset. */
  render(roles, n, offset = 0) {
    if (!this.out) this.out = ROLES.map(() => new Float32Array(BLOCK));
    let done = 0;
    while (done < n) {
      const b = Math.min(BLOCK, n - done);
      this._block(b);
      for (let c = 0; c < 6; c++) roles[c].set(this.out[c].subarray(0, b), offset + done);
      done += b;
    }
  }

  get voiceCount() {
    return this.active.length;
  }
}
