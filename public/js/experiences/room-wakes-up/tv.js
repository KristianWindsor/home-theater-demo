// Awakening on the TV: a metronome whose arm swings to the ticks (left on surround left, right on front right, like
// the tick marble in the room), and a lane per speaker where the notes scroll towards a playhead, so you see what
// each speaker is about to play before it plays it. Drawn on a canvas each frame and shown on the room's TV.
import { clamp, lastBefore, smoothstep } from '../core/timeline.js';

const W = 1024, H = 576;
const FONT = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const css = (c, a = 1) => `rgba(${Math.round(Math.min(1, c[0]) * 255)}, ${Math.round(Math.min(1, c[1]) * 255)}, ${Math.round(Math.min(1, c[2]) * 255)}, ${a})`;

// one lane per speaker, in the order of a channel check
const LANES = [
  { role: 'FL', label: 'FL', inst: 'pluck' },
  { role: 'C', label: 'C', inst: 'hum' },
  { role: 'FR', label: 'FR', inst: 'glass' },
  { role: 'SR', label: 'SR', inst: 'box' },
  { role: 'SL', label: 'SL', inst: 'air' },
  { role: 'LFE', label: 'SUB', inst: 'sub' },
];
const AHEAD = 4.2, BEHIND = 1.1; // seconds shown either side of the playhead
const THETA = 0.42; // the arm's swing (radians either side)

