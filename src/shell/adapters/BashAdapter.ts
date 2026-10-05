import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {runExternal} from '../../providers/providers.js';
import {completionLabel, filterCompletions, type CompletionCandidate, type CompletionContext, type CompletionKind, type CompletionSource} from '../completion.js';
import {completionWord} from '../ConfiguredCompletion.js';
import type {CommandEntry} from '../../suggestions/types.js';
import {posixQuote, type LaunchContext, type ShellAdapter, type ShellLaunch} from './ShellAdapter.js';
import {findShellExecutables} from './shellExecutable.js';
import {bridgeBootstrap} from '../../themeBridge/environment.js';

/**
 * Bash backend.
 *
 * Bash runs with `--noediting` (no Readline: like zsh without ZLE, it reads
 * whole lines and NMSh owns the editor) and a private `--rcfile` that loads
 * the system and user bashrc first. Lifecycle comes from Bash's own hooks:
 * PROMPT_COMMAND (status + cwd, composed with the user's commands) and PS0
 * (expanded after a line is read, before it runs; Bash >= 4.4).
 *
 * Honest limits: Bash cannot report the text of a line it decided not to
 * record (leading space with ignorespace, ignoredups, HISTIGNORE, history
 * off). Such commands are reported as not recorded, which NMSh history
 * respects. Completion uses the system bash-completion framework in an
 * isolated helper; completions defined only in ~/.bashrc are not seen, and
 * Bash completion has no descriptions.
 */

const MIN_BASH: [number, number] = [4, 4];

