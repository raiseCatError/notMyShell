import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPromptLine} from '../src/prompt/prompt.js';
import {shimmerText} from '../src/status/shimmer.js';
import {foreground, UI_COLORS} from '../src/ui/palette.js';

test('NMSh palette emits deterministic truecolor sequences', () => {
  for (const color of Object.values(UI_COLORS)) {
    assert.match(foreground(color), /^\u001B\[38;2;\d+;\d+;\d+m$/u);
  }
  const prompt = buildPromptLine({cwd: '/tmp/project', project: 'project', branch: 'main'}, 60);
  assert.match(prompt, /48;2;166;124;243/u);
  assert.match(prompt, /48;2;148;106;219/u);
  assert.match(prompt, //u);
  assert.match(prompt, /38;2;\d+;\d+;\d+m/u);
  assert.match(shimmerText('Meowing', 100), /38;2;\d+;\d+;\d+m/u);
  assert.match(foreground(UI_COLORS.success), /38;2;116;181;154/u);
  assert.match(foreground(UI_COLORS.failure), /38;2;205;115;123/u);
  assert.match(foreground(UI_COLORS.accent), /38;2;197;185;232/u);
  assert.match(foreground(UI_COLORS.separator), /38;2;139;132;178/u);
});
