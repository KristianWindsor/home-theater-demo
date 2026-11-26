// Full-screen experiences (#/x/<id>): title card, quiet controls (pause, chapters, restart, a seekable timeline),
// a live speaker map, end card.
import { h, icon } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { EXPERIENCE_BY_ID } from '../experiences/index.js';
import { showTransport, showKey } from './transport.js';

export function experience(root, id) {
  const app = ctx.app;
  const def = EXPERIENCE_BY_ID[id];
  if (!def || def.kind !== 'stage') {
    app.router.go('/demos', true);
    return {};
  }
  let run = app.experience && app.experience.id === id ? app.experience : null;
  app.setMode('stage');
  const unsubs = [];
  let idleTimer = 0, raf = 0;

  const loadBar = h('div', { class: 'xp-load-fill' });
  const loadText = h('div', { class: 'xp-load-text' }, 'Composing');
  const load = h('div', { class: 'xp-load' }, h('div', { class: 'xp-load-track' }, loadBar), loadText);
  const title = h('div', { class: 'xp-title' }, h('div', { class: 'xp-orig' }, 'A KW5.1 Original'), h('div', { class: 'xp-t1' }, def.title), h('div', { class: 'xp-t2' }, def.tagline), load,
    h('div', { class: 'xp-rotate' }, 'Turn your phone sideways for the full picture'));
  const tp = showTransport();
  const map = speakerMap(app);
  const layout = h('span', { class: 'badge' });
  const controls = h('div', { class: 'xp-controls' },
    h('div', { class: 'xp-row' },
      h('button', { class: 'btn btn-icon', onclick: () => leave(), 'aria-label': 'Stop', 'data-autofocus': true }, icon('back')),
      h('div', { class: 'xp-name' }, h('div', {}, def.title), tp.chapter),
      h('div', { class: 'spacer' }), h('div', { class: 'xp-transport' }, ...tp.buttons), layout, tp.time),
    tp.bar);
  const endCard = h('div', { class: 'end-card', style: { display: 'none' } },
    h('div', { class: 'box' },
      h('h2', {}, def.title),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', onclick: () => replay() }, icon('refresh'), 'Play again'),
        h('button', { class: 'btn', onclick: () => replayLast() }, icon('prev'), 'Last chapter'),
        h('button', { class: 'btn', onclick: () => leave() }, icon('back'), 'Back'))));
  const el = h('div', { class: 'screen xp' }, title, h('div', { class: 'xp-map' }, map.el), controls, endCard);
  root.appendChild(el);

  const showUi = () => {
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (run && run.state === 'playing') {
        el.classList.add('idle');
        if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
      }
    }, 2600);
  };
  // a mouse reveals the controls by moving; a finger by tapping anywhere (hidden controls ignore that tap)
  el.addEventListener('pointermove', showUi);
  el.addEventListener('pointerdown', showUi, true);
  showUi();

  function leave() {
    if (app.experience === run) app.stopExperience();
    app.router.back('/demos');
  }

  // the audio is kept, so playing again (or the last chapter again) starts at once
  function replay() {
    endCard.style.display = 'none';
    if (run && run.state === 'ended') run.restart();
    else app.runExperience(id).then((r) => attach(r));
  }

  function replayLast() {
    endCard.style.display = 'none';
    if (run && run.state === 'ended' && run.chapters.length) run.seek(run.chapters[run.chapters.length - 1].t, true);
    else replay();
  }

  function attach(r) {
    run = r;
    if (!run) return;
    title.classList.remove('hide');
    load.style.display = '';
    unsubs.push(run.on('progress', (p) => {
      loadBar.style.width = `${Math.round(p * 100)}%`;
      loadText.textContent = `Composing the sound for your ${app.engine.layoutName} speakers  ${Math.round(p * 100)}%`;
    }));
    tp.attach(run);
    let started = false;
    unsubs.push(run.on('state', (st) => {
      if (st === 'playing' && !started) {
        started = true;
        load.style.display = 'none';
        setTimeout(() => title.classList.add('hide'), 5200);
        layout.textContent = app.engine.channels >= 6 ? app.engine.layoutName : `${app.engine.layoutName} (folded down)`;
        tp.drawMarks();
        showUi();
      } else if (st === 'playing' || st === 'paused' || st === 'seeking') {
        endCard.style.display = 'none';
        showUi();
      } else if (st === 'ended') {
        if (run.showcase) return; // the showcase moves on by itself
        endCard.style.display = '';
        el.classList.remove('idle');
        const b = endCard.querySelector('button');
        if (b) b.focus();
      } else if (st === 'error') {
        loadText.textContent = `Could not start: ${run.error}`;
      }
    }));
    loadText.textContent = `Composing the sound for your ${app.engine.ready ? app.engine.layoutName : ''} speakers`;
  }

  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!run) return;
    tp.update();
    if (!el.classList.contains('idle')) map.update();
  };
  raf = requestAnimationFrame(tick);

  if (run) attach(run);
  else app.runExperience(id).then((r) => attach(r));

  return {
    unmount() {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      for (const u of unsubs) u();
      if (run && app.experience === run) app.stopExperience();
      app.setMode('room');
    },
    onKey(e) {
      showUi();
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.key === 'GoBack') {
        leave();
        return true;
      }
      const inControls = controls.contains(document.activeElement) || endCard.contains(document.activeElement);
      return showKey(run, e, inControls);
    },
  };
}

