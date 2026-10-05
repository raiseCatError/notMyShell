import {writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {runExternal} from '../../providers/providers.js';
import {completionLabel, filterCompletions, type CompletionCandidate, type CompletionContext, type CompletionKind, type CompletionSource} from '../completion.js';
import {completionWord} from '../ConfiguredCompletion.js';
import type {CommandEntry} from '../../suggestions/types.js';
import {fishQuote, type LaunchContext, type ShellAdapter, type ShellLaunch} from './ShellAdapter.js';
import {findShellExecutables} from './shellExecutable.js';
import {bridgeBootstrap} from '../../themeBridge/environment.js';

/**
 * Fish backend.
 *
 * Fish's own facilities, not zsh emulation: the user's config.fish loads as
 * usual, then `--init-command` sources a private bootstrap that
 *  - reports readiness once from fish_prompt (fish calls it on every repaint),
 *  - reports each command from the fish_preexec / fish_postexec events,
 *  - empties fish_prompt / fish_right_prompt / fish_mode_prompt / fish_title
 *    and the greeting, because NMSh owns prompt and title,
 *  - writes a bounded name snapshot (functions, abbreviations, builtins, job count).
 * Fish's line editor cannot be turned off; its redraws between readiness and
 * exec are editor chrome and are dropped by the session (editorChrome).
 */

const FISH_BUILTINS = new Set(['and', 'begin', 'bg', 'bind', 'block', 'break', 'breakpoint', 'builtin', 'case', 'cd', 'command', 'commandline', 'complete',
  'contains', 'continue', 'count', 'echo', 'else', 'emit', 'end', 'eval', 'exec', 'exit', 'false', 'fg', 'for', 'function', 'functions', 'history', 'if', 'jobs',
  'math', 'not', 'or', 'path', 'printf', 'pwd', 'random', 'read', 'realpath', 'return', 'set', 'set_color', 'source', 'status', 'string', 'switch', 'test',
  'time', 'true', 'type', 'ulimit', 'wait', 'while', 'abbr', 'argparse']);

function bootstrap({token, knowledgePath, bridgeEnvPath}: LaunchContext, originalTerm: string | undefined): string {
  const sync = bridgeEnvPath ? '\n    nmsh_bridge_sync' : '';
  const marker = (body: string) => `printf '\\e]777;nmsh;${token};${body}\\a'`;
  return `# NMSh managed fish session bootstrap (private, per session)
${originalTerm ? `set -gx TERM ${fishQuote(originalTerm)}` : ''}
set -g fish_greeting
# Fish >= 4 only; NMSh shows its own suggestions.
set -g fish_autosuggestion_enabled 0
function fish_prompt
  if not set -q __nmsh_ready
    set -g __nmsh_ready 1
    __nmsh_knowledge${sync}
    ${marker("0;%s")} "$PWD"
  end
end
${bridgeEnvPath ? bridgeBootstrap('fish', bridgeEnvPath) : ''}
function fish_right_prompt; end
function fish_mode_prompt; end
function fish_title; end
function __nmsh_knowledge
  begin
    printf 'jobs %d\\n' (count (jobs -p 2>/dev/null))
    set -l nmsh_count 0
    for nmsh_name in (functions -n) (abbr --list 2>/dev/null) (builtin -n)
      set nmsh_count (math $nmsh_count + 1)
      if test $nmsh_count -gt 4096
        printf 'partial\\n'
        return
      end
    end
    for nmsh_name in (functions -n)
      string match -qr '^[A-Za-z0-9_.+-]{1,128}$' -- $nmsh_name; and printf 'function %s\\n' $nmsh_name
    end
    for nmsh_name in (abbr --list 2>/dev/null)
      string match -qr '^[A-Za-z0-9_.+-]{1,128}$' -- $nmsh_name; and printf 'alias %s\\n' $nmsh_name
    end
    for nmsh_name in (builtin -n)
      string match -qr '^[A-Za-z0-9_.+-]{1,128}$' -- $nmsh_name; and printf 'builtin %s\\n' $nmsh_name
    end
    printf 'complete\\n'
  end > ${fishQuote(knowledgePath)}
end
function __nmsh_preexec --on-event fish_preexec
  set -l nmsh_allowed 1
  # Fish itself keeps a command that starts with a space out of history.
  string match -qr '^\\s' -- "$argv[1]"; and set nmsh_allowed 0
  ${marker('exec2;%d;%s')} $nmsh_allowed (string replace -ra '[[:cntrl:]]' ' ' -- "$argv[1]")
end
function __nmsh_postexec --on-event fish_postexec
  set -l nmsh_status $status
  __nmsh_knowledge${bridgeEnvPath ? '\n  nmsh_bridge_sync' : ''}
  ${marker('%d;%s')} $nmsh_status "$PWD"
end
`;
}

/** Parse fish_history (a YAML subset): `- cmd: <escaped>` then `  when: <epoch seconds>`. */
export function parseFishHistory(content: Uint8Array | string): CommandEntry[] {
  const text = typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
  const entries: CommandEntry[] = [];
  let current: CommandEntry | undefined;
  for (const line of text.split('\n')) {
    const cmd = /^- cmd: (.*)$/u.exec(line);
    if (cmd) {
      if (current?.command.trim()) entries.push(current);
      // Fish escapes newline as \n and backslash as \\ in this file.
      current = {command: cmd[1]!.replace(/\\(\\|n)/gu, (_match, escaped: string) => (escaped === 'n' ? '\n' : '\\'))};
      continue;
    }
    const when = /^ {2}when: (\d+)$/u.exec(line);
    if (when && current) current.at = Number(when[1]) * 1000;
  }
  if (current?.command.trim()) entries.push(current);
  return entries.filter(entry => !/^\s/u.test(entry.command));
}

/**
 * Fish's own completion engine, asked in an isolated `fish -c` process with
 * the user's configuration: `complete -C <line>` prints candidate<TAB>description.
 * The live session is never asked; the line is passed as an argument, never interpolated.
 */
export class FishCompletionSource implements CompletionSource {
  readonly id = 'fish';
  private readonly cache = new Map<string, {at: number; output: string}>();

  constructor(private readonly executable: () => string | undefined) {}

  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    const fish = this.executable();
    const cursor = context.cursor ?? context.buffer.length;
    const range = completionWord({...context, cursor});
    if (!fish || !range || /[\u0000-\u001f]/u.test(context.buffer)) return [];
    const line = context.buffer.slice(0, cursor);
    const key = JSON.stringify([context.cwd, line]);
    const cached = this.cache.get(key);
    let output: string;
    if (cached && Date.now() - cached.at < 2000) output = cached.output;
    else {
      const result = await runExternal(fish, ['-c', 'complete -C -- $argv[1]', '--', line],
        {cwd: context.cwd, env: process.env, signal, timeoutMs: 2000, maxBytes: 1024 * 1024, terminationGraceMs: 100});
      if (!result.ok || signal.aborted) return [];
      output = result.stdout;
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, {at: Date.now(), output});
    }
    return filterCompletions(parseFishCompletions(output, context, range), context.buffer.slice(range.start, cursor));
  }
}

