import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {TOOLS, suggestibleToolFor, toolInstall, toolInstallUnavailable, toolsInTier} from '../src/tools/catalog.js';
import {createToolsPanel, renderTools, toolHasUpdate, toolsKey, visibleTools} from '../src/tools/ToolsPanel.js';
import {
  loadToolUpdateState, parseBrewOutdated, runToolUpdateCheck, saveToolUpdateState, toolOwner, toolUpdateCheckDue, toolUpgrade,
  UNKNOWN_OWNER_UPDATE,
} from '../src/tools/ToolUpdates.js';
import {
  commandWord, createInstallPrompt, ignoreInstallSuggestion, installCandidate, installPromptKey, renderInstallPrompt, shouldOfferInstall,
} from '../src/tools/InstallSuggestion.js';
import {lifecycleNote, providerLifecycle} from '../src/providers/providers.js';
import {WELCOME_PROVIDERS} from '../src/output/WelcomeProviders.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {describeCommandSource, describeSlashCommand, renderInspector} from '../src/shell/CommandInspector.js';
import {parseCommandSource, parseCompletionFacts} from '../src/shell/SemanticService.js';
import {describeOnly, parseConfiguredCompletions} from '../src/shell/ConfiguredCompletion.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';

const tool = (id: string) => TOOLS.find(item => item.id === id)!;
const plain = (rows: string[]) => rows.map(stripAnsi).join('\n');

test('tiers: the conservative Recommended toolkit is unchanged; Enhanced is separate and never "better"', () => {
  assert.deepEqual(toolsInTier('recommended').map(item => item.id).sort(), ['fastfetch', 'fd', 'fzf', 'jq', 'rg', 'tealdeer', 'zoxide']);
  assert.deepEqual(toolsInTier('enhanced').map(item => item.id).sort(), ['atuin', 'bat', 'btop', 'delta', 'direnv', 'duf', 'dust', 'eza', 'gh', 'glow', 'hyperfine', 'jc', 'just', 'lazygit', 'mise', 'procs', 'shellcheck', 'shfmt', 'tokei', 'watchexec', 'xh']);
  const state = createToolsPanel();
  state.tier = 'recommended';
  assert.ok(visibleTools(state).every(item => item.tier === 'recommended'));
  state.tier = 'enhanced';
  assert.deepEqual(new Set(visibleTools(state).map(item => item.tier)), new Set(['recommended', 'enhanced']));
  const onboarding = createToolsPanel(new Set(), true);
  const text = plain(renderTools(onboarding, 100, 30));
  assert.match(text, /NMSh is complete out of the box\. No external shell tools are required\./u);
  assert.match(text, /Recommended \+ Enhanced/u);
  toolsKey(onboarding, {kind: 'down'}); toolsKey(onboarding, {kind: 'down'});
  assert.equal(toolsKey(onboarding, {kind: 'enter'}), 'finishOnboarding');
  assert.equal(onboarding.tier, 'enhanced');
  assert.equal(onboarding.task, undefined, 'choosing a tier installs nothing');
  assert.match(plain(renderTools(createToolsPanel(), 120, 30)), /NMSh is complete without them/u);
});

test('lifecycle metadata is curated, muted and suggests successors without switching', () => {
  const neofetch = WELCOME_PROVIDERS.find(item => item.id === 'neofetch')!;
  const macchina = WELCOME_PROVIDERS.find(item => item.id === 'macchina')!;
  assert.equal(providerLifecycle(neofetch), 'legacy');
  assert.equal(providerLifecycle(macchina), 'maintenance');
  assert.equal(providerLifecycle(tool('rg')), 'active');
  assert.equal(lifecycleNote(tool('rg')), undefined);
  assert.equal(lifecycleNote(neofetch), 'Legacy / archived · Fastfetch is the recommended maintained alternative.');
  assert.equal(lifecycleNote(macchina), 'Maintenance mode');
  assert.equal(toolInstall(tool('neofetch'), true), undefined, 'legacy tools are never installed');
  assert.match(toolInstallUnavailable(tool('neofetch'), true), /archived upstream/u);
  const state = createToolsPanel();
  for (const item of TOOLS) state.statuses[item.id] = {state: 'installed'};
  const list = plain(renderTools(state, 120, 60));
  assert.match(list, /Neofetch\s+.*Installed\s+Integrated · Welcome · Fastfetch recommended · Legacy/u);
  assert.match(list, /Macchina\s+.*Installed\s+Integrated · Welcome · Maintenance/u);
  state.detail = tool('neofetch');
  assert.match(plain(renderTools(state, 120, 40)), /Lifecycle\s+Legacy \/ archived · Fastfetch/u);
  // Rendering never discovers lifecycle over the network: it is static data.
  assert.ok(!TOOLS.some(item => 'lifecycleUrl' in item));
});

