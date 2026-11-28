// Sound Check: is every speaker playing, and from the right place? Awakening leads (the whole check, as music: a
// marble bounces on each speaker for every note it plays, and each is named as it comes in), then the quick tests
// (Channel Check, the Subwoofer Sweep, Orbit), each saying what it checks. Everything plays in the room, with each
// speaker lit as it sounds. Each card has a still (public/img/shows/<id>.jpg). Your own clips from media/demos follow.
import { h, icon, fmtTime, TOUCH_ONLY } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { BUILTIN_DEMOS } from '../audio/demos.js';
import { EXPERIENCES } from '../experiences/index.js';
import { videoCard } from './movies.js';

const ICONS = { 'channel-check': 'surround', 'lfe-sweep': 'sub', orbit: 'orbit' };
const LEAD = 'room-wakes-up';

function still(id, ic, duration) {
  const fallback = () => h('div', { class: 'still-fallback' }, icon(ic));
  return h('div', { class: 'thumb' },
    h('img', { src: `/img/shows/${id}.jpg`, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(fallback()) }),
    h('span', { class: 'badge time' }, fmtTime(duration)));
}

/** A test as a card: its still and length, then what it checks, its name, and what to listen for. */
function testCard({ id, ic, title, check, line, duration, run }) {
  return h('button', { class: 'card show-card', onclick: run, 'data-key': `show:${id}` },
    still(id, ic, duration),
    h('div', { class: 'body' },
      h('div', { class: 'kicker' }, check),
      h('div', { class: 'title' }, title),
      h('div', { class: 'line' }, line)));
}

/** The lead check, wide: start here. */
function leadCard({ id, ic, title, check, line, duration, run }) {
  return h('button', { class: 'card show-card sc-lead', onclick: run, 'data-autofocus': true, 'data-key': `show:${id}` },
    still(id, ic, duration),
    h('div', { class: 'body' },
      h('div', { class: 'kicker' }, `Start here · ${check}`),
      h('div', { class: 'title' }, title),
      h('div', { class: 'line' }, line),
      h('span', { class: 'btn btn-primary sc-go', 'aria-hidden': 'true' }, icon('play'), 'Run the sound check')));
}

/** What the browser is sending the receiver: every channel on its own speaker, or the surrounds simulated. */
function outputStatus(app) {
  const eng = app.engine;
  if (!eng.ready) return null;
  if (eng.channels >= 6) {
    return h('div', { class: 'sc-output ok' }, icon('check'),
      h('span', {}, h('b', {}, `${eng.layoutName} output.`), ' Every speaker gets its own channel.'));
  }
  return h('div', { class: 'sc-output warn' }, icon('warn'),
    h('span', {}, h('b', {}, `${eng.layoutName} output.`), ' The surrounds and the sub are simulated in the speakers you have.'),
    // a phone or tablet can't be set up for 5.1, so it isn't asked to
    TOUCH_ONLY ? null : h('button', { class: 'btn small', onclick: () => app.router.go('/settings?panel=speakers'), 'data-key': 'sc:setup' }, 'Set up 5.1'));
}

const section = (title, sub) => h('div', { class: 'section-head' }, h('div', { class: 'section-title' }, title), sub ? h('div', { class: 'section-sub' }, sub) : null);

export function soundCheck(root) {
  const app = ctx.app;
  app.setMode('room');
  app.room.goTo('overview', 1.4);
  const files = app.library.items.filter((i) => i.category === 'demos');
  const vids = files.filter((i) => i.kind === 'video');
  const auds = files.filter((i) => i.kind === 'audio');
  const pieces = EXPERIENCES.filter((x) => !x.hidden).map((x) => ({ id: x.id, ic: `xp-${x.id}`, title: x.title, check: x.check, line: x.listen || x.tagline,
    duration: x.duration, run: () => app.runExperience(x.id) }));
  const builtins = BUILTIN_DEMOS.map((d) => ({ id: d.id, ic: ICONS[d.id] || 'bolt', title: d.title, check: d.check, line: d.blurb,
    duration: d.duration, run: () => app.runDemo(d.id) }));
  const lead = pieces.find((p) => p.id === LEAD);
  const tests = [...builtins, ...pieces.filter((p) => p !== lead)];
  const el = h('div', { class: 'screen scrim' },
    h('div', { class: 'topbar' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('h1', {}, 'Sound Check'), h('div', { class: 'spacer' })),
    h('div', { class: 'scroll' },
      h('div', { class: 'page-intro' }, 'Make sure every speaker is playing, and playing from the right place, before the movie. Everything here plays in the room, with each speaker lit up as it sounds.'),
      outputStatus(app),
      lead ? leadCard(lead) : null,
      tests.length ? [section('Quick tests'), h('div', { class: 'show-grid' }, tests.map((d) => testCard(d)))] : null,
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
      ] : null,
      h('div', { class: 'sc-foot' },
        h('span', {}, 'Something too loud, too quiet or out of sync?'),
        h('button', { class: 'btn small', onclick: () => app.router.go('/settings?panel=speakers'), 'data-key': 'sc:settings' }, icon('sliders'), 'Levels & lip sync'))));
  root.appendChild(el);
  focusFirst(el);
  return {};
}
