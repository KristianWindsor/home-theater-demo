'use strict';
// Background queue that runs the Python analyzer for audio tracks and tracks progress.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const config = require('./config');
const { readJSONFile, writeJSONAtomic } = require('./util');
const { mediaPath } = require('./media');

const SCORE_VERSION = 1;
const bus = new EventEmitter();
bus.setMaxListeners(100);

const scoresDir = () => path.join(config.dataDir, 'scores');
const indexFile = () => path.join(scoresDir(), 'index.json');
let index = null; // id -> { size, mtime, version, seconds, at }
const failures = new Map(); // id -> { mtime, error }
const queue = [];
const running = new Map(); // id -> { progress, stage, proc }

function loadIndex() {
  if (!index) index = readJSONFile(indexFile(), {});
  return index;
}

function scorePath(id) {
  return path.join(scoresDir(), `${id}.json`);
}

function isReady(item) {
  const e = loadIndex()[item.id];
  return !!e && e.size === item.size && e.mtime === item.mtime && e.version === SCORE_VERSION &&
    fs.existsSync(scorePath(item.id));
}

function statusOf(item) {
  if (running.has(item.id)) {
    const r = running.get(item.id);
    return { status: 'analyzing', progress: r.progress, stage: r.stage };
  }
  if (queue.some((q) => q.id === item.id)) return { status: 'queued', progress: 0 };
  if (isReady(item)) return { status: 'ready', progress: 1 };
  const f = failures.get(item.id);
  if (f && f.mtime === item.mtime) return { status: 'failed', error: f.error };
  return { status: 'missing' };
}

function emit(item, extra = {}) {
  bus.emit('analysis', { id: item.id, ...statusOf(item), ...extra });
}

function enqueue(item, { front = false, force = false } = {}) {
  if (item.kind !== 'audio') return false;
  if (running.has(item.id)) return true;
  if (!force && isReady(item)) return false;
  const existing = queue.findIndex((q) => q.id === item.id);
  if (existing >= 0) {
    if (front) queue.unshift(queue.splice(existing, 1)[0]);
    return true;
  }
  failures.delete(item.id);
  if (front) queue.unshift(item);
  else queue.push(item);
  emit(item);
  pump();
  return true;
}

function pump() {
  while (running.size < config.analyzerConcurrency && queue.length) {
    const item = queue.shift();
    runOne(item);
  }
}

function runOne(item) {
  fs.mkdirSync(scoresDir(), { recursive: true });
  const out = scorePath(item.id);
  const tmp = `${out}.${process.pid}.tmp`;
  const args = [config.analyzerScript, mediaPath(item), '-o', tmp, '--progress'];
  const started = Date.now();
  let proc;
  try {
    proc = spawn(config.python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    failures.set(item.id, { mtime: item.mtime, error: e.message });
    emit(item);
    return;
  }
  const r = { progress: 0, stage: 'starting', proc };
  running.set(item.id, r);
  emit(item);
  let buf = '';
  let errText = '';
  let lastEmit = 0;
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'progress') {
          r.progress = msg.progress;
          r.stage = msg.stage;
          if (Date.now() - lastEmit > 250) {
            lastEmit = Date.now();
            emit(item);
          }
        } else if (msg.type === 'error') {
          errText = msg.message;
        }
      } catch { /* not JSON: ignore */ }
    }
  });
  proc.stderr.on('data', (c) => {
    if (errText.length < 4000) errText += c;
  });
  proc.on('error', (e) => {
    errText = `could not start analyzer (${config.python}): ${e.message}`;
  });
  proc.on('close', (code) => {
    running.delete(item.id);
    if (code === 0 && fs.existsSync(tmp)) {
      fs.renameSync(tmp, out);
      loadIndex()[item.id] = { size: item.size, mtime: item.mtime, version: SCORE_VERSION,
        seconds: Math.round((Date.now() - started) / 100) / 10, at: new Date().toISOString() };
      writeJSONAtomic(indexFile(), index);
      console.log(`[analysis] ${item.title}: done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } else {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      const msg = (errText || `exit code ${code}`).trim().split('\n').slice(-2).join(' ');
      failures.set(item.id, { mtime: item.mtime, error: msg });
      console.warn(`[analysis] ${item.title}: failed: ${msg}`);
    }
    emit(item);
    pump();
  });
}

function enqueueMissing(items) {
  let n = 0;
  for (const item of items) {
    if (item.kind === 'audio' && !isReady(item) && !failures.has(item.id)) {
      if (enqueue(item)) n++;
    }
  }
  if (n) console.log(`[analysis] queued ${n} track(s) for analysis`);
}

function stats() {
  return {
    running: [...running.entries()].map(([id, r]) => ({ id, progress: r.progress, stage: r.stage })),
    queued: queue.length,
    failed: failures.size,
  };
}

function stopAll() {
  queue.length = 0;
  for (const r of running.values()) r.proc.kill('SIGTERM');
}

module.exports = { bus, enqueue, enqueueMissing, statusOf, isReady, scorePath, stats, stopAll };
