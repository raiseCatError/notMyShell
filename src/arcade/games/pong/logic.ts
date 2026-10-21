import type {Rng} from '../../rng.js';

/**
 * Purr Pong's court, in fixed logical units (160 × 90) whatever the terminal, so a resize never changes the game. The
 * ball moves in fixed steps; it bounces off the top and bottom walls and off a paddle's face at an angle set by where it
 * hit (the edge sends it steeply, the middle straight), a little faster each rally hit. NMSh reports key presses only, so
 * a paddle key moves its paddle for a short time and a held key's repeats keep it moving.
 *
 * The AI sees only what a player sees: it reacts after a delay, moves no faster than a paddle can, aims with an error
 * that shrinks with difficulty, and on Hard predicts the bounces off the walls.
 */
export const COURT_W = 160;
export const COURT_H = 90;
export const PADDLE_H = 18;
export const PADDLE_W = 3;
export const PADDLE_X = 6;
export const BALL_R = 1.6;
export const PADDLE_SPEED = 150;
export const BALL_START = 92;
export const BALL_MAX = 230;
export const HIT_SPEEDUP = 1.06;
export const MAX_ANGLE = (58 * Math.PI) / 180;
export const WIN_POINTS = 7;
export const SERVE_MS = 800;
/** How long one key press keeps a paddle moving. */
export const PRESS_MS = 150;

export type Level = 'easy' | 'normal' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];
export const AI: Readonly<Record<Level, {speed: number; reaction: number; error: number; predict: boolean}>> = {
  easy: {speed: 0.55, reaction: 260, error: 9, predict: false},
  normal: {speed: 0.8, reaction: 150, error: 4.5, predict: false},
  hard: {speed: 1, reaction: 85, error: 1.5, predict: true},
};

export interface Paddle { y: number; vy: number; pressMs: number; dir: -1 | 0 | 1 }

export type Event = {kind: 'hit'; side: 'left' | 'right'; x: number; y: number; speed: number} | {kind: 'wall'; x: number; y: number} | {kind: 'point'; side: 'left' | 'right'};

export class PongState {
  left: Paddle = {y: COURT_H / 2, vy: 0, pressMs: 0, dir: 0};
  right: Paddle = {y: COURT_H / 2, vy: 0, pressMs: 0, dir: 0};
  ball = {x: COURT_W / 2, y: COURT_H / 2, vx: 0, vy: 0, px: COURT_W / 2, py: COURT_H / 2};
  score = {left: 0, right: 0};
  /** Milliseconds until the next serve (the ball waits at the center). */
  serveMs = SERVE_MS;
  /** Who serves next: the ball goes toward this side's opponent. */
  private serveTo: 1 | -1 = 1;
  rally = 0;
  longestRally = 0;
  events: Event[] = [];
  private aiTarget = COURT_H / 2;
  private aiClock = 0;

  constructor(readonly ai: Level | 'player', private readonly rng: Rng) { this.serveTo = rng.chance(0.5) ? 1 : -1; }

  get over(): boolean { return this.score.left >= WIN_POINTS || this.score.right >= WIN_POINTS; }

  /** A paddle key: move `side`'s paddle up (-1) or down (1) for a moment. */
  press(side: 'left' | 'right', dir: -1 | 1): void {
    const paddle = side === 'left' ? this.left : this.right;
    paddle.dir = dir;
    paddle.pressMs = PRESS_MS;
  }

  step(dtMs: number): void {
    if (this.over) return;
    const dt = dtMs / 1000;
    this.movePaddle(this.left, dt, PADDLE_SPEED);
    if (this.ai === 'player') this.movePaddle(this.right, dt, PADDLE_SPEED);
    else this.think(dtMs);
    if (this.serveMs > 0) {
      this.serveMs -= dtMs;
      if (this.serveMs <= 0) this.serve();
      return;
    }
    this.moveBall(dt);
  }

  private movePaddle(paddle: Paddle, dt: number, speed: number): void {
    if (paddle.pressMs > 0) { paddle.pressMs -= dt * 1000; paddle.vy = paddle.dir * speed; }
    else paddle.vy *= 0.6;
    paddle.y = Math.max(PADDLE_H / 2, Math.min(COURT_H - PADDLE_H / 2, paddle.y + paddle.vy * dt));
  }

