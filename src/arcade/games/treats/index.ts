import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {truncateText} from '../../../util/text.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import {ParticleSystem} from '../../effects.js';
import {cellAt, cellOrigin, squareLayout, type BoardLayout} from '../../engine/boardLayout.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BOMB, HEIGHT, KINDS, MOVES, STARS, starsFor, STRIPE_COL, STRIPE_ROW, TreatBoard, WIDTH, type Mark, type Step} from './logic.js';
import {INK, KIND_COLORS, KIND_LETTERS, KIND_NAMES, KIND_SHAPES, SPRITES, spriteColor} from './sprites.js';

/**
 * Treat Match: swap neighbouring treats to line up three or more. Each kind has its own color and its own silhouette
 * (pixel art where the tiles are big enough, a shape glyph on small boards, a letter when color or glyphs are off), so no
 * match depends on telling hues apart. A swap slides the two tiles across each other (and back when it makes no match),
 * cleared tiles pop and shrink, the rest fall to their new rows and cascades follow one step at a time; any key skips to
 * the end. A line of four makes a striped treat (clears its row or column), five or a T/L a bomb (clears a whole kind).
 *
 * Reduced Motion and Effects Off play none of it: the board settles at once.
 */
const SWAP_MS = 130;
const CLEAR_MS = 200;
const FALL_MS_PER_ROW = 55;
const FALL_MIN_MS = 110;
const WHITE = rgb(0xffffff);
const GOLD = rgb(0xffd166);

type Phase =
  | {kind: 'swap'; a: number; b: number; t: number; dur: number; back: boolean}
  | {kind: 'clear'; step: Step; t: number; dur: number}
  | {kind: 'fall'; step: Step; t: number; dur: number};

/** A tile to draw: its kind and mark at a (fractional) cell position, scale and flash. */
interface Tile { cell: number; kind: number; mark: Mark; x: number; y: number; scale: number; flash: number }

interface Pop { text: string; cell: number; age: number; life: number; color: Rgb }

