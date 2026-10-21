import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {confetti, shatter} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, readyText, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import {arcadePalette, type ArcadePalette} from '../../palette.js';
import {disc, gradient, ridge, rgb, stars} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {FUEL_MAX, HEAD, RoverState, WHEEL_R, WHEEL_X, WHEEL_Y} from './logic.js';

/**
 * Vespyr Rover: hill-climb driving over endless procedural moon terrain. Gas and brake on the arrows; tilt presses are
 * short torque pulses that spin the rover in the air and shift its weight on the ground, so you can land on both wheels
 * or chase flips; fuel cans keep the tank up. A drawn scene (parallax ridges, stars, the rover drawn rotated by its
 * simulated angle, on its suspension, with Vespyr at the wheel); without color it falls back to a text profile of the
 * same terrain.
 */
const TIRE = rgb(0x15122a);
const CAN = rgb(0xffb347);
const GRASS = rgb(0x7fe0a8);
const DIRT = [rgb(0x5b3f6e), rgb(0x432d58), rgb(0x2f2043)];

interface Colors { sky: Rgb[]; body: Rgb; trim: Rgb; glass: Rgb; fur: Rgb }
function colorsFor(palette: ArcadePalette, look: ArcadeLook): Colors {
  return {sky: [mixRgb(palette.deep, rgb(0x000000), 0.2), palette.dusk, mixRgb(palette.dusk, palette.haze, 0.55)], body: look.hue.coral, trim: look.hue.butter, glass: look.hue.sky, fur: palette.cat.body};
}

/** Draw the rover into `buffer` at pixel (cx, cy), rotated by `angle`, at `scale` pixels per unit; wheels turn with `spin`. */
export function drawRover(buffer: PixelBuffer, cx: number, cy: number, angle: number, scale: number, spin: number, colors: Colors, crashed = false, compression: readonly [number, number] = [1, 1]): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  const reach = Math.ceil((WHEEL_X + WHEEL_R + 3) * scale) + 2;
  for (let py = Math.floor(cy - reach); py <= Math.ceil(cy + reach); py += 1) {
    for (let px = Math.floor(cx - reach); px <= Math.ceil(cx + reach); px += 1) {
      const dx = (px + 0.5 - cx) / scale, dy = (py + 0.5 - cy) / scale;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c; // into body space
      let color: Rgb | undefined;
      for (const [side, sx] of [-WHEEL_X, WHEEL_X].entries()) {
        const center = WHEEL_Y - compression[side]!;
        if (Math.abs(lx - sx) < 0.45 && ly > 1.5 && ly < center) color = TIRE;
        const wx = lx - sx, wy = ly - center;
        const d = Math.hypot(wx, wy);
        if (d <= WHEEL_R) {
          color = d < WHEEL_R * 0.5 ? colors.trim : TIRE;
          const a = Math.atan2(wy, wx) - spin;
          if (d < WHEEL_R * 0.85 && d > WHEEL_R * 0.2 && Math.abs(Math.sin(a * 2)) > 0.93) color = colors.trim;
        }
      }
      if (!color) {
        if (ly >= -2.2 && ly <= 1.9 && lx >= -7 && lx <= 7.2) color = ly < -1.4 ? mixRgb(colors.body, rgb(0xffffff), 0.35) : ly > 1.0 ? mixRgb(colors.body, rgb(0x000000), 0.35) : colors.body;
        else if (ly >= -4.4 && ly < -2.2 && lx >= -4.2 && lx <= 2.6) color = lx > 1.2 ? colors.glass : colors.body;
      }
      if (Math.hypot(lx - HEAD.x, ly - HEAD.y + 0.2) <= HEAD.r + 0.5) color = crashed ? mixRgb(colors.fur, rgb(0xff6a6a), 0.5) : colors.fur;
      if (Math.hypot(lx - HEAD.x - 0.7, ly - HEAD.y + 0.1) <= 0.3 && scale >= 0.8) color = TIRE;
      if (color) buffer.set(px, py, color);
    }
  }
}

