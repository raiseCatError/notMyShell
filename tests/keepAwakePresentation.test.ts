import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {dividerAnimated, normalizeTreatmentSettings} from '../src/chroma/treatment.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {regionOf, type ScreenPlan} from '../src/app/screenPlan.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {renderStatusStrip} from '../src/status/StatusStrip.js';
import {DEFAULT_STATUS_STRIP, type PromptConfiguration} from '../src/prompt/configuration.js';
import type {KeepAwakeRecord} from '../src/keepAwake/keepAwake.js';
import {
  AWAKE_SAVER_POSITIONS, awakeLabel, DEFAULT_KEEP_AWAKE_PRESENTATION, edgeFits, normalizeKeepAwakePresentation, placeOnSaver,
  renderComposerEdge, resolveAccessorySlot, sliceAnsiCells, type KeepAwakePresentation,
} from '../src/keepAwake/presentation.js';

const RECORD: KeepAwakeRecord = {version: 1, token: 'a'.repeat(32), backend: 'macos-caffeinate', mode: 'display', pid: 1,
  startedAt: Date.now() - 47 * 60_000, command: '/usr/bin/caffeinate', args: ['-d', '-i']};

type Frame = {rows: string[]; plain: string[]; plan: ScreenPlan; cursorRow: number; cursorColumn: number};

interface Scene {
  config?: Partial<PromptConfiguration>;
  awake?: Partial<KeepAwakePresentation>;
  active?: boolean;
  idle?: boolean;
  text?: string;
  columns?: number;
  rows?: number;
  provider?: PromptConfiguration['provider'];
}

/** A real TerminalApp frame with Keep Awake state injected (the controller's verified record). */
function frame(scene: Scene = {}): Frame {
  const app = new TerminalApp() as any;
  const columns = scene.columns ?? 80, rows = scene.rows ?? 20;
  try {
    Object.defineProperty(app, 'dimensions', {value: () => ({columns, rows})});
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    app.output.beginCommand('ls', ['❯ ls']);
    app.output.write('alpha\nbeta\n');
    app.output.complete(0);
    app.promptConfiguration = {...app.promptConfiguration, ...scene.config, keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION, ...scene.awake}};
    if (scene.provider) {
      app.effectivePromptProvider = scene.provider;
      if (scene.provider !== 'nmsh' && scene.provider !== 'none') app.externalPrompt = {ansi: 'EXTERNAL-PROMPT ~/demo main', text: 'EXTERNAL-PROMPT ~/demo main'};
    }
    app.awakeRecord = scene.active === false ? undefined : RECORD;
    app.lastUserInput = scene.idle ? 0 : Date.now();
    if (scene.text) app.editor.insert(scene.text);
    const frames: Array<{rows: string[]; cursorRow: number; cursorColumn: number}> = [];
    app.renderer.render = (next: {rows: string[]; cursorRow: number; cursorColumn: number}) => { frames.push(next); };
    app.render();
    const last = frames.at(-1)!;
    return {rows: last.rows, plain: last.rows.map(stripAnsi), plan: app.presentationFrame.plan, cursorRow: last.cursorRow, cursorColumn: last.cursorColumn};
  } finally {
    app.stop(0);
    app.session.kill();
  }
}

const rowOf = (f: Frame, kind: Parameters<typeof regionOf>[1]) => { const region = regionOf(f.plan, kind); return region ? f.plain[region.top]! : undefined; };
const everyRowFits = (f: Frame, columns: number) => f.rows.forEach((row, index) => assert.ok(displayWidth(stripAnsi(row)) <= columns, `row ${index} overflows: ${stripAnsi(row)}`));

let config: ReturnType<typeof isolateConfig>;
test.before(() => { config = isolateConfig(); });
test.after(() => config.restore());

test('Off renders nothing anywhere: no icon, no placeholder, no row', () => {
  for (const placement of ['edge', 'above', 'input'] as const) {
    const off = frame({active: false, awake: {placement}, config: {statusStrip: {...DEFAULT_STATUS_STRIP, enabled: true}}, text: 'npm test'});
    assert.ok(!off.plain.some(row => /Awake|zoomies/u.test(row)), placement);
    assert.equal(regionOf(off.plan, 'awake'), undefined);
    assert.equal(off.plan.awake, undefined);
  }
});

