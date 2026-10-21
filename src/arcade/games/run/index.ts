import {mixRgb} from '../../../chroma/chroma.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';
import type {GameDefinition} from '../../types.js';
import {createRunGame, readRecord} from './game.js';
import {geometry} from './scene.js';
import {catSprite, obstacleSprite} from './sprites.js';

/** Vespyr Run: an endless runner. The cat runs by itself; Space or Up jumps, Down ducks. See docs/design/arcade-run.md. */
export const runGame: GameDefinition = {
  id: 'run', aliases: ['vespyr-run', 'dino'], title: 'Vespyr Run', tagline: 'Endless runner',
  description: 'Vespyr dashes across a scrolling landscape. Jump the crates and yarn, duck the swooping birds.', kind: 'action', category: 'runners',
  controls: [{keys: 'Space/Up', action: 'jump'}, {keys: 'Down', action: 'duck'}],
  summary: record => { const saved = readRecord(record); return saved.runs > 0 ? `Best ${saved.best} · ${saved.bestDistance} m` : 'Not played yet'; },
  preview(canvas: Canvas, frame: number, palette: ArcadePalette) {
    const geo = geometry(canvas.width, canvas.height);
    const buffer = new PixelBuffer(geo.width, geo.height);
    buffer.rect(0, geo.groundY, geo.width, 1, palette.accent);
    buffer.rect(0, geo.groundY + 1, geo.width, 1, mixRgb(palette.accent, palette.deep, 0.55));
    const span = geo.width + 16;
    const x = geo.width - ((frame * 3) % span);
    const hop = Math.max(0, 9 - Math.abs(x - geo.catX - 14) * 0.9);
    buffer.sprite(obstacleSprite('crates', palette), x, geo.groundY - 6);
    buffer.sprite(catSprite({shape: hop > 0.5 ? 'air' : 'run', frame: frame % 6, tail: Math.floor(frame / 3) % 4, twitch: false}, palette), geo.catX, geo.groundY - 8 - Math.round(hop), true);
    canvas.blit(buffer);
  },
  create: context => createRunGame(context),
};
