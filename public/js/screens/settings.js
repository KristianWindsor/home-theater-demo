// Settings & system check: speakers, sync, visuals, playback, library, browser capabilities.
import { h, icon, toast, TOUCH_ONLY } from '../core/dom.js';
import { api } from '../core/api.js';
import { ctx } from '../core/context.js';
import { settings, setSetting } from '../core/settings.js';
import { focusFirst } from '../core/nav.js';
import { capabilityTable } from '../core/compat.js';
import { ROLE_LABEL } from '../audio/engine.js';

function seg(key, options, onChange) {
  const wrap = h('div', { class: 'seg-ctl', role: 'group' });
  const draw = () => wrap.replaceChildren(...options.map(([v, label]) => h('button', {
    class: settings[key] === v ? 'on' : '', onclick: () => { setSetting(key, v); draw(); if (onChange) onChange(v); },
  }, label)));
  draw();
  return wrap;
}

function toggle(key, onChange) {
  return seg(key, [[false, 'Off'], [true, 'On']], onChange);
}

function slider(key, min, max, step, fmt, onChange) {
  const out = h('span', { class: 'mono muted', style: { minWidth: '5rem', textAlign: 'right' } }, fmt(settings[key]));
  const input = h('input', { class: 'range', type: 'range', min, max, step, value: settings[key],
    oninput: (e) => { const v = Number(e.target.value); setSetting(key, v); out.textContent = fmt(v); if (onChange) onChange(v); } });
  return [input, out];
}

const row = (label, help, ...ctl) => h('div', { class: 'row' }, h('div', { class: 'label' }, label, help ? h('small', {}, help) : null), ...ctl);

