// Performance overlay (Settings → Performance overlay): what the GPU is actually rendering, how frames arrive,
// dropped video frames and the audio output, on top of every screen. For checking the real machine: a new TV, a
// different GPU, or what a quality setting costs.
import { h } from './dom.js';
import { settings, onSetting } from './settings.js';
import { frameClock } from '../gl/resolution.js';

export function perfOverlay(app) {
  const el = h('div', { class: 'perf', 'aria-hidden': 'true' });
  document.body.appendChild(el);
  let timer = 0;
  let gpu = null;

  const gpuName = () => {
    try {
      const gl = app.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      return 'unknown';
    }
  };

  /** Frame intervals covering roughly the last `ms` milliseconds (at least `min` frames), newest first. */
  const recent = (ms, min = 0) => {
    const c = frameClock, N = c.ring.length, out = [];
    let t = 0;
    for (let k = c.n - 1; k >= 0 && c.n - k <= N && (t < ms || out.length < min); k--) {
      const d = c.ring[k % N];
      out.push(d);
      t += d;
    }
    return out;
  };

  const draw = () => {
    const c = frameClock;
    const two = recent(2000, 4); // a few frames even when it's very slow, which is when this matters most
    const lines = [];
    const canvas = app.canvas;
    lines.push(`display  ${canvas.width}×${canvas.height} canvas · ${c.refresh.hz.toFixed(0)} Hz · ${window.devicePixelRatio || 1}× pixels`);
    const r = c.last;
    lines.push(r
      ? `render   ${r.w}×${r.h} = ${Math.round(r.scale * 100)}% of ${r.outW}×${r.outH} · ${r.name} · quality ${r.quality}`
      : 'render   (nothing on the canvas: the video plays on its own layer)');
    if (two.length >= 2) {
      const total = two.reduce((a, b) => a + b, 0);
      const sorted = two.slice().sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      const late = recent(10000).filter((d) => d > c.refresh.ms * 1.5).length;
      lines.push(`frames   ${((two.length * 1000) / total).toFixed(0)} fps · avg ${(total / two.length).toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · ${late} late in 10 s`);
    }
    const v = document.getElementById('video');
    if (v && v.classList.contains('on') && v.videoWidth) {
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      const drop = q ? ` · dropped ${q.droppedVideoFrames} of ${q.totalVideoFrames}` : '';
      lines.push(`video    ${v.videoWidth}×${v.videoHeight}${drop}`);
    }
    const m = app.music;
    if (m && m.videoOn && m.video.videoWidth) {
      // the music video follows the song: how far apart they are and how hard it's catching up
      const mv = m.video;
      const q = mv.getVideoPlaybackQuality ? mv.getVideoPlaybackQuality() : null;
      const drop = q ? ` · dropped ${q.droppedVideoFrames} of ${q.totalVideoFrames}` : '';
      lines.push(`mvideo   ${mv.videoWidth}×${mv.videoHeight}${drop} · ${m.videoDrift >= 0 ? '+' : ''}${Math.round(m.videoDrift * 1000)} ms from the song · speed ${mv.playbackRate.toFixed(3)}`);
    }
    const e = app.engine;
    if (e && e.ready) {
      const lat = (e.ctx.baseLatency || 0) + (e.ctx.outputLatency || 0);
      lines.push(`audio    ${e.layoutName} · ${(e.ctx.sampleRate / 1000).toFixed(1)} kHz · ${e.ctx.state}${lat ? ` · ${Math.round(lat * 1000)} ms output latency` : ''}`);
    }
    if (gpu === null) gpu = gpuName();
    lines.push(`gpu      ${gpu}`);
    el.textContent = lines.join('\n');
  };

  const sync = () => {
    const on = !!settings.perfOverlay;
    el.style.display = on ? '' : 'none';
    clearInterval(timer);
    if (on) {
      draw();
      timer = setInterval(draw, 500);
    }
  };
  onSetting((k) => {
    if (k === 'perfOverlay') sync();
  });
  sync();
}
