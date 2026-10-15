import test from 'node:test';
import assert from 'node:assert/strict';
import {entersBar, ESCALATION_PAUSE_MS, fitHints, renderTaskBar, TaskBarController, taskLabel, type ComposerState} from '../src/backgroundTasks/bar.js';
import {explicitRun, parseBackgroundCommand, renderSuggestion, suggestionKey} from '../src/backgroundTasks/suggestion.js';
import {taskBlock, taskBlockText, TaskOutputView} from '../src/backgroundTasks/view.js';
import {BackgroundManager} from '../src/backgroundTasks/manager.js';
import {TaskOutput} from '../src/backgroundTasks/output.js';
import {DEFAULT_PREFERENCES, rememberFamily} from '../src/backgroundTasks/preferences.js';
import {classifyCommand} from '../src/backgroundTasks/detector.js';
import type {StopLevel, TaskRecord} from '../src/backgroundTasks/supervisor.js';
import type {Key} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const k = (kind: Key['kind'], value?: string): Key => (value === undefined ? {kind} : {kind, value}) as Key;
const NOW = 1_000_000;
const task = (id: string, extra: Partial<TaskRecord> = {}): TaskRecord => ({id, command: 'adb logcat', family: 'adb logcat', cwd: '/w', shell: '/bin/zsh', startedAt: NOW - 261_000, state: 'running', ...extra});
const TASKS: TaskRecord[] = [task('t1'), task('t2', {command: 'scrcpy', family: 'scrcpy', startedAt: NOW - 158_000}),
  task('t3', {command: 'npm run dev', family: 'npm run dev', state: 'failed', exitCode: 1, endedAt: NOW - 1000, startedAt: NOW - 662_000})];
const idle: ComposerState = {empty: true, browsingHistory: false, foregroundBusy: false, otherOwner: false};
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‮]/u;

test('entering the bar: Up only from an idle composer; Shift+Up always from an empty one; never while input is owned', () => {
  assert.equal(entersBar(k('up'), idle, 2, 'idle'), true);
  assert.equal(entersBar(k('up'), {...idle, empty: false}, 2, 'idle'), false, 'a draft keeps Up for its own lines and history');
  assert.equal(entersBar(k('up'), {...idle, browsingHistory: true}, 2, 'idle'), false, 'history browsing continues');
  assert.equal(entersBar(k('up'), {...idle, foregroundBusy: true}, 2, 'idle'), false, 'a running or waiting foreground command owns the keys');
  assert.equal(entersBar(k('selectUp'), {...idle, foregroundBusy: true}, 2, 'idle'), false);
  assert.equal(entersBar(k('up'), {...idle, otherOwner: true}, 2, 'idle'), false);
  assert.equal(entersBar(k('up'), idle, 0, 'idle'), false, 'nothing to enter');
  assert.equal(entersBar(k('up'), idle, 2, 'off'), false, 'the preference turns Up off');
  assert.equal(entersBar(k('selectUp'), idle, 2, 'off'), true, 'Shift+Up still works');
  assert.equal(entersBar(k('down'), idle, 2, 'idle'), false);
});

