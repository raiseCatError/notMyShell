import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {createCopyPicker, copyPickerKey, renderCopyPicker} from '../src/ui/CopyPicker.js';
import {createComparePanel, comparePanelKey, renderComparePanel} from '../src/ui/ComparePanel.js';
import {copyableDiff} from '../src/output/compare.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';

// Color capability is established before module import, as in a real frontend. Run this file once per environment.
for (const mode of (process.env.NO_COLOR ? ['safe-no-color'] as const : ['normal'] as const)) {
  test(`${mode}: output focus uses production theme band, picker membership uses checkmarks, Compare is framed and scroll reaches final change`, async () => {
    const f = executionFrameFixture(32, 30, mode);
    try {
      f.begin('first', Array.from({length: 50}, (_, i) => `old ${i}`).join('\n') + '\n'); f.complete();
      f.begin('second', Array.from({length: 50}, (_, i) => `new ${i}`).join('\n') + '\n'); f.complete();
      const records = f.app['output'].recentShellCommands();
      await f.app['copySlash']('/cp', '');
      const copy = f.capture().frame.rows;
      assert.ok(copy.some(row => mode === 'normal' ? /\u001b\[48;/u.test(row) : /\u001b\[7m/u.test(row)), 'visible focused output has theme band or reverse fallback');
      assert.ok(copy.every(row => displayWidth(row) <= 32));
      f.app['handleKey']({kind: 'escape'});
      const picker = createCopyPicker(records, false); copyPickerKey(picker, {kind: 'text', value: ' '});
      const chosen = renderCopyPicker(picker, 32, 24);
      assert.doesNotMatch(stripAnsi(chosen.join('\n')), /\[[ x]\]/u);
      assert.match(stripAnsi(chosen.join('\n')), mode === 'normal' ? /✔/u : /\+/u);
      assert.ok(chosen.some(row => mode === 'normal' ? /\u001b\[48;/u.test(row) : /\u001b\[7m/u.test(row)), 'focus is independent of membership');
      const chooser = createComparePanel(records[0]!, records);
      assert.match(stripAnsi(renderComparePanel(chooser, 32, 7).join('\n')), /first/u, 'short chooser shows the candidate Enter would compare');
      const panel = createComparePanel(records[0]!, records, records[1]);
      const diff = copyableDiff(panel.comparison!);
      for (const columns of [8, 20, 32, 80, 160]) {
        for (const height of [9, 12, 14, 24]) {
          for (let n = 0; n < 100; n++) comparePanelKey(panel, {kind: 'pageDown'}, columns, height);
          const rendered = renderComparePanel(panel, columns, height);
          assert.ok(rendered.length <= height);
          assert.ok(rendered.every(row => displayWidth(row) <= columns));
          assert.match(stripAnsi(rendered[0]!), mode === 'normal' ? /^─+$/u : /^-+$/u);
          if (columns >= 32) assert.match(stripAnsi(rendered.join('\n')), /Esc back/u, 'short panels retain escape control');
          assert.match(stripAnsi(rendered.at(-1)!), mode === 'normal' ? /^─+$/u : /^-+$/u);
          if (columns >= 32) assert.match(stripAnsi(rendered.join('\n')), /old 49/u, 'scroll geometry reaches final row');
          assert.equal(copyableDiff(panel.comparison!), diff, 'framing never changes clipboard diff');
        }
      }
      if (mode === 'safe-no-color') assert.doesNotMatch([...copy, ...chosen].join(''), /\u001b\[(?:38|48);/u);
    } finally { f.dispose(); }
  });
}
