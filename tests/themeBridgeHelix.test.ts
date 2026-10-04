import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {addTheme, setActiveTheme} from '../src/appearance/themeLibraryActions.js';
import {assetRef, builtinTheme} from '../src/appearance/themeRefs.js';
import {paletteFromTheme} from '../src/appearance/semanticPalette.js';
import {helixTheme, validateHelixTheme} from '../src/themeBridge/targets.js';
import {applyHook, applyHookRemoval, artifactPath, helixConfigDirectory, hookSpec, loadLedger, planHook, planHookRemoval, removeArtifact} from '../src/themeBridge/artifacts.js';
import {applyThemeBridge, reportTargets, type BridgeContext} from '../src/themeBridge/runtime.js';
import {BRIDGE_TARGETS, type BridgeTargetId} from '../src/themeBridge/model.js';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-helix-'));
  const home = join(root, 'home');
  mkdirSync(home);
  return {root, home, env: {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: ''} as NodeJS.ProcessEnv, done: () => rmSync(root, {recursive: true, force: true})};
}
const facts = Object.fromEntries(BRIDGE_TARGETS.map(target => [target, {installed: true}])) as BridgeContext['facts'];
function config(helix: {mode: 'independent' | 'follow' | 'choose'; theme?: string}, active = 'builtin:lavender'): PromptConfiguration {
  const base = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), themeBridge: {enabled: true, targets: {helix}}});
  const result = setActiveTheme(base, active);
  assert.ok(result.ok);
  return result.config;
}
const ctx = (source: PromptConfiguration, env: NodeJS.ProcessEnv): BridgeContext => ({source, facts, level: 'truecolor', env});

