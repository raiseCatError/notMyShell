import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSlashCommand, slashSuggestions, suggestionWindow} from '../src/commands/slashCommands.js';
import {calculateScreenLayout} from '../src/app/layout.js';

test('slash autocomplete exposes copy variants and help', () => {
  assert.deepEqual(slashSuggestions('/co').map(item => item.name), ['/copy', '/copy N', '/config']);
  assert.deepEqual(slashSuggestions('/h').map(item => item.name), ['/help', '/history']);
  assert.deepEqual(slashSuggestions('/z').map(item => item.name), ['/zsh']);
  assert.deepEqual(parseSlashCommand('/clear'), {kind: 'clear'});
  assert.deepEqual(parseSlashCommand('/resume'), {kind: 'resume'});
});

test('autocomplete height clamps while keeping the selected candidate visible', () => {
  const values = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(suggestionWindow(values, 4, 2), {items: ['d', 'e'], start: 3});
  const layout = calculateScreenLayout(8, 1, 20, false, false);
  assert.ok(layout.suggestionCount < 20);
  assert.ok(layout.outputHeight >= 2);
});

test('jump, autocomplete, and live rows reserve anchored space outside history', () => {
  const layout = calculateScreenLayout(24, 1, 3, true, true);
  assert.equal(layout.showJump, true);
  assert.equal(layout.showLiveActivity, true);
  assert.equal(layout.suggestionCount, 3);
  assert.equal(layout.outputHeight + layout.inputHeight + layout.suggestionCount
    + Number(layout.showJump) + (layout.showLiveActivity ? 2 : 0)
    + Number(layout.showPrompt) + Number(layout.showSeparator), 24);
});
