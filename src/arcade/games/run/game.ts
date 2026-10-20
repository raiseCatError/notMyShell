import type {Key} from '../../../terminal/keys.js';
import type {Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Flash, Shake} from '../../effects.js';
import type {ArcadePalette} from '../../palette.js';
import type {ControlHint, GameContext, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {drawTooSmall, geometry, MIN_COLUMNS, MIN_ROWS, RunScene, type Geometry} from './scene.js';
import type {CatLook} from './sprites.js';
import {RunWorld} from './world.js';

/** What a person's saved Vespyr Run record holds, read defensively (the file can be old, empty or hand-edited). */
export interface RunRecord { best: number; bestDistance: number; runs: number }

const clean = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000_000) : 0);
export function readRecord(raw: Readonly<Record<string, unknown>>): RunRecord {
  return {best: clean(raw.best), bestDistance: clean(raw.bestDistance), runs: clean(raw.runs)};
}

const POP_MS = 700;
/** After a crash the world holds still this many steps (the cat shown hit) before the game over card: shorter when motion is reduced. */
const DYING_STEPS = 24;
const DYING_STEPS_REDUCED = 8;
const LAND_STEPS = 7;

/** Test seams: a prepared world or a particle pool the test can inspect. The arcade always uses the defaults. */
export interface RunParts { world?: RunWorld; particles?: ParticleSystem }

