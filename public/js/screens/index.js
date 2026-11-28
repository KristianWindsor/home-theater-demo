import { home } from './home.js';
import { movies, movie } from './movies.js';
import { player } from './player.js';
import { soundCheck } from './soundcheck.js';
import { trailers } from './trailers.js';
import { music } from './music.js';
import { viz } from './viz.js';
import { settingsScreen } from './settings.js';

export const screens = {
  home, movies, movie, play: player, soundcheck: soundCheck, trailers, music, viz, settings: settingsScreen,
  demos: soundCheck, // the page's old address (Original Shows)
};
