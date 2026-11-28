// Home: the 3D theater. Click the TV to play the showcase, speakers to hear them alone, the couch to sit. The
// pages are a row below (Sound Check first); Settings is the gear in the corner, beside what
// the speakers are getting. Room shows play here, with their transport in a pill at the top and their speaker
// callouts over the speakers; the music's transport is the Now Playing bar (core/nowplaying.js).
import { h, icon, TOUCH_ONLY } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { focusFirst } from '../core/nav.js';
import { settings } from '../core/settings.js';
import { showTransport, showKey } from './transport.js';
import { showcaseProgram, aboutLength } from '../core/showcase.js';

export function home(root) {
  const app = ctx.app;
  app.setMode('room');
  if (!app.room.preset || app.room.preset === 'tv') app.room.goTo('overview', 1.4);
  const unsubs = [];
  const tag = h('div', { class: 'room-tag', style: { opacity: 0 } });
  const banner = h('div', { class: 'demo-banner', style: { display: 'none' } });
  const go = (path) => () => app.router.go(path);
  const dockItem = (path, ic, label, auto) => h('button', { class: 'dock-item', onclick: go(path), 'data-autofocus': auto || null, 'data-key': `dock:${path}` },
    icon(ic), h('span', {}, label));
  // the sound check comes first: it's what you do first
  const dock = h('nav', { class: 'dock', 'aria-label': 'Explore' },
    dockItem('/soundcheck', 'volume', 'Sound Check', true),
    dockItem('/trailers', 'ticket', 'Cinema Demos'),
    dockItem('/movies', 'film', 'Movie Scenes'),
    dockItem('/music', 'music', 'Music'),
  );
  // top right: what the speakers are getting (and the way to set them up), and Settings
  const outChip = h('button', { class: 'out-chip', onclick: go('/settings?panel=speakers'), 'data-key': 'home:output', title: 'Speaker setup' });
  const drawOut = () => {
    const eng = app.engine;
    // a phone or tablet can't be set up for 5.1, so it isn't asked to
    const ok = eng.ready && (eng.channels >= 6 || TOUCH_ONLY);
    const text = !eng.ready ? 'Sound off' : ok ? `${eng.layoutName} output` : `${eng.layoutName} · set up 5.1`;
    outChip.classList.toggle('warn', !ok);
    outChip.setAttribute('aria-label', `${text} · speaker setup`);
    outChip.replaceChildren(icon('surround'), h('span', {}, text));
  };
  drawOut();
  const corner = h('div', { class: 'home-corner' }, outChip,
    h('button', { class: 'btn btn-icon gear', onclick: go('/settings'), 'aria-label': 'Settings', 'data-key': 'dock:/settings' }, icon('settings')));
  const xpPill = h('div', { class: 'xp-pill' });
  const calloutLayer = h('div', { class: 'callouts' });
  const el = h('div', { class: 'screen home' },
    h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, 'KW5.1'),
      h('div', { class: 'room-name' }, 'A Windsor home theater showcase')),
    corner,
    h('div', { class: 'room-hint' }, TOUCH_ONLY
      ? ['Tap the TV to play the showcase', h('br'), 'Tap a speaker to hear it alone · the couch to sit']
      : ['Click the TV to play the showcase', h('br'), 'Click a speaker to hear it alone · the couch to sit', h('br'), 'Drag to look around']),
    tag, calloutLayer, banner, dock, xpPill,
  );
  root.appendChild(el);
  focusFirst(el);
  const calloutEls = new Map(); // a room show's speaker callouts on screen: callout -> its element (see drawCallouts)
  const clearCallouts = () => {
    for (const e of calloutEls.values()) e.remove();
    calloutEls.clear();
  };

  // room experiences ("Awakening") take over this screen: the interface fades out and back in on cue. Their
  // transport (pause, chapters, restart, a seekable timeline) is a pill that shows when the mouse moves or a key is
  // pressed, and stays while the show is paused or the pill has focus
  let xpUnsub = [];
  let pillTimer = 0;
  let tp = null, tpRaf = 0;
  const immersive = (on) => {
    el.classList.toggle('immersive', on);
    dock.inert = on; // hidden, so out of reach of the arrow keys too
    corner.inert = on;
  };
  const showPill = () => {
    const run = app.experience;
    if (!run || run.kind !== 'room' || app.showcase.active) return; // in the showcase its own chip does this
    xpPill.classList.add('on');
    clearTimeout(pillTimer);
    const hide = () => {
      if (run.state === 'paused' || run.state === 'seeking' || xpPill.contains(document.activeElement)) pillTimer = setTimeout(hide, 1500);
      else xpPill.classList.remove('on');
    };
    pillTimer = setTimeout(hide, 2600);
  };
  const bindXp = (run) => {
    for (const u of xpUnsub) u();
    xpUnsub = [];
    cancelAnimationFrame(tpRaf);
    if (!run || run.kind !== 'room') {
      immersive(false);
      xpPill.classList.remove('on');
      clearCallouts();
      tp = null;
      return;
    }
    tp = showTransport();
    xpPill.replaceChildren(
      h('div', { class: 'xp-pill-row' },
        h('div', { class: 'xp-name' }, h('div', { class: 'title' }, run.def.title), tp.chapter),
        h('div', { class: 'xp-transport' }, ...tp.buttons),
        h('button', { class: 'btn small', onclick: () => app.finishExperience(), 'data-key': 'xp:stop' }, icon('close'), 'Stop')),
      h('div', { class: 'xp-pill-bar' }, tp.bar, tp.time));
    tp.attach(run);
    const tick = () => {
      tpRaf = requestAnimationFrame(tick);
      if (xpPill.classList.contains('on') && tp) tp.update();
    };
    tick();
    xpUnsub.push(run.on('chrome', (visible) => immersive(!visible)));
    xpUnsub.push(run.on('state', (st) => {
      if (st === 'playing' && tp) tp.drawMarks();
      if (st === 'paused') showPill();
    }));
    if (run.chromeHidden) immersive(true);
  };
  unsubs.push(app.on('experience', bindXp));
  bindXp(app.experience);
  for (const ev of ['pointermove', 'pointerdown']) document.addEventListener(ev, showPill, true);
  unsubs.push(() => {
    for (const u of xpUnsub) u();
    cancelAnimationFrame(tpRaf);
    clearTimeout(pillTimer);
    for (const ev of ['pointermove', 'pointerdown']) document.removeEventListener(ev, showPill, true);
  });

  // a room show's callouts (Awakening names each speaker as it comes in): a label over that speaker on the show's
  // clock, so a pause holds it and a jump back shows it again. They stay up while the rest of the interface is hidden.
  const drawCallouts = (room) => {
    const run = app.experience;
    const list = run && run.kind === 'room' && run.score ? run.score.callouts : null;
    const t = run ? run.t || 0 : 0;
    const live = new Set();
    if (list && list.length && settings.roomLabels) {
      for (const c of list) {
        if (t < c.t || t >= c.t + c.dur) continue;
        const id = room.idForRole(c.role);
        const a0 = id && anchor(id);
        if (!a0) continue;
        // above where the show's marbles bounce (the sub's ball goes higher)
        const a = [a0[0], a0[1] + (c.role === 'LFE' ? 1.0 : 0.5), a0[2]];
        live.add(c);
        let box = calloutEls.get(c);
        if (!box) {
          // on a stereo output the surrounds, the center and the sub are simulated: say so, it's a sound check
          const virt = app.engine.ready && app.engine.channelOf(c.role) < 0;
          box = h('div', { class: 'room-callout' }, h('span', { class: 'name' }, room.speakers[id].label),
            h('span', { class: 'sub' }, virt ? `${c.text} · simulated on ${app.engine.layoutName}` : c.text));
          calloutLayer.appendChild(box);
          calloutEls.set(c, box);
        }
        const p = room.project(a, window.innerWidth, window.innerHeight);
        box.style.left = `${p.x}px`;
        box.style.top = `${p.y}px`;
        box.style.opacity = p.visible ? Math.max(0, Math.min(1, (t - c.t) / 0.25, (c.t + c.dur - t) / 0.4)) : 0;
      }
    }
    for (const [c, box] of calloutEls) {
      if (live.has(c)) continue;
      box.remove();
      calloutEls.delete(c);
    }
  };
  unsubs.push(app.on('roomframe', drawCallouts));

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
    if (p.id === 'tv') {
      if (app.showcase.active) return null; // it's playing already
      const prog = showcaseProgram(app);
      return [p.label || 'TV', `${prog.title} · ${aboutLength(prog.length)}`];
    }
    if (p.id === 'couch') return ['Couch', app.room.preset === 'couch' ? 'Stand up' : 'Sit down'];
    return [p.label || p.id, ''];
  };
  unsubs.push(app.on('hover', (p) => {
    const text = p && labelFor(p);
    if (text) {
      tagFor = p.id;
      tagText = text;
      tagUntil = Infinity;
    } else if (tagUntil === Infinity) tagUntil = performance.now() + 300;
  }));
  // clicking the TV starts the showcase with the pointer still on it: its label goes then
  unsubs.push(app.on('showcase', (on) => {
    if (on && tagFor === 'tv') tagUntil = 0;
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
  banner.append(bTitle, bStatus,
    h('button', { class: 'btn small', onclick: () => app.demo && app.runDemo(app.demo.def.id), title: 'From the start', 'data-key': 'demo:restart' }, icon('refresh'), 'Restart'),
    h('button', { class: 'btn small', onclick: () => app.finishDemo(), 'data-key': 'demo:stop' }, icon('close'), 'Stop'));
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

  const order = ['fl', 'c', 'fr', 'sr', 'sl', 'sub'];
  return {
    unmount() {
      for (const u of unsubs) u();
      app.hover = null;
      if (app.experience && app.experience.kind === 'room') app.stopExperience();
      if (app.demo) app.stopDemo();
    },
    onKey(e) {
      const run = app.experience;
      if (run && run.kind === 'room') {
        showPill();
        if (e.key === 'Escape' || e.key === 'Backspace') {
          app.finishExperience();
          return true;
        }
        // arrow keys move between the pill's buttons once one has focus; before that, up/down give it focus
        const inPill = xpPill.contains(document.activeElement);
        if (!inPill && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && tp) {
          tp.playBtn.focus();
          return true;
        }
        return showKey(run, e, inPill);
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
        app.finishDemo();
        return true;
      }
      return false;
    },
  };
}
