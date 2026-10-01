import type {CommandType} from './SemanticService.js';
import {stripAnsi} from '../util/text.js';

export const MAX_SHELL_KNOWLEDGE_BYTES = 65536;

/** Names only: no alias expansion, function body, environment value or evaluation. */
export function parseShellKnowledge(text: string): Map<string, CommandType> {
  const result = new Map<string, CommandType>();
  if (Buffer.byteLength(text) > MAX_SHELL_KNOWLEDGE_BYTES) return result;
  for (const line of text.split('\n').slice(0, 4097)) {
    const match = /^(alias|function) ([A-Za-z0-9_.+\-]{1,128})$/u.exec(line);
    if (match && result.get(match[2]!) !== 'alias') result.set(match[2]!, match[1] as CommandType);
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
  integer nmsh_bytes=0 nmsh_count=0
  {
    for nmsh_type in alias function; do
      local -a nmsh_names
      if [[ $nmsh_type == alias ]]; then nmsh_names=(\${(ok)aliases}); else nmsh_names=(\${(ok)functions}); fi
      for nmsh_name in "\${nmsh_names[@]}"; do
        [[ $nmsh_name == [A-Za-z0-9_.+-]## && \${#nmsh_name} -le 128 ]] || continue
        (( nmsh_bytes += \${#nmsh_name} + 10 ))
        (( ++nmsh_count > 4096 || nmsh_bytes > 65536 )) && return
        builtin printf '%s %s\\n' "$nmsh_type" "$nmsh_name"
      done
    done
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
  if (exitCode !== 0 && lines.some(line => /^zsh(?::[^:]+)*: (?:parse error|unmatched)/u.test(line))) return 'syntax-error';
  return;
}
