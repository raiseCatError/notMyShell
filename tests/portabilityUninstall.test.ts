import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration, normalizePromptConfiguration, savePromptConfiguration} from '../src/prompt/configuration.js';
import {exportSettings, formatImportPlan, NEVER_EXPORTED, parseCategories, parsePortableDocument, planImport, PORTABLE_VERSION} from '../src/configuration/portability.js';
import {runConfigCommand} from '../src/cli/configCommand.js';
import {InstallProvenance, planToolUninstall} from '../src/tools/InstallProvenance.js';
import {applyUninstall, findOwnedLinks, planUninstall} from '../src/cli/uninstall.js';
import {runUninstallCommand} from '../src/cli/uninstallCommand.js';
import {createToolsPanel, confirmToolInstall, toolsKey} from '../src/tools/ToolsPanel.js';
import {TOOLS} from '../src/tools/catalog.js';
import {detectShellEnvironment, type EnvironmentProbe} from '../src/shell/ShellEnvironment.js';
import {detectPlatform, detectWsl, isWindowsMount, type PlatformProbe} from '../src/host/platform.js';

function scratch(prefix = 'nmsh-port-'): string { return realpathSync(mkdtempSync(join(tmpdir(), prefix))); }
const io = () => { const out: string[] = []; const err: string[] = []; return {out, err, io: {out: (t: string) => out.push(t), err: (t: string) => err.push(t)}}; };

test('export: categories only, versioned, never onboarding state or machine paths', () => {
  const config = normalizePromptConfiguration({onboardingComplete: true, starship: {configPath: '/Users/me/secret/starship.toml'}, nmsh: {palette: 'dracula'}});
  const document = exportSettings(config, ['theme', 'prompt'], {version: '0.7.0', now: new Date(0)});
  assert.equal(document.format, 'nmsh-settings');
  assert.equal(document.version, PORTABLE_VERSION);
  assert.deepEqual(Object.keys(document.categories), ['theme', 'prompt']);
  assert.equal(document.categories.theme!['nmsh.palette'], 'dracula');
  const text = JSON.stringify(exportSettings(config));
  for (const key of NEVER_EXPORTED) assert.ok(!text.includes(`"${key}"`), `${key} is never exported`);
  assert.ok(!text.includes('/Users/me'), 'no absolute host paths');
  assert.throws(() => parseCategories('theme,bogus'), /Unknown setting category: bogus/u);
});

test('import: preview, partial categories, invalid values rejected, unknown fields ignored, newer versions refused', () => {
  const current = normalizePromptConfiguration({});
  const source = exportSettings(normalizePromptConfiguration({nmsh: {palette: 'nord'}, composerPosition: 'top', sessionNotices: false}));
  const partial = planImport(current, source, ['theme']);
  assert.deepEqual(partial.changes.map(change => change.path), ['nmsh.palette']);
  assert.equal(partial.next.composerPosition, 'bottom', 'unselected categories are untouched');
  const full = planImport(current, source);
  assert.ok(full.changes.some(change => change.path === 'composerPosition'));
  assert.ok(full.changes.some(change => change.path === 'sessionNotices'));

  const hostile = parsePortableDocument(JSON.stringify({format: 'nmsh-settings', version: 1, categories: {
    theme: {'nmsh.palette': 'not-a-theme', 'nmsh.vibrance': 'vibrant', onboardingComplete: true}, future: {x: 1}, layout: {composerPosition: 'sideways'}}}));
  const plan = planImport(normalizePromptConfiguration({provider: 'starship'}), hostile);
  assert.deepEqual(plan.rejected.map(item => item.path).sort(), ['composerPosition', 'nmsh.palette']);
  assert.equal(plan.next.nmsh.palette, 'lavender', 'an invalid value never silently becomes something else');
  assert.ok(plan.ignored.includes('category future') && plan.ignored.includes('theme.onboardingComplete'));
  assert.equal(plan.next.onboardingComplete, false);
  assert.match(formatImportPlan(plan), /rejected\s+nmsh.palette/u);
  assert.throws(() => parsePortableDocument(JSON.stringify({format: 'nmsh-settings', version: 99, categories: {}})), /v99.*Update NMSh/u);
  assert.throws(() => parsePortableDocument('{"format":"other","version":1,"categories":{}}'), /not an NMSh settings export/u);
});