test('Composer edge: a plain top divider hosts it; the prompt, input and bottom rule are unchanged', () => {
  for (const layout of [{composerLayout: 'oneLine'}, {composerLayout: 'twoLine', placement: 'composer'}] as const) {
    const on = frame({config: layout, text: 'npm test'});
    const off = frame({config: layout, text: 'npm test', active: false});
    assert.equal(on.plan.awake?.slot, 'topEdge');
    assert.match(rowOf(on, 'composerBorder')!, /^─+ Awake · Display ──$/u);
    assert.equal(displayWidth(rowOf(on, 'composerBorder')!), 80);
    for (const kind of ['prompt', 'input', 'separator'] as const) assert.equal(rowOf(on, kind), rowOf(off, kind), `${layout.composerLayout} ${kind}`);
    assert.deepEqual([on.cursorRow - regionOf(on.plan, 'input')!.top, on.cursorColumn], [off.cursorRow - regionOf(off.plan, 'input')!.top, off.cursorColumn]);
  }
});

test('Composer edge: a header prompt owns the top edge, so Awake takes the bottom edge and the prompt is untouched', () => {
  const on = frame({config: {composerLayout: 'twoLine', placement: 'header'}});
  const off = frame({config: {composerLayout: 'twoLine', placement: 'header'}, active: false});
  assert.equal(on.plan.awake?.slot, 'bottomEdge');
  assert.equal(rowOf(on, 'prompt'), rowOf(off, 'prompt'), 'prompt row byte-for-byte unchanged');
  assert.ok(!rowOf(on, 'prompt')!.includes('Awake'));
  assert.match(rowOf(on, 'separator')!, /Awake · Display ──$/u);
});

test('Dividers Off: neither edge exists, the dividers stay off, and one adjacent row carries it', () => {
  const on = frame({config: {composerDividers: false}});
  assert.equal(on.plan.awake?.slot, 'adjacentRow');
  assert.equal(regionOf(on.plan, 'composerBorder'), undefined);
  assert.equal(regionOf(on.plan, 'separator'), undefined);
  const awake = regionOf(on.plan, 'awake')!;
  assert.equal(on.plain[awake.top], 'Awake · Display');
  assert.ok(awake.top < regionOf(on.plan, 'prompt')!.top, 'directly above the composer');
});

test('slot policy: top, else bottom, else adjacent; the saved preference is never rewritten', () => {
  const edge = (top: 'available' | 'occupied' | 'unavailable', bottom: 'available' | 'unavailable') =>
    resolveAccessorySlot('edge', {topEdge: top, bottomEdge: bottom, inputTrailing: 'unavailable'});
  assert.equal(edge('available', 'available'), 'topEdge');
  assert.equal(edge('occupied', 'available'), 'bottomEdge');
  assert.equal(edge('unavailable', 'available'), 'bottomEdge', 'top too narrow, bottom fits');
  assert.equal(edge('occupied', 'unavailable'), 'adjacentRow', 'top occupied + bottom unavailable');
  assert.equal(edge('unavailable', 'unavailable'), 'adjacentRow', 'neither edge safe');
  assert.equal(resolveAccessorySlot('above', {topEdge: 'available', bottomEdge: 'available', inputTrailing: 'available'}), 'adjacentRow');
  assert.equal(resolveAccessorySlot('input', {topEdge: 'available', bottomEdge: 'available', inputTrailing: 'unavailable'}), 'adjacentRow');
  // Too narrow for any edge: the frame falls back, the setting stays Composer edge.
  const narrow = frame({columns: 22, config: {composerLayout: 'twoLine', placement: 'header'}});
  assert.equal(narrow.plan.awake?.slot, 'adjacentRow');
  assert.ok(!edgeFits(20, 15));
});

test('Bottom, Top and Flow: placement is relative to the composer, never the screen', () => {
  for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
    const plain = frame({config: {composerPosition, composerLayout: 'twoLine', placement: 'composer'}});
    const border = regionOf(plain.plan, 'composerBorder')!;
    assert.equal(plain.plan.awake?.slot, 'topEdge', composerPosition);
    assert.match(plain.plain[border.top]!, /Awake · Display/u);
    const header = frame({config: {composerPosition, composerLayout: 'twoLine', placement: 'header'}});
    assert.equal(header.plan.awake?.slot, 'bottomEdge', composerPosition);
    assert.match(rowOf(header, 'separator')!, /Awake · Display/u);
    const above = frame({config: {composerPosition}, awake: {placement: 'above'}});
    const row = regionOf(above.plan, 'awake')!;
    const composerTop = Math.min(...above.plan.regions.filter(region => ['composerBorder', 'prompt', 'input'].includes(region.kind)).map(region => region.top));
    assert.equal(row.top + 1, composerTop, `${composerPosition}: right before the composer block`);
  }
});

