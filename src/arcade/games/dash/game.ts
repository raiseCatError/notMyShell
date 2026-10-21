import type {Key} from '../../../terminal/keys.js';
import type {Canvas} from '../../Canvas.js';
import {Flash, ParticleSystem, Popups, Shake, Trail, type EffectsLevel} from '../../effects.js';
import type {ArcadePalette} from '../../palette.js';
import type {ControlHint, GameContext, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {stepPx} from './physics.js';
import {DashScene, drawTooSmall, geometry, MIN_COLUMNS, MIN_ROWS, type Geometry} from './scene.js';
import type {PlayerPose} from './sprites.js';
import {DashWorld} from './world.js';

/** What a person's saved Vespyr Dash record holds, read defensively (the file can be old, empty or hand-edited). */
export interface DashRecord { best: number; bestDistance: number; attempts: number }

const clean = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000_000) : 0);
export function readRecord(raw: Readonly<Record<string, unknown>>): DashRecord {
  return {best: clean(raw.best), bestDistance: clean(raw.bestDistance), attempts: clean(raw.attempts)};
}

const POP_MS = 700;
/** After a crash the world holds still this many steps (the cat shown hit) before the game over card: shorter with reduced motion. */
const DYING_STEPS = 24;
const DYING_STEPS_REDUCED = 8;
const LAND_STEPS = 6;
const HOT_MS = 360;
const TRAIL_LENGTH: Readonly<Record<EffectsLevel, number>> = {off: 0, subtle: 8, normal: 14, rich: 20};

/** Test seams: a prepared world or particle pool the test can inspect. The arcade always uses the defaults. */
export interface DashParts { world?: DashWorld; particles?: ParticleSystem; trail?: Trail }