test('CLI: export to file, import previews and needs consent, applies atomically and preserves unrelated keys', async () => {
  const home = scratch();
  try {
    const env = {...process.env, XDG_CONFIG_HOME: join(home, 'config'), HOME: home};
    const configPath = join(home, 'config', 'nmsh', 'config.json');
    mkdirSync(join(home, 'config', 'nmsh'), {recursive: true});
    writeFileSync(configPath, JSON.stringify({...DEFAULT_PROMPT_CONFIGURATION, nmsh: {...DEFAULT_PROMPT_CONFIGURATION.nmsh, palette: 'nord'}, futureKey: 'kept'}));
    const exportFile = join(home, 'out.json');
    const first = io();
    assert.equal(await runConfigCommand(['export', '--categories', 'theme', '--output', exportFile], {...first.io, env}), 0);
    assert.equal(lstatSync(exportFile).mode & 0o077, 0, 'export file is private');
    assert.equal(await runConfigCommand(['export', '--output', exportFile], {...io().io, env}), 1, 'no silent overwrite');

    savePromptConfiguration(normalizePromptConfiguration({...loadPromptConfiguration(configPath), nmsh: {palette: 'dracula'}}), configPath, loadPromptConfiguration(configPath));
    const noConsent = io();
    assert.equal(await runConfigCommand(['import', exportFile], {...noConsent.io, env}), 2);
    assert.match(noConsent.out.join(''), /nmsh\.palette: "dracula" -> "nord"/u);
    assert.equal(loadPromptConfiguration(configPath).nmsh.palette, 'dracula', 'preview alone changes nothing');
    assert.equal(await runConfigCommand(['import', exportFile], {...io().io, env, confirm: async () => false}), 1);
    assert.equal(await runConfigCommand(['import', exportFile], {...io().io, env, confirm: async () => true}), 0);
    assert.equal(loadPromptConfiguration(configPath).nmsh.palette, 'nord');
    assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).futureKey, 'kept', 'unknown keys from a newer NMSh survive');
  } finally { rmSync(home, {recursive: true, force: true}); }
});

test('tool uninstall: only recorded installs are offered plainly; Homebrew-owned needs two fresh confirmations; unknown is manual', async () => {
  const home = scratch();
  try {
    const provenance = new InstallProvenance(join(home, 'tool-installs.json'));
    const jq = TOOLS.find(tool => tool.id === 'jq')!;
    assert.equal(planToolUninstall(jq, undefined, 'unknown').kind, 'manual');
    assert.match((planToolUninstall(jq, undefined, 'unknown') as {provenance: string}).provenance, /did not install jq/u);
    const external = planToolUninstall(jq, undefined, 'homebrew');
    assert.equal(external.kind, 'external-homebrew');
    provenance.record(jq, {label: 'brew install jq', command: 'brew', args: ['install', 'jq']}, new Date('2026-01-02T00:00:00Z'));
    const recorded = planToolUninstall(jq, provenance.find('jq'), 'unknown');
    assert.deepEqual(recorded.kind === 'recorded' && [recorded.command, recorded.args], ['brew', ['uninstall', 'jq']]);
    assert.match((recorded as {provenance: string}).provenance, /Installed by NMSh on 2026-01-02/u);
    assert.equal(planToolUninstall(jq, {...provenance.find('jq')!, package: 'jq; rm -rf ~'}, 'unknown').kind, 'manual', 'no interpolation-shaped package names');

    // Panel flow: starts on No, and an external Homebrew removal needs a second fresh confirmation.
    const state = createToolsPanel();
    state.provenance = new InstallProvenance(join(home, 'none.json'));
    state.detail = jq;
    state.statuses.jq = {state: 'installed', binary: '/nonexistent/jq'} as never;
    toolsKey(state, {kind: 'text', value: 'x'});
    assert.equal(state.confirm, undefined, 'unknown provenance offers no command');
    assert.match(state.message ?? '', /will not remove it/u);

    state.provenance = provenance;
    state.message = undefined;
    toolsKey(state, {kind: 'text', value: 'x'});
    assert.equal(state.confirm?.choice, 'no', 'confirmation starts on No');
    const ran: string[][] = [];
    await confirmToolInstall(state, {kind: 'enter'}, () => {}, async (task, recipe) => { ran.push([recipe.command, ...recipe.args]); });
    assert.deepEqual(ran, [], 'Enter on No cancels');
  } finally { rmSync(home, {recursive: true, force: true}); }
});

