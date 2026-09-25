import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextLine, buildInlineContextPrefix, buildRightContext, nativePromptSnapshot, renderedModules} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, modulePlacement, normalizePromptConfiguration, type ContextModuleId, type PromptConfiguration} from '../src/prompt/configuration.js';
import {renderHistoricalContext} from '../src/output/OutputBuffer.js';
import {DEFAULT_TRANSCRIPT_APPEARANCE} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {PromptContext} from '../src/shell/ShellContext.js';

const context: PromptContext = {
  cwd: '/work/notMyShell',
  project: 'notMyShell',
  branch: 'main',
  git: {staged: 2, modified: 1, untracked: 0, conflicts: 0, ahead: 1, behind: 0},
  toolchains: ['node'],
  exitStatus: 1,
};

function withRight(ids: ContextModuleId[], base: PromptConfiguration = DEFAULT_PROMPT_CONFIGURATION): PromptConfiguration {
  const configuration = structuredClone(base);
  configuration.modules = configuration.modules.map(module => ids.includes(module.id) ? {...module, placement: 'right' as const} : module);
  return configuration;
}

test('placement defaults left, only low-priority modules may move right, and it persists', () => {
  assert.ok(DEFAULT_PROMPT_CONFIGURATION.modules.every(module => modulePlacement(module) === 'left'), 'default appearance is unchanged');
  const config = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'always', placement: 'right'},
    {id: 'cwd', visible: true, condition: 'always', placement: 'right'},
    {id: 'gitBranch', visible: true, condition: 'inRepository', placement: 'right'},
    {id: 'gitStatus', visible: true, condition: 'inRepository', placement: 'right'},
    {id: 'toolchain', visible: true, condition: 'always', placement: 'right'},
    {id: 'exitStatus', visible: true, condition: 'nonzeroExit', placement: 'bogus'},
  ]});
  assert.deepEqual(config.modules.map(module => modulePlacement(module)), ['left', 'left', 'left', 'right', 'right', 'left']);
  assert.deepEqual(normalizePromptConfiguration(JSON.parse(JSON.stringify(config))).modules, config.modules);
});

test('v0.3 configs gain Git status right after the branch, wherever it was moved, with its visibility', () => {
  const config = normalizePromptConfiguration({modules: [
    {id: 'gitBranch', visible: false, condition: 'inRepository'},
    {id: 'project', visible: true, condition: 'always'},
    {id: 'cwd', visible: true, condition: 'always'},
  ]});
  assert.deepEqual(config.modules.map(module => module.id), ['gitBranch', 'gitStatus', 'project', 'cwd', 'toolchain', 'exitStatus']);
  assert.equal(config.modules[1]!.visible, false);
});

test('all-left prompts render exactly as before the right area existed', () => {
  for (const width of [20, 40, 80, 140]) {
    const line = buildContextLine(context, width, DEFAULT_PROMPT_CONFIGURATION, 'header');
    assert.equal(displayWidth(line), width);
    assert.ok(stripAnsi(line).includes('notMyShell'));
  }
  assert.ok(!/─ \S/u.test(stripAnsi(buildContextLine(context, 140, DEFAULT_PROMPT_CONFIGURATION, 'header'))), 'nothing after the divider');
});

test('right context sits at the right edge in header and composer placement', () => {
  const config = withRight(['gitStatus', 'exitStatus']);
  for (const placement of ['header', 'composer'] as const) {
    const plain = stripAnsi(buildContextLine(context, 120, config, placement));
    assert.equal(displayWidth(plain), 120, placement);
    const branch = plain.indexOf('main*');
    const staged = plain.indexOf('+2');
    assert.ok(branch !== -1 && staged > branch + 10, `${placement}: the branch stays left, Git state moves right`);
    assert.ok(plain.slice(-6).includes('1'), `${placement}: the exit status ends the row`);
  }
});

test('narrow widths drop right context before any left content and never overflow', () => {
  const config = withRight(['gitStatus', 'toolchain', 'exitStatus']);
  const leftOnly = {...config, modules: config.modules.filter(module => modulePlacement(module) === 'left')};
  let sawPartial = false;
  for (let width = 8; width <= 140; width += 1) {
    for (const placement of ['header', 'composer'] as const) {
      const line = buildContextLine(context, width, config, placement);
      assert.ok(displayWidth(line) <= width, `width ${width} ${placement}`);
      const left = stripAnsi(buildContextLine(context, width, leftOnly, 'composer'));
      assert.ok(stripAnsi(line).startsWith(left.trimEnd()), `width ${width}: the left prompt is never squeezed by the right`);
    }
    const right = stripAnsi(buildRightContext(context, width, config));
    if (right && !right.includes('+2')) sawPartial = true;
  }
  assert.ok(sawPartial, 'blocks farthest from the right edge drop first');
  const right = stripAnsi(buildRightContext(context, 200, config));
  assert.ok(right.includes('+2') && right.includes('node'), 'wide terminals show every right block');
});

test('one-line composer: the prefix is the left prompt only; right context is separate', () => {
  const config = {...withRight(['gitStatus', 'toolchain']), composerLayout: 'oneLine' as const};
  const prefix = stripAnsi(buildInlineContextPrefix(context, 120, config));
  assert.ok(prefix.includes('main*') && !prefix.includes('+2') && !prefix.includes('node'));
  assert.ok(stripAnsi(buildRightContext(context, 60, config)).includes('node'));
  assert.equal(buildRightContext(context, 2, config), '', 'no room means no right context');
  assert.equal(buildRightContext(context, 120, DEFAULT_PROMPT_CONFIGURATION), '');
});

test('snapshots record right placement and history renders it right-aligned, dropping it first', () => {
  const config = withRight(['gitStatus']);
  const snapshot = nativePromptSnapshot(context, config);
  const staged = snapshot.segments.find(segment => segment.role === 'gitStaged');
  assert.equal(staged?.placement, 'right');
  assert.equal(snapshot.segments.find(segment => segment.role === 'gitBranch')?.placement, undefined);
  const historical = {cwd: context.cwd, project: context.project, branch: context.branch, prompt: snapshot};
  const wide = renderHistoricalContext(historical, 120)!;
  assert.equal(displayWidth(wide.plain), 120);
  assert.ok(wide.plain.indexOf('+2') > wide.plain.indexOf('─'), 'right context follows the divider');
  const noDivider = renderHistoricalContext(historical, 120, {...DEFAULT_TRANSCRIPT_APPEARANCE, divider: false})!;
  assert.equal(displayWidth(noDivider.plain), 120);
  const narrow = renderHistoricalContext(historical, 30)!;
  assert.ok(displayWidth(narrow.plain) <= 30);
  assert.ok(!narrow.plain.includes('+2') && narrow.plain.includes('notMyShell'), 'history drops right context first');
  // Rendering is deterministic: stored semantics, not the live config.
  assert.equal(renderHistoricalContext(historical, 120)!.ansi, wide.ansi);
});

test('renderedModules tags right segments; Git status follows Rich Git Off', () => {
  const config = withRight(['gitStatus']);
  assert.ok(renderedModules(context, config).filter(module => module.id === 'gitStatus').every(module => module.placement === 'right'));
  const off = structuredClone(config);
  off.nmsh.gitEnabled = false;
  assert.equal(renderedModules(context, off).filter(module => module.id === 'gitStatus').length, 0);
});
