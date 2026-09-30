import {applyCurve, type Curve} from '../chroma/chroma.js';
import {isReducedMotion} from '../presentation/environment.js';

/**
 * Restrained, pure motion: given elapsed time (from whichever clock the caller
 * owns) a profile yields a 0..1 intensity for a cell. Chroma turns intensity
 * into color; UI code decides where cells are. Nothing here changes width,
 * schedules timers, or touches PTY output.
 */
export type MotionShape =
  | 'sine' // symmetric breathing / traveling shimmer
  | 'comet' // slow rise, fast fall
  | 'tail' // fast rise, long tail
  | 'pulse'; // quick rise, then settle to rest

export type MotionSpread =
  | 'uniform' // every cell moves together
  | 'travel'; // the crest moves across cells

export interface MotionProfile {
  shape: MotionShape;
  spread: MotionSpread;
  /** Time for one full cycle (or the whole gesture when not repeating). */
  cycleMs: number;
  /** Repeating profiles loop; the rest settle at 0 once the gesture ends. */
  repeat: boolean;
  /** Cells per wavelength for `travel`. */
  wavelength?: number;
  /** Shapes the finished waveform; linear when omitted. */
  curve?: Curve;
}

export type MotionState = 'waiting' | 'processing' | 'streaming' | 'transition' | 'completion' | 'failure';

/** Which motion communicates which NMSh state. Reduced motion holds every one still. */
export const MOTION_PROFILES: Readonly<Record<MotionState, MotionProfile>> = {
  waiting: {shape: 'sine', spread: 'uniform', cycleMs: 3200, repeat: true},
  processing: {shape: 'sine', spread: 'travel', cycleMs: 1800, repeat: true, wavelength: 12},
  streaming: {shape: 'sine', spread: 'travel', cycleMs: 1200, repeat: true, wavelength: 12},
  transition: {shape: 'pulse', spread: 'uniform', cycleMs: 300, repeat: false, curve: 'ease-out'},
  completion: {shape: 'tail', spread: 'uniform', cycleMs: 700, repeat: false},
  failure: {shape: 'pulse', spread: 'uniform', cycleMs: 450, repeat: false},
};

export function wrappedPhase(elapsedMs: number, cycleMs: number): number {
  if (cycleMs <= 0) return 0;
  return ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
}

/** Waveform value for a phase in [0,1). */
function waveform(shape: MotionShape, phase: number): number {
  switch (shape) {
    case 'sine': return (1 + Math.cos(2 * Math.PI * phase)) / 2;
    case 'comet': return phase < 0.8 ? phase / 0.8 : 1 - (phase - 0.8) / 0.2;
    case 'tail': return phase < 0.15 ? phase / 0.15 : 1 - (phase - 0.15) / 0.85;
    case 'pulse': return phase < 0.25 ? applyCurve('ease-out', phase / 0.25) : 1 - applyCurve('ease-in-out', (phase - 0.25) / 0.75);
  }
}

export interface SampleOptions {
  /** Hold the profile still. Defaults to the user's reduced-motion setting. */
  reduced?: boolean;
}

/**
 * Intensity 0..1 of `cell` (its index along the text or bar) after `elapsedMs`.
 * Reduced motion samples the profile at time zero for every call, so output is
 * stable frame to frame.
 */
export function sampleMotion(profile: MotionProfile, elapsedMs: number, cell = 0, options: SampleOptions = {}): number {
  const reduced = options.reduced ?? isReducedMotion();
  const elapsed = reduced ? 0 : elapsedMs;
  if (!profile.repeat && !reduced && (elapsed < 0 || elapsed >= profile.cycleMs)) return 0;
  const clock = profile.repeat ? wrappedPhase(elapsed, profile.cycleMs) : Math.max(0, Math.min(1, elapsed / profile.cycleMs));
  const shift = profile.spread === 'travel' ? cell / (profile.wavelength ?? 12) : 0;
  const phase = ((clock - shift) % 1 + 1) % 1;
  return applyCurve(profile.curve ?? 'linear', waveform(profile.shape, phase));
}
