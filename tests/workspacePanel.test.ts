import test from 'node:test';
import assert from 'node:assert/strict';
import {diffContent, factDetail, PanelController, renderPanel, resourceDetail, worktreeDetail} from '../src/workspace/panel.js';
import type {WorktreeRecord} from '../src/worktrees/model.js';
import type {ContextFact} from '../src/context/facts.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@ export function main() {',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '--flag stays a deletion of "-flag"',
  '\\ No newline at end of file',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
  'diff --git a/old.txt b/new.txt',
  'similarity index 100%',
  'rename from old.txt',
  'rename to new.txt',
].join('\n');

test('local diff: hunks through the shared parser, binary and rename-only files named, markers kept', () => {
  const content = diffContent('diff:wt', 'feature', DIFF, 'git diff', 1000);
  const headings = content.lines.filter(line => line.kind === 'heading').map(line => (line as {text: string}).text);
  assert.deepEqual(headings, ['src/app.ts', 'logo.png', 'old.txt → new.txt']);
  const diff = content.lines.filter(line => line.kind === 'diff').map(line => line.kind === 'diff' ? [line.line.kind, line.line.text] : []);
  assert.deepEqual(diff, [['ctx', 'const a = 1;'], ['del', 'const b = 2;'], ['add', 'const b = 3;'], ['del', '-flag stays a deletion of "-flag"'], ['note', 'No newline at end of file']]);
  assert.ok(content.lines.some(line => line.kind === 'muted' && line.text === 'binary file: not shown'));
  assert.ok(content.lines.some(line => line.kind === 'muted' && /rename only/u.test(line.text)));
  assert.equal(content.partial, undefined);
  const panel = new PanelController();
  panel.show(content);
  const plain = renderPanel(panel, {width: 60, rows: 30, focused: false, safe: true, color: false, now: 2000});
  assert.ok(plain.includes('--flag stays a deletion of "-flag"'), 'a deleted line that starts with "-" keeps its own dash');
  assert.ok(plain.includes('+const b = 3;'));
  assert.ok(plain.includes('\\ No newline at end of file'));
});

test('local diff: hostile content is inert and bounded; a cut diff says so', () => {
  const hostile = `diff --git a/x b/x\n@@ -1 +1 @@\n-\u001b]8;;https://evil\u0007link\u001b[2J\n+‮evil\u0000\n`;
  const panel = new PanelController();
  panel.show(diffContent('d', 'x', hostile, 'git diff'));
  for (const line of renderPanel(panel, {width: 40, rows: 12, focused: true, safe: false, color: false, now: 0})) assert.doesNotMatch(line, /[\u0000-\u0008\u000b-\u001f\u007f‮]/u);
  const big = `diff --git a/x b/x\n@@ -1,5000 +1,5000 @@\n${Array.from({length: 5000}, (_, i) => `+line ${i}`).join('\n')}\n`;
  const cut = diffContent('d', 'x', big, 'git diff', undefined, 100);
  assert.match(cut.partial!, /up to 100 lines/u);
  assert.ok(cut.lines.filter(line => line.kind === 'diff').length <= 100);
  assert.deepEqual(diffContent('d', 'x', '', 'git diff').lines, [{kind: 'muted', text: 'no changes'}]);
});

test('resource and worktree details say what opening would do, or why it cannot; nothing is inferred', () => {
  const tmux = resourceDetail({id: 'tmux:$1:@2', kind: 'tmuxWindow', label: '1 servers', support: 'activatable', activation: {kind: 'tmux', scope: 'window', target: '@2'}, observedAt: 5, children: []});
  assert.ok(tmux.lines.some(line => line.kind === 'text' && line.text === 'Enter: tmux selects this window and switches your client to it.'));
  const codex = resourceDetail({id: 'x', kind: 'managedTarget', label: 'Codex', support: 'unsupported', reason: 'no supported Codex adapter yet'});
  assert.ok(codex.lines.some(line => line.kind === 'muted' && /Cannot be opened here: no supported Codex adapter yet/u.test(line.text)));
  const record: WorktreeRecord = {id: '/w', path: '/w', ref: 'refs/heads/f', branch: 'f', head: 'abcdef1234567890', detached: false, bare: false, main: false,
    locked: true, lockedReason: 'on a USB drive', prunable: false, pathState: 'present', status: {kind: 'unknown', reason: 'status timed out'}};
  const detail = worktreeDetail(record, 9);
  assert.deepEqual(detail.lines.slice(0, 4), [{kind: 'field', label: 'Path', value: '/w'}, {kind: 'field', label: 'Checkout', value: 'f'},
    {kind: 'field', label: 'HEAD', value: 'abcdef123456'}, {kind: 'field', label: 'Status', value: 'unknown (status timed out)'}], 'an unknown status is never shown as clean');
});

