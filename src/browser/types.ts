/**
 * The boundary between NMSh and a real browser engine.
 *
 * NMSh draws a real web page by asking an installed Chromium to render it (over the DevTools Protocol, on a pipe, no network port)
 * and showing the frames the engine produces through the graphics service. Nothing in NMSh depends on Chromium except the
 * implementation of these interfaces (`src/browser/engine/*`); the panel and the document workspace only see this file, so they
 * run against a fake engine in tests, and NMSh works fully without a browser installed.
 *
 * Lifecycle: the engine starts lazily on the first `open`, is shared by every page (web tabs and document previews), and shuts down
 * when the last page is closed and `idleMs` has passed, when NMSh exits, or on `shutdown()`. Exactly one browser process tree exists at
 * a time. Pages of kind `web` live in a persistent profile; pages of kind `preview` each get their own throwaway browser context.
 */

export type BrowserAvailability = {ok: true; executable: string; version: string} | {ok: false; reason: string};

export type PageKind = 'web' | 'preview';

export interface Viewport {
  /** CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio of the frames (1 = frames are `width` x `height` pixels). */
  scale: number;
}

export interface OpenOptions {
  kind: PageKind;
  viewport: Viewport;
  /** `web` only: the address to load. Previews load their `PreviewHandle.url`. */
  url?: string;
  /**
   * Scripts run. `web` pages default to true; `preview` pages to false and need an explicit trust decision. A preview can only ever
   * reach its own loopback origin (every other request is refused and reported as a `blocked` event), whatever this says.
   */
  scripts?: boolean;
  /** Emulate prefers-color-scheme / prefers-reduced-motion so a page follows NMSh's theme and motion settings. */
  colorScheme?: 'light' | 'dark';
  reducedMotion?: boolean;
}

/** One rendered frame, PNG-encoded, at `viewport.width * scale` x `viewport.height * scale` pixels. */
export interface Frame {
  png: Uint8Array;
  width: number;
  height: number;
  /** Increases by one per delivered frame. */
  sequence: number;
}

export type MouseEventInput =
  | {type: 'move'; x: number; y: number; modifiers?: number}
  | {type: 'down' | 'up'; x: number; y: number; button: 'left' | 'middle' | 'right'; clickCount?: number; modifiers?: number}
  | {type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers?: number};

export interface KeyEventInput {
  /** DOM `key` ('a', 'Enter', 'ArrowDown', 'Backspace', 'Tab', 'Escape', 'F5'…). */
  key: string;
  /** DOM `code` when known ('KeyA', 'Enter'…); optional. */
  code?: string;
  /** Printable text produced by the key, for typing into fields. */
  text?: string;
  /** Bit mask: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift (the DevTools Protocol's). */
  modifiers?: number;
}

export type PageEvent =
  | {type: 'navigated'; url: string}
  | {type: 'title'; title: string}
  | {type: 'loading'; loading: boolean}
  /** A script dialog (alert/confirm/prompt/beforeunload) was dismissed for the person; the message is for a notice. */
  | {type: 'dialog'; kind: string; message: string}
  /** The page asked for a new window; it opens as a tab (`web`) or is refused (`preview`). */
  | {type: 'popup'; url: string}
  | {type: 'download-blocked'; url: string}
  /** An editable element (field, textarea, contenteditable) gained or lost focus: keys then belong to the page. */
  | {type: 'editable'; editable: boolean}
  /** A request or navigation the page's policy refused (remote resource in a preview, a non-http scheme…). */
  | {type: 'blocked'; url: string; reason: string}
  | {type: 'crashed'}
  | {type: 'closed'};

export interface BrowserPage {
  readonly id: string;
  readonly kind: PageKind;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly viewport: Viewport;
  /** Page zoom (1 = 100%). */
  readonly zoom: number;
  readonly editable: boolean;

  navigate(url: string): Promise<void>;
  reload(options?: {hard?: boolean}): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  stop(): Promise<void>;
  setViewport(viewport: Viewport): Promise<void>;
  setZoom(zoom: number): Promise<void>;
  setScripts(enabled: boolean): Promise<void>;

  /**
   * Frames as the page changes (a static page produces one). The engine sends the next frame only after the listener's returned
   * promise settles (or it returned nothing), so a slow consumer causes frames to be skipped, never queued.
   */
  onFrame(listener: (frame: Frame) => void | Promise<void>): () => void;
  /** One frame of the current state now (a fresh capture even when nothing changed). */
  capture(): Promise<Frame>;
  onEvent(listener: (event: PageEvent) => void): () => void;

  mouse(event: MouseEventInput): Promise<void>;
  key(type: 'down' | 'up' | 'char', event: KeyEventInput): Promise<void>;
  /** Insert text as if typed or pasted into the focused field. */
  insertText(text: string): Promise<void>;
  /** Find in page; resolves with the number of matches and the current index (1-based, 0 when none). */
  find(query: string, options?: {backwards?: boolean}): Promise<{matches: number; current: number}>;
  clearFind(): Promise<void>;

  /** For previews: the run-time knobs; tabs never use it. */
  close(): Promise<void>;
}

export interface BrowserStats {
  running: boolean;
  pages: number;
  pid?: number;
  startedAt?: number;
  executable?: string;
}

export interface BrowserEngine {
  available(): Promise<BrowserAvailability>;
  /** Start the engine if needed and open a page. Rejects with a message fit for the person if no browser is available. */
  open(options: OpenOptions): Promise<BrowserPage>;
  pages(): readonly BrowserPage[];
  /** Stop the process tree now (pages are closed). Safe to call repeatedly. */
  shutdown(): Promise<void>;
  stats(): BrowserStats;
}

// ---- Local document preview ------------------------------------------------------------------------------------------------

/**
 * A document served from memory on a loopback-only server: the editor's current buffer (saved or not), with the files beside it
 * available under a restricted rule. The server is a function of this object only; it reads nothing the document did not name.
 */
export interface PreviewDocument {
  /** The page the browser loads: complete HTML (a Markdown file is converted before it gets here). */
  html: string;
  /** The folder relative references resolve against (the document's own folder). Assets must stay inside `root`. */
  root: string;
  /** Scripts may run in the page (a trusted project). Without it the page is served with a CSP that forbids them. */
  trusted: boolean;
  /** The document's own name, for messages. */
  name: string;
}

export interface PreviewHandle {
  /** The address to open in a `preview` page: `http://127.0.0.1:<port>/<token>/`. */
  readonly url: string;
  /** Replace the served HTML (a refresh of the unsaved buffer); the next load of `url` returns it. Assets are unaffected. */
  update(html: string): void;
  /** Resources the page asked for that were refused or missing, newest last (path and reason), bounded. */
  problems(): ReadonlyArray<{path: string; reason: string}>;
  dispose(): void;
}

export interface PreviewServer {
  serve(document: PreviewDocument): Promise<PreviewHandle>;
  /** Stop listening and forget every handle. */
  close(): Promise<void>;
}
