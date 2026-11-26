// Music library: one grid of songs (the collection is mostly singles), or grouped by album (Songs / Albums at the
// top, remembered). Picking a song plays it and the ones after it, and opens the visualizer (or its music video).
import { h, icon, fmtTime } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { settings, setSetting } from '../core/settings.js';
import { hashString } from '../gl/math.js';
import { qualityBadge, musicVideoBadge } from '../core/quality.js';

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
  // the song grid runs in album order (artist, album, track), so the songs after the one you pick make sense as a queue
  const songs = [...albums.values()].flat();
  const rows = new Map(); // id -> { t, badge } for the view on screen
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
  const view = () => (settings.musicView === 'albums' ? 'albums' : 'songs');
  const body = h('div', {});
  const viewCtl = h('div', { class: 'seg-ctl', role: 'group', 'aria-label': 'Show' });
  const drawCtl = () => viewCtl.replaceChildren(...[['songs', 'Songs'], ['albums', 'Albums']].map(([v, label]) => h('button', {
    class: view() === v ? 'on' : '', 'aria-pressed': String(view() === v), 'data-key': `view:${v}`,
    onclick: () => {
      if (view() === v) return;
      setSetting('musicView', v);
      drawCtl();
      draw();
    },
  }, label)));
  const nowId = () => (app.music.item ? app.music.item.id : null);
  // the analysis status only when it says something (analyzing, queued, live only): "Choreographed" is the norm
  const songStatus = (t) => h('span', { class: 'st' }, t.analysis && t.analysis.status === 'ready' ? null : statusBadge(t));

  function songsView() {
    return h('div', { class: 'song-grid' }, songs.map((t, i) => {
      const badge = songStatus(t);
      rows.set(t.id, { t, badge, compact: true });
      return h('button', { class: `card song ${nowId() === t.id ? 'playing' : ''}`, onclick: () => play(songs, i), 'data-autofocus': i === 0 || null, 'data-key': `song:${t.id}` },
        h('div', { class: 'song-cover' }, coverEl(t)),
        h('div', { class: 'body' },
          h('div', { class: 'title' }, t.title),
          h('div', { class: 'meta' }, t.artist || t.album || ''),
          h('div', { class: 'song-foot' }, h('span', { class: 'badges' }, qualityBadge(t), musicVideoBadge(t), badge), h('span', { class: 'dur' }, fmtTime(t.duration)))));
    }));
  }

  function albumsView() {
    let first = true;
    return [...albums.entries()].map(([key, list]) => {
      const [artist, album] = key.split('\u0000');
      return h('div', { class: 'album' },
        coverEl(list[0]),
        h('div', {},
          h('h2', {}, album), h('div', { class: 'muted' }, artist),
          h('div', { class: 'tracks' }, list.map((t, i) => {
            const auto = first;
            first = false;
            const badge = h('span', { class: 'st' }, statusBadge(t));
            rows.set(t.id, { t, badge, compact: false });
            return h('button', { class: `track ${nowId() === t.id ? 'playing' : ''}`, onclick: () => play(list, i), 'data-autofocus': auto || null, 'data-key': `song:${t.id}` },
              h('span', { class: 'no' }, t.track || i + 1),
              h('span', { class: 'tt' }, h('div', {}, t.title), t.artist && t.artist !== artist ? h('div', { class: 'sub' }, t.artist) : null),
              h('span', { class: 'badges' }, qualityBadge(t), musicVideoBadge(t), badge),
              h('span', { class: 'dur' }, fmtTime(t.duration)));
          }))));
    });
  }

  function draw() {
    rows.clear();
    body.replaceChildren(...[view() === 'albums' ? albumsView() : songsView()].flat());
  }

  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('h1', {}, 'Music'), h('div', { class: 'spacer' }),
      tracks.length ? viewCtl : null,
      tracks.length ? h('button', { class: 'btn', onclick: () => play(songs, 0) }, icon('play'), h('span', { class: 'lbl' }, 'Play all')) : null,
      tracks.length ? h('button', { class: 'btn', onclick: () => play(shuffled(), 0) }, icon('shuffle'), h('span', { class: 'lbl' }, 'Shuffle')) : null),
    h('div', { class: 'scroll' },
      tracks.length ? body : h('div', { class: 'empty' }, 'No music yet. Put FLAC (or any common format) in ', h('code', {}, 'media/music'),
        ', one folder per album works nicely. Each track is analyzed once in the background (about 10 s per song) so the visuals can be choreographed; until then they react live. ',
        'A video with the same name as a song is its music video, shown instead of the visualizer.')));
  root.appendChild(el);
  if (tracks.length) {
    drawCtl();
    draw();
  }
  focusFirst(el);
  const unsubs = [
    app.on('analysis', (d) => {
      const r = rows.get(d.id);
      if (!r) return;
      r.t.analysis = d;
      r.badge.replaceChildren(...(r.compact && d.status === 'ready' ? [] : [statusBadge(r.t)]));
    }),
    // the song playing stays marked as the queue moves on
    app.music.on(() => {
      const id = nowId();
      for (const b of body.querySelectorAll('[data-key^="song:"]')) b.classList.toggle('playing', b.dataset.key === `song:${id}`);
    }),
  ];
  return { unmount: () => unsubs.forEach((u) => u()) };
}
