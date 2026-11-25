// Registry of visual worlds and what kind of music each one suits.
import { NebulaWorld, KaleidoWorld, TunnelWorld, AuroraWorld } from './shaders.js';
import { HorizonWorld } from './horizon.js';
import { GalaxyWorld, CymaticsWorld } from './particles.js';

export const WORLDS = [
  { id: 'horizon', label: 'Horizon', blurb: 'A road through the music that is about to play',
    create: (c) => new HorizonWorld(c), energy: [0.5, 1.0], kinds: ['drop', 'chorus', 'peak', 'build'], needsScore: true, feedback: 0.18 },
  { id: 'galaxy', label: 'Spectral Galaxy', blurb: 'Every star is a frequency; beats ripple outward',
    create: (c) => new GalaxyWorld(c), energy: [0.35, 1.0], kinds: ['drop', 'chorus', 'peak', 'verse'], feedback: 0.62 },
  { id: 'tunnel', label: 'Wormhole', blurb: 'One ring per beat, arriving exactly on time',
    create: (c) => TunnelWorld(c), energy: [0.55, 1.0], kinds: ['drop', 'build', 'chorus', 'peak'], needsBeat: true, feedback: 0.45 },
  { id: 'kaleido', label: 'Mandala', blurb: 'A kaleidoscope that turns one notch per beat',
    create: (c) => KaleidoWorld(c), energy: [0.4, 1.0], kinds: ['chorus', 'peak', 'verse', 'build'], feedback: 0.55 },
  { id: 'cymatics', label: 'Cymatics', blurb: 'Sand on a vibrating plate, re-forming with each chord',
    create: (c) => new CymaticsWorld(c), energy: [0.15, 0.75], kinds: ['verse', 'break', 'build', 'intro'], feedback: 0.4 },
  { id: 'nebula', label: 'Chromatic Ink', blurb: 'Harmony as color, bass as gravity',
    create: (c) => NebulaWorld(c), energy: [0.0, 0.7], kinds: ['intro', 'break', 'verse', 'outro'], feedback: 0.6 },
  { id: 'aurora', label: 'Silk', blurb: 'Northern lights over still water',
    create: (c) => AuroraWorld(c), energy: [0.0, 0.45], kinds: ['intro', 'break', 'outro'], feedback: 0.35 },
];

export const WORLD_BY_ID = Object.fromEntries(WORLDS.map((w) => [w.id, w]));

export function affinity(world, { intensity, kind, hasBeat, hasScore }) {
  const [lo, hi] = world.energy;
  const miss = intensity < lo ? lo - intensity : intensity > hi ? intensity - hi : 0;
  let s = 1 - miss * 3;
  if (kind && world.kinds.includes(kind)) s += 0.45 - world.kinds.indexOf(kind) * 0.06;
  if (world.needsBeat && !hasBeat) s -= 2;
  if (world.needsScore && !hasScore) s -= 0.6;
  return s;
}
