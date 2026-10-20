import type {GameDefinition} from '../../types.js';
import {placeholderGame} from '../placeholder.js';

/** Placeholder until this game is implemented; replaced wholesale by the game's own module. */
export const flightGame: GameDefinition = placeholderGame({
  id: 'flight', aliases: ['vespyr-flight', 'flap'], title: 'Vespyr Flight', tagline: 'Endless flier', description: 'Flap through an endless run of gaps.', kind: 'action',
});
