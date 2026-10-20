import {mixRgb} from '../../../chroma/chroma.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';
import type {GameDefinition} from '../../types.js';
import {createFlightGame, readRecord} from './game.js';
import {OB_W} from './physics.js';
import {obstacleColor} from './scene.js';
import {catSprite} from './sprites.js';

/** Vespyr Flight: an endless flier. Gravity pulls; Space or Up flaps. See docs/design/arcade-flight.md. */
export const flightGame: GameDefinition = {
  id: 'flight', aliases: ['vespyr-flight', 'flap'], title: 'Vespyr Flight', tagline: 'Endless flier',
  description: 'Vespyr flaps a pair of paper wings through towers of books, glass chimneys and crates. Each gap passed is a point.', kind: 'action',
  controls: [{keys: 'Space/Up', action: 'flap'}],
  summary: record => { const saved = readRecord(record); return saved.attempts > 0 ? `Best ${saved.best} · ${saved.bestPassed} passed` : 'Not played yet'; },
  preview(canvas: Canvas, frame: number, palette: ArcadePalette) {
    const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
    const tones = {
      edge: mixRgb(palette.deep, palette.accent, 0.25), light: mixRgb(palette.haze, palette.ink, 0.5), books: [palette.accent, palette.accentSoft, palette.muted, palette.haze],
      wood: palette.dusk, woodDark: palette.deep, glass: palette.haze, glassLight: palette.ink, ink: palette.ink,
    };
    const span = buffer.width + 12;
    const left = buffer.width - ((frame * 2) % span);
    const gapTop = Math.max(2, Math.floor(buffer.height / 2) - 4);
    for (let py = 0; py < buffer.height; py += 1) {
      if (py >= gapTop && py < gapTop + 9) continue;
      const d = py < gapTop ? gapTop - 1 - py : py - gapTop - 9;
      for (let column = 0; column < OB_W; column += 1) { const color = obstacleColor('books', 3, column, d, tones); if (color) buffer.set(left + column, py, color); }
    }
    const bob = Math.round(Math.sin(frame * 0.5) * 2);
    buffer.sprite(catSprite({wing: frame % 3 === 0 ? 'down' : frame % 3 === 1 ? 'mid' : 'up', legs: 'tucked', tail: 'trailing', blink: false, twitch: false, hit: false}, palette), 3, gapTop - 2 + bob, true);
    canvas.blit(buffer);
  },
  create: context => createFlightGame(context),
};
