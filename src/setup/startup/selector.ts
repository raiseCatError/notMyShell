import {pureMix, type MoodMix} from '../../idle/auroraMoods.js';
import type {OnboardingBackdrop, PromptConfiguration} from '../../prompt/configuration.js';
import type {EnvironmentEvidence} from '../environment/detect.js';
import type {KeepState} from '../environment/keepExisting.js';
import {AURORA_EPOCH, SKY_HOLD_MS, skyMix, skySceneTime} from './sky.js';
import {STARTING_POINT_MOODS, startingPointAt, startingPointIndex, type MinimalLayout} from './startingPoints.js';

/** The sky's own clock for one open selector: plain data, kept with the rest of the selector state. */
export interface StartupSkyClock {
  /** When the selector opened: the scene's zero and Vespyr's blink phase. */
  started: number;
  /** The blend on screen and the scene time (past the epoch) when the highlight last changed. */
  from: MoodMix;
  timeAt: number;
  /** The last key; the sky holds still after SKY_HOLD_MS without one. */
  activeAt: number;
}

/**
 * The selector's state, one source of truth inside Setup Cat's quick state.
 * `confirm` is the Leave setup? sheet (confirmIndex 0 Stay, 1 Leave) and
 * `manual` the guided setup opened over the selector.
 */
export interface StartupSelectorState {
  choice: number;
  review: boolean;
  confirm?: boolean;
  confirmIndex?: number;
  manual?: boolean;
  /** Minimal's composer layout. */
  layout: MinimalLayout;
  backdrop: OnboardingBackdrop;
  previousChoice: number;
  changedAt: number;
  sky: StartupSkyClock;
  /** Keep Existing's answer to its question, and whether a configured install asked to re-detect. */
  keep: KeepState;
  /** The read-only detection result, filled asynchronously; absent while it loads. */
  evidence?: EnvironmentEvidence;
}

const BACKDROP_CYCLE: readonly OnboardingBackdrop[] = ['aurora', 'subtle', 'off'];
export const nextBackdrop = (backdrop: OnboardingBackdrop): OnboardingBackdrop => BACKDROP_CYCLE[(BACKDROP_CYCLE.indexOf(backdrop) + 1) % BACKDROP_CYCLE.length]!;

/** Opens on the current starting point (Recommended when there is none), with Minimal's layout as saved when it is current. */
export function createSelector(saved: PromptConfiguration, now: number): StartupSelectorState {
  const choice = startingPointIndex(saved.startingPoint);
  const layout: MinimalLayout = saved.startingPoint === 'minimal' ? saved.composerLayout : 'twoLine';
  return {choice, review: false, layout, backdrop: saved.onboardingBackdrop, previousChoice: choice, changedAt: Number.NEGATIVE_INFINITY,
    sky: {started: now, from: pureMix(STARTING_POINT_MOODS[startingPointAt(choice)]), timeAt: 0, activeAt: now}, keep: {answer: 0, redetect: false}};
}

function timing(quick: StartupSelectorState, now: number) {
  return {now, started: quick.sky.started, mood: STARTING_POINT_MOODS[startingPointAt(quick.choice)], previousMood: STARTING_POINT_MOODS[startingPointAt(quick.previousChoice)],
    changedAt: quick.changedAt, from: quick.sky.from, timeAt: quick.sky.timeAt, activeAt: quick.sky.activeAt, reduced: false};
}

/**
 * Every key keeps the sky alive. After a hold the held time is skipped, not
 * replayed: the clocks move forward by it, so the sky resumes exactly where it stopped.
 */
export function resumeSky(quick: StartupSelectorState, now: number): void {
  const heldUntil = quick.sky.activeAt + SKY_HOLD_MS;
  if (now > heldUntil) {
    const held = now - heldUntil;
    quick.sky.started += held;
    if (Number.isFinite(quick.changedAt)) quick.changedAt += held;
  }
  quick.sky.activeAt = now;
}

/** Moves the highlight; the cross-fade starts from the blend on screen. False when nothing changed. */
export function highlightChoice(quick: StartupSelectorState, next: number, now: number): boolean {
  if (next === quick.choice) return false;
  const shown = timing(quick, now);
  quick.sky.from = skyMix(shown);
  quick.sky.timeAt = skySceneTime(shown) - AURORA_EPOCH;
  quick.previousChoice = quick.choice;
  quick.choice = next;
  quick.changedAt = now;
  return true;
}
