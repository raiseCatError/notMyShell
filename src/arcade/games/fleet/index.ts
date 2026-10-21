import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {truncateText} from '../../../util/text.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BOATS, CELLS, Gunner, SIDE, span, Waters} from './logic.js';

/**
 * Cat Fleet: Battleship against a computer that plays fair. Place five boats yourself or at random, then trade shots.
 * Every state has its own glyph (water, miss, hit, sunk boat, your boat), so the boards read without color, and the
 * log line says in words what the last shots did. Narrow terminals show one board at a time (Tab switches).
 */
const COLS = 'ABCDEFGHIJ';
const WATER = rgb(0x6aa8d8);

const name = (cell: number): string => `${COLS[cell % SIDE]}${Math.floor(cell / SIDE) + 1}`;

interface Layout { cw: number; ch: number; dual: boolean; labels: boolean; y: number; left: number; right: number }

class CatFleet implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'place' | 'battle' = 'menu';
  private menu: Menu;
  private mine = new Waters();
  private theirs = new Waters();
  private gunner: Gunner;
  private cursor = 45;
  private horizontal = true;
  private view: 'enemy' | 'mine' = 'enemy';
  private shots = 0;
  private hitsMade = 0;
  private log = '';
  private lastAi = -1;
  private aiWait = 0;
  private outcome: 'won' | 'lost' | undefined;
  private wave: Reveal | undefined;
  private startBest = 0;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.gunner = new Gunner(context.rng.fork('fleet-ai'));
    this.particles = new ParticleSystem(context.rng.fork('fleet-fx'), 120, context.motion.effects);
    this.menu = new Menu([
      {id: 'random', label: 'Quick start', key: 'q', hint: 'random fleet'},
      {id: 'manual', label: 'Place my fleet', key: 'p', hint: 'choose spots'},
    ]);
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.outcome === 'won' ? 'won' : this.outcome === 'lost' ? 'over' : 'playing'; }
  get finale(): Finale | undefined { return this.outcome ? this.wave : undefined; }
  get refreshMs(): number { return this.aiWait > 0 || (this.wave && !this.wave.done) || this.particles.count ? 40 : 0; }

  private start(mode: 'random' | 'manual'): void {
    this.mine = new Waters(); this.theirs = new Waters();
    this.gunner = new Gunner(createRng(this.context.rng.int(1, 0x7fffffff)));
    this.theirs.placeRandom(createRng(this.context.rng.int(1, 0x7fffffff)));
    this.shots = 0; this.hitsMade = 0; this.log = ''; this.lastAi = -1; this.aiWait = 0;
    this.outcome = undefined; this.wave = undefined; this.result = undefined; this.view = 'enemy';
    this.startBest = readScore(this.context.record.get()).best;
    this.particles.clear();
    this.cursor = 45;
    if (mode === 'random') { this.mine.placeRandom(createRng(this.context.rng.int(1, 0x7fffffff))); this.beginBattle(); } else { this.screen = 'place'; this.log = 'Place the Galleon (5)'; }
  }

  private beginBattle(): void { this.screen = 'battle'; this.cursor = 45; this.log = 'Fire at the enemy waters'; }

  step(): void {}

  animate(dtMs: number): void {
    this.wave?.update(dtMs);
    this.particles.update(dtMs);
    if (this.aiWait > 0 && !this.outcome) { this.aiWait -= dtMs; if (this.aiWait <= 0) this.aiTurn(); }
  }

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (key.kind === 'escape') return 'ignored';
      const choice = this.menu.key(key);
      if (choice) this.start(choice as 'random' | 'manual');
      return 'handled';
    }
    if (this.outcome) { this.wave?.skip(); return 'ignored'; }
    if (this.screen === 'place') return this.placeKey(key);
    if (this.aiWait > 0) { this.aiWait = 0; this.aiTurn(); return 'handled'; }
    if (key.kind === 'complete' || (key.kind === 'text' && key.value.toLowerCase() === 'v')) { this.view = this.view === 'enemy' ? 'mine' : 'enemy'; return 'handled'; }
    const move = direction(key);
    if (move) { this.moveCursor(move); return 'handled'; }
    if (isConfirm(key)) { if (this.view === 'enemy' || this.layout()?.dual) this.fire(); else this.log = 'Switch to the enemy waters (Tab) to fire'; return 'handled'; }
    return 'ignored';
  }

  private moveCursor(move: 'up' | 'down' | 'left' | 'right'): void {
    const x = this.cursor % SIDE + (move === 'left' ? -1 : move === 'right' ? 1 : 0);
    const y = Math.floor(this.cursor / SIDE) + (move === 'up' ? -1 : move === 'down' ? 1 : 0);
    if (x >= 0 && y >= 0 && x < SIDE && y < SIDE) this.cursor = y * SIDE + x;
  }

  private placeKey(key: Key): GameKeyResult {
    const move = direction(key);
    if (move) { this.moveCursor(move); return 'handled'; }
    const index = this.mine.boats.length;
    if (isConfirm(key)) {
      if (this.mine.complete) { this.beginBattle(); return 'handled'; }
      if (this.mine.place(index, this.cursor, this.horizontal)) {
        this.log = this.mine.complete ? 'Fleet ready: Enter starts the battle, u takes a boat back' : `Place the ${BOATS[index + 1]!.name} (${BOATS[index + 1]!.length})`;
      } else this.log = 'It does not fit there';
      return 'handled';
    }
    if (key.kind !== 'text') return 'ignored';
    const value = key.value.toLowerCase();
    if (value === 'r') this.horizontal = !this.horizontal;
    else if (value === 'u') { this.mine.removeLast(); this.log = `Place the ${BOATS[this.mine.boats.length]!.name} (${BOATS[this.mine.boats.length]!.length})`; }
    else if (value === 'x') { this.mine.placeRandom(createRng(this.context.rng.int(1, 0x7fffffff))); this.log = 'Fleet ready: Enter starts the battle, u takes a boat back'; }
    else return 'ignored';
    return 'handled';
  }

  private fire(): void {
    const result = this.theirs.fire(this.cursor);
    if (!result) { this.log = 'Already fired there'; return; }
    this.shots += 1;
    if (result.hit) this.hitsMade += 1;
    this.log = `You: ${name(result.cell)} ${result.sunk ? `hit - ${result.sunk.name} sunk!` : result.hit ? 'hit!' : 'miss'}`;
    this.splash(result.cell, result.hit, true);
    if (this.theirs.allSunk) { this.finish('won'); return; }
    if (this.context.motion.reduced) this.aiTurn(); else this.aiWait = 520;
  }

  private aiTurn(): void {
    this.aiWait = 0;
    const cell = this.gunner.next();
    const result = this.mine.fire(cell)!;
    this.gunner.report(cell, result.hit, result.sunk?.cells);
    this.lastAi = cell;
    this.log += `  |  Cats: ${name(cell)} ${result.sunk ? `${result.sunk.name} lost!` : result.hit ? 'hit' : 'miss'}`;
    this.splash(cell, result.hit, false);
    if (this.mine.allSunk) this.finish('lost');
  }

  private splash(cell: number, hit: boolean, enemy: boolean): void {
    const layout = this.layout();
    if (!layout || (!layout.dual && (this.view === 'enemy') !== enemy)) return;
    const x = (enemy ? layout.right : layout.left) + (cell % SIDE) * layout.cw + layout.cw / 2;
    const y = (layout.y + Math.floor(cell / SIDE) * layout.ch) * 2 + layout.ch;
    const look = arcadeLook();
    this.particles.burst({x, y, count: hit ? 12 : 6, speed: 26, life: 420, gravity: 20, drag: 1.2, colors: hit ? [look.bad, look.warn, look.gold] : [WATER, rgb(0xcfe8ff)]});
  }

  private finish(outcome: 'won' | 'lost'): void {
    this.outcome = outcome;
    const won = outcome === 'won';
    const score = won ? 100 + this.mine.remainingCells * 5 + Math.max(0, 100 - this.shots) : 0;
    const before = this.context.record.get();
    const fastest = count(before.fastest);
    this.context.record.update(raw => {
      if (won) { raw.wins = count(raw.wins) + 1; raw.fastest = fastest ? Math.min(fastest, this.shots) : this.shots; } else raw.losses = count(raw.losses) + 1;
    });
    const saved = saveScore(this.context.record, score);
    const boats = won ? this.theirs.boats : this.theirs.boats.filter(boat => !this.theirs.isSunk(boat));
    this.wave = new Reveal(boats.map(boat => boat.cells), this.context.motion, {stagger: 240, within: 50, rise: 140, hold: 240, fall: 400});
    if (won) { const look = arcadeLook(); confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, look.gold, look.hue.sky], this.context.motion); }
    this.result = {
      score, scoreText: won ? score.toLocaleString('en-US') : 'Fleet sunk', record: won && score > this.startBest,
      details: [won ? 'The enemy fleet is sunk' : 'The cats sank your fleet', `Shots ${this.shots} · hits ${this.hitsMade}`, `Your boats afloat ${this.mine.boats.length - this.mine.sunk.length}`, `Best ${saved.best}`],
    };
  }

  private layout(): Layout | undefined {
    const {columns, rows} = this.size;
    const sizes = [[4, 2], [3, 1], [2, 1]] as const;
    for (const dual of [true, false]) for (const [cw, ch] of sizes) {
      const need = dual ? 2 * (SIDE * cw + 3) + 4 : SIDE * cw + 3;
      if (columns >= need && rows >= SIDE * ch + 4) {
        const left = Math.floor((columns - need) / 2) + 3;
        return {cw, ch, dual, labels: true, y: 2 + Math.max(0, Math.floor((rows - SIDE * ch - 4) / 2)), left, right: dual ? left + SIDE * cw + 3 + 4 : left};
      }
    }
    for (const [cw, ch] of sizes) if (columns >= SIDE * cw && rows >= SIDE * ch + 2) return {cw, ch, dual: false, labels: false, y: 1, left: Math.floor((columns - SIDE * cw) / 2), right: Math.floor((columns - SIDE * cw) / 2)};
    return undefined;
  }

  private glyph(waters: Waters, cell: number, own: boolean, unicode: boolean): {ch: string; fg: Rgb; bold: boolean} {
    const look = arcadeLook();
    const shot = waters.shots[cell]!, boat = waters.boatAt(cell);
    const sunk = boat ? waters.isSunk(boat) : false;
    if (shot === 2) return sunk ? {ch: unicode ? '▣' : '%', fg: look.warn, bold: true} : {ch: unicode ? '✖' : 'X', fg: look.bad, bold: true};
    if (shot === 1) return {ch: unicode ? '○' : 'o', fg: look.text.normal, bold: false};
    if (own && boat) return {ch: unicode ? '■' : '#', fg: look.hue.mint, bold: true};
    return {ch: unicode ? '·' : '.', fg: mixRgb(WATER, look.surface.sunken, 0.45), bold: false};
  }

  private drawBoard(canvas: Canvas, look: ArcadeLook, layout: Layout, left: number, waters: Waters, own: boolean, title: string, cursor: number | undefined, ghost: {cells: number[]; ok: boolean} | undefined): void {
    const color = this.context.color !== 'none';
    const unicode = color && !this.context.safeGlyphs;
    const well = look.surface.sunken;
    const {cw, ch} = layout;
    if (layout.labels) {
      canvas.text(left, layout.y - 2, title, {fg: look.text.strong, bold: true});
      for (let x = 0; x < SIDE; x += 1) canvas.put(left + x * cw + Math.floor(cw / 2), layout.y - 1, COLS[x]!, {fg: color ? look.text.dim : undefined});
      for (let y = 0; y < SIDE; y += 1) canvas.text(left - 3, layout.y + y * ch, String(y + 1).padStart(2), {fg: color ? look.text.dim : undefined});
    }
    if (color) canvas.fill(left, layout.y, SIDE * cw, SIDE * ch, ' ', {bg: well});
    for (let cell = 0; cell < CELLS; cell += 1) {
      const px = left + (cell % SIDE) * cw, py = layout.y + Math.floor(cell / SIDE) * ch;
      let {ch: glyph, fg, bold} = this.glyph(waters, cell, own, unicode);
      const isGhost = ghost?.cells.includes(cell);
      if (isGhost) { glyph = ghost!.ok ? '+' : '!'; fg = ghost!.ok ? look.ok : look.bad; bold = true; }
      const isCursor = cell === cursor;
      const glow = this.wave && !own && this.wave.has(cell) ? this.wave.amount(cell) : 0;
      if (glow > 0) fg = mixRgb(fg, rgb(0xffffff), glow);
      const bg = color ? (isCursor ? look.surface.selected : glow > 0 ? mixRgb(well, look.gold, 0.4 * glow) : well) : undefined;
      const style = {fg: color ? fg : undefined, bg, bold, reverse: !color && isCursor && cw < 3, underline: isCursor && cw < 3};
      if (ch === 2 || bg) canvas.fill(px, py, cw, ch, ' ', {bg, reverse: !color && isCursor && cw < 3});
      const gx = px + Math.floor((cw - 1) / 2);
      canvas.put(gx, py, glyph, style);
      if (isCursor && cw >= 3) {
        const edge = {fg: color ? look.text.strong : undefined, bg, bold: true};
        canvas.put(px, py, '[', edge); canvas.put(px + cw - 1, py, ']', edge);
      }
      if (own && cell === this.lastAi && cw >= 3 && !isCursor) canvas.put(px + cw - 1, py, '<', {fg: color ? look.warn : undefined, bg});
    }
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu') {
      topRow(canvas, look, 'Cat Fleet', scoreSummary(this.context.record.get()));
      const top = Math.max(2, Math.floor(canvas.height / 2) - 4);
      canvas.center(top, 'Sink the cats\' fleet', {fg: look.text.strong, bold: true});
      canvas.center(top + 1, 'Five boats each. One shot a turn.', {fg: look.text.normal});
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const afloat = (waters: Waters): string => waters.boats.filter(boat => !waters.isSunk(boat)).map(boat => boat.length).join(' ');
    const top = this.screen === 'place' ? 'Cat Fleet · place your boats' : `Shots ${this.shots}  Hits ${this.hitsMade}  Afloat you ${this.mine.boats.length - this.mine.sunk.length} / them ${this.theirs.boats.length - this.theirs.sunk.length}`;
    topRow(canvas, look, 'Cat Fleet', top);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger', {fg: look.warn}); return; }
    if (this.screen === 'place') {
      const index = this.mine.boats.length;
      const spec = BOATS[index];
      const cells = spec ? span(this.cursor, spec.length, this.horizontal) : undefined;
      const ghost = spec ? {cells: cells ?? [], ok: !!cells && this.mine.canPlace(spec.length, this.cursor, this.horizontal)} : undefined;
      this.drawBoard(canvas, look, layout, layout.left, this.mine, true, 'Your waters', this.cursor, ghost);
    } else if (layout.dual) {
      this.drawBoard(canvas, look, layout, layout.left, this.mine, true, `Your waters (${afloat(this.mine) || 'none'})`, undefined, undefined);
      this.drawBoard(canvas, look, layout, layout.right, this.theirs, false, `Enemy waters (${afloat(this.theirs) || 'none'})`, this.cursor, undefined);
    } else if (this.view === 'enemy') this.drawBoard(canvas, look, layout, layout.left, this.theirs, false, `Enemy waters (${afloat(this.theirs) || 'none'})`, this.cursor, undefined);
    else this.drawBoard(canvas, look, layout, layout.left, this.mine, true, `Your waters (${afloat(this.mine) || 'none'})`, undefined, undefined);
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    const base = layout.y + SIDE * layout.ch;
    const text = this.outcome === 'won' ? 'Victory! The enemy fleet is sunk.' : this.outcome === 'lost' ? 'Your fleet is sunk.' : this.log;
    const keysLine = this.screen === 'place' ? 'Arrows move · r turns · Space places · x random · u back' : layout.dual ? 'Arrows aim · Space fires' : 'Arrows aim · Space fires · Tab switches board';
    if (base < canvas.height) canvas.center(base, truncateText(text, canvas.width - 2), {fg: this.outcome === 'won' ? look.ok : this.outcome === 'lost' ? look.bad : look.text.normal, bold: !!this.outcome});
    if (base + 1 < canvas.height) canvas.center(base + 1, truncateText(keysLine, canvas.width - 2), {fg: look.text.dim});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return this.screen === 'place' ? PLACE_HINTS : HINTS; }
  persist(): void {}
  dispose(): void { this.particles.clear(); }
}