test('update checks are Off by default and never due when Off; Daily/Weekly are batched', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.toolUpdateChecks, 'off');
  assert.equal(normalizePromptConfiguration({}).toolUpdateChecks, 'off');
  assert.equal(normalizePromptConfiguration({toolUpdateChecks: 'hourly'}).toolUpdateChecks, 'off');
  assert.equal(normalizePromptConfiguration({toolUpdateChecks: 'weekly'}).toolUpdateChecks, 'weekly');
  assert.equal(toolUpdateCheckDue('off', {outdated: {}}), false);
  assert.equal(toolUpdateCheckDue('daily', {outdated: {}}, 1000), true);
  assert.equal(toolUpdateCheckDue('daily', {lastCheck: 0, outdated: {}}, 3_600_000), false);
  assert.equal(toolUpdateCheckDue('weekly', {lastCheck: 0, outdated: {}}, 8 * 86_400_000), true);
  assert.ok(SETTINGS_ROWS.some(row => row.id === 'toolUpdateChecks'));
});

test('brew outdated JSON is validated; one batched check is recorded and failures are factual', async () => {
  const json = JSON.stringify({formulae: [
    {name: 'ripgrep', installed_versions: ['14.0.0'], current_version: '14.1.1'},
    {name: 'bad name;rm', installed_versions: ['1'], current_version: '2'},
    {name: 'jq', installed_versions: ['\u001b[31m1.6'], current_version: '1.7'},
  ], casks: []});
  assert.deepEqual(parseBrewOutdated(json), {ripgrep: {installed: '14.0.0', current: '14.1.1'}});
  assert.deepEqual(parseBrewOutdated('not json'), {});
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-tool-updates-'));
  try {
    const path = join(directory, 'state.json');
    let calls = 0;
    const state = await runToolUpdateCheck({now: 5, path, check: async () => { calls++; return {ok: true, outdated: parseBrewOutdated(json)}; }});
    assert.equal(calls, 1);
    assert.deepEqual(loadToolUpdateState(path), state);
    const failed = await runToolUpdateCheck({now: 9, path, check: async () => ({ok: false, reason: 'Homebrew is not installed; NMSh does not guess other package managers.'})});
    assert.equal(failed.lastCheck, 9);
    assert.deepEqual(failed.outdated, state.outdated, 'a failed check keeps the last known result');
    assert.match(failed.error!, /does not guess/u);
    saveToolUpdateState({outdated: {'x': {installed: 'a', current: 'b'}}}, path);
    assert.deepEqual(loadToolUpdateState(path).outdated, {x: {installed: 'a', current: 'b'}});
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('no silent upgrade: Homebrew-owned tools preview brew upgrade; unknown owners get honest guidance', () => {
  const updates = {outdated: {ripgrep: {installed: '14.0.0', current: '14.1.1'}}};
  const realpath = (path: string) => path === '/opt/homebrew/bin/rg' ? '/opt/homebrew/Cellar/ripgrep/14.0.0/bin/rg' : path;
  assert.equal(toolOwner('/opt/homebrew/bin/rg', realpath), 'homebrew');
  assert.equal(toolOwner('/usr/bin/rg', realpath), 'unknown');
  assert.equal(toolOwner('/opt/homebrew/bin/rg-nocellar', p => p), 'unknown', 'a prefix alone is not ownership');
  assert.deepEqual(toolUpgrade(tool('rg'), 'homebrew', updates)?.args, ['upgrade', 'ripgrep']);
  assert.equal(toolUpgrade(tool('rg'), 'unknown', updates), undefined);
  assert.equal(toolUpgrade(tool('jq'), 'homebrew', updates), undefined, 'not outdated');
  const state = createToolsPanel();
  state.updates = updates;
  state.statuses.rg = {state: 'installed', binary: '/nonexistent/rg'};
  assert.ok(toolHasUpdate(state, tool('rg')));
  assert.match(plain(renderTools(state, 120, 40)), /ripgrep.*Update available/u);
  state.detail = tool('rg');
  assert.match(plain(renderTools(state, 120, 40)), new RegExp(`Update\\s+14\\.0\\.0 → 14\\.1\\.1 · ${UNKNOWN_OWNER_UPDATE.replace('.', '\\.')}`, 'u'));
  toolsKey(state, {kind: 'text', value: 'u'});
  assert.equal(state.confirm, undefined, 'unknown owner never gets an upgrade command');
  assert.match(state.message!, /does not guess its package manager/u);
  assert.equal(toolsKey(createToolsPanel(), {kind: 'text', value: 'U'}), 'checkUpdates', 'checks run only on an explicit key');
});

test('install suggestions: exact curated names only, aliases/functions/executables win, never fuzzy', () => {
  const config = {installSuggestions: true, ignoredInstallSuggestions: [] as string[]};
  for (const word of ['lazygit', 'gh', 'rg', 'fd', 'jq', 'eza', 'bat', 'zoxide', 'shellcheck', 'shfmt', 'just', 'hyperfine', 'watchexec', 'tldr', 'tv', 'carapace', 'dust', 'duf', 'procs', 'xh', 'jc', 'btop', 'glow', 'tokei']) {
    assert.equal(installCandidate(`${word} --help`, config)?.executable, word, word);
  }
  for (const command of ['lazygitt', 'LazyGit', 'ripgrep foo', 'node x', 'python3', 'docker ps', 'kubectl get', 'neofetch',
    './rg', 'FOO=1 rg x', '"rg"', '$rg', 'rg\nls', '', '   ', 'node', 'python3', 'go', 'docker', 'kubectl', 'neofetch']) {
    assert.equal(installCandidate(command, config), undefined, JSON.stringify(command));
  }
  assert.equal(suggestibleToolFor('r'), undefined);
  assert.equal(commandWord('  jq .a file'), 'jq');
  const lazygit = tool('lazygit');
  const recipe = {label: 'brew install lazygit', command: 'brew', args: ['install', 'lazygit']};
  assert.equal(shouldOfferInstall(lazygit, 'missing', false, recipe), true);
  for (const resolution of ['alias', 'function', 'builtin', 'executable', 'reserved', 'unknown', 'unavailable'] as const) {
    assert.equal(shouldOfferInstall(lazygit, resolution, false, recipe), false, resolution);
  }
  assert.equal(shouldOfferInstall(lazygit, 'missing', true, recipe), false, 'frontend PATH wins');
  assert.equal(shouldOfferInstall(lazygit, 'missing', false, undefined), false, 'unsupported package manager never guesses');
  assert.equal(installCandidate('lazygit', {installSuggestions: false, ignoredInstallSuggestions: []}), undefined, 'global off');
  assert.equal(installCandidate('lazygit', {installSuggestions: true, ignoredInstallSuggestions: ['lazygit']}), undefined, 'ignored tool');
  const base = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.deepEqual(ignoreInstallSuggestion(base, 'ignoreTool', lazygit).ignoredInstallSuggestions, ['lazygit']);
  assert.equal(ignoreInstallSuggestion(base, 'never', lazygit).installSuggestions, false);
  assert.deepEqual(normalizePromptConfiguration({ignoredInstallSuggestions: ['lazygit', 'lazygit', 'bad id;', 7]}).ignoredInstallSuggestions, ['lazygit']);
  assert.ok(SETTINGS_ROWS.some(row => row.id === 'resetInstallSuggestions' && row.control === 'action'));
});

test('install prompt: actions, Esc is Later, and no sudo/curl/scripts in any recipe', () => {
  const prompt = createInstallPrompt(tool('lazygit'), {label: 'brew install lazygit', command: 'brew', args: ['install', 'lazygit']}, 'lazygit');
  const text = plain(renderInstallPrompt(prompt, 100));
  assert.match(text, /`lazygit` is not installed\./u);
  assert.match(text, /Install lazygit now\?/u);
  assert.match(text, /Runs\s+brew install lazygit/u);
  for (const label of ['Install', 'Run anyway', 'Later', "Don't ask for lazygit", 'Never suggest installs']) assert.ok(text.includes(label), label);
  assert.equal(installPromptKey(prompt, {kind: 'escape'}), 'later');
  installPromptKey(prompt, {kind: 'right'});
  assert.equal(installPromptKey(prompt, {kind: 'enter'}), 'run');
  for (const width of [12, 40, 100]) assert.ok(renderInstallPrompt(prompt, width).every(row => displayWidth(row) <= width));
  for (const item of TOOLS) {
    const recipe = toolInstall(item, true, 'darwin');
    if (!recipe) continue;
    assert.equal(recipe.command, 'brew');
    assert.deepEqual(recipe.args.slice(0, 1), ['install']);
    assert.ok(!/sudo|curl|\|/u.test(recipe.label));
  }
});

test('app: a missing curated command shows the offer, keeps the composer text and Run anyway submits it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-install-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['startupPending'] = false;
    const submitted: string[] = [];
    app['session'].submit = (command: string) => { submitted.push(command); };
    app['installProbe'] = {onPath: () => false, recipe: () => ({label: 'brew install lazygit', command: 'brew', args: ['install', 'lazygit']})};
    app['semanticService'].resolveSource = async () => ({kind: 'missing'});
    app['editor'].insert('lazygit');
    await app['submit']();
    assert.ok(app['installPrompt'], 'offer shown');
    assert.equal(app['editor'].text, 'lazygit', 'composer text preserved');
    assert.deepEqual(submitted, [], 'nothing ran');
    await app['handleInstallPromptKey']({kind: 'escape'}, app['installPrompt']!);
    assert.equal(app['installPrompt'], undefined);
    assert.equal(app['editor'].text, 'lazygit');
    // An alias/function/executable in the real zsh wins: no offer, the command runs.
    app['semanticService'].resolveSource = async () => ({kind: 'alias', aliasTarget: 'git'});
    await app['submit']();
    assert.equal(app['installPrompt'], undefined);
    assert.deepEqual(submitted, ['lazygit']);
    // Don't ask again is stored safely and respected.
    app['semanticService'].resolveSource = async () => ({kind: 'missing'});
    app['running'] = undefined;
    app['editor'].insert('lazygit');
    await app['submit']();
    const state = app['installPrompt']!;
    state.selected = 3;
    await app['handleInstallPromptKey']({kind: 'enter'}, state);
    const saved = JSON.parse(await readFile(join(directory, 'nmsh', 'config.json'), 'utf8'));
    assert.deepEqual(saved.ignoredInstallSuggestions, ['lazygit']);
    assert.equal(app['editor'].text, 'lazygit');
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
});

test('command source: builtin, alias, function, executable path, slash command; zsh stays authoritative', () => {
  assert.deepEqual(parseCommandSource('source\talias\teza\t/opt/homebrew/bin/eza'), {kind: 'alias', aliasTarget: 'eza', path: '/opt/homebrew/bin/eza'});
  assert.deepEqual(parseCommandSource('source\tcommand\t\t/bin/ls'), {kind: 'executable', path: '/bin/ls'});
  assert.deepEqual(parseCommandSource('source\tnone\t\t'), {kind: 'missing'});
  assert.deepEqual(parseCommandSource('source\tnone\t\t', 'function'), {kind: 'function'}, 'live-session names win');
  assert.deepEqual(parseCommandSource('source\tcommand\t\t/bin/\u001b]x'), {kind: 'executable'}, 'unsafe paths dropped');
  assert.equal(parseCommandSource('nonsense'), undefined);
  assert.match(describeCommandSource('ls', {kind: 'alias', aliasTarget: 'eza', path: '/opt/homebrew/bin/eza'}),
    /^alias → eza · \/opt\/homebrew\/bin\/eza · optional external tool \(eza\)/u);
  assert.equal(describeCommandSource('ls', {kind: 'executable', path: '/bin/ls'}), 'executable · /bin/ls');
  assert.match(describeCommandSource('cd', {kind: 'builtin', path: '/usr/bin/cd'}), /^zsh builtin/u);
  assert.match(describeCommandSource('gs', {kind: 'function'}), /^shell function/u);
  assert.match(describeCommandSource('rg', {kind: 'executable', path: '/opt/homebrew/bin/rg'}), /optional external tool \(ripgrep\)/u);
  assert.match(describeCommandSource('zoxide', {kind: 'executable', path: '/x/zoxide'}), /optional external navigation provider/u);
  assert.match(describeCommandSource('nope', {kind: 'missing'}), /not found in your zsh/u);
  assert.doesNotMatch(describeCommandSource('ls', {kind: 'executable', path: '/bin/ls'}), /Native/u);
  assert.match(describeSlashCommand('/setup tools')!, /^NMSh slash command/u);
  assert.equal(describeSlashCommand('/nonexistent'), undefined);
  const rows = renderInspector({value: 'ls', kind: 'command', description: 'd', start: 0, end: 2, command: 'ls', source: 'context'}, 80, 'executable · /bin/ls');
  assert.equal(rows.at(-1), 'Source: executable · /bin/ls');
  assert.deepEqual(parseCompletionFacts('facts\t1\t0\t1'), {zshCompletions: true, fzfTab: false, completionSystem: true});
});

test('configured completion: explanations become groups, duplicated -d prefixes are stripped, internal groups hidden', () => {
  assert.equal(describeOnly('checkout  -- checkout a branch', 'checkout'), 'checkout a branch');
  assert.equal(describeOnly('--color  -- use color', '--color'), 'use color');
  assert.equal(describeOnly('master', 'master'), '');
  assert.equal(describeOnly('plain description', 'x'), 'plain description');
  const record = (value: string, display: string, group: string, kind = 'argument') => [value, display, display, group, '', '', kind].join('\0') + '\0';
  const sub = parseConfiguredCompletions(record('checkout', 'checkout  -- switch branches', 'common commands'), {buffer: 'git ch', cwd: '/'});
  assert.equal(sub[0]?.kind, 'subcommand');
  assert.equal(sub[0]?.description, 'switch branches');
  assert.equal(sub[0]?.group, 'common commands');
  const command = parseConfiguredCompletions(record('git', 'git', 'external command'), {buffer: 'gi', cwd: '/'});
  assert.equal(command[0]?.identity, 'executable');
  const internal = parseConfiguredCompletions(record('x', 'x', '-default-'), {buffer: 'a x', cwd: '/'});
  assert.equal(internal[0]?.group, '');
});

test('tools and inspector stay plain under NO_COLOR and Safe glyphs', () => {
  const old = process.env.NO_COLOR;
  process.env.NO_COLOR = '1'; setIconStyle('safe');
  try {
    const state = createToolsPanel();
    state.updates = {outdated: {ripgrep: {installed: '1', current: '2'}}};
    state.statuses.rg = {state: 'installed'};
    for (const width of [20, 60, 100]) assert.ok(renderTools(state, width, 30).every(row => displayWidth(row) <= width && !/\u001b\[(?:38|48);/u.test(row)));
  } finally { if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = old; setIconStyle('nerd'); }
});
