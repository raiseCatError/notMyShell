import type {CursorSettings} from '../prompt/configuration.js';
import {overlayFrame} from '../presentation/cellOverlay.js';
import {presentationClock} from '../motion/PresentationClock.js';
import {CursorEngine, type DrawBounds, type MoveCause} from './CursorEngine.js';
import {effectPalette} from './palette.js';
import type {BackendChoice} from './backends.js';

/**
 * Glue between NMSh's frame and the portable cursor engine: one engine, one
 * clock subscription that exists only while something animates, and an
 * overlay applied to the input rows of an already-built frame. Disabled
 * (Reduced Motion, Decorative Effects Off, NO_COLOR, passthrough, a panel)
 * means no overlay and no clock at all.
 */
export class CursorPresenter {
  readonly engine: CursorEngine;
  private stopClock?: () => void;
  private interval = 0;

  constructor(private settings: () => CursorSettings, private readonly repaint: () => void, random?: () => number) {
    this.engine = new CursorEngine(settings(), random);
  }

  /** Effective settings with what a native backend already draws removed (never drawn twice). */
  private effective(choice?: BackendChoice): CursorSettings {
    const settings = this.settings();
    if (!choice || choice.backend.id === 'portable') return settings;
    return {...settings, ...(choice.nativeHandles.motion ? {motion: 'off' as const} : {}), ...(choice.nativeHandles.effect ? {effect: 'none' as const} : {})};
  }

  /**
   * Overlay the current frame. `caret` is the logical caret's screen cell (or undefined when
   * NMSh does not own an editable input right now, which resets everything).
   */
  apply(rows: string[], caret: {row: number; column: number} | undefined, bounds: DrawBounds, cause: MoveCause, allowed: boolean, now: number, choice?: BackendChoice):
    {rows: string[]; hideCaret: boolean} {
    const settings = this.effective(choice);
    this.engine.configure(settings);
    if (!allowed || !caret || !this.engine.enabled) { this.engine.reset(); this.sync(0); return {rows, hideCaret: false}; }
    this.engine.target(caret, now, cause);
    this.engine.step(now);
    const paints = this.engine.paints(effectPalette(settings), bounds, now);
    this.sync(this.engine.cadence(now));
    return {rows: overlayFrame(rows, paints, bounds.columns), hideCaret: this.engine.drawsCaret};
  }

  /** Keep exactly one clock subscription at the needed cadence; none when nothing animates. */
  private sync(fps: number): void {
    const interval = fps > 0 ? Math.round(1000 / fps) : 0;
    if (interval === this.interval) return;
    this.stopClock?.();
    this.stopClock = undefined;
    this.interval = interval;
    if (interval) this.stopClock = presentationClock.subscribe(() => this.repaint(), interval, 16);
  }

  get scheduled(): boolean { return Boolean(this.stopClock); }

  dispose(): void { this.engine.reset(); this.sync(0); }
}
