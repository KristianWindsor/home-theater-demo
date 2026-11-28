// Awakening's marbles (from the retired Marble Machine): every sound has a marble that lands exactly when it plays, on
// the speaker it plays from. The tick marble ping-pongs over the couch between the surround-left and front-right
// towers (it finds the tempo with the ticks); each tower's own marble drops in when the tower introduces itself and
// bounces on every note it plays; the center's marble rolls along the center speaker, one chord to the next; a heavy
// ball slams onto the subwoofer on every hit. Everything is a pure function of score time, so pausing holds the
// picture and a jump back replays it.
import { Program } from '../../gl/gl.js';
import { clamp, lerp, lastBefore, smoothstep } from '../core/timeline.js';
import { DynBuffer, rgbMul } from '../core/gfx.js';

const G = 9.8; // real gravity: a hop that lasts dt rises g dt^2 / 8 (capped per marble)

/** Lands at the given times and places, hopping between them; rests where a gap is too long to fly. */
class Bouncer {
  constructor(landings, { hMax = 0.55, maxHop = 1.3, hopDur = 0.9, drop = 2.2, dropDur = 0.68 } = {}) {
    this.L = landings; // [{ t, p, vel }], sorted
    Object.assign(this, { hMax, maxHop, hopDur, drop, dropDur });
  }

  get start() {
    return this.L.length ? this.L[0].t - this.dropDur : Infinity;
  }

  at(t) {
    const L = this.L;
    if (!L.length || t < this.start) return null;
    const first = L[0];
    if (t < first.t) {
      // falling in from the dark above its speaker
      const u = (t - this.start) / this.dropDur;
      return { pos: [first.p[0], first.p[1] + this.drop * (1 - u * u), first.p[2]], since: Infinity, vel: 0, appear: clamp(u * 3, 0, 1) };
    }
    const i = lastBefore(L, t);
    const a = L[i], b = L[i + 1];
    const out = { pos: a.p.slice(), land: a.p, since: t - a.t, vel: a.vel ?? 0.7, appear: 1 };
    if (!b) return out;
    const gap = b.t - a.t;
    const hop = gap <= this.maxHop ? gap : this.hopDur;
    const t0 = b.t - hop;
    if (t < t0) return out;
    const u = (t - t0) / hop;
    const h = Math.min((G * hop * hop) / 8, this.hMax);
    out.pos = [lerp(a.p[0], b.p[0], u), lerp(a.p[1], b.p[1], u) + 4 * h * u * (1 - u), lerp(a.p[2], b.p[2], u)];
    return out;
  }
}

/** Landings from note events: one per onset (a strum or a doubled note counts once). */
function landingsFrom(events, spot) {
  const out = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (prev && e.t - prev.t < 0.09) {
      prev.vel = Math.max(prev.vel, e.vel);
      continue;
    }
    out.push({ t: e.t, p: spot, vel: e.vel });
  }
  return out;
}

const MARBLE_VS = `#version 300 es
layout(location = 0) in vec3 aC;
layout(location = 1) in vec2 aQ;
layout(location = 2) in vec4 aCol;
layout(location = 3) in vec4 aP;   // radius, squash, spin, flash
uniform mat4 uVP;
uniform vec3 uRight, uUp;
out vec2 vQ;
out vec4 vCol;
out vec4 vP;
void main() {
  float r = aP.x, sq = aP.y;
  vec2 q = aQ * 1.04;
  vec3 c = aC + uUp * r * (sq - 1.0); // squashed on landing, its bottom stays where it landed
  vec3 p = c + uRight * q.x * r / sqrt(sq) + uUp * q.y * r * sq;
  gl_Position = uVP * vec4(p, 1.0);
  vQ = q;
  vCol = aCol;
  vP = aP;
}`;

