import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {regionOf, type ScreenPlan} from '../src/app/screenPlan.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {awakeStyle, DEFAULT_KEEP_AWAKE_PRESENTATION} from '../src/keepAwake/presentation.js';
import type {KeepAwakeRecord} from '../src/keepAwake/keepAwake.js';
import type {PromptConfiguration} from '../src/prompt/configuration.js';
import {historyId, type HistoryEntry} from '../src/shell/HistoryIndex.js';

/**
 * #389, the History n/N slice (decision D1): while Up/Down browse an unchanged recalled entry, its position shows on a
 * composer edge that is free. It never adds a row, never moves the prompt, input or caret, never covers Keep Awake,
 * and is simply absent when no edge has room.
 */

const UP = '\u001B[A';
const DOWN = '\u001B[B';
const LEFT = '\u001B[D';
const RECORD: KeepAwakeRecord = {version: 1, token: 'a'.repeat(32), backend: 'macos-caffeinate', mode: 'display', pid: 1,
  startedAt: Date.now() - 47 * 60_000, command: '/usr/bin/caffeinate', args: ['-d', '-i']};

interface Scene {
  keys?: string[];
  config?: Partial<PromptConfiguration>;
  awake?: boolean;
  columns?: number;
}

interface Frame { rows: string[]; plain: string[]; plan: ScreenPlan; cursorRow: number; cursorColumn: number }

function frame(scene: Scene = {}): Frame {
  const app = new TerminalApp() as any;
  const columns = scene.columns ?? 80;
  try {
    Object.defineProperty(app, 'dimensions', {value: () => ({columns, rows: 20})});
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    app.session.write = () => { throw new Error('browsing history never writes to the shell'); };
    app.output.beginCommand('ls', ['❯ ls']);
    app.output.write('alpha\nbeta\n');
    app.output.complete(0);
    app.promptConfiguration = {...app.promptConfiguration, ...scene.config, keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION}};
    app.awakeRecord = scene.awake ? RECORD : undefined;
    app.lastUserInput = Date.now();
    // Newest last: 'clear' is the most recent command.
    ['npm test', 'git status', 'clear'].forEach((command, index) => app.historyService.index.add(
      {id: historyId('nmsh', `test:${index}`), source: 'nmsh', command, at: 1000 + index} satisfies HistoryEntry));
    const frames: Array<{rows: string[]; cursorRow: number; cursorColumn: number}> = [];
    app.renderer.render = (next: {rows: string[]; cursorRow: number; cursorColumn: number}) => { frames.push(next); };
    for (const key of scene.keys ?? []) app.onInput(key);
    app.render();
    const last = frames.at(-1)!;
    return {rows: last.rows, plain: last.rows.map(stripAnsi), plan: app.presentationFrame.plan, cursorRow: last.cursorRow, cursorColumn: last.cursorColumn};
  } finally {
    app.stop(0);
    app.session.kill();
  }
}

const rowOf = (f: Frame, kind: Parameters<typeof regionOf>[1]) => { const region = regionOf(f.plan, kind); return region ? f.plain[region.top]! : undefined; };
const layout = (f: Frame) => f.plan.regions.map(region => `${region.kind}@${region.top}+${region.height}`);
const shows = (f: Frame) => f.plain.some(row => /History \d+\/\d+/u.test(row));

let config: ReturnType<typeof isolateConfig>;
test.before(() => { config = isolateConfig(); });
test.after(() => config.restore());

