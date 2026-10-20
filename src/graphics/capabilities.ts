import type {TerminalCapabilities} from '../host/capabilities.js';
import {terminalProfile} from '../host/capabilities.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import type {GraphicsMode} from '../prompt/configuration.js';

/**
 * Which way NMSh draws a real image right now, and why. One function decides it for every surface (`/view`, Markdown,
 * HTML, the browser, the About logo), so they never disagree.
 *
 * Evidence, strongest first:
 *   - a reply to the terminal's own query (Kitty graphics `a=q`, DA1 attribute 4 for Sixel): *verified*;
 *   - a known-host record where the protocol has no query (iTerm2 inline images): *host record*, labelled as such;
 *   - an explicit person's choice in Settings: *forced*, labelled "not confirmed" unless a query also confirmed it.
 * A terminal's name alone never turns a protocol on, except for the sub-feature of Unicode placeholders (below), which only
 * ever refines a protocol that was already verified. Multiplexers hide the real terminal, so they always get character art.
 * Everything else, and every uncertainty, is Unicode character art.
 */
export type GraphicsBackend = 'kitty' | 'iterm2' | 'sixel' | 'unicode' | 'off';
export type GraphicsEvidence = 'query' | 'host' | 'forced' | 'none';
export type UnicodeStyle = 'quadrant' | 'half' | 'ascii';

export interface GraphicsEnvironment {
  capabilities: Readonly<TerminalCapabilities>;
  env: NodeJS.ProcessEnv;
  mode: GraphicsMode;
  color: ColorLevel;
  safeGlyphs: boolean;
  /** The terminal's size in cells, to turn a reported text-area size into a cell size. */
  columns?: number;
  rows?: number;
}

export interface GraphicsDecision {
  /** The protocol used for a standalone image surface (the viewer). */
  backend: GraphicsBackend;
  evidence: GraphicsEvidence;
  /**
   * What an image placed in the flow of a document uses: Kitty Unicode placeholders (the image behaves like text, so it
   * scrolls, clips and repaints with the rows), character art, or nothing (placeholders only).
   */
  inline: 'placeholder' | 'unicode' | 'none';
  unicode: UnicodeStyle;
  cell: {width: number; height: number; source: 'terminal' | 'window' | 'estimated'};
  /** One sentence for `/doctor` and for explaining a fallback. */
  reason: string;
}

/** A cell is about twice as tall as wide when the terminal does not say. */
export const ESTIMATED_CELL = {width: 8, height: 16};

/** Hosts that implement Kitty's Unicode placeholders (kitty 0.28+, Ghostty). Used only after Kitty graphics was verified. */
const PLACEHOLDER_HOSTS: ReadonlySet<string> = new Set(['kitty', 'ghostty']);

export function isMultiplexed(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TMUX || env.STY || env.ZELLIJ) || /^(?:tmux|screen)/u.test(env.TERM ?? '');
}