const MARBLE_FS = `#version 300 es
precision highp float;
in vec2 vQ;
in vec4 vCol;
in vec4 vP;
out vec4 outColor;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  vec3 n = vec3(vQ, sqrt(1.0 - r2));
  vec3 L = normalize(vec3(-0.45, 0.7, 0.55));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 48.0);
  float fres = pow(1.0 - n.z, 2.2);
  // the coloured swirl inside the glass: it turns as the marble rolls or spins
  float s = vP.z;
  vec2 rq = mat2(cos(s), -sin(s), sin(s), cos(s)) * n.xy;
  float band = exp(-pow((rq.x + 0.28 * sin(rq.y * 3.4 + s * 0.5)) * 3.0, 2.0));
  vec3 c = vCol.rgb;
  float flash = vP.w;
  vec3 col = c * (0.08 + 0.3 * diff)
    + c * band * (0.55 + 1.6 * flash) * (0.35 + 0.65 * n.z)
    + c * fres * (0.45 + 0.8 * flash)
    + vec3(1.0, 0.97, 0.92) * spec * 1.1;
  float a = vCol.a * (1.0 - smoothstep(0.92, 1.0, r2));
  outColor = vec4(col * a, a);
}`;

export class Marbles {
  /**
   * score: Awakening's score. room: the 3D room (speaker tops). col: colours per instrument (scene.js COL).
   */
  constructor(gl, score, room, col) {
    this.gl = gl;
    this.room = room;
    this.M = score.marks;
    this.T = score.T;
    this.col = col;
    const ev = score.events;
    const sp = (role) => {
      for (const id in room.speakers) if (room.speakers[id].role === role) return room.speakers[id];
      return null;
    };
    const fwd = (s) => [Math.sin(s.rotY), 0, Math.cos(s.rotY)];
    // on a tower's top: its own marble sits at the back, the tick marble lands at the front
    const spot = (role, r, d = 0) => {
      const s = sp(role);
      if (!s || !s.top) return null;
      const f = fwd(s);
      return [s.top[0] + f[0] * d, s.top[1] + r, s.top[2] + f[2] * d];
    };
    this.list = [];
    const add = (m) => m.bouncer && m.bouncer.L.length && this.list.push(m);

    // the tick marble: the conversation between surround left and front right, then the beat
    const R_TICK = 0.062;
    const ticks = ev.filter((e) => e.inst === 'tick');
    const main = ticks.filter((e) => !e.last);
    const last = ticks.filter((e) => e.last);
    const tickSpot = { SL: spot('SL', R_TICK, 0.075), FR: spot('FR', R_TICK, 0.075) };
    if (tickSpot.SL && tickSpot.FR) {
      add({ key: 'tick', col: col.tick, r: R_TICK, squashAmt: 0.25, until: this.M.F + 4,
        bouncer: new Bouncer(main.map((e) => ({ t: e.t, p: tickSpot[e.spk], vel: e.vel })), { hMax: 1.15, maxHop: 1.7, hopDur: 1.15, drop: 2.0 }) });
      // the last tick behind your left shoulder: dropped in again, and it settles
      if (last.length) {
        const t0 = last[0].t, p = tickSpot.SL;
        add({ key: 'tick-last', col: col.tick, r: R_TICK, squashAmt: 0.25, until: Infinity,
          bouncer: new Bouncer([{ t: t0, p, vel: 0.9 }, { t: t0 + 0.42, p, vel: 0.25 }, { t: t0 + 0.66, p, vel: 0.08 }], { hMax: 0.3, maxHop: 0.5, drop: 2.0 }) });
      }
    }
    // each tower's marble: in on its introduction, then a bounce for every note it plays
    const R_TOWER = 0.068;
    const towerInst = { FL: 'pluck', FR: 'glass', SR: 'box', SL: 'air' };
    for (const role of ['FL', 'FR', 'SR', 'SL']) {
      const p = spot(role, R_TOWER, -0.075);
      if (!p) continue;
      const notes = ev.filter((e) => e.spk === role && e.inst !== 'tick' && (e.inst !== 'click' || role === 'SR'));
      add({ key: role, col: col[towerInst[role]], r: R_TOWER, squashAmt: 0.18, until: this.M.F + 4,
        bouncer: new Bouncer(landingsFrom(notes, p), { hMax: 0.5, maxHop: 1.25, hopDur: 0.85 }) });
    }
    // the subwoofer's ball: heavy, in on the first hit, a slam on every hit (the swells just make it shiver)
    // it comes in with the sub's line and bounces on every note; for the drop it's lifted off the cabinet through the
    // build, hangs there charging, falls in the held breath and lands with the drop (see _lifted)
    const sub = sp('LFE');
    if (sub && sub.top) {
      const R_SUB = 0.17;
      const p = [sub.top[0], sub.top[1] + R_SUB, sub.top[2]];
      this.subRest = p;
      this.swells = ev.filter((e) => e.inst === 'sub' && e.swell);
      const hits = ev.filter((e) => (e.inst === 'sub' && !e.swell) || e.inst === 'drop').map((e) => (e.inst === 'drop' ? { ...e, vel: 1.8 } : e));
      add({ key: 'sub', col: [1.0, 0.22, 0.08], r: R_SUB, squashAmt: 0.3, until: this.M.F + 4, heavy: true,
        bouncer: new Bouncer(landingsFrom(hits, p), { hMax: 0.8, maxHop: 1.4, hopDur: 1.0, drop: 2.0, dropDur: 0.64 }) });
    }
    // the center's marble rolls along the top of the center speaker, from one chord to the next
    const c = sp('FC');
    if (c && c.top) {
      const R_C = 0.058;
      const axis = [Math.cos(c.rotY), 0, -Math.sin(c.rotY)];
      const hums = landingsFrom(ev.filter((e) => e.inst === 'hum'), null).map((h) => ({ ...h, dur: ev.find((e) => e.inst === 'hum' && e.t === h.t).dur }));
      this.roller = { base: [c.top[0], c.top[1] + R_C, c.top[2]], axis, hums, r: R_C, X: 0.3 };
      add({ key: 'C', col: col.hum, r: R_C, squashAmt: 0.15, until: this.M.F + 4, roll: true,
        bouncer: new Bouncer(hums.length ? [{ t: hums[0].t, p: this.roller.base, vel: hums[0].vel }] : [], { drop: 2.0 }) });
    }

    this.prog = new Program(gl, MARBLE_VS, MARBLE_FS, 'rwu-marbles');
    this.buf = new DynBuffer(gl, [[0, 3], [1, 2], [2, 4], [3, 4]], 6 * 16);
  }

