'use strict';
// Scans MEDIA_DIR/{demos,trailers,movies,music} (movies from S3 when MEDIA_BUCKET is set), probes files (cached),
// pairs songs with their music videos, merges curated metadata from config/catalog.json and scene edits saved
// from the app (data/scenes.json).
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { probe } = require('./probe');
const bucket = require('./bucket');
const { findSidecarImage } = require('./media');
const { VIDEO_EXT, AUDIO_EXT, idFor, readJSONFile, writeJSONAtomic, parseTime, limiter } = require('./util');

const CATEGORIES = ['demos', 'trailers', 'movies', 'music'];
const probeCacheFile = () => path.join(config.dataDir, 'probe-cache.json');
const scenesFile = () => path.join(config.dataDir, 'scenes.json');

let state = { items: [], byId: new Map(), scannedAt: 0, scanning: null };
let probeCache = null;
const probeLimit = limiter(4);
const lastListing = new Map(); // category -> remote objects from the last successful listing
const listeners = new Set();

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function loadCatalog() {
  const cat = readJSONFile(path.join(config.configDir, 'catalog.json'), null) ||
    readJSONFile(path.join(config.configDir, 'catalog.example.json'), {}) || {};
  return { demos: cat.demos || {}, trailers: cat.trailers || {}, movies: cat.movies || {}, music: cat.music || {} };
}

function loadRoom() {
  return readJSONFile(path.join(config.configDir, 'room.json'), null);
}

/** The showcase (config/showcase.json): the few minutes "Play the showcase" plays, step by step. */
function loadShowcase() {
  return readJSONFile(path.join(config.configDir, 'showcase.json'), null);
}

function catalogEntry(catalog, category, rel) {
  const table = catalog[category] || {};
  return table[rel] || table[path.basename(rel)] || null;
}

function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile() || e.isSymbolicLink()) out.push(path.relative(base, full));
  }
  return out;
}

