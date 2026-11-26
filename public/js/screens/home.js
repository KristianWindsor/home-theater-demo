// Home: the 3D theater. Click speakers to hear them alone, the TV for movies, the couch to sit.
import { h, icon, TOUCH_ONLY } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { settings } from '../core/settings.js';
import { coverEl } from './music.js';

export function home(root) {
  const app = ctx.app;
  app.setMode('room');
  if (!app.room.preset || app.room.preset === 'tv') app.room.goTo('overview', 1.4);
  const unsubs = [];
  const tag = h('div', { class: 'room-tag', style: { opacity: 0 } });
  const banner = h('div', { class: 'demo-banner', style: { display: 'none' } });
  const nowPlaying = h('div', { class: 'nowplaying', style: { display: 'none' } });
  const go = (path) => () => app.router.go(path);
  const dock = h('div', { class: 'dock' },
    h('button', { class: 'dock-item', onclick: go('/demos'), 'data-autofocus': true }, icon('surround'), h('span', {}, 'Demos')),
    h('button', { class: 'dock-item', onclick: go('/trailers') }, icon('ticket'), h('span', {}, 'Trailers')),
    h('button', { class: 'dock-item', onclick: go('/movies') }, icon('film'), h('span', {}, 'Movies')),
    h('button', { class: 'dock-item', onclick: go('/music') }, icon('music'), h('span', {}, 'Music')),
    h('button', { class: 'dock-item', onclick: go('/settings') }, icon('settings'), h('span', {}, 'Settings')),
  );
  const xpPill = h('div', { class: 'xp-pill' });
  const el = h('div', { class: 'screen home' },
    h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, 'KW 5.1'),
      h('div', { class: 'room-name' }, (app.library.room && app.library.room.name) || 'Home Theater')),
    h('div', { class: 'room-hint' }, TOUCH_ONLY
      ? ['Tap a speaker to hear it alone', h('br'), 'Drag to look around · tap the couch to sit']
      : ['Click a speaker to hear it alone', h('br'), 'Drag to look around · click the couch to sit']),
    tag, banner, nowPlaying, dock, xpPill,
  );
  root.appendChild(el);
  focusFirst(el);

  // room experiences ("The Room Wakes Up") take over this screen: the interface fades out and back in on cue
  let xpUnsub = [];
  let pillTimer = 0;
  const showPill = () => {
    if (!app.experience || app.experience.kind !== 'room') return;
    xpPill.classList.add('on');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => xpPill.classList.remove('on'), 2600);
  };
  const bindXp = (run) => {
    for (const u of xpUnsub) u();
    xpUnsub = [];
    if (!run || run.kind !== 'room') {
      el.classList.remove('immersive');
      xpPill.classList.remove('on');
      return;
    }
    xpPill.replaceChildren(h('span', { class: 'title' }, run.def.title),
      h('button', { class: 'btn small', onclick: () => app.stopExperience() }, icon('close'), 'Stop'));
    xpUnsub.push(run.on('chrome', (visible) => el.classList.toggle('immersive', !visible)));
    if (run.chromeHidden) el.classList.add('immersive');
  };
  unsubs.push(app.on('experience', bindXp));
  bindXp(app.experience);
  for (const ev of ['pointermove', 'pointerdown']) document.addEventListener(ev, showPill, true);
  unsubs.push(() => {
    for (const u of xpUnsub) u();
    clearTimeout(pillTimer);
    for (const ev of ['pointermove', 'pointerdown']) document.removeEventListener(ev, showPill, true);
  });

  // floating label over hovered / clicked objects
  let tagFor = null, tagUntil = 0, tagText = null;
  const anchor = (id) => {
    const sp = app.room.speakers[id];
    if (sp && sp.top) return [sp.top[0], sp.top[1] + 0.3, sp.top[2]];
    if (id === 'tv') return [0, app.room.tv.y + app.room.tv.h / 2 + 0.15, app.room.tv.z];
    if (id === 'couch') return [0, 1.35, app.library.room?.couch?.z ?? 0.3];
    return null;
  };
  const labelFor = (p) => {
    const sp = app.room.speakers[p.id];
    if (sp) return [sp.label, sp.detail || sp.role];
    if (p.id === 'tv') return [p.label || 'TV', 'Movies'];
    if (p.id === 'couch') return ['Couch', app.room.preset === 'couch' ? 'Stand up' : 'Sit down'];
    return [p.label || p.id, ''];
  };
  unsubs.push(app.on('hover', (p) => {
    if (p) {
      tagFor = p.id;
      tagText = labelFor(p);
      tagUntil = Infinity;
    } else if (tagUntil === Infinity) tagUntil = performance.now() + 300;
  }));
  unsubs.push(app.on('egg', (e) => {
    tagFor = e.id;
    tagText = [e.label, e.detail];
    tagUntil = performance.now() + 2600;
  }));
  unsubs.push(app.on('roomframe', (room) => {
    if (!tagFor || performance.now() > tagUntil || !settings.roomLabels) {
      tag.style.opacity = 0;
      return;
    }
    const a = anchor(tagFor);
    if (!a) return;
    const p = room.project(a, window.innerWidth, window.innerHeight);
    tag.style.left = `${p.x}px`;
    tag.style.top = `${p.y}px`;
    tag.style.opacity = p.visible ? 1 : 0;
    if (tag.dataset.k !== tagText.join('|')) {
      tag.dataset.k = tagText.join('|');
      tag.replaceChildren(h('span', {}, tagText[0]), tagText[1] ? h('span', { class: 'sub' }, tagText[1]) : null);
    }
  }));

  // demo banner: built once and updated in place, so the Stop button stays the same element while it's tapped
  const bTitle = h('span', { class: 'title' });
  const bStatus = h('span', { class: 'status' });
  banner.append(bTitle, bStatus, h('button', { class: 'btn small', onclick: () => app.stopDemo() }, icon('close'), 'Stop'));
  const renderDemo = (st) => {
    if (!st) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = '';
    const elapsed = (performance.now() - st.started) / 1000;
    const text = st.text || `${Math.max(0, Math.ceil(st.duration - elapsed))} s`;
    if (bTitle.textContent !== st.title) bTitle.textContent = st.title;
    if (bStatus.textContent !== text) bStatus.textContent = text;
  };
  unsubs.push(app.on('demo', renderDemo));
  renderDemo(app.demo && app.demo.status);
  const demoClock = setInterval(() => app.demo && renderDemo(app.demo.status), 500);
  unsubs.push(() => clearInterval(demoClock));

  // now playing (music keeps going in the background; the TV and lights follow it)
  const renderNP = () => {
    const m = app.music;
    if (!m.item) {
      nowPlaying.style.display = 'none';
      return;
    }
    nowPlaying.style.display = '';
    nowPlaying.replaceChildren(
      m.item.cover ? h('img', { src: m.item.cover, alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; } }) : coverEl(m.item, 'cover-art'),
      h('div', { class: 'np-text' }, h('div', { class: 'np-title' }, m.item.title), h('div', { class: 'np-sub' }, m.item.artist || m.item.album || '')),
      h('button', { class: 'btn btn-icon btn-ghost', onclick: () => m.toggle(), 'aria-label': 'Play or pause' }, icon(m.playing ? 'pause' : 'play')),
      h('button', { class: 'btn btn-icon btn-ghost', onclick: () => app.router.go(`/viz/${m.item.id}`), 'aria-label': m.videoOn ? 'Watch the music video' : 'Open visualizer' }, icon(m.videoOn ? 'film' : 'eye')),
    );
  };
  unsubs.push(app.music.on(() => renderNP()));
  renderNP();

  const order = ['fl', 'c', 'fr', 'sr', 'sl', 'sub'];
  return {
    unmount() {
      for (const u of unsubs) u();
      app.hover = null;
      if (app.experience && app.experience.kind === 'room') app.stopExperience();
      if (app.demo) app.stopDemo();
    },
    onKey(e) {
      if (app.experience && app.experience.kind === 'room') {
        showPill();
        if (e.key === 'Escape' || e.key === 'Backspace') {
          app.stopExperience();
          return true;
        }
        return false;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 6) {
        const ids = Object.keys(app.room.speakers);
        const id = order.filter((x) => ids.includes(x))[n - 1] || ids[n - 1];
        if (id) app.activate(id);
        return true;
      }
      if (e.key === 'c' || e.key === 'C') {
        app.activate('couch');
        return true;
      }
      if (e.key === 'Escape' && app.demo) {
        app.stopDemo();
        return true;
      }
      return false;
    },
  };
}
