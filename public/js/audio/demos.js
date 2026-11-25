// Built-in, fully synthesized demos. Each one drives the speakers *and* tells the 3D room what
// to show (which speaker is active, where the sound is, when lightning strikes).
import { RingPanner } from './synth.js';
import { ROLE_LABEL } from './engine.js';

export const BUILTIN_DEMOS = [
  {
    id: 'channel-check',
    title: 'Channel Check',
    blurb: 'Pink noise from each speaker in turn, the way a receiver calibrates. Each one lights up as it plays.',
    duration: 15,
    run: channelCheck,
  },
  {
    id: 'orbit',
    title: 'Orbit',
    blurb: 'A helicopter circles the couch: front, right, behind you, left. Close your eyes and point at it.',
    duration: 32,
    run: orbit,
  },
  {
    id: 'storm',
    title: 'Thunderstorm',
    blurb: 'Rain on every side, lightning in the lights, thunder rolling out of the subwoofer corner.',
    duration: 70,
    run: storm,
  },
  {
    id: 'lfe-sweep',
    title: 'Subwoofer Sweep',
    blurb: '120 Hz down to 18 Hz on the LFE channel. Listen for rattles and boomy notes. Start with the volume low.',
    duration: 24,
    run: lfeSweep,
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

function storm({ engine, synth, emit, ring }) {
  const ctx = engine.ctx;
  const T = timers();
  const nodes = [];
  const speakers = ring.filter((s) => s.role !== 'LFE');
  // rain: independent noise per speaker (decorrelated), band-limited, slowly breathing
  const rainGains = speakers.map((s, i) => {
    const n = synth._noise(i % 2 ? 'white' : 'pink');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900 + i * 130;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(hp).connect(lp).connect(g).connect(engine.speaker(s.role).input);
    n.start();
    nodes.push(n);
    g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 6);
    return g;
  });
  // individual drops: tiny clicks scattered around
  let dropTimer = setInterval(() => {
    const s = speakers[Math.floor(Math.random() * speakers.length)];
    const o = ctx.createOscillator();
    o.frequency.value = 2500 + Math.random() * 3000;
    const g = ctx.createGain();
    o.connect(g).connect(engine.speaker(s.role).input);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.06 * Math.random(), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.start(t);
    o.stop(t + 0.04);
  }, 45);
  const thunder = (delayMs, distance, az) => {
    T.at(delayMs, () => {
      emit('flash', { intensity: 1 - distance * 0.5, az });
      T.at(80 + Math.random() * 90, () => emit('flash', { intensity: 0.7 - distance * 0.4, az }));
      T.at(300 + distance * 2200, () => {
        // crack from the strike's direction, rumble everywhere + the sub
        const pan = new RingPanner(engine, speakers);
        pan.setAngle(az);
        const crack = synth._noise('white');
        const cf = ctx.createBiquadFilter();
        cf.type = 'highpass';
        cf.frequency.value = 700;
        const cg = ctx.createGain();
        crack.connect(cf).connect(cg).connect(pan.input);
        const t = ctx.currentTime;
        cg.gain.setValueAtTime(0, t);
        cg.gain.linearRampToValueAtTime(0.7 * (1 - distance * 0.6), t + 0.01);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        crack.start(t);
        crack.stop(t + 0.7);
        const rum = synth._noise('pink');
        const rl = ctx.createBiquadFilter();
        rl.type = 'lowpass';
        rl.frequency.value = 220;
        const rg = ctx.createGain();
        rum.connect(rl).connect(rg);
        rg.connect(pan.input);
        const sub = ctx.createGain();
        sub.gain.value = 1.8;
        rg.connect(sub).connect(engine.speaker('LFE').input);
        rg.gain.setValueAtTime(0, t);
        rg.gain.linearRampToValueAtTime(0.8, t + 0.15 + distance * 0.4);
        // rolling: a few swells
        for (let k = 1; k < 5; k++) rg.gain.linearRampToValueAtTime(0.3 + Math.random() * 0.5, t + 0.4 + k * 0.7);
        rg.gain.exponentialRampToValueAtTime(0.0001, t + 5 + distance * 3);
        rum.start(t);
        rum.stop(t + 9);
        nodes.push(rum, crack);
        emit('rumble', { intensity: 1 - distance * 0.5, dur: 4 + distance * 3 });
      });
    });
  };
  const strikes = [[7000, 0.7, -130], [16000, 0.3, 60], [24000, 0.15, -100], [33000, 0.5, 150], [41000, 0.05, -60],
    [50000, 0.4, 0], [58000, 0.2, 120]];
  for (const [ms, d, az] of strikes) thunder(ms, d, az);
  T.at(64000, () => rainGains.forEach((g) => g.gain.linearRampToValueAtTime(0, ctx.currentTime + 5)));
  T.at(70000, () => emit('end'));
  return {
    stop() {
      T.clear();
      clearInterval(dropTimer);
      dropTimer = null;
      for (const n of nodes) try { n.stop(); } catch { /* ignore */ }
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
