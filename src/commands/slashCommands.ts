export interface SlashCommand {
  name: string;
  insertion: string;
  description: string;
}

export const slashCommands: readonly SlashCommand[] = [
  {name: '/copy', insertion: '/copy', description: 'Copy latest command output'},
  {name: '/copy N', insertion: '/copy ', description: 'Copy Nth previous output'},
  {name: '/appearance', insertion: '/appearance', description: 'Configure terminal appearance'},
  {name: '/prompt', insertion: '/prompt', description: 'Configure prompt provider and composer layout'},
  {name: '/settings', insertion: '/settings', description: 'Open NMSh settings (Config view)'},
  {name: '/config', insertion: '/config', description: 'Open NMSh settings (Config view)'},
  {name: '/status', insertion: '/status', description: 'Show NMSh status'},
  {name: '/syntax', insertion: '/syntax', description: 'Configure syntax highlighting'},
  {name: '/transcript', insertion: '/transcript', description: 'Configure historical prompts and dividers'},
  {name: '/keyboard', insertion: '/keyboard', description: 'Configure keyboard integration'},
  {name: '/zsh', insertion: '/zsh', description: 'Return to an ordinary interactive zsh'},
  {name: '/version', insertion: '/version', description: 'Show this compiled NMSh build identity'},
  {name: '/clear', insertion: '/clear', description: 'Archive this transcript and start a fresh view'},
  {name: '/resume', insertion: '/resume', description: 'Browse archived NMSh transcripts'},
  {name: '/help', insertion: '/help', description: 'Show NMSh commands'},
  {name: '/history', insertion: '/history ', description: 'Search history'},
];

export type ParsedSlashCommand =
  | {kind: 'copy'; index: number}
  | {kind: 'appearance'}
  | {kind: 'prompt'}
  | {kind: 'settings'; view: 'config' | 'status'}
  | {kind: 'transcript'}
  | {kind: 'syntax'}
  | {kind: 'keyboard'}
  | {kind: 'zsh'}
  | {kind: 'version'}
  | {kind: 'clear'}
  | {kind: 'resume'}
  | {kind: 'help'}
  | {kind: 'history', query: string}
  | {kind: 'unknown'; input: string};

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  if (!input.startsWith('/')) return undefined;
  const match = /^\/copy(?:\s+([1-9]\d*))?\s*$/u.exec(input);
  if (match) return {kind: 'copy', index: Number(match[1] ?? '1')};
  if (/^\/appearance\s*$/u.test(input)) return {kind: 'appearance'};
  if (/^\/prompt\s*$/u.test(input)) return {kind: 'prompt'};
  if (/^\/(?:settings|config)\s*$/u.test(input)) return {kind: 'settings', view: 'config'};
  if (/^\/status\s*$/u.test(input)) return {kind: 'settings', view: 'status'};
  if (/^\/transcript\s*$/u.test(input)) return {kind: 'transcript'};
  if (/^\/syntax\s*$/u.test(input)) return {kind: 'syntax'};
  if (/^\/keyboard\s*$/u.test(input)) return {kind: 'keyboard'};
  if (/^\/zsh\s*$/u.test(input)) return {kind: 'zsh'};
  if (/^\/version\s*$/u.test(input)) return {kind: 'version'};
  if (/^\/clear\s*$/u.test(input)) return {kind: 'clear'};
  if (/^\/resume\s*$/u.test(input)) return {kind: 'resume'};
  if (/^\/help\s*$/u.test(input)) return {kind: 'help'};
  if (input.startsWith('/history ')) return {kind: 'history', query: input.substring(9).trim()};
  return {kind: 'unknown', input};
}

export function slashSuggestions(input: string): SlashCommand[] {
  if (!input.startsWith('/') || input.includes('\n')) return [];
  return slashCommands.filter(command => command.name.startsWith(input) || command.insertion.startsWith(input));
}

export function suggestionWindow<T>(values: readonly T[], selected: number, height: number): {items: T[]; start: number} {
  const count = Math.max(0, Math.min(values.length, height));
  if (count === 0) return {items: [], start: 0};
  const safeSelected = Math.max(0, Math.min(values.length - 1, selected));
  const start = Math.max(0, Math.min(safeSelected - count + 1, values.length - count));
  return {items: values.slice(start, start + count), start};
}
