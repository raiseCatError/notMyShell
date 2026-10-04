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


test('persisted presentation motion controls freeze task decoration without freezing measured duration', () => {
  const task = new TaskProgress('Installing tool', () => {}, 1000);
  task.setReducedMotion(true);
  assert.equal(taskProgressBar(task.state, 1200), taskProgressBar(task.state, 1800));
  const first = renderTaskProgress(task.state, 1200)[0]!;
  const second = renderTaskProgress(task.state, 1800)[0]!;
  assert.equal(first.split('\u001B[0m')[0], second.split('\u001B[0m')[0]);
  assert.notEqual(first, second, 'factual elapsed time still advances');
  task.setReducedMotion(false);
  assert.notEqual(taskProgressBar(task.state, 1200), taskProgressBar(task.state, 1800));
});

import {animatedProgressBar, type TaskSnapshot} from '../src/status/TaskProgress.js';
import {stripAnsi} from '../src/util/text.js';
import {foreground, UI_COLORS} from '../src/ui/palette.js';
import {setIconStyle} from '../src/ui/glyphs.js';

const snap = (extra: Partial<TaskSnapshot>): TaskSnapshot => ({label: 'x', status: 'running', startedAt: 0, start: 0, reducedMotion: false, ...extra} as TaskSnapshot);
const colored = <T,>(run: () => T): T => {
  const saved = {c: process.env.COLORTERM, n: process.env.NO_COLOR, m: process.env.NMSH_REDUCED_MOTION};
  process.env.COLORTERM = 'truecolor'; delete process.env.NO_COLOR; delete process.env.NMSH_REDUCED_MOTION; setIconStyle('nerd');
  try { return run(); } finally { for (const [k, v] of [['COLORTERM', saved.c], ['NO_COLOR', saved.n], ['NMSH_REDUCED_MOTION', saved.m]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const fills = (bar: string) => (stripAnsi(bar).match(/━/gu) ?? []).length;

test('determinate bar: a travelling wave moves inside the factual fill and never changes it', () => colored(() => {
  const state = snap({total: 100, completed: 48});
  const a = animatedProgressBar(state, 100), b = animatedProgressBar(state, 1700);
  assert.equal(fills(a), 12, '48% of 24 cells, always'); assert.equal(fills(b), 12);
  assert.equal(stripAnsi(a), stripAnsi(taskProgressBar(state, 100)), 'same glyphs as the factual bar');
  assert.notEqual(a, b, 'the wave position changes with elapsed time');
  // Cells differ in color (a localized wave, not one uniform pulse) and only filled cells carry the wave.
  const colorsOf = (bar: string) => [...bar.matchAll(/\u001b\[38;2;(\d+;\d+;\d+)m(?:━|─)/gu)].map(m => m[1]!);
  const colors = colorsOf(a);
  assert.equal(colors.length, 24);
  assert.ok(new Set(colors.slice(0, 12)).size > 3, 'neighbouring filled cells have offset phases');
  assert.equal(new Set(colors.slice(12)).size, 1, 'unfilled cells are a uniform track, never lit as completed');
  assert.equal(fills(animatedProgressBar(snap({total: 100, completed: 0}), 100)), 0, '0% stays empty');
  assert.equal(fills(animatedProgressBar(snap({total: 100, completed: 100}), 100)), 24);
}));

test('indeterminate bar: a travelling segment with no percentage, looping smoothly', () => colored(() => {
  const state = snap({});
  const frames = [0, 450, 900, 1800].map(now => stripAnsi(animatedProgressBar(state, now)));
  assert.ok(new Set(frames).size === frames.length, 'the segment moves');
  assert.ok(frames.every(frame => frame.length === 24 && /[█▓▒]|─/u.test(frame) && !/%|━/u.test(frame)), 'no invented fill or percentage');
  const head = (frame: string) => frame.search(/█/u);
  assert.ok(head(frames[1]!) !== head(frames[2]!) || head(frames[0]!) !== head(frames[1]!));
}));

test('progress colors come from the theme roles; finished, reduced-motion and no-color forms are static and valid', () => colored(() => {
  const running = animatedProgressBar(snap({total: 10, completed: 5}), 300);
  assert.ok(running.includes(foreground(UI_COLORS.secondary)), 'the track uses the secondary role');
  const original = {...UI_COLORS.workingBase};
  try {
    Object.assign(UI_COLORS.workingBase, {red: 1, green: 2, blue: 3}); Object.assign(UI_COLORS.workingPeak, {red: 1, green: 2, blue: 3});
    assert.ok(animatedProgressBar(snap({total: 10, completed: 5}), 300).includes('38;2;1;2;3'), 'a custom theme\'s roles flow through');
  } finally { Object.assign(UI_COLORS.workingBase, original); Object.assign(UI_COLORS.workingPeak, {red: 211, green: 202, blue: 238}); }
  const still = animatedProgressBar(snap({total: 10, completed: 5, reducedMotion: true}), 300);
  assert.equal(still, animatedProgressBar(snap({total: 10, completed: 5, reducedMotion: true}), 2900), 'reduced motion: static, correct fill');
  assert.equal(fills(still), 12);
  assert.equal(animatedProgressBar(snap({status: 'succeeded', total: 10, completed: 5}), 300), animatedProgressBar(snap({status: 'succeeded', total: 10, completed: 5}), 900), 'finished tasks do not animate');
  process.env.NO_COLOR = '1';
  const plain = animatedProgressBar(snap({total: 10, completed: 5}), 300);
  assert.ok(!/\u001b\[38/u.test(plain) && fills(plain) === 12, 'NO_COLOR: valid plain bar');
  delete process.env.NO_COLOR;
  setIconStyle('safe');
  assert.match(stripAnsi(animatedProgressBar(snap({}), 300)), /^[-#+]+$/u, 'safe glyph mode uses ASCII');
  setIconStyle('nerd');
}));
