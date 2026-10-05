import type {AskOutcome} from './types.js';
import {parseSlashCommand} from '../commands/slashCommands.js';
import {describeTmuxChange, type TmuxChange} from '../tools/config/tmux.js';
import {BRIDGE_TARGET_LABELS, type BridgeTargetId} from '../themeBridge/model.js';
import {THEME_PALETTE_IDS} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import {detectOhMyZsh, previousZshrc} from '../tools/frameworks.js';
import {TOOLS, toolInstall} from '../tools/catalog.js';
import {resolveCommand} from '../providers/providers.js';
import {installProposal} from './commands.js';

/**
 * Deterministic Ask routing for NMSh surfaces and supported configuration.
 * Requests map only onto typed actions (a registered tmux change, a Theme
 * Bridge setting, or opening a canonical surface); model or request text
 * never becomes a command, path mutation or config snippet. Changes are
 * proposals behind Ask's final Yes/No; opening a surface is navigation.
 */

const SURFACES: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:check|update|review)\b.*\bintegrations?\b|\bintegrations? (?:health|status)\b|\bupdate (?:anything|everything) missing\b/u, '/integrations'],
  [/\bmotion\b/u, '/motion'],
  [/\bui chrome\b|\bchrome\b(?! ?browser)/u, '/chrome'],
  [/\bglyphs?\b|\bsymbols\b|\bnerd font\b/u, '/glyphs'],
  [/\bcomposer\b/u, '/composer'],
  [/\bstatus strip\b|\bthe strip\b/u, '/strip'],
  [/\btheme bridge\b/u, '/theme-bridge'],
  [/\bpicker\b/u, '/picker'],
  [/\bdirectory nav(?:igation)?\b|\bdir(?:ectory)? jump/u, '/navigation'],
  [/\btmux\b/u, '/tmux'],
];

const OPEN = /^(?:please )?(?:open|show|change|configure|edit|set up|go to|take me to)\b/u;
const keyName = (text: string) => {
  const match = /\b(?:ctrl|control|c)[ +-]?([a-z])\b/u.exec(text);
  return match ? `C-${match[1]}` : undefined;
};

function themeRef(name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  const id = THEME_PALETTE_IDS.filter(palette => palette !== 'custom').find(palette => {
    const label = NATIVE_PROMPT_THEMES[palette].label.toLowerCase();
    return label === wanted || label.replace(/ native$/u, '') === wanted || label.startsWith(`${wanted} `) || label === `${wanted} dark`;
  });
  return id ? `builtin:${id}` : undefined;
}

const TARGET_WORDS: ReadonlyArray<[RegExp, BridgeTargetId]> = [[/\btmux\b/u, 'tmux'], [/\bneovim\b|\bnvim\b/u, 'neovim'], [/\bvim\b/u, 'vim'], [/\bhelix\b/u, 'helix'],
  [/\bfzf\b/u, 'fzf'], [/\bbat\b/u, 'bat'], [/\bless\b|\bman pages?\b/u, 'pager'], [/\bls\b|\bfile listing/u, 'lsColors']];

function tmuxChanges(text: string): TmuxChange[] {
  const changes: TmuxChange[] = [];
  const mouse = /\bmouse\b.*\b(on|off)\b|\b(enable|disable)\b.*\bmouse\b/u.exec(text);
  if (mouse) changes.push({kind: 'option', id: 'mouse', value: mouse[1] ?? (mouse[2] === 'enable' ? 'on' : 'off')});
  if (/\bprefix\b/u.test(text)) { const key = keyName(text.slice(text.indexOf('prefix'))); if (key) changes.push({kind: 'prefix', key}); }
  const status = /\bstatus(?: bar| line)?\b.*\b(top|bottom)\b/u.exec(text);
  if (status) changes.push({kind: 'option', id: 'status-position', value: status[1]!});
  if (/\bvi keys\b|\bvi mode\b|\bvim keys\b/u.test(text)) changes.push({kind: 'option', id: 'mode-keys', value: 'vi'}, {kind: 'option', id: 'status-keys', value: 'vi'});
  if (/\bnew (?:tmux )?(?:panes?|windows?)\b.*\b(?:start|run|open|launch)\b.*\bnmsh\b/u.test(text)) changes.push({kind: 'frontend', value: 'nmsh'});
  if (/\bnew (?:tmux )?(?:panes?|windows?)\b.*\b(?:start|run)\b.*\b(?:normal |default |my )?shell\b/u.test(text)) changes.push({kind: 'frontend', value: 'shell'});
  return changes;
}

