import {spawn} from 'node:child_process';
import {basename, dirname, isAbsolute} from 'node:path';
import {resolveTrustedExecutable} from '../context/services.js';

/**
 * "Open in pager": a transcript block's command and complete stored output
 * (folded lines included) on the host terminal, read-only.
 *
 * The text is handed to the pager on its stdin through an owned pipe. It
 * never becomes shell source, a command line, an argument or history, and the
 * managed shell never sees it. Control characters still in the stored text
 * are shown in caret notation first, so the pager and the host terminal only
 * ever receive printable text, tabs and line breaks.
 *
 * The pager is the user's PAGER when it names a plain program with plain
 * options (run with typed argv, never through a shell), else less, else more.
 * Executables resolve like NMSh's other tools: absolute PATH entries only,
 * never inside the current workspace, never writable by others or owned by
 * another user.
 */

export interface PagerCommand {
  binary: string;
  args: string[];
  /** The program name, for messages. */
  name: string;
}

export type PagerResult = {ok: true} | {ok: false; reason: string};

const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;
/** Programs that would not page: NMSh shells set PAGER=cat for their own transcript. */
const NOT_A_PAGER = new Set(['cat', 'tee', 'nmsh', 'true', 'false']);

/** PAGER as plain argv, or undefined when it would need a shell to mean anything. */
export function pagerArgv(value: string | undefined): string[] | undefined {
  const words = (value ?? '').trim().split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > 8 || !words.every(word => PLAIN_WORD.test(word))) return undefined;
  if (NOT_A_PAGER.has(basename(words[0]!))) return undefined;
  if (words[0]!.includes('/') && !isAbsolute(words[0]!)) return undefined;
  return words;
}

export async function choosePager(env: NodeJS.ProcessEnv, untrustedRoots: readonly string[]): Promise<PagerCommand | undefined> {
  const preferred = pagerArgv(env.PAGER);
  for (const [program, ...args] of [...(preferred ? [preferred] : []), ['less'], ['more']]) {
    // An absolute PAGER is resolved in its own directory, under the same ownership rules.
    const resolved = await resolveTrustedExecutable(basename(program!), program!.includes('/') ? dirname(program!) : env.PATH, untrustedRoots);
    if (typeof resolved !== 'string') return {binary: resolved.path, args, name: basename(program!)};
  }
  return undefined;
}

/** Printable text, tabs and newlines only: other controls become visible caret notation. */
export function pagerText(text: string): string {
  return text.replace(/\r\n/gu, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u0080-\u009f]/gu, char => {
    const code = char.codePointAt(0)!;
    return code < 0x20 ? `^${String.fromCharCode(code + 64)}` : code === 0x7f ? '^?' : `<${code.toString(16).toUpperCase().padStart(2, '0')}>`;
  });
}

/** The command line as the first line, then its output: the same text "Copy command + output" copies. */
export function pagerDocument(command: string, output: string): string {
  const text = pagerText([command, output].filter(Boolean).join('\n'));
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * The pager's environment: the user's own, with input preprocessors removed
 * (LESSOPEN applied to standard input would run on the block's text) and the
 * Theme Bridge pager colors added when that target is active.
 */
export function pagerProcessEnvironment(env: NodeJS.ProcessEnv, bridge: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {...env, ...bridge};
  delete out.LESSOPEN;
  delete out.LESSCLOSE;
  return out;
}

/** Interactive host-terminal program: call only while NMSh has handed the terminal over. */
export function runPager(command: PagerCommand, document: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<PagerResult> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve({ok: false, reason: 'cancelled'}); return; }
    let child: ReturnType<typeof spawn> | undefined;
    let settled = false;
    const abort = () => { child?.kill('SIGTERM'); };
    const finish = (result: PagerResult) => { if (!settled) { settled = true; signal?.removeEventListener('abort', abort); resolve(result); } };
    try { child = spawn(command.binary, command.args, {env, stdio: ['pipe', 'inherit', 'inherit']}); }
    catch (error) { finish({ok: false, reason: `${command.name} could not start: ${error instanceof Error ? error.message : String(error)}`}); return; }
    signal?.addEventListener('abort', abort, {once: true});
    child.stdin!.on('error', () => { /* Quitting before the end closes the pipe early. */ });
    child.once('error', error => finish({ok: false, reason: `${command.name} could not start: ${error.message}`}));
    child.once('close', (code, killed) => finish(signal?.aborted ? {ok: false, reason: 'cancelled'} : code === 0 ? {ok: true}
      : {ok: false, reason: `${command.name} exited with ${code ?? killed}`}));
    child.stdin!.end(document);
  });
}
