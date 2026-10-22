import type {Key} from '../terminal/keys.js';
import type {TextOverlay} from '../arcade/Canvas.js';
import {createEditor, editorKey, openConsole, openProblems, renderEditor, type EditorAction, type EditorState} from './EditorPanel.js';
import type {ConsoleFeed} from './consoleDialog.js';
import {formatForPath, type ViewDocument} from './document.js';
import type {EditableFile} from './fileEdit.js';
import {displayWidth, stripAnsi, truncateAnsi} from '../util/text.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getIconStyle} from '../ui/glyphs.js';
import {createHybrid, renderHybrid, scrollHybrid, type HybridState} from './HybridView.js';
import {createViewer, renderViewer, showSourceLine, viewerKey, type ViewerAction, type ViewerLook, type ViewerState} from './ViewerPanel.js';

/**
 * The document workspace for Markdown and HTML files: one document, three ways to look at it, switched with a key and never
 * by reopening anything.
 *
 *   source   the file's text, read-only navigation (the viewer): scroll, find, go to line. `e` starts typing.
 *   edit     the native editor on the same buffer. Plain letters are text; `Ctrl+O` shows the preview, `Esc` returns to source.
 *   preview  the rendered document of the CURRENT buffer, saved or not: a real Chromium page when a browser is installed
 *            (`PreviewView`), otherwise NMSh's own renderer. `e` edits, `r` refreshes, `Esc` returns to source.
 *
 * There is one `EditorState` (buffer, undo history, caret, selection, file identity, save and conflict dialogs); the viewer
 * is re-synced from its lines whenever a read-only mode is shown, so nothing is copied that could drift. Showing the
 * preview never saves. Saving, reloading and the conflict rules are the editor's own (atomic write, identity check, BOM
 * and line endings kept). In navigation modes `h`, `e`, `r` are commands; while typing they are text, and Ctrl+O is the
 * switch that works there.
 */
export type DocumentMode = 'source' | 'edit' | 'preview' | 'split' | 'hybrid';

/**
 * The split view (#461): the editor, the only editable pane, beside NMSh's own preview of the same buffer. F2 opens and closes
 * it; Ctrl+O moves between the panes; in the preview pane `x` swaps the sides, `<` `>` change the widths and `l` links or
 * unlinks the preview's scrolling to the caret. Below SPLIT_MIN_COLUMNS only the focused pane is shown, full width.
 */
export interface SplitState {
  focus: 'source' | 'preview';
  /** The preview is on the left. */
  swapped: boolean;
  /** The text pane shows the hybrid view (rendered except for the active block) instead of the plain source editor. */
  hybrid: boolean;
  /** The preview's share of the width, in percent. */
  ratio: number;
  /** The preview follows the caret when it moves to another line. */
  linked: boolean;
  /** Bumped by every change to the buffer, so the preview is rebuilt only when the text changed. */
  version: number;
  seen: number;
  caretLine: number;
  stop(): void;
}

export const SPLIT_MIN_COLUMNS = 100;
const RATIO_MIN = 30, RATIO_MAX = 70, RATIO_STEP = 5;

/** The pane widths for a terminal of `columns` (one column is the divider); `narrow` shows one pane only. */
export function splitLayout(columns: number, split: Pick<SplitState, 'ratio'>): {narrow: boolean; source: number; preview: number} {
  if (columns < SPLIT_MIN_COLUMNS) return {narrow: true, source: columns, preview: columns};
  const usable = columns - 1;
  const ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, split.ratio));
  const preview = Math.max(40, Math.min(usable - 40, Math.round(usable * ratio / 100)));
  return {narrow: false, source: usable - preview, preview};
}

