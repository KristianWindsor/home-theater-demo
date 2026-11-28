// The experiences: composed, choreographed pieces. Each one is a folder with
//   score.js  the shared timeline (notes, positions, cues) - read by both the audio and the picture
//   audio.js  how the score sounds (rendered offline in a worker, streamed to the speakers)
//   scene.js  how it looks (WebGL) and what the lights do
// Pure data here so Node (scripts/render_experience.mjs) can import it too. The listed ones are on the Sound Check
// page: `check` is what each one checks, `listen` what to listen for. They play in the 3D room (`kind: 'room'`).

export const EXPERIENCES = [
  {
    id: 'room-wakes-up',
    title: 'Awakening',
    check: 'Every speaker',
    tagline: 'One tick, then the whole room joins in',
    listen: 'Each speaker gets a marble that bounces on every note it plays, named as it comes in, and the sub’s lands with a full-power 37 Hz drop',
    duration: 60,
    kind: 'room',
  },
];

export const EXPERIENCE_BY_ID = Object.fromEntries(EXPERIENCES.map((e) => [e.id, e]));