test('Prompt None and an external provider: Keep Awake is NMSh chrome, never provider output', () => {
  const none = frame({provider: 'none'});
  assert.equal(none.plan.awake?.slot, 'topEdge');
  assert.match(rowOf(none, 'composerBorder')!, /Awake · Display/u);
  for (const placement of ['header', 'composer'] as const) {
    const external = frame({provider: 'starship', config: {composerLayout: 'twoLine', placement}});
    const without = frame({provider: 'starship', config: {composerLayout: 'twoLine', placement}, active: false});
    assert.equal(rowOf(external, 'prompt'), rowOf(without, 'prompt'), 'provider output unchanged');
    assert.ok(!rowOf(external, 'prompt')!.includes('Awake'));
    assert.ok(external.plain.some(row => row.includes('Awake · Display')));
  }
});

test('Input row: reserves real editor width (caret and wrapping agree) and yields when the edit gets long or multi-line', () => {
  const on = frame({config: {composerLayout: 'twoLine'}, awake: {placement: 'input'}, text: 'npm test'});
  assert.equal(on.plan.awake?.slot, 'inputTrailing');
  const input = rowOf(on, 'input')!;
  assert.match(input, /^❯ npm test +Awake · Display$/u);
  assert.equal(displayWidth(input), 80);
  assert.equal(on.cursorColumn, 11, 'caret right after the typed text, never inside the status');
  const long = frame({config: {composerLayout: 'twoLine'}, awake: {placement: 'input'}, text: 'x'.repeat(65)});
  assert.equal(long.plan.awake?.slot, 'adjacentRow', 'editable input wins');
  assert.ok(rowOf(long, 'input')!.includes('x'.repeat(65)));
  // The one-line Native composer keeps its right prompt on that row: Input row falls back.
  const oneLine = frame({config: {composerLayout: 'oneLine'}, awake: {placement: 'input'}, text: 'ls'});
  assert.equal(oneLine.plan.awake?.slot, 'adjacentRow');
});

test('idle reminder: expands on the edge when it fits, else compact edge + one muted reminder row; input collapses it', () => {
  const wide = frame({idle: true, config: {composerLayout: 'twoLine', placement: 'header'}});
  assert.match(rowOf(wide, 'separator')!, /Awake · Display · 47m {3}\/zoomies stop ──$/u);
  assert.equal(regionOf(wide.plan, 'awake'), undefined);
  const narrow = frame({idle: true, columns: 40, config: {composerLayout: 'twoLine', placement: 'header'}});
  assert.match(rowOf(narrow, 'separator')!, /Awake · Display ──$/u);
  const reminder = regionOf(narrow.plan, 'awake')!;
  assert.equal(narrow.plain[reminder.top], '47m   /zoomies stop', 'duration + stop only; the label is not repeated');
  assert.ok(narrow.rows[reminder.top]!.includes('/zoomies stop'));
  const active = frame({idle: false, columns: 40, config: {composerLayout: 'twoLine', placement: 'header'}});
  assert.equal(regionOf(active.plan, 'awake'), undefined, 'collapsed after input');
  assert.match(rowOf(active, 'separator')!, /Awake · Display/u, 'still shown while typing');
  const reminderOff = frame({idle: true, awake: {idleReminder: false}});
  assert.ok(!reminderOff.plain.some(row => row.includes('/zoomies stop')));
});

