// Hash router: #/movies, #/movie/<id>, #/play/<id>?t=..., #/music, #/viz/<id>, #/demos, #/trailers, #/settings
// Each screen module exports { mount(root, params, query) -> { unmount?, onKey? } }.
// It remembers where you were on each screen (scroll positions, the focused tile) and puts you back there when you
// return, so coming back from a show or a scene lands on the tile you started it from.
import { clear } from './dom.js';
import { focusables } from './nav.js';

const SCROLLERS = '.scroll, .shelf-row';

export class Router {
  constructor(root, routes) {
    this.root = root;
    this.routes = routes;
    this.current = null;
    this.prevPath = null;
    this.memory = new Map(); // route key -> { scroll: [[top, left]...], key, index }
    this.listeners = new Set();
    window.addEventListener('hashchange', () => this._go());
  }

  start() {
    this._go();
  }

  /** Called after every screen change with the new route ({ name, path, arg, query }). */
  onRoute(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  go(path, replace = false) {
    const h = `#${path}`;
    if (location.hash === h) this._go();
    else if (replace) {
      history.replaceState(null, '', h);
      this._go();
    } else location.hash = h;
  }

  /** Point the address bar at `path` without leaving the current screen (no remount), e.g. the scene now playing. */
  replaceQuiet(path) {
    const h = `#${path}`;
    if (location.hash === h) return;
    history.replaceState(null, '', h);
    const r = this._parse();
    if (this.current) Object.assign(this.current, { path: r.path, arg: r.arg, query: r.query });
  }

  /** Back in history (or to `fallback`). From home, only when home was opened from `fallback` (a room show's origin). */
  back(fallback = '/') {
    const fromHome = this.current && this.current.path === '/';
    if (history.length > 1 && this.current && (!fromHome || (fallback !== '/' && this.prevPath === fallback))) history.back();
    else this.go(fallback);
  }

  _parse() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    return { path: path || '/', name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : null, query: new URLSearchParams(qs || '') };
  }

  _key(r) {
    const qs = r.query && r.query.toString();
    return qs ? `${r.path}?${qs}` : r.path;
  }

  /** Where we are on the current screen: its scroll positions and the focused element. */
  _save() {
    const cur = this.current;
    const screen = this.root.querySelector('.screen');
    if (!cur || !screen) return;
    const scroll = [...screen.querySelectorAll(SCROLLERS)].map((el) => [el.scrollTop, el.scrollLeft]);
    const a = document.activeElement;
    const inside = a && a !== document.body && screen.contains(a);
    this.memory.set(this._key(cur), {
      scroll,
      key: inside ? a.dataset.key || null : null,
      index: inside ? focusables(screen).indexOf(a) : -1,
    });
  }

  /** Back where we were on this screen, if we've been here before. */
  _restore(r) {
    const m = this.memory.get(this._key(r));
    const screen = this.root.querySelector('.screen');
    if (!m || !screen) return;
    const apply = () => {
      const scrollers = [...screen.querySelectorAll(SCROLLERS)];
      for (const el of scrollers) el.style.scrollBehavior = 'auto';
      m.scroll.forEach(([top, left], i) => {
        const el = scrollers[i];
        if (!el) return;
        el.scrollTop = top;
        el.scrollLeft = left;
      });
      let target = m.key ? screen.querySelector(`[data-key="${CSS.escape(m.key)}"]`) : null;
      if (!target && m.index >= 0) target = focusables(screen)[m.index] || null;
      if (target) target.focus({ preventScroll: true });
      requestAnimationFrame(() => { for (const el of scrollers) el.style.scrollBehavior = ''; });
    };
    apply();
    requestAnimationFrame(apply); // again after layout: images and fonts can still move things on the first frame
  }

  async _go() {
    const r = this._parse();
    const screen = this.routes[r.name] || this.routes.home;
    if (this.current) this._save();
    if (this.current && this.current.ctl && this.current.ctl.unmount) {
      try {
        this.current.ctl.unmount();
      } catch (e) {
        console.error(e);
      }
    }
    this.prevPath = this.current ? this.current.path : null;
    clear(this.root);
    this.current = { ...r, ctl: null };
    try {
      const ctl = await screen(this.root, r.arg, r.query);
      if (this.current && this.current.path === r.path) {
        this.current.ctl = ctl || {};
        this._restore(r);
      }
    } catch (e) {
      console.error(`[router] ${r.name}`, e);
    }
    for (const fn of this.listeners) {
      try {
        fn(this.current);
      } catch (e) {
        console.error(e);
      }
    }
  }

  key(e) {
    const ctl = this.current && this.current.ctl;
    return ctl && ctl.onKey ? ctl.onKey(e) : false;
  }
}
