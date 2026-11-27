// KW5.1 front end: boots the renderer, audio, library and screens; runs the frame loop.
import { createContext, Target } from './gl/gl.js';
import { Room } from './room/room.js';
import { Visualizer } from './viz/visualizer.js';
import { AudioEngine, ROLE_LABEL } from './audio/engine.js';
import { Synth } from './audio/synth.js';
import { SpeakerSamples } from './audio/samples.js';
import { BUILTIN_DEMOS } from './audio/demos.js';
import { MusicPlayer } from './audio/music.js';
import { LightRig } from './lights/rig.js';
import { api, events } from './core/api.js';
import { settings, onSetting } from './core/settings.js';
import { Router } from './core/router.js';
import { installNav } from './core/nav.js';
import { installNowPlaying } from './core/nowplaying.js';
import { Showcase } from './core/showcase.js';
import { unlockMedia } from './core/unlock.js';
import { toast, TOUCH_ONLY } from './core/dom.js';
import { ctx } from './core/context.js';
import { screens } from './screens/index.js';
import { ExperienceRunner } from './experiences/core/runner.js';
import { frameClock } from './gl/resolution.js';
import { perfOverlay } from './core/perf.js';
import { EXPERIENCE_BY_ID } from './experiences/index.js';

const FALLBACK_ROOM = {
  name: 'The Theater',
  room: { width: 6.4, front: -3.7, back: 2.7, height: 2.75 },
  tv: { diagonalInches: 100, centerHeight: 1.35 },
  speakers: [
    { id: 'fl', label: 'Front Left', channel: 'FL', type: 'tower', clock: 10, distance: 2.9 },
    { id: 'fr', label: 'Front Right', channel: 'FR', type: 'tower', clock: 2, distance: 2.9 },
    { id: 'sr', label: 'Surround Right', channel: 'SR', type: 'tower', clock: 4, distance: 2.35 },
    { id: 'sl', label: 'Surround Left', channel: 'SL', type: 'tower', clock: 8, distance: 2.35 },
    { id: 'c', label: 'Center', channel: 'FC', type: 'center' },
    { id: 'sub', label: 'Subwoofer', channel: 'LFE', type: 'subwoofer', corner: 'back-left', size: 0.9 },
  ],
  hue: [{ id: 'hue-tv', anchor: 'tv' }, { id: 'hue-fl', anchor: 'fl' }, { id: 'hue-fr', anchor: 'fr' }, { id: 'hue-sl', anchor: 'sl' }, { id: 'hue-sr', anchor: 'sr' }],
};

