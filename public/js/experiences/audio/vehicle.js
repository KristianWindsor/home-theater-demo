// Cars, by physics rather than recordings: a mid-engine, naturally aspirated V10 built from what actually makes the
// sound. A crankshaft turns at the score's rpm; ten cylinders fire in the real firing order (1-6-5-10-2-7-3-8-4-9,
// alternating banks every 72 degrees); every firing sends a blowdown pulse, sized by load and varying from cycle to
// cycle, down its bank's exhaust (two pipe sections modelled as waveguides, a muffler with a flap valve, radiation
// from the tail pipe); the intake sucks 360 degrees later through an airbox; forty valves tick; the starter, pops,
// crackles and shifts follow the score. One EngineCore can be heard from several places at once (EngineVoice taps:
// each exhaust bank, the intake, the engine bay) or from the side of the track (PassBy: propagation delay and so
// Doppler, spreading, air absorption, the ground reflection, exhaust directivity).
import { Noise, OnePole, Biquad, SVF, Delay, sinCycle, softClip } from './dsp.js';
import { Rng, TAU, clamp, lerp } from '../core/timeline.js';

const C_AIR = 343;
const C_GAS = 560; // speed of sound in hot exhaust gas

/** 90-degree V10 with split crankpins: even firing every 72 degrees, banks alternating. */
export const V10 = {
  cylinders: 10,
  order: [1, 6, 5, 10, 2, 7, 3, 8, 4, 9],
  bankOf: (c) => (c <= 5 ? 0 : 1),
  pipes: [[1.12, 0.74], [1.2, 0.69]], // per bank: header+collector to muffler, muffler to tail (m)
  redline: 8500,
};

// ---------------------------------------------------------------- the engine
/**
 * opts: ctl (ControlTrack: rpm, load, fuel, crank, cold, valve), pops [{ t, bank, I }] (score time),
 *       seed, valveAuto (default true when ctl has no valve channel)
 * get(absSample, n) -> { exL, exR, intake, mech, starter, body } for [absSample, absSample + n)
 */
export class EngineCore {
  constructor(sr, o) {
    this.sr = sr;
    this.ctl = o.ctl;
    this.pops = (o.pops || []).slice().sort((a, b) => a.t - b.t);
    this.popI = 0;
    this.rng = new Rng(o.seed || 77);
    this.noise = new Noise(o.seed || 77);
    this.n2 = new Noise((o.seed || 77) + 101);
    const E = (this.E = o.engine || V10);
    // every cylinder is a little different (fixed): gain, header length, how sharp its blowdown is
    const cr = new Rng((o.seed || 77) * 7 + 3);
    this.cyl = [];
    for (let c = 1; c <= E.cylinders; c++) {
      this.cyl[c] = { gain: 1 + cr.range(-0.075, 0.075), delay: cr.range(0, 0.00028), ap: cr.range(21, 29), bright: cr.range(0.85, 1.15) };
    }
    this.theta = 0; // crank revolutions
    this.nextFire = 0.05;
    this.fireIdx = 0;
    this.nextValve = 0.025;
    this.pulses = [];
    this.intakes = [];
    this.activePops = [];
    const pipe = (L) => Math.max(8, Math.round(((2 * L) / C_GAS) * sr));
    this.bank = E.pipes.map(([l1, l2], b) => ({
      d1: new Delay(pipe(l1) + 4), D1: pipe(l1), lp1: new OnePole(2600, sr),
      d2: new Delay(pipe(l2) + 4), D2: pipe(l2), lp2: new OnePole(3400, sr),
      muf: new Biquad('lowpass', 3000, 0.7, sr), res: new Biquad('peak', b ? 121 : 112, 1.3, sr, 4),
      notch: new Biquad('peak', 880, 1.1, sr, -4), hp: new OnePole(34, sr), prev: 0,
      raspBp: new Biquad('bandpass', 2400, 0.8, sr),
    }));
    this.airbox = new Biquad('bandpass', 168, 1.6, sr);
    this.runner = new Biquad('bandpass', 560, 3.2, sr);
    this.roarBp = new SVF(950, 0.8, sr);
    this.hissHp = new Biquad('highpass', 3600, 0.7, sr);
    this.intHp = new OnePole(45, sr);
    this.envInt = 0;
    this.vClick = 0;
    this.inj = 0;
    this.clickBp = new Biquad('bandpass', 5200, 1.4, sr);
    this.clickBp2 = new Biquad('bandpass', 9300, 2, sr);
    this.injBp = new Biquad('bandpass', 2600, 2.5, sr);
    this.rumbleLp = new OnePole(180, sr);
    this.bodyLp1 = new OnePole(140, sr);
    this.bodyLp2 = new OnePole(140, sr);
    this.bodyHp = new OnePole(16, sr);
    // starter motor
    this.arm = 0;
    this.armSpin = 0; // freewheel after the engine catches
    this.wasCrank = 0;
    this.starterBp = new Biquad('bandpass', 3100, 1.2, sr);
    // smoothed block controls
    this.loadS = 0.12;
    this.valveS = 0;
    this.pos = 0;
    this.cacheStart = -1;
    this.cacheN = 0;
    const max = 4096;
    this.out = { exL: new Float32Array(max), exR: new Float32Array(max), intake: new Float32Array(max), mech: new Float32Array(max), starter: new Float32Array(max), body: new Float32Array(max) };
  }

