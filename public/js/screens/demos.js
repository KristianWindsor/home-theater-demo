// Original Shows: the composed experiences and the short built-in pieces, each card with a still from the piece itself
// (public/img/shows/<id>.jpg), then your own demo clips. Speaker setup (Channel Check, the Subwoofer Sweep) is in
// Settings.
import { h, icon, fmtTime } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { BUILTIN_DEMOS } from '../audio/demos.js';
import { EXPERIENCES } from '../experiences/index.js';
import { videoCard } from './movies.js';

const ICONS = { orbit: 'orbit', storm: 'storm' };

/** A show as a card: its still, how long it runs, then name, one line, and where it plays. */
function showCard({ id, ic, title, line, duration, where, run }, first) {
  const fallback = () => h('div', { class: 'still-fallback' }, icon(ic));
  return h('button', { class: 'card show-card', onclick: run, 'data-autofocus': first || null, 'data-key': `show:${id}` },
    h('div', { class: 'thumb' },
      h('img', { src: `/img/shows/${id}.jpg`, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(fallback()) }),
      h('span', { class: 'badge time' }, fmtTime(duration))),
    h('div', { class: 'body' },
      h('div', { class: 'orig' }, 'KW5.1 Original'),
      h('div', { class: 'title' }, title),
      h('div', { class: 'line' }, line),
      h('div', { class: 'meta' }, where)));
}

const section = (title, sub) => h('div', { class: 'section-head' }, h('div', { class: 'section-title' }, title), sub ? h('div', { class: 'section-sub' }, sub) : null);

export function demos(root) {
  const app = ctx.app;
  app.setMode('room');
  app.room.goTo('overview', 1.4);
  const files = app.library.items.filter((i) => i.category === 'demos');
  const vids = files.filter((i) => i.kind === 'video');
  const auds = files.filter((i) => i.kind === 'audio');
  const shows = [
    ...EXPERIENCES.filter((x) => !x.hidden).map((x) => ({ id: x.id, ic: `xp-${x.id}`, title: x.title, line: x.tagline, duration: x.duration,
      where: x.kind === 'room' ? 'In the room' : 'Full screen', run: () => app.runExperience(x.id) })),
    // the short built-in pieces sit with the shows
    ...BUILTIN_DEMOS.filter((d) => d.show).map((d) => ({ id: d.id, ic: ICONS[d.id] || 'bolt', title: d.title, line: d.blurb, duration: d.duration,
      where: 'In the room', run: () => app.runDemo(d.id) })),
  ];
  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('h1', {}, 'Original Shows'), h('div', { class: 'spacer' })),
    h('div', { class: 'scroll' },
      h('div', { class: 'page-intro' }, 'Sound, picture and lights, composed for this room.'),
      h('div', { class: 'show-grid' }, shows.map((d, i) => showCard(d, i === 0))),
      // your own clips from media/demos (the Dolby/DTS/THX trailers are the Cinema Demos)
      vids.length ? [
        section('Your clips'),
        h('div', { class: 'demo-grid' }, vids.map((v) => videoCard(v, () => app.router.go(v.scenes && v.scenes.length ? `/movie/${v.id}` : `/play/${v.id}?t=0`)))),
      ] : null,
      auds.length ? [
        h('div', { class: 'section-title' }, 'Demo audio (plays with the visualizer)'),
        h('div', { class: 'tracks' }, auds.map((a, i) => h('button', { class: 'track', onclick: async () => { await app.music.playQueue(auds, i); app.router.go(`/viz/${a.id}`); } },
          h('span', { class: 'no' }, i + 1), h('span', { class: 'tt' }, h('div', {}, a.title), h('div', { class: 'sub' }, a.artist || '')),
          h('span', {}, ''), h('span', { class: 'dur' }, fmtTime(a.duration))))),
      ] : null));
  root.appendChild(el);
  focusFirst(el);
  return {};
}
