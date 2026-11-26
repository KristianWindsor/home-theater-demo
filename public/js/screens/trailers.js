// Trailers: the Dolby, DTS and THX trailers that play before the film in a cinema. One section per folder
// (media/trailers/Dolby/Spheres.mp4 goes under Dolby); Play all runs them back to back, like a pre-show reel.
import { h, icon, fmtTime } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { badges } from './movies.js';

const BRAND_ORDER = ['dolby', 'dts', 'imax', 'thx']; // other folders follow alphabetically, loose files last

/** Trailers grouped by their top folder, in page order: [{ name, items }] ('' = files not in a folder). */
export function trailerGroups(items) {
  const groups = new Map();
  for (const v of items) {
    if (v.category !== 'trailers' || v.kind !== 'video') continue;
    const name = v.file.includes('/') ? v.file.slice(0, v.file.indexOf('/')) : '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(v);
  }
  const rank = (name) => (name ? BRAND_ORDER.indexOf(name.toLowerCase()) + 1 || BRAND_ORDER.length + 1 : Infinity);
  return [...groups].map(([name, list]) => ({ name, items: list }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/** Every trailer in page order: what Play all plays. */
export const trailerReel = (items) => trailerGroups(items).flatMap((g) => g.items);

function trailerCard(item, autofocus) {
  const app = ctx.app;
  return h('button', { class: 'card trailer', onclick: () => app.router.go(`/play/${item.id}?t=0`), 'data-autofocus': autofocus || null },
    h('div', { class: 'thumb' },
      h('img', { src: item.poster, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.opacity = 0; } }),
      h('div', { class: 'badges' }, badges(item)),
      h('span', { class: 'badge time' }, fmtTime(item.duration))),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, item.title),
      item.description ? h('div', { class: 'line' }, item.description) : null));
}

export function trailers(root) {
  const app = ctx.app;
  app.setMode('room');
  app.room.goTo('couch', 1.6);
  const groups = trailerGroups(app.library.items);
  const reel = groups.flatMap((g) => g.items);
  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('h1', {}, 'Trailers'), h('div', { class: 'spacer' }),
      reel.length > 1
        ? h('button', { class: 'btn btn-primary', onclick: () => app.router.go(`/play/${reel[0].id}?reel=trailers`), 'aria-label': 'Play all' },
          icon('play'), h('span', { class: 'lbl' }, `Play all ${reel.length}`))
        : null),
    h('div', { class: 'scroll' },
      reel.length
        ? groups.map((g, gi) => [
          g.name ? h('div', { class: 'section-title' }, g.name) : null,
          h('div', { class: 'trailer-grid' }, g.items.map((v, i) => trailerCard(v, gi === 0 && i === 0))),
        ])
        : h('div', { class: 'empty' }, 'No trailers yet. Put Dolby, DTS and THX trailers in ', h('code', {}, 'media/trailers'),
          ', one folder per brand (', h('code', {}, 'trailers/Dolby/Spheres.mp4'), '), and run ', h('code', {}, 'scripts/prepare_media.py'),
          ' on TrueHD and DTS files so they play in a browser.')));
  root.appendChild(el);
  focusFirst(el);
  return {};
}
