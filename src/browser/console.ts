/**
 * The runtime Console of a document's browser preview (#466): what the page itself reported while it loaded and ran — script
 * exceptions, console errors and warnings, failed loads and HTTP errors, Content Security Policy refusals and NMSh's own refusals.
 *
 * It is a read-only record. Nothing here evaluates code, changes the page's script or network rules, or asks the browser for
 * anything: the engine turns DevTools events it already receives into `ConsoleEntry` values with `consoleEntry()`, which redacts
 * them on the way in, so a secret in a URL or message never reaches memory, the screen or the clipboard. `ConsoleLog` keeps the
 * entries of the current document load, bounded by count, bytes and message size, in memory only.
 */

export type ConsoleSeverity = 'error' | 'warning' | 'info';
/** Where an entry came from: a thrown exception, a console call, the network layer, a CSP refusal, NMSh's policy, the page itself. */
export type ConsoleOrigin = 'exception' | 'console' | 'network' | 'security' | 'policy' | 'page';

export interface ConsoleLocation {
  /** `document`: the previewed document itself; `local`: a file beside it; `external`: anything else (shown redacted). */
  target: 'document' | 'local' | 'external';
  /** What to show: the document's name, a path relative to its folder, or a redacted address. */
  label: string;
  /** 0-based line and UTF-16 column, as Chrome reports them; absent when Chrome gave none. */
  line?: number;
  column?: number;
}

export interface ConsoleEntry {
  severity: ConsoleSeverity;
  origin: ConsoleOrigin;
  /** Redacted, control characters removed, at most MAX_MESSAGE characters. */
  message: string;
  location?: ConsoleLocation;
  /** Up to MAX_FRAMES call frames, each `function (location)`, redacted. */
  stack?: string[];
}

export const MAX_MESSAGE = 2000;
export const MAX_ENTRIES = 200;
export const MAX_BYTES = 256 * 1024;
const MAX_FRAMES = 8;
/** Raw text is cut before any pattern runs, so a hostile megabyte message costs the same as a short one. */
const MAX_RAW = 8000;

// ---- redaction -------------------------------------------------------------------------------------------------------

