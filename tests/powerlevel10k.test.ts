import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {detectPowerlevel10k, powerlevel10kThemeCandidates, renderPowerlevel10kPrompt} from '../src/prompt/powerlevel10k.js';
import {configuratorFileChanged, powerlevel10kZshrcPath, preparePowerlevel10kConfigurator} from '../src/prompt/Powerlevel10kConfigurator.js';
import {describePromptConfiguration, handlePromptPanelKey, PROVIDER_ORDER, renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import type {Key} from '../src/terminal/keys.js';
import {stripAnsi} from '../src/util/text.js';

/**
 * A stand-in theme with p10k's shape: config-driven element list, a precmd
 * hook that reads $?, and a lazily expanded PROMPT.
 */
const STUB_THEME = `
typeset -ga precmd_functions=(_stub_precmd)
_stub_precmd() {
  local st=$?
  local parts=() e
  for e in $POWERLEVEL9K_LEFT_PROMPT_ELEMENTS; do
    case $e in
      dir) parts+=("%F{blue}\${PWD:t}%f") ;;
      status) parts+=("%F{red}rc=$st%f") ;;
      prompt_char) parts+=('❯') ;;
      newline) parts+=($'\\n') ;;
    esac
  done
  typeset -g _stub_prompt="\${(j: :)parts}"
  PROMPT='\${_stub_prompt}'
}
`;

async function stubInstall() {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-p10k-'));
  const theme = join(directory, 'powerlevel10k.zsh-theme');
  const config = join(directory, '.p10k.zsh');
  const cwd = join(directory, 'project-dir');
  await writeFile(theme, STUB_THEME);
  await writeFile(config, `typeset -ga POWERLEVEL9K_LEFT_PROMPT_ELEMENTS=(dir status newline prompt_char)\n`);
  await import('node:fs/promises').then(fs => fs.mkdir(cwd));
  return {directory, theme, config, cwd};
}

test('Powerlevel10k detection finds the theme and config without requiring either', async () => {
  const {directory, theme, config} = await stubInstall();
  try {
    const found = detectPowerlevel10k({POWERLEVEL9K_CONFIG_FILE: config}, directory, [join(directory, 'missing'), theme]);
    assert.deepEqual(found, {installed: true, themePath: theme, configPath: config, configExists: true});
    const missing = detectPowerlevel10k({}, directory, [join(directory, 'missing')]);
    assert.equal(missing.installed, false);
    assert.equal(missing.configPath, join(directory, '.p10k.zsh'));
    const candidates = powerlevel10kThemeCandidates({HOMEBREW_PREFIX: '/opt/brew'}, '/Users/x');
    assert.ok(candidates.includes('/opt/brew/share/powerlevel10k/powerlevel10k.zsh-theme'));
    assert.ok(candidates.includes('/Users/x/powerlevel10k/powerlevel10k.zsh-theme'));
    assert.ok(candidates.includes('/Users/x/.oh-my-zsh/custom/themes/powerlevel10k/powerlevel10k.zsh-theme'));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('isolated helper renders the left prompt for cwd and status, drops prompt_char, and never writes config', async () => {
  const {directory, theme, config, cwd} = await stubInstall();
  try {
    const before = await readFile(config, 'utf8');
    const beforeTime = (await stat(config)).mtimeMs;
    const status = detectPowerlevel10k({POWERLEVEL9K_CONFIG_FILE: config}, directory, [theme]);
    const result = await renderPowerlevel10kPrompt({cwd, project: 'x', exitStatus: 3}, status);
    assert.equal(result.text, 'project-dir rc=3');
    assert.equal(result.normalizedMultiline, false, 'newline element is removed');
    assert.doesNotMatch(result.text, /❯/u, 'NMSh owns the input prompt');
    assert.ok(result.segments.some(segment => segment.text === 'project-dir' && segment.foreground), 'colors become semantic spans');
    assert.equal(await readFile(config, 'utf8'), before);
    assert.equal((await stat(config)).mtimeMs, beforeTime);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('helper failures reject instead of rendering a fake prompt', async () => {
  const {directory, config, cwd} = await stubInstall();
  try {
    await writeFile(join(directory, 'broken.zsh-theme'), 'return 1\n');
    await assert.rejects(renderPowerlevel10kPrompt({cwd, project: 'x'}, {installed: true, themePath: join(directory, 'broken.zsh-theme'), configPath: config, configExists: true}));
    await assert.rejects(renderPowerlevel10kPrompt({cwd, project: 'x'}, {installed: false, configPath: config, configExists: true}), /not found/u);
    await writeFile(join(directory, 'slow.zsh-theme'), 'sleep 5\n');
    await assert.rejects(renderPowerlevel10kPrompt({cwd, project: 'x'}, {installed: true, themePath: join(directory, 'slow.zsh-theme'), configPath: config, configExists: true}, process.env, 300), /timed out/u);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

const realP10k = detectPowerlevel10k();
test('renders a real installed Powerlevel10k left prompt', {skip: !realP10k.installed && 'Powerlevel10k is not installed'}, async () => {
  const result = await renderPowerlevel10kPrompt({cwd: process.cwd(), project: 'notMyShell', exitStatus: 0}, realP10k);
  assert.ok(result.text.trim().length > 0);
  assert.equal(result.normalizedMultiline, false);
});

test('provider config round-trips and switching keeps inactive provider settings', () => {
  const config = normalizePromptConfiguration({provider: 'powerlevel10k', starship: {configPath: '/s.toml'},
    powerlevel10k: {themePath: '/t.zsh-theme', configPath: '/c.zsh'}, nmsh: {palette: 'cool'}});
  assert.equal(config.provider, 'powerlevel10k');
  assert.deepEqual(config.powerlevel10k, {themePath: '/t.zsh-theme', configPath: '/c.zsh'});
  const switched = normalizePromptConfiguration({...config, provider: 'nmsh'});
  assert.deepEqual(switched.powerlevel10k, config.powerlevel10k);
  assert.equal(switched.starship.configPath, '/s.toml');
  assert.equal(switched.nmsh.palette, 'cool');
  assert.deepEqual(normalizePromptConfiguration({}).powerlevel10k, {themePath: null, configPath: null});
  assert.equal(describePromptConfiguration(config), 'Powerlevel10k · two-line divider');
});

test('/prompt offers three providers and an honest Powerlevel10k step', () => {
  const state: PromptPanelState = {onboarding: false, step: 'provider', selectedIndex: 0,
    draft: structuredClone(DEFAULT_PROMPT_CONFIGURATION), saved: structuredClone(DEFAULT_PROMPT_CONFIGURATION)};
  assert.deepEqual(PROVIDER_ORDER, ['nmsh', 'starship', 'powerlevel10k']);
  let rows = renderPromptPanel(state, 140, []).map(stripAnsi);
  assert.ok(rows.some(row => row.includes('NMSh Native · built-in themes, geometry, and modules  ●  ✓ saved')));
  assert.ok(rows.some(row => row.includes('Powerlevel10k · use your ~/.p10k.zsh left prompt')));
  handlePromptPanelKey({kind: 'up'} as Key, state);
  assert.equal(state.selectedIndex, 2);

  const installed = {...state, step: 'powerlevel10k' as const, selectedIndex: 0,
    p10kStatus: {installed: true, themePath: '/t/powerlevel10k.zsh-theme', configPath: '/h/.p10k.zsh', configExists: true}};
  rows = renderPromptPanel(installed, 160, []).map(stripAnsi);
  assert.ok(rows.some(row => row.includes('Theme /t/powerlevel10k.zsh-theme')));
  assert.ok(rows.some(row => row.includes('right prompt is not shown yet.')));
  assert.ok(rows.some(row => row.includes('› Use Powerlevel10k')));
  assert.ok(rows.some(row => row.includes('Configure Powerlevel10k')));

  const missing = {...installed, p10kStatus: {installed: false, configPath: '/h/.p10k.zsh', configExists: false}};
  rows = renderPromptPanel(missing, 160, []).map(stripAnsi);
  assert.ok(rows.some(row => row.includes('Powerlevel10k was not found.')));
  assert.ok(!rows.some(row => /Install Powerlevel10k now/u.test(row)), 'no silent or implied installation');

  installed.step = 'p10kConfirm';
  rows = renderPromptPanel(installed, 160, []).map(stripAnsi);
  assert.ok(rows.some(row => row.includes('wizard may modify')));
  assert.ok(rows.some(row => row.includes('/h/.p10k.zsh')));
  assert.ok(rows.some(row => row.includes('Create backups and continue')));
});

test('Powerlevel10k wizard preparation backs up both possible targets and detects changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-p10k-config-'));
  const config = join(directory, '.p10k.zsh');
  const zshrc = join(directory, '.zshrc');
  await writeFile(config, '# config\n');
  await writeFile(zshrc, '# shell\n');
  try {
    assert.equal(powerlevel10kZshrcPath({ZDOTDIR: directory}), zshrc);
    const preparation = await preparePowerlevel10kConfigurator(
      {installed: true, themePath: '/fake/theme', configPath: config, configExists: true}, {ZDOTDIR: directory});
    assert.equal(await readFile(preparation.config.backup!, 'utf8'), '# config\n');
    assert.equal(await readFile(preparation.zshrc.backup!, 'utf8'), '# shell\n');
    assert.equal(await configuratorFileChanged(preparation.config), false);
    await writeFile(config, '# updated\n');
    assert.equal(await configuratorFileChanged(preparation.config), true);
    assert.equal(await configuratorFileChanged(preparation.zshrc), false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('Powerlevel10k wizard preparation refuses symlinked user configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-p10k-symlink-'));
  const config = join(directory, '.p10k.zsh');
  const zshrc = join(directory, '.zshrc');
  await writeFile(zshrc, '# shell\n');
  await symlink(zshrc, config);
  try {
    await assert.rejects(preparePowerlevel10kConfigurator(
      {installed: true, themePath: '/fake/theme', configPath: config, configExists: true}, {ZDOTDIR: directory}),
    /not a regular file/u);
    assert.equal(await readFile(zshrc, 'utf8'), '# shell\n');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('a broken Powerlevel10k provider falls back to NMSh truthfully', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-p10k-fallback-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  try {
    app['promptConfiguration'] = normalizePromptConfiguration({provider: 'powerlevel10k', powerlevel10k: {themePath: join(directory, 'missing.zsh-theme')}});
    await app['refreshProviderPrompt']();
    assert.equal(app['effectivePromptProvider'], 'nmsh');
    assert.equal(app['promptConfiguration'].provider, 'nmsh');
    assert.match(app['externalPromptError'] ?? '', /not found/u);
    assert.equal(app['currentPromptSnapshot']().provider, 'nmsh');
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
});
