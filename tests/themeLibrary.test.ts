import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, savePromptConfiguration, loadPromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {
  categoryOf, LEGACY_THEME_ID, librarySummary, normalizeThemeLibrary, provenanceLabel, THEME_LIBRARY_LIMIT, uniqueThemeName,
} from '../src/appearance/themeLibrary.js';
import {addTheme, deleteCheck, deleteTheme, duplicateBuiltin, duplicateTheme, renameTheme, saveTheme, setActiveTheme} from '../src/appearance/themeLibraryActions.js';
import {activeThemeRef, assetRef, builtinRef, builtinTheme, parseThemeRef, selectableThemes, themeForRef} from '../src/appearance/themeRefs.js';
import {resolveSemanticPalette} from '../src/appearance/semanticPalette.js';
import {exportTheme, type CustomTheme} from '../src/appearance/customTheme.js';
import {exportSettings} from '../src/configuration/portability.js';
import {writeThemeExport} from '../src/appearance/ThemeStudio.js';
import {currentSelectionFamily, selectionFamilies, selectionVariants, selectSelectionFamily} from '../src/appearance/themeSelection.js';

const base = (): PromptConfiguration => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const theme = (name: string, project = '#123456'): CustomTheme => ({...builtinTheme('nord'), name, prompt: {...builtinTheme('nord').prompt, project}});
const ok = <T extends {ok: boolean}>(result: T): Extract<T, {ok: true}> => { assert.ok(result.ok, JSON.stringify(result)); return result as Extract<T, {ok: true}>; };
const ORIGIN = {kind: 'ghostty' as const, sourceName: 'Mocha', sourcePath: '/Users/someone/private/themes/mocha', importerVersion: 2, importedAt: '2026-10-05T00:00:00.000Z'};

test('migration: a valid legacy customTheme becomes one active Custom asset; nothing is lost', () => {
  const legacy = theme('Mine');
  const migrated = normalizePromptConfiguration({customTheme: legacy, nmsh: {palette: 'custom'}});
  assert.equal(migrated.themes.length, 1);
  assert.equal(migrated.themes[0]!.id, LEGACY_THEME_ID);
  assert.equal(categoryOf(migrated.themes[0]!), 'custom');
  assert.equal(migrated.nmsh.palette, 'custom', 'it stays active');
  assert.equal(migrated.nmsh.themeId, LEGACY_THEME_ID);
  assert.deepEqual(migrated.customTheme, migrated.themes[0]!.theme, 'the mirror is the active asset');
  // Inactive legacy theme: kept, built-in stays active.
  const inactive = normalizePromptConfiguration({customTheme: legacy, nmsh: {palette: 'nord'}});
  assert.equal(inactive.nmsh.palette, 'nord');
  assert.equal(inactive.themes[0]!.theme.name, 'Mine');
  // Idempotent: normalizing again keeps the same stable id.
  assert.deepEqual(normalizePromptConfiguration(migrated).themes, migrated.themes);
  // Malformed legacy data falls back safely.
  const broken = normalizePromptConfiguration({customTheme: {schema: 'nmsh-theme', version: 1, name: 'x', prompt: {}, ui: {}}, nmsh: {palette: 'custom'}});
  assert.equal(broken.themes.length, 0);
  assert.equal(broken.nmsh.palette, 'lavender');
});