export class TVMetronome {
  constructor(gl, score, col) {
    this.gl = gl;
    this.T = score.T;
    this.M = score.marks;
    this.col = col;
    const ev = score.events;
    this.ticks = ev.filter((e) => e.inst === 'tick' && !e.last).map((e) => ({ t: e.t, side: e.spk === 'SL' ? -1 : 1, vel: e.vel }));
    this.lanes = LANES.map((l) => ({
      ...l,
      color: col[l.inst],
      notes: ev.filter((e) => e.spk === l.role && e.inst !== 'tick').map((e) => ({ t: e.t, dur: e.inst === 'click' ? 0 : Math.min(e.dur || 0.3, 2.2), vel: e.vel, click: e.inst === 'click' })),
    }));
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  /** The arm's angle at t (-1 = full left, +1 = full right) and how recently it clicked. */
  _arm(t) {
    const K = this.ticks;
    if (!K.length) return { a: 0, click: 0 };
    const i = lastBefore(K, t);
    const swing = (from, to, u) => from + (to - from) * (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2;
    if (i < 0) {
      // at rest until the first swing out to the first tick
      const k = K[0];
      return { a: swing(0, k.side, (t - (k.t - 0.75)) / 0.75), click: 0 };
    }
    const a = K[i], b = K[i + 1];
    const click = Math.exp(-(t - a.t) / 0.12) * (0.5 + a.vel);
    if (!b) return { a: a.side, click };
    const gap = b.t - a.t;
    const dur = gap <= 1.8 ? gap : 1.0;
    return { a: swing(a.side, b.side, (t - (b.t - dur)) / dur), click };
  }

  /** Draw the frame for score time t (fade: 0..1 over black) and upload it; returns the texture. */
  draw(t, fade = 1) {
    const g = this.g;
    const T = this.T;
    g.save();
    g.globalAlpha = 1;
    const bg = g.createRadialGradient(W / 2, H * 0.55, 30, W / 2, H * 0.55, 640);
    bg.addColorStop(0, '#0e1628');
    bg.addColorStop(1, '#020306');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = fade;

    // ---------------------------------------------------------------- the metronome
    const cx = 200, base = 470, topY = 120;
    const tempo = smoothstep(T.t(2.5), T.t(3.5), t); // the tempo is found by bar 3
    g.beginPath();
    g.moveTo(cx - 105, base);
    g.lineTo(cx + 105, base);
    g.lineTo(cx + 38, topY);
    g.lineTo(cx - 38, topY);
    g.closePath();
    const wood = g.createLinearGradient(cx - 105, 0, cx + 105, 0);
    wood.addColorStop(0, '#1a0f08');
    wood.addColorStop(0.5, '#3a2414');
    wood.addColorStop(1, '#140b06');
    g.fillStyle = wood;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(245, 184, 74, 0.55)';
    g.stroke();
    // its scale
    g.strokeStyle = 'rgba(245, 220, 170, 0.35)';
    g.lineWidth = 2;
    for (let k = 0; k < 9; k++) {
      const y = topY + 40 + k * 30;
      const w = k % 2 ? 9 : 16;
      g.beginPath();
      g.moveTo(cx - w, y);
      g.lineTo(cx + w, y);
      g.stroke();
    }
    // the arm, pivoting near the base; it clicks at either end
    const { a, click } = this._arm(t);
    const piv = [cx, base - 40];
    const ang = a * THETA;
    const len = 330;
    const tip = [piv[0] + Math.sin(ang) * len, piv[1] - Math.cos(ang) * len];
    if (click > 0.02) {
      const glow = g.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], 70);
      glow.addColorStop(0, css(this.col.tick, 0.65 * Math.min(1, click)));
      glow.addColorStop(1, css(this.col.tick, 0));
      g.fillStyle = glow;
      g.fillRect(tip[0] - 70, tip[1] - 70, 140, 140);
    }
    g.strokeStyle = '#efe2c2';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(piv[0], piv[1]);
    g.lineTo(tip[0], tip[1]);
    g.stroke();
    const wy = 0.62; // the sliding weight
    const wp = [piv[0] + Math.sin(ang) * len * wy, piv[1] - Math.cos(ang) * len * wy];
    g.save();
    g.translate(wp[0], wp[1]);
    g.rotate(ang);
    g.fillStyle = '#f5b84a';
    g.fillRect(-22, -16, 44, 32);
    g.restore();
    g.fillStyle = '#f5b84a';
    g.beginPath();
    g.arc(piv[0], piv[1], 9, 0, Math.PI * 2);
    g.fill();
    // the beat, once there is one: four dots, the downbeat gold
    if (tempo > 0) {
      g.globalAlpha = fade * tempo;
      const beat = Math.floor((t - T.t(0)) / T.beat + 1e-6);
      const ph = (t - T.t(0)) / T.beat - beat;
      for (let k = 0; k < 4; k++) {
        const on = ((beat % 4) + 4) % 4 === k;
        g.fillStyle = on ? (k === 0 ? '#f5b84a' : '#efe2c2') : 'rgba(239, 226, 194, 0.2)';
        g.beginPath();
        g.arc(cx - 54 + k * 36, base + 46, on ? 10 + 5 * Math.exp(-ph * 6) : 7, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(239, 226, 194, 0.75)';
      g.font = `400 34px ${FONT}`;
      g.textAlign = 'center';
      g.fillText('♩ = 90', cx, 72);
      g.globalAlpha = fade;
    }

    // ---------------------------------------------------------------- the lanes
    const x0 = 420, x1 = 990, lab = 58;
    const lx = x0 + lab; // lanes start
    const play = lx + (x1 - lx) * (BEHIND / (AHEAD + BEHIND));
    const pps = (x1 - lx) / (AHEAD + BEHIND);
    const rowH = 62, y0 = 95;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    this.lanes.forEach((L, r) => {
      const yc = y0 + r * rowH + rowH / 2;
      // the lane, and its label in the speaker's colour
      g.fillStyle = 'rgba(255, 255, 255, 0.035)';
      g.fillRect(lx, yc - rowH / 2 + 6, x1 - lx, rowH - 12);
      g.fillStyle = css(L.color, 0.95);
      g.font = `600 24px ${FONT}`;
      g.fillText(L.label, x0, yc + 1);
      const N = L.notes;
      let i = lastBefore(N, t - BEHIND - 2.5);
      if (i < 0) i = 0;
      for (; i < N.length && N[i].t < t + AHEAD; i++) {
        const n = N[i];
        const xa = play + (n.t - t) * pps;
        const xb = n.click ? xa + 9 : play + (n.t + n.dur - t) * pps;
        if (xb < lx || xa > x1) continue;
        // a hair of space between notes that follow each other
        const a0 = Math.max(lx, xa), b0 = Math.min(x1, Math.max(xb - 3, xa + (n.click ? 9 : 12)));
        if (b0 - a0 < 2) continue;
        const hit = t >= n.t ? Math.exp(-(t - n.t) / 0.18) : 0;
        const past = t > n.t + n.dur + 0.05;
        const hh = (n.click ? 14 : 26) + 10 * hit;
        g.fillStyle = hit > 0.05 ? css([L.color[0] + hit * 0.6, L.color[1] + hit * 0.6, L.color[2] + hit * 0.6], 1) : css(L.color, past ? 0.28 : 0.55 + 0.4 * n.vel);
        roundRect(g, a0, yc - hh / 2, b0 - a0, hh, Math.min(hh / 2, (b0 - a0) / 2, 8));
        g.fill();
      }
    });
    // the playhead
    g.fillStyle = 'rgba(245, 184, 74, 0.8)';
    g.fillRect(play - 1.5, y0 - 6, 3, rowH * LANES.length + 12);
    // the sub's drop: the screen holds its breath with the room, then flashes red
    const M = this.M;
    if (M.drop !== undefined) {
      const breath = smoothstep(M.breath, M.breath + 0.12, t) * (1 - smoothstep(M.drop - 0.01, M.drop, t));
      const hit = t >= M.drop ? Math.exp(-(t - M.drop) / 0.35) : 0;
      if (breath > 0) {
        g.globalAlpha = 0.55 * breath;
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
      }
      if (hit > 0.01) {
        g.globalAlpha = 0.45 * hit;
        g.fillStyle = '#ff3a12';
        g.fillRect(0, 0, W, H);
      }
    }
    g.restore();

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return this.tex;
  }

  dispose() {
    this.gl.deleteTexture(this.tex);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h);
  g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.closePath();
}
