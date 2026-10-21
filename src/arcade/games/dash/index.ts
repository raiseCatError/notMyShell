import {mixRgb} from '../../../chroma/chroma.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';
import type {GameDefinition} from '../../types.js';
import {createDashGame, readRecord} from './game.js';
import {geometry} from './scene.js';
import {playerSprite, spikeSprite} from './sprites.js';

/** Vespyr Dash: a rhythm platformer. Vespyr rides a glowing board at a steady pace; Space or Up jumps. See docs/design/arcade-dash.md. */
export const dashGame: GameDefinition = {
  id: 'dash', aliases: ['vespyr-dash'], title: 'Vespyr Dash', tagline: 'Rhythm platformer',
  description: 'Time your jumps over spikes, gaps and platforms. The pace never stops and never gets unfair.', kind: 'action', category: 'runners',
  controls: [{keys: 'Space/Up', action: 'jump'}],
  summary: record => { const saved = readRecord(record); return saved.attempts > 0 ? `Best ${saved.best} · ${saved.bestDistance} m` : 'Not played yet'; },
  preview(canvas: Canvas, frame: number, palette: ArcadePalette) {
    const geo = geometry(canvas.width, canvas.height);
    const buffer = new PixelBuffer(geo.width, geo.height);
    buffer.rect(0, geo.groundY, geo.width, 1, palette.accent);
    buffer.rect(0, geo.groundY + 1, geo.width, 1, mixRgb(palette.accent, palette.deep, 0.55));
    const span = geo.width + 12;
    const x = geo.width - ((frame * 3) % span);
    const hop = Math.max(0, 8 - Math.abs(x - 6 - geo.catX) * 0.6);
    buffer.sprite(spikeSprite(palette), x, geo.groundY - 4);
    buffer.sprite(playerSprite(hop > 0.5 ? 'air' : 'ride', palette), geo.catX, geo.groundY - 6 - Math.round(hop));
    canvas.blit(buffer);
  },
  create: context => createDashGame(context),
};