class Rover implements GameInstance {
  result: GameResult | undefined;
  readonly stepsPerSecond = 60;
  private readonly state: RoverState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(220);
  private pixels = new PixelBuffer(0, 0);
  private camY = 0;
  private drawCamY = 0;
  private frac = 0.28;
  private clock = 0;
  private banner = '';
  private bannerMs = 0;
  private dust = 0;
  private readonly startBest: number;
  private celebrate = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new RoverState(context.seed);
    this.particles = new ParticleSystem(context.rng.fork('rover-fx'), 200, context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
    this.camY = this.state.y;
    this.drawCamY = this.camY;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.started || this.context.motion.reduced ? 0 : 100; }

  step(dtMs: number): void {
    if (this.done) return;
    const state = this.state;
    state.step(dtMs);
    const view = this.view(this.size.columns, this.size.rows);
    const at = (x: number, y: number) => ({x: (x - this.camX(state.x, view)) * view.scale, y: view.y0 + (y - this.drawCamY) * view.scale});
    if (state.driving && state.grounded && this.context.motion.effects !== 'off') {
      this.dust += 1;
      if (this.dust % 5 === 0) {
        const p = at(state.local(-WHEEL_X, WHEEL_Y + WHEEL_R).x, state.local(-WHEEL_X, WHEEL_Y + WHEEL_R).y);
        this.particles.burst({x: p.x, y: p.y, count: 2, speed: 14, angle: Math.PI * 1.1, spread: 0.7, life: 380, gravity: 20, drag: 1.5, colors: [DIRT[0]!, GRASS]});
      }
    }
    for (const event of state.events.splice(0)) {
      const p = at(event.kind === 'flip' ? state.x : event.x, event.kind === 'flip' ? state.y : event.y);
      if (event.kind === 'pickup') {
        this.particles.burst({x: p.x, y: p.y, count: 8, speed: 30, angle: -Math.PI / 2, spread: Math.PI, life: 500, gravity: 40, drag: 1, colors: [CAN, rgb(0xfff2c0)]});
        this.say(`Fuel +50`);
      } else if (event.kind === 'land') {
        this.particles.burst({x: p.x, y: p.y + 2, count: 4, speed: 20 + event.speed * 0.3, angle: -Math.PI / 2, spread: 1.3, life: 400, gravity: 50, drag: 1.2, colors: [DIRT[0]!, GRASS]});
      } else if (event.kind === 'flip') {
        this.say(`Flip!  +${event.count * 25}`);
      } else if (event.kind === 'crash') {
        shatter(this.particles, {x: p.x - 4, y: p.y - 3, width: 8, height: 6}, [this.colors().body, this.colors().trim, TIRE], {speed: 46, gravity: 90});
        this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
      }
    }
    if (state.over) this.finish();
  }

  private colors(): Colors { return colorsFor(this.lastPalette, arcadeLook(this.lastPalette)); }
  private lastPalette: ArcadePalette = arcadePalette();