  /** Block of the engine's outputs starting at absolute sample abs (shared by every tap in sync). */
  get(abs, n) {
    if (abs === this.cacheStart && n === this.cacheN) return this.out;
    if (abs < this.pos) {
      // a tap out of step (should not happen): hand it silence rather than garbage
      for (const k in this.out) this.out[k].fill(0, 0, n);
      return this.out;
    }
    while (this.pos < abs) this._produce(Math.min(2048, abs - this.pos)); // skip forward
    this._produce(n);
    this.cacheStart = abs;
    this.cacheN = n;
    return this.out;
  }

  _fire(rpm, load, fuel, cold) {
    const E = this.E;
    const c = E.order[this.fireIdx % E.cylinders];
    this.fireIdx++;
    const cy = this.cyl[c];
    const rng = this.rng;
    // combustion: stronger with load; more irregular cold, at idle and light load
    const sig = 0.035 + 0.11 * (1 - load) * (rpm < 2200 ? 1 : 0.5) + 0.12 * cold;
    let A = 0;
    if (fuel > 0.01) {
      A = fuel * (0.16 + 0.84 * Math.pow(load, 0.8)) * cy.gain * Math.max(0.2, 1 + sig * rng.gauss());
      if (cold > 0 && rng.chance(0.05 * cold)) A *= 0.15; // a weak cylinder on a cold start
    } else if (rpm > 1400) {
      A = 0.055 * (0.3 + 1.4 * rng.next()); // sport-mode overrun: a trickle of fuel keeps it burbling
    }
    const dly = cy.delay * (rpm / 60); // header length as a delay, in revolutions
    this.pulses.push({ th0: this.theta + dly, A, pump: 0.085 + 0.12 * load, bank: E.bankOf(c), ap: cy.ap * (0.72 + 0.4 * (1 - load)), br: cy.bright });
    this.intakes.push({ th0: this.theta + 1.0 + dly * 0.5, A: (0.25 + 0.75 * load) * cy.gain });
    this.inj = 0.6 + 0.4 * rng.next();
    // the next firing: 72 degrees, with a little timing scatter (much more at idle)
    const jit = (rpm < 1800 ? 0.0022 : 0.0007) * (1 + 2 * cold);
    this.nextFire += 0.2 + jit * rng.gauss();
  }

