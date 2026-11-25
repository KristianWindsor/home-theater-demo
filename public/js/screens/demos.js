// Demos: built-in synthesized experiences + your demo discs (Dolby/DTS trailers etc.).
import { h, icon, fmtTime } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { BUILTIN_DEMOS } from '../audio/demos.js';
import { videoCard } from './movies.js';

const ICONS = { 'channel-check': 'surround', orbit: 'orbit', storm: 'storm', 'lfe-sweep': 'sub' };

export function demos(root) {
  const app = ctx.app;
  app.setMode('room');
  app.room.goTo('overview', 1.4);
  const files = app.library.items.filter((i) => i.category === 'demos');
  const vids = files.filter((i) => i.kind === 'video');
  const auds = files.filter((i) => i.kind === 'audio');
  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('h1', {}, 'Demos'), h('div', { class: 'spacer' })),
    h('div', { class: 'scroll' },
      h('div', { class: 'section-title' }, 'Built in (synthesized live, plays in the 3D room)'),
      h('div', { class: 'builtin' }, BUILTIN_DEMOS.map((d, i) => h('button', { class: 'card', onclick: () => app.runDemo(d.id), 'data-autofocus': i === 0 || null },
        icon(ICONS[d.id] || 'bolt'),
        h('div', { class: 'title' }, d.title),
        h('div', { class: 'blurb' }, d.blurb),
        h('div', { class: 'meta' }, `${fmtTime(d.duration)}`)))),
      h('div', { class: 'section-title' }, 'Demo videos'),
      vids.length
        ? h('div', { class: 'grid' }, vids.map((v) => videoCard(v, () => app.router.go(v.scenes && v.scenes.length ? `/movie/${v.id}` : `/play/${v.id}?t=0`))))
        : h('div', { class: 'empty' }, 'Put demo clips (Dolby Atmos/DTS:X trailers, audiophile surround tests) in ', h('code', {}, 'media/demos'), '.'),
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
