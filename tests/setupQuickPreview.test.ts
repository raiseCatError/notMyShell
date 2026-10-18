import test from 'node:test';
import assert from 'node:assert/strict';
import * as preview from '../src/setup/SetupPreview.js';
import {createQuickSetup, setupKey} from '../src/setup/SetupCat.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

for (const choice of [0, 1, 2]) test(`quick preview ${choice} is finite, deterministic and replays all stages`, () => {
  const f = executionFrameFixture();
  try {
    const state = createQuickSetup(DEFAULT_PROMPT_CONFIGURATION);
    setupKey(state, {kind: 'text', value: String(choice + 1)});
    const frames = [0, 700, 1400, 2400, 3400, 4500, 5700, 7000].map(elapsed => preview.renderQuickPreview(state, 80, 20, elapsed, false));
    assert.notDeepEqual(frames[0]!.rows, frames[3]!.rows);
    assert.deepEqual(preview.renderQuickPreview(state, 80, 20, 0, false), frames[0]);
    assert.equal(frames.at(-1)!.busy, false);
    const text = frames.flatMap(frame => frame.rows).map(stripAnsi).join('\n');
    assert.match(text, choice === 2 ? /Prompt|Look|Motion/ : /Running|Cooking/);
    if (choice === 0) assert.match(text, /442 lines hidden/);
    if (choice === 1) assert.doesNotMatch(text, /Vespyr|Welcome|Chroma/);
    for (const width of [16, 32, 50, 80]) for (const height of [4, 8, 18]) {
      const shown = preview.renderQuickPreview(state, width, height, 2400, false);
      assert.ok(shown.rows.length <= height);
      assert.ok(shown.rows.every(row => displayWidth(row) <= width));
    }
    const still = preview.renderQuickPreview(state, 32, 18, 0, true);
    assert.equal(still.busy, false); assert.ok(still.rows.length > 1);
  } finally { f.dispose(); }
});
