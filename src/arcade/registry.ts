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
import {treatsGame} from './games/treats/index.js';
import {mergeGame} from './games/merge/index.js';
import {minesGame} from './games/mines/index.js';
import {purrwordGame} from './games/purrword/index.js';
import {slideGame} from './games/slide/index.js';
import {escapeGame} from './games/escape/index.js';
import {iceGame} from './games/ice/index.js';
import {moonjarsGame} from './games/moonjars/index.js';
import {linesGame} from './games/lines/index.js';
import {circuitGame} from './games/circuit/index.js';
import {fleetGame} from './games/fleet/index.js';
import {driftkeysGame} from './games/driftkeys/index.js';
import {roverGame} from './games/rover/index.js';
import {pinballGame} from './games/pinball/index.js';
import {catapultGame} from './games/catapult/index.js';
import {yarnGame} from './games/yarn/index.js';
import {sandfallGame} from './games/sandfall/index.js';
import {alleyGame} from './games/alley/index.js';
import {paradeGame} from './games/parade/index.js';
import {glassGame} from './games/glass/index.js';
import {prowlerGame} from './games/prowler/index.js';

/**
 * Every arcade game, in hub order within its category (the hub groups them). A new game is one more entry here and one
 * directory under `games/`; there is no per-game global command, and `/game <name>` finds it by id or alias.
 */
export const ARCADE_GAMES: readonly GameDefinition[] = [
  runGame, flightGame, dashGame, leapGame,
  snakeGame, pongGame, brickfallGame,
  towerGame, bullseyeGame, orbitGame,
  sudokuGame, queensGame, minesGame, mergeGame, treatsGame, purrwordGame,
  slideGame, escapeGame, iceGame, moonjarsGame, linesGame, circuitGame, fleetGame, driftkeysGame,
  alleyGame, paradeGame, glassGame, prowlerGame,
  roverGame, pinballGame, catapultGame, yarnGame, sandfallGame,
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
