import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {CHAT_MIN_WIDTH, chatColumn} from '../src/output/TranscriptPresenter.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

function transcript(): OutputBuffer {
  const output = new OutputBuffer();
  output.beginCommand('git status', ['\u001B[35m❯ git status\u001B[0m'], undefined, {cwd: '/tmp/project', branch: 'main'});
  output.write('On branch main\r\nnothing to commit\r\n');
  output.complete(0);
  output.beginCommand('echo 世界 \\\n  && ls', ['❯ echo 世界 \\', '  && ls'], undefined, {cwd: '/tmp/project'});
  output.write('世界\r\nfile\r\n');
  output.complete(0);
  return output;
}

test('Chat right-aligns command blocks in a bounded column; output stays left and identical', () => {
  const output = transcript();
  const normal = output.wrapped(100);
  output.presenter.setLayout('chat');
  const chat = output.wrapped(100);
  const column = chatColumn(100)!;
  assert.equal(chat.length, normal.length);
  const commandRows = chat.filter(row => row.lineIndex !== undefined && output.lineTypes.get(row.lineIndex) === 'command');
  assert.equal(commandRows.length, 3);
  for (const row of commandRows) {
    assert.ok((row.indent ?? 0) > 0, 'command rows are indented');
    assert.ok(displayWidth(row.plain) <= 100);
  }
  assert.equal(displayWidth(commandRows[0]!.plain), 100, 'a one-line block ends at the right edge');
  const multi = commandRows.slice(1);
  assert.equal(multi[0]!.indent, multi[1]!.indent, 'a multi-line block keeps one left edge');
  assert.equal(stripAnsi(multi[1]!.plain).trimStart(), '&& ls', 'command text is unchanged');
  for (const header of chat.filter(row => row.isHistoricalHeader)) {
    assert.equal(displayWidth(header.plain.trimStart()), column, 'the divider is local to the command column');
    assert.equal(displayWidth(header.plain), 100, 'the header sits on the command side');
  }
  const outputRows = (rows: typeof chat) => rows.filter(row => !row.isHistoricalHeader
    && !(row.lineIndex !== undefined && output.lineTypes.get(row.lineIndex) === 'command')).map(row => row.ansi);
  assert.deepEqual(outputRows(chat), outputRows(normal), 'output rows are untouched');
});

test('narrow terminals fall back to Normal rows', () => {
  const output = transcript();
  const width = CHAT_MIN_WIDTH - 1;
  const normal = output.wrapped(width);
  output.presenter.setLayout('chat');
  assert.equal(chatColumn(width), undefined);
  assert.deepEqual(output.wrapped(width), normal);
});

test('toggling Chat changes nothing stored: transcript, copy payload and fold state', () => {
  const output = transcript();
  const before = JSON.stringify(output.transcript());
  const copy = serializeCopyPayload(output.recent(2)!);
  output.presenter.setLayout('chat');
  output.wrapped(120);
  output.toggleExpanded(0);
  output.toggleExpanded(0);
  assert.equal(JSON.stringify(output.transcript()), before);
  assert.equal(serializeCopyPayload(output.recent(2)!), copy);
  assert.ok(!copy.startsWith(' '), 'no alignment padding in /copy');
});

test('surfaces start after the alignment padding; sticky headers align like their block', () => {
  const output = transcript();
  output.presenter.setLayout('chat');
  const rows = output.wrapped(100);
  const command = rows.find(row => row.lineIndex === 0 && !row.isHistoricalHeader)!;
  const painted = output.presenter.decorate(command, 'command', {now: 0});
  assert.ok(painted.startsWith(' '.repeat(command.indent!)), 'padding is not painted');
  assert.match(painted.slice(command.indent!), /^\u001B\[48;2;38;38;48m/u);
  const sticky = output.presentSticky(0, 100)!;
  assert.equal(displayWidth(stripAnsi(sticky)), 100);
  assert.ok(sticky.startsWith(' '));
  output.presenter.setLayout('normal');
  assert.ok(output.presentSticky(0, 100)!.startsWith('\u001B[48;2;38;38;48m'));
});

test('resumed transcripts re-render in Chat; presentation is independent of composer position', () => {
  const restored = new OutputBuffer();
  restored.restoreTranscript(transcript().transcript());
  restored.presenter.setLayout('chat');
  assert.ok(restored.wrapped(100).some(row => (row.indent ?? 0) > 0));
  assert.equal(normalizePromptConfiguration({}).transcriptPresentation, 'normal');
  const both = normalizePromptConfiguration({transcriptPresentation: 'chat', composerPosition: 'top'});
  assert.deepEqual([both.transcriptPresentation, both.composerPosition], ['chat', 'top']);
  assert.equal(normalizePromptConfiguration({transcriptPresentation: 'chat'}).composerPosition, 'bottom');
  const row = SETTINGS_ROWS.find(candidate => candidate.id === 'transcriptPresentation')!;
  assert.ok(row.control === 'enum');
  assert.deepEqual(row.options, ['Normal', 'Chat']);
});
