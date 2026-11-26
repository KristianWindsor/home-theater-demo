// Per-device settings (this browser on this TV), persisted in localStorage.

const KEY = 'marquee.settings.v1';

export const DEFAULTS = {
  volume: 1,
  fxLevel: 0.5,            // speaker clicks, Channel Check, Subwoofer Sweep, test tones (0..1)
  showLevel: 1,            // the shows: composed experiences, Orbit, Thunderstorm (1 = as composed)
  quality: 'auto',         // auto | native | high | medium | low (see gl/resolution.js)
  perfOverlay: false,      // resolution, frame times, dropped video frames on top of everything
  trip: 1,                 // visual intensity (0.5 .. 1.5)
  reduceFlashing: false,
  avOffsetMs: 0,           // + delays the visuals, - advances them
  upmix: false,            // stereo music -> 5.1
  surroundMap: 'side',     // 7.1 devices: where 5.1 surrounds go (side|back)
  sceneFades: true,
  sceneEnd: 'stop',        // stop | continue | next
  showHud: false,
  roomLabels: true,
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();
const listeners = new Set();

export function setSetting(k, v) {
  settings[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch { /* private mode */ }
  for (const fn of listeners) fn(k, v);
}

export function onSetting(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
