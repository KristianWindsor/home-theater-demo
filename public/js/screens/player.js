// Video player: scenes, play-all, fades, bookmarking. Audio stays on the browser's native path.
import { h, icon, fmtTime, toast } from '../core/dom.js';
import { api } from '../core/api.js';
import { ctx } from '../core/context.js';
import { settings, setSetting } from '../core/settings.js';
import { checkVideo } from '../core/compat.js';

const FADE_IN = 0.8;
const FADE_OUT = 1.2;

// queue: true = several entries that play back to back (Play all scenes)
function buildPlaylist(app, arg, q) {
  const item = app.items.get(arg);
  if (!item) return { list: [] };
  const scenes = (item.scenes || []).map((s, i) => ({ ...s, i })).filter((s) => s.start !== null);
  if (q.get('scenes') === 'all') {
    return { title: item.title, queue: true, list: scenes.map((s) => ({ item, start: s.start, end: s.end, title: s.title, scene: s.i })) };
  }
  if (q.get('scene') !== null) {
    const i = Number(q.get('scene'));
    const s = (item.scenes || [])[i];
    if (s && s.start !== null) return { title: item.title, list: [{ item, start: s.start, end: s.end, title: s.title, scene: i }], sceneNav: true };
  }
  return { title: item.title, list: [{ item, start: Number(q.get('t')) || 0, end: null, title: null }] };
}

