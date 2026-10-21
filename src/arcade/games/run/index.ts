import {mixRgb} from '../../../chroma/chroma.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';
import type {GameDefinition} from '../../types.js';
import {createRunGame, readRecord} from './game.js';
import {geometry, runSky} from './scene.js';
import {disc, gradient, rgb, ridge} from '../../scenery.js';
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
    const {stops} = runSky(0.08);
    gradient(buffer, stops, 0, geo.groundY);
    disc(buffer, geo.width * 0.74, geo.groundY * 0.3, Math.max(2, Math.round(geo.height * 0.07)), rgb(0xffe2b8), stops[1]!, 4);
    ridge(buffer, {base: geo.groundY, height: Math.round(geo.groundY * 0.2), amplitude: 3, scale: 18, scroll: frame * 0.4, seed: 3, step: 2, color: mixRgb(stops[3]!, rgb(0x7462b4), 0.72), rim: mixRgb(stops[3]!, rgb(0xf2e6ff), 0.45)});
    ridge(buffer, {base: geo.groundY, height: 2, amplitude: 2, scale: 3.5, scroll: frame * 1.5, seed: 21, color: rgb(0x356e62), rim: rgb(0x58a08a)});
    buffer.rect(0, geo.groundY, geo.width, 1, rgb(0x9fe0b8));
    buffer.rect(0, geo.groundY + 1, geo.width, geo.height - geo.groundY - 1, rgb(0x3a2c4e));
    const span = geo.width + 16;
    const x = geo.width - ((frame * 3) % span);
    const hop = Math.max(0, 9 - Math.abs(x - geo.catX - 14) * 0.9);
    buffer.sprite(obstacleSprite('crates', palette), x, geo.groundY - 6);
    buffer.sprite(catSprite({shape: hop > 0.5 ? 'air' : 'run', frame: frame % 6, tail: Math.floor(frame / 3) % 4, twitch: false}, palette), geo.catX, geo.groundY - 8 - Math.round(hop), true);
    canvas.blit(buffer);
  },
  create: context => createRunGame(context),
};
