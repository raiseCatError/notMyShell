import type {TerminalCapabilities} from '../host/capabilities.js';
import {terminalProfile} from '../host/capabilities.js';
import type {TextSizingSetting} from '../prompt/configuration.js';
import {setSizedBackend, setTextSizing, type SizedBlock, type TypeRequest, type TypeRole} from './typography.js';

/**
 * Kitty's text sizing protocol (OSC 66), as NMSh's typography backend.
 * https://sw.kovidgoyal.net/kitty/text-sizing-protocol/
 *
 *   OSC 66 ; metadata ; text ST      metadata: colon-separated key=value
 *     s  1-7  scale: each cell becomes an s x s block (a w-cell glyph is s*w columns wide and s rows high)
 *     w  0-7  explicit width in cells; 0 lets the terminal measure the text
 *     n, d    fractional scale n/d (n < d): only the glyph shrinks inside the s x s cells, the box does not change
 *     v, h    0/1/2 alignment of a fractionally scaled glyph inside its box (top/bottom/center, left/right/center)
 *
 * This is relative terminal text scaling, not a font engine: no family choice, no arbitrary point sizes. Scale and width
 * support are detected separately (host/probe.ts, the cursor-position method of the specification) and used separately.
 *
 * What makes it safe here:
 *  - only text whose cell width is certain (ordinary Latin, Greek, Cyrillic and punctuation) is ever sized, so the
 *    terminal's own measurement and ours cannot disagree and the layout cannot drift; anything else is drawn plain;
 *  - the text goes in escape-safe (control characters never reach the sequence) and under the 4096-byte limit;
 *  - a block is a single sequence at one position, drawn after the rows of its frame (an erase or overwrite of any one
 *    cell of a multicell erases all of it, so the renderer places it last and again whenever a row it covers repaints);
 *  - sizing is a drawing concern: it is never written to transcripts, saved documents or the clipboard.
 */

export interface ScaleStep {
  s: number;
  /** Fractional glyph scale inside the s x s cells. */
  n?: number;
  d?: number;
  v?: 0 | 1 | 2;
  h?: 0 | 1 | 2;
  /** The narrowest area (in cells) in which this step may be used: no oversized headings in narrow windows. */
  minColumns: number;
}

/**
 * Candidates per role, largest first; the first that fits the columns and rows wins, else the text is drawn plain.
 * Document levels map H1..H6 onto 3x, 2x, 1.5x, then ordinary bold, bold, muted (those three are weight and color, not size).
 */
export const ROLE_STEPS: Readonly<Record<TypeRole, readonly ScaleStep[]>> = {
  celebration: [{s: 3, minColumns: 60}, {s: 2, minColumns: 30}],
  title: [{s: 3, minColumns: 60}, {s: 2, minColumns: 36}],
  heading: [{s: 2, minColumns: 36}],
  subheading: [{s: 2, n: 3, d: 4, v: 2, minColumns: 36}],
  counter: [{s: 2, minColumns: 24}],
  caption: [],
  body: [],
};

/** A document heading level (1..6) as a role: H1 title, H2 heading, H3 subheading, deeper levels are ordinary text. */
export function roleForLevel(level: number): TypeRole {
  return level <= 1 ? 'title' : level === 2 ? 'heading' : level === 3 ? 'subheading' : level === 4 ? 'caption' : 'body';
}

/** The code points whose width is not in doubt: printable ASCII, Latin-1 to Latin Extended-B, Greek, Cyrillic, general punctuation. */
const SIZABLE = /^[ -~¡-¬®-ɏͰ-ϿЀ-ӿ‐-‧‰-⁄]*$/u;
export const MAX_SIZED_BYTES = 4096;

export function isSizable(text: string): boolean {
  return text.length > 0 && Buffer.byteLength(text) <= MAX_SIZED_BYTES && SIZABLE.test(text);
}

export function metadata(step: Pick<ScaleStep, 's' | 'n' | 'd' | 'v' | 'h'>): string {
  const parts = [`s=${step.s}`];
  if (step.n !== undefined && step.d !== undefined && step.n > 0 && step.d > step.n) {
    parts.push(`n=${step.n}`, `d=${step.d}`);
    if (step.v) parts.push(`v=${step.v}`);
    if (step.h) parts.push(`h=${step.h}`);
  }
  return parts.join(':');
}

