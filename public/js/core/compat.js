// Can *this* browser play a given file? Uses the codec strings the server derives with ffprobe.

const probeEl = document.createElement('video');
const audioEl = document.createElement('audio');

function can(type) {
  const a = probeEl.canPlayType(type);
  let b = false;
  try {
    b = window.MediaSource && MediaSource.isTypeSupported(type);
  } catch { /* ignore */ }
  return a === 'probably' || a === 'maybe' || b;
}

export function videoCodecOk(codecString) {
  if (!codecString) return false;
  if (codecString.startsWith('vp') || codecString.startsWith('av01')) {
    return can(`video/webm; codecs="${codecString}"`) || can(`video/mp4; codecs="${codecString}"`);
  }
  return can(`video/mp4; codecs="${codecString}"`) || (codecString.startsWith('hvc1') && can(`video/mp4; codecs="${codecString.replace('hvc1', 'hev1')}"`));
}

export function audioCodecOk(codecString) {
  if (!codecString) return false;
  if (codecString === 'opus' || codecString === 'vorbis') return can(`audio/webm; codecs="${codecString}"`) || can(`audio/ogg; codecs="${codecString}"`);
  if (codecString === 'flac') return can('audio/flac') || can('audio/mp4; codecs="flac"');
  if (codecString === 'mp4a.40.34') return can('audio/mpeg');
  return can(`audio/mp4; codecs="${codecString}"`);
}

export function containerOk(file) {
  const ext = file.split('.').pop().toLowerCase();
  if (ext === 'mkv') return probeEl.canPlayType('video/x-matroska') !== '' || can('video/x-matroska; codecs="avc1.640029, mp4a.40.2"');
  if (ext === 'webm') return can('video/webm');
  if (ext === 'mov') return probeEl.canPlayType('video/quicktime') !== '' || true; // most browsers treat mov as mp4
  return true;
}

const PRETTY = {
  truehd: 'Dolby TrueHD', mlp: 'MLP', dts: 'DTS', ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', aac: 'AAC', flac: 'FLAC',
  opus: 'Opus', vorbis: 'Vorbis', mp3: 'MP3', alac: 'ALAC', pcm_s16le: 'PCM', pcm_s24le: 'PCM', h264: 'H.264', hevc: 'HEVC',
  av1: 'AV1', vp9: 'VP9', mpeg2video: 'MPEG-2', vc1: 'VC-1',
};

export function prettyCodec(c, profile = '') {
  let name = PRETTY[c] || (c || '').toUpperCase();
  if (c === 'dts' && /MA/.test(profile)) name = 'DTS-HD MA';
  if (/atmos/i.test(profile)) name += ' Atmos';
  if (/DTS:X/i.test(profile)) name = 'DTS:X';
  return name;
}

export function channelsLabel(a) {
  if (!a) return '';
  const n = a.channels;
  if (a.layout && /^(\d\.\d)/.test(a.layout)) return a.layout.match(/^(\d\.\d)/)[1];
  return { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' }[n] || `${n}ch`;
}

/** Audio track the browser will actually play (default-flagged or first). */
export function defaultAudio(probe) {
  const tracks = probe.audio || [];
  return tracks.find((a) => a.default) || tracks[0] || null;
}

/**
 * Verdict for a video item: { ok, level: 'ok'|'warn'|'bad', video, audio, messages[] }
 */
export function checkVideo(item) {
  const p = item.probe || {};
  const v = p.video;
  const a = defaultAudio(p);
  const msgs = [];
  let level = 'ok';
  const contOk = containerOk(item.file);
  if (!contOk) {
    level = 'bad';
    msgs.push('This browser can’t open MKV files. Use Chrome or Edge, or run prepare_media.py to make an MP4.');
  }
  const vOk = v ? videoCodecOk(v.codecString) : false;
  if (v && !vOk) {
    level = 'bad';
    msgs.push(`${prettyCodec(v.codec)} video can’t be decoded here${v.codec === 'hevc' ? ' (HEVC needs a GPU with HEVC decode: Chrome/Edge on Windows or a Mac usually work)' : ''}.`);
  }
  const aOk = a ? audioCodecOk(a.codecString) : true;
  if (a && !aOk) {
    if (level !== 'bad') level = 'warn';
    msgs.push(`Its default audio track is ${prettyCodec(a.codec, a.profile)} ${channelsLabel(a)}, which browsers can’t decode: the picture would play silently. Run prepare_media.py to make a lossless FLAC copy.`);
  }
  const better = (p.audio || []).find((x) => x !== a && audioCodecOk(x.codecString));
  if (a && !aOk && better && (p.audio || []).length > 1) {
    msgs.push(`(Track ${better.order + 1}, ${prettyCodec(better.codec, better.profile)} ${channelsLabel(better)}, would work, but browsers only play the default track.)`);
  }
  if (v && v.hdr) msgs.push(`${v.hdr}: for real HDR, turn on HDR in the OS display settings of the playback PC.`);
  return { ok: level === 'ok', level, video: vOk, audio: aOk, messages: msgs };
}

export function canPlayAudioFile(item) {
  const a = (item.probe && item.probe.audio && item.probe.audio[0]) || {};
  return audioCodecOk(a.codecString) && containerOk(item.file);
}

export function capabilityTable() {
  const rows = [
    ['H.264 video', can('video/mp4; codecs="avc1.640029"')],
    ['HEVC / H.265 video', can('video/mp4; codecs="hvc1.1.6.L150.B0"') || can('video/mp4; codecs="hev1.1.6.L150.B0"')],
    ['HEVC Main 10 (HDR)', can('video/mp4; codecs="hvc1.2.4.L153.B0"')],
    ['AV1 video', can('video/mp4; codecs="av01.0.08M.10"')],
    ['VP9 video', can('video/webm; codecs="vp09.00.40.08"')],
    ['MKV container', probeEl.canPlayType('video/x-matroska') !== ''],
    ['AAC audio', can('audio/mp4; codecs="mp4a.40.2"')],
    ['FLAC audio', can('audio/flac')],
    ['FLAC in MP4', can('audio/mp4; codecs="flac"')],
    ['Opus audio', can('audio/webm; codecs="opus"')],
    ['Dolby Digital (AC-3)', can('audio/mp4; codecs="ac-3"')],
    ['Dolby Digital Plus (E-AC-3)', can('audio/mp4; codecs="ec-3"')],
    ['DTS', can('audio/mp4; codecs="dtsc"')],
    ['Dolby TrueHD', can('audio/mp4; codecs="mlpa"')],
    ['ALAC audio', audioEl.canPlayType('audio/mp4; codecs="alac"') !== ''],
  ];
  return rows;
}
