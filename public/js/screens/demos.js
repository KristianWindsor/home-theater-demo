// Demos: shows (composed experiences and short built-in pieces), setup tools, and your own demo clips.
import { h, icon, fmtTime } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { BUILTIN_DEMOS } from '../audio/demos.js';
import { EXPERIENCES } from '../experiences/index.js';
import { videoCard } from './movies.js';

// One card for everything you can start here: icon, name, one line, then length and where it plays.
function demoCard({ id, icon: ic, title, line, duration, where, run }, first) {
  return h('button', { class: 'card demo-card', onclick: run, 'data-autofocus': first || null, 'data-key': `show:${id}` },
    h('div', { class: 'ico' }, icon(ic)),
    h('div', { class: 'title' }, title),
    h('div', { class: 'line' }, line),
    h('div', { class: 'meta' }, h('span', {}, fmtTime(duration)), h('span', { class: 'dot' }, '·'), h('span', {}, where)));
}

const ICONS = { 'channel-check': 'surround', orbit: 'orbit', storm: 'storm', 'lfe-sweep': 'sub' };

const section = (title, sub) => h('div', { class: 'section-head' }, h('div', { class: 'section-title' }, title), sub ? h('div', { class: 'section-sub' }, sub) : null);

export function demos(root) {
  const app = ctx.app;
  app.setMode('room');
  app.room.goTo('overview', 1.4);
  const files = app.library.items.filter((i) => i.category === 'demos');
  const vids = files.filter((i) => i.kind === 'video');
  const auds = files.filter((i) => i.kind === 'audio');
  const builtin = (d) => ({ id: d.id, icon: ICONS[d.id] || 'bolt', title: d.title, line: d.blurb, duration: d.duration, where: 'In the room', run: () => app.runDemo(d.id) });
  const shows = [
    ...EXPERIENCES.filter((x) => !x.hidden).map((x) => ({ id: x.id, icon: `xp-${x.id}`, title: x.title, line: x.tagline, duration: x.duration, where: x.kind === 'room' ? 'In the room' : 'Full screen', run: () => app.runExperience(x.id) })),
    ...BUILTIN_DEMOS.filter((d) => d.show).map(builtin), // short built-in pieces sit with the shows
  ];
  const setup = BUILTIN_DEMOS.filter((d) => !d.show).map(builtin);
  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('h1', {}, 'Demos'), h('div', { class: 'spacer' })),
    h('div', { class: 'scroll' },
      section('Shows', 'Sound, picture and lights, composed for this room'),
      h('div', { class: 'demo-grid' }, shows.map((d, i) => demoCard(d, i === 0))),
      section('Setup', 'Check each speaker and the subwoofer'),
      h('div', { class: 'demo-grid' }, setup.map((d) => demoCard(d))),
      // your own clips from media/demos (the Dolby/DTS/THX trailers have their own page)
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
