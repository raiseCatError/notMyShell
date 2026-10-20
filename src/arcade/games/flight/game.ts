import type {Key} from '../../../terminal/keys.js';
import type {Canvas} from '../../Canvas.js';
import {easeOutCubic} from '../../easing.js';
import {Flash, ParticleSystem, Popups, Shake, Trail} from '../../effects.js';
import type {ArcadePalette} from '../../palette.js';
import type {ControlHint, GameContext, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {CAT_H, DT} from './physics.js';
import {drawTooSmall, FlightScene, geometry, MIN_COLUMNS, MIN_ROWS, worldHeightFor, type Geometry} from './scene.js';
import type {CatLook, Legs, TailShape, Wing} from './sprites.js';
import {FlightWorld} from './world.js';

/** What a person's saved Vespyr Flight record holds, read defensively (the file can be old, empty or hand-edited). */
export interface FlightRecord { best: number; bestPassed: number; attempts: number }

const clean = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000_000) : 0);
export function readRecord(raw: Readonly<Record<string, unknown>>): FlightRecord {
  return {best: clean(raw.best), bestPassed: clean(raw.bestPassed), attempts: clean(raw.attempts)};
}

const POP_MS = 450;
/** After a crash the world holds still this many steps (the cat shown hit, the scene fading to dusk) before the game over card. */
const DYING_STEPS = 24;
const DYING_STEPS_REDUCED = 8;
const MILESTONE = 10;

/** Test seams: a prepared world or a particle pool the test can inspect. The arcade always uses the defaults. */
export interface FlightParts { world?: FlightWorld; particles?: ParticleSystem }