/** The escape for `text` at the given step. The caller has checked `isSizable`; this refuses anything unsafe anyway. */
export function osc66(text: string, step: Pick<ScaleStep, 's' | 'n' | 'd' | 'v' | 'h'>): string {
  if (!Number.isInteger(step.s) || step.s < 1 || step.s > 7) throw new RangeError('text sizing scale must be 1..7');
  if (!isSizable(text)) throw new RangeError('text is not safe to size');
  return `\u001b]66;${metadata(step)};${text}\u001b\\`;
}

/** The sized block for a request, or undefined when scaling is off, unverified, or no step fits. */
function sizedBlock(request: TypeRequest, text: string): SizedBlock | undefined {
  if (!textSizingEnabled() || !isSizable(text)) return undefined;
  if (request.segments?.some(segment => !isSizable(segment.text))) return undefined;
  const steps = request.role === 'title' || request.role === 'heading' || request.role === 'subheading'
    ? ROLE_STEPS[request.level !== undefined ? roleForLevel(request.level) : request.role] : ROLE_STEPS[request.role];
  const maxRows = request.maxRows ?? 3;
  const cells = text.length;
  for (const step of steps) {
    const columns = cells * step.s;
    if (step.s > maxRows || columns > request.maxColumns || request.maxColumns < step.minColumns) continue;
    const sequence = request.segments?.length
      ? request.segments.map(segment => `${segment.sgr}${osc66(segment.text, step)}\u001b[0m`).join('')
      : osc66(text, step);
    return {sequence, columns, rows: step.s};
  }
  return undefined;
}

let active = false;
export function textSizingEnabled(): boolean { return active; }

/** Hosts that are known to parse OSC 66 without drawing scaled glyphs; Auto stays off for them, Enhanced is a deliberate override. */
const UNRENDERED_PROFILES: ReadonlySet<string> = new Set(['ghostty']);

export interface TextSizingInput {
  setting: TextSizingSetting;
  capabilities: Readonly<TerminalCapabilities>;
  env: NodeJS.ProcessEnv;
  /** Colorless terminals are fine for sizing, but a multiplexer in between is not (it cannot pass the sequence). */
}

/** Apply the setting and the probe's evidence to the typography module. Safe to call whenever either changes. */
export function configureTextSizing(input: TextSizingInput): void {
  const {setting, capabilities, env} = input;
  const nested = Boolean(env.TMUX || env.STY || env.ZELLIJ) || /^(?:tmux|screen)/u.test(env.TERM ?? '');
  const scale = Boolean(capabilities.textSizing?.scale) && !nested && env.TERM !== 'dumb' && env.NMSH_TEXT_SIZING !== '0';
  const knownUnrendered = UNRENDERED_PROFILES.has(terminalProfile(env));
  setTextSizing({mode: setting, capability: {scale, width: Boolean(capabilities.textSizing?.width) && !nested}, knownUnrendered});
  active = setting !== 'off' && scale && (setting === 'enhanced' || !knownUnrendered);
  setSizedBackend(active ? sizedBlock : undefined);
}

/** Why scaled text is, or is not, in use right now: one sentence for /doctor. */
export function describeTextSizing(input: TextSizingInput): string {
  const {setting, capabilities, env} = input;
  const nested = Boolean(env.TMUX || env.STY || env.ZELLIJ) || /^(?:tmux|screen)/u.test(env.TERM ?? '');
  if (setting === 'off') return 'Text sizing: off in Settings.';
  if (nested) return 'Text sizing: off (a terminal multiplexer cannot pass the sequence).';
  if (!capabilities.textSizing) return 'Text sizing: not checked (this terminal did not answer the probe).';
  if (!capabilities.textSizing.scale) return `Text sizing: not available${capabilities.textSizing.width ? ' (explicit widths only)' : ''}; headings use weight and color.`;
  if (UNRENDERED_PROFILES.has(terminalProfile(env)) && setting !== 'enhanced') {
    return 'Text sizing: this terminal accepts the sequence but is not known to draw scaled glyphs, so Auto leaves it off; choose Enhanced in Settings to try it.';
  }
  return `Text sizing: scaled headings and counters (${setting === 'enhanced' ? 'enhanced' : 'verified by the terminal'}).`;
}
