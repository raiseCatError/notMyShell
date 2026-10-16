import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {renderQueueHistoryPanel} from '../src/queue/QueueHistoryPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {QueueOp} from '../src/session/CommandQueue.js';

interface Harness {
  app: TerminalApp;
  dispatcher: {onExec(command: string): void; onPrompt(exitCode: number): void; request(op: QueueOp): void};
  sent: QueueOp[];
  dims: {columns: number; rows: number};
  /** Paint one real frame and return its rows, so composition is asserted on what the renderer shows. */
  paint(): string[];
}

/** A window whose in-process session the test drives directly: no real shell, exact observed chain facts. */
function fixture(): Harness {
  const app = new TerminalApp();
  let frame: {rows: readonly string[]} | undefined;
  Object.defineProperty(app['renderer'], 'render', {value: (next: {rows: readonly string[]}) => { frame = next; }});
  const dims = {columns: 80, rows: 30};
  Object.defineProperty(app, 'dimensions', {value: () => dims, configurable: true});
  app['startupPending'] = false;
  const dispatcher = app['session']['dispatcher'];
  // The owner dispatches through this shell; a test chain needs no real prompt cycle.
  dispatcher['shell'] = {isReady: true, adapter: {id: 'zsh'}, submit() {}};
  const sent: QueueOp[] = [];
  const original = app['session'].queue.bind(app['session']);
  Object.defineProperty(app['session'], 'queue', {value: (op: QueueOp) => { sent.push(op); original(op); }, configurable: true});
  const paint = (): string[] => { app['render'](); return (frame?.rows ?? []).map(row => stripAnsi(row).replace(/\s+$/u, '')); };
  return {app, dispatcher, sent, dims, paint};
}

const dispose = (app: TerminalApp) => { app['stop'](0); app['session'].kill(); };

/** One settled chain: the first command is the foreground one the queue joined; every step's code is observed. */
function chain(dispatcher: Harness['dispatcher'], steps: Array<{text: string; code: number}>): void {
  dispatcher.request({op: 'resume'});
  dispatcher.onExec(steps[0]!.text);
  for (const [index, step] of steps.slice(1).entries()) {
    dispatcher.request({op: 'add', text: step.text});
    dispatcher.onPrompt(steps[index]!.code);
    dispatcher.onExec(step.text);
  }
  dispatcher.onPrompt(steps.at(-1)!.code);
}

const blockRows = (app: TerminalApp, columns = 80, budget = 8): string[] =>
  (app['queueBlockRows'](columns, budget) ?? []).map(row => stripAnsi(row));
const blockText = (app: TerminalApp, columns = 80, budget = 8): string => blockRows(app, columns, budget).join('\n');
const panelText = (app: TerminalApp, columns = 80, height = 24): string =>
  renderQueueHistoryPanel(app['queueHistoryPanel'], app['queueState'], columns, height).map(row => stripAnsi(row)).join('\n');

test('every /queue form keeps its meaning; history and save-summary join the aliases', () => {
  assert.deepEqual(parseSlashCommand('/queue'), {kind: 'queue', op: 'open'});
  assert.deepEqual(parseSlashCommand('/q'), {kind: 'queue', op: 'open'});
  assert.deepEqual(parseSlashCommand('/qp'), {kind: 'queue', op: 'pause'});
  assert.deepEqual(parseSlashCommand('/pause'), {kind: 'queue', op: 'pause'});
  assert.deepEqual(parseSlashCommand('/queue pause'), {kind: 'queue', op: 'pause'});
  assert.deepEqual(parseSlashCommand('/qr'), {kind: 'queue', op: 'resume'});
  assert.deepEqual(parseSlashCommand('/queue resume'), {kind: 'queue', op: 'resume'});
  assert.deepEqual(parseSlashCommand('/qc'), {kind: 'queue', op: 'clear'});
  assert.deepEqual(parseSlashCommand('/queue clear'), {kind: 'queue', op: 'clear'});
  assert.deepEqual(parseSlashCommand('/queue settings'), {kind: 'settings', view: 'config', destination: 'queue'});
  assert.deepEqual(parseSlashCommand('/queue history'), {kind: 'queue', op: 'history'});
  assert.deepEqual(parseSlashCommand('/q history'), {kind: 'queue', op: 'history'});
  assert.deepEqual(parseSlashCommand('/queue save-summary'), {kind: 'queue', op: 'save-summary'});
  assert.deepEqual(parseSlashCommand('/q save-summary'), {kind: 'queue', op: 'save-summary'});
});

