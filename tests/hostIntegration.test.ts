import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectTerminalHost} from '../src/host/terminalHost.js';

test('configuration adapter selection is passive and unavailable outside its host', () => {
  const enhanced = detectTerminalHost({TERM_PROGRAM: 'ghostty'});
  assert.ok(enhanced.integration);
  assert.equal(enhanced.capabilities.appearanceIntegration, true);
  for (const env of [{}, {TERM_PROGRAM: 'Apple_Terminal'}, {TERM_PROGRAM: 'vscode'},
    {TERM_PROGRAM: 'unknown', GHOSTTY_RESOURCES_DIR: ''}, {TERM_PROGRAM: 'ghostty', TMUX: 'socket'}]) {
    assert.equal(detectTerminalHost(env).integration, undefined);
  }
  assert.match(detectTerminalHost({TERM_PROGRAM: 'vscode'}).keyboardGuidance!, /sendSequence/u);
});

test('general frontend, renderer, decoder and shell do not branch on host products', () => {
  for (const file of ['app/TerminalApp.ts', 'terminal/TerminalRenderer.ts', 'shell/ShellSession.ts', 'help/markdown.ts']) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /ghostty|iTerm\.app|WezTerm|Apple_Terminal|KITTY_WINDOW_ID|process\.env\.TERM_PROGRAM|host\.name\s*===/iu, file);
  }
});
