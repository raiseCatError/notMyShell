import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS, suggestibleToolFor, toolInstall} from '../src/tools/catalog.js';
import {confirmToolInstall, createToolsPanel, renderTools, toolBadges, toolStatusLine, toolsKey, visibleTools} from '../src/tools/ToolsPanel.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {TaskProgress, taskProgressBar} from '../src/status/TaskProgress.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {background, UI_COLORS} from '../src/ui/palette.js';
import {discoverLocalExecutables, invalidateLocalDiscovery} from '../src/tools/localDiscovery.js';
import {promoteLocalExecutables} from '../src/tools/catalog.js';
import {mkdtemp, mkdir, chmod, rm, writeFile, existsSync} from 'node:fs';
import {mkdtemp, mkdir, chmod, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('offline catalog, truthful filters and curated argv recipes do not execute discovery', () => {
  assert.equal(new Set(TOOLS.map(tool => tool.id)).size, TOOLS.length);
  assert.deepEqual(TOOLS.filter(tool => tool.recommended).map(tool => tool.id).sort(), ['fastfetch', 'fd', 'fzf', 'jq', 'rg', 'tealdeer', 'zoxide']);
  const state = createToolsPanel(new Set(['fzf']));
  state.statuses.fzf = {state: 'installed', version: 'stub 1'};
  state.statuses.fd = {state: 'missing'};
  state.query = 'files';
  assert.ok(visibleTools(state).every(tool => tool.category === 'Search & Files'));
  assert.ok(visibleTools(state).findIndex(tool => tool.id === 'fzf') > visibleTools(state).findIndex(tool => tool.id === 'fd'));
  state.query = ''; state.tab = 'installed';
  assert.deepEqual(visibleTools(state).map(tool => tool.id), ['fzf']);
  state.tab = 'configure';
  assert.deepEqual(visibleTools(state).map(tool => tool.id), ['starship', 'tmux'], 'Configure lists only tools with a registered adapter');
  assert.equal(toolInstall(TOOLS[0]!, false), undefined);
  assert.deepEqual(toolInstall(TOOLS[0]!, true)?.args, ['install', 'ripgrep']);
  assert.deepEqual(parseSlashCommand('/tools'), {kind: 'tools'});
});

test('bounded local discovery uses direct PATH entries, recognized plugins, stable identity, and cache invalidation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nmsh-local-discovery-'));
  const bin = join(root, 'bin'); const nested = join(bin, 'nested'); const home = join(root, 'home');
  try {
    await mkdir(bin); await mkdir(nested); await mkdir(join(home, '.docker', 'cli-plugins'), {recursive: true});
    const executable = async (path: string, text = '#!/bin/sh\nexit 0\n') => { await writeFile(path, text); await chmod(path, 0o755); };
    const executionSentinel = join(root, 'executed');
    const ghExtensionDirectory = join(home, '.local', 'share', 'gh', 'extensions', 'gh-review');
    await mkdir(ghExtensionDirectory, {recursive: true});
    await executable(join(bin, 'unlisted-cli'));
    await executable(join(bin, 'git-town'));
    await executable(join(bin, 'kubectl-foo'));
    await executable(join(bin, 'no-run'), `#!/bin/sh\ntouch '${executionSentinel}'\n`);
    await executable(join(nested, 'hidden-cli'));
    await executable(join(home, '.docker', 'cli-plugins', 'docker-buildx'));
    await executable(join(ghExtensionDirectory, 'gh-review'));
    const first = await discoverLocalExecutables(`${bin}${process.platform === 'win32' ? ';' : ':'}${join(root, 'missing')}`, home);
    assert.deepEqual(first.executables.map(item => item.id), ['docker-plugin:docker-buildx', 'executable:no-run', 'executable:unlisted-cli', 'gh-extension:gh-review', 'git-plugin:git-town', 'kubectl-plugin:kubectl-foo']);
    assert.ok(!existsSync(executionSentinel), 'discovered binaries are never executed');
    assert.ok(!first.executables.some(item => item.name === 'hidden-cli'), 'no recursive traversal');
    assert.equal(first.measurements.directoriesRead >= 3, true, 'only requested PATH and known plugin directories were enumerated');
    assert.equal(first.measurements.entriesInspected >= 7, true);
    assert.equal(first.executables.find(item => item.name === 'git-town')?.evidence.includes('git-* executable'), true);
    assert.equal((await discoverLocalExecutables(`${bin}${process.platform === 'win32' ? ';' : ':'}${join(root, 'missing')}`, home)), first, 'warm snapshot reused');
    await executable(join(bin, 'new-tool'));
    assert.equal((await discoverLocalExecutables(`${bin}${process.platform === 'win32' ? ';' : ':'}${join(root, 'missing')}`, home)), first, 'cached until explicit invalidation');
    invalidateLocalDiscovery();
    const refreshed = await discoverLocalExecutables(`${bin}${process.platform === 'win32' ? ';' : ':'}${join(root, 'missing')}`, home);
    assert.ok(refreshed.executables.some(item => item.name === 'new-tool'));
    assert.deepEqual(refreshed.executables.map(item => item.id), [...refreshed.executables.map(item => item.id)].sort());
    assert.equal(new Set(refreshed.executables.map(item => item.id)).size, refreshed.executables.length);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('local detections promote into curated metadata without duplicate rows; unknown results stay local', () => {
  const local = [
    {id: 'executable:rg', name: 'rg', path: '/bin/rg', family: 'path' as const, evidence: 'PATH'},
    {id: 'executable:custom-cli', name: 'custom-cli', path: '/opt/bin/custom-cli', family: 'path' as const, evidence: 'PATH'},
  ];
  const merged = promoteLocalExecutables(local);
  assert.equal(merged.curated.find(item => item.id === 'rg')?.localDetection?.path, '/bin/rg');
  assert.deepEqual(merged.local.map(item => item.id), ['executable:custom-cli']);
  const state = createToolsPanel(); state.localExecutables = local; state.query = 'custom-cli'; state.tab = 'local';
  assert.deepEqual(visibleTools(state).map(item => item.id), ['executable:custom-cli']);
  state.detail = visibleTools(state)[0];
  assert.equal(toolStatusLine(state, state.detail!), 'Local detected');
  assert.doesNotMatch(renderTools(state, 100, 24).map(stripAnsi).join('\n'), /Install…|Uninstall…/u);
  state.tab = 'discover'; state.query = 'ripgrep'; state.localExecutables = [];
  assert.deepEqual(visibleTools(state).map(item => item.id), ['rg']);
  state.localExecutables = local; state.query = 'custom-cli';
  assert.deepEqual(visibleTools(state).map(item => item.id), ['executable:custom-cli'], 'Discover search includes unknown local results');
  state.tab = 'local'; state.query = 'ripgrep';
  assert.deepEqual(visibleTools(state).map(item => item.id), ['rg'], 'Local search includes curated matches');
});

test('curated developer tools use verified Homebrew package and executable names', () => {
  const additions = ['shellcheck', 'shfmt', 'just', 'hyperfine', 'watchexec', 'dust', 'duf', 'procs', 'xh', 'jc', 'btop', 'glow', 'tokei'];
  for (const name of additions) {
    const item = TOOLS.find(tool => tool.id === name)!;
    assert.ok(item, name);
    assert.equal(item.executable, name, `${name} executable`);
    assert.equal(item.package, name, `${name} formula`);
    assert.equal(toolInstall(item, true)?.label, `brew install ${name}`, `${name} recipe`);
    assert.equal(suggestibleToolFor(name), item, `${name} exact suggestion`);
  }
  assert.equal(TOOLS.find(tool => tool.id === 'delta')?.package, 'git-delta');
  assert.equal(TOOLS.find(tool => tool.id === 'kubectl')?.package, 'kubernetes-cli');
});

test('badges separate provider integration, recommendation tier, lifecycle and environment facts', () => {
  const state = createToolsPanel();
  assert.deepEqual(toolBadges(state, TOOLS.find(tool => tool.id === 'fzf')!), ['Recommended']);
  assert.deepEqual(toolBadges(state, TOOLS.find(tool => tool.id === 'fastfetch')!), ['Integrated · Welcome', 'Recommended']);
  assert.deepEqual(toolBadges(state, TOOLS.find(tool => tool.id === 'shellcheck')!), ['Enhanced']);
  assert.deepEqual(toolBadges(state, TOOLS.find(tool => tool.id === 'node')!), ['Detected environment']);
  assert.deepEqual(toolBadges(state, TOOLS.find(tool => tool.id === 'neofetch')!), ['Integrated · Welcome', 'Fastfetch recommended', 'Legacy']);
  assert.ok(toolBadges(state, TOOLS.find(tool => tool.id === 'macchina')!).includes('Maintenance'));
});

test('install needs a new confirmation; default cancel and failure preserve settings', async () => {
  const state = createToolsPanel();
  const tool = TOOLS[0]!;
  state.detail = tool; state.statuses[tool.id] = {state: 'missing'};
  state.recipe = toolInstall(tool, true); state.confirm = {choice: 'no'};
  let runs = 0;
  const run = async (task: TaskProgress) => { runs++; task.markFailure('Exit 3'); };
  await confirmToolInstall(state, {kind: 'enter'}, () => {}, run);
  assert.equal(runs, 0);
  state.recipe = toolInstall(tool, true); state.confirm = {choice: 'no'};
  await confirmToolInstall(state, {kind: 'right'}, () => {}, run);
  assert.equal(runs, 0);
  await confirmToolInstall(state, {kind: 'enter'}, () => {}, run);
  assert.equal(runs, 1);
  assert.match(state.errors[tool.id]!, /Exit 3/u);
  assert.equal(state.configured.size, 0);
  state.tab = 'errors'; state.detail = undefined;
  assert.equal(visibleTools(state)[0]?.id, tool.id);
});

test('onboarding defaults to Skip; recommendations only browse; legacy config stays complete', () => {
  const state = createToolsPanel(new Set(), true);
  assert.equal(state.onboarding, 3);
  assert.equal(toolsKey(state, {kind: 'enter'}), 'close');
  const recommended = createToolsPanel(new Set(), true);
  toolsKey(recommended, {kind: 'down'});
  assert.equal(recommended.onboarding, 0, 'wraps from Skip to Recommended');
  assert.equal(toolsKey(recommended, {kind: 'enter'}), 'finishOnboarding');
  assert.ok(visibleTools(recommended).every(tool => tool.recommended));
  assert.equal(recommended.task, undefined);
  assert.equal(normalizePromptConfiguration({onboardingComplete: true}).toolsSetupComplete, true);
  assert.equal(normalizePromptConfiguration({}).toolsSetupComplete, false);
});

test('keyboard browse, configured state, error empty state and language identity survive narrow/plain paths', () => {
  const state = createToolsPanel(new Set(['fzf']));
  toolsKey(state, {kind: 'text', value: 'fzf'});
  toolsKey(state, {kind: 'enter'});
  state.statuses.fzf = {state: 'installed', version: '\u001b]0;unsafe\u0007v1'};
  assert.match(renderTools(state, 120, 24).map(stripAnsi).join('\n'), /Configured in NMSh/u);
  toolsKey(state, {kind: 'escape'});
  toolsKey(state, {kind: 'escape'});
  toolsKey(state, {kind: 'right'});
  assert.equal(state.tab, 'installed');
  state.tab = 'errors';
  assert.match(renderTools(state, 80, 24).map(stripAnsi).join('\n'), /No tool problems detected/u);
  const old = process.env.NO_COLOR;
  process.env.NO_COLOR = '1'; setIconStyle('safe');
  try {
    state.detail = TOOLS.find(tool => tool.id === 'python3');
    for (const width of [1, 12, 30, 80]) {
      const rows = renderTools(state, width, 20);
      assert.ok(rows.every(row => displayWidth(row) <= width));
      assert.ok(rows.every(row => !/\u001b\[(?:38|48);/u.test(row)));
    }
  } finally { if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = old; setIconStyle('nerd'); }
});

test('task timeout/cancellation settle and reduced-motion progress stays still', async () => {
  const task = new TaskProgress('bounded', () => {});
  const result = await task.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 30);
  assert.equal(result.error, 'Timed out');
  const cancelled = new TaskProgress('cancelled', () => {});
  const pending = cancelled.run(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  cancelled.dispose();
  assert.equal((await pending).error, 'Cancelled');
  const old = process.env.NMSH_REDUCED_MOTION;
  process.env.NMSH_REDUCED_MOTION = '1';
  try { assert.equal(taskProgressBar(task.state, 1000), taskProgressBar(task.state, 1500)); }
  finally { if (old === undefined) delete process.env.NMSH_REDUCED_MOTION; else process.env.NMSH_REDUCED_MOTION = old; }
});

test('Tools v2: Discover groups by category with aligned status columns, a selection band and the selected description', () => {
  const state = createToolsPanel(new Set(['fzf']));
  state.contexts = []; // independent of the directory the tests run in
  for (const tool of TOOLS) state.statuses[tool.id] = tool.id === 'lazygit' ? {state: 'missing'} : {state: 'installed'};
  const rows = renderTools(state, 100, 40);
  const plain = rows.map(stripAnsi);
  const header = plain.findIndex(row => row.trim() === 'Search & Files');
  assert.ok(header > 0, 'category header');
  assert.ok(plain.some(row => row.trim() === 'Git & Development'));
  const ripgrep = plain.find(row => row.includes('ripgrep'))!;
  const fd = plain.find(row => /\bfd\b/u.test(row) && row.includes('Installed'))!;
  assert.equal(ripgrep.indexOf('Installed'), fd.indexOf('Installed'), 'status column aligned');
  assert.match(ripgrep, /Installed\s+Recommended/u);
  assert.ok(!plain.some(row => / \/ Installed/u.test(row)), 'no slash-separated prose');
  const first = visibleTools(state)[0]!;
  const selected = rows.find(row => stripAnsi(row).includes('›') && stripAnsi(row).includes(first.label))!;
  assert.ok(/\u001b\[48;|\u001b\[7m/u.test(selected), 'selected row has a background band or reverse-video fallback');
  assert.ok(plain.some(row => row.trim() === first.description), 'muted description of the selection');
  assert.match(plain.at(-1)!, /↑↓ select · Tab\/←→ tabs · Space select · Enter details/u);
  const lazygit = plain.find(row => row.includes('lazygit'))!;
  assert.match(lazygit, /Missing/u);
});

test('Tools v2: long lists scroll with a factual "more" cue; narrow widths keep rows within the panel', () => {
  const state = createToolsPanel();
  const rows = renderTools(state, 90, 18).map(stripAnsi);
  assert.ok(rows.some(row => /↓ \d+ more/u.test(row)));
  for (let index = 0; index < TOOLS.length + 5; index += 1) toolsKey(state, {kind: 'down'});
  const end = renderTools(state, 90, 18).map(stripAnsi);
  const last = visibleTools(state).at(-1)!.label;
  assert.ok(end.some(row => row.includes('›') && row.includes(last)), 'selection stays visible at the end');
  for (const width of [20, 33, 45, 59, 61]) {
    const narrow = renderTools(state, width, 18);
    assert.ok(narrow.every(row => displayWidth(row) <= width), `@${width}`);
    assert.ok(narrow.map(stripAnsi).some(row => row.includes('›')), `selection visible @${width}`);
  }
});

import {detectToolContexts, relevantTools, type RelevanceProbe} from '../src/tools/relevance.js';
import {availableManagers, distroManager, planPackageInstall, planUnavailableReason, type PackageEnvironment} from '../src/packages/managers.js';
import {reviewBulk} from '../src/tools/ToolsPanel.js';

const fakeProbe = (files: string[], env: NodeJS.ProcessEnv = {}, dirs: Record<string, string[]> = {}): RelevanceProbe => ({
  exists: path => files.includes(path), list: path => dirs[path] ?? [], env, home: '/home/u'});

test('Relevant here: contexts come from bounded existence checks only', () => {
  assert.deepEqual(detectToolContexts('/w/app', fakeProbe([])), []);
  assert.ok(detectToolContexts('/w/app/src', fakeProbe(['/w/.git'])).includes('git'), 'git found in a parent');
  assert.ok(!detectToolContexts('/a/b/c/d/e/f/g/h/i/j', fakeProbe(['/.git'])).includes('git'), 'parent walk is bounded');
  const node = detectToolContexts('/w/app', fakeProbe(['/w/app/package.json']));
  assert.ok(node.includes('javascript') && node.includes('project'));
  assert.ok(detectToolContexts('/w/s', fakeProbe([], {}, {'/w/s': ['deploy.sh']})).includes('shell-scripts'));
  assert.ok(detectToolContexts('/w/k', fakeProbe(['/w/k/kustomization.yaml'])).includes('kubernetes'));
  assert.ok(detectToolContexts('/w/x', fakeProbe([], {KUBECONFIG: '/x'})).includes('kubernetes'));
  assert.ok(detectToolContexts('/w/x', fakeProbe(['/home/u/.kube/config'])).includes('kubernetes'));
});

test('Relevant here: curated, missing-only, and the broad project context alone adds nothing', () => {
  const missing = (ids: string[]) => (tool: {id: string}) => ids.includes(tool.id);
  const all = TOOLS.map(tool => tool.id);
  assert.deepEqual(relevantTools(TOOLS, ['project'], missing(all)), []);
  const git = relevantTools(TOOLS, ['git'], missing(all)).map(item => item.tool.id);
  assert.deepEqual([...git].sort(), ['delta', 'gh', 'lazygit']);
  assert.deepEqual(relevantTools(TOOLS, ['git'], missing(['gh'])).map(item => item.tool.id), ['gh']);
  assert.deepEqual(relevantTools(TOOLS, ['shell-scripts'], missing(all)).map(item => item.tool.id).sort(), ['shellcheck', 'shfmt']);
  const k8s = relevantTools(TOOLS, ['kubernetes'], missing(all)).map(item => item.tool.id);
  assert.ok(k8s.includes('kubectl') && k8s.includes('yq') && k8s.includes('jq'));
  const js = relevantTools(TOOLS, ['javascript', 'project'], missing(all)).map(item => item.tool.id);
  assert.ok(!js.includes('node'), 'language runtimes are not suggested');
  assert.ok(!js.includes('hyperfine'), 'no metadata, no suggestion');
  assert.deepEqual(relevantTools(TOOLS, ['git'], () => false), [], 'installed tools are not listed');
});

test('Relevant here: Discover shows a group before categories, with the reason, once statuses are known', () => {
  const state = createToolsPanel();
  state.contexts = ['git'];
  for (const tool of TOOLS) state.statuses[tool.id] = {state: 'installed'};
  assert.ok(!renderTools(state, 100, 40).map(stripAnsi).some(row => row.trim() === 'Relevant here'));
  state.statuses.gh = {state: 'missing'};
  const plain = renderTools(state, 100, 40).map(stripAnsi);
  const header = plain.findIndex(row => row.trim() === 'Relevant here');
  assert.ok(header >= 0 && plain[header + 1]!.includes('GitHub CLI'));
  assert.equal(visibleTools(state)[0]!.id, 'gh');
  assert.match(plain.join('\n'), /Shown because this looks like a Git repository/u);
  state.query = 'git';
  assert.ok(!renderTools(state, 100, 40).map(stripAnsi).some(row => row.trim() === 'Relevant here'), 'searching shows plain results');
});

const env = (osRelease: string | undefined, commands: string[], extra: Partial<PackageEnvironment> = {}): PackageEnvironment =>
  ({platform: 'linux', ...(osRelease ? {osRelease} : {}), has: command => commands.includes(command), isRoot: false, ...extra});

test('package managers: distro families, preference order and typed argv plans', () => {
  assert.equal(distroManager('ID=ubuntu\nID_LIKE=debian'), 'apt');
  assert.equal(distroManager('ID="linuxmint"\nID_LIKE="ubuntu debian"'), 'apt');
  assert.equal(distroManager('ID=fedora'), 'dnf');
  assert.equal(distroManager('ID=manjaro\nID_LIKE=arch'), 'pacman');
  assert.equal(distroManager('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"'), 'zypper');
  assert.equal(distroManager('ID=nixos'), undefined);
  assert.equal(distroManager(undefined), undefined);
  const rg = TOOLS.find(tool => tool.id === 'rg')!;
  const apt = planPackageInstall(rg, env('ID=ubuntu', ['apt-get', 'brew']))!;
  assert.deepEqual([apt.command, ...apt.args], ['sudo', '-n', 'apt-get', 'install', '-y', 'ripgrep']);
  assert.equal(apt.manager, 'apt'); assert.equal(apt.elevation, 'administrator');
  assert.equal(apt.manual, 'sudo apt-get install -y ripgrep');
  const root = planPackageInstall(rg, env('ID=ubuntu', ['apt-get'], {isRoot: true}))!;
  assert.deepEqual([root.command, ...root.args], ['apt-get', 'install', '-y', 'ripgrep']);
  assert.deepEqual(planPackageInstall(rg, env('ID=fedora', ['dnf']))!.args, ['-n', 'dnf', 'install', '-y', 'ripgrep']);
  assert.deepEqual(planPackageInstall(rg, env('ID=arch', ['pacman']))!.args, ['-n', 'pacman', '-S', '--needed', '--noconfirm', 'ripgrep']);
  assert.deepEqual(planPackageInstall(rg, env('ID=opensuse-leap', ['zypper']))!.args, ['-n', 'zypper', '--non-interactive', 'install', 'ripgrep']);
  const mac = planPackageInstall(rg, {platform: 'darwin', has: command => command === 'brew', isRoot: false})!;
  assert.deepEqual([mac.command, ...mac.args, mac.elevation], ['brew', 'install', 'ripgrep', 'none']);
  assert.deepEqual(availableManagers(env('ID=ubuntu', ['apt-get', 'brew'])).map(manager => manager.id), ['apt', 'homebrew']);
});

test('package managers: no verified mapping means manual, never a guessed name; Windows is unsupported', () => {
  const fd = TOOLS.find(tool => tool.id === 'fd')!;
  assert.equal(planPackageInstall(fd, env('ID=ubuntu', ['apt-get'])), undefined, 'Debian ships fd as fdfind');
  assert.match(planUnavailableReason(fd, env('ID=ubuntu', ['apt-get'])), /no verified APT package for fd/u);
  const fallback = planPackageInstall(fd, env('ID=ubuntu', ['apt-get', 'brew']))!;
  assert.equal(fallback.manager, 'homebrew', 'falls back to an installed Homebrew, shown in the plan');
  assert.match(planUnavailableReason(fd, env('ID=nixos', [])), /did not recognise a supported package manager/u);
  assert.match(planUnavailableReason(fd, {platform: 'win32', has: () => false, isRoot: false}), /Native Windows is not supported/u);
  assert.equal(planPackageInstall(fd, {platform: 'win32', has: () => true, isRoot: false}), undefined);
  assert.equal(planPackageInstall(TOOLS.find(tool => tool.id === 'kubectl')!, env('ID=fedora', ['dnf'])), undefined);
});

test('bulk install: Space selects missing installable tools, Enter reviews, one confirmation, per-tool results', async () => {
  const state = createToolsPanel();
  state.contexts = [];
  state.packages = env('ID=ubuntu', ['apt-get'], {isRoot: true});
  for (const tool of TOOLS) state.statuses[tool.id] = {state: 'installed'};
  state.statuses.rg = {state: 'missing'}; state.statuses.jq = {state: 'missing'}; state.statuses.fd = {state: 'missing'};
  const space = {kind: 'text', value: ' '} as const;
  const select = (id: string) => { state.selected = visibleTools(state).findIndex(tool => tool.id === id); toolsKey(state, space); };
  select('bat'); assert.equal(state.selection?.size ?? 0, 0, 'installed tools are not selectable');
  select('fd'); assert.equal(state.selection?.size ?? 0, 0, 'no verified mapping: not selectable');
  assert.match(state.message ?? '', /fd/u);
  select('rg'); select('jq');
  assert.deepEqual([...state.selection!].sort(), ['jq', 'rg']);
  select('jq'); select('jq'); assert.deepEqual([...state.selection!].sort(), ['jq', 'rg']);
  const review = reviewBulk(state);
  assert.deepEqual(review.items.map(item => `${item.tool.id}:${item.plan.manager}:${item.plan.package}`).sort(), ['jq:apt:jq', 'rg:apt:ripgrep']);
  toolsKey(state, {kind: 'enter'});
  assert.ok(state.bulk && state.confirm, 'Enter opens the combined review');
  const plain = renderTools(state, 100, 40).map(stripAnsi).join('\n');
  assert.match(plain, /Install 2 tools\?/u);
  assert.match(plain, /ripgrep\s+→\s+APT\s+→\s+ripgrep/u);
  const ran: string[] = [];
  const run = async (task: TaskProgress, recipe: {label: string}) => {
    ran.push(recipe.label);
    if (recipe.label.endsWith('jq')) throw new Error('E: unable to locate package jq');
    state.statuses.rg = {state: 'installed'};
  };
  await confirmToolInstall(state, {kind: 'enter'}, () => undefined, run); // default answer is No
  assert.deepEqual(ran, [], 'default focus is No: nothing ran');
  assert.equal(state.bulk, undefined);
});

test('bulk install: one failing tool is reported per tool and does not undo the others', async () => {
  const state = createToolsPanel();
  state.contexts = [];
  state.packages = env('ID=ubuntu', ['apt-get'], {isRoot: true});
  state.provenance = new (await import('../src/tools/InstallProvenance.js')).InstallProvenance(`${process.env.TMPDIR ?? '/tmp'}/nmsh-bulk-prov-${process.pid}.json`);
  for (const tool of TOOLS) state.statuses[tool.id] = {state: 'installed'};
  state.statuses.rg = {state: 'missing'}; state.statuses.jq = {state: 'missing'};
  state.selection = new Set(['rg', 'jq']);
  toolsKey(state, {kind: 'enter'});
  const ran: string[] = [];
  await confirmToolInstall(state, {kind: 'text', value: 'y'}, () => undefined, async (task, recipe) => {
    ran.push(recipe.label);
    if (recipe.label.endsWith('jq')) throw new Error('E: unable to locate package jq');
  });
  assert.equal(ran.length, 2, 'the second tool still ran after the first outcome');
  assert.match(state.message ?? '', /Installed 0 of 2|Installed 1 of 2/u);
  assert.match(state.message ?? '', /jq|JQ/u);
  assert.ok(state.errors.jq, 'failure is recorded per tool');
  assert.deepEqual([...state.selection!].sort(), ['jq', ...(state.errors.rg ? ['rg'] : [])].sort(), 'failed tools stay selected for retry');
});

import {integrationActivation} from '../src/tools/Activation.js';

test('integration activation: runtime evidence from the shell snapshot, separate from installed/selected, shared by all shells', () => {
  const names = (...list: string[]) => new Set(list);
  assert.equal(integrationActivation('zoxide', 'zsh', names('__zoxide_z'), true)?.state, 'active');
  assert.equal(integrationActivation('zoxide', 'bash', names('__zoxide_hook'), true)?.state, 'active');
  assert.equal(integrationActivation('zoxide', 'fish', names('__zoxide_z'), true)?.state, 'active');
  assert.equal(integrationActivation('atuin', 'bash', names('__atuin_history'), true)?.state, 'active');
  assert.equal(integrationActivation('atuin', 'zsh', names('ls'), true)?.state, 'not-detected');
  assert.equal(integrationActivation('fzf', 'zsh', names('fzf-history-widget'), true)?.state, 'active');
  assert.equal(integrationActivation('zoxide', 'zsh', names('ls'), false)?.state, 'unknown', 'truncated snapshot cannot prove absence');
  assert.equal(integrationActivation('zoxide', 'zsh', undefined, false)?.state, 'unknown');
  assert.equal(integrationActivation('fzf', 'fish', names('x'), true)?.state, 'unknown', 'Fish lists autoloadable names, so no claim');
  assert.equal(integrationActivation('rg', 'zsh', names('x'), true), undefined, 'tools without an activation concept have no claim');
  const state = createToolsPanel(new Set(['zoxide']));
  state.statuses.zoxide = {state: 'installed'};
  state.activation = id => integrationActivation(id, 'zsh', names('__zoxide_z'), true);
  state.detail = TOOLS.find(tool => tool.id === 'zoxide')!;
  const plain = renderTools(state, 120, 40).map(stripAnsi).join('\n');
  assert.match(plain, /NMSh\s+Integration selected in NMSh/u);
  assert.match(plain, /Shell\s+Active in this shell/u);
  assert.match(plain, /rc files are never read/u);
});

test('the selected tool row is an unmistakable band that follows the selection, with color and without it', () => {
  const saved = {NO_COLOR: process.env.NO_COLOR, COLORTERM: process.env.COLORTERM};
  const selectedRows = (rows: string[]) => rows.filter(row => row.includes('\u001b[48;') || row.includes('\u001b[7m'));
  try {
    delete process.env.NO_COLOR; process.env.COLORTERM = 'truecolor';
    const state = createToolsPanel();
    for (const tool of TOOLS) state.statuses[tool.id] = {state: 'missing'};
    const first = renderTools(state, 100, 40);
    const band = selectedRows(first).filter(row => !/Discover/u.test(stripAnsi(row)));
    assert.equal(band.length, 1, 'exactly one selected tool row');
    const label = visibleTools(state)[0]!.label;
    assert.ok(stripAnsi(band[0]!).includes(label));
    assert.equal(displayWidth(stripAnsi(band[0]!)), 100, 'a full-width band, not tinted text');
    assert.ok(!band[0]!.includes('\u001b[38;2;125;133;144m'), 'no dim muted text on the band');
    toolsKey(state, {kind: 'down'});
    const moved = selectedRows(renderTools(state, 100, 40)).filter(row => !/Discover/u.test(stripAnsi(row)));
    assert.equal(moved.length, 1);
    assert.ok(stripAnsi(moved[0]!).includes(visibleTools(state)[1]!.label), 'the band moves with the selection');
    state.query = visibleTools(state)[3]!.label;
    const filtered = selectedRows(renderTools(state, 100, 40)).filter(row => !/Discover/u.test(stripAnsi(row)));
    assert.equal(filtered.length, 1, 'search keeps one clear selection');
    delete process.env.NMSH_COLOR; process.env.NO_COLOR = '1';
    const reversed = renderTools(createToolsPanel(), 60, 30).filter(row => row.includes('\u001b[7m'));
    // The active tab is reverse video too (the shared tab strip), as in the colored branch above it is excluded here.
    assert.ok(reversed.some(row => /Discover/u.test(stripAnsi(row))), 'NO_COLOR: the active tab is reverse video');
    const plain = reversed.filter(row => !/Discover/u.test(stripAnsi(row)));
    assert.equal(plain.length, 1, 'NO_COLOR: reverse video carries the selection');
    assert.match(stripAnsi(plain[0]!), /^ {2}› /u);
  } finally {
    if (saved.NO_COLOR === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved.NO_COLOR;
    if (saved.COLORTERM === undefined) delete process.env.COLORTERM; else process.env.COLORTERM = saved.COLORTERM;
  }
});

test('Space-chosen rows use the semantic selection surface continuously without markers', () => {
  const saved = {NO_COLOR: process.env.NO_COLOR, NMSH_COLOR: process.env.NMSH_COLOR};
  try {
    delete process.env.NO_COLOR; process.env.NMSH_COLOR = 'truecolor';
    const selectionBand = background(UI_COLORS.selection);
    const assertContinuous = (row: string, band: string) => {
      assert.ok(row.startsWith(band), 'band starts at the first column');
      assert.equal(displayWidth(row), 100, 'band fills the entire row including padding');
      const resets = [...row.matchAll(/\u001b\[0m/gu)];
      assert.ok(resets.length > 1, 'row contains internal style resets');
      for (const reset of resets.slice(0, -1)) {
        assert.ok(row.slice(reset.index! + reset[0].length).startsWith(band), 'every internal reset immediately reopens the band');
      }
      assert.ok(row.endsWith('\u001b[0m'), 'final reset closes the band');
    };
    const state = createToolsPanel();
    for (const tool of TOOLS) state.statuses[tool.id] = {state: 'missing'};
    const first = visibleTools(state)[0]!;
    const firstBefore = renderTools(state, 100, 40).find(row => stripAnsi(row).includes(first.label))!;
    assert.ok(!firstBefore.includes('[ ]'), 'ordinary row has no checkbox');
    toolsKey(state, {kind: 'text', value: ' '});
    const focusedChosen = renderTools(state, 100, 40).find(row => stripAnsi(row).includes(first.label))!;
    assertContinuous(focusedChosen, selectionBand);
    assert.ok(focusedChosen.includes('\u001b[48;') && stripAnsi(focusedChosen).includes('›'), 'focused chosen row keeps the existing focus treatment');
    assert.ok(!stripAnsi(focusedChosen).includes('[x]'));
    toolsKey(state, {kind: 'down'});
    const rows = renderTools(state, 100, 40);
    const chosenAway = rows.find(row => stripAnsi(row).includes(first.label))!;
    assertContinuous(chosenAway, selectionBand);
    assert.ok(stripAnsi(chosenAway).startsWith(`    ${first.label}`), 'unfocused queued row has only the ordinary indentation and label');
    assert.ok(stripAnsi(focusedChosen).startsWith(`  › ${first.label}`), 'focused queued row has only the existing focus pointer');
    const focusedOther = rows.find(row => stripAnsi(row).includes(visibleTools(state)[1]!.label))!;
    assert.ok(chosenAway.includes('\u001b[48;'), 'chosen row retains a colored band without focus');
    assert.ok(focusedOther.includes('\u001b[48;') && stripAnsi(focusedOther).includes('›'), 'ordinary focused row uses the existing focus treatment');
    assert.notEqual(chosenAway.match(/\u001b\[48;[^m]*m/u)?.[0], focusedOther.match(/\u001b\[48;[^m]*m/u)?.[0], 'chosen tint differs from focus band');
    assert.ok(!stripAnsi(chosenAway).includes('[x]') && !stripAnsi(chosenAway).includes('[ ]'));
    delete process.env.NMSH_COLOR; process.env.NO_COLOR = '1';
    toolsKey(state, {kind: 'down'});
    const noColorRows = renderTools(state, 100, 40);
    assertContinuous(noColorRows.find(row => stripAnsi(row).includes(first.label))!, '\u001b[7m');
    assert.ok(noColorRows.find(row => stripAnsi(row).includes(first.label))?.includes('\u001b[7m'), 'NO_COLOR retains chosen distinction with reverse video');
    assert.ok(!noColorRows.some(row => stripAnsi(row).includes('[x]') || stripAnsi(row).includes('[ ]')));
  } finally {
    if (saved.NO_COLOR === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved.NO_COLOR;
    if (saved.NMSH_COLOR === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = saved.NMSH_COLOR;
  }
});
