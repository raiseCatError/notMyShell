import {ARCADE_GAMES, findGame} from '../../src/arcade/registry.js';

/** Whether the arcade registry lists Classic Sudoku under its id and alias. */
export function registryHas(): boolean {
  return ARCADE_GAMES.some(game => game.id === 'sudoku') && findGame('classic-sudoku')?.id === 'sudoku' && findGame('sudoku')?.id === 'sudoku';
}
