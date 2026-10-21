import {mixRgb} from '../../../chroma/chroma.js';
import type {Key} from '../../../terminal/keys.js';
import {typeset} from '../../../ui/typography.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Trail} from '../../effects.js';
import {count, readyText, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BALL_R, COURT_H, COURT_W, LEVELS, PADDLE_H, PADDLE_W, PADDLE_X, PongState, WIN_POINTS, type Level} from './logic.js';

/**
 * Purr Pong: the classic, first to seven, against a local AI at three levels or a second person on the same keyboard.
 * The court keeps its 16:9 shape at any terminal size; the ball leaves a short trail and sparks where it hits.
 */
const FELT = rgb(0x14233a);
const FELT_LINE = rgb(0x2c4766);
const RIGHT = rgb(0xffb48a);
const BALL = rgb(0xfff8ef);

const LEVEL_LABEL: Readonly<Record<Level, string>> = {easy: 'Easy', normal: 'Normal', hard: 'Hard'};
const cap = (value: string): string => `${value[0]!.toUpperCase()}${value.slice(1)}`;

export function readPong(raw: Readonly<Record<string, unknown>>): {plays: number; wins: Record<Level, number>; margin: Record<Level, number>} {
  const wins = {easy: count(raw.winsEasy), normal: count(raw.winsNormal), hard: count(raw.winsHard)};
  const margin = {easy: count(raw.bestMarginEasy), normal: count(raw.bestMarginNormal), hard: count(raw.bestMarginHard)};
  return {plays: count(raw.plays), wins, margin};
}

interface Court { x: number; y: number; scale: number; width: number; height: number }

function courtFor(columns: number, rows: number): Court {
  const width = columns;
  const height = Math.max(8, (rows - 1) * 2);
  const scale = Math.min(width / COURT_W, height / COURT_H);
  const w = Math.round(COURT_W * scale);
  const h = 2 * Math.round((COURT_H * scale) / 2);
  return {x: Math.floor((width - w) / 2), y: 2 + 2 * Math.floor((height - h) / 4), scale, width: w, height: h};
}

