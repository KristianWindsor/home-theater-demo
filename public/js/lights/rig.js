// Light rig: the room's Hue fixtures as data. One "brain" decides colours; any number of sinks
// display them. Today the only sink is the 3D room; a Philips Hue sink plugs in the same way
// (see lights/hue-sink.js and ARCHITECTURE.md).
import { mixRGB } from '../viz/palette.js';

export class LightRig {
  constructor() {
    this.fixtures = [];
    this.sinks = new Set();
    this.mode = 'ambient';
    this.flash = 0;
    this.flashColor = [0.85, 0.9, 1.0];
    this.flashAz = null;
    this.t = 0;
    this.override = new Map(); // fixture id -> { color, until }
  }

  /** fixtures: [{ id, label, pos:[x,y,z], az (deg, 0 = front), side: -1|0|1, rear: bool }] */
  setFixtures(fixtures) {
    this.fixtures = fixtures.map((f) => ({ ...f, color: [0, 0, 0], intensity: 0 }));
  }

  addSink(sink) {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  setMode(mode) {
    this.mode = mode;
  }

  lightning(intensity = 1, az = null) {
    this.flash = Math.max(this.flash, intensity);
    this.flashAz = az;
  }

  pulse(id, color, seconds = 0.6) {
    this.override.set(id, { color, until: this.t + seconds, len: seconds });
  }

  /**
   * dt: seconds. music: { frame, state } from the visualizer when music plays (else null).
   */
  update(dt, music = null) {
    this.t += dt;
    const k = Math.min(1, dt / 0.12);
    for (const f of this.fixtures) {
      let target;
      if (music && music.frame && music.state && this.mode === 'music') target = this._musicColor(f, music.frame, music.state);
      else if (this.mode === 'movie') target = [0.06, 0.06, 0.065]; // dim D65-ish bias light
      else if (this.mode === 'off') target = [0, 0, 0];
      else target = this._ambient(f);
      if (this.flash > 0.01) {
        let w = this.flash;
        if (this.flashAz !== null && f.az !== undefined) {
          const d = Math.abs(((f.az - this.flashAz + 540) % 360) - 180);
          w *= 0.35 + 0.65 * Math.max(0, Math.cos((d * Math.PI) / 180 / 1.6));
        }
        target = target.map((v, i) => v + this.flashColor[i] * w * 3.5);
      }
      const o = this.override.get(f.id);
      if (o) {
        if (this.t > o.until) this.override.delete(f.id);
        else {
          const p = 1 - (o.until - this.t) / o.len;
          target = mixRGB(o.color, target, p * p);
          f.color = target;
          continue;
        }
      }
      // fast attack, slower release, like real bulbs
      const kk = target[0] + target[1] + target[2] > f.color[0] + f.color[1] + f.color[2] ? Math.min(1, k * 2.5) : k;
      f.color = f.color.map((v, i) => v + (target[i] - v) * kk);
    }
    this.flash *= Math.exp(-dt / 0.09);
    for (const s of this.sinks) s.render(this.fixtures, dt);
  }

  _ambient(f) {
    // slow breathing warm/cool wash
    const ph = this.t * 0.25 + (f.az || 0) * 0.01;
    const warm = [0.9, 0.38, 0.12], cool = [0.16, 0.28, 0.95];
    const c = mixRGB(warm, cool, 0.5 + 0.5 * Math.sin(ph));
    return c.map((v) => v * 0.55);
  }

  _musicColor(f, fr, st) {
    const pal = st.pal;
    if (f.anchor === 'tv') {
      return mixRGB(pal[1], st.chord, 0.5).map((v) => v * (0.25 + 1.2 * fr.loud + 0.6 * fr.beatPulse));
    }
    const rear = !!f.rear;
    const side = f.side || 0;
    // stereo/surround placement: louder side glows more
    let placement = 1 + 0.6 * side * fr.pan;
    if (fr.channelLevels && fr.channels) {
      const want = rear ? (side < 0 ? 'SL' : 'SR') : (side < 0 ? 'FL' : 'FR');
      const i = fr.channels.indexOf(want);
      const alt = fr.channels.indexOf(want.replace('S', 'B'));
      const lvl = i >= 0 ? fr.channelLevels[i] : alt >= 0 ? fr.channelLevels[alt] : -1;
      if (lvl >= 0) placement = Math.max(0, (lvl - 0.45) * 3);
    }
    const base = rear ? mixRGB(pal[2], pal[0], 0.2) : mixRGB(pal[1], st.chord, 0.35);
    const hit = rear ? fr.snare * 0.8 + fr.hat * 0.4 : fr.kick * 1.1 + fr.beatPulse * 0.4;
    const level = (0.12 + 0.9 * fr.intensity * fr.loud + hit) * placement * (1 + 1.5 * fr.drop);
    return base.map((v) => v * level);
  }
}
