import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';

test('one-line presentation does not alter exact submission of multiple folded paste atoms', () => {
  const app = new TerminalApp();
  const originalSubmit = app['session'].submit.bind(app['session']);
  const submitted: string[] = [];
  app['promptConfiguration'] = normalizePromptConfiguration({composerLayout: 'oneLine'});
  app['session'].submit = command => submitted.push(command);
  try {
    const first = 'alpha\nbeta\ngamma\ndelta';
    const second = 'one\ntwo\nthree\nfour\nfive';
    app['onInput']('run ');
    app['onInput'](`\u001B[200~${first}\u001B[201~`);
    app['onInput'](' between ');
    app['onInput'](`\u001B[200~${second}\u001B[201~`);
    app['onInput'](' tail');
    assert.match(app['editor'].displayText, /Text #1/u);
    assert.match(app['editor'].displayText, /Text #2/u);
    app['onInput']('\r');

    assert.deepEqual(submitted, [`{ run ${first} between ${second} tail\n}`]);
    assert.ok(!submitted[0]?.includes('Text #'));
  } finally {
    app['session'].submit = originalSubmit;
    app['stop'](0);
    app['session'].kill();
  }
});