  _produce(n) {
    const sr = this.sr, ctl = this.ctl, E = this.E;
    const t = this.pos / sr, t1 = (this.pos + n) / sr;
    const rpmA = ctl.at('rpm', t), rpmB = ctl.at('rpm', t1);
    const loadT = ctl.at('load', t);
    this.loadS += (loadT - this.loadS) * Math.min(1, n / (0.006 * sr));
    const load = clamp(this.loadS, 0, 1);
    const fuel = ctl.at('fuel', t);
    const crank = ctl.at('crank', t);
    const cold = ctl.at('cold', t);
    const rpmMid = (rpmA + rpmB) / 2;
    const vTarget = ctl.ch.valve ? ctl.at('valve', t) : load > 0.35 || rpmMid > 3800 ? 1 : 0.15;
    this.valveS += (vTarget - this.valveS) * Math.min(1, n / (0.25 * sr));
    const valve = this.valveS;
    const rpmF = clamp(rpmMid / E.redline, 0, 1.1);
    for (const b of this.bank) {
      b.muf.set('lowpass', lerp(1500, 5600, valve) * (0.85 + 0.25 * load), 0.7, sr);
      b.notch.set('peak', 880, 1.1, sr, -6 * (1 - valve));
    }
    const mufGain = lerp(0.5, 1, valve);
    const drive = 0.35 + 1.6 * load * rpmF;
    const raspAmt = 0.03 + 0.26 * load * rpmF * rpmF;
    // pops that start in this block
    while (this.popI < this.pops.length && this.pops[this.popI].t < t1) {
      const p = this.pops[this.popI++];
      if (p.t < t - 0.05) continue;
      this.activePops.push({ at: Math.max(0, Math.round((p.t - t) * sr)), age: 0, bank: p.bank, I: p.I });
    }
    const O = this.out;
    const exL = O.exL, exR = O.exR, oInt = O.intake, oMech = O.mech, oSt = O.starter, oBody = O.body;
    const nz = this.noise, nz2 = this.n2;
    // starter: engaged while cranking, then freewheels down
    if (crank > 0.5) this.armSpin = 1;
    else if (this.wasCrank > 0.5) this.armSpin = 1.7;
    this.wasCrank = crank;
    for (let k = 0; k < n; k++) {
      let rpm = rpmA + ((rpmB - rpmA) * k) / n;
      if (crank > 0.5) rpm *= 1 + 0.34 * Math.sin(TAU * 5 * this.theta); // the crank slows on every compression
      const dth = Math.max(0, rpm) / 60 / sr;
      this.theta += dth;
      while (this.theta >= this.nextFire && dth > 0) this._fire(rpm, load, crank > 0.5 ? fuel * 0.5 : fuel, cold);
      // valvetrain: forty valves, a tick every 18 degrees
      while (this.theta >= this.nextValve && dth > 0) {
        this.vClick = Math.max(this.vClick, 0.35 + 0.65 * this.rng.next());
        this.nextValve += 0.05;
      }
      // ---- exhaust pulses into each bank
      let p0 = 0, p1 = 0;
      const pl = this.pulses;
      for (let j = pl.length - 1; j >= 0; j--) {
        const P = pl[j];
        const a = (this.theta - P.th0) * 360;
        if (a < 0) continue;
        if (a > 250) {
          pl[j] = pl[pl.length - 1];
          pl.pop();
          continue;
        }
        const x = a / P.ap;
        const taper = a > 205 ? 0.5 + 0.5 * Math.cos((Math.PI * (a - 205)) / 45) : 1;
        const v = (P.A * x * Math.exp(1 - x) * P.br + P.pump * Math.sin((Math.PI * a) / 250)) * taper;
        if (P.bank) p1 += v;
        else p0 += v;
      }
      // pops: a pressure spike in the pipe (rings with it) plus the crack at the tail pipe
      let pop0 = 0, pop1 = 0, crack0 = 0, crack1 = 0, popBody = 0;
      const ap = this.activePops;
      for (let j = ap.length - 1; j >= 0; j--) {
        const P = ap[j];
        if (P.at > 0) {
          P.at--;
          continue;
        }
        const tt = P.age++ / sr;
        if (tt > 0.03) {
          ap[j] = ap[ap.length - 1];
          ap.pop();
          continue;
        }
        const press = P.I * 5.2 * (1 - Math.exp(-tt / 0.00025)) * Math.exp(-tt / 0.0021);
        const cr = P.I * 1.1 * nz2.white() * Math.exp(-tt / 0.0035);
        if (P.bank) {
          pop1 += press;
          crack1 += cr;
        } else {
          pop0 += press;
          crack0 += cr;
        }
        popBody += press * (P.I > 0.7 ? 1.6 : 0.6);
      }
      // ---- each bank: pipe waveguides, saturation, muffler, radiation
      const w0 = nz.white(), w1 = nz.white();
      for (let b = 0; b < 2; b++) {
        const B = this.bank[b];
        const press = b ? p1 : p0;
        const rasp = B.raspBp.tick((b ? w1 : w0) * press) * raspAmt;
        const x = press + (b ? pop1 : pop0) + rasp;
        const y1 = x - 0.56 * B.lp1.lp(B.d1.readInt(B.D1));
        B.d1.write(y1);
        const y2 = y1 - 0.42 * B.lp2.lp(B.d2.readInt(B.D2));
        B.d2.write(y2);
        const g = 0.32 * drive;
        const z = softClip(y2 * g) / g;
        let m = B.notch.tick(B.res.tick(B.muf.tick(z))) * mufGain;
        const h = B.hp.hp(m);
        const rad = h + 0.4 * (h - B.prev) * 9.5;
        B.prev = h;
        const outv = rad + (b ? crack1 : crack0);
        if (b) exR[k] = outv;
        else exL[k] = outv;
      }
      // ---- intake: suction pulses through the airbox and runners, roar at full throttle, hiss when closed
      let xi = 0;
      const il = this.intakes;
      for (let j = il.length - 1; j >= 0; j--) {
        const P = il[j];
        const a = (this.theta - P.th0) * 360;
        if (a < 0) continue;
        if (a > 180) {
          il[j] = il[il.length - 1];
          il.pop();
          continue;
        }
        xi -= P.A * (0.5 - 0.5 * Math.cos((TAU * a) / 180));
      }
      this.envInt += (Math.abs(xi) - this.envInt) * 0.02;
      this.roarBp.tick(nz.pink());
      const roar = this.roarBp.bp;
      const hiss = this.hissHp.tick(w1) * (1 - load) * rpmF * rpmF * 0.14;
      const iv = this.airbox.tick(xi) * 3.2 + this.runner.tick(xi) * 1.6 * (0.3 + rpmF) + roar * this.envInt * load * (0.4 + 1.6 * rpmF) * 1.1 + hiss + xi * 0.15;
      oInt[k] = this.intHp.hp(iv);
      // ---- engine bay: valve ticks, injectors, cam chain whine, block rumble
      this.vClick *= 0.8;
      this.inj *= 0.72;
      const click = this.clickBp.tick(w0 * this.vClick) * 1.4 + this.clickBp2.tick(w1 * this.vClick) * 0.7;
      const injc = this.injBp.tick(w1 * this.inj) * 0.9;
      const whine = sinCycle(31.3 * this.theta) * 0.018 * rpmF * (0.4 + load);
      const rumble = this.rumbleLp.lp(w0) * (p0 + p1) * 0.9;
      oMech[k] = click * (0.6 - 0.3 * rpmF) + injc * (1 - 0.7 * rpmF) + whine + rumble;
      // ---- low-frequency body: the pressure pulsation itself (what the cabin and the subwoofer feel)
      const bp = this.bodyLp2.lp(this.bodyLp1.lp(p0 + p1 + popBody * 0.5));
      oBody[k] = this.bodyHp.hp(bp);
      // ---- starter motor (13:1 onto the flywheel, 22 commutator bars)
      let st = 0;
      if (crank > 0.5 || this.armSpin > 0.002) {
        const armRpm = crank > 0.5 ? rpm * 13 : 3100 * this.armSpin;
        this.arm += armRpm / 60 / sr;
        const ph = 22 * this.arm;
        st = (sinCycle(ph) + 0.5 * sinCycle(2 * ph + 0.3) + 0.25 * sinCycle(3 * ph + 0.1)) * 0.35 + sinCycle(2 * this.arm) * 0.25
          + this.starterBp.tick(w0) * 0.5;
        st *= crank > 0.5 ? 0.8 + 0.25 * Math.sin(TAU * 5 * this.theta + 1.2) : this.armSpin * 0.6;
        if (crank <= 0.5) this.armSpin *= 0.99988;
      }
      oSt[k] = st;
    }
    this.pos += n;
  }
}

