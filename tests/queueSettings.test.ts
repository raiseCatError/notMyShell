import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueDispatcher} from '../src/session/QueueDispatcher.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {adjustSettingsRow, configGroup, QUEUE_SETTINGS_ROW_IDS, SETTINGS_ENTRIES, SETTINGS_ROWS, settingsRowValue, toggleSettingsRow} from '../src/ui/SettingsPanel.js';
import {createRowPanel, renderRowPanel, rowPanelKey} from '../src/ui/RowPanel.js';
import {queueSettingsPreview} from '../src/status/queueSettingsPreview.js';
import {queueBlock} from '../src/status/queueStatus.js';
import {exportSettings, planImport} from '../src/configuration/portability.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {stripAnsi} from '../src/util/text.js';
import {isolateConfig} from './support/isolatedConfig.js';
import type {QueueState} from '../src/session/CommandQueue.js';
import type {QueueTimeline} from '../src/session/ExecutionTimeline.js';

const withQueue = (patch: Partial<PromptConfiguration['queue']>): PromptConfiguration =>
  ({...DEFAULT_PROMPT_CONFIGURATION, queue: {...DEFAULT_PROMPT_CONFIGURATION.queue, ...patch}});
const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;

const timeline: QueueTimeline = {id: 1, createdAt: 1000, startedAt: 1000, observedAt: 4000, elapsedMs: 3000, failurePolicy: 'pause', status: 'active',
  counts: {succeeded: 2, failed: 0, interrupted: 0, skipped: 0, unobserved: 0}, executions: [
    {id: 1, text: 'npm run build', source: 'queue', entryId: 1, startedAt: 1000, endedAt: 2000, durationMs: 1000, status: 'succeeded', exitCode: 0},
    {id: 2, text: 'npm run lint', source: 'queue', entryId: 2, startedAt: 2000, endedAt: 3000, durationMs: 1000, status: 'succeeded', exitCode: 0},
    {id: 3, text: 'npm test', source: 'queue', entryId: 3, startedAt: 3000, status: 'running'}]};
const running: QueueState = {timeline, revision: 4, entries: [{id: 4, text: 'git status', addedAt: 3000}, {id: 5, text: 'echo done', addedAt: 3000}]};
const plain = (state: QueueState, options: Record<string, unknown> = {}) => queueBlock(state, 80, 7, {now: 3000, animate: false, ...options})!.map(stripAnsi).join('\n');

test('queue presentation defaults match the approved spec: timeline on, two results, two upcoming, eight-second completed view', () => {
  assert.deepEqual(DEFAULT_PROMPT_CONFIGURATION.queue, {liveTimeline: true, recentResults: 2, upcoming: 2, transient: true, transientSeconds: 8});
  assert.deepEqual(normalizePromptConfiguration({}).queue, DEFAULT_PROMPT_CONFIGURATION.queue, 'an existing configuration keeps the defaults');
});

test('queue presentation normalization bounds every value and keeps a hand-set in-range retention', () => {
  assert.deepEqual(normalizePromptConfiguration({queue: {recentResults: -4, upcoming: 0, transientSeconds: 2}}).queue,
    {liveTimeline: true, recentResults: 0, upcoming: 1, transient: true, transientSeconds: 6});
  assert.deepEqual(normalizePromptConfiguration({queue: {recentResults: 9, upcoming: 9, transientSeconds: 300}}).queue,
    {liveTimeline: true, recentResults: 2, upcoming: 2, transient: true, transientSeconds: 30});
  assert.equal(normalizePromptConfiguration({queue: {recentResults: 1.5}}).queue.recentResults, 2, 'a non-integer falls back to the default');
  assert.equal(normalizePromptConfiguration({queue: {transientSeconds: 12}}).queue.transientSeconds, 12, 'any integer in 6–30 is kept, not snapped to a preset');
  assert.equal(normalizePromptConfiguration({queue: {liveTimeline: false, transient: false}}).queue.liveTimeline, false);
  assert.equal(normalizePromptConfiguration({queue: 'nope'}).queue.liveTimeline, true, 'a malformed group falls back to the defaults');
  assert.equal(normalizePromptConfiguration({queue: null}).queue.transientSeconds, 8);
});

