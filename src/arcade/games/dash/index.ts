import type {GameDefinition} from '../../types.js';
import {placeholderGame} from '../placeholder.js';

/** Placeholder until this game is implemented; replaced wholesale by the game's own module. */
export const dashGame: GameDefinition = placeholderGame({
  id: 'dash', aliases: ['vespyr-dash'], title: 'Vespyr Dash', tagline: 'Rhythm platformer', description: 'Time your jumps over spikes and gaps.', kind: 'action',
});