/**
 * One place to hear an engine from: a mix of its outputs with its own colouring.
 * opts: core, t0 (score time the voice starts), dur, mix { exL, exR, intake, mech, starter, body },
 *       lp (Hz, e.g. the firewall), lowShelf { f, db }, hp (Hz)
 */
export class EngineVoice {
  constructor(sr, o) {
    this.sr = sr;
    this.core = o.core;
    this.start = Math.round(o.t0 * sr);
    this.done = 0;
    this.max = Math.round((o.dur ?? 10) * sr);
    const m = o.mix || {};
    this.m = [m.exL || 0, m.exR || 0, m.intake || 0, m.mech || 0, m.starter || 0, m.body || 0];
    this.lp = o.lp ? new Biquad('lowpass', o.lp, 0.6, sr) : null;
    this.lp2 = o.lp ? new Biquad('lowpass', o.lp * 1.3, 0.55, sr) : null;
    this.shelf = o.lowShelf ? new Biquad('lowshelf', o.lowShelf.f, 0.7, sr, o.lowShelf.db) : null;
    this.hp = o.hp ? new Biquad('highpass', o.hp, 0.7, sr) : null;
    this.gain = o.gain ?? 1;
  }

  process(out, i0, n) {
    const b = this.core.get(this.start + this.done, n);
    const [a, bb, c, d, e, f] = this.m;
    const g = this.gain;
    for (let k = 0; k < n; k++) {
      let s = a * b.exL[k] + bb * b.exR[k] + c * b.intake[k] + d * b.mech[k] + e * b.starter[k] + f * b.body[k];
      if (this.shelf) s = this.shelf.tick(s);
      if (this.lp) s = this.lp2.tick(this.lp.tick(s));
      if (this.hp) s = this.hp.tick(s);
      out[i0 + k] = s * g;
    }
    this.done += n;
    return this.done < this.max;
  }
}

// ---------------------------------------------------------------- hearing a moving car from outside
/**
 * Where the sound heard at time t left the car: solves t - te = |car(te) - ear| / c (a few fixed-point steps).
 * carAt(t) -> { p: [x, y, z], h }. Returns { te, r, p, h }.
 */
export function retarded(carAt, ear, t) {
  let te = t, r = 0, q = null;
  for (let i = 0; i < 4; i++) {
    q = carAt(te);
    r = Math.hypot(q.p[0] - ear[0], q.p[1] - ear[1], q.p[2] - ear[2]);
    te = t - r / C_AIR;
  }
  return { te, r, p: q.p, h: q.h };
}

/** Azimuth (degrees, clockwise from the listener's facing) of a point for a listener facing heading `face`. */
export function azFrom(ear, face, p) {
  const dx = p[0] - ear[0], dz = p[2] - ear[2];
  const fwd = dx * Math.sin(face) - dz * Math.cos(face);
  const right = dx * Math.cos(face) + dz * Math.sin(face);
  return (Math.atan2(right, fwd) * 180) / Math.PI;
}

/**
 * The car heard from a fixed point: engine (+ tyres and air) through a long delay line read at the propagation
 * delay of the direct path and of the ground reflection, 1/r spreading from a reference distance, air absorption,
 * and the exhaust's directivity (louder from behind the car).
 * opts: core, t0, dur, carAt(t) -> { p, h }, ear [x, y, z], ref (m), mix, ctl (for tyre noise from speed),
 *       diffuse (true: the far-field feed for the reverb: 1/sqrt(r), no reflection), maxDist (m)
 */
export class PassBy {
  constructor(sr, o) {
    this.sr = sr;
    this.core = o.core;
    this.start = Math.round(o.t0 * sr);
    this.done = 0;
    this.max = Math.round((o.dur ?? 10) * sr);
    this.carAt = o.carAt;
    this.ear = o.ear;
    this.ref = o.ref ?? 6;
    this.diffuse = !!o.diffuse;
    const m = o.mix || { exL: 1, exR: 1, intake: 0.25, mech: 0.15, body: 0.4 };
    this.m = [m.exL || 0, m.exR || 0, m.intake || 0, m.mech || 0, m.starter || 0, m.body || 0];
    this.ctl = o.ctl;
    const maxD = ((o.maxDist ?? 1400) / C_AIR) * sr + 1024;
    let size = 1024;
    while (size < maxD) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
    this.w = 0;
    this.noise = new Noise(o.seed || 5);
    this.tyreBp = new SVF(700, 0.6, sr);
    this.aeroLp = new OnePole(2500, sr);
    this.airA = new OnePole(20000, sr);
    this.airB = new OnePole(20000, sr);
    this.reflLp = new OnePole(6000, sr);
    this.g = null;
    this.gain = o.gain ?? 1;
  }

