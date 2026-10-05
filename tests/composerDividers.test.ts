import test from 'node:test';
import assert from 'node:assert/strict';
import {planScreen, type ScreenPlanInput} from '../src/app/screenPlan.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';

const base = (extra: Partial<ScreenPlanInput> = {}): ScreenPlanInput => ({rows: 30, inputRows: 1, suggestions: 3, running: true, detached: false, hasOutput: true,
  contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition: 'bottom', transcriptRows: 200, ...extra});
const kinds = (input: ScreenPlanInput) => planScreen(input).regions.map(region => region.kind);
const rules = (input: ScreenPlanInput) => planScreen(input).regions.filter(region => region.kind === 'separator' || region.kind === 'composerBorder').reduce((sum, region) => sum + region.height, 0);

test('setting: Composer dividers defaults On, lives in Layout, separate from transcript dividers', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.composerDividers, true);
  assert.equal(normalizePromptConfiguration({}).composerDividers, true, 'existing configs keep today\'s look');
  const off = normalizePromptConfiguration({composerDividers: false});
  assert.equal(off.composerDividers, false);
  assert.equal(off.transcript.divider, DEFAULT_PROMPT_CONFIGURATION.transcript.divider, 'history dividers are independent');
  assert.equal(SETTINGS_ROWS.find(row => row.id === 'composerDividers')!.category, 'Layout');
});

test('On keeps the current geometry; Off has no rule rows and gives them to the transcript, in every position and layout', () => {
  for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
    for (const composerLayout of ['oneLine', 'twoLine'] as const) {
      for (const contextPlacement of ['header', 'composer'] as const) {
        const input = base({composerPosition, composerLayout, contextPlacement});
        const on = planScreen(input);
        assert.deepEqual(on, planScreen({...input, composerDividers: true}), 'explicit On equals the default');
        const off = planScreen({...input, composerDividers: false});
        const removed = rules(input);
        assert.equal(rules({...input, composerDividers: false}), 0, `${composerPosition}/${composerLayout}/${contextPlacement}`);
        assert.ok(removed > 0);
        assert.equal(off.ptyRows, on.ptyRows + removed, 'the rows are reclaimed, not left blank');
        assert.equal(off.regions.reduce((sum, region) => sum + region.height, 0), on.regions.reduce((sum, region) => sum + region.height, 0), 'nothing phantom');
        // Contiguous regions: no gaps where the rules were.
        let top = 0;
        for (const region of off.regions) { assert.equal(region.top, top); top += region.height; }
        if (composerLayout === 'twoLine') assert.ok(kinds({...input, composerDividers: false}).includes('prompt'), 'the prompt row (prompt-as-divider) stays');
      }
    }
  }
});

test('Off with live activity, suggestions and narrow/short terminals stays valid', () => {
  for (const rows of [4, 6, 9, 30]) {
    const plan = planScreen(base({rows, composerDividers: false}));
    assert.ok(plan.regions.reduce((sum, region) => sum + region.height, 0) <= rows);
    assert.ok(plan.inputHeight >= 1);
    assert.ok(!plan.regions.some(region => region.kind === 'separator' || region.kind === 'composerBorder'));
  }
});

test('app: the frame plan follows the setting; with no live rule, Chroma Divider lines has nothing to paint', async () => {
  const {TerminalApp} = await import('../src/app/TerminalApp.js');
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  try {
    instance['promptConfiguration'] = {...instance['promptConfiguration'], composerDividers: false,
      presentation: {...instance['promptConfiguration'].presentation, preset: 'aurora', motion: 'travel', rules: true}};
    const plan = instance['planFrame'](100, 30);
    assert.ok(!plan.regions.some((region: {kind: string}) => region.kind === 'separator' || region.kind === 'composerBorder'));
    instance['promptConfiguration'] = {...instance['promptConfiguration'], composerDividers: true};
    assert.ok(instance['planFrame'](100, 30).regions.some((region: {kind: string}) => region.kind === 'separator'));
  } finally { instance['stop'](0); instance['session'].kill(); }
});
