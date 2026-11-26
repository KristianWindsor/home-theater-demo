// Speaker sounds from files: one-shots in media/sounds that replace the synthesized speaker clicks in the room.
// The ones in use are the synthesized clicks enhanced with layers cut from trailers, so they aren't in git
// (media/sounds/README.txt says how they're made). LFE.flac plays on the subwoofer; FL.flac, FC.flac... on their
// own speaker; mains.flac on any main speaker without a file of its own. The server lists what's there, and a
// speaker without a file keeps its synthesized sound.
// Each plays at its speaker's level whatever its level in the file, so any one-shot can be dropped in.

// Loudest 400 ms (BS.1770 momentary loudness) before the fx bus, per speaker: about 1 dB above the synthesized
// sound each file replaces (zap -24, whoosh -22, chime -13), so switching keeps the balance the synth set
const TARGET_LUFS = { FL: -23, FR: -23, FC: -12, SL: -21, SR: -21, BL: -21, BR: -21 };
const OTHER_LUFS = -21;
const MAIN_PEAK = 0.89; // and never above -1 dBFS
const LFE_PEAK = 1.25; // the sub goes by its peak (loudness weighting ignores its range): as hot as the synthesized boom

/** BS.1770 K-weighting (the two pre-filters behind LUFS) at any sample rate. */
function kWeighted(x, fs) {
  const shelf = (() => {
    const K = Math.tan((Math.PI * 1681.974450955533) / fs), Q = 0.7071752369554196;
    const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  })();
  const highpass = (() => {
    const K = Math.tan((Math.PI * 38.13547087602444) / fs), Q = 0.5003270373238773;
    const d = 1 + K / Q + K * K;
    return [1, -2, 1, (2 * (K * K - 1)) / d, (1 - K / Q + K * K) / d];
  })();
  let y = x;
  for (const [b0, b1, b2, a1, a2] of [shelf, highpass]) {
    const out = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v;
      out[i] = v;
    }
    y = out;
  }
  return y;
}

/** A decoded one-shot's peak and loudest 400 ms (LUFS), from which each speaker's gain is set. */
function measure(buffer) {
  const n = buffer.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
  const z = kWeighted(mono, buffer.sampleRate);
  const win = Math.min(n, Math.round(0.4 * buffer.sampleRate));
  let acc = 0, best = 1e-12;
  for (let i = 0; i < n; i++) {
    acc += z[i] * z[i];
    if (i >= win) acc -= z[i - win] * z[i - win];
    if (i >= win - 1) best = Math.max(best, acc / win);
  }
  return { peak, lufs: -0.691 + 10 * Math.log10(best) };
}

/** The gain that plays a measured one-shot at a speaker's level. */
function gainFor(s, role) {
  if (role === 'LFE') return LFE_PEAK / s.peak;
  return Math.min(10 ** (((TARGET_LUFS[role] ?? OTHER_LUFS) - s.lufs) / 20), MAIN_PEAK / s.peak);
}

export class SpeakerSamples {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.sounds = new Map(); // role -> { buffer, peak, lufs }
    this.loaded = '';
  }

  get size() {
    return this.sounds.size;
  }

  /** Fetch and decode the files the server lists ({ role: url }). A file that fails leaves its speaker to the synth. */
  async load(list = {}) {
    const key = JSON.stringify(list);
    if (key === this.loaded) return this;
    this.loaded = key;
    const next = new Map();
    await Promise.all(Object.entries(list).map(async ([role, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        next.set(role, { buffer, ...measure(buffer) });
      } catch (e) {
        console.warn(`[sounds] ${url}: ${e.message}`);
      }
    }));
    if (key === this.loaded) this.sounds = next;
    return this;
  }

  /** The file for a speaker: its own, the same-side surround's for a back speaker, else mains (not for the sub). */
  pick(role) {
    const s = this.sounds;
    return s.get(role) || (role === 'BL' && s.get('SL')) || (role === 'BR' && s.get('SR')) || (role !== 'LFE' && s.get('mains')) || null;
  }

  /** Play a speaker's file on that speaker. Returns { stop, duration } like Synth.play, or null if it has none. */
  play(role) {
    const s = this.pick(role);
    if (!s) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    const g = this.ctx.createGain();
    g.gain.value = gainFor(s, role);
    src.connect(g).connect(this.engine.speaker(role).input);
    src.start(this.ctx.currentTime + 0.01);
    return {
      duration: s.buffer.duration,
      stop: () => {
        try { src.stop(); } catch { /* already stopped */ }
      },
    };
  }
}
