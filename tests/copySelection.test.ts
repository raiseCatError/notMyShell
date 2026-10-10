import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {copiedNote, copySelectionPayload, parseCopyArgs, recordCopyText, resolveCopySelection, type CopySelector} from '../src/clipboard/copySelection.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {blockCopyPayload, blockControlsLayout} from '../src/ui/BlockActions.js';
import {copyPickerKey, copyPickerRows, createCopyPicker, renderCopyPicker} from '../src/ui/CopyPicker.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {exportSettings, PORTABLE_CATEGORIES} from '../src/configuration/portability.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';

function run(buffer: OutputBuffer, command: string, output: string, exitCode: number, lifecycle: string) {
  buffer.beginCommand(command, [`❯ ${command}`]);
  buffer.write(output);
  const record = buffer.complete(exitCode)!;
  buffer.setCompletionLifecycle(lifecycle);
  return record;
}

/** Five commands, oldest first: one, two (failed), silent, four (multi-line), five. /copy 1 is "five". */
function transcript() {
  const buffer = new OutputBuffer();
  run(buffer, 'echo one', 'one\r\n', 0, '✔ Completed · 4 ms · 10:01');
  run(buffer, 'false-ish', 'boom\r\n', 2, '✘ Command failed · exit 2 · 12.9s · 10:02');
  run(buffer, 'true', '', 0, '✔ Completed · 2 ms · 10:03');
  run(buffer, 'printf multi', 'a\r\n\r\n  b\r\n', 0, '✔ Completed · 1.4s · 10:04 · 3.1s waiting for input');
  run(buffer, 'echo five', 'five\r\n', 0, '✔ Completed · 3 ms · 10:05');
  return buffer;
}

const ok = (text: string) => {
  const parsed = parseCopyArgs(text);
  assert.ok(parsed.ok, `${text}: ${parsed.ok ? '' : parsed.error}`);
  return parsed.request;
};
const selector = (text: string) => ok(text).selector as Extract<CopySelector, {kind: 'latest' | 'indices'}>;

test('parse: every form, flags in any position, and precise errors; -N is a count, --flags are never counts', () => {
  assert.deepEqual(ok(''), {selector: {kind: 'default'}});
  assert.deepEqual(ok('latest'), {selector: {kind: 'latest', count: 1}});
  assert.deepEqual(ok('ui'), {selector: {kind: 'picker'}});
  assert.deepEqual(ok('2'), {selector: {kind: 'indices', indices: [2]}});
  assert.deepEqual(ok('-3'), {selector: {kind: 'latest', count: 3}});
  assert.deepEqual(ok('2-4'), {selector: {kind: 'indices', indices: [2, 3, 4]}});
  assert.deepEqual(ok('4-2'), {selector: {kind: 'indices', indices: [2, 3, 4]}}, 'either order');
  assert.deepEqual(ok('1,3,5'), {selector: {kind: 'indices', indices: [1, 3, 5]}});
  assert.deepEqual(ok('1-3,6,8'), {selector: {kind: 'indices', indices: [1, 2, 3, 6, 8]}});
  assert.deepEqual(ok('1-3,2,3-4'), {selector: {kind: 'indices', indices: [1, 2, 3, 4]}}, 'overlaps deduplicated');
  assert.deepEqual(ok('-3 --status'), {selector: {kind: 'latest', count: 3}, status: true});
  assert.deepEqual(ok('--no-status 2-4'), {selector: {kind: 'indices', indices: [2, 3, 4]}, status: false});
  assert.deepEqual(ok('--status'), {selector: {kind: 'default'}, status: true});
  for (const bad of ['0', '-0', '2-', 'x', '1,,2', '--state', '1 2', '1000', '-101', '1-200', 'ui 2']) {
    const parsed = parseCopyArgs(bad);
    assert.equal(parsed.ok, false, bad);
  }
  assert.match((parseCopyArgs('--status --no-status') as {error: string}).error, /either --status or --no-status/u);
});

test('/cp is /copy: the same parse for every form', () => {
  for (const args of ['', '2', '-3', '2-4', '1,3,5', 'ui', 'latest', '-3 --status', 'settings']) {
    assert.deepEqual(parseSlashCommand(`/cp${args ? ` ${args}` : ''}`), parseSlashCommand(`/copy${args ? ` ${args}` : ''}`), args);
  }
  assert.deepEqual(parseSlashCommand('/cp -3 --status'), {kind: 'copy', args: '-3 --status'});
  assert.deepEqual(parseSlashCommand('/copy settings'), {kind: 'copySettings'});
  assert.equal(parseSlashCommand('/cpx')?.kind, 'unknown', 'only the exact alias');
});

