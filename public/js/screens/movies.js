// Movies grid, movie detail (scenes, chapters, compatibility) and the scene editor.
import { h, icon, fmtTime, fmtTimePrecise, parseTime, fmtBytes, toast } from '../core/dom.js';
import { api } from '../core/api.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { checkVideo, prettyCodec, channelsLabel, defaultAudio } from '../core/compat.js';

export function resLabel(v) {
  if (!v) return '';
  const w = v.width || 0, ht = v.height || 0;
  if (w >= 3800 || ht >= 2100) return '4K';
  if (w >= 2500) return '1440p';
  if (w >= 1900 || ht >= 1070) return '1080p';
  if (w >= 1270) return '720p';
  return `${ht}p`;
}

export function badges(item) {
  const p = item.probe || {};
  const out = [];
  if (p.video) out.push(h('span', { class: 'badge' }, resLabel(p.video)));
  if (p.video && p.video.hdr) out.push(h('span', { class: 'badge gold' }, p.video.hdr));
  const a = defaultAudio(p);
  if (a) out.push(h('span', { class: 'badge' }, `${prettyCodec(a.codec, a.profile)} ${channelsLabel(a)}`));
  const c = checkVideo(item);
  if (c.level !== 'ok') out.push(h('span', { class: `badge ${c.level}` }, icon('warn'), c.level === 'bad' ? 'Won’t play here' : 'Needs prep'));
  return out;
}

function topbar(title, ...right) {
  const app = ctx.app;
  return h('div', { class: 'topbar' },
    h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
    h('h1', {}, title), h('div', { class: 'spacer' }), ...right);
}

export function videoCard(item, onclick, auto = false) {
  return h('button', { class: 'card', onclick, 'data-autofocus': auto || null },
    h('div', { class: 'thumb' },
      h('img', { src: `${item.poster}?w=640`, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.opacity = 0; } }),
      h('div', { class: 'badges' }, badges(item))),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, item.title),
      h('div', { class: 'meta' }, [item.year, fmtTime(item.duration), item.scenes && item.scenes.length ? `${item.scenes.length} scenes` : null].filter(Boolean).join(' · '))));
}

// A frame a little way into the scene: the first second or two is often a black transition.
function sceneThumbTime(s) {
  const len = s.end !== null ? s.end - s.start : 60;
  return s.start + Math.min(20, Math.max(1.5, len * 0.25));
}

/** One scene as a tile: click to play just that scene. */
function sceneTile(item, s, i, { showMovie = false, autofocus = false } = {}) {
  const app = ctx.app;
  const has = s.start !== null;
  const long = item.duration >= 3600;
  return h('button', {
    class: 'card scene',
    'data-autofocus': autofocus || null,
    onclick: () => (has ? app.router.go(`/play/${item.id}?scene=${i}`) : toast('This scene has no start time yet. Set one in Edit scenes or with B in the player.', 'warn')),
  },
  h('div', { class: 'thumb' },
    has ? h('img', { src: api.thumb(item.id, sceneThumbTime(s), 640), alt: '', loading: 'lazy' }) : null,
    s.star ? h('span', { class: 'star' }, icon('starFill')) : null,
    h('span', { class: 'badge time' }, has ? `${fmtTime(s.start, long)}${s.end ? ` – ${fmtTime(s.end, long)}` : ''}` : 'no time yet')),
  h('div', { class: 'body' },
    h('div', { class: 'title' }, s.title),
    showMovie ? h('div', { class: 'meta' }, item.title) : null,
    s.note ? h('div', { class: 'note' }, s.note) : null));
}

