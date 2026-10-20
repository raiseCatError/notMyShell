import type {GameDefinition} from '../../types.js';
import {placeholderGame} from '../placeholder.js';

/** Placeholder until this game is implemented; replaced wholesale by the game's own module. */
export const runGame: GameDefinition = placeholderGame({
  id: 'run', aliases: ['vespyr-run', 'dino'], title: 'Vespyr Run', tagline: 'Endless runner', description: 'Vespyr dashes across a scrolling landscape. Jump the rocks, duck the swooping birds.', kind: 'action',
});