test('bar keys: select, view, stop then escalate, remove only finished tasks, typing returns to the composer with the key', () => {
  const bar = new TaskBarController();
  bar.focused = true;
  const next = (levels: Record<string, StopLevel | undefined>) => (id: string) => levels[id];
  assert.equal(bar.handleKey(k('enter'), TASKS, next({})).kind, 'view');
  assert.deepEqual(bar.handleKey(k('text', 'x'), TASKS, next({t1: 'interrupt'})), {kind: 'stop', taskId: 't1', level: 'interrupt'});
  assert.deepEqual(bar.handleKey(k('text', 'x'), [{...TASKS[0]!, state: 'stopping', stopRequested: 'interrupt'}], next({t1: 'terminate'})), {kind: 'stop', taskId: 't1', level: 'terminate'});
  assert.equal(bar.handleKey(k('text', 'x'), [{...TASKS[0]!, state: 'stopping', stopRequested: 'kill'}], next({})).kind, 'none');
  assert.deepEqual(bar.handleKey(k('delete'), TASKS, next({})), {kind: 'none', message: 'stop it first (x); a running task is never removed'});
  bar.handleKey(k('down'), TASKS, next({})); bar.handleKey(k('down'), TASKS, next({}));
  assert.equal(bar.selectedId, 't3');
  assert.equal(bar.handleKey(k('text', 'x'), TASKS, next({})).kind, 'none', 'x on a finished task stops nothing');
  assert.deepEqual(bar.handleKey(k('delete'), TASKS, next({})), {kind: 'remove', taskId: 't3'});
  assert.deepEqual(bar.handleKey(k('down'), TASKS, next({})), {kind: 'leave'}, 'down past the last task returns to the composer below');
  bar.focused = true;
  assert.equal(bar.handleKey(k('text', ' '), TASKS, next({})).kind, 'toggle');
  assert.equal(bar.expanded, true);
  assert.deepEqual(bar.handleKey(k('text', 'g'), TASKS, next({})), {kind: 'leave', forward: {kind: 'text', value: 'g'}}, 'typing is not lost');
  assert.equal(bar.focused, false);
  bar.focused = true;
  assert.deepEqual(bar.handleKey(k('escape'), TASKS, next({})), {kind: 'leave'});
  bar.sync([]);
  assert.equal(bar.focused, false, 'no tasks, no focus');
});

test('bar rendering: no rows when empty; one summary row collapsed; bounded rows expanded; exact width; marks without color', () => {
  const bar = new TaskBarController();
  assert.equal(bar.rows([]), 0);
  assert.deepEqual(renderTaskBar(bar, [], {width: 80, now: NOW, safe: true, color: false}), []);
  const summary = renderTaskBar(bar, TASKS, {width: 80, now: NOW, safe: true, color: false});
  assert.deepEqual(summary, ['* 3 background tasks · 2 running · 1 failed']);
  bar.focused = true;
  bar.selectedId = 't1';
  assert.match(renderTaskBar(bar, TASKS, {width: 120, now: NOW, safe: true, color: false, next: () => 'interrupt'})[0]!, /^>\* adb logcat {2}04:21 {2}running {2}1\/3 {2}Enter view · x stop · Esc back$/u);
  bar.expanded = true;
  const many = Array.from({length: 9}, (_, i) => task(`t${i + 1}`, {family: undefined, command: `tail -f /var/log/app${i}.log`}));
  for (const tasks of [TASKS, many]) {
    for (const width of [10, 24, 40, 80, 160]) for (const safe of [true, false]) for (const color of [true, false]) {
      const lines = renderTaskBar(bar, tasks, {width, now: NOW, safe, color, next: () => 'interrupt'});
      assert.equal(lines.length, bar.rows(tasks), `${width}: rows reserved = rows drawn`);
      assert.ok(lines.length <= 4);
      for (const line of lines) assert.ok(displayWidth(stripAnsi(line)) <= width, `${width}: ${stripAnsi(line)}`);
    }
  }
  const expanded = renderTaskBar(bar, many, {width: 80, now: NOW, safe: true, color: false});
  assert.match(expanded.at(-1)!, /\+\d+ more · \/background lists all/u);
  const states: TaskRecord[] = (['running', 'stopping', 'exited', 'failed', 'stopped'] as const).map((state, i) => task(`t${i}`, {state, endedAt: state === 'running' || state === 'stopping' ? undefined : NOW}));
  for (const safe of [true, false]) {
    bar.expanded = true; bar.focused = false;
    const rows = renderTaskBar(bar, states, {width: 80, now: NOW, safe, color: false, maxRows: 10}).slice(1);
    assert.equal(new Set(rows.map(row => row.trimStart()[0])).size, 5, 'each state has its own mark');
    assert.ok(rows.every(row => /running|stopping|exited|failed|stopped/u.test(row)), 'and its own word');
  }
});