  _read(d) {
    const p = this.w - d;
    const i = Math.floor(p);
    const f = p - i;
    const m = this.mask, b = this.buf;
    const y0 = b[(i - 1) & m], y1 = b[i & m], y2 = b[(i + 1) & m], y3 = b[(i + 2) & m];
    // 4-point Hermite: clean pitch shifts
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  _geom(t) {
    const ear = this.ear;
    const q = retarded(this.carAt, ear, t);
    const hs = q.p[1] || 0.45;
    const dh = Math.hypot(q.p[0] - ear[0], q.p[2] - ear[2]);
    const r1 = Math.max(0.5, q.r);
    const r2 = Math.hypot(dh, hs + ear[1]);
    // exhaust points backwards: 1.0 from behind the car, 0.55 head-on
    const fx = Math.sin(q.h), fz = -Math.cos(q.h);
    const tx = (ear[0] - q.p[0]) / r1, tz = (ear[2] - q.p[2]) / r1;
    const cosF = fx * tx + fz * tz; // +1: the car is coming straight at us
    const dir = 0.55 + 0.45 * (1 - cosF) / 2;
    const spread = this.diffuse ? Math.sqrt(this.ref / Math.max(this.ref, r1)) * 0.5 : Math.pow(this.ref / Math.max(this.ref * 0.5, r1), 0.72);
    return { d1: (r1 / C_AIR) * this.sr, d2: (r2 / C_AIR) * this.sr, g1: spread * dir, g2: this.diffuse ? 0 : 0.6 * (this.ref / Math.max(1, r2)) * dir,
      air: 21000 / (1 + r1 / 85), front: Math.max(0, cosF) };
  }

  process(out, i0, n) {
    const sr = this.sr;
    const abs = this.start + this.done;
    const b = this.core.get(abs, n);
    const [ma, mb, mc, md, me, mf] = this.m;
    const t = abs / sr, t1 = (abs + n) / sr;
    const gA = this.g || this._geom(t);
    const gB = this._geom(t1);
    this.g = gB;
    // tyres and air rush at speed, mostly heard as the car is near
    const v = this.ctl ? this.ctl.at('speed', Math.max(0, t - gA.d1 / sr)) : 0;
    const tyreAmt = Math.min(1.5, Math.pow(v / 70, 2)) * 0.22;
    this.tyreBp.set(300 + v * 9, 0.6, sr);
    this.airA.set(gA.air, sr);
    this.airB.set(Math.min(9000, gA.air * 0.6), sr);
    for (let k = 0; k < n; k++) {
      let s = ma * b.exL[k] + mb * b.exR[k] + mc * b.intake[k] + md * b.mech[k] + me * b.starter[k] + mf * b.body[k];
      if (tyreAmt > 0.001) {
        this.tyreBp.tick(this.noise.pink());
        s += (this.tyreBp.bp * 2.2 + this.aeroLp.lp(this.noise.white()) * 0.8) * tyreAmt;
      }
      this.buf[this.w] = s;
      this.w = (this.w + 1) & this.mask;
      const x = (k + 1) / n;
      const d1 = gA.d1 + (gB.d1 - gA.d1) * x;
      let y = this.airA.lp(this._read(d1 + 1)) * (gA.g1 + (gB.g1 - gA.g1) * x);
      if (!this.diffuse) {
        const d2 = gA.d2 + (gB.d2 - gA.d2) * x;
        y += this.reflLp.lp(this._read(d2 + 1)) * (gA.g2 + (gB.g2 - gA.g2) * x);
      } else y = this.airB.lp(y);
      out[i0 + k] = y * this.gain;
    }
    this.done += n;
    return this.done < this.max;
  }
}

// ---------------------------------------------------------------- from the cockpit: tyres and wind
/**
 * One tyre on the road: rolling roar rising with speed, grit, a kerb's rumble strip, squeal at the grip limit.
 * opts: ctl (speed, latG, kerbL/kerbR), t0, dur, side ('L'|'R'), front (bool), seed
 */
export class Tyre {
  constructor(sr, o) {
    this.sr = sr;
    this.ctl = o.ctl;
    this.t = o.t0;
    this.max = Math.round((o.dur ?? 10) * sr);
    this.i = 0;
    this.side = o.side || 'L';
    this.front = !!o.front;
    this.noise = new Noise(o.seed || 41);
    this.roll = new SVF(500, 0.55, sr);
    this.low = new OnePole(120, sr);
    this.sq = new SVF(1300, 9, sr);
    this.kerbPh = 0;
    this.kerbLp = new OnePole(260, sr);
    this.grit = 0;
    this.gritBp = new Biquad('bandpass', 2400, 1.2, sr);
    this.sqPh = 0;
  }

