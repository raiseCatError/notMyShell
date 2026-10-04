import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {XMLValidator} from 'fast-xml-parser';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {addTheme, deleteTheme, duplicateCurrentToCustom, setActiveTheme} from '../src/appearance/themeLibraryActions.js';
import {assetRef, builtinTheme} from '../src/appearance/themeRefs.js';
import {paletteFromTheme} from '../src/appearance/semanticPalette.js';
import {categoryOf} from '../src/appearance/themeLibrary.js';
import {BRIDGE_TARGETS, effectiveMode, effectiveSetting, normalizeThemeBridge, targetEditable, type BridgeTargetId} from '../src/themeBridge/model.js';
import {batTheme, bsdLsColors, validateBatTheme, validBsdLsColors} from '../src/themeBridge/targets.js';
import {artifactPath, batConfigDirectory, loadLedger} from '../src/themeBridge/artifacts.js';
import {applyThemeBridge, batReady, bridgeEnvironment, integrationHealth, reportTargets, setupBat, type BridgeContext, type TargetFacts} from '../src/themeBridge/runtime.js';
import {createThemeStudio, studioKey} from '../src/appearance/ThemeStudio.js';
import {createSetup, sectionIndex, setupKey} from '../src/setup/SetupCat.js';

const base = (): PromptConfiguration => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const facts = (extra: Partial<Record<BridgeTargetId, TargetFacts>> = {}) =>
  ({...Object.fromEntries(BRIDGE_TARGETS.map(target => [target, {installed: true}])), ...extra}) as Record<BridgeTargetId, TargetFacts>;
const ctx = (source: PromptConfiguration, env: NodeJS.ProcessEnv, f = facts()): BridgeContext => ({source, facts: f, level: 'truecolor', env});
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-policy-'));
  const home = join(root, 'home');
  mkdirSync(home);
  return {root, home, env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: process.env.PATH} as NodeJS.ProcessEnv, done: () => rmSync(root, {recursive: true, force: true})};
}

test('policy: Off preserves Manual state; Follow and Choose apply to supported targets only; Manual comes back exactly', () => {
  const manual = {fzf: {mode: 'choose' as const, theme: 'builtin:nord'}, tmux: {mode: 'follow' as const}, delta: {mode: 'follow' as const}};
  const off = normalizeThemeBridge({enabled: false, targets: manual});
  assert.ok(BRIDGE_TARGETS.every(target => effectiveMode(off, target) === 'independent'));
  assert.equal(off.targets.fzf.theme, 'builtin:nord', 'kept while Off');
  const follow = normalizeThemeBridge({enabled: true, policy: 'follow', targets: manual});
  assert.equal(effectiveMode(follow, 'pager'), 'follow');
  assert.equal(effectiveMode(follow, 'fzf'), 'follow');
  assert.equal(effectiveMode(follow, 'delta'), 'independent', 'delta never inherits');
  assert.equal(targetEditable(follow, 'tmux'), false);
  const choose = normalizeThemeBridge({enabled: true, policy: 'choose', theme: 'builtin:gruvboxDark', targets: manual});
  assert.deepEqual(effectiveSetting(choose, 'vim'), {mode: 'choose', theme: 'builtin:gruvboxDark'});
  const back = normalizeThemeBridge({...choose, policy: 'manual'});
  assert.deepEqual(back.targets.fzf, {mode: 'choose', theme: 'builtin:nord'});
  assert.deepEqual(effectiveSetting(back, 'tmux'), {mode: 'follow'});
  assert.equal(targetEditable(back, 'tmux'), true);
  // Migration from the earlier model: enabled + targets read as Manual; Choose without a theme reads as Manual.
  assert.equal(normalizeThemeBridge({enabled: true, targets: manual}).policy, 'manual');
  assert.equal(normalizeThemeBridge({enabled: true, policy: 'choose'}).policy, 'manual');
});

