import {createHash} from 'node:crypto';
import type {Block} from '../markdown/blocks.js';

/**
 * Mermaid diagrams in Markdown: which fences are diagrams, the bounds a diagram's text must meet before anything is drawn, and the
 * library configuration NMSh imposes. Pure and synchronous: nothing here starts a browser or reads a file.
 */

export const MERMAID_LIMITS = {
  /** Characters of one diagram (also Mermaid's own `maxTextSize`). */
  chars: 20_000,
  lines: 1_000,
  /** Characters of one line (a huge label). */
  lineChars: 2_000,
  /** Subgraphs, sequence blocks, composite states and braces inside one another. */
  nesting: 32,
  /** `%%{init: …}%%` directives in one diagram. */
  directives: 4,
  /** Mermaid's `maxEdges`. */
  edges: 500,
} as const;

/**
 * Configuration keys a diagram's own directives or front matter may not change. Mermaid's `secure` list makes them settable only by
 * NMSh: the security level, the sanitiser's options, HTML labels, custom CSS and the work bounds.
 */
export const LOCKED_KEYS: readonly string[] = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'dompurifyConfig', 'htmlLabels', 'themeCSS', 'fontFamily', 'altFontFamily', 'deterministicIds', 'deterministicIDSeed', 'logLevel', 'arrowMarkerAbsolute'];

export function isMermaidLanguage(language: string | undefined): boolean {
  return language?.toLowerCase() === 'mermaid';
}

const OPENERS = /^(?:subgraph|loop|alt|opt|par|par_over|critical|break|rect|box|namespace)(?:\s|$)/u;
const CLOSER = /^end(?:\s|$|;)/u;

/** The deepest nesting in the text: block keywords (subgraph … end) plus braces outside quoted labels. */
function nestingDepth(lines: readonly string[]): number {
  let blocks = 0, braces = 0, deepest = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('%%')) continue;
    if (CLOSER.test(line)) blocks = Math.max(0, blocks - 1);
    else if (OPENERS.test(line)) blocks += 1;
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (quoted) continue;
      else if (char === '{') { braces += 1; deepest = Math.max(deepest, blocks + braces); }
      else if (char === '}') braces = Math.max(0, braces - 1);
    }
    deepest = Math.max(deepest, blocks + braces);
  }
  return deepest;
}

export type SourceCheck = {ok: true} | {ok: false; reason: string};

/** Whether a diagram's text is within NMSh's bounds. Deterministic work bounds: checked before a browser is involved. */
export function checkMermaidSource(source: string): SourceCheck {
  if (!source.trim()) return {ok: false, reason: 'The diagram is empty.'};
  if (source.length > MERMAID_LIMITS.chars) return {ok: false, reason: `The diagram has ${source.length.toLocaleString('en-US')} characters; NMSh draws at most ${MERMAID_LIMITS.chars.toLocaleString('en-US')}.`};
  const lines = source.split('\n');
  if (lines.length > MERMAID_LIMITS.lines) return {ok: false, reason: `The diagram has ${lines.length.toLocaleString('en-US')} lines; NMSh draws at most ${MERMAID_LIMITS.lines.toLocaleString('en-US')}.`};
  const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);
  if (longest > MERMAID_LIMITS.lineChars) return {ok: false, reason: `One line of the diagram has ${longest.toLocaleString('en-US')} characters; NMSh draws lines of at most ${MERMAID_LIMITS.lineChars.toLocaleString('en-US')}.`};
  const directives = lines.filter(line => line.trimStart().startsWith('%%{')).length;
  if (directives > MERMAID_LIMITS.directives) return {ok: false, reason: `The diagram has ${directives} directives; NMSh allows at most ${MERMAID_LIMITS.directives}.`};
  const depth = nestingDepth(lines);
  if (depth > MERMAID_LIMITS.nesting) return {ok: false, reason: `The diagram is nested ${depth} levels deep; NMSh draws at most ${MERMAID_LIMITS.nesting}.`};
  return {ok: true};
}

/** How diagrams follow NMSh's theme: light or dark (or grey without colour), with the theme's text, accent and line colours. */
export interface DiagramTheme {
  scheme: 'light' | 'dark' | 'mono';
  /** `#rrggbb` */
  text: string;
  accent: string;
  line: string;
}

/** The library configuration for one diagram: NMSh's choices, with the security-relevant keys locked against directives. */
export function mermaidConfig(theme: DiagramTheme): Record<string, unknown> {
  const variables: Record<string, string> = theme.scheme === 'mono'
    ? {}
    : {primaryBorderColor: theme.accent, lineColor: theme.line, ...(theme.scheme === 'dark' ? {primaryTextColor: theme.text, textColor: theme.text} : {})};
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: {htmlLabels: false},
    maxTextSize: MERMAID_LIMITS.chars,
    maxEdges: MERMAID_LIMITS.edges,
    deterministicIds: true,
    suppressErrorRendering: true,
    logLevel: 5,
    fontFamily: '"Helvetica Neue", Arial, sans-serif',
    theme: theme.scheme === 'light' ? 'default' : theme.scheme === 'dark' ? 'dark' : 'neutral',
    themeVariables: {fontFamily: '"Helvetica Neue", Arial, sans-serif', ...variables},
    secure: [...LOCKED_KEYS],
  };
}

/** The identity of a drawing: its exact text and the theme (SHA-256, hex). One library is used for the life of the process. */
export function diagramKey(source: string, theme: DiagramTheme): string {
  return createHash('sha256').update(JSON.stringify([source, theme.scheme, theme.text, theme.accent, theme.line])).digest('hex');
}

/** The diagram text of every Mermaid fence in parsed blocks, in document order (nested quotes, lists and details included). */
export function mermaidSources(blocks: readonly Block[]): string[] {
  const found: string[] = [];
  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      if (block.kind === 'code' && isMermaidLanguage(block.language)) found.push(block.lines.join('\n'));
      else if (block.kind === 'quote' || block.kind === 'details') walk(block.blocks);
      else if (block.kind === 'list') for (const item of block.items) walk(item.blocks);
    }
  };
  walk(blocks);
  return found;
}