test('/queue history opens the owner’s recent chains; an empty history just explains', () => {
  const {app, dispatcher} = fixture();
  try {
    app['handleQueueCommand']('/queue history', 'history');
    assert.equal(app['queueHistoryPanel'], undefined, 'nothing finished: no modal takes the screen');
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'npm test', code: 1}]);
    app['handleQueueCommand']('/queue history', 'history');
    assert.deepEqual(app['queueHistoryPanel'], {selected: 0});
    const text = panelText(app);
    assert.match(text, /Queue history/u);
    assert.match(text, /chain 1/u);
    assert.match(text, /2 results · 1 failed/u);
    assert.doesNotMatch(text, /summary saved/u, 'nothing was saved for this chain yet');
    // The panel is a modal: Esc closes it and hands the screen back.
    app['handleKey']({kind: 'escape'});
    assert.equal(app['queueHistoryPanel'], undefined);
  } finally { dispose(app); }
});

test('the history panel selects chains, asks for one detail at a time, and hands its chain to the save review', () => {
  const {app, dispatcher, sent} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'git diff --stat', code: 0}]);
    chain(dispatcher, [{text: 'npm --version', code: 0}, {text: 'git status', code: 0}]);
    app['handleQueueCommand']('/queue history', 'history');
    assert.match(panelText(app), /recent 2 chains/u);

    // Enter asks the owner for the selected chain's retained results, and only the selected one.
    app['handleKey']({kind: 'enter'});
    assert.equal(app['queueHistoryPanel']?.detail, 2);
    assert.deepEqual(sent.at(-1), {op: 'history-detail', chainId: 2});
    assert.match(panelText(app), /Retained results/u);
    assert.match(panelText(app), /git status/u);
    assert.match(panelText(app), /Enter hide results/u, 'the key that opened it dismisses it');

    app['handleKey']({kind: 'down'});
    assert.equal(app['queueHistoryPanel']?.selected, 1, 'down moves to the older chain');
    assert.match(panelText(app), /chain 1/u);
    app['handleKey']({kind: 'enter'});
    assert.deepEqual(sent.at(-1), {op: 'history-detail', chainId: 1}, 'a new selection asks for its own chain');
    assert.match(panelText(app), /git diff --stat/u);

    // `s` hands the selected chain to the same reviewed save; nothing is stored yet.
    app['handleKey']({kind: 'text', value: 's'});
    assert.equal(app['queueHistoryPanel'], undefined, 'the review takes the screen');
    assert.equal(app['summaryReview']?.chainId, 1);
    assert.match(blockText(app), /Save this Queue Summary\?/u);
    assert.equal(app['queueState'].summaries, undefined, 'the review stores nothing by itself');

    // The same key dismisses what it opened when the chain is the one shown.
    app['handleQueueCommand']('/queue history', 'history');
    app['handleKey']({kind: 'enter'});
    assert.deepEqual(sent.at(-1), {op: 'history-detail', chainId: 2});
    app['handleKey']({kind: 'enter'});
    assert.deepEqual(sent.at(-1), {op: 'history-detail'}, 'Enter on the shown chain dismisses its detail');
    assert.equal(app['queueHistoryPanel']?.detail, undefined);
  } finally { dispose(app); }
});

test('the reviewed save shows the redacted artifact it would store, and Enter stores exactly that', () => {
  const {app, dispatcher, sent, paint} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'deploy --token=abc123', code: 1}]);
    app['handleQueueCommand']('/queue save-summary', 'save-summary');
    assert.deepEqual(sent.at(-1), {op: 'history-detail', chainId: 1}, 'the review reads what the owner observed');
    const review = app['summaryReview']!;
    assert.deepEqual(review.texts, ['npm run build', 'deploy --token=[REDACTED]']);
    const block = blockText(app);
    assert.match(block, /Save this Queue Summary\?/u);
    assert.match(block, /npm run build/u);
    assert.match(block, /deploy --token=\[REDACTED\]/u);
    assert.doesNotMatch(block, /abc123/u, 'the review never shows the raw secret');
    assert.match(paint().join('\n'), /Enter saves this summary · Esc cancels/u, 'the focused review says what its keys do');

    const revision = app['queueState'].revision;
    const shown = review.summary;
    app['summaryReviewKey']({kind: 'enter'});
    assert.deepEqual(sent.at(-1), {op: 'save-summary', chainId: 1, reviewed: {text: review.texts}, expectedRevision: revision});
    const saved = app['queueState'].summaries?.at(-1)!;
    assert.equal(saved.origin, 'reviewed');
    assert.deepEqual(
      {entries: saved.entries, counts: saved.counts, elapsedMs: saved.elapsedMs, entriesOmitted: saved.entriesOmitted},
      {entries: shown.entries, counts: shown.counts, elapsedMs: shown.elapsedMs, entriesOmitted: shown.entriesOmitted},
      'the stored artifact is what the review showed');
    assert.doesNotMatch(JSON.stringify(app['queueState'].summaries), /abc123/u, 'the raw secret is never stored');
  } finally { dispose(app); }
});

