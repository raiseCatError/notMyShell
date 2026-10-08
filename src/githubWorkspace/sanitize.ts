import {stripTerminalControls} from '../util/terminalControls.js';

/**
 * GitHub titles, bodies, comments, branch names and patches are untrusted
 * remote data. Everything passes through here before it reaches the model,
 * so renderers only ever see bounded, control-free text.
 */

/** One line of display text: controls removed, whitespace collapsed, bounded. */
export function sanitizeLine(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return stripTerminalControls(value.replace(/[\t\r\n]+/gu, ' '), maxLength * 4).replace(/ {2,}/gu, ' ').trim().slice(0, maxLength);
}

/** Optional single-line field: `undefined` stays unknown rather than becoming ''. */
export function optionalLine(value: unknown, maxLength: number): string | undefined {
  const line = sanitizeLine(value, maxLength);
  return line ? line : undefined;
}

/**
 * Multi-line text (bodies, comments). Line breaks survive; tabs expand to two
 * spaces; every other control and escape sequence is removed per line.
 */
export function sanitizeBlock(value: unknown, maxLength: number): {text: string; truncated: boolean} {
  if (typeof value !== 'string') return {text: '', truncated: false};
  const truncated = value.length > maxLength;
  const text = value.slice(0, maxLength).split(/\r\n|\r|\n/u)
    .map(line => stripTerminalControls(line.replace(/\t/gu, '  '), maxLength).trimEnd())
    .join('\n').replace(/\n{3,}/gu, '\n\n').trim();
  return {text, truncated};
}

/** A single patch line keeps its leading marker and indentation. */
export function sanitizePatchLine(value: string, maxLength: number): {text: string; truncated: boolean} {
  const truncated = value.length > maxLength;
  return {text: stripTerminalControls(value.slice(0, maxLength).replace(/\t/gu, '    '), maxLength), truncated};
}

export function boundedInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** GitHub owner/repo names: a strict allowlist, so no name can carry flags, paths or controls. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;

export function parseRepository(value: string): {owner: string; repo: string} | undefined {
  const match = /^([^/\s]+)\/([^/\s]+)$/u.exec(value.trim());
  if (!match) return undefined;
  const [, owner, repo] = match;
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return undefined;
  return {owner, repo};
}

/** Only https github.com URLs are kept as external-open intents. */
export function safeGithubUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) return undefined;
    return url.toString();
  } catch { return undefined; }
}
