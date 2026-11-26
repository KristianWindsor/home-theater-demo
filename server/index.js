'use strict';
// KW5.1 server: static app + media library API. Zero npm dependencies (Node >= 18).
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');
const library = require('./library');
const media = require('./media');
const analysis = require('./analysis');
const bucket = require('./bucket');
const { sendJSON, sendError, sendBuffer, safeJoin, mimeFor, readJSONBody, TEXT_EXT } = require('./util');

const VERSION = require('../package.json').version;

// Movies kept in S3 play from CloudFront (or S3 itself), and sidecar posters load from there too
const MEDIA_ORIGIN = bucket.viewerOrigin() ? ` ${bucket.viewerOrigin()}` : '';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${MEDIA_ORIGIN}`,
    `media-src 'self' blob:${MEDIA_ORIGIN}`,
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; '),
};

// ---------------------------------------------------------------- static files (gzip cached in memory)
const staticCache = new Map();
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  let file = safeJoin(config.publicDir, rel.slice(1));
  if (!file) return sendError(req, res, 400, 'bad path');
  let st;
  try {
    st = fs.statSync(file);
    if (st.isDirectory()) {
      file = path.join(file, 'index.html');
      st = fs.statSync(file);
    }
  } catch {
    // SPA fallback: unknown extension-less paths load the app shell
    if (!path.extname(rel)) {
      file = path.join(config.publicDir, 'index.html');
      st = fs.statSync(file);
    } else {
      return sendError(req, res, 404, 'not found');
    }
  }
  const ext = path.extname(file).toLowerCase();
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'no-cache', ...(ext === '.html' ? SECURITY_HEADERS : {}) };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  if (!TEXT_EXT.has(ext)) {
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return media.streamFile(req, res, file);
  }
  const key = `${file}:${etag}`;
  let entry = staticCache.get(key);
  if (!entry) {
    const raw = fs.readFileSync(file);
    entry = { raw, gz: zlib.gzipSync(raw, { level: 9 }) };
    staticCache.set(key, entry);
  }
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gzip ? entry.gz : entry.raw;
  res.writeHead(200, {
    ...headers,
    'Content-Type': mimeFor(file),
    'Content-Length': body.length,
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------- server-sent events
const sseClients = new Set();
function sse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: don't buffer
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
}
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}
analysis.bus.on('analysis', (d) => broadcast('analysis', d));
library.onChange(() => broadcast('library', { at: Date.now() }));

// ---------------------------------------------------------------- API
function publicItem(item) {
  const out = { ...item };
  if (item.kind === 'audio') out.analysis = analysis.statusOf(item);
  return out;
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = parts[1];
  const id = parts[2];
  const method = req.method;

  if (route === 'library' && method === 'GET') {
    const items = await library.ensureFresh();
    return sendJSON(req, res, 200, {
      items: items.map(publicItem),
      room: library.loadRoom(),
      showcase: library.loadShowcase(),
      sounds: library.speakerSounds(),
      server: { version: VERSION, sceneEdits: config.allowSceneEdits, analysis: analysis.stats() },
    });
  }
  if (route === 'item' && method === 'GET') {
    const item = library.get(id);
    return item ? sendJSON(req, res, 200, publicItem(item)) : sendError(req, res, 404, 'not found');
  }
  if (route === 'events' && method === 'GET') return sse(req, res);
  if (route === 'status' && method === 'GET') {
    return sendJSON(req, res, 200, { version: VERSION, analysis: analysis.stats(), items: library.all().length });
  }
  if (route === 'rescan' && method === 'POST') {
    const items = await library.scan();
    if (config.analyzeOnStart) analysis.enqueueMissing(items);
    return sendJSON(req, res, 200, { ok: true, items: items.length });
  }
  if (route === 'score' && method === 'GET') {
    const item = library.get(id);
    if (!item || item.kind !== 'audio') return sendError(req, res, 404, 'not found');
    if (!analysis.isReady(item)) {
      analysis.enqueue(item, { front: true });
      return sendJSON(req, res, 404, { error: 'not analyzed yet', analysis: analysis.statusOf(item) });
    }
    const file = analysis.scorePath(item.id);
    const st = fs.statSync(file);
    const etag = `"s-${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    return sendBuffer(req, res, 200, fs.readFileSync(file), 'application/json; charset=utf-8',
      { ETag: etag, 'Cache-Control': 'private, no-cache' });
  }
  if (route === 'analyze' && method === 'POST') {
    if (id === 'all') {
      let n = 0;
      for (const item of library.all()) if (analysis.enqueue(item, { force: true })) n++;
      return sendJSON(req, res, 200, { queued: n });
    }
    const item = library.get(id);
    if (!item) return sendError(req, res, 404, 'not found');
    analysis.enqueue(item, { front: true, force: true });
    return sendJSON(req, res, 200, analysis.statusOf(item));
  }
  if (route === 'scenes' && (method === 'PUT' || method === 'DELETE')) {
    if (!config.allowSceneEdits) return sendError(req, res, 403, 'scene editing is disabled');
    const item = library.get(id);
    if (!item || item.kind !== 'video') return sendError(req, res, 404, 'not found');
    if (method === 'DELETE') {
      const scenes = library.resetScenes(item);
      broadcast('library', { at: Date.now(), id });
      return sendJSON(req, res, 200, { scenes });
    }
    const body = await readJSONBody(req, 512 * 1024);
    if (!Array.isArray(body.scenes) || body.scenes.length > 500) return sendError(req, res, 400, 'scenes[] required');
    const scenes = library.saveScenes(item, body.scenes);
    broadcast('library', { at: Date.now(), id });
    return sendJSON(req, res, 200, { scenes });
  }
  if (method === 'GET' || method === 'HEAD') {
    const item = library.get((id || '').replace(/\.flac$/, ''));
    if (route === 'thumb') return media.thumb(req, res, item, url.searchParams);
    if (route === 'poster') return media.poster(req, res, item, url.searchParams);
    if (route === 'cover') return media.cover(req, res, item);
    if (route === 'compat') return media.compat(req, res, item);
  }
  return sendError(req, res, 404, 'unknown endpoint');
}

