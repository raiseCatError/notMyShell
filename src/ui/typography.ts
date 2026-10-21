import type {Rgb} from '../chroma/escape.js';
import {displayWidth, truncateText} from '../util/text.js';

/**
 * NMSh's shared typography: semantic roles, not escape sequences.
 *
 * A component asks for a role (a title, a heading, a score counter, a celebration) and the width it may use; the backend
 * decides how to draw it. Where the terminal has been shown to scale text (Kitty's OSC 66 text sizing protocol,
 * detected separately from graphics), the role is drawn larger; everywhere else it is ordinary styled text with the same
 * hierarchy in weight, color and spacing. Callers never build an OSC 66 sequence and never branch on the terminal.
 *
 * A block reports the cells it really occupies, so layout, wrapping, scrolling and clipping use measured sizes. Sized
 * text must not be partly drawn: callers place a sized block only when all its rows are visible, and use `plain`
 * otherwise. Sized text is a drawing concern only: it is never written to transcripts, saved documents or the clipboard.
 */
export type TypeRole = 'title' | 'heading' | 'subheading' | 'body' | 'caption' | 'counter' | 'celebration';

export type TextSizingMode = 'auto' | 'off' | 'enhanced';

export interface TextSizingCapability {
  /** The terminal drew a block with `s=2` two cells wide: scaled text works. */
  scale: boolean;
  /** The terminal drew `w=2` two cells wide: explicit widths work. */
  width: boolean;
}

export interface TextSizingState {
  mode: TextSizingMode;
  capability: TextSizingCapability;
  /** The terminal is known to parse the protocol without drawing scaled glyphs; only `enhanced` overrides this. */
  knownUnrendered: boolean;
}

let state: TextSizingState = {mode: 'auto', capability: {scale: false, width: false}, knownUnrendered: false};

export function setTextSizing(next: Partial<TextSizingState>): void { state = {...state, ...next}; }
export function textSizing(): Readonly<TextSizingState> { return state; }

/** Scaled text may be drawn: the person has not turned it off, and the terminal was shown to scale it. */
export function textSizingActive(): boolean {
  if (state.mode === 'off' || !state.capability.scale) return false;
  return state.mode === 'enhanced' || !state.knownUnrendered;
}

export interface TypeRequest {
  role: TypeRole;
  text: string;
  /** The most cells the block may occupy across. */
  maxColumns: number;
  /** The most rows it may occupy down (a short panel gets smaller type). */
  maxRows?: number;
  /** A document heading's level (1..6) refines `heading` and `title`. */
  level?: number;
  fg?: Rgb;
  bg?: Rgb;
  /**
   * The text as styled pieces (bold, italic, code, links in a heading): each piece is drawn with its own SGR prefix, side by
   * side at the same scale. When present, `text` is the pieces joined. A piece that cannot be sized means plain text.
   */
  segments?: ReadonlyArray<{text: string; sgr: string}>;
}

/** A scaled block: the escape that draws it with the cursor at its top-left cell, and the cells it covers. */
export interface SizedBlock {
  sequence: string;
  columns: number;
  rows: number;
}

export interface TypeBlock {
  /** Cells the block occupies in the layout (the sized size when `sized`, otherwise the plain rows). */
  columns: number;
  rows: number;
  /** The ordinary rendering, one string per row (unstyled text; callers add color). Always present. */
  plain: string[];
  sized?: SizedBlock;
}

/** The role's weight in the plain rendering: bold for everything above body text. */
export const ROLE_BOLD: Readonly<Record<TypeRole, boolean>> = {title: true, heading: true, subheading: true, body: false, caption: false, counter: true, celebration: true};

/** Plain rendering only, until a backend fills `sized` (see ui/textSizing). */
export function typeset(request: TypeRequest): TypeBlock {
  const text = displayWidth(request.text) > request.maxColumns ? truncateText(request.text, request.maxColumns) : request.text;
  const block: TypeBlock = {columns: displayWidth(text), rows: 1, plain: [text]};
  const sized = sizedBackend?.(request, text);
  if (sized) return {columns: sized.columns, rows: sized.rows, plain: block.plain, sized};
  return block;
}

type SizedBackend = (request: TypeRequest, text: string) => SizedBlock | undefined;
let sizedBackend: SizedBackend | undefined;
/** Installed by the text sizing module; tests install fakes. */
export function setSizedBackend(backend: SizedBackend | undefined): void { sizedBackend = backend; }