test('the production renderer keeps the configured recent results and upcoming entries', () => {
  const full = plain(running);
  assert.match(full, /npm run build/u);
  assert.match(full, /npm run lint/u);
  assert.match(full, /git status.*Next/u);
  assert.match(full, /echo done.*Queued/u);
  assert.doesNotMatch(plain(running, {recentResults: 0}), /npm run build|npm run lint/u);
  const latestOnly = plain(running, {recentResults: 1});
  assert.doesNotMatch(latestOnly, /npm run build/u);
  assert.match(latestOnly, /npm run lint/u);
  const nextOnly = plain(running, {upcoming: 1});
  assert.match(nextOnly, /git status/u);
  assert.doesNotMatch(nextOnly, /echo done/u);
});

test('live timeline Off never renders the observed timeline; the classic pending list stays', () => {
  const classic = plain(running, {liveTimeline: false});
  assert.doesNotMatch(classic, /npm test|Running/u, 'no observed timeline rows');
  assert.doesNotMatch(classic, /npm run build/u, 'completed results are timeline presentation');
  assert.match(classic, /Queue · 2 pending/u);
  assert.match(classic, /git status/u);
});

test('/settings queue and /queue settings reach one Queue destination; every existing /queue form is unchanged', () => {
  const queue = {kind: 'settings', view: 'config', destination: 'queue'} as const;
  assert.deepEqual(parseSlashCommand('/settings queue'), queue);
  assert.deepEqual(parseSlashCommand('/config queue'), queue);
  assert.deepEqual(parseSlashCommand('/queue settings'), queue);
  assert.deepEqual(parseSlashCommand('/q settings'), queue);
  assert.deepEqual(parseSlashCommand('/settings'), {kind: 'settings', view: 'config'});
  assert.deepEqual(parseSlashCommand('/queue'), {kind: 'queue', op: 'open'});
  assert.deepEqual(parseSlashCommand('/queue pause'), {kind: 'queue', op: 'pause'});
  assert.deepEqual(parseSlashCommand('/qr'), {kind: 'queue', op: 'resume'});
  assert.deepEqual(parseSlashCommand('/settings nonsense'), {kind: 'unknown', input: '/settings nonsense'}, 'unknown arguments are not silently swallowed');
});

test('the Queue destination is one set of canonical rows: shared values, bounded steppers and dependent hiding', () => {
  const ids = new Set(SETTINGS_ROWS.map(item => item.id));
  for (const id of QUEUE_SETTINGS_ROW_IDS) assert.ok(ids.has(id), `${id} is a real Settings row`);
  const entry = SETTINGS_ENTRIES.find(item => item.id === 'queue')!;
  assert.equal(entry.control, 'child');
  assert.equal((entry as {destination?: string}).destination, 'queue');
  assert.equal(configGroup(row('queueTimeline')), 'Sessions & Alerts', 'the rows stay in the Sessions group of Config');
  assert.equal(settingsRowValue(row('queueRecentResults'), withQueue({recentResults: 0})), 'None');
  assert.equal(settingsRowValue(row('queueRecentResults'), withQueue({recentResults: 2})), '2');
  assert.equal(settingsRowValue(row('queueTransientSeconds'), withQueue({transientSeconds: 15})), '15s');
  assert.equal(toggleSettingsRow(row('queueRecentResults'), withQueue({recentResults: 2}))!.queue.recentResults, 0, 'stepping wraps');
  assert.equal(adjustSettingsRow(row('queueTransientSeconds'), withQueue({transientSeconds: 8}), 1)!.queue.transientSeconds, 10);
  assert.equal(toggleSettingsRow(row('queueTransient'), withQueue({transient: true}))!.queue.transient, false);
  assert.equal(toggleSettingsRow(row('queueTimeline'), withQueue({liveTimeline: true}))!.queue.liveTimeline, false);
});