test('resolve: oldest first; a missing number refuses the whole copy; -N takes what there is', () => {
  const recent = transcript().recentShellCommands();
  const commands = (text: string) => {
    const resolved = resolveCopySelection(selector(text), recent);
    assert.ok(resolved.ok, text);
    return resolved.records.map(record => record.command);
  };
  assert.deepEqual(commands('1'), ['echo five']);
  assert.deepEqual(commands('-3'), ['true', 'printf multi', 'echo five']);
  assert.deepEqual(commands('2-4'), ['false-ish', 'true', 'printf multi']);
  assert.deepEqual(commands('5,1,3'), ['echo one', 'true', 'echo five']);
  assert.deepEqual(commands('-9'), ['echo one', 'false-ish', 'true', 'printf multi', 'echo five']);
  const missing = resolveCopySelection(selector('1,7'), recent);
  assert.equal(missing.ok, false);
  assert.match((missing as {error: string}).error, /No completed command output at 7: there are only 5 completed commands\. Nothing was copied\./u);
  assert.equal(resolveCopySelection(selector('1'), []).ok, false);
});

test('payload: output only by default; with status each record\'s own recorded status follows its own output', () => {
  const recent = transcript().recentShellCommands();
  const pick = (text: string) => (resolveCopySelection(selector(text), recent) as {records: typeof recent}).records;
  assert.equal(copySelectionPayload(pick('2-4'), false), 'boom\na\n\n  b', 'silent commands add nothing; no status rows');
  assert.equal(copySelectionPayload(pick('2-4'), true),
    'boom\n✘ Command failed · exit 2 · 12.9s · 10:02\n✔ Completed · 2 ms · 10:03\na\n\n  b\n✔ Completed · 1.4s · 10:04 · 3.1s waiting for input');
  assert.equal(copySelectionPayload(pick('3'), false), '', 'a silent command alone copies nothing');
  assert.equal(copySelectionPayload(pick('3'), true), '✔ Completed · 2 ms · 10:03', 'status was asked for: it alone is copied');
  // The stored output is never changed by including the status.
  assert.equal(recent[1]!.output, 'a\n\n  b');
  assert.equal(recordCopyText(recent[0]!, true), 'five\n✔ Completed · 3 ms · 10:05');
  assert.match(copiedNote(3, {characters: 3501, lines: 12}, true), /^Copied 3 outputs with completion status · 3,501 characters · 12 lines$/u);
  assert.equal(copiedNote(1, {characters: 1, lines: 1}, false), 'Copied · 1 character · 1 line');
});

test('folded and restored transcripts copy the full stored output, with the same status', () => {
  const buffer = transcript();
  const long = Array.from({length: 400}, (_, index) => `line ${index}`).join('\r\n');
  run(buffer, 'seq', `${long}\r\n`, 0, '✔ Completed · 9 ms · 10:06');
  const restored = new OutputBuffer();
  restored.restoreTranscript(buffer.transcript());
  for (const source of [buffer, restored]) {
    const [record] = source.recentShellCommands();
    assert.equal(recordCopyText(record!, true).split('\n').length, 401);
    assert.ok(recordCopyText(record!, true).endsWith('line 399\n✔ Completed · 9 ms · 10:06'));
  }
});

test('block actions: Copy output and Copy command + output follow the status setting; Copy command never does', () => {
  const record = transcript().recentShellCommands()[3]!;
  assert.equal(blockCopyPayload(record, 'copyOutput', false), 'boom');
  assert.equal(blockCopyPayload(record, 'copyOutput', true), 'boom\n✘ Command failed · exit 2 · 12.9s · 10:02');
  assert.equal(blockCopyPayload(record, 'copyBoth', true), 'false-ish\nboom\n✘ Command failed · exit 2 · 12.9s · 10:02');
  assert.equal(blockCopyPayload(record, 'copyCommand', true), 'false-ish');
});

test('block controls: Copy beside Actions where room allows; "Copied" never moves Actions; narrow keeps Actions only', () => {
  const wide = blockControlsLayout(20, 100)!;
  const copied = blockControlsLayout(20, 100, {copied: true})!;
  assert.ok(wide.suffix.endsWith('[Copy] [Actions]'));
  assert.ok(copied.suffix.endsWith('[✓ Copied] [Actions]'));
  assert.ok(blockControlsLayout(20, 100, {copied: true, safe: true})!.suffix.endsWith('[+ Copied] [Actions]'), 'Safe glyphs');
  assert.equal(wide.column, copied.column, 'Actions stays put');
  assert.equal(displayWidth(wide.suffix), 80);
  assert.equal(displayWidth(copied.suffix), 80);
  // Click targets are exactly the labels' cells.
  const row = ' '.repeat(20) + wide.suffix;
  assert.equal(row.slice(wide.copy!.column - 1, wide.copy!.end), '[Copy]');
  assert.equal(row.slice(wide.column - 1), '[Actions]');
  const narrow = blockControlsLayout(20, 40)!;
  assert.equal(narrow.copy, undefined);
  assert.ok(narrow.suffix.endsWith('[Actions]'));
  assert.equal(blockControlsLayout(35, 40), undefined, 'never covers the row\'s own text');
});

