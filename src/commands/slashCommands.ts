import {IDLE_MODES, type IdleMode} from '../idle/scenes.js';
export interface SlashCommand {
  name: string;
  insertion: string;
  description: string;
}

export const slashCommands: readonly SlashCommand[] = [
  {name: '/effects', insertion: '/effects ', description: 'Preview sparkles, rain or confetti in owned chrome; /effects stop cancels'},
  {name: '/copy', insertion: '/copy', description: 'Copy latest command output'},
  {name: '/copy N', insertion: '/copy ', description: 'Copy Nth previous output'},
  {name: '/appearance', insertion: '/appearance', description: 'Configure terminal appearance'},
  {name: '/prompt', insertion: '/prompt', description: 'Configure prompt provider and composer layout'},
  {name: '/cursor', insertion: '/cursor', description: 'Text caret shape and blink while NMSh owns the composer'},
  {name: '/activity', insertion: '/activity', description: 'Live activity colors for the running-command line'},
  {name: '/screensaver', insertion: '/screensaver', description: 'Idle visuals: live gallery, timeout and colors'},
  {name: '/screensaver start', insertion: '/screensaver start', description: 'Start the selected idle visual now; any key or mouse stops it'},
  {name: '/theme', insertion: '/theme', description: 'Theme Studio: clone, edit, import and export a custom Native theme'},
  {name: '/chroma', insertion: '/chroma', description: 'Chroma palettes, motion and custom gradients for the Native prompt'},
  {name: '/settings', insertion: '/settings', description: 'Open NMSh settings (Config view)'},
  {name: '/setup', insertion: '/setup', description: 'Setup Cat: guided, rerunnable setup; keeps your current choices'},
  {name: '/setup prompt', insertion: '/setup prompt', description: 'Setup Cat: prompt provider and style'},
  {name: '/setup appearance', insertion: '/setup appearance', description: 'Setup Cat: theme, vibrance and Chroma'},
  {name: '/setup transcript', insertion: '/setup transcript', description: 'Setup Cat: transcript presentation, history colors, dividers and folding'},
  {name: '/setup tools', insertion: '/setup tools', description: 'Setup Cat: optional tools, update checks and install suggestions'},
  {name: '/tools', insertion: '/tools', description: 'Browse optional tools, installation previews and supported configuration'},
  {name: '/config', insertion: '/config', description: 'Open NMSh settings (Config view)'},
  {name: '/status', insertion: '/status', description: 'Show NMSh status'},
  {name: '/syntax', insertion: '/syntax', description: 'Configure syntax highlighting'},
  {name: '/layout', insertion: '/layout', description: 'Preview and choose composer position and transcript presentation'},
  {name: '/transcript', insertion: '/transcript', description: 'Configure historical prompts and dividers'},
  {name: '/keyboard', insertion: '/keyboard', description: 'Configure keyboard integration'},
  {name: '/shell', insertion: '/shell', description: 'Managed backend switcher: NMSh stays open; install missing shells; D sets the default'},
  {name: '/shell zsh', insertion: '/shell zsh', description: 'Switch this NMSh session to zsh (NMSh stays open)'},
  {name: '/shell fish', insertion: '/shell fish', description: 'Switch this NMSh session to Fish (NMSh stays open)'},
  {name: '/shell bash', insertion: '/shell bash', description: 'Switch this NMSh session to Bash (NMSh stays open)'},
  {name: '/zsh', insertion: '/zsh', description: 'Leave NMSh for an ordinary interactive zsh (ends this NMSh session)'},
  {name: '/fish', insertion: '/fish', description: 'Leave NMSh for an ordinary interactive Fish (ends this NMSh session)'},
  {name: '/bash', insertion: '/bash', description: 'Leave NMSh for an ordinary interactive Bash (ends this NMSh session)'},
  {name: '/exit', insertion: '/exit', description: 'Leave NMSh for your configured default shell (Settings → Default shell)'},
  {name: '/version', insertion: '/version', description: 'Show this compiled NMSh build identity'},
  {name: '/update', insertion: '/update', description: 'Check for a newer NMSh release'},
  {name: '/update apply', insertion: '/update apply', description: 'Install the release that /update offered'},
  {name: '/clear', insertion: '/clear', description: 'Archive this transcript and start a fresh view'},
  {name: '/presets', insertion: '/presets', description: 'Create, inspect and launch named session presets'},
  {name: '/sessions', insertion: '/sessions', description: 'Live NMSh sessions right now: switch to a detached one, kill one (nmsh --sessions outside)'},
  {name: '/resume', insertion: '/resume', description: 'Browse archived NMSh transcripts'},
  {name: '/find', insertion: '/find ', description: 'Add a find term (Ctrl+F); terms AND together. -r regex, -c case; /find remove N, /find clear'},
  {name: '/filter', insertion: '/filter ', description: 'Add a filter term to the newest/focused output (terms AND together; -v, -C N, -r, -c); /filter remove N, /filter clear'},
  {name: '/open', insertion: '/open', description: 'Open a path[:line[:column]] in your editor; alone, pick a reference from recent output'},
  {name: '/open-diff', insertion: '/open-diff ', description: 'Show two files in your editor\'s diff view (Zed, VS Code); nothing is rebuilt here'},
  {name: '/about', insertion: '/about', description: 'About NMSh: build identity and logo (inline image where the terminal supports it)'},
  {name: '/agents', insertion: '/agents', description: 'Local agent CLI activity: durations, runs and a heatmap (on/off/reset)'},
  {name: '/notices', insertion: '/notices', description: 'Cross-session notices above the composer (on/off/clear)'},
  {name: '/help', insertion: '/help', description: 'Show NMSh commands'},
  {name: '/palette', insertion: '/palette', description: 'Search NMSh actions (Ctrl+Shift+P / F1)'},
  {name: '/dirs', insertion: '/dirs ', description: 'Find a directory; insert a visible cd command'},
  {name: '/history', insertion: '/history ', description: 'Search history'},
];

