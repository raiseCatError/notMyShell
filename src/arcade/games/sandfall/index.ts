import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {confetti} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, distinctColors, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, hash, rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {COLORS, SHAPES, SandState, dimensionsFor, type Piece} from './logic.js';

/**
 * Sandfall: Sandtris. Pieces fall as solid blocks and turn into grains of their color when they land; the grains pour
 * and settle, and a single color connected from the left wall to the right wall dissolves. Each color also has its own
 * texture in the pixel view and its own glyph in the text view, so no color is told apart by hue alone.
 */
const NIGHT = [rgb(0x0e0a24), rgb(0x1d1540)];
const SAFE_GLYPHS = ['#', '%', '+', ':'] as const;
const BLOCK_GLYPHS = ['█', '▓', '▒', '░'] as const;
const OVER_MS = 900;

interface View { left: number; top: number; width: number; height: number }

class Sandfall implements GameInstance {
  result: GameResult | undefined;
  readonly stepsPerSecond = 60;
  private readonly state: SandState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(180);
  private pixels = new PixelBuffer(0, 0);
  private endMs = -1;
  private clock = 0;
  private banner = '';
  private bannerMs = 0;
  private readonly startBest: number;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new SandState(context.rng.fork('sand'), dimensionsFor(context.size.columns, context.size.rows));
    this.particles = new ParticleSystem(context.rng.fork('sand-fx'), 200, context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return 0; }

  private view(columns = this.size.columns, rows = this.size.rows): View {
    const {width, height} = this.state;
    return {left: Math.max(0, Math.floor((columns - width) / 2)), top: 2 + 2 * Math.floor(Math.max(0, rows - 2 - height / 2) / 2), width, height};
  }

  step(dtMs: number): void {
    if (this.done || !this.started) return;
    if (this.state.over && this.endMs >= 0) {
      this.endMs -= dtMs;
      if (this.endMs <= 0) this.finish();
      return;
    }
    this.clock += dtMs;
    this.state.step(dtMs);
    const view = this.view();
    const colors = distinctColors(COLORS, arcadeLook());
    for (const event of this.state.events.splice(0)) {
      if (event.kind === 'clear') {
        const stride = Math.max(1, Math.floor(event.grains.length / 40));
        let sx = 0, sy = 0;
        event.grains.forEach((index, order) => {
          const x = index % view.width, y = Math.floor(index / view.width);
          sx += x; sy += y;
          if (order % stride === 0) {
            const color = colors[(event.colors[order] ?? 1) - 1]!;
            this.particles.burst({x: view.left + x, y: view.top + y, count: 1, speed: 26, life: 600, gravity: 60, drag: 0.7, colors: [color, mixRgb(color, rgb(0xffffff), 0.5)]});
          }
        });
        const n = Math.max(1, event.grains.length);
        this.popups.add(`+${event.points}`, view.left + sx / n, (view.top + sy / n) / 2, rgb(0xffe08a), 900);
        this.say(event.chain > 1 ? `Chain ×${event.chain} · +${event.points}` : `Clear · +${event.points}`);
        if (event.chain >= 2) this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
      } else if (event.kind === 'over') {
        this.endMs = this.context.motion.reduced ? 300 : OVER_MS;
        if (this.state.score > 0 && this.state.score > this.startBest) confetti(this.particles, this.size.columns, this.size.rows * 2, colors, this.context.motion);
      }
    }
  }