export function player(root, arg, q) {
  const app = ctx.app;
  if (app.demo) app.stopDemo();
  if (app.music.playing) app.music.pause();
  const video = document.getElementById('video');
  const pl = buildPlaylist(app, arg || '', q);
  if (!pl.list.length) {
    toast('Nothing to play.', 'warn');
    app.router.back();
    return {};
  }
  app.setMode('video');
  video.classList.add('on');
  let idx = 0;
  let entry = null;
  let ending = false;
  let idleTimer = 0;
  let raf = 0;
  let input = null;

  const fade = h('div', { class: 'fade-black', style: { opacity: 1 } });
  const spinner = h('div', { class: 'spinner' });
  const titleEl = h('div', { class: 'p-title' });
  const sceneEl = h('div', { class: 'p-scene' });
  const timeEl = h('span', { class: 'time' });
  const fill = h('div', { class: 'fill' });
  const buf = h('div', { class: 'buf' });
  const timeline = h('div', { class: 'timeline' }, buf, fill);
  const playBtn = h('button', { class: 'btn btn-icon', onclick: () => toggle(), 'aria-label': 'Play/pause' }, icon('pause'));
  const vol = h('input', { class: 'vol', type: 'range', min: 0, max: 1, step: 0.01, value: settings.volume,
    oninput: (e) => { video.volume = Number(e.target.value); setSetting('volume', video.volume); } });
  const endCard = h('div', { class: 'end-card', style: { display: 'none' } });
  const inputBox = h('div', { style: { display: 'none' } });
  const overlay = h('div', { class: 'overlay' },
    h('div', { class: 'p-top' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('div', {}, titleEl, sceneEl), h('div', { style: { flex: 1 } }), inputBox),
    h('div', { class: 'p-bottom' },
      timeline,
      h('div', { class: 'controls' },
        h('button', { class: 'btn btn-icon', onclick: () => jumpScene(-1), 'aria-label': 'Previous scene' }, icon('prev')),
        h('button', { class: 'btn btn-icon', onclick: () => seekBy(-10), 'aria-label': 'Back 10 seconds' }, icon('rew')),
        playBtn,
        h('button', { class: 'btn btn-icon', onclick: () => seekBy(10), 'aria-label': 'Forward 10 seconds' }, icon('fwd')),
        h('button', { class: 'btn btn-icon', onclick: () => jumpScene(1), 'aria-label': 'Next scene' }, icon('next')),
        timeEl,
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => bookmark(), title: 'Add a scene starting now (B)' }, icon('marker'), 'Mark scene'),
        icon('volume', 'vol-icon'), vol,
        h('button', { class: 'btn btn-icon', onclick: () => toggleFs(), 'aria-label': 'Fullscreen' }, icon('full')))));
  const el = h('div', { class: 'screen player' }, fade, spinner, overlay, endCard);
  root.appendChild(el);

  const showUi = () => {
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!video.paused && !el.contains(document.activeElement)) el.classList.add('idle');
      else if (!video.paused && document.activeElement && !overlay.contains(document.activeElement)) el.classList.add('idle');
    }, 3000);
  };
  el.addEventListener('pointermove', showUi);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target === overlay) toggle();
  });

  const onEvent = {
    waiting: () => spinner.classList.add('on'),
    playing: () => { spinner.classList.remove('on'); playBtn.replaceChildren(icon('pause')); },
    pause: () => { playBtn.replaceChildren(icon('play')); showUi(); },
    error: () => {
      spinner.classList.remove('on');
      const c = checkVideo(entry.item);
      toast(`Can’t play this file here. ${c.messages[0] || ''}`, 'bad', 9000);
    },
    progress: () => drawTimeline(),
  };
  for (const [k, fn] of Object.entries(onEvent)) video.addEventListener(k, fn);

  function drawTimeline() {
    const d = video.duration || (entry && entry.item.duration) || 1;
    timeline.querySelectorAll('.mark, .span').forEach((m) => m.remove());
    const scenes = (entry && entry.item.scenes) || [];
    for (const s of scenes) {
      if (s.start === null) continue;
      if (s.end) timeline.appendChild(h('div', { class: 'span', style: { left: `${(s.start / d) * 100}%`, width: `${((s.end - s.start) / d) * 100}%` } }));
      timeline.appendChild(h('div', { class: 'mark', title: s.title, style: { left: `${(s.start / d) * 100}%` } }));
    }
    try {
      if (video.buffered.length) buf.style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`;
    } catch { /* ignore */ }
  }

  timeline.addEventListener('pointerdown', (e) => {
    const r = timeline.getBoundingClientRect();
    const seekTo = (x) => { video.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * (video.duration || 0); };
    seekTo(e.clientX);
    const move = (ev) => seekTo(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function rampVolume(to, seconds) {
    const from = video.volume;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
        video.volume = from + (to - from) * k;
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
  }

  async function load(i) {
    idx = i;
    entry = pl.list[i];
    ending = false;
    endCard.style.display = 'none';
    titleEl.textContent = pl.queue ? `${pl.title} — ${i + 1}/${pl.list.length}` : entry.item.title;
    sceneEl.textContent = entry.title && entry.title !== entry.item.title ? entry.title : '';
    const fades = settings.sceneFades && (entry.start > 0 || entry.end);
    fade.style.transition = 'none';
    fade.style.opacity = fades ? 1 : 0;
    const c = checkVideo(entry.item);
    if (c.level !== 'ok' && i === 0) toast(c.messages[0], c.level === 'bad' ? 'bad' : 'warn', 9000);
    const url = entry.item.url;
    if (!video.src.endsWith(url)) {
      video.src = url;
      await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    }
    video.volume = fades ? 0 : settings.volume;
    video.currentTime = entry.start || 0;
    spinner.classList.add('on');
    try {
      await video.play();
    } catch (e) {
      console.warn('[player] play()', e);
    }
    drawTimeline();
    requestAnimationFrame(() => {
      fade.style.transition = `opacity ${FADE_IN}s ease`;
      fade.style.opacity = 0;
    });
    if (fades) rampVolume(settings.volume, FADE_IN);
    showUi();
  }

  async function finishScene() {
    if (ending) return;
    ending = true;
    const auto = pl.queue || settings.sceneEnd === 'next';
    if (settings.sceneEnd === 'continue' && !pl.queue) return;
    fade.style.transition = `opacity ${FADE_OUT}s ease`;
    fade.style.opacity = 1;
    await rampVolume(0, FADE_OUT);
    video.pause();
    if (auto && idx + 1 < pl.list.length) return load(idx + 1);
    if (auto && pl.sceneNav) return jumpScene(1, true);
    endCard.replaceChildren(h('div', { class: 'box' },
      h('h2', {}, entry.title || 'Done'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', onclick: () => load(idx), 'data-autofocus': true }, icon('refresh'), 'Replay'),
        nextSceneOf(entry) ? h('button', { class: 'btn', onclick: () => jumpScene(1) }, icon('next'), 'Next scene') : null,
        h('button', { class: 'btn', onclick: () => { endCard.style.display = 'none'; fade.style.opacity = 0; video.volume = settings.volume; entry = { ...entry, end: null }; ending = false; video.play(); } }, icon('play'), 'Keep watching'),
        h('button', { class: 'btn', onclick: () => app.router.back() }, icon('back'), 'Back'))));
    endCard.style.display = '';
    const f = endCard.querySelector('[data-autofocus]');
    if (f) f.focus();
  }

  function nextSceneOf(e, dir = 1) {
    const scenes = (e.item.scenes || []).map((s, i) => ({ ...s, i })).filter((s) => s.start !== null).sort((a, b) => a.start - b.start);
    const now = video.currentTime;
    if (dir > 0) return scenes.find((s) => s.start > now + 1) || null;
    const before = scenes.filter((s) => s.start < now - 3);
    return before[before.length - 1] || null;
  }

  function jumpScene(dir, fromEnd = false) {
    if (pl.queue) {
      const j = idx + dir;
      if (j >= 0 && j < pl.list.length) load(j);
      return;
    }
    const s = nextSceneOf(entry, dir);
    if (!s) {
      if (fromEnd) app.router.back();
      return;
    }
    pl.list[0] = { item: entry.item, start: s.start, end: s.end, title: s.title, scene: s.i };
    load(0);
  }

  function toggle() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    showUi();
  }

  function seekBy(s) {
    video.currentTime = Math.max(0, Math.min((video.duration || 0) - 0.5, video.currentTime + s));
    showUi();
  }

  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  async function saveScenes(scenes, msg) {
    try {
      const r = await api.saveScenes(entry.item.id, scenes);
      entry.item.scenes = r.scenes;
      drawTimeline();
      toast(msg);
    } catch (e) {
      toast(`Couldn’t save: ${e.message}`, 'bad');
    }
  }

  function bookmark() {
    const t = Math.round(video.currentTime * 10) / 10;
    const n = (entry.item.scenes || []).length + 1;
    // scenes listed in the catalog without a time yet are offered first
    const untimed = (entry.item.scenes || []).find((s) => s.start === null);
    showUi();
    input = h('input', { class: 'input', value: untimed ? untimed.title : `Scene ${n}`, style: { width: '18rem' },
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const title = e.target.value.trim() || `Scene ${n}`;
          inputBox.style.display = 'none';
          input = null;
          const existing = (entry.item.scenes || []).map((s) => ({ ...s }));
          const slot = existing.find((s) => s.start === null && s.title === title);
          if (slot) slot.start = t;
          else existing.push({ title, start: t, end: null });
          const scenes = existing.sort((a, b) => (a.start ?? 1e12) - (b.start ?? 1e12));
          saveScenes(scenes, `${slot ? 'Set' : 'Added'} “${title}” at ${fmtTime(t)}. Press E where it should end.`);
        } else if (e.key === 'Escape') {
          inputBox.style.display = 'none';
          input = null;
        }
      } });
    inputBox.replaceChildren(h('div', { class: 'row' }, h('span', { class: 'muted' }, `New scene at ${fmtTime(t)}:`), input));
    inputBox.style.display = '';
    input.focus();
    input.select();
  }

  function setEnd() {
    const t = Math.round(video.currentTime * 10) / 10;
    const scenes = (entry.item.scenes || []).map((s) => ({ ...s }));
    const cand = scenes.filter((s) => s.start !== null && s.start < t).sort((a, b) => b.start - a.start)[0];
    if (!cand) {
      toast('No scene starts before this point. Press B to add one first.', 'warn');
      return;
    }
    cand.end = t;
    saveScenes(scenes, `“${cand.title}” now ends at ${fmtTime(t)}.`);
  }

  const tick = () => {
    if (entry) {
      const d = video.duration || entry.item.duration || 0;
      const t = video.currentTime;
      fill.style.width = `${d ? (t / d) * 100 : 0}%`;
      const rel = entry.end ? ` · scene ${fmtTime(Math.max(0, entry.end - t))} left` : '';
      timeEl.textContent = `${fmtTime(t, d >= 3600)} / ${fmtTime(d, d >= 3600)}${rel}`;
      if (entry.end && !ending && t >= entry.end - (settings.sceneFades ? FADE_OUT * 0.5 : 0)) finishScene();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  video.addEventListener('ended', finishScene);
  load(0);

  return {
    unmount() {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      for (const [k, fn] of Object.entries(onEvent)) video.removeEventListener(k, fn);
      video.removeEventListener('ended', finishScene);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.classList.remove('on');
      app.setMode('room');
    },
    onKey(e) {
      if (input) return false;
      const inControls = overlay.contains(document.activeElement) || endCard.contains(document.activeElement);
      showUi();
      switch (e.key) {
        case ' ': case 'k': case 'K': case 'MediaPlayPause':
          if (inControls && e.key === ' ') return false;
          toggle(); return true;
        case 'ArrowLeft': case 'j': case 'J':
          if (inControls && e.key === 'ArrowLeft') return false;
          seekBy(e.shiftKey ? -60 : -10); return true;
        case 'ArrowRight': case 'l': case 'L':
          if (inControls && e.key === 'ArrowRight') return false;
          seekBy(e.shiftKey ? 60 : 10); return true;
        case 'ArrowUp': case 'ArrowDown':
          if (inControls) return false;
          playBtn.focus(); return true;
        case 'n': case 'N': case 'PageDown': case 'MediaTrackNext': jumpScene(1); return true;
        case 'p': case 'P': case 'PageUp': case 'MediaTrackPrevious': jumpScene(-1); return true;
        case 'f': case 'F': toggleFs(); return true;
        case 'b': case 'B': bookmark(); return true;
        case 'e': case 'E': setEnd(); return true;
        case '+': case '=': video.volume = Math.min(1, video.volume + 0.05); setSetting('volume', video.volume); vol.value = video.volume; return true;
        case '-': video.volume = Math.max(0, video.volume - 0.05); setSetting('volume', video.volume); vol.value = video.volume; return true;
        case 'Escape':
          if (inControls) { document.activeElement.blur(); el.classList.add('idle'); return true; }
          return false;
        default: return false;
      }
    },
  };
}
