import {appearanceContext, appearancePaths, type AppearanceContext, type AppearanceHost} from './hostPaths.js';
import {readHostConfiguration, type Definition} from './hostConfiguration.js';
import {digest, snapshot, transact, type FileChange, type FileSnapshot} from './hostFiles.js';
export type {AppearanceContext, AppearanceHost} from './hostPaths.js';

export type BlurMode = 'Off' | 'Numeric' | 'Glass Regular' | 'Glass Clear';
export interface HostAppearanceSettings {opacity: number; blurMode: BlurMode; blurStrength: number; background?: string}
export interface AppearanceRead {
  settings?: HostAppearanceSettings;
  hostPath: string;
  origins: Partial<Record<keyof HostAppearanceSettings, Definition>>;
  problems: string[];
}
interface OwnershipRecord {version: 1; hostPath: string; hook: string; fragmentHash: string; created: boolean}
export interface HostAppearancePlan {
  host: AppearanceHost;
  operation: 'save' | 'remove';
  hostPath: string;
  fragmentPath: string;
  preview: string[];
  guidance: string;
  /** Captured dependencies and changes live only until this exact preview is confirmed. */
  home: string;
  changes: readonly FileChange[];
  dependencies: readonly FileSnapshot[];
}
export type AppearancePlanResult = {ok: true; plan: HostAppearancePlan} | {ok: false; error: string};
export type AppearanceSaveResult = {success: true; hostPath: string; fragmentPath: string} | {success: false; error: string};

export function readHostAppearance(host: AppearanceHost, context = appearanceContext()): AppearanceRead {
  const read = readHostConfiguration(host, context);
  const opacityKey = host === 'kitty' ? 'background_opacity' : 'background-opacity';
  const blurKey = host === 'kitty' ? 'background_blur' : 'background-blur';
  const opacity = read.values.get(opacityKey);
  const blur = read.values.get(blurKey);
  const background = read.values.get('background');
  const problems = [...read.problems];
  if (host === 'ghostty' && read.values.has('theme') && (!opacity || !blur)) problems.push('Current theme-derived appearance is unresolved. Set explicit opacity and blur in the host configuration to inspect them; NMSh will not invent current values.');
  const origins: AppearanceRead['origins'] = {...(opacity ? {opacity} : {}), ...(blur ? {blurMode: blur, blurStrength: blur} : {}), ...(background ? {background} : {})};
  const strength = !blur?.value || blur.value === 'false' ? 0 : blur.value === 'true' ? 20 : Number(blur.value);
  const blurMode: BlurMode = blur?.value === 'macos-glass-regular' ? 'Glass Regular' : blur?.value === 'macos-glass-clear' ? 'Glass Clear' : strength > 0 ? 'Numeric' : 'Off';
  const settings: HostAppearanceSettings = {opacity: opacity?.value ? Number(opacity.value) : 1, blurMode, blurStrength: Number.isFinite(strength) ? strength : 20,
    ...(background?.value ? {background: background.value} : {})};
  if (!Number.isFinite(settings.opacity) || settings.opacity < 0 || settings.opacity > 1 || (blur && !['macos-glass-regular', 'macos-glass-clear'].includes(blur.value) && (!Number.isInteger(strength) || strength < 0))) problems.push('An appearance value cannot be interpreted safely.');
  return {hostPath: read.hostPath, origins, problems, ...(problems.length ? {} : {settings})};
}

export function appearanceGuidance(host: AppearanceHost, platform: NodeJS.Platform): string {
  return host === 'ghostty'
    ? `Configuration saved, not proof of loaded GPU output. Reload Ghostty (${platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+,). Opacity on macOS requires quitting and reopening Ghostty; NMSh will not restart it.`
    : 'Configuration saved, not proof of loaded GPU output. Reload Kitty with its reload_config action (normally Ctrl+Shift+F5). Opacity changes may require a new OS window unless dynamic_background_opacity was already enabled; NMSh does not enable it.';
}