export function movies(root) {
  const app = ctx.app;
  app.setMode('room');
  app.room.goTo('couch', 1.6);
  const vids = app.library.items.filter((i) => i.category === 'movies');
  // Every starred scene, from every film, as its own tile
  const starred = app.library.items.filter((i) => i.kind === 'video')
    .flatMap((v) => (v.scenes || []).map((s, i) => ({ v, s, i })))
    .filter(({ s }) => s.star && s.start !== null);
  const el = h('div', { class: 'screen scrim' },
    topbar('Movies'),
    h('div', { class: 'scroll' },
      starred.length ? [
        h('div', { class: 'section-title' }, 'Scenes'),
        h('div', { class: 'scene-list' }, starred.map(({ v, s, i }, n) => sceneTile(v, s, i, { showMovie: true, autofocus: n === 0 }))),
      ] : null,
      h('div', { class: 'section-title' }, 'Movies'),
      vids.length
        ? h('div', { class: 'grid' }, vids.map((v, i) => videoCard(v, () => app.router.go(`/movie/${v.id}`), !starred.length && i === 0)))
        : h('div', { class: 'empty' }, 'No movies yet. Put video files in ', h('code', {}, 'media/movies'),
          '. MKV and MP4 work; run ', h('code', {}, 'scripts/prepare_media.py'), ' on Blu-ray rips so their audio plays in a browser.')));
  root.appendChild(el);
  focusFirst(el);
  return {};
}

