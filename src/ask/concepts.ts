import {parseSlashCommand} from '../commands/slashCommands.js';
import type {CapabilityId} from './types.js';

/**
 * NMSh's own product vocabulary for Ask: one entry per public concept, with
 * the words people use for it and where it actually lives. Resolution is
 * deterministic (no model): the request's words pick concepts, the verb picks
 * an intent, and the concept says what Ask may do (an existing capability, a
 * slash surface to open, a typed setting) or only explain. Nothing here
 * carries argv; a destination is an NMSh slash command parsed by NMSh's own
 * parser, and settings are typed AskActions.
 *
 * Support levels (also the coverage audit's classification):
 * - actionable: Ask can open or change it (with confirmation where needed).
 * - settings: it is configured in Settings (or Setup Cat), which Ask opens.
 * - no-ui: a real feature with no configuration surface yet; Ask says so.
 * - unsupported: understood, but NMSh does not do this.
 */
export type ConceptSupport = 'actionable' | 'settings' | 'no-ui' | 'unsupported';

export interface Concept {
  id: string;
  label: string;
  /** Lowercase phrases. A phrase shared by several concepts is ambiguous between exactly those. */
  aliases: string[];
  /** One or two factual sentences shown when someone asks what it is. */
  description: string;
  support: ConceptSupport;
  /** An existing Ask capability that acts on this concept. */
  capability?: CapabilityId;
  /** The NMSh slash command that opens its surface. */
  open?: string;
  /** Where it is configured, in words, when that is not a slash command of its own. */
  where?: string;
  /** Where "change/configure" goes when that differs from where "open/show" goes (e.g. /dirs vs /providers). */
  configure?: string;
  /** Within an ambiguous phrase, this concept is meant when the request has one of these intents ("open the palette"). */
  prefers?: ConceptIntent[];
  /** A typed on/off setting Ask may propose. */
  toggle?: {setting: 'suggestions' | 'composerDividers'; on: string; off: string};
  /** Capability matches this concept beats when both match (it names something more specific). */
  overrides?: CapabilityId[];
  /** Coverage: the public slash commands, Settings categories, provider families and planned areas this concept stands for. */
  covers?: string[];
}

const SUGGESTIONS_WHERE = 'Settings → Suggestions (provider and empty-prompt prediction), or /providers';