function serveMedia(req, res, url) {
  // /media/<category>/<path...>, and /media/sounds/<file> (speaker sounds)
  const rest = url.pathname.slice('/media/'.length);
  const category = rest.split('/')[0];
  if (!library.CATEGORIES.includes(category) && category !== library.SOUND_DIR) return sendError(req, res, 404, 'not found');
  if (bucket.isRemote(category)) {
    // Only objects the last listing saw get a signed link, so this can't be used to sign arbitrary keys
    let key;
    try {
      key = `${category}/${decodeURIComponent(rest.slice(category.length + 1))}`;
    } catch {
      return sendError(req, res, 400, 'bad path');
    }
    if (!bucket.has(key)) return sendError(req, res, 404, 'not found');
    return media.redirectToBucket(res, key);
  }
  const file = safeJoin(path.join(config.mediaDir, category), rest.slice(category.length + 1));
  if (!file) return sendError(req, res, 400, 'bad path');
  return media.streamFile(req, res, file);
}

// ---------------------------------------------------------------- router
async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (p === '/healthz') return sendJSON(req, res, 200, { ok: true, version: VERSION });
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p.startsWith('/media/')) return serveMedia(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(req, res, 405, 'method not allowed');
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(`[http] ${req.method} ${p}: ${e.stack || e.message}`);
    return sendError(req, res, e.status || 500, e.status ? e.message : 'internal error');
  }
}

function start() {
  for (const d of [config.dataDir, ...library.CATEGORIES.map((c) => path.join(config.mediaDir, c))]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch { /* read-only media mount is fine */ }
  }
  const server = http.createServer(handle);
  server.keepAliveTimeout = 65000;
  server.requestTimeout = 0; // long media streams
  server.listen(config.port, config.host, () => {
    console.log(`[server] KW5.1 v${VERSION} listening on http://${config.host}:${config.port}`);
    console.log(`[server] media: ${config.mediaDir}  data: ${config.dataDir}  config: ${config.configDir}`);
  });
  library.scan().then((items) => {
    const counts = library.CATEGORIES.map((c) => `${items.filter((i) => i.category === c).length} ${c}`).join(', ');
    console.log(`[library] ${counts}`);
  }).catch((e) => console.error(`[library] scan failed: ${e.message}`));
  library.onChange((items) => {
    if (config.analyzeOnStart) analysis.enqueueMissing(items);
  });
  const shutdown = () => {
    analysis.stopAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start();
module.exports = { start, handle };