test('the Queue panel edits the shared rows and hides values that no longer apply', () => {
  const panel = createRowPanel('Queue', '/queue · /settings queue', [...QUEUE_SETTINGS_ROW_IDS]);
  let config = DEFAULT_PROMPT_CONFIGURATION;
  rowPanelKey(panel, {kind: 'down'}, config);
  rowPanelKey(panel, {kind: 'down'}, config);
  const action = rowPanelKey(panel, {kind: 'enter'}, config);
  assert.equal(action?.kind, 'change');
  config = action!.configuration;
  assert.equal(config.queue.liveTimeline, false);
  const text = renderRowPanel(panel, config, 80, 40, []).map(stripAnsi).join('\n');
  assert.doesNotMatch(text, /Recent results|Upcoming entries/u, 'appearance counts disappear with the timeline');
  assert.match(text, /Completed view/u, 'history rows stay independent of the timeline switch');
  rowPanelKey(panel, {kind: 'down'}, config);
  const turnedOff = rowPanelKey(panel, {kind: 'enter'}, config);
  config = turnedOff!.configuration;
  assert.equal(config.queue.transient, false);
  assert.doesNotMatch(renderRowPanel(panel, config, 80, 40, []).map(stripAnsi).join('\n'), /Keep visible/u);
});

test('the Queue panel preview is the production renderer over frozen observations and follows the settings', () => {
  const lines = queueSettingsPreview(DEFAULT_PROMPT_CONFIGURATION, 76).map(stripAnsi);
  const text = lines.join('\n');
  assert.match(text, /Queue · 5 commands/u);
  assert.match(text, /npm run build.*1.0s/u);
  assert.match(text, /npm run lint/u);
  assert.match(text, /npm test.*Running/u);
  assert.match(text, /git status.*Next/u);
  assert.match(text, /echo done.*Queued/u);
  assert.deepEqual(queueSettingsPreview(DEFAULT_PROMPT_CONFIGURATION, 76).map(stripAnsi), lines, 'deterministic, no live session');
  const none = queueSettingsPreview(withQueue({recentResults: 0}), 76).map(stripAnsi).join('\n');
  assert.doesNotMatch(none, /npm run build|npm run lint/u);
  const one = queueSettingsPreview(withQueue({upcoming: 1}), 76).map(stripAnsi).join('\n');
  assert.doesNotMatch(one, /echo done/u);
  const classic = queueSettingsPreview(withQueue({liveTimeline: false}), 76).map(stripAnsi).join('\n');
  assert.doesNotMatch(classic, /npm test|Running/u);
  assert.match(classic, /git status/u);
  const transient = queueSettingsPreview(withQueue({transientSeconds: 20}), 76).map(stripAnsi).join('\n');
  assert.match(transient, /resume and clear are always reviewed/u, 'the preview explains session ownership and reviewed resume/clear');
});

test('the Queue panel keeps its preview and footer visible at the exact fit height', () => {
  const panel = createRowPanel('Queue', '/queue · /settings queue', [...QUEUE_SETTINGS_ROW_IDS], 'queue');
  const config = DEFAULT_PROMPT_CONFIGURATION;
  const compact = renderRowPanel(panel, config, 80, 24, queueSettingsPreview(config, 76)).map(stripAnsi);
  assert.match(compact.join('\n'), /Queue · 5 commands/u, 'the preview is shown when it exactly fits');
  assert.doesNotMatch(compact.join('\n'), /While a command runs/u, 'the description yields before the controls do');
  assert.match(compact.at(-1) ?? '', /Esc close/u, 'the footer controls are never cut from the tail');
  const tall = renderRowPanel(panel, config, 80, 30, queueSettingsPreview(config, 76)).map(stripAnsi);
  assert.match(tall.join('\n'), /While a command runs/u, 'the focused row description appears when there is room');
  assert.match(tall.at(-1) ?? '', /Esc close/u);
});

test('queue behavior and presentation transfer with the sessions settings category', () => {
  const config: PromptConfiguration = {...withQueue({liveTimeline: false, recentResults: 0, upcoming: 1, transient: false, transientSeconds: 30}), queueFailurePolicy: 'continue'};
  const document = exportSettings(config, ['sessions']);
  assert.deepEqual(document.categories.sessions!.queue, config.queue);
  assert.equal(document.categories.sessions!.queueFailurePolicy, 'continue');
  const plan = planImport(DEFAULT_PROMPT_CONFIGURATION, document, ['sessions']);
  assert.deepEqual(plan.next.queue, config.queue);
  assert.equal(plan.next.queueFailurePolicy, 'continue');
});

