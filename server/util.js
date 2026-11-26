'use strict';
// Small helpers shared by the server modules (no dependencies).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  // media
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.mka': 'audio/x-matroska',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
};

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mkv', '.webm', '.mov']);
const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.oga', '.mka', '.aif',
  '.aiff', '.alac', '.wv', '.ape', '.dsf', '.dff', '.wma']);
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.vtt']);

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function idFor(str) {
  return crypto.createHash('sha1').update(str).digest('hex').slice(0, 12);
}

/** Resolve `rel` inside `root`, refusing anything that escapes it. Returns null if unsafe. */
function safeJoin(root, rel) {
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(root, '.' + path.sep + decoded);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) return null;
  return full;
}

function sendJSON(req, res, status, obj, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  sendBuffer(req, res, status, body, 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...extraHeaders });
}

function sendBuffer(req, res, status, body, type, headers = {}) {
  const gz = body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /json|text|javascript|svg/.test(type);
  const out = gz ? zlib.gzipSync(body, { level: 6 }) : body;
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': out.length,
    ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : out);
}

function sendError(req, res, status, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJSON(req, res, status, { error: message || String(status) });
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSONBody(req, limit) {
  const buf = await readBody(req, limit);
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

function readJSONFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[json] could not read ${file}: ${e.message}`);
    return fallback;
  }
}

function writeJSONAtomic(file, obj, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

/** Parse "1:23:45.6", "83:12", "95.5" or a number into seconds. Returns null when empty/invalid. */
function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const parts = String(v).trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Run a command, collecting stdout. Rejects with stderr on failure. */
function run(cmd, args, { timeoutMs = 120000, maxBuffer = 64 << 20 } = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let outLen = 0;
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (c) => {
      outLen += c.length;
      if (outLen <= maxBuffer) out.push(c);
    });
    p.stderr.on('data', (c) => {
      if (err.length < 8192) err += c;
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} exited with ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

/** Limit concurrency of async jobs; identical keys share one in-flight promise. */
function limiter(max) {
  let active = 0;
  const queue = [];
  const inflight = new Map();
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (key, fn) => {
    if (key && inflight.has(key)) return inflight.get(key);
    const p = new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
    if (key) {
      inflight.set(key, p);
      p.finally(() => inflight.delete(key)).catch(() => {});
    }
    return p;
  };
}

module.exports = {
  MIME, VIDEO_EXT, AUDIO_EXT, TEXT_EXT, mimeFor, idFor, safeJoin, sendJSON, sendBuffer, sendError, readBody,
  readJSONBody, readJSONFile, writeJSONAtomic, parseTime, run, limiter,
};
