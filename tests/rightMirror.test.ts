import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildContextLine, buildInlineContextPrefix, buildRightContext, moduleShowcaseContext, nativePromptSnapshot} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration, normalizePromptConfiguration, savePromptConfiguration,
  type ContextModuleId, type PromptConfiguration} from '../src/prompt/configuration.js';
import {connectorFadeColor, CONNECTOR_FADE_COLORS, POWERLINE_EDGE_STYLES, POWERLINE_SHAPES, renderPowerlineBlocks,
  type PowerlineBlock} from '../src/prompt/powerline.js';
import {handlePromptPanelKey, promptPanelControls, renderPromptPanel} from '../src/prompt/PromptPanel.js';
import {renderHistoricalContext} from '../src/output/OutputBuffer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const WHITE = {red: 240, green: 240, blue: 240};
const PURPLE = {red: 100, green: 60, blue: 180};
const GREEN = {red: 40, green: 120, blue: 80};
const A: PowerlineBlock = {text: 'A', foreground: WHITE, background: PURPLE};
const B: PowerlineBlock = {text: 'B', foreground: WHITE, background: GREEN};
const RESET = '\u001B[0m';
const fg = (color: typeof WHITE) => `\u001B[38;2;${color.red};${color.green};${color.blue}m`;
const bg = (color: typeof WHITE) => `\u001B[48;2;${color.red};${color.green};${color.blue}m`;
const REFLECT: Record<string, string> = {
  '': '', '': '', '': '', '': '', '': '', '': '',
  '': '', '': '', '': '', '': '',
};
/** Plain-text reflection: single-character block texts make a per-character reversal exact. */
const reflectPlain = (plain: string) => [...plain].reverse().map(glyph => REFLECT[glyph] ?? glyph).join('');
const ALL_IDS: ContextModuleId[] = ['project', 'cwd', 'gitBranch', 'gitStatus', 'toolchain', 'exitStatus', 'kubeContext', 'dockerContext'];

function placed(ids: readonly ContextModuleId[], mirror = true): PromptConfiguration {
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  configuration.nmsh.mirrorRight = mirror;
  configuration.modules = configuration.modules.map(module => ids.includes(module.id) ? {...module, placement: 'right' as const} : module);
  return configuration;
}

