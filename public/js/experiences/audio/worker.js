// Module worker: renders an experience's audio ahead of playback and streams it to the page in chunks.
// The page grants "credit" (how far ahead we may render) so memory stays bounded on long pieces.
import { createRenderer } from './render-core.js';

let stopped = false;
let credit = 0;
let wake = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start') run(m);
  else if (m.type === 'credit') {
    credit = Math.max(credit, m.frames);
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  } else if (m.type === 'stop') {
    stopped = true;
    if (wake) wake();
    self.close();
  }
};

async function run(m) {
  try {
    const t0 = performance.now();
    const r = await createRenderer(m);
    self.postMessage({ type: 'meta', duration: r.duration, frames: r.frames, channels: r.channels, setupMs: performance.now() - t0 });
    credit = Math.max(credit, m.credit || r.frames);
    const chunk = m.chunk || 16384;
    let pos = 0;
    while (pos < r.frames && !stopped) {
      if (pos >= credit) {
        await new Promise((res) => (wake = res));
        continue;
      }
      const n = Math.min(chunk, r.frames - pos);
      const t1 = performance.now();
      const data = r.render(n);
      self.postMessage({ type: 'chunk', start: pos, frames: n, data, ms: performance.now() - t1, voices: r.studio.voiceCount },
        data.map((d) => d.buffer));
      pos += n;
      // yield so credit / stop messages get through
      if ((pos / chunk) % 4 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    if (!stopped) self.postMessage({ type: 'done', minGain: r.limiter.minGain });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err), stack: err && err.stack });
  }
}
