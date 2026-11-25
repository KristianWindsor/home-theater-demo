'use strict';
// ffprobe -> a compact, UI-friendly description of a media file.
const config = require('./config');
const { run } = require('./util');

const LOSSLESS = new Set(['flac', 'alac', 'truehd', 'mlp', 'wavpack', 'ape', 'tta']);

function hexByte(n) {
  return Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0').toUpperCase();
}

/** RFC 6381 codec strings, good enough for canPlayType / mediaCapabilities checks in the browser. */
function videoCodecString(s) {
  const prof = (s.profile || '').toLowerCase();
  const level = Number(s.level) || 0;
  switch (s.codec_name) {
    case 'h264': {
      const pid = prof.includes('high 4:4:4') ? 0xf4 : prof.includes('high 4:2:2') ? 0x7a : prof.includes('high 10')
        ? 0x6e : prof.includes('high') ? 0x64 : prof.includes('main') ? 0x4d : 0x42;
      return `avc1.${hexByte(pid)}00${hexByte(level || 40)}`.toLowerCase();
    }
    case 'hevc': {
      const main10 = prof.includes('10') || /10/.test(s.pix_fmt || '');
      return main10 ? `hvc1.2.4.L${level || 150}.B0` : `hvc1.1.6.L${level || 150}.B0`;
    }
    case 'av1': {
      const depth = /1[02]le|10/.test(s.pix_fmt || '') ? '10' : '08';
      return `av01.0.${String(Math.max(0, level) || 8).padStart(2, '0')}M.${depth}`;
    }
    case 'vp9':
      return /10/.test(s.pix_fmt || '') ? 'vp09.02.40.10' : 'vp09.00.40.08';
    case 'vp8':
      return 'vp8';
    default:
      return s.codec_name || '';
  }
}

function audioCodecString(s) {
  const prof = (s.profile || '').toLowerCase();
  switch (s.codec_name) {
    case 'aac':
      return prof.includes('he-aacv2') ? 'mp4a.40.29' : prof.includes('he') ? 'mp4a.40.5' : 'mp4a.40.2';
    case 'mp3':
      return 'mp4a.40.34';
    case 'ac3':
      return 'ac-3';
    case 'eac3':
      return 'ec-3';
    case 'flac':
      return 'flac';
    case 'opus':
      return 'opus';
    case 'vorbis':
      return 'vorbis';
    case 'alac':
      return 'alac';
    case 'dts':
      return prof.includes('ma') || prof.includes('hra') || prof.includes('x') ? 'dtsh' : 'dtsc';
    case 'truehd':
    case 'mlp':
      return 'mlpa';
    default:
      return s.codec_name || '';
  }
}

function hdrOf(s, sideData) {
  if (sideData.some((d) => /dovi|dolby vision/i.test(d.side_data_type || ''))) return 'Dolby Vision';
  if (sideData.some((d) => /hdr10\+|hdr dynamic metadata smpte2094-40/i.test(d.side_data_type || ''))) return 'HDR10+';
  if (s.color_transfer === 'smpte2084') return 'HDR10';
  if (s.color_transfer === 'arib-std-b67') return 'HLG';
  return null;
}

function fps(rate) {
  if (!rate || rate === '0/0') return null;
  const [a, b] = rate.split('/').map(Number);
  return b ? Math.round((a / b) * 1000) / 1000 : a;
}

function bitDepth(s) {
  const raw = Number(s.bits_per_raw_sample);
  if (raw) return raw;
  const fmt = s.sample_fmt || s.pix_fmt || '';
  if (/s32|flt|fltp|dbl/.test(fmt)) return s.codec_type === 'audio' ? 24 : null;
  if (/s16/.test(fmt)) return 16;
  if (/10le|10be/.test(fmt)) return 10;
  if (/12le|12be/.test(fmt)) return 12;
  return s.codec_type === 'video' ? 8 : null;
}

async function probe(file) {
  const out = await run(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams',
    '-show_chapters', file], { timeoutMs: 60000 });
  const info = JSON.parse(out.toString('utf8') || '{}');
  const streams = info.streams || [];
  const fmt = info.format || {};
  const tags = {};
  for (const [k, v] of Object.entries(fmt.tags || {})) tags[k.toLowerCase()] = v;

  const vs = streams.find((s) => s.codec_type === 'video' && !(s.disposition || {}).attached_pic);
  const video = vs ? {
    codec: vs.codec_name,
    profile: vs.profile || '',
    width: vs.width,
    height: vs.height,
    fps: fps(vs.avg_frame_rate || vs.r_frame_rate),
    pixFmt: vs.pix_fmt || '',
    bitDepth: bitDepth(vs),
    hdr: hdrOf(vs, vs.side_data_list || []),
    codecString: videoCodecString(vs),
  } : null;

  const audio = streams.filter((s) => s.codec_type === 'audio').map((s, i) => {
    const t = s.tags || {};
    return {
      index: s.index,
      order: i,
      codec: s.codec_name,
      profile: s.profile || '',
      channels: s.channels || 0,
      layout: s.channel_layout || '',
      sampleRate: Number(s.sample_rate) || 0,
      bitDepth: bitDepth(s),
      bitRate: Number(s.bit_rate) || null,
      lang: t.language || '',
      title: t.title || t.handler_name || '',
      default: !!(s.disposition || {}).default,
      lossless: LOSSLESS.has(s.codec_name) || /^pcm_/.test(s.codec_name || '') ||
        (s.codec_name === 'dts' && /ma\b|master/i.test(s.profile || '')),
      atmos: /atmos/i.test(s.profile || '') || /atmos/i.test(t.title || ''),
      dtsx: /dts:x/i.test(s.profile || ''),
      codecString: audioCodecString(s),
    };
  });

  const subtitles = streams.filter((s) => s.codec_type === 'subtitle').map((s) => ({
    index: s.index,
    codec: s.codec_name,
    lang: (s.tags || {}).language || '',
    title: (s.tags || {}).title || '',
    forced: !!(s.disposition || {}).forced,
  }));

  const chapters = (info.chapters || []).map((c, i) => ({
    start: Math.round(Number(c.start_time) * 1000) / 1000,
    end: Math.round(Number(c.end_time) * 1000) / 1000,
    title: (c.tags || {}).title || `Chapter ${i + 1}`,
  }));

  const hasCover = streams.some((s) => s.codec_type === 'video' && (s.disposition || {}).attached_pic);

  return {
    duration: Number(fmt.duration) || 0,
    bitRate: Number(fmt.bit_rate) || null,
    container: fmt.format_name || '',
    video,
    audio,
    subtitles,
    chapters,
    hasCover,
    tags: {
      title: tags.title || '',
      artist: tags.artist || tags.album_artist || '',
      album: tags.album || '',
      track: parseInt(tags.track, 10) || null,
      disc: parseInt(tags.disc, 10) || null,
      year: parseInt(tags.date || tags.year, 10) || null,
      genre: tags.genre || '',
    },
  };
}

module.exports = { probe };
