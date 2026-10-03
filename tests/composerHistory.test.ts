import test from 'node:test';
import assert from 'node:assert/strict';
import {ComposerHistory, COMPOSER_HISTORY_LIMIT} from '../src/input/ComposerHistory.js';
import {CommandEditor} from '../src/input/CommandEditor.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {historyId, type HistoryEntry} from '../src/shell/HistoryIndex.js';

const UP = '\u001B[A';
const DOWN = '\u001B[B';

test('navigator: Up walks older, Down walks newer, then restores the draft; no wrap at either end', () => {
  const history = new ComposerHistory();
  const source = () => ['clear', 'git status', 'npm test'];
  assert.equal(history.previous('', source), 'clear');
  assert.equal(history.previous('clear', source), 'git status');
  assert.equal(history.previous('git status', source), 'npm test');
  assert.equal(history.previous('npm test', source), undefined, 'oldest entry: no wrap');
  assert.equal(history.next('npm test'), 'git status');
  assert.equal(history.next('git status'), 'clear');
  assert.equal(history.next('clear'), '', 'past the newest: the empty draft returns');
  assert.equal(history.active, false);
  assert.equal(history.next(''), undefined, 'Down outside navigation does nothing');
});

test('navigator: an unsent draft survives; editing a recalled command ends navigation without touching history', () => {
  const stored = ['git status', 'npm test'];
  const history = new ComposerHistory();
  assert.equal(history.previous('git di', () => stored), 'git status');
  assert.equal(history.next('git status'), 'git di');
  assert.equal(history.previous('git di', () => stored), 'git status');
  // Edited: the edit becomes the new draft; Down is plain editor movement again.
  assert.equal(history.next('git status --short'), undefined);
  assert.equal(history.previous('git status --short', () => stored), 'git status');
  assert.equal(history.next('git status'), 'git status --short');
  assert.deepEqual(stored, ['git status', 'npm test'], 'stored history is never mutated');
});

test('navigator: duplicates collapse, the draft itself is not a step, and the snapshot is bounded and read once', () => {
  let reads = 0;
  const many = function* () { reads += 1; for (let index = 0; index < COMPOSER_HISTORY_LIMIT * 3; index += 1) yield `cmd ${index}`; };
  const history = new ComposerHistory();
  history.previous('', many);
  for (let index = 0; index < COMPOSER_HISTORY_LIMIT - 1; index += 1) history.previous(`cmd ${index}`, many);
  assert.equal(history.previous(`cmd ${COMPOSER_HISTORY_LIMIT - 1}`, many), undefined, 'stops at the bound');
  assert.equal(reads, 1, 'one snapshot per navigation, never per keypress');
  assert.equal(history.next(`cmd ${COMPOSER_HISTORY_LIMIT - 1}`), `cmd ${COMPOSER_HISTORY_LIMIT - 2}`);
  const dupes = new ComposerHistory();
  const source = () => ['ls', 'ls', 'pwd', 'ls'];
  assert.equal(dupes.previous('', source), 'ls');
  assert.equal(dupes.previous('ls', source), 'pwd');
  assert.equal(dupes.previous('pwd', source), undefined);
  assert.equal(new ComposerHistory().previous('pwd', source), 'ls', 'the draft is skipped as a step');
});

test('editor: vertical moves report the first/last row boundary; replaceText puts the caret at the end', () => {
  const editor = new CommandEditor();
  assert.equal(editor.moveUp(80), false);
  assert.equal(editor.moveDown(80), false);
  editor.replaceText('one\ntwo\nthree');
  assert.equal(editor.cursorIndex, 13);
  assert.equal(editor.moveDown(80), false, 'caret already on the last line');
  assert.equal(editor.moveUp(80), true);
  assert.equal(editor.moveUp(80), true);
  assert.equal(editor.moveUp(80), false, 'first line reached');
  assert.equal(editor.moveDown(80), true);
});

test('Up/Down decode identically in normal and application cursor mode (every host)', () => {
  for (const sequence of [UP, '\u001BOA']) assert.deepEqual(decodeKeys(sequence), [{kind: 'up'}]);
  for (const sequence of [DOWN, '\u001BOB']) assert.deepEqual(decodeKeys(sequence), [{kind: 'down'}]);
});

function historyApp(commands: string[]) {
  const app = new TerminalApp();
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 24})});
  app['renderer'].render = (() => {}) as never;
  app['session'].resize = (() => {}) as never;
  const written: string[] = [];
  app['session'].write = ((data: string) => { written.push(data); }) as never;
  // Oldest first in, newest first out: later timestamps are newer.
  commands.forEach((command, index) => app['historyService'].index.add(
    {id: historyId('nmsh', `test:${index}`), source: 'nmsh', command, at: 1000 + index} satisfies HistoryEntry));
  return {app, written, text: () => app['editor'].text as string};
}

