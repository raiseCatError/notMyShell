import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';

test('key diagnostics observe only the idle composer, never startup or program input', () => {
  const previous = process.env.NMSH_DEBUG_KEYS;
  process.env.NMSH_DEBUG_KEYS = '1';
  const app = new TerminalApp();
  const logged: string[] = [], sent: string[] = [];
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'logEditorKeyInput', {value: (data: string) => { logged.push(data); }});
  Object.defineProperty(app['session'], 'write', {value: (data: string) => { sent.push(data); }});
  try {
    app['startupPending'] = true;
    app['onInput']('startup-secret');
    app['startupPending'] = false;
    app['onShellExec']('ask');
    app['passthrough'] = true;
    app['onInput']('hidden-secret\r');
    assert.deepEqual(sent, ['hidden-secret\r']);
    assert.deepEqual(logged, []);
    app['passthrough'] = false;
    app['onInput']('program-answer');
    assert.deepEqual(logged, [], 'running input is private before any probe can classify it');
    app['onShellPrompt'](0, '/tmp');
    app['editor'].clear();
    app['onInput']('idle draft');
    assert.deepEqual(logged, ['idle draft']);
  } finally {
    app['stop'](0); app['session'].kill();
    if (previous === undefined) delete process.env.NMSH_DEBUG_KEYS; else process.env.NMSH_DEBUG_KEYS = previous;
  }
});
