import {dirname, extname} from 'node:path';
import {createLocalFs, diagnose, type Diagnostic, type DiagnosticReport, type LocalFs, type Severity} from '../markdown/diagnostics.js';
import {formatForPath} from './document.js';
import {documentRoot} from './documentImages.js';
import type {EditorState} from './EditorPanel.js';

/**
 * Keeps one editor's static diagnostics (#466) current. Checking is off until the person opens Problems (or asks), so a
 * document nobody is inspecting costs nothing; once on, a change to the buffer (typing, undo, redo, a snippet, a helper, a
 * restored draft, a review) schedules a run after a short pause. Every run works on a snapshot of the lines and carries the
 * revision it started from: a result for an older revision is discarded, and a newer change aborts a run in flight. Nothing
 * here writes a file, opens a watcher or keeps a timer after `dispose`.
 */
export interface ProblemsOptions {
  debounceMs?: number;
  /** The filesystem the document's references are checked against; undefined for a document with no folder yet. */
  makeFs?: () => Promise<LocalFs | undefined>;
}

export class ProblemsRunner {
  /** Told when a report arrives (the app redraws). */
  static notify?: () => void;
  report?: DiagnosticReport;
  /** Findings the person dismissed; cleared by the next report, so a dismissal never hides a changed document. */
  readonly dismissed = new Set<string>();
  disposed = false;
  private revision = 0;
  private timer?: NodeJS.Timeout;
  private controller?: AbortController;
  private running = 0;
  private stop?: () => void;

  constructor(private readonly editor: EditorState, private readonly options: ProblemsOptions = {}) {}

  /** A run is pending or in flight. */
  get busy(): boolean { return this.running > 0 || this.timer !== undefined; }
  get enabled(): boolean { return this.stop !== undefined; }

  enable(): void {
    if (this.disposed) return;
    if (!this.stop) this.stop = this.editor.buffer.observe(() => { this.revision += 1; this.schedule(); });
    this.refresh();
  }

  /** Check now (opening Problems, Ctrl+R, after a save: the files the document names may have changed). */
  refresh(): void {
    if (this.disposed) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    void this.run();
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, this.options.debounceMs ?? 500);
    this.timer.unref?.();
  }

  private async makeFs(): Promise<LocalFs | undefined> {
    if (this.options.makeFs) return this.options.makeFs();
    const file = this.editor.file;
    if (file.scratch) return undefined;
    const directory = dirname(file.realPath);
    return createLocalFs(directory, await documentRoot(directory));
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const revision = this.revision;
    this.running += 1;
    try {
      const path = this.editor.file.path;
      const kind = formatForPath(path).format;
      const format = kind === 'markdown' || kind === 'html' ? kind : extname(path).toLowerCase() === '.css' ? 'css' : undefined;
      const lines = [...this.editor.buffer.lines];
      const fs = await this.makeFs();
      const report = format ? await diagnose({lines, format, ...(fs ? {fs} : {}), signal: controller.signal}) : {diagnostics: [], external: 0, checked: 0, truncated: false};
      // A result for a text that has since changed is stale: the change has scheduled (or will schedule) its own run.
      if (this.disposed || controller.signal.aborted || revision !== this.revision) return;
      this.report = report;
      this.dismissed.clear();
      ProblemsRunner.notify?.();
    } finally { this.running -= 1; }
  }

  /** The findings that are not dismissed. */
  visible(): Diagnostic[] { return (this.report?.diagnostics ?? []).filter(item => !this.dismissed.has(item.id)); }

  counts(): Record<Severity, number> {
    const counts: Record<Severity, number> = {error: 0, warning: 0, info: 0, unverified: 0};
    for (const item of this.visible()) counts[item.severity] += 1;
    return counts;
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.stop?.();
    this.stop = undefined;
  }
}

export const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info', 'unverified'];
