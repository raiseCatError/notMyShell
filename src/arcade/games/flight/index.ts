import {mixRgb} from '../../../chroma/chroma.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';
import type {GameDefinition} from '../../types.js';
import {createFlightGame, readRecord} from './game.js';
import {OB_W} from './physics.js';
import {obstacleColor, flightSky} from './scene.js';
import {disc, gradient, rgb, skyline, stars} from '../../scenery.js';
import {catSprite} from './sprites.js';

/** Vespyr Flight: an endless flier. Gravity pulls; Space or Up flaps. See docs/design/arcade-flight.md. */
export const flightGame: GameDefinition = {
  id: 'flight', aliases: ['vespyr-flight', 'flap'], title: 'Vespyr Flight', tagline: 'Endless flier',
  description: 'Vespyr flaps a pair of paper wings through towers of books, glass chimneys and crates. Each gap passed is a point.', kind: 'action', category: 'runners',
  controls: [{keys: 'Space/Up', action: 'flap'}],
  summary: record => { const saved = readRecord(record); return saved.attempts > 0 ? `Best ${saved.best} · ${saved.bestPassed} passed` : 'Not played yet'; },
  preview(canvas: Canvas, frame: number, palette: ArcadePalette) {
    const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
    const {stops} = flightSky(0);
    const ground = buffer.height - 3;
    gradient(buffer, stops, 0, ground);
    stars(buffer, 5, ground - 8, rgb(0xf4f1ff), stops[0]!, {density: 60});
    disc(buffer, buffer.width * 0.78, ground * 0.3, Math.max(3, Math.round(buffer.height * 0.09)), rgb(0xfaf6ff), stops[1]!, 5);
    skyline(buffer, {base: ground, scroll: frame * 0.6, seed: 7, color: rgb(0x1d2257), window: rgb(0xd9b86f), low: 5, high: Math.max(6, Math.round(ground * 0.4)), lit: 0.3});
    skyline(buffer, {base: ground, scroll: frame * 1.5, seed: 19, color: rgb(0x12133a), window: rgb(0xffd98a), low: 3, high: Math.max(4, Math.round(ground * 0.22)), lit: 0.2});
    buffer.rect(0, ground, buffer.width, buffer.height - ground, rgb(0x1c1b42));
    buffer.rect(0, ground, buffer.width, 1, rgb(0x9a8fe0));
    const tones = {
      edge: rgb(0x14153a), light: rgb(0xf7efdc), books: [rgb(0xff8fb3), rgb(0x8fc4ff), rgb(0xffe08a), rgb(0x9fe0b8), rgb(0xffb48a), rgb(0xc9b2ff)],
      wood: rgb(0xc98f5e), woodDark: rgb(0x6e4630), glass: rgb(0x6fd1d6), glassLight: rgb(0xd8fbff), ink: palette.ink,
    };
    const span = buffer.width + 12;
    const left = buffer.width - ((frame * 2) % span);
    const gapTop = Math.max(2, Math.floor(ground / 2) - 5);
    for (let py = 0; py < ground; py += 1) {
      if (py >= gapTop && py < gapTop + 11) continue;
      const d = py < gapTop ? gapTop - 1 - py : py - gapTop - 11;
      for (let column = 0; column < OB_W; column += 1) { const color = obstacleColor('books', 3, column, d, tones); if (color) buffer.set(left + column, py, color); }
    }
    const bob = Math.round(Math.sin(frame * 0.5) * 2);
    buffer.sprite(catSprite({wing: frame % 3 === 0 ? 'down' : frame % 3 === 1 ? 'mid' : 'up', legs: 'tucked', tail: 'trailing', blink: false, twitch: false, hit: false}, palette), 4, gapTop - 1 + bob, true);
    canvas.blit(buffer);
  },
  create: context => createFlightGame(context),
};
