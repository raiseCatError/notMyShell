import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskProgress, renderTaskProgress, taskProgressBar} from '../src/status/TaskProgress.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';

test('task progress uses a stable-width travelling shimmer and only real totals', () => {
  const task = new TaskProgress('Installing Starship', () => {}, 1000);
  const first = renderTaskProgress(task.state, 1000)[0]!;
  const later = renderTaskProgress(task.state, 1300)[0]!;
  assert.equal(stripAnsi(first).split('  ')[0], stripAnsi(later).split('  ')[0]);
  assert.notEqual(first.split('\u001B[0m')[0], later.split('\u001B[0m')[0]);
  assert.equal(displayWidth(taskProgressBar(task.state, 1200)), 24);
  task.setProgress(5, 0);
  assert.equal(task.state.total, undefined);
  task.setProgress(5, 10);
  assert.equal(task.state.total, 10);
  assert.equal(taskProgressBar(task.state, 1200).length, 24);
});

test('task runner bounds diagnostics and cleans up after success and failure', async () => {
  const success = new TaskProgress('Write output', () => {});
  const completed = await success.run(process.execPath, ['-e', "process.stdout.write('x'.repeat(20000))"]);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.details.length, 16 * 1024);
  assert.equal(success['timer'], undefined);
  assert.equal(success['child'], undefined);

  const failure = new TaskProgress('Fail', () => {});
  const failed = await failure.run(process.execPath, ['-e', "process.stderr.write('diagnostic'); process.exit(3)"]);
  assert.equal(failed.status, 'failed');
  assert.match(failed.details, /diagnostic/u);
  assert.equal(failed.error, 'Exit 3');
  assert.equal(failure['child'], undefined);
});

test('installer panel shows active, finished, and bounded sanitized detail states', async () => {
  const task = new TaskProgress('Installing Starship with Homebrew', () => {}, Date.now(), 'Starship');
  const state: PromptPanelState = {onboarding: false, step: 'installProgress', selectedIndex: 0,
    draft: structuredClone(DEFAULT_PROMPT_CONFIGURATION), task};
  assert.match(renderPromptPanel(state, 80, []).map(stripAnsi).join('\n'), /Installing Starship/u);
  await task.run(process.execPath, ['-e', "process.stdout.write('installed')"]);
  state.step = 'installResult';
  assert.match(renderPromptPanel(state, 80, []).map(stripAnsi).join('\n'), /Starship installed/u);
  task.appendDetails('\u001B[2J\nextra details');
  state.step = 'installDetails';
  const details = renderPromptPanel(state, 80, [], [], 9).map(stripAnsi).join('\n');
  assert.doesNotMatch(details, /\u001B|\[2J/u);
  assert.match(details, /extra details/u);
});