test('a review stores nothing when it is dismissed or goes stale', () => {
  const {app, dispatcher, sent} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'npm test', code: 0}]);
    app['handleQueueCommand']('/queue save-summary', 'save-summary');
    assert.ok(app['summaryReview']);
    app['summaryReviewKey']({kind: 'escape'});
    assert.equal(app['summaryReview'], undefined);
    assert.equal(app['queueState'].summaries, undefined, 'Esc never saves');
    assert.ok(!sent.some(op => op.op === 'save-summary'), 'nothing was even sent');

    // Any change to the queue while the review is open revokes it: nothing unseen is stored.
    app['handleQueueCommand']('/queue save-summary', 'save-summary');
    assert.ok(app['summaryReview']);
    dispatcher.request({op: 'pause'});
    assert.equal(app['summaryReview'], undefined, 'a changed queue revokes the review');
    assert.equal(app['queueState'].summaries, undefined);
    assert.match(app['output'].wrapped(80).map(row => row.plain).join('\n'), /queue changed while the summary review was open/u);

    // A save that happened elsewhere first stands; the review never rewrites or duplicates it.
    dispatcher.request({op: 'resume'});
    app['handleQueueCommand']('/queue save-summary', 'save-summary');
    assert.ok(app['summaryReview']);
    dispatcher.request({op: 'save-summary', chainId: 1});
    assert.equal(app['summaryReview'], undefined, 'an existing artifact dismisses the review');
    assert.equal(app['queueState'].summaries?.length, 1);
    assert.equal(app['queueState'].summaries?.[0]?.origin, 'automatic', 'the first save stands');
  } finally { dispose(app); }
});

test('the saved summary chrome waits for the completed view, then dismisses, and a new chain replaces it', () => {
  const {app, dispatcher} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'npm run lint', code: 0}]);
    assert.equal(app['summaryChrome'](), undefined);
    assert.match(blockText(app), /Queue finished · 2 commands/u, 'the completed view owns the space first');
    dispatcher.request({op: 'save-summary', chainId: 1});
    assert.equal(app['summaryChrome'](), undefined, 'the completed view still owns the space');
    app['queueTransientUntil'] = 0;
    const shown = blockText(app);
    assert.match(shown, /Queue Summary/u);
    assert.match(shown, /npm/u, 'an automatic artifact keeps recognized labels');
    assert.doesNotMatch(shown, /run build/u, 'an automatic artifact never stores command text');
    assert.match(shown, /wall time/u);
    assert.match(stripAnsi(app['queueLine'](80) ?? ''), /^Queue Summary · 2 executed · 2 succeeded/u);

    // Queue Settings drive the same renderer.
    const facts = blockRows(app);
    assert.equal(facts.filter(row => /exit 0 · (?:<1|\d+) ms/u.test(row)).length, 2, 'each entry carries its own observed duration');
    app['promptConfiguration'].queue.summaryDurations = false;
    assert.ok(!blockRows(app).some(row => /exit 0 · (?:<1|\d+) ms/u.test(row)), 'durations are optional');
    app['promptConfiguration'].queue.summaryDurations = true;
    app['promptConfiguration'].queue.summaryDetail = 'compact';
    assert.doesNotMatch(blockText(app), /npm/u, 'Compact keeps the counts and drops the entries');
    assert.match(blockText(app), /wall time/u);
    app['promptConfiguration'].queue.summaryDetail = 'detailed';
    app['promptConfiguration'].queue.summaryPlacement = 'right';
    app['promptConfiguration'].queue.summaryAlign = 'right';
    assert.match(blockText(app), /Queue Summary/u, 'placement and alignment never change the facts');
    app['promptConfiguration'].queue.summaryPlacement = 'center';
    app['promptConfiguration'].queue.summaryAlign = 'left';

    // A new settled chain replaces the summary with its own completed view...
    chain(dispatcher, [{text: 'git status', code: 0}, {text: 'git diff', code: 0}]);
    assert.equal(app['summaryChrome'](), undefined);
    assert.match(blockText(app), /Queue finished · 2 commands/u);
    assert.doesNotMatch(blockText(app), /Queue Summary/u);
    // ...and once that dismisses, the newest saved artifact is back.
    app['queueTransientUntil'] = 0;
    assert.match(blockText(app), /Queue Summary/u);
    assert.match(blockText(app), /npm/u);
  } finally { dispose(app); }
});

