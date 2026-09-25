import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

test('/history parses to one history kind with or without a query', () => {
  assert.deepEqual(parseSlashCommand('/history'), {kind: 'history', query: ''});
  assert.deepEqual(parseSlashCommand('/history '), {kind: 'history', query: ''});
  assert.deepEqual(parseSlashCommand('/history git'), {kind: 'history', query: 'git'});
  assert.deepEqual(parseSlashCommand('/history nonexistent-query'), {kind: 'history', query: 'nonexistent-query'});
  assert.equal(parseSlashCommand('/historyx')?.kind, 'unknown');
  assert.deepEqual(parseSlashCommand('/help'), {kind: 'help'});
  assert.deepEqual(parseSlashCommand('/copy 2'), {kind: 'copy', index: 2});
  assert.equal(parseSlashCommand('/resume')?.kind, 'resume');
});

function historyApp(): {app: TerminalApp; leaked: string[]} {
  const app = new TerminalApp();
  const leaked: string[] = [];
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 24})});
  app['historyService'].getAll = () => ['git status', 'ls -la', 'git log'];
  app['session'].submit = ((data: string) => { leaked.push(data); }) as never;
  app['session'].write = ((data: string) => { leaked.push(data); }) as never;
  return {app, leaked};
}

async function enter(app: TerminalApp): Promise<void> {
  await app['submit']();
}

function transcriptText(app: TerminalApp): string {
  return app['output'].wrapped(80).map((row: {plain: string}) => row.plain).join('\n');
}

test('bare /history enters the same search state as the slash suggestion', async () => {
  const {app, leaked} = historyApp();
  try {
    app['editor'].insert('/history');
    await enter(app);
    assert.equal(app['editor'].text, '/history ');
    assert.deepEqual(app['composerSuggestions']().map((s: {name: string}) => s.name), ['git status', 'ls -la', 'git log']);
    assert.deepEqual(leaked, [], 'nothing reaches zsh');
    assert.doesNotMatch(transcriptText(app), /Unknown NMSh command|\/history/u, 'no transcript entry');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('/history query filters, arrows select, and Enter restores the match without running it', async () => {
  const {app, leaked} = historyApp();
  try {
    app['editor'].insert('/history git');
    assert.deepEqual(app['composerSuggestions']().map((s: {name: string}) => s.name), ['git status', 'git log']);
    app['handleKey']({kind: 'down'});
    await enter(app);
    assert.equal(app['editor'].text, 'git log', 'selected match restored into the editor');
    assert.deepEqual(leaked, []);
    assert.doesNotMatch(transcriptText(app), /Unknown NMSh command/u);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('Tab applies the selected history match', () => {
  const {app} = historyApp();
  try {
    app['editor'].insert('/history ls');
    app['handleKey']({kind: 'complete'});
    assert.equal(app['editor'].text, 'ls -la');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('/history with no match keeps the search open and reports nothing', async () => {
  const {app, leaked} = historyApp();
  try {
    app['editor'].insert('/history nonexistent-query');
    await enter(app);
    assert.equal(app['editor'].text, '/history nonexistent-query');
    assert.deepEqual(app['composerSuggestions'](), []);
    assert.deepEqual(leaked, []);
    assert.doesNotMatch(transcriptText(app), /Unknown NMSh command/u);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