class PurrPong implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private screen: 'menu' | 'play' | 'over' = 'menu';
  private state: PongState | undefined;
  private level: Level | 'player' = 'normal';
  private menu: Menu;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly trail: Trail;
  private pixels = new PixelBuffer(0, 0);
  private glow = {left: 0, right: 0};

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('pong-fx'), 120, context.motion.effects);
    this.popups = new Popups(4, context.motion.effects);
    this.trail = new Trail(7, context.motion.reduced ? 'off' : context.motion.effects);
    this.menu = this.buildMenu();
  }

  private buildMenu(): Menu {
    const saved = readPong(this.context.record.get());
    return new Menu([
      ...LEVELS.map((level, index) => ({id: level, label: `vs Vespyr · ${LEVEL_LABEL[level]}`, key: String(index + 1), hint: saved.wins[level] ? `${saved.wins[level]} won` : ''})),
      {id: 'player', label: 'Two players', key: '4', hint: 'W S  ·  ↑ ↓'},
    ]);
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.screen === 'over' ? (this.won ? 'won' : 'over') : 'playing'; }
  get refreshMs(): number { return 0; }
  private get won(): boolean { return Boolean(this.state && this.state.score.left > this.state.score.right && this.level !== 'player'); }

  step(dtMs: number): void {
    const state = this.state;
    if (!state || this.screen !== 'play') return;
    state.step(dtMs);
    const court = courtFor(this.size.columns, this.size.rows);
    const sx = (x: number) => court.x + x * court.scale;
    const sy = (y: number) => court.y + y * court.scale;
    if (state.serveMs <= 0) this.trail.push(sx(state.ball.x), sy(state.ball.y));
    for (const event of state.events.splice(0)) {
      if (event.kind === 'hit') {
        const color = event.side === 'left' ? this.context.motion.effects === 'off' ? BALL : arcadeLook().accent : RIGHT;
        this.particles.burst({x: sx(event.x), y: sy(event.y), count: 7, speed: 30 + event.speed * 0.15, angle: event.side === 'left' ? 0 : Math.PI, spread: 0.9, life: 360, drag: 2, colors: [color, BALL]});
        this.glow[event.side] = 1;
      } else if (event.kind === 'wall') {
        this.particles.burst({x: sx(event.x), y: sy(event.y), count: 3, speed: 18, angle: event.y === 0 ? Math.PI / 2 : -Math.PI / 2, spread: 0.8, life: 260, drag: 2, colors: [FELT_LINE, BALL]});
      } else {
        this.trail.clear();
        const x = event.side === 'left' ? court.x + court.width * 0.25 : court.x + court.width * 0.75;
        this.popups.add('+1', x, Math.floor(court.y / 2) + 3, event.side === 'left' ? arcadeLook().accent : RIGHT, 900);
      }
    }
    if (state.over) this.finish();
  }

  private finish(): void {
    const state = this.state!;
    this.screen = 'over';
    const left = state.score.left;
    const right = state.score.right;
    const before = readPong(this.context.record.get());
    const margin = left - right;
    let record = false;
    this.context.record.update(raw => {
      raw.plays = count(raw.plays) + 1;
      if (this.level !== 'player' && margin > 0) {
        const level = cap(this.level);
        raw[`wins${level}`] = count(raw[`wins${level}`]) + 1;
        record = margin > count(raw[`bestMargin${level}`]);
        raw[`bestMargin${level}`] = Math.max(count(raw[`bestMargin${level}`]), margin);
      }
    });
    const versus = this.level === 'player' ? 'Two players' : `vs Vespyr · ${LEVEL_LABEL[this.level]}`;
    const verdict = this.level === 'player' ? (left > right ? 'Left player wins' : 'Right player wins') : left > right ? 'You win' : 'Vespyr wins';
    this.result = {
      score: left, scoreText: `${left} – ${right}`, record,
      details: [verdict, versus, `Longest rally ${state.longestRally}`, ...(this.level !== 'player' ? [`Won ${before.wins[this.level] + (margin > 0 ? 1 : 0)} at ${LEVEL_LABEL[this.level].toLowerCase()}`] : [])],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.glow.left = Math.max(0, this.glow.left - dtMs / 240);
    this.glow.right = Math.max(0, this.glow.right - dtMs / 240);
  }

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (key.kind === 'escape') return 'ignored';
      const choice = this.menu.key(key);
      if (choice) {
        this.level = choice as Level | 'player';
        this.state = new PongState(this.level, createRng(this.context.rng.int(1, 0x7fffffff)));
        this.screen = 'play';
        this.result = undefined;
      }
      return 'handled';
    }
    const state = this.state;
    if (!state || this.screen !== 'play') return 'ignored';
    const two = this.level === 'player';
    const value = key.kind === 'text' ? key.value.toLowerCase() : '';
    if (value === 'w' || (!two && (key.kind === 'up' || value === 'k'))) { state.press('left', -1); return 'handled'; }
    if (value === 's' || (!two && (key.kind === 'down' || value === 'j'))) { state.press('left', 1); return 'handled'; }
    if (two && (key.kind === 'up' || value === 'k')) { state.press('right', -1); return 'handled'; }
    if (two && (key.kind === 'down' || value === 'j')) { state.press('right', 1); return 'handled'; }
    return 'ignored';
  }

  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.state) {
      const saved = readPong(this.context.record.get());
      topRow(canvas, look, 'Purr Pong', saved.plays ? `Games ${saved.plays}` : 'Not played yet');
      const top = Math.max(2, Math.floor(canvas.height / 2) - 5);
      readyText(canvas, look, 'First to seven', ['Choose an opponent'], top);
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const state = this.state;
    const court = courtFor(canvas.width, canvas.height);
    const versus = this.level === 'player' ? 'Two players' : `vs Vespyr · ${LEVEL_LABEL[this.level]}`;
    topRow(canvas, look, `Purr Pong · ${versus}`, `First to ${WIN_POINTS}  ·  rally ${state.rally}`);
    if (!color) { this.drawText(canvas, look, state, court); return; }
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const sx = (x: number) => court.x + x * court.scale;
    const sy = (y: number) => court.y + y * court.scale;
    buffer.rect(court.x, court.y, court.width, court.height, FELT);
    buffer.rect(court.x, court.y, court.width, 1, FELT_LINE);
    buffer.rect(court.x, court.y + court.height - 1, court.width, 1, FELT_LINE);
    for (let y = court.y + 2; y < court.y + court.height - 2; y += 4) buffer.rect(Math.round(sx(COURT_W / 2)) - 1, y, 2, 2, FELT_LINE);
    const paddle = (x: number, y: number, tone: typeof BALL, glow: number) => {
      const top = Math.round(sy(y - PADDLE_H / 2));
      const height = Math.max(2, Math.round(PADDLE_H * court.scale));
      const width = Math.max(1, Math.round(PADDLE_W * court.scale));
      const left = Math.round(sx(x) - width / 2);
      buffer.rect(left, top, width, height, mixRgb(tone, BALL, glow * 0.6));
      buffer.rect(left, top, width, 1, mixRgb(tone, BALL, 0.5));
    };
    paddle(PADDLE_X + PADDLE_W / 2, state.left.y, look.accent, this.glow.left);
    paddle(COURT_W - PADDLE_X - PADDLE_W / 2, state.right.y, RIGHT, this.glow.right);
    this.trail.draw(buffer, mixRgb(BALL, FELT, 0.4), mixRgb(BALL, FELT, 0.9));
    this.particles.draw(buffer, FELT);
    if (state.serveMs <= 0 || Math.floor(state.serveMs / 160) % 2 === 0 || this.context.motion.reduced) {
      const ball = state.ball;
      const bx = sx(ball.px + (ball.x - ball.px) * alpha);
      const by = sy(ball.py + (ball.y - ball.py) * alpha);
      const r = Math.max(1, Math.round(BALL_R * court.scale));
      buffer.rect(Math.round(bx - r / 2), Math.round(by - r / 2), Math.max(2, r), Math.max(2, r), BALL);
    }
    canvas.blit(buffer);
    this.drawScore(canvas, look, state, court);
    this.popups.draw(canvas, FELT);
  }

  private drawScore(canvas: Canvas, look: ArcadeLook, state: PongState, court: Court): void {
    const y = Math.floor(court.y / 2) + 1;
    const left = typeset({role: 'counter', text: String(state.score.left), maxColumns: 4, maxRows: canvas.height >= 20 ? 2 : 1});
    const right = typeset({role: 'counter', text: String(state.score.right), maxColumns: 4, maxRows: canvas.height >= 20 ? 2 : 1});
    const middle = court.x + Math.floor(court.width / 2);
    canvas.typeBlock(left, middle - 4 - left.columns, y, {fg: look.accent, bold: true});
    canvas.typeBlock(right, middle + 4, y, {fg: RIGHT, bold: true});
  }

  /** Without color: the court as text, paddles as bars, the ball as o. */
  private drawText(canvas: Canvas, look: ArcadeLook, state: PongState, court: Court): void {
    const rows = court.height / 2;
    const cy = (y: number) => Math.floor(court.y / 2) + Math.floor((y / COURT_H) * rows);
    const cx = (x: number) => court.x + Math.floor((x / COURT_W) * (court.width - 1));
    for (let row = 0; row < rows; row += 1) canvas.put(cx(COURT_W / 2), Math.floor(court.y / 2) + row, row % 2 ? ' ' : ':', {fg: look.text.dim});
    for (const [x, paddle] of [[PADDLE_X, state.left], [COURT_W - PADDLE_X, state.right]] as const) {
      for (let y = paddle.y - PADDLE_H / 2; y < paddle.y + PADDLE_H / 2; y += COURT_H / rows) canvas.put(cx(x), cy(y), '|', {bold: true});
    }
    if (state.serveMs <= 0) canvas.put(cx(state.ball.x), cy(state.ball.y), 'o', {bold: true});
    canvas.center(Math.floor(court.y / 2) + 1, `${state.score.left}   ${state.score.right}`, {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; this.trail.clear(); }
  pause(): void {}
  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'choose'}, {keys: '⏎', action: 'play'}, {keys: 'Esc', action: 'back'}];
    return this.level === 'player' ? [{keys: 'W S', action: 'left paddle'}, {keys: '↑ ↓', action: 'right paddle'}] : [{keys: '↑↓ / W S', action: 'paddle'}];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); this.trail.clear(); this.state = undefined; }
}

