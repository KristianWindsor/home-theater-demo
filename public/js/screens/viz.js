// Full-screen visualizer for the current track, or its music video when it has one (V switches).
import { h, icon, fmtTime } from '../core/dom.js';
import { ctx } from '../core/context.js';
import { settings, setSetting } from '../core/settings.js';
import { WORLDS, WORLD_BY_ID } from '../viz/worlds/index.js';
import { rgbToCss } from '../viz/palette.js';
import { ScoreSource } from '../viz/score.js';
import { frameClock } from '../gl/resolution.js';
import { qualityBadge } from '../core/quality.js';

export function viz(root, id) {
  const app = ctx.app;
  const m = app.music;
  if (app.demo) app.stopDemo();
  app.stopExperience();
  if (id && (!m.item || m.item.id !== id)) {
    const item = app.items.get(id);
    if (item) {
      const list = app.library.items.filter((i) => i.category === item.category && i.album === item.album);
      m.playQueue(list.length ? list : [item], Math.max(0, list.indexOf(item)));
    }
  }
  if (!m.item && !id) {
    app.router.go('/music', true);
    return {};
  }
  app.setMode('viz');
  const unsubs = [];
  let idleTimer = 0, hudTimer = 0, barRaf = 0, cardTimer = 0;
  const t1 = h('div', { class: 't1' }), t2 = h('div', { class: 't2' }), t3 = h('div', { class: 't3' });
  const card = h('div', { class: 'titlecard hide' }, t1, t2, t3);
  const sections = h('div', { class: 'sections' });
  const head = h('div', { class: 'head' });
  const time = h('span', { class: 'time mono muted' });
  const playBtn = h('button', { class: 'btn btn-icon', onclick: () => m.toggle(), 'aria-label': 'Play/pause' }, icon('pause'));
  const worldBtn = h('button', { class: 'btn small', onclick: () => cycleWorld() }, icon('layers'), 'Auto');
  const hudBtn = h('button', { class: `btn btn-icon ${settings.showHud ? 'active' : ''}`, onclick: () => toggleHud(), title: 'What the analyzer sees (I)' }, icon('info'));
  const hud = h('div', { class: 'hud', style: { display: settings.showHud ? '' : 'none' } });
  const live = h('div', { class: 'live-badge', style: { display: 'none' } });
  const quality = h('span', { class: 'v-quality' });
  const bar = h('div', { class: 'v-bar' },
    sections,
    h('div', { class: 'controls' },
      h('button', { class: 'btn btn-icon', onclick: () => app.router.back(), 'aria-label': 'Back' }, icon('back')),
      h('button', { class: 'btn btn-icon', onclick: () => m.prev(), 'aria-label': 'Previous track' }, icon('prev')),
      playBtn,
      h('button', { class: 'btn btn-icon', onclick: () => m.next(), 'aria-label': 'Next track' }, icon('next')),
      time, quality, h('div', { class: 'spacer' }), worldBtn, hudBtn));
  const el = h('div', { class: 'screen vizscreen' }, card, live, hud, h('div', { class: 'v-overlay' }, bar));
  root.appendChild(el);

  const showUi = () => {
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (m.playing) {
        el.classList.add('idle');
        if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
      }
    }, 3200);
  };
  // a mouse reveals the controls by moving; a finger by tapping. A tap that only woke them doesn't also pause
  let woke = false;
  el.addEventListener('pointermove', showUi);
  el.addEventListener('pointerdown', (e) => {
    woke = e.pointerType !== 'mouse' && el.classList.contains('idle');
    showUi();
  }, true);
  el.addEventListener('click', (e) => {
    if (e.target !== el && !e.target.classList.contains('v-overlay')) return;
    if (woke) woke = false;
    else m.toggle();
  });
  showUi();

  sections.addEventListener('pointerdown', (e) => {
    const r = sections.getBoundingClientRect();
    m.seek(((e.clientX - r.left) / r.width) * m.duration);
  });

  function drawSections() {
    sections.replaceChildren();
    const d = m.duration || 1;
    const plan = app.viz().director.plan;
    if (plan && m.source instanceof ScoreSource) {
      for (const p of plan) {
        sections.appendChild(h('div', { class: 'seg', title: `${p.kind} · ${WORLD_BY_ID[p.world].label}`,
          style: { left: `${(p.start / d) * 100}%`, width: `${((p.end - p.start) / d) * 100}%`, background: rgbToCss(p.palette[1], p.kind === 'drop' ? 1 : 0.65) } }));
      }
    } else {
      sections.appendChild(h('div', { class: 'seg', style: { left: 0, width: '100%', background: 'rgba(255,255,255,0.14)' } }));
    }
    sections.appendChild(head);
  }

  function updateCard(showFor = 7000) {
    if (!m.item) return;
    const sc = m.source instanceof ScoreSource ? m.source.score : null;
    t1.textContent = m.item.title;
    t2.textContent = [m.item.artist, m.item.album].filter(Boolean).join(' · ');
    if (sc) {
      const g = sc.global;
      t3.textContent = [g.key ? `${g.key} ${g.mode}` : null, g.bpm ? `${Math.round(g.bpm)} BPM` : 'free time', `${sc.sections.length} sections`].filter(Boolean).join('  ·  ');
    } else t3.textContent = 'reacting live';
    card.classList.remove('hide');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => card.classList.add('hide'), m.videoOn ? Math.min(showFor, 4000) : showFor);
    updateLive();
  }

  // "Live · analysis queued" is about the visualizer: a music video doesn't need it
  function updateLive() {
    const a = (m.item && m.item.analysis) || {};
    if (m.source instanceof ScoreSource || m.videoOn) live.style.display = 'none';
    else {
      live.style.display = '';
      live.replaceChildren(h('span', { class: 'badge warn' }, a.status === 'analyzing' ? `Live · analyzing ${Math.round((a.progress || 0) * 100)}%` : a.status === 'failed' ? 'Live (analysis failed)' : 'Live · analysis queued'));
    }
  }

  unsubs.push(m.on((type) => {
    if (type === 'track') {
      drawSections();
      updateCard();
      quality.replaceChildren(m.item ? qualityBadge(m.item) || '' : '');
      updateWorldBtn();
    } else if (type === 'video') {
      updateWorldBtn();
      updateLive();
    } else if (type === 'score') {
      drawSections();
      updateCard(4000);
    } else if (type === 'play' || type === 'playing') playBtn.replaceChildren(icon('pause'));
    else if (type === 'pause') {
      playBtn.replaceChildren(icon('play'));
      showUi();
    } else if (type === 'end') app.router.back();
  }));
  unsubs.push(app.on('analysis', (d) => {
    if (m.item && d.id === m.item.id && !(m.source instanceof ScoreSource)) updateCard(1);
  }));
  drawSections();
  updateCard();
  quality.replaceChildren(m.item ? qualityBadge(m.item) || '' : '');
  updateWorldBtn();
  if (m.el.paused) playBtn.replaceChildren(icon('play'));

  const tick = () => {
    const d = m.duration || 1;
    head.style.left = `${(m.time / d) * 100}%`;
    time.textContent = `${fmtTime(m.time)} / ${fmtTime(d)}`;
    barRaf = requestAnimationFrame(tick);
  };
  barRaf = requestAnimationFrame(tick);

  /** What's on screen: 'video' (the song's music video), null (Auto: the choreographed visualizer) or a world id. */
  function picture() {
    return m.videoOn ? 'video' : app.viz().director.override || null;
  }

  function setPicture(id) {
    const d = app.viz().director;
    if (id === 'video') {
      d.forceWorld(null);
      m.setVideo(true);
    } else {
      if (m.mv) m.setVideo(false);
      d.forceWorld(id);
    }
    updateWorldBtn();
  }

  function cycleWorld(dir = 1) {
    const ids = [...(m.mv ? ['video'] : []), null, ...WORLDS.map((w) => w.id)];
    const i = ids.indexOf(picture());
    setPicture(ids[(i + dir + ids.length) % ids.length]);
    showUi();
  }

  function updateWorldBtn() {
    const p = picture();
    worldBtn.replaceChildren(icon(p === 'video' ? 'film' : 'layers'), p === 'video' ? 'Video' : p ? WORLD_BY_ID[p].label : 'Auto');
    worldBtn.title = m.mv
      ? 'The music video, or a visualizer world (V). Auto follows the choreography.'
      : 'Choose a world (V). Auto follows the choreography.';
  }

  function toggleHud() {
    setSetting('showHud', !settings.showHud);
    hud.style.display = settings.showHud ? '' : 'none';
    hudBtn.classList.toggle('active', settings.showHud);
  }

  const meter = (v, n = 10) => '█'.repeat(Math.round(Math.max(0, Math.min(1, v)) * n)).padEnd(n, '·');
  hudTimer = setInterval(() => {
    if (!settings.showHud) return;
    const v = app.viz();
    const f = v.frame, s = v.state;
    if (!f || !s) return;
    const plan = v.director.plan;
    const sec = plan && s.planIndex !== undefined ? plan[s.planIndex] : null;
    const lines = [
      `world    ${WORLD_BY_ID[s.a] ? WORLD_BY_ID[s.a].label : s.a}${s.b ? ` -> ${WORLD_BY_ID[s.b].label} ${(s.mix * 100).toFixed(0)}%` : ''}${v.director.override ? '  (manual)' : ''}`,
      f.hasScore ? `section  ${(s.planIndex ?? 0) + 1}/${plan ? plan.length : 0}  ${f.sectionKind || '-'}  [${String.fromCharCode(65 + (f.sectionLabel % 26))}]  ${(f.sectionT * 100).toFixed(0)}%` : 'section  (live: no lookahead)',
      f.hasBeat ? `beat     ${f.beatInBar + 1}/${f.meter}  ${f.beatPulse > 0.5 ? '●' : '○'}  ${f.bpm.toFixed(1)} BPM` : 'beat     free time',
      f.key ? `key      ${f.key} ${f.mode}` : '',
      `loud     ${meter(f.loud)}  int ${f.intensity.toFixed(2)}`,
      `bands    B ${meter(f.bands[0], 5)} M ${meter(f.bands[2], 5)} H ${meter(f.bands[3], 5)}`,
      `hits     kick ${meter(f.kick, 4)} snare ${meter(f.snare, 4)} hat ${meter(f.hat, 4)}`,
      f.hasScore ? `story    build ${f.build.toFixed(2)}  pre-drop ${f.preDrop.toFixed(2)}  drop ${f.drop.toFixed(2)}` : '',
      f.hasScore && f.nextSection ? `next     ${f.nextSection.kind} in ${f.timeToNext.toFixed(1)} s${Number.isFinite(f.nextDropIn) ? `   drop in ${f.nextDropIn.toFixed(1)} s` : ''}` : '',
      `render   ${(1000 / (app.frameInterval || 16.7)).toFixed(0)} fps  ${frameClock.last ? `${frameClock.last.w}×${frameClock.last.h} (${Math.round(frameClock.last.scale * 100)}%)` : ''}  sync ${settings.avOffsetMs} ms`,
    ].filter(Boolean);
    hud.textContent = lines.join('\n');
  }, 100);

  return {
    unmount() {
      for (const u of unsubs) u();
      clearTimeout(idleTimer);
      clearTimeout(cardTimer);
      clearInterval(hudTimer);
      cancelAnimationFrame(barRaf);
      app.setMode('room');
    },
    onKey(e) {
      showUi();
      const inControls = el.contains(document.activeElement) && document.activeElement !== document.body;
      switch (e.key) {
        case ' ': if (inControls) return false; m.toggle(); return true;
        case 'k': case 'K': case 'MediaPlayPause': m.toggle(); return true;
        case 'ArrowLeft': if (inControls) return false; m.seek(m.time - 10); return true;
        case 'ArrowRight': if (inControls) return false; m.seek(m.time + 10); return true;
        case 'ArrowUp': case 'ArrowDown': if (inControls) return false; playBtn.focus(); return true;
        case 'n': case 'N': case 'MediaTrackNext': m.next(); return true;
        case 'p': case 'P': case 'MediaTrackPrevious': m.prev(); return true;
        case 'v': case 'V': cycleWorld(e.shiftKey ? -1 : 1); return true;
        case 'a': case 'A': setPicture(m.mv ? 'video' : null); return true;
        case 'i': case 'I': toggleHud(); return true;
        case 't': case 'T': updateCard(); return true;
        default: return false;
      }
    },
  };
}