/** Top-down map of the real room: speakers light up with their output level, Hue lights show their colour. */
export function speakerMap(app) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-60 -60 120 120');
  svg.setAttribute('class', 'speaker-map');
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    svg.appendChild(e);
    return e;
  };
  const room = app.room;
  const scale = 13;
  const items = [];
  const b = room.bounds;
  mk('rect', { x: (-b.W / 2) * scale, y: b.front * scale, width: b.W * scale, height: (b.back - b.front) * scale, rx: 4,
    fill: 'rgba(255,255,255,0.02)', stroke: 'rgba(255,255,255,0.14)' });
  mk('rect', { x: (-room.tv.w / 2) * scale, y: room.tv.z * scale, width: room.tv.w * scale, height: 2.2, rx: 1, fill: 'rgba(255,255,255,0.4)' });
  mk('rect', { x: -10, y: 0, width: 20, height: 8, rx: 2.5, fill: 'rgba(255,255,255,0.14)' }); // couch
  for (const f of app.rig.fixtures) {
    const p = f.pos;
    const c = mk('circle', { cx: (p[0] * scale).toFixed(1), cy: (p[2] * scale).toFixed(1), r: 7, fill: '#000', opacity: 0.9 });
    items.push({ kind: 'hue', el: c, f });
  }
  for (const id in room.speakers) {
    const sp = room.speakers[id];
    const x = sp.pos[0] * scale, y = sp.pos[2] * scale;
    const sub = sp.type === 'subwoofer';
    const w = sub ? 9 : sp.type === 'center' ? 12 : 5, hh = sub ? 9 : 5;
    const r = mk('rect', { x: (x - w / 2).toFixed(1), y: (y - hh / 2).toFixed(1), width: w, height: hh, rx: 1.2,
      fill: 'rgba(255,255,255,0.18)', stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 0.5 });
    items.push({ kind: 'spk', el: r, role: sp.role });
  }
  mk('circle', { cx: 0, cy: 0, r: 1.6, fill: 'rgba(255,255,255,0.6)' });
  return {
    el: svg,
    update() {
      const eng = app.engine;
      if (eng.ready) eng.levels();
      for (const it of items) {
        if (it.kind === 'spk') {
          const v = eng.ready ? Math.min(1, eng.levelOf(it.role) * 5) : 0;
          it.el.setAttribute('fill', `rgba(${Math.round(150 + 105 * v)},${Math.round(190 + 40 * v)},255,${(0.15 + 0.85 * v).toFixed(2)})`);
        } else {
          const c = it.f.color || [0, 0, 0];
          const m = Math.max(c[0], c[1], c[2], 1e-3);
          const k = Math.min(1, m * 1.6);
          it.el.setAttribute('fill', `rgb(${Math.round((c[0] / m) * 255 * k)},${Math.round((c[1] / m) * 255 * k)},${Math.round((c[2] / m) * 255 * k)})`);
          it.el.setAttribute('opacity', (0.25 + 0.6 * k).toFixed(2));
        }
      }
    },
  };
}
