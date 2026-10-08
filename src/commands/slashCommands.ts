import {IDLE_MODES, type IdleMode} from '../idle/scenes.js';
export type CommandGroup = 'Appearance' | 'Composer & transcript' | 'Providers' | 'Tools & integration';

export interface SlashCommand {
  name: string;
  insertion: string;
  description: string;
  /** /help section for substantial surfaces; ungrouped commands are listed under "More commands". */
  group?: CommandGroup;
  /** Human palette label ("Open Motion"); the command name is shown beside it. */
  title?: string;
  /** Another spelling of a canonical command: parsed to the same action, not listed twice. */
  alias?: string;
}

/** Group, palette title and alias metadata for the substantial surfaces, in one place. */
const META: Record<string, Pick<SlashCommand, 'group' | 'title' | 'alias'>> = {
  '/appearance': {group: 'Appearance', title: 'Open Appearance'}, '/theme': {group: 'Appearance', title: 'Open Theme Studio'},
  '/theme-bridge': {group: 'Appearance', title: 'Open Theme Bridge'}, '/chroma': {group: 'Appearance', title: 'Open Chroma'},
  '/chrome': {group: 'Appearance', title: 'Open UI Chrome'}, '/cursor': {group: 'Appearance', title: 'Open Cursor & effects'},
  '/motion': {group: 'Appearance', title: 'Open Motion'}, '/glyphs': {group: 'Appearance', title: 'Configure Glyph Style'},
  '/strip': {group: 'Appearance', title: 'Configure Status Strip'}, '/status-strip': {alias: '/strip'},
  '/screensaver': {group: 'Appearance', title: 'Open Idle visuals'}, '/activity': {group: 'Appearance', title: 'Open Live activity colors'},
  '/prompt': {group: 'Composer & transcript', title: 'Open Prompt'}, '/modules': {group: 'Composer & transcript', title: 'Open Modules'}, '/layout': {group: 'Composer & transcript', title: 'Configure Composer Layout'},
  '/composer': {alias: '/layout'}, '/syntax': {group: 'Composer & transcript', title: 'Open Syntax highlighting'},
  '/transcript': {group: 'Composer & transcript', title: 'Open Transcript appearance'}, '/keyboard': {group: 'Composer & transcript', title: 'Open Keyboard'},
  '/providers': {group: 'Providers', title: 'Open Providers'}, '/picker': {group: 'Providers', title: 'Configure Picker Provider'}, '/pickers': {alias: '/picker'},
  '/suggestions': {group: 'Providers', title: 'Configure Suggestions Provider'}, '/navigation': {group: 'Providers', title: 'Configure Directory Navigation'},
  '/welcome': {group: 'Providers', title: 'Configure Welcome'}, '/history-provider': {group: 'Providers', title: 'Configure History Provider'},
  '/tools': {group: 'Tools & integration', title: 'Open Tools'}, '/configure': {group: 'Tools & integration', title: 'Open Tool Configuration'},
  '/tmux': {group: 'Tools & integration', title: 'Configure tmux'}, '/integrations': {group: 'Tools & integration', title: 'Check Integrations'},
  '/dotfiles': {group: 'Tools & integration', title: 'Import Dotfiles'},
  '/btw': {title: 'Open local intelligence'}, '/ask': {alias: '/btw'},
  '/caffeinate': {group: 'Tools & integration', title: 'Open Keep Awake'}, '/awake': {alias: '/caffeinate'}, '/zoomies': {alias: '/caffeinate'},
};

