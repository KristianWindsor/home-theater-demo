// Speaker geometry from config/room.json, in the form the audio renderer wants:
// { FL: { az, dist }, FR: ..., FC: ..., SL: ..., SR: ..., LFE: ... } (az degrees clockwise from the screen).
// Uses the same placement as the 3D room (room/layout.js), so sound and picture agree.
import { placeSpeaker } from '../../room/layout.js';

export function speakersFromRoom(cfg) {
  const out = {};
  for (const s of (cfg && cfg.speakers) || []) {
    const { pos, az } = placeSpeaker(s, cfg);
    const role = s.channel === 'C' ? 'FC' : s.channel;
    out[role] = { az, dist: Math.hypot(pos[0], pos[2]), id: s.id };
  }
  return out;
}