  process(out, i0, n) {
    const sr = this.sr, ctl = this.ctl;
    const t = this.t + this.i / sr;
    const v = ctl.at('speed', t);
    const lat = ctl.at('latG', t);
    const kerb = ctl.at(this.side === 'L' ? 'kerbL' : 'kerbR', t);
    const lvl = Math.min(1.4, Math.pow(v / 60, 1.5)) * 0.3;
    this.roll.set(180 + v * 11, 0.55, sr);
    // the outside tyres load up in a corner and start to sing near the limit
    const outside = (lat > 0 && this.side === 'L') || (lat < 0 && this.side === 'R') ? 1 : 0.35;
    const squeal = Math.max(0, Math.abs(lat) - 0.95) * 1.6 * outside * (v > 8 ? 1 : 0);
    const nz = this.noise;
    for (let k = 0; k < n; k++) {
      const w = nz.white();
      this.roll.tick(nz.pink());
      let s = this.roll.bp * lvl * 1.8 + this.low.lp(nz.brown()) * lvl * 1.1;
      // grit and expansion joints: sparse ticks, more at speed
      if (nz.white() > 1 - 0.0006 * (v / 30)) this.grit = 0.6 + 0.4 * Math.abs(nz.white());
      this.grit *= 0.985;
      s += this.gritBp.tick(w * this.grit) * lvl * 0.9;
      if (kerb > 0.01) {
        // rumble strip: ridges every 0.55 m
        this.kerbPh += v / 0.55 / sr;
        const ridge = Math.pow(Math.max(0, Math.sin(TAU * this.kerbPh)), 6);
        s += this.kerbLp.lp(ridge * (1 + 0.3 * w)) * kerb * 1.1;
      }
      if (squeal > 0.001) {
        this.sqPh += 1;
        this.sq.set(1250 + 220 * Math.sin(this.sqPh * 0.00031) + 90 * w, 11, sr);
        this.sq.tick(w);
        s += this.sq.bp * squeal * 0.9;
      }
      out[i0 + k] = s;
    }
    this.i += n;
    return this.i < this.max;
  }
}

/** Air over the car: broadband rush rising steeply with speed, gusts, a faint A-pillar whistle. */
export class Wind {
  constructor(sr, o) {
    this.sr = sr;
    this.ctl = o.ctl;
    this.t = o.t0;
    this.max = Math.round((o.dur ?? 10) * sr);
    this.i = 0;
    this.noise = new Noise(o.seed || 43);
    this.lp = new SVF(1500, 0.6, sr);
    this.hp = new OnePole(220, sr);
    this.wh = new SVF(2300, 14, sr);
    this.gust = 0;
    this.gustT = 0;
    this.whistle = o.whistle ?? 1;
  }

  process(out, i0, n) {
    const sr = this.sr;
    const t = this.t + this.i / sr;
    const v = this.ctl.at('speed', t);
    const lvl = Math.min(1.6, Math.pow(v / 70, 2.2)) * 0.32;
    this.lp.set(600 + v * 75, 0.6, sr);
    this.wh.set(2100 + v * 6, 14, sr);
    const nz = this.noise;
    for (let k = 0; k < n; k++) {
      if (--this.gustT <= 0) {
        this.gustT = sr * (0.2 + 0.6 * Math.abs(nz.white()));
        this.gTarget = 0.75 + 0.5 * Math.abs(nz.white());
      }
      this.gust += ((this.gTarget || 1) - this.gust) * 0.0004;
      const w = nz.white();
      this.lp.tick(this.hp.hp(nz.pink()));
      this.wh.tick(w);
      out[i0 + k] = (this.lp.lp * 2 + this.wh.bp * 0.5 * this.whistle * Math.max(0, v - 40) / 60) * lvl * this.gust;
    }
    this.i += n;
    return this.i < this.max;
  }
}

// ---------------------------------------------------------------- the garage: small mechanical sounds
/** A relay: coil thunk then contact bounce (two quick metallic ticks). */
export class Relay {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.vel = o.vel ?? 0.6;
    this.noise = new Noise(o.seed || 47);
    this.bp = new Biquad('bandpass', 3800, 3, sr);
    this.body = new Biquad('bandpass', 620, 4, sr);
    this.hits = [[0, 1], [0.0042, 0.55], [0.0071, 0.3]];
    this.i = 0;
    this.max = Math.round(0.08 * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      let e = 0;
      for (const [t0, g] of this.hits) if (t >= t0) e += g * Math.exp(-(t - t0) / 0.0009);
      const w = this.noise.white();
      out[i0 + k] = (this.bp.tick(w * e) * 2.6 + this.body.tick(w * e) * 1.2) * this.vel;
    }
    return this.i < this.max;
  }
}

