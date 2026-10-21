import {mixRgb} from '../../../chroma/chroma.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas, type Style} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {generateIce, IceBoard, DIRS, LEVELS, slideFrom, type Dir, type Level} from './logic.js';
import {cellOrigin, squareLayout, type BoardLayout} from '../../engine/boardLayout.js';

/**
 * Ice Paws: the cat slides until something stops it; get it to the fish bowl. Rocks are drawn as solid blocks and
 * labelled with a glyph, the bowl and the cat have their own glyphs, so nothing depends on color. Levels are checked
 * solvable and show their shortest solution (par).
 */
const LEVEL_IDS = Object.keys(LEVELS) as Level[];
const SLIDE_MS_PER_CELL = 35;
const ARROW: Record<Dir, string> = {up: '↑', down: '↓', left: '←', right: '→'};
const ARROW_ASCII: Record<Dir, string> = {up: '^', down: 'v', left: '<', right: '>'};
const PUFF_MS = 260;

/** The cat: ears, face and paws as the cell allows. Always contains the face ^.^ (or ^^ in the smallest cell). */
function catSprite(cw: number, ch: number): readonly string[] {
  if (ch >= 3) return ['/\\_/\\', '(^.^)', ' " " '];
  if (ch === 2) return ['/\\/\\', ' ^.^'];
  return [cw >= 3 ? '^.^' : '^^'];
}
/** The fish bowl: a fish over a bowl. Always starts with a "(". */
function bowlSprite(cw: number, ch: number, safe: boolean): readonly string[] {
  const fish = safe ? '><>' : '≻°>';
  if (ch >= 3) return [' ' + fish, '(   )', ' \\_/ '];
  if (ch === 2) return [fish, '(__)'];
  return [cw >= 3 ? '(o)' : '()'];
}

export function readIce(raw: Readonly<Record<string, unknown>>): {plays: number; wins: number; perfect: number; best: Record<Level, number>} {
  return {plays: count(raw.plays), wins: count(raw.wins), perfect: count(raw.perfect), best: {easy: count(raw.bestEasy), medium: count(raw.bestMedium), hard: count(raw.bestHard)}};
}
const bestKey = (level: Level): string => `best${level[0]!.toUpperCase()}${level.slice(1)}`;

