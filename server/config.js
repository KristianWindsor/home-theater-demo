'use strict';
// All runtime configuration comes from environment variables (see README "Configuration").
const path = require('path');

const root = path.resolve(__dirname, '..');
const env = process.env;

function int(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function bool(v, d) {
  if (v === undefined || v === '') return d;
  return /^(1|true|yes|on)$/i.test(v);
}

const config = {
  port: int(env.PORT, 8080),
  host: env.HOST || '0.0.0.0',
  root,
  publicDir: path.join(root, 'public'),
  mediaDir: path.resolve(env.MEDIA_DIR || path.join(root, 'media')),
  dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
  configDir: path.resolve(env.CONFIG_DIR || path.join(root, 'config')),
  // analysis
  python: env.PYTHON || 'python3',
  analyzerScript: path.join(root, 'analyzer', 'analyze.py'),
  analyzeOnStart: bool(env.ANALYZE_ON_START, true),
  analyzerConcurrency: Math.max(1, int(env.ANALYZER_CONCURRENCY, 1)),
  // tools
  ffmpeg: env.FFMPEG || 'ffmpeg',
  ffprobe: env.FFPROBE || 'ffprobe',
  thumbConcurrency: Math.max(1, int(env.THUMB_CONCURRENCY, 2)),
  // library
  rescanSeconds: int(env.RESCAN_SECONDS, 120),
  // movies from S3 instead of MEDIA_DIR/movies, streamed to the browser through CloudFront (server/bucket.js)
  bucket: env.MEDIA_BUCKET || '',
  bucketRegion: env.MEDIA_BUCKET_REGION || env.AWS_REGION || 'us-east-1',
  cdnUrl: (env.MEDIA_CDN_URL || '').replace(/\/+$/, ''),
  cdnKeyPairId: env.MEDIA_CDN_KEY_PAIR_ID || '',
  cdnPrivateKey: env.MEDIA_CDN_PRIVATE_KEY || '', // PEM
  linkHours: Math.max(1, int(env.MEDIA_LINK_HOURS, 12)),
  // editing scene lists from the app
  allowSceneEdits: bool(env.ALLOW_SCENE_EDITS, true),
};

module.exports = config;