export function createDashGame(context: GameContext, parts: DashParts = {}): GameInstance {
  const courseRng = context.rng.fork('course');
  const fxRng = context.rng.fork('fx');
  const world = parts.world ?? new DashWorld(courseRng);
  const scene = new DashScene();
  const effects = context.motion.effects;
  const particles = parts.particles ?? new ParticleSystem(fxRng, 120, effects);
  const trail = parts.trail ?? new Trail(TRAIL_LENGTH[effects], effects);
  const popups = new Popups(4, effects);
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
  let phase = 0;
  let landSteps = 0;
  let dying = 0;
  let disposed = false;
  const hot = {support: -2, x: 0, amount: 0};

  const tooSmall = (): boolean => size.columns < MIN_COLUMNS || size.rows < MIN_ROWS;

  function pose(): PlayerPose {
    if (status === 'ready') return visualMs % 3200 < 150 ? 'blink' : 'ride';
    if (!world.alive) return 'hit';
    if (world.airborne) return 'air';
    return landSteps > 0 ? 'land' : 'ride';
  }

  function finish(): void {
    status = 'over';
    const score = world.score;
    const previous = readRecord(context.record.get());
    const next: DashRecord = {best: Math.max(previous.best, score), bestDistance: Math.max(previous.bestDistance, world.meters), attempts: previous.attempts + 1};
    context.record.update(record => { record.best = next.best; record.bestDistance = next.bestDistance; record.attempts = next.attempts; });
    saved = next;
    result = {
      score, scoreText: String(score).padStart(5, '0'), record: score > 0 && score > startBest,
      details: [`Distance ${world.meters} m`, `Best ${next.best}`, `Attempts ${next.attempts}`],
    };
  }

  /** Screen pixel of the cat's centre. */
  const centerY = (): number => geo.groundY - world.y - 3;

  function trailAndDust(): void {
    if (!decor) return;
    trail.shift(-stepPx(world.distance));
    if (world.alive) trail.push(geo.catX + 1, centerY());
    if (palette && world.steps % 5 === 0 && !world.airborne && world.alive) {
      particles.burst({x: geo.catX + 1, y: geo.groundY - world.y - 1, count: 1, speed: world.speed * 0.4, angle: Math.PI, spread: 0.4, life: 300, gravity: -30, drag: 1.5, colors: [palette.muted, palette.faint]});
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
      trailAndDust();
      if (outcome.landedAfter > 0) {
        landSteps = LAND_STEPS;
        if (!context.motion.reduced) { hot.support = outcome.support; hot.x = world.distance + 3; hot.amount = 1; }
        if (palette && decor && outcome.landedAfter >= 3) {
          particles.burst({x: geo.catX + 3, y: geo.groundY - world.y - 1, count: 7, speed: 38, angle: -Math.PI / 2, spread: 1.4, life: 380, gravity: 70, drag: 2, colors: [palette.accent, palette.haze, palette.muted]});
        }
      }
      if (outcome.tookOff && palette && decor) {
        particles.burst({x: geo.catX + 3, y: geo.groundY - world.y, count: 5, speed: 30, angle: Math.PI / 2, spread: 0.9, life: 300, gravity: -20, drag: 2, colors: [palette.accent, palette.haze]});
      }
      const reached = Math.floor(world.score / 100);
      if (reached > milestone) {
        milestone = reached;
        popMs = POP_MS;
        if (!context.motion.reduced && palette) popups.add(String(reached * 100), geo.catX + 3, Math.max(1, Math.floor(geo.groundY / 2) - 9), palette.accent);
      }
      if (world.phase > phase) {
        phase = world.phase;
        if (!context.motion.reduced && palette) popups.add(`Phase ${phase + 1}`, Math.floor(geo.width / 2), 3, palette.ink);
      }
      if (outcome.fate !== 'alive') {
        dying = context.motion.reduced ? DYING_STEPS_REDUCED : DYING_STEPS;
        if (!context.motion.reduced && palette) {
          flash.trigger(true);
          shake.trigger(context.motion.effects !== 'off');
        }
        if (palette) particles.burst({x: geo.catX + 3, y: geo.groundY - world.y - 3, count: 24, speed: 62, spread: Math.PI, life: 600, gravity: 80, drag: 0.8, colors: [palette.warn, palette.bad, palette.ink, palette.accent]});
      }
    },

    animate(dtMs) {
      visualMs += dtMs;
      particles.update(dtMs);
      popups.update(dtMs);
      flash.update(dtMs);
      shake.update(dtMs);
      popMs = Math.max(0, popMs - dtMs);
      hot.amount = Math.max(0, hot.amount - dtMs / HOT_MS);
    },

    key(key: Key): GameKeyResult {
      const jump = key.kind === 'up' || (key.kind === 'text' && key.value === ' ');
      if (!jump) return 'ignored';
      if (status === 'ready') {
        status = 'playing';
        world.jump();
        return 'handled';
      }
      if (status !== 'playing') return 'ignored';
      if (dying === 0) world.jump();
      return 'handled';
    },

    render(canvas: Canvas, alpha: number, colors: ArcadePalette) {
      palette = colors;
      if (tooSmall() || canvas.width < MIN_COLUMNS || canvas.height < MIN_ROWS) { drawTooSmall(canvas, colors); return; }
      scene.draw(canvas, {
        world, alpha: status === 'playing' && dying === 0 ? alpha : 1, palette: colors, decor, reduced: context.motion.reduced, visualMs,
        pose: pose(), particles, trail, popups, shake: shake.offset, flash: flash.amount, hot,
        score: world.score, best: Math.max(saved.best, world.score), pop: popMs / POP_MS,
        phase: status === 'ready' ? 'ready' : status === 'over' ? 'over' : 'playing',
      });
    },

    resize(next) {
      size = next;
      geo = geometry(next.columns, next.rows);
      particles.clear();
      popups.clear();
      trail.clear();
    },

    pause() { /* The host owns the paused state; the fixed steps simply stop arriving. Nothing here advances on its own. */ },

    hints(): readonly ControlHint[] {
      return status === 'ready'
        ? [{keys: 'Space/Up', action: 'start'}, {keys: 'Esc', action: 'menu'}]
        : [{keys: 'Space/Up', action: 'jump'}, {keys: 'p', action: 'pause'}, {keys: 'Esc', action: 'menu'}];
    },

    persist() {
      // A run left unfinished keeps a better score than the saved best, but is not counted as an attempt.
      if (disposed || status !== 'playing' || world.score <= saved.best) return;
      const score = world.score;
      const meters = world.meters;
      context.record.update(record => { const current = readRecord(record); record.best = Math.max(current.best, score); record.bestDistance = Math.max(current.bestDistance, meters); record.attempts = current.attempts; });
      saved = readRecord(context.record.get());
    },

    dispose() { disposed = true; particles.clear(); popups.clear(); trail.clear(); },
  };
  return instance;
}
