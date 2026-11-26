// Hash router: #/movies, #/movie/<id>, #/play/<id>?t=..., #/music, #/viz/<id>, #/demos, #/trailers, #/settings
// Each screen module exports { mount(root, params, query) -> { unmount?, onKey? } }.
import { clear } from './dom.js';

export class Router {
  constructor(root, routes) {
    this.root = root;
    this.routes = routes;
    this.current = null;
    window.addEventListener('hashchange', () => this._go());
  }

  start() {
    this._go();
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

  back(fallback = '/') {
    if (history.length > 1 && this.current && this.current.path !== '/') history.back();
    else this.go(fallback);
  }

  _parse() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    return { path: path || '/', name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : null, query: new URLSearchParams(qs || '') };
  }

  async _go() {
    const r = this._parse();
    const screen = this.routes[r.name] || this.routes.home;
    if (this.current && this.current.ctl && this.current.ctl.unmount) {
      try {
        this.current.ctl.unmount();
      } catch (e) {
        console.error(e);
      }
    }
    clear(this.root);
    this.current = { ...r, ctl: null };
    try {
      const ctl = await screen(this.root, r.arg, r.query);
      if (this.current && this.current.path === r.path) this.current.ctl = ctl || {};
    } catch (e) {
      console.error(`[router] ${r.name}`, e);
    }
  }

  key(e) {
    const ctl = this.current && this.current.ctl;
    return ctl && ctl.onKey ? ctl.onKey(e) : false;
  }
}
