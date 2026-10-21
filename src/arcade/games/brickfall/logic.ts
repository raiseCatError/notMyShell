import {circleBox} from '../../engine/collide.js';
import type {Rng} from '../../rng.js';

/**
 * Brickfall's rules in fixed logical units (120 × 80): a paddle along the bottom, balls, a wall of bricks from a
 * handcrafted layout, power-ups that fall from broken bricks, three lives. Balls move in small sub-steps so a fast ball
 * cannot skip through a brick, and each contact reflects along the true normal of the brick face or corner it touched.
 */
export const FIELD_W = 120;
export const FIELD_H = 80;
export const PADDLE_Y = 74;
export const PADDLE_W = 18;
export const WIDE_W = 28;
export const PADDLE_H = 2;
export const PADDLE_SPEED = 110;
export const BALL_R = 1.2;
export const BALL_START = 62;
export const BALL_MAX = 115;
export const BRICK_W = 9;
export const BRICK_H = 3;
export const BRICK_TOP = 8;
export const COLUMNS = 12;
export const LIVES = 3;
export const PRESS_MS = 140;
export const POWER_MS = 12_000;
export const POWER_CHANCE = 0.12;

export type PowerKind = 'wide' | 'multi' | 'slow';
export interface Brick { id: number; x: number; y: number; row: number; hits: number; tough: boolean }
export interface Ball { x: number; y: number; vx: number; vy: number; px: number; py: number; stuck: boolean }
export interface Power { kind: PowerKind; x: number; y: number }
export type BrickEvent = {kind: 'break'; brick: Brick; combo: number; points: number} | {kind: 'dent'; brick: Brick} | {kind: 'paddle'; x: number} | {kind: 'wall'; x: number; y: number} | {kind: 'lost'} | {kind: 'power'; power: PowerKind} | {kind: 'clear'; level: number};

/**
 * Original layouts, one row of text per brick row: `#` a brick, `=` a tough brick (two hits), `.` empty. Twelve columns.
 * They cycle, a little faster each time round.
 */
export const LAYOUTS: readonly (readonly string[])[] = [
  ['############', '############', '############', '############', '............'],
  ['.....##.....', '....####....', '...######...', '..########..', '...######...', '....####....', '.....##.....'],
  // A cat's face: ears, eyes, a nose and whiskers.
  ['.#........#.', '.##......##.', '.####==####.', '.###.##.###.', '.##########.', '###..==..###', '.##########.'],
  ['#.#.#.#.#.#.', '.#.#.#.#.#.#', '#.#.#.#.#.#.', '.#.#.#.#.#.#', '=.=.=.=.=.=.'],
  ['============', '#..........#', '#.########.#', '#.#......#.#', '#.########.#', '#..........#'],
];

export class BrickState {
  paddleX = FIELD_W / 2;
  paddleV = 0;
  private pressMs = 0;
  private pressDir: -1 | 0 | 1 = 0;
  balls: Ball[] = [];
  bricks: Brick[] = [];
  powers: Power[] = [];
  wideMs = 0;
  slowMs = 0;
  lives = LIVES;
  score = 0;
  level = 1;
  /** Bricks broken since the ball last touched the paddle. */
  combo = 0;
  bestCombo = 0;
  events: BrickEvent[] = [];
  /** Milliseconds of the pause between levels. */
  clearMs = 0;
  private nextId = 1;

  constructor(private readonly rng: Rng) { this.load(); }

  get paddleW(): number { return this.wideMs > 0 ? WIDE_W : PADDLE_W; }
  get over(): boolean { return this.lives <= 0; }
  get speedScale(): number { return (this.slowMs > 0 ? 0.7 : 1) * Math.min(1.35, 1 + (this.level - 1) * 0.06); }

  /** The layout for the current level, and a fresh ball on the paddle. */
  load(): void {
    const layout = LAYOUTS[(this.level - 1) % LAYOUTS.length]!;
    this.bricks = [];
    const left = (FIELD_W - COLUMNS * (BRICK_W + 1) + 1) / 2;
    layout.forEach((line, row) => [...line].forEach((ch, column) => {
      if (ch !== '#' && ch !== '=') return;
      this.bricks.push({id: this.nextId++, x: left + column * (BRICK_W + 1), y: BRICK_TOP + row * (BRICK_H + 1), row, hits: ch === '=' ? 2 : 1, tough: ch === '='});
    }));
    this.powers = [];
    this.resetBall();
  }

  private resetBall(): void {
    this.balls = [{x: this.paddleX, y: PADDLE_Y - BALL_R - 0.1, vx: 0, vy: 0, px: this.paddleX, py: PADDLE_Y, stuck: true}];
    this.combo = 0;
  }

  press(dir: -1 | 1): void { this.pressDir = dir; this.pressMs = PRESS_MS; }

  /** Space: launch every ball resting on the paddle, up and a little toward the paddle's motion. */
  launch(): void {
    for (const ball of this.balls) {
      if (!ball.stuck) continue;
      ball.stuck = false;
      const angle = -Math.PI / 2 + this.rng.range(-0.35, 0.35) + Math.sign(this.paddleV) * 0.2;
      ball.vx = Math.cos(angle) * BALL_START;
      ball.vy = Math.sin(angle) * BALL_START;
    }
  }