test('hostile commands and directories are drawn as text only', () => {
  const evil = task('t9', {family: undefined, command: '\u001b]0;PWNED\u0007\u001b[2Jtail -f ‮evil.log\nrm -rf ~', cwd: '/tmp/\u001b[31mred\u0007dir'});
  assert.equal(taskLabel(evil), 'tail -f evil.log');
  const output = new TaskOutput({lines: 50, bytes: 10_000});
  const bar = new TaskBarController(true);
  const manager = new BackgroundManager();
  const view = new TaskOutputView();
  const drawn = [
    ...renderTaskBar(bar, [evil], {width: 80, now: NOW, safe: false, color: true}),
    ...manager.render([evil], () => output, DEFAULT_PREFERENCES(), {width: 100, rows: 20, now: NOW, color: true, safe: false}),
    ...view.render(evil, output, {width: 100, height: 6, now: NOW, color: true, safe: false}),
    ...taskBlock(evil, output, {width: 100, now: NOW, color: true, safe: false}), taskBlockText(evil, output),
  ];
  for (const line of drawn) assert.doesNotMatch(stripAnsi(line), CONTROL, JSON.stringify(stripAnsi(line)));
  assert.ok(drawn.some(line => stripAnsi(line).includes('/tmp/reddir')));
  assert.ok(drawn.some(line => stripAnsi(line).includes('(+1 more line)')), 'a hidden second line is announced, not shown as if absent');
});

