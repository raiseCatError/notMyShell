import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS, suggestibleToolFor, toolInstall} from '../src/tools/catalog.js';
import {confirmToolInstall, createToolsPanel, renderTools, toolBadges, toolsKey, visibleTools} from '../src/tools/ToolsPanel.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {TaskProgress, taskProgressBar} from '../src/status/TaskProgress.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';

test('offline catalog, truthful filters and curated argv recipes do not execute discovery', () => {
  assert.equal(new Set(TOOLS.map(tool => tool.id)).size, TOOLS.length);
  assert.deepEqual(TOOLS.filter(tool => tool.recommended).map(tool => tool.id).sort(), ['fastfetch', 'fd', 'fzf', 'jq', 'rg', 'zoxide']);
  const state = createToolsPanel(new Set(['fzf']));
  state.statuses.fzf = {state: 'installed', version: 'stub 1'};
  state.statuses.fd = {state: 'missing'};
  state.query = 'files';
  assert.ok(visibleTools(state).every(tool => tool.category === 'Search & Files'));
  assert.ok(visibleTools(state).findIndex(tool => tool.id === 'fzf') > visibleTools(state).findIndex(tool => tool.id === 'fd'));
  state.query = ''; state.tab = 'installed';
  assert.deepEqual(visibleTools(state).map(tool => tool.id), ['fzf']);
  state.tab = 'configure';
  assert.deepEqual(visibleTools(state).map(tool => tool.id), ['starship']);
  assert.equal(toolInstall(TOOLS[0]!, false), undefined);
  assert.deepEqual(toolInstall(TOOLS[0]!, true)?.args, ['install', 'ripgrep']);
  assert.deepEqual(parseSlashCommand('/tools'), {kind: 'tools'});
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
  assert.match(selected, /\u001b\[48;/u, 'selected row has a background band');
  assert.ok(plain.some(row => row.trim() === first.description), 'muted description of the selection');
  assert.match(plain.at(-1)!, /↑↓ select · ←→ tabs · Space select · Enter details/u);
  const lazygit = plain.find(row => row.includes('lazygit'))!;
  assert.match(lazygit, /Missing/u);
});

test('Tools v2: long lists scroll with a factual "more" cue; narrow widths keep rows within the panel', () => {
  const state = createToolsPanel();
  const rows = renderTools(state, 90, 18).map(stripAnsi);
  assert.ok(rows.some(row => /↓ \d+ more/u.test(row)));
  for (let index = 0; index < 40; index += 1) toolsKey(state, {kind: 'down'});
  const end = renderTools(state, 90, 18).map(stripAnsi);
  assert.ok(end.some(row => row.includes('›') && row.includes('Python')), 'selection stays visible at the end');
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
