import test from 'node:test';
import assert from 'node:assert/strict';
import {queueSummaryLines, renderQueueSummary} from '../src/status/queueSummaryView.js';
import type {QueueSummary} from '../src/session/QueueSummary.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {GLYPHS, setIconStyle} from '../src/ui/glyphs.js';

const AT = Date.UTC(2026, 9, 16, 12, 0, 0);

/** One deterministic saved artifact: the same facts the owner stores, nothing else. */
function sample(overrides: Partial<QueueSummary> = {}): QueueSummary {
  return {version: 1, id: 'chain-4', chainId: 4, savedAt: AT, origin: 'automatic', status: 'finished', failurePolicy: 'pause',
    createdAt: AT, startedAt: AT, endedAt: AT + 23_900, elapsedMs: 23_900,
    counts: {succeeded: 2, failed: 1, interrupted: 0, skipped: 0, unobserved: 0},
    entries: [
      {outcome: 'succeeded', label: 'npm', durationMs: 8200, exitCode: 0},
      {outcome: 'failed', label: 'command 2', durationMs: 1400, exitCode: 1},
      {outcome: 'succeeded', label: 'npm', durationMs: 12_300, exitCode: 0}],
    entriesOmitted: 0, ...overrides};
}

const plain = (lines: readonly string[]): string[] => lines.map(line => stripAnsi(line));
const lead = (line: string): number => line.length - line.trimStart().length;
const find = (lines: readonly string[], text: string): string | undefined => lines.find(line => line.includes(text));

test('the default is a centered bounded container with left-aligned contents', () => {
  const bare = plain(renderQueueSummary(sample(), 80, 30));
  const offset = lead(bare[0]!);
  const width = displayWidth(bare[0]!) - offset;
  assert.ok(width >= 24 && width <= 56, `the container is bounded (${width})`);
  assert.match(bare[0]!.trimStart(), /^─+ Queue Summary ─+$/u);
  assert.match(bare.at(-1)!.trimStart(), /^─+$/u);
  assert.equal(displayWidth(bare.at(-1)!) - lead(bare.at(-1)!), width, 'the container closes at the same width');
  assert.ok(offset >= 4, `centered at a normal width (${offset})`);
  for (const line of bare.slice(1, -1)) assert.equal(lead(line), offset + 1, 'the whole block moves together');
  const entry = find(bare, 'npm')!;
  assert.ok(entry.startsWith(`${' '.repeat(offset + 1)}${GLYPHS.success} npm`), 'contents start left-aligned at the container edge');
  assert.ok(find(bare, '3 executed'), 'factual counts are always present');
  assert.ok(find(bare, 'wall time 23.9s'));
});

test('container placement moves the block; internal alignment only moves the text inside it', () => {
  const at = (placement: 'left' | 'center' | 'right', align?: 'left' | 'center' | 'right') =>
    plain(renderQueueSummary(sample(), 60, 30, {placement, ...(align === undefined ? {} : {align})}));
  const left = at('left');
  const center = at('center');
  const right = at('right');
  assert.equal(lead(left[0]!), 0);
  assert.ok(lead(center[0]!) > 0 && lead(right[0]!) > 0, 'center and right push the whole block');
  assert.deepEqual(left.map(line => line.trimStart()), right.map(line => line.trimStart()), 'placement never changes the shape');
  assert.deepEqual(left.map(line => line.trimStart()), center.map(line => line.trimStart()));
  // Internal alignment only moves text inside the same container.
  const short = sample({entries: [], counts: {succeeded: 1, failed: 0, interrupted: 0, skipped: 0, unobserved: 0}, elapsedMs: 2100, startedAt: AT, endedAt: AT + 2100});
  const agg = (align: 'left' | 'center' | 'right') => find(plain(renderQueueSummary(short, 60, 30, {placement: 'left', align})), '1 executed')!;
  const leftAgg = agg('left');
  const centerAgg = agg('center');
  const rightAgg = agg('right');
  assert.ok(leftAgg.trimEnd().startsWith(' 1 executed'), 'left alignment starts at the inner edge');
  assert.ok(rightAgg.trimEnd().endsWith('wall time 2.1s'), 'right alignment ends at the inner edge');
  assert.ok(centerAgg.trimEnd().length > leftAgg.trimEnd().length && centerAgg.trimEnd().length < rightAgg.trimEnd().length, 'centered sits between');
  const glyphIndex = (align: 'left' | 'center' | 'right') => find(at('left', align), 'exit 1')!.indexOf(GLYPHS.failure);
  assert.equal(glyphIndex('left'), glyphIndex('center'), 'statuses keep their column');
  assert.equal(glyphIndex('left'), glyphIndex('right'));
});

test('Compact and Detailed differ only in presentation', () => {
  const detailed = plain(renderQueueSummary(sample(), 80, 30, {detail: 'detailed'}));
  const compact = plain(renderQueueSummary(sample(), 80, 30, {detail: 'compact'}));
  assert.ok(detailed.some(line => line.includes('exit 1')), 'detailed rows carry the observed exit code');
  assert.ok(detailed.some(line => line.includes('8.2s')));
  assert.ok(!compact.some(line => line.includes('npm')), 'compact keeps no per-entry rows');
  assert.ok(compact.length < detailed.length, 'compact is shorter');
  for (const text of ['3 executed', '2 succeeded', '1 failed', 'wall time 23.9s']) {
    assert.ok(compact.some(line => line.includes(text)), `compact keeps ${text}`);
    assert.ok(detailed.some(line => line.includes(text)), `detailed keeps ${text}`);
  }
  assert.deepEqual(plain(renderQueueSummary(sample(), 80, 30)), detailed, 'detailed is the default');
});