export const CONCEPTS: readonly Concept[] = [
  {id: 'completion', label: 'Tab completion / completion menu', support: 'no-ui', covers: [],
    aliases: ['tab completion', 'tab complete', 'completion', 'completions', 'completion menu', 'complete menu', 'autocomplete menu', 'completion settings',
      'autocomplete', 'auto complete', 'auto-complete', 'autocompletion', 'auto completion'],
    description: 'Tab completion opens a menu of structured candidates (commands, options, files, Git refs) from your shell\'s own completion, custom specs and NMSh\'s bundled catalog.',
    where: 'Tab completion has no settings of its own yet; it follows your shell\'s completion configuration. Ghost suggestions (predictive text) are configurable.'},
  {id: 'suggestions', label: 'Ghost suggestions / predictive text', support: 'actionable', open: '/providers', prefers: ['on', 'off'], where: SUGGESTIONS_WHERE,
    covers: ['settings:Suggestions', 'family:suggestions'], toggle: {setting: 'suggestions', on: 'nmsh', off: 'none'},
    aliases: ['suggestion', 'suggestions', 'autosuggestion', 'autosuggestions', 'auto suggestion', 'auto suggestions', 'auto-suggestions', 'ghost text', 'ghost suggestions',
      'ghost suggestion', 'prediction', 'predictions', 'predictive text', 'next command suggestion', 'next-command suggestion', 'deja',
      'autocomplete', 'auto complete', 'auto-complete', 'autocompletion', 'auto completion'],
    description: 'Ghost suggestions are the dim predicted rest of a command shown as you type (→ accepts). The provider is NMSh Native, Deja, or None; empty-prompt prediction is optional.'},
  {id: 'prompt', label: 'Prompt', support: 'actionable', capability: 'prompt.open', open: '/prompt', covers: ['/prompt', 'settings:Prompt', 'family:prompt'],
    aliases: ['prompt', 'prompts', 'prompt style', 'ps1', 'starship', 'powerlevel10k', 'p10k', 'rich git', 'git prompt', 'composer layout', 'one-line prompt', 'two-line prompt'],
    description: 'The prompt above the composer: NMSh Native (themes, geometry, modules, Rich Git), Starship, Powerlevel10k, or None (composer only). /prompt previews and saves it.'},
  {id: 'modules', label: 'Context modules', support: 'actionable', open: '/modules', covers: ['/modules'],
    aliases: ['modules', 'module', 'prompt modules', 'context modules', 'module manager', 'module catalog', 'context packs', 'module surfaces'],
    description: 'Context modules show facts (project, Git, runtimes, cloud, system, agents) on a surface: Main Prompt, Right Context, Context Rail or Status Strip. /modules opens the manager directly (Modules, Catalog, Packs; / searches) and saves as you change things; /prompt → Modules edits the same settings as part of its draft.'},
  {id: 'theme', label: 'Theme and appearance', support: 'actionable', capability: 'theme.open', open: '/appearance', prefers: ['change', 'explain'], covers: ['/appearance', 'settings:Appearance', 'settings:Motion'],
    aliases: ['theme', 'themes', 'appearance', 'colors', 'colours', 'color scheme', 'colour scheme', 'styling', 'vibrance', 'opacity', 'blur', 'transparency', 'palette'],
    description: 'Appearance covers the Native theme, vibrance, UI chrome colors and terminal opacity/blur where the terminal supports it.'},
  {id: 'themeStudio', label: 'Theme Studio', support: 'actionable', open: '/theme', covers: ['/theme'],
    aliases: ['theme studio', 'custom theme', 'custom themes', 'import theme', 'export theme', 'my own theme', 'imported theme', 'theme library'],
    description: 'Theme Studio manages Native themes: browse built-ins, import a theme file (Base16/24, Windows Terminal, Oh My Posh, Kitty, Ghostty, iTerm2, WezTerm), edit, duplicate, export and select.'},
  {id: 'uiChrome', label: 'UI chrome', support: 'actionable', open: '/chrome', covers: ['/chrome'],
    aliases: ['ui chrome', 'chrome', 'frames', 'panel colors', 'tab colors'],
    description: 'UI chrome is NMSh\'s frames, rules, tabs, selection and accents; it follows the theme or a custom preset. Not Chroma (animated color treatment).'},
  {id: 'toolConfig', label: 'Tool Configuration', support: 'actionable', open: '/configure', covers: ['/configure', '/tmux'],
    aliases: ['configure tmux', 'tmux config', 'tmux settings', 'tmux prefix', 'tmux mouse', 'tmux status bar', 'tool configuration', 'status studio'],
    description: 'Tool Configuration edits supported settings of registered tools: tmux (settings, keys, Status Studio, new panes start NMSh) through one NMSh-managed file, Starship through its own CLI. /tmux opens tmux directly.'},
  {id: 'integrations', label: 'Integrations', support: 'actionable', open: '/integrations', covers: ['/integrations'],
    aliases: ['integrations', 'integration health', 'managed integrations', 'update all integrations'],
    description: 'Integrations shows every managed integration (Theme Bridge files, includes, bat cache, tmux) and applies what is missing after one combined review that starts on No.'},
  {id: 'dotfiles', label: 'Dotfiles import', support: 'actionable', open: '/dotfiles', covers: ['/dotfiles'],
    aliases: ['dotfiles', 'dot files', 'import dotfiles', 'stow', 'chezmoi'],
    description: 'Dotfiles import scans a local repository (plain, Git, Stow or chezmoi source) or a Git URL you confirm, and imports supported settings through the same adapters after a review. Nothing in the repository is run.'},
  {id: 'themeBridge', label: 'Theme Bridge', support: 'actionable', open: '/theme-bridge', covers: ['/theme-bridge'],
    aliases: ['theme bridge', 'fzf colors', 'fzf colours', 'man page colors', 'less colors', 'ls colors', 'ls_colors', 'tmux theme', 'tmux colors', 'neovim theme', 'nvim colorscheme', 'vim colorscheme', 'helix theme'],
    description: 'Theme Bridge extends NMSh themes to fzf, less/man, LS_COLORS, tmux, Neovim, Vim and Helix. Each tool is Independent until you choose Follow NMSh or a pinned theme.'},
  {id: 'chroma', label: 'Chroma', support: 'actionable', open: '/chroma', covers: ['/chroma', 'settings:Presentation'],
    aliases: ['chroma', 'gradient', 'gradients', 'animated colors', 'animated colours', 'color motion', 'colour motion', 'prompt gradient', 'rainbow prompt', 'chroma palette',
      'animated prompt colors', 'animated prompt colours', 'animated prompt'],
    description: 'Chroma paints NMSh-owned chrome (prompt, dividers) with a palette gradient, optionally animated (Travel, Breathe, Comet, Pulse). Palette Off turns it off.',
    where: 'Chroma is in /chroma (or /prompt → Chroma); set Palette to Off there to turn it off.'},
  {id: 'transcript', label: 'Transcript', support: 'actionable', open: '/transcript', covers: ['/transcript', 'settings:Transcript', '/clear'],
    aliases: ['transcript', 'output history', 'command output', 'past output', 'scrollback', 'history divider', 'history dividers', 'dividers', 'prompt snapshots', 'history colors', 'history colours'],
    description: 'The transcript is this session\'s commands and their raw output. /transcript chooses Normal or Chat presentation and sets historical prompts, history colors, dividers and folding; /clear archives it and starts a fresh view.'},
  {id: 'folding', label: 'Output folding', support: 'settings', open: '/setup transcript', where: 'Settings → Transcript → Output folding (Off, Smart or Always), also in /setup transcript',
    aliases: ['folding', 'output folding', 'fold output', 'fold', 'collapse output', 'collapsed output', 'collapsing', 'collapsing output', 'smart fold', 'smart folding',
      'hide noisy output', 'folded output', 'folds'],
    description: 'Output folding collapses long command output behind a one-line disclosure (Ctrl+O expands). Smart folds long, repetitive successes and never hides errors; Always folds every long block.'},
  {id: 'composerDividers', label: 'Composer dividers', support: 'actionable', open: '/settings', prefers: ['on', 'off'], toggle: {setting: 'composerDividers', on: 'on', off: 'off'},
    where: 'Settings → Layout → Composer dividers (On/Off)',
    aliases: ['composer dividers', 'composer divider', 'input dividers', 'input divider', 'input lines', 'lines around the input', 'divider lines', 'input box lines', 'composer lines', 'input separators'],
    description: 'Composer dividers are the two thin rules above and below the input. Off removes them and gives their rows back to output.'},
  {id: 'layout', label: 'Layout', support: 'actionable', open: '/layout', covers: ['/layout', '/composer', 'settings:Layout'],
    aliases: ['layout', 'transcript layout', 'transcript presentation', 'chat mode', 'chat layout', 'composer position', 'composer at the top', 'flow mode', 'classic mode'],
    description: 'Layout chooses where the composer sits (bottom, top, or Flow after the newest output) and whether the transcript is Normal or Chat (commands on the right).'},
  {id: 'history', label: 'Command history', support: 'actionable', open: '/history', configure: '/providers', where: 'Settings → History → Command history provider, or /providers',
    covers: ['/history', 'settings:History', 'family:history'],
    aliases: ['command history', 'history provider', 'command history provider', 'shell history', 'atuin', 'history search', 'search history', 'history'],
    description: 'Command history is what ↑ and /history search: NMSh\'s native journals and zsh history, or a read-only Atuin database.'},
  {id: 'picker', label: 'Picker', support: 'actionable', open: '/providers', where: 'Settings → History → Picker provider, or /providers', covers: ['family:picker'],
    aliases: ['picker', 'fuzzy finder', 'fzf', 'television', 'picker provider'],
    description: 'The picker is the search list for history and directories: native composer search, fzf, or Television. Selections never execute.'},
  {id: 'navigation', label: 'Directory navigation', support: 'actionable', open: '/dirs', configure: '/providers', where: 'Settings → History → Directory navigation, or /providers',
    covers: ['/dirs', 'family:navigation'],
    aliases: ['directory navigation', 'directories', 'dirs', 'folder navigation', 'cd history', 'zoxide', 'jump to directory', 'recent directories', 'recent directory', 'recent folders', 'recent folder'],
    description: '/dirs finds a directory and inserts a visible cd command. Ranking comes from native command-history frecency or a read-only zoxide snapshot.'},
  {id: 'providers', label: 'Providers', support: 'actionable', capability: 'providers.open', open: '/providers', covers: ['/providers', '/picker', '/pickers', '/suggestions', '/navigation', '/welcome', '/history-provider'],
    aliases: ['providers', 'provider', 'picker provider', 'history provider'],
    description: 'Providers are what NMSh uses for prompt, welcome, suggestions, history, picker, directory navigation and local understanding. /providers shows, switches, detects and installs them.'},
  {id: 'shell', label: 'Shell', support: 'actionable', capability: 'shell.switch', open: '/shell', covers: ['/shell'],
    aliases: ['shell', 'shells', 'shell backend', 'backend', 'default shell'],
    description: 'Each NMSh session runs a real zsh, Fish or Bash. /shell switches this session (NMSh stays open), installs missing shells, and D sets the default for new sessions. It also controls visibility and Left/Right placement of the prompt shell indicator, shared with /prompt.'},
  {id: 'leave', label: 'Leave NMSh for an ordinary shell', support: 'actionable', capability: 'shell.leave', covers: ['/zsh', '/fish', '/bash', '/exit'],
    aliases: ['leave nmsh', 'exit nmsh', 'quit nmsh', 'ordinary shell', 'plain shell', 'regular shell'],
    description: '/zsh, /fish and /bash leave NMSh for an ordinary shell (the session waits; `nmsh` returns). /exit uses your default shell.'},
  {id: 'queue', label: 'Command queue', support: 'actionable', open: '/queue', covers: ['/queue'],
    aliases: ['command queue', 'queue a command', 'queue commands', 'run after this finishes', 'run next'],
    description: 'While a command runs, Enter queues the next command (Ctrl+Q always queues; Ctrl+S sends to the program). Entries run in order in the same shell after each finishes; a failure or Ctrl+C pauses the rest. /queue shows, edits, reorders, pauses, resumes or clears them.'},
  {id: 'sessions', label: 'Live sessions', support: 'actionable', capability: 'session.list', open: '/sessions', covers: ['/sessions', '/rename', 'settings:Sessions'],
    aliases: ['live sessions', 'running sessions', 'detached sessions', 'current sessions', 'open sessions', 'other sessions', 'sessions', 'session', 'other windows', 'startup restore'],
    description: 'Live sessions are NMSh sessions running right now, attached or detached. /sessions switches to or ends one.'},
  {id: 'worktrees', label: 'Git worktrees', support: 'actionable', open: '/worktrees', covers: ['/worktrees'],
    aliases: ['worktrees', 'worktree', 'git worktrees', 'git worktree', 'linked worktrees', 'worktree manager', 'new worktree', 'remove worktree'],
    description: '/worktrees lists this repository\'s Git worktrees. Enter stages a cd in the composer; n plans a new one and x previews removal, each applied only after you confirm the plan.'},
  {id: 'githubWorkspace', label: 'GitHub pull requests and issues', support: 'actionable', open: '/github', covers: ['/github', '/prs', '/issues'],
    aliases: ['github', 'pull requests', 'pull request', 'prs', 'github issues', 'issues', 'pr checks', 'pr review', 'github workspace'],
    description: '/github (/prs, /issues) is a read-only view of this repository\'s pull requests and issues through your gh login: checks, reviews, commits, files and diffs. NMSh changes nothing on GitHub.'},
  {id: 'transcripts', label: 'Archived transcripts', support: 'actionable', capability: 'session.resume', open: '/resume', overrides: ['session.list'], covers: ['/resume'],
    aliases: ['old sessions', 'past sessions', 'previous sessions', 'archived sessions', 'saved sessions', 'old transcripts', 'archived transcripts', 'saved transcripts',
      'past transcripts', 'transcript archive', 'old output', 'old terminal output'],
    description: '/resume browses archived transcripts (earlier views, cleared or closed sessions) and live sessions, and reopens one.'},
  {id: 'find', label: 'Find and filter output', support: 'actionable', capability: 'transcript.find', covers: ['/find', '/filter'],
    aliases: ['find bar', 'find in transcript', 'search the transcript', 'search output', 'filter output', 'filter lines', 'find and filter'],
    description: '/find (Ctrl+F) highlights terms in the transcript; /filter shows only matching lines of the newest output. Terms AND together; -r regex, -c case.'},
  {id: 'cursor', label: 'Cursor & effects', support: 'actionable', open: '/cursor', covers: ['/cursor', 'settings:Cursor'],
    aliases: ['cursor', 'caret', 'cursor blink', 'blinking cursor', 'cursor shape', 'blink', 'cursor effects', 'cursor trail', 'smooth cursor', 'smear cursor', 'cursor animation', 'fire cursor', 'cursor particles', 'cursor shader'],
    description: 'The caret\'s shape and blink, plus optional motion (Smooth, Smear, Tail), effects (Fire, Sparks, Lightning, Railgun, Ripple, Wireframe) and idle effects. Portable everywhere NMSh owns its input; after a previewed setup Ghostty draws Smear, Tail, Fire, Sparks and Ripple natively and Kitty draws a Tail, and Portable covers the rest. Colors follow the current theme, a theme you choose, the NMSh accent, the host or a custom color. Off by default.'},
  {id: 'motion', label: 'Motion', support: 'actionable', open: '/motion', covers: ['/motion'], where: '/motion (also /appearance → Motion (Context transitions, Command launch, Completion highlight, Command completion, Event feedback)',
    aliases: ['motion', 'animations', 'transitions', 'launch sweep', 'command launch', 'block seal', 'semantic echo', 'event feedback', 'completion highlight', 'context transitions', 'prompt morph'],
    description: 'Short presentation transitions for real events: the command handoff on Enter, what completion inserted, a finished block settling, prompt modules changing, and meaningful events. Reduced Motion and Decorative Effects Off stop them all.'},
  {id: 'doctor', label: 'Doctor', support: 'actionable', open: '/doctor', covers: ['/doctor'],
    aliases: ['doctor', 'health check', 'diagnostics', 'diagnose', 'check my setup', 'is everything ok', 'whats wrong with my setup', 'check environment'],
    description: '/doctor checks NMSh, the shell, this project, Git, tools, the local model and the host terminal with local, read-only checks, and offers actions that open the right place; it never fixes anything silently.'},
  {id: 'watch', label: 'Watch', support: 'actionable', open: '/watch', covers: ['/watch'],
    aliases: ['watch', 'watch a command', 'rerun every', 'repeat a command', 'keep running', 'monitor a command'],
    description: '/watch runs a command on NMSh\'s own schedule and shows what changed in one live block (pause, run now, stop). Commands that install, modify or destroy are refused; unknown ones need a Yes.'},
  {id: 'pastePreview', label: 'Paste preview', support: 'settings', open: '/settings', where: 'Settings → Editor → Paste preview (Smart, Always, Off)', covers: ['settings:Editor'],
    aliases: ['paste preview', 'paste guard', 'pasting', 'paste safety', 'pasted commands'],
    description: 'Multiline, chained, mutating or risky pastes are shown (muted, above the composer) before they enter it; Insert keeps the exact text, and nothing runs until you press Enter.'},
  {id: 'syntax', label: 'Syntax highlighting', support: 'actionable', open: '/syntax', covers: ['/syntax', 'settings:Syntax'],
    aliases: ['syntax highlighting', 'syntax', 'highlighting', 'command colors', 'command colours', 'syntax colors', 'syntax colours'],
    description: 'Syntax highlighting colors what you type: known commands, unknown commands, strings, options and paths.'},
  {id: 'idle', label: 'Idle visuals (screensaver)', support: 'actionable', capability: 'screensaver.open', open: '/screensaver', covers: ['/screensaver', 'settings:Idle visuals'],
    aliases: ['screensaver', 'screen saver', 'idle visuals', 'idle visual', 'idle animation', 'idle screen'],
    description: 'Idle visuals play after a timeout while the composer is empty; any key or mouse stops them. /screensaver has the gallery, timeout and colors.'},
  {id: 'effects', label: 'Effects', support: 'actionable', open: '/effects', covers: ['/effects'],
    aliases: ['effects', 'sparkles', 'confetti', 'rain effect'],
    description: '/effects previews sparkles, rain or confetti in NMSh-owned chrome; /effects stop cancels.'},
  {id: 'activity', label: 'Live activity', support: 'actionable', open: '/activity', covers: ['/activity', 'settings:Live activity'],
    aliases: ['live activity', 'activity colors', 'activity colours', 'running command line', 'spinner', 'elapsed time'],
    description: 'Live activity is the animated line with elapsed time while a command runs; /activity sets its colors.'},
  {id: 'tools', label: 'Optional tools', support: 'actionable', capability: 'tools.open', open: '/tools', covers: ['/tools', 'settings:Tools'],
    aliases: ['tools', 'optional tools', 'installs', 'install suggestions'],
    description: '/tools lists optional tools NMSh can use, with previewed installs that start on No.'},
  {id: 'keepAwake', label: 'Keep Awake', support: 'actionable', open: '/caffeinate', covers: ['/caffeinate', '/awake', '/zoomies'],
    aliases: ['keep awake', 'keep-awake', 'caffeinate', 'awake', 'zoomies', 'prevent sleep', 'stay awake'],
    description: 'Keep Awake (/caffeinate, /awake, /zoomies) keeps the computer or display awake with the operating system\'s own mechanism (Apple caffeinate, the systemd inhibitor or the Windows execution-state API) until you stop it or its timeout ends. No power settings change.'},
  {id: 'presets', label: 'Session presets', support: 'actionable', open: '/presets', covers: ['/presets'],
    aliases: ['presets', 'preset', 'session presets', 'named presets', 'session preset'],
    description: 'Presets are named session setups (folder, shell, startup command) you can create, inspect and launch from /presets.'},
  {id: 'notices', label: 'Session notices', support: 'actionable', open: '/notices', covers: ['/notices'],
    aliases: ['notices', 'session notices', 'cross-session notices', 'notifications', 'notification'],
    prefers: ['explain'],
    description: 'Session notices are up to three factual lines above the composer when other NMSh sessions finish, fail, ask for attention or end. /notices on/off/clear.'},
  {id: 'commandNotifications', label: 'Command notifications', support: 'settings', open: '/settings', where: 'Settings → Command notifications (Notify after, on success, on failure, when focused)',
    covers: ['settings:Command notifications'],
    aliases: ['command notifications', 'desktop notifications', 'notify when done', 'notify me', 'long command notifications', 'notifications', 'notification'],
    description: 'Command notifications tell you when a long-running command finishes, after a minimum duration, on success and/or failure, optionally only when the terminal is not focused.'},
  {id: 'agentSessions', label: 'Agent sessions', support: 'actionable', open: '/ai', covers: ['/ai', '/claude', '/codex'],
    aliases: ['agent sessions', 'ai sessions', 'background agent', 'background agents', 'claude session', 'codex session', 'agent session', 'start claude', 'run claude in the background'],
    description: '/ai starts and supervises external agent harnesses (Claude Code today) in the background and shows other running agents it can see. The harness owns models, sign-in and tools; NMSh never calls model APIs. ← on an empty composer opens sessions, ↓ shows the agent shelf.'},
  {id: 'agents', label: 'Agent activity', support: 'actionable', open: '/agents', covers: ['/agents'],
    aliases: ['agents', 'agent activity', 'agent stats', 'agent statistics', 'claude code activity', 'codex activity', 'agent runs'],
    description: '/agents tracks local agent CLI activity (Claude Code, Codex CLI): durations, run counts and a heatmap. It never records prompts or output.'},
  {id: 'editor', label: 'Editor (open files)', support: 'actionable', capability: 'editor.status', where: 'Settings → Open with', covers: ['/open', '/open-diff'],
    aliases: ['editor', 'open with', 'zed', 'vscode', 'vs code', 'visual studio code', 'open files in', 'open diff'],
    description: '/open hands a path[:line[:column]] to your editor (Auto, Zed, VS Code, or VISUAL/EDITOR); /open-diff shows two files in its diff view.'},
  {id: 'keyboard', label: 'Keyboard', support: 'actionable', open: '/keyboard', covers: ['/keyboard', 'settings:Keyboard'],
    aliases: ['keyboard', 'key bindings', 'keybindings', 'shortcuts', 'keyboard shortcuts', 'option key', 'kitty keyboard'],
    description: '/keyboard configures terminal keyboard integration (enhanced keys, Option as Meta, Shift+Enter).'},
  {id: 'updates', label: 'Updates', support: 'actionable', open: '/update', covers: ['/update', 'settings:Updates'],
    aliases: ['update', 'updates', 'new version', 'new release', 'upgrade nmsh', 'update nmsh', 'update checks', 'latest version'],
    description: '/update checks GitHub for a newer NMSh release; installing it is a separate, explicit /update apply.'},
  {id: 'version', label: 'Version', support: 'actionable', open: '/version', covers: ['/version', '/about'],
    aliases: ['version', 'which version', 'nmsh version', 'about nmsh'],
    description: '/version shows this NMSh build\'s identity; /about adds the logo.'},
  {id: 'status', label: 'NMSh status', support: 'actionable', open: '/status', covers: ['/status'],
    aliases: ['nmsh status', 'diagnostics', 'status page', 'status view'],
    description: '/status shows NMSh\'s own state: session, shell, providers, local understanding and more.'},
  {id: 'statusStrip', label: 'Status strip', support: 'actionable', open: '/strip', where: '/strip (also Settings → Status strip)', covers: ['settings:Status strip', '/strip', '/status-strip'],
    aliases: ['status strip', 'clock', 'battery', 'cpu', 'ram', 'uptime', 'status bar'],
    description: 'The Status Strip is one live row at the top or bottom of the NMSh pane with left, center and right groups: clock, battery, CPU, RAM, uptime and Keep Awake, plus modules routed there in /modules. /strip composes it (edge, style, presets, groups) with a live preview; it is never saved to history and it is not a tmux status bar.'},
  {id: 'palette', label: 'Command palette', support: 'actionable', open: '/palette', prefers: ['open'], covers: ['/palette'],
    aliases: ['command palette', 'action palette', 'actions palette', 'palette', 'search actions'],
    description: 'The palette (Ctrl+Shift+P or F1) searches every NMSh action.'},
  {id: 'help', label: 'Help and the guide', support: 'actionable', open: '/help', covers: ['/help', '/guide'],
    aliases: ['slash commands', 'nmsh commands', 'nmsh help'],
    description: '/help lists NMSh commands; /btw what can you do lists what Ask does.'},
  {id: 'settings', label: 'Settings', support: 'actionable', capability: 'settings.open', open: '/settings', covers: ['/settings', '/config', 'settings:General'],
    aliases: ['settings', 'preferences'],
    description: 'Settings (/settings or /config) holds every NMSh option, grouped by area.'},
  {id: 'setup', label: 'Setup Cat', support: 'actionable', open: '/setup', covers: ['/setup'],
    aliases: ['setup cat', 'setup', 'guided setup', 'onboarding', 'first run'],
    description: 'Setup Cat is the guided, rerunnable setup; it keeps your current choices.'},
  {id: 'welcome', label: 'Welcome', support: 'actionable', open: '/providers', where: 'Settings → Welcome, or /providers', covers: ['settings:Welcome', 'family:welcome'],
    aliases: ['welcome', 'welcome screen', 'startup logo', 'banner', 'fastfetch', 'neofetch', 'vespyr', 'startup screen'],
    description: 'The welcome is what a new session shows first: Vespyr (NMSh\'s own), fastfetch, neofetch, or none.'},
  {id: 'ask', label: 'Ask', support: 'settings', open: '/settings', where: 'Settings → Ask (Record Ask in transcript, Local understanding)', covers: ['/btw', '/ask', 'settings:Ask'],
    aliases: ['ask', 'record ask', 'ask settings', 'ask transcript'],
    description: '/btw answers plain-English questions about NMSh and proposes typed actions; it never runs arbitrary commands. Recording it in the transcript is optional.'},
  {id: 'understanding', label: 'Local understanding', support: 'actionable', capability: 'understanding.set', open: '/llm', covers: ['/llm'],
    aliases: ['local understanding', 'local model', 'language model', 'llm', 'qwen', 'ai model', 'local intelligence', 'local llm'],
    description: 'Local understanding is an optional small model that runs on this machine to help Ask and Smart Folding with loosely worded input. Auto (the default) asks it only when built-in understanding is unsure and a model is set up; nothing downloads without your Yes. Off never loads one.'},
  {id: 'glyphs', label: 'Glyph style', support: 'actionable', open: '/glyphs', where: '/glyphs (also Settings → Glyph style)', covers: ['/glyphs'],
    aliases: ['glyphs', 'glyph style', 'nerd font', 'nerd fonts', 'icons', 'symbols'],
    description: 'Glyph style picks Nerd Font symbols or safe terminal symbols for icons and prompt shapes.'},
  {id: 'copy', label: 'Copy output', support: 'actionable', open: '/copy', covers: ['/copy', '/cp', 'settings:Copy'],
    aliases: ['copy output', 'copy the output', 'copy last output', 'copy latest output', 'copy several outputs', 'copy completion status', 'quick copy', 'copy picker'],
    description: '/copy copies the latest command output as plain text (or opens a picker, in Settings → Copy); /copy N copies an earlier one, /copy -N the latest N, /copy 2-4 or /copy 1,3,5 several, oldest first. --status adds each command\'s completion status after its output; --no-status leaves it out.'},
  {id: 'homebrew', label: 'Homebrew packages', support: 'actionable', open: '/tools', covers: [],
    aliases: ['homebrew', 'brew packages', 'brew', 'formulae', 'casks', 'package manager'],
    description: 'Ask can inspect Homebrew: installed packages, versions, search, info, dependencies and what is outdated, and install, upgrade or uninstall after showing the exact brew command and your Yes. Ownership is only claimed from Homebrew\'s own evidence.'},
  {id: 'otherShells', label: 'Other shells (Nushell, PowerShell)', support: 'unsupported',
    aliases: ['nushell', 'nu shell', 'powershell', 'pwsh', 'elvish', 'xonsh'],
    description: 'NMSh runs zsh, Fish and Bash. Nushell, PowerShell and other shells are not supported yet.'},
  {id: 'panes', label: 'Tabs and split panes', support: 'unsupported',
    aliases: ['split pane', 'split panes', 'splits', 'tabs', 'new tab', 'tmux'],
    description: 'NMSh doesn\'t manage tabs or split panes; your terminal does. Each NMSh window is one session (/sessions lists them).'},
];