const BASH_BUILTINS = new Set(['alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'cd', 'command', 'compgen', 'complete', 'compopt', 'continue', 'declare',
  'dirs', 'disown', 'echo', 'enable', 'eval', 'exec', 'exit', 'export', 'false', 'fc', 'fg', 'getopts', 'hash', 'help', 'history', 'jobs', 'kill', 'let',
  'local', 'logout', 'mapfile', 'popd', 'printf', 'pushd', 'pwd', 'read', 'readarray', 'readonly', 'return', 'set', 'shift', 'shopt', 'source', 'suspend',
  'test', 'times', 'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'wait']);

const bashVersions = new Map<string, [number, number] | undefined>();

export function bashVersionOf(executable: string): [number, number] | undefined {
  if (bashVersions.has(executable)) return bashVersions.get(executable);
  let version: [number, number] | undefined;
  try {
    const result = spawnSync(executable, ['--norc', '--noprofile', '-c', 'printf "%s.%s" "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"'],
      {encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], env: {PATH: process.env.PATH ?? ''}});
    const match = /^(\d+)\.(\d+)$/u.exec(result.stdout.trim());
    version = match ? [Number(match[1]), Number(match[2])] : undefined;
  } catch { version = undefined; }
  bashVersions.set(executable, version);
  return version;
}

const recentEnough = (version: [number, number] | undefined) => Boolean(version && (version[0] > MIN_BASH[0] || (version[0] === MIN_BASH[0] && version[1] >= MIN_BASH[1])));

/** The first Bash >= 4.4 on PATH, then the system Bash (macOS /bin/bash is 3.2 and is skipped). */
function resolveBash(env: NodeJS.ProcessEnv): string | undefined {
  // PATH first (a newer Homebrew Bash), then the system Bash, as with zsh.
  return findShellExecutables('bash', env, ['/bin/bash', '/usr/bin/bash']).find(candidate => recentEnough(bashVersionOf(candidate)));
}

function bootstrap(context: LaunchContext): string {
  const {home, token, knowledgePath} = context;
  const marker = (body: string) => `builtin printf '\\e]777;nmsh;${token};${body}\\a'`;
  return `# NMSh managed bash session bootstrap (private, per session)
# --rcfile replaces the standard startup files, so load them as Bash would.
[[ -f /etc/bash.bashrc ]] && . /etc/bash.bashrc
[[ -f /etc/bashrc ]] && . /etc/bashrc
[[ -f ${posixQuote(join(home, '.bashrc'))} ]] && . ${posixQuote(join(home, '.bashrc'))}
if [[ -n $NMSH_ORIGINAL_TERM ]]; then export TERM=$NMSH_ORIGINAL_TERM; fi
unset NMSH_ORIGINAL_TERM
export NMSH_ACTIVE=1

# Hooks may run before Bash has the terminal back; run stty immune to SIGTTOU.
__nmsh_tty() { ( trap '' TTOU; builtin command stty "$1" 2>/dev/null ); }

__nmsh_knowledge() {
  local nmsh_name nmsh_count=0
  {
    # jobs must run in this shell (a pipeline or $(...) subshell has no job table).
    { builtin jobs -pr; builtin jobs -ps; } > ${posixQuote(knowledgePath)}.jobs 2>/dev/null
    local -a nmsh_jobs=()
    builtin mapfile -t nmsh_jobs < ${posixQuote(knowledgePath)}.jobs
    builtin printf 'jobs %d\\n' "\${#nmsh_jobs[@]}"
    while IFS= read -r nmsh_name; do
      ((++nmsh_count > 4096)) && { builtin printf 'partial\\n'; return; }
      [[ $nmsh_name =~ ^[A-Za-z0-9_.+-]{1,128}$ ]] && builtin printf 'alias %s\\n' "$nmsh_name"
    done < <(builtin compgen -a)
    while IFS= read -r nmsh_name; do
      ((++nmsh_count > 4096)) && { builtin printf 'partial\\n'; return; }
      [[ $nmsh_name =~ ^[A-Za-z0-9_.+-]{1,128}$ ]] && builtin printf 'function %s\\n' "$nmsh_name"
    done < <(builtin compgen -A function)
    builtin printf 'complete\\n'
  } > ${posixQuote(knowledgePath)}
}

# Compose with the user's PROMPT_COMMAND (string or Bash 5.1 array) instead of replacing it.
if [[ "$(builtin declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  __nmsh_user_prompt_command=("\${PROMPT_COMMAND[@]}")
else
  __nmsh_user_prompt_command=("\${PROMPT_COMMAND:-}")
fi
__nmsh_set_status() { return "$1"; }
__nmsh_history_last=

${context.bridgeEnvPath ? bridgeBootstrap('bash', context.bridgeEnvPath) : ''}
__nmsh_precmd() {
  local nmsh_status=$? nmsh_command
  for nmsh_command in "\${__nmsh_user_prompt_command[@]}"; do
    [[ -n $nmsh_command ]] || continue
    __nmsh_set_status "$nmsh_status"
    builtin eval "$nmsh_command"
  done
  # A plugin may reassign PROMPT_COMMAND; adopt its value and keep NMSh's hook last.
  if [[ "\${PROMPT_COMMAND[*]}" != "__nmsh_precmd" ]]; then
    __nmsh_user_prompt_command=("\${PROMPT_COMMAND[@]/__nmsh_precmd/}")
    PROMPT_COMMAND=__nmsh_precmd
  fi
  PS1='' PS2=''
  __nmsh_tty -echo
  __nmsh_history_last=$(HISTTIMEFORMAT= builtin history 1)
  __nmsh_knowledge${context.bridgeEnvPath ? '\n  nmsh_bridge_sync' : ''}
  ${marker('%d;%s')} "$nmsh_status" "$PWD"
}

# Expanded in a subshell after a line is read and before it runs.
__nmsh_ps0() {
  local nmsh_current
  nmsh_current=$(HISTTIMEFORMAT= builtin history 1)
  if [[ -n $nmsh_current && $nmsh_current != "$__nmsh_history_last" && $nmsh_current =~ ^[[:space:]]*[0-9]+\\*?[[:space:]]+(.*)$ ]]; then
    nmsh_current=\${BASH_REMATCH[1]}
    ${marker('exec2;1;%s')} "\${nmsh_current//[[:cntrl:]]/ }"
  else
    # Bash did not record this line (private, duplicate, ignored or history off).
    ${marker('exec2;0;')}
  fi
  __nmsh_tty echo
}

PROMPT_COMMAND=__nmsh_precmd
PS1='' PS2=''
PS0='$(__nmsh_ps0)'
`;
}

/** ~/.bash_history: one command per line, with optional "#<epoch>" lines when HISTTIMEFORMAT was set. */
export function parseBashHistory(content: Uint8Array | string): CommandEntry[] {
  const text = typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
  const entries: CommandEntry[] = [];
  let at: number | undefined;
  for (const line of text.split('\n')) {
    const stamp = /^#(\d{9,11})$/u.exec(line);
    if (stamp) { at = Number(stamp[1]) * 1000; continue; }
    if (line.trim() && !/^\s/u.test(line)) entries.push({command: line, ...(at === undefined ? {} : {at})});
    at = undefined;
  }
  return entries;
}

const COMPLETION_SCRIPT = `
line=$1
shopt -s extglob progcomp
for nmsh_bc in /usr/share/bash-completion/bash_completion /opt/homebrew/etc/profile.d/bash_completion.sh /usr/local/etc/profile.d/bash_completion.sh /etc/bash_completion; do
  [[ -r $nmsh_bc ]] && { . "$nmsh_bc" >/dev/null 2>&1; break; }
done
read -ra words <<< "$line"
[[ $line == *[[:space:]] || \${#words[@]} -eq 0 ]] && words+=("")
cword=$(( \${#words[@]} - 1 ))
cur=\${words[cword]}
if (( cword == 0 )); then compgen -c -- "$cur" 2>/dev/null; exit 0; fi
cmd=\${words[0]}
spec=$(complete -p -- "$cmd" 2>/dev/null)
if [[ -z $spec ]] && declare -F _completion_loader >/dev/null; then _completion_loader "$cmd" >/dev/null 2>&1; spec=$(complete -p -- "$cmd" 2>/dev/null); fi
if [[ $spec =~ -F[[:space:]]+([^[:space:]]+) ]]; then
  COMP_WORDS=("\${words[@]}"); COMP_CWORD=$cword; COMP_LINE=$line; COMP_POINT=\${#line}; COMPREPLY=()
  "\${BASH_REMATCH[1]}" "$cmd" "$cur" "\${words[cword-1]}" >/dev/null 2>&1
  printf '%s\\n' "\${COMPREPLY[@]}"
else
  compgen -f -- "$cur" 2>/dev/null
fi
`;

/** Bash programmable completion via bash-completion in an isolated helper; names only (Bash has no descriptions). */
export class BashCompletionSource implements CompletionSource {
  readonly id = 'bash';
  private readonly cache = new Map<string, {at: number; output: string}>();

  constructor(private readonly executable: () => string | undefined) {}

  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    const bash = this.executable();
    const cursor = context.cursor ?? context.buffer.length;
    const range = completionWord({...context, cursor});
    if (!bash || !range || /[\u0000-\u001f]/u.test(context.buffer)) return [];
    const line = context.buffer.slice(0, cursor);
    const key = JSON.stringify([context.cwd, line]);
    const cached = this.cache.get(key);
    let output: string;
    if (cached && Date.now() - cached.at < 2000) output = cached.output;
    else {
      const result = await runExternal(bash, ['--norc', '--noprofile', '-c', COMPLETION_SCRIPT, 'nmsh-complete', line],
        {cwd: context.cwd, env: process.env, signal, timeoutMs: 2000, maxBytes: 1024 * 1024, terminationGraceMs: 100});
      if (!result.ok || signal.aborted) return [];
      output = result.stdout;
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, {at: Date.now(), output});
    }
    const seen = new Set<string>();
    const candidates: CompletionCandidate[] = [];
    for (const raw of output.split('\n').slice(0, 2000)) {
      const value = raw.replace(/\r$/u, '').replace(/\s+$/u, '');
      if (!value || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || seen.has(value)) continue;
      seen.add(value);
      const kind: CompletionKind = value.endsWith('/') ? 'directory' : value.startsWith('-') ? 'option' : range.start === 0 ? 'command' : 'argument';
      candidates.push({value, display: completionLabel(value), name: completionLabel(value), description: '', kind, source: 'bash', replacement: range,
        context: {...context}, insertion: context.buffer.slice(0, range.start) + value + context.buffer.slice(range.end), insertionCursor: range.start + value.length});
    }
    return filterCompletions(candidates, context.buffer.slice(range.start, cursor));
  }
}

