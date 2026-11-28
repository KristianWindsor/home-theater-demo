// The showcase (click the TV in the room): a few minutes of everything in order, from
// config/showcase.json: a sound check in the room first (Awakening, naming each speaker), a trailer, stretches of
// films, songs with their video or the visualizer, then a closing card. Each step plays on its own screen (the room, the player, the visualizer, a full-screen show); a chip at
// the top says where it is and offers Next and End. Going anywhere else (Back, a menu) ends it.
import { h, icon } from './dom.js';
import { EXPERIENCE_BY_ID } from '../experiences/index.js';

const DEFAULT = {
  title: 'Play the showcase',
  steps: [{ show: 'room-wakes-up', to: 54, title: 'Sound check' }],
  finale: { title: 'KW5.1', line: 'A Windsor home theater showcase', thanks: 'Thanks for watching' },
};
const FADE = 1.6; // seconds of fade at the end of a step that stops early
const sec = (v) => (typeof v === 'number' ? v : v ? String(v).split(':').map(Number).reduce((a, p) => a * 60 + p, 0) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The steps that can play here (each step, or the first of its stand-ins that's in the library) and their length. */
export function showcaseProgram(app) {
  const cfg = (app.library && app.library.showcase) || DEFAULT;
  const items = (app.library && app.library.items) || [];
  const base = (f) => String(f).split('/').pop();
  const find = (category, file) => items.find((i) => i.category === category && (i.file === file || base(i.file) === base(file)));
  const resolve = (st) => {
    if (st.show) {
      const def = EXPERIENCE_BY_ID[st.show];
      if (!def) return null;
      const from = sec(st.from) || 0;
      return { ...st, kind: 'show', def, from, to: Math.min(def.duration, sec(st.to) ?? def.duration), title: st.title || def.title };
    }
    const cat = st.movie ? 'movies' : st.trailer ? 'trailers' : st.song ? 'music' : null;
    const item = cat && find(cat, st.movie || st.trailer || st.song);
    if (!item) return null;
    const start = sec(st.start) || 0;
    const end = Math.min(item.duration || Infinity, sec(st.end) ?? item.duration);
    // no start or end: the whole thing (a trailer), which the player plays as itself rather than as a clip
    const whole = st.start == null && st.end == null;
    return { ...st, kind: st.song ? 'song' : 'video', item, start, end, whole, title: st.title || item.title };
  };
  const steps = [];
  for (const st of cfg.steps || []) {
    const r = [st, ...(st.or || [])].map(resolve).find(Boolean);
    if (r) steps.push(r);
  }
  const length = steps.reduce((a, s) => a + (s.kind === 'show' ? s.to - s.from : s.end - s.start), 0);
  return { title: cfg.title || DEFAULT.title, finale: { ...DEFAULT.finale, ...(cfg.finale || {}) }, steps, length };
}

/** "5 minutes", "1 minute", "45 seconds". */
export function aboutLength(seconds) {
  if (seconds < 90) return `${Math.max(10, Math.round(seconds / 5) * 5)} seconds`;
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

export class Showcase {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.token = 0;
    this.index = -1;
    this.expected = null;
    this.chipTimer = 0;
    // the chip: where we are, Next, End
    this.dots = h('div', { class: 'sc-dots' });
    this.capTitle = h('div', { class: 'sc-title' });
    this.capLine = h('div', { class: 'sc-line' });
    this.chip = h('div', { id: 'showcase', class: 'sc-chip', hidden: true, role: 'region', 'aria-label': 'Showcase' },
      h('div', { class: 'sc-text' }, h('div', { class: 'sc-kicker' }, 'KW5.1 showcase', this.dots), this.capTitle, this.capLine),
      h('button', { class: 'btn small', onclick: () => this.next(), 'data-key': 'sc:next' }, icon('next'), h('span', { class: 'lbl' }, 'Next')),
      h('button', { class: 'btn small', onclick: () => this.stop(), 'data-key': 'sc:end' }, icon('close'), h('span', { class: 'lbl' }, 'End')));
    // the closing card, over the room
    this.card = h('div', { id: 'showcase-card', class: 'sc-finale', hidden: true });
    document.body.insertBefore(this.chip, document.getElementById('toasts'));
    document.body.insertBefore(this.card, document.getElementById('toasts'));
    // stepping off the showcase's path (Back, a menu, the visualizer's Back) ends it
    app.router.onRoute((r) => {
      if (this.active && this.expected && r.path !== this.expected) this.stop(false);
    });
    for (const ev of ['pointermove', 'pointerdown', 'keydown']) document.addEventListener(ev, () => this.active && this._showChip(2600), true);
  }

  get program() {
    return this._program || showcaseProgram(this.app);
  }

  /** The closing card is up (the home screen keeps its showcase button out of the way). */
  get cardOpen() {
    return !this.card.hidden;
  }

  /** Start from the first step (or again, from the closing card). */
  start() {
    const app = this.app;
    this._program = showcaseProgram(app);
    if (!this._program.steps.length) return;
    this._hideCard();
    this.active = true;
    this.dots.replaceChildren(...this._program.steps.map(() => h('span', { class: 'sc-dot' })));
    app.emit('showcase', true);
    this._play(0);
  }

  /** The next step now (the current one stops, with a short fade). */
  next() {
    if (!this.active) return;
    this._play(this.index + 1);
  }

  /** End it. goHome: back to the room (false when the user has already gone somewhere else). */
  stop(goHome = true) {
    if (!this.active) return;
    this.active = false;
    this.token++;
    this._teardown();
    this.chip.hidden = true;
    this.expected = null;
    this.app.emit('showcase', false);
    if (goHome && this.app.router.current && this.app.router.current.name !== 'home') this.app.router.go('/');
  }

  _go(path, full = path) {
    this.expected = path;
    this.app.router.go(full);
  }

  /** Whatever the current step left running: a show, the song (and its fade), the player (its own screen ends it). */
  _teardown() {
    const app = this.app;
    if (this.run && app.experience === this.run) app.stopExperience();
    this.run = null;
    if (this.song) {
      if (app.music.item && app.music.item.id === this.song.id) app.music.stop();
      this.song = null;
    }
    const eng = app.engine;
    if (eng && eng.musicGain) {
      const g = eng.musicGain.gain;
      g.cancelScheduledValues(eng.ctx.currentTime);
      g.setValueAtTime(1, eng.ctx.currentTime);
    }
  }

  async _until(cond, token, ms = 100) {
    while (token === this.token && !cond()) await sleep(ms);
    return token === this.token;
  }

  async _play(i) {
    const app = this.app;
    const token = ++this.token;
    this._teardown();
    this.index = i;
    const st = this._program.steps[i];
    if (!st) return this._finale();
    [...this.dots.children].forEach((d, k) => d.classList.toggle('on', k <= i));
    this.capTitle.textContent = st.title || '';
    this.capLine.textContent = st.line || '';
    this._showChip(5200);
    if (st.kind === 'show') return this._playShow(st, token);
    if (st.kind === 'song') return this._playSong(st, token);
    // a stretch of a film or a cinema demo: the player plays [start, end] (or all of it) and calls next() at the end
    this._go(`/play/${st.item.id}`, `/play/${st.item.id}?t=${st.start}${st.whole ? '' : `&end=${st.end}`}&showcase=1`);
    return undefined;
  }

  async _playShow(st, token) {
    const app = this.app;
    // shows play in the room. One starts its camera from the current view: bring the view back to the whole room
    // first, so its opening shows the speakers (not the TV, the couch, a speaker or a zoom)
    if (!app.router.current || app.router.current.path !== '/') {
      this._go('/');
      // wait for the home screen: a show started before it's up would navigate there again, and the second remount
      // of home would stop the show
      if (!(await this._until(() => app.router.current && app.router.current.path === '/', token, 30))) return;
    }
    if (!(await this._roomView(token))) return;
    this.expected = '/';
    const run = await app.runExperience(st.show);
    if (!run || token !== this.token) return;
    run.showcase = true;
    run.from = null; // a room show in the showcase stays in the room when it ends
    this.run = run;
    if (!(await this._until(() => run.state === 'playing' || run.state === 'error' || run.state === 'stopped', token))) return;
    if (run.state !== 'playing') return this.next();
    if (st.from > 0) run.seek(st.from);
    if (!(await this._until(() => run.state === 'stopped' || run.state === 'ended' || (run.state === 'playing' && run.position >= st.to - FADE), token))) return;
    if (run.state === 'playing') await run.fadeOut(FADE);
    if (token !== this.token) return;
    this.next();
  }

  /** The room camera on the whole room (the overview), gliding there if it isn't; resolves once it's there. */
  async _roomView(token) {
    const room = this.app.room;
    const ov = room.presets.overview, c = room.cam;
    let dth = Math.abs(c.theta - ov.theta) % (2 * Math.PI);
    if (dth > Math.PI) dth = 2 * Math.PI - dth;
    const off = Math.hypot(c.target[0] - ov.target[0], c.target[1] - ov.target[1], c.target[2] - ov.target[2]);
    // the overview drifts slowly from side to side when idle, so a little turn still counts
    const there = room.camT === undefined && Math.abs(c.radius / ov.radius - 1) < 0.1 && Math.abs(c.phi - ov.phi) < 0.1 && dth < 0.5 && off < 0.2;
    if (there) return token === this.token;
    if (room.camT === undefined || room.preset !== 'overview') room.goTo('overview', 1.2);
    const t0 = performance.now();
    return this._until(() => room.camT === undefined || performance.now() - t0 > 2000, token, 50);
  }

  async _playSong(st, token) {
    const app = this.app;
    const m = app.music;
    const eng = app.engine;
    const g = eng.musicGain.gain;
    // silent until it's at its start (loading plays from the top for a moment)
    g.cancelScheduledValues(eng.ctx.currentTime);
    g.setValueAtTime(0, eng.ctx.currentTime);
    await m.playQueue([st.item], 0);
    if (token !== this.token) return;
    this.song = st.item;
    // the visualizer, choreographed to the song, unless the step asks for the song's music video ("video": true)
    m.setVideo(!!st.video);
    m.seek(st.start);
    await sleep(150);
    if (token !== this.token) return;
    if (st.video && m.mv) {
      // the music video: wait (briefly) for its picture at the new spot, so the sound doesn't arrive first
      const t0 = performance.now();
      const there = () => m.videoFrame && !m.video.seeking && Math.abs(m.video.currentTime - m.time) < 1;
      if (!(await this._until(() => there() || performance.now() - t0 > 3000, token))) return;
    }
    const now = eng.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(1, now + FADE);
    this._go(`/viz/${st.item.id}`);
    if (!(await this._until(() => !m.item || m.item.id !== st.item.id || m.time >= st.end - FADE, token))) return;
    const t = eng.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + FADE);
    await sleep(FADE * 1000);
    if (token !== this.token) return;
    this.next();
  }

  /** The closing card, over the room. */
  _finale() {
    const app = this.app;
    const f = this._program.finale;
    this.active = false;
    this.token++;
    this._teardown();
    this.chip.hidden = true;
    this.expected = null;
    if (!app.router.current || app.router.current.name !== 'home') app.router.go('/');
    const close = () => this._hideCard();
    this.card.replaceChildren(h('div', { class: 'sc-box' },
      h('div', { class: 'brand-mark' }, f.title),
      h('div', { class: 'sc-finale-line' }, f.line),
      f.thanks ? h('div', { class: 'sc-thanks' }, f.thanks) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => this.start(), 'data-key': 'sc:again' }, icon('refresh'), 'Watch again'),
        h('button', { class: 'btn', onclick: () => { close(); app.router.go('/movies'); }, 'data-key': 'sc:movies' }, icon('film'), 'Movie Scenes'),
        h('button', { class: 'btn btn-primary', onclick: close, 'data-key': 'sc:close' }, icon('check'), 'Back to the room'))));
    this.card.hidden = false;
    app.emit('showcase', false);
    setTimeout(() => { const b = this.card.querySelector('.btn-primary'); if (b) b.focus(); }, 400);
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(close, 45000);
  }

  _hideCard() {
    clearTimeout(this.cardTimer);
    if (this.card.hidden) return;
    this.card.hidden = true;
    this.app.emit('showcase', this.active);
  }

  _showChip(ms) {
    if (!this.active) return;
    this.chip.hidden = false;
    this.chip.classList.add('on');
    clearTimeout(this.chipTimer);
    this.chipTimer = setTimeout(() => {
      if (!this.chip.contains(document.activeElement)) this.chip.classList.remove('on');
    }, ms);
  }
}
