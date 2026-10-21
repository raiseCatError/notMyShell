import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {typeset} from '../../../ui/typography.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {confetti} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {rgb} from '../../scenery.js';
import {truncateText} from '../../../util/text.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BALL_R, BALLS, FLIPPER_R, GATE, LANE_WALL_X, LANE_X, MAX_MULTIPLIER, PinballState, RAMP_MOUTH, RAMP_PATH, RAMP_TOTAL, rampPoint, SEGMENTS, TABLE_H, TABLE_W} from './logic.js';

/**
 * Vespyr Pinball: one table, three balls. Pop bumpers and slingshots, three rollover lanes, a bank of drop targets, stand-up
 * targets, a spinner and a ramp that carries the ball over the top; lanes, the drop bank and every third ramp raise the
 * multiplier. A two-press plunger with a swinging power meter (shown filling the shooter lane), a one-way gate so the ball
 * can never go back into the lane, a ball save for the first seconds of each ball, and a nudge that tilts the table if overused.
 * Flippers are tap-triggered strokes, because a terminal sends key presses and never releases. Drawn as a pixel table;
 * without color it becomes a text table (| / \ - walls, O bumpers, # drop targets, = flippers, o ball).
 */
const BALL = rgb(0xfff8ef);
const STEEL = rgb(0xc9c5dc);
const BLACK = rgb(0x000000);
const TRAIL_POINTS = 12;

interface Layout { scale: number; ox: number; oy: number; panel: number }

function layoutFor(columns: number, rows: number): Layout {
  const height = Math.max(8, rows * 2) - 3;
  const scale = Math.min(height / TABLE_H, columns / TABLE_W);
  const width = Math.round(TABLE_W * scale);
  const panel = columns >= width + 26 ? 24 : 0;
  return {scale, ox: Math.floor((columns - width - panel) / 2), oy: 3, panel};
}

const bar = (value: number, cells: number, full = '#', empty = '-') => full.repeat(Math.round(clamp(value, 0, 1) * cells)).padEnd(cells, empty);