test('library is canonical: the mirror follows the asset, a stale stored customTheme is ignored once a library exists', () => {
  const config = ok(addTheme(base(), theme('A'), undefined, true)).config;
  const stale = normalizePromptConfiguration({...config, customTheme: theme('Stale', '#000000')});
  assert.equal(stale.customTheme?.name, 'A');
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-lib-'));
  try {
    const path = join(dir, 'config.json');
    savePromptConfiguration(config, path);
    const loaded = loadPromptConfiguration(path);
    assert.deepEqual(loaded.themes, config.themes);
    assert.equal(loaded.nmsh.themeId, config.nmsh.themeId);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('multiple Custom and Imported themes: stable ids, categories, unique names, selection by id', () => {
  let config = base();
  const ids: string[] = [];
  for (const [name, origin] of [['One', undefined], ['Two', undefined], ['Imp', ORIGIN], ['Imp', ORIGIN]] as const) {
    const result = ok(addTheme(config, theme(name), origin));
    config = result.config;
    ids.push(result.id!);
  }
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every(id => /^t-[0-9a-f]{12}$/u.test(id)));
  assert.deepEqual(config.themes.map(asset => categoryOf(asset)), ['custom', 'custom', 'imported', 'imported']);
  assert.deepEqual(config.themes.map(asset => asset.theme.name), ['One', 'Two', 'Imp', 'Imp 2'], 'display names are unique but never identity');
  assert.equal(librarySummary(config.themes), '2 imported · 2 custom');
  config = ok(setActiveTheme(config, assetRef(ids[2]!))).config;
  assert.equal(activeThemeRef(config), assetRef(ids[2]!));
  assert.equal(config.customTheme?.name, 'Imp');
  config = ok(renameTheme(config, ids[2]!, 'Renamed')).config;
  assert.equal(config.themes.find(asset => asset.id === ids[2])?.theme.name, 'Renamed', 'rename keeps the id');
  assert.equal(activeThemeRef(config), assetRef(ids[2]!), 'selection survives a rename');
  assert.equal(uniqueThemeName(config.themes, 'one'), 'one 2');
});

test('imported themes are Native: editing marks Modified; duplicate is Custom; selectable everywhere', () => {
  let config = ok(addTheme(base(), theme('Mocha'), ORIGIN)).config;
  const id = config.themes[0]!.id;
  assert.equal(provenanceLabel(config.themes[0]!), 'Imported from Ghostty · Mocha');
  config = ok(saveTheme(config, id, {...config.themes[0]!.theme, prompt: {...config.themes[0]!.theme.prompt, gitBranch: '#ff0000'}})).config;
  assert.equal(config.themes[0]!.modified, true);
  assert.equal(provenanceLabel(config.themes[0]!), 'Imported from Ghostty · Mocha · Modified');
  const copy = ok(duplicateTheme(config, id));
  assert.equal(categoryOf(copy.config.themes.find(asset => asset.id === copy.id)!), 'custom');
  assert.equal(copy.config.themes.find(asset => asset.id === copy.id)!.theme.basedOn, 'Mocha');
  const refs = selectableThemes(copy.config);
  assert.ok(refs.some(item => item.category === 'imported' && item.ref === assetRef(id)));
  assert.ok(refs.some(item => item.category === 'custom'));
  assert.ok(refs.some(item => item.category === 'builtin' && item.ref === 'builtin:gruvboxDark'));
  const fromBuiltin = ok(duplicateBuiltin(copy.config, builtinRef('gruvboxDark')));
  assert.equal(fromBuiltin.config.themes.at(-1)!.theme.name, 'My Gruvbox Dark');
});

test('portable exports never leak the local source path', () => {
  const config = ok(addTheme(base(), theme('Mocha'), ORIGIN)).config;
  const asset = config.themes[0]!;
  assert.doesNotMatch(exportTheme(asset.theme), /private|sourcePath|\/Users\//u);
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-export-'));
  try {
    const path = writeThemeExport(asset.theme, dir);
    assert.doesNotMatch(readFileSync(path, 'utf8'), /sourcePath|private/u);
  } finally { rmSync(dir, {recursive: true, force: true}); }
  const settings = JSON.stringify(exportSettings(config, ['theme']));
  assert.doesNotMatch(settings, /sourcePath|\/Users\/someone/u, 'settings transfer drops the path');
  assert.match(settings, /"kind":"ghostty"/u, 'non-sensitive provenance kind is kept');
});

test('deleting: the active theme is refused; Theme Bridge pins block until confirmed, then become Independent', () => {
  let config = ok(addTheme(base(), theme('Pinned'))).config;
  const id = config.themes[0]!.id;
  config = ok(setActiveTheme(config, assetRef(id))).config;
  assert.equal(deleteTheme(config, id).ok, false, 'active theme is never deleted');
  config = ok(setActiveTheme(config, 'builtin:nord')).config;
  config.themeBridge = {enabled: true, targets: {...config.themeBridge.targets, tmux: {mode: 'choose', theme: assetRef(id)}, vim: {mode: 'follow'}}};
  assert.deepEqual(deleteCheck(config, id).pinned, ['tmux']);
  const blocked = deleteTheme(config, id);
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? '' : blocked.error, /tmux is pinned/u);
  const deleted = ok(deleteTheme(config, id, true));
  assert.equal(deleted.config.themes.length, 0);
  assert.deepEqual(deleted.config.themeBridge.targets.tmux, {mode: 'independent'}, 'Independent, never another theme');
  assert.equal(deleted.config.themeBridge.targets.vim.mode, 'follow', 'other targets untouched');
  assert.equal(resolveSemanticPalette(assetRef(id), deleted.config).ok, false, 'the old reference resolves to nothing');
});

test('missing references are reported, never replaced; bad refs are rejected', () => {
  assert.deepEqual(themeForRef('asset:t-000000000000', {themes: []}), {ok: false, reason: 'missing'});
  assert.deepEqual(themeForRef('builtin:notATheme', {themes: []}), {ok: false, reason: 'invalid'});
  assert.equal(parseThemeRef('asset:../../etc'), undefined);
  assert.deepEqual(parseThemeRef('builtin:catppuccinMocha@peach'), {kind: 'builtin', palette: 'catppuccinMocha', accent: 'peach'});
  assert.equal(builtinRef('catppuccinMocha', 'mauve'), 'builtin:catppuccinMocha', 'the default accent is implicit');
  assert.equal(builtinRef('nord', 'peach'), 'builtin:nord', 'accents only apply to accented families');
});

test('malformed library entries are dropped individually; the library is bounded', () => {
  const good = {id: 't-aaaaaaaaaaaa', theme: theme('Good')};
  const library = normalizeThemeLibrary([good, {id: 'bad id!', theme: theme('X')}, {id: 't-bbbbbbbbbbbb', theme: {name: 'broken'}}, good, 'nope'], undefined, 't-aaaaaaaaaaaa');
  assert.deepEqual(library.themes.map(asset => asset.id), ['t-aaaaaaaaaaaa']);
  assert.equal(library.themeId, 't-aaaaaaaaaaaa');
  const many = Array.from({length: THEME_LIBRARY_LIMIT + 10}, (_, index) => ({id: `t-${index.toString(16).padStart(12, '0')}`, theme: theme(`T${index}`)}));
  assert.equal(normalizeThemeLibrary(many, undefined, undefined).themes.length, THEME_LIBRARY_LIMIT);
  let config = normalizePromptConfiguration({themes: many});
  const full = addTheme(config, theme('One more'));
  assert.equal(full.ok, false);
  assert.match(full.ok ? '' : full.error, /library is full/u);
  config = normalizePromptConfiguration({themes: [{id: 't-cccccccccccc', theme: theme('A'), origin: {kind: 'evil'}, modified: true}]});
  assert.equal(categoryOf(config.themes[0]!), 'custom', 'an unknown origin kind is not provenance');
  assert.equal(config.themes[0]!.modified, undefined);
});

test('Setup/Settings selection: built-in families, Imported and Custom groups, variants by stable id', () => {
  let config = ok(addTheme(base(), theme('Custom A'))).config;
  config = ok(addTheme(config, theme('Imported B'), ORIGIN)).config;
  const families = selectionFamilies(config);
  assert.ok(families.includes('nmsh') && families.includes('gruvbox'));
  assert.deepEqual(families.slice(-2), ['imported', 'custom']);
  config = selectSelectionFamily(config, 'imported');
  assert.equal(currentSelectionFamily(config), 'imported');
  assert.equal(config.nmsh.palette, 'custom');
  assert.equal(config.customTheme?.name, 'Imported B');
  const variants = selectionVariants(config, 'custom');
  config = variants[0]!.apply(config);
  assert.equal(currentSelectionFamily(config), 'custom');
  config = selectSelectionFamily(config, 'gruvbox');
  assert.equal(config.nmsh.palette, 'gruvboxDark');
  assert.equal(config.themes.length, 2, 'selection never deletes or copies library themes');
});