/** Public surfaces Ask deliberately has no concept for, with the reason (the coverage audit checks these too). */
export const ASK_EXCLUDED: Readonly<Record<string, string>> = {
  '/mods': 'Unified mod inventory is opened explicitly; installation and activation are not inferred Ask actions.',
  '/extensions': 'Alias of the explicit /mods inventory surface.',
  '/nmsh': 'Raw provider handoff requires an explicitly typed command and preserves provider CLI arguments.',
};

export type ConceptIntent = 'explain' | 'on' | 'off' | 'open' | 'change';

/** What the person wants to do, from the verb; "change" when no verb says otherwise. */
export function conceptIntent(text: string): ConceptIntent {
  if (/^(?:what|wat|whats)\b(?! (?:version|shell|branch|provider))|\bexplain\b|\bdifference\b|\btell me about\b|\bhow does\b|\bwhat (?:is|are|does|do)\b|\bmean(?:s|ing)?\b/u.test(text)) return 'explain';
  if (/\b(?:turn|switch|set)\b.*\boff\b|\b(?:disable|stop|hide|no more|get rid of|without|remove|drop)\b/u.test(text)) return 'off';
  if (/\b(?:turn|switch|set)\b.*\bon\b|\benable\b/u.test(text)) return 'on';
  if (/^(?:open|show|see|view|browse|list|check|inspect|display|go to|jump|launch|start)\b|\b(?:open|show me|check for|check|see)\b/u.test(text)
    && !/\b(?:change|configure|customi[sz]e|tweak|edit|adjust|settings?|where)\b/u.test(text)) return 'open';
  return 'change';
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const ALIAS_INDEX = CONCEPTS.flatMap(concept => concept.aliases.map(alias => ({alias, concept, pattern: new RegExp(`(?:^|[^a-z0-9-])${escape(alias)}(?:$|[^a-z0-9-])`, 'u')})))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Conservative single-typo tolerance for long one-word aliases (autocompelte, sugestions). */
function typoMatch(word: string, alias: string): boolean {
  if (alias.length < 7 || alias.includes(' ') || Math.abs(word.length - alias.length) > 1 || word[0] !== alias[0]) return false;
  const [a, b] = [word, alias];
  const rows = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1);
  }
  return rows[a.length]![b.length]! <= 1;
}

