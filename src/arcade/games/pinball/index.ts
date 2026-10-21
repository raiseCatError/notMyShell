import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {typeset} from '../../../ui/typography.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import {ParticleSystem, Popups, Shake, Trail} from '../../effects.js';
import {confetti} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {rgb} from '../../scenery.js';
import {truncateText} from '../../../util/text.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BALL_R, BALLS, FLIPPER_R, MAX_MULTIPLIER, PinballState, SEGMENTS, TABLE_H, TABLE_W} from './logic.js';

/**
 * Vespyr Pinball: one table, three balls. Pop bumpers, slingshots, three rollover lanes that raise the score multiplier,
 * a two-press plunger with a swinging power meter, and a nudge that tilts the table if overused. Drawn as a pixel table;
 * without color it becomes a text table (| / \ - walls, O bumpers, = flippers, o ball).
 */
const BALL = rgb(0xfff8ef);
const STEEL = rgb(0xc9c5dc);

interface Layout { scale: number; ox: number; oy: number; panel: number }

function layoutFor(columns: number, rows: number): Layout {
  const height = Math.max(8, rows * 2) - 3;
  const scale = Math.min(height / TABLE_H, columns / TABLE_W);
  const width = Math.round(TABLE_W * scale);
  const panel = columns >= width + 26 ? 24 : 0;
  return {scale, ox: Math.floor((columns - width - panel) / 2), oy: 3, panel};
}

class Pinball implements GameInstance {
  result: GameResult | undefined;
  readonly stepsPerSecond = 60;
  private readonly state: PinballState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly trail: Trail;
  private readonly shake = new Shake(200);
  private pixels = new PixelBuffer(0, 0);
  private banner = '';
  private bannerMs = 0;
  private clock = 0;
  private flash = 0;
  private readonly startBest: number;
  private lastPalette: ArcadePalette | undefined;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new PinballState(context.rng.fork('pinball'));
    this.particles = new ParticleSystem(context.rng.fork('pinball-fx'), 160, context.motion.effects);
    this.popups = new Popups(6, context.motion.effects);
    this.trail = new Trail(6, context.motion.reduced ? 'off' : context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.started || this.context.motion.reduced ? 0 : 100; }

