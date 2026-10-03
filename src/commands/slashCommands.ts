export interface SlashCommand {
  name: string;
  insertion: string;
  description: string;
}

export const slashCommands: readonly SlashCommand[] = [
  {name: '/effects', insertion: '/effects ', description: 'Preview sparkles or rain in owned chrome; /effects stop cancels'},
  {name: '/copy', insertion: '/copy', description: 'Copy latest command output'},
  {name: '/copy N', insertion: '/copy ', description: 'Copy Nth previous output'},
  {name: '/appearance', insertion: '/appearance', description: 'Configure terminal appearance'},
  {name: '/prompt', insertion: '/prompt', description: 'Configure prompt provider and composer layout'},
  {name: '/chroma', insertion: '/chroma', description: 'Chroma palettes, motion and custom gradients for the Native prompt'},
  {name: '/settings', insertion: '/settings', description: 'Open NMSh settings (Config view)'},
  {name: '/tools', insertion: '/tools', description: 'Browse optional tools, installation previews and supported configuration'},
  {name: '/config', insertion: '/config', description: 'Open NMSh settings (Config view)'},
  {name: '/status', insertion: '/status', description: 'Show NMSh status'},
  {name: '/syntax', insertion: '/syntax', description: 'Configure syntax highlighting'},
  {name: '/layout', insertion: '/layout', description: 'Preview and choose composer position and transcript presentation'},
  {name: '/transcript', insertion: '/transcript', description: 'Configure historical prompts and dividers'},
  {name: '/keyboard', insertion: '/keyboard', description: 'Configure keyboard integration'},
  {name: '/zsh', insertion: '/zsh', description: 'Return to an ordinary interactive zsh'},
  {name: '/version', insertion: '/version', description: 'Show this compiled NMSh build identity'},
  {name: '/update', insertion: '/update', description: 'Check for a newer NMSh release'},
  {name: '/update apply', insertion: '/update apply', description: 'Install the release that /update offered'},
  {name: '/clear', insertion: '/clear', description: 'Archive this transcript and start a fresh view'},
  {name: '/presets', insertion: '/presets', description: 'Create, inspect and launch named session presets'},
  {name: '/resume', insertion: '/resume', description: 'Browse archived NMSh transcripts'},
  {name: '/help', insertion: '/help', description: 'Show NMSh commands'},
  {name: '/palette', insertion: '/palette', description: 'Search NMSh actions (Ctrl+Shift+P / F1)'},
  {name: '/dirs', insertion: '/dirs ', description: 'Find a directory; insert a visible cd command'},
  {name: '/history', insertion: '/history ', description: 'Search history'},
];

export type ParsedSlashCommand =
  | {kind: 'effects'; effect: 'sparkles' | 'rain' | 'stop' | 'help'; placement: 'top' | 'bottom'}
  | {kind: 'copy'; index: number}
  | {kind: 'appearance'}
  | {kind: 'prompt'}
  | {kind: 'chroma'}
  | {kind: 'tools'}
  | {kind: 'settings'; view: 'config' | 'status'}
  | {kind: 'transcript'}
  | {kind: 'syntax'}
  | {kind: 'layout'}
  | {kind: 'keyboard'}
  | {kind: 'zsh'}
  | {kind: 'version'}
  | {kind: 'update'; apply: boolean}
  | {kind: 'clear'}
  | {kind: 'presets'}
  | {kind: 'resume'}
  | {kind: 'help'}
  | {kind: 'palette'}
  | {kind: 'directories', query: string}
  | {kind: 'history', query: string}
  | {kind: 'unknown'; input: string};

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  if (!input.startsWith('/')) return undefined;
  const effect = /^\/effects(?:\s+(sparkles|rain|stop))?(?:\s+(top|bottom))?\s*$/u.exec(input);
  if (effect) return {kind: 'effects', effect: (effect[1] ?? 'help') as 'sparkles' | 'rain' | 'stop' | 'help', placement: (effect[2] ?? 'bottom') as 'top' | 'bottom'};
  const match = /^\/copy(?:\s+([1-9]\d*))?\s*$/u.exec(input);
  if (match) return {kind: 'copy', index: Number(match[1] ?? '1')};
  if (/^\/appearance\s*$/u.test(input)) return {kind: 'appearance'};
  if (/^\/prompt\s*$/u.test(input)) return {kind: 'prompt'};
  if (/^\/chroma\s*$/u.test(input)) return {kind: 'chroma'};
  if (/^\/tools\s*$/u.test(input)) return {kind: 'tools'};
  if (/^\/(?:settings|config)\s*$/u.test(input)) return {kind: 'settings', view: 'config'};
  if (/^\/status\s*$/u.test(input)) return {kind: 'settings', view: 'status'};
  if (/^\/transcript\s*$/u.test(input)) return {kind: 'transcript'};
  if (/^\/syntax\s*$/u.test(input)) return {kind: 'syntax'};
  if (/^\/layout\s*$/u.test(input)) return {kind: 'layout'};
  if (/^\/keyboard\s*$/u.test(input)) return {kind: 'keyboard'};
  if (/^\/zsh\s*$/u.test(input)) return {kind: 'zsh'};
  if (/^\/version\s*$/u.test(input)) return {kind: 'version'};
  const update = /^\/update(?:\s+(apply))?\s*$/u.exec(input);
  if (update) return {kind: 'update', apply: update[1] === 'apply'};
  if (/^\/clear\s*$/u.test(input)) return {kind: 'clear'};
  if (/^\/presets\s*$/u.test(input)) return {kind: 'presets'};
  if (/^\/resume\s*$/u.test(input)) return {kind: 'resume'};
  if (/^\/help\s*$/u.test(input)) return {kind: 'help'};
  if (/^\/palette\s*$/u.test(input)) return {kind: 'palette'};
  const directories = /^\/dirs(?:\s+([\s\S]*))?$/u.exec(input);
  if (directories) return {kind: 'directories', query: (directories[1] ?? '').trim()};
  const history = /^\/history(?:\s+([\s\S]*))?$/u.exec(input);
  if (history) return {kind: 'history', query: (history[1] ?? '').trim()};
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
