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
  toggle?: {setting: 'suggestions'; on: string; off: string};
  /** Capability matches this concept beats when both match (it names something more specific). */
  overrides?: CapabilityId[];
  /** Coverage: the public slash commands, Settings categories, provider families and planned areas this concept stands for. */
  covers?: string[];
}

const SUGGESTIONS_WHERE = 'Settings → Suggestions (provider and empty-prompt prediction), or /providers';

export const CONCEPTS: readonly Concept[] = [
  {id: 'completion', label: 'Tab completion / completion menu', support: 'no-ui', covers: ['planned:Completion'],
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
    aliases: ['prompt', 'prompts', 'prompt style', 'prompt modules', 'ps1', 'starship', 'powerlevel10k', 'p10k', 'rich git', 'git prompt', 'composer layout', 'one-line prompt', 'two-line prompt'],
    description: 'The prompt above the composer: NMSh Native (themes, geometry, modules, Rich Git), Starship or Powerlevel10k. /prompt previews and saves it.'},
  {id: 'theme', label: 'Theme and appearance', support: 'actionable', capability: 'theme.open', open: '/appearance', prefers: ['change', 'explain'], covers: ['/appearance', 'settings:Appearance'],
    aliases: ['theme', 'themes', 'appearance', 'colors', 'colours', 'color scheme', 'colour scheme', 'styling', 'vibrance', 'opacity', 'blur', 'transparency', 'palette'],
    description: 'Appearance covers the Native theme, vibrance, UI chrome colors and terminal opacity/blur where the terminal supports it.'},
  {id: 'themeStudio', label: 'Theme Studio (custom themes)', support: 'actionable', open: '/theme', covers: ['/theme'],
    aliases: ['theme studio', 'custom theme', 'custom themes', 'import theme', 'export theme', 'my own theme'],
    description: 'Theme Studio clones a Native theme so you can edit, import and export your own.'},
  {id: 'chroma', label: 'Chroma', support: 'actionable', open: '/chroma', covers: ['/chroma', 'settings:Presentation', 'planned:Chroma'],
    aliases: ['chroma', 'gradient', 'gradients', 'animated colors', 'animated colours', 'color motion', 'colour motion', 'prompt gradient', 'rainbow prompt', 'chroma palette',
      'animated prompt colors', 'animated prompt colours', 'animated prompt'],
    description: 'Chroma paints NMSh-owned chrome (prompt, dividers) with a palette gradient, optionally animated (Travel, Breathe, Comet, Pulse). Palette Off turns it off.',
    where: 'Chroma is in /chroma (or /prompt → Chroma); set Palette to Off there to turn it off.'},
  {id: 'transcript', label: 'Transcript', support: 'actionable', open: '/transcript', covers: ['/transcript', 'settings:Transcript', '/clear'],
    aliases: ['transcript', 'output history', 'command output', 'past output', 'scrollback', 'history divider', 'history dividers', 'dividers', 'prompt snapshots', 'history colors', 'history colours'],
    description: 'The transcript is this session\'s commands and their raw output. /transcript sets historical prompts, history colors and dividers; /clear archives it and starts a fresh view.'},
  {id: 'folding', label: 'Output folding', support: 'settings', open: '/setup transcript', where: 'Settings → Transcript → Output folding (Off, Smart or Always), also in /setup transcript',
    aliases: ['folding', 'output folding', 'fold output', 'fold', 'collapse output', 'collapsed output', 'collapsing', 'collapsing output', 'smart fold', 'smart folding',
      'hide noisy output', 'folded output', 'folds'],
    description: 'Output folding collapses long command output behind a one-line disclosure (Ctrl+O expands). Smart folds long, repetitive successes and never hides errors; Always folds every long block.'},
  {id: 'layout', label: 'Layout', support: 'actionable', open: '/layout', covers: ['/layout', 'settings:Layout', 'planned:Layout'],
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
  {id: 'providers', label: 'Providers', support: 'actionable', capability: 'providers.open', open: '/providers', covers: ['/providers'],
    aliases: ['providers', 'provider', 'integrations'],
    description: 'Providers are what NMSh uses for prompt, welcome, suggestions, history, picker, directory navigation and local understanding. /providers shows, switches, detects and installs them.'},
  {id: 'shell', label: 'Shell', support: 'actionable', capability: 'shell.switch', open: '/shell', covers: ['/shell'],
    aliases: ['shell', 'shells', 'shell backend', 'backend', 'default shell'],
    description: 'Each NMSh session runs a real zsh, Fish or Bash. /shell switches this session (NMSh stays open), installs missing shells, and D sets the default for new sessions.'},
  {id: 'leave', label: 'Leave NMSh for an ordinary shell', support: 'actionable', capability: 'shell.leave', covers: ['/zsh', '/fish', '/bash', '/exit'],
    aliases: ['leave nmsh', 'exit nmsh', 'quit nmsh', 'ordinary shell', 'plain shell', 'regular shell'],
    description: '/zsh, /fish and /bash leave NMSh for an ordinary shell (the session waits; `nmsh` returns). /exit uses your default shell.'},
  {id: 'sessions', label: 'Live sessions', support: 'actionable', capability: 'session.list', open: '/sessions', covers: ['/sessions', 'settings:Sessions'],
    aliases: ['live sessions', 'running sessions', 'detached sessions', 'current sessions', 'open sessions', 'other sessions', 'sessions', 'session', 'other windows', 'startup restore'],
    description: 'Live sessions are NMSh sessions running right now, attached or detached. /sessions switches to or ends one.'},
  {id: 'transcripts', label: 'Archived transcripts', support: 'actionable', capability: 'session.resume', open: '/resume', overrides: ['session.list'], covers: ['/resume'],
    aliases: ['old sessions', 'past sessions', 'previous sessions', 'archived sessions', 'saved sessions', 'old transcripts', 'archived transcripts', 'saved transcripts',
      'past transcripts', 'transcript archive', 'old output', 'old terminal output'],
    description: '/resume browses archived transcripts (earlier views, cleared or closed sessions) and live sessions, and reopens one.'},
  {id: 'find', label: 'Find and filter output', support: 'actionable', capability: 'transcript.find', covers: ['/find', '/filter'],
    aliases: ['find bar', 'find in transcript', 'search the transcript', 'search output', 'filter output', 'filter lines', 'find and filter'],
    description: '/find (Ctrl+F) highlights terms in the transcript; /filter shows only matching lines of the newest output. Terms AND together; -r regex, -c case.'},
  {id: 'cursor', label: 'Cursor', support: 'actionable', open: '/cursor', covers: ['/cursor'],
    aliases: ['cursor', 'caret', 'cursor blink', 'blinking cursor', 'cursor shape', 'blink'],
    description: 'The text caret\'s shape (block, bar, underline) and blink while NMSh owns the composer; Host default leaves it to the terminal.'},
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
  {id: 'tools', label: 'Optional tools', support: 'actionable', capability: 'tools.open', open: '/tools', covers: ['/tools', 'settings:Tools', 'planned:Tools'],
    aliases: ['tools', 'optional tools', 'installs', 'install suggestions'],
    description: '/tools lists optional tools NMSh can use, with previewed installs that start on No.'},
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
  {id: 'statusStrip', label: 'Status strip', support: 'settings', open: '/settings', where: 'Settings → Status strip', covers: ['settings:Status strip'],
    aliases: ['status strip', 'clock', 'battery', 'cpu', 'ram', 'uptime', 'status bar'],
    description: 'The status strip is a compact row, top right: clock, battery, CPU, RAM and uptime, each optional.'},
  {id: 'palette', label: 'Command palette', support: 'actionable', open: '/palette', prefers: ['open'], covers: ['/palette'],
    aliases: ['command palette', 'action palette', 'actions palette', 'palette', 'search actions'],
    description: 'The palette (Ctrl+Shift+P or F1) searches every NMSh action.'},
  {id: 'help', label: 'Help and the guide', support: 'actionable', open: '/help', covers: ['/help', '/guide'],
    aliases: ['slash commands', 'nmsh commands', 'nmsh help'],
    description: '/help lists NMSh commands; /ask what can you do lists what Ask does.'},
  {id: 'settings', label: 'Settings', support: 'actionable', capability: 'settings.open', open: '/settings', covers: ['/settings', '/config', 'settings:General'],
    aliases: ['settings', 'preferences'],
    description: 'Settings (/settings or /config) holds every NMSh option, grouped by area.'},
  {id: 'setup', label: 'Setup Cat', support: 'actionable', open: '/setup', covers: ['/setup'],
    aliases: ['setup cat', 'setup', 'guided setup', 'onboarding', 'first run'],
    description: 'Setup Cat is the guided, rerunnable setup; it keeps your current choices.'},
  {id: 'welcome', label: 'Welcome', support: 'actionable', open: '/providers', where: 'Settings → Welcome, or /providers', covers: ['settings:Welcome', 'family:welcome'],
    aliases: ['welcome', 'welcome screen', 'startup logo', 'banner', 'fastfetch', 'neofetch', 'vespyr', 'startup screen'],
    description: 'The welcome is what a new session shows first: Vespyr (NMSh\'s own), fastfetch, neofetch, or none.'},
  {id: 'ask', label: 'Ask', support: 'settings', open: '/settings', where: 'Settings → Ask (Record Ask in transcript, Local understanding)', covers: ['/ask', 'settings:Ask'],
    aliases: ['ask', 'record ask', 'ask settings', 'ask transcript'],
    description: 'Ask answers plain-English questions about NMSh and proposes typed actions; it never runs arbitrary commands. Recording it in the transcript is optional.'},
  {id: 'understanding', label: 'Local understanding', support: 'actionable', capability: 'understanding.set', open: '/providers', covers: [],
    aliases: ['local understanding', 'local model', 'language model', 'llm', 'qwen', 'ai model'],
    description: 'Local understanding is an optional small model that runs on this machine to help Ask and Smart Folding with loosely worded input. Off never loads one.'},
  {id: 'glyphs', label: 'Glyph style', support: 'settings', open: '/settings', where: 'Settings → General → Glyph style', covers: [],
    aliases: ['glyphs', 'glyph style', 'nerd font', 'nerd fonts', 'icons', 'symbols'],
    description: 'Glyph style picks Nerd Font symbols or safe terminal symbols for icons and prompt shapes.'},
  {id: 'copy', label: 'Copy output', support: 'actionable', open: '/copy', covers: ['/copy'],
    aliases: ['copy output', 'copy the output', 'copy last output', 'copy latest output'],
    description: '/copy copies the latest command output as plain text; /copy N copies an earlier one.'},
  {id: 'otherShells', label: 'Other shells (Nushell, PowerShell)', support: 'unsupported',
    aliases: ['nushell', 'nu shell', 'powershell', 'pwsh', 'elvish', 'xonsh'],
    description: 'NMSh runs zsh, Fish and Bash. Nushell, PowerShell and other shells are not supported yet.'},
  {id: 'panes', label: 'Tabs and split panes', support: 'unsupported',
    aliases: ['split pane', 'split panes', 'splits', 'tabs', 'new tab', 'tmux'],
    description: 'NMSh doesn\'t manage tabs or split panes; your terminal does. Each NMSh window is one session (/sessions lists them).'},
];

/** Public surfaces Ask deliberately has no concept for, with the reason (the coverage audit checks these too). */
export const ASK_EXCLUDED: Readonly<Record<string, string>> = {
  'planned:Blocks': 'A planned settings area with no feature behind it yet; Ask says nothing about it rather than describe something that does not exist.',
};

export type ConceptIntent = 'explain' | 'on' | 'off' | 'open' | 'change';

/** What the person wants to do, from the verb; "change" when no verb says otherwise. */
export function conceptIntent(text: string): ConceptIntent {
  if (/^(?:what|wat|whats)\b(?! (?:version|shell|branch|provider))|\bexplain\b|\bdifference\b|\btell me about\b|\bhow does\b|\bwhat (?:is|are|does|do)\b|\bmean(?:s|ing)?\b/u.test(text)) return 'explain';
  if (/\b(?:turn|switch|set)\b.*\boff\b|\b(?:disable|stop|hide|no more|get rid of|without)\b/u.test(text)) return 'off';
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
 * guide and /ask help explain exactly what Ask knows. Every public concept
 * belongs to a section (a test enforces it); "Everything" lists them all.
 */
export interface GuideSection {id: string; title: string; why: string; concepts: string[]}

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {id: 'start', title: 'Getting started', why: 'NMSh is a terminal frontend over a real, persistent shell: your shell keeps its state, and NMSh adds the editor, transcript and tools around it.',
    concepts: ['setup', 'help', 'palette', 'settings', 'version', 'updates', 'status']},
  {id: 'look', title: 'Prompt & appearance', why: 'Make the prompt and colors yours without editing dotfiles.', concepts: ['prompt', 'theme', 'themeStudio', 'glyphs', 'cursor', 'syntax']},
  {id: 'chroma', title: 'Chroma', why: 'Optional gradients and motion for NMSh-owned chrome only; your command output is never recolored.', concepts: ['chroma', 'effects', 'activity']},
  {id: 'shells', title: 'Shells', why: 'One NMSh window can run zsh, Fish or Bash, and you can leave for a plain shell and come back.', concepts: ['shell', 'leave', 'otherShells']},
  {id: 'completion', title: 'Completion & suggestions', why: 'Tab completion lists real candidates; ghost suggestions predict the rest of the line.', concepts: ['completion', 'suggestions']},
  {id: 'history', title: 'History & transcripts', why: 'Find what you ran and what it printed, now or in earlier sessions.', concepts: ['history', 'picker', 'transcript', 'find', 'copy', 'transcripts']},
  {id: 'sessions', title: 'Sessions', why: 'Sessions keep running when a window closes; reattach, switch or get notified.', concepts: ['sessions', 'presets', 'notices', 'commandNotifications', 'panes']},
  {id: 'ask', title: 'Ask', why: 'Plain-English help that knows NMSh, your commands and this repository, and never runs anything you did not confirm.', concepts: ['ask', 'understanding']},
  {id: 'files', title: 'Files, folders & editor', why: 'Jump to folders and open what output mentions in your editor.', concepts: ['navigation', 'editor']},
  {id: 'providers', title: 'Providers & tools', why: 'Choose what powers each part of NMSh, and install optional tools with previewed recipes.', concepts: ['providers', 'welcome', 'tools', 'agents']},
  {id: 'layout', title: 'Layout & folding', why: 'Decide where the composer sits and how much output stays in view.', concepts: ['layout', 'folding', 'statusStrip', 'idle']},
  {id: 'keyboard', title: 'Keyboard', why: 'Terminal key integration for Shift+Enter, Option as Meta and enhanced keys.', concepts: ['keyboard']},
];