class IcePaws implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private board: IceBoard | undefined;
  private level: Level = 'easy';
  private tip: Dir | undefined;
  private slideDir: Dir | undefined;
  /** The landing puff: where the cat stopped and which way it was going. */
  private puff: {dir: Dir; age: number} | undefined;
  private trail: number[] = [];
  /** The sliding animation: the cells the cat is passing and the time spent. */
  private anim: {path: number[]; from: number; elapsed: number} | undefined;
  private readonly menu: Menu;
  private wave: Reveal | undefined;
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);
  private size: {columns: number; rows: number};
  private startBest = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('ice-fx'), 140, context.motion.effects);
    const saved = readIce(context.record.get());
    this.menu = new Menu(LEVEL_IDS.map((id, index) => ({id, label: LEVELS[id].label, key: String(index + 1), hint: saved.best[id] ? `best ${saved.best[id]}` : 'new'})));
  }

  get status(): GameStatus {
    if (this.screen === 'menu' || !this.board) return 'ready';
    return this.board.solved && !this.anim ? 'won' : 'playing';
  }
  get finale(): Finale | undefined { return this.board?.solved && !this.anim ? this.wave : undefined; }
  get refreshMs(): number { return this.anim || this.puff || (this.wave && !this.wave.done) || this.particles.count ? 30 : 0; }
  private get still(): boolean { return this.context.motion.reduced || this.context.motion.effects === 'off'; }

  private start(level: Level): void {
    this.level = level;
    this.board = new IceBoard(generateIce(level, createRng(this.context.rng.int(1, 0x7fffffff))));
    this.tip = undefined;
    this.trail = [];
    this.anim = undefined;
    this.wave = undefined;
    this.result = undefined;
    this.screen = 'play';
    this.startBest = readIce(this.context.record.get()).best[level];
  }

  step(): void {}

  animate(dtMs: number): void {
    if (this.puff && (this.puff.age += dtMs) >= PUFF_MS) this.puff = undefined;
    if (this.anim) {
      this.anim.elapsed += dtMs;
      if (this.anim.elapsed >= this.anim.path.length * SLIDE_MS_PER_CELL) this.landed();
    }
    this.wave?.update(dtMs);
    this.particles.update(dtMs);
  }

  private landed(): void {
    if (this.anim && this.slideDir && !this.still) this.puff = {dir: this.slideDir, age: 0};
    this.anim = undefined;
    if (this.board?.solved && !this.result) this.finish();
  }

  private finish(): void {
    const board = this.board!, field = board.field;
    // A ripple of ice: groups of cells by distance from the bowl.
    const groups: number[][] = [];
    for (let cell = 0; cell < field.width * field.height; cell += 1) {
      if (field.rocks[cell]) continue;
      const d = Math.abs((cell % field.width) - (field.goal % field.width)) + Math.abs(Math.floor(cell / field.width) - Math.floor(field.goal / field.width));
      (groups[d] ??= []).push(cell);
    }
    this.wave = new Reveal(groups.filter(Boolean), this.context.motion, {stagger: 60, within: 0, rise: 140, hold: 160, fall: 400});
    const saved = readIce(this.context.record.get());
    const record = this.startBest === 0 || board.moves < this.startBest;
    const perfect = board.moves <= board.par;
    this.context.record.update(raw => {
      raw.plays = count(raw.plays) + 1;
      raw.wins = count(raw.wins) + 1;
      if (perfect) raw.perfect = count(raw.perfect) + 1;
      if (record) raw[bestKey(this.level)] = Math.max(1, board.moves);
    });
    this.result = {
      score: board.moves, scoreText: `${board.moves} moves`, record,
      details: [LEVELS[this.level].label, perfect ? 'Perfect: the shortest way' : `Shortest is ${board.par} moves`, `Best ${record ? board.moves : saved.best[this.level]} moves`],
    };
    const look = arcadeLook();
    confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, look.hue.sky, look.hue.butter, look.text.strong], this.context.motion);
  }

  private go(dir: Dir): GameKeyResult {
    const board = this.board!;
    if (this.anim) this.landed();
    const from = board.cat;
    const path = board.slide(dir);
    if (!path.length) return 'ignored';
    this.tip = undefined;
    this.slideDir = dir;
    this.puff = undefined;
    this.trail = path;
    if (this.still) { if (board.solved) this.finish(); } else this.anim = {path, from, elapsed: 0};
    return 'handled';
  }

  key(k: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (k.kind === 'escape') return 'ignored';
      const choice = this.menu.key(k);
      if (choice) this.start(choice as Level);
      return 'handled';
    }
    const board = this.board!;
    if (board.solved) { this.anim = undefined; if (!this.result) this.finish(); this.wave?.skip(); return 'ignored'; }
    const move = direction(k);
    if (move) return this.go(move);
    if (k.kind === 'text') {
      const value = k.value.toLowerCase();
      if (value === 'u') { this.anim = undefined; const undone = board.undo(); if (undone) { this.tip = undefined; this.trail = []; } return undone ? 'handled' : 'ignored'; }
      if (value === 'r') { this.anim = undefined; board.restart(); this.tip = undefined; this.trail = []; return 'handled'; }
      if (value === '?' || value === 't') { this.tip = board.hint(); return this.tip ? 'handled' : 'ignored'; }
    }
    return 'ignored';
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  /** The largest physically square cells that fit under the title row and above the status line. */
  private layout(): BoardLayout | undefined {
    const field = this.board!.field;
    return squareLayout({columns: this.size.columns, rows: this.size.rows, top: 1, bottom: 1}, field.width, field.height, {maxCellH: 4});
  }

  /** Where the four slides from the cat would stop: the ghost preview. */
  private ghosts(): Array<{dir: Dir; to: number; path: number[]}> {
    const board = this.board!;
    return DIRS.map(dir => ({dir, ...slideFrom(board.field, board.cat, dir)})).filter(g => g.to !== board.cat);
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const safe = this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      const saved = readIce(this.context.record.get());
      topRow(canvas, look, 'Ice Paws', saved.plays ? `Solved ${saved.wins}` : 'Not played yet');
      const top = Math.max(1, Math.floor(canvas.height / 2) - 3);
      canvas.center(top, 'Choose a rink', {fg: look.text.strong, bold: true});
      if (canvas.height >= 9) canvas.center(top + 1, 'Slide until you hit something. Reach the bowl.', {fg: look.text.dim});
      this.menu.draw(canvas, palette, 0, top + (canvas.height >= 9 ? 3 : 2), canvas.width);
      return;
    }
    const board = this.board, field = board.field;
    topRow(canvas, look, `Ice Paws · ${LEVELS[this.level].label}`, `Moves ${board.moves}  Par ${board.par}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), `Needs ${field.width * 2}×${field.height + 2}`, {fg: look.warn}); return; }
    const {cellW: cw, cellH: ch} = layout;
    const trail = new Set(this.trail);
    let catCell = board.cat;
    let index = -1;
    if (this.anim) {
      index = Math.min(this.anim.path.length - 1, Math.floor(this.anim.elapsed / SLIDE_MS_PER_CELL));
      catCell = this.anim.path[index]!;
    }
    const sliding = this.anim ? this.slideDir : undefined;
    const behind = new Set(this.anim ? this.anim.path.slice(0, index) : []);
    const ghosts = this.anim || board.solved ? [] : this.ghosts();
    const ghostPath = new Set<number>();
    for (const g of ghosts) if (g.dir === this.tip) g.path.forEach(c => ghostPath.add(c));
    const at = (cell: number) => cellOrigin(layout, cell % field.width, Math.floor(cell / field.width));
    const stone = mixRgb(look.surface.raised2, look.text.dim, 0.16);
    const stoneEdge = mixRgb(stone, look.text.dim, 0.35);
    const horizontal = sliding === 'left' || sliding === 'right';

    for (let cell = 0; cell < field.width * field.height; cell += 1) {
      const {x, y} = at(cell);
      const cx = cell % field.width, cy = Math.floor(cell / field.width);
      const glow = this.wave?.amount(cell) ?? 0;
      let bg = (cx + cy) % 2 === 0 ? mixRgb(look.surface.sunken, look.hue.sky, 0.1) : mixRgb(look.surface.sunken, look.hue.sky, 0.04);
      if (ghostPath.has(cell)) bg = mixRgb(bg, look.accent, 0.25);
      bg = mixRgb(bg, look.ok, 0.4 * glow);
      const style = {bg: color ? bg : undefined};
      canvas.fill(x, y, cw, ch, ' ', style);
      if (field.rocks[cell]) {
        const rb = color ? stone : undefined;
        canvas.fill(x, y, cw, ch, safe ? '#' : color ? ' ' : '▓', {fg: color ? stoneEdge : undefined, bg: rb});
        if (ch >= 2) { canvas.fill(x + 1, y, cw - 2, 1, safe ? '=' : '▀', {fg: color ? look.text.strong : undefined, bg: rb, bold: true}); canvas.fill(x, y + ch - 1, cw, 1, safe ? '#' : '▄', {fg: color ? mixRgb(stone, look.surface.sunken, 0.6) : undefined, bg: rb}); }
        else if (!color) canvas.fill(x, y, cw, ch, '#');
      } else if (cell === field.goal && cell !== catCell) {
        this.sprite(canvas, x, y, cw, ch, bowlSprite(cw, ch, safe), {fg: look.ok, ...style, bold: true});
      } else if (behind.has(cell) && sliding) {
        // Speed lines in the slide direction.
        const mid = Math.floor((ch - 1) / 2);
        if (horizontal) canvas.fill(x, y + mid, cw, 1, safe ? '-' : '─', {fg: look.hue.sky, ...style});
        else canvas.fill(x + Math.floor((cw - 1) / 2), y, 1, ch, safe ? '|' : '│', {fg: look.hue.sky, ...style});
      } else if (trail.has(cell) && cell !== catCell) {
        canvas.text(x + Math.floor((cw - 1) / 2), y + Math.floor((ch - 1) / 2), safe ? '.' : '•', {fg: look.text.dim, ...style});
      } else {
        canvas.text(x + Math.floor((cw - 1) / 2), y + Math.floor((ch - 1) / 2), safe ? '.' : '·', {fg: look.text.dim, ...style});
      }
    }
    // Ghost landing markers: an arrow in the corner of the cell each slide would stop in.
    for (const g of ghosts) {
      const {x, y} = at(g.to);
      if (g.to === field.goal) continue;
      const hot = g.dir === this.tip;
      canvas.text(x, y, safe ? ARROW_ASCII[g.dir] : ARROW[g.dir], {fg: hot ? look.focus : look.text.dim, bold: hot});
    }
    // The cat (and the bowl under it once it arrives).
    {
      const {x, y} = at(catCell);
      const onGoal = catCell === field.goal;
      const bg = color ? (onGoal ? look.ok : look.accent) : undefined;
      canvas.fill(x, y, cw, ch, ' ', {bg});
      this.sprite(canvas, x, y, cw, ch, catSprite(cw, ch), {fg: color ? look.text.onAccent : undefined, bg, bold: true});
      if (this.anim && sliding) {
        // A direction arrow on the leading edge while sliding.
        const ax = sliding === 'left' ? x : sliding === 'right' ? x + cw - 1 : x + Math.floor((cw - 1) / 2);
        const ay = sliding === 'up' ? y : sliding === 'down' ? y + ch - 1 : y + Math.floor((ch - 1) / 2);
        canvas.text(ax, ay, safe ? ARROW_ASCII[sliding] : ARROW[sliding], {fg: color ? look.text.strong : undefined, bg, bold: true});
      } else if (this.puff && !this.still) {
        const t = this.puff.age / PUFF_MS;
        const lead = this.puff.dir;
        const puffBg = color ? mixRgb(bg!, look.text.strong, 0.35 * (1 - t)) : undefined;
        canvas.fill(x, y, cw, ch, ' ', {bg: puffBg});
        this.sprite(canvas, x, y, cw, ch, catSprite(cw, ch), {fg: color ? look.text.onAccent : undefined, bg: puffBg, bold: true});
        const spark = safe ? '*' : t < 0.5 ? '✦' : '·';
        const px = lead === 'left' ? x : lead === 'right' ? x + cw - 1 : undefined;
        const py = lead === 'up' ? y : lead === 'down' ? y + ch - 1 : undefined;
        const put = (sx: number, sy: number) => { if (canvas.cell(sx, sy)?.ch === ' ') canvas.text(sx, sy, spark, {fg: look.text.strong, bg: puffBg, bold: true}); };
        if (px !== undefined) for (let row = 0; row < ch; row += 1) put(px, y + row);
        else if (py !== undefined) for (let col = 0; col < cw; col += 1) put(x + col, py);
        // Snow thrown up in the rock or wall side, when there is room outside the cell.
        const out = lead === 'left' ? [x - 1, y] : lead === 'right' ? [x + cw, y] : lead === 'up' ? [x, y - 1] : [x, y + ch];
        if (canvas.cell(out[0]!, out[1]!)?.ch === ' ') canvas.text(out[0]!, out[1]!, spark, {fg: look.text.strong});
      }
    }
    const note = board.solved && !this.anim ? 'In the bowl!' : this.anim ? `Sliding ${this.slideDir} ${ARROW[this.slideDir!]}` : this.tip ? `Hint: slide ${this.tip} ${ARROW[this.tip]}` : canvas.width < 44 ? 'u undo · r restart · ? hint' : 'Slide ←↑↓→ · u undo · r restart · ? hint';
    canvas.center(canvas.height - 1, note.slice(0, canvas.width - 2), {fg: board.solved ? look.ok : this.tip ? look.accent : look.text.dim, bold: board.solved});
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
  }

  /** Centered lines of a sprite inside a cell; blanks stay transparent. */
  private sprite(canvas: Canvas, x: number, y: number, cw: number, ch: number, lines: readonly string[], style: Style): void {
    const top = y + Math.floor((ch - lines.length) / 2);
    lines.forEach((line, row) => {
      const left = x + Math.floor((cw - line.length) / 2);
      for (let col = 0; col < line.length; col += 1) if (line[col] !== ' ') canvas.text(left + col, top + row, line[col]!, style);
    });
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'rink'}, {keys: '⏎', action: 'start'}, {keys: 'Esc', action: 'back'}];
    return [{keys: '←↑↓→', action: 'slide'}, {keys: 'u', action: 'undo'}, {keys: 'r', action: 'restart'}, {keys: '?', action: 'hint'}];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.wave = undefined; this.anim = undefined; this.board = undefined; }
}

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const cw = canvas.width >= 30 ? 3 : 2, w = Math.min(8, Math.floor(canvas.width / cw)), h = Math.min(5, canvas.height - 1);
  const left = Math.floor((canvas.width - w * cw) / 2), top = Math.floor((canvas.height - h) / 2);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) canvas.fill(left + x * cw, top + y, cw, 1, ' ', {bg: (x + y) % 2 ? look.surface.raised : look.surface.sunken});
  const rocks = [[3, 1], [w - 1, 2], [1, 3]];
  for (const [x, y] of rocks) if (x! < w && y! < h) canvas.text(left + x! * cw, top + y!, '▓'.repeat(cw), {fg: look.text.dim, bg: look.surface.raised2});
  const t = Math.floor((frame % 24) / 4);
  const path = [[0, 0], [2, 0], [2, 3], [Math.min(w - 2, 5), 3], [Math.min(w - 2, 5), 2], [Math.min(w - 2, 5), 2]][t]!;
  canvas.text(left + Math.min(w - 2, 5) * cw, top + 2, '()', {fg: look.ok, bold: true});
  canvas.text(left + path[0]! * cw, top + Math.min(h - 1, path[1]!), cw === 3 ? '^.^' : '^^', {fg: look.text.onAccent, bg: look.accent, bold: true});
}

export const iceGame: GameDefinition = {
  id: 'ice', aliases: ['ice-paws', 'ice-slide'], title: 'Ice Paws', tagline: 'Slide to the fish bowl',
  description: 'The cat cannot stop on ice: it slides until a rock or the wall. Plan your slides and land in the fish bowl. Every rink is checked solvable and shows its shortest solution.',
  kind: 'puzzle', category: 'logic',
  controls: [{keys: '←↑↓→', action: 'slide'}, {keys: 'u', action: 'undo'}, {keys: 'r', action: 'restart'}, {keys: '?', action: 'hint'}],
  howToPlay: [
    'An arrow slides the cat in that direction until a rock or the edge stops it. The fish bowl ( ) catches the cat as it slides over.',
    'Reach the bowl in as few slides as you can. ? shows the best next slide, u undoes, r restarts the rink.',
  ],
  summary: record => {
    const saved = readIce(record);
    const level = ([...LEVEL_IDS].reverse()).find(id => saved.best[id]);
    return level ? `Best ${saved.best[level]} · ${LEVELS[level].label.toLowerCase()}` : 'Not played yet';
  },
  preview,
  create: context => new IcePaws(context),
};
