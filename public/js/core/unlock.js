// iPhone/iPad Safari starts a <video> or <audio> with sound only when play() runs inside a tap (click, touchend,
// keydown). Anything after an `await`, a timer or a media event doesn't count, so the showcase moving on to a film,
// the trailer reel's next trailer, or the player starting a film once its metadata has loaded were all refused
// (NotAllowedError: a black screen, no sound). An element that has once played inside a tap may play from then on
// without one, whatever its source, so the two elements that make sound (films/trailers and music) are unlocked on
// the first tap: play() and an immediate pause() while they're empty, which makes no sound. Elsewhere it's harmless.

const IDS = ['video', 'music'];
const unlocked = new WeakSet();

export function unlockMedia() {
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el || unlocked.has(el)) continue;
    if (!el.paused) {
      unlocked.add(el);
      continue;
    }
    // something is loaded: leave it alone (a play/pause would show in its controls); the next tap will do
    if (el.getAttribute('src')) continue;
    let p;
    try {
      p = el.play();
      el.pause();
    } catch {
      continue;
    }
    // the pause rejects the play with AbortError: allowed. NotAllowedError: this wasn't a tap after all; try again
    Promise.resolve(p).then(() => unlocked.add(el), (e) => {
      if (!e || e.name !== 'NotAllowedError') unlocked.add(el);
    });
  }
}
