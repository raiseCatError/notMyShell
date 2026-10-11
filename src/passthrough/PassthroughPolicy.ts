const FULL_SCREEN_COMMANDS = new Set([
  'vim', 'nvim', 'vi', 'nano', 'less', 'more', 'top', 'htop', 'fzf', 'ssh', 'claude', 'codex',
]);

function shellWords(command: string): string[] {
  return command.trim().split(/\s+/u);
}

export function shouldPassthrough(command: string): boolean {
  const words = shellWords(command);
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? '')) index += 1;
  if (words[index] === 'command' || words[index] === 'exec' || words[index] === 'sudo') index += 1;
  if (words[index] === 'env') {
    index += 1;
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? '')) index += 1;
  }
  const executable = (words[index] ?? '').split('/').pop() ?? '';
  return FULL_SCREEN_COMMANDS.has(executable) || startsMultiplexerClient(executable, words.slice(index + 1));
}

/**
 * Terminal multiplexers become interactive clients that need the real terminal from their first byte (their
 * startup queries, size and modes). Only invocations that start or attach a client hand it over; `tmux ls`,
 * `tmux kill-server`, `screen -ls` and the like print and exit, so their output stays in the transcript.
 */
const TMUX_CLIENT_COMMANDS = new Set(['new', 'new-session', 'attach', 'attach-session', 'a', 'at']);
function startsMultiplexerClient(executable: string, args: readonly string[]): boolean {
  // Global options come before the command; those taking a value consume the next word.
  const command = (valueOptions: RegExp) => {
    for (let index = 0; index < args.length; index++) {
      const word = args[index]!;
      if (!word.startsWith('-')) return word;
      if (valueOptions.test(word)) index += 1;
    }
    return undefined;
  };
  if (executable === 'tmux') {
    const subcommand = command(/^-[cfLST]$/u);
    return subcommand === undefined ? !args.some(word => word === '-c' || word === '-V') : TMUX_CLIENT_COMMANDS.has(subcommand);
  }
  if (executable === 'screen') return !args.some(word => /^-(ls|list|wipe|v|version|help|Q|X)$/u.test(word));
  if (executable === 'zellij') {
    const subcommand = command(/^-(c|-config|-config-dir|l|-layout|s|-session|-data-dir)$/u);
    return subcommand === undefined || subcommand === 'attach' || subcommand === 'a';
  }
  return false;
}

