export interface SlashCommand {
  name: string;
  insertion: string;
  description: string;
}

export const slashCommands: readonly SlashCommand[] = [
  {name: '/copy', insertion: '/copy', description: 'Copy latest command output'},
  {name: '/copy N', insertion: '/copy ', description: 'Copy Nth previous output'},
  {name: '/appearance', insertion: '/appearance', description: 'Configure terminal appearance'},
  {name: '/keyboard', insertion: '/keyboard', description: 'Configure keyboard integration'},
  {name: '/help', insertion: '/help', description: 'Show NMSh commands'},
];

export type ParsedSlashCommand =
  | {kind: 'copy'; index: number}
  | {kind: 'appearance'}
  | {kind: 'keyboard'}
  | {kind: 'help'}
  | {kind: 'unknown'; input: string};

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  if (!input.startsWith('/')) return undefined;
  const match = /^\/copy(?:\s+([1-9]\d*))?\s*$/u.exec(input);
  if (match) return {kind: 'copy', index: Number(match[1] ?? '1')};
  if (/^\/appearance\s*$/u.test(input)) return {kind: 'appearance'};
  if (/^\/keyboard\s*$/u.test(input)) return {kind: 'keyboard'};
  if (/^\/help\s*$/u.test(input)) return {kind: 'help'};
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
