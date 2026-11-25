'use strict';
// Byte-exact media streaming (HTTP Range), plus cached thumbnails, posters, covers and
// lossless FLAC copies for audio formats browsers can't decode.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { mimeFor, sendError, run, limiter } = require('./util');

const thumbLimit = limiter(config.thumbConcurrency);
const compatLimit = limiter(1);

/**
 * Stream a file with full Range support. The bytes go out untouched (no transcoding),
 * which is what keeps the original video and audio bit-exact.
 */
function streamFile(req, res, file, type) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return sendError(req, res, 404, 'not found');
  }
  if (!st.isFile()) return sendError(req, res, 404, 'not found');
  const size = st.size;
  const etag = `"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type || mimeFor(file),
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': 'private, max-age=3600',
  };
  if (req.headers['if-none-match'] === etag && !req.headers.range) {
    res.writeHead(304, headers);
    return res.end();
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;
  const ifRange = req.headers['if-range'];
  if (range && (!ifRange || ifRange === etag)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 1 << 20 });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function cacheDir(name) {
  const d = path.join(config.dataDir, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function exists(p) {
  try {
    return fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function mediaPath(item) {
  return path.join(config.mediaDir, item.category, item.file);
}

const HDR_TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,' +
  'zscale=t=bt709:m=bt709:r=tv,format=yuv420p,';

async function makeThumb(item, t, width, out) {
  const src = mediaPath(item);
  const scale = `scale=${width}:-2:flags=lanczos`;
  const tmp = `${out}.${process.pid}.tmp.jpg`;
  const args = (vf) => ['-v', 'error', '-nostdin', '-y', '-ss', String(Math.max(0, t)), '-i', src, '-map', '0:v:0',
    '-frames:v', '1', '-vf', vf, '-q:v', '4', '-f', 'image2', tmp];
  const hdr = item.probe.video && item.probe.video.hdr;
  try {
    await run(config.ffmpeg, args((hdr ? HDR_TONEMAP : '') + scale), { timeoutMs: 45000 });
  } catch (e) {
    if (!hdr) throw e; // zscale missing in this ffmpeg build: fall back to an untonemapped frame
    await run(config.ffmpeg, args(scale), { timeoutMs: 45000 });
  }
  fs.renameSync(tmp, out);
}

/** GET /api/thumb/:id?t=seconds&w=width */
async function thumb(req, res, item, query) {
  if (!item || item.kind !== 'video') return sendError(req, res, 404, 'no video');
  const dur = item.duration || 0;
  let t = Number(query.get('t'));
  if (!Number.isFinite(t)) t = dur ? Math.min(dur * 0.12, 600) : 10;
  t = Math.max(0, Math.min(t, Math.max(0, dur - 1)));
  const w = [320, 480, 640, 960, 1280].find((x) => x >= (Number(query.get('w')) || 480)) || 1280;
  const out = path.join(cacheDir('thumbs'), `${item.id}-${item.mtime}-${Math.round(t * 10)}-${w}.jpg`);
  if (!exists(out)) {
    try {
      await thumbLimit(out, () => makeThumb(item, t, w, out));
    } catch (e) {
      return sendError(req, res, 500, `thumbnail failed: ${e.message}`);
    }
  }
  res.setHeader('Cache-Control', 'private, max-age=604800');
  return streamFile(req, res, out, 'image/jpeg');
}

const IMAGE_NAMES = ['poster', 'folder', 'cover', 'front', 'album'];
function findSidecarImage(item) {
  const full = mediaPath(item);
  const dir = path.dirname(full);
  const base = path.basename(full, path.extname(full));
  const candidates = [];
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    candidates.push(path.join(dir, base + ext), path.join(dir, `${base}-poster${ext}`));
  }
  // folder-level art only applies when the folder holds a single title (movies) or an album (music)
  for (const n of IMAGE_NAMES) for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) candidates.push(path.join(dir, n + ext));
  return candidates.find((c) => exists(c)) || null;
}

/** GET /api/poster/:id — sidecar image if present, else a frame from the film. */
async function poster(req, res, item, query) {
  if (!item) return sendError(req, res, 404, 'not found');
  const side = item.category !== 'demos' || path.dirname(item.file) !== '.' ? findSidecarImage(item) : null;
  if (side) {
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return streamFile(req, res, side);
  }
  return thumb(req, res, item, query);
}

/** GET /api/cover/:id — album art: sidecar image or embedded picture (extracted once). */
async function cover(req, res, item) {
  if (!item || item.kind !== 'audio') return sendError(req, res, 404, 'not found');
  const side = findSidecarImage(item);
  if (side) {
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return streamFile(req, res, side);
  }
  if (!item.probe.hasCover) return sendError(req, res, 404, 'no cover');
  const out = path.join(cacheDir('covers'), `${item.id}-${item.mtime}.jpg`);
  if (!exists(out)) {
    const tmp = `${out}.tmp.jpg`;
    try {
      await thumbLimit(out, () => run(config.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', mediaPath(item), '-an',
        '-map', '0:v:0', '-frames:v', '1', '-vf', "scale='min(800,iw)':-2", '-q:v', '3', '-f', 'image2', tmp])
        .then(() => fs.renameSync(tmp, out)));
    } catch (e) {
      return sendError(req, res, 404, 'no cover');
    }
  }
  res.setHeader('Cache-Control', 'private, max-age=604800');
  return streamFile(req, res, out, 'image/jpeg');
}

/**
 * GET /api/compat/:id.flac — a lossless FLAC copy for audio the browser can't decode (ALAC, AIFF,
 * DSD, WMA, APE, DTS/TrueHD music...). Decoded samples are stored exactly; channel layout kept.
 */
async function compat(req, res, item) {
  if (!item || item.kind !== 'audio') return sendError(req, res, 404, 'not found');
  const out = path.join(cacheDir('compat'), `${item.id}-${item.mtime}.flac`);
  if (!exists(out)) {
    const a = item.probe.audio[0] || {};
    const tmp = `${out}.${process.pid}.tmp.flac`;
    const fmt = (a.bitDepth || 16) > 16 ? 's32' : 's16';
    const args = ['-v', 'error', '-nostdin', '-y', '-i', mediaPath(item), '-map', '0:a:0', '-c:a', 'flac',
      '-sample_fmt', fmt, '-compression_level', '5'];
    if ((a.sampleRate || 0) > 192000 || /^dsd/.test(a.codec || '')) args.push('-ar', '176400');
    args.push('-f', 'flac', tmp);
    try {
      await compatLimit(out, () => run(config.ffmpeg, args, { timeoutMs: 15 * 60000 }).then(() => fs.renameSync(tmp, out)));
    } catch (e) {
      return sendError(req, res, 500, `conversion failed: ${e.message}`);
    }
  }
  return streamFile(req, res, out, 'audio/flac');
}

module.exports = { streamFile, thumb, poster, cover, compat, mediaPath, findSidecarImage };
