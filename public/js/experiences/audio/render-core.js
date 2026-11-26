// Turns an experience's score + audio module into PCM for the actual output device.
// Used by the browser worker (worker.js) and by Node (scripts/render_experience.mjs).
import { Studio, ROLES } from './studio.js';

/**
 * Fold the 6 role channels (FL FR FC LFE SL SR) into a device layout.
 * deviceRoles: the device's channel order, e.g. ['FL','FR','FC','LFE','SL','SR'] or ['FL','FR'].
 * Returns matrix[deviceChannel][role] gains.
 */
export function foldMatrix(deviceRoles) {
  const has = (r) => deviceRoles.includes(r);
  const M = deviceRoles.map(() => ROLES.map(() => 0));
  const add = (dev, role, g) => {
    const d = deviceRoles.indexOf(dev);
    if (d >= 0) M[d][ROLES.indexOf(role)] += g;
  };
  for (const r of ROLES) {
    if (has(r)) {
      add(r, r, 1);
      continue;
    }
    // missing speakers: ITU-style downmix, keeping the subwoofer's weight in the mains
    if (r === 'FC') {
      if (has('FL')) {
        add('FL', 'FC', 0.7071);
        add('FR', 'FC', 0.7071);
      } else add(deviceRoles[0], 'FC', 1);
    } else if (r === 'LFE') {
      // the LFE content is rendered 10 dB down (the receiver adds it back): restore it, split across L/R
      if (has('FL')) {
        add('FL', 'LFE', 3.162 * 0.5);
        add('FR', 'LFE', 3.162 * 0.5);
      } else add(deviceRoles[0], 'LFE', 3.162 * 0.7);
    } else if (r === 'SL' || r === 'SR') {
      const back = r === 'SL' ? 'BL' : 'BR';
      const front = r === 'SL' ? 'FL' : 'FR';
      if (has(back)) add(back, r, 1);
      else if (has(front)) add(front, r, 0.7071);
      else add(deviceRoles[0], r, 0.5);
    }
  }
  return M;
}

/** Linked look-ahead peak limiter for all output channels. */
export class Limiter {
  constructor(channels, sr, { ceiling = 0.891, lookahead = 0.004, release = 0.15 } = {}) {
    this.C = channels;
    this.L = Math.max(8, Math.round(lookahead * sr));
    this.buf = Array.from({ length: channels }, () => new Float32Array(this.L));
    this.w = 0;
    this.ceiling = ceiling;
    this.env = 1;
    this.hold = 0;
    this.gain = 1;
    this.att = 1 - Math.exp(-1 / (this.L / 5));
    this.rel = 1 - Math.exp(-1 / (release * sr));
    this.minGain = 1;
  }

  process(chans, n) {
    const C = this.C, L = this.L, ceil = this.ceiling;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < C; c++) {
        const x = chans[c][i];
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
      }
      const req = peak > ceil ? ceil / peak : 1;
      if (req < this.env) {
        this.env = req;
        this.hold = L;
      } else if (this.hold > 0) this.hold--;
      else this.env += (1 - this.env) * this.rel;
      this.gain += (this.env - this.gain) * (this.env < this.gain ? this.att : 1);
      if (this.gain < this.minGain) this.minGain = this.gain;
      const w = this.w;
      for (let c = 0; c < C; c++) {
        const delayed = this.buf[c][w];
        this.buf[c][w] = chans[c][i];
        let y = delayed * this.gain;
        if (y > ceil) y = ceil;
        else if (y < -ceil) y = -ceil;
        chans[c][i] = y;
      }
      this.w = (w + 1) % L;
    }
  }
}

/**
 * opts: { id, sr, speakers: { FL: { az, dist }, ... }, deviceRoles: [...], base (optional module base URL) }
 * Returns { score, duration, frames, channels, render(n) -> Float32Array[] }
 */
export async function createRenderer({ id, sr, speakers = {}, deviceRoles = ROLES }) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`bad experience id ${id}`);
  const scoreMod = await import(`../${id}/score.js`);
  const audioMod = await import(`../${id}/audio.js`);
  const score = scoreMod.compose();
  const studio = new Studio({ sr, speakers, duration: score.duration });
  audioMod.default(studio, score);
  studio.prepare();
  const M = foldMatrix(deviceRoles);
  const D = deviceRoles.length;
  const limiter = new Limiter(D, sr);
  const lat = limiter.L; // the limiter delays the output; render that much extra and drop the start
  let roles = ROLES.map(() => new Float32Array(0));
  let produced = 0;
  let skip = lat;
  const total = studio.frames;
  return {
    score,
    studio,
    duration: score.duration,
    frames: total,
    channels: D,
    deviceRoles,
    limiter,
    /** Next n frames for the device (fresh arrays, safe to transfer). */
    render(n) {
      n = Math.min(n, total - produced);
      const need = n + skip;
      if (roles[0].length < need) roles = ROLES.map(() => new Float32Array(need));
      studio.render(roles, need, 0);
      const dev = Array.from({ length: D }, () => new Float32Array(need));
      for (let d = 0; d < D; d++) {
        const row = M[d], o = dev[d];
        for (let r = 0; r < 6; r++) {
          const g = row[r];
          if (!g) continue;
          const src = roles[r];
          for (let i = 0; i < need; i++) o[i] += src[i] * g;
        }
      }
      limiter.process(dev, need);
      const out = skip ? dev.map((a) => a.slice(skip)) : dev;
      skip = 0;
      produced += n;
      return out;
    },
    get done() {
      return produced >= total;
    },
  };
}