export function createFlightGame(context: GameContext, parts: FlightParts = {}): GameInstance {
  const courseRng = context.rng.fork('course');
  const fxRng = context.rng.fork('fx');
  const world = parts.world ?? new FlightWorld(courseRng, worldHeightFor(context.size.rows));
  const scene = new FlightScene();
  const calm = context.motion.reduced;
  const level = calm ? 'off' : context.motion.effects;
  const particles = parts.particles ?? new ParticleSystem(fxRng, 140, level);
  particles.setLevel(level);
  const trail = new Trail(10, level);
  const popups = new Popups(5, level);
  const flash = new Flash();
  const shake = new Shake();
  const decor = context.color !== 'none' && !context.safeGlyphs;
  let size = context.size;
  let geo: Geometry = geometry(size.columns, size.rows, world.height);
  let status: GameStatus = 'ready';
  let result: GameResult | undefined;
  let palette: ArcadePalette | undefined;
  let saved = readRecord(context.record.get());
  const startBest = saved.best;
  let visualMs = 0;
  let popMs = 0;
  let dying = 0;
  /** A smoothed vertical speed, so the tail trails the motion instead of snapping with it. */
  let tailLag = 0;
  let disposed = false;

  const tooSmall = (): boolean => size.columns < MIN_COLUMNS || size.rows < MIN_ROWS;
  const screenY = (value: number): number => geo.top + value * geo.scale;

  function look(): CatLook {
    const blink = visualMs % 3100 < 140;
    const twitch = (visualMs + 1300) % 4300 < 170;
    if (status === 'ready') {
      const beat = Math.floor(visualMs / 420) % 2;
      return {wing: beat ? 'mid' : 'up', legs: 'glide', tail: beat ? 'level' : 'curled', blink, twitch, hit: false};
    }
    if (!world.alive) return {wing: 'up', legs: 'dangle', tail: 'streaming', blink: true, twitch: false, hit: true};
    const vy = world.vy;
    const wing: Wing = world.sinceFlap < 4 ? 'down' : world.sinceFlap < 8 ? 'mid' : vy > 25 ? 'up' : 'mid';
    const legs: Legs = vy < -10 ? 'tucked' : vy > 45 ? 'dangle' : 'glide';
    const tail: TailShape = tailLag < -30 ? 'trailing' : tailLag > 40 ? 'streaming' : tailLag < -8 ? 'level' : 'curled';
    return {wing, legs, tail, blink, twitch, hit: false};
  }

  function finish(): void {
    status = 'over';
    const score = world.score;
    const previous = readRecord(context.record.get());
    const next: FlightRecord = {best: Math.max(previous.best, score), bestPassed: Math.max(previous.bestPassed, score), attempts: previous.attempts + 1};
    context.record.update(record => { record.best = next.best; record.bestPassed = next.bestPassed; record.attempts = next.attempts; });
    saved = next;
    result = {
      score, scoreText: String(score), record: score > 0 && score > startBest,
      details: [`Obstacles passed ${score}`, `Best ${next.best}`, `Attempts ${next.attempts}`],
    };
  }

  const puff = (): void => {
    if (!palette) return;
    particles.burst({x: geo.catX - 2, y: screenY(world.y) + 3, count: 5, speed: 26, angle: Math.PI / 2, spread: 0.7, life: 380, gravity: 30, drag: 1.2, colors: [palette.haze, palette.muted, palette.accentSoft]});
  };

  const instance: GameInstance = {
    get status() { return status; },
    get result() { return result; },
    stepsPerSecond: 60,
    refreshMs: 100,

    step() {
      if (status !== 'playing') return;
      if (dying > 0) { dying -= 1; if (dying === 0) finish(); return; }
      const outcome = world.step();
      tailLag += (world.vy - tailLag) * 0.15;
      if (decor) {
        trail.shift(-world.speed * DT);
        if (world.steps % 2 === 0) trail.push(geo.catX - 2, screenY(world.y) + (CAT_H / 2) * geo.scale);
        if (palette && world.steps % 5 === 0) particles.burst({x: geo.catX - 3, y: screenY(world.y) + 2, count: 1, speed: 10, angle: Math.PI, spread: 0.6, life: 480, drag: 0.5, colors: [palette.accent, palette.haze]});
      }
      if (outcome.scored) {
        popMs = POP_MS;
        if (palette) {
          popups.add('+1', geo.catX + 6, Math.max(1, Math.floor(screenY(world.y) / 2) - 3), palette.accent);
          if (world.score % MILESTONE === 0) {
            particles.burst({x: geo.catX + 4, y: screenY(world.y) + 2, count: 22, speed: 55, spread: Math.PI, life: 700, drag: 1.1, colors: [palette.accent, palette.haze, palette.warn, palette.ok]});
            popups.add(`${world.score}!`, geo.catX + 6, Math.max(1, Math.floor(screenY(world.y) / 2) - 5), palette.warn, 900);
          }
        }
      }
      if (outcome.hit) {
        dying = calm ? DYING_STEPS_REDUCED : DYING_STEPS;
        if (palette) {
          flash.trigger(!calm);
          shake.trigger(!calm && context.motion.effects !== 'off');
          particles.burst({x: geo.catX + 4, y: screenY(world.y) + 2, count: 28, speed: 70, spread: Math.PI, life: 650, gravity: 90, drag: 0.8, colors: [palette.warn, palette.bad, palette.ink, palette.accent]});
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
      const flap = key.kind === 'up' || (key.kind === 'text' && key.value === ' ');
      if (status === 'ready') {
        if (!flap) return 'ignored';
        status = 'playing';
        world.flap();
        puff();
        return 'handled';
      }
      if (status !== 'playing') return 'ignored';
      if (dying > 0) return 'handled';
      if (!flap) return 'ignored';
      if (world.flap()) puff();
      return 'handled';
    },

    render(canvas: Canvas, alpha: number, colors: ArcadePalette) {
      palette = colors;
      if (tooSmall() || canvas.width < MIN_COLUMNS || canvas.height < MIN_ROWS) { drawTooSmall(canvas, colors); return; }
      geo = geometry(canvas.width, canvas.height, world.height);
      const fading = calm ? 0 : status === 'over' ? 1 : dying > 0 ? easeOutCubic(1 - dying / DYING_STEPS) : 0;
      scene.draw(canvas, {
        world, alpha: status === 'playing' && dying === 0 ? alpha : 1, palette: colors, decor, reduced: calm, visualMs,
        look: look(), particles, trail, popups, shake: shake.offset, flash: flash.amount, fade: fading,
        score: world.score, best: Math.max(saved.best, world.score), pop: popMs / POP_MS,
        phase: status === 'ready' ? 'ready' : status === 'over' ? 'over' : 'playing',
      });
    },

    resize(next) {
      size = next;
      geo = geometry(next.columns, next.rows, world.height);
      particles.clear();
      popups.clear();
      trail.clear();
    },

    pause() { /* The host owns the paused state; the fixed steps simply stop arriving. Nothing here advances on its own. */ },

    hints(): readonly ControlHint[] {
      return status === 'ready'
        ? [{keys: 'Space/Up', action: 'flap'}, {keys: 'Esc', action: 'menu'}]
        : [{keys: 'Space/Up', action: 'flap'}, {keys: 'p', action: 'pause'}, {keys: 'Esc', action: 'menu'}];
    },

    persist() {
      // A run left unfinished keeps a better score than the saved best, but is not counted as an attempt.
      if (disposed || status !== 'playing' || world.score <= saved.best) return;
      const score = world.score;
      context.record.update(record => { const current = readRecord(record); record.best = Math.max(current.best, score); record.bestPassed = Math.max(current.bestPassed, score); record.attempts = current.attempts; });
      saved = readRecord(context.record.get());
    },

    dispose() { disposed = true; particles.clear(); popups.clear(); trail.clear(); },
  };
  return instance;
}