/** Fuel pump priming: an electric motor whine climbing to speed, pressure hiss, then stopping. */
export class FuelPump {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 1.9;
    this.vel = o.vel ?? 0.5;
    this.noise = new Noise(o.seed || 53);
    this.ph = 0;
    this.hiss = new Biquad('bandpass', 5200, 0.9, sr);
    this.case = new Biquad('peak', 330, 2, sr, 6);
    this.i = 0;
    this.max = Math.round((this.dur + 0.3) * sr);
  }

  process(out, i0, n) {
    const sr = this.sr, D = this.dur;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const spin = t < D ? 1 - Math.exp(-t / 0.12) : Math.exp(-(t - D) / 0.06);
      const f = 145 * spin * (1 + 0.02 * Math.sin(t * 31));
      this.ph += f / sr;
      const tone = sinCycle(this.ph) * 0.5 + sinCycle(2 * this.ph + 0.2) * 0.35 + sinCycle(4 * this.ph) * 0.25 + sinCycle(11 * this.ph) * 0.12;
      const e = Math.min(1, t / 0.03) * (t < D ? 1 : Math.exp(-(t - D) / 0.05));
      const press = t < D ? Math.min(1, t / D) : Math.exp(-(t - D) / 0.03);
      out[i0 + k] = (this.case.tick(tone) * 0.5 * e + this.hiss.tick(this.noise.white()) * 0.25 * press * e) * this.vel;
    }
    return this.i < this.max;
  }
}

/** Radiator fans: blade-pass hum and turbulent air, spinning up, running, spinning down. */
export class Fan {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 12;
    this.vel = o.vel ?? 0.4;
    this.blades = o.blades ?? 7;
    this.rps = o.rps ?? 38;
    this.noise = new Noise(o.seed || 59);
    this.air = new SVF(900, 0.7, sr);
    this.ph = 0;
    this.i = 0;
    this.max = Math.round((this.dur + 4) * sr);
  }

  process(out, i0, n) {
    const sr = this.sr, D = this.dur;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const spin = t < D ? 1 - Math.exp(-t / 0.7) : Math.exp(-(t - D) / 1.1);
      this.ph += (this.rps * spin) / sr;
      const bpf = this.blades * this.ph;
      this.air.set(300 + 900 * spin, 0.7, sr);
      this.air.tick(this.noise.pink());
      const s = (sinCycle(bpf) * 0.35 + sinCycle(2 * bpf + 0.4) * 0.12) * spin + this.air.bp * 1.4 * spin * spin + sinCycle(this.ph * 3) * 0.04 * spin;
      out[i0 + k] = s * this.vel;
    }
    return this.i < this.max;
  }
}

/** One tick of cooling metal: a tiny, bright, slightly ringing click. */
export class Tick {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.vel = o.vel ?? 0.3;
    this.noise = new Noise(o.seed || 61);
    this.f = o.freq ?? 3200;
    this.ring = new Biquad('bandpass', this.f, 18, sr);
    this.ring2 = new Biquad('bandpass', this.f * 2.71, 22, sr);
    this.hp = new OnePole(1500, sr);
    this.i = 0;
    this.max = Math.round(0.12 * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      const e = i < 3 ? 1 : 0;
      const w = this.noise.white();
      const click = this.hp.hp(w * Math.exp(-i / (0.00025 * sr)));
      out[i0 + k] = (click * 0.9 + this.ring.tick(e * 0.6) * 9 + this.ring2.tick(e * 0.4) * 6) * this.vel;
    }
    return this.i < this.max;
  }
}

/** A roller door: motor whine, chain rattle, slats clattering over the drum. Opens (or closes) over dur. */
export class RollerDoor {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 5;
    this.vel = o.vel ?? 0.6;
    this.noise = new Noise(o.seed || 67);
    this.ph = 0;
    this.motor = new Biquad('peak', 240, 3, sr, 8);
    this.slat = new Biquad('bandpass', 950, 2.5, sr);
    this.slatLow = new Biquad('bandpass', 180, 1.5, sr);
    this.chain = new Biquad('bandpass', 4200, 2, sr);
    this.next = 0;
    this.slatE = 0;
    this.chainE = 0;
    this.i = 0;
    this.max = Math.round((this.dur + 1.2) * sr);
  }

  process(out, i0, n) {
    const sr = this.sr, D = this.dur;
    const nz = this.noise;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const run = t < D ? Math.min(1, t / 0.25) : Math.max(0, 1 - (t - D) / 0.15);
      this.ph += (118 * (0.9 + 0.1 * run)) / sr;
      const motor = this.motor.tick(sinCycle(this.ph) * 0.4 + sinCycle(2 * this.ph) * 0.25 + nz.white() * 0.05) * run;
      // a slat joint passes over the drum every ~0.21 s, the chain clicks much faster
      if (t < D && this.i >= this.next) {
        this.next = this.i + sr * (0.19 + 0.05 * Math.abs(nz.white()));
        this.slatE = 0.7 + 0.3 * Math.abs(nz.white());
      }
      this.slatE *= 0.9992;
      if (t < D && nz.white() > 0.992) this.chainE = 0.5 + 0.5 * Math.abs(nz.white());
      this.chainE *= 0.96;
      const w = nz.white();
      let s = motor * 0.5 + this.slat.tick(w * this.slatE) * 1.4 + this.slatLow.tick(w * this.slatE) * 1.6 + this.chain.tick(w * this.chainE) * 0.8;
      // the final clunk at the stop
      if (t >= D && t < D + 0.4) s += this.slatLow.tick(w * Math.exp(-(t - D) / 0.05)) * 4;
      out[i0 + k] = s * this.vel;
    }
    return this.i < this.max;
  }
}

