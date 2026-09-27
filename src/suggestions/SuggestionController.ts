import type {CommandEntry, Suggestion, SuggestionContext, SuggestionProvider} from './types.js';

/** Async providers that miss this budget are skipped for that keystroke. */
export const SUGGESTION_BUDGET_MS = 150;
/** Consecutive failures before a provider is reported unhealthy and the fallback takes over. */
const FAILURE_LIMIT = 3;
export const MAX_ALTERNATIVES = 5;

/**
 * Owns ghost text and ranked alternatives for the composer. Queries are
 * keyed by the exact buffer: a result that arrives after the buffer changed
 * is discarded. Providers rank text only; this never executes anything.
 */
export class SuggestionController {
  private provider?: SuggestionProvider;
  private fallback?: SuggestionProvider;
  private candidates: Suggestion[] = [];
  private queried?: string;
  private queriedEmpty = false;
  private selected = 0;
  private dismissed?: string;
  private sequence = 0;
  private abort?: AbortController;
  private failures = 0;
  /** Ranked alternatives are listed under the composer while cycling. */
  alternativesOpen = false;

  constructor(private readonly onChange: () => void, private readonly onUnhealthy: (reason: string) => void = () => {},
    private readonly budgetMs = SUGGESTION_BUDGET_MS) {}

  setProvider(provider: SuggestionProvider | undefined, fallback?: SuggestionProvider): void {
    this.abort?.abort();
    this.provider = provider;
    this.fallback = fallback && fallback !== provider ? fallback : undefined;
    this.failures = 0;
    this.reset();
  }

  get providerId(): string | undefined {
    return this.provider?.id;
  }

  /** Query for the current buffer; a no-op when it has not changed. */
  update(context: SuggestionContext, allowEmpty = false): void {
    if (context.buffer === this.queried && allowEmpty === this.queriedEmpty) return;
    this.queried = context.buffer;
    this.queriedEmpty = allowEmpty;
    this.alternativesOpen = false;
    this.selected = 0;
    if (this.dismissed !== context.buffer) this.dismissed = undefined;
    this.abort?.abort();
    const sequence = ++this.sequence;
    // Keep earlier candidates that still extend the buffer so async ghosts do not flicker.
    this.candidates = this.candidates.filter(candidate => candidate.text.startsWith(context.buffer) && candidate.text !== context.buffer);
    const provider = this.provider;
    if (!provider || context.buffer.includes('\n') || (!context.buffer.trim() && !allowEmpty)) {
      this.candidates = [];
      return;
    }
    const controller = new AbortController();
    this.abort = controller;
    let result: Suggestion[] | Promise<Suggestion[]>;
    try {
      result = provider.query(context, controller.signal);
    } catch (error) {
      this.failed(context, error);
      return;
    }
    if (Array.isArray(result)) {
      this.accept(result, context.buffer);
      return;
    }
    const timer = setTimeout(() => controller.abort(), this.budgetMs);
    result.then(list => {
      if (sequence !== this.sequence || controller.signal.aborted) return;
      this.failures = 0;
      this.accept(list, context.buffer);
      this.onChange();
    }, error => {
      if (sequence !== this.sequence || controller.signal.aborted) return;
      this.failed(context, error);
      this.onChange();
    }).finally(() => clearTimeout(timer));
  }

  private accept(list: readonly Suggestion[], buffer: string): void {
    const seen = new Set<string>();
    this.candidates = list.filter(candidate => {
      if (!candidate.text || candidate.text === buffer || candidate.text.includes('\n') || seen.has(candidate.text)) return false;
      seen.add(candidate.text);
      return true;
    }).slice(0, MAX_ALTERNATIVES);
  }

  /** A failed query shows the fallback's synchronous candidates; repeated failures switch to it. */
  private failed(context: SuggestionContext, error: unknown): void {
    this.failures += 1;
    if (this.failures >= FAILURE_LIMIT && this.fallback) {
      this.provider = this.fallback;
      this.fallback = undefined;
      this.failures = 0;
      this.onUnhealthy(error instanceof Error ? error.message : String(error));
    }
    const backup = this.fallback ?? this.provider;
    let result: Suggestion[] = [];
    try {
      const candidates = backup?.query(context, new AbortController().signal);
      if (Array.isArray(candidates)) result = candidates;
    } catch {
      // Nothing to show for this keystroke.
    }
    this.accept(result, context.buffer);
  }

  /** The full predicted line whose suffix is drawn as ghost text, if any. */
  ghost(buffer: string): string | undefined {
    if (this.dismissed === buffer || this.queried !== buffer) return undefined;
    const extends_ = (candidate?: Suggestion) => candidate && candidate.text.startsWith(buffer) && candidate.text.length > buffer.length;
    if (this.alternativesOpen) return extends_(this.candidates[this.selected]) ? this.candidates[this.selected]!.text : undefined;
    return this.candidates.find(extends_)?.text;
  }

  alternatives(): {items: readonly Suggestion[]; selected: number} {
    return this.alternativesOpen ? {items: this.candidates, selected: this.selected} : {items: [], selected: 0};
  }

  get hasCandidates(): boolean {
    return this.candidates.length > 0 && this.dismissed !== this.queried;
  }

  /** Opens the alternatives list on first use, then moves through it. */
  cycle(delta: 1 | -1): boolean {
    if (!this.hasCandidates) return false;
    if (!this.alternativesOpen) {
      this.alternativesOpen = true;
      this.selected = delta === 1 ? 0 : this.candidates.length - 1;
    } else this.selected = (this.selected + delta + this.candidates.length) % this.candidates.length;
    return true;
  }

  /** The line an explicit accept inserts: the highlighted alternative, else the ghost. */
  acceptance(buffer: string): string | undefined {
    if (this.alternativesOpen) return this.candidates[this.selected]?.text;
    return this.ghost(buffer);
  }

  /** The ghost's next word (with its leading spaces) for partial acceptance. */
  nextWord(buffer: string): string | undefined {
    const ghost = this.ghost(buffer);
    if (!ghost) return undefined;
    return /^\s*\S+/u.exec(ghost.slice(buffer.length))?.[0];
  }

  /** Hide suggestions until the buffer changes. */
  dismiss(buffer: string): boolean {
    if (!this.ghost(buffer) && !this.alternativesOpen) return false;
    this.dismissed = buffer;
    this.alternativesOpen = false;
    return true;
  }

  record(entry: CommandEntry): void {
    this.provider?.record?.(entry);
    this.fallback?.record?.(entry);
  }

  reset(): void {
    this.abort?.abort();
    this.sequence += 1;
    this.candidates = [];
    this.queried = undefined;
    this.selected = 0;
    this.alternativesOpen = false;
    this.dismissed = undefined;
  }

  dispose(): void {
    this.abort?.abort();
    this.provider?.dispose?.();
    this.fallback?.dispose?.();
  }
}
