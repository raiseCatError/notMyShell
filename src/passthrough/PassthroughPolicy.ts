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
  return FULL_SCREEN_COMMANDS.has(executable);
}