export function decideGraphics(input: GraphicsEnvironment): GraphicsDecision {
  const {capabilities, env, mode, color, safeGlyphs} = input;
  const unicode: UnicodeStyle = color === 'none' || safeGlyphs ? 'ascii' : color === 'ansi16' ? 'half' : 'quadrant';
  const cell = cellSize(input);
  const base = {unicode, cell};
  if (mode === 'off') return {...base, backend: 'off', evidence: 'none', inline: 'none', reason: 'Images are off in Settings; a placeholder names each image.'};
  if (env.NMSH_IMAGES === '0') return {...base, backend: 'unicode', evidence: 'none', inline: 'unicode', reason: 'NMSH_IMAGES=0 turns native protocols off; images are drawn as character art.'};
  if (env.TERM === 'dumb') return {...base, backend: 'unicode', evidence: 'none', inline: 'unicode', unicode: 'ascii', reason: 'TERM=dumb: images are drawn as plain character art.'};
  const character = (reason: string): GraphicsDecision => ({...base, backend: 'unicode', evidence: 'none', inline: 'unicode', reason});
  if (mode === 'unicode') return character('Images are set to character art in Settings.');
  if (isMultiplexed(env)) {
    return character(mode === 'auto'
      ? 'tmux, screen and Zellij hide the real terminal, so images are drawn as character art (graphics need passthrough, which NMSh does not use).'
      : `${modeName(mode)} was chosen, but a terminal multiplexer is in between and needs passthrough, which NMSh does not use; images are drawn as character art.`);
  }
  const profile = terminalProfile(env);
  const verifiedKitty = capabilities.graphicsProtocol === 'kitty';
  const colorNeeded = color === 'none';
  // Kitty placeholders carry the image's identity in a text color, so they need color; without it character art is used.
  const kittyInline = (): GraphicsDecision['inline'] => (!colorNeeded && PLACEHOLDER_HOSTS.has(profile) ? 'placeholder' : 'unicode');
  if (mode === 'kitty') {
    return {...base, backend: 'kitty', evidence: verifiedKitty ? 'query' : 'forced', inline: kittyInline(),
      reason: verifiedKitty ? 'Kitty graphics, confirmed by this terminal.' : 'Kitty graphics, chosen in Settings. This terminal did not confirm it; if images look wrong set Images to Auto.'};
  }
  if (mode === 'iterm2') {
    const known = capabilities.graphicsProtocol === 'iterm2';
    return {...base, backend: 'iterm2', evidence: known ? 'host' : 'forced', inline: 'unicode',
      reason: known ? 'iTerm2 inline images (known host; the protocol has no query).' : 'iTerm2 inline images, chosen in Settings. This terminal is not known to support them; if images look wrong set Images to Auto.'};
  }
  if (mode === 'sixel') {
    return {...base, backend: 'sixel', evidence: capabilities.sixel ? 'query' : 'forced', inline: 'unicode',
      reason: capabilities.sixel ? 'Sixel, confirmed by this terminal.' : 'Sixel, chosen in Settings. This terminal did not report Sixel support; if images look wrong set Images to Auto.'};
  }
  // Auto.
  if (verifiedKitty) {
    return {...base, backend: 'kitty', evidence: 'query', inline: kittyInline(),
      reason: `Kitty graphics, confirmed by this terminal${kittyInline() === 'placeholder' ? '; images in documents use Unicode placeholders' : '; images in documents are character art'}.`};
  }
  if (capabilities.graphicsProtocol === 'iterm2') {
    return {...base, backend: 'iterm2', evidence: 'host', inline: 'unicode', reason: 'iTerm2 inline images (known host; the protocol has no query). Images in documents are character art.'};
  }
  if (capabilities.sixel) {
    return {...base, backend: 'sixel', evidence: 'query', inline: 'unicode', reason: 'Sixel, confirmed by this terminal. Images in documents are character art.'};
  }
  return character(profile === 'zed'
    ? 'Zed has no image protocol NMSh can verify; images are drawn as character art (lower resolution than Ghostty or Kitty).'
    : 'This terminal did not confirm a graphics protocol; images are drawn as character art.');
}

function modeName(mode: GraphicsMode): string {
  return mode === 'kitty' ? 'Kitty graphics' : mode === 'iterm2' ? 'iTerm2 inline images' : mode === 'sixel' ? 'Sixel' : mode;
}

function cellSize(input: GraphicsEnvironment): GraphicsDecision['cell'] {
  const {capabilities, columns, rows} = input;
  if (capabilities.cellPixels) return {...capabilities.cellPixels, source: 'terminal'};
  if (capabilities.windowPixels && columns && rows && columns > 0 && rows > 0) {
    const width = Math.round(capabilities.windowPixels.width / columns);
    const height = Math.round(capabilities.windowPixels.height / rows);
    if (width >= 4 && width <= 64 && height >= 8 && height <= 128) return {width, height, source: 'window'};
  }
  return {...ESTIMATED_CELL, source: 'estimated'};
}

/** The lines `/doctor` shows. */
export function describeGraphics(decision: GraphicsDecision): string[] {
  const label: Record<GraphicsBackend, string> = {kitty: 'Kitty graphics', iterm2: 'iTerm2 inline images', sixel: 'Sixel', unicode: 'Unicode character art', off: 'Off'};
  return [
    `Images: ${label[decision.backend]}${decision.evidence === 'query' ? ' (verified)' : decision.evidence === 'host' ? ' (known host)' : decision.evidence === 'forced' ? ' (chosen, not confirmed)' : ''}`,
    `In documents: ${decision.inline === 'placeholder' ? 'Kitty Unicode placeholders' : decision.inline === 'unicode' ? 'character art' : 'placeholder text'}`,
    `Character art: ${decision.unicode === 'quadrant' ? 'quadrant blocks' : decision.unicode === 'half' ? 'half blocks' : 'ASCII'}; cell ${decision.cell.width} × ${decision.cell.height} px (${decision.cell.source})`,
    decision.reason,
  ];
}