  step(dtMs: number): void {
    if (this.over) return;
    const dt = dtMs / 1000;
    if (this.clearMs > 0) { this.clearMs -= dtMs; if (this.clearMs <= 0) { this.level += 1; this.load(); } return; }
    this.wideMs = Math.max(0, this.wideMs - dtMs);
    this.slowMs = Math.max(0, this.slowMs - dtMs);
    if (this.pressMs > 0) { this.pressMs -= dtMs; this.paddleV = this.pressDir * PADDLE_SPEED; } else this.paddleV *= 0.55;
    const half = this.paddleW / 2;
    this.paddleX = Math.max(half, Math.min(FIELD_W - half, this.paddleX + this.paddleV * dt));
    for (const ball of this.balls) {
      ball.px = ball.x; ball.py = ball.y;
      if (ball.stuck) { ball.x = this.paddleX; ball.y = PADDLE_Y - BALL_R - 0.1; continue; }
      // Sub-steps of at most half a radius, so nothing is tunnelled through.
      const distance = Math.hypot(ball.vx, ball.vy) * this.speedScale * dt;
      const steps = Math.max(1, Math.ceil(distance / (BALL_R * 0.5)));
      for (let index = 0; index < steps; index += 1) this.moveBall(ball, (dt * this.speedScale) / steps);
    }
    const kept = this.balls.filter(ball => ball.y < FIELD_H + 4);
    if (kept.length < this.balls.length && kept.length === 0) {
      this.lives -= 1;
      this.events.push({kind: 'lost'});
      this.wideMs = 0;
      if (!this.over) this.resetBall();
    } else this.balls = kept;
    this.fall(dt);
    if (this.bricks.length === 0 && this.clearMs <= 0) {
      this.score += 500 * this.level;
      this.events.push({kind: 'clear', level: this.level});
      this.clearMs = 1400;
    }
  }

  private moveBall(ball: Ball, dt: number): void {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); this.events.push({kind: 'wall', x: 0, y: ball.y}); }
    if (ball.x > FIELD_W - BALL_R) { ball.x = FIELD_W - BALL_R; ball.vx = -Math.abs(ball.vx); this.events.push({kind: 'wall', x: FIELD_W, y: ball.y}); }
    if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); this.events.push({kind: 'wall', x: ball.x, y: 0}); }
    // The paddle: only from above, the angle set by where it hit.
    const half = this.paddleW / 2;
    if (ball.vy > 0 && ball.y + BALL_R >= PADDLE_Y && ball.y - BALL_R <= PADDLE_Y + PADDLE_H && Math.abs(ball.x - this.paddleX) <= half + BALL_R) {
      const offset = Math.max(-1, Math.min(1, (ball.x - this.paddleX) / half));
      const speed = Math.min(BALL_MAX, Math.hypot(ball.vx, ball.vy) * 1.015);
      const angle = -Math.PI / 2 + offset * 1.05;
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      ball.y = PADDLE_Y - BALL_R;
      this.combo = 0;
      this.events.push({kind: 'paddle', x: ball.x});
    }
    for (const brick of this.bricks) {
      const contact = circleBox({x: ball.x, y: ball.y, r: BALL_R}, {x: brick.x, y: brick.y, width: BRICK_W, height: BRICK_H});
      if (!contact) continue;
      ball.x += contact.nx * contact.depth;
      ball.y += contact.ny * contact.depth;
      const along = ball.vx * contact.nx + ball.vy * contact.ny;
      if (along < 0) { ball.vx -= 2 * along * contact.nx; ball.vy -= 2 * along * contact.ny; }
      this.hit(brick);
      break;
    }
  }

  private hit(brick: Brick): void {
    brick.hits -= 1;
    if (brick.hits > 0) { this.events.push({kind: 'dent', brick}); return; }
    this.bricks = this.bricks.filter(other => other !== brick);
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const points = (brick.tough ? 30 : 10) * Math.min(5, 1 + Math.floor(this.combo / 4));
    this.score += points;
    this.events.push({kind: 'break', brick, combo: this.combo, points});
    if (this.rng.chance(POWER_CHANCE)) this.powers.push({kind: this.rng.pick(['wide', 'multi', 'slow'] as const), x: brick.x + BRICK_W / 2, y: brick.y + BRICK_H});
  }

  private fall(dt: number): void {
    const half = this.paddleW / 2;
    this.powers = this.powers.filter(power => {
      power.y += 26 * dt;
      if (power.y >= PADDLE_Y - 1 && power.y <= PADDLE_Y + PADDLE_H + 1 && Math.abs(power.x - this.paddleX) <= half + 2) { this.collect(power.kind); return false; }
      return power.y < FIELD_H + 2;
    });
  }

  private collect(kind: PowerKind): void {
    this.events.push({kind: 'power', power: kind});
    if (kind === 'wide') this.wideMs = POWER_MS;
    else if (kind === 'slow') this.slowMs = POWER_MS;
    else {
      const source = this.balls.find(ball => !ball.stuck) ?? this.balls[0];
      if (!source) return;
      for (const turn of [-0.5, 0.5]) {
        if (this.balls.length >= 5) break;
        const speed = Math.max(BALL_START, Math.hypot(source.vx, source.vy));
        const angle = Math.atan2(source.vy || -1, source.vx) + turn;
        this.balls.push({x: source.x, y: source.y, vx: Math.cos(angle) * speed, vy: -Math.abs(Math.sin(angle) * speed), px: source.x, py: source.y, stuck: false});
      }
    }
  }
}