test('Helix theme: deterministic parseable TOML with a palette; every style references the palette', () => {
  const palette = paletteFromTheme(builtinTheme('tokyonightNight'), 'builtin:tokyonightNight');
  const toml = helixTheme(palette);
  assert.equal(toml, helixTheme(palette));
  assert.ok(validateHelixTheme(toml, parseToml));
  const data = parseToml(toml) as Record<string, unknown>;
  const names = data.palette as Record<string, string>;
  assert.ok(Object.values(names).every(hex => /^#[0-9a-f]{6}$/u.test(hex)));
  for (const scope of ['attribute', 'type', 'type.builtin', 'constructor', 'constant', 'constant.builtin', 'constant.numeric', 'string', 'string.regexp', 'string.special', 'comment',
    'variable', 'variable.builtin', 'variable.parameter', 'variable.other.member', 'label', 'punctuation', 'punctuation.delimiter', 'punctuation.bracket', 'keyword', 'keyword.control',
    'keyword.control.conditional', 'keyword.control.repeat', 'keyword.control.import', 'keyword.control.return', 'keyword.control.exception', 'keyword.operator', 'keyword.directive',
    'keyword.function', 'keyword.storage', 'operator', 'function', 'function.builtin', 'function.method', 'function.macro', 'tag', 'namespace', 'special',
    'markup.heading', 'markup.bold', 'markup.italic', 'markup.link', 'markup.quote', 'markup.raw', 'diff.plus', 'diff.minus', 'diff.delta', 'diff.delta.conflict']) assert.ok(scope in data, scope);
  for (const scope of ['ui.background', 'ui.background.separator', 'ui.cursor', 'ui.cursor.normal', 'ui.cursor.insert', 'ui.cursor.select', 'ui.cursor.match', 'ui.cursor.primary',
    'ui.gutter', 'ui.gutter.selected', 'ui.linenr', 'ui.linenr.selected', 'ui.statusline', 'ui.statusline.inactive', 'ui.statusline.normal', 'ui.statusline.insert', 'ui.statusline.select',
    'ui.statusline.separator', 'ui.bufferline', 'ui.bufferline.active', 'ui.bufferline.background', 'ui.popup', 'ui.popup.info', 'ui.window', 'ui.help', 'ui.text', 'ui.text.focus',
    'ui.text.inactive', 'ui.text.info', 'ui.text.directory', 'ui.virtual.whitespace', 'ui.virtual.indent-guide', 'ui.virtual.inlay-hint', 'ui.virtual.inlay-hint.parameter',
    'ui.virtual.inlay-hint.type', 'ui.menu', 'ui.menu.selected', 'ui.menu.scroll', 'ui.selection', 'ui.selection.primary', 'ui.highlight', 'ui.cursorline.primary',
    'ui.cursorline.secondary', 'ui.cursorcolumn.primary']) assert.ok(scope in data, scope);
  assert.equal(names[data['diff.plus'] as string], palette.success);
  assert.equal(names[data['diff.minus'] as string], palette.failure);
  assert.equal(names[data['diff.delta'] as string], palette.warning);
  assert.equal(names[(data['diagnostic.error'] as {underline: {color: string}}).underline.color], palette.failure);
  assert.equal(names[data.keyword as string], palette.syntax.keyword);
  assert.deepEqual({...data['ui.background'] as object}, {}, 'no theme background: the terminal keeps its own');
  const imported = paletteFromTheme({...builtinTheme('nord'), terminal: {background: '#101010', foreground: '#eeeeee', ansi: Array(16).fill('#888888')}}, 'asset:t-aaaaaaaaaaaa');
  assert.deepEqual({...parseToml(helixTheme(imported))['ui.background'] as object}, {bg: 'background'});
  assert.equal(validateHelixTheme(`${toml}\n"ui.text" = "nonexistent"\n`, parseToml), false);
  assert.equal(validateHelixTheme('"keyword" = { fg = "x", command = "rm -rf ~" }\n[palette]\nx = "#000000"\n', parseToml), false, 'theme data only');
});

test('Helix: Independent writes nothing; Follow tracks the active theme; Choose stays pinned; library themes resolve', async () => {
  const box = sandbox();
  try {
    await applyThemeBridge(ctx(config({mode: 'independent'}), box.env));
    assert.equal(existsSync(artifactPath('helix', box.env)), false);
    assert.equal(existsSync(helixConfigDirectory(box.env)), false, 'nothing under the Helix config dir');
    let follow = config({mode: 'follow'});
    await applyThemeBridge(ctx(follow, box.env));
    const lavender = readFileSync(artifactPath('helix', box.env), 'utf8');
    assert.match(lavender, /from "Lavender Native"/u);
    follow = (setActiveTheme(follow, 'builtin:gruvboxDark') as {config: PromptConfiguration}).config;
    await applyThemeBridge(ctx(follow, box.env));
    assert.match(readFileSync(artifactPath('helix', box.env), 'utf8'), /from "Gruvbox Dark"/u, 'regenerated when the NMSh theme changes');
    let pinned = config({mode: 'choose', theme: 'builtin:nord'});
    const added = addTheme(pinned, {...builtinTheme('dracula'), name: 'Imported Dracula'}, {kind: 'ghostty'});
    assert.ok(added.ok);
    pinned = {...added.config, themeBridge: {...added.config.themeBridge, targets: {...added.config.themeBridge.targets, helix: {mode: 'choose', theme: assetRef(added.id!)}}}};
    await applyThemeBridge(ctx(pinned, box.env));
    const chosen = readFileSync(artifactPath('helix', box.env), 'utf8');
    assert.match(chosen, /from "Imported Dracula"/u);
    pinned = (setActiveTheme(pinned, 'builtin:solarizedLight') as {config: PromptConfiguration}).config;
    await applyThemeBridge(ctx(pinned, box.env));
    assert.equal(readFileSync(artifactPath('helix', box.env), 'utf8'), chosen, 'pinned: unchanged by the main theme');
    const report = reportTargets(ctx(pinned, box.env)).find(item => item.target === 'helix')!;
    assert.equal(report.status, 'Pinned theme');
    assert.match(report.notes.join(' '), /Managed theme generated; select it with :theme nmsh-bridge/u);
    assert.match(report.notes.join(' '), /Running Helix instances are not recolored/u, 'never claims live updates');
  } finally { box.done(); }
});

test('Helix: never overwrites an unowned user theme file of the same name', async () => {
  const box = sandbox();
  try {
    mkdirSync(join(helixConfigDirectory(box.env), 'themes'), {recursive: true});
    writeFileSync(artifactPath('helix', box.env), 'inherits = "onedark"\n');
    const outcomes = await applyThemeBridge(ctx(config({mode: 'follow'}), box.env));
    assert.equal(outcomes.find(outcome => outcome.target === 'helix')?.ok, false);
    assert.equal(readFileSync(artifactPath('helix', box.env), 'utf8'), 'inherits = "onedark"\n');
    assert.equal(removeArtifact('helix', box.env).ok, false);
    assert.equal(reportTargets(ctx(config({mode: 'follow'}), box.env)).find(item => item.target === 'helix')!.status, 'Conflict');
  } finally { box.done(); }
});

test('Helix activation: exact confirmed theme assignment before the first table; removal exact; a user-selected theme is never replaced', async () => {
  const box = sandbox();
  try {
    await applyThemeBridge(ctx(config({mode: 'follow'}), box.env));
    const configPath = join(helixConfigDirectory(box.env), 'config.toml');
    const user = '# my helix\n[editor]\nline-number = "relative"\n\n[keys.normal]\nC-s = ":w"\n';
    writeFileSync(configPath, user);
    const spec = hookSpec('helix', box.env, box.home);
    assert.ok(!('error' in spec));
    assert.deepEqual(spec.lines, ['# NMSh Theme Bridge: selects the NMSh-managed theme (remove with /theme-bridge)', 'theme = "nmsh-bridge"']);
    const planned = planHook(spec, box.home);
    assert.ok('plan' in planned);
    assert.equal(readFileSync(configPath, 'utf8'), user, 'planning alone changes nothing');
    assert.ok(applyHook('helix', planned.plan, spec, box.env).ok);
    const after = readFileSync(configPath, 'utf8');
    assert.equal((parseToml(after) as {theme: string}).theme, 'nmsh-bridge', 'a valid top-level assignment');
    assert.deepEqual({...(parseToml(after) as {editor: object}).editor}, {'line-number': 'relative'}, 'user settings untouched');
    assert.match(reportTargets(ctx(config({mode: 'follow'}), box.env)).find(item => item.target === 'helix')!.notes.join(' '), /Active through NMSh-managed config/u);
    const removal = planHookRemoval('helix', box.home, box.env);
    assert.ok('plan' in removal);
    assert.ok(applyHookRemoval('helix', removal.plan, box.env).ok);
    assert.equal(readFileSync(configPath, 'utf8'), user, 'exactly restored');
    assert.equal(loadLedger(box.env).entries.helix?.hook, undefined);
    writeFileSync(configPath, 'theme = "catppuccin_mocha"\n');
    const refused = hookSpec('helix', box.env, box.home);
    assert.ok('error' in refused && /already selects a theme/u.test(refused.error));
    assert.match(reportTargets(ctx(config({mode: 'follow'}), box.env)).find(item => item.target === 'helix')!.notes.join(' '), /Configured independently: .*catppuccin_mocha/u);
    assert.equal(readFileSync(configPath, 'utf8'), 'theme = "catppuccin_mocha"\n');
    rmSync(configPath);
    const fresh = hookSpec('helix', box.env, box.home);
    assert.ok(!('error' in fresh) && fresh.createIfMissing, 'a missing config is created with only the assignment, after confirmation');
    await applyThemeBridge(ctx(config({mode: 'independent'}), box.env));
    assert.equal(existsSync(artifactPath('helix', box.env)), false, 'Independent removes only the owned generated theme');
  } finally { box.done(); }
});

void ({} as BridgeTargetId);