  /** Where the center marble has rolled to (an offset along the speaker) at t, and how far it has turned. */
  _roll(t) {
    const R = this.roller;
    const H = R.hums;
    const i = lastBefore(H, t);
    if (i < 0) return { x: 0, spin: 0 };
    const xAt = (k) => (k <= 0 ? 0 : k % 2 ? -R.X : R.X);
    const h = H[i];
    // a chord moves it to the other end; a long gap (no chords) leaves it where it stopped
    const dur = Math.min(h.dur, this.T.bar) * 0.88;
    const u = smoothstep(0, 1, clamp((t - h.t) / dur, 0, 1));
    const x = lerp(xAt(i), xAt(i + 1), u);
    return { x, spin: x / R.r };
  }

  /**
   * The sub's ball through the build: lifted off the cabinet, hanging there charging, falling in the held breath so it
   * lands with the drop. Null outside that stretch.
   */
  _lifted(t) {
    const M = this.M, p = this.subRest;
    if (!p || M.build === undefined || t < M.build || t >= M.drop) return null;
    const H = 1.5; // how high it's lifted
    if (t < M.breath) {
      const u = clamp((t - M.build) / 0.9, 0, 1);
      const charge = (t - M.build) / (M.breath - M.build);
      const y = p[1] + H * smoothstep(0, 1, u) + 0.012 * charge * Math.sin(t * 43);
      return { pos: [p[0], y, p[2]], charge };
    }
    const u = (t - M.breath) / (M.drop - M.breath);
    return { pos: [p[0], p[1] + H * (1 - u * u), p[2]], charge: 1 };
  }

