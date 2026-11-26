// Tiny DOM helpers + inline icons.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M6 5v14M19 5l-10 7 10 7z"/>',
  next: '<path d="M18 5v14M5 5l10 7-10 7z"/>',
  rew: '<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/>',
  fwd: '<path d="M13 6l7 6-7 6zM4 6l7 6-7 6z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  surround: '<circle cx="12" cy="12" r="2.5"/><path d="M7.5 7.5a6.4 6.4 0 000 9M16.5 7.5a6.4 6.4 0 010 9M4.6 4.6a10.4 10.4 0 000 14.8M19.4 4.6a10.4 10.4 0 010 14.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z"/>',
  starFill: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  wave: '<path d="M2 12h2l2-6 3 12 3-15 3 18 3-12 2 3h2"/>',
  orbit: '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4.5"/><circle cx="21" cy="11" r="1.4" fill="currentColor"/>',
  storm: '<path d="M7 15a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.5A3.8 3.8 0 0117.5 15"/><path d="M12 13l-2 4h3l-2 4"/>',
  sub: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  marker: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  // experiences (drawn large on their cards)
  'xp-room-wakes-up': '<path d="M3 20h18"/><rect x="7" y="6" width="10" height="6" rx="0.6"/><path d="M4 18v-6M20 18v-6M6.5 19v-2.5M17.5 19v-2.5"/><circle cx="12" cy="9" r="7.5" stroke-dasharray="1.2 2.2"/><path d="M9.5 17h5"/>',
  'xp-glass-orchard': '<path d="M12 21v-7M12 14c0-3-3-4-5-7M12 14c0-2 3-3 4-6M12 17c2-1 4-1 6-3M9 10l-3 1M14.5 10.5l2.5-3"/><circle cx="6.5" cy="6.5" r="1.4"/><circle cx="17.5" cy="7" r="1.4"/><circle cx="18.5" cy="13.5" r="1.1"/><path d="M4 21h16" stroke-dasharray="1 2"/>',
  'xp-beneath-the-ice': '<path d="M2 7h20"/><path d="M17 7l-3 4 1 3-4 3-2 4M14 11l3 2M11 17l-3-1"/><path d="M3 16c3 2 6 3 9 2.5s5-1.5 7-1" stroke-dasharray="1.5 2"/><circle cx="6" cy="10" r="0.6"/><circle cx="9" cy="12.5" r="0.5"/>',
  'xp-last-lighthouse': '<path d="M10 20l1-11h2l1 11M9.5 9h5M11 6.5h2V9h-2zM12 5v1.5"/><path d="M13.5 7.5L22 4M10.5 7.5L2 4" stroke-dasharray="1.2 1.6"/><path d="M2 20c2-1 3 1 5 0s3 1 5 0 3 1 5 0 3 1 5 0"/><circle cx="20" cy="15" r="0.7"/>',
  'xp-marble-eventually': '<circle cx="6" cy="5" r="1.6"/><path d="M3 9l9 3M21 11l-8 4M4 18l8 1.5M14 19.5h6"/><path d="M17 3v5M15.5 8h3" /><circle cx="17" cy="9.6" r="1.3"/><path d="M8 13l.8 3.5"/>',
};

/** Phones and tablets (no mouse): touch wording, tap-to-reveal controls, no 5.1 advice. */
export const TOUCH_ONLY = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${P[name] || ''}</svg>`;
  return span.firstChild;
}

export function fmtTime(s, forceHours = false) {
  if (s === null || s === undefined || !Number.isFinite(s)) return '--:--';
  s = Math.max(0, s);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return hh || forceHours ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

export function fmtTimePrecise(s) {
  if (s === null || s === undefined || !Number.isFinite(s)) return '';
  const base = fmtTime(s, s >= 3600);
  const tenth = Math.floor((s % 1) * 10);
  return tenth ? `${base}.${tenth}` : base;
}

export function parseTime(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const parts = String(v).trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return NaN;
  return parts.reduce((a, p) => a * 60 + p, 0);
}

export function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function toast(msg, kind = '', ms = 4500) {
  const host = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.4s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 450);
  }, ms);
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}