class Pinball implements GameInstance {
  result: GameResult | undefined;
  readonly stepsPerSecond = 60;
  private readonly state: PinballState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(200);
  private pixels = new PixelBuffer(0, 0);
  private banner = '';
  private bannerMs = 0;
  private clock = 0;
  private flash = 0;
  private trailPoints: Array<{x: number; y: number}> = [];
  private slingMs: [number, number] = [0, 0];
  private loss: {x: number; ms: number} | undefined;
  private readonly startBest: number;
  private lastPalette: ArcadePalette | undefined;
  private readonly fx: boolean;
  private readonly calm: boolean;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new PinballState(context.rng.fork('pinball'));
    this.fx = context.motion.effects !== 'off';
    this.calm = context.motion.reduced || context.motion.effects === 'off';
    this.particles = new ParticleSystem(context.rng.fork('pinball-fx'), 160, context.motion.effects);
    this.popups = new Popups(6, context.motion.effects);
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
    if (state.phase === 'play' && !this.calm) {
      this.trailPoints.unshift({x: state.ball.x, y: state.ball.y});
      if (this.trailPoints.length > TRAIL_POINTS) this.trailPoints.pop();
    } else this.trailPoints.length = 0;
    this.slingMs = [Math.max(0, this.slingMs[0] - dtMs), Math.max(0, this.slingMs[1] - dtMs)];
    const colors = this.accents();
    const pop = (text: string, x: number, y: number, color: Rgb, life = 750) => this.popups.add(text, px(x), Math.floor(py(y) / 2) - 1, color, life);
    let saved = false;
    for (const event of state.events.splice(0)) {
      if (event.kind === 'bumper') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 9, speed: 34, angle: 0, spread: Math.PI, life: 380, drag: 2, colors: [colors[0]!, BALL]});
        pop(`+${event.points}`, event.x, event.y - 6, BALL, 700);
      } else if (event.kind === 'sling') {
        this.slingMs[event.x < 27 ? 0 : 1] = 200;
        this.particles.burst({x: px(event.x), y: py(event.y), count: 4, speed: 22, angle: -Math.PI / 2, spread: 1.2, life: 260, drag: 2, colors: [colors[1]!, BALL]});
      } else if (event.kind === 'lane') {
        pop(`+${event.points}`, event.x, event.y + 6, colors[2]!);
      } else if (event.kind === 'drop') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 6, speed: 26, angle: 0, spread: Math.PI, life: 320, drag: 2, colors: [colors[3]!, BALL]});
        pop(`+${event.points}`, event.x + 8, event.y, colors[3]!);
      } else if (event.kind === 'target') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 5, speed: 22, angle: Math.PI, spread: 1.4, life: 280, drag: 2, colors: [colors[2]!, BALL]});
        pop(`+${event.points}`, event.x - 8, event.y, colors[2]!);
      } else if (event.kind === 'spinner') {
        if (this.state.spins % 3 === 1) pop(`+${event.points}`, event.x, event.y - 4, colors[3]!, 500);
      } else if (event.kind === 'ramp') {
        this.say(`Ramp  +${event.points}`);
        pop(`+${event.points}`, event.x, event.y - 4, colors[1]!, 900);
      } else if (event.kind === 'bank') {
        this.say(`Drop bank  +${event.points}`);
        this.flash = this.calm ? 0 : 0.7;
      } else if (event.kind === 'multiplier') {
        this.say(`Multiplier x${event.value}`);
        this.flash = this.calm ? 0 : 1;
      } else if (event.kind === 'flipper' && event.speed > 60) {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 3, speed: 16, angle: -Math.PI / 2, spread: 1, life: 220, drag: 2, colors: [STEEL]});
      } else if (event.kind === 'save') { saved = true; this.say('Ball saved'); }
      else if (event.kind === 'recover') this.say(event.how === 'relaunch' ? 'Ball re-served' : 'Ball freed');
      else if (event.kind === 'drain') {
        this.loss = {x: event.x, ms: 900};
        if (!saved) this.say(event.left > 0 ? `Ball lost · ${event.left} left` : 'Game over');
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
      details: [`Balls played ${BALLS}`, `Bumper hits ${state.bumperHits}`, `Drop banks ${state.banks}  Ramps ${state.ramps}`, `Best multiplier x${state.bestMultiplier}`, `Best ${saved.best.toLocaleString('en-US')}`],
    };
    if (record) confetti(this.particles, this.size.columns, this.size.rows * 2, [...this.accents(), BALL], this.context.motion);
  }

  animate(dtMs: number): void {
    this.clock += dtMs;
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    this.bannerMs = Math.max(0, this.bannerMs - dtMs);
    this.flash = Math.max(0, this.flash - dtMs / 400);
    if (this.loss) { this.loss.ms -= dtMs; if (this.loss.ms <= 0) this.loss = undefined; }
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    const dir = direction(key);
    const value = key.kind === 'text' ? key.value.toLowerCase() : '';
    if (dir === 'left' || value === 'z' || value === 'a') this.state.flip('left');
    else if (dir === 'right' || value === '/' || value === 'x' || value === 'l' || value === 'm') this.state.flip('right');
    else if (dir === 'down' || isConfirm(key)) this.state.plunger();
    else if (dir === 'up' || value === 'n') this.state.nudge();
    else return 'ignored';
    this.started = true;
    return 'handled';
  }

  /** A slow glow, 0..1, that holds still under reduced motion or with effects off. */
  private glow(phase = 0): number { return this.calm ? 0.6 : 0.5 + 0.5 * Math.sin(this.clock / 650 + phase); }

  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void {
    this.lastPalette = palette;
    const look = arcadeLook(palette);
    const state = this.state;
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    const safe = this.context.safeGlyphs || this.context.color === 'none';
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const layout = layoutFor(canvas.width, canvas.height);
    topRow(canvas, look, 'Vespyr Pinball', `Score ${state.score.toLocaleString('en-US')}`);
    if (color) this.drawTable(canvas, look, layout, alpha); else this.drawText(canvas, look, layout);
    const mult = state.multiplier > 1 ? ` x${state.multiplier}` : '';
    const drops = layout.panel ? '' : `  Drops ${state.drops.filter(t => !t.up).length}/${state.drops.length}`;
    const info = state.phase === 'charging'
      ? `Power [${bar(state.charge, 8)}] tap Space to launch`
      : `Ball ${Math.min(BALLS, BALLS - state.ballsLeft + 1)}/${BALLS}${mult}${drops}${state.saveMs > 0 ? '  SAVE' : ''}${state.tilted ? '  TILT' : ''}`;
    canvas.text(1, 1, truncateText(info, Math.max(1, canvas.width - 2)), {fg: state.tilted ? look.bad : state.phase === 'charging' ? look.gold : look.text.normal, bold: state.phase === 'charging' || state.tilted});
    if (layout.panel) this.drawPanel(canvas, look, layout, safe);
    this.popups.draw(canvas, look.surface.base);
    const mid = color ? Math.max(3, Math.floor((layout.oy + 54 * layout.scale) / 2)) : Math.floor(canvas.height / 3);
    const say = (y: number, text: string, style: {fg: Rgb; bold: boolean}) => {
      const tableWidth = Math.round(TABLE_W * layout.scale);
      const room = layout.panel ? Math.max(tableWidth + 6, 32) : canvas.width;
      const left = layout.panel ? Math.max(0, Math.min(layout.ox + Math.floor((tableWidth - room) / 2), layout.ox + tableWidth + 2 - room)) : 0;
      canvas.center(y, truncateText(text, Math.max(1, room - 1)), style, left, layout.panel ? room : canvas.width);
    };
    if (!this.started) {
      say(mid, 'Vespyr Pinball', {fg: look.text.strong, bold: true});
      say(mid + 1, 'Space pulls the plunger, Space again launches', {fg: look.accent, bold: true});
      say(mid + 2, safe ? 'Tap Left / Right to flip (one tap, one stroke)' : 'Tap ← → to flip (one tap, one stroke)', {fg: look.text.normal, bold: false});
    } else if (this.bannerMs > 0 && !this.done) say(mid, this.banner, {fg: look.gold, bold: true});
    else if (state.phase === 'lane' && !this.done) say(mid, 'Press Space for the plunger', {fg: look.text.strong, bold: true});
    if (this.done) {
      say(mid, 'GAME OVER', {fg: look.bad, bold: true});
      say(mid + 1, `${state.score.toLocaleString('en-US')}${this.result?.record ? '  *  NEW RECORD  *' : ''}`, {fg: this.result?.record ? look.gold : look.text.strong, bold: true});
    }
  }

  private drawPanel(canvas: Canvas, look: ArcadeLook, layout: Layout, safe: boolean): void {
    const x = layout.ox + Math.round(TABLE_W * layout.scale) + 3;
    const state = this.state;
    const score = typeset({role: 'counter', text: String(state.score), maxColumns: 20, maxRows: canvas.height >= 20 ? 2 : 1});
    canvas.text(x, 3, 'SCORE', {fg: look.text.dim});
    canvas.typeBlock(score, x, 4, {fg: look.accent, bold: true});
    let y = 4 + score.rows + 1;
    const pips = Array.from({length: BALLS}, (_, i) => (i < BALLS - state.ballsLeft ? (safe ? '.' : '○') : (safe ? 'o' : '●'))).join(' ');
    canvas.text(x, y, `Balls ${pips}`, {fg: look.text.normal});
    canvas.text(x, y + 1, `Multiplier x${state.multiplier}`, {fg: state.multiplier > 1 ? look.gold : look.text.normal, bold: state.multiplier > 1});
    canvas.text(x, y + 2, `Lanes ${state.sensors.map(s => (s.lit ? '[*]' : '[ ]')).join('')}`, {fg: look.text.normal});
    canvas.text(x, y + 3, `Drops ${state.drops.map(t => (t.up ? '[ ]' : '[*]')).join('')}`, {fg: look.text.normal});
    canvas.text(x, y + 4, `Ramps ${state.ramps}  Spins ${state.spins}`, {fg: look.text.normal});
    if (state.saveMs > 0) canvas.text(x, y + 5, `Ball save ${Math.ceil(state.saveMs / 1000)}s`, {fg: look.ok});
    y += 7;
    canvas.text(x, y, safe ? 'Left/Right: tap to flip' : '← →  tap to flip', {fg: look.text.dim});
    canvas.text(x, y + 1, 'Z and / also flip', {fg: look.text.dim});
    canvas.text(x, y + 2, 'Space  plunger', {fg: look.text.dim});
    canvas.text(x, y + 3, safe ? 'Up  nudge' : '↑  nudge', {fg: look.text.dim});
  }

  private drawTable(canvas: Canvas, look: ArcadeLook, layout: Layout, alpha: number): void {
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const state = this.state;
    const [bumperTone, slingTone, laneTone, gold] = this.accents() as [Rgb, Rgb, Rgb, Rgb];
    const X = (v: number) => layout.ox + v * layout.scale;
    const Y = (v: number) => layout.oy + v * layout.scale;
    const S = layout.scale;
    const felt = mixRgb(look.surface.sunken, look.accent, 0.08 + this.flash * 0.22);
    const wall = mixRgb(STEEL, look.text.dim, 0.35);
    const width = Math.round(TABLE_W * S), height = Math.round(TABLE_H * S);
    buffer.rect(layout.ox, layout.oy, width, height, felt);
    // A faint lit inset so the table has depth: darker toward the bottom.
    for (let row = 0; row < height; row += 2) buffer.rect(layout.ox, layout.oy + row, width, 1, mixRgb(felt, BLACK, 0.06 + 0.1 * (row / height)));
    // The shooter lane, with the launch meter filling it from the floor.
    const laneX = Math.round(X(LANE_WALL_X)), laneW = Math.max(1, Math.round((58 - LANE_WALL_X) * S));
    const laneTop = Math.round(Y(30)), laneBottom = Math.round(Y(99));
    buffer.rect(laneX, laneTop, laneW, laneBottom - laneTop, mixRgb(felt, look.surface.base, 0.55));
    if (state.phase === 'charging' || state.phase === 'lane') {
      const level = state.phase === 'charging' ? state.charge : 0;
      const fill = Math.round((laneBottom - laneTop) * level);
      for (let row = 0; row < fill; row += 1) {
        const t = row / Math.max(1, laneBottom - laneTop);
        buffer.rect(laneX, laneBottom - 1 - row, laneW, 1, t < 0.4 ? laneTone : t < 0.75 ? gold : bumperTone);
      }
      for (let tick = 0; tick <= 4; tick += 1) buffer.set(laneX - 1, laneBottom - 1 - ((laneBottom - laneTop) * tick) / 4, STEEL);
    }
    // The ramp's path, drawn as a pipe over the table with chevrons running along it.
    const pipe = mixRgb(slingTone, felt, 0.8), pipeEdge = mixRgb(slingTone, felt, 0.5);
    for (let i = 1; i < RAMP_PATH.length; i += 1) {
      const a = RAMP_PATH[i - 1]!, b = RAMP_PATH[i]!;
      if (S >= 0.8) { buffer.line(X(a.x), Y(a.y) - 1, X(b.x), Y(b.y) - 1, pipe); buffer.line(X(a.x), Y(a.y) + 1, X(b.x), Y(b.y) + 1, pipe); }
      buffer.line(X(a.x), Y(a.y), X(b.x), Y(b.y), pipeEdge);
    }
    for (let k = 0; k < 4 && !this.calm; k += 1) {
      const at = rampPoint(((this.clock / 1400 + k / 4) % 1) * RAMP_TOTAL);
      buffer.set(X(at.x), Y(at.y), mixRgb(BALL, slingTone, 0.4));
    }
    const mouthOn = state.rampAt !== undefined;
    const mr = Math.max(2, Math.round(RAMP_MOUTH.r * S));
    buffer.ellipse(Math.round(X(RAMP_MOUTH.x)) - mr, Math.round(Y(RAMP_MOUTH.y)) - mr, mr * 2, mr * 2, mouthOn ? BALL : pipeEdge);
    buffer.ellipse(Math.round(X(RAMP_MOUTH.x)) - mr + 1, Math.round(Y(RAMP_MOUTH.y)) - mr + 1, Math.max(1, mr * 2 - 2), Math.max(1, mr * 2 - 2), mouthOn ? slingTone : felt);
    for (const segment of SEGMENTS) {
      const kicker = segment.kick > 0;
      const left = segment.a.x < 27;
      const flashing = kicker && this.slingMs[left ? 0 : 1] > 0;
      buffer.line(X(segment.a.x), Y(segment.a.y), X(segment.b.x), Y(segment.b.y), flashing ? BALL : kicker ? mixRgb(slingTone, felt, 0.5) : segment === GATE ? gold : wall);
    }
    // Rollover lights: lit ones glow gently; unlit ones are dim rings with a slow pulse when motion is on.
    state.sensors.forEach((sensor, index) => {
      const r = Math.max(1, Math.round(sensor.r * S));
      const tone = sensor.lit ? mixRgb(laneTone, BALL, 0.25 * this.glow(index)) : mixRgb(felt, look.text.dim, 0.28 + 0.1 * this.glow(index * 2));
      buffer.ellipse(Math.round(X(sensor.x)) - r, Math.round(Y(sensor.y)) - r, r * 2, r * 2, tone);
    });
    // Stand-up targets and drop targets.
    for (const target of state.standups) {
      const lit = target.hitMs > 0;
      for (const offset of [0, 1]) buffer.line(X(target.seg.a.x), Y(target.seg.a.y) + offset, X(target.seg.b.x), Y(target.seg.b.y) + offset, lit ? BALL : laneTone);
    }
    state.drops.forEach((target, index) => {
      const tone = target.hitMs > 0 ? BALL : index % 2 ? gold : bumperTone;
      const x = Math.round(X(target.seg.a.x));
      if (target.up) { buffer.rect(x - 1, Math.round(Y(target.seg.a.y)), 2, Math.max(2, Math.round((target.seg.b.y - target.seg.a.y) * S)), tone); }
      else buffer.rect(x - 1, Math.round(Y(target.seg.b.y)) - 1, 2, 1, mixRgb(tone, felt, 0.6));
    });
    // The spinner: a bar that foreshortens as it turns.
    const sp = state.spinner;
    const half = Math.max(1, sp.half * S * Math.abs(Math.cos(sp.angle)));
    buffer.line(X(sp.x) - half, Y(sp.y), X(sp.x) + half, Y(sp.y), Math.abs(sp.omega) > 1 ? BALL : gold);
    buffer.set(X(sp.x) - sp.half * S, Y(sp.y), look.text.dim); buffer.set(X(sp.x) + sp.half * S, Y(sp.y), look.text.dim);
    // Bumpers, with an impact ring that expands while lit.
    for (const bumper of state.bumpers) {
      const r = Math.max(2, Math.round(bumper.r * S));
      const lit = bumper.lit > 0;
      const cx = Math.round(X(bumper.x)), cy = Math.round(Y(bumper.y));
      if (lit && this.fx && !this.calm) {
        const grow = 1 - bumper.lit / 260, ring = r + 1 + Math.round(grow * 2 * Math.max(1, S * 2));
        buffer.ellipse(cx - ring, cy - ring, ring * 2, ring * 2, mixRgb(bumperTone, felt, 0.45 + 0.4 * grow));
        buffer.ellipse(cx - ring + 1, cy - ring + 1, ring * 2 - 2, ring * 2 - 2, felt);
      }
      buffer.ellipse(cx - r, cy - r, r * 2, r * 2, lit ? BALL : bumperTone);
      if (r > 2) buffer.ellipse(cx - r + 1, cy - r + 1, r * 2 - 2, r * 2 - 2, lit ? bumperTone : mixRgb(bumperTone, BLACK, 0.35));
      buffer.set(cx, cy, lit ? BALL : mixRgb(bumperTone, BALL, 0.35));
    }
    for (const flipper of state.flippers) {
      const up = flipper.holdMs > 0;
      const thickness = Math.max(2, Math.round(FLIPPER_R * 2.4 * S));
      for (let offset = 0; offset < thickness; offset += 1) buffer.line(X(flipper.pivot.x), Y(flipper.pivot.y) + offset - 1, X(flipper.tip.x), Y(flipper.tip.y) + offset - 1, up ? (offset === 0 ? BALL : mixRgb(BALL, gold, 0.5)) : offset === 0 ? mixRgb(gold, BALL, 0.35) : gold);
      buffer.set(X(flipper.pivot.x), Y(flipper.pivot.y), STEEL);
    }
    // The ball and its trail.
    const ball = state.ball;
    if (this.trailPoints.length > 1) {
      for (let i = 1; i < this.trailPoints.length; i += 1) {
        const a = this.trailPoints[i - 1]!, b = this.trailPoints[i]!;
        buffer.line(X(a.x), Y(a.y), X(b.x), Y(b.y), mixRgb(mixRgb(BALL, slingTone, 0.3), felt, 0.1 + (0.8 * i) / this.trailPoints.length));
      }
    }
    this.particles.draw(buffer, felt);
    if (state.phase !== 'drained') {
      const pull = state.phase === 'charging' ? state.charge * 4 : 0;
      const bx = X(ball.px + (ball.x - ball.px) * alpha), by = Y(ball.py + (ball.y - ball.py) * alpha + pull);
      const r = Math.max(3, Math.round(BALL_R * 2 * S));
      if (state.rampAt !== undefined) buffer.ellipse(Math.round(bx - r / 2) - 1, Math.round(by - r / 2) - 1, r + 2, r + 2, mixRgb(BALL, slingTone, 0.5));
      buffer.ellipse(Math.round(bx - r / 2), Math.round(by - r / 2), r, r, BALL);
      buffer.set(bx - r / 4, by - r / 4, rgb(0xffffff));
      buffer.set(bx + r / 4, by + r / 4, STEEL);
      if (state.phase === 'charging' || state.phase === 'lane') buffer.rect(laneX + Math.floor(laneW / 2), Math.round(by + r / 2), 1, Math.max(1, laneBottom - Math.round(by + r / 2)), STEEL);
    }
    if (this.loss && this.fx) {
      // Ball lost: it sinks between the flippers, shrinking, while a red wash and ring spread from the drain.
      const t = 1 - this.loss.ms / 900;
      const lx = X(clamp(this.loss.x, 14, 40)), ly = Y(96 + t * 8);
      const r = Math.max(1, Math.round(BALL_R * 2 * S * (1 - t * 0.8)));
      if (!this.calm) {
        const ring = Math.round(t * 14 * S + 2);
        buffer.ellipse(Math.round(lx) - ring, Math.round(Y(100)) - ring, ring * 2, ring * 2, mixRgb(bumperTone, felt, 0.4 + 0.5 * t));
        buffer.ellipse(Math.round(lx) - ring + 1, Math.round(Y(100)) - ring + 1, ring * 2 - 2, ring * 2 - 2, felt);
        buffer.ellipse(Math.round(lx - r / 2), Math.round(ly - r / 2), r, r, mixRgb(BALL, bumperTone, t));
      }
      buffer.rect(layout.ox, Math.round(Y(99)), width, 1, mixRgb(bumperTone, felt, 0.35 + 0.5 * t));
    }
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
  }

  /** Without color: walls as | / \ -, bumpers O, targets #, spinner - \ | /, flippers =, the ball o. */
  private drawText(canvas: Canvas, look: ArcadeLook, layout: Layout): void {
    const state = this.state;
    const cx = (v: number) => Math.round(layout.ox + v * layout.scale);
    const cy = (v: number) => Math.floor((layout.oy + v * layout.scale) / 2);
    const line = (ax: number, ay: number, bx: number, by: number, ch: string | undefined, style: {bold?: boolean} = {}) => {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(cx(bx) - cx(ax)), Math.abs(cy(by) - cy(ay)))));
      const mark = ch ?? (Math.abs(bx - ax) < 0.01 ? '|' : Math.abs(by - ay) < 0.01 ? '-' : (bx - ax) * (by - ay) > 0 ? '\\' : '/');
      for (let step = 0; step <= steps; step += 1) canvas.put(Math.round(cx(ax) + ((cx(bx) - cx(ax)) * step) / steps), Math.round(cy(ay) + ((cy(by) - cy(ay)) * step) / steps), mark, {fg: look.text.normal, ...style});
    };
    // The ramp path as dots, then the walls over it.
    for (let i = 1; i < RAMP_PATH.length; i += 1) line(RAMP_PATH[i - 1]!.x, RAMP_PATH[i - 1]!.y, RAMP_PATH[i]!.x, RAMP_PATH[i]!.y, '.');
    canvas.put(cx(RAMP_MOUTH.x), cy(RAMP_MOUTH.y), '^', {bold: state.rampAt !== undefined});
    for (const segment of SEGMENTS) line(segment.a.x, segment.a.y, segment.b.x, segment.b.y, segment === GATE ? ',' : undefined);
    // The plunger lane's power meter: the lane fills with # from the floor.
    const laneCol = cx(LANE_X), floor = cy(98), top = cy(32);
    if (state.phase === 'charging') for (let row = 0; row < Math.round((floor - top) * state.charge); row += 1) canvas.put(laneCol, floor - row, '#', {bold: true});
    for (const sensor of state.sensors) canvas.put(cx(sensor.x), cy(sensor.y), sensor.lit ? '*' : '.', {bold: sensor.lit});
    for (const target of state.standups) line(target.seg.a.x, target.seg.a.y, target.seg.b.x, target.seg.b.y, '+', {bold: target.hitMs > 0});
    for (const target of state.drops) {
      if (target.up) line(target.seg.a.x, target.seg.a.y, target.seg.b.x, target.seg.b.y, '#', {bold: target.hitMs > 0});
      else canvas.put(cx(target.seg.a.x), cy(target.seg.b.y), '_');
    }
    const turn = Math.floor(((state.spinner.angle % Math.PI) + Math.PI) % Math.PI / (Math.PI / 4)) % 4;
    canvas.put(cx(state.spinner.x), cy(state.spinner.y), ['-', '\\', '|', '/'][turn]!, {bold: Math.abs(state.spinner.omega) > 1});
    for (const bumper of state.bumpers) canvas.put(cx(bumper.x), cy(bumper.y), bumper.lit > 0 ? '@' : 'O', {bold: true});
    for (const flipper of state.flippers) line(flipper.pivot.x, flipper.pivot.y, flipper.tip.x, flipper.tip.y, '=', {bold: flipper.holdMs > 0});
    const ball = state.ball;
    if (state.phase !== 'drained') canvas.put(cx(ball.x), cy(ball.y + (state.phase === 'charging' ? state.charge * 4 : 0)), 'o', {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; this.trailPoints.length = 0; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'tap to flip'}, {keys: 'Space', action: 'plunger'}, {keys: '↑', action: 'nudge'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); this.trailPoints.length = 0; }
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
  description: 'A full pinball table: pull the plunger, tap the flippers, hit the pop bumpers, clear the drop targets, spin the spinner and ride the ramp to raise the score multiplier.',
  kind: 'action', category: 'physics',
  controls: [{keys: '← → / Z /', action: 'tap to flip'}, {keys: 'Space', action: 'plunger (tap, tap)'}, {keys: '↑', action: 'nudge'}],
  howToPlay: [
    'Press Space to start the power meter (it fills the lane at the right) and Space again to launch. A stronger launch carries the ball higher; a one-way gate stops it ever returning to the lane.',
    `A terminal cannot tell when a key is released, so each tap is one flipper stroke: ← or Z or A for the left, → or / or X or L for the right. Time your taps; holding a key will not hold the flipper.`,
    `Bumpers, slingshots, targets and the spinner score. Light all three top lanes, clear the drop-target bank, or ride the ramp three times to raise the multiplier (up to x${MAX_MULTIPLIER}) for this ball. The first seconds of each ball are protected by a ball save.`,
    'Press ↑ to nudge the table. Nudge too often and it tilts: the flippers go dead until the ball is lost.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · x${Math.max(1, count(record.bestMultiplier))} best` : 'Not played yet'; },
  preview,
  create: context => new Pinball(context),
};
