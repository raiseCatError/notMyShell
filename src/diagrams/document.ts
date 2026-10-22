import type {LoadedImage} from '../graphics/service.js';
import type {DiagramProvider, DiagramSlot} from '../markdown/render.js';
import {checkMermaidSource, diagramKey, mermaidConfig, type DiagramTheme} from './mermaid.js';
import type {DiagramClient, DiagramPlacer, DiagramService} from './service.js';

/**
 * The diagrams of one open document: the renderer's `DiagramProvider`, and the only connection between a document view and the
 * diagram service. It never changes the document: it is asked for a diagram's text, and answers with rows to draw or a reason.
 *
 *  - Settings → Mermaid diagrams: `auto` draws them whenever a rendered view shows one; `manual` (the default) only after the person
 *    asked for this document (D, or F1 › Draw diagrams); `off` never.
 *  - What the document shows now: a full render (`pass`) or the hybrid view's block list (`want`) replaces it. The service draws
 *    only diagrams some open document shows, so text typed past is never drawn.
 *  - Placements belong to this object: closing the document releases its pictures from the terminal and detaches it from the
 *    service (the renderer page closes when no document is left).
 */
export type DiagramMode = 'auto' | 'manual' | 'off';

export const MAX_DOCUMENT_DIAGRAMS = 24;
const ORDER_LIMIT = 256;

export interface DocumentDiagramOptions {
  mode: () => DiagramMode;
  theme: () => DiagramTheme;
  placer: DiagramPlacer;
  /** A diagram finished (or failed): the view draws again. */
  changed: () => void;
}

/** A one-line reason from a library message (Mermaid's parse errors are several lines with a caret drawing). */
export function shortReason(message: string): string {
  // Reasons can come from files on disk (a package.json) or the library: no terminal controls or bidi formatting reach a row.
  // eslint-disable-next-line no-control-regex
  const lines = message.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').split('\n').map(line => line.trim()).filter(line => line && !/^[-.]*\^$/u.test(line) && !/^\.\.\./u.test(line));
  const text = lines.length > 1 ? `${lines[0]!.replace(/:$/u, '')}: ${lines.at(-1)}` : (lines[0] ?? message);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

export class DocumentDiagrams implements DiagramProvider, DiagramClient {
  private shown = new Set<string>();
  private collecting: Set<string> | undefined;
  private readonly order: string[] = [];
  private attached = false;
  private closed = false;
  private changes = 0;
  private waiting = false;
  /** The person asked for this document's diagrams (on-request mode). */
  requested = false;

  constructor(private readonly service: () => DiagramService, private readonly options: DocumentDiagramOptions) {}

  /** Changes whenever what the rows would show changes: a diagram finished, the mode or the theme changed. */
  get version(): string {
    const theme = this.options.theme();
    return `${this.changes}|${this.options.mode()}|${this.requested ? 1 : 0}|${theme.scheme}${theme.text}${theme.accent}${theme.line}`;
  }

  /** Diagrams were shown that are drawn on request, and the person has not asked yet: the controls offer D. */
  get offer(): boolean { return this.waiting && !this.enabled && this.options.mode() === 'manual'; }

  get enabled(): boolean {
    const mode = this.options.mode();
    return mode === 'auto' || (mode === 'manual' && this.requested);
  }

  /** D / F1 › Draw diagrams: draw this document's diagrams now, and try again what failed for a passing reason. */
  request(): void {
    this.requested = true;
    if (this.attached) this.service().retry();
    this.changes += 1;
  }

  /** Render the whole document inside this: the diagrams it asks for are the ones shown, and only those are drawn. */
  pass<T>(render: () => T): T {
    const outer = this.collecting;
    const collected = new Set<string>();
    this.collecting = collected;
    try { return render(); } finally {
      this.collecting = outer;
      this.shown = collected;
    }
  }

  /** The diagrams shown now, by their text (the hybrid view, which renders block by block). */
  want(sources: readonly string[]): void {
    if (!this.enabled) { this.shown = new Set(); return; }
    const theme = this.options.theme();
    this.shown = new Set(sources.slice(0, MAX_DOCUMENT_DIAGRAMS).map(source => diagramKey(source, theme)));
  }

  wants(key: string): boolean { return !this.closed && this.shown.has(key); }

  notify(): void {
    if (this.closed) return;
    this.changes += 1;
    this.options.changed();
  }

  slot(source: string): DiagramSlot {
    const mode = this.options.mode();
    const empty = (note: string): DiagramSlot => ({index: -1, note, place: () => undefined});
    if (this.closed) return empty('the document is closed');
    if (mode === 'off') return empty('Mermaid diagrams are off (Settings → General → Mermaid diagrams)');
    if (!this.enabled) this.waiting = true;
    if (!this.enabled) return empty('not drawn yet: press D to draw this document\'s diagrams (F1 › Draw diagrams while editing)');
    const check = checkMermaidSource(source);
    if (!check.ok) return empty(check.reason);
    const theme = this.options.theme();
    const key = diagramKey(source, theme);
    const capped = empty(`NMSh draws at most ${MAX_DOCUMENT_DIAGRAMS} diagrams in one document`);
    if (this.collecting) {
      if (!this.collecting.has(key) && this.collecting.size >= MAX_DOCUMENT_DIAGRAMS) return capped;
      this.collecting.add(key);
    } else if (!this.shown.has(key) && this.shown.size >= MAX_DOCUMENT_DIAGRAMS) return capped;
    if (!this.attached) { this.service().attach(this); this.attached = true; }
    const entry = this.service().request(key, source, mermaidConfig(theme));
    let index = this.order.indexOf(key);
    if (index < 0) {
      if (this.order.length >= ORDER_LIMIT) this.order.shift();
      this.order.push(key);
      index = this.order.length - 1;
    }
    if (entry.state === 'failed') return {index, note: shortReason(entry.reason ?? 'the diagram could not be drawn'), place: () => undefined};
    if (entry.state !== 'ready' || !entry.image) return {index, note: 'drawing…', place: () => undefined};
    const image = entry.image;
    return {
      index, ...(entry.type ? {type: entry.type} : {}),
      place: (columns, maxRows) => {
        if (this.closed) return undefined;
        const placement = this.options.placer.place(image, {columns, rows: maxRows, owner: this, surface: 'inline'});
        return placement.kind === 'text' ? undefined : {lines: placement.lines, columns: placement.columns, rows: placement.rows};
      },
    };
  }

  /** A fence for the browser preview: its drawing as a `data:` PNG, or why it is not drawn (same rules and requests as `slot`). */
  html(source: string): {src: string; alt: string} | {note: string} {
    const slot = this.slot(source);
    const key = slot.index >= 0 ? this.order[slot.index] : undefined;
    const png = key && !slot.note ? this.service().entry(key)?.png : undefined;
    if (png) return {src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, alt: `Mermaid ${slot.type ?? 'diagram'}`};
    return {note: slot.note ?? 'not available'};
  }

  /** The drawing behind a slot's index, for the enlarged view. */
  image(index: number): LoadedImage | undefined {
    const key = this.order[index];
    return key && this.attached ? this.service().entry(key)?.image : undefined;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.shown = new Set();
    this.options.placer.releaseOwner(this);
    if (this.attached) this.service().detach(this);
  }
}