  step(dtMs: number): void {
    if (this.done) return;
    const state = this.state;
    state.step(dtMs);
    const layout = layoutFor(this.size.columns, this.size.rows);
    const px = (x: number) => layout.ox + x * layout.scale;
    const py = (y: number) => layout.oy + y * layout.scale;
    if (state.phase === 'play') this.trail.push(px(state.ball.x), py(state.ball.y)); else this.trail.clear();
    const colors = this.accents();
    for (const event of state.events.splice(0)) {
      if (event.kind === 'bumper') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 9, speed: 34, angle: 0, spread: Math.PI, life: 380, drag: 2, colors: [colors[0]!, BALL]});
        this.popups.add(`+${event.points}`, px(event.x), Math.floor(py(event.y) / 2) - 2, BALL, 700);
      } else if (event.kind === 'sling') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 4, speed: 22, angle: -Math.PI / 2, spread: 1.2, life: 260, drag: 2, colors: [colors[1]!, BALL]});
      } else if (event.kind === 'lane') {
        this.popups.add(`+${event.points}`, px(event.x), Math.floor(py(event.y) / 2) + 2, colors[2]!, 700);
      } else if (event.kind === 'multiplier') {
        this.say(`Multiplier x${event.value}`);
        this.flash = this.context.motion.reduced ? 0 : 1;
      } else if (event.kind === 'flipper' && event.speed > 60) {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 3, speed: 16, angle: -Math.PI / 2, spread: 1, life: 220, drag: 2, colors: [STEEL]});
      } else if (event.kind === 'drain') {
        this.say(event.left > 0 ? `Ball lost · ${event.left} left` : 'Game over');
        this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
      } else if (event.kind === 'tilt') this.say('TILT');
      else if (event.kind === 'launch') this.say('');
    }
    if (state.over) this.finish();
  }

  private accents(): Rgb[] {
    const look = arcadeLook(this.lastPalette);
    return [look.hue.coral, look.hue.sky, look.hue.mint, look.hue.butter];
  }

  private say(text: string): void { this.banner = text; this.bannerMs = text ? 1600 : 0; }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {bestMultiplier: state.bestMultiplier});
    const record = state.score > 0 && state.score > this.startBest;
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record,
      details: [`Balls played ${BALLS}`, `Bumper hits ${state.bumperHits}`, `Best multiplier x${state.bestMultiplier}`, `Best ${saved.best.toLocaleString('en-US')}`],
    };
    if (record) confetti(this.particles, this.size.columns, this.size.rows * 2, [...this.accents(), BALL], this.context.motion);
  }

  animate(dtMs: number): void {
    this.clock += dtMs;
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    this.bannerMs = Math.max(0, this.bannerMs - dtMs);
    this.flash = Math.max(0, this.flash - dtMs / 300);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    const dir = direction(key);
    const value = key.kind === 'text' ? key.value.toLowerCase() : '';
    if (dir === 'left' || value === 'z') this.state.flip('left');
    else if (dir === 'right' || value === '/' || value === 'm') this.state.flip('right');
    else if (dir === 'down' || isConfirm(key)) this.state.plunger();
    else if (dir === 'up' || value === 'n') this.state.nudge();
    else return 'ignored';
    this.started = true;
    return 'handled';
  }

  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void {
    this.lastPalette = palette;
    const look = arcadeLook(palette);
    const state = this.state;
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const layout = layoutFor(canvas.width, canvas.height);
    topRow(canvas, look, 'Vespyr Pinball', `Score ${state.score.toLocaleString('en-US')}`);
    if (color) this.drawTable(canvas, look, layout, alpha); else this.drawText(canvas, look, layout);
    const mult = state.multiplier > 1 ? `  x${state.multiplier}` : '';
    const info = state.phase === 'charging' ? `Power [${'#'.repeat(Math.round(state.charge * 8)).padEnd(8, '-')}] Space to launch` : `Ball ${Math.min(BALLS, BALLS - state.ballsLeft + 1)}/${BALLS}${mult}${state.tilted ? '  TILT' : ''}`;
    canvas.text(1, 1, info.slice(0, Math.max(0, canvas.width - 2)), {fg: state.tilted ? look.bad : state.phase === 'charging' ? look.gold : look.text.normal, bold: state.phase === 'charging' || state.tilted});
    if (layout.panel) this.drawPanel(canvas, look, layout);
    this.popups.draw(canvas, look.surface.base);
    const mid = Math.floor(canvas.height / 3);
    const say = (y: number, text: string, style: {fg: Rgb; bold: boolean}) => {
      const tableWidth = Math.round(TABLE_W * layout.scale);
      const room = layout.panel ? Math.max(tableWidth + 6, 32) : canvas.width;
      const left = layout.panel ? Math.max(0, Math.min(layout.ox + Math.floor((tableWidth - room) / 2), layout.ox + tableWidth + 2 - room)) : 0;
      canvas.center(y, truncateText(text, Math.max(1, room - 1)), style, left, layout.panel ? room : canvas.width);
    };
    if (!this.started) {
      say(mid, 'Vespyr Pinball', {fg: look.text.strong, bold: true});
      say(mid + 1, 'Space plunges, Space again launches', {fg: look.accent, bold: true});
      say(mid + 2, '← → flippers  ↑ nudge', {fg: look.text.normal, bold: false});
    } else if (this.bannerMs > 0 && !this.done) say(mid, this.banner, {fg: look.gold, bold: true});
    else if (state.phase === 'lane' && !this.done) say(mid, 'Press Space for the plunger', {fg: look.text.strong, bold: true});
    if (this.done) {
      say(mid, 'GAME OVER', {fg: look.bad, bold: true});
      say(mid + 1, `${state.score.toLocaleString('en-US')}${this.result?.record ? '  *  NEW RECORD  *' : ''}`, {fg: this.result?.record ? look.gold : look.text.strong, bold: true});
    }
  }

  private drawPanel(canvas: Canvas, look: ArcadeLook, layout: Layout): void {
    const x = layout.ox + Math.round(TABLE_W * layout.scale) + 3;
    const state = this.state;
    const score = typeset({role: 'counter', text: String(state.score), maxColumns: 20, maxRows: canvas.height >= 20 ? 2 : 1});
    canvas.text(x, 3, 'SCORE', {fg: look.text.dim});
    canvas.typeBlock(score, x, 4, {fg: look.accent, bold: true});
    const y = 4 + score.rows + 1;
    canvas.text(x, y, `Ball ${Math.min(BALLS, BALLS - state.ballsLeft + 1)} of ${BALLS}`, {fg: look.text.normal});
    canvas.text(x, y + 1, `Multiplier x${state.multiplier}`, {fg: state.multiplier > 1 ? look.gold : look.text.normal, bold: state.multiplier > 1});
    canvas.text(x, y + 2, `Lanes ${state.sensors.map(s => (s.lit ? '[*]' : '[ ]')).join('')}`, {fg: look.text.normal});
    canvas.text(x, y + 4, '← →  flippers', {fg: look.text.dim});
    canvas.text(x, y + 5, 'Space  plunger', {fg: look.text.dim});
    canvas.text(x, y + 6, '↑  nudge', {fg: look.text.dim});
  }

  private drawTable(canvas: Canvas, look: ArcadeLook, layout: Layout, alpha: number): void {
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const state = this.state;
    const [bumperTone, slingTone, laneTone, accent] = this.accents() as [Rgb, Rgb, Rgb, Rgb];
    const x = (v: number) => layout.ox + v * layout.scale;
    const y = (v: number) => layout.oy + v * layout.scale;
    const felt = mixRgb(look.surface.sunken, look.accent, 0.08 + this.flash * 0.25);
    const width = Math.round(TABLE_W * layout.scale), height = Math.round(TABLE_H * layout.scale);
    buffer.rect(layout.ox, layout.oy, width, height, felt);
    // Lane floor stripe so the plunger lane reads as separate.
    buffer.rect(Math.round(x(51.5)), Math.round(y(30)), Math.max(1, Math.round(6.5 * layout.scale)), Math.round(69 * layout.scale), mixRgb(felt, look.surface.base, 0.5));
    for (const segment of SEGMENTS) {
      const kicker = segment.kick > 0;
      buffer.line(x(segment.a.x), y(segment.a.y), x(segment.b.x), y(segment.b.y), kicker ? slingTone : look.text.dim);
    }
    for (const sensor of state.sensors) {
      const r = Math.max(1, Math.round(sensor.r * layout.scale));
      buffer.ellipse(Math.round(x(sensor.x)) - r, Math.round(y(sensor.y)) - r, r * 2, r * 2, sensor.lit ? laneTone : mixRgb(felt, look.text.dim, 0.35));
    }
    for (const bumper of state.bumpers) {
      const r = Math.max(2, Math.round(bumper.r * layout.scale));
      const lit = bumper.lit > 0;
      buffer.ellipse(Math.round(x(bumper.x)) - r, Math.round(y(bumper.y)) - r, r * 2, r * 2, lit ? BALL : bumperTone);
      if (r > 2) buffer.ellipse(Math.round(x(bumper.x)) - r + 1, Math.round(y(bumper.y)) - r + 1, r * 2 - 2, r * 2 - 2, lit ? bumperTone : mixRgb(bumperTone, rgb(0x000000), 0.35));
    }
    for (const flipper of state.flippers) {
      const thickness = Math.max(1, Math.round(FLIPPER_R * layout.scale));
      for (let offset = 0; offset < thickness; offset += 1) buffer.line(x(flipper.pivot.x), y(flipper.pivot.y) + offset, x(flipper.tip.x), y(flipper.tip.y) + offset, flipper.holdMs > 0 ? BALL : accent);
    }
    this.trail.draw(buffer, mixRgb(BALL, felt, 0.4), mixRgb(BALL, felt, 0.9));
    this.particles.draw(buffer, felt);
    const ball = state.ball;
    const bx = x(ball.px + (ball.x - ball.px) * alpha), by = y(ball.py + (ball.y - ball.py) * alpha);
    const r = Math.max(2, Math.round(BALL_R * 2 * layout.scale));
    buffer.ellipse(Math.round(bx - r / 2), Math.round(by - r / 2), r, r, BALL);
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
  }

  /** Without color: walls as | / \ -, bumpers O, flippers as slanted bars, the ball o. */
  private drawText(canvas: Canvas, look: ArcadeLook, layout: Layout): void {
    const state = this.state;
    const cx = (v: number) => Math.round(layout.ox + v * layout.scale);
    const cy = (v: number) => Math.floor((layout.oy + v * layout.scale) / 2);
    const line = (ax: number, ay: number, bx: number, by: number, ch: string | undefined, style: {bold?: boolean} = {}) => {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(cx(bx) - cx(ax)), Math.abs(cy(by) - cy(ay)))));
      const mark = ch ?? (Math.abs(bx - ax) < 0.01 ? '|' : Math.abs(by - ay) < 0.01 ? '-' : (bx - ax) * (by - ay) > 0 ? '\\' : '/');
      for (let step = 0; step <= steps; step += 1) canvas.put(Math.round(cx(ax) + ((cx(bx) - cx(ax)) * step) / steps), Math.round(cy(ay) + ((cy(by) - cy(ay)) * step) / steps), mark, {fg: look.text.normal, ...style});
    };
    for (const segment of SEGMENTS) line(segment.a.x, segment.a.y, segment.b.x, segment.b.y, undefined);
    for (const sensor of state.sensors) canvas.put(cx(sensor.x), cy(sensor.y), sensor.lit ? '*' : '.', {bold: sensor.lit});
    for (const bumper of state.bumpers) canvas.put(cx(bumper.x), cy(bumper.y), bumper.lit > 0 ? '@' : 'O', {bold: true});
    for (const flipper of state.flippers) line(flipper.pivot.x, flipper.pivot.y, flipper.tip.x, flipper.tip.y, '=', {bold: flipper.holdMs > 0});
    const ball = state.ball;
    canvas.put(cx(ball.x), cy(ball.y), 'o', {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; this.trail.clear(); }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'flippers'}, {keys: 'Space', action: 'plunger'}, {keys: '↑', action: 'nudge'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); this.trail.clear(); }
}

