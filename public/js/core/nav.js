// Spatial navigation for remotes and arrow keys: move focus to the nearest focusable element
// in the pressed direction. Enter activates (native for buttons).

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, a[href]';

function visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && el.closest('[inert]') === null;
}

/** Focusable elements in root; by default the screen and the Now Playing bar that sits beside it. */
export function focusables(root = null) {
  const roots = root ? [root] : [document.getElementById('ui'), document.getElementById('np')].filter(Boolean);
  return roots.flatMap((r) => [...r.querySelectorAll(FOCUSABLE)]).filter(visible);
}

export function focusFirst(root) {
  const el = (root.querySelector('[data-autofocus]') && visible(root.querySelector('[data-autofocus]')))
    ? root.querySelector('[data-autofocus]') : focusables(root)[0];
  if (el) el.focus({ preventScroll: false });
}

export function move(dir) {
  const items = focusables();
  if (!items.length) return false;
  const cur = document.activeElement;
  if (!cur || !items.includes(cur)) {
    items[0].focus();
    return true;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    let along, across;
    if (dir === 'left') { along = -dx; across = Math.abs(dy); }
    else if (dir === 'right') { along = dx; across = Math.abs(dy); }
    else if (dir === 'up') { along = -dy; across = Math.abs(dx); }
    else { along = dy; across = Math.abs(dx); }
    if (along <= 2) continue;
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return true;
  }
  return false;
}

/** Install the global arrow-key handler (screens may intercept first). */
export function installNav(shouldHandle) {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !shouldHandle(e)) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (dir && move(dir)) e.preventDefault();
  });
}