function prettyTitle(rel) {
  return path.basename(rel, path.extname(rel))
    .replace(/[._]+/g, ' ')
    .replace(/\s*\((19|20)\d\d\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function yearFrom(rel) {
  const m = path.basename(rel).match(/\((19\d\d|20\d\d)\)/);
  return m ? Number(m[1]) : null;
}

/**
 * A scene's highlight: a short cut inside it ({ start, end, note }) that its tile plays first, for when the whole
 * sequence is too long a detour in a demo. Dropped unless it lies inside the scene and runs at least 10 s.
 */
function normHighlight(h, start, end, duration) {
  if (!h || typeof h !== 'object' || start === null) return null;
  const hs = parseTime(h.start), he = parseTime(h.end);
  const last = end ?? duration ?? Infinity;
  if (hs === null || he === null || hs < start || he > last || he - hs < 10) return null;
  return { start: hs, end: he, note: h.note ? String(h.note).slice(0, 300) : '' };
}

function normScenes(list, duration) {
  if (!Array.isArray(list)) return [];
  return list.map((s, i) => {
    const start = parseTime(s.start);
    let end = parseTime(s.end);
    if (end !== null && start !== null && end <= start) end = null;
    if (end !== null && duration) end = Math.min(end, duration);
    const highlight = normHighlight(s.highlight, start, end, duration);
    return {
      id: s.id || `s${i + 1}`,
      title: String(s.title || `Scene ${i + 1}`).slice(0, 200),
      start,
      end,
      note: s.note ? String(s.note).slice(0, 1000) : '',
      star: !!s.star,
      ...(highlight ? { highlight } : {}),
    };
  });
}

/** Remote files in a category: [{ rel, size, mtimeMs }]. If S3 can't be reached, the last listing stands. */
async function listRemote(category) {
  const prefix = `${category}/`;
  let objects;
  try {
    objects = await bucket.list(prefix);
    lastListing.set(category, objects);
  } catch (e) {
    console.warn(`[library] ${e.message}; keeping the last listing`);
    objects = lastListing.get(category) || [];
  }
  return objects
    .map((o) => ({ rel: o.key.slice(prefix.length), size: o.size, mtimeMs: o.mtime }))
    .filter((f) => !f.rel.split('/').some((part) => part.startsWith('.')));
}

const stem = (rel) => rel.slice(0, rel.length - path.extname(rel).length);
const urlFor = (category, rel) => `/media/${category}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;

/**
 * A video next to a song with the same name ("My Girls.opus" + "My Girls.webm") is that song's music video:
 * the app shows it instead of the visualizer, following the song's clock. Music is local (see bucket.js).
 */
async function musicVideo(category, rel, seen) {
  const full = path.join(config.mediaDir, category, rel);
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return null;
  }
  let info;
  try {
    info = await probeCached(category, rel, () => full, st);
  } catch (e) {
    console.warn(`[library] probe failed for ${category}/${rel}: ${e.message}`);
    return null;
  }
  seen.add(`${category}/${rel}`);
  if (!info.video) return null;
  return { file: rel, url: urlFor(category, rel), size: st.size, mtime: Math.floor(st.mtimeMs), duration: info.duration,
    video: info.video };
}

/** `source()` returns what ffprobe reads: a local path or a presigned S3 URL (only built on a cache miss). */
async function probeCached(category, rel, source, st) {
  if (!probeCache) probeCache = readJSONFile(probeCacheFile(), {});
  const key = `${category}/${rel}`;
  const hit = probeCache[key];
  if (hit && hit.size === st.size && hit.mtime === Math.floor(st.mtimeMs)) return hit.probe;
  const info = await probeLimit(key, () => probe(source()));
  probeCache[key] = { size: st.size, mtime: Math.floor(st.mtimeMs), probe: info };
  return info;
}

async function scan() {
  if (state.scanning) return state.scanning;
  state.scanning = (async () => {
    const catalog = loadCatalog();
    const edits = readJSONFile(scenesFile(), {});
    const items = [];
    const seen = new Set();
    for (const category of CATEGORIES) {
      const remote = bucket.isRemote(category);
      const dir = path.join(config.mediaDir, category);
      const files = remote ? await listRemote(category) : walk(dir).map((rel) => ({ rel }));
      files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
      // music: videos are the pictures of the songs they're named after (musicVideo())
      const videos = new Map();
      if (category === 'music') {
        for (const f of files) if (VIDEO_EXT.has(path.extname(f.rel).toLowerCase())) videos.set(stem(f.rel), f.rel);
      }
      for (const f of files) {
        const rel = f.rel;
        const ext = path.extname(rel).toLowerCase();
        const isVideo = VIDEO_EXT.has(ext);
        const isAudio = AUDIO_EXT.has(ext);
        if (!isVideo && !isAudio) continue;
        if (category === 'music' && !isAudio) continue;
        if ((category === 'movies' || category === 'trailers') && !isVideo) continue;
        const full = path.join(dir, rel);
        let st = f;
        if (!remote) {
          try {
            st = fs.statSync(full);
          } catch {
            continue;
          }
        }
        const source = remote ? () => bucket.serverUrl(`${category}/${rel}`) : () => full;
        let info;
        try {
          info = await probeCached(category, rel, source, st);
        } catch (e) {
          console.warn(`[library] probe failed for ${category}/${rel}: ${e.message}`);
          continue;
        }
        const key = `${category}/${rel}`;
        seen.add(key);
        const id = idFor(key);
        const meta = catalogEntry(catalog, category, rel) || {};
        const item = {
          id,
          category,
          kind: isVideo ? 'video' : 'audio',
          file: rel,
          url: urlFor(category, rel),
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
          duration: info.duration,
          probe: info,
          title: meta.title || info.tags.title || prettyTitle(rel),
          year: meta.year || yearFrom(rel) || info.tags.year || null,
          description: meta.description || '',
          tags: meta.tags || [],
        };
        if (remote) item.remote = true; // streamed from the bucket (see server/bucket.js)
        if (isVideo) {
          const editScenes = edits[key];
          item.scenes = normScenes(editScenes || meta.scenes || [], info.duration);
          item.scenesEdited = !!editScenes;
          item.poster = `/api/poster/${id}`;
        }
        if (isAudio) {
          item.artist = meta.artist || info.tags.artist || '';
          item.album = meta.album || info.tags.album || (category === 'music' ? path.dirname(rel) : '') || '';
          if (item.album === '.') item.album = '';
          item.track = info.tags.track;
          item.disc = info.tags.disc;
          const mv = videos.has(stem(rel)) ? await musicVideo(category, videos.get(stem(rel)), seen) : null;
          if (mv) item.musicVideo = mv;
          item.cover = info.hasCover || findSidecarImage(item) || mv ? `/api/cover/${id}` : null;
          item.scoreUrl = `/api/score/${id}`;
          item.compatUrl = `/api/compat/${id}.flac`;
        }
        items.push(item);
      }
    }
    // forget cache entries for files that disappeared
    if (probeCache) {
      for (const k of Object.keys(probeCache)) if (!seen.has(k)) delete probeCache[k];
      try {
        writeJSONAtomic(probeCacheFile(), probeCache);
      } catch (e) {
        console.warn(`[library] could not save probe cache: ${e.message}`);
      }
    }
    const sig = (i) => `${i.id}:${i.mtime}:${i.size}${i.musicVideo ? `:${i.musicVideo.mtime}:${i.musicVideo.size}` : ''}`;
    const before = state.items.map(sig).join('|');
    state.items = items;
    state.byId = new Map(items.map((i) => [i.id, i]));
    state.catalog = catalog;
    state.scannedAt = Date.now();
    const after = items.map(sig).join('|');
    if (before !== after) for (const fn of listeners) fn(items);
    return items;
  })();
  try {
    return await state.scanning;
  } finally {
    state.scanning = null;
  }
}

async function ensureFresh() {
  if (!state.scannedAt) return scan();
  if (Date.now() - state.scannedAt > config.rescanSeconds * 1000) scan().catch(() => {});
  return state.items;
}

function get(id) {
  return state.byId.get(id) || null;
}

function sceneKey(item) {
  return `${item.category}/${item.file}`;
}

function saveScenes(item, scenes) {
  const edits = readJSONFile(scenesFile(), {});
  const clean = normScenes(scenes, item.duration).map((s, i) => ({ ...s, id: s.id || `s${i + 1}` }));
  edits[sceneKey(item)] = clean;
  writeJSONAtomic(scenesFile(), edits, true);
  item.scenes = clean;
  item.scenesEdited = true;
  return clean;
}

function resetScenes(item) {
  const edits = readJSONFile(scenesFile(), {});
  delete edits[sceneKey(item)];
  writeJSONAtomic(scenesFile(), edits, true);
  const meta = catalogEntry(state.catalog || loadCatalog(), item.category, item.file) || {};
  item.scenes = normScenes(meta.scenes || [], item.duration);
  item.scenesEdited = false;
  return item.scenes;
}

// Speaker sounds (MEDIA_DIR/sounds): LFE.flac plays on the subwoofer, FL.flac, FC.flac... on their own
// speaker, mains.flac on any other. Not library items and not in git; the app falls back to its synthesized sounds.
const SOUND_DIR = 'sounds';
const SOUND_ROLES = ['FL', 'FR', 'FC', 'SL', 'SR', 'BL', 'BR', 'LFE', 'mains'];

/** { role: url } for the sound files present. The ?v= changes with the file, so a replaced sound isn't cached. */
function speakerSounds() {
  const dir = path.join(config.mediaDir, SOUND_DIR);
  const out = {};
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    const ext = path.extname(name);
    const role = SOUND_ROLES.find((r) => r.toLowerCase() === path.basename(name, ext).toLowerCase());
    if (!role || !AUDIO_EXT.has(ext.toLowerCase()) || out[role]) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      out[role] = `/media/${SOUND_DIR}/${encodeURIComponent(name)}?v=${Math.floor(st.mtimeMs)}`;
    } catch { /* gone */ }
  }
  return out;
}

module.exports = { scan, ensureFresh, get, all: () => state.items, saveScenes, resetScenes, onChange, loadRoom, loadShowcase, speakerSounds,
  CATEGORIES, SOUND_DIR };