export interface ConceptMatch {
  /** Concepts named by the request, in order of the longest phrase that named them. */
  concepts: Concept[];
  /** Groups that one shared phrase left ambiguous (e.g. "autocomplete": completion or suggestions). */
  ambiguous: Concept[][];
}

/**
 * The concepts a normalized request names. Longer phrases win and consume
 * their words ("tab completion" is completion, not also "completion"); a
 * phrase several concepts share yields an ambiguous group unless another word
 * already named one of them.
 */
export function matchConcepts(text: string): ConceptMatch {
  let rest = ` ${text} `;
  const found: Concept[] = [];
  const groups: Concept[][] = [];
  const consumed = new Set<string>();
  for (const {alias, pattern} of ALIAS_INDEX) {
    if (consumed.has(alias) || !pattern.test(rest)) continue;
    consumed.add(alias);
    const owners = ALIAS_INDEX.filter(entry => entry.alias === alias).map(entry => entry.concept);
    rest = rest.replace(pattern, match => match.replace(alias, ' '.repeat(alias.length)));
    if (owners.length === 1) { if (!found.includes(owners[0]!)) found.push(owners[0]!); } else groups.push(owners);
  }
  for (const word of rest.split(/[^a-z0-9-]+/u).filter(item => item.length >= 6)) {
    const hit = ALIAS_INDEX.find(entry => typoMatch(word, entry.alias));
    if (!hit) continue;
    const owners = ALIAS_INDEX.filter(entry => entry.alias === hit.alias).map(entry => entry.concept);
    if (owners.length === 1) { if (!found.includes(owners[0]!)) found.push(owners[0]!); } else groups.push(owners);
  }
  // A group is settled when another phrase already named one of its members ("autocomplete ghost text").
  const ambiguous = groups.filter(group => !group.some(concept => found.includes(concept)))
    .filter((group, index, all) => all.findIndex(other => other.map(item => item.id).join() === group.map(item => item.id).join()) === index);
  return {concepts: found, ambiguous};
}