test('suggestion strip: Enter keeps the foreground path; choices are single keys; the strip says what background changes', () => {
  assert.equal(suggestionKey(k('enter')), 'foreground');
  assert.equal(suggestionKey(k('escape')), 'edit');
  assert.equal(suggestionKey(k('text', 'b')), 'background');
  assert.equal(suggestionKey(k('text', 'a')), 'always');
  assert.equal(suggestionKey(k('text', 'n')), 'never');
  assert.equal(suggestionKey(k('text', 'q')), undefined);
  const classification = classifyCommand('adb logcat') as Exclude<ReturnType<typeof classifyCommand>, {why: string}>;
  const wide = renderSuggestion({command: 'adb logcat', classification}, {width: 200, color: false, safe: true});
  assert.equal(wide.length, 2);
  assert.match(wide[0]!, /adb logcat keeps streaming device logs/u);
  assert.match(wide[1]!, /without this shell's aliases, functions or unexported variables/u);
  for (const width of [12, 30, 47, 48, 80]) for (const line of renderSuggestion({command: 'adb logcat', classification}, {width, color: true, safe: false})) assert.ok(displayWidth(stripAnsi(line)) <= width);
  const likely = classifyCommand('npm run dev') as Exclude<ReturnType<typeof classifyCommand>, {why: string}>;
  assert.match(renderSuggestion({command: 'npm run dev', classification: likely}, {width: 200, color: false, safe: true})[0]!, /it may keep running/u);
});

test('/background: explicit runs keep the command byte for byte; interactive programs are refused; subcommands parse', () => {
  assert.deepEqual(explicitRun(`/background run   printf '%s\\n' "a  b"`), {ok: true, command: `printf '%s\\n' "a  b"`, notes: []});
  const logcat = explicitRun('/bg run adb logcat | grep -i Activity');
  assert.ok(logcat.ok && logcat.classification?.family === 'adb logcat');
  assert.deepEqual(explicitRun('/background run sudo tail -f /var/log/x'), {ok: false, reason: 'not run in the background: sudo needs the terminal or the shell itself'});
  assert.equal(explicitRun('/background run vim notes.md').ok, false);
  const expanding = explicitRun('/background run tail -f "$LOG"');
  assert.ok(expanding.ok && expanding.notes[0]!.includes('values set only in this shell are not seen'));
  assert.deepEqual(explicitRun('/background run'), {ok: false, reason: 'usage: /background run <command>'});
  assert.deepEqual(parseBackgroundCommand('/background'), {kind: 'open'});
  assert.deepEqual(parseBackgroundCommand('/bg  '), {kind: 'open'});
  assert.deepEqual(parseBackgroundCommand('/bg stop t3'), {kind: 'stop', taskId: 't3', force: false});
  assert.deepEqual(parseBackgroundCommand('/bg kill t3'), {kind: 'stop', taskId: 't3', force: true});
  assert.deepEqual(parseBackgroundCommand('/background stop 3'), {kind: 'invalid', reason: 'usage: /background stop t<number>'});
  assert.deepEqual(parseBackgroundCommand('/background suggestions off'), {kind: 'suggestions', value: 'off'});
  assert.deepEqual(parseBackgroundCommand('/background t3'), {kind: 'view', taskId: 't3'});
  assert.equal(parseBackgroundCommand('/background t3 now')?.kind, 'invalid');
  assert.deepEqual(parseBackgroundCommand('/background forget adb logcat'), {kind: 'forget', family: 'adb logcat'});
  assert.equal(parseBackgroundCommand('/backgrounds'), undefined, 'not this command');
  assert.equal(parseBackgroundCommand('/background frob')?.kind, 'invalid');
});

test('output view: follows new output, stops following when scrolled back and counts what is new; End follows again', () => {
  const output = new TaskOutput({lines: 1000, bytes: 1_000_000});
  for (let i = 1; i <= 30; i++) output.append(`line ${i}\r\n`);
  const view = new TaskOutputView();
  const running = task('t1');
  let lines = view.render(running, output, {width: 60, height: 7, now: NOW, color: false, safe: true});
  assert.equal(lines.length, 7);
  assert.deepEqual(lines.slice(1, 6), ['line 26', 'line 27', 'line 28', 'line 29', 'line 30']);
  assert.match(lines[6]!, /^following · 30 lines/u);
  view.scroll(-10, output, 5);
  for (let i = 31; i <= 34; i++) output.append(`line ${i}\r\n`);
  lines = view.render(running, output, {width: 60, height: 7, now: NOW, color: false, safe: true});
  assert.equal(lines[1], 'line 16', 'the view stays where the person scrolled');
  assert.match(lines[6]!, /^4 new lines below · End follow/u);
  view.end(output);
  lines = view.render(running, output, {width: 60, height: 7, now: NOW, color: false, safe: true});
  assert.equal(lines[5], 'line 34');
});

test('transcript block: labelled with its task, latest lines, folded and dropped counts, plain copy', () => {
  const output = new TaskOutput({lines: 5, bytes: 1_000_000});
  for (let i = 1; i <= 12; i++) output.append(`log ${i}\r\n`);
  output.append('partial');
  const block = taskBlock(task('t4'), output, {width: 100, now: NOW, lines: 3, color: false, safe: true});
  assert.deepEqual(block, ['> Background · adb logcat · t4 · running 04:21', '  … 9 earlier lines (7 beyond the retention limit) · /background t4', '  log 10', '  log 11', '  log 12', '  partial']);
  assert.equal(taskBlockText(task('t4'), output).split('\n')[0], '# background t4: adb logcat');
  assert.deepEqual(taskBlock(task('t5'), new TaskOutput({lines: 5, bytes: 100}), {width: 80, now: NOW, color: false, safe: true}).at(-1), '  (no output yet)');
});

test('manager: running first, stop/remove/clear rules, preferences changed and forgotten, exact size', () => {
  const manager = new BackgroundManager();
  assert.deepEqual(BackgroundManager.order(TASKS).map(item => item.id), ['t2', 't1', 't3'], 'running first, newest first');
  // Suggestions on, so Right in Preferences turns them off.
  const prefs = rememberFamily({...DEFAULT_PREFERENCES(), suggestions: 'ask'}, 'adb logcat', 'always');
  const next = () => 'interrupt' as const;
  assert.deepEqual(manager.handleKey(k('text', 'x'), TASKS, prefs, next), {kind: 'stop', taskId: 't2', level: 'interrupt'});
  assert.equal(manager.handleKey(k('delete'), TASKS, prefs, next).kind, 'none');
  manager.handleKey(k('down'), TASKS, prefs, next); manager.handleKey(k('down'), TASKS, prefs, next);
  assert.deepEqual(manager.handleKey(k('delete'), TASKS, prefs, next), {kind: 'remove', taskId: 't3'});
  assert.deepEqual(manager.handleKey(k('text', 'c'), TASKS, prefs, next), {kind: 'clear'});
  assert.deepEqual(manager.handleKey(k('text', 'c'), TASKS.slice(0, 2), prefs, next), {kind: 'none', message: 'no finished tasks'});
  manager.handleKey(k('complete'), TASKS, prefs, next);
  assert.equal(manager.tab, 'preferences');
  const off = manager.handleKey(k('right'), TASKS, prefs, next);
  assert.equal(off.kind === 'preferences' && off.value.suggestions, 'off');
  for (let i = 0; i < 6; i++) manager.handleKey(k('down'), TASKS, prefs, next);
  const flipped = manager.handleKey(k('enter'), TASKS, prefs, next);
  assert.equal(flipped.kind === 'preferences' && flipped.value.families['adb logcat'], 'never');
  const forgotten = manager.handleKey(k('delete'), TASKS, prefs, next);
  assert.deepEqual(forgotten.kind === 'preferences' && forgotten.value.families, {});
  for (const tab of ['tasks', 'preferences'] as const) {
    manager.tab = tab;
    for (const [width, rows] of [[40, 8], [100, 20], [20, 3]] as const) {
      const lines = manager.render(TASKS, () => new TaskOutput({lines: 5, bytes: 100}), prefs, {width, rows, now: NOW, color: true, safe: false});
      assert.equal(lines.length, rows);
      for (const line of lines) assert.ok(displayWidth(stripAnsi(line)) <= width);
    }
  }
  assert.match(new BackgroundManager().render([], () => undefined, prefs, {width: 120, rows: 4, now: NOW, color: false, safe: true})[1]!, /No background tasks/u);
});

test('the manager acts on the task the person selected, even when the order changes under it', () => {
  const manager = new BackgroundManager();
  const prefs = DEFAULT_PREFERENCES();
  const next = () => 'interrupt' as const;
  const a = task('t1', {startedAt: NOW - 50_000});
  const b = task('t2', {startedAt: NOW - 40_000, command: 'scrcpy', family: 'scrcpy'});
  manager.handleKey(k('down'), [a, b], prefs, next);
  assert.deepEqual(manager.handleKey(k('text', 'x'), [a, b], prefs, next), {kind: 'stop', taskId: 't1', level: 'interrupt'}, 'newest first: t2, then t1');
  // A new task starts at the top while t1 is selected: the selection stays on t1.
  const c = task('t3', {startedAt: NOW - 1000, command: 'tail -f x', family: 'tail -f'});
  assert.deepEqual(manager.handleKey(k('text', 'x'), [a, b, c], prefs, next), {kind: 'stop', taskId: 't1', level: 'interrupt'});
  // Finished tasks: one ends and is listed above the selected finished task; Delete still removes the selected one.
  const old = task('t4', {state: 'exited', exitCode: 0, endedAt: NOW - 9000});
  const ended = task('t5', {state: 'exited', exitCode: 0, endedAt: NOW - 8000});
  for (let i = 0; i < 4; i++) manager.handleKey(k('down'), [a, old], prefs, next);
  assert.deepEqual(manager.handleKey(k('delete'), [a, old], prefs, next), {kind: 'remove', taskId: 't4'});
  assert.deepEqual(manager.handleKey(k('delete'), [a, old, ended], prefs, next), {kind: 'remove', taskId: 't4'});
  // The selected task removed: its neighbour is selected, not the first row.
  assert.deepEqual(manager.handleKey(k('delete'), [a, ended], prefs, next), {kind: 'remove', taskId: 't5'});
});

test('the manager list scrolls with the selection and leaves room for the details at any height', () => {
  const manager = new BackgroundManager();
  const prefs = DEFAULT_PREFERENCES();
  const many = Array.from({length: 30}, (_, i) => task(`t${i + 1}`, {family: undefined, command: `tail -f /var/log/app${i + 1}.log`, startedAt: NOW - (i + 1) * 1000}));
  for (let i = 0; i < 20; i++) manager.handleKey(k('down'), many, prefs, () => 'interrupt');
  for (const rows of [8, 14, 24]) {
    const lines = manager.render(many, () => undefined, prefs, {width: 80, rows, now: NOW, color: false, safe: true}).map(stripAnsi);
    assert.equal(lines.length, rows);
    assert.ok(lines.some(line => /^> t21 /u.test(line)), `${rows} rows: the selected task is visible\n${lines.join('\n')}`);
    assert.match(lines.find(line => /above|below/u.test(line)) ?? '', /^ {2}\d+ above( · \d+ below)?$/u, 'the rows not shown are counted');
    if (rows >= 14) assert.ok(lines.some(line => line.startsWith('  Command  tail -f /var/log/app21.log')), `${rows} rows: details of the selection`);
  }
});

test('stopping is paced: a repeated or held x cannot go from interrupt to SIGKILL at once', () => {
  const bar = new TaskBarController();
  bar.focused = true;
  const stopping = task('t1', {state: 'stopping', stopRequested: 'interrupt', stopRequestedAt: NOW});
  const next = () => 'terminate' as const;
  const early = bar.handleKey(k('text', 'x'), [stopping], next, NOW + 200);
  assert.equal(early.kind, 'none');
  assert.match((early as {message: string}).message, /give it a moment, then x sends terminate \(SIGTERM\)/u);
  assert.deepEqual(bar.handleKey(k('text', 'x'), [stopping], next, NOW + ESCALATION_PAUSE_MS), {kind: 'stop', taskId: 't1', level: 'terminate'});
  const manager = new BackgroundManager();
  assert.equal(manager.handleKey(k('text', 'x'), [stopping], DEFAULT_PREFERENCES(), next, NOW + 200).kind, 'none', 'the manager uses the same rule');
  // While paused the bar does not offer the escalation; afterwards it names it.
  const paused = stripAnsi(renderTaskBar(bar, [stopping], {width: 120, now: NOW + 200, safe: true, color: false, next})[0]!);
  assert.doesNotMatch(paused, /x terminate/u);
  assert.match(stripAnsi(renderTaskBar(bar, [stopping], {width: 120, now: NOW + ESCALATION_PAUSE_MS, safe: true, color: false, next})[0]!), /x terminate \(SIGTERM\)/u);
});

test('a finished task with processes left: x kills what is left, Delete waits until nothing runs', () => {
  const bar = new TaskBarController();
  bar.focused = true;
  const left = task('t1', {state: 'exited', exitCode: 0, endedAt: NOW - 1000, leftovers: true});
  assert.deepEqual(bar.handleKey(k('text', 'x'), [left], () => undefined, NOW), {kind: 'stop', taskId: 't1', level: 'kill'});
  assert.deepEqual(bar.handleKey(k('delete'), [left], () => undefined, NOW), {kind: 'none', message: 'its processes still run; x kills them, then Delete removes it'});
  assert.match(stripAnsi(renderTaskBar(bar, [left], {width: 120, now: NOW, safe: true, color: false, next: () => undefined})[0]!), /x kill what is left · Esc back/u);
  const killed = {...left, stopRequested: 'kill' as const};
  assert.equal(bar.handleKey(k('text', 'x'), [killed], () => undefined, NOW).kind, 'none', 'one kill request; then it waits');
  const manager = new BackgroundManager();
  const lines = manager.render([left], () => undefined, DEFAULT_PREFERENCES(), {width: 100, rows: 20, now: NOW, color: false, safe: true});
  assert.ok(lines.some(line => line.includes('processes of this task still run; x kills them')));
});

test('narrow terminals: the task stays named, the way back stays shown, and removal keeps the selection in place', () => {
  const bar = new TaskBarController();
  bar.focused = true;
  const tasks = [task('t1', {state: 'stopping', stopRequested: 'terminate', stopRequestedAt: NOW - 5000}), task('t2'), task('t3', {command: 'npm run dev', family: 'npm run dev'})];
  for (const width of [40, 48, 60]) {
    const row = stripAnsi(renderTaskBar(bar, tasks, {width, now: NOW, safe: true, color: false, next: () => 'kill'})[0]!);
    assert.ok(displayWidth(row) <= width);
    assert.match(row, /adb logcat/u, `${width}: the label survives (${row})`);
  }
  assert.equal(fitHints(['↑↓ select', 'Enter output', 'x stop', 'Del remove', 'c clear finished', 'Tab preferences', 'Esc close'], 40), '↑↓ select · Enter output · Esc close', 'whole hints are dropped, the way back is kept');
  const manager = new BackgroundManager();
  const footer = stripAnsi(manager.render(tasks, () => undefined, DEFAULT_PREFERENCES(), {width: 40, rows: 12, now: NOW, color: false, safe: true}).at(-1)!);
  assert.match(footer, /Esc close$/u, 'the way out is never cut off');
  bar.selectedId = 't2';
  bar.sync(tasks);
  bar.sync([tasks[0]!, tasks[2]!]);
  assert.equal(bar.selectedId, 't3', 'the neighbour takes the removed task\'s place');
  const expanded = new TaskBarController(true);
  assert.match(renderTaskBar(expanded, tasks, {width: 80, now: NOW, safe: false, color: false, upArrow: 'off'})[0]!, /Shift\+↑ or \/background/u, 'the hint names the key that enters the bar');
});

test('output view: a scrolled-back view stays on its lines while the retention limit drops older ones; the progress line shows', () => {
  const output = new TaskOutput({lines: 20, bytes: 1024 * 1024});
  for (let i = 1; i <= 20; i++) output.append(`line ${i}\n`);
  const view = new TaskOutputView();
  const running = task('t1');
  const options = {width: 60, height: 7, now: NOW, color: false, safe: true};
  view.render(running, output, options);
  view.scroll(-8, output, 5);
  const before = view.render(running, output, options).slice(1, 6);
  assert.deepEqual(before, ['line 8', 'line 9', 'line 10', 'line 11', 'line 12']);
  for (let i = 21; i <= 25; i++) output.append(`line ${i}\n`);
  assert.deepEqual(view.render(running, output, options).slice(1, 6), before, 'the lines being read do not drift up as old ones are dropped');
  assert.match(view.render(running, output, options)[6]!, /^5 new lines below/u);
  for (let i = 26; i <= 40; i++) output.append(`line ${i}\n`);
  const overtaken = view.render(running, output, {...options, width: 100});
  assert.equal(overtaken[1], 'line 21', 'once its lines are gone the view shows the oldest kept line');
  assert.match(overtaken[6]!, /older lines dropped \(retention limit\) · End follow · Esc back$/u);
  assert.match(view.render(running, output, {...options, width: 44})[6]!, /^20 new lines below · End follow · Esc back$/u, 'narrow: notes go before the keys');
  view.end(output);
  output.append('downloading 42%');
  const following = view.render(running, output, options);
  assert.equal(following[5], 'downloading 42%', 'the unfinished line is the last row while following');
  assert.equal(following[4], 'line 40');
});

test('/background parsing is linear on a long pasted run of spaces', () => {
  const started = performance.now();
  assert.equal(parseBackgroundCommand(`/background ${' '.repeat(100_000)}x${' '.repeat(100_000)}`)?.kind, 'invalid');
  assert.equal(parseBackgroundCommand(`${' '.repeat(100_000)}x`), undefined);
  assert.ok(performance.now() - started < 250, `took ${(performance.now() - started).toFixed(0)} ms`);
});