test('picker: newest first with /copy numbers; Space selects, a toggles all, search keeps selections, Enter copies oldest first', () => {
  const picker = createCopyPicker(transcript().recentShellCommands(), false);
  assert.deepEqual(copyPickerRows(picker).map(row => [row.number, row.record.command]).slice(0, 2), [[1, 'echo five'], [2, 'printf multi']]);
  // Enter with nothing chosen copies the highlighted row.
  assert.deepEqual((copyPickerKey(structuredClone(picker), {kind: 'enter'}) as {records: Array<{command: string}>}).records.map(record => record.command), ['echo five']);
  copyPickerKey(picker, {kind: 'text', value: ' '});
  copyPickerKey(picker, {kind: 'down'});
  copyPickerKey(picker, {kind: 'text', value: ' '});
  // Search narrows the rows; the chosen ones stay chosen.
  copyPickerKey(picker, {kind: 'text', value: '/'});
  for (const char of 'boom') copyPickerKey(picker, {kind: 'text', value: char});
  assert.deepEqual(copyPickerRows(picker).map(row => row.number), [4]);
  copyPickerKey(picker, {kind: 'enter'});
  copyPickerKey(picker, {kind: 'text', value: ' '});
  copyPickerKey(picker, {kind: 'escape'});
  assert.equal(picker.query, '', 'Esc clears the search first');
  copyPickerKey(picker, {kind: 'text', value: 's'});
  const action = copyPickerKey(picker, {kind: 'enter'});
  assert.equal(action?.kind, 'copy');
  if (action?.kind !== 'copy') return;
  assert.deepEqual(action.records.map(record => record.command), ['false-ish', 'true', 'echo five']);
  assert.equal(action.includeStatus, true);
  const all = createCopyPicker(transcript().recentShellCommands(), false);
  copyPickerKey(all, {kind: 'text', value: 'a'});
  assert.equal(all.chosen.size, 5);
  copyPickerKey(all, {kind: 'text', value: 'a'});
  assert.equal(all.chosen.size, 0, 'a again deselects all');
  assert.equal(copyPickerKey(all, {kind: 'escape'})?.kind, 'close');
});

test('picker render: says whether statuses are included before Enter; fits narrow widths; previews sanitized output', () => {
  const buffer = transcript();
  run(buffer, 'evil', 'safe\u001b]52;c;Zm9v\u0007 \u001b[31mred\r\n', 0, '✔ Completed · 1 ms · 10:07');
  const picker = createCopyPicker(buffer.recentShellCommands(), true);
  for (const columns of [100, 40, 28]) {
    const lines = renderCopyPicker(picker, columns, 24).map(stripAnsi);
    assert.ok(lines.every(line => displayWidth(line) <= columns), `${columns} columns`);
    assert.match(lines.join('\n'), /Completion status: (?:included|not included)|Completion status/u);
  }
  const text = renderCopyPicker(picker, 100, 30).join('\n');
  assert.match(stripAnsi(text), /Completion status: included after each output \(s\)/u);
  assert.doesNotMatch(text, /\u001b\]52/u, 'program output never reaches the terminal as control sequences');
  picker.includeStatus = false;
  assert.match(stripAnsi(renderCopyPicker(picker, 100, 30).join('\n')), /Completion status: not included/u);
});

test('settings: Quick Copy and status Off by default; normalized; exported and imported with the copy category', () => {
  assert.deepEqual(DEFAULT_PROMPT_CONFIGURATION.copy, {mode: 'quick', includeStatus: false, autoExpand: false});
  assert.deepEqual(normalizePromptConfiguration({copy: {mode: 'picker', includeStatus: true}} as never).copy, {mode: 'picker', includeStatus: true, autoExpand: false});
  assert.deepEqual(normalizePromptConfiguration({copy: {mode: 'weird', includeStatus: 'yes'}} as never).copy, {mode: 'quick', includeStatus: false, autoExpand: false});
  assert.deepEqual(PORTABLE_CATEGORIES.copy, ['copy']);
  const exported = exportSettings({...DEFAULT_PROMPT_CONFIGURATION, copy: {mode: 'picker', includeStatus: true, autoExpand: false}}, ['copy']);
  assert.deepEqual(exported.categories.copy, {copy: {mode: 'picker', includeStatus: true, autoExpand: false}});
});