const HINTS: readonly ControlHint[] = [{keys: '←↑↓→', action: 'aim'}, {keys: 'Space', action: 'fire'}, {keys: 'Tab', action: 'switch board'}];
const PLACE_HINTS: readonly ControlHint[] = [{keys: '←↑↓→', action: 'move'}, {keys: 'r', action: 'rotate'}, {keys: 'Space', action: 'place'}, {keys: 'x', action: 'random'}, {keys: 'u', action: 'take back'}];

/** The hub preview: a small sea with a hit streak sweeping across a boat. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const w = 8, h = 5, left = Math.floor((canvas.width - w * 3) / 2), top = Math.max(0, Math.floor((canvas.height - h) / 2));
  canvas.fill(left, top, w * 3, h, ' ', {bg: look.surface.sunken});
  const phase = Math.floor(frame / 3) % 14;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) canvas.put(left + x * 3 + 1, top + y, '·', {fg: mixRgb(WATER, look.surface.sunken, 0.5), bg: look.surface.sunken});
  for (let index = 0; index < 4; index += 1) {
    const hit = phase > index * 2;
    canvas.put(left + (2 + index) * 3 + 1, top + 2, hit ? '✖' : '■', {fg: hit ? look.bad : look.hue.mint, bg: look.surface.sunken, bold: true});
  }
  canvas.put(left + 6 * 3 + 1, top, '○', {fg: look.text.normal, bg: look.surface.sunken});
}

export const fleetGame: GameDefinition = {
  id: 'fleet', aliases: ['cat-fleet', 'battleship'], title: 'Cat Fleet', tagline: 'Find and sink the hidden fleet',
  description: 'Battleship on a 10 × 10 sea. Place five boats yourself or at random, then take turns firing at hidden squares against a computer that hunts in a checkerboard and finishes boats it hits, using only what its own shots reveal.',
  kind: 'puzzle', category: 'logic', controls: HINTS,
  howToPlay: [
    'Place five boats (r turns the one in hand), or take a random fleet. Then aim at the enemy waters and press Space to fire; hits show ✖ (X), misses ○ (o) and a sunk boat ▣ (%).',
    'You and the cats take one shot each in turn. Sink all five enemy boats first. Fewer shots and more of your boats afloat score higher.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · won ${count(record.wins)}` : 'Not played yet'; },
  preview,
  create: context => new CatFleet(context),
};