const OMZ = /\boh[ -]?my[ -]?zsh\b|\bomz\b/u;
const OMP = /\boh[ -]?my[ -]?posh\b|\bomp\b/u;
const P10K = /\bpowerlevel ?10k\b|\bp10k\b/u;
const view = (tool: string, which: 'detail' | 'guided' | 'previous' | 'p10kConfigure' | 'importAppearance', text: string): AskOutcome =>
  ({kind: 'proposal', capability: 'tools.open', safety: 'navigate', confidence: 0.92, direct: true, text, action: {kind: 'toolView', tool, view: which, label: text}});
const promptSwitch = (value: 'ohMyPosh' | 'powerlevel10k', label: string): AskOutcome =>
  ({kind: 'proposal', capability: 'provider.switch', safety: 'mutate', confidence: 0.92, text: `Use ${label} as the prompt? NMSh renders it directly; no shell rc file changes.`,
    action: {kind: 'setting', setting: 'prompt', value, label: `Prompt: ${label}`}});

/** Shell frameworks and prompt engines: facts, navigation to the exact /tools view, or a typed provider switch. Never a shell command or rc edit. */
function resolveFrameworkRequest(text: string, env: NodeJS.ProcessEnv): AskOutcome | undefined {
  if (/\bpre[ -]?oh[ -]?my[ -]?zsh\b|\b(?:old|previous)\b.*\bzshrc\b|\bzshrc\b.*\b(?:old|previous|before oh my zsh)\b|\bwhat happened to my\b.*\bzshrc\b/u.test(text)) {
    const pair = previousZshrc(env);
    if (!pair) return {kind: 'answer', capability: 'tools.open', text: 'There is no .zshrc.pre-oh-my-zsh here, so the Oh My Zsh installer did not save an earlier .zshrc in this home (or ZDOTDIR).'};
    return view('oh-my-zsh', 'previous', `Compare ${pair.current} with ${pair.previous} in /tools (restoring there backs up the current file and asks first)`);
  }
  if (OMZ.test(text)) {
    if (/\binstalled\b|\bdo i have\b|\bis there\b/u.test(text)) {
      const found = detectOhMyZsh(env);
      return {kind: 'answer', capability: 'tools.open', text: found ? `Yes. Oh My Zsh is installed at ${found.path}${found.source ? ` (from ${found.source})` : ''}. It is a Zsh framework, used by Zsh only.` : 'No. No Oh My Zsh installation was found at $ZSH or ~/.oh-my-zsh.'};
    }
    if (/\binstall\b/u.test(text)) return view('oh-my-zsh', 'guided', 'Open the Oh My Zsh guided install (keeps your .zshrc; you run the official installer yourself)');
    return view('oh-my-zsh', 'detail', 'Open Oh My Zsh in /tools');
  }
  if (OMP.test(text)) {
    if (/\bimport\b|\btheme studio\b|\binto nmsh\b/u.test(text)) return view('oh-my-posh', 'importAppearance', 'Import your Oh My Posh appearance into an NMSh Native theme (static colors only; the provider is not switched)');
    if (/\binstall\b/u.test(text)) {
      const tool = TOOLS.find(item => item.id === 'oh-my-posh')!;
      if (resolveCommand('oh-my-posh', env.PATH ?? '')) return {kind: 'answer', capability: 'tools.open', text: 'Oh My Posh is already installed.'};
      const recipe = toolInstall(tool);
      return recipe ? installProposal('oh-my-posh', {tool: tool.id, label: recipe.label}) : view('oh-my-posh', 'detail', 'Open Oh My Posh in /tools (no curated install here)');
    }
    if (/\b(?:use|switch to|set)\b.*\bprompt\b|\bas (?:my )?prompt\b/u.test(text)) return promptSwitch('ohMyPosh', 'Oh My Posh');
    return view('oh-my-posh', 'detail', 'Open Oh My Posh in /tools');
  }
  if (P10K.test(text)) {
    if (/\bconfigure\b|\bwizard\b|\bset up\b/u.test(text)) return view('powerlevel10k', 'p10kConfigure', 'Configure Powerlevel10k (backs up ~/.p10k.zsh and .zshrc, then runs p10k configure)');
    if (/\buse\b|\bswitch to\b/u.test(text)) return promptSwitch('powerlevel10k', 'Powerlevel10k');
  }
  return undefined;
}

/**
 * Keep Awake: deterministic, typed through the /caffeinate action against the
 * one controller. Status and opening run directly; starting, changing or
 * stopping waits for Ask's Yes. No model is involved.
 */
