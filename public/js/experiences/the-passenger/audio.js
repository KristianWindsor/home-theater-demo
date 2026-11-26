// The Passenger: how it sounds. Everything the cat does comes from where the cat is: the bell and paws behind the
// couch, the jumps, kneading on the cushion beside you (to your right), the purr (with its fundamental in the
// subwoofer), the dream's lullaby and drifting wool around the room, the ear flick, the chirp.
import { PurrCore, PurrVoice, Bell, Paw, Landing, Knead, Sigh, EarFlick, Trill } from '../audio/cat.js';
import { Bed, Modal, Pad, Vox, SubPulse } from '../audio/instruments.js';
import { mtof, clamp, smoothstep } from '../core/timeline.js';

const sm = smoothstep;

/** Where something at world position p sounds from, for the listener on the couch (origin, facing the screen). */
function placeOf(p, extra = {}) {
  const az = (Math.atan2(p[0], -p[2]) * 180) / Math.PI;
  const d = Math.hypot(p[0], p[2]);
  return { az, dist: Math.max(1, d / 0.9), width: 18, ...extra };
}

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  const D = score.duration;
  let seed = 3;
  const S = () => (seed = (seed * 1103515245 + 12345) >>> 0) % 100000 + 1;
  const dream = (t) => score.dreamAmt.at(t);
  const seat = placeOf(score.SEAT);

  // ---------------------------------------------------------------- the room
  st.set('master', (t) => 0.9 * (1 - sm(D - 1.5, D, t)));
  st.set('space', (t) => clamp(dream(t) * 1.1, 0, 1));
  st.set('t60A', 0.45);
  st.set('revA', 0.8);
  st.set('t60B', (t) => 2.2 + 3.5 * dream(t));
  st.set('revB', (t) => 0.5 + 0.7 * dream(t));
  st.set('er', (t) => 0.5 * (1 - dream(t)));
  st.set('room', { w: 6.4, front: -3.7, back: 2.7, h: 2.75, refl: { left: 0.55, right: 0.55, front: 0.5, back: 0.55, floor: 0.2, ceiling: 0.45 } });
  // the theater at night: air handling, the faintest hum
  st.note(0, Bed, { dur: D, color: 'pink', type: 'lp', cutoff: 280, gain: (t) => 0.022 * (1 - 0.6 * dream(t)), seed: S() }, { az: 0, width: 360, dist: 1.5, rev: 0.1 });

  // ---------------------------------------------------------------- the cat moving about
  st.note(0, Bell, { strikes: score.bell, vel: 1.0, seed: S() }, {
    path: (_, t) => placeOf(score.catState(t).pos, { width: 10 }), rev: 0.25,
  });
  for (const e of score.events) {
    if (e.inst === 'paw') st.note(e.t, Paw, { vel: e.vel * (e.seat ? 0.5 : 0.5), surface: e.surface, seed: S() }, placeOf(e.pos, { rev: 0.18 }));
  }
  // the wiggle: hind feet treading the carpet
  for (const dt of [0.05, 0.22, 0.38]) st.note(M.wiggle + dt, Paw, { vel: 0.14, surface: 'carpet', seed: S() }, placeOf([0.46, 0, 1.14], { rev: 0.15 }));
  // jump one: push off the carpet, claws on the leather backrest
  st.note(M.jump1, Paw, { vel: 0.3, surface: 'carpet', seed: S() }, placeOf([0.46, 0, 1.14]));
  st.note(M.land1, Paw, { vel: 0.85, surface: 'leather', seed: S() }, placeOf([0.43, 1, 0.62], { rev: 0.2 }));
  st.note(M.land1 + 0.04, Knead, { dur: 0.25, rate: 14, vel: 0.35, seed: S() }, placeOf([0.43, 1, 0.62]));
  // jump two: onto the seat beside you
  st.note(M.jump2, Paw, { vel: 0.3, surface: 'leather', seed: S() }, placeOf([0.43, 1, 0.62]));
  st.note(M.land2, Landing, { vel: 0.7, seed: S() }, { ...seat, rev: 0.2 });
  st.note(M.land2 + 0.01, SubPulse, { freq: 48, dur: 0.35, vel: 0.35, drop: 0.3, texture: 0.2, seed: S() }, { spk: 'LFE', lfe: 1, dry: 0 });
  // kneading, then the two turns, then settling down with a sigh
  st.note(M.knead0, Knead, { dur: M.knead1 - M.knead0, rate: 2.2, vel: 0.5, seed: S() }, { ...seat, rev: 0.15 });
  st.note(M.settle + 0.55, Landing, { vel: 0.22, seed: S() }, { ...seat, rev: 0.2 });
  st.note(M.settle + 1.2, Sigh, { dur: 0.9, vel: 0.32, seed: S() }, { ...seat, rev: 0.25 });

  // ---------------------------------------------------------------- the purr: in the cushion beside you, and in the floor
  const purr = new PurrCore(sr, { dur: D, t0: 0, level: (t) => score.purr.at(t), sleep: (t) => score.sleep.at(t), breaths: score.breaths, f0: 23.4, seed: S(),
    brightness: (t) => 0.55 - 0.25 * score.sleep.at(t) });
  st.play(0, () => new PurrVoice(sr, { core: purr, tap: 'main', t0: 0, dur: D, gain: 0.55 }), { ...seat, width: 26, rev: 0.12 });
  st.play(0, () => new PurrVoice(sr, { core: purr, tap: 'sub', t0: 0, dur: D, gain: 1 }), {
    spk: 'LFE', lfe: 1, dry: 0, gain: (t) => 0.35 + 0.45 * score.sleep.at(t) * (0.6 + 0.4 * dream(t)),
  });

  // ---------------------------------------------------------------- the dream
  // a warm swell as the room drifts away, and the drop back into the real room at the end
  st.note(M.dream0, Bed, { dur: 9, color: 'pink', type: 'bp', q: 0.6, cutoff: (t) => 400 + 2600 * Math.min(1, t / 7), gain: (t) => 0.05 * Math.sin(Math.PI * Math.min(1, t / 9)), seed: S() },
    { az: 0, width: 360, rev: 0.8 });
  for (const e of score.events) {
    if (e.inst === 'chord') {
      e.pad.forEach((n, k) => {
        st.note(e.t, Pad, { freq: mtof(n), dur: e.dur * 1.02, vel: 0.36, cutoff: 900, toCutoff: 1400, kind: 'saw', attack: 1.6, release: e.fade ? 0.6 : 2.4, detune: 7 },
          { az: -150 + (k * 300) / (e.pad.length - 1), width: 90, dist: 1.6, rev: 0.7, gain: (t) => dream(t) * 0.24 });
      });
      st.note(e.t, Pad, { freq: mtof(e.bass), dur: e.dur, vel: 0.5, cutoff: 220, kind: 'organ', attack: 0.8, release: e.fade ? 0.5 : 1.5 },
        { az: 0, width: 200, dist: 1.2, rev: 0.3, lfe: 0.25, gain: (t) => dream(t) * 0.32 });
    } else if (e.inst === 'box') {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: 'tine', t60: 2.6, hard: 0.55, vel: e.vel, seed: S() }, { az: e.az, dist: 1.9, rev: 0.65, gain: (t) => dream(t) * 0.9 });
    } else if (e.inst === 'hum') {
      for (const d of [-6, 5]) {
        st.note(e.t, Vox, { freq: mtof(e.n), dur: e.dur, vowel: 'm', vel: e.vel, detune: d, vib: 0.08, attack: 1.4, release: 2, breath: 0.01, seed: S() },
          { az: d < 0 ? -100 : 100, dist: 1.8, rev: 0.7, gain: (t) => dream(t) * 0.22 });
      }
    } else if (e.inst === 'drift') {
      // a strand of wool drifting past: a soft woolly whoosh that travels round the room
      const dur = e.dur;
      st.note(e.t, Bed, { dur, color: 'pink', type: 'bp', q: 0.5, cutoff: (t) => 500 + 900 * Math.sin(Math.PI * Math.min(1, t / dur)), gain: (t) => 0.05 * e.vel * Math.sin(Math.PI * Math.min(1, t / dur)) ** 2, seed: S() },
        { path: (x) => ({ az: e.from + e.sweep * Math.min(1, x / dur), dist: 1.3, width: 40 }), rev: 0.6, gain: (t) => dream(t) });
    } else if (e.inst === 'glint') {
      st.note(e.t, Modal, { freq: mtof(e.n), modes: 'glass', t60: 1.4, hard: 0.5, vel: e.vel, seed: S() }, { az: e.az, dist: e.dist, rev: 0.7, gain: (t) => dream(t) * 0.45 });
    }
  }
  // the dream ends: a breath pulled in, then the room again
  st.note(M.twitch - 0.7, Bed, { dur: 0.72, color: 'white', type: 'bp', q: 0.8, cutoff: (t) => 600 * Math.pow(10, t / 0.72), gain: (t) => 0.06 * Math.pow(t / 0.72, 2.5), seed: S() },
    { az: 0, width: 360, rev: 0.4 });

  // ---------------------------------------------------------------- awake
  st.note(M.twitch, EarFlick, { vel: 0.5, seed: S() }, { ...seat, rev: 0.08 });
  st.note(M.chirp, Trill, { dur: 0.42, vel: 0.62, f: [[0, 470], [0.1, 590], [0.26, 640], [0.42, 820]], seed: S() }, { ...seat, rev: 0.22 });
}
