import {existsSync, readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {resolveCommand, runExternal} from '../providers/providers.js';
import {parse as parseToml} from 'smol-toml';
import type {ColorLevel} from '../presentation/capabilities.js';
import {resolveSemanticPalette, type SemanticPalette} from '../appearance/semanticPalette.js';
import {activeThemeRef, themeRefLabel, type ThemeSource} from '../appearance/themeRefs.js';
import {BRIDGE_TARGETS, BRIDGE_TARGET_LABELS, effectiveMode, type BridgeMode, type BridgeTargetId, type ThemeBridgeSettings} from './model.js';
import {bridgeEnvPath, writeEnvironmentFiles, type BridgeEnvironment} from './environment.js';
import {
  artifactPath, helixConfigDirectory, ledgerPath, loadLedger, ownership, removeArtifact, sha256, writeArtifact, type ManagedTarget,
} from './artifacts.js';
import {
  fzfColorArgs, lsColorsFallback, neovimColorscheme, pagerEnvironment, parseFzfVersion, tmuxFragment, validateNeovimColorscheme,
  validateTmuxFragment, validateVimColorscheme, validLsColors, vimColorscheme, vividTheme, TMUX_UNREPRESENTED, helixTheme, validateHelixTheme,
} from './targets.js';

/**
 * Theme Bridge runtime: target detection (local, read-only, bounded,
 * cached), per-target resolution through the one semantic palette, and
 * application through the environment sink or managed artifacts. Never
 * touches shell rc files, terminal/editor themes or git config; permanent
 * includes are separate, explicitly confirmed steps (see artifacts.ts).
 */

export type BridgeStatus = 'Not installed' | 'Detected' | 'Independent' | 'Following NMSh' | 'Pinned theme' | 'Conflict' | 'Unsupported capability' | 'Missing theme';

export interface TargetFacts {installed: boolean; binary?: string; version?: string}

export interface TargetReport {
  target: BridgeTargetId;
  label: string;
  mode: BridgeMode;
  /** Modes this target can honestly offer. */
  modes: readonly BridgeMode[];
  themeLabel?: string;
  status: BridgeStatus;
  /** Short factual qualifiers: "Managed", "include installed", "reload available", conflicts, limitations. */
  notes: string[];
  palette?: SemanticPalette;
}

/** Executable per target (PATH lookup only; versions only where mappings depend on them). */
const BINARIES: Record<BridgeTargetId, string> = {fzf: 'fzf', pager: 'less', lsColors: 'ls', bat: 'bat', delta: 'delta', tmux: 'tmux', neovim: 'nvim', vim: 'vim', helix: 'hx'};
const VERSION_ARGS: Partial<Record<BridgeTargetId, string[]>> = {fzf: ['--version'], tmux: ['-V']};

const UNSUPPORTED: Partial<Record<BridgeTargetId, string>> = {
  bat: 'bat loads custom themes only from its own theme cache (bat cache --build), which NMSh does not modify; a built-in bat theme would not be this theme.',
  delta: 'delta takes syntax themes from bat\'s cache and diff styles from git config or its own arguments; NMSh does not edit ~/.gitconfig or bat\'s cache.',
};

export function supportedModes(target: BridgeTargetId): readonly BridgeMode[] {
  return UNSUPPORTED[target] ? ['independent'] : ['independent', 'follow', 'choose'];
}

let factsCache: Promise<Record<BridgeTargetId, TargetFacts>> | undefined;
let factsKey = '';

/** Local, bounded detection, cached per PATH; at most two short version probes. */
export function detectTargets(env: NodeJS.ProcessEnv = process.env, refresh = false): Promise<Record<BridgeTargetId, TargetFacts>> {
  const key = env.PATH ?? '';
  if (factsCache && factsKey === key && !refresh) return factsCache;
  factsKey = key;
  factsCache = (async () => {
    const entries = await Promise.all(BRIDGE_TARGETS.map(async (target): Promise<[BridgeTargetId, TargetFacts]> => {
      const binary = resolveCommand(BINARIES[target], key);
      if (!binary) return [target, {installed: false}];
      const args = VERSION_ARGS[target];
      if (!args) return [target, {installed: true, binary}];
      const result = await runExternal(binary, args, {timeoutMs: 1500, maxBytes: 4096, env});
      const version = result.stdout.trim().replace(/^tmux\s+/u, '').split('\n')[0]?.slice(0, 40);
      return [target, {installed: true, binary, ...(version ? {version} : {})}];
    }));
    return Object.fromEntries(entries) as Record<BridgeTargetId, TargetFacts>;
  })();
  return factsCache;
}

export function resetDetectionCache(): void { factsCache = undefined; }

/** Bounded read of a user config for conflict facts; never parsed beyond simple line matching, never executed. */
function readSmall(path: string): string | undefined {
  try {
    if (statSync(path).size > 256 * 1024) return undefined;
    return readFileSync(path, 'utf8');
  } catch { return undefined; }
}

const TMUX_THEME_PLUGINS = /@plugin\s+['"]?(catppuccin\/tmux|dracula\/tmux|egel\/tmux-gruvbox|arcticicestudio\/nord-tmux|nordtheme\/tmux|odedlaz\/tmux-onedark-theme|wfxr\/tmux-power|jimeh\/tmux-themepack|fabioluciano\/tmux-tokyo-night|janoamaral\/tokyo-night-tmux|rose-pine\/tmux|seebi\/tmux-colors-solarized)/u;

/** Factual conflicts: other sources that style the same surface. Reported, never fought. */
export function targetConflicts(target: BridgeTargetId, env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): string[] {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : join(home, '.config');
  if (target === 'tmux') {
    const text = [join(home, '.tmux.conf'), join(xdg, 'tmux', 'tmux.conf')].map(readSmall).filter(Boolean).join('\n');
    const notes: string[] = [];
    const plugin = TMUX_THEME_PLUGINS.exec(text);
    if (plugin) notes.push(`Your tmux config loads the ${plugin[1]} theme plugin; whichever loads last decides the colors.`);
    if (/^\s*set(?:-option)?\s+(?:-[a-zA-Z]*\s+)*(?:status-style|status-bg|status-fg|pane-border-style|pane-active-border-style|window-status-current-style)\b/mu.test(text)) {
      notes.push('Your tmux config also sets status/pane styles; whichever loads last decides the colors.');
    }
    return notes;
  }
  if (target === 'neovim' || target === 'vim') {
    const paths = target === 'neovim' ? [join(xdg, 'nvim', 'init.lua'), join(xdg, 'nvim', 'init.vim')] : [join(home, '.vimrc'), join(home, '.vim', 'vimrc')];
    const text = paths.map(readSmall).filter(Boolean).join('\n');
    return /^\s*(?:colorscheme|colo)\s+\S|vim\.cmd\.colorscheme|vim\.cmd\s*\(?\s*['"]colorscheme/mu.test(text)
      ? ['Your config also chooses a colorscheme; the NMSh include, placed last, takes effect after it.'] : [];
  }
  if (target === 'helix') {
    const config = readSmall(join(helixConfigDirectory(env), 'config.toml'));
    const theme = config ? /^\s*theme\s*=\s*"?([^"\n]+)"?/mu.exec(config)?.[1]?.trim() : undefined;
    return theme && theme !== 'nmsh-bridge' ? [`Configured independently: your Helix config selects "${theme.slice(0, 40)}"; NMSh leaves it.`] : [];
  }
  if (target === 'lsColors' && env.LS_COLORS) return ['LS_COLORS is already set; NMSh replaces it in NMSh shells while active and restores it when Independent.'];
  if (target === 'fzf' && /--color/u.test(env.FZF_DEFAULT_OPTS ?? '')) return ['FZF_DEFAULT_OPTS sets colors; NMSh-owned fzf launches never read FZF_DEFAULT_OPTS, your own fzf use keeps it.'];
  return [];
}

/** The theme a target uses right now, or why it has none. Never another theme. */
export function targetPalette(settings: ThemeBridgeSettings, target: BridgeTargetId, source: ThemeSource): {palette?: SemanticPalette; label?: string; missing?: boolean} {
  const setting = settings.targets[target];
  const mode = effectiveMode(settings, target);
  if (mode === 'independent' || !supportedModes(target).includes(mode)) return {};
  const ref = mode === 'follow' ? activeThemeRef(source) : setting.theme;
  const resolved = resolveSemanticPalette(ref, source);
  if (!resolved.ok) return {missing: true, label: resolved.label};
  return {palette: resolved.palette, label: themeRefLabel(ref, source)};
}

export interface BridgeContext {source: ThemeSource & {themeBridge: ThemeBridgeSettings}; facts: Record<BridgeTargetId, TargetFacts>; level: ColorLevel; env?: NodeJS.ProcessEnv}

/** NO_COLOR (any value) or no color capability: color injection stops for every target. */
export function bridgeColorLevel(level: ColorLevel, env: NodeJS.ProcessEnv = process.env): ColorLevel {
  return env.NO_COLOR !== undefined && env.NO_COLOR !== '' ? 'none' : level;
}

export function reportTargets({source, facts, level, env = process.env}: BridgeContext): TargetReport[] {
  const ledger = loadLedger(env);
  return BRIDGE_TARGETS.map(target => {
    const setting = {...source.themeBridge.targets[target], mode: effectiveMode(source.themeBridge, target)};
    const {palette, label, missing} = targetPalette(source.themeBridge, target, source);
    const notes: string[] = [];
    let status: BridgeStatus;
    if (!facts[target]?.installed) status = 'Not installed';
    else if (UNSUPPORTED[target]) { status = 'Unsupported capability'; notes.push(UNSUPPORTED[target]!); }
    else if (setting.mode === 'independent') status = 'Detected';
    else if (missing) status = 'Missing theme';
    else status = setting.mode === 'follow' ? 'Following NMSh' : 'Pinned theme';
    if (setting.mode !== 'independent' && bridgeColorLevel(level, env) === 'none') notes.push('NO_COLOR or no color support: nothing is injected.');
    const managed = target === 'tmux' || target === 'neovim' || target === 'vim' || target === 'helix' ? target : undefined;
    if (managed) {
      const entry = ledger.entries[managed];
      const owned = ownership(managed, ledger, env);
      if (owned === 'owned') notes.push('Managed');
      if (owned === 'modified' || owned === 'unknown') { status = 'Conflict'; notes.push(`${artifactPath(managed, env)} exists and is not NMSh's unchanged file; NMSh will not overwrite it.`); }
      if (managed === 'helix') {
        if (entry?.hook) notes.push(setting.mode === 'independent' ? 'theme assignment installed (inactive)' : 'Active through NMSh-managed config');
        else if (setting.mode !== 'independent') notes.push('Managed theme generated; select it with :theme nmsh-bridge, or review the config change');
        if (setting.mode !== 'independent') notes.push('Coverage: syntax, markup, diff, diagnostics and editor UI. Running Helix instances are not recolored; new ones use the file.');
      } else if (entry?.hook) notes.push(setting.mode === 'independent' ? 'include installed (inactive)' : 'include installed');
      else if (setting.mode !== 'independent') notes.push('new instances need the include (Apply)');
      if (managed === 'tmux' && setting.mode !== 'independent') { notes.push('reload available'); notes.push(TMUX_UNREPRESENTED); }
    }
    for (const conflict of facts[target]?.installed ? targetConflicts(target, env) : []) {
      notes.push(conflict);
      if (setting.mode !== 'independent' && status !== 'Missing theme' && (target === 'tmux')) status = 'Conflict';
    }
    return {target, label: BRIDGE_TARGET_LABELS[target], mode: setting.mode, modes: supportedModes(target), ...(label ? {themeLabel: label} : {}),
      status, notes, ...(palette ? {palette} : {})};
  });
}

/** The environment the sink should carry for the current settings (pager + LS_COLORS), from the resolved palettes. */
export function bridgeEnvironment(context: BridgeContext, lsColors?: string): BridgeEnvironment {
  const level = bridgeColorLevel(context.level, context.env);
  const out: BridgeEnvironment = {};
  const pager = targetPalette(context.source.themeBridge, 'pager', context.source).palette;
  if (pager) Object.assign(out, pagerEnvironment(pager, level));
  const ls = targetPalette(context.source.themeBridge, 'lsColors', context.source).palette;
  if (ls) {
    const value = lsColors ?? lsColorsFallback(ls, level);
    if (value) out.LS_COLORS = value;
  }
  return out;
}

/** fzf arguments for one NMSh-owned launch (empty when Independent, unavailable or colorless). */
export function fzfBridgeArgs(context: BridgeContext): string[] {
  const palette = targetPalette(context.source.themeBridge, 'fzf', context.source).palette;
  if (!palette) return [];
  return fzfColorArgs(palette, bridgeColorLevel(context.level, context.env), parseFzfVersion(context.facts.fzf?.version));
}

const vividCache = new Map<string, string>();

/** vivid output for the LS_COLORS palette when vivid is installed; undefined falls back to the small built-in mapping. */
async function vividColors(palette: SemanticPalette, level: ColorLevel, env: NodeJS.ProcessEnv, mode: BridgeMode, ref: string): Promise<string | undefined> {
  const binary = resolveCommand('vivid', env.PATH ?? '');
  if (!binary || level === 'none') return undefined;
  const theme = vividTheme(palette);
  const key = `${sha256(theme)}:${level}`;
  if (vividCache.has(key)) return vividCache.get(key);
  const written = writeArtifact('vivid', theme, content => content.startsWith('# Generated by NMSh Theme Bridge'), {mode, themeRef: ref, format: 'vivid-theme', formatVersion: 1}, env);
  if (!written.ok) return undefined;
  const args = [...(level === 'truecolor' ? [] : ['-m', '8-bit']), 'generate', written.path];
  const result = await runExternal(binary, args, {timeoutMs: 2000, maxBytes: 128 * 1024, env});
  const value = result.stdout.trim();
  if (!result.ok || !validLsColors(value)) return undefined;
  vividCache.set(key, value);
  return value;
}

export interface ApplyOutcome {target: BridgeTargetId; ok: boolean; message?: string}

const MANAGED: ReadonlyArray<{target: Extract<BridgeTargetId, ManagedTarget>; render: (palette: SemanticPalette) => string; validate: (content: string) => boolean; format: string}> = [
  {target: 'tmux', render: tmuxFragment, validate: validateTmuxFragment, format: 'tmux-fragment'},
  {target: 'neovim', render: neovimColorscheme, validate: validateNeovimColorscheme, format: 'nvim-colorscheme'},
  {target: 'vim', render: vimColorscheme, validate: validateVimColorscheme, format: 'vim-colorscheme'},
  {target: 'helix', render: helixTheme, validate: content => validateHelixTheme(content, parseToml), format: 'helix-theme'},
];

/**
 * Applies the current settings: the environment sink (pager, LS_COLORS) and
 * the managed artifacts for tmux/Neovim/Vim. Each target is isolated; one
 * failure is reported and leaves every other target (and the active NMSh
 * theme) intact. Independent targets get no artifact and no injection; an
 * owned artifact left from an earlier mode is removed (includes stay
 * recorded and are harmless without it).
 */
export async function applyThemeBridge(context: BridgeContext): Promise<ApplyOutcome[]> {
  const env = context.env ?? process.env;
  const level = bridgeColorLevel(context.level, env);
  const outcomes: ApplyOutcome[] = [];
  let lsColors: string | undefined;
  const ls = targetPalette(context.source.themeBridge, 'lsColors', context.source);
  if (ls.palette) {
    const setting = {...context.source.themeBridge.targets.lsColors, mode: effectiveMode(context.source.themeBridge, 'lsColors')};
    lsColors = await vividColors(ls.palette, level, env, setting.mode, setting.mode === 'follow' ? activeThemeRef(context.source) ?? '' : setting.theme ?? '');
  }
  try {
    writeEnvironmentFiles(bridgeEnvironment(context, lsColors), env);
    outcomes.push({target: 'pager', ok: true}, {target: 'lsColors', ok: true});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcomes.push({target: 'pager', ok: false, message}, {target: 'lsColors', ok: false, message});
  }
  for (const managed of MANAGED) {
    const setting = {...context.source.themeBridge.targets[managed.target], mode: effectiveMode(context.source.themeBridge, managed.target)};
    const resolved = targetPalette(context.source.themeBridge, managed.target, context.source);
    try {
      if (setting.mode === 'independent' || !resolved.palette) {
        if (existsSync(artifactPath(managed.target, env)) && loadLedger(env).entries[managed.target]) {
          const removed = removeArtifact(managed.target, env);
          outcomes.push({target: managed.target, ok: removed.ok, ...(!removed.ok ? {message: removed.error} : {})});
        }
        if (resolved.missing) outcomes.push({target: managed.target, ok: false, message: `${BRIDGE_TARGET_LABELS[managed.target]}: the pinned theme no longer exists; nothing was generated.`});
        continue;
      }
      const ref = setting.mode === 'follow' ? activeThemeRef(context.source) ?? '' : setting.theme ?? '';
      const result = writeArtifact(managed.target, managed.render(resolved.palette), managed.validate, {mode: setting.mode, themeRef: ref, format: managed.format, formatVersion: 1}, env);
      outcomes.push(result.ok ? {target: managed.target, ok: true} : {target: managed.target, ok: false, message: result.error});
    } catch (error) {
      outcomes.push({target: managed.target, ok: false, message: error instanceof Error ? error.message : String(error)});
    }
  }
  return outcomes;
}

/**
 * The one typed tmux reload: `tmux source-file <NMSh fragment>` against the
 * user's running server, on explicit request only. No shell, no other command.
 */
export async function reloadTmux(env: NodeJS.ProcessEnv = process.env): Promise<{ok: boolean; message: string}> {
  const binary = resolveCommand('tmux', env.PATH ?? '');
  if (!binary) return {ok: false, message: 'tmux is not installed.'};
  const path = artifactPath('tmux', env);
  if (ownership('tmux', loadLedger(env), env) !== 'owned') return {ok: false, message: 'There is no NMSh-managed tmux fragment to load yet.'};
  const result = await runExternal(binary, ['source-file', path], {timeoutMs: 3000, maxBytes: 16 * 1024, env});
  return result.ok ? {ok: true, message: 'tmux reloaded the NMSh colors for the running server.'}
    : {ok: false, message: 'tmux did not reload (no running server, or it refused the file). New tmux servers load it through the include.'};
}

/** Everything a bridge application depends on; a change in it (theme, library, bridge settings) re-applies. */
export function themeBridgeKey(config: ThemeSource & {themeBridge: ThemeBridgeSettings}): string {
  return JSON.stringify([config.themeBridge, activeThemeRef(config), config.themes]);
}

/** Whether NMSh ever wrote bridge state; with nothing active and nothing written, there is nothing to do or undo. */
export function bridgeStateExists(env: NodeJS.ProcessEnv = process.env): boolean {
  return existsSync(bridgeEnvPath('zsh', env)) || existsSync(ledgerPath(env));
}
