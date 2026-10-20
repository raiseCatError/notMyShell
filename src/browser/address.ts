import {statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/**
 * What the address bar accepts. A typed address is the person's own request, so the rules are strict: only web pages, local
 * files and about:blank open in the browser; every other scheme is refused with a plain reason. NMSh has no search engine and
 * never looks anything up on the person's behalf, so text that looks like a search is refused with a hint.
 */
export type AddressResult = {ok: true; url: string; local?: string} | {ok: false; reason: string};

export interface AddressOptions {
  cwd: string;
  home?: string;
}

const MAX_ADDRESS = 2048;
/** Files that open in the document viewer, not in the browser. */
const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown']);
const LOOPBACK = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/iu;
const SCHEME = /^([a-z][a-z0-9+.-]*):/iu;
/** `host:port` (and `host:port/path`) is an address, not a scheme. */
const HOST_PORT = /^[^\s/:@?#]+:\d{1,5}(?:[/?#]|$)/u;
const BIDI_AND_FORMAT = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu;
const REFUSED_SCHEMES: Readonly<Record<string, string>> = {
  javascript: 'Script addresses are never run.',
  data: 'Data addresses are not opened.',
  blob: 'Blob addresses are not opened.',
  chrome: 'Browser-internal pages are not available.',
  'chrome-untrusted': 'Browser-internal pages are not available.',
  'chrome-extension': 'Extensions are not supported.',
  devtools: 'Developer tools are not available.',
  'view-source': 'View-source is not available.',
  ftp: 'FTP is not supported; use an https address.',
  mailto: 'Mail links are not opened from the browser.',
  tel: 'Phone links are not opened from the browser.',
  ws: 'Only web pages open here.',
  wss: 'Only web pages open here.',
  filesystem: 'Filesystem addresses are not opened.',
};

export function normalizeAddress(input: string, options: AddressOptions): AddressResult {
  const text = input.trim();
  if (!text) return refuse('Type a web address (example.com) or a file path.');
  if (text.length > MAX_ADDRESS) return refuse('That address is too long.');
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(text) || /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text)) return refuse('The address contains control or direction characters.');

  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (scheme && !HOST_PORT.test(text)) return explicit(text, scheme, options);

  if (isPathLike(text)) return filePath(text, options, true);
  // A name that exists beside the shell (notes.html, a path with spaces) is the file, before anything is guessed from its shape.
  const existing = filePath(text, options, false);
  if (existing.ok) return existing;
  if (/\s/u.test(text)) return refuse('NMSh has no search engine. Type a web address (example.com), a localhost address or a file path.');
  return host(text);
}

function refuse(reason: string): AddressResult { return {ok: false, reason}; }

function explicit(text: string, scheme: string, options: AddressOptions): AddressResult {
  if (scheme === 'about') return /^about:blank$/iu.test(text) ? {ok: true, url: 'about:blank'} : refuse('Only about:blank is available.');
  if (scheme === 'http' || scheme === 'https') {
    let url: URL;
    try { url = new URL(text); } catch { return refuse('That is not a valid web address.'); }
    if (!url.hostname) return refuse('That web address has no host.');
    if (url.username || url.password) return refuse('Addresses with a user name or password are not opened. Remove the credentials from the address.');
    return {ok: true, url: url.href};
  }
  if (scheme === 'file') {
    let url: URL;
    try { url = new URL(text); } catch { return refuse('That is not a valid file address.'); }
    if (url.hostname && url.hostname !== 'localhost') return refuse('Only files on this computer open.');
    let file: string;
    try { file = fileURLToPath(url); } catch { return refuse('That is not a valid file address.'); }
    return filePath(file, options, true);
  }
  return refuse(REFUSED_SCHEMES[scheme] ?? `${scheme}: addresses are not opened. Only web pages (http, https) and local files open here.`);
}

function isPathLike(text: string): boolean {
  return text.startsWith('/') || text.startsWith('./') || text.startsWith('../') || text === '.' || text === '..' || text === '~' || text.startsWith('~/');
}

function filePath(text: string, options: AddressOptions, explain: boolean): AddressResult {
  let target = text;
  if (target === '~' || target.startsWith('~/')) {
    if (!options.home) return refuse('The home folder is not known.');
    target = path.join(options.home, target.slice(1));
  }
  const resolved = path.resolve(options.cwd, target);
  let stat;
  try { stat = statSync(resolved); } catch { return refuse(explain ? 'No such file.' : 'not a file'); }
  if (!stat.isFile()) return refuse(explain ? 'That is not a regular file.' : 'not a file');
  const url = pathToFileURL(resolved).href;
  return DOCUMENT_EXTENSIONS.has(path.extname(resolved).toLowerCase()) ? {ok: true, url, local: resolved} : {ok: true, url};
}

function host(text: string): AddressResult {
  const authority = text.split(/[/?#]/u, 1)[0]!;
  if (authority.includes('@')) return refuse('Addresses with a user name or password are not opened. Remove the credentials from the address.');
  let url: URL;
  try { url = new URL(`https://${text}`); } catch { return refuse('That is not a valid web address.'); }
  const name = url.hostname;
  const bare = name.replace(/^\[|\]$/gu, '');
  const known = LOOPBACK.test(name) || bare.includes(':') || name.includes('.');
  if (!name || !known) return refuse('That is not a web address. Add a domain (example.com) or use localhost:port.');
  if (LOOPBACK.test(name)) url.protocol = 'http:';
  return {ok: true, url: url.href};
}

/** A URL as it is shown: control, direction and format characters removed, a password hidden. Never the page's own text. */
export function displayUrl(url: string): string {
  let shown = url;
  try {
    const parsed = new URL(url);
    if (parsed.password) { parsed.password = '***'; shown = parsed.href; }
  } catch { /* shown as given */ }
  return shown.replace(BIDI_AND_FORMAT, '');
}

/** Text from a page (a title, a dialog message) made safe to draw: control and direction characters removed, bounded. */
export function plainText(text: string, max = 200): string {
  const clean = text.replace(BIDI_AND_FORMAT, ' ').replace(/\s+/gu, ' ').trim();
  return [...clean].length > max ? `${[...clean].slice(0, max - 1).join('')}…` : clean;
}

/** True when a URL carries a user name or password (flagged where it is shown). */
export function hasCredentials(url: string): boolean {
  try { const parsed = new URL(url); return Boolean(parsed.username || parsed.password); } catch { return false; }
}

export type AddressKind = 'https' | 'http' | 'file' | 'blank' | 'other';

/** How trustworthy the shown address is, from the real URL. */
export function addressKind(url: string): AddressKind {
  if (url === 'about:blank' || url === '') return 'blank';
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'https:') return 'https';
    if (protocol === 'http:') return 'http';
    if (protocol === 'file:') return 'file';
  } catch { /* other */ }
  return 'other';
}

/** A popup or link target a page asks for: only plain web addresses and about:blank, never credentials. */
export function popupAddress(url: string): string | undefined {
  if (url === 'about:blank') return url;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch { return undefined; }
}