class TreatMatch implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private board: TreatBoard;
  /** What is on the board right now as the person sees it (changes as the animation plays). */
  private shown: number[];
  private shownMarks: Mark[];
  private cursor = 0;
  private selected: number | undefined;
  private phases: Phase[] = [];
  private started = false;
  private over = false;
  private hintCells: [number, number] | undefined;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private pops: Pop[] = [];
  private pixels = new PixelBuffer(0, 0);
  private readonly startBest: number;
  private shownScore = 0;
  private note = '';
  private noteLeft = 0;
  private clock = 0;
  private wave: Reveal | undefined;
  private bursts: number[] = [];

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.board = new TreatBoard(context.rng.fork('treats'));
    this.shown = this.board.cells.slice();
    this.shownMarks = this.board.marks.slice();
    this.particles = new ParticleSystem(context.rng.fork('treats-fx'), 160, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.over ? 'over' : this.started ? 'playing' : 'ready'; }
  get finale(): Finale | undefined { return this.over ? this.wave : undefined; }
  get refreshMs(): number { return this.phases.length || this.particles.count || this.pops.length || this.bursts.length || (this.wave && !this.wave.done) || this.noteLeft > 0 || this.hasSpecials ? 30 : 0; }
  private get busy(): boolean { return this.phases.length > 0; }
  private get still(): boolean { return this.context.motion.reduced || this.context.motion.effects === 'off'; }
  private get hasSpecials(): boolean { return !this.still && this.shownMarks.some(mark => mark === BOMB); }

  step(): void {}

  animate(dtMs: number): void {
    this.clock += dtMs;
    this.particles.update(dtMs);
    this.wave?.update(dtMs);
    this.pops = this.pops.filter(pop => (pop.age += dtMs) < pop.life);
    if (this.noteLeft > 0) this.noteLeft = Math.max(0, this.noteLeft - dtMs);
    if (this.bursts.length) {
      this.bursts = this.bursts.map(left => left - dtMs);
      while (this.bursts.length && this.bursts[0]! <= 0) { this.bursts.shift(); this.celebrate(); }
    }
    let left = dtMs;
    while (this.phases.length && left >= 0) {
      const phase = this.phases[0]!;
      phase.t += left;
      if (phase.t < phase.dur) break;
      left = phase.t - phase.dur;
      this.endPhase(this.phases.shift()!);
      if (this.phases.length) this.startPhase(this.phases[0]!);
      else { this.settleDone(); break; }
    }
  }

  private startPhase(phase: Phase): void {
    if (phase.kind !== 'clear') return;
    const step = phase.step;
    this.shownScore += step.gained;
    const middle = step.cleared[Math.floor(step.cleared.length / 2)]!;
    this.pop(step.chain > 1 ? `+${step.gained} x${step.chain}` : `+${step.gained}`, middle, KIND_COLORS[this.shown[middle]! % KINDS]!, 800);
    const layout = this.layout();
    if (layout && !this.still) {
      for (const cell of step.cleared) {
        const o = cellOrigin(layout, cell % WIDTH, Math.floor(cell / WIDTH));
        this.particles.burst({x: o.x + layout.cellW / 2, y: (o.y + layout.cellH / 2) * 2, count: step.triggered.length ? 3 : 2, speed: 18, angle: -Math.PI / 2, spread: Math.PI, life: 420, gravity: 30, drag: 0.5, colors: [KIND_COLORS[this.shown[cell]! % KINDS]!, WHITE]});
      }
    }
  }

  private endPhase(phase: Phase): void {
    if (phase.kind === 'swap') {
      if (!phase.back) { [this.shown[phase.a], this.shown[phase.b]] = [this.shown[phase.b]!, this.shown[phase.a]!]; [this.shownMarks[phase.a], this.shownMarks[phase.b]] = [this.shownMarks[phase.b]!, this.shownMarks[phase.a]!]; }
    } else if (phase.kind === 'clear') {
      this.shown = phase.step.after.slice(); this.shownMarks = phase.step.afterMarks.slice();
      // The fall that follows shows the finished board with each moved tile still on its way down.
    }
  }

  private settleDone(): void {
    this.shown = this.board.cells.slice();
    this.shownMarks = this.board.marks.slice();
    this.shownScore = this.board.score;
    this.hintCells = undefined;
    if (this.board.over) this.finish();
  }

  private skip(): void {
    this.phases = [];
    this.settleDone();
  }

  private pop(text: string, cell: number, color: Rgb, life = 700): void {
    if (this.context.motion.effects === 'off') return;
    this.pops.push({text, cell, age: 0, life, color});
    if (this.pops.length > 6) this.pops.shift();
  }

  private say(text: string): void { this.note = text; this.noteLeft = 1400; }

  key(key: Key): GameKeyResult {
    if (this.over) { this.wave?.skip(); this.bursts = []; return 'ignored'; }
    if (this.busy) { this.skip(); return 'handled'; }
    if (key.kind === 'mouseClick') {
      const layout = this.layout();
      const at = layout && 'x' in key && typeof key.x === 'number' && typeof key.y === 'number' ? cellAt(layout, key.x - 1, key.y - 1) : undefined;
      if (!at) return 'ignored';
      this.started = true;
      const target = at.cy * WIDTH + at.cx;
      this.hintCells = undefined;
      if (this.selected !== undefined && this.board.adjacent(this.selected, target)) { const from = this.selected; this.selected = undefined; this.cursor = target; this.trySwap(from, target); }
      else { this.cursor = target; this.selected = this.selected === target ? undefined : target; }
      return 'handled';
    }
    // h asks for a hint; it is taken before the movement keys, which would otherwise read it as vim's "left".
    if (key.kind === 'text' && key.value.toLowerCase() === 'h') { this.hintCells = this.board.hint(); return 'handled'; }
    const move = direction(key);
    if (move) {
      this.started = true;
      this.hintCells = undefined;
      const dx = move === 'left' ? -1 : move === 'right' ? 1 : 0, dy = move === 'up' ? -1 : move === 'down' ? 1 : 0;
      const x = this.cursor % WIDTH + dx, y = Math.floor(this.cursor / WIDTH) + dy;
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return 'handled';
      const target = y * WIDTH + x;
      if (this.selected !== undefined) { const from = this.selected; this.selected = undefined; this.cursor = target; this.trySwap(from, target); } else this.cursor = target;
      return 'handled';
    }
    if (isConfirm(key)) {
      this.started = true;
      if (this.selected === undefined) this.selected = this.cursor;
      else if (this.selected === this.cursor) this.selected = undefined;
      else if (this.board.adjacent(this.selected, this.cursor)) { const from = this.selected; this.selected = undefined; this.trySwap(from, this.cursor); }
      else this.selected = this.cursor;
      return 'handled';
    }
    if (key.kind === 'escape' && this.selected !== undefined) { this.selected = undefined; return 'handled'; }
    return 'ignored';
  }

  private trySwap(a: number, b: number): void {
    const shuffles = this.board.shuffles;
    const steps = this.board.swap(a, b);
    if (steps && this.board.shuffles > shuffles) this.say('No swaps were left: the board was reshuffled');
    if (!steps) {
      // No match: the tiles slide over and back, and the note says why; the popup stays inside the playfield.
      this.say(this.board.adjacent(a, b) ? 'No match: that swap does not line up three' : 'Swap with a neighbour');
      this.pop('no match', b, rgb(0xffb86c), 900);
      if (!this.still && this.board.adjacent(a, b)) this.phases = [{kind: 'swap', a, b, t: 0, dur: SWAP_MS * 2, back: true}];
      return;
    }
    this.phases = [{kind: 'swap', a, b, t: 0, dur: SWAP_MS, back: false}];
    for (const step of steps) {
      const rows = step.falls.reduce((most, fall) => Math.max(most, Math.floor(fall.to / WIDTH) - fall.fromRow), 1);
      this.phases.push({kind: 'clear', step, t: 0, dur: CLEAR_MS}, {kind: 'fall', step, t: 0, dur: Math.max(FALL_MIN_MS, FALL_MS_PER_ROW * rows)});
    }
    if (this.still) this.skip();
  }

  private celebrate(): void {
    confetti(this.particles, this.size.columns, this.size.rows * 2, [...KIND_COLORS, GOLD], this.context.motion);
  }

  private finish(): void {
    if (this.over) return;
    this.over = true;
    const board = this.board;
    const saved = saveScore(this.context.record, board.score, {bestChain: board.bestChain});
    const record = board.score > 0 && board.score > this.startBest;
    const stars = starsFor(board.score);
    // A diagonal wave of light across the tiles, then confetti in as many bursts as stars were earned.
    const groups: number[][] = [];
    for (let cell = 0; cell < WIDTH * HEIGHT; cell += 1) (groups[(cell % WIDTH) + Math.floor(cell / WIDTH)] ??= []).push(cell);
    this.wave = new Reveal(groups, this.context.motion, {stagger: 60, within: 0, rise: 170, hold: 220, fall: 520});
    if (stars > 0 || record) { this.celebrate(); this.bursts = Array.from({length: Math.max(0, stars - 1) + (record ? 1 : 0)}, (_, index) => 420 * (index + 1)); }
    const marks = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
    this.result = {
      score: board.score, scoreText: board.score.toLocaleString('en-US'), record,
      details: [`${marks(stars)} ${stars} of 3 stars (${STARS.map(limit => limit.toLocaleString('en-US')).join(' / ')})`, `Longest cascade x${board.bestChain}`, `${MOVES} moves used`, `Best ${saved.best.toLocaleString('en-US')}`, `Games ${saved.plays}`],
    };
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  /** Physically square tiles under the title and progress rows and above the status line. */
  private layout(): BoardLayout | undefined {
    return squareLayout({columns: this.size.columns, rows: this.size.rows, top: 2, bottom: 1}, WIDTH, HEIGHT, {maxCellH: 3});
  }

  /** Where every tile is now, with scale and flash, from the animation phase. */
  private tiles(): Tile[] {
    const phase = this.phases[0];
    const tiles: Tile[] = [];
    const cellsOf = phase?.kind === 'fall' ? phase.step.after : this.shown;
    const marksOf = phase?.kind === 'fall' ? phase.step.afterMarks : this.shownMarks;
    const dropFrom = new Map<number, number>();
    if (phase?.kind === 'fall') for (const fall of phase.step.falls) dropFrom.set(fall.to, fall.fromRow);
    const glow = (cell: number) => (this.wave?.has(cell) ? this.wave.amount(cell) : 0);
    for (let cell = 0; cell < cellsOf.length; cell += 1) {
      const kind = cellsOf[cell]!;
      if (kind < 0) continue;
      let x = cell % WIDTH, y = Math.floor(cell / WIDTH), scale = 1, flash = glow(cell) * 0.55, mark = marksOf[cell]!;
      if (phase?.kind === 'swap') {
        const t = clamp(phase.t / phase.dur, 0, 1);
        const e = phase.back ? Math.sin(Math.PI * t) * 0.6 : t * t * (3 - 2 * t);
        const other = cell === phase.a ? phase.b : cell === phase.b ? phase.a : -1;
        if (other >= 0) { x += ((other % WIDTH) - x) * e; y += (Math.floor(other / WIDTH) - y) * e; }
      } else if (phase?.kind === 'clear') {
        const t = clamp(phase.t / phase.dur, 0, 1);
        const made = phase.step.created.find(item => item.cell === cell);
        if (made) { scale = 1 + 0.35 * Math.sin(Math.PI * t); if (t > 0.45) mark = made.mark; flash = Math.max(flash, 0.7 * (1 - t)); }
        else if (phase.step.cleared.includes(cell)) {
          // Pop up a little, then shrink away.
          scale = t < 0.25 ? 1 + 0.25 * (t / 0.25) : Math.max(0, 1.25 * (1 - (t - 0.25) / 0.75));
          flash = Math.max(flash, t < 0.5 ? 0.8 : 0.8 * (1 - (t - 0.5) * 2));
        }
      } else if (phase?.kind === 'fall') {
        const from = dropFrom.get(cell);
        if (from !== undefined) { const t = clamp(phase.t / phase.dur, 0, 1); y = from + (y - from) * t * t; }
      }
      if (scale <= 0.02) continue;
      tiles.push({cell, kind, mark, x, y, scale, flash});
    }
    // Moving tiles draw last so they pass over the ones that stay.
    return tiles.sort((p, q) => (p.x !== p.cell % WIDTH || p.y !== Math.floor(p.cell / WIDTH) ? 1 : 0) - (q.x !== q.cell % WIDTH || q.y !== Math.floor(q.cell / WIDTH) ? 1 : 0) || p.scale - q.scale);
  }

  /** Cells that glow for the step being cleared: the row or column of a striped treat, every treat of a bomb's kind. */
  private sweep(): Map<number, number> {
    const out = new Map<number, number>();
    const phase = this.phases[0];
    if (phase?.kind !== 'clear') return out;
    const t = clamp(phase.t / phase.dur, 0, 1), level = Math.sin(Math.PI * Math.min(1, t * 1.3));
    for (const fired of phase.step.triggered) {
      if (fired.mark === STRIPE_ROW) for (let x = 0; x < WIDTH; x += 1) out.set(Math.floor(fired.cell / WIDTH) * WIDTH + x, level);
      else if (fired.mark === STRIPE_COL) for (let y = 0; y < HEIGHT; y += 1) out.set(y * WIDTH + (fired.cell % WIDTH), level);
      else for (const cell of phase.step.cleared) out.set(cell, level);
    }
    return out;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const safe = this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    const board = this.board;
    topRow(canvas, look, 'Treat Match', `Score ${(this.over || !this.busy ? board.score : this.shownScore).toLocaleString('en-US')}  Best ${Math.max(this.startBest, board.score).toLocaleString('en-US')}`);
    this.progress(canvas, look, color, safe);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger', {fg: look.warn}); return; }
    const well = look.surface.sunken;
    if (color && layout.x >= 1 && layout.y >= 3 && layout.y + layout.height + 1 < canvas.height) canvas.fill(layout.x - 1, layout.y - 1, layout.width + 2, layout.height + 2, ' ', {bg: well});
    const tiles = this.tiles();
    const sweep = this.sweep();
    const S = layout.cellW;
    const sprites = color && (S === 6 || S === 4);
    const hint = this.hintCells ? new Set<number>(this.hintCells) : new Set<number>();
    const pulse = this.still ? 0 : (Math.sin(this.clock / 160) + 1) / 2;

    if (sprites) {
      const px = new PixelBuffer(layout.width, layout.height * 2);
      for (let cell = 0; cell < WIDTH * HEIGHT; cell += 1) {
        const x = (cell % WIDTH) * S, y = Math.floor(cell / WIDTH) * S;
        const sweepLevel = sweep.get(cell) ?? 0;
        px.rect(x, y, S, S, mixRgb((cell + Math.floor(cell / WIDTH)) % 2 ? mixRgb(well, look.surface.raised, 0.35) : mixRgb(well, look.surface.raised, 0.7), WHITE, 0.45 * sweepLevel));
      }
      // Small tiles (4 px) sit on a tinted plate with the corners cut, so neighbouring icons stay apart.
      if (S === 4) for (const tile of tiles) {
        const plate = mixRgb(look.surface.sunken, KIND_COLORS[tile.kind]!, 0.28 + 0.5 * Math.min(0.5, tile.flash));
        const ox = Math.round(tile.x * S), oy = Math.round(tile.y * S);
        for (let v = 0; v < S; v += 1) for (let u = 0; u < S; u += 1) if (!((u === 0 || u === S - 1) && (v === 0 || v === S - 1))) px.set(ox + u, oy + v, plate);
      }
      for (const tile of tiles) this.drawSprite(px, tile, S, pulse);
      for (const cell of [...hint]) this.ring(px, cell, S, look.focus, true);
      if (this.selected !== undefined) this.ring(px, this.selected, S, look.text.strong, false);
      this.ring(px, this.cursor, S, this.selected !== undefined ? look.accent : look.text.strong, false, true);
      canvas.blit(px, layout.x, layout.y);
    } else {
      const glyphs = color && !safe;
      for (let cell = 0; cell < WIDTH * HEIGHT; cell += 1) {
        const o = cellOrigin(layout, cell % WIDTH, Math.floor(cell / WIDTH));
        if (color) canvas.fill(o.x, o.y, layout.cellW, layout.cellH, ' ', {bg: mixRgb(well, look.surface.raised, (cell + Math.floor(cell / WIDTH)) % 2 ? 0.35 : 0.7)});
      }
      for (const tile of tiles) {
        if (tile.scale < 0.45) continue;
        const cell = Math.round(tile.y) * WIDTH + Math.round(tile.x);
        const home = tile.cell;
        const col = layout.x + Math.round(tile.x * layout.cellW), row = layout.y + Math.round(tile.y * layout.cellH);
        const here = home === this.cursor, picked = home === this.selected, hinted = hint.has(home);
        const mark = tile.mark === STRIPE_ROW ? (glyphs ? '═' : '=') : tile.mark === STRIPE_COL ? (glyphs ? '║' : '|') : tile.mark === BOMB ? (glyphs ? '✱' : '*') : '';
        const symbol = glyphs ? KIND_SHAPES[tile.kind]! : KIND_LETTERS[tile.kind]!;
        // A tile still above the board (a new one dropping in) must not draw over the title or progress rows.
        if (row < layout.y) continue;
        const rowMid = row + Math.floor((layout.cellH - 1) / 2);
        void cell;
        if (!color) {
          const left = picked ? '<' : here ? '[' : hinted ? '*' : ' ', right = picked ? '>' : here ? ']' : hinted ? '*' : ' ';
          const text = layout.cellW >= 4 ? `${left}${symbol}${right}${mark || ' '}`.trimEnd() : `${symbol}${hinted && !here && !picked ? '*' : mark || ''}`;
          canvas.text(layout.x + Math.round(tile.x * layout.cellW) + Math.floor((layout.cellW - text.length) / 2), rowMid, text, {bold: here || picked || !!mark, reverse: layout.cellW < 4 && (here || picked), underline: layout.cellW < 4 && picked});
          continue;
        }
        let fill = KIND_COLORS[tile.kind]!;
        if (tile.flash > 0) fill = mixRgb(fill, WHITE, Math.min(0.85, tile.flash));
        const swept = sweep.get(home) ?? 0;
        if (swept) fill = mixRgb(fill, WHITE, 0.6 * swept);
        const inverse = here || picked;
        const bg = inverse ? look.text.strong : fill;
        const fg = inverse ? KIND_COLORS[tile.kind]! : INK;
        canvas.fill(col, row, layout.cellW, layout.cellH, ' ', {bg});
        const text = layout.cellW >= 2 ? `${symbol}${mark}` : symbol;
        canvas.text(col + Math.max(0, Math.floor((layout.cellW - text.length) / 2)), rowMid, text, {fg, bg, bold: true, underline: picked});
        if (hinted && !inverse) canvas.text(col, rowMid, '·', {fg: look.focus, bg, bold: true});
      }
    }
    // Popups stay inside the playfield: never over the title or progress rows.
    for (const pop of this.pops) {
      const o = cellOrigin(layout, pop.cell % WIDTH, Math.floor(pop.cell / WIDTH));
      const t = pop.age / pop.life, rise = Math.round(t * Math.min(2, layout.cellH));
      const width = pop.text.length;
      const x = clamp(Math.round(o.x + layout.cellW / 2 - width / 2), layout.x, Math.max(layout.x, layout.x + layout.width - width));
      const y = clamp(o.y + Math.floor(layout.cellH / 2) - rise, layout.y, layout.y + layout.height - 1);
      canvas.text(x, y, pop.text, {fg: color ? mixRgb(pop.color, look.surface.base, clamp((t - 0.5) * 1.6, 0, 0.8)) : undefined, bg: color ? look.surface.base : undefined, bold: true, reverse: !color});
    }
    if (this.particles.count && color) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    const footer = canvas.height - 1;
    const kindName = KIND_NAMES[this.shown[this.cursor]! % KINDS]!;
    const markName = this.shownMarks[this.cursor] === BOMB ? ' (bomb: clears a kind)' : this.shownMarks[this.cursor] === STRIPE_ROW ? ' (clears its row)' : this.shownMarks[this.cursor] === STRIPE_COL ? ' (clears its column)' : '';
    const stars = starsFor(board.score);
    const text = this.over ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${board.score.toLocaleString('en-US')} points` : this.noteLeft > 0 ? this.note : !this.started ? 'Arrows move · Space picks a treat, then an arrow swaps it · h hints' : this.selected !== undefined ? `Swap the ${kindName}: press an arrow` : `${kindName}${markName}`;
    canvas.center(footer, truncateText(safe ? text.replace(/[★☆]/gu, ch => (ch === '★' ? '*' : 'o')) : text, canvas.width - 2), {fg: this.over ? look.gold : this.noteLeft > 0 ? look.warn : look.text.dim, bold: this.over});
  }

  /** Moves left as a bar, and the score against the three star thresholds. */
  private progress(canvas: Canvas, look: ArcadeLook, color: boolean, safe: boolean): void {
    const board = this.board, width = canvas.width;
    const full = safe ? '#' : '█', empty = safe ? '-' : '░', star = safe ? '*' : '★', hollow = safe ? 'o' : '☆';
    const moveBar = clamp(Math.floor((width - 8) / 5), 3, 14), scoreBar = clamp(Math.floor((width - 10) / 2.4), 6, 24);
    const label = width >= 34;
    const left = `${label ? 'Moves ' : ''}${full.repeat(Math.round(moveBar * board.movesLeft / MOVES))}${empty.repeat(moveBar - Math.round(moveBar * board.movesLeft / MOVES))} ${board.movesLeft}`;
    canvas.text(1, 1, left, {fg: board.movesLeft <= 5 ? look.warn : look.text.normal});
    const score = this.over || !this.busy ? board.score : this.shownScore;
    const filled = Math.round(scoreBar * clamp(score / STARS[2], 0, 1));
    const cells: string[] = Array.from({length: scoreBar}, (_, index) => (index < filled ? full : empty));
    const marks = STARS.map(limit => clamp(Math.round(scoreBar * limit / STARS[2]) - 1, 0, scoreBar - 1));
    marks.forEach((at, index) => { cells[at] = score >= STARS[index]! ? star : hollow; });
    const right = cells.join('');
    const x = width - 1 - right.length;
    if (x > 2 + left.length) {
      canvas.text(x, 1, right, {fg: look.text.dim});
      marks.forEach((at, index) => canvas.text(x + at, 1, cells[at]!, {fg: score >= STARS[index]! ? look.gold : look.text.dim, bold: score >= STARS[index]!}));
      for (let index = 0; index < filled; index += 1) if (!marks.includes(index)) canvas.text(x + index, 1, cells[index]!, {fg: color ? look.gold : undefined});
    }
    void color;
  }

  /** A tile's pixel art, scaled around its center. */
  private drawSprite(px: PixelBuffer, tile: Tile, S: number, pulse: number): void {
    const art = SPRITES[S as 6 | 4][tile.kind % KINDS]!;
    const left = tile.x * S, top = tile.y * S;
    const flash = clamp(tile.flash, 0, 0.5);
    const scale = tile.scale;
    const size = Math.max(1, Math.round(S * scale));
    const ox = Math.round(left + (S - size) / 2), oy = Math.round(top + (S - size) / 2);
    for (let v = 0; v < size; v += 1) for (let u = 0; u < size; u += 1) {
      const glyph = art[Math.min(S - 1, Math.floor(((v + 0.5) / size) * S))]![Math.min(S - 1, Math.floor(((u + 0.5) / size) * S))]!;
      const base = spriteColor(glyph, tile.kind);
      if (base) px.set(ox + u, oy + v, flash ? mixRgb(base, WHITE, flash) : base);
    }
    if (tile.mark === PLAIN_MARK) return;
    const mark = rgb(0xffffff);
    const inset = S >= 6 ? 1 : 0;
    if (tile.mark === STRIPE_ROW) for (const row of S >= 6 ? [1, S - 2] : [0, S - 1]) for (let u = 0; u < S; u += 1) px.set(Math.round(left) + u, Math.round(top) + row, mark);
    else if (tile.mark === STRIPE_COL) for (const col of S >= 6 ? [1, S - 2] : [0, S - 1]) for (let v = 0; v < S; v += 1) px.set(Math.round(left) + col, Math.round(top) + v, mark);
    else if (tile.mark === BOMB) {
      const edge = mixRgb(mark, KIND_COLORS[tile.kind]!, 0.45 * pulse);
      for (let u = 0; u < S; u += 1) { px.set(Math.round(left) + u, Math.round(top), edge); px.set(Math.round(left) + u, Math.round(top) + S - 1, edge); px.set(Math.round(left), Math.round(top) + u, edge); px.set(Math.round(left) + S - 1, Math.round(top) + u, edge); }
      px.set(Math.round(left) + inset + 1, Math.round(top) + inset + 1, mark);
    }
  }

  /** A one-pixel ring (or its corners) around a cell. */
  private ring(px: PixelBuffer, cell: number, S: number, colorValue: Rgb, dashed: boolean, strong = false): void {
    const x = (cell % WIDTH) * S, y = Math.floor(cell / WIDTH) * S;
    for (let i = 0; i < S; i += 1) {
      if (dashed && i % 2) continue;
      px.set(x + i, y, colorValue); px.set(x + i, y + S - 1, colorValue); px.set(x, y + i, colorValue); px.set(x + S - 1, y + i, colorValue);
    }
    if (strong && S >= 6) for (const [dx, dy] of [[1, 0], [S - 2, 0], [1, S - 1], [S - 2, S - 1], [0, 1], [S - 1, 1], [0, S - 2], [S - 1, S - 2]] as const) px.set(x + dx, y + dy, colorValue);
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '←↑↓→', action: 'move / swap'}, {keys: 'Space', action: 'pick'}, {keys: 'h', action: 'hint'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.pops = []; this.wave = undefined; }
}

const PLAIN_MARK = 0;

/** The hub preview: a board of treats where one swap keeps clearing a row. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const n = 6, cw = 5;
  const left = Math.floor((canvas.width - n * cw) / 2), top = Math.max(0, Math.floor((canvas.height - n * 2) / 2));
  const phase = frame % 24;
  for (let cell = 0; cell < n * n; cell += 1) {
    const x = cell % n, y = Math.floor(cell / n);
    let kind = (x * 2 + y * 3 + (x ^ y)) % KINDS;
    const row = y === 3 && phase > 12 && phase < 18;
    if (row) kind = 1;
    const fill = row ? mixRgb(KIND_COLORS[kind]!, rgb(0xffffff), 0.6) : KIND_COLORS[kind]!;
    canvas.fill(left + x * cw, top + y * 2, cw - 1, 1, ' ', {bg: fill});
    canvas.put(left + x * cw + 1, top + y * 2, KIND_SHAPES[kind]!, {fg: INK, bg: fill, bold: true});
  }
}

export const treatsGame: GameDefinition = {
  id: 'treats', aliases: ['treat-match', 'match3', 'match-three'], title: 'Treat Match', tagline: 'Swap, match, cascade',
  description: 'Swap two neighbouring treats to line up three or more. Matches clear, the rest fall and new ones drop in, and a lucky fall can chain into a cascade worth more each step. Match four for a striped treat, five or a T for a bomb. Thirty moves to score as high as you can, and up to three stars.',
  kind: 'puzzle', category: 'falling',
  controls: [{keys: '←↑↓→', action: 'move / swap'}, {keys: 'Space', action: 'pick'}, {keys: 'h', action: 'hint'}],
  howToPlay: [
    'Move the cursor, press Space to pick a treat, then an arrow to swap it with that neighbour. A swap only counts if it makes a line of three or more.',
    'Four in a line makes a striped treat that clears its whole row or column when matched; five in a line, or a T or L, makes a bomb that clears every treat of its kind. Cascades are worth more each step. You have thirty moves; if no swap is possible the board reshuffles for free.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · chain x${count(record.bestChain)}` : 'Not played yet'; },
  preview,
  create: context => new TreatMatch(context),
};