test('global Follow tracks the active theme; global Choose stays pinned; deleting the global pin returns to Manual', () => {
  let config = normalizePromptConfiguration({...base(), themeBridge: {enabled: true, policy: 'follow', targets: {}}});
  const env = {PATH: ''};
  const before = reportTargets(ctx(config, env)).find(report => report.target === 'tmux')!;
  config = (setActiveTheme(config, 'builtin:nord') as {config: PromptConfiguration}).config;
  const after = reportTargets(ctx(config, env)).find(report => report.target === 'tmux')!;
  assert.equal(before.themeLabel, 'Lavender Native');
  assert.equal(after.themeLabel, 'Nord');
  assert.equal(after.inherited, true);
  const added = addTheme(config, {...builtinTheme('dracula'), name: 'Mine'});
  assert.ok(added.ok);
  config = {...added.config, themeBridge: {...added.config.themeBridge, policy: 'choose', theme: assetRef(added.id!)}};
  config = (setActiveTheme(config, 'builtin:solarizedDark') as {config: PromptConfiguration}).config;
  assert.equal(reportTargets(ctx(config, env)).find(report => report.target === 'vim')!.themeLabel, 'Mine');
  assert.equal(deleteTheme(config, added.id!).ok, false, 'a global pin blocks deletion until confirmed');
  const deleted = deleteTheme(config, added.id!, true);
  assert.ok(deleted.ok);
  assert.equal(deleted.config.themeBridge.policy, 'manual');
  assert.equal(deleted.config.themeBridge.theme, undefined);
});

test('file listing colors: GNU ls/gls get LS_COLORS and session-only wrappers; macOS/BSD ls gets CLICOLOR and LSCOLORS', () => {
  const config = normalizePromptConfiguration({...base(), themeBridge: {enabled: true, targets: {lsColors: {mode: 'follow'}}}});
  const env = {PATH: ''};
  const gnu = bridgeEnvironment(ctx(config, env, facts({lsColors: {installed: true, listing: {ls: 'gnu', gls: false}}})));
  assert.ok(gnu.LS_COLORS);
  assert.deepEqual(gnu.listing, ['ls']);
  assert.equal(gnu.LSCOLORS, undefined);
  const mac = bridgeEnvironment(ctx(config, env, facts({lsColors: {installed: true, listing: {ls: 'bsd', gls: true}}})));
  assert.equal(mac.CLICOLOR, '1');
  assert.ok(validBsdLsColors(mac.LSCOLORS!));
  assert.deepEqual(mac.listing, ['gls'], 'Homebrew gls is GNU and gets its own wrapper');
  assert.ok(mac.LS_COLORS);
  assert.equal(bsdLsColors(paletteFromTheme(builtinTheme('nord'), 'x')).length, 24, 'twelve fg/bg pairs');
  const report = reportTargets(ctx(config, env, facts({lsColors: {installed: true, listing: {ls: 'bsd', gls: true}}}))).find(item => item.target === 'lsColors')!;
  assert.equal(report.label, 'File listing colors');
  assert.match(report.backend!, /macOS\/BSD ls · CLICOLOR, LSCOLORS \+ GNU gls · LS_COLORS/u);
  const independent = bridgeEnvironment(ctx(normalizePromptConfiguration({}), env, facts({lsColors: {installed: true, listing: {ls: 'bsd'}}})));
  assert.deepEqual(independent, {}, 'Independent injects nothing');
});