/** The hub preview: a ball pinging between three bumpers. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const w = buffer.width, h = buffer.height;
  buffer.rect(0, 0, w, h, mixRgb(look.surface.sunken, look.accent, 0.08));
  const tones = [look.hue.coral, look.hue.sky, look.hue.mint];
  const spots = [[0.25, 0.3], [0.7, 0.3], [0.48, 0.65]] as const;
  spots.forEach(([sx, sy], index) => {
    const r = Math.max(2, Math.round(h * 0.14));
    buffer.ellipse(Math.round(w * sx) - r, Math.round(h * sy) - r, r * 2, r * 2, Math.floor(frame / 3) % 3 === index ? BALL : tones[index]!);
  });
  const t = (frame % 24) / 24;
  const a = spots[Math.floor(frame / 8) % 3]!, b = spots[(Math.floor(frame / 8) + 1) % 3]!;
  const k = clamp(((frame % 8) / 8), 0, 1);
  buffer.rect(Math.round(w * (a[0] + (b[0] - a[0]) * k)), Math.round(h * (a[1] + (b[1] - a[1]) * k + 0.06 * Math.sin(t * 6.28))), 2, 2, BALL);
  canvas.blit(buffer);
}

export const pinballGame: GameDefinition = {
  id: 'pinball', aliases: ['vespyr-pinball'], title: 'Vespyr Pinball', tagline: 'Flippers, bumpers, three balls',
  description: 'A full pinball table: pull the plunger, work the flippers, hit the pop bumpers and slingshots, and light all three lanes to raise the score multiplier.',
  kind: 'action', category: 'physics',
  controls: [{keys: '← →', action: 'flippers'}, {keys: 'Space', action: 'plunger'}, {keys: '↑', action: 'nudge'}],
  howToPlay: [
    'Press Space to start the power meter and Space again to launch the ball. A stronger launch carries it higher.',
    `Press ← and → (or Z and /) to raise the left and right flipper; hold the key to keep it up. Pop bumpers and slingshots score; three lit lanes raise the multiplier (up to x${MAX_MULTIPLIER}) for this ball.`,
    'Press ↑ to nudge the table. Nudge too often and it tilts: the flippers go dead until the ball is lost.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · x${Math.max(1, count(record.bestMultiplier))} best` : 'Not played yet'; },
  preview,
  create: context => new Pinball(context),
};
