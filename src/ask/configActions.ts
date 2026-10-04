import type {AskOutcome} from './types.js';
import {parseSlashCommand} from '../commands/slashCommands.js';
import {describeTmuxChange, type TmuxChange} from '../tools/config/tmux.js';
import {BRIDGE_TARGET_LABELS, type BridgeTargetId} from '../themeBridge/model.js';
import {THEME_PALETTE_IDS} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';

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

export function resolveConfigRequest(text: string): AskOutcome | undefined {
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
