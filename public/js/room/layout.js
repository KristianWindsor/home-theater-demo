// Where things stand in the theater, from config/room.json. Meters; the listener sits at x=0, z=0 facing -z
// (12 o'clock = the TV). Pure maths, shared by the 3D room (room/room.js) and the speaker angles the audio
// renderer uses (experiences/core/speakers.js), so what you see and what you hear always agree.

export function roomBounds(cfg) {
  const R = (cfg && cfg.room) || {};
  return { W: R.width || 6.4, front: R.front ?? -3.7, back: R.back ?? 2.7, H: R.height || 2.75 };
}

/** A fireplace (chimney breast) sticking out of the middle of the front wall, or null. */
export function fireplaceOf(cfg) {
  const f = cfg && cfg.fireplace;
  if (!f) return null;
  return { width: f.width || 2.0, depth: f.depth || 0.4, height: f.height || roomBounds(cfg).H };
}

/** z of what the TV and its stand back onto: the fireplace's face, or the front wall. */
export function backingZ(cfg) {
  const f = fireplaceOf(cfg);
  return roomBounds(cfg).front + (f ? f.depth : 0);
}

/** The TV stand: its size and the z of its middle (backed up against the fireplace or the wall). */
export function standOf(cfg) {
  const con = (cfg && cfg.console) || { width: 2.4, height: 0.42, depth: 0.48 };
  return { ...con, z: backingZ(cfg) + 0.05 + con.depth / 2 };
}

export const couchZ = (cfg) => (cfg && cfg.couch && cfg.couch.z) ?? 0.3;

/**
 * One speaker's placement: { pos: [x, y, z], rotY, az, facing }.
 *   - towers: "clock" + "distance" around the listener, or "x" + "z" in meters, where "z" may be "tv" (in line
 *     with the TV stand) or "couch" (level with the couch); "position": [x, y, z] overrides everything
 *   - the center sits on the TV stand; a subwoofer with "corner" (e.g. "front-left") stands in that corner
 *   - "facing": "listener" (default) turns it towards the listener; "forward" keeps its front parallel to the
 *     front wall, firing straight into the room; "across" keeps it parallel to its side wall, firing across
 * rotY turns the speaker's front (its +z) in the room; az is its direction from the listener in degrees,
 * clockwise from the screen.
 */
export function placeSpeaker(s, cfg) {
  const { W, front, back } = roomBounds(cfg);
  const stand = standOf(cfg);
  const type = s.type || 'tower';
  let facing = s.facing || 'listener';
  let x, y = 0, z;
  if (type === 'center') {
    x = 0;
    y = stand.height;
    z = stand.z + stand.depth / 2 - 0.2;
    facing = 'forward';
  } else if (type === 'subwoofer' && s.x === undefined && s.z === undefined && s.clock === undefined) {
    const corner = s.corner || 'back-left';
    const half = (s.size || 0.85) / 2;
    const gap = s.gap ?? 0.15; // from both walls
    x = (corner.includes('left') ? -1 : 1) * (W / 2 - half - gap);
    z = corner.includes('back') ? back - half - gap : front + half + gap;
  } else if (s.x !== undefined || s.z !== undefined) {
    x = s.x ?? 0;
    z = s.z === 'tv' ? stand.z : s.z === 'couch' ? couchZ(cfg) : s.z ?? 0;
  } else {
    const th = (((s.clock ?? 12) - 12) * 30 * Math.PI) / 180;
    const d = s.distance || 2.5;
    x = Math.sin(th) * d;
    z = -Math.cos(th) * d;
  }
  if (s.position) [x, y, z] = s.position;
  const rotY = facing === 'forward' ? 0 : facing === 'across' ? (x < 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(-x, -z);
  return { pos: [x, y, z], rotY, az: (Math.atan2(x, -z) * 180) / Math.PI, facing };
}
