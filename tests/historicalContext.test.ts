import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';

test('TerminalApp captures cwd at command submission for its historical header', async () => {
  const app = new TerminalApp();
  app['shellCwd'] = '/tmp';
  app['context'] = {...app['context'], cwd: '/tmp', project: 'tmp'};
  app['editor'].insert('pwd');
  app['session'].submit = () => {};
  try {
    await app['submit']();
    const header = app['output'].wrapped(80).find(row => row.isHistoricalHeader);
    assert.match(header?.plain ?? '', /^ tmp   \/tmp/u);
    assert.ok(header?.ansi.includes('49m'), 'archived prompt edges reset to terminal-neutral background');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
