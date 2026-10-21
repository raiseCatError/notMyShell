/**
 * Undo and redo for turn-based games: snapshots of an immutable (or copied) state, bounded so a long session cannot grow
 * without limit. `push` after an undo drops the redo branch, as every editor does.
 */
export class History<State> {
  private past: State[] = [];
  private future: State[] = [];
  constructor(private readonly limit = 200) {}

  /** Remember `before`, the state a move is about to change. */
  push(before: State): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** The state to return to, given the current one (kept for redo), or undefined. */
  undo(current: State): State | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(current);
    return previous;
  }

  redo(current: State): State | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get depth(): number { return this.past.length; }
  clear(): void { this.past = []; this.future = []; }
}