test('browsing: the position shows on a free composer edge; no row is added and nothing moves', () => {
  const layouts: Array<Partial<PromptConfiguration>> = [{}, {composerLayout: 'oneLine'}, {composerLayout: 'twoLine', placement: 'composer'}];
  for (const config of layouts) {
    const name = JSON.stringify(config);
    const typed = frame({keys: [...'git status'], config});
    const browsing = frame({keys: [UP, UP], config});
    assert.equal(rowOf(browsing, 'input')?.includes('git status'), true, `${name}: the second-newest entry is recalled`);
    assert.match(rowOf(browsing, 'separator')!, /─ History 2\/3 ──$/u, `${name}: counted back from the newest`);
    assert.deepEqual(layout(browsing), layout(typed), `${name}: the same rows in the same places`);
    for (const kind of ['composerBorder', 'prompt', 'input'] as const) assert.equal(rowOf(browsing, kind), rowOf(typed, kind), `${name} ${kind}`);
    assert.deepEqual([browsing.cursorRow, browsing.cursorColumn], [typed.cursorRow, typed.cursorColumn], `${name}: the caret is where it would be`);
    assert.equal(displayWidth(rowOf(browsing, 'separator')!), 80, `${name}: the edge keeps its width`);
    // Contrast: the subtle chrome role Keep Awake's muted text uses, never a new color.
    const raw = browsing.rows[regionOf(browsing.plan, 'separator')!.top]!;
    assert.ok(raw.includes(`${awakeStyle.muted()}History 2/3`), `${name}: drawn in the subtle chrome role`);
  }
  assert.match(rowOf(frame({keys: [UP]}), 'separator')!, /History 1\/3/u, 'the newest is 1');
  assert.match(rowOf(frame({keys: [UP, UP, UP, UP]}), 'separator')!, /History 3\/3/u, 'the oldest stays N; no wrap');
});

test('it leaves with browsing: an edit, a caret move, or Down past the newest; a typed draft never shows it', () => {
  assert.equal(shows(frame()), false, 'an empty composer');
  assert.equal(shows(frame({keys: [...'git status']})), false, 'a typed draft that matches an entry is not browsing');
  assert.equal(shows(frame({keys: [UP, 'x']})), false, 'an edit makes it a draft again');
  assert.equal(shows(frame({keys: [UP, LEFT]})), false, 'a caret move makes it a draft again');
  assert.equal(shows(frame({keys: [UP, DOWN]})), false, 'Down past the newest restores the draft');
  assert.match(rowOf(frame({keys: [UP, UP, DOWN]}), 'separator')!, /History 1\/3/u, 'Down within history keeps it');
});

test('Keep Awake keeps its edge; with no free edge the position is simply not shown', () => {
  // Keep Awake on the top edge: the position takes the bottom one.
  const both = frame({keys: [UP], awake: true, config: {composerLayout: 'oneLine'}});
  assert.equal(both.plan.awake?.slot, 'topEdge');
  assert.match(rowOf(both, 'composerBorder')!, /Awake · Display ──$/u, 'Keep Awake is untouched');
  assert.match(rowOf(both, 'separator')!, /History 1\/3 ──$/u);
  // A header prompt owns the top edge and Keep Awake the bottom: nowhere free, so nothing, and nothing moves.
  const header = {composerLayout: 'twoLine', placement: 'header'} as Partial<PromptConfiguration>;
  const full = frame({keys: [UP], awake: true, config: header});
  assert.equal(full.plan.awake?.slot, 'bottomEdge');
  assert.equal(shows(full), false);
  assert.deepEqual(layout(full), layout(frame({keys: [...'clear'], awake: true, config: header})));
  // The header prompt alone: the bottom edge is free.
  assert.match(rowOf(frame({keys: [UP], config: header}), 'separator')!, /History 1\/3 ──$/u);
  // Dividers Off: no edge exists; no row is added for it.
  const off = frame({keys: [UP], config: {composerDividers: false}});
  assert.equal(shows(off), false);
  assert.deepEqual(layout(off), layout(frame({keys: [...'clear'], config: {composerDividers: false}})));
});

test('narrow: when the label does not fit, the edge stays a plain rule', () => {
  const narrow = frame({keys: [UP], columns: 18});
  assert.equal(shows(narrow), false);
  assert.equal(rowOf(narrow, 'separator'), rowOf(frame({keys: [...'clear'], columns: 18}), 'separator'));
  narrow.plain.forEach((row, index) => assert.ok(displayWidth(row) <= 18, `row ${index} overflows: ${row}`));
});
