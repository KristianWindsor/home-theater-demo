// The experiences: composed, choreographed pieces. Each one is a folder with
//   score.js  the shared timeline (notes, positions, cues) - read by both the audio and the picture
//   audio.js  how the score sounds (rendered offline in a worker, streamed to the speakers)
//   scene.js  how it looks (WebGL) and what the lights do
// Pure data here so Node (scripts/render_experience.mjs) can import it too.

export const EXPERIENCES = [
  {
    id: 'room-wakes-up',
    title: 'Awakening',
    tagline: 'One tick, then the whole room joins in',
    duration: 101,
    kind: 'room',
  },
  {
    id: 'glass-orchard',
    title: 'Glass Orchard',
    tagline: 'A glass tree, grown note by note',
    duration: 154,
    kind: 'stage',
  },
  {
    id: 'beneath-the-ice',
    title: 'Under the Ice',
    tagline: 'Something huge moves under a frozen lake',
    duration: 128,
    kind: 'stage',
  },
  {
    id: 'last-lighthouse',
    title: 'Lighthouse',
    tagline: 'A signal across a dark sea, then an answer',
    duration: 132,
    kind: 'stage',
  },
  {
    id: 'marble-eventually',
    title: 'Marble Machine',
    tagline: 'One marble sets off a room-sized machine',
    duration: 104,
    kind: 'stage',
  },
];

export const EXPERIENCE_BY_ID = Object.fromEntries(EXPERIENCES.map((e) => [e.id, e]));
