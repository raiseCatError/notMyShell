import type {CommandType} from './SemanticService.js';
import {stripAnsi} from '../util/text.js';

export const MAX_SHELL_KNOWLEDGE_BYTES = 65536;

/** Names only: no alias expansion, function body, environment value or evaluation. */
export function parseShellKnowledge(text: string): Map<string, CommandType> {
  const result = new Map<string, CommandType>();
  if (Buffer.byteLength(text) > MAX_SHELL_KNOWLEDGE_BYTES) return result;
  for (const line of text.split('\n').slice(0, 4097)) {
    const match = /^(alias|function|builtin) ([\p{L}\p{N}_.+\-]{1,128})$/u.exec(line);
    // Precedence follows what a shell runs: alias, then function, then builtin.
    if (!match) continue;
    const previous = result.get(match[2]!);
    if (previous === 'alias' || (previous === 'function' && match[1] === 'builtin')) continue;
    result.set(match[2]!, match[1] as CommandType);
  }
  return result;
}

/** Executed only by the existing managed-shell precmd trust boundary. */
export function shellKnowledgeBootstrap(path: string): string {
  const target = "'" + path.replace(/'/gu, "'\\''") + "'";
  return `
function nmsh_capture_knowledge {
  setopt localoptions extendedglob noksharrays
  local nmsh_name nmsh_type
  integer nmsh_bytes=0 nmsh_count=0 nmsh_partial=0
  {
    # Background and stopped jobs, so NMSh can refuse to end them by switching shells.
    builtin printf 'jobs %d\\n' \${#jobstates}
    for nmsh_type in alias function; do
      local -a nmsh_names
      if [[ $nmsh_type == alias ]]; then nmsh_names=(\${(ok)aliases}); else nmsh_names=(\${(ok)functions}); fi
      for nmsh_name in "\${nmsh_names[@]}"; do
        if [[ $nmsh_name != [[:alnum:]_.+-]## || \${#nmsh_name} -gt 128 ]]; then
          nmsh_partial=1
          continue
        fi
        # UTF-8 needs at most four bytes per accepted code point.
        (( nmsh_bytes += 4 * \${#nmsh_name} + 10 ))
        if (( ++nmsh_count > 4096 || nmsh_bytes > 65500 )); then
          builtin printf 'partial\\n'
          return
        fi
        builtin printf '%s %s\\n' "$nmsh_type" "$nmsh_name"
      done
    done
    if (( nmsh_partial )); then builtin printf 'partial\\n'; else builtin printf 'complete\\n'; fi
  } > ${target}
}
`;
}

export type ShellFailure = 'command-not-found' | 'syntax-error';
/** Evidence labels complement existing lifecycle UI; status alone is insufficient. */
export function classifyShellFailure(command: string, exitCode: number, output: string): ShellFailure | undefined {
  const lines = stripAnsi(output).split('\n').map(line => line.trim());
  const word = /^([A-Za-z_][A-Za-z0-9_.+-]*)(?:\s|$)/u.exec(command)?.[1];
  if (exitCode === 127 && word && lines.some(line => /^(?:zsh(?::[^:]+)*: |nmsh: )command not found: /u.test(line)
    && line.replace(/^(?:zsh(?::[^:]+)*: |nmsh: )command not found: /u, '') === word)) return 'command-not-found';
  // Bash: "bash: foo: command not found"; Fish: "fish: Unknown command: foo".
  if (exitCode === 127 && word && lines.some(line => line === `bash: ${word}: command not found` || line === `fish: Unknown command: ${word}`)) return 'command-not-found';
  if (exitCode !== 0 && lines.some(line => /^zsh(?::[^:]+)*: (?:parse error|unmatched)/u.test(line))) return 'syntax-error';
  if (exitCode !== 0 && lines.some(line => /^bash: (?:-c: )?(?:line \d+: )?syntax error/u.test(line))) return 'syntax-error';
  return;
}