function render(host: AppearanceHost, settings: HostAppearanceSettings): string {
  if (!Number.isFinite(settings.opacity) || settings.opacity < 0 || settings.opacity > 1 || !Number.isSafeInteger(settings.blurStrength) || settings.blurStrength < 0) throw new Error('Opacity must be 0–1 and blur a nonnegative safe integer.');
  if (!['Off', 'Numeric', 'Glass Regular', 'Glass Clear'].includes(settings.blurMode) || (host === 'kitty' && settings.blurMode.startsWith('Glass'))) throw new Error('This blur mode is not supported by the selected host.');
  if (settings.background !== undefined && !/^(?:#?[0-9a-f]{6}|[a-z][a-z0-9 ]{0,47})$/iu.test(settings.background)) throw new Error('Background must be a six-digit RGB color or a bounded host color name.');
  const color = settings.background && /^#?[0-9a-f]{6}$/iu.test(settings.background) ? `#${settings.background.replace(/^#/u, '')}` : settings.background;
  const header = '# NMSh-owned appearance. Restore through /appearance; user shaders and keybindings are untouched.\n';
  const blur = settings.blurMode === 'Off' ? (host === 'kitty' ? '0' : 'false') : settings.blurMode === 'Numeric' ? String(settings.blurStrength) : settings.blurMode === 'Glass Regular' ? 'macos-glass-regular' : 'macos-glass-clear';
  return host === 'kitty' ? `${header}background_opacity ${settings.opacity}\nbackground_blur ${blur}\n${settings.background ? `background ${color}\n` : ''}`
    : `${header}background-opacity = ${settings.opacity}\nbackground-blur = ${blur}\n${settings.background ? `background = ${color?.replace(/^#/u, '')}\n` : ''}`;
}

function owned(host: AppearanceHost, context: AppearanceContext) {
  const paths = appearancePaths(host, context);
  const fragment = snapshot(paths.fragment, paths.home, true);
  const ledger = snapshot(paths.ledger, paths.home, true);
  let record: OwnershipRecord | undefined;
  if (ledger.content !== undefined) {
    let parsed;
    try { parsed = JSON.parse(ledger.content); } catch { throw new Error('The appearance ownership record is malformed; nothing will be overwritten.'); }
    if (parsed?.version !== 1 || typeof parsed.created !== 'boolean' || !paths.candidates.includes(parsed.hostPath) || typeof parsed.hook !== 'string' || !/^[0-9a-f]{64}$/u.test(parsed.fragmentHash ?? '')) throw new Error('The appearance ownership record is invalid.');
    record = parsed as OwnershipRecord;
    const expectedInclude = host === 'ghostty' ? `config-file = ?${paths.fragment}` : `include ${paths.fragment}`;
    if (!record.hook.endsWith(`${expectedInclude}${record.hook.includes('\r\n') ? '\r\n' : '\n'}`) || record.hook.replace(/\r\n/gu, '\n').trim() !== `# NMSh appearance (remove using /appearance)\n${expectedInclude}`) throw new Error('The recorded include does not match NMSh’s own hook.');
  }
  if (fragment.content !== undefined && (!record || digest(fragment.content) !== record.fragmentHash)) throw new Error('The appearance fragment is unowned or was edited outside NMSh; it was preserved.');
  if (record && fragment.content === undefined) throw new Error('The recorded appearance fragment is missing; restore it before changing the integration.');
  return {paths, fragment, ledger, record};
}

function preview(changes: readonly FileChange[]): string[] {
  return changes.filter(change => change.before.content !== change.after).flatMap(change => {
    const before = change.before.content ?? '';
    const after = change.after ?? '';
    // Host includes are append-only. Show only inserted/removed lines, never unrelated secret-bearing config.
    const added = after.startsWith(before) ? after.slice(before.length) : '';
    const removed = before.startsWith(after) ? before.slice(after.length) : '';
    return [`File: ${change.before.path}`, ...(added ? added.trimEnd().split(/\r?\n/u).map(line => `+ ${line}`)
      : removed ? removed.trimEnd().split(/\r?\n/u).map(line => `- ${line}`)
        : ['Replace only the NMSh-owned file with:', ...after.trimEnd().split(/\r?\n/u).map(line => `+ ${line}`)])];
  });
}

export function planHostAppearance(host: AppearanceHost, settings: HostAppearanceSettings, context = appearanceContext()): AppearancePlanResult {
  try {
    const content = render(host, settings);
    const state = owned(host, context);
    if (/[\u0000-\u001f'"\u007f]/u.test(state.paths.fragment) || state.paths.fragment.includes(String.fromCharCode(92))) throw new Error('This configuration path cannot be included safely.');
    const read = readHostConfiguration(host, context);
    if (read.problems.length) throw new Error(read.problems.join(' '));
    if (state.record && state.record.hostPath !== read.hostPath) throw new Error('Default configuration precedence changed; remove the old integration before setting up this one.');
    const hostFile = snapshot(read.hostPath, state.paths.home, true);
    const original = hostFile.content ?? '';
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const include = host === 'ghostty' ? `config-file = ?${state.paths.fragment}` : `include ${state.paths.fragment}`;
    const hook = state.record?.hook ?? `${original && !original.endsWith('\n') ? newline : ''}${newline}# NMSh appearance (remove using /appearance)${newline}${include}${newline}`;
    if (state.record && original.split(hook).length !== 2) throw new Error('The recorded include was changed or duplicated; nothing was changed.');
    if (!state.record && original.includes(state.paths.fragment)) throw new Error('An unrecorded appearance include already exists; remove it manually before setup.');
    const simulated = readHostConfiguration(host, context, new Map([[hostFile.path, state.record ? original : `${original}${hook}`], [state.paths.fragment, content]]));
    const opacityKey = host === 'kitty' ? 'background_opacity' : 'background-opacity';
    const blurKey = host === 'kitty' ? 'background_blur' : 'background-blur';
    if (simulated.problems.length || simulated.values.get(opacityKey)?.path !== state.paths.fragment || simulated.values.get(blurKey)?.path !== state.paths.fragment
      || (settings.background && simulated.values.get('background')?.path !== state.paths.fragment)) {
      throw new Error('A later or unresolved include overrides the managed appearance. Resolve that conflict explicitly before setup; no files were changed.');
    }
    const record: OwnershipRecord = {version: 1, hostPath: hostFile.path, hook, fragmentHash: digest(content), created: state.record?.created ?? hostFile.content === undefined};
    const changes: FileChange[] = [{before: state.fragment, after: content}, ...(state.record ? [] : [{before: hostFile, after: `${original}${hook}`}]), {before: state.ledger, after: `${JSON.stringify(record, null, 2)}\n`}];
    return {ok: true, plan: {host, operation: 'save', hostPath: hostFile.path, fragmentPath: state.paths.fragment, home: state.paths.home, changes,
      dependencies: simulated.files, preview: preview(changes), guidance: appearanceGuidance(host, context.platform)}};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

/**
 * Cut out exactly the owned hook. A hook added to a file without a final newline began with
 * that missing line break, so lines the user appended later need one back; with nothing
 * after the hook the original bytes return unchanged.
 */
function withoutHook(content: string, hook: string): string {
  const at = content.indexOf(hook);
  const prefix = content.slice(0, at);
  const suffix = content.slice(at + hook.length);
  const joined = prefix !== '' && suffix !== '' && !prefix.endsWith('\n') && !/^\r?\n/u.test(suffix);
  return `${prefix}${joined ? (hook.includes('\r\n') ? '\r\n' : '\n') : ''}${suffix}`;
}

export function planHostRemoval(host: AppearanceHost, context = appearanceContext()): AppearancePlanResult {
  try {
    const state = owned(host, context);
    if (!state.record) throw new Error('No NMSh-owned appearance integration is recorded.');
    const hostFile = snapshot(state.record.hostPath, state.paths.home, true);
    const content = hostFile.content ?? '';
    const hooks = content.split(state.record.hook).length - 1;
    if (hooks > 1) throw new Error('The owned include is duplicated; it was preserved.');
    if (hooks === 0) {
      // An interrupted removal (or a hand edit) already took the hook out: remove only NMSh's own files.
      // The host file is a dependency, so the plan is refused if the hook reappears before confirmation.
      const cleanup: FileChange[] = [{before: state.fragment}, {before: state.ledger}];
      return {ok: true, plan: {host, operation: 'remove', hostPath: hostFile.path, fragmentPath: state.paths.fragment, home: state.paths.home, changes: cleanup, dependencies: [hostFile],
        preview: [`The NMSh include is already absent from ${hostFile.path}; that file is not changed.`, ...preview(cleanup)], guidance: appearanceGuidance(host, context.platform)}};
    }
    const after = withoutHook(content, state.record.hook);
    const changes: FileChange[] = [{before: hostFile, after: state.record.created && after === '' ? undefined : after}, {before: state.fragment}, {before: state.ledger}];
    return {ok: true, plan: {host, operation: 'remove', hostPath: hostFile.path, fragmentPath: state.paths.fragment, home: state.paths.home,
      changes, dependencies: [], preview: [`File: ${hostFile.path}`, ...state.record.hook.trim().split(/\r?\n/u).map(line => `- ${line}`), ...preview(changes.slice(1))], guidance: appearanceGuidance(host, context.platform)}};
  } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

export function applyHostAppearance(plan: HostAppearancePlan): {ok: true} | {ok: false; error: string} {
  try { transact(plan.changes, plan.dependencies, plan.home); return {ok: true}; }
  catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}
