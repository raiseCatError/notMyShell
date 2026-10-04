import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {applyUiTheme} from '../src/appearance/uiTheme.js';
import {layoutInput} from '../src/input/inputLayout.js';
import {GLYPHS} from '../src/ui/glyphs.js';
import {renderHistoricalContext, type HistoricalContextSnapshot} from '../src/output/OutputBuffer.js';
import {DEFAULT_TRANSCRIPT_APPEARANCE} from '../src/prompt/configuration.js';
import {nativePromptSnapshot, themePreviewContext} from '../src/prompt/prompt.js';
import {historicalPromptLevel} from '../src/output/TranscriptPanel.js';
import {stripAnsi} from '../src/util/text.js';
import {describePromptConfiguration, PROVIDER_ORDER} from '../src/prompt/PromptPanel.js';

function harness(config: object): {app: TerminalApp; frames: TerminalFrame[]; cleanup: () => void} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: TerminalFrame[] = [];
  app['renderer'].render = (frame: TerminalFrame) => { frames.push(frame); };
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['configuration'] = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, ...config});
  return {app, frames, cleanup: () => { app['stop'](0); app['session'].kill(); applyUiTheme(undefined); isolation.restore(); }};
}

const plainRows = (frame: TerminalFrame) => frame.rows.map(stripAnsi);

test('Prompt None: normalizes, persists and is a listed provider; describes itself as composer only', () => {
  assert.equal(normalizePromptConfiguration({provider: 'none'}).provider, 'none');
  assert.equal(normalizePromptConfiguration({prompt: {provider: 'none'}}).provider, 'none');
  assert.equal(normalizePromptConfiguration({provider: 'bogus'}).provider, 'nmsh');
  assert.ok(PROVIDER_ORDER.includes('none'));
  assert.equal(describePromptConfiguration(normalizePromptConfiguration({provider: 'none'})), 'None · composer only');
});

test('Prompt None: an explicitly empty prefix means no marker and no continuation indent', () => {
  const bare = layoutInput('echo one\necho two', 0, 40, Infinity, '');
  assert.deepEqual(bare.allRows.map(row => row.prefix), ['', '']);
  assert.equal(bare.caretColumn, 0);
  const normal = layoutInput('echo', 0, 40);
  assert.equal(normal.allRows[0]!.prefix, `${GLYPHS.prompt} `);
});

for (const layout of ['twoLine', 'oneLine'] as const) {
  for (const panelPosition of ['bottom', 'top'] as const) {
    test(`Prompt None (${layout}, panels ${panelPosition}): no prompt row, modules, right prompt or marker; the composer collapses`, async () => {
      const none = harness({provider: 'none', composerLayout: layout, panelPosition, onboardingComplete: true});
      const native = harness({provider: 'nmsh', composerLayout: layout, panelPosition, onboardingComplete: true});
      try {
        for (const instance of [none, native]) {
          await instance.app['refreshProviderPrompt']();
          instance.app['onShellPrompt'](0, process.cwd());
          instance.app['editor'].insert('git status');
          instance.app['render']();
        }
        const noneRows = plainRows(none.frames.at(-1)!);
        const nativeRows = plainRows(native.frames.at(-1)!);
        assert.equal(none.app['hasVisibleProviderPrompt'](), false);
        assert.equal(none.app['currentPromptLine'](80), '');
        assert.ok(noneRows.some(row => row === 'git status' || row.startsWith('git status')), 'the input row is the bare composer');
        assert.ok(!noneRows.some(row => row.includes(`${GLYPHS.prompt} git status`)), 'no prompt symbol');
        const input = noneRows.findIndex(row => row.startsWith('git status'));
        assert.match(noneRows[input - 1] ?? '', /^─+$/u, 'directly under the divider: no prompt/modules row and no blank row');
        assert.match(noneRows[input + 1] ?? '', /^─+$/u, 'the composer is exactly divider, input, divider');
        assert.ok(nativeRows.some(row => row.includes(`${GLYPHS.prompt} git status`)), 'the Native prompt keeps its marker');
        // The rest of the composer keeps working: syntax highlighting still paints the command.
        const frame = none.frames.at(-1)!.rows.find(row => stripAnsi(row).startsWith('git status'))!;
        assert.match(frame, /\u001B\[38;/u, 'syntax colors still apply');
      } finally { none.cleanup(); native.cleanup(); }
    });
  }
}

test('Prompt None history: submissions store no snapshot and render no prompt; switching back restores the prompt', () => {
  const {app, cleanup} = harness({provider: 'none', onboardingComplete: true});
  try {
    app['onShellPrompt'](0, process.cwd());
    app['effectivePromptProvider'] = 'none';
    const context = app['historicalContext'](process.cwd(), {project: 'p', branch: 'main'}, 'ls');
    assert.equal(context.prompt, undefined, 'no prompt snapshot');
    assert.equal(context.promptless, true);
    const header = renderHistoricalContext(context, 60, DEFAULT_TRANSCRIPT_APPEARANCE);
    assert.ok(header && !/p\b.*main/u.test(header.plain), 'no substituted Native prompt');
    assert.match(header!.plain, /^─+$/u, 'only the divider remains');
    assert.equal(renderHistoricalContext(context, 60, {...DEFAULT_TRANSCRIPT_APPEARANCE, divider: false}), undefined);
    app['configuration'] = normalizePromptConfiguration({...app['configuration'], provider: 'nmsh'});
    app['effectivePromptProvider'] = 'nmsh';
    const restored = app['historicalContext'](process.cwd(), {project: 'p', branch: 'main'}, 'ls');
    assert.ok(restored.prompt, 'switching provider restores normal snapshots');
    assert.equal(restored.promptless, undefined);
  } finally { cleanup(); }
});

test('historical prompt Full / Compact / Minimal / Off: presentation only, the snapshot stays complete', () => {
  const context: HistoricalContextSnapshot = {cwd: '/home/me/src', project: 'notMyShell', branch: 'main',
    prompt: nativePromptSnapshot(themePreviewContext('/home/me'), normalizePromptConfiguration({}))};
  const before = JSON.stringify(context);
  const render = (level: 'full' | 'compact' | 'minimal', on = true) =>
    renderHistoricalContext(context, 80, {...DEFAULT_TRANSCRIPT_APPEARANCE, historicalPrompt: on, historicalPromptLevel: level});
  const full = render('full')!.plain;
  const compact = render('compact')!.plain;
  const minimal = render('minimal')!.plain;
  const off = render('full', false)!.plain;
  assert.match(full, /notMyShell/u);
  assert.match(compact, new RegExp(`^notMyShell ${GLYPHS.branch} main ${GLYPHS.prompt} ─+$`, 'u'));
  assert.match(minimal, new RegExp(`^${GLYPHS.prompt} ─+$`, 'u'));
  assert.match(off, /^─+$/u);
  assert.equal(JSON.stringify(context), before, 'stored data is never changed by presentation');
  assert.equal(historicalPromptLevel({...DEFAULT_TRANSCRIPT_APPEARANCE, historicalPrompt: false, historicalPromptLevel: 'compact'}), 'off');
  assert.equal(normalizePromptConfiguration({transcript: {historicalPromptLevel: 'sideways'}}).transcript.historicalPromptLevel, 'full');
  assert.equal(normalizePromptConfiguration({transcript: {historicalPromptLevel: 'minimal'}}).transcript.historicalPromptLevel, 'minimal');
});
