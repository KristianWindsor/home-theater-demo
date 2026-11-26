// Speaker geometry from config/room.json, in the form the audio renderer wants:
// { FL: { az, dist }, FR: ..., FC: ..., SL: ..., SR: ..., LFE: ... } (az degrees clockwise from the screen).
// Mirrors the placement maths in room/room.js so sound and picture agree.

export function speakersFromRoom(cfg) {
  const R = (cfg && cfg.room) || {};
  const W = R.width || 6.4;
  const front = R.front ?? -3.7;
  const back = R.back ?? 2.7;
  const con = (cfg && cfg.console) || { width: 2.4, height: 0.42, depth: 0.48 };
  const conZ = front + 0.05 + con.depth / 2;
  const out = {};
  for (const s of (cfg && cfg.speakers) || []) {
    let x, z;
    const type = s.type || 'tower';
    if (type === 'center') {
      x = 0;
      z = conZ + con.depth / 2 - 0.2;
    } else if (type === 'subwoofer') {
      const size = s.size || 0.85;
      const corner = s.corner || 'back-left';
      x = (corner.includes('left') ? -1 : 1) * (W / 2 - size / 2 - 0.25);
      z = corner.includes('back') ? back - size / 2 - 0.25 : front + size / 2 + 0.35;
    } else {
      const th = (((s.clock ?? 12) - 12) * 30 * Math.PI) / 180;
      const d = s.distance || 2.5;
      x = Math.sin(th) * d;
      z = -Math.cos(th) * d;
    }
    if (s.position) [x, , z] = s.position;
    const role = s.channel === 'C' ? 'FC' : s.channel;
    out[role] = { az: (Math.atan2(x, -z) * 180) / Math.PI, dist: Math.hypot(x, z), id: s.id };
  }
  return out;
}
