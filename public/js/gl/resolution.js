// Internal render resolution for everything drawn with WebGL: the 3D room, the experiences and the visualizer.
//
// Settings → Quality:
//   native            every pixel of the output (full 4K on a 4K screen), never adapted
//   auto              starts where High would, then adapts between half of High and native so frames stay on
//                     time at the display's refresh rate (it climbs to native when the GPU has headroom)
//   high/medium/low   fixed caps (each renderer has its own)
import { settings } from '../core/settings.js';

const RATES = [24, 25, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240];

/** Snap a measured frame period to the nearest common refresh rate (within 4%). */
function snap(ms) {
  const hz = 1000 / ms;
  for (const r of RATES) if (Math.abs(r - hz) / r < 0.04) return 1000 / r;
  return ms;
}

/** Learns the display's frame period from requestAnimationFrame intervals. */
export class RefreshMeter {
  constructor() {
    this.ms = 1000 / 60;
    this.buf = new Float32Array(15);
    this.n = 0;
  }

  push(dt) {
    if (!(dt > 2 && dt < 100)) return;
    this.buf[this.n % 15] = dt;
    this.n++;
    if (this.n < 15 || this.n % 15) return;
    const med = snap(Array.from(this.buf).sort((a, b) => a - b)[7]);
    // The first seconds (splash, room) calibrate in either direction. After that only a faster steady rate moves
    // it: a heavy scene running at half rate mustn't convince us the display itself is slower.
    if (this.n <= 180 || med < this.ms * 0.95) this.ms = med;
  }

  get hz() {
    return 1000 / this.ms;
  }
}

/** Frame timing shared by the renderers and the diagnostics overlay (the app ticks it once per frame). */
export const frameClock = {
  ms: 1000 / 60,          // the last frame interval
  refresh: new RefreshMeter(),
  ring: new Float32Array(600),
  n: 0,
  last: null,             // { name, w, h, outW, outH, scale, quality }: what the active renderer drew this frame
  tick(dt) {
    this.ms = dt;
    this.refresh.push(dt);
    if (dt > 0 && dt < 1000) this.ring[this.n++ % this.ring.length] = dt;
  },
};

/**
 * Auto quality: trades resolution for frame time. It watches missed vsyncs (frames that took more than 1.5 refresh
 * periods) rather than an average, so an isolated hitch (garbage collection, a texture upload) changes nothing.
 * It climbs in small steps while frames are on time; if a step up starts missing frames it goes straight back to
 * the last good level and stays there, so the picture doesn't pump. A scene that gets heavier on its own makes it
 * step down by more. Every 40 seconds of calm it may try one step higher again.
 */
export class AutoRes {
  constructor() {
    this.scale = null;
    this.late = new Uint8Array(30);
    this.i = 0;
    this.lateCount = 0;
    this.onTime = 0;
    this.cool = 0;
    this.ceiling = 1;
    this.prev = null;      // the level before the last step up
    this.sinceUp = 1e9;
    this.calm = 0;
  }

  update(frameMs, refreshMs, lo, hi, start) {
    if (this.scale === null) {
      this.scale = start;
      this.ceiling = hi;
    }
    this.scale = Math.min(hi, Math.max(lo, this.scale));
    if (!(frameMs > 0) || frameMs > 250) return this.scale; // tab switch or a loading hitch: no information
    const late = frameMs > refreshMs * 1.5 ? 1 : 0;
    this.lateCount += late - this.late[this.i];
    this.late[this.i] = late;
    this.i = (this.i + 1) % this.late.length;
    this.sinceUp++;
    if (this.cool > 0) {
      this.cool--;
      return this.scale;
    }
    if (this.lateCount >= 6) {
      // one frame in five missed
      if (this.prev !== null && this.sinceUp < 300) {
        // it was our step up: back to the last good level, and don't go above it for a while
        this.scale = this.prev;
        this.ceiling = this.prev;
      } else {
        // the scene got heavier: step down further, and remember the level that failed
        this.ceiling = Math.max(lo, this.scale - 0.03);
        this.scale = Math.max(lo, this.scale * 0.88);
      }
      this.prev = null;
      this.calm = 0;
      this._settle(30);
      return this.scale;
    }
    // on time (an isolated late frame is tolerated): after two seconds, a little more resolution
    this.onTime = this.lateCount <= 1 ? this.onTime + 1 : 0;
    const top = Math.min(hi, this.ceiling);
    if (this.onTime >= 120 && this.scale < top - 1e-3) {
      this.prev = this.scale;
      this.sinceUp = 0;
      this.scale = Math.min(top, this.scale + 0.04);
      this._settle(20);
    }
    if (++this.calm > 2400) {
      this.calm = 0;
      this.ceiling = hi;
    }
    return this.scale;
  }

  _settle(frames) {
    this.late.fill(0);
    this.lateCount = 0;
    this.onTime = 0;
    this.cool = frames;
  }
}

/** One renderer's resolution policy: its caps for High/Medium/Low, plus Auto and Native. */
export class Resolution {
  /** caps: { high: { maxW, scale? }, medium: {...}, low: {...} } */
  constructor(name, caps) {
    this.name = name;
    this.caps = caps;
    this.auto = new AutoRes();
  }

  /** Internal size to render an outW x outH output at, this frame (call once per rendered frame). */
  size(outW, outH) {
    const q = settings.quality;
    const fixed = (cap) => Math.min(1, cap.maxW / outW) * (cap.scale ?? 1);
    let s;
    if (q === 'native') s = 1;
    else if (q === 'auto') {
      const start = fixed(this.caps.high);
      s = this.auto.update(frameClock.ms, frameClock.refresh.ms, start * 0.5, 1, start);
    } else s = fixed(this.caps[q] || this.caps.high);
    const w = Math.max(2, Math.round(outW * s));
    const h = Math.max(2, Math.round(outH * s));
    frameClock.last = { name: this.name, w, h, outW, outH, scale: s, quality: q };
    return { w, h, scale: s };
  }
}