export const bashAdapter: ShellAdapter = {
  id: 'bash',
  label: 'Bash',
  capabilities: {completion: 'basic', completionDescriptions: false, liveNames: true, historyImport: true,
    privateHistory: 'Bash\'s own HISTCONTROL/HISTIGNORE decide; lines Bash does not record are not recorded by NMSh either', jobCount: true},
  editorChrome: 'none',
  builtins: BASH_BUILTINS,
  resolveExecutable: resolveBash,
  unavailableReason(env) {
    if (resolveBash(env)) return undefined;
    const found = findShellExecutables('bash', env, ['/bin/bash']);
    if (found.length) {
      const version = bashVersionOf(found[0]!);
      return `Bash ${version ? version.join('.') : '(unknown version)'} at ${found[0]} is too old: NMSh needs Bash ${MIN_BASH.join('.')} or newer (PS0). Select Bash in /shell to see how to install a newer one.`;
    }
    return 'Bash is not installed. Select it in /shell to see how to install it.';
  },
  launch(context): ShellLaunch {
    const bash = resolveBash(context.env);
    if (!bash) throw new Error(this.unavailableReason(context.env));
    const rc = join(context.stateDir, 'nmsh.bashrc');
    writeFileSync(rc, bootstrap(context), {mode: 0o600});
    const ghostty = context.env.TERM === 'xterm-ghostty';
    return {executable: bash, args: ['--noediting', '--rcfile', rc, '-i'],
      env: ghostty ? {TERM: 'xterm-256color', NMSH_ORIGINAL_TERM: 'xterm-ghostty'} : {}};
  },
  historyFile(env, home) { return env.HISTFILE || join(home || homedir(), '.bash_history'); },
  async parseHistory(content) { return parseBashHistory(content); },
  completionSource() { return new BashCompletionSource(() => resolveBash(process.env)); },
};