test('bat: deterministic data-only tmTheme from any theme; setup only on request; BAT_THEME only when the cache lists it', async () => {
  for (const theme of [builtinTheme('nord'), builtinTheme('solarizedLight'), {...builtinTheme('dracula'), name: 'Imported & <odd> "name"'}]) {
    const xml = batTheme(paletteFromTheme(theme, 'x'));
    assert.equal(xml, batTheme(paletteFromTheme(theme, 'x')));
    assert.equal(XMLValidator.validate(xml), true);
    assert.ok(validateBatTheme(xml, text => text));
    for (const scope of ['comment', 'string', 'constant.numeric', 'entity.name.function', 'keyword', 'entity.name.type', 'entity.name.tag', 'invalid', 'markup.inserted', 'markup.deleted']) assert.match(xml, new RegExp(scope.replace('.', '\\.'), 'u'));
  }
  const box = sandbox();
  try {
    const config = normalizePromptConfiguration({...base(), themeBridge: {enabled: true, targets: {bat: {mode: 'follow'}}}});
    await applyThemeBridge(ctx(config, box.env, facts({bat: {installed: true}})));
    assert.equal(existsSync(artifactPath('bat', box.env)), false, 'no bat file until the user asks for setup');
    assert.equal(bridgeEnvironment(ctx(config, box.env)).BAT_THEME, undefined);
    assert.equal(integrationHealth(ctx(config, box.env)).find(item => item.target === 'bat')!.state, 'needs-setup');
    mkdirSync(join(batConfigDirectory(box.env), 'themes'), {recursive: true});
    writeFileSync(artifactPath('bat', box.env), '<plist>mine</plist>');
    const refused = await setupBat(paletteFromTheme(builtinTheme('nord'), 'builtin:nord'), 'follow', 'builtin:nord', {...box.env, PATH: ''});
    assert.equal(refused.ok, false);
    assert.equal(readFileSync(artifactPath('bat', box.env), 'utf8'), '<plist>mine</plist>', 'an unowned same-name file is never overwritten');
    rmSync(artifactPath('bat', box.env));
    const bat = ['/opt/homebrew/bin/bat', '/usr/local/bin/bat', '/usr/bin/bat', '/usr/bin/batcat'].find(existsSync);
    if (!bat || bat.endsWith('batcat')) return;
    const env = {...box.env, BAT_CONFIG_DIR: batConfigDirectory(box.env), BAT_CACHE_PATH: join(box.root, 'bat-cache')};
    const result = await setupBat(paletteFromTheme(builtinTheme('nord'), 'builtin:nord'), 'follow', 'builtin:nord', env);
    assert.ok(result.ok, result.message);
    assert.ok(batReady(env));
    assert.equal(loadLedger(env).entries.bat?.cacheApproved, true);
    assert.equal(bridgeEnvironment(ctx(config, env)).BAT_THEME, 'nmsh-bridge');
    assert.equal(existsSync(join(batConfigDirectory(box.env), 'config')), false, "bat's own config file is never written");
  } finally { box.done(); }
});

test('Duplicate current → Custom: any source, provenance dropped, "<name> - Custom", active theme unchanged', () => {
  let config = addTheme(base(), {...builtinTheme('nord'), name: 'Ghostty Mocha'}, {kind: 'ghostty', sourcePath: '/x'}, true);
  assert.ok(config.ok);
  const before = config.config.nmsh.themeId;
  const copy = duplicateCurrentToCustom(config.config);
  assert.ok(copy.ok);
  const asset = copy.config.themes.find(item => item.id === copy.id)!;
  assert.equal(asset.theme.name, 'Ghostty Mocha - Custom');
  assert.equal(categoryOf(asset), 'custom');
  assert.equal(copy.config.nmsh.themeId, before, 'the current theme stays active');
  const builtin = duplicateCurrentToCustom(normalizePromptConfiguration({nmsh: {palette: 'gruvboxDark'}}));
  assert.ok(builtin.ok && builtin.config.themes[0]!.theme.name === 'Gruvbox Dark - Custom');
  const again = duplicateCurrentToCustom(builtin.config);
  assert.ok(again.ok && again.config.themes[1]!.theme.name === 'Gruvbox Dark - Custom 2', 'deterministic unique naming');
  void config;
});

test('preview Chroma switches are local: Theme Studio and Setup toggle only their preview', () => {
  const context = {themes: [], accent: 'mauve' as const, pinnedTo: () => [], chroma: 'Aurora · wave'};
  const studio = createThemeStudio(context);
  assert.equal(studio.previewChroma, false, 'Off by default');
  studioKey(studio, {kind: 'text', value: 'c'}, 'truecolor', '/', context);
  assert.equal(studio.previewChroma, true);
  const config = normalizePromptConfiguration({presentation: {preset: 'aurora'}});
  const setup = createSetup(config);
  setup.section = sectionIndex('appearance');
  setupKey(setup, {kind: 'text', value: 'p'});
  assert.equal(setup.previewChroma, true);
  assert.equal(setup.draft.presentation.preset, 'aurora', 'the draft (and saved) Chroma is unchanged');
});
