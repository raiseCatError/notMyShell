import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {stripAnsi} from '../src/util/text.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';

test('one-line prompt and editor share a row inside composer boundaries for either legacy placement', () => {
  for (const placement of ['header', 'composer'] as const) {
    const app = new TerminalApp();
    app['promptConfiguration'] = normalizePromptConfiguration({composerLayout: 'oneLine', placement});
    app['context'] = {cwd: '/tmp/work', project: 'work', branch: 'dev', exitStatus: 7};
    app['editor'].insert('echo ready');
    app['running'] = {command: 'echo ready', startedAt: Date.now(), interrupted: false, cleared: false, startId: 0};
    const frames: TerminalFrame[] = [];
    app['renderer'].render = frame => frames.push(frame);
    try {
      app['render']();
      const frame = frames.at(-1);
      assert.ok(frame);
      const plainRows = frame.rows.map(stripAnsi);
      const commandRow = plainRows.findIndex(row => row.includes('/tmp/work')
        && row.includes(' dev') && row.includes('✘ 7') && row.includes('❯ echo ready'));
      const boundary = '─'.repeat(Math.max(1, process.stdout.columns || 80));
      const upperBoundary = plainRows.indexOf(boundary);
      const lowerBoundary = plainRows.lastIndexOf(boundary);
      const activityRow = plainRows.findIndex(row => row.includes('Running echo ready'));

      assert.ok(upperBoundary >= 0, 'one-line layout retains an upper composer boundary');
      assert.ok(commandRow > upperBoundary, 'context and editable command appear below the upper boundary');
      assert.ok(commandRow < lowerBoundary, 'context and editable command appear above the lower boundary');
      assert.equal(plainRows.some(row => row.includes(' dev') && !row.includes('echo ready')), false,
        'one-line layout has no separate context/header row');
      assert.ok(frame.cursorColumn > 1, 'cursor remains positioned after the presentation prefix');
      assert.equal(frame.cursorRow - 1, commandRow, 'cursor stays on the combined context and command row');
      assert.ok(activityRow >= 0, 'primary live activity remains visible above the composer');
      assert.equal(plainRows[activityRow + 1], '', 'the existing activity breathing-space row remains');
      assert.equal(plainRows[activityRow + 2], boundary, 'composer layout adds no row above primary activity');
    } finally {
      app['stop'](0);
      app['session'].kill();
    }
  }
});

test('two-line layout keeps context separate from the editable command', () => {
  const app = new TerminalApp();
  app['promptConfiguration'] = normalizePromptConfiguration({composerLayout: 'twoLine', placement: 'header'});
  app['context'] = {cwd: '/tmp/work', project: 'work', branch: 'dev', exitStatus: 7};
  app['editor'].insert('echo ready');
  const frames: TerminalFrame[] = [];
  app['renderer'].render = frame => frames.push(frame);
  try {
    app['render']();
    const frame = frames.at(-1);
    assert.ok(frame);
    const plainRows = frame.rows.map(stripAnsi);
    const contextRow = plainRows.findIndex(row => row.includes('/tmp/work') && row.includes(' dev') && !row.includes('echo ready'));
    const commandRow = plainRows.findIndex(row => row.includes('❯ echo ready'));
    assert.ok(contextRow >= 0);
    assert.ok(commandRow > contextRow);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