const RAW_COMMANDS: readonly SlashCommand[] = [
  {name: '/effects', insertion: '/effects ', description: 'Preview sparkles, rain or confetti in owned chrome; /effects stop cancels'},
  {name: '/copy', insertion: '/copy', description: 'Copy latest command output'},
  {name: '/copy N', insertion: '/copy ', description: 'Copy Nth previous output'},
  {name: '/appearance', insertion: '/appearance', description: 'Configure terminal appearance'},
  {name: '/motion', insertion: '/motion', description: 'Motion: context transitions, command launch, completion highlight and effects (same as /appearance → Motion)'},
  {name: '/prompt', insertion: '/prompt', description: 'Configure prompt provider and composer layout'},
  {name: '/modules', insertion: '/modules', description: 'Context modules, catalog and Context Packs: show, route to a surface, search; saved as you change them'},
  {name: '/cursor', insertion: '/cursor', description: 'Text caret shape and blink while NMSh owns the composer'},
  {name: '/activity', insertion: '/activity', description: 'Live activity colors for the running-command line'},
  {name: '/screensaver', insertion: '/screensaver', description: 'Idle visuals: live gallery, timeout and colors'},
  {name: '/screensaver start', insertion: '/screensaver start', description: 'Start the selected idle visual now; any key or mouse stops it'},
  {name: '/theme', insertion: '/theme', description: 'Theme Studio: built-in, imported and custom Native themes; create, edit, import, export, select'},
  {name: '/theme-bridge', insertion: '/theme-bridge', description: 'Theme Bridge: extend NMSh themes to fzf, less/man, LS_COLORS, tmux, Neovim, Vim and Helix (opt-in per tool)'},
  {name: '/chroma', insertion: '/chroma', description: 'Chroma palettes, motion and custom gradients for the Native prompt'},
  {name: '/settings', insertion: '/settings', description: 'Open NMSh settings (Config view)'},
  {name: '/setup', insertion: '/setup', description: 'Setup Cat: guided, rerunnable setup; keeps your current choices'},
  {name: '/setup prompt', insertion: '/setup prompt', description: 'Setup Cat: prompt provider and style'},
  {name: '/setup appearance', insertion: '/setup appearance', description: 'Setup Cat: theme, vibrance and Chroma'},
  {name: '/setup transcript', insertion: '/setup transcript', description: 'Setup Cat: transcript presentation, history colors, dividers and folding'},
  {name: '/setup cursor', insertion: '/setup cursor', description: 'Setup Cat: cursor shape, effects and colors, with a live preview'},
  {name: '/setup syntax', insertion: '/setup syntax', description: 'Setup Cat: editor, syntax colors and suggestions'},
  {name: '/setup tools', insertion: '/setup tools', description: 'Setup Cat: optional tools, update checks and install suggestions'},
  {name: '/caffeinate', insertion: '/caffeinate', description: 'Keep Awake: keep the computer or display awake (idle, display, system, all; optional 30m/2h; status, stop). Uses the OS mechanism'},
  {name: '/awake', insertion: '/awake', description: 'Same as /caffeinate (Keep Awake)'},
  {name: '/zoomies', insertion: '/zoomies', description: 'Same as /caffeinate (Keep Awake)'},
  {name: '/tools', insertion: '/tools', description: 'Browse optional tools, installation previews and supported configuration'},
  {name: '/config', insertion: '/config', description: 'Open NMSh settings (Config view)'},
  {name: '/status', insertion: '/status', description: 'Show NMSh status'},
  {name: '/syntax', insertion: '/syntax', description: 'Configure syntax highlighting'},
  {name: '/layout', insertion: '/layout', description: 'Preview and choose composer position and transcript presentation'},
  {name: '/composer', insertion: '/composer', description: 'Composer position and transcript presentation (same as /layout)'},
  {name: '/chrome', insertion: '/chrome', description: 'UI chrome: NMSh frames, rules, tabs, selection and accents (not Chroma)'},
  {name: '/glyphs', insertion: '/glyphs', description: 'Glyph style: compare Nerd Font and Safe / ASCII symbols and icons'},
  {name: '/strip', insertion: '/strip', description: 'Status Strip Studio: top or bottom row, left/center/right groups, style, presets and system items, with a live preview'},
  {name: '/status-strip', insertion: '/status-strip', description: 'Same as /strip'},
  {name: '/configure', insertion: '/configure ', description: 'Tool Configuration: supported settings for tmux, Starship and other registered tools'},
  {name: '/tmux', insertion: '/tmux', description: 'Configure tmux: settings, keys, Status Studio, new panes start NMSh, theme'},
  {name: '/integrations', insertion: '/integrations', description: 'Integrations health: review and update every managed integration'},
  {name: '/dotfiles', insertion: '/dotfiles ', description: 'Import supported settings from a dotfiles repository (reviewed, nothing executed)'},
  {name: '/transcript', insertion: '/transcript', description: 'Choose Normal/Chat presentation, historical prompts, dividers and folding'},
  {name: '/keyboard', insertion: '/keyboard', description: 'Configure keyboard integration'},
  {name: '/shell', insertion: '/shell', description: 'Managed backend switcher: NMSh stays open; install missing shells; D sets the default'},
  {name: '/shell zsh', insertion: '/shell zsh', description: 'Switch this NMSh session to zsh (NMSh stays open)'},
  {name: '/shell fish', insertion: '/shell fish', description: 'Switch this NMSh session to Fish (NMSh stays open)'},
  {name: '/shell bash', insertion: '/shell bash', description: 'Switch this NMSh session to Bash (NMSh stays open)'},
  {name: '/zsh', insertion: '/zsh', description: 'Leave NMSh for an ordinary zsh; this session waits, and `nmsh` there returns to it'},
  {name: '/fish', insertion: '/fish', description: 'Leave NMSh for an ordinary Fish; this session waits, and `nmsh` there returns to it'},
  {name: '/bash', insertion: '/bash', description: 'Leave NMSh for an ordinary Bash; this session waits, and `nmsh` there returns to it'},
  {name: '/exit', insertion: '/exit', description: 'Leave NMSh for your configured default shell (Settings → Default shell)'},
  {name: '/version', insertion: '/version', description: 'Show this compiled NMSh build identity'},
  {name: '/update', insertion: '/update', description: 'Check for a newer NMSh release'},
  {name: '/update apply', insertion: '/update apply', description: 'Install the release that /update offered'},
  {name: '/clear', insertion: '/clear', description: 'Archive this transcript and start a fresh view'},
  {name: '/btw', insertion: '/btw ', description: 'Local intelligence: ask NMSh in plain English'},
  {name: '/ask', insertion: '/ask ', description: 'Compatibility alias for /btw'},
  {name: '/ai', insertion: '/ai', description: 'Agent sessions: Claude Code and other harnesses running in the background; /ai claude starts one'},
  {name: '/claude', insertion: '/claude', description: 'Focus or start a managed Claude target; new forces fresh; mods opens inventory'},
  {name: '/codex', insertion: '/codex', description: 'Managed Codex routing where supported; mods opens inventory'},
  {name: '/mods', insertion: '/mods', description: 'Unified portable mods, provider-native extensions and Context Packs'},
  {name: '/extensions', insertion: '/extensions', description: 'Alias of /mods'},
  {name: '/worktrees', insertion: '/worktrees', description: 'This repository\'s Git worktrees: open one, create or remove with a reviewed plan'},
  {name: '/github', insertion: '/github', description: 'Read-only GitHub workspace for this repository: PRs, issues, checks and diffs (uses gh)'},
  {name: '/prs', insertion: '/prs', description: 'Open pull requests in the GitHub workspace'},
  {name: '/issues', insertion: '/issues', description: 'Open issues in the GitHub workspace'},
  {name: '/nmsh', insertion: '/nmsh raw ', description: 'Raw provider escape: /nmsh raw claude or codex with native CLI args'},
  {name: '/guide', insertion: '/guide', description: 'Interactive guide to everything NMSh can do'},
  {name: '/rename', insertion: '/rename ', description: 'Name this live session (display only); /rename alone returns to its familiar signature'},
  {name: '/watch', insertion: '/watch ', description: 'Run a command repeatedly and show what changed (/watch git status · --every 10s · /watch stop|pause|resume)'},
  {name: '/doctor', insertion: '/doctor', description: 'Health check: NMSh, shell, project, Git, tools, local model and host (local, read-only)'},
  {name: '/llm', insertion: '/llm', description: 'Local Intelligence: the optional local model for Ask and Smart Folding (status, setup, stop, remove)'},
  {name: '/providers', insertion: '/providers', description: 'What NMSh uses for prompt, welcome, suggestions, history and more; switch, install, detect'},
  {name: '/picker', insertion: '/picker', description: 'Picker provider (NMSh Native, fzf, Television) in /providers'},
  {name: '/pickers', insertion: '/pickers', description: 'Same as /picker'},
  {name: '/suggestions', insertion: '/suggestions', description: 'Ghost-text suggestions provider in /providers'},
  {name: '/navigation', insertion: '/navigation', description: 'Directory navigation provider (NMSh Native, zoxide) in /providers'},
  {name: '/welcome', insertion: '/welcome', description: 'Welcome provider (Vespyr, fastfetch, …) in /providers'},
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
  {name: '/history-provider', insertion: '/history-provider', description: 'History provider (NMSh Native, Atuin) in /providers; /history is history search'},
];

