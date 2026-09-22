import type {CatFrameName} from './catFrames.js';

export type CatState = 'idle' | 'blink' | 'tailFlick' | 'walkLeft' | 'walkRight' | 'sleep' | 'wake';

export interface CatUpdate {
  changed: boolean;
  movement: -1 | 0 | 1;
}

export interface CatStateMachineOptions {
  random?: () => number;
  initialTime?: number;
  ambientDelayMs?: number;
  sleepAfterMs?: number;
}

const STATE_DURATION: Partial<Record<CatState, number>> = {
  blink: 300,
  tailFlick: 700,
  walkLeft: 1400,
  walkRight: 1400,
  wake: 700,
};

const FRAME_INTERVAL: Partial<Record<CatState, number>> = {
  tailFlick: 240,
  walkLeft: 240,
  walkRight: 240,
  sleep: 850,
  wake: 300,
};

export class CatStateMachine {
  private readonly random: () => number;
  private readonly ambientDelayMs: number;
  private readonly sleepAfterMs: number;
  private currentState: CatState = 'idle';
  private enteredAt: number;
  private nextAmbientAt: number;
  private currentFrameIndex = 0;
  private commandStartedAt?: number;

  constructor(options: CatStateMachineOptions = {}) {
    this.random = options.random ?? Math.random;
    this.ambientDelayMs = options.ambientDelayMs ?? 5000;
    this.sleepAfterMs = options.sleepAfterMs ?? 8000;
    this.enteredAt = options.initialTime ?? Date.now();
    this.nextAmbientAt = this.enteredAt + this.ambientDelay();
  }

  get state(): CatState {
    return this.currentState;
  }

  get frameName(): CatFrameName {
    if (this.currentState === 'blink') return 'blink';
    if (this.currentState === 'tailFlick') return this.currentFrameIndex % 2 === 0 ? 'tail-low' : 'tail-high';
    if (this.currentState === 'walkLeft') return this.currentFrameIndex % 2 === 0 ? 'walk-left-a' : 'walk-left-b';
    if (this.currentState === 'walkRight') return this.currentFrameIndex % 2 === 0 ? 'walk-right-a' : 'walk-right-b';
    if (this.currentState === 'sleep') return this.currentFrameIndex % 2 === 0 ? 'sleep-a' : 'sleep-b';
    if (this.currentState === 'wake') return this.currentFrameIndex === 0 ? 'wake-a' : 'wake-b';
    return 'idle';
  }

  commandStarted(now: number): void {
    this.commandStartedAt = now;
  }

  commandCompleted(now: number): void {
    this.commandStartedAt = undefined;
    this.transition(this.currentState === 'sleep' ? 'wake' : 'idle', now);
  }

  advance(now: number): CatUpdate {
    if (this.commandStartedAt !== undefined && now - this.commandStartedAt >= this.sleepAfterMs && this.currentState !== 'sleep') {
      this.transition('sleep', now);
      return {changed: true, movement: 0};
    }

    if (this.currentState === 'idle' && now >= this.nextAmbientAt) {
      this.transition(this.nextAmbientState(), now);
      return {changed: true, movement: 0};
    }

    const duration = STATE_DURATION[this.currentState];
    if (duration !== undefined && now - this.enteredAt >= duration) {
      this.transition('idle', now);
      return {changed: true, movement: 0};
    }

    const interval = FRAME_INTERVAL[this.currentState];
    if (interval === undefined) return {changed: false, movement: 0};
    const nextFrame = Math.floor((now - this.enteredAt) / interval);
    if (nextFrame === this.currentFrameIndex) return {changed: false, movement: 0};
    this.currentFrameIndex = nextFrame;
    const movement = this.currentState === 'walkLeft' ? -1 : this.currentState === 'walkRight' ? 1 : 0;
    return {changed: true, movement};
  }

  private transition(state: CatState, now: number): void {
    this.currentState = state;
    this.enteredAt = now;
    this.currentFrameIndex = 0;
    if (state === 'idle') this.nextAmbientAt = now + this.ambientDelay();
  }

  private nextAmbientState(): CatState {
    const choice = this.random();
    if (choice < 0.35) return 'blink';
    if (choice < 0.65) return 'tailFlick';
    if (choice < 0.825) return 'walkLeft';
    return 'walkRight';
  }

  private ambientDelay(): number {
    return this.ambientDelayMs + Math.floor(this.random() * 3500);
  }
}