export function settingsScreen(root) {
  const app = ctx.app;
  app.setMode('room');
  const eng = app.engine;
  const speakers = Object.values(app.room.speakers);
  let sync = null;

  const audioPanel = h('div', { class: 'panel' },
    h('h3', {}, 'Speakers'),
    row('Output', eng.ready ? `${eng.channels} channels reported by the browser` : 'Starts after the first click',
      h('span', { class: `badge ${eng.ready && eng.channels >= 6 ? 'ok' : 'warn'}` }, eng.ready ? eng.layoutName : 'not started')),
    eng.ready && eng.channels < 6 && !TOUCH_ONLY ? h('div', { class: 'help' }, 'Per-speaker sounds need the OS playback device set to 5.1 (Windows: Sound settings → the HDMI/receiver device → Configure → 5.1). Reload the page afterwards. Movies are unaffected: they always play their own channels.') : null,
    h('div', { class: 'speaker-grid' }, speakers.map((s) => h('button', { class: 'btn', onclick: () => {
      if (!app.synth) return toast('Click Enter first.', 'warn');
      app.synth.play(s.role, s.role === 'LFE' ? 'lfeRumble' : 'pinkBurst', { dur: 1.5 });
      app.room.setActivity(s.id, 1);
    } }, `${s.label}`))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => app.runDemo('channel-check') }, icon('surround'), 'Run channel check in the room')),
    row('Volume', 'Master level for music, shows and tests', ...slider('volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)),
    row('Shows level', 'The experiences, Orbit and Thunderstorm. 100% plays them as composed', ...slider('showLevel', 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`)),
    row('Speaker clicks & tests', 'Tapping speakers in the room, Channel Check, Subwoofer Sweep and these test buttons', ...slider('fxLevel', 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`)),
    eng.ready && eng.channels === 8 ? row('Surround speakers on a 7.1 output', 'Where the 4 and 8 o’clock towers are wired', seg('surroundMap', [['side', 'Side'], ['back', 'Back']])) : null,
  );

  const flash = h('div', { class: 'sync-flash' });
  const syncBtn = h('button', { class: 'btn', onclick: () => toggleSync() }, icon('play'), 'Start test');
  const syncPanel = h('div', { class: 'panel' },
    h('h3', {}, 'Audio / video sync'),
    h('div', { class: 'help' }, 'TVs delay the picture and receivers delay the sound. Start the test, then move the slider until the white flash lands exactly on each click. The visualizer uses this offset.'),
    h('div', { class: 'row' }, flash, syncBtn),
    row('Offset', 'Positive = visuals later', ...slider('avOffsetMs', -400, 400, 5, (v) => `${v > 0 ? '+' : ''}${v} ms`)),
  );

  function toggleSync() {
    if (sync) {
      sync.stop();
      sync = null;
      syncBtn.replaceChildren(icon('play'), 'Start test');
      return;
    }
    if (!eng.ready) return toast('Click Enter first.', 'warn');
    if (app.music.playing) app.music.pause();
    // a click track played through the same media-element path the music uses
    const sr = 48000, bpm = 100, secs = 60;
    const period = 60 / bpm;
    const n = sr * secs;
    const data = new Int16Array(n);
    for (let k = 0; k * period < secs; k++) {
      const s0 = Math.floor(k * period * sr);
      for (let i = 0; i < 1200 && s0 + i < n; i++) data[s0 + i] = Math.round(Math.sin(i * 2 * Math.PI * 1500 / sr) * Math.exp(-i / 250) * 24000);
    }
    const wav = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(wav);
    const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
    new Int16Array(wav, 44).set(data);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const el = new Audio(url);
    const src = eng.ctx.createMediaElementSource(el);
    src.connect(eng.master);
    el.loop = true;
    el.play();
    let raf = 0;
    const loop = () => {
      const t = el.currentTime - settings.avOffsetMs / 1000;
      const ph = ((t % period) + period) % period;
      flash.classList.toggle('on', ph < 0.07);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    syncBtn.replaceChildren(icon('pause'), 'Stop test');
    sync = { stop() { cancelAnimationFrame(raf); el.pause(); src.disconnect(); URL.revokeObjectURL(url); flash.classList.remove('on'); } };
  }

  const visualPanel = h('div', { class: 'panel' },
    h('h3', {}, 'Visualizer'),
    row('Quality', 'Auto lowers the resolution if frames drop', seg('quality', [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], () => toast('Quality applies to newly built worlds; reload for a clean start.'))),
    row('Intensity', 'How hard the visuals react (warp, trails, punches)', ...slider('trip', 0.4, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`)),
    row('Reduce flashing', 'Tames full-screen flashes and strobing at drops (photosensitivity)', toggle('reduceFlashing')),
    row('Show analysis HUD', 'Press I in the visualizer', toggle('showHud')),
    row('Labels in the 3D room', '', toggle('roomLabels')),
  );

  const playbackPanel = h('div', { class: 'panel' },
    h('h3', {}, 'Playback'),
    row('Stereo music on all speakers', 'Upmixes stereo to 5.1 (center anchor, ambience to the surrounds, bass to the sub). Off plays stereo exactly as mastered; surround music always plays as mastered.',
      toggle('upmix')),
    row('Fade scenes in and out', '', toggle('sceneFades')),
    row('When a scene ends', '', seg('sceneEnd', [['stop', 'Stop'], ['next', 'Next scene'], ['continue', 'Keep playing']])),
  );

  const status = h('div', { class: 'help' });
  const drawStatus = async () => {
    try {
      const lib = app.library;
      const a = (lib.server && lib.server.analysis) || {};
      const counts = ['movies', 'demos', 'music'].map((c) => `${lib.items.filter((i) => i.category === c).length} ${c}`).join(' · ');
      const ready = lib.items.filter((i) => i.kind === 'audio' && i.analysis && i.analysis.status === 'ready').length;
      const audio = lib.items.filter((i) => i.kind === 'audio').length;
      status.textContent = `${counts}. ${ready}/${audio} tracks choreographed${a.queued ? `, ${a.queued} queued` : ''}${a.failed ? `, ${a.failed} failed` : ''}. Server v${lib.server ? lib.server.version : '?'}.`;
    } catch { /* ignore */ }
  };
  drawStatus();
  const libPanel = h('div', { class: 'panel' },
    h('h3', {}, 'Library'),
    status,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => { await api.rescan(); await app.refreshLibrary(); drawStatus(); toast('Library rescanned.'); } }, icon('refresh'), 'Rescan media'),
      h('button', { class: 'btn', onclick: async () => { const r = await api.analyze('all'); toast(`Re-analyzing ${r.queued} tracks in the background.`); } }, icon('wave'), 'Re-analyze music')),
  );

  const caps = capabilityTable();
  const capsPanel = h('div', { class: 'panel' },
    h('h3', {}, 'This browser can decode'),
    h('div', { class: 'codec-table' }, caps.map(([k, ok]) => [h('span', { class: 'k' }, k), h('span', { class: `badge ${ok ? 'ok' : 'bad'}` }, ok ? 'yes' : 'no')])),
    h('div', { class: 'help' }, 'Browsers decode audio themselves and send multichannel PCM to the receiver; they can’t pass Dolby TrueHD/Atmos or DTS-HD through. prepare_media.py converts those tracks to lossless FLAC with the same channels.'),
  );

  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back', 'data-autofocus': true }, icon('back')),
      h('h1', {}, 'Settings'), h('div', { class: 'spacer' })),
    h('div', { class: 'scroll' }, h('div', { class: 'settings' }, audioPanel, syncPanel, visualPanel, playbackPanel, libPanel, capsPanel)));
  root.appendChild(el);
  focusFirst(el);
  return { unmount() { if (sync) sync.stop(); } };
}

export { ROLE_LABEL };