  private say(text: string): void { this.banner = text; this.bannerMs = 1600; }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {bestClears: state.clears});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`Pieces ${state.pieces}`, `Clears ${state.clears}`, `Level ${state.level}`, `Best ${saved.best.toLocaleString('en-US')}`, `Games ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    this.bannerMs = Math.max(0, this.bannerMs - dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    const state = this.state;
    const dir = direction(key);
    const text = key.kind === 'text' ? key.value.toLowerCase() : '';
    let handled = true;
    if (dir === 'left') { if (!state.over) state.shift(-1); }
    else if (dir === 'right') { if (!state.over) state.shift(1); }
    else if (dir === 'up' || text === 'x') { if (!state.over) state.rotate(1); }
    else if (text === 'z') { if (!state.over) state.rotate(-1); }
    else if (dir === 'down') { if (!state.over) state.drop(state.cell); }
    else if (isConfirm(key)) { if (!state.over) state.hardDrop(); }
    else handled = false;
    if (handled) this.started = true;
    return handled ? 'handled' : 'ignored';
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    const state = this.state;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    topRow(canvas, look, `Sandfall · level ${state.level}`, `Score ${state.score.toLocaleString('en-US')}  Next ${state.next.name}`);
    const view = this.view(canvas.width, canvas.height);
    const colors = distinctColors(COLORS, look);
    if (color) this.drawPixels(canvas, view, look, colors);
    else this.drawText(canvas, view, look, colors);
    this.popups.draw(canvas, NIGHT[1]);
    const message = !this.started ? '← → move  ·  ↑ turn  ·  Space drops' : this.bannerMs > 0 ? this.banner : '';
    if (message && canvas.height > 6) canvas.center(Math.max(1, Math.floor(view.top / 2) + 1), message, {fg: look.text.strong, bold: true});
  }

  private grain(base: Rgb, colorIndex: number, x: number, y: number): Rgb {
    const jitter = (hash(x * 7919 + y * 104729) % 5) / 5 - 0.4;
    let tone = jitter > 0 ? mixRgb(base, rgb(0xffffff), jitter * 0.22) : mixRgb(base, rgb(0x000000), -jitter * 0.3);
    const dark = mixRgb(base, rgb(0x000000), 0.38);
    const light = mixRgb(base, rgb(0xffffff), 0.45);
    if (colorIndex === 1 && (x + y) % 3 === 0) tone = dark;
    else if (colorIndex === 2 && x % 2 === 0 && y % 2 === 0) tone = light;
    else if (colorIndex === 3 && y % 3 === 0) tone = dark;
    return tone;
  }

  private drawPixels(canvas: Canvas, view: View, look: ArcadeLook, colors: Rgb[]): void {
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const state = this.state;
    gradient(buffer, [look.surface.sunken, mixRgb(look.surface.sunken, NIGHT[1]!, 0.7)], view.top, view.top + view.height);
    for (let y = view.top; y < view.top + view.height; y += 1) for (let x = 0; x < buffer.width; x += 1) if (x < view.left || x >= view.left + view.width) buffer.set(x, y, undefined);
    const flash = this.context.motion.reduced ? true : Math.floor(this.clock / 90) % 2 === 0;
    for (let y = 0; y < view.height; y += 1) {
      for (let x = 0; x < view.width; x += 1) {
        const c = state.grid[y * view.width + x]!;
        if (!c) continue;
        const base = colors[c - 1]!;
        const marked = state.phase === 'clear' && state.marked.has(y * view.width + x);
        buffer.set(view.left + x, view.top + y, marked ? (flash ? rgb(0xffffff) : mixRgb(base, rgb(0xffffff), 0.6)) : this.grain(base, c - 1, x, y));
      }
    }
    if (state.piece) this.pieceGrains(state.piece, state.cell, (x, y, rim) => {
      const base = colors[state.piece!.color - 1]!;
      buffer.set(view.left + x, view.top + y, rim ? mixRgb(base, rgb(0xffffff), 0.65) : this.grain(base, state.piece!.color - 1, x, y));
    });
    this.nextPreview(buffer, view, colors);
    const wall = look.surface.edge;
    for (let y = view.top - 1; y <= view.top + view.height; y += 1) { buffer.set(view.left - 1, y, wall); buffer.set(view.left + view.width, y, wall); }
    for (let x = view.left - 1; x <= view.left + view.width; x += 1) buffer.set(x, view.top + view.height, wall);
    this.particles.draw(buffer, NIGHT[1]);
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
  }

  private nextPreview(buffer: PixelBuffer, view: View, colors: Rgb[]): void {
    const room = buffer.width - (view.left + view.width + 3);
    if (room < 9) return;
    const unit = 2;
    const color = colors[this.state.next.color - 1]!;
    for (const [cx, cy] of SHAPES[this.state.next.name]!) {
      for (let dy = 0; dy < unit; dy += 1) for (let dx = 0; dx < unit; dx += 1) {
        const x = cx * unit + dx, y = cy * unit + dy;
        buffer.set(view.left + view.width + 3 + x, view.top + 3 + y, this.grain(color, this.state.next.color - 1, x, y));
      }
    }
  }

  /** Calls `paint(x, y, rim)` for every grain of the falling piece, in well coordinates; `rim` marks its outline. */
  private pieceGrains(piece: Piece, k: number, paint: (x: number, y: number, rim: boolean) => void): void {
    const has = (cx: number, cy: number) => piece.cells.some(c => c[0] === cx && c[1] === cy);
    for (const [cx, cy] of piece.cells) {
      for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) {
        const rim = (dx === 0 && !has(cx - 1, cy)) || (dx === k - 1 && !has(cx + 1, cy)) || (dy === 0 && !has(cx, cy - 1)) || (dy === k - 1 && !has(cx, cy + 1));
        paint(piece.x + cx * k + dx, piece.y + cy * k + dy, rim);
      }
    }
  }

  /** Text mode: a cell holds two grains of height; its glyph names the color of the lower grain, else the upper. */
  private drawText(canvas: Canvas, view: View, look: ArcadeLook, colors: Rgb[]): void {
    const tint = this.context.color !== 'none';
    const glyphs = this.context.safeGlyphs ? SAFE_GLYPHS : BLOCK_GLYPHS;
    const state = this.state;
    const top = Math.floor(view.top / 2);
    const rows = Math.ceil(view.height / 2);
    const flash = this.context.motion.reduced ? true : Math.floor(this.clock / 90) % 2 === 0;
    const edge = {fg: tint ? look.surface.edge : undefined, bold: true};
    for (let r = 0; r <= rows; r += 1) { canvas.put(view.left - 1, top + r, '|', edge); canvas.put(view.left + view.width, top + r, '|', edge); }
    for (let x = view.left - 1; x <= view.left + view.width; x += 1) canvas.put(x, top + rows, '=', edge);
    const occupant = new Map<number, {c: number; piece: boolean}>();
    const pick = (x: number, r: number): number => {
      const lower = state.at(x, Math.min(view.height - 1, r * 2 + 1)), upper = state.at(x, r * 2);
      return lower || upper;
    };
    for (let r = 0; r < rows; r += 1) {
      for (let x = 0; x < view.width; x += 1) {
        const c = pick(x, r);
        if (!c) continue;
        const marked = state.phase === 'clear' && (state.marked.has((r * 2) * view.width + x) || state.marked.has((r * 2 + 1) * view.width + x));
        canvas.put(view.left + x, top + r, marked && flash ? '*' : glyphs[c - 1]!, {fg: tint ? colors[c - 1] : undefined});
      }
    }
    if (state.piece) {
      const piece = state.piece;
      this.pieceGrains(piece, state.cell, (x, y) => occupant.set((y >> 1) * view.width + x, {c: piece.color, piece: true}));
      for (const [index, o] of occupant) canvas.put(view.left + (index % view.width), top + Math.floor(index / view.width), glyphs[o.c - 1]!, {fg: tint ? colors[o.c - 1] : undefined, bold: true, reverse: true});
    }
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'move'}, {keys: '↑ Z', action: 'turn'}, {keys: '↓', action: 'soft drop'}, {keys: 'Space', action: 'drop'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: layered sand with a block settling on top. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const colors = distinctColors(COLORS, look);
  const w = Math.min(canvas.width - 2, 24);
  const left = Math.floor((canvas.width - w) / 2);
  const h = canvas.height * 2;
  buffer.rect(left, 0, w, h, look.surface.sunken);
  const bands = [0, 1, 2, 0, 3];
  bands.forEach((c, i) => buffer.rect(left, h - 2 - (i + 1) * 2, w, 2, colors[c]!));
  const y = (frame * 2) % Math.max(4, h - 14);
  buffer.rect(left + 4 + (Math.floor(frame / 12) % 3) * 4, y, 6, 4, colors[(Math.floor(frame / 12)) % COLORS]!);
  canvas.blit(buffer);
}

export const sandfallGame: GameDefinition = {
  id: 'sandfall', aliases: ['sandtris', 'sand'], title: 'Sandfall', tagline: 'Pour a wall of color',
  description: 'Falling pieces turn to sand when they land. Build a single color from the left wall to the right wall and the whole mass clears, with chains for what falls next.',
  kind: 'action', category: 'falling',
  controls: [{keys: '← →', action: 'move'}, {keys: '↑ Z', action: 'turn'}, {keys: 'Space', action: 'drop'}],
  howToPlay: [
    'Move the piece with the arrows (or A D, h l), turn it with Up or X (Z turns back), nudge it down with Down and drop it with Space.',
    'A landed piece becomes grains of its color that pour into the gaps. Colors are told apart by texture and glyph as well as hue.',
    'When one color is connected from the left wall to the right wall, all of it clears. Sand that falls into a new span chains for more points.',
    'The game ends when a new piece has no room at the top.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · ${count(record.bestClears)} clears` : 'Not played yet'; },
  preview,
  create: context => new Sandfall(context),
};