// ------------------------------------------------------------------ detail
export function movie(root, id) {
  const app = ctx.app;
  app.setMode('room');
  let item = app.items.get(id);
  if (!item) {
    root.appendChild(h('div', { class: 'screen scrim' }, topbar('Not found'), h('div', { class: 'scroll' }, h('div', { class: 'empty' }, 'That file is no longer in the library.'))));
    return {};
  }
  let editing = false;
  const el = h('div', { class: 'screen scrim' });
  root.appendChild(el);
  const unsub = app.on('library', () => {
    const fresh = app.items.get(id);
    if (fresh && !editing) {
      item = fresh;
      render();
    }
  });

  function render() {
    const p = item.probe || {};
    const c = checkVideo(item);
    const scenes = item.scenes || [];
    const playable = scenes.filter((s) => s.start !== null);
    const v = p.video;
    el.replaceChildren(
      topbar(item.category === 'demos' ? 'Demo' : 'Movie'),
      h('div', { class: 'scroll' },
        h('div', { class: 'hero' },
          h('div', { class: 'hero-bg', style: { backgroundImage: `url("${api.thumb(item.id, item.duration * 0.3, 1280)}")` } }),
          h('div', { class: 'hero-info' },
            h('h2', { class: 'hero-title' }, item.title),
            h('div', { class: 'hero-meta' }, [item.year, fmtTime(item.duration), fmtBytes(item.size),
              v ? `${prettyCodec(v.codec)} ${v.width}×${v.height}${v.fps ? ` ${Math.round(v.fps * 100) / 100} fps` : ''}${v.bitDepth > 8 ? ` ${v.bitDepth}-bit` : ''}` : null].filter(Boolean).join(' · ')),
            h('div', { class: 'chips' }, badges(item)),
            item.description ? h('div', { class: 'muted' }, item.description) : null,
            h('div', { class: 'hero-actions' },
              h('button', { class: 'btn btn-primary', onclick: () => app.router.go(`/play/${item.id}?t=0`), 'data-autofocus': true }, icon('play'), 'Play'),
              playable.length ? h('button', { class: 'btn', onclick: () => app.router.go(`/play/${item.id}?scenes=all`) }, icon('layers'), `Play all ${playable.length} scenes`) : null,
              app.library.server && app.library.server.sceneEdits !== false
                ? h('button', { class: 'btn', onclick: () => { editing = !editing; render(); } }, icon('edit'), editing ? 'Done editing' : 'Edit scenes') : null),
            c.messages.length ? h('div', { class: `notice ${c.level === 'ok' ? 'ok' : ''}` }, icon(c.level === 'ok' ? 'info' : 'warn'), h('div', {}, c.messages.map((m) => h('div', {}, m)))) : null,
            p.audio && p.audio.length > 1 ? h('div', { class: 'dim' }, `Audio tracks: ${p.audio.map((a, i) => `${i + 1}. ${prettyCodec(a.codec, a.profile)} ${channelsLabel(a)}${a.lang ? ` ${a.lang}` : ''}${a.default ? ' (default)' : ''}`).join('   ')}`) : null)),
        editing ? editor() : null,
        !editing ? [
          h('div', { class: 'section-title' }, 'Scenes'),
          scenes.length
            ? h('div', { class: 'scene-list' }, scenes.map((s, i) => sceneTile(item, s, i)))
            : h('div', { class: 'empty' }, 'No scenes yet. Use ', h('b', {}, 'Edit scenes'), ' here, or press ', h('b', {}, 'B'),
              ' while watching to bookmark the current moment as a scene and ', h('b', {}, 'E'), ' to mark where it ends.'),
          p.chapters && p.chapters.length ? [
            h('div', { class: 'section-title' }, 'Chapters (from the file)'),
            h('div', { class: 'chapters' }, p.chapters.map((ch) => h('button', { class: 'chapter', onclick: () => app.router.go(`/play/${item.id}?t=${ch.start}`) },
              h('span', { class: 't' }, fmtTime(ch.start, item.duration >= 3600)), h('span', {}, ch.title)))),
          ] : null,
        ] : null));
    focusFirst(el);
  }

  function editor() {
    const rows = (item.scenes || []).map((s) => ({ ...s }));
    const list = h('div', { class: 'editor' });
    const drawRows = () => {
      list.replaceChildren(...rows.map((r, i) => {
        const timeInput = (key) => h('input', {
          class: 'input mono', value: r[key] === null || r[key] === undefined ? '' : fmtTimePrecise(r[key]), placeholder: key === 'start' ? 'h:mm:ss' : 'end (optional)',
          oninput: (e) => {
            const t = parseTime(e.target.value);
            e.target.classList.toggle('invalid', Number.isNaN(t));
            if (!Number.isNaN(t)) r[key] = t;
          },
        });
        return h('div', { class: 'edit-row' },
          h('div', { class: 'n' }, i + 1),
          h('input', { class: 'input', value: r.title, oninput: (e) => { r.title = e.target.value; } }),
          timeInput('start'), timeInput('end'),
          h('button', { class: `btn btn-icon ${r.star ? 'active' : ''}`, title: 'Star (shows it under Scenes on the Movies page)', onclick: (e) => { r.star = !r.star; e.currentTarget.classList.toggle('active', r.star); } }, icon(r.star ? 'starFill' : 'star')),
          h('button', { class: 'btn btn-icon', title: 'Delete', onclick: () => { rows.splice(i, 1); drawRows(); } }, icon('trash')));
      }));
    };
    drawRows();
    const save = async () => {
      rows.sort((a, b) => (a.start ?? 1e12) - (b.start ?? 1e12));
      try {
        const res = await api.saveScenes(item.id, rows);
        item.scenes = res.scenes;
        editing = false;
        toast('Scenes saved.');
        render();
      } catch (e) {
        toast(`Couldn’t save: ${e.message}`, 'bad');
      }
    };
    return h('div', {},
      h('div', { class: 'section-title' }, 'Edit scenes'),
      h('div', { class: 'help' }, 'Times look like 1:23:45 (or 83:45, or seconds). The end is optional: without it a scene plays to the end of the film. ',
        'Tip: in the player, press B to add a scene at the current moment and E to set its end.'),
      list,
      h('div', { class: 'row', style: { marginTop: '0.8rem' } },
        h('button', { class: 'btn', onclick: () => { rows.push({ title: `Scene ${rows.length + 1}`, start: null, end: null, star: false }); drawRows(); } }, icon('plus'), 'Add scene'),
        h('button', { class: 'btn btn-primary', onclick: save }, icon('check'), 'Save'),
        h('button', { class: 'btn', onclick: () => { editing = false; render(); } }, 'Cancel'),
        item.scenesEdited ? h('button', { class: 'btn btn-ghost', onclick: async () => { const r = await api.resetScenes(item.id); item.scenes = r.scenes; item.scenesEdited = false; editing = false; render(); } }, 'Revert to catalog') : null));
  }

  render();
  return { unmount: unsub };
}