test('exit codes and durations can each be hidden without changing status truthfulness', () => {
  const noExit = plain(renderQueueSummary(sample(), 80, 30, {exitCodes: false}));
  assert.ok(!noExit.some(line => line.includes('exit 1')));
  assert.ok(noExit.some(line => line.includes('1.4s')), 'the observed duration stays');
  const noDuration = plain(renderQueueSummary(sample(), 80, 30, {durations: false}));
  assert.ok(noDuration.some(line => line.includes('exit 1')));
  assert.ok(!noDuration.some(line => line.includes('1.4s')));
  for (const lines of [noExit, noDuration]) {
    assert.ok(lines.some(line => line.includes(GLYPHS.failure)), 'the failed row keeps its status glyph');
    assert.ok(lines.some(line => line.includes('1 failed')), 'and its factual count');
  }
});

test('a missing duration, wait or exit renders nothing rather than a placeholder', () => {
  const bare = plain(renderQueueSummary(sample({entries: [{outcome: 'failed', label: 'command 1'}],
    counts: {succeeded: 0, failed: 1, interrupted: 0, skipped: 0, unobserved: 0}}), 80, 30));
  const row = find(bare, GLYPHS.failure)!;
  assert.equal(row.trimEnd().endsWith('command 1'), true, 'the row ends after its label');
  const waits = plain(renderQueueSummary(sample({entries: [{outcome: 'succeeded', label: 'npm', durationMs: 500, inputWaitMs: 250, exitCode: 0}]}), 80, 30, {inputWaits: true}));
  assert.ok(find(waits, 'waited 250 ms'), 'an observed input wait is shown when asked for');
  const hidden = plain(renderQueueSummary(sample({entries: [{outcome: 'succeeded', label: 'npm', durationMs: 500, inputWaitMs: 250, exitCode: 0}]}), 80, 30));
  assert.ok(!hidden.some(line => line.includes('waited')), 'input waits appear only when enabled');
});

test('the aggregate lines always state factual counts and wall elapsed, or that nothing ran', () => {
  const bare = plain(renderQueueSummary(sample(), 80, 30));
  for (const text of ['3 executed', '2 succeeded', '1 failed', 'wall time 23.9s']) assert.ok(bare.join('\n').includes(text), text);
  const empty = plain(renderQueueSummary(sample({entries: [], startedAt: undefined, endedAt: undefined, elapsedMs: 0,
    counts: {succeeded: 0, failed: 0, interrupted: 0, skipped: 0, unobserved: 1}}), 80, 30));
  assert.ok(empty.join('\n').includes('no execution observed'));
  assert.ok(!empty.join('\n').includes('wall time'), 'no wall time was observed, so none is printed');
  assert.ok(empty.join('\n').includes('1 without exec'));
  const omitted = plain(renderQueueSummary(sample({entriesOmitted: 2}), 80, 30));
  assert.ok(omitted.join('\n').includes('2 results not detailed'), 'what left the review detail is counted, not hidden');
});

test('80×30 and 32×18 stay readable without cutting an exit code away', () => {
  const long = sample({entries: [{outcome: 'failed', label: 'command 2', durationMs: 1400, exitCode: 1,
    text: 'npm run lint -- --max-warnings 0 --report-unused-disable-directives'}]});
  for (const columns of [80, 32]) {
    const bare = plain(renderQueueSummary(long, columns, 18));
    assert.ok(bare.length > 0);
    for (const line of bare) assert.ok(displayWidth(line) <= columns, `${columns}: ${line}`);
    assert.ok(bare.join('\n').includes('exit 1'), `${columns}: the exit code survives`);
    assert.ok(bare.join('\n').includes('wall time 23.9s'), `${columns}: the wall time survives`);
    assert.ok(bare.join('\n').includes('1 failed'), `${columns}: the count survives`);
  }
  assert.ok(find(plain(renderQueueSummary(long, 32, 18)), '…'), 'a long reviewed text truncates before the facts');
});

test('Safe glyphs and NO_COLOR keep the same shape', () => {
  const colored = renderQueueSummary(sample(), 80, 30);
  const before = {icons: process.env.NMSH_ICONS, noColor: process.env.NO_COLOR};
  try {
    process.env.NMSH_ICONS = 'safe';
    process.env.NO_COLOR = '1';
    setIconStyle('safe');
    const safe = plain(renderQueueSummary(sample(), 80, 30));
    assert.doesNotMatch(safe.join('\n'), /\u001b\[[34]8;/u, 'no color escapes under NO_COLOR');
    assert.equal(safe.length, colored.length, 'the same rows');
    for (const text of ['Queue Summary', '3 executed', '2 succeeded', '1 failed', 'wall time 23.9s']) assert.ok(safe.join('\n').includes(text), text);
    assert.ok(safe.some(line => line.includes(`${GLYPHS.failure} `)), 'Safe failure glyph');
    assert.ok(plain(colored).some(line => line.includes('✘ ')));
    assert.deepEqual(safe.map(line => displayWidth(line)), plain(colored).map(line => displayWidth(line)));
  } finally {
    setIconStyle('nerd');
    if (before.icons === undefined) delete process.env.NMSH_ICONS; else process.env.NMSH_ICONS = before.icons;
    if (before.noColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before.noColor;
  }
});

test('the plain form is the same layout without presentation chrome', () => {
  const options = {detail: 'compact', placement: 'right', align: 'center', durations: false, inputWaits: true} as const;
  assert.deepEqual(plain(renderQueueSummary(sample(), 80, 30, options)), queueSummaryLines(sample(), 80, options));
  assert.ok(queueSummaryLines(sample(), 80).every(line => !line.includes('\u001b')));
});
