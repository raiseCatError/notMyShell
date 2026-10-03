import {resolveZsh} from './zshExecutable.js';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {commandIdentity, completionLabel, type CompletionCandidate, type CompletionContext, type CompletionSource} from './completion.js';

const MAX_BYTES = 1024 * 1024;
const shellQuote = (value: string): string => "'" + value.replace(/'/gu, "'\\''") + "'";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const script = (name: string): string => existsSync(join(scriptDirectory, name)) ? join(scriptDirectory, name)
  : join(scriptDirectory, '../../src/shell', name);

/** Conservative word bounds; expansions and nested shell syntax use native fallback. */
export function completionWord(context: CompletionContext): {start: number; end: number} | undefined {
  const cursor = context.cursor ?? context.buffer.length;
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > context.buffer.length || context.buffer.length > 8192
    || /[\u0000-\u001f\u007f-\u009f$`();<>|&]/u.test(context.buffer)) return;
  let start = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < context.buffer.length; i++) {
    const character = context.buffer[i]!;
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; }
    else if (character === '"' || character === "'") quote = character;
    else if (/\s/u.test(character)) {
      if (i >= cursor) return {start, end: i};
      start = i + 1;
    }
  }
  return {start, end: context.buffer.length};
}

/**
 * zsh's `-d` display strings (from `_describe`) repeat the match, padded,
 * before ` -- description`. Keep just the description; a display string that
 * is only the match itself carries no description.
 */
export function describeOnly(display: string, raw: string): string {
  const text = display.trim();
  if (text === raw) return '';
  const rest = raw && text.startsWith(raw) ? /^\s+--\s+(.*)$/u.exec(text.slice(raw.length)) : null;
  return rest ? rest[1]!.trim() : text;
}

export function parseConfiguredCompletions(output: string, context: CompletionContext): CompletionCandidate[] {
  const range = completionWord(context);
  if (!range || Buffer.byteLength(output) > MAX_BYTES || !output.endsWith('\0')) return [];
  const fields = output.slice(0, -1).split('\0');
  if (fields.length % 7 !== 0) return [];
  const candidates: CompletionCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < fields.length && candidates.length < 4096; i += 7) {
    const [raw, display, description, group, prefix, suffix, category] = fields.slice(i, i + 7);
    const value = prefix + raw + suffix;
    if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || seen.has(value)) continue;
    seen.add(value);
    // Quote the complete replacement, avoiding any dependence on plugin ZLE insertion.
    let insertionValue = value.replace(/([^\p{L}\p{N}_./:,@%+\-])/gu, '\\$1');
    const kind = category === 'directory' ? 'directory' : category === 'file' ? 'file'
      : value.startsWith('-') ? 'option' : range.start === 0 ? 'command'
        // "common commands", "internal commands", "subcommand": a subcommand group after the command word.
        : /\b(?:sub)?commands?$/iu.test(group ?? '') ? 'subcommand' : 'argument';
    // Preserve only the user's explicit, unquoted HOME expansion. Quoted/escaped
    // tildes and arbitrary completion values remain literal presentation data.
    if ((kind === 'file' || kind === 'directory') && value.startsWith('~/')
      && context.buffer.slice(range.start, range.end).startsWith('~/')) {
      insertionValue = insertionValue.slice(1);
    }
    const label = completionLabel(display);
    const cleanDescription = describeOnly(completionLabel(description), raw);
    const identity = kind === 'command' ? commandIdentity(group) : undefined;
    candidates.push({value, display: label, name: label, description: cleanDescription,
      group: /^-.*-$/u.test(group ?? '') ? '' : completionLabel(group), prefix, suffix, kind, ...(identity ? {identity} : {}), source: 'zsh-configured', replacement: range,
      context: {...context}, insertionCursor: range.start + insertionValue.length,
      insertion: context.buffer.slice(0, range.start) + insertionValue + context.buffer.slice(range.end)});
  }
  return candidates;
}

/** Persistent, bounded helper; config is executable trusted user code, not sandboxed. */
export class ConfiguredCompletionSource implements CompletionSource {
  readonly id = 'zsh-configured';
  private child?: ChildProcess;
  private root?: string;
  private cwd?: string;
  private started = 0;
  private sequence = 0;
  private wait?: {expected: string; resolve: (ok: boolean) => void};
  private output = '';
  private queue: Promise<void> = Promise.resolve();
  private retryAfter = 0;
  constructor(private readonly options: {env?: NodeJS.ProcessEnv; startupMs?: number; queryMs?: number} = {}) {}

  private epoch = 0;

  dispose(): void { this.epoch++; this.reset(); }

  private reset(): void {
    const child = this.child;
    this.child = undefined;
    if (this.root) {
      try {
        const pid = Number(readFileSync(join(this.root, 'pid'), 'utf8').trim());
        if (Number.isSafeInteger(pid) && pid > 1) {
          try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); }
        }
      } catch { /* The helper may not have reached startup yet. */ }
    }
    if (child?.pid) {
      const pid = child.pid;
      // Let the zpty parent reap an inner shell even before its PID file exists.
      const deadline = setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }, 100);
      child.once('close', () => {
        clearTimeout(deadline);
        try { process.kill(-pid, 'SIGKILL'); } catch { /* Group already gone. */ }
      });
      try { process.kill(-pid, 'SIGTERM'); } catch { clearTimeout(deadline); }
    }
    this.wait?.resolve(false);
    this.wait = undefined;
    if (this.root) rmSync(this.root, {recursive: true, force: true});
    this.root = undefined;
    this.output = '';
  }

  private async expect(expected: string, milliseconds: number, signal: AbortSignal, send?: () => void): Promise<boolean> {
    if (signal.aborted) return false;
    return new Promise(resolve => {
      const finish = (ok: boolean) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (this.wait?.resolve === finish) this.wait = undefined;
        resolve(ok);
      };
      const abort = () => { this.reset(); finish(false); };
      const timer = setTimeout(() => { this.reset(); finish(false); }, milliseconds);
      this.wait = {expected, resolve: finish};
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) { abort(); return; }
      send?.();
    });
  }

  private async start(cwd: string, signal: AbortSignal): Promise<boolean> {
    this.reset();
    const env = {...(this.options.env ?? process.env)};
    const shell = resolveZsh(env);
    const home = env.HOME ?? '';
    this.root = mkdtempSync(join(tmpdir(), 'nmsh-completion-'));
    const root = this.root;
    // Same HOME-based startup trust boundary as ShellSession. Suppress UI before sourcing.
    writeFileSync(join(root, '.zshenv'), `print -r -- $$ > ${shellQuote(join(root, 'pid'))}\nunsetopt monitor\n[[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshenv'))} ]] && source ${shellQuote(join(home, '.zshenv'))}\nZDOTDIR=${shellQuote(root)}\n`, {mode: 0o600});
    writeFileSync(join(root, '.zshrc'), `unsetopt zle\nexport POWERLEVEL9K_DISABLE_PROMPT=true\nTERM=dumb\nif [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshrc'))} ]]; then\n ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zshrc'))}\nfi\nsetopt noaliases\nbuiltin cd -- ${shellQuote(cwd)} || exit 1\nexport NMSH_COMPLETION_ROOT=${shellQuote(root)}\nbuiltin source ${shellQuote(script('configured-widget.zsh'))}\n`, {mode: 0o600});
    delete env.TERM_PROGRAM;
    delete env.TERM_PROGRAM_VERSION;
    this.cwd = cwd;
    this.started = Date.now();
    const child = spawn(shell, ['-f', script('configured-completion.zsh')], {cwd, env: {...env,
      TERM: 'dumb', NMSH_ZSH_EXECUTABLE: shell, ZDOTDIR: root, NMSH_COMPLETION_ROOT: root,
      NMSH_COMPLETION_STARTUP_MS: String(Math.min(this.options.startupMs ?? 1500, 5000)),
      NMSH_COMPLETION_QUERY_MS: String(Math.min(this.options.queryMs ?? 300, 2000))}, detached: true, stdio: ['pipe', 'pipe', 'ignore']});
    this.child = child;
    child.stdin!.on('error', () => { if (this.child === child) this.reset(); });
    child.on('error', () => { if (this.child === child) this.reset(); });
    child.on('exit', () => { if (this.child === child) this.reset(); });
    child.stdout!.on('data', (data: Buffer) => {
      if (this.child !== child) return;
      this.output += data.toString('utf8');
      if (this.output.length > 4096) { this.reset(); return; }
      let newline: number;
      while ((newline = this.output.indexOf('\n')) >= 0) {
        const line = this.output.slice(0, newline);
        this.output = this.output.slice(newline + 1);
        if (this.wait?.expected === line) this.wait.resolve(true);
      }
    });
    return this.expect('READY', this.options.startupMs ?? 1500, signal);
  }

  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    if (!completionWord(context) || signal.aborted || Date.now() < this.retryAfter) return [];
    const epoch = this.epoch;
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      if (signal.aborted || epoch !== this.epoch) return [];
      if (!this.child || this.cwd !== context.cwd || Date.now() - this.started >= 60_000) {
        // Startup is shared across superseding input requests. Disposal/timeout still cancels it.
        if (!await this.start(context.cwd, new AbortController().signal)) { this.retryAfter = Date.now() + 5000; return []; }
      }
      if (signal.aborted || epoch !== this.epoch) return [];
      const root = this.root!;
      writeFileSync(join(root, 'buffer'), context.buffer, {mode: 0o600});
      const range = completionWord(context)!;
      writeFileSync(join(root, 'home-expansion'), context.buffer.slice(range.start, range.end).startsWith('~/') ? '1' : '0', {mode: 0o600});
      // zsh counts Unicode code points; NMSh context offsets are UTF-16.
      writeFileSync(join(root, 'cursor'), String([...context.buffer.slice(0, context.cursor ?? context.buffer.length)].length), {mode: 0o600});
      writeFileSync(join(root, 'results'), '', {mode: 0o600});
      rmSync(join(root, 'done'), {force: true});
      const id = ++this.sequence;
      if (!await this.expect(`DONE ${id}`, this.options.queryMs ?? 300, signal, () => this.child?.stdin!.write(`${id}\n`))) {
        // A slow warm query canceled by typing must not source executable config
        // again on every subsequent keystroke. Native remains available meanwhile.
        this.retryAfter = Date.now() + (signal.aborted ? 1000 : 5000);
        return [];
      }
      if (statSync(join(root, 'results')).size > MAX_BYTES) { this.reset(); return []; }
      return parseConfiguredCompletions(readFileSync(join(root, 'results'), 'utf8'), {...context,
        generation: this.started, expiresAt: this.started + 60_000});
    } catch { this.reset(); return []; }
    finally { release(); }
  }
}