const AWAKE_NAME = String.raw`(?:zoomies|caffeinate|keep[ -]?awake|awake)`;
function awakeDuration(text: string): string {
  const match = /\bfor (?:an? |one )?(\d{1,3})?\s*(hours?|hrs?|h|minutes?|mins?|m)\b/u.exec(text);
  if (!match) return '';
  return ` ${match[1] ?? '1'}${match[2]!.startsWith('h') ? 'h' : 'm'}`;
}
function resolveKeepAwakeRequest(text: string): AskOutcome | undefined {
  const slash = (command: string, safety: 'navigate' | 'mutate', label: string): AskOutcome | undefined => {
    const parsed = parseSlashCommand(command);
    return parsed ? {kind: 'proposal', capability: 'feature.open', safety, confidence: 0.92, ...(safety === 'navigate' ? {direct: true} : {}), text: label, action: {kind: 'slash', slash: parsed, label: command}} : undefined;
  };
  const name = new RegExp(String.raw`\b${AWAKE_NAME}\b`, 'u');
  // Status: "is zoomies on", "are we keeping the computer awake", "what awake mode is active".
  if ((/^(?:is|are|what|which|how long)\b/u.test(text) && name.test(text) && /\b(?:on|running|active|mode|keeping|still)\b/u.test(text))
    || new RegExp(String.raw`\b${AWAKE_NAME} status\b`, 'u').test(text)) return slash('/caffeinate status', 'navigate', 'Keep Awake status');
  // Stop: "stop zoomies", "turn caffeinate off", "let my mac sleep".
  if (new RegExp(String.raw`\b(?:stop|end|cancel|disable|turn off|switch off)\b.*\b${AWAKE_NAME}\b|\b${AWAKE_NAME}\b.*\b(?:off|stop)\b`, 'u').test(text)
    || /\bstop\b.*\b(?:keeping|keep)\b.*\bawake\b|(?<!(?:don'?t|do not|never) )\blet (?:my |the )?(?:computer|mac|laptop|machine|pc) sleep\b/u.test(text)) return slash('/caffeinate stop', 'mutate', 'Stop Keep Awake (normal sleep returns)');
  const duration = awakeDuration(text);
  const until = duration ? `for${duration}` : 'until you stop it';
  // Change mode: "switch zoomies to system".
  const switched = new RegExp(String.raw`\b(?:switch|change|set|move)\b.*\b${AWAKE_NAME}\b.*\b(idle|display|system|all)\b`, 'u').exec(text);
  if (switched) return slash(`/zoomies ${switched[1]}${duration}`, 'mutate', `Switch Keep Awake to ${switched[1]![0]!.toUpperCase()}${switched[1]!.slice(1)} ${until}`);
  if (/\bkeep (?:my |the )?(?:screen|display|monitor) (?:awake|on)\b/u.test(text)) return slash(`/caffeinate display${duration}`, 'mutate', `Keep the display and the machine awake (/caffeinate display${duration}) ${until}`);
  if (/\b(?:don'?t|do not|never) let (?:my |the )?(?:computer|mac|laptop|machine|pc) sleep\b|\bprevent (?:system )?sleep\b/u.test(text)) return slash(`/caffeinate system${duration}`, 'mutate', `Prevent automatic system sleep (/caffeinate system${duration}) ${until}`);
  if (/\bkeep (?:my |the )?(?:computer|mac|laptop|machine|pc) awake\b/u.test(text)) return slash(`/caffeinate idle${duration}`, 'mutate', `Prevent automatic idle sleep (/caffeinate idle${duration}) ${until}`);
  if (/\bzoomies\b/u.test(text)) return slash('/zoomies', 'navigate', 'Open Keep Awake (/zoomies)');
  return undefined;
}

export function resolveConfigRequest(text: string, env: NodeJS.ProcessEnv = process.env): AskOutcome | undefined {
  const awake = resolveKeepAwakeRequest(text);
  if (awake) return awake;
  const framework = resolveFrameworkRequest(text, env);
  if (framework) return framework;
  // Provider choices map onto the same typed provider setting /providers uses.
  const picker = /\b(?:use|switch to|pick)\s+(fzf|television|tv|native|nmsh native|nmsh)\b.*\bpickers?\b|\bpickers?\b.*\b(?:use|to)\s+(fzf|television|tv|native|nmsh)\b/u.exec(text);
  if (picker) {
    const word = picker[1] ?? picker[2]!;
    const value = word === 'fzf' ? 'fzf' : word === 'television' || word === 'tv' ? 'television' : 'native';
    const label = value === 'fzf' ? 'fzf' : value === 'television' ? 'Television' : 'NMSh Native';
    return {kind: 'proposal', capability: 'provider.switch', safety: 'mutate', confidence: 0.92, text: `Use ${label} for pickers?`, action: {kind: 'setting', setting: 'picker', value, label: `Picker: ${label}`}};
  }
  const suggestions = /\b(?:use|switch to)\s+(native|nmsh|deja|no)\s+suggestions\b|\bturn (off) suggestions\b/u.exec(text);
  if (suggestions) {
    const word = suggestions[1] ?? suggestions[2]!;
    const value = word === 'deja' ? 'deja' : word === 'no' || word === 'off' ? 'none' : 'nmsh';
    const label = value === 'deja' ? 'Deja' : value === 'none' ? 'None' : 'NMSh Native';
    return {kind: 'proposal', capability: 'provider.switch', safety: 'mutate', confidence: 0.92, text: `Use ${label} for suggestions?`, action: {kind: 'setting', setting: 'suggestions', value, label: `Suggestions: ${label}`}};
  }
  if (/\bpickers?\b.*\bfollow\b.*\bcomposer\b/u.test(text)) {
    return {kind: 'answer', capability: 'help.feature', text: 'Pickers already follow the composer: with the composer at the bottom, the query is at the bottom and results sit above it (NMSh Native and fzf); at the top, the query is at the top. /composer chooses the side.'};
  }
  // Dotfiles: the wizard scans and reviews; nothing is applied from here.
  const dotfiles = /\b(?:import|adopt|use|show)\b.*\bdotfiles?\b(?:.*?\bfrom\s+(\S+))?/u.exec(text);
  if (dotfiles) {
    const source = dotfiles[1] ?? '~/dotfiles';
    const command = `/dotfiles ${source}`;
    const slash = parseSlashCommand(command);
    if (slash) return {kind: 'proposal', capability: 'feature.open', safety: 'navigate', confidence: 0.9, direct: true, text: `Open the dotfiles import for ${source} (scan and review; nothing is applied until you confirm there)`,
      action: {kind: 'slash', slash, label: command}};
  }
  if (/\btmux\b/u.test(text)) {
    const changes = tmuxChanges(text);
    if (changes.length) {
      return {kind: 'proposal', capability: 'settings.open', safety: 'mutate', confidence: 0.92,
        text: `Change tmux (NMSh's managed tmux file only):\n${changes.map(change => `  ${describeTmuxChange(change)}`).join('\n')}`,
        action: {kind: 'tmux', changes, label: changes.map(describeTmuxChange).join(' · ')}};
    }
  }
  if (/\btheme bridge\b|\b(?:all )?(?:bridge )?targets\b/u.test(text) && /\bfollow nmsh\b|\bfollow (?:the )?(?:nmsh )?theme\b/u.test(text)) {
    return {kind: 'proposal', capability: 'theme.open', safety: 'mutate', confidence: 0.9, text: 'Turn Theme Bridge On with Apply themes: Follow NMSh (every supported tool follows the active theme)',
      action: {kind: 'themeBridge', enabled: true, policy: 'follow', label: 'Theme Bridge · Follow NMSh'}};
  }
  // "use Tokyo Night for tmux but Lavender for Vim": per-tool pins (Manual).
  const pins = [...text.matchAll(/\buse ([a-z][a-z ]{1,30}?) for ([a-z/ ]{2,20}?)(?= but|,| and|$)|\b(?:but|and) ([a-z][a-z ]{1,30}?) for ([a-z/ ]{2,20}?)(?= but|,| and|$)/gu)];
  if (pins.length) {
    const targets: Partial<Record<BridgeTargetId, {mode: 'choose'; theme: string}>> = {};
    for (const pin of pins) {
      const theme = themeRef(pin[1] ?? pin[3] ?? '');
      const target = TARGET_WORDS.find(([pattern]) => pattern.test(pin[2] ?? pin[4] ?? ''))?.[1];
      if (theme && target) targets[target] = {mode: 'choose', theme};
    }
    const entries = Object.entries(targets) as Array<[BridgeTargetId, {mode: 'choose'; theme: string}]>;
    if (entries.length) {
      const label = entries.map(([target, setting]) => `${BRIDGE_TARGET_LABELS[target]}: ${NATIVE_PROMPT_THEMES[setting.theme.slice(8) as 'lavender'].label}`).join(' · ');
      return {kind: 'proposal', capability: 'theme.open', safety: 'mutate', confidence: 0.85, text: `Theme Bridge (Manual): ${label}`,
        action: {kind: 'themeBridge', enabled: true, policy: 'manual', targets, label}};
    }
  }
  if (OPEN.test(text) || /\bsettings\b/u.test(text)) {
    for (const [pattern, command] of SURFACES) {
      if (!pattern.test(text)) continue;
      const slash = parseSlashCommand(command);
      if (slash) return {kind: 'proposal', capability: 'feature.open', safety: 'navigate', confidence: 0.9, direct: true, text: `Open ${command}`, action: {kind: 'slash', slash, label: command}};
    }
  }
  if (/\b(?:check|update)\b.*\bintegrations?\b|\bupdate (?:anything|everything) missing\b/u.test(text)) {
    const slash = parseSlashCommand('/integrations')!;
    return {kind: 'proposal', capability: 'feature.open', safety: 'navigate', confidence: 0.9, direct: true, text: 'Open /integrations (Review all; nothing is applied until you confirm)', action: {kind: 'slash', slash, label: '/integrations'}};
  }
  return undefined;
}
