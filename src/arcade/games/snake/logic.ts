import type {Direction} from '../../kit.js';
import type {Rng} from '../../rng.js';

/**
 * Tail Chase's rules, with no drawing and no clock: a grid, the snake as a list of cells head first, the treat, an
 * optional golden treat that times out, rocks in Garden mode, and a step that moves the snake one cell. Time enters only
 * as milliseconds passed to `advance`, which runs whole moves at the current interval, so a replay with the same seed
 * and inputs ends in the same state at any frame rate.
 */
export type SnakeMode = 'classic' | 'wrap' | 'garden';
export const SNAKE_MODES: readonly SnakeMode[] = ['classic', 'wrap', 'garden'];
export const MODE_LABEL: Readonly<Record<SnakeMode, string>> = {classic: 'Classic', wrap: 'Wrap-around', garden: 'Garden'};
export const MODE_HINT: Readonly<Record<SnakeMode, string>> = {classic: 'walls are solid', wrap: 'walls wrap around', garden: 'rocks to steer around'};

export const START_INTERVAL = 150;
export const MIN_INTERVAL = 62;
/** Each treat shortens the move interval by this many ms, down to `MIN_INTERVAL`. */
export const SPEED_STEP = 2.5;
export const TREAT_POINTS = 10;
export const GOLDEN_POINTS = 50;
export const GOLDEN_MS = 6000;
/** A golden treat appears after every this many treats. */
export const GOLDEN_EVERY = 5;

const DELTA: Readonly<Record<Direction, readonly [number, number]>> = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};
const OPPOSITE: Readonly<Record<Direction, Direction>> = {up: 'down', down: 'up', left: 'right', right: 'left'};

export interface Eaten { cell: number; golden: boolean; points: number }

export class SnakeState {
  /** Head first. */
  body: number[];
  heading: Direction = 'right';
  /** Turns pressed but not yet taken: at most two, so a quick "up, left" is a corner, not a lost key. */
  private turns: Direction[] = [];
  treat = -1;
  golden = -1;
  goldenMs = 0;
  rocks = new Set<number>();
  score = 0;
  eaten = 0;
  alive = true;
  /** Milliseconds banked toward the next move. */
  private banked = 0;
  /** What the last move ate, for effects; cleared by the caller. */
  lastEaten: Eaten | undefined;
  /** The cells the snake occupied before the last move, for interpolation. */
  previous: number[];

  constructor(readonly width: number, readonly height: number, readonly mode: SnakeMode, private readonly rng: Rng) {
    const y = Math.floor(height / 2);
    const x = Math.max(3, Math.floor(width / 4));
    this.body = [this.at(x, y), this.at(x - 1, y), this.at(x - 2, y)];
    this.previous = [...this.body];
    if (mode === 'garden') this.placeRocks();
    this.treat = this.freeCell();
  }

  at(x: number, y: number): number { return y * this.width + x; }
  x(cell: number): number { return cell % this.width; }
  y(cell: number): number { return Math.floor(cell / this.width); }

  get interval(): number { return Math.max(MIN_INTERVAL, START_INTERVAL - this.eaten * SPEED_STEP); }
  get length(): number { return this.body.length; }

  /** Queue a turn; a reversal into the neck and a repeat of the current heading are ignored. */
  turn(direction: Direction): void {
    const last = this.turns.at(-1) ?? this.heading;
    if (direction === last || direction === OPPOSITE[last] || this.turns.length >= 2) return;
    this.turns.push(direction);
  }

  /** Let `ms` pass: whole moves at the current interval, plus the golden treat's timer. Returns the moves made. */
  advance(ms: number): number {
    if (!this.alive) return 0;
    if (this.golden >= 0) { this.goldenMs -= ms; if (this.goldenMs <= 0) { this.golden = -1; this.goldenMs = 0; } }
    this.banked += ms;
    let moves = 0;
    while (this.alive && this.banked >= this.interval) {
      this.banked -= this.interval;
      this.move();
      moves += 1;
    }
    return moves;
  }

  /** 0..1 of the way to the next move, for drawing between moves. */
  get progress(): number { return this.alive ? Math.min(1, this.banked / this.interval) : 0; }

  /** One move: turn if one is queued, step, eat or die. */
  move(): void {
    if (!this.alive) return;
    this.previous = [...this.body];
    const next = this.turns.shift();
    if (next) this.heading = next;
    const [dx, dy] = DELTA[this.heading];
    let nx = this.x(this.body[0]!) + dx;
    let ny = this.y(this.body[0]!) + dy;
    if (this.mode === 'wrap') { nx = (nx + this.width) % this.width; ny = (ny + this.height) % this.height; }
    if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) { this.alive = false; return; }
    const head = this.at(nx, ny);
    const eats = head === this.treat || head === this.golden;
    // The tail moves away this step unless the snake grows, so the head may enter the tail's current cell.
    const solid = eats ? this.body : this.body.slice(0, -1);
    if (this.rocks.has(head) || solid.includes(head)) { this.alive = false; return; }
    this.body.unshift(head);
    if (!eats) { this.body.pop(); return; }
    const golden = head === this.golden;
    const points = golden ? GOLDEN_POINTS : TREAT_POINTS;
    this.score += points;
    this.lastEaten = {cell: head, golden, points};
    if (golden) { this.golden = -1; this.goldenMs = 0; return; }
    this.eaten += 1;
    this.treat = this.freeCell();
    if (this.eaten % GOLDEN_EVERY === 0 && this.golden < 0) { this.golden = this.freeCell(); this.goldenMs = GOLDEN_MS; }
  }

  /** A random free cell (not the snake, a rock or another treat); -1 when the board is full. */
  freeCell(): number {
    const taken = new Set([...this.body, ...this.rocks, this.treat, this.golden]);
    const free: number[] = [];
    for (let cell = 0; cell < this.width * this.height; cell += 1) if (!taken.has(cell)) free.push(cell);
    return free.length ? this.rng.pick(free) : -1;
  }

  /** Garden rocks: small clusters, never in the snake's first rows of travel or touching the walls' corners. */
  private placeRocks(): void {
    const count = Math.max(3, Math.floor((this.width * this.height) / 70));
    const head = this.body[0]!;
    for (let attempt = 0; attempt < count * 20 && this.rocks.size < count; attempt += 1) {
      const x = this.rng.int(1, this.width - 2);
      const y = this.rng.int(1, this.height - 2);
      if (Math.abs(y - this.y(head)) <= 1 && x >= this.x(head) - 3) continue;
      const cell = this.at(x, y);
      if (this.body.includes(cell)) continue;
      this.rocks.add(cell);
    }
  }
}
