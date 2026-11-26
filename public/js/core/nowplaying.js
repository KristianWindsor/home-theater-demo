// Now Playing: music keeps going while you browse, so its transport stays with you (cover and title, which open the
// visualizer, then previous, play/pause, next, stop). Shown on the home screen and the library screens; not over the
// movie player, the visualizer or a show.
import { h, icon } from './dom.js';
import { coverEl } from '../screens/music.js';

const SHOWN_ON = new Set(['home', 'movies', 'movie', 'trailers', 'demos', 'music', 'settings']);

export function installNowPlaying(app) {
  const m = app.music;
  const cover = h('div', { class: 'np-cover' });
  const title = h('div', { class: 'np-title' });
  const sub = h('div', { class: 'np-sub' });
  const open = () => m.item && app.router.go(`/viz/${m.item.id}`);
  const playBtn = h('button', { class: 'btn btn-icon btn-ghost', onclick: () => m.toggle(), 'aria-label': 'Play or pause' }, icon('pause'));
  const el = h('div', { id: 'np', class: 'np', hidden: true, role: 'region', 'aria-label': 'Now playing' },
    h('button', { class: 'np-info', onclick: open, title: 'Open the visualizer', 'data-key': 'np:open' }, cover, h('div', { class: 'np-text' }, title, sub)),
    h('button', { class: 'btn btn-icon btn-ghost', onclick: () => m.prev(), 'aria-label': 'Previous song', 'data-key': 'np:prev' }, icon('prev')),
    playBtn,
    h('button', { class: 'btn btn-icon btn-ghost', onclick: () => m.next(), 'aria-label': 'Next song', 'data-key': 'np:next' }, icon('next')),
    h('button', { class: 'btn btn-icon btn-ghost np-stop', onclick: () => m.stop(), 'aria-label': 'Stop the music', 'data-key': 'np:stop' }, icon('close')));
  document.body.insertBefore(el, document.getElementById('toasts'));

  let shownId = null, shownPlaying = null;
  const render = () => {
    const route = app.router.current;
    const roomShow = !!app.experience && app.experience.kind === 'room';
    const show = !!m.item && !!route && SHOWN_ON.has(route.name) && !roomShow;
    el.hidden = !show;
    document.body.classList.toggle('np-on', show);
    el.classList.toggle('at-home', !!route && route.name === 'home');
    if (!show) return;
    if (shownId !== m.item.id) {
      shownId = m.item.id;
      const it = m.item;
      cover.replaceChildren(it.cover ? h('img', { src: it.cover, alt: '', onerror: (e) => e.target.replaceWith(coverEl(it)) }) : coverEl(it));
      title.textContent = it.title;
      sub.textContent = it.artist || it.album || '';
    }
    if (shownPlaying !== m.playing) {
      shownPlaying = m.playing;
      playBtn.replaceChildren(icon(m.playing ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', m.playing ? 'Pause' : 'Play');
    }
  };
  m.on(render);
  app.router.onRoute(render);
  app.on('experience', render);
  render();
  return { render };
}