/** Parse a concept's own destination with NMSh's slash parser; never free text. */
export function conceptDestination(concept: Concept) {
  if (!concept.open) return undefined;
  const slash = parseSlashCommand(concept.open);
  return slash && slash.kind !== 'unknown' ? slash : undefined;
}

/**
 * The NMSh guide: sections over the same concept catalog, so /guide, /ask
 * guide and /btw help explain exactly what Ask knows. Every public concept
 * belongs to a section (a test enforces it); "Everything" lists them all.
 */
export interface GuideSection {id: string; title: string; why: string; concepts: string[]; notes?: string[]}

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {id: 'start', title: 'Getting started', why: 'NMSh is a terminal frontend over a real, persistent shell: your shell keeps its state, and NMSh adds the editor, transcript and tools around it.',
    concepts: ['setup', 'help', 'palette', 'settings', 'version', 'updates', 'status']},
  {id: 'look', title: 'Prompt & appearance', why: 'Make the prompt and colors yours without editing dotfiles.', concepts: ['prompt', 'modules', 'theme', 'themeStudio', 'themeBridge', 'uiChrome', 'glyphs', 'syntax']},
  {id: 'cursorEffects', title: 'Cursor & effects', why: 'Cursor trails and motion for NMSh-owned chrome; Reduced Motion, Effects Off and NO_COLOR are always respected.', concepts: ['cursor', 'motion']},
  {id: 'chroma', title: 'Chroma', why: 'Optional gradients and motion for NMSh-owned chrome only; your command output is never recolored.', concepts: ['chroma', 'effects', 'activity']},
  {id: 'shells', title: 'Shells', why: 'One NMSh window can run zsh, Fish or Bash, and you can leave for a plain shell and come back.', concepts: ['shell', 'leave', 'otherShells']},
  {id: 'completion', title: 'Completion & suggestions', why: 'Tab completion lists real candidates; ghost suggestions predict the rest of the line.', concepts: ['completion', 'suggestions']},
  {id: 'history', title: 'History & transcripts', why: 'Find what you ran and what it printed, now or in earlier sessions.', concepts: ['history', 'picker', 'transcript', 'find', 'copy', 'transcripts']},
  {id: 'sessions', title: 'Sessions', why: 'Sessions keep running when a window closes; reattach, switch or get notified.', concepts: ['sessions', 'queue', 'agentSessions', 'presets', 'notices', 'commandNotifications', 'panes', 'keepAwake']},
  {id: 'ask', title: 'Ask', why: 'Plain-English help that knows NMSh, your commands and this repository, and never runs anything you did not confirm.', concepts: ['ask']},
  {id: 'intelligence', title: 'Local intelligence', why: 'An optional local model helps Ask map vague requests to known actions. It runs on this machine, never writes commands, and Ask works fully without it.', concepts: ['understanding'],
    notes: ['Modes: Off, Auto (used only when the deterministic resolver is unsure) and Always (consulted first). /llm shows the model, runtime and last inference.']},
  {id: 'projects', title: 'Project & dev tasks', why: 'Ask reads this project\'s scripts (package.json, Makefile, Cargo, …) and can run them for you; /worktrees and /github show its worktrees, pull requests and issues.', concepts: ['worktrees', 'githubWorkspace'],
    notes: ['Try: "run the tests" · "start the dev server" · "what scripts does this project have?"', 'Dev servers run as NMSh-managed background tasks: a live status row, detected URLs to open, and "stop the dev server" to end them.']},
  {id: 'files', title: 'Files, config & editor', why: 'Jump to folders, open what output mentions, and let Ask find and open config files or add/update a setting with a verified, previewed edit (it never removes settings).', concepts: ['navigation', 'editor', 'pastePreview']},
  {id: 'providers', title: 'Providers & tools', why: 'Choose what powers each part of NMSh, and install optional tools with previewed recipes.', concepts: ['providers', 'welcome', 'tools', 'toolConfig', 'integrations', 'dotfiles', 'homebrew', 'agents']},
  {id: 'doctorWatch', title: 'Doctor & watch', why: 'Check your setup with local, read-only checks, and watch a command change over time.', concepts: ['doctor', 'watch'],
    notes: ['After a failure, ask "why did that fail?" for an explanation from the recorded output.']},
  {id: 'layout', title: 'Layout & folding', why: 'Decide where the composer sits and how much output stays in view.', concepts: ['layout', 'composerDividers', 'folding', 'statusStrip', 'idle']},
  {id: 'keyboard', title: 'Keyboard', why: 'Terminal key integration for Shift+Enter, Option as Meta and enhanced keys.', concepts: ['keyboard']},
];