export type ParsedSlashCommand =
  | {kind: 'effects'; effect: 'sparkles' | 'rain' | 'confetti' | 'stop' | 'help'; placement: 'top' | 'bottom'}
  | {kind: 'copy'; index: number}
  | {kind: 'appearance'}
  | {kind: 'prompt'}
  | {kind: 'chroma'}
  | {kind: 'theme'}
  | {kind: 'cursor'}
  | {kind: 'activity'}
  | {kind: 'screensaver'; start: boolean; mode?: IdleMode}
  | {kind: 'tools'}
  | {kind: 'setup'; entry?: string}
  | {kind: 'settings'; view: 'config' | 'status'}
  | {kind: 'transcript'}
  | {kind: 'syntax'}
  | {kind: 'layout'}
  | {kind: 'keyboard'}
  /** Leave NMSh for an ordinary shell; no shell means the configured default (/exit). */
  | {kind: 'handoff'; shell?: 'zsh' | 'fish' | 'bash'}
  | {kind: 'version'}
  | {kind: 'update'; apply: boolean}
  | {kind: 'clear'}
  | {kind: 'presets'}
  | {kind: 'resume'}
  | {kind: 'sessions'}
  | {kind: 'help'}
  | {kind: 'about'}
  | {kind: 'find'; arguments: string}
  | {kind: 'open'; target: string}
  | {kind: 'openDiff'; left: string; right: string}
  | {kind: 'filter'; arguments: string}
  | {kind: 'shell'; shell?: 'zsh' | 'fish' | 'bash'}
  | {kind: 'agents'; action: 'show' | 'on' | 'off' | 'reset'}
  | {kind: 'notices'; action: 'show' | 'on' | 'off' | 'clear'}
  | {kind: 'palette'}
  | {kind: 'directories', query: string}
  | {kind: 'history', query: string}
  | {kind: 'unknown'; input: string};

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  if (!input.startsWith('/')) return undefined;
  const effect = /^\/effects(?:\s+(sparkles|rain|confetti|stop))?(?:\s+(top|bottom))?\s*$/u.exec(input);
  if (effect) return {kind: 'effects', effect: (effect[1] ?? 'help') as 'sparkles' | 'rain' | 'confetti' | 'stop' | 'help', placement: (effect[2] ?? 'bottom') as 'top' | 'bottom'};
  const match = /^\/copy(?:\s+([1-9]\d*))?\s*$/u.exec(input);
  if (match) return {kind: 'copy', index: Number(match[1] ?? '1')};
  if (/^\/appearance\s*$/u.test(input)) return {kind: 'appearance'};
  if (/^\/prompt\s*$/u.test(input)) return {kind: 'prompt'};
  if (/^\/chroma\s*$/u.test(input)) return {kind: 'chroma'};
  if (/^\/theme\s*$/u.test(input)) return {kind: 'theme'};
  if (/^\/cursor\s*$/u.test(input)) return {kind: 'cursor'};
  if (/^\/activity\s*$/u.test(input)) return {kind: 'activity'};
  const screensaver = /^\/screensaver(?:\s+(start)(?:\s+(\w+))?)?\s*$/u.exec(input);
  if (screensaver && (!screensaver[2] || (IDLE_MODES as readonly string[]).includes(screensaver[2]))) {
    return {kind: 'screensaver', start: screensaver[1] === 'start', ...(screensaver[2] ? {mode: screensaver[2] as IdleMode} : {})};
  }
  if (/^\/tools\s*$/u.test(input)) return {kind: 'tools'};
  const setup = /^\/setup(?:\s+(prompt|appearance|chroma|tools|editor|transcript))?\s*$/u.exec(input);
  if (setup) return setup[1] ? {kind: 'setup', entry: setup[1]} : {kind: 'setup'};
  if (/^\/(?:settings|config)\s*$/u.test(input)) return {kind: 'settings', view: 'config'};
  if (/^\/status\s*$/u.test(input)) return {kind: 'settings', view: 'status'};
  if (/^\/transcript\s*$/u.test(input)) return {kind: 'transcript'};
  if (/^\/syntax\s*$/u.test(input)) return {kind: 'syntax'};
  if (/^\/layout\s*$/u.test(input)) return {kind: 'layout'};
  if (/^\/keyboard\s*$/u.test(input)) return {kind: 'keyboard'};
  const handoff = /^\/(zsh|fish|bash|exit)\s*$/u.exec(input);
  if (handoff) return handoff[1] === 'exit' ? {kind: 'handoff'} : {kind: 'handoff', shell: handoff[1] as 'zsh' | 'fish' | 'bash'};
  if (/^\/version\s*$/u.test(input)) return {kind: 'version'};
  const update = /^\/update(?:\s+(apply))?\s*$/u.exec(input);
  if (update) return {kind: 'update', apply: update[1] === 'apply'};
  if (/^\/clear\s*$/u.test(input)) return {kind: 'clear'};
  if (/^\/presets\s*$/u.test(input)) return {kind: 'presets'};
  if (/^\/resume\s*$/u.test(input)) return {kind: 'resume'};
  if (/^\/sessions\s*$/u.test(input)) return {kind: 'sessions'};
  if (/^\/help\s*$/u.test(input)) return {kind: 'help'};
  if (/^\/about\s*$/u.test(input)) return {kind: 'about'};
  const openDiff = /^\/open-diff(?:\s+("[^"]+"|'[^']+'|\S+))?(?:\s+("[^"]+"|'[^']+'|\S+))?\s*$/u.exec(input);
  if (openDiff) return {kind: 'openDiff', left: (openDiff[1] ?? '').replace(/^["']|["']$/gu, ''), right: (openDiff[2] ?? '').replace(/^["']|["']$/gu, '')};
  const open = /^\/open(?:\s+([\s\S]*))?$/u.exec(input);
  if (open) return {kind: 'open', target: (open[1] ?? '').trim()};
  const find = /^\/find(?:\s+([\s\S]*))?$/u.exec(input);
  if (find) return {kind: 'find', arguments: find[1] ?? ''};
  const filter = /^\/filter(?:\s+([\s\S]*))?$/u.exec(input);
  if (filter) return {kind: 'filter', arguments: filter[1] ?? ''};
  const shell = /^\/shell(?:\s+(zsh|fish|bash))?\s*$/u.exec(input);
  if (shell) return shell[1] ? {kind: 'shell', shell: shell[1] as 'zsh' | 'fish' | 'bash'} : {kind: 'shell'};
  const agents = /^\/agents(?:\s+(on|off|reset))?\s*$/u.exec(input);
  if (agents) return {kind: 'agents', action: (agents[1] ?? 'show') as 'show' | 'on' | 'off' | 'reset'};
  const notices = /^\/notices(?:\s+(on|off|clear))?\s*$/u.exec(input);
  if (notices) return {kind: 'notices', action: (notices[1] ?? 'show') as 'show' | 'on' | 'off' | 'clear'};
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
