/** Most recent distinct commands one navigation can reach; keeps a keypress bounded. */
export const COMPOSER_HISTORY_LIMIT = 1000;

/**
 * Shell-style Up/Down recall over a snapshot of the authoritative history
 * (newest first). The snapshot is taken once when navigation starts, so a
 * keypress never touches disk or a provider. Stored entries are never
 * mutated: the composer only receives copies of their text.
 *
 * Editing a recalled command ends navigation; the edited text becomes the new
 * draft, so a later Up starts again from the newest entry and Down past it
 * restores exactly what was being edited.
 */
export class ComposerHistory {
  private entries: readonly string[] = [];
  private index = -1;
  private draft = '';
  /** The text this navigator last placed in the composer. */
  private shown?: string;

  /** Whether the composer currently shows text recalled by this navigator. */
  get active(): boolean {
    return this.index >= 0;
  }

  /** True while `text` is still exactly what navigation put in the composer. */
  showing(text: string): boolean {
    return this.active && this.shown === text;
  }

  /**
   * One step older. `source` is read only when navigation starts. Returns the
   * text to show, or undefined at the oldest entry (no wrap).
   */
  previous(current: string, source: () => Iterable<string>): string | undefined {
    if (!this.showing(current)) this.begin(current, source);
    if (this.index + 1 >= this.entries.length) return undefined;
    this.index += 1;
    return this.show(this.entries[this.index]!);
  }

  /** One step newer; past the newest entry the original draft returns. Undefined when not navigating. */
  next(current: string): string | undefined {
    if (!this.showing(current)) { this.reset(); return undefined; }
    this.index -= 1;
    if (this.index < 0) {
      const draft = this.draft;
      this.reset();
      return draft;
    }
    return this.show(this.entries[this.index]!);
  }

  reset(): void {
    this.entries = [];
    this.index = -1;
    this.draft = '';
    this.shown = undefined;
  }

  private begin(current: string, source: () => Iterable<string>): void {
    this.reset();
    this.draft = current;
    const seen = new Set<string>();
    const entries: string[] = [];
    for (const command of source()) {
      // Distinct commands only; the unsent draft itself is not a step.
      if (!command.trim() || seen.has(command) || command === current) continue;
      seen.add(command);
      entries.push(command);
      if (entries.length >= COMPOSER_HISTORY_LIMIT) break;
    }
    this.entries = entries;
  }

  private show(text: string): string {
    this.shown = text;
    return text;
  }
}
