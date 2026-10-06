import {existsSync, readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {XMLValidator} from 'fast-xml-parser';
import {resolveCommand, runExternal} from '../providers/providers.js';
import {parse as parseToml} from 'smol-toml';
import type {ColorLevel} from '../presentation/capabilities.js';
import {safeContextText} from '../context/facts.js';
import {resolveSemanticPalette, type SemanticPalette} from '../appearance/semanticPalette.js';
import {activeThemeRef, themeRefLabel, type ThemeSource} from '../appearance/themeRefs.js';
import {
  BRIDGE_CAPABILITY, BRIDGE_TARGETS, BRIDGE_TARGET_LABELS, effectiveSetting, targetEditable, type BridgeCapability, type BridgeMode, type BridgeTargetId,
  type ThemeBridgeSettings,
} from './model.js';
import {bridgeEnvPath, writeEnvironmentFiles, type BridgeEnvironment, type ListingWrapper} from './environment.js';
import {
  artifactPath, batConfigDirectory, helixConfigDirectory, hookSpec, recordedHook, ledgerPath, loadLedger, ownership, removeArtifact, saveLedger, sha256, writeArtifact,
  type HookTarget, type ManagedTarget,
} from './artifacts.js';
import {loadTmuxModel} from '../tools/config/tmux.js';
import {modelIsEmpty, tmuxManagedNeeded, writeTmuxManaged} from '../tools/config/tmuxManaged.js';
import {
  BAT_THEME_NAME, batTheme, bsdLsColors, fzfColorArgs, helixTheme, lsColorsFallback, neovimColorscheme, pagerEnvironment, parseFzfVersion, tmuxFragment,
  validateBatTheme, validateHelixTheme, validateNeovimColorscheme, validateTmuxFragment, validateVimColorscheme, validLsColors, vimColorscheme, vividTheme,
  TMUX_UNREPRESENTED,
} from './targets.js';

/**
 * Theme Bridge runtime: target detection (local, read-only, bounded,
 * cached), effective settings (switch × policy × capability × Manual state)
 * resolved through the one semantic palette, application through the
 * environment sink or managed artifacts, and the integrations-health planner.
 * Never touches shell rc files, terminal/editor themes or git config;
 * includes and bat's cache are separate, explicitly confirmed steps.
 */

export type BridgeStatus = 'Not installed' | 'Detected' | 'Following NMSh' | 'Pinned theme' | 'Conflict' | 'Missing theme' | 'Needs setup' | 'Not managed';

/** File listing backends found on this system. */
export interface ListingFacts {
  /** `ls` on PATH: GNU coreutils, or BSD/macOS. */
  ls?: 'gnu' | 'bsd';
  /** GNU `gls` (Homebrew coreutils) is installed. */
  gls?: boolean;
}

export interface TargetFacts {installed: boolean; binary?: string; version?: string; listing?: ListingFacts}

export interface TargetReport {
  target: BridgeTargetId;
  label: string;
  capability: BridgeCapability;
  /** The effective mode (after switch, policy and capability). */
  mode: BridgeMode;
  /** Modes this target can honestly offer. */
  modes: readonly BridgeMode[];
  /** Mode/theme can be edited now (Manual policy and a supported target). */
  editable: boolean;
  /** The mode comes from the global policy, not this target's own setting. */
  inherited: boolean;
  themeLabel?: string;
  status: BridgeStatus;
  /** One short readiness line: Ready, Needs include, Needs activation, Needs cache build, … */
  readiness?: string;
  /** For file listing colors: the backend(s) in use. */
  backend?: string;
  notes: string[];
  palette?: SemanticPalette;
}

/** Executable per target (PATH lookup only; versions only where mappings depend on them). */
const BINARIES: Record<BridgeTargetId, string> = {fzf: 'fzf', pager: 'less', lsColors: 'ls', bat: 'bat', delta: 'delta', tmux: 'tmux', neovim: 'nvim', vim: 'vim', helix: 'hx'};
const VERSION_ARGS: Partial<Record<BridgeTargetId, string[]>> = {fzf: ['--version'], tmux: ['-V']};


export function supportedModes(target: BridgeTargetId): readonly BridgeMode[] {
  return BRIDGE_CAPABILITY[target] === 'detected' ? ['independent'] : ['independent', 'follow', 'choose'];
}

let factsCache: Promise<Record<BridgeTargetId, TargetFacts>> | undefined;
let factsKey = '';

/** Local, bounded detection, cached per PATH; at most a few short version probes, never on render. */
export function detectTargets(env: NodeJS.ProcessEnv = process.env, refresh = false): Promise<Record<BridgeTargetId, TargetFacts>> {
  const key = env.PATH ?? '';
  if (factsCache && factsKey === key && !refresh) return factsCache;
  factsKey = key;
  factsCache = (async () => {
    const entries = await Promise.all(BRIDGE_TARGETS.map(async (target): Promise<[BridgeTargetId, TargetFacts]> => {
      const binary = resolveCommand(BINARIES[target], key);
      if (!binary) return [target, {installed: false}];
      if (target === 'lsColors') {
        // GNU ls answers --version; BSD/macOS ls refuses it. Nothing else is run.
        const probe = await runExternal(binary, ['--version'], {timeoutMs: 1500, maxBytes: 4096, env});
        return [target, {installed: true, binary, listing: {ls: /GNU coreutils/u.test(probe.stdout) ? 'gnu' : 'bsd', gls: Boolean(resolveCommand('gls', key))}}];
      }
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
    // Regular files only: a FIFO or device named by a config path would block or never end.
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 256 * 1024) return undefined;
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
  if (target === 'bat') {
    const config = readSmall(join(batConfigDirectory(env), 'config'));
    const theme = config ? /^\s*--theme[=\s]+["']?([^"'\n]+)/mu.exec(config)?.[1]?.trim() : undefined;
    return theme ? [`Your bat config file sets --theme=${theme.slice(0, 40)}; bat's own config is not changed, and BAT_THEME applies only where your config does not override it.`] : [];
  }
  if (target === 'lsColors' && (env.LS_COLORS || env.LSCOLORS)) return ['Listing colors are already set; NMSh replaces them in NMSh shells while active and restores them when Independent.'];
  if (target === 'fzf' && /--color/u.test(env.FZF_DEFAULT_OPTS ?? '')) return ['FZF_DEFAULT_OPTS sets colors; NMSh-owned fzf launches never read FZF_DEFAULT_OPTS, your own fzf use keeps it.'];
  return [];
}

/** One git config value: inline comments dropped, quotes and escapes resolved (data only). */
function gitConfigValue(raw: string): string {
  let out = '';
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '\\' && index + 1 < raw.length) { const next = raw[++index]!; out += next === 'n' ? ' ' : next === 't' ? ' ' : next; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && (char === '#' || char === ';')) break;
    out += char;
  }
  return out.trim();
}

/**
 * Where delta's syntax theme is pinned in the global git config. Read as data
 * only: GIT_CONFIG_GLOBAL, else $XDG_CONFIG_HOME/git/config and ~/.gitconfig,
 * bounded, includes not followed, git never run. A repository's own config is
 * not consulted (the bridge is not per-directory). `theme` is named only when
 * every pin agrees, so the status never names the wrong one.
 */
export function deltaSyntaxTheme(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): {pinned: boolean; theme?: string} {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : join(home, '.config');
  const global = env.GIT_CONFIG_GLOBAL;
  const paths = global !== undefined ? (isAbsolute(global) ? [global] : []) : [join(xdg, 'git', 'config'), join(home, '.gitconfig')];
  let main: string | undefined;
  let features: string[] = [];
  const byFeature = new Map<string, string>();
  const flags: string[] = [];
  for (const path of paths) {
    const text = readSmall(path);
    if (text === undefined) continue;
    let section = '';
    let subsection: string | undefined;
    for (const raw of text.split('\n')) {
      let line = raw.trim();
      const header = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/u.exec(line);
      if (header) { section = header[1]!.toLowerCase(); subsection = header[2]; line = header[3]!.trim(); }
      const pair = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/u.exec(line);
      if (!pair) continue;
      const key = pair[1]!.toLowerCase();
      const value = gitConfigValue(pair[2]!);
      if (section === 'delta' && key === 'syntax-theme') {
        if (subsection === undefined) main = value; else byFeature.set(subsection, value);
      } else if (section === 'delta' && subsection === undefined && key === 'features') features = value.split(/\s+/u).filter(Boolean);
      else if ((section === 'core' && key === 'pager') || (section === 'pager' && subsection === undefined) || (section === 'interactive' && key === 'difffilter')) {
        const flag = /(?:^|[\s/])delta\b.*--syntax-theme(?:=|\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/u.exec(value);
        if (flag) flags.push(flag[1] ?? flag[2] ?? flag[3]!);
      }
    }
  }
  const pins = [...flags, ...(main !== undefined ? [main] : []), ...features.flatMap(feature => byFeature.has(feature) ? [byFeature.get(feature)!] : [])].filter(Boolean);
  if (!pins.length) return {pinned: false};
  const unique = [...new Set(pins)];
  return {pinned: true, ...(unique.length === 1 ? {theme: safeContextText(unique[0]!, 40)} : {})};
}

/**
 * delta is never managed: NMSh does not change git config. Its syntax
 * highlighting follows BAT_THEME and bat's theme cache when git config pins no
 * syntax theme, so the status says exactly which of those holds. Diff colors
 * come only from git config, which stays the user's.
 */
function deltaStatus(source: BridgeContext['source'], facts: Record<BridgeTargetId, TargetFacts>, level: ColorLevel, env: NodeJS.ProcessEnv, home: string): {readiness?: string; notes: string[]} {
  const diff = 'Diff colors come from your git config, which NMSh never changes.';
  const pin = deltaSyntaxTheme(env, home);
  if (pin.pinned) return {readiness: 'Own syntax theme', notes: [`Your git config selects delta's syntax theme${pin.theme ? ` (${pin.theme})` : ''}; NMSh leaves it. ${diff}`]};
  const batThemed = Boolean(facts.bat?.installed && targetPalette(source.themeBridge, 'bat', source).palette && batReady(env) && bridgeColorLevel(level, env) !== 'none');
  if (batThemed) {
    return {readiness: 'Syntax via bat', notes: [`In NMSh shells delta highlights syntax with ${BAT_THEME_NAME}: it reads BAT_THEME and bat's theme cache. ${diff}`,
      'A delta built with a different bat version may not read that cache; it then uses its own default theme.']};
  }
  return {notes: [`delta takes its syntax theme from BAT_THEME and bat's theme cache: set bat to Follow NMSh (with its reviewed cache build) and delta follows in NMSh shells. ${diff}`]};
}

/** The theme a target uses right now, or why it has none. Never another theme. */
export function targetPalette(settings: ThemeBridgeSettings, target: BridgeTargetId, source: ThemeSource): {palette?: SemanticPalette; label?: string; missing?: boolean; ref?: string} {
  const setting = effectiveSetting(settings, target);
  if (setting.mode === 'independent') return {};
  const ref = setting.mode === 'follow' ? activeThemeRef(source) : setting.theme;
  const resolved = resolveSemanticPalette(ref, source);
  if (!resolved.ok) return {missing: true, label: resolved.label};
  return {palette: resolved.palette, label: themeRefLabel(ref, source), ...(ref ? {ref} : {})};
}

export interface BridgeContext {source: ThemeSource & {themeBridge: ThemeBridgeSettings}; facts: Record<BridgeTargetId, TargetFacts>; level: ColorLevel; env?: NodeJS.ProcessEnv}

/** NO_COLOR (any value) or no color capability: color injection stops for every target. */
export function bridgeColorLevel(level: ColorLevel, env: NodeJS.ProcessEnv = process.env): ColorLevel {
  return env.NO_COLOR !== undefined && env.NO_COLOR !== '' ? 'none' : level;
}

/** File listing backend in plain words, from facts. */
export function listingBackend(facts: TargetFacts | undefined): string | undefined {
  const listing = facts?.listing;
  if (!listing) return undefined;
  const parts = [listing.ls === 'gnu' ? 'GNU ls · LS_COLORS' : listing.ls === 'bsd' ? 'macOS/BSD ls · CLICOLOR, LSCOLORS' : '', listing.gls ? 'GNU gls · LS_COLORS' : ''].filter(Boolean);
  return parts.join(' + ') || undefined;
}

/** bat is ready when NMSh's own theme file exists unchanged and bat's cache was built and verified for exactly it. */
export function batReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const ledger = loadLedger(env);
  const entry = ledger.entries.bat;
  return Boolean(entry && ownership('bat', ledger, env) === 'owned' && entry.cacheBuiltFor === entry.sha256);
}

function hookPresent(target: HookTarget, env: NodeJS.ProcessEnv, home: string): 'none' | 'current' | 'stale' | 'missing' {
  const hook = recordedHook(target, env);
  if (!hook) return 'none';
  const text = readSmall(hook.configPath);
  if (text === undefined || !text.includes(`${hook.lines.join('\n')}\n`)) return 'missing';
  const spec = hookSpec(target, env, home);
  // Helix's spec refuses a config that already selects a theme, which our own recorded assignment does: still current.
  if ('error' in spec) return 'current';
  return spec.configPath !== hook.configPath || spec.lines.join('\n') !== hook.lines.join('\n') ? 'stale' : 'current';
}

/** Readiness of a managed target: what (if anything) still needs a reviewed step. */
export function managedReadiness(target: Extract<BridgeTargetId, ManagedTarget>, env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): string {
  const ledger = loadLedger(env);
  // tmux.conf includes the one managed tmux file, so that file decides tmux's setup state.
  const owned = ownership(target === 'tmux' ? 'tmuxConfig' : target, ledger, env);
  if (owned === 'modified' || owned === 'unknown') return 'Conflict';
  if (owned !== 'owned') return 'Needs setup';
  if (target === 'bat') return batReady(env) ? 'Ready' : 'Needs cache build';
  const hook = hookPresent(target, env, home);
  if (hook === 'current') return 'Active';
  if (hook === 'stale' || hook === 'missing') return target === 'helix' ? 'Activation stale' : 'Include stale';
  return target === 'helix' || target === 'neovim' ? 'Needs activation' : 'Needs include';
}

export function reportTargets({source, facts, level, env = process.env}: BridgeContext): TargetReport[] {
  const home = env.HOME || homedir();
  return BRIDGE_TARGETS.map(target => {
    const capability = BRIDGE_CAPABILITY[target];
    const setting = effectiveSetting(source.themeBridge, target);
    const inherited = source.themeBridge.enabled && source.themeBridge.policy !== 'manual' && capability !== 'detected';
    const {palette, label, missing} = targetPalette(source.themeBridge, target, source);
    const notes: string[] = [];
    let status: BridgeStatus;
    let readiness: string | undefined;
    if (!facts[target]?.installed) status = 'Not installed';
    else if (capability === 'detected') {
      status = 'Not managed';
      const delta = deltaStatus(source, facts, level, env, home);
      readiness = delta.readiness;
      notes.push(...delta.notes);
    }
    else if (setting.mode === 'independent') status = 'Detected';
    else if (missing) status = 'Missing theme';
    else status = setting.mode === 'follow' ? 'Following NMSh' : 'Pinned theme';
    if (setting.mode !== 'independent' && bridgeColorLevel(level, env) === 'none') notes.push('NO_COLOR or no color support: nothing is injected.');
    if (capability === 'managed' && facts[target]?.installed) {
      const managed = target as Extract<BridgeTargetId, ManagedTarget>;
      readiness = managedReadiness(managed, env, home);
      if (readiness === 'Conflict') { status = 'Conflict'; notes.push(`${artifactPath(managed, env)} exists and is not NMSh's unchanged file; NMSh will not overwrite it.`); }
      else if (setting.mode !== 'independent' && readiness === 'Needs setup' && target === 'bat') { status = 'Needs setup'; notes.push('bat needs a generated custom theme and a reviewed cache build before BAT_THEME is set.'); }
      if (setting.mode === 'independent' && (readiness === 'Active' || readiness === 'Needs include' || readiness === 'Needs activation')) readiness = managed !== 'bat' && recordedHook(managed as HookTarget, env) ? 'Include kept (inactive)' : undefined;
      if (target === 'helix' && setting.mode !== 'independent') {
        notes.push('Coverage: syntax, markup, diff, diagnostics and editor UI. Running Helix instances are not recolored; new ones use the file.');
        if (readiness === 'Needs activation') notes.push('Select it with :theme nmsh-bridge, or review the config change.');
      }
      if (target === 'tmux' && setting.mode !== 'independent') notes.push(TMUX_UNREPRESENTED);
    }
    for (const conflict of facts[target]?.installed ? targetConflicts(target, env, home) : []) {
      notes.push(conflict);
      if (setting.mode !== 'independent' && status !== 'Missing theme' && target === 'tmux') status = 'Conflict';
    }
    const backend = target === 'lsColors' ? listingBackend(facts.lsColors) : undefined;
    if (target === 'lsColors' && facts.lsColors?.listing?.ls === 'bsd') notes.push('macOS/BSD ls names terminal ANSI colors, so it uses the closest of the theme\'s base colors.');
    return {target, label: BRIDGE_TARGET_LABELS[target], capability, mode: setting.mode, modes: supportedModes(target),
      editable: targetEditable(source.themeBridge, target), inherited, ...(label ? {themeLabel: label} : {}), status, ...(readiness ? {readiness} : {}),
      ...(backend ? {backend} : {}), notes, ...(palette ? {palette} : {})};
  });
}

/**
 * The environment the sink should carry: pager termcap, file listing colors
 * for the detected backends, and BAT_THEME once bat's managed theme is ready.
 */
export function bridgeEnvironment(context: BridgeContext, lsColors?: string): BridgeEnvironment {
  const env = context.env ?? process.env;
  const level = bridgeColorLevel(context.level, env);
  const out: BridgeEnvironment = {};
  const pager = targetPalette(context.source.themeBridge, 'pager', context.source).palette;
  if (pager) Object.assign(out, pagerEnvironment(pager, level));
  const ls = targetPalette(context.source.themeBridge, 'lsColors', context.source).palette;
  const listing = context.facts.lsColors?.listing;
  if (ls && level !== 'none') {
    const gnu = listing?.ls === 'gnu' || listing?.gls;
    if (gnu || !listing) {
      const value = lsColors ?? lsColorsFallback(ls, level);
      if (value) out.LS_COLORS = value;
    }
    const wrappers: ListingWrapper[] = [...(listing?.ls === 'gnu' ? ['ls' as const] : []), ...(listing?.gls ? ['gls' as const] : [])];
    if (wrappers.length) out.listing = wrappers;
    if (listing?.ls === 'bsd') { out.CLICOLOR = '1'; out.LSCOLORS = bsdLsColors(ls); }
  }
  if (targetPalette(context.source.themeBridge, 'bat', context.source).palette && batReady(env) && level !== 'none') out.BAT_THEME = BAT_THEME_NAME;
  return out;
}

/** fzf arguments for one NMSh-owned launch (empty when Independent, unavailable or colorless). */
export function fzfBridgeArgs(context: BridgeContext): string[] {
  const palette = targetPalette(context.source.themeBridge, 'fzf', context.source).palette;
  if (!palette) return [];
  return fzfColorArgs(palette, bridgeColorLevel(context.level, context.env), parseFzfVersion(context.facts.fzf?.version));
}

const vividCache = new Map<string, string>();

/** vivid output for the listing palette when vivid is installed; undefined falls back to the small built-in mapping. */
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

const validXml = (content: string) => XMLValidator.validate(content) === true;

const MANAGED: ReadonlyArray<{target: Extract<BridgeTargetId, ManagedTarget>; render: (palette: SemanticPalette) => string; validate: (content: string) => boolean; format: string}> = [
  {target: 'tmux', render: tmuxFragment, validate: validateTmuxFragment, format: 'tmux-fragment'},
  {target: 'neovim', render: neovimColorscheme, validate: validateNeovimColorscheme, format: 'nvim-colorscheme'},
  {target: 'vim', render: vimColorscheme, validate: validateVimColorscheme, format: 'vim-colorscheme'},
  {target: 'helix', render: helixTheme, validate: content => validateHelixTheme(content, parseToml), format: 'helix-theme'},
  {target: 'bat', render: batTheme, validate: content => validateBatTheme(content, text => { if (!validXml(text)) throw new Error('invalid'); return text; }), format: 'bat-tmtheme'},
];

/** Whether NMSh may (re)generate a managed target's artifact automatically: bat only after its first reviewed setup. */
function autoGenerate(target: Extract<BridgeTargetId, ManagedTarget>, env: NodeJS.ProcessEnv): boolean {
  return target !== 'bat' || Boolean(loadLedger(env).entries.bat);
}

/**
 * Applies the current effective settings: the environment sink and the
 * managed artifacts. Each target is isolated; one failure is reported and
 * leaves every other target (and the active NMSh theme) intact. Independent
 * targets get no artifact and no injection; an owned artifact left from an
 * earlier mode is removed (includes stay recorded and are harmless without
 * it). bat is generated automatically only after its first reviewed setup,
 * and its cache is rebuilt automatically only after the user approved that
 * once; otherwise it reports Needs setup / Needs cache build.
 */
export async function applyThemeBridge(context: BridgeContext): Promise<ApplyOutcome[]> {
  const env = context.env ?? process.env;
  const level = bridgeColorLevel(context.level, env);
  const outcomes: ApplyOutcome[] = [];
  for (const managed of MANAGED) {
    const setting = effectiveSetting(context.source.themeBridge, managed.target);
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
      if (!autoGenerate(managed.target, env)) continue;
      const result = writeArtifact(managed.target, managed.render(resolved.palette), managed.validate,
        {mode: setting.mode, themeRef: resolved.ref ?? '', format: managed.format, formatVersion: 1}, env);
      if (!result.ok) { outcomes.push({target: managed.target, ok: false, message: result.error}); continue; }
      if (managed.target === 'bat' && result.changed && loadLedger(env).entries.bat?.cacheApproved && context.facts.bat?.installed) {
        const built = await buildBatCache(env);
        outcomes.push({target: 'bat', ok: built.ok, ...(built.ok ? {} : {message: built.message})});
        continue;
      }
      outcomes.push({target: managed.target, ok: true});
    } catch (error) {
      outcomes.push({target: managed.target, ok: false, message: error instanceof Error ? error.message : String(error)});
    }
  }
  // The one tmux file tmux.conf includes: Tool Configuration settings plus the Theme Bridge colors.
  try {
    const model = loadTmuxModel(env);
    if (tmuxManagedNeeded(model, effectiveSetting(context.source.themeBridge, 'tmux').mode !== 'independent', env)) {
      const written = writeTmuxManaged(model, env);
      if (!written.ok) outcomes.push({target: 'tmux', ok: false, message: written.error});
    }
  } catch (error) {
    outcomes.push({target: 'tmux', ok: false, message: error instanceof Error ? error.message : String(error)});
  }
  let lsColors: string | undefined;
  const ls = targetPalette(context.source.themeBridge, 'lsColors', context.source);
  if (ls.palette) lsColors = await vividColors(ls.palette, level, env, effectiveSetting(context.source.themeBridge, 'lsColors').mode, ls.ref ?? '');
  try {
    writeEnvironmentFiles(bridgeEnvironment(context, lsColors), env);
    outcomes.push({target: 'pager', ok: true}, {target: 'lsColors', ok: true});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcomes.push({target: 'pager', ok: false, message}, {target: 'lsColors', ok: false, message});
  }
  return outcomes;
}

/**
 * bat's reviewed setup step: write the managed theme for a palette (refusing
 * unowned files), then rebuild bat's cache with typed argv and verify the
 * theme is listed. Only a verified build marks bat ready (and allows later
 * automatic rebuilds).
 */
export async function setupBat(palette: SemanticPalette, mode: BridgeMode, ref: string, env: NodeJS.ProcessEnv = process.env): Promise<{ok: boolean; message: string}> {
  const binary = resolveCommand('bat', env.PATH ?? '');
  if (!binary) return {ok: false, message: 'bat is not installed.'};
  const reported = (await runExternal(binary, ['--config-dir'], {timeoutMs: 2000, maxBytes: 4096, env})).stdout.trim();
  if (reported && reported !== batConfigDirectory(env)) return {ok: false, message: `bat reports its config directory as ${reported}, not ${batConfigDirectory(env)}; NMSh does not guess where to put the theme.`};
  const managed = MANAGED.find(item => item.target === 'bat')!;
  const written = writeArtifact('bat', managed.render(palette), managed.validate, {mode, themeRef: ref, format: managed.format, formatVersion: 1}, env);
  if (!written.ok) return {ok: false, message: written.error};
  return buildBatCache(env, true);
}

/** `bat cache --build`, then `bat --list-themes` must include the NMSh theme. Typed argv; no shell; local only. */
export async function buildBatCache(env: NodeJS.ProcessEnv = process.env, approve = false): Promise<{ok: boolean; message: string}> {
  const binary = resolveCommand('bat', env.PATH ?? '');
  if (!binary) return {ok: false, message: 'bat is not installed.'};
  const ledger = loadLedger(env);
  const entry = ledger.entries.bat;
  if (!entry || ownership('bat', ledger, env) !== 'owned') return {ok: false, message: 'There is no NMSh-managed bat theme to build.'};
  const build = await runExternal(binary, ['cache', '--build'], {timeoutMs: 60_000, maxBytes: 64 * 1024, env});
  if (!build.ok) return {ok: false, message: 'bat cache --build failed; BAT_THEME stays unset and nothing claims the theme is active.'};
  const list = await runExternal(binary, ['--list-themes', '--color=never'], {timeoutMs: 10_000, maxBytes: 256 * 1024, env});
  if (!list.stdout.split('\n').some(line => line.trim() === BAT_THEME_NAME)) return {ok: false, message: 'bat rebuilt its cache but does not list the NMSh theme; BAT_THEME stays unset.'};
  const fresh = loadLedger(env);
  fresh.entries.bat = {...fresh.entries.bat!, cacheBuiltFor: fresh.entries.bat!.sha256, ...(approve || fresh.entries.bat!.cacheApproved ? {cacheApproved: true} : {})};
  saveLedger(fresh, env);
  return {ok: true, message: 'bat rebuilt its theme cache and lists nmsh-bridge; NMSh shells use it from their next prompt.'};
}

/**
 * The one typed tmux reload: `tmux source-file <NMSh fragment>` against the
 * user's running server, on explicit request only. No shell, no other command.
 */
export async function reloadTmux(env: NodeJS.ProcessEnv = process.env, path = artifactPath('tmuxConfig', env)): Promise<{ok: boolean; message: string}> {
  const binary = resolveCommand('tmux', env.PATH ?? '');
  if (!binary) return {ok: false, message: 'tmux is not installed.'};
  if (!existsSync(path)) return {ok: false, message: 'There is no NMSh-managed tmux file to load yet.'};
  const result = await runExternal(binary, ['source-file', path], {timeoutMs: 3000, maxBytes: 16 * 1024, env});
  return result.ok ? {ok: true, message: 'tmux reloaded the NMSh-managed settings for the running server.'}
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

// ---- Integrations health ---------------------------------------------------------

export type HealthState = 'ready' | 'not-installed' | 'independent' | 'needs-setup' | 'needs-include' | 'stale-include' | 'needs-cache' | 'conflict' | 'not-managed';
export interface HealthItem {target: BridgeTargetId; label: string; state: HealthState; detail: string; action?: 'generate' | 'include' | 'cache'}

const HEALTH_LABELS: Record<HealthState, string> = {ready: 'Ready', 'not-installed': 'Not installed', independent: 'Independent · nothing to do', 'needs-setup': 'Needs setup',
  'needs-include': 'Needs one reviewed include', 'stale-include': 'Include out of date', 'needs-cache': 'Needs cache build', conflict: 'Conflict · skipped', 'not-managed': 'Not managed'};

/** One read-only pass over every target: what is current, what needs a reviewed step, what must be skipped. */
export function integrationHealth(context: BridgeContext): HealthItem[] {
  const env = context.env ?? process.env;
  const home = env.HOME || homedir();
  return BRIDGE_TARGETS.map(target => {
    const label = BRIDGE_TARGET_LABELS[target];
    const item = (state: HealthState, action?: HealthItem['action'], detail = HEALTH_LABELS[state]): HealthItem => ({target, label, state, detail, ...(action ? {action} : {})});
    if (!context.facts[target]?.installed) return item('not-installed');
    if (BRIDGE_CAPABILITY[target] === 'detected') {
      const readiness = deltaStatus(context.source, context.facts, context.level, env, home).readiness;
      return item('not-managed', undefined, readiness ? `Not managed · ${readiness}` : HEALTH_LABELS['not-managed']);
    }
    // tmux settings from /tmux need the same one include even while Theme Bridge leaves tmux Independent.
    const tmuxConfigured = target === 'tmux' && !modelIsEmpty(loadTmuxModel(env));
    if (effectiveSetting(context.source.themeBridge, target).mode === 'independent' && !tmuxConfigured) return item('independent');
    if (BRIDGE_CAPABILITY[target] === 'direct') return item('ready', undefined, 'Ready · applied to NMSh shells and launches');
    const managed = target as Extract<BridgeTargetId, ManagedTarget>;
    const readiness = managedReadiness(managed, env, home);
    if (readiness === 'Conflict') return item('conflict');
    if (readiness === 'Needs setup') return item('needs-setup', target === 'bat' ? 'cache' : 'generate', target === 'bat' ? 'Needs a generated bat theme and cache build' : 'Generated file missing');
    if (readiness === 'Needs cache build') return item('needs-cache', 'cache');
    if (readiness === 'Include stale' || readiness === 'Activation stale') return item('stale-include', undefined, 'Recorded include no longer matches; remove and re-add it in the target details');
    if (readiness === 'Needs include' || readiness === 'Needs activation') {
      const spec = hookSpec(managed as HookTarget, env, home);
      if ('error' in spec) return item('conflict', undefined, spec.error);
      return item('needs-include', 'include', `${readiness} · ${spec.configPath}`);
    }
    return item('ready');
  });
}