test('Status Strip: active Awake is always in an enabled strip, narrows before it drops, and never enables the strip', () => {
  const awake = {full: 'Awake · Display', short: 'Awake', glyph: 'Awake'};
  const stats = {cpu: 8, memory: {used: 4.2 * 1024 ** 3, total: 16 * 1024 ** 3}};
  const settings = {...DEFAULT_STATUS_STRIP, enabled: true, clock: true, cpu: true, ram: true};
  const now = new Date(2026, 0, 1, 6, 44);
  assert.match(stripAnsi(renderStatusStrip(settings, stats, 100, now, awake)), /CPU 8% · .*RAM 26% · .*06:44 · Awake · Display$/u, 'Awake joins the end of the strip');
  assert.match(stripAnsi(renderStatusStrip(settings, stats, 36, now, awake)).trim(), /Awake · Display$/u, 'decorative items drop first');
  assert.equal(stripAnsi(renderStatusStrip(settings, stats, 30, now, {...awake, full: 'Awake · Display + System and more'})).trim(), 'Awake');
  assert.equal(renderStatusStrip({...settings, enabled: false}, stats, 100, now, awake), '', 'a disabled strip stays disabled');
  const app = frame({config: {statusStrip: {...settings}}});
  assert.match(app.plain[regionOf(app.plan, 'status')!.top]!, /Awake · Display$/u);
});

test('display styles use the glyph abstraction; Safe/ASCII has no icon, so text carries the meaning', () => {
  assert.equal(awakeLabel(RECORD, 'text'), 'Awake · Display');
  assert.equal(awakeLabel(RECORD, 'iconText', 'full', 'E'), 'E Awake · Display');
  assert.equal(awakeLabel(RECORD, 'icon', 'full', 'E'), 'E Display');
  assert.equal(awakeLabel(RECORD, 'icon', 'full', ''), 'Awake · Display', 'Safe mode falls back to text');
  assert.equal(awakeLabel({...RECORD, mode: 'all'}, 'text'), 'Awake · All');
});

test('the shared edge renderer is exact-width, keeps rule colors and works without color', () => {
  const rule = `\u001b[38;5;99m${'─'.repeat(60)}\u001b[39m`;
  const edge = renderComposerEdge({rule, width: 60, accessory: {ansi: '\u001b[38;5;183mAwake · Idle\u001b[0m', width: 12}});
  assert.equal(displayWidth(stripAnsi(edge)), 60);
  assert.match(stripAnsi(edge), /^─{44} Awake · Idle ──$/u);
  assert.ok(edge.startsWith('\u001b[38;5;99m'));
  assert.equal(stripAnsi(sliceAnsiCells(rule, 58, 60)), '──');
  assert.ok(sliceAnsiCells(rule, 58, 60).startsWith('\u001b[38;5;99m'), 'trailing segment carries the rule color');
  const noColor = renderComposerEdge({rule: '─'.repeat(30), width: 30, accessory: {ansi: 'Awake · Idle', width: 12}});
  assert.equal(noColor, `${'─'.repeat(14)}\u001b[0m Awake · Idle \u001b[0m──\u001b[0m`);
  assert.equal(renderComposerEdge({rule: '─'.repeat(15), width: 15, accessory: {ansi: 'Awake · Idle', width: 12}}), '─'.repeat(15), 'too narrow: the plain rule');
});

test('Chroma-animated dividers repaint the composed edge: Awake never disappears and its text never shimmers', () => {
  const app = new TerminalApp() as any;
  try {
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 20})});
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    Object.defineProperty(app, 'decorativeMotionAllowed', {value: () => true});
    app.promptConfiguration = {...app.promptConfiguration, composerLayout: 'twoLine', placement: 'header', keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION},
      presentation: normalizeTreatmentSettings({...app.promptConfiguration.presentation, preset: 'aurora', motion: 'travel', rules: true})};
    assert.ok(dividerAnimated(app.promptConfiguration.presentation), 'the divider really animates');
    app.awakeRecord = RECORD;
    const frames: string[][] = [];
    app.renderer.render = (next: {rows: string[]}) => { frames.push(next.rows); };
    app.render();
    const separator = regionOf(app.presentationFrame.plan, 'separator')!;
    const awakeText = (row: string) => /\u001b\[0m (.*Awake · Display.*?)\u001b\[0m \u001b\[0m/u.exec(row)?.[1];
    const first = awakeText(frames.at(-1)![separator.top]!);
    assert.ok(first, 'composed edge on the base frame');
    for (const at of [1000, 2500, 7000]) {
      app.paintPresentation(Date.now() + at);
      const row = frames.at(-1)![separator.top]!;
      assert.match(stripAnsi(row), /Awake · Display ──$/u, `animated frame +${at}ms keeps the accessory`);
      assert.equal(awakeText(row), first, 'accessory styling is stable while the rule animates');
    }
  } finally {
    app.stop(0);
    app.session.kill();
  }
});