  /** The AI: every reaction period it picks a target (the ball's arrival, with an error), then moves toward it at its speed. */
  private think(dtMs: number): void {
    const level = AI[this.ai as Level];
    this.aiClock -= dtMs;
    if (this.aiClock <= 0) {
      this.aiClock = level.reaction;
      const coming = this.ball.vx > 0 && this.serveMs <= 0;
      const aim = coming ? (level.predict ? this.arrival(COURT_W - PADDLE_X) : this.ball.y) : COURT_H / 2;
      this.aiTarget = aim + this.rng.range(-level.error, level.error);
    }
    const paddle = this.right;
    const delta = this.aiTarget - paddle.y;
    const step = Math.min(Math.abs(delta), PADDLE_SPEED * level.speed * (dtMs / 1000));
    paddle.vy = Math.sign(delta) * PADDLE_SPEED * level.speed;
    paddle.y = Math.max(PADDLE_H / 2, Math.min(COURT_H - PADDLE_H / 2, paddle.y + Math.sign(delta) * step));
  }

  /** Where the ball will cross x, bouncing off the walls on the way. */
  arrival(x: number): number {
    const {ball} = this;
    if (ball.vx === 0) return ball.y;
    const time = (x - ball.x) / ball.vx;
    if (time < 0) return ball.y;
    const span = COURT_H - BALL_R * 2;
    let y = ball.y - BALL_R + ball.vy * time;
    y = ((y % (span * 2)) + span * 2) % (span * 2);
    return BALL_R + (y > span ? span * 2 - y : y);
  }

  private serve(): void {
    const angle = this.rng.range(-0.35, 0.35);
    this.ball = {x: COURT_W / 2, y: COURT_H / 2, vx: Math.cos(angle) * BALL_START * this.serveTo, vy: Math.sin(angle) * BALL_START, px: COURT_W / 2, py: COURT_H / 2};
    this.rally = 0;
  }

  private moveBall(dt: number): void {
    const ball = this.ball;
    ball.px = ball.x; ball.py = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.y < BALL_R) { ball.y = BALL_R * 2 - ball.y; ball.vy = Math.abs(ball.vy); this.events.push({kind: 'wall', x: ball.x, y: 0}); }
    if (ball.y > COURT_H - BALL_R) { ball.y = (COURT_H - BALL_R) * 2 - ball.y; ball.vy = -Math.abs(ball.vy); this.events.push({kind: 'wall', x: ball.x, y: COURT_H}); }
    this.paddleHit(this.left, PADDLE_X + PADDLE_W / 2, -1);
    this.paddleHit(this.right, COURT_W - PADDLE_X - PADDLE_W / 2, 1);
    if (ball.x < -BALL_R * 2) this.point('right');
    else if (ball.x > COURT_W + BALL_R * 2) this.point('left');
  }

  /** A swept test: the ball's leading edge crossed the paddle's face this step, within its span. */
  private paddleHit(paddle: Paddle, face: number, side: -1 | 1): void {
    const ball = this.ball;
    if (Math.sign(ball.vx) !== side) return;
    const edge = face - side * BALL_R;
    const before = ball.px;
    const crossed = side < 0 ? before >= edge && ball.x < edge : before <= edge && ball.x > edge;
    if (!crossed) return;
    const t = (edge - before) / (ball.x - before);
    const y = ball.py + (ball.y - ball.py) * t;
    const offset = (y - paddle.y) / (PADDLE_H / 2 + BALL_R);
    if (Math.abs(offset) > 1) return;
    const speed = Math.min(BALL_MAX, Math.hypot(ball.vx, ball.vy) * HIT_SPEEDUP);
    const angle = offset * MAX_ANGLE + paddle.vy * 0.0015;
    ball.vx = -side * Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    ball.x = edge;
    ball.y = y;
    this.rally += 1;
    this.longestRally = Math.max(this.longestRally, this.rally);
    this.events.push({kind: 'hit', side: side < 0 ? 'left' : 'right', x: edge, y, speed});
  }

  private point(side: 'left' | 'right'): void {
    this.score[side] += 1;
    this.events.push({kind: 'point', side});
    this.serveTo = side === 'left' ? 1 : -1;
    this.ball = {x: COURT_W / 2, y: COURT_H / 2, vx: 0, vy: 0, px: COURT_W / 2, py: COURT_H / 2};
    this.serveMs = SERVE_MS;
  }
}