  /** Each marble's state at t: [{ m, pos, r, squash, spin, flash, alpha }]. */
  states(t) {
    if (this._cache && this._cache.t === t) return this._cache.list;
    const out = [];
    for (const m of this.list) {
      const s = m.bouncer.at(t);
      if (!s) continue;
      if (m.heavy) {
        const lift = this._lifted(t);
        if (lift) Object.assign(s, { pos: lift.pos, since: Infinity, charge: lift.charge });
      }
      const alpha = s.appear * (m.until === Infinity ? 1 : 1 - smoothstep(m.until - 3, m.until, t));
      if (alpha <= 0.002) continue;
      const pos = s.pos;
      let spin = t * 0.7 + m.r * 40;
      let since = s.since, vel = s.vel;
      if (m.roll && s.since !== Infinity) {
        const r = this._roll(t);
        const A = this.roller.axis;
        pos[0] += A[0] * r.x;
        pos[2] += A[2] * r.x;
        spin = r.spin;
        // it glows up with each new chord as it sets off
        const H = this.roller.hums;
        const k = lastBefore(H, t);
        if (k > 0) {
          since = t - H[k].t;
          vel = H[k].vel * 0.6;
        }
      }
      if (m.heavy && this.swells) {
        // a sub swell: the ball shivers on top of the cabinet
        for (let i = lastBefore(this.swells, t); i >= 0 && t - this.swells[i].t < 8; i--) {
          const e = this.swells[i];
          const x = (t - e.t) / e.dur;
          if (x >= 0 && x <= 1) pos[1] += Math.sin(t * 71) * 0.006 * Math.sin(Math.PI * x) * e.vel * 3;
        }
      }
      let flash = since === Infinity ? 0 : Math.exp(-since / (m.heavy ? 0.4 : 0.28)) * (0.4 + 0.8 * vel);
      if (s.charge) flash = s.charge * s.charge * 1.3 * (0.85 + 0.15 * Math.sin(t * 31)); // charging before the drop
      const squash = since === Infinity || (m.roll && since !== s.since) ? 1
        : Math.max(0.55, 1 - m.squashAmt * Math.exp(-since / 0.05) * (0.5 + vel * 0.7));
      out.push({ m, pos, land: s.land, r: m.r, squash, spin, flash, alpha, since });
    }
    this._cache = { t, list: out };
    return out;
  }

  /** The marbles themselves (solid glass): call before the additive glows. */
  draw(ctx, t) {
    const gl = this.gl;
    const list = this.states(t);
    if (!list.length) return;
    const d = this.buf.data;
    let v = 0;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const s of list) {
      if (v + 6 > this.buf.max) break;
      for (const [qx, qy] of corners) {
        const o = v * 13;
        d[o] = s.pos[0]; d[o + 1] = s.pos[1]; d[o + 2] = s.pos[2];
        d[o + 3] = qx; d[o + 4] = qy;
        d[o + 5] = s.m.col[0]; d[o + 6] = s.m.col[1]; d[o + 7] = s.m.col[2]; d[o + 8] = s.alpha;
        d[o + 9] = s.r; d[o + 10] = s.squash; d[o + 11] = s.spin; d[o + 12] = s.flash;
        v++;
      }
    }
    this.buf.upload(v);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.prog.use().setAll({ uVP: ctx.vp, uRight: ctx.right, uUp: ctx.up });
    this.buf.draw(gl.TRIANGLES);
  }

  /** Halos, into the scene's additive sprites. */
  halos(t, push) {
    for (const s of this.states(t)) push(s.pos, rgbMul(s.m.col, (0.1 + 1.5 * s.flash) * s.alpha), s.r * (3.2 + 2 * s.flash));
  }

  /** A ring where each one lands, on whatever it landed on (the sub's spreads wide). */
  rings(t, ring) {
    for (const s of this.states(t)) {
      const c = s.m.col;
      if (!s.m.roll && s.land && s.since < 0.9) {
        const age = s.since;
        ring({ x: s.land[0], y: s.land[1] - s.r + 0.004, z: s.land[2], r: s.r * 1.2 + age * (s.m.heavy ? 0.9 : 0.55), col: c,
          a: Math.exp(-age / (s.m.heavy ? 0.35 : 0.22)) * s.alpha * (s.m.heavy ? 1.4 : 1.0), w: 0.07 });
      }
    }
  }

  dispose() {
    if (this.buf) this.buf.dispose();
    if (this.prog) this.gl.deleteProgram(this.prog.prog);
  }
}
