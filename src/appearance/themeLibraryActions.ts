import type {PromptConfiguration} from '../prompt/configuration.js';
import {normalizePromptConfiguration} from '../prompt/configuration.js';
import {BRIDGE_TARGET_LABELS, targetsPinnedTo, type BridgeTargetId} from '../themeBridge/model.js';
import type {CustomTheme} from './customTheme.js';
import {
  addThemeAsset, duplicateThemeAsset, findTheme, removeThemeAsset, renameThemeAsset, updateThemeAsset, type ThemeOrigin,
} from './themeLibrary.js';
import {assetRef, builtinTheme, parseThemeRef, type ThemeRef} from './themeRefs.js';

/**
 * Library operations over the whole configuration: the one place assets,
 * the active selection, the `customTheme` mirror and Theme Bridge references
 * change together. Every result is re-normalized so the mirror is always the
 * active asset. Nothing here touches the filesystem.
 */

export type ActionResult = {ok: true; config: PromptConfiguration; message: string; id?: string} | {ok: false; error: string};

const finish = (config: PromptConfiguration, message: string, id?: string): ActionResult =>
  ({ok: true, config: normalizePromptConfiguration(config), message, ...(id ? {id} : {})});

/** Make any selectable theme the active NMSh theme. A missing asset is an error, never a substitute. */
export function setActiveTheme(config: PromptConfiguration, ref: ThemeRef): ActionResult {
  const parsed = parseThemeRef(ref);
  if (!parsed) return {ok: false, error: 'Not a theme reference.'};
  if (parsed.kind === 'builtin') {
    return finish({...config, nmsh: {...config.nmsh, palette: parsed.palette, ...(parsed.accent ? {accent: parsed.accent} : {})}}, `Theme · ${builtinTheme(parsed.palette, parsed.accent).name}`);
  }
  const asset = findTheme(config.themes, parsed.id);
  if (!asset) return {ok: false, error: 'That theme no longer exists.'};
  return finish({...config, nmsh: {...config.nmsh, palette: 'custom', themeId: asset.id}}, `Theme · ${asset.theme.name}`);
}

/** A new Custom or Imported asset; `activate` also makes it the active theme. */
export function addTheme(config: PromptConfiguration, theme: CustomTheme, origin?: ThemeOrigin, activate = false): ActionResult {
  const added = addThemeAsset(config.themes, theme, origin);
  if (!added.ok) return added;
  const next = {...config, themes: added.value.themes};
  if (activate) next.nmsh = {...next.nmsh, palette: 'custom', themeId: added.value.asset.id};
  return finish(next, `${origin ? 'Imported' : 'Saved'} ${added.value.asset.theme.name}${activate ? ' · active' : ''}`, added.value.asset.id);
}

export function saveTheme(config: PromptConfiguration, id: string, theme: CustomTheme): ActionResult {
  const updated = updateThemeAsset(config.themes, id, theme);
  if (!updated.ok) return updated;
  return finish({...config, themes: updated.value}, `Saved ${findTheme(updated.value, id)!.theme.name}`, id);
}

export function renameTheme(config: PromptConfiguration, id: string, name: string): ActionResult {
  const renamed = renameThemeAsset(config.themes, id, name);
  if (!renamed.ok) return renamed;
  return finish({...config, themes: renamed.value}, `Renamed to ${findTheme(renamed.value, id)!.theme.name}`, id);
}

export function duplicateTheme(config: PromptConfiguration, id: string): ActionResult {
  const copied = duplicateThemeAsset(config.themes, id);
  if (!copied.ok) return copied;
  return finish({...config, themes: copied.value.themes}, `Duplicated as ${copied.value.asset.theme.name} (Custom)`, copied.value.asset.id);
}

/** A built-in, immutable theme copied into the library as an editable Custom theme. */
export function duplicateBuiltin(config: PromptConfiguration, ref: ThemeRef): ActionResult {
  const parsed = parseThemeRef(ref);
  if (parsed?.kind !== 'builtin') return {ok: false, error: 'Not a built-in theme.'};
  const source = builtinTheme(parsed.palette, parsed.accent);
  return addTheme(config, {...source, name: `My ${source.name}`.slice(0, 48), basedOn: source.name});
}

export interface DeleteCheck {
  /** Deleting the active NMSh theme is refused: choose another theme first, so nothing falls back silently. */
  active: boolean;
  /** Theme Bridge targets pinned to this theme (Choose theme). */
  pinned: BridgeTargetId[];
}

export function deleteCheck(config: PromptConfiguration, id: string): DeleteCheck {
  return {active: config.nmsh.palette === 'custom' && config.nmsh.themeId === id, pinned: targetsPinnedTo(config.themeBridge, assetRef(id))};
}

/**
 * Deletes an asset. Pinned Theme Bridge targets block the delete unless the
 * user explicitly confirmed that they become Independent; the active theme is
 * never deleted. No reference is ever left dangling or re-pointed elsewhere.
 */
export function deleteTheme(config: PromptConfiguration, id: string, confirmIndependent = false): ActionResult {
  const asset = findTheme(config.themes, id);
  if (!asset) return {ok: false, error: 'That theme no longer exists.'};
  const check = deleteCheck(config, id);
  if (check.active) return {ok: false, error: `${asset.theme.name} is the active theme. Choose another theme first.`};
  if (check.pinned.length && !confirmIndependent) {
    return {ok: false, error: `Theme Bridge ${check.pinned.map(target => BRIDGE_TARGET_LABELS[target]).join(', ')} ${check.pinned.length === 1 ? 'is' : 'are'} pinned to ${asset.theme.name}.`};
  }
  const targets = structuredClone(config.themeBridge.targets);
  // Explicitly confirmed: affected targets become Independent (never another theme). The old reference is dropped.
  for (const target of check.pinned) targets[target] = {mode: 'independent'};
  const next: PromptConfiguration = {...config, themes: removeThemeAsset(config.themes, id), themeBridge: {...config.themeBridge, targets},
    nmsh: config.nmsh.themeId === id ? (({themeId: _removed, ...rest}) => rest)(config.nmsh) as PromptConfiguration['nmsh'] : config.nmsh};
  const suffix = check.pinned.length ? ` · ${check.pinned.map(target => BRIDGE_TARGET_LABELS[target]).join(', ')} now Independent` : '';
  return finish(next, `Deleted ${asset.theme.name}${suffix}`);
}