/** The browser-backed preview as the workspace sees it (see browser/ for the engine behind it). */
export interface PreviewView {
  /** Rows for the preview body area of `columns` x `height`, and the sized-text or image overlays it needs. */
  render(columns: number, height: number): {rows: string[]; overlays?: TextOverlay[]};
  /** A key in preview mode that the workspace did not take (scrolling, zoom, find). */
  key(key: Key): void;
  dispose(): void;
  /** One short line for the status row (zoom, find count, a refused link). */
  status(): string | undefined;
  /** The preview is reading text (a find prompt): every key, Esc included, belongs to it. */
  capturing(): boolean;
  /** Show the buffer's text now (the app builds the page from it); never reads or writes the file. */
  refresh(text: string): Promise<void>;
  /** Scripts on or off for this file (a trusted project). */
  setTrusted(trusted: boolean, text: string): Promise<void>;
  /** The page's runtime Console (#466); undefined when this preview has none (NMSh's own renderer runs no page). */
  console?(): ConsoleFeed | undefined;
}

export interface DocumentSession {
  mode: DocumentMode;
  editor: EditorState;
  viewer: ViewerState;
  /** The Chromium preview, when one is running; otherwise the preview mode uses the viewer's native renderer. */
  preview?: PreviewView;
  /** Scripts may run in the local preview (a trusted project); off unless the person turned them on for this file. */
  trusted: boolean;
  /** The mode the preview was opened from (edit or source): Ctrl+O in the preview goes back to it. */
  before: DocumentMode;
  /** Scroll positions per read-only mode, so switching back finds the place again. */
  tops: {source: {top: number; sub: number}; preview: {top: number; sub: number}};
  /** Present only while the mode is 'split'. */
  split?: SplitState;
  /** The hybrid view's viewport and render cache (#460), created the first time it is shown. */
  hybrid?: HybridState;
  note?: string;
  /** Sized-text blocks of the last render, positioned in the returned panel rows. */
  overlays: TextOverlay[];
}

export type DocumentSessionAction =
  | {kind: 'close'}
  | {kind: 'save'; force?: boolean; thenClose?: boolean}
  /** Reload from disk, discarding the buffer (the person has confirmed when the buffer was edited). */
  | {kind: 'reload'}
  | {kind: 'copy'; text: string}
  /** Entering or refreshing preview: the app builds or updates the browser page from the current buffer. */
  | {kind: 'preview'; refresh: boolean}
  | {kind: 'trust'; on: boolean}
  | {kind: 'open'; path: string}
  | {kind: 'image'; index: number}
  /** Draw the document's Mermaid diagrams (on request), or open drawn diagram `index` enlarged. */
  | {kind: 'diagrams'}
  | {kind: 'diagram'; index: number}
  /** A recovered draft was restored, discarded or kept (#469): the app updates the draft store. */
  | Extract<EditorAction, {kind: 'draft' | 'draft-discard' | 'draft-keep' | 'review' | 'review-apply' | 'save-as'}>;

/** The file's current text: the buffer's lines as one document, as the viewer reads it (unsaved edits included). */
export function bufferText(editor: EditorState): string {
  return editor.buffer.lines.join('\n');
}

function documentOf(editor: EditorState): ViewDocument {
  const text = bufferText(editor);
  const { format, language } = formatForPath(editor.file.path);
  const lines = [...editor.buffer.lines];
  return {
    title: editor.file.title,
    origin: {kind: 'file', path: editor.file.path, realPath: editor.file.realPath, symlink: editor.file.realPath !== editor.file.path, bytes: Buffer.byteLength(text), mtimeMs: editor.file.identity?.mtimeMs ?? 0},
    lines, text, format, ...(language ? {language} : {}),
    notes: editor.buffer.dirty ? ['Showing your unsaved changes.'] : [],
    lineEnding: editor.file.lineEnding, complete: true,
  };
}

export function createDocumentSession(file: EditableFile, mode: DocumentMode = 'source'): DocumentSession {
  const editor = createEditor(file);
  editor.workspace = true;
  const viewer = createViewer(documentOf(editor));
  viewer.rendered = false;
  viewer.numbers = true;
  delete viewer.note;
  return {mode, editor, viewer, trusted: false, before: 'source', tops: {source: {top: 0, sub: 0}, preview: {top: 0, sub: 0}}, overlays: []};
}

