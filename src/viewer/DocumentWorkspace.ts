import type {Key} from '../terminal/keys.js';
import type {TextOverlay} from '../arcade/Canvas.js';
import {createEditor, editorKey, renderEditor, type EditorAction, type EditorState} from './EditorPanel.js';
import {formatForPath, type ViewDocument} from './document.js';
import type {EditableFile} from './fileEdit.js';
import {createViewer, renderViewer, viewerKey, type ViewerAction, type ViewerLook, type ViewerState} from './ViewerPanel.js';

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
export type DocumentMode = 'source' | 'edit' | 'preview';

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
  | {kind: 'image'; index: number};

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
  if (state.mode !== 'edit') state.tops[state.mode] = {top: viewer.top, sub: viewer.sub};
  if (mode === 'preview') state.before = state.mode;
  if (mode !== 'edit') {
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
  if (editor.dialog || editor.busy) return fromEditor(state, editorKey(editor, key, columns, height));
  if (key.kind === 'sendToProgram') return {kind: 'save'};

  if (state.mode === 'edit') {
    if (key.kind === 'toggleDetails') { setDocumentMode(state, 'preview'); return {kind: 'preview', refresh: false}; }
    // Esc leaves typing for navigation without closing or discarding anything; the unsaved buffer stays as it is.
    if (key.kind === 'escape' && !editor.input) { setDocumentMode(state, 'source'); return undefined; }
    return fromEditor(state, editorKey(editor, key, columns, height));
  }

  // A find prompt in the browser preview owns its keys.
  if (state.mode === 'preview' && state.preview?.capturing()) { state.preview.key(key); return undefined; }
  // Navigation (source and preview).
  const searching = Boolean(state.viewer.input) && state.mode === 'source';
  if (!searching) {
    if (text === 'e') { setDocumentMode(state, 'edit'); return undefined; }
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
  return undefined;
}

function fromEditor(state: DocumentSession, action: EditorAction | undefined): DocumentSessionAction | undefined {
  if (!action) return undefined;
  if (action.kind === 'close') return {kind: 'close'};
  if (action.kind === 'save') return {kind: 'save', ...(action.force ? {force: true} : {}), ...(action.thenClose ? {thenClose: true} : {})};
  if (action.kind === 'reload') return {kind: 'reload'};
  return {kind: 'copy', text: action.text};
}

/** The look the viewer needs in a workspace: its controls name the workspace's keys. */
export function documentSessionLook(state: DocumentSession, look: ViewerLook = {}): ViewerLook {
  return {...look, workspace: {mode: state.mode === 'preview' ? 'preview' : 'source', dirty: state.editor.buffer.dirty, browser: Boolean(state.preview), trusted: state.trusted}};
}

export function renderDocumentSession(state: DocumentSession, columns: number, height: number, look: ViewerLook = {}): string[] {
  state.overlays = [];
  const editor = state.editor;
  if (state.mode === 'edit' || editor.dialog) return renderEditor(editor, columns, height);
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
