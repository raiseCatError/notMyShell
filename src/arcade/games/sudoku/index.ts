import type {GameDefinition} from '../../types.js';
import {placeholderGame} from '../placeholder.js';

/** Placeholder until this game is implemented; replaced wholesale by the game's own module. */
export const sudokuGame: GameDefinition = placeholderGame({
  id: 'sudoku', aliases: ['classic-sudoku'], title: 'Classic Sudoku', tagline: 'Numbers, calmly', description: 'The classic 9x9 puzzle with notes, hints and undo.', kind: 'puzzle',
});