/** Re-sync the viewer from the buffer, keeping its scroll position, and show it as source or as the native rendering. */
export function syncDocumentViewer(state: DocumentSession, rendered: boolean): void {
  const viewer = state.viewer;
  viewer.document = documentOf(state.editor);
  delete viewer.markdown;
  delete viewer.tokens;
  delete viewer.match;
  viewer.rendered = rendered;
  viewer.numbers = !rendered;
  delete viewer.note;
}

export function setDocumentMode(state: DocumentSession, mode: DocumentMode): void {
  if (mode === state.mode) return;
  const viewer = state.viewer;
  if (state.mode === 'source' || state.mode === 'preview') state.tops[state.mode] = {top: viewer.top, sub: viewer.sub};
  if (state.mode === 'split') { state.split?.stop(); delete state.split; }
  if (mode === 'preview') state.before = state.mode === 'split' ? 'edit' : state.mode;
  if (mode === 'split') {
    const split: SplitState = {focus: state.mode === 'edit' || state.mode === 'hybrid' ? 'source' : 'preview', swapped: false, hybrid: state.mode === 'hybrid', ratio: 50, linked: true, version: 0, seen: -1, caretLine: -1, stop: () => {}};
    split.stop = state.editor.buffer.observe(() => { split.version += 1; });
    state.split = split;
    syncDocumentViewer(state, true);
    state.viewer.rendered = true;
    state.mode = 'split';
    state.note = undefined;
    return;
  }
  if (mode !== 'edit' && mode !== 'hybrid') {
    syncDocumentViewer(state, mode === 'preview');
    viewer.top = state.tops[mode].top;
    viewer.sub = state.tops[mode].sub;
    delete viewer.shown;
  }
  state.mode = mode;
  state.note = undefined;
}