const fact = (value: unknown, extra: Partial<ContextFact<unknown>> = {}): ContextFact<unknown> => ({value, source: {capability: 'runtime.node', evidence: '.nvmrc, node on PATH'},
  collectedAt: 1000, freshness: 'fresh', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe', resolution: 'bounded-async', ...extra});

test('module detail: value, provenance, freshness and what the capability reads; private fields stay private', () => {
  const shown = factDetail('runtime.node', 'Node.js version', ['.nvmrc', 'node_version.h'], fact({requested: '22', active: '22.11.0'}), 11_000);
  assert.deepEqual(shown.lines.slice(0, 2), [{kind: 'field', label: 'requested', value: '22'}, {kind: 'field', label: 'active', value: '22.11.0'}]);
  assert.ok(shown.lines.some(line => line.kind === 'field' && line.label === 'Collected' && line.value === '10 s ago'));
  assert.ok(shown.lines.some(line => line.kind === 'muted' && line.text === 'node_version.h'));
  const secret = factDetail('agent.claude', 'Claude', [], fact({cost: 3}, {sensitivity: 'secret'}), 0);
  assert.ok(secret.lines.some(line => line.kind === 'muted' && /not displayable/u.test(line.text)));
  assert.ok(factDetail('x.y', 'X', [], undefined, 0).lines[0]!.kind === 'muted');
});

test('panel: exact size, focus mark without color, scrolling clamps, the same content keeps its scroll, previews come from the cache', () => {
  const panel = new PanelController();
  const long = {id: 'a', title: 'Long', source: 'test', observedAt: 0, lines: Array.from({length: 80}, (_, i) => ({kind: 'text' as const, text: `line ${i} ${'word '.repeat(i % 7)}`}))};
  panel.show(long);
  for (const width of [10, 24, 40, 72]) for (const rows of [1, 2, 5, 20]) for (const color of [true, false]) for (const focused of [true, false]) {
    const lines = renderPanel(panel, {width, rows, focused, safe: false, color, now: 120_000});
    assert.equal(lines.length, rows);
    for (const line of lines) assert.ok(displayWidth(stripAnsi(line)) <= width, `${width}x${rows}: ${stripAnsi(line)}`);
  }
  const focused = renderPanel(panel, {width: 40, rows: 10, focused: true, safe: true, color: false, now: 120_000});
  assert.match(focused[0]!, /^> Long/u);
  assert.match(focused[1]!, /^test · 2m ago, stale/u);
  assert.match(focused.at(-1)!, /^1-7\/80 · /u);
  assert.match(renderPanel(panel, {width: 40, rows: 10, focused: false, safe: true, color: false, now: 1000})[0]!, /^ {2}Long/u);
  panel.dispatch('panel.pageDown', 8);
  assert.equal(panel.scroll, 7);
  for (let i = 0; i < 50; i++) panel.dispatch('panel.pageDown', 8);
  renderPanel(panel, {width: 40, rows: 10, focused: true, safe: true, color: false, now: 0});
  assert.equal(panel.scroll, 80 - 7, 'scrolling stops at the end');
  panel.show({...long, lines: long.lines.slice(0, 79)});
  assert.equal(panel.scroll, 73, 'a refresh of the same content keeps its place');
  panel.show({id: 'b', title: 'Other', source: 'test', lines: []});
  assert.equal(panel.scroll, 0);
  assert.equal(panel.cached('a')?.title, 'Long');
  for (let i = 0; i < 40; i++) panel.show({id: `n${i}`, title: `${i}`, source: 'test', lines: []});
  assert.equal(panel.cached('a'), undefined, 'the preview cache is bounded');
  const empty = new PanelController();
  assert.match(renderPanel(empty, {width: 40, rows: 3, focused: false, safe: true, color: false, now: 0})[1]!, /Select something/u);
});