function stop(app: TerminalApp): void {
  app['stop'](0);
  app['session'].kill();
}

test('composer: Up recalls the latest command, repeats older, Down returns to the original draft; nothing runs', () => {
  const {app, written, text} = historyApp(['npm test', 'git status', 'clear']);
  try {
    app['onInput'](UP);
    assert.equal(text(), 'clear');
    app['onInput'](UP);
    assert.equal(text(), 'git status');
    app['onInput'](UP);
    assert.equal(text(), 'npm test');
    app['onInput'](UP);
    assert.equal(text(), 'npm test', 'no wrap past the oldest');
    app['onInput'](DOWN);
    assert.equal(text(), 'git status');
    app['onInput'](DOWN);
    assert.equal(text(), 'clear');
    app['onInput'](DOWN);
    assert.equal(text(), '', 'the empty draft returns');
    assert.equal(app['editor'].cursorIndex, 0);
    assert.deepEqual(written, [], 'navigation never writes to the shell');
  } finally { stop(app); }
});

test('composer: a typed draft is preserved; editing a recalled command keeps stored history intact', () => {
  const {app, text} = historyApp(['npm test', 'git status']);
  try {
    app['onInput']('git di');
    app['shellSuggestions'] = [];
    app['onInput'](UP);
    assert.equal(text(), 'git status');
    assert.equal(app['editor'].cursorIndex, 'git status'.length, 'caret at the end');
    app['onInput'](DOWN);
    assert.equal(text(), 'git di');
    app['onInput'](UP);
    app['onInput'](' -s');
    assert.equal(text(), 'git status -s');
    assert.deepEqual(app['historyService'].index.all().map(entry => entry.command), ['git status', 'npm test']);
  } finally { stop(app); }
});

test('composer: multiline drafts move by line first, then enter and leave history at the boundaries', () => {
  const {app, text} = historyApp(['echo old']);
  try {
    app['onInput']('first');
    app['onInput']('\n'); // Ctrl+J newline
    app['onInput']('second');
    app['shellSuggestions'] = [];
    assert.equal(text(), 'first\nsecond');
    app['onInput'](UP);
    assert.equal(text(), 'first\nsecond', 'Up moved to the first line, not into history');
    app['onInput'](UP);
    assert.equal(text(), 'echo old', 'Up on the first line enters history');
    app['onInput'](DOWN);
    assert.equal(text(), 'first\nsecond', 'Down past the newest restores the multiline draft');
    app['onInput'](DOWN);
    assert.equal(text(), 'first\nsecond', 'Down on the last line with no navigation does nothing');
  } finally { stop(app); }
});

test('composer: a recalled multiline command navigates its own lines before older history', () => {
  const {app, text} = historyApp(['echo older', 'printf a\nprintf b']);
  try {
    app['onInput'](UP);
    assert.equal(text(), 'printf a\nprintf b');
    app['onInput'](UP);
    assert.equal(text(), 'printf a\nprintf b', 'moved to the first line of the recalled command');
    app['onInput'](UP);
    assert.equal(text(), 'echo older');
  } finally { stop(app); }
});

test('composer: an open completion menu owns Down and Up within it; Up from its first item reaches history', () => {
  const {app, text} = historyApp(['git status']);
  try {
    app['onInput']('gi');
    const candidate = (name: string) => ({value: name, display: name, description: '', kind: 'command', source: 'test', name,
      replacement: {start: 0, end: 2}, context: {buffer: 'gi', cursor: 2, cwd: app['context'].cwd}, insertion: name});
    app['shellSuggestions'] = [candidate('git'), candidate('gitk')] as never;
    app['onInput'](DOWN);
    assert.equal(app['selectedSuggestion'], 1);
    assert.equal(text(), 'gi');
    app['onInput'](UP);
    assert.equal(app['selectedSuggestion'], 0);
    assert.equal(text(), 'gi', 'Up inside the menu moves the selection');
    app['onInput'](UP);
    assert.equal(text(), 'git status', 'Up from the first candidate recalls history');
    assert.equal(app['shellSuggestions'].length, 0, 'a recalled command opens no menu until edited');
  } finally { stop(app); }
});

test('composer: slash suggestions and an open panel keep Up/Down', () => {
  const {app, text} = historyApp(['git status']);
  try {
    app['onInput']('/he');
    app['onInput'](UP);
    assert.equal(text(), '/he', 'slash suggestions own Up');
  } finally { stop(app); }
});

test('composer: private commands are never recalled', () => {
  const {app, text} = historyApp(['echo public', ' echo private']);
  try {
    app['onInput'](UP);
    assert.equal(text(), 'echo public');
  } finally { stop(app); }
});