/** A fluorescent tube striking: starter clicks, flickers, then the ballast's 120 Hz hum. */
export class Tube {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 20;
    this.vel = o.vel ?? 0.3;
    this.mains = o.mains ?? 60;
    this.strikes = o.strikes || [0, 0.21, 0.36, 0.7];
    this.noise = new Noise(o.seed || 71);
    this.tick = new Biquad('bandpass', 2900, 4, sr);
    this.ph = 0;
    this.i = 0;
    this.max = Math.round(this.dur * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    const on = this.strikes[this.strikes.length - 1];
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      let e = 0;
      for (const s of this.strikes) if (t >= s) e += Math.exp(-(t - s) / 0.004);
      this.ph += (this.mains * 2) / sr;
      const hum = t > on ? (sinCycle(this.ph) * 0.4 + sinCycle(2 * this.ph) * 0.2 + sinCycle(3 * this.ph) * 0.12) * Math.min(1, (t - on) / 0.2) : 0;
      const fade = this.dur - t < 0.5 ? Math.max(0, (this.dur - t) / 0.5) : 1;
      out[i0 + k] = (this.tick.tick(this.noise.white() * e) * 3 + hum * 0.06 + this.noise.white() * 0.0015 * (t > on ? 1 : 0)) * this.vel * fade;
    }
    return this.i < this.max;
  }
}

/** A cricket: trains of short 4-5 kHz chirps. */
export class Cricket {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.dur = o.dur ?? 10;
    this.f = o.freq ?? 4600;
    this.vel = o.vel ?? 0.1;
    this.rate = o.rate ?? 1.3; // chirps per second
    this.pulses = o.pulses ?? 4;
    this.rng = new Rng(o.seed || 73);
    this.ph = 0;
    this.i = 0;
    this.next = Math.round(this.rng.range(0, 1) * sr);
    this.max = Math.round(this.dur * sr);
    this.chirpT = -1;
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const i = this.i++;
      if (i >= this.next) {
        this.chirpT = 0;
        this.next = i + Math.round((sr / this.rate) * this.rng.range(0.85, 1.15));
      }
      let s = 0;
      if (this.chirpT >= 0) {
        const t = this.chirpT++ / sr;
        const P = 0.022; // pulse spacing
        const pi = Math.floor(t / P);
        if (pi < this.pulses) {
          const x = (t - pi * P) / 0.014;
          if (x < 1) s = Math.sin(Math.PI * x) ** 2;
        } else this.chirpT = -1;
      }
      this.ph += this.f / sr;
      const fade = Math.min(1, i / (0.5 * sr), (this.max - i) / (0.5 * sr));
      out[i0 + k] = sinCycle(this.ph) * s * this.vel * fade;
    }
    return this.i < this.max;
  }
}

/** A shift paddle: a crisp plastic-and-spring click right at your fingertips. */
export class Paddle {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.vel = o.vel ?? 0.5;
    this.noise = new Noise(o.seed || 79);
    this.bp = new Biquad('bandpass', 2300, 2.2, sr);
    this.bp2 = new Biquad('bandpass', 5600, 3, sr);
    this.i = 0;
    this.max = Math.round(0.06 * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      const e = Math.exp(-t / 0.0011) + 0.45 * (t > 0.012 ? Math.exp(-(t - 0.012) / 0.0009) : 0);
      const w = this.noise.white();
      out[i0 + k] = (this.bp.tick(w * e) * 2 + this.bp2.tick(w * e) * 1.2) * this.vel;
    }
    return this.i < this.max;
  }
}

/** The gearbox engaging a gear: a dull mechanical clunk felt through the car. */
export class Clunk {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.vel = o.vel ?? 0.5;
    this.f = o.freq ?? 95;
    this.noise = new Noise(o.seed || 83);
    this.bp = new Biquad('bandpass', 420, 2, sr);
    this.ph = 0;
    this.i = 0;
    this.max = Math.round(0.25 * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      this.ph += (this.f * (1 + 0.4 * Math.exp(-t / 0.01))) / sr;
      const e = Math.exp(-t / 0.045);
      out[i0 + k] = (sinCycle(this.ph) * e * 0.8 + this.bp.tick(this.noise.white() * Math.exp(-t / 0.008)) * 1.5) * this.vel;
    }
    return this.i < this.max;
  }
}

/** A water drop into a puddle in a quiet concrete room. */
export class Drip {
  constructor(sr, o = {}) {
    this.sr = sr;
    this.f = o.freq ?? 1400;
    this.vel = o.vel ?? 0.2;
    this.ph = 0;
    this.i = 0;
    this.max = Math.round(0.09 * sr);
  }

  process(out, i0, n) {
    const sr = this.sr;
    for (let k = 0; k < n; k++) {
      const t = this.i++ / sr;
      this.ph += (this.f * (1 + 1.6 * t / 0.05)) / sr;
      out[i0 + k] = sinCycle(this.ph) * Math.exp(-t / 0.016) * Math.min(1, t / 0.0005) * this.vel;
    }
    return this.i < this.max;
  }
}