export const slashCommands: readonly SlashCommand[] = RAW_COMMANDS.map(command => ({...command, ...META[command.name]}));


export type ParsedSlashCommand =
  | {kind: 'effects'; effect: 'sparkles' | 'rain' | 'confetti' | 'stop' | 'help'; placement: 'top' | 'bottom'}
  | {kind: 'copy'; index: number}
  | {kind: 'appearance'}
  | {kind: 'motion'}
  | {kind: 'prompt'}
  | {kind: 'modules'}
  | {kind: 'chroma'}
  | {kind: 'theme'}
  | {kind: 'themeBridge'}
  | {kind: 'cursor'}
  | {kind: 'activity'}
  | {kind: 'screensaver'; start: boolean; mode?: IdleMode}
  | {kind: 'tools'}
  /** /caffeinate, /awake and /zoomies: one Keep Awake action. A timeout is a validated number of seconds; `invalid` names bad input. */
  | {kind: 'keepAwake'; op: 'panel' | 'status' | 'stop' | 'start'; mode?: 'idle' | 'display' | 'system' | 'all'; timeoutSeconds?: number; invalid?: string}
  | {kind: 'setup'; entry?: string}
  | {kind: 'settings'; view: 'config' | 'status'}
  | {kind: 'transcript'}
  | {kind: 'syntax'}
  | {kind: 'layout'}
  | {kind: 'chrome'}
  | {kind: 'glyphs'}
  | {kind: 'statusStrip'}
  | {kind: 'configure'; tool?: string}
  | {kind: 'integrations'}
  | {kind: 'dotfiles'; source?: string}
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
  | {kind: 'ask'; request: string}
  /** Agent sessions: /ai opens the list; /ai <harness or profile> starts one in the background. */
  | {kind: 'ai'; target?: string}
  | {kind: 'mods'; provider?: string}
  | {kind: 'worktrees'}
  | {kind: 'github'; tab: 'prs' | 'issues' | 'search'}
  | {kind: 'managedTarget'; provider: 'claude' | 'codex'; action: 'open' | 'new'}
  | {kind: 'rawProvider'; command?: string}
  | {kind: 'providers'; family?: 'prompt' | 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation'}
  | {kind: 'llm'}
  | {kind: 'doctor'}
  | {kind: 'watch'; op: 'list' | 'stop' | 'pause' | 'resume' | 'now' | 'start'; arguments: string}
  | {kind: 'rename'; name: string}
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
  if (/^\/motion\s*$/u.test(input)) return {kind: 'motion'};
  if (/^\/prompt\s*$/u.test(input)) return {kind: 'prompt'};
  if (/^\/modules\s*$/u.test(input)) return {kind: 'modules'};
  if (/^\/chroma\s*$/u.test(input)) return {kind: 'chroma'};
  if (/^\/theme\s*$/u.test(input)) return {kind: 'theme'};
  if (/^\/theme-bridge\s*$/u.test(input)) return {kind: 'themeBridge'};
  if (/^\/cursor\s*$/u.test(input)) return {kind: 'cursor'};
  if (/^\/activity\s*$/u.test(input)) return {kind: 'activity'};
  const screensaver = /^\/screensaver(?:\s+(start)(?:\s+(\w+))?)?\s*$/u.exec(input);
  if (screensaver && (!screensaver[2] || (IDLE_MODES as readonly string[]).includes(screensaver[2]))) {
    return {kind: 'screensaver', start: screensaver[1] === 'start', ...(screensaver[2] ? {mode: screensaver[2] as IdleMode} : {})};
  }
  if (/^\/tools\s*$/u.test(input)) return {kind: 'tools'};
  // Unlisted compatibility spelling; /caffeinate stop is the documented form.
  if (/^\/caffeinate-stop\s*$/u.test(input)) return {kind: 'keepAwake', op: 'stop'};
  const awake = /^\/(?:caffeinate|awake|zoomies)(?:\s+(\S+))?(?:\s+(\S+))?\s*$/u.exec(input);
  if (awake) {
    const [, word, duration] = awake;
    if (!word) return {kind: 'keepAwake', op: 'panel'};
    if ((word === 'status' || word === 'stop') && !duration) return {kind: 'keepAwake', op: word};
    if (word === 'idle' || word === 'display' || word === 'system' || word === 'all') {
      if (!duration) return {kind: 'keepAwake', op: 'start', mode: word};
      const match = /^([1-9]\d{0,5})([smh])$/u.exec(duration);
      const seconds = match ? Number(match[1]) * (match[2] === 'h' ? 3600 : match[2] === 'm' ? 60 : 1) : 0;
      return seconds && seconds <= 7 * 24 * 3600 ? {kind: 'keepAwake', op: 'start', mode: word, timeoutSeconds: seconds} : {kind: 'keepAwake', op: 'panel', invalid: duration};
    }
    return {kind: 'keepAwake', op: 'panel', invalid: word};
  }
  const setup = /^\/setup(?:\s+(prompt|appearance|chroma|tools|editor|transcript|cursor|syntax|motion|sessions|shell|ask))?\s*$/u.exec(input);
  if (setup) return setup[1] ? {kind: 'setup', entry: setup[1]} : {kind: 'setup'};
  if (/^\/(?:settings|config)\s*$/u.test(input)) return {kind: 'settings', view: 'config'};
  if (/^\/status\s*$/u.test(input)) return {kind: 'settings', view: 'status'};
  if (/^\/transcript\s*$/u.test(input)) return {kind: 'transcript'};
  if (/^\/syntax\s*$/u.test(input)) return {kind: 'syntax'};
  // Aliases normalize to one action kind: /composer is /layout, /glyph(s) one panel, /strip and /status-strip one panel.
  if (/^\/(?:layout|composer)\s*$/u.test(input)) return {kind: 'layout'};
  if (/^\/chrome\s*$/u.test(input)) return {kind: 'chrome'};
  if (/^\/glyphs?\s*$/u.test(input)) return {kind: 'glyphs'};
  if (/^\/(?:strip|status-strip)\s*$/u.test(input)) return {kind: 'statusStrip'};
  if (/^\/tmux\s*$/u.test(input)) return {kind: 'configure', tool: 'tmux'};
  const configure = /^\/configure(?:\s+([A-Za-z0-9_.+-]{1,40}))?\s*$/u.exec(input);
  if (configure) return configure[1] ? {kind: 'configure', tool: configure[1].toLowerCase()} : {kind: 'configure'};
  if (/^\/integrations\s*$/u.test(input)) return {kind: 'integrations'};
  const dotfiles = /^\/dotfiles(?:\s+(.{1,1024}))?\s*$/u.exec(input);
  if (dotfiles) return dotfiles[1]?.trim() ? {kind: 'dotfiles', source: dotfiles[1].trim()} : {kind: 'dotfiles'};
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
  if (/^\/guide\s*$/u.test(input)) return {kind: 'ask', request: 'guide'};
  const ai = /^\/ai(?:\s+([\w.-]{1,40}))?\s*$/u.exec(input);
  const mods = /^\/(?:mods|extensions)\s*$/u.exec(input);
  if (mods) return {kind: 'mods'};
  if (/^\/worktrees\s*$/u.test(input)) return {kind: 'worktrees'};
  const github = /^\/(github|prs|issues)\s*$/u.exec(input);
  if (github) return {kind: 'github', tab: github[1] === 'issues' ? 'issues' : 'prs'};
  const providerMods = /^\/(claude|codex|opencode)\s+mods\s*$/u.exec(input);
  if (providerMods) return {kind: 'mods', provider: providerMods[1]!};
  const managed = /^\/(claude|codex)(?:\s+(new))?\s*$/u.exec(input);
  if (managed) return {kind: 'managedTarget', provider: managed[1] as 'claude' | 'codex', action: managed[2] ? 'new' : 'open'};
  const rawProvider = /^\/nmsh\s+raw\s+((?:claude|codex)(?:\s[^\n]*)?)\s*$/u.exec(input);
  if (rawProvider) return {kind: 'rawProvider', command: rawProvider[1]!};
  if (/^\/nmsh(?:\s+raw)?\s*$/u.test(input)) return {kind: 'rawProvider'};
  if (ai) return ai[1] ? {kind: 'ai', target: ai[1]} : {kind: 'ai'};
  const ask = /^\/(?:btw|ask)(?:\s+([\s\S]*))?$/u.exec(input);
  if (ask) return {kind: 'ask', request: (ask[1] ?? '').trim()};
  if (/^\/providers\s*$/u.test(input)) return {kind: 'providers'};
  // Family shortcuts are aliases of one action: /providers focused on that family.
  const family = /^\/providers\s+(prompt|welcome|suggestions|history|picker|pickers|navigation)\s*$/u.exec(input)?.[1]
    ?? {'/picker': 'picker', '/pickers': 'picker', '/suggestions': 'suggestions', '/navigation': 'navigation', '/welcome': 'welcome', '/history-provider': 'history'}[input.trim()];
  if (family) return {kind: 'providers', family: (family === 'pickers' ? 'picker' : family) as 'prompt' | 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation'};
  if (/^\/(?:llm|localllm)\s*$/u.test(input)) return {kind: 'llm'};
  if (/^\/doctor\s*$/u.test(input)) return {kind: 'doctor'};
  const watch = /^\/watch(?:\s+(.*))?$/u.exec(input);
  if (watch) {
    const rest = (watch[1] ?? '').trim();
    const op = /^(stop|pause|resume|now)(?:\s+(.*))?$/u.exec(rest);
    return op ? {kind: 'watch', op: op[1] as 'stop' | 'pause' | 'resume' | 'now', arguments: (op[2] ?? '').trim()} : {kind: 'watch', op: rest ? 'start' : 'list', arguments: rest};
  }
  const rename = /^\/rename(?:\s+(.*))?$/u.exec(input);
  if (rename) return {kind: 'rename', name: (rename[1] ?? '').trim()};
  const directories = /^\/dirs(?:\s+([\s\S]*))?$/u.exec(input);
  if (directories) return {kind: 'directories', query: (directories[1] ?? '').trim()};
  const history = /^\/history(?:\s+([\s\S]*))?$/u.exec(input);
  if (history) return {kind: 'history', query: (history[1] ?? '').trim()};
  return {kind: 'unknown', input};
}

export function slashSuggestions(input: string): SlashCommand[] {
  if (!input.startsWith('/') || input.includes('\n')) return [];
  return slashCommands.filter(command => !(command.name === '/ask' && input === '/') && (command.name.startsWith(input) || command.insertion.startsWith(input)));
}

export function suggestionWindow<T>(values: readonly T[], selected: number, height: number): {items: T[]; start: number} {
  const count = Math.max(0, Math.min(values.length, height));
  if (count === 0) return {items: [], start: 0};
  const safeSelected = Math.max(0, Math.min(values.length - 1, selected));
  const start = Math.max(0, Math.min(safeSelected - count + 1, values.length - count));
  return {items: values.slice(start, start + count), start};
}