/** The keys that switch modes in navigation, and the ones that act in every mode. */
export function documentSessionKey(state: DocumentSession, key: Key, columns: number, height: number, look: ViewerLook = {}): DocumentSessionAction | undefined {
  const editor = state.editor;
  const text = key.kind === 'text' ? key.value : undefined;
  state.note = undefined;
  // A save or conflict dialog belongs to the editor, whatever mode raised it.
  if (editor.dialog || editor.review || editor.input || editor.busy) {
    const action = fromEditor(state, editorKey(editor, key, columns, height));
    // A jump from the browser preview's Console goes to the text itself: the page is not the text, so the editor shows it.
    if (editor.consoleJump) { editor.consoleJump = false; if (state.mode === 'preview') { editor.lastJump = undefined; setDocumentMode(state, 'edit'); return action; } }
    // A jump from Problems or the outline moved the caret: the read-only views follow it.
    const jumped = editor.lastJump;
    editor.lastJump = undefined;
    if (jumped !== undefined && (state.mode === 'source' || state.mode === 'preview')) showSourceLine(state.viewer, jumped, columns, height, documentSessionLook(state, look));
    return action;
  }
  if (key.kind === 'splitToggle') { setDocumentMode(state, state.mode === 'split' ? (state.split?.hybrid ? 'hybrid' : 'edit') : 'split'); return undefined; }
  if (key.kind === 'hybridToggle') { toggleHybrid(state); return undefined; }
  if (state.mode === 'split') return splitKey(state, key, columns, height, look);
  if (key.kind === 'sendToProgram') return editor.file.scratch ? fromEditor(state, editorKey(editor, key, columns, height)) : {kind: 'save'};

  if (state.mode === 'edit' || state.mode === 'hybrid') {
    if (state.mode === 'hybrid' && hybridScrollKey(state, key, columns, height, look)) return undefined;
    if (key.kind === 'toggleDetails') { setDocumentMode(state, 'preview'); return {kind: 'preview', refresh: false}; }
    // Esc leaves typing for navigation without closing or discarding anything; the unsaved buffer stays as it is.
    if (key.kind === 'escape' && !editor.input && !editor.snippet) { setDocumentMode(state, 'source'); return undefined; }
    return fromEditor(state, editorKey(editor, key, columns, height));
  }

  // A find prompt in the browser preview owns its keys.
  if (state.mode === 'preview' && state.preview?.capturing()) { state.preview.key(key); return undefined; }
  // Navigation (source and preview).
  const searching = Boolean(state.viewer.input) && state.mode === 'source';
  if (!searching) {
    if (text === 'e') { setDocumentMode(state, 'edit'); return undefined; }
    if (text === 's') { setDocumentMode(state, 'split'); return undefined; }
    if (text === 'P') { openProblems(editor); return undefined; }
    if (text === 'C' && state.mode === 'preview') {
      // The Console only reads what the page reported; opening it changes nothing about scripts or the network.
      const feed = state.preview?.console?.();
      if (feed) openConsole(editor, feed);
      else state.note = state.preview ? 'This preview has no Console.' : 'The Console belongs to the browser preview (Chromium); NMSh\'s own renderer runs no page.';
      return undefined;
    }
    if (text === 'H') { toggleHybrid(state); return undefined; }
    if (key.kind === 'toggleDetails' && state.mode === 'preview') { setDocumentMode(state, state.before); return undefined; }
    if (text === 'h' || key.kind === 'toggleDetails') {
      if (state.mode === 'preview') { setDocumentMode(state, 'source'); return undefined; }
      setDocumentMode(state, 'preview');
      return {kind: 'preview', refresh: false};
    }
    if (text === 'r' && state.mode === 'preview') { if (!state.preview) syncDocumentViewer(state, true); return {kind: 'preview', refresh: true}; }
    if (text === 'r') { state.note = 'The preview shows the current text each time you open it (h); r refreshes it while it is open.'; return undefined; }
    if (text === 'R') {
      if (editor.buffer.dirty) { editor.dialog = {kind: 'conflict', focus: 0, conflict: 'changed', reason: `${editor.file.title} has unsaved changes. Reloading from disk discards them.`}; return undefined; }
      return {kind: 'reload'};
    }
    // The browser preview's page says "press D" for diagrams drawn on request: D is the workspace's, not the page's.
    if (text === 'D' && state.mode === 'preview' && state.preview) return {kind: 'diagrams'};
    if (text === 'T' && state.mode === 'preview') { state.trusted = !state.trusted; return {kind: 'trust', on: state.trusted}; }
    if ((text === 'q' || key.kind === 'escape' || key.kind === 'interrupt') && !state.viewer.query) {
      if (state.mode === 'preview') { setDocumentMode(state, 'source'); return undefined; }
      if (editor.buffer.dirty) { editor.dialog = {kind: 'unsaved', focus: 0}; return undefined; }
      return {kind: 'close'};
    }
  }
  if (state.mode === 'preview' && state.preview) {
    // The browser preview scrolls, zooms and finds by itself; the workspace owns only the keys above.
    state.preview.key(key);
    return undefined;
  }
  const action: ViewerAction | undefined = viewerKey(state.viewer, key, columns, height, look);
  if (!action) return undefined;
  if (action.kind === 'close') return editor.buffer.dirty && !state.viewer.query ? (editor.dialog = {kind: 'unsaved', focus: 0}, undefined) : {kind: 'close'};
  if (action.kind === 'copy') return {kind: 'copy', text: action.text};
  if (action.kind === 'edit') { setDocumentMode(state, 'edit'); return undefined; }
  if (action.kind === 'open') return {kind: 'open', path: action.path};
  if (action.kind === 'image') return {kind: 'image', index: action.index};
  if (action.kind === 'diagrams' || action.kind === 'diagram') return action;
  return undefined;
}

