import type {GameDefinition} from '../../types.js';
import {placeholderGame} from '../placeholder.js';

/** Placeholder until this game is implemented; replaced wholesale by the game's own module. */
export const dokuGame: GameDefinition = placeholderGame({
  id: 'vespyr-doku', aliases: ['doku'], title: 'Vespyr Doku', tagline: 'Cats and colored regions', description: 'One cat in every row, column and colored region, and no two cats touching.', kind: 'puzzle',
});
