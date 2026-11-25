// Music library, grouped by album. Picking a track opens the visualizer.
import { h, icon, fmtTime } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { hashString } from '../gl/math.js';

function statusBadge(item) {
  const a = item.analysis || {};
  if (a.status === 'ready') return h('span', { class: 'badge ok', title: 'Fully choreographed' }, icon('check'), 'Choreographed');
  if (a.status === 'analyzing') return h('span', { class: 'badge warn' }, `Analyzing ${Math.round((a.progress || 0) * 100)}%`);
  if (a.status === 'queued') return h('span', { class: 'badge' }, 'Queued');
  if (a.status === 'failed') return h('span', { class: 'badge bad', title: a.error || '' }, 'Live only');
  return h('span', { class: 'badge' }, 'Live');
}

export function coverEl(item, cls = 'cover-art') {
  const hue = hashString(`${item.album}|${item.artist}`) % 360;
  const fallback = h('div', { class: cls, style: {
    background: `linear-gradient(135deg, hsl(${hue} 55% 32%), hsl(${(hue + 50) % 360} 70% 12%))`,
    display: 'grid', placeItems: 'center', fontSize: '2.4rem', fontWeight: 200, color: 'rgba(255,255,255,0.7)',
  } }, (item.album || item.title || '?').slice(0, 1).toUpperCase());
  if (!item.cover) return fallback;
  const img = h('img', { class: cls, src: item.cover, alt: '', loading: 'lazy', onerror: () => img.replaceWith(fallback) });
  return img;
}

export function music(root) {
  const app = ctx.app;
  app.setMode('room');
  app.room.goTo('wide', 1.6);
  const tracks = app.library.items.filter((i) => i.category === 'music');
  const albums = new Map();
  for (const t of tracks) {
    const key = `${t.artist || 'Unknown artist'}\u0000${t.album || 'Singles'}`;
    if (!albums.has(key)) albums.set(key, []);
    albums.get(key).push(t);
  }
  for (const list of albums.values()) list.sort((a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0) || a.title.localeCompare(b.title));
  const rows = new Map();
  const play = async (list, i) => {
    await app.music.playQueue(list, i);
    app.router.go(`/viz/${list[i].id}`);
  };
  const shuffled = () => {
    const a = tracks.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let first = true;
  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('h1', {}, 'Music'), h('div', { class: 'spacer' }),
      tracks.length ? h('button', { class: 'btn', onclick: () => play(tracks, 0) }, icon('play'), 'Play all') : null,
      tracks.length ? h('button', { class: 'btn', onclick: () => play(shuffled(), 0) }, icon('shuffle'), 'Shuffle') : null),
    h('div', { class: 'scroll' },
      tracks.length ? [...albums.entries()].map(([key, list]) => {
        const [artist, album] = key.split('\u0000');
        return h('div', { class: 'album' },
          coverEl(list[0]),
          h('div', {},
            h('h2', {}, album), h('div', { class: 'muted' }, artist),
            h('div', { class: 'tracks' }, list.map((t, i) => {
              const auto = first;
              first = false;
              const badge = h('span', {}, statusBadge(t));
              rows.set(t.id, { t, badge });
              return h('button', { class: `track ${app.music.item && app.music.item.id === t.id ? 'playing' : ''}`, onclick: () => play(list, i), 'data-autofocus': auto || null },
                h('span', { class: 'no' }, t.track || i + 1),
                h('span', { class: 'tt' }, h('div', {}, t.title), t.artist && t.artist !== artist ? h('div', { class: 'sub' }, t.artist) : null),
                badge, h('span', { class: 'dur' }, fmtTime(t.duration)));
            }))));
      }) : h('div', { class: 'empty' }, 'No music yet. Put FLAC (or any common format) in ', h('code', {}, 'media/music'),
        ', one folder per album works nicely. Each track is analyzed once in the background (about 10 s per song) so the visuals can be choreographed; until then they react live.')));
  root.appendChild(el);
  focusFirst(el);
  const unsub = app.on('analysis', (d) => {
    const r = rows.get(d.id);
    if (r) {
      r.t.analysis = d;
      r.badge.replaceChildren(statusBadge(r.t));
    }
  });
  return { unmount: unsub };
}
