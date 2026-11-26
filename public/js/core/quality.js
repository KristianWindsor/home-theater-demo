// What a song is made of, as badges: lossless or not, bit depth and sample rate (or the bitrate of lossy audio),
// surround; and the music video's resolution. From the server's ffprobe data (server/probe.js).
import { h, icon } from './dom.js';
import { prettyCodec, channelsLabel } from './compat.js';

const kHz = (rate) => String(Math.round(rate / 100) / 10); // 44100 -> "44.1", 96000 -> "96"

/**
 * { tier: 'hires' | 'lossless' | 'lossy', label, detail, title } for an audio item, or null.
 *   Hi-Res    lossless beyond CD: more than 16 bits or more than 48 kHz (24/96, 24/48, DSD...)
 *   Lossless  every sample of the master: CD quality (16/44.1) or 16/48
 *   lossy     named by codec and bitrate (Opus 130 kbps, AAC 256 kbps, MP3 320 kbps)
 */
export function audioQuality(item) {
  const p = (item && item.probe) || {};
  const a = (p.audio || [])[0];
  if (!a) return null;
  const surround = a.channels > 2 ? channelsLabel(a) : '';
  const layout = surround || (a.channels === 1 ? 'mono' : 'stereo');
  const name = prettyCodec(a.codec, a.profile);
  if (/^dsd/.test(a.codec || '')) {
    const dsd = `DSD${Math.round(((a.sampleRate || 352800) * 8) / 44100)}`;
    return { tier: 'hires', label: `Hi-Res${surround ? ` ${surround}` : ''}`, detail: dsd, title: `${dsd} (Direct Stream Digital), ${layout}: hi-res, lossless` };
  }
  if (a.lossless) {
    const bits = a.bitDepth || 16;
    const rate = a.sampleRate || 44100;
    const hires = bits > 16 || rate > 48000;
    const what = hires ? 'beyond CD quality' : rate === 44100 && bits === 16 ? 'CD quality' : 'lossless';
    return {
      tier: hires ? 'hires' : 'lossless',
      label: `${hires ? 'Hi-Res' : 'Lossless'}${surround ? ` ${surround}` : ''}`,
      detail: `${bits}/${kHz(rate)}`,
      title: `${name}, ${bits}-bit / ${kHz(rate)} kHz, ${layout}: lossless${what === 'lossless' ? '' : `, ${what}`}`,
    };
  }
  // Ogg and WebM don't state a stream's bitrate; for an audio-only file the file's average is the audio's
  const bps = a.bitRate || (!p.video ? p.bitRate : 0) || 0;
  const kbps = bps ? `${Math.round(bps / 1000)} kbps` : '';
  return {
    tier: 'lossy',
    label: `${name}${surround ? ` ${surround}` : ''}`,
    detail: kbps,
    title: `${name}${kbps ? ` at ${kbps}` : ''}${a.sampleRate ? `, ${kHz(a.sampleRate)} kHz` : ''}, ${layout}: lossy`,
  };
}

export function qualityBadge(item) {
  const q = audioQuality(item);
  if (!q) return null;
  return h('span', { class: `badge q q-${q.tier}`, title: q.title },
    q.label, q.detail ? h('span', { class: 'q-detail' }, q.detail) : null);
}

/** "4K", "1080p", "720p"... (the short side, so portrait videos read right too) */
export function videoResolution(v) {
  if (!v || !v.width || !v.height) return '';
  const s = Math.min(v.width, v.height);
  return s >= 2160 ? '4K' : s >= 1440 ? '1440p' : `${s}p`;
}

export function musicVideoBadge(item) {
  const mv = item && item.musicVideo;
  if (!mv) return null;
  const v = mv.video || {};
  const fps = v.fps ? `, ${Math.round(v.fps)} fps` : '';
  return h('span', { class: 'badge q-video', title: `Music video: ${prettyCodec(v.codec)} ${v.width}×${v.height}${fps}${v.hdr ? `, ${v.hdr}` : ''}. Plays instead of the visualizer (V switches).` },
    icon('film'), h('span', { class: 'lbl' }, videoResolution(v) || 'Video'));
}