export function createRunGame(context: GameContext, parts: RunParts = {}): GameInstance {
  const courseRng = context.rng.fork('course');
  const fxRng = context.rng.fork('fx');
  const world = parts.world ?? new RunWorld(courseRng);
  const scene = new RunScene();
  const particles = parts.particles ?? new ParticleSystem(fxRng, 140, context.motion.effects);
  const popups = new Popups(5, context.motion.effects);
  const flash = new Flash();
  const shake = new Shake();
  const decor = context.color !== 'none' && !context.safeGlyphs;
  let size = context.size;
  let geo: Geometry = geometry(size.columns, size.rows);
  let status: GameStatus = 'ready';
  let result: GameResult | undefined;
  let palette: ArcadePalette | undefined;
  let saved = readRecord(context.record.get());
  const startBest = saved.best;
  let visualMs = 0;
  let popMs = 0;
  let milestone = 0;
  let landSteps = 0;
  let dying = 0;
  let disposed = false;

  const tooSmall = (): boolean => size.columns < MIN_COLUMNS || size.rows < MIN_ROWS;

  function look(): CatLook {
    const d = world.distance;
    if (status === 'ready') {
      const blinking = visualMs % 3200 < 150;
      return {shape: blinking ? 'blink' : 'idle', frame: 0, tail: Math.floor(visualMs / 600) % 4, twitch: (visualMs + 1300) % 4300 < 180};
    }
    const tail = Math.floor(d / 12) % 4;
    const twitch = Math.floor(d) % 420 < 16;
    if (!world.alive) return {shape: 'hit', frame: 0, tail, twitch: false};
    if (world.airborne) return {shape: world.vy > 0 ? 'air' : 'fall', frame: 0, tail, twitch};
    if (world.ducking) return {shape: 'duck', frame: Math.floor(d / 6) % 2, tail, twitch};
    if (landSteps > 0) return {shape: 'land', frame: 0, tail, twitch};
    return {shape: 'run', frame: Math.floor(d / 5) % 6, tail, twitch};
  }

  function finish(): void {
    status = 'over';
    const score = world.score;
    const previous = readRecord(context.record.get());
    const next: RunRecord = {best: Math.max(previous.best, score), bestDistance: Math.max(previous.bestDistance, world.meters), runs: previous.runs + 1};
    context.record.update(record => { record.best = next.best; record.bestDistance = next.bestDistance; record.runs = next.runs; });
    saved = next;
    result = {
      score, scoreText: String(score).padStart(5, '0'), record: score > 0 && score > startBest,
      details: [`Distance ${world.meters} m`, `Best ${next.best}`, `Runs ${next.runs}`],
    };
  }

  function dust(): void {
    if (!palette || !decor) return;
    if (world.steps % 4 === 0 && !world.airborne && world.alive) {
      particles.burst({x: geo.catX + 3, y: geo.groundY - 1, count: 1, speed: world.speed * 0.6, angle: Math.PI, spread: 0.5, life: 380, gravity: -40, drag: 1.5, colors: [palette.muted, palette.faint]});
    }
  }

  const instance: GameInstance = {
    get status() { return status; },
    get result() { return result; },
    stepsPerSecond: 60,
    refreshMs: 100,

    step() {
      if (status !== 'playing') return;
      if (dying > 0) { dying -= 1; if (dying === 0) finish(); return; }
      const outcome = world.step();
      if (landSteps > 0) landSteps -= 1;
      dust();
      if (outcome.landedAfter >= 3 && palette && decor) {
        landSteps = LAND_STEPS;
        particles.burst({x: geo.catX + 5, y: geo.groundY - 1, count: 8, speed: 34, angle: -Math.PI / 2, spread: 1.3, life: 420, gravity: 60, drag: 2, colors: [palette.muted, palette.faint, palette.haze]});
      } else if (outcome.landedAfter >= 3) landSteps = LAND_STEPS;
      const reached = Math.floor(world.score / 100);
      if (reached > milestone) {
        milestone = reached;
        popMs = POP_MS;
        if (!context.motion.reduced && palette) popups.add(String(reached * 100), geo.catX + 7, Math.max(1, Math.floor(geo.groundY / 2) - 11), palette.accent);
      }
      if (outcome.hit) {
        dying = context.motion.reduced ? DYING_STEPS_REDUCED : DYING_STEPS;
        if (!context.motion.reduced && palette) {
          flash.trigger(true);
          shake.trigger(context.motion.effects !== 'off');
          particles.burst({x: geo.catX + 7, y: geo.groundY - 6, count: 26, speed: 70, spread: Math.PI, life: 650, gravity: 90, drag: 0.8, colors: [palette.warn, palette.bad, palette.ink, palette.accent]});
        }
      }
    },

    animate(dtMs) {
      visualMs += dtMs;
      particles.update(dtMs);
      popups.update(dtMs);
      flash.update(dtMs);
      shake.update(dtMs);
      popMs = Math.max(0, popMs - dtMs);
    },

    key(key: Key): GameKeyResult {
      const jump = key.kind === 'up' || (key.kind === 'text' && key.value === ' ');
      if (status === 'ready') {
        if (!jump) return 'ignored';
        status = 'playing';
        world.jump();
        return 'handled';
      }
      if (status !== 'playing') return 'ignored';
      if (dying > 0) return 'handled';
      if (jump) { world.jump(); return 'handled'; }
      if (key.kind === 'down') { world.duck(); return 'handled'; }
      return 'ignored';
    },

    render(canvas: Canvas, alpha: number, colors: ArcadePalette) {
      palette = colors;
      if (tooSmall() || canvas.width < MIN_COLUMNS || canvas.height < MIN_ROWS) { drawTooSmall(canvas, colors); return; }
      scene.draw(canvas, {
        world, alpha: status === 'playing' && dying === 0 ? alpha : 1, palette: colors, decor, reduced: context.motion.reduced, visualMs,
        look: look(), particles, popups, shake: shake.offset, flash: flash.amount,
        score: world.score, best: Math.max(saved.best, world.score), pop: popMs / POP_MS,
        phase: status === 'ready' ? 'ready' : status === 'over' ? 'over' : 'playing',
      });
    },

    resize(next) {
      size = next;
      geo = geometry(next.columns, next.rows);
      particles.clear();
      popups.clear();
    },

    pause() { /* The host owns the paused state; the fixed steps simply stop arriving. Nothing here advances on its own. */ },

    hints(): readonly ControlHint[] {
      return status === 'ready'
        ? [{keys: 'Space/Up', action: 'run'}, {keys: 'Esc', action: 'menu'}]
        : [{keys: 'Space/Up', action: 'jump'}, {keys: 'Down', action: 'duck'}, {keys: 'p', action: 'pause'}, {keys: 'Esc', action: 'menu'}];
    },

    persist() {
      // A run left unfinished keeps a better score than the saved best, but is not counted as a completed run.
      if (disposed || status !== 'playing' || world.score <= saved.best) return;
      const score = world.score;
      const meters = world.meters;
      context.record.update(record => { const current = readRecord(record); record.best = Math.max(current.best, score); record.bestDistance = Math.max(current.bestDistance, meters); record.runs = current.runs; });
      saved = readRecord(context.record.get());
    },

    dispose() { disposed = true; particles.clear(); popups.clear(); },
  };
  return instance;
}
