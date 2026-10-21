import {mixRgb} from '../../../chroma/chroma.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';
import type {GameDefinition} from '../../types.js';
import {createDashGame, readRecord} from './game.js';
import {geometry, phaseTones} from './scene.js';
import {gradient, rgb} from '../../scenery.js';
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
    const tint = phaseTones(palette)[Math.floor(frame / 40) % 5]!;
    gradient(buffer, [rgb(0x07051a), mixRgb(rgb(0x170f3a), tint, 0.22)], 0, geo.groundY);
    const radius = Math.max(4, Math.round(geo.groundY * 0.34));
    const cx = Math.round(geo.width * 0.66);
    for (let y = geo.groundY - radius; y < geo.groundY; y += 1) {
      const t = (y - (geo.groundY - radius)) / radius;
      if (t > 0.45 && Math.floor((y - (geo.groundY - radius)) * (1 + t)) % 5 < Math.round(t * 2.4)) continue;
      const half = Math.sqrt(Math.max(0, radius * radius - (geo.groundY - y) ** 2)) * 1.4;
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x += 1) buffer.set(x, y, mixRgb(rgb(0xffe39a), rgb(0xff6fae), t));
    }
    for (let x = 0; x < geo.width; x += 1) for (let y = geo.groundY; y < geo.height; y += 1) buffer.set(x, y, y === geo.groundY ? tint : (x + frame * 3) % 8 === 0 ? mixRgb(tint, rgb(0x0b0820), 0.55) : rgb(0x0b0820));
    const span = geo.width + 12;
    const x = geo.width - ((frame * 3) % span);
    const hop = Math.max(0, 8 - Math.abs(x - 6 - geo.catX) * 0.6);
    buffer.sprite(spikeSprite(palette), x, geo.groundY - 4);
    buffer.sprite(playerSprite(hop > 0.5 ? 'air' : 'ride', palette), geo.catX, geo.groundY - 6 - Math.round(hop));
    canvas.blit(buffer);
  },
  create: context => createDashGame(context),
};
