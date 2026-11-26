#!/usr/bin/env node
// Render an experience's soundtrack to a WAV file, exactly as the browser would play it.
//
//   node scripts/render_experience.mjs room-wakes-up                 -> room-wakes-up.wav (5.1, 48 kHz)
//   node scripts/render_experience.mjs glass-orchard out.wav --stereo
//   node scripts/render_experience.mjs --list
//
// The 5.1 file uses the WAVE_FORMAT_EXTENSIBLE channel mask for FL FR FC LFE SL SR, so players and
// receivers route it correctly. Speaker angles come from config/room.json like in the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const { EXPERIENCES } = await import(pathToFileURL(path.join(root, 'public/js/experiences/index.js')).href);
if (flag('--list') || !args.length) {
  for (const e of EXPERIENCES) console.log(`${e.id.padEnd(20)} ${e.title}  (${Math.round(e.duration)} s)`);
  if (!args.length) console.log('\nusage: node scripts/render_experience.mjs <id> [out.wav] [--stereo] [--sr 48000]');
  process.exit(0);
}
const id = args[0];
const out = args[1] && !args[1].startsWith('--') ? args[1] : `${id}${flag('--stereo') ? '-stereo' : ''}.wav`;
const sr = Number(opt('--sr', 48000));
const deviceRoles = flag('--stereo') ? ['FL', 'FR'] : ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'];

const { createRenderer } = await import(pathToFileURL(path.join(root, 'public/js/experiences/audio/render-core.js')).href);
const { speakersFromRoom } = await import(pathToFileURL(path.join(root, 'public/js/experiences/core/speakers.js')).href);
const room = JSON.parse(fs.readFileSync(path.join(root, 'config/room.json'), 'utf8'));

const t0 = Date.now();
const r = await createRenderer({ id, sr, speakers: speakersFromRoom(room), deviceRoles });
const C = r.channels;
const frames = r.frames;
const pcm = Buffer.alloc(frames * C * 3); // 24-bit
let pos = 0;
let peak = 0;
const chunk = 48000;
while (pos < frames) {
  const n = Math.min(chunk, frames - pos);
  const data = r.render(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++) {
      const x = Math.max(-1, Math.min(1, data[c][i]));
      peak = Math.max(peak, Math.abs(x));
      const v = Math.round(x * 8388607);
      pcm.writeIntLE(v, ((pos + i) * C + c) * 3, 3);
    }
  }
  pos += n;
  process.stdout.write(`\r${id}: ${(pos / sr).toFixed(1)} / ${r.duration.toFixed(1)} s`);
}
const secs = (Date.now() - t0) / 1000;
console.log(`\nrendered in ${secs.toFixed(1)} s (${(r.duration / secs).toFixed(1)}x real time), peak ${(20 * Math.log10(peak || 1e-9)).toFixed(1)} dBFS, limiter min gain ${(20 * Math.log10(r.limiter.minGain)).toFixed(1)} dB`);

// WAVE_FORMAT_EXTENSIBLE header
const mask = C === 6 ? 0x3f : C === 2 ? 0x3 : 0;
const h = Buffer.alloc(68);
h.write('RIFF', 0);
h.writeUInt32LE(60 + pcm.length, 4);
h.write('WAVE', 8);
h.write('fmt ', 12);
h.writeUInt32LE(40, 16);
h.writeUInt16LE(0xfffe, 20);
h.writeUInt16LE(C, 22);
h.writeUInt32LE(sr, 24);
h.writeUInt32LE(sr * C * 3, 28);
h.writeUInt16LE(C * 3, 32);
h.writeUInt16LE(24, 34);
h.writeUInt16LE(22, 36);
h.writeUInt16LE(24, 38);
h.writeUInt32LE(mask, 40);
// KSDATAFORMAT_SUBTYPE_PCM {00000001-0000-0010-8000-00aa00389b71}
Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(h, 44);
h.write('data', 60);
h.writeUInt32LE(pcm.length, 64);
fs.writeFileSync(out, Buffer.concat([h, pcm]));
console.log(`wrote ${out} (${C} ch, ${sr} Hz, 24-bit)`);