export function parseFishCompletions(output: string, context: CompletionContext, range: {start: number; end: number}): CompletionCandidate[] {
  const seen = new Set<string>();
  const result: CompletionCandidate[] = [];
  for (const raw of output.split('\n').slice(0, 2000)) {
    const [value = '', ...rest] = raw.replace(/\r$/u, '').split('\t');
    if (!value || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || seen.has(value)) continue;
    seen.add(value);
    const description = completionLabel(rest.join(' '));
    const kind: CompletionKind = value.endsWith('/') ? 'directory' : value.startsWith('-') ? 'option' : range.start === 0 ? 'command' : 'argument';
    result.push({value, display: completionLabel(value), name: completionLabel(value), description, kind, source: 'fish',
      replacement: range, context: {...context}, insertion: context.buffer.slice(0, range.start) + value + context.buffer.slice(range.end),
      insertionCursor: range.start + value.length});
  }
  return result;
}

function resolveFish(env: NodeJS.ProcessEnv): string | undefined {
  // PATH only: a shell the user cannot run by name is not offered.
  return findShellExecutables('fish', env)[0];
}

export const fishAdapter: ShellAdapter = {
  id: 'fish',
  label: 'Fish',
  capabilities: {completion: 'rich', completionDescriptions: true, liveNames: true, historyImport: true,
    privateHistory: 'a leading space keeps a command out of Fish history (and NMSh history)', jobCount: true},
  editorChrome: 'prompt-to-exec',
  builtins: FISH_BUILTINS,
  resolveExecutable: resolveFish,
  unavailableReason(env) {
    return resolveFish(env) ? undefined : 'Fish is not installed (no executable fish on PATH). Select it in /shell to see how to install it.';
  },
  launch(context): ShellLaunch {
    const fish = resolveFish(context.env);
    if (!fish) throw new Error(this.unavailableReason(context.env));
    const original = context.env.TERM;
    const init = join(context.stateDir, 'nmsh-init.fish');
    writeFileSync(init, bootstrap(context, original === 'xterm-ghostty' ? original : undefined), {mode: 0o600});
    return {executable: fish, args: ['--interactive', `--init-command=source ${fishQuote(init)}`],
      // Same startup TERM compatibility as zsh: restored by the bootstrap after config.fish.
      env: original === 'xterm-ghostty' ? {TERM: 'xterm-256color'} : {}};
  },
  scrubCommandStart(data) {
    return data.replace(/^(?:\u001b\[\?2004l|\u001b\[\?1004l|\u001b\[<1u|\u001b\[=0;1u|\u001b\[>4;0m)+/u, '');
  },
  answerQueries(chrome) {
    // Primary device attributes: Fish 4 waits for this reply. Answer as a VT220-class terminal; nothing else is claimed.
    return /\u001b\[0?c/u.test(chrome) ? '\u001b[?62;22c' : '';
  },
  historyFile(env, home) {
    const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home || homedir(), '.local', 'share');
    const name = env.fish_history && /^[A-Za-z0-9_]+$/u.test(env.fish_history) ? env.fish_history : 'fish';
    return env.fish_history === '' ? undefined : join(data, 'fish', `${name}_history`);
  },
  async parseHistory(content) { return parseFishHistory(content); },
  completionSource() { return new FishCompletionSource(() => resolveFish(process.env)); },
};