class App {
  constructor() {
    this.listeners = new Map();
    this.mode = 'room';
    this.demo = null;
    this.experience = null;
    this.hover = null;
    this.items = new Map();
    this.library = { items: [] };
    this._viz = null;
  }

  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev).add(fn);
    return () => this.listeners.get(ev).delete(fn);
  }

  emit(ev, data) {
    for (const fn of this.listeners.get(ev) || []) fn(data);
  }

  async boot() {
    ctx.app = this;
    this.canvas = document.getElementById('gl');
    try {
      const { gl, caps } = createContext(this.canvas);
      this.gl = gl;
      this.caps = caps;
    } catch (e) {
      document.getElementById('splash-sub').textContent = 'This browser has no WebGL2, which the 3D room and visualizer need. Try Chrome or Edge.';
      throw e;
    }
    this._resize();
    window.addEventListener('resize', () => this._resize());
    await this.refreshLibrary(true);
    this.room = new Room(this.gl, this.caps, this.library.room || FALLBACK_ROOM);
    this.room.goTo('overview', 0.01);
    this.rig = new LightRig();
    this.rig.setFixtures(this.room.fixtures);
    this.engine = new AudioEngine(settings);
    this.music = new MusicPlayer(this);
    this.tvTarget = new Target(this.gl, 640, 360, { hdr: false });
    perfOverlay(this);
    this.router = new Router(document.getElementById('ui'), screens);
    installNowPlaying(this);
    this.showcase = new Showcase(this);
    events({
      analysis: (d) => {
        const item = this.items.get(d.id);
        if (item) item.analysis = d;
        this.music.onAnalysis(d);
        this.emit('analysis', d);
      },
      library: () => this.refreshLibrary(),
    });
    onSetting((k, v) => {
      if (k === 'volume' && this.engine.ready) this.engine.setVolume(v);
      if (k === 'upmix' && this.engine.ready) this.engine.setUpmix(v);
      if (k === 'fxLevel' && this.engine.ready) this.engine.setFxLevel(v);
      if (k === 'showLevel' && this.engine.ready) this.engine.setShowLevel(v);
      if (k === 'quality') this._resize();
      if (k === 'surroundMap' && this.engine.ready) this.engine.speakers = {};
    });
    this._input();
    installNav(() => true);
    const enter = document.getElementById('enter');
    enter.addEventListener('click', () => this.enter());
    this.last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  async enter() {
    // first, while this is still the tap (iPhone: films, trailers and music may then start without one)
    unlockMedia();
    try {
      await this.engine.init();
      this.synth = new Synth(this.engine);
      // speaker sounds from media/sounds, if there are any; until they're decoded the synth plays
      if (!this.samples) this.samples = new SpeakerSamples(this.engine);
      this.samples.load(this.library.sounds);
      if (!this._unlockBound) {
        this._unlockBound = true;
        const unlock = () => this.engine.unlock();
        for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, true);
        // the events Safari counts as a tap for media (until both media elements are unlocked; cheap after)
        for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, unlockMedia, true);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && unlock());
      }
    } catch (e) {
      console.error('[audio]', e);
      toast('Audio could not start in this browser.', 'bad');
    }
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    document.getElementById('splash').classList.add('hide');
    this.router.start();
    if (this.engine.ready && this.engine.channels < 6 && !TOUCH_ONLY) {
      setTimeout(() => toast(`This browser is outputting ${this.engine.layoutName}. For per-speaker sound set the playback device to 5.1 in the OS sound settings, then reload.`, 'warn', 9000), 1500);
    }
  }

  async refreshLibrary(initial = false) {
    for (let attempt = 0; ; attempt++) {
      try {
        const lib = await api.library();
        this.library = lib;
        this.items = new Map(lib.items.map((i) => [i.id, i]));
        if (this.samples) this.samples.load(lib.sounds); // only refetches when the list of sound files changed
        if (!initial) this.emit('library', lib);
        return lib;
      } catch (e) {
        if (!initial || attempt > 20) {
          toast(`Can't reach the server: ${e.message}`, 'bad');
          return this.library;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  viz() {
    if (!this._viz) this._viz = new Visualizer(this.gl, this.caps, settings);
    return this._viz;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'video') this.rig.setMode('movie');
  }

  _resize() {
    // Native quality draws every device pixel; otherwise very dense screens (phones) are capped at 2x
    const dpr = settings.quality === 'native' ? window.devicePixelRatio || 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  // ---------------------------------------------------------------- frame loop
  _frame(now) {
    const dt = Math.min(0.1, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.frameInterval = (this.frameInterval || 16.7) * 0.9 + (now - (this.prevNow || now)) * 0.1;
    if (this.prevNow) frameClock.tick(now - this.prevNow);
    this.prevNow = now;
    try {
      if (this.music) this.music.syncVideo();
      this._render(dt);
    } catch (e) {
      if (!this._renderErr) console.error('[frame]', e);
      this._renderErr = e;
    }
    requestAnimationFrame((t) => this._frame(t));
  }

  _render(dt) {
    const W = this.canvas.width, H = this.canvas.height;
    const xp = this.experience;
    if (xp && xp.scene) {
      // an experience owns the screen: its scene draws (the room, or a world of its own) on the audio clock
      this.rig.mode = 'script';
      xp.frame(W, H, dt);
      this.rig.update(dt, null);
      if (xp.kind === 'room') this.emit('roomframe', this.room);
      return;
    }
    if (xp && xp.kind === 'stage') {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.rig.update(dt, null);
      return;
    }
    const m = this.music;
    const musicOn = !!(m && m.item);
    if (musicOn) this.viz().update(m.visualTime, dt, m.playing);
    // a song's music video takes the screen instead of the visualizer (the lights still follow the music)
    const videoUp = this.mode === 'viz' && musicOn && m.videoOn;
    if (videoUp !== !!this._videoUp) {
      this._videoUp = videoUp;
      m.video.classList.toggle('on', videoUp);
    }
    if (this.mode === 'viz' && musicOn) {
      const v = this.viz();
      if (videoUp) frameClock.last = null; // nothing on the canvas: the video plays on its own layer
      else v.render(W, H);
      this.rig.setMode('music');
      this.rig.update(dt, { frame: v.frame, state: v.state });
      return;
    }
    if (this.mode === 'room' || this.mode === 'viz') {
      if (musicOn && m.playing) {
        const v = this.viz();
        let tv = null;
        if (m.videoFrame) tv = this._videoTexture(m.video, m.mv.video.fps); // the room's TV plays the music video
        if (!tv) {
          v.render(0, 0, this.tvTarget);
          tv = this.tvTarget.tex;
        }
        const c = v.state.chord || [0.2, 0.2, 0.3];
        this.room.setTVSource(tv, c.map((x) => x * (0.15 + 0.5 * v.frame.loud)));
        if (!this.demo && !this.experience) this.rig.setMode('music');
      } else {
        this.room.setTVSource(null, [0.03, 0.045, 0.08]);
        if (!this.demo && !this.experience) this.rig.setMode('ambient');
      }
      this.rig.update(dt, musicOn ? { frame: this.viz().frame, state: this.viz().state } : null);
      const eng = this.engine;
      const lv = eng && eng.ready ? eng.levels() : null;
      this.room.update(dt, lv ? (role) => eng.levelOf(role) * 2.2 : null);
      this.room.render(W, H, this.rig.fixtures, this.hover && this.hover.id);
      this.emit('roomframe', this.room);
      return;
    }
    // video mode: nothing to draw on the canvas; keep the virtual lights in "bias" mode
    frameClock.last = null;
    this.rig.update(dt, null);
  }

  /** The music video's current frame as a texture (for the TV in the room), uploaded once per video frame. */
  _videoTexture(video, fps) {
    const gl = this.gl;
    if (!this._vtex) {
      this._vtex = { tex: gl.createTexture(), key: '' };
      gl.bindTexture(gl.TEXTURE_2D, this._vtex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // the TV is small: no shimmer
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const vt = this._vtex;
    if (vt.broken === video.currentSrc) return null;
    const key = `${video.currentSrc}#${Math.floor(video.currentTime * (fps || 30))}`;
    if (key === vt.key) return vt.tex;
    gl.bindTexture(gl.TEXTURE_2D, vt.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // video rows run top-down, GL textures bottom-up
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.generateMipmap(gl.TEXTURE_2D);
      vt.key = key;
    } catch (e) {
      // e.g. a video from another origin without CORS: the TV shows the visualizer instead
      console.warn('[tv] the music video can\'t be drawn on the TV', e);
      vt.broken = video.currentSrc;
      return null;
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    return vt.tex;
  }

  // ---------------------------------------------------------------- 3D room input
  _input() {
    const c = this.canvas;
    let down = null;
    const ndc = (e) => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    };
    const active = () => this.mode === 'room' && !this.experience && this.router.current && this.router.current.name === 'home';
    c.addEventListener('pointerdown', (e) => {
      if (!active()) return;
      down = { x: e.clientX, y: e.clientY, moved: 0 };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!active()) return;
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        down.moved += Math.abs(dx) + Math.abs(dy);
        down.x = e.clientX;
        down.y = e.clientY;
        if (down.moved > 6) this.room.orbit(dx, dy);
      } else {
        const [x, y] = ndc(e);
        const p = this.room.pick(x, y, c.width, c.height);
        if ((p && p.id) !== (this.hover && this.hover.id)) {
          this.hover = p;
          c.style.cursor = p ? 'pointer' : 'grab';
          this.emit('hover', p);
        }
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (!active() || !down) return;
      const click = down.moved <= 6;
      down = null;
      if (click) {
        const [x, y] = ndc(e);
        const p = this.room.pick(x, y, c.width, c.height);
        if (p) this.activate(p.id);
      }
    });
    // experiences can react to a click too (The Passenger: the sleeping cat)
    c.addEventListener('pointerup', (e) => {
      const xp = this.experience;
      if (!xp || xp.state !== 'playing' || !xp.scene || !xp.scene.onClick) return;
      const [x, y] = ndc(e);
      xp.scene.onClick(x, y);
    });
    c.addEventListener('wheel', (e) => {
      if (!active()) return;
      e.preventDefault();
      this.room.zoom(e.deltaY);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (document.getElementById('splash').classList.contains('hide') === false) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.enter();
        }
        return;
      }
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (!typing && this.router.key(e)) {
        e.preventDefault();
        return;
      }
      if (typing) return;
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.key === 'GoBack') {
        if (this.router.current && this.router.current.name !== 'home') {
          e.preventDefault();
          this.router.back();
        } else if (this.demo) this.finishDemo();
      } else if (e.key === 'MediaPlayPause') this.music.toggle();
      else if (e.key === 'MediaTrackNext') this.music.next();
      else if (e.key === 'MediaTrackPrevious') this.music.prev();
    });
  }

  // ---------------------------------------------------------------- easter eggs
  /** Something in the room was clicked (or chosen with the keyboard). */
  async activate(id) {
    if (id === 'tv') {
      // the TV is the way in: it plays the showcase
      this.room.goTo('tv', 1.1);
      setTimeout(() => this.playShowcase(), 650);
      return;
    }
    if (id === 'couch') {
      this.room.goTo(this.room.preset === 'couch' ? 'overview' : 'couch', 1.6);
      return;
    }
    const sp = this.room.speakers[id];
    if (!sp) return;
    if (!this.engine.ready) await this.enter();
    if (!this.synth) return;
    const role = sp.role;
    const sound = { FL: ['zap', { pitch: 1 }], FR: ['zap', { pitch: 1.26 }], FC: ['chime', { base: 660 }], SL: ['whoosh', {}],
      SR: ['whoosh', { dur: 1.1 }], BL: ['whoosh', {}], BR: ['whoosh', {}], LFE: ['boom', {}] }[role] || ['chime', {}];
    const fromFile = settings.speakerSounds !== 'original' && this.samples ? this.samples.play(role) : null;
    const s = fromFile || this.synth.play(role, sound[0], sound[1]);
    this.room.setActivity(id, role === 'LFE' ? 1.6 : 1);
    const fx = this.rig.fixtures.find((f) => f.anchor === id);
    const warm = role === 'LFE' ? [1.0, 0.08, 0.02] : role === 'FC' ? [0.95, 0.75, 0.4] : [0.25, 0.55, 1.0];
    if (fx) this.rig.pulse(fx.id, warm.map((v) => v * 1.6), Math.max(0.8, s.duration));
    if (role === 'LFE') {
      this.room.shake = 0.06;
      for (const f of this.rig.fixtures) this.rig.pulse(f.id, [0.9, 0.05, 0.02], 2.6);
    }
    const virt = this.engine.speaker(role).virtual;
    this.emit('egg', { id, label: sp.label, role, virtual: virt, detail: `${[sp.detail, role].filter(Boolean).join(' \u00b7 ')}${virt ? ` (simulated on ${this.engine.layoutName})` : ''}` });
  }

  // ---------------------------------------------------------------- built-in demos
  async runDemo(id) {
    const def = BUILTIN_DEMOS.find((d) => d.id === id);
    if (!def) return;
    if (!this.engine.ready) await this.enter();
    if (!this.synth) return;
    const prevFrom = this.demo ? this.demo.from : null; // Restart keeps where it came from
    this.stopExperience();
    this.stopDemo();
    if (this.music.playing) this.music.pause();
    const speakers = Object.values(this.room.speakers);
    const roles = speakers.map((s) => s.role);
    const ring = speakers.filter((s) => s.type !== 'subwoofer').map((s) => ({ role: s.role, az: s.az }));
    this.room.setCard(def.title.toUpperCase(), 'Now playing');
    this.room.goTo(id === 'lfe-sweep' ? 'wide' : 'overview', 1.5);
    const status = { title: def.title, text: '', started: performance.now(), duration: def.duration };
    const emit = (type, d = {}) => {
      const before = status.text;
      if (type === 'speaker') {
        const sid = this.room.idForRole(d.role);
        if (sid) this.room.setActivity(sid, d.on ? 1 : 0);
        const fx = this.rig.fixtures.find((f) => f.anchor === sid);
        if (fx && d.on) this.rig.pulse(fx.id, [0.3, 0.6, 1.0].map((v) => v * 1.4), 1.8);
        if (d.on) status.text = `${d.label}${d.virtual ? ' (simulated)' : ''}`;
      } else if (type === 'orb') {
        this.room.setOrb(d);
        if (d.on) {
          const near = this.rig.fixtures.filter((f) => f.az !== undefined && f.anchor !== 'tv')
            .map((f) => ({ f, d: Math.abs(((f.az - d.angle + 540) % 360) - 180) })).sort((a, b) => a.d - b.d)[0];
          if (near && near.d < 50) this.rig.pulse(near.f.id, [1.0, 0.7, 0.35], 0.3);
        }
      } else if (type === 'flash') {
        this.rig.lightning(d.intensity, d.az);
        this.room.flash = Math.max(this.room.flash, d.intensity);
      } else if (type === 'rumble') {
        this.room.shake = 0.04 * d.intensity;
        this.room.setActivity('sub', 1.4);
      } else if (type === 'sweep') {
        status.text = `${d.freq.toFixed(0)} Hz`;
      } else if (type === 'end') {
        this.finishDemo();
        return;
      }
      // only when what the banner shows changed: the orbit and the storm emit every frame, and re-rendering the
      // banner that often swapped its Stop button out from under the user's finger
      if (status.text !== before) this.emit('demo', status);
    };
    const engine = def.show ? this.engine.onBus('show') : this.engine; // shows play at the Shows level
    // where it was started (Original Shows): it goes back there when it ends, onto the same tile
    const here = this.router.current;
    const from = here && here.name !== 'home' ? here.path : prevFrom;
    this.demo = { def, ctl: def.run({ engine, synth: this.synth, emit, roles, ring }), status, from };
    this.rig.setMode('ambient');
    this.emit('demo', status);
    if (!here || here.name !== 'home') this.router.go('/');
  }

  /** A built-in demo ended, or Stop was pressed: back to where it was started. */
  finishDemo() {
    const d = this.demo;
    if (!d) return;
    this.stopDemo();
    if (d.from && this.router.current && this.router.current.name === 'home') this.router.back(d.from);
  }

  // ---------------------------------------------------------------- the showcase
  /** Play the showcase (core/showcase.js): a few minutes of everything, from config/showcase.json. */
  async playShowcase() {
    if (!this.engine.ready) await this.enter();
    if (!this.engine.ready) return;
    this.stopDemo();
    this.stopExperience();
    if (this.music.playing) this.music.pause();
    this.showcase.start();
  }

  // ---------------------------------------------------------------- experiences
  /** Start a composed experience (see experiences/). Room experiences play on the home screen. */
  async runExperience(id) {
    const def = EXPERIENCE_BY_ID[id];
    if (!def) return null;
    if (!this.engine.ready) await this.enter();
    if (!this.engine.ready) return null;
    const prevFrom = this.experience ? this.experience.from : null; // a show started from a show (the cat's dream) returns where that one would
    this.stopDemo();
    this.stopExperience();
    if (this.music.playing) this.music.pause();
    const run = new ExperienceRunner(this, id);
    this.experience = run;
    this.hover = null;
    this.rig.script = (f) => run.light(f);
    this.rig.setMode('script');
    run.on('end', () => {
      if (this.experience !== run || run.showcase) return; // in the showcase, the showcase moves on
      if (run.kind === 'room') this.finishExperience();
    });
    run.on('state', (st) => {
      if (st === 'error' && this.experience === run) toast(`${def.title} could not start: ${run.error}`, 'bad', 8000);
    });
    this.emit('experience', run);
    const route = def.kind === 'room' ? '/' : `/x/${id}`;
    const here = this.router.current ? this.router.current.path : null;
    run.from = here && here !== route ? here : prevFrom; // a room show goes back there when it ends
    if (here !== route) this.router.go(route);
    run.start().catch((e) => {
      console.error('[experience]', e);
      if (this.experience === run) {
        toast(`${def.title} could not start: ${e.message}`, 'bad', 8000);
        this.stopExperience();
      }
    });
    return run;
  }

  /** A room show ended, or Stop was pressed: back to where it was started (Original Shows, its tile focused). */
  finishExperience() {
    const run = this.experience;
    if (!run) return;
    if (run.showcase && this.showcase.active) {
      this.showcase.stop(); // Stop during the showcase ends the showcase
      return;
    }
    this.stopExperience();
    if (run.kind === 'room' && run.from && this.router.current && this.router.current.name === 'home') this.router.back(run.from);
  }

  stopExperience() {
    const run = this.experience;
    if (!run) return;
    this.experience = null;
    run.stop();
    this.rig.script = null;
    this.rig.setMode('ambient');
    this.emit('experience', null);
  }

  stopDemo() {
    if (!this.demo) return;
    try {
      this.demo.ctl.stop();
    } catch (e) {
      console.warn(e);
    }
    this.demo = null;
    this.room.setOrb(null);
    this.room.setIdleCard();
    for (const id in this.room.speakers) this.room.setActivity(id, 0);
    this.emit('demo', null);
  }
}

const app = new App();
app.boot().catch((e) => console.error('[boot]', e));
window.kw51 = app; // handy from the devtools console
