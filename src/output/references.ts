import {findSourceReferences} from '../host/HostActions.js';
import {stripAnsi} from '../util/text.js';

/**
 * References in one command's stored output that can be acted on from its block menu: source locations, web links,
 * Git commit ids (only in Git's own output) and Android serials (only in `adb devices`). Recognition is conservative,
 * local and non-executing; it runs only when the person asks for a block's references, never while output arrives.
 *
 * Deterministic: file locations (`path:line[:column]`, the same finder `/open` uses), http(s) links without
 * credentials. Heuristic, so limited to the command that prints them: commit ids and device serials.
 */
export type ReferenceKind = 'file' | 'url' | 'commit' | 'device';

export interface OutputReference {
  /** Stable for this output: kind and value, so an action resolves the same reference again when it runs. */
  id: string;
  kind: ReferenceKind;
  /** The path as printed (files), the link, the commit id or the serial. */
  value: string;
  /** What the menu shows: the reference as it was printed. */
  label: string;
  line?: number;
  column?: number;
  /** Devices: the adb state printed next to the serial; only `device` can take a follow-up command. */
  state?: string;
}

/** Output lines read, counted from the end, and references kept: a bound for any output size. */
export const MAX_REFERENCE_LINES = 20_000;
export const MAX_REFERENCES = 50;
const MAX_VALUE_LENGTH = 2000;

/** Nothing a terminal or a reader could misread: no control, format (zero-width, bidi) or line/paragraph separator characters. */
const clean = (text: string) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text);

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\u007f-\u009f]+/giu;
const PAIRS: Record<string, string> = {')': '(', ']': '[', '}': '{'};

function linkReference(raw: string): OutputReference | undefined {
  let text = raw;
  // Sentence punctuation after a link is not part of it; a closing bracket is only when the link opened one.
  for (;;) {
    const last = text.at(-1) ?? '';
    const opener = PAIRS[last];
    const count = (char: string) => text.split(char).length - 1;
    if (/[.,;:!?'">]/u.test(last) || (opener && count(opener) < count(last))) text = text.slice(0, -1);
    else break;
  }
  if (!text || text.length > MAX_VALUE_LENGTH || !clean(text)) return undefined;
  let url: URL;
  try { url = new URL(text); } catch { return undefined; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  // Credentials in a link are a secret, not a destination.
  if (url.username || url.password || !url.hostname) return undefined;
  // The normalised form shows an international name as punycode, so a look-alike host cannot pass as a familiar one.
  return {id: `url:${url.href}`, kind: 'url', value: url.href, label: url.href};
}

const GIT_COMMAND = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:command\s+|noglob\s+)?git(?:\s|$)/u;
const ADB_DEVICES = /^\s*adb(?:\s+-\S+(?:\s+\S+)?)*\s+devices(?:\s+-l)?\s*$/u;
const COMMIT_ID = /^[0-9a-f]{7,40}$/u;
const isCommitId = (token: string) => COMMIT_ID.test(token) && /\d/u.test(token) && /[a-f]/u.test(token);
const COMMIT_CONTEXTS = [
  /^[\s*|\\/_]*commit\s+([0-9a-f]{7,40})\b/u,
  /^[\s*|\\/_]*([0-9a-f]{7,40})(?:\s|$)/u,
  /^\[[^\]\n]*\s([0-9a-f]{7,40})\]/u,
  /^(?:HEAD is now at|Merge:)\s+([0-9a-f]{7,40})\b/u,
];

const SERIAL = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/u;
const DEVICE_LINE = /^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions|authorizing|connecting|host)\b/u;

export interface ReferenceSource {
  command: string;
  output: string;
}

/** The references in this command's output, in the order they were printed, without duplicates. */
export function findOutputReferences(record: ReferenceSource): OutputReference[] {
  const found: OutputReference[] = [];
  const seen = new Set<string>();
  const add = (reference: OutputReference) => {
    if (found.length >= MAX_REFERENCES || seen.has(reference.id)) return;
    seen.add(reference.id);
    found.push(reference);
  };
  const isGit = GIT_COMMAND.test(record.command);
  const isDevices = ADB_DEVICES.test(record.command);
  const lines = stripAnsi(record.output).split(/\r\n?|\n/u);
  for (const line of lines.slice(-MAX_REFERENCE_LINES)) {
    if (found.length >= MAX_REFERENCES) break;
    if (line.length > 4000) continue;
    for (const match of line.matchAll(URL_PATTERN)) {
      const reference = linkReference(match[0]);
      if (reference) add(reference);
    }
    for (const source of findSourceReferences(line)) {
      // Dotted numbers (versions, IP addresses with a port) look like "name.ext:line" but are not files.
      if (/^\d+(?:\.\d+)+$/u.test(source.path) || !clean(source.path) || source.path.length > MAX_VALUE_LENGTH || !source.line || source.line < 1) continue;
      add({id: `file:${source.path}:${source.line}:${source.column ?? ''}`, kind: 'file', value: source.path, label: `${source.path}:${source.line}${source.column ? `:${source.column}` : ''}`,
        line: source.line, ...(source.column ? {column: source.column} : {})});
    }
    if (isGit) {
      for (const pattern of COMMIT_CONTEXTS) {
        const id = pattern.exec(line)?.[1];
        if (id && isCommitId(id)) { add({id: `commit:${id}`, kind: 'commit', value: id, label: id}); break; }
      }
    }
    if (isDevices) {
      const device = DEVICE_LINE.exec(line);
      if (device && SERIAL.test(device[1]!) && clean(device[1]!)) add({id: `device:${device[1]}`, kind: 'device', value: device[1]!, label: `${device[1]} (${device[2]})`, state: device[2]!});
    }
  }
  return found;
}

/**
 * A command to put in the composer for review (never run): inspect a commit, or open a shell on a connected device.
 * undefined when the reference has no follow-up.
 */
export function referenceFollowUp(reference: OutputReference): string[] | undefined {
  if (reference.kind === 'commit' && isCommitId(reference.value)) return ['git', 'show', reference.value];
  if (reference.kind === 'device' && reference.state === 'device' && SERIAL.test(reference.value)) return ['adb', '-s', reference.value, 'shell'];
  return undefined;
}

export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {file: 'File', url: 'Link', commit: 'Commit', device: 'Device'};