  private say(text: string): void { this.banner = text; this.bannerMs = 1400; }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {bestDistance: state.distance, bestFlips: state.flips});
    const record = state.score > 0 && state.score > this.startBest;
    this.result = {
      score: state.score, scoreText: `${state.score.toLocaleString('en-US')} m`, record,
      details: [state.reason === 'fuel' ? 'Out of fuel' : state.reason === 'stuck' ? 'Stranded' : 'Crashed upside down', `Distance ${state.distance} m`, `Flips ${state.flips}`, `Fuel cans ${state.collected}`, `Best ${saved.best.toLocaleString('en-US')} m`],
    };
    if (record) {
      this.celebrate = 2400;
      confetti(this.particles, this.size.columns, this.size.rows * 2, [CAN, GRASS, this.colors().body, this.colors().glass], this.context.motion);
    }
  }

  animate(dtMs: number): void {
    this.clock += dtMs;
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    this.bannerMs = Math.max(0, this.bannerMs - dtMs);
    this.celebrate = Math.max(0, this.celebrate - dtMs);
    // Camera: look further ahead the faster the rover goes, follow the rover and the ground ahead on the ground, and chase
    // the rover itself in the air (render keeps it inside the frame whatever the lag).
    const state = this.state;
    const view = this.view(this.size.columns, this.size.rows);
    this.frac += (0.27 + 0.13 * clamp(state.vx / 55, 0, 1) - this.frac) * clamp(dtMs / 500, 0, 1);
    const ahead = state.terrain.height(state.x + (view.width / view.scale) * 0.4);
    const target = state.grounded ? state.y * 0.62 + ahead * 0.38 : state.y;
    this.camY += (target - this.camY) * clamp(dtMs / (state.grounded ? 280 : 130), 0, 1);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    const dir = direction(key);
    if (dir === 'right') this.state.drive(1);
    else if (dir === 'left') this.state.drive(-1);
    else if (dir === 'up') this.state.tilt(-1);
    else if (dir === 'down') this.state.tilt(1);
    else if (isConfirm(key)) this.state.drive(1);
    else return 'ignored';
    this.started = true;
    return 'handled';
  }

  private view(columns: number, rows: number): {scale: number; y0: number; width: number; height: number} {
    const height = Math.max(8, rows * 2);
    return {scale: clamp(columns / 80, 0.5, 1.6), y0: 2 + Math.floor((height - 2) * 0.58), width: columns, height};
  }
  private camX(x: number, view: {scale: number; width: number}): number { return x - (view.width / view.scale) * this.frac; }
  /** The smoothed camera height, held so the rover stays inside the frame (below the HUD rows) however high it flies. */
  private camYFor(ry: number, view: {scale: number; y0: number; height: number}): number {
    return clamp(this.camY, ry - (view.height - 8 - view.y0) / view.scale, ry - (8 - view.y0) / view.scale);
  }

  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void {
    this.lastPalette = palette;
    const look = arcadeLook(palette);
    const state = this.state;
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const fuel = Math.round((state.fuel / FUEL_MAX) * 100);
    const unitText = `${state.score.toLocaleString('en-US')} m`;
    const view = this.view(canvas.width, canvas.height);
    const rx = state.px + (state.x - state.px) * alpha;
    const ry = state.py + (state.y - state.py) * alpha;
    const ra = state.pangle + (state.angle - state.pangle) * alpha;
    const camX = this.camX(rx, view);
    this.drawCamY = this.camYFor(ry, view);
    if (color) this.drawScene(canvas, palette, look, view, camX, rx, ry, ra);
    else this.drawText(canvas, look, view, camX, rx, ry);
    topRow(canvas, look, 'Vespyr Rover', `${unitText}  Fuel ${fuel}%`);
    this.drawFuel(canvas, look, fuel, color);
    this.popups.draw(canvas, look.surface.base);
    const middle = Math.floor(canvas.height / 3);
    if (!this.started) readyText(canvas, look, 'Vespyr Rover', ['Press → to drive', '→ gas  ← brake  ↑↓ tilt', 'Land on your wheels'], middle);
    else if (!this.done && state.danger > 0) {
      const blink = this.context.motion.reduced || Math.floor(this.clock / 150) % 2 === 0;
      const left = Math.max(0, Math.ceil((1 - state.danger) * 5));
      canvas.center(Math.max(2, middle - 1), `${state.upsideDown ? 'UPSIDE DOWN' : 'ROOF DOWN'}! Roll back  ${'#'.repeat(left)}${'-'.repeat(5 - left)}`.slice(0, canvas.width - 2), {fg: look.bad, bold: blink});
    } else if (this.bannerMs > 0 && !this.done) canvas.center(Math.max(2, middle - 1), this.banner, {fg: look.gold, bold: true});
    if (this.done) {
      const record = this.result?.record;
      canvas.center(middle, this.state.reason === 'fuel' ? 'OUT OF FUEL' : this.state.reason === 'stuck' ? 'STRANDED' : 'CRASHED', {fg: look.bad, bold: true});
      canvas.center(middle + 1, `${unitText}${record ? '  *  NEW RECORD  *' : ''}`, {fg: record ? look.gold : look.text.strong, bold: true});
    }
  }

  private drawFuel(canvas: Canvas, look: ArcadeLook, fuel: number, color: boolean): void {
    const slots = clamp(canvas.width - 14, 0, 12);
    const filled = Math.round((fuel / 100) * slots);
    const bar = color ? '█'.repeat(filled) + '░'.repeat(slots - filled) : '#'.repeat(filled) + '-'.repeat(slots - filled);
    const low = fuel <= 25;
    const text = slots > 0 ? `Fuel [${bar}]${low ? ' LOW' : ''}` : `Fuel ${fuel}%${low ? ' LOW' : ''}`;
    canvas.text(1, 1, text.slice(0, Math.max(0, canvas.width - 2)), {fg: low ? look.warn : look.text.normal, bold: low});
  }

  private drawScene(canvas: Canvas, palette: ArcadePalette, look: ArcadeLook, view: {scale: number; y0: number; width: number; height: number}, camX: number, rx: number, ry: number, ra: number): void {
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const colors = colorsFor(palette, look);
    const top = 2;
    const sky = colors.sky;
    gradient(buffer, sky, top, buffer.height);
    stars(buffer, 11, Math.floor(buffer.height * 0.55), palette.haze, sky[0]!, {scroll: camX * view.scale * 0.05, time: this.context.motion.reduced ? 0 : this.clock, strength: 0.9});
    disc(buffer, Math.floor(buffer.width * 0.78), top + Math.floor(buffer.height * 0.2), Math.max(2, Math.round(buffer.height * 0.08)), rgb(0xfff4d6), sky[1]!, 2);
    ridge(buffer, {base: buffer.height - 2, height: buffer.height * 0.38, amplitude: buffer.height * 0.1, scale: 30, scroll: camX * view.scale * 0.15, seed: 3, color: mixRgb(sky[1]!, palette.deep, 0.45), step: 2});
    ridge(buffer, {base: buffer.height - 2, height: buffer.height * 0.28, amplitude: buffer.height * 0.08, scale: 18, scroll: camX * view.scale * 0.35, seed: 8, color: mixRgb(sky[1]!, palette.deep, 0.7), rim: mixRgb(sky[2]!, palette.deep, 0.5), step: 2});
    // Terrain.
    for (let x = 0; x < buffer.width; x += 1) {
      const wx = camX + x / view.scale;
      const gy = Math.round(view.y0 + (this.state.terrain.height(wx) - this.drawCamY) * view.scale);
      for (let y = Math.max(top, gy); y < buffer.height; y += 1) {
        const depth = y - gy;
        buffer.set(x, y, depth < 1 ? GRASS : depth < 2 ? mixRgb(GRASS, DIRT[0]!, 0.5) : DIRT[Math.min(2, Math.floor(depth / 5))]!);
      }
    }
    // Fuel cans, with a letter on top so the pickup is not just a color.
    for (const pickup of this.state.pickups) {
      const x = Math.round((pickup.x - camX) * view.scale), y = Math.round(view.y0 + (pickup.y - this.drawCamY) * view.scale);
      if (x < -4 || x > buffer.width + 4) continue;
      const w = Math.max(3, Math.round(3.4 * view.scale)), h = Math.max(4, Math.round(4.4 * view.scale));
      buffer.rect(x - Math.floor(w / 2), y - Math.floor(h / 2), w, h, CAN);
      buffer.rect(x - Math.floor(w / 2), y - Math.floor(h / 2), w, 1, rgb(0xfff2c0));
    }
    const spin = this.state.spin;
    drawRover(buffer, (rx - camX) * view.scale, view.y0 + (ry - this.drawCamY) * view.scale, ra, view.scale, spin, colors, this.state.over, this.state.compression);
    this.particles.draw(buffer, sky[1]!);
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
    for (const pickup of this.state.pickups) {
      const x = Math.round((pickup.x - camX) * view.scale), y = Math.floor((view.y0 + (pickup.y - this.drawCamY) * view.scale) / 2);
      if (x >= 0 && x < canvas.width && y >= 2 && y < canvas.height) canvas.put(x, y, 'F', {fg: rgb(0x2a1a00), bg: CAN, bold: true});
    }
  }

  /** Without color: the hills as / \ _ marks, the rover as O=O with Vespyr (c) above, fuel cans as F. */
  private drawText(canvas: Canvas, look: ArcadeLook, view: {scale: number; y0: number; width: number; height: number}, camX: number, rx: number, ry: number): void {
    const cellY = (y: number) => Math.floor((view.y0 + (y - this.drawCamY) * view.scale) / 2);
    for (let x = 0; x < canvas.width; x += 1) {
      const wx = camX + x / view.scale;
      const gy = cellY(this.state.terrain.height(wx));
      const slope = this.state.terrain.slope(wx);
      const mark = Math.abs(slope) < 0.25 ? '_' : slope < 0 ? '/' : '\\';
      for (let y = Math.max(2, gy); y < canvas.height; y += 1) canvas.put(x, y, y === gy ? mark : y === gy + 1 ? ':' : '.', {fg: y === gy ? look.text.strong : look.text.dim});
    }
    for (const pickup of this.state.pickups) {
      const x = Math.round((pickup.x - camX) * view.scale);
      if (x >= 0 && x < canvas.width) canvas.put(x, cellY(pickup.y), 'F', {bold: true});
    }
    const state = this.state;
    const part = (lx: number, ly: number) => { const p = state.local(lx, ly, state.angle, rx, ry); return {x: Math.round((p.x - camX) * view.scale), y: cellY(p.y)}; };
    const a = part(-WHEEL_X, WHEEL_Y - state.compression[0]), b = part(WHEEL_X, WHEEL_Y - state.compression[1]), h = part(HEAD.x, HEAD.y);
    for (const lx of [-4.5, -3.3, -2.1, -0.9, 0.3, 1.5, 2.7, 3.9, 5]) { const m = part(lx, -0.5); canvas.put(m.x, m.y, '=', {bold: true}); }
    canvas.put(h.x, h.y, state.over ? 'x' : 'c', {bold: true});
    canvas.put(a.x, a.y, 'O', {bold: true});
    canvas.put(b.x, b.y, 'O', {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '→', action: 'gas'}, {keys: '←', action: 'brake'}, {keys: '↑ ↓', action: 'tilt (tap fast)'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: the rover rolling over a looping hill. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  const colors = colorsFor(palette, look);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  gradient(buffer, colors.sky);
  disc(buffer, Math.floor(buffer.width * 0.8), Math.floor(buffer.height * 0.25), 2, rgb(0xfff4d6), colors.sky[1]!, 1);
  const hill = (x: number) => buffer.height * 0.72 - Math.sin((x + frame * 2.2) / 7) * 2.5 - Math.sin((x + frame * 2.2) / 17) * 3;
  for (let x = 0; x < buffer.width; x += 1) for (let y = Math.round(hill(x)); y < buffer.height; y += 1) buffer.set(x, y, y === Math.round(hill(x)) ? GRASS : DIRT[1]!);
  const cx = buffer.width * 0.4;
  const slope = (hill(cx + 2) - hill(cx - 2)) / 4;
  drawRover(buffer, cx, hill(cx) - 3.2, Math.atan(slope), 0.8, frame * 0.5, colors);
  canvas.blit(buffer);
}

export const roverGame: GameDefinition = {
  id: 'rover', aliases: ['vespyr-rover', 'hill-climb'], title: 'Vespyr Rover', tagline: 'Climb the hills, mind the fuel',
  description: 'Drive Vespyr\'s moon rover over endless rolling terrain: gas and brake, tilt to spin the rover in the air and to land on both wheels, grab fuel cans and score for every metre and every flip. Staying roof-down too long ends the run.',
  kind: 'action', category: 'physics',
  controls: [{keys: '→ / D', action: 'gas'}, {keys: '← / A', action: 'brake'}, {keys: '↑ ↓', action: 'tilt (tap fast to chain)'}],
  howToPlay: [
    'Press → (or D) to drive and keep pressing or holding it to keep the gas on; ← (or A) brakes and then reverses.',
    'Each ↑ (nose up) or ↓ (nose down) press is a short twist; tap quickly to chain them. In the air it spins the rover, on the ground it shifts your weight. Land on both wheels; a full turn scores a flip.',
    'Fuel drains faster with the gas on. Drive through fuel cans (marked F). Head or roof on the ground, or stuck upside down, for under a second can still be rolled back; longer ends the run, as do an empty tank and being stranded.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record, ' m')} · ${count(record.bestFlips)} flips` : 'Not played yet'; },
  preview,
  create: context => new Rover(context),
};
