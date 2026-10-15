import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueEntry, QueueState} from '../src/session/CommandQueue.js';
import {queueBlock, queueRow} from '../src/status/queueStatus.js';
import {planScreen, regionOf, withQueueRows, type ScreenPlanInput} from '../src/app/screenPlan.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

/**
 * The queue preview near the composer: what runs next and in what order, without opening /queue; the inline review
 * a first empty Enter arms; and the screen plan rows it takes from the transcript's view, never from the shell's PTY.
 */
function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(patch).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(patch)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { return run(); } finally {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

const entry = (id: number, text: string, extra: Partial<QueueEntry> = {}): QueueEntry => ({id, text, addedAt: id, ...extra});
const five: QueueState = {entries: [entry(1, 'npm run build'), entry(2, 'npm test'), entry(3, 'git status', {condition: 'always'}), entry(4, 'git push'), entry(5, 'open .')]};
const plain = (rows: string[] | undefined) => rows?.map(stripAnsi);

test('preview: up to three commands in run order, then +N more; one plain entry stays one line', () => {
  withEnv({NO_COLOR: undefined, NMSH_ICONS: undefined, TERM: 'xterm-256color'}, () => {
    assert.deepEqual(plain(queueBlock(five, 80, 5)), [
      '╭─ ≡ Queue · 5 pending',
      '├─ next  npm run build',
      '├─ 2     npm test',
      '├─ 3     git status · runs even after a failure',
      '╰─ +2 more · /queue',
    ]);
    // Less room: fewer commands, and the footer still says how many are not shown.
    assert.deepEqual(plain(queueBlock(five, 80, 3)), ['╭─ ≡ Queue · 5 pending', '├─ next  npm run build', '╰─ +4 more · /queue']);
    // Three or fewer: the last listed command closes the list.
    assert.deepEqual(plain(queueBlock({entries: five.entries.slice(0, 2)}, 80, 5)), ['╭─ ≡ Queue · 2 pending', '├─ next  npm run build', '╰─ 2     npm test']);
    assert.equal(queueBlock({entries: [entry(1, 'ls')]}, 80, 5), undefined, 'one plain entry: the one-line row says it all');
    assert.equal(queueBlock(five, 80, 1), undefined, 'no room for a listed command');
    // Multi-line entries show their first line and how many more lines run with it.
    assert.match(plain(queueBlock({entries: [entry(1, 'cd build &&\nmake\nmake install'), entry(2, 'ls')]}, 80, 5))![1]!, /next {2}cd build && \(\+2 lines\)$/u);
  });
});

test('preview: a paused queue and an entry that asks first say so in the header; the hint appears only when offered', () => {
  withEnv({NO_COLOR: undefined, NMSH_ICONS: undefined, TERM: 'xterm-256color'}, () => {
    const paused: QueueState = {...five, paused: {reason: 'interrupted', at: 1, command: 'sleep 10'}};
    const rows = plain(queueBlock(paused, 80, 5, {affordance: 'resume'}))!;
    assert.equal(rows[0], '╭─ ⏸ Queue paused · 5 pending');
    assert.equal(rows[1], '├─ 1  npm run build', 'paused: nothing is "next" until it resumes');
    assert.equal(rows.at(-1), '╰─ +2 more · Enter to review before anything runs · /queue');
    assert.equal(plain(queueBlock(paused, 80, 5))!.at(-1), '╰─ +2 more · /queue', 'no hint where Enter would not review (a command runs, a draft is typed)');
    const asks: QueueState = {entries: [entry(1, 'rm -r build', {condition: 'approve'}), entry(2, 'make')]};
    const ask = plain(queueBlock(asks, 80, 5, {affordance: 'approve'}))!;
    assert.equal(ask[0], '╭─ ≡ Queue · next needs your approval', 'the same words as the one-line row');
    assert.equal(ask[1], '├─ next  rm -r build · asks first');
    assert.equal(ask.at(-1), '╰─ Enter to review it · /queue');
  });
});

test('review: the whole command that will run, and exactly what each key does', () => {
  withEnv({NO_COLOR: undefined, NMSH_ICONS: undefined, TERM: 'xterm-256color'}, () => {
    const asks: QueueState = {entries: [entry(1, 'cd build\nrm -rf out\nmake', {condition: 'approve'}), entry(2, 'make test')]};
    assert.deepEqual(plain(queueBlock(asks, 80, 7, {review: 'approve'})), [
      '╭─ Approve and run this command?',
      '├─ cd build',
      '│  rm -rf out',
      '│  make',
      '╰─ Enter or y approves · n not now · e edits · Esc',
    ]);
    // Too long to show whole: it says how much is not shown, and how to see it before approving.
    const long = plain(queueBlock({entries: [entry(1, Array.from({length: 9}, (_, i) => `step ${i}`).join('\n'), {condition: 'approve'})]}, 80, 5, {review: 'approve'}))!;
    assert.equal(long.length, 5);
    assert.equal(long[3], '│  … 7 more lines · e shows all');
    const resume = plain(queueBlock({...five, paused: {reason: 'failed', at: 1, command: 'make', exitCode: 2}}, 80, 5, {review: 'resume'}))!;
    assert.equal(resume[0], '╭─ ⏸ Resume the queue? 5 pending');
    assert.equal(resume.at(-1), '╰─ +2 more · Enter resumes · Esc keeps it paused · e edits next');
    // The one-line forms say the same.
    assert.match(stripAnsi(queueRow(asks, 100, {review: 'approve'})!), /^Approve and run: cd build \(\+2 lines\) · Enter or y approves · n not now · e edits · Esc$/u);
    assert.match(stripAnsi(queueRow({...five, paused: {reason: 'user', at: 1}}, 100, {affordance: 'resume'})!), /^⏸ Queue paused · 5 waiting · Enter to review · \/queue$/u);
  });
});

test('preview: narrow widths, NO_COLOR and Safe glyphs stay aligned and legible', () => {
  withEnv({NO_COLOR: '1', NMSH_ICONS: 'safe'}, () => {
    const rows = queueBlock(five, 60, 5)!;
    assert.doesNotMatch(rows.join(''), /\u001b\[38;/u, 'no color under NO_COLOR');
    assert.deepEqual(rows.map(row => stripAnsi(row).slice(0, 2)), ['+-', '|-', '|-', '|-', "'-"], 'ASCII connectors in the same columns');
    assert.equal(stripAnsi(rows[1]!).indexOf('npm'), stripAnsi(rows[2]!).indexOf('npm'), 'commands line up under each other');
  });
  withEnv({NO_COLOR: undefined, NMSH_ICONS: undefined, TERM: 'xterm-256color'}, () => {
    for (const columns of [24, 30, 40, 60]) {
      for (const row of queueBlock(five, columns, 5, {affordance: 'resume'}) ?? []) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
    }
    assert.equal(queueBlock(five, 20, 5), undefined, 'too narrow for a list: the one-line row stays');
    for (const columns of [12, 20, 40]) assert.ok(displayWidth(stripAnsi(queueRow({...five, paused: {reason: 'user', at: 1}}, columns, {affordance: 'resume'})!)) <= columns);
  });
});

test('geometry: the list takes rows from the transcript view, right after the activity region; the PTY never resizes', () => {
  const base: ScreenPlanInput = {rows: 30, inputRows: 1, suggestions: 0, running: true, detached: false, hasOutput: true,
    contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', transcriptRows: 200};
  for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
    const plan = planScreen({...base, composerPosition});
    const listed = withQueueRows(plan, 4);
    const activity = regionOf(listed, 'activity')!;
    const queue = regionOf(listed, 'queue')!;
    assert.equal(listed.ptyRows, plan.ptyRows, `${composerPosition}: the running program keeps its terminal size`);
    assert.equal(queue.height, 4, composerPosition);
    assert.equal(queue.top, activity.top + activity.height, `${composerPosition}: the list follows the activity region`);
    assert.equal(listed.transcript.height, plan.transcript.height - 4, composerPosition);
    // Regions never overlap and stay inside the screen.
    const sorted = [...listed.regions].sort((a, b) => a.top - b.top);
    sorted.forEach((region, index) => { if (index) assert.ok(region.top >= sorted[index - 1]!.top + sorted[index - 1]!.height, `${composerPosition}: ${region.kind} overlaps`); });
    assert.ok(sorted.at(-1)!.top + sorted.at(-1)!.height <= listed.rows);
  }
  // A short screen keeps at least three transcript rows; nothing at all when even that is not possible.
  const short = planScreen({...base, rows: 12});
  const squeezed = withQueueRows(short, 4);
  assert.equal(squeezed.transcript.height, Math.min(3, short.transcript.height));
  const tiny = planScreen({...base, rows: 9});
  assert.equal(regionOf(withQueueRows(tiny, 4), 'queue')?.height ?? 0, Math.max(0, tiny.transcript.height - 3), 'only what the transcript can spare');
  assert.equal(withQueueRows(planScreen({...base, panelRows: 10}), 4).regions.some(region => region.kind === 'queue'), false, 'a panel owns the screen');
});

test('paste review: NMSh commands among other lines are named, with where they go; one on its own needs no note', async () => {
  const {analyzePaste, nmshCommandNote, needsPreview} = await import('../src/input/pasteGuard.js');
  const {createPasteReview, renderPasteReview} = await import('../src/input/PasteReview.js');
  const mixed = analyzePaste('printf one\n/copy\n/compare 1 2\nls');
  assert.deepEqual(mixed.commands.map(command => command.kinds), [['read'], ['nmsh'], ['nmsh'], ['read']]);
  assert.equal(nmshCommandNote(mixed, 'zsh'), '/copy, /compare are NMSh commands: here they reach zsh as text. Submit each alone to run it in NMSh.');
  assert.equal(nmshCommandNote(analyzePaste('/copy'), 'zsh'), undefined, 'on its own it is NMSh\'s');
  assert.equal(nmshCommandNote(analyzePaste('echo a\n/usr/bin/env true'), 'zsh'), undefined, 'an absolute path is the shell\'s');
  assert.equal(nmshCommandNote(analyzePaste('echo a\n/notacommand'), 'zsh'), undefined, 'only real NMSh commands');
  assert.ok(needsPreview(mixed, 'smart'));
  const review = createPasteReview('echo a\n/queue', analyzePaste('echo a\n/queue'), true, 'bash');
  const text = renderPasteReview(review, 100, 12).map(row => stripAnsi(row)).join('\n');
  assert.match(text, /NMSh command\s+\/queue/u);
  assert.match(text, /\/queue is an NMSh command: here it reaches bash as text\. Submit it alone to run it in NMSh\./u);
  assert.ok(renderPasteReview(review, 100, 12).length <= 12, 'the note takes a body row, never more than the height');
});
