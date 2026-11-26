// Purr / Rev: how it sounds. The purr sits on the seat to your right; as its pulse rate climbs to the idle's
// rhythm the engine fades in from the same place, then spreads around the whole room while it revs, and draws
// back into the cushion as it slows down into a purr again.
import { PurrCore, PurrVoice } from '../audio/cat.js';
import { EngineCore, EngineVoice } from '../audio/vehicle.js';
import { SubPulse } from '../audio/instruments.js';
import { smoothstep, clamp } from '../core/timeline.js';

const sm = smoothstep;
const SEAT_AZ = 119;

export default function setup(st, score) {
  const sr = st.sr;
  const M = score.marks;
  const D = score.duration;
  st.set('master', (t) => 0.85 * sm(0, 0.6, t) * (1 - sm(D - 1.2, D, t)));
  st.set('space', 0);
  st.set('t60A', 0.5);
  st.set('er', 0.45);
  st.set('room', { w: 6.4, front: -3.7, back: 2.7, h: 2.75, refl: { left: 0.6, right: 0.6, front: 0.55, back: 0.6, floor: 0.25, ceiling: 0.5 } });

  // the purr, its pulse rate following the morph
  const purr = new PurrCore(sr, { dur: D, t0: 0, level: (t) => score.purrLevel.at(t), rise: (t) => score.purrRise.at(t), breaths: score.breaths, f0: 23.4, seed: 5,
    brightness: (t) => 0.35 + 0.5 * score.morph.at(t) });
  st.play(0, () => new PurrVoice(sr, { core: purr, tap: 'main', t0: 0, dur: D, gain: 0.5 }), { az: SEAT_AZ, dist: 1, width: 24, rev: 0.12 });
  st.play(0, () => new PurrVoice(sr, { core: purr, tap: 'sub', t0: 0, dur: D, gain: 0.7 }), { spk: 'LFE', lfe: 1, dry: 0 });

  // the engine: born in the cushion, then filling the room while it revs
  const core = new EngineCore(sr, { ctl: score.ctl, pops: score.pops, seed: 808 });
  const spread = (t) => clamp((score.ctl.at('rpm', t) - 1400) / 3000, 0, 1) * (t > M.blip1 - 0.5 ? 1 : 0);
  const place = (side) => ({
    path: (_, t) => {
      const k = spread(t);
      return { az: SEAT_AZ + side * 70 * k, dist: 1, width: 20 + 260 * k };
    },
    gain: (t) => score.engineLevel.at(t) * 0.4, rev: 0.2,
  });
  const tap = (mix, plc, extra = {}) => st.play(0, () => new EngineVoice(sr, { core, t0: 0, dur: D, mix, ...extra }), plc);
  tap({ exL: 1 }, place(-1), { lp: 6500 });
  tap({ exR: 1 }, place(1), { lp: 6500 });
  tap({ intake: 0.8, mech: 0.5 }, { az: SEAT_AZ, dist: 1, width: 40, gain: (t) => score.engineLevel.at(t) * 0.3, rev: 0.15 });
  tap({ body: 1 }, { spk: 'LFE', lfe: 1, dry: 0, gain: (t) => score.engineLevel.at(t) * 2.2 });
  // each shift lands like a kick in the chest
  for (const t of score.shifts) st.note(t + 0.07, SubPulse, { freq: 38, dur: 0.5, vel: 0.5, drop: 0.25, texture: 0.3, seed: 3 }, { spk: 'LFE', lfe: 1, dry: 0 });
}