test('Mirror right side defaults On, older configs gain it, and Off persists', async () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.mirrorRight, true);
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'warm'}}).nmsh.mirrorRight, true);
  assert.equal(normalizePromptConfiguration({nmsh: {mirrorRight: 'yes'}}).nmsh.mirrorRight, true);
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-mirror-'));
  try {
    const path = join(directory, 'config.json');
    savePromptConfiguration(placed(['exitStatus'], false), path);
    assert.equal(loadPromptConfiguration(path).nmsh.mirrorRight, false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('M toggles Mirror right side and the Modules screen says which', () => {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const state = {onboarding: false, step: 'modules' as const, selectedIndex: 0, draft: structuredClone(saved), saved};
  const shown = () => stripAnsi(renderPromptPanel(state, 140, []).join('\n'));
  assert.match(shown(), /Mirror right side: On/u);
  assert.ok(handlePromptPanelKey({kind: 'text', value: 'M'} as Key, state));
  assert.equal(state.draft.nmsh.mirrorRight, false);
  assert.match(shown(), /Mirror right side: Off/u);
  assert.ok(promptPanelControls(state).some(([key, label]) => key === 'M' && label === 'mirror right: Off'));
  handlePromptPanelKey({kind: 'text', value: 'm'} as Key, state);
  assert.equal(state.draft.nmsh.mirrorRight, true);
});

test('P moves every module, including Project, Path and Git branch, right and back', () => {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const state = {onboarding: false, step: 'modules' as const, selectedIndex: 0, draft: structuredClone(saved), saved};
  state.draft.modules.forEach((module, index) => {
    state.selectedIndex = index;
    handlePromptPanelKey({kind: 'text', value: 'p'} as Key, state);
    assert.equal(state.draft.modules[index]!.placement, 'right', module.id);
  });
  const rows = stripAnsi(renderPromptPanel(state, 140, []).join('\n'));
  for (const label of ['Project', 'Path', 'Git branch', 'Git status', 'Toolchains', 'Exit status', 'Kubernetes', 'Docker context']) {
    assert.match(rows, new RegExp(`${label} +right`, 'u'), label);
  }
  state.selectedIndex = 0;
  handlePromptPanelKey({kind: 'text', value: 'P'} as Key, state);
  assert.equal(state.draft.modules[0]!.placement, undefined);
});

test('each module renders on the right when placed there', () => {
  const context = moduleShowcaseContext();
  const expected: Record<ContextModuleId, string> = {project: 'notMyShell', cwd: '~/Projects/notMyShell/src', gitBranch: 'feature/example',
    gitStatus: '+2', toolchain: 'node', exitStatus: '1', kubeContext: 'dev-cluster', dockerContext: 'colima'};
  for (const id of ALL_IDS) {
    const configuration = placed([id]);
    const right = stripAnsi(buildRightContext({...context, cwd: id === 'project' ? '/elsewhere' : context.cwd}, 200, configuration));
    assert.ok(right.includes(expected[id]), `${id}: ${right}`);
    const prefix = buildInlineContextPrefix(context, 400, {...configuration, composerLayout: 'oneLine'});
    const allLeft = buildInlineContextPrefix(context, 400, {...placed([]), composerLayout: 'oneLine'});
    assert.ok(displayWidth(prefix) < displayWidth(allLeft), `${id} leaves the left prompt`);
  }
});

test('an all-right prompt has an empty but valid left side, in every layout', () => {
  const configuration = placed(ALL_IDS);
  const context = moduleShowcaseContext();
  assert.equal(stripAnsi(buildInlineContextPrefix(context, 120, {...configuration, composerLayout: 'oneLine'})), '❯ ');
  for (const placement of ['header', 'composer'] as const) {
    for (const width of [20, 60, 120, 240]) {
      const line = buildContextLine(context, width, configuration, placement);
      assert.ok(displayWidth(line) <= width, `${placement} ${width}`);
    }
    const wide = stripAnsi(buildContextLine(context, 240, configuration, placement));
    assert.ok(wide.includes('notMyShell') && wide.includes('colima'), placement);
    assert.ok(/^[─ ]/u.test(wide), `${placement}: nothing is anchored left`);
  }
});

test('mirrored rendering is the exact reflection of the reversed normal render, for every geometry', () => {
  for (const edge of POWERLINE_EDGE_STYLES) {
    for (const connector of POWERLINE_SHAPES) {
      for (const fade of [undefined, ...POWERLINE_SHAPES]) {
        for (const [gap, gapEnabled] of [[0, false], [0, true], [1, true], [2, true]] as const) {
          for (const mode of CONNECTOR_FADE_COLORS) {
            const normal = renderPowerlineBlocks([B, A], gap, 0, edge, gapEnabled, edge, connector, fade, mode);
            const mirrored = renderPowerlineBlocks([A, B], gap, 0, edge, gapEnabled, edge, connector, fade, mode, 'mirrored');
            const label = `${edge} ${connector} ${fade} ${gap}/${gapEnabled} ${mode}`;
            assert.equal(stripAnsi(mirrored), reflectPlain(stripAnsi(normal)), label);
            assert.equal(displayWidth(mirrored), displayWidth(normal), label);
            assert.ok(mirrored.endsWith(`${RESET}\u001B[49m`), `${label}: output ends neutral`);
          }
        }
      }
    }
  }
});

test('mirrored wedges, slants, edges and joins face left', () => {
  const single = renderPowerlineBlocks([A], 0, 0, 'wedge', true, 'wedge', 'wedge', undefined, 'previous', 'mirrored');
  assert.equal(stripAnsi(single), 'A', 'End shapes the free left edge, Start the anchored right edge');
  assert.equal(stripAnsi(renderPowerlineBlocks([A], 0, 0, 'wedge', true, 'wedge')), 'A', 'normal is unchanged');
  const joined = renderPowerlineBlocks([A, B], 0, 0, 'flat', false, 'flat', 'wedge', undefined, 'previous', 'mirrored');
  assert.equal(stripAnsi(joined), 'AB');
  assert.ok(joined.includes(`${RESET}${bg(PURPLE)}${fg(GREEN)}`), 'the arrow is painted by the flow-previous block and points into A');
  const slash = stripAnsi(renderPowerlineBlocks([A, B], 1, 0, 'flat', true, 'flat', 'slash', undefined, 'previous', 'mirrored'));
  assert.equal(slash, 'A B', 'a slash connector reflects into backslash-shaped caps');
  const backslash = stripAnsi(renderPowerlineBlocks([A, B], 1, 0, 'flat', true, 'flat', 'backslash', undefined, 'previous', 'mirrored'));
  assert.equal(backslash, 'A B');
  const flat = renderPowerlineBlocks([A, B], 0, 0, 'flat', false, 'flat', 'flat', undefined, 'previous', 'mirrored');
  assert.equal(stripAnsi(flat), 'AB', 'Flat stays flat');
  const fadeWedge = stripAnsi(renderPowerlineBlocks([A], 0, 0, 'fadeWedge', true, 'flat', 'wedge', undefined, 'previous', 'mirrored'));
  assert.equal(fadeWedge, 'A', 'a fading End faces left on the free edge');
});

test('Previous / Next / Mixed keep their meaning along the mirrored flow', () => {
  const darkA = bg(connectorFadeColor(PURPLE));
  const darkB = bg(connectorFadeColor(GREEN));
  // Visually A then B; the flow runs from the right edge, so B is Previous.
  const render = (mode: typeof CONNECTOR_FADE_COLORS[number]) =>
    renderPowerlineBlocks([A, B], 1, 0, 'flat', true, 'flat', 'wedge', 'slash', mode, 'mirrored');
  assert.ok(render('previous').includes(darkB) && !render('previous').includes(darkA));
  assert.ok(render('next').includes(darkA) && !render('next').includes(darkB));
  assert.ok(render('mixed').includes(darkA) && render('mixed').includes(darkB));
});

test('normal orientation is unchanged by the mirror option, and Off restores it on the right', () => {
  const context = moduleShowcaseContext();
  const on = buildContextLine(context, 200, placed(['gitStatus', 'exitStatus']), 'header');
  const off = buildContextLine(context, 200, placed(['gitStatus', 'exitStatus'], false), 'header');
  const leftOf = (line: string) => stripAnsi(line).split('─')[0];
  assert.equal(leftOf(on), leftOf(off), 'the left prompt never mirrors');
  assert.notEqual(on, off);
  assert.equal(displayWidth(on), displayWidth(off));
  assert.ok(stripAnsi(off).includes('') && stripAnsi(on).split('─').at(-1)!.includes(''));
});

test('mirrored right context still fits narrow widths and drops first', () => {
  const configuration = placed(['gitStatus', 'toolchain', 'exitStatus', 'kubeContext', 'dockerContext']);
  const context = moduleShowcaseContext();
  for (let width = 8; width <= 200; width += 3) {
    const line = stripAnsi(buildContextLine(context, width, configuration, 'header'));
    assert.ok(displayWidth(line) <= width, `width ${width}`);
    if (line.includes('colima')) assert.ok(line.includes('notMyShell'), `width ${width}: right never survives the left`);
  }
});

test('the showcase is deterministic, synthetic, and shows every module type', () => {
  assert.deepEqual(moduleShowcaseContext('/Users/a'), moduleShowcaseContext('/Users/a'));
  const context = moduleShowcaseContext(homedir());
  assert.notEqual(context.cwd, process.cwd());
  const line = stripAnsi(buildContextLine(context, 400, placed(['gitStatus', 'exitStatus', 'kubeContext']), 'header'));
  for (const text of ['notMyShell', '~/Projects/notMyShell/src', 'feature/example', '+2', 'node', '1', 'dev-cluster', 'colima']) {
    assert.ok(line.includes(text), text);
  }
});

test('the Modules preview renders the showcase through the real renderer and follows P, M and layout', () => {
  const app = new TerminalApp();
  try {
    app['context'] = {cwd: '/tmp/unrelated', project: 'unrelated', exitStatus: 0};
    const draft = placed(['exitStatus', 'kubeContext']);
    app['promptPanelState'] = {onboarding: false, step: 'modules', selectedIndex: 0, draft, saved: structuredClone(draft)};
    const preview = () => app['promptPanelPreview'](160) as string[];
    const first = preview();
    assert.ok(first.includes(buildContextLine(moduleShowcaseContext(), 156, draft, draft.placement)), 'same renderer, same output');
    assert.ok(!first.join('\n').includes('unrelated'), 'never the live cwd');
    handlePromptPanelKey({kind: 'text', value: 'p'} as Key, app['promptPanelState']!);
    const moved = preview();
    assert.notDeepEqual(moved, first, 'P updates the showcase');
    handlePromptPanelKey({kind: 'text', value: 'm'} as Key, app['promptPanelState']!);
    assert.notDeepEqual(preview(), moved, 'M updates the showcase');
    app['promptPanelState']!.draft.composerLayout = 'oneLine';
    const oneLine = preview();
    assert.equal(oneLine.length, 3, 'one-line preview: border, input row, border');
    assert.ok(stripAnsi(oneLine[1]!).includes('command') && stripAnsi(oneLine[1]!).includes('dev-cluster'));
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('history keeps each side and the submitted orientation; old snapshots stay unmirrored', () => {
  const context = moduleShowcaseContext();
  const mirrored = nativePromptSnapshot(context, placed(['gitStatus']));
  assert.equal(mirrored.mirrorRight, true);
  assert.equal(nativePromptSnapshot(context, placed([])).mirrorRight, undefined, 'all-left snapshots carry no orientation');
  const header = (prompt: typeof mirrored) => renderHistoricalContext({cwd: context.cwd, project: context.project, prompt}, 200)!;
  const unmirrored = {...mirrored, mirrorRight: false};
  const legacy = {...mirrored};
  delete legacy.mirrorRight;
  assert.notEqual(header(mirrored).ansi, header(unmirrored).ansi);
  assert.equal(header(legacy).ansi, header(unmirrored).ansi, 'snapshots from before mirroring render as captured');
  assert.equal(header(mirrored).plain.length > 0 && displayWidth(header(mirrored).plain), 200);
  assert.ok(header(mirrored).plain.split('─').at(-1)!.includes('+2'));
});