test('screensaver: On shows one positioned status in each of the six positions; Off shows nothing; saver rows otherwise untouched', () => {
  const saver = Array.from({length: 6}, () => '.'.repeat(40));
  const overlay = (row: string, column: number, ansi: string, width: number) => `${row.slice(0, column)}${ansi}${row.slice(column + width)}`;
  const text = {ansi: 'Awake · Idle · 5m', width: 17};
  const expected: Record<string, [number, number]> = {topLeft: [0, 1], topCenter: [0, 11], topRight: [0, 22], bottomLeft: [5, 1], bottomCenter: [5, 11], bottomRight: [5, 22]};
  for (const position of AWAKE_SAVER_POSITIONS) {
    const out = placeOnSaver(saver, 40, text, position, overlay);
    const [row, column] = expected[position]!;
    assert.equal(out[row]!.indexOf('Awake'), column, position);
    out.forEach((line, index) => { if (index !== row) assert.equal(line, saver[index]); assert.equal(line.length, 40); });
  }
  assert.equal(DEFAULT_KEEP_AWAKE_PRESENTATION.screensaverPosition, 'bottomLeft');
  const app = new TerminalApp() as any;
  try {
    app.promptConfiguration = {...app.promptConfiguration, keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION}};
    app.awakeRecord = RECORD;
    const rows = Array.from({length: 10}, () => ' '.repeat(60));
    assert.match(stripAnsi(app.saverAwake(rows, 60, Date.now()).at(-1)!), /^ Awake · Display · 47m +$/u);
    app.promptConfiguration = {...app.promptConfiguration, keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION, screensaver: false}};
    assert.deepEqual(app.saverAwake(rows, 60, Date.now()), rows);
    app.awakeRecord = undefined;
    app.promptConfiguration = {...app.promptConfiguration, keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION}};
    assert.deepEqual(app.saverAwake(rows, 60, Date.now()), rows, 'Off: nothing on the saver');
  } finally {
    app.stop(0);
    app.session.kill();
  }
});

test('never in transcript, history, /copy or the editor, and every row stays within the terminal width', () => {
  for (const scene of [{}, {idle: true}, {awake: {placement: 'above' as const}}, {awake: {placement: 'input' as const}, text: 'echo hi'}, {config: {composerDividers: false}}]) {
    const app = new TerminalApp() as any;
    try {
      Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 20})});
      Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
      app.output.beginCommand('ls', ['❯ ls']); app.output.write('alpha\n'); app.output.complete(0);
      app.promptConfiguration = {...app.promptConfiguration, ...(scene as Scene).config, keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION, ...(scene as Scene).awake}};
      app.awakeRecord = RECORD;
      app.lastUserInput = (scene as Scene).idle ? 0 : Date.now();
      if ((scene as Scene).text) app.editor.insert((scene as Scene).text);
      app.renderer.render = () => {};
      app.render();
      assert.ok(!app.output.wrapped(80).some((row: {plain: string}) => /Awake|zoomies stop/u.test(row.plain)), 'transcript');
      assert.ok(!/Awake/u.test(app.editor.text), 'editor source');
      assert.ok(!(app.output.recent(1)?.output ?? '').includes('Awake'), '/copy source');
    } finally {
      app.stop(0);
      app.session.kill();
    }
  }
  for (const columns of [40, 60, 80, 120]) everyRowFits(frame({columns, idle: true}), columns);
});

test('settings normalize to the documented defaults', () => {
  assert.deepEqual(normalizeKeepAwakePresentation(undefined), {placement: 'edge', display: 'text', idleReminder: true, idleAfterSeconds: 30, screensaver: true, screensaverPosition: 'bottomLeft'});
  assert.deepEqual(normalizeKeepAwakePresentation({placement: 'input', display: 'iconText', idleReminder: false, idleAfterSeconds: 60, screensaver: false, screensaverPosition: 'topRight'}),
    {placement: 'input', display: 'iconText', idleReminder: false, idleAfterSeconds: 60, screensaver: false, screensaverPosition: 'topRight'});
  assert.equal(normalizeKeepAwakePresentation({placement: 'statusbar', idleAfterSeconds: 7}).placement, 'edge');
});
