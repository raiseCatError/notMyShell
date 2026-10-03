import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS, toolInstall} from '../src/tools/catalog.js';
import {confirmToolInstall, createToolsPanel, renderTools, toolsKey, visibleTools} from '../src/tools/ToolsPanel.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {TaskProgress, taskProgressBar} from '../src/status/TaskProgress.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';

test('offline catalog, truthful filters and curated argv recipes do not execute discovery', () => {
  assert.equal(new Set(TOOLS.map(tool => tool.id)).size, TOOLS.length);
  assert.deepEqual(TOOLS.filter(tool => tool.recommended).map(tool => tool.id).sort(), ['fd', 'fzf', 'jq', 'rg', 'zoxide']);
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
  assert.equal(state.onboarding, 2);
  assert.equal(toolsKey(state, {kind: 'enter'}), 'close');
  const recommended = createToolsPanel(new Set(), true);
  toolsKey(recommended, {kind: 'down'});
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
  assert.match(plain.at(-1)!, /↑↓ select · ←→ tabs · Enter details/u);
  const lazygit = plain.find(row => row.includes('lazygit'))!;
  assert.match(lazygit, /Missing/u);
});

test('Tools v2: long lists scroll with a factual "more" cue; narrow widths keep rows within the panel', () => {
  const state = createToolsPanel();
  const rows = renderTools(state, 90, 18).map(stripAnsi);
  assert.ok(rows.some(row => /↓ \d+ more/u.test(row)));
  for (let index = 0; index < 30; index += 1) toolsKey(state, {kind: 'down'});
  const end = renderTools(state, 90, 18).map(stripAnsi);
  assert.ok(end.some(row => row.includes('›') && row.includes('Python')), 'selection stays visible at the end');
  for (const width of [20, 33, 45, 59, 61]) {
    const narrow = renderTools(state, width, 18);
    assert.ok(narrow.every(row => displayWidth(row) <= width), `@${width}`);
    assert.ok(narrow.map(stripAnsi).some(row => row.includes('›')), `selection visible @${width}`);
  }
});