test('self-uninstall in a temp home: removes only links into this installation, keeps data by default, never the checkout', async () => {
  const sandbox = scratch('nmsh-uninst-');
  try {
    const root = join(sandbox, 'checkout'); mkdirSync(join(root, 'bin'), {recursive: true}); mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'bin', 'nmsh'), '#!/usr/bin/env node\n');
    const prefix = join(sandbox, 'prefix'); mkdirSync(join(prefix, 'bin'), {recursive: true}); mkdirSync(join(prefix, 'lib', 'node_modules'), {recursive: true});
    symlinkSync(join(root, 'bin', 'nmsh'), join(prefix, 'bin', 'nmsh'));
    symlinkSync(root, join(prefix, 'lib', 'node_modules', 'nmsh'));
    const other = join(sandbox, 'other-bin'); mkdirSync(other);
    symlinkSync('/usr/bin/env', join(other, 'nmsh')); // someone else's nmsh: never touched
    const realFile = join(sandbox, 'real-bin'); mkdirSync(realFile); writeFileSync(join(realFile, 'nmsh'), 'not a link');
    const home = join(sandbox, 'home'); mkdirSync(join(home, '.config', 'nmsh'), {recursive: true});
    writeFileSync(join(home, '.config', 'nmsh', 'config.json'), '{}');
    writeFileSync(join(home, '.zshrc'), 'echo untouched\n');
    const env = {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: [join(prefix, 'bin'), other, realFile].join(':'), NMSH_RUNTIME_DIR: join(sandbox, 'rt')};
    assert.deepEqual(findOwnedLinks(root, env, prefix), [join(prefix, 'bin', 'nmsh'), join(prefix, 'lib', 'node_modules', 'nmsh')].sort());

    const dry = io();
    assert.equal(await runUninstallCommand(['--dry-run'], {...dry.io, env, root, npmPrefix: prefix}), 0);
    assert.match(dry.out.join(''), /Will remove[\s\S]*prefix\/bin\/nmsh[\s\S]*Kept \(your NMSh data/u);
    assert.ok(existsSync(join(prefix, 'bin', 'nmsh')), 'dry run removes nothing');

    assert.equal(await runUninstallCommand([], {...io().io, env, root, npmPrefix: prefix, confirm: async () => false}), 1);
    const done = io();
    assert.equal(await runUninstallCommand([], {...done.io, env, root, npmPrefix: prefix, confirm: async () => true}), 0);
    assert.match(done.out.join(''), /NMSh is uninstalled\. Your shell is exactly as you left it\./u);
    assert.ok(!existsSync(join(prefix, 'bin', 'nmsh')) && !existsSync(join(prefix, 'lib', 'node_modules', 'nmsh')));
    assert.ok(existsSync(join(other, 'nmsh')) || lstatSync(join(other, 'nmsh')).isSymbolicLink(), 'unrelated nmsh link kept');
    assert.ok(existsSync(join(realFile, 'nmsh')), 'regular files are never removed');
    assert.ok(existsSync(join(root, 'bin', 'nmsh')), 'the checkout itself stays');
    assert.ok(existsSync(join(home, '.config', 'nmsh', 'config.json')), 'data kept by default');
    assert.equal(readFileSync(join(home, '.zshrc'), 'utf8'), 'echo untouched\n');

    const plan = planUninstall({root, env});
    const deleted = applyUninstall(plan, {deleteData: true, env});
    assert.ok(deleted.removed.includes(join(home, '.config', 'nmsh')));
    assert.ok(!existsSync(join(home, '.config', 'nmsh')));
  } finally { rmSync(sandbox, {recursive: true, force: true}); }
});