/** The wheel scrolls the hybrid view without moving the caret; Page keys move the caret by about a screen of source lines. */
function hybridScrollKey(state: DocumentSession, key: Key, columns: number, height: number, look: ViewerLook): boolean {
  const hybrid = hybridOf(state);
  if (key.kind === 'wheelUp' || key.kind === 'wheelDown') { scrollHybrid(state.editor, hybrid, key.kind === 'wheelUp' ? -3 : 3, columns, look); return true; }
  hybrid.free = false;
  if (key.kind === 'pageUp' || key.kind === 'pageDown') { state.editor.buffer.vertical((key.kind === 'pageUp' ? -1 : 1) * Math.max(1, height - 6)); return true; }
  return false;
}

function hybridOf(state: DocumentSession): HybridState {
  return state.hybrid ??= createHybrid();
}

/** F3: the plain source editor and the hybrid view are two presentations of one buffer. */
function toggleHybrid(state: DocumentSession): void {
  if (formatForPath(state.editor.file.path).format !== 'markdown') { state.note = 'The hybrid view is for Markdown files.'; return; }
  if (state.mode === 'split' && state.split) { state.split.hybrid = !state.split.hybrid; return; }
  setDocumentMode(state, state.mode === 'hybrid' ? 'edit' : 'hybrid');
}

function splitLook(state: DocumentSession, look: ViewerLook): ViewerLook {
  const split = state.split!;
  const {workspace: _workspace, sized: _sized, ...rest} = look;
  return {...rest, split: {linked: split.linked, focused: split.focus === 'preview'}};
}

function splitKey(state: DocumentSession, key: Key, columns: number, height: number, look: ViewerLook): DocumentSessionAction | undefined {
  const split = state.split!;
  const editor = state.editor;
  const layout = splitLayout(columns, split);
  const text = key.kind === 'text' ? key.value : undefined;
  if (key.kind === 'toggleDetails' && !editor.dialog) { split.focus = split.focus === 'source' ? 'preview' : 'source'; return undefined; }
  if (split.focus === 'source') {
    if (split.hybrid && !editor.dialog && !editor.input && hybridScrollKey(state, key, layout.narrow ? columns : layout.source, height, look)) return undefined;
    if (key.kind === 'escape' && !editor.input && !editor.snippet) { setDocumentMode(state, 'source'); return undefined; }
    return fromEditor(state, editorKey(editor, key, layout.narrow ? columns : layout.source, height));
  }
  const viewer = state.viewer;
  if (!viewer.input) {
    if (key.kind === 'escape' && !viewer.query) { setDocumentMode(state, 'source'); return undefined; }
    if (text === 'P') { openProblems(editor); return undefined; }
    if (text === 'x') { split.swapped = !split.swapped; return undefined; }
    if (text === '<' || text === '>') { split.ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, split.ratio + (text === '>' ? RATIO_STEP : -RATIO_STEP))); return undefined; }
    if (text === 'l') { split.linked = !split.linked; return undefined; }
    if (text === 'e') { split.focus = 'source'; return undefined; }
    if (text === 's') { setDocumentMode(state, 'edit'); return undefined; }
  }
  // Scrolling the preview by hand is the person's choice of place: it is not undone by a caret that has not moved.
  split.caretLine = editor.buffer.caret.line;
  const action = viewerKey(viewer, key, layout.narrow ? columns : layout.preview, height, splitLook(state, look));
  if (action?.kind === 'diagrams' || action?.kind === 'diagram') return action;
  return action?.kind === 'copy' ? {kind: 'copy', text: action.text} : undefined;
}

function pad(row: string, width: number): string {
  const cut = truncateAnsi(row, width);
  return `${cut}${' '.repeat(Math.max(0, width - displayWidth(stripAnsi(cut))))}\u001b[0m`;
}

