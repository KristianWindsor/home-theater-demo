// Base for full-screen experience scenes: an HDR target at an adaptive resolution, the shared bloom/tonemap
// post chain, a camera helper and sensible defaults for lights.
import { Target } from '../../gl/gl.js';
import { Post } from '../../gl/post.js';
import { m4, v3 } from '../../gl/math.js';
import { settings } from '../../core/settings.js';

export class StageScene {
  constructor(app, score, run) {
    this.app = app;
    this.gl = app.gl;
    this.score = score;
    this.run = run;
    this.post = new Post(this.gl);
    this.target = new Target(this.gl, 4, 4, { hdr: true, depth: true });
    this.scale = 1;
    this.t = 0;
  }

  /** View/projection for an eye looking at a target, with optional roll (radians). */
  camera(eye, target, fov, w, h, { roll = 0, near = 0.03, far = 400 } = {}) {
    const fwd = v3.norm(v3.sub(target, eye));
    let up = [0, 1, 0];
    if (roll) {
      const right = v3.norm(v3.cross(fwd, up));
      const u0 = v3.cross(right, fwd);
      up = v3.add(v3.scale(u0, Math.cos(roll)), v3.scale(right, Math.sin(roll)));
    }
    const view = m4.lookAt(eye, target, up);
    const proj = m4.perspective(fov, w / h, near, far);
    const vp = m4.multiply(proj, view);
    return { view, proj, vp, eye, target, fov, w, h, invVP: m4.invert(vp), right: [view[0], view[4], view[8]], up: [view[1], view[5], view[9]] };
  }

  /** Project a world point: { x, y } in 0..1 uv (y up), depth w, visible. */
  project(cam, p) {
    const m = cam.vp;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return { x: (x / w) * 0.5 + 0.5, y: (y / w) * 0.5 + 0.5, w, visible: w > 0 };
  }

  update() {}

  /** Subclasses draw into this.target (already bound and sized). */
  draw() {}

  postParams() {
    return {};
  }

  render(w, h, t, dt) {
    const gl = this.gl;
    const q = settings.quality;
    const maxW = q === 'low' ? 1280 : q === 'medium' ? 1600 : 1920;
    const s = Math.min(1, maxW / w) * this.scale;
    this.target.resize(w * s, h * s);
    this.target.bind();
    const t0 = performance.now();
    const src = this.draw(t, dt, this.target) || this.target;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.post.run(src.tex, src.w, src.h, w, h, this.postParams(t), t);
    this._adapt(performance.now() - t0);
  }

  _adapt() {
    if (settings.quality !== 'auto') {
      this.scale = 1;
      return;
    }
    const ms = this.app.frameInterval || 16.7;
    if (ms > 22 && this.scale > 0.5) this.scale = Math.max(0.5, this.scale - 0.02);
    else if (ms < 15.5 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.004);
  }

  light() {
    return null;
  }

  dispose() {
    this.target.dispose();
    for (const l of this.post.levels) l.dispose();
  }
}