const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/gu;
export const REDACTED = '‹redacted›';

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string | ((match: string, ...groups: string[]) => string)]> = [
  // Authorization schemes followed by their credential.
  [/\b(Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=-]{6,}/giu, (_m, scheme) => `${scheme} ${REDACTED}`],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{0,}/gu, REDACTED],
  // Well-known token formats (GitHub, Slack, AWS, Google, OpenAI-style and Anthropic-style keys, Stripe).
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{16,}|[rs]k_(?:live|test)_[A-Za-z0-9]{16,})\b/gu, REDACTED],
  // key=value / key: value / "key": "value" for names that usually carry a secret.
  [/((?:["']?)\b[A-Za-z0-9_-]{0,24}(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth|authorization|session(?:id)?|cookie|signature|sig|credential)s?["']?\s{0,3}[:=]\s{0,3})("[^"\n]{0,512}"|'[^'\n]{0,512}'|[^\s,;&"'}\])]{1,512})/giu,
    (_m, key) => `${key}${REDACTED}`],
];

/** A URL anywhere in a message (absolute addresses only; bounded so a hostile line cannot make it slow). */
const URL_IN_TEXT = /\b(?:https?|wss?|ftp|file|blob|data):[^\s"'<>()[\]{}`]{1,2048}/giu;

export interface RedactContext {
  /** The address of the previewed document (`http://127.0.0.1:<port>/<token>/`): its token never leaves this module. */
  documentUrl?: string;
  /** The document's own name, shown in place of its address. */
  documentName?: string;
  /** The person's home folder, shown as `~`. */
  home?: string;
}

/** The preview's base (`http://127.0.0.1:<port>/<token>/`) for a document address, or undefined when it is not one. */
function previewBase(documentUrl: string | undefined): URL | undefined {
  if (!documentUrl) return undefined;
  try {
    const url = new URL(documentUrl);
    if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) return undefined;
    const token = url.pathname.split('/')[1];
    if (!token) return undefined;
    return new URL(`${url.origin}/${token}/`);
  } catch { return undefined; }
}

export type ClassifiedUrl = {target: 'document' | 'local' | 'external'; label: string};

/**
 * What an address may be shown as. The preview's own address becomes the document's name and a file beside it a relative path,
 * so the preview's unguessable token is never shown or copied; any other address keeps its scheme, host and path, with
 * credentials removed, query values and the fragment replaced, and `data:` reduced to its type.
 */
export function classifyUrl(raw: string, context: RedactContext = {}): ClassifiedUrl {
  const text = raw.slice(0, MAX_RAW).replace(CONTROLS, '');
  const base = previewBase(context.documentUrl);
  let url: URL;
  try { url = new URL(text); } catch { return {target: 'external', label: redactText(text, {}, false).slice(0, 300)}; }
  if (base && url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
    const relative = url.pathname.slice(base.pathname.length);
    if (relative === '' || relative === 'index.html') return {target: 'document', label: context.documentName ?? 'this document'};
    let decoded = relative;
    try { decoded = decodeURIComponent(relative); } catch { /* keep it encoded */ }
    return {target: 'local', label: decoded.replace(CONTROLS, '').slice(0, 300)};
  }
  if (base && url.origin === base.origin) return {target: 'external', label: `${url.origin}/${REDACTED}`};
  if (url.protocol === 'data:') return {target: 'external', label: `data:${/^[\w.+-]+\/[\w.+-]+/u.exec(url.pathname)?.[0] ?? ''},…`};
  if (url.protocol === 'blob:') return {target: 'external', label: 'blob:…'};
  if (url.protocol === 'file:') {
    const path = decodeSafe(url.pathname);
    return {target: 'external', label: `file://${context.home && path.startsWith(`${context.home}/`) ? `~${path.slice(context.home.length)}` : path}`.slice(0, 300)};
  }
  url.username = '';
  url.password = '';
  const keys = [...new Set([...url.searchParams.keys()])].slice(0, 12);
  const query = keys.length ? `?${keys.map(key => `${encodeURIComponent(key)}=…`).join('&')}` : '';
  const shown = `${url.protocol}//${url.host}${url.pathname}${query}${url.hash ? '#…' : ''}`;
  return {target: 'external', label: redactText(shown, {}, false).slice(0, 300)};
}

function decodeSafe(text: string): string {
  try { return decodeURIComponent(text); } catch { return text; }
}

/** Remove controls, rewrite every address (see `classifyUrl`) and replace likely secrets. */
export function redactText(raw: string, context: RedactContext = {}, urls = true): string {
  let text = raw.slice(0, MAX_RAW).replace(CONTROLS, '').replace(/\r\n?/gu, '\n');
  if (urls) text = text.replace(URL_IN_TEXT, match => classifyUrl(match, context).label);
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement as string);
  if (context.home && context.home.length > 1) text = text.split(context.home).join('~');
  // Whatever token the preview address carried is gone even if it appeared outside a URL.
  const token = previewBase(context.documentUrl)?.pathname.split('/')[1];
  if (token && token.length >= 8) text = text.split(token).join(REDACTED);
  return text;
}

// ---- turning DevTools events into entries ----------------------------------------------------------------------------

/** The DevTools `Runtime.RemoteObject` fields a console message is made from (never fetched further: nothing is evaluated). */
interface RemoteObject {type?: string; subtype?: string; value?: unknown; unserializableValue?: string; description?: string; className?: string}
interface CallFrame {functionName?: string; url?: string; lineNumber?: number; columnNumber?: number}

function remoteText(arg: RemoteObject): string {
  if (arg.type === 'string') return String(arg.value ?? '');
  if (arg.unserializableValue !== undefined) return String(arg.unserializableValue);
  if (arg.type === 'undefined') return 'undefined';
  if (arg.subtype === 'null') return 'null';
  if (arg.value !== undefined && (arg.type === 'number' || arg.type === 'boolean')) return String(arg.value);
  return String(arg.description ?? arg.className ?? arg.type ?? '');
}

/** console.log's own formatting: %s %d %i %f %o %O consume an argument, %c (a style) consumes one and prints nothing. */
function formatArgs(args: readonly RemoteObject[]): string {
  const list = args.slice(0, 32);
  if (list.length === 0) return '';
  let rest = list.slice(1);
  let head = remoteText(list[0]!);
  if (list[0]!.type === 'string' && /%[sdifoOc%]/u.test(head)) {
    head = head.slice(0, MAX_RAW).replace(/%([sdifoOc%])/gu, (_match, code: string) => {
      if (code === '%') return '%';
      const next = rest[0];
      if (!next) return `%${code}`;
      rest = rest.slice(1);
      if (code === 'c') return '';
      const value = remoteText(next);
      if (code === 'd' || code === 'i') return String(Number.parseInt(value, 10));
      if (code === 'f') return String(Number.parseFloat(value));
      return value;
    });
  }
  return [head, ...rest.map(remoteText)].join(' ');
}

function frameText(frame: CallFrame, context: RedactContext): string {
  const where = frame.url ? classifyUrl(frame.url, context).label : '(anonymous)';
  const position = frame.lineNumber !== undefined ? `:${frame.lineNumber + 1}:${(frame.columnNumber ?? 0) + 1}` : '';
  return `${(frame.functionName || '(anonymous)').replace(CONTROLS, '').slice(0, 80)} (${where}${position})`;
}

function location(url: string | undefined, line: number | undefined, column: number | undefined, context: RedactContext): ConsoleLocation | undefined {
  if (!url) return undefined;
  const target = classifyUrl(url, context);
  const valid = (value: number | undefined) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 10_000_000;
  return {...target, ...(valid(line) ? {line} : {}), ...(valid(line) && valid(column) ? {column} : {})};
}

function finish(entry: ConsoleEntry): ConsoleEntry {
  const message = entry.message.length > MAX_MESSAGE ? `${entry.message.slice(0, MAX_MESSAGE - 1)}…` : entry.message;
  return {...entry, message: message || '(empty message)'};
}

const SEVERITY_OF_CONSOLE: Readonly<Record<string, ConsoleSeverity>> = {error: 'error', assert: 'error', warning: 'warning'};

/** A DevTools event the Console keeps, as an entry; undefined for events it does not show. Never throws on malformed input. */
export function consoleEntry(method: string, params: any, context: RedactContext = {}): ConsoleEntry | undefined {
  try {
    if (method === 'Runtime.exceptionThrown') {
      const details = params?.exceptionDetails ?? {};
      const description = typeof details.exception?.description === 'string' ? details.exception.description : '';
      const head = description.split('\n')[0] || String(details.exception?.value ?? '');
      const message = [String(details.text ?? 'Uncaught'), head].filter(Boolean).join(' ').replace(/^Uncaught Uncaught/u, 'Uncaught');
      const frames: CallFrame[] = Array.isArray(details.stackTrace?.callFrames) ? details.stackTrace.callFrames : [];
      const top = frames[0];
      return finish({
        severity: 'error', origin: 'exception', message: redactText(message, context),
        ...(location(details.url ?? top?.url, details.lineNumber ?? top?.lineNumber, details.columnNumber ?? top?.columnNumber, context) ? {location: location(details.url ?? top?.url, details.lineNumber ?? top?.lineNumber, details.columnNumber ?? top?.columnNumber, context)!} : {}),
        ...(frames.length ? {stack: frames.slice(0, MAX_FRAMES).map(frame => redactText(frameText(frame, context), context))} : {}),
      });
    }
    if (method === 'Runtime.consoleAPICalled') {
      const type = String(params?.type ?? 'log');
      if (type === 'clear' || type === 'startGroup' || type === 'startGroupCollapsed' || type === 'endGroup' || type === 'profile' || type === 'profileEnd') return undefined;
      const frames: CallFrame[] = Array.isArray(params?.stackTrace?.callFrames) ? params.stackTrace.callFrames : [];
      const top = frames[0];
      const where = top ? location(top.url, top.lineNumber, top.columnNumber, context) : undefined;
      return finish({
        severity: SEVERITY_OF_CONSOLE[type] ?? 'info', origin: 'console',
        message: redactText(`${type === 'assert' ? 'Assertion failed: ' : ''}${formatArgs(Array.isArray(params?.args) ? params.args : [])}`, context),
        ...(where ? {location: where} : {}),
        ...(type === 'error' || type === 'assert' || type === 'trace' ? (frames.length > 1 ? {stack: frames.slice(0, MAX_FRAMES).map(frame => redactText(frameText(frame, context), context))} : {}) : {}),
      });
    }
    if (method === 'Log.entryAdded') {
      const entry = params?.entry ?? {};
      const level = String(entry.level ?? 'info');
      if (level === 'verbose' || entry.source === 'violation') return undefined;
      const text = String(entry.text ?? '');
      // NMSh's own refusal of a request is recorded as a policy entry, which says why; Chrome's echo of it would repeat it.
      if (entry.source === 'network' && /ERR_BLOCKED_BY_CLIENT/u.test(text)) return undefined;
      const origin: ConsoleOrigin = entry.source === 'network' ? 'network' : entry.source === 'security' ? 'security' : entry.source === 'javascript' ? 'exception' : 'page';
      const where = location(entry.url, entry.lineNumber, undefined, context);
      return finish({severity: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info', origin, message: redactText(text, context), ...(where ? {location: where} : {})});
    }
  } catch { /* a malformed event is not shown */ }
  return undefined;
}

/** NMSh's own refusal of a request or navigation (a preview loads nothing from outside its folder). */
export function policyEntry(url: string, reason: string, context: RedactContext = {}): ConsoleEntry {
  const where = classifyUrl(url, context);
  return finish({severity: 'warning', origin: 'policy', message: redactText(`Refused by NMSh: ${reason}`, context), location: where});
}

// ---- the record ------------------------------------------------------------------------------------------------------

export interface ConsoleRecord extends ConsoleEntry {
  /** Increases with every entry kept: the order things happened in. */
  id: number;
  /** Consecutive identical entries are one record with a count. */
  count: number;
}

function sizeOf(entry: ConsoleEntry): number {
  return (entry.message.length + (entry.location?.label.length ?? 0) + (entry.stack?.reduce((sum, frame) => sum + frame.length, 0) ?? 0)) * 2 + 64;
}

function same(a: ConsoleEntry, b: ConsoleEntry): boolean {
  return a.severity === b.severity && a.origin === b.origin && a.message === b.message && a.location?.label === b.location?.label
    && a.location?.line === b.location?.line && a.location?.column === b.location?.column;
}

/**
 * The entries of the current document load, newest last. Bounded: at most MAX_ENTRIES records and MAX_BYTES of text; the oldest
 * go first and are counted in `dropped`. `reset()` starts a new load (the page navigated, reloaded or was opened again).
 */
export class ConsoleLog {
  private records: ConsoleRecord[] = [];
  private bytes = 0;
  private next = 1;
  dropped = 0;
  /** Bumped by every change, so a view knows when to re-read. */
  version = 0;
  private listeners = new Set<() => void>();

  entries(): readonly ConsoleRecord[] { return this.records; }
  get size(): number { return this.records.length; }

  add(entry: ConsoleEntry): void {
    const last = this.records.at(-1);
    if (last && same(last, entry)) { last.count = Math.min(last.count + 1, 999_999); this.changed(); return; }
    const record: ConsoleRecord = {...entry, id: this.next++, count: 1};
    this.records.push(record);
    this.bytes += sizeOf(record);
    while (this.records.length > MAX_ENTRIES || (this.bytes > MAX_BYTES && this.records.length > 1)) {
      const old = this.records.shift()!;
      this.bytes -= sizeOf(old);
      this.dropped += old.count;
    }
    this.changed();
  }

  /** The person cleared the Console: the entries go, and so does the count of dropped ones. */
  clear(): void {
    this.records = [];
    this.bytes = 0;
    this.dropped = 0;
    this.changed();
  }

  /** A new document load: what the previous one reported no longer applies. */
  reset(): void { this.clear(); }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.records = [];
    this.bytes = 0;
    this.listeners.clear();
  }

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* a listener's failure is its own */ } }
  }
}

// ---- going to the source -------------------------------------------------------------------------------------------

export interface SourceContext {
  /** How the page was made: an HTML document is served exactly as written; Markdown is converted, so its lines are not the file's. */
  kind: 'html' | 'markdown';
  /** The text the loaded page was built from, and the buffer's text now. */
  servedText: string | undefined;
  currentText: string;
  lines: readonly string[];
}

/**
 * Where Enter on an entry goes: a position in the document's own text, only when that is certain (an HTML document, unchanged
 * since the page loaded, a line Chrome named that exists); otherwise the reason it is not offered.
 */
export function sourcePosition(entry: ConsoleEntry, context: SourceContext): {line: number; column: number} | {reason: string} {
  const where = entry.location;
  if (!where) return {reason: 'no source location was reported'};
  if (where.target === 'external') return {reason: 'it comes from outside the document'};
  if (where.target === 'local') return {reason: `it is in ${where.label}, not this document`};
  if (context.kind !== 'html') return {reason: 'the page is generated from Markdown, so its lines are not the file\'s'};
  if (where.line === undefined) return {reason: 'no line was reported'};
  if (context.servedText === undefined || context.servedText !== context.currentText) return {reason: 'the text changed since the page loaded (r in the preview refreshes it)'};
  if (where.line >= context.lines.length) return {reason: 'the line is past the end of the document'};
  const length = context.lines[where.line]!.length;
  return {line: where.line, column: Math.min(where.column ?? 0, length)};
}

/** Plain text for the clipboard: one entry per line block, already redacted; no colours, no terminal controls. */
export function consoleCopyText(records: readonly ConsoleRecord[], documentName: string): string {
  const out = [`Console of ${documentName.replace(CONTROLS, '')} (NMSh browser preview, redacted)`];
  for (const record of records) {
    const where = record.location ? ` ${record.location.label}${record.location.line !== undefined ? `:${record.location.line + 1}${record.location.column !== undefined ? `:${record.location.column + 1}` : ''}` : ''}` : '';
    out.push(`[${record.severity}] ${record.origin}${where}${record.count > 1 ? ` (×${record.count})` : ''}: ${record.message}`);
    for (const frame of record.stack ?? []) out.push(`    at ${frame}`);
  }
  return out.join('\n');
}
