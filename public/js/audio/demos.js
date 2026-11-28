// Built-in, fully synthesized demos: the quick tests on the Sound Check page. Each one drives the speakers *and*
// tells the 3D room what to show (which speaker is active, where the sound is). `check` is
// what it checks, `blurb` what to listen for.
import { RingPanner } from './synth.js';
import { ROLE_LABEL } from './engine.js';

export const BUILTIN_DEMOS = [
  {
    id: 'channel-check',
    title: 'Channel Check',
    check: 'Speaker by speaker',
    blurb: 'Pink noise from each speaker in turn, named on screen. The plain, fast check',
    duration: 15,
    run: channelCheck,
  },
  {
    id: 'lfe-sweep',
    title: 'Subwoofer Sweep',
    check: 'Bass',
    blurb: 'A slow tone from 120 Hz down to 18 Hz: where the sub fades out, and what rattles. Start quiet',
    duration: 24,
    run: lfeSweep,
  },
  {
    id: 'orbit',
    title: 'Orbit',
    check: 'Panning',
    blurb: 'A helicopter circles the couch. It should glide from speaker to speaker, never jump',
    duration: 32,
    show: true, // it plays at the Sound check level (the two tests above at the tests level)
    run: orbit,
  },
];

function timers() {
  const ids = new Set();
  return {
    at(ms, fn) {
      const id = setTimeout(() => {
        ids.delete(id);
        fn();
      }, ms);
      ids.add(id);
    },
    clear() {
      for (const id of ids) clearTimeout(id);
      ids.clear();
    },
  };
}

function channelCheck({ engine, synth, emit, roles }) {
  const T = timers();
  const order = ['FL', 'FC', 'FR', 'SR', 'SL', 'LFE'].filter((r) => roles.includes(r));
  let playing = null;
  order.forEach((role, i) => {
    T.at(i * 2300 + 300, () => {
      emit('speaker', { role, on: true, label: ROLE_LABEL[role], virtual: engine.speaker(role).virtual });
      playing = role === 'LFE' ? synth.play(role, 'lfeRumble', { dur: 1.7 }) : synth.play(role, 'pinkBurst', { dur: 1.7 });
    });
    T.at(i * 2300 + 2200, () => emit('speaker', { role, on: false }));
  });
  T.at(order.length * 2300 + 500, () => emit('end'));
  return { stop() { T.clear(); if (playing) playing.stop(); } };
}

function orbit({ engine, synth, emit, ring }) {
  const ctx = engine.ctx;
  const T = timers();
  const pan = new RingPanner(engine, ring.filter((s) => s.role !== 'LFE'));
  // helicopter: rotor slap (amplitude-modulated filtered noise) + turbine whine + low thump
  const noise = synth._noise('white');
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  const am = ctx.createGain();
  am.gain.value = 0.15;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const lfoShape = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255 * 2 - 1;
    curve[i] = Math.pow(Math.max(0, x), 6) * 1.6;
  }
  lfoShape.curve = curve;
  lfo.connect(lfoShape).connect(am.gain);
  const whine = ctx.createOscillator();
  whine.type = 'sawtooth';
  whine.frequency.value = 1450;
  const wg = ctx.createGain();
  wg.gain.value = 0.012;
  const out = ctx.createGain();
  out.gain.value = 0;
  noise.connect(lp).connect(am).connect(out);
  whine.connect(wg).connect(out);
  out.connect(pan.input);
  const sub = synth._noise('white');
  const subLp = ctx.createBiquadFilter();
  subLp.type = 'lowpass';
  subLp.frequency.value = 70;
  const subAm = ctx.createGain();
  subAm.gain.value = 0;
  lfo.connect(lfoShape);
  const subLfo = ctx.createGain();
  subLfo.gain.value = 0.6;
  lfoShape.connect(subLfo).connect(subAm.gain);
  sub.connect(subLp).connect(subAm).connect(engine.speaker('LFE').input);
  const t0 = ctx.currentTime + 0.05;
  for (const n of [noise, lfo, whine, sub]) n.start(t0);
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(1, t0 + 3);
  out.gain.setValueAtTime(1, t0 + 28);
  out.gain.linearRampToValueAtTime(0, t0 + 31.5);
  const start = performance.now();
  let raf = 0;
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    const laps = t < 4 ? t / 4 * 0.15 : 0.15 + (t - 4) / 8;
    const angle = -laps * 360 * 1.0 + 0; // counter-clockwise from the front... then around
    const deg = ((angle % 360) + 360) % 360;
    pan.setAngle(deg > 180 ? deg - 360 : deg);
    const radius = 1.6 + 0.3 * Math.sin(t * 0.7);
    emit('orb', { angle: deg, radius, height: 1.9 + 0.2 * Math.sin(t * 1.3), on: true });
    lfo.frequency.setTargetAtTime(5.2 + 0.4 * Math.sin(t * 0.4), ctx.currentTime, 0.2);
    if (t < 32) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  T.at(32000, () => {
    emit('orb', { on: false });
    emit('end');
  });
  const nodes = [noise, lfo, whine, sub];
  return {
    stop() {
      cancelAnimationFrame(raf);
      T.clear();
      for (const n of nodes) try { n.stop(); } catch { /* ignore */ }
      pan.disconnect();
      emit('orb', { on: false });
    },
  };
}

function lfeSweep({ synth, emit }) {
  const T = timers();
  const dur = 22;
  const s = synth.play('LFE', 'sweep', { from: 120, to: 18, dur, level: 0.55 });
  emit('speaker', { role: 'LFE', on: true, label: 'Subwoofer (LFE)' });
  const start = performance.now();
  let raf = 0;
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    const f = 120 * Math.pow(18 / 120, Math.min(1, t / dur));
    emit('sweep', { freq: f, t, dur });
    if (t < dur) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  T.at(dur * 1000 + 300, () => {
    emit('speaker', { role: 'LFE', on: false });
    emit('end');
  });
  return { stop() { T.clear(); cancelAnimationFrame(raf); s.stop(); emit('speaker', { role: 'LFE', on: false }); } };
}