function appFixture(): {app: TerminalApp; dispose: () => void} {
  const app = new TerminalApp();
  app['render'] = () => {};
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 30})});
  app['startupPending'] = false;
  return {app, dispose: () => { app['stop'](0); app['session'].kill(); }};
}

const finishedChain = (id: number): QueueState => ({revision: id,
  timeline: {id, createdAt: 1000, startedAt: 1000, endedAt: 5000, observedAt: 5000, elapsedMs: 4000, failurePolicy: 'pause', status: 'finished',
    counts: {succeeded: 1, failed: 0, interrupted: 0, skipped: 0, unobserved: 0},
    executions: [{id: 1, text: 'npm run build', source: 'queue', entryId: 1, startedAt: 1000, endedAt: 5000, durationMs: 4000, status: 'succeeded', exitCode: 0}]},
  entries: []});

test('/settings queue and /queue settings open the Queue panel; Esc returns to Settings and /queue still opens the manager', async () => {
  const isolated = isolateConfig();
  const {app, dispose} = appFixture();
  try {
    for (const command of ['/settings queue', '/queue settings']) {
      app['editor'].insert(command);
      await app['submit']();
      assert.ok(app['rowPanel'], command);
      assert.equal(app['rowPanel']!.title, 'Queue', command);
      assert.ok(app['rowPanel']!.rowIds.includes('commandQueue') && app['rowPanel']!.rowIds.includes('queueTimeline'), command);
      app['handleKey']({kind: 'escape'});
      assert.equal(app['rowPanel'], undefined, command);
      assert.ok(app['settingsPanelState'], `${command} returns to Settings on Esc`);
      app['settingsPanelState'] = undefined;
    }
    app['editor'].insert('/queue');
    await app['submit']();
    assert.ok(app['queuePanel'], 'the manager is untouched');
    assert.equal(app['rowPanel'], undefined);
  } finally { dispose(); isolated.restore(); }
});

test('the app passes the queue presentation settings to the real timeline and honors the completed-view switch', () => {
  const isolated = isolateConfig();
  const {app, dispose} = appFixture();
  try {
    let at = 1000;
    const owner = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit() {}}, undefined, {now: () => at, monotonic: () => at});
    owner.onExec('npm run build'); owner.request({op: 'add', text: 'npm test'}); owner.onPrompt(0); owner.onExec('npm test');
    app['onQueueState'](owner.state, {});
    assert.equal(app['timelineVisible'](), true);
    assert.match(app['queueBlockRows'](80, 7)!.map(stripAnsi).join('\n'), /npm run build/u);
    app['promptConfiguration'] = withQueue({recentResults: 0});
    assert.doesNotMatch(app['queueBlockRows'](80, 7)!.map(stripAnsi).join('\n'), /npm run build/u, 'the setting reaches the renderer');
    app['promptConfiguration'] = withQueue({liveTimeline: false});
    assert.equal(app['timelineVisible'](), false);
    assert.equal(app['queueBlockRows'](80, 7), undefined, 'one pending entry falls back to the one-line queue row');
    at += 1;
    const started = performance.now();
    app['promptConfiguration'] = DEFAULT_PROMPT_CONFIGURATION;
    app['onQueueState'](finishedChain(7), {});
    const linger = app['queueTransientUntil'] - started;
    assert.ok(linger >= 8000 && linger < 8100, `default eight seconds: ${linger}`);
    app['promptConfiguration'] = withQueue({transientSeconds: 6});
    const beforeSix = performance.now();
    app['onQueueState'](finishedChain(8), {});
    const six = app['queueTransientUntil'] - beforeSix;
    assert.ok(six >= 6000 && six < 6100, `configured six seconds: ${six}`);
    app['promptConfiguration'] = withQueue({transient: false});
    app['onQueueState'](finishedChain(9), {});
    assert.equal(app['queueTransientUntil'], 0);
    assert.equal(app['timelineVisible'](), false, 'a finished chain dismisses at once');
  } finally { dispose(); isolated.restore(); }
});