function renderSplit(state: DocumentSession, columns: number, height: number, look: ViewerLook): string[] {
  const split = state.split!;
  const editor = state.editor;
  const layout = splitLayout(columns, split);
  const previewLook = splitLook(state, look);
  const previewWidth = layout.narrow ? columns : layout.preview;
  if (split.seen !== split.version) { syncDocumentViewer(state, true); state.viewer.rendered = true; split.seen = split.version; }
  const line = editor.buffer.caret.line;
  if (split.linked && line !== split.caretLine) showSourceLine(state.viewer, line, previewWidth, height, previewLook);
  split.caretLine = line;
  if (state.note) state.viewer.note = state.note;
  const sourcePane = (width: number) => split.hybrid ? renderHybrid(editor, hybridOf(state), width, height, look) : renderEditor(editor, width, height);
  if (layout.narrow) return split.focus === 'source' ? sourcePane(columns) : renderViewer(state.viewer, columns, height, previewLook);
  const source = sourcePane(layout.source);
  const preview = renderViewer(state.viewer, layout.preview, height, previewLook);
  const [left, right] = split.swapped ? [preview, source] : [source, preview];
  const [leftWidth, rightWidth] = split.swapped ? [layout.preview, layout.source] : [layout.source, layout.preview];
  const safe = getIconStyle() === 'safe';
  const bar = `${foreground(UI_COLORS.separator)}${safe ? '|' : '│'}\u001b[0m`;
  const joint = (top: boolean) => `${foreground(UI_COLORS.separator)}${safe ? '+' : top ? '┬' : '┴'}\u001b[0m`;
  const count = Math.max(left.length, right.length);
  return Array.from({length: count}, (_, index) => `${pad(left[index] ?? '', leftWidth)}${index === 0 ? joint(true) : index === count - 1 ? joint(false) : bar}${pad(right[index] ?? '', rightWidth)}`);
}

function fromEditor(state: DocumentSession, action: EditorAction | undefined): DocumentSessionAction | undefined {
  if (state.editor.diagramsAsked) { state.editor.diagramsAsked = false; if (!action) return {kind: 'diagrams'}; }
  if (!action) return undefined;
  if (action.kind === 'close') return {kind: 'close'};
  if (action.kind === 'save') return {kind: 'save', ...(action.force ? {force: true} : {}), ...(action.thenClose ? {thenClose: true} : {})};
  if (action.kind === 'reload') return {kind: 'reload'};
  if (action.kind === 'draft' || action.kind === 'draft-discard' || action.kind === 'draft-keep' || action.kind === 'review' || action.kind === 'review-apply' || action.kind === 'save-as') return action;
  if (action.kind === 'playground') return undefined;
  return {kind: 'copy', text: action.text};
}

/** The look the viewer needs in a workspace: its controls name the workspace's keys. */
export function documentSessionLook(state: DocumentSession, look: ViewerLook = {}): ViewerLook {
  return {...look, workspace: {mode: state.mode === 'preview' ? 'preview' : 'source', dirty: state.editor.buffer.dirty, browser: Boolean(state.preview), trusted: state.trusted}};
}

export function renderDocumentSession(state: DocumentSession, columns: number, height: number, look: ViewerLook = {}): string[] {
  state.overlays = [];
  const editor = state.editor;
  if (state.mode === 'split' && state.split && !(editor.dialog || editor.review || editor.input)) return renderSplit(state, columns, height, look);
  if (state.mode === 'hybrid' && !(editor.dialog || editor.review || editor.input)) return renderHybrid(editor, hybridOf(state), columns, height, look);
  if (state.mode === 'edit' || state.mode === 'hybrid' || state.mode === 'split' || editor.dialog || editor.review || editor.input) return renderEditor(editor, columns, height);
  if (state.mode === 'preview' && state.preview) {
    const view = state.preview.render(columns, height);
    state.overlays = view.overlays ?? [];
    return view.rows;
  }
  if (state.note) state.viewer.note = state.note;
  const rows = renderViewer(state.viewer, columns, height, documentSessionLook(state, look));
  state.overlays = state.viewer.overlays ?? [];
  return rows;
}
