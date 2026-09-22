import type {MascotConfig} from '../config.js';
import {CatStateMachine} from './CatStateMachine.js';
import {CAT_HEIGHT, CAT_WIDTH, renderCatFrame} from './CatSprite.js';

export interface CatPlacement {
  visible: boolean;
  x: number;
  minX: number;
  maxX: number;
  stationary: boolean;
}

export function calculateCatPlacement(
  columns: number,
  promptWidth: number,
  preferredX: number,
  spriteWidth = CAT_WIDTH,
): CatPlacement {
  const minX = Math.max(0, promptWidth);
  const maxX = columns - spriteWidth;
  if (columns < spriteWidth || maxX < minX) {
    return {visible: false, x: 0, minX, maxX, stationary: true};
  }
  const x = Math.max(minX, Math.min(maxX, Number.isFinite(preferredX) ? preferredX : maxX));
  return {visible: true, x, minX, maxX, stationary: maxX - minX < 3};
}

export class CatMascot {
  private readonly machine: CatStateMachine;
  private position = Number.POSITIVE_INFINITY;
  private placement: CatPlacement = {visible: false, x: 0, minX: 0, maxX: 0, stationary: true};

  constructor(
    private readonly config: MascotConfig,
    machine = new CatStateMachine(),
  ) {
    this.machine = machine;
  }

  get state(): string {
    return this.machine.state;
  }

  commandStarted(now: number): void {
    if (this.config.animation) this.machine.commandStarted(now);
  }

  commandCompleted(now: number): void {
    if (this.config.animation) this.machine.commandCompleted(now);
  }

  tick(now: number): boolean {
    if (!this.config.enabled || !this.config.animation) return false;
    const update = this.machine.advance(now);
    if (update.movement !== 0 && this.placement.visible && !this.placement.stationary) {
      this.position = Math.max(this.placement.minX, Math.min(this.placement.maxX, this.position + update.movement));
    }
    return update.changed;
  }

  canRender(columns: number, promptWidth: number): boolean {
    if (!this.config.enabled) return false;
    return calculateCatPlacement(columns, promptWidth, this.position).visible;
  }

  render(columns: number, promptWidth: number): string[] {
    if (!this.config.enabled) return [];
    this.placement = calculateCatPlacement(columns, promptWidth, this.position);
    if (!this.placement.visible) return [];
    this.position = this.placement.x;
    const padding = ' '.repeat(this.position);
    return renderCatFrame(this.machine.frameName, this.config.variant).map(row => `${padding}${row}`);
  }
}

export {CAT_HEIGHT, CAT_WIDTH};

