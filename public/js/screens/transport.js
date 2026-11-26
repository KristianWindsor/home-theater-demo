// Transport for the composed shows: previous chapter, play/pause, next chapter, restart, and a timeline with the
// chapters marked that you can click or drag along (a click near a mark lands on that chapter's start).
// Used by the full-screen shows (screens/experience.js) and by the room shows' pill on the home screen.
import { h, icon, fmtTime } from '../core/dom.js';

export function showTransport() {
  let run = null;
  let drag = null; // { t } while dragging along the bar: the picture and sound jump on release
  const playBtn = h('button', { class: 'btn btn-icon', 'aria-label': 'Pause (Space)', onclick: () => run && run.toggle() }, icon('pause'));
  const prevBtn = h('button', { class: 'btn btn-icon', 'aria-label': 'Previous chapter', title: 'Previous chapter (←)', onclick: () => run && run.jumpChapter(-1) }, icon('prev'));
  const nextBtn = h('button', { class: 'btn btn-icon', 'aria-label': 'Next chapter', title: 'Next chapter (→)', onclick: () => run && run.jumpChapter(1) }, icon('next'));
  const restartBtn = h('button', { class: 'btn btn-icon', 'aria-label': 'Play from the start', title: 'From the start (R)', onclick: () => run && run.restart() }, icon('refresh'));
  const fill = h('div', { class: 'fill' });
  const hover = h('div', { class: 'xp-hover' });
  const bar = h('div', { class: 'timeline xp-bar' }, fill, hover);
  const time = h('span', { class: 'xp-time mono' });
  const chapter = h('div', { class: 'xp-chapter' });
  let state = '';

  const duration = () => (run && run.duration) || 1;
  // the time under a pointer x, snapped to a chapter start when it's within a few pixels of its mark
  const timeAt = (clientX) => {
    const r = bar.getBoundingClientRect();
    let t = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration();
    for (const c of run ? run.chapters : []) if (Math.abs((c.t / duration()) * r.width - (clientX - r.left)) < 9) t = c.t;
    return t;
  };
  const chapterName = (t) => {
    if (!run || !run.chapters.length) return '';
    return run.chapters[run.chapterAt(t)].title;
  };
  const showHover = (clientX) => {
    const t = timeAt(clientX);
    const r = bar.getBoundingClientRect();
    hover.textContent = `${chapterName(t)} · ${fmtTime(t)}`;
    hover.style.left = `${Math.max(0, Math.min(r.width, clientX - r.left))}px`;
    hover.classList.add('on');
  };
  bar.addEventListener('pointermove', (e) => {
    showHover(e.clientX);
    if (drag) drag.t = timeAt(e.clientX);
  });
  bar.addEventListener('pointerleave', () => { if (!drag) hover.classList.remove('on'); });
  bar.addEventListener('pointerdown', (e) => {
    if (!run) return;
    bar.setPointerCapture(e.pointerId);
    drag = { t: timeAt(e.clientX) };
    showHover(e.clientX);
  });
  const release = () => {
    if (!drag) return;
    const t = drag.t;
    drag = null;
    hover.classList.remove('on');
    if (run) run.seek(t);
  };
  bar.addEventListener('pointerup', release);
  bar.addEventListener('pointercancel', () => { drag = null; hover.classList.remove('on'); });

  function drawMarks() {
    for (const m of bar.querySelectorAll('.mark')) m.remove();
    if (!run) return;
    for (const c of run.chapters) {
      if (c.t <= 0) continue;
      bar.appendChild(h('div', { class: 'mark', style: { left: `${(c.t / duration()) * 100}%` } }));
    }
  }

  function update() {
    if (!run) return;
    const t = drag ? drag.t : run.state === 'playing' || run.state === 'ended' ? (run.t || 0) : run.position;
    fill.style.width = `${Math.min(100, (t / duration()) * 100)}%`;
    const txt = `${fmtTime(t)} / ${fmtTime(duration())}`;
    if (time.textContent !== txt) time.textContent = txt;
    const name = run.state === 'seeking' ? `${chapterName(t)} · getting the sound ready…` : chapterName(t);
    if (chapter.textContent !== name) chapter.textContent = name;
    if (run.state !== state) {
      state = run.state;
      const playing = state === 'playing' || (state === 'seeking' && run._resume);
      playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', playing ? 'Pause (Space)' : 'Play (Space)');
      bar.classList.toggle('busy', state === 'seeking');
    }
  }

  return {
    buttons: [prevBtn, playBtn, nextBtn, restartBtn],
    playBtn,
    bar,
    time,
    chapter,
    attach(r) {
      run = r;
      state = '';
      drawMarks();
      update();
    },
    drawMarks,
    update,
  };
}

/**
 * Keys for a show (shared by the full-screen shows and the room shows): Space/K play-pause, ←/→ chapters (unless
 * a control has focus, where they move between controls), J/L ten seconds, R from the start. True when handled.
 */
export function showKey(run, e, inControls) {
  if (!run) return false;
  switch (e.key) {
    case ' ': case 'k': case 'K': case 'MediaPlayPause':
      if (inControls && e.key === ' ') return false;
      run.toggle();
      return true;
    case 'ArrowLeft': case 'ArrowRight':
      if (inControls) return false;
      run.jumpChapter(e.key === 'ArrowLeft' ? -1 : 1);
      return true;
    case 'PageUp': case 'MediaTrackPrevious': case 'p': case 'P':
      run.jumpChapter(-1);
      return true;
    case 'PageDown': case 'MediaTrackNext': case 'n': case 'N':
      run.jumpChapter(1);
      return true;
    case 'j': case 'J':
      run.seek(run.position - 10);
      return true;
    case 'l': case 'L':
      run.seek(run.position + 10);
      return true;
    case 'r': case 'R': case 'Home':
      run.restart();
      return true;
    default:
      return false;
  }
}
