import type {GameDefinition} from './types.js';
import {runGame} from './games/run/index.js';
import {flightGame} from './games/flight/index.js';
import {dashGame} from './games/dash/index.js';
import {sudokuGame} from './games/sudoku/index.js';
import {queensGame} from './games/queens/index.js';
import {leapGame} from './games/leap/index.js';
import {snakeGame} from './games/snake/index.js';
import {pongGame} from './games/pong/index.js';
import {brickfallGame} from './games/brickfall/index.js';
import {towerGame} from './games/tower/index.js';
import {bullseyeGame} from './games/bullseye/index.js';
import {orbitGame} from './games/orbit/index.js';

/**
 * Every arcade game, in hub order within its category (the hub groups them). A new game is one more entry here and one
 * directory under `games/`; there is no per-game global command, and `/game <name>` finds it by id or alias.
 */
export const ARCADE_GAMES: readonly GameDefinition[] = [
  runGame, flightGame, dashGame, leapGame,
  snakeGame, pongGame, brickfallGame,
  towerGame, bullseyeGame, orbitGame,
  sudokuGame, queensGame,
];

/** The game a `/game <name>` argument names (id or alias, case-insensitive, spaces as dashes), or undefined. */
export function findGame(name: string, games: readonly GameDefinition[] = ARCADE_GAMES): GameDefinition | undefined {
  const wanted = name.trim().toLowerCase().replace(/[\s_]+/gu, '-');
  if (!wanted) return undefined;
  return games.find(game => game.id === wanted || game.aliases.includes(wanted));
}

/** Names `/game` completes: every id, in hub order. */
export function gameNames(games: readonly GameDefinition[] = ARCADE_GAMES): string[] {
  return games.map(game => game.id);
}