test('the summary block is chrome: the transcript, records and journal never carry it', () => {
  const {app, dispatcher, paint} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'npm run lint', code: 0}]);
    dispatcher.request({op: 'save-summary', chainId: 1});
    app['queueTransientUntil'] = 0;
    assert.ok(app['summaryChrome']());
    assert.match(paint().join('\n'), /Queue Summary/u, 'the chrome is painted from the screen plan');
    const transcript = app['output'].wrapped(80).map(row => row.plain).join('\n');
    assert.doesNotMatch(transcript, /Queue Summary/u, 'the transcript never carries chrome');
    assert.doesNotMatch(transcript, /2 executed/u);
    assert.doesNotMatch(JSON.stringify(app['output'].transcript().records), /Queue Summary/u);
    assert.deepEqual(app['output'].transcript().queueSummaries?.map(summary => summary.id), ['chain-1'],
      'the journal carries the typed artifact only');

    // A queued entry owns the space again instead of the summary.
    dispatcher.request({op: 'pause'});
    dispatcher.request({op: 'add', text: 'echo later'});
    assert.equal(app['summaryChrome'](), undefined, 'pending work always wins over a saved summary');
    assert.match(blockText(app), /echo later/u);
    assert.doesNotMatch(blockText(app), /Queue Summary/u);
  } finally { dispose(app); }
});

test('a service without queue history is never sent the new operations and never clears the journaled artifacts', () => {
  const {app, dispatcher, sent} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'npm run lint', code: 0}]);
    dispatcher.request({op: 'save-summary', chainId: 1});
    const saved = app['queueState'].summaries!;
    // Pretend this window is attached to a service that only knows the base queue.
    Object.defineProperty(app['session'], 'features', {value: new Set(['queue']), configurable: true});
    app['output'].setQueueSummaries([]);
    sent.length = 0;

    app['handleQueueCommand']('/queue history', 'history');
    app['handleQueueCommand']('/queue save-summary', 'save-summary');
    assert.equal(app['queueHistoryPanel'], undefined);
    assert.deepEqual(sent, [], 'no operation reaches a service that cannot answer it');
    dispatcher.request({op: 'pause'});
    assert.equal(app['queueState'].summaries?.length, saved.length, 'the owner still holds its artifacts');
    assert.equal(app['output'].transcript().queueSummaries, undefined,
      'the missing feature leaves the journal exactly as the transcript carried it');
  } finally { dispose(app); }
});

test('a focused review pauses the completed view’s dismissal until it is answered', () => {
  const {app, dispatcher} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'npm run lint', code: 0}]);
    app['handleQueueCommand']('/queue save-summary', 'save-summary');
    assert.ok(app['summaryReview']);
    app['queueTransientUntil'] = performance.now() - 1;
    assert.equal(app['timelineVisible'](), true, 'the review holds the view it reviewed');
    app['handleKey']({kind: 'escape'});
    assert.equal(app['summaryReview'], undefined);
    assert.equal(app['timelineVisible'](), false, 'once answered, the expired view dismisses');
  } finally { dispose(app); }
});

test('the history panel stays bounded and legible at 80x30 and 32x18', () => {
  const {app, dispatcher} = fixture();
  try {
    chain(dispatcher, [{text: 'npm run build', code: 0}, {text: 'npm test -- --coverage', code: 1}]);
    app['handleQueueCommand']('/queue history', 'history');
    app['handleKey']({kind: 'enter'});
    for (const [columns, height] of [[80, 30], [32, 18]] as const) {
      const rows = renderQueueHistoryPanel(app['queueHistoryPanel'], app['queueState'], columns, height).map(row => stripAnsi(row));
      assert.ok(rows.some(row => row.includes('chain 1')), `${columns}: the chain is listed`);
      assert.ok(rows.some(row => row.includes('Retained results')), `${columns}: the retained results are shown`);
      for (const row of rows) assert.ok(displayWidth(row) <= columns, `${columns} wide, got ${displayWidth(row)}: ${row}`);
    }
    // At 80 columns the retained results keep the readable command text (redacted form); at 32 they truncate, never break.
    const wide = renderQueueHistoryPanel(app['queueHistoryPanel'], app['queueState'], 80, 30).map(row => stripAnsi(row));
    assert.ok(wide.some(row => row.includes('npm test -- --coverage')), '80: the observed command is legible');
    // The saved summary never grows wider than its host either.
    dispatcher.request({op: 'save-summary', chainId: 1});
    app['queueTransientUntil'] = 0;
    for (const row of blockRows(app, 32, 4)) assert.ok(displayWidth(row) <= 32, `32 wide: ${row}`);
    for (const row of app['queueBlockRows'](80, 8) ?? []) assert.ok(displayWidth(stripAnsi(row)) <= 80);
  } finally { dispose(app); }
});