/** The hub preview: a rally between two paddles that track the ball. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const court = courtFor(canvas.width, canvas.height + 1);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const sx = (x: number) => court.x + x * court.scale;
  const sy = (y: number) => court.y - 2 + y * court.scale;
  buffer.rect(court.x, court.y - 2, court.width, court.height, FELT);
  for (let y = court.y; y < court.y + court.height - 4; y += 4) buffer.rect(Math.round(sx(COURT_W / 2)) - 1, y, 2, 2, FELT_LINE);
  const t = (frame % 40) / 40;
  const across = t < 0.5 ? t * 2 : 2 - t * 2;
  const bx = PADDLE_X + 4 + across * (COURT_W - 2 * PADDLE_X - 8);
  const by = COURT_H / 2 + Math.sin(frame * 0.31) * 28;
  for (const [x, y, tone] of [[PADDLE_X, by * 0.7 + 13, look.accent], [COURT_W - PADDLE_X - PADDLE_W, by * 0.8 + 9, RIGHT]] as const) {
    buffer.rect(Math.round(sx(x)), Math.round(sy(y - PADDLE_H / 2)), Math.max(1, Math.round(PADDLE_W * court.scale)), Math.round(PADDLE_H * court.scale), tone);
  }
  buffer.rect(Math.round(sx(bx)), Math.round(sy(by)), 2, 2, BALL);
  canvas.blit(buffer);
}

export const pongGame: GameDefinition = {
  id: 'pong', aliases: ['purr-pong'], title: 'Purr Pong', tagline: 'Paddles, a ball and a rival',
  description: 'The classic, first to seven: play Vespyr at three levels or a friend on the same keyboard. Where the ball meets your paddle decides its angle.',
  kind: 'action', category: 'arcade',
  controls: [{keys: '↑↓ / W S', action: 'paddle'}, {keys: '1-4', action: 'opponent'}],
  howToPlay: [
    'Move your paddle with the arrows or W and S; each press moves it a little, holding keeps it going.',
    'Hit the ball near the edge of the paddle for a steep angle, in the middle for a straight one. Every hit speeds it up.',
    'Two players: the left player uses W and S, the right player the arrows. First to seven wins.',
  ],
  summary: record => {
    const saved = readPong(record);
    if (!saved.plays) return 'Not played yet';
    const wins = saved.wins.easy + saved.wins.normal + saved.wins.hard;
    return `Won ${wins} · ${saved.wins.hard ? `hard best +${saved.margin.hard}` : `${saved.plays} played`}`;
  },
  preview,
  create: context => new PurrPong(context),
};