test('self-uninstall refuses while live sessions run', async () => {
  const sandbox = scratch('nmsh-uninst-');
  try {
    const rt = join(sandbox, 'rt'); mkdirSync(rt); writeFileSync(join(rt, 'nmshd-v2.sock'), '');
    const root = join(sandbox, 'r'); mkdirSync(join(root, 'bin'), {recursive: true});
    const bin = join(sandbox, 'bin'); mkdirSync(bin); symlinkSync(join(root, 'bin'), join(bin, 'nmsh'));
    const result = io();
    assert.equal(await runUninstallCommand(['--yes'], {...result.io, env: {HOME: sandbox, PATH: bin, NMSH_RUNTIME_DIR: rt}, root, npmPrefix: null}), 1);
    assert.match(result.err.join(''), /live-session service is running/u);
    assert.ok(lstatSync(join(bin, 'nmsh')).isSymbolicLink());
  } finally { rmSync(sandbox, {recursive: true, force: true}); }
});

function probe(files: Record<string, string>, env: NodeJS.ProcessEnv = {}): EnvironmentProbe {
  return {home: '/h', env: {HOME: '/h', ...env}, exists: path => path in files, read: path => files[path]};
}

test('shell environment: detection from evidence only, no false positives on comments or substrings', () => {
  const report = detectShellEnvironment(probe({
    '/h/.zshrc': 'export ZSH="$HOME/.oh-my-zsh"\nplugins=(git zsh-autosuggestions fzf-tab)\nsource $ZSH/oh-my-zsh.sh\nsource ${ZDOTDIR:-~}/.antidote/antidote.zsh\nantidote load\n',
    '/h/.zsh_plugins.txt': 'zsh-users/zsh-completions\nzdharma-continuum/fast-syntax-highlighting\n',
  }));
  assert.deepEqual(report.environments.map(item => item.id).sort(), ['antidote', 'oh-my-zsh']);
  assert.deepEqual(report.plugins.map(item => item.id).sort(), ['fast-syntax-highlighting', 'fzf-tab', 'zsh-autosuggestions', 'zsh-completions']);
  assert.equal(report.plugins.find(item => item.id === 'zsh-completions')!.relation, 'compatible');
  assert.match(report.plugins.find(item => item.id === 'fzf-tab')!.note, /one completion menu/u);

  const quiet = detectShellEnvironment(probe({'/h/.zshrc': '# source $ZSH/oh-my-zsh.sh\n# zinit light foo\necho my-zsh-autosuggestions-fork-notes\nalias zinitx=1\n'}));
  assert.deepEqual(quiet, {environments: [], plugins: []}, 'comments and lookalikes are not evidence');
  const fish = detectShellEnvironment(probe({'/h/.config/fish/functions/fisher.fish': ''}));
  assert.deepEqual(fish.environments.map(item => item.id), ['fisher']);
});

const platformProbe = (release: string, env: NodeJS.ProcessEnv = {}, files: Record<string, string> = {}, platform: NodeJS.Platform = 'linux'): PlatformProbe =>
  ({platform, release, env, read: path => files[path]});

test('platform: WSL 2 is the supported Windows path; WSL 1 is reported, not claimed; native Windows refused', () => {
  const wsl2 = detectPlatform(platformProbe('6.6.87.2-microsoft-standard-WSL2', {WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop'}));
  assert.equal(wsl2.wsl?.version, 2);
  assert.equal(wsl2.wsl?.distro, 'Ubuntu');
  assert.match(wsl2.support, /WSL 2 \(Ubuntu\): the supported Windows path; physical validation is pending/u);
  const wsl1 = detectPlatform(platformProbe('4.4.0-19041-Microsoft', {WSL_DISTRO_NAME: 'Debian'}, {'/proc/version': 'Linux version 4.4.0-19041-Microsoft'}));
  assert.equal(wsl1.wsl?.version, 1);
  assert.match(wsl1.support, /WSL 1 \(Debian\) detected: not supported/u);
  assert.equal(detectWsl(platformProbe('6.8.0-45-generic')), undefined, 'plain Linux is not WSL');
  assert.match(detectPlatform(platformProbe('6.8.0-45-generic')).support, /physical terminal validation is pending/u);
  assert.match(detectPlatform(platformProbe('10.0', {}, {}, 'win32')).support, /Native Windows is not supported.*WSL 2/u);
  assert.equal(detectWsl(platformProbe('5.15.0', {WSL_DISTRO_NAME: 'Arch'}))?.version, 'unknown');
  assert.equal(isWindowsMount('/mnt/c/Users/me', wsl2.wsl), true);
  assert.equal(isWindowsMount('/home/me', wsl2.wsl), false);
  assert.equal(isWindowsMount('/mnt/c/x', undefined), false);
});
