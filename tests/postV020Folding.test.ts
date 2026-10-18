import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {InProcessSessionClient} from '../src/session/InProcessSessionClient.js';
import {ShellSession} from '../src/shell/ShellSession.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';
import type {ShellId} from '../src/shell/adapters/ShellAdapter.js';
import {serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {beginSelection} from '../src/output/TranscriptSelection.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration} from '../src/prompt/configuration.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';

const sequence = (n: number) => Array.from({length: n}, (_, i) => `${i + 1}`).join('\n') + '\n';

async function realApp(shell: ShellId) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `nmsh-fold-${shell}-`)));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const keys = ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'NMSH_RETURN_SESSION', 'NMSH_HANDOFF_SHELL', 'TERM_PROGRAM'];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const previousCwd = process.cwd();
  process.chdir(cwd);
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), TERM_PROGRAM: 'nmsh-regression'});
  let actualShell: ShellSession | undefined;
  let startupHostReply: {dispose(): void} | undefined;
  let client: InProcessSessionClient | undefined;
  let app: TerminalApp | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    startupHostReply?.dispose();
    app?.['stop'](0); client?.kill(); actualShell?.kill();
    process.chdir(previousCwd);
    for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    // A killed shell can still land one write in its temp root; mirror the suite harness's bounded retries.
    rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  };
  try {
    client = new InProcessSessionClient({cwd, columns: 80, rows: 24, shell}, options => {
      actualShell = new ShellSession(options.cwd, options.columns, options.rows, root, {...process.env}, shell);
      const ownedShell = actualShell;
      let queryTail = '';
      let wasReady = false;
      // This headless fixture has no outer terminal, so it answers the shell's startup device-attributes query as a
      // VT220 host would, writing directly to its owned PTY (Session.write() queues pre-ready user input, so a
      // protocol reply can never become a later command). Fish 4 waits 10 seconds for this reply and the tests give
      // startup 10 seconds; without the reply, startup aborts. The session answers the editor's queries only once it
      // has read the readiness marker, so a query arriving in the same read as the marker is captured as startup
      // output and still owed an answer; queries strictly after the marker are the session's own editor handling.
      startupHostReply = ownedShell['pty'].onData(data => {
        const flipped = !wasReady && ownedShell.isReady;
        wasReady = ownedShell.isReady;
        if (wasReady && !flipped) return;
        queryTail = (queryTail + data).slice(-1024);
        if (flipped) {
          const marker = queryTail.indexOf('\u001b]777;nmsh;');
          if (marker >= 0) queryTail = queryTail.slice(0, marker);
        }
        if (/\u001b\[0?c/u.test(queryTail)) {
          queryTail = '';
          ownedShell['pty'].write('\u001b[?62;22c');
        }
      });
      return actualShell;
    });
    app = new TerminalApp({client, mode: 'in-process', shell});
    const fixtureApp = app, fixtureClient = client;
    app['welcomeGeneration']++;
    app['output'].clearPresentation();
    app['renderer'].render = () => {};
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 24})});
    Object.defineProperty(app, 'terminalDimensions', {value: () => ({columns: 80, rows: 24})});
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    Object.defineProperty(app, 'refreshContext', {value: async () => {}});
    const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
    Object.assign(config, {provider: 'none', onboardingComplete: true, welcome: 'none', outputFolding: 'smart'});
    config.cursor.effect = 'none';
    assert.equal(app['applySettingsConfiguration'](config), true);
    if (!actualShell!.isReady) await once(client, 'prompt', {signal: AbortSignal.timeout(10000)});
    return {app, client, cwd, run: async (command: string) => {
      const done = once(fixtureClient, 'prompt', {signal: AbortSignal.timeout(10000)});
      fixtureApp['editor'].replaceText(command);
      await fixtureApp['submit'](true, true);
      await done;
      return fixtureApp['output'].recent(1)!;
    }, dispose};
  } catch (error) { dispose(); throw error; }
}

for (const shell of ['zsh', 'bash', 'fish'] as const) test(`real ${shell} TerminalApp submit folds 450 foreground lines in Normal and Chat`, {
  skip: !shellAdapter(shell).resolveExecutable(process.env) && `${shell} unavailable`, timeout: 30000,
}, async () => {
  const f = await realApp(shell);
  try {
    for (const presentation of ['normal', 'chat'] as const) {
      f.app['promptConfiguration'].transcriptPresentation = presentation;
      f.app['output'].presenter.setLayout(presentation);
      const record = await f.run('seq 1 450');
      const state = JSON.stringify({presentation, queued: record.queued, detached: f.app['historyViewport'].detached, selection: f.app['selection'], activities: record.activities, mode: record.mode, outputLines: record.endId - record.outputStartId, outputFolding: f.app['output']['outputFolding']});
      assert.equal(record.command, 'seq 1 450', state);
      assert.equal(record.exitCode, 0, state);
      assert.equal(record.queued, undefined, state);
      assert.equal(record.expanded, false, state);
      assert.equal(serializeCopyPayload(record), sequence(450), state);
      assert.ok(f.app['output'].wrapped(80).some(row => row.plain.includes('442 lines hidden')), state);
      f.app['handleKey']({kind: 'toggleDetails'}); assert.equal(record.expanded, true, state);
      f.app['handleKey']({kind: 'toggleDetails'}); assert.equal(record.expanded, false, state);
    }
  } finally { f.dispose(); }
});

// These are deliberate policy distinctions, not failure reproductions: they explain why a long block can remain open.
test('real PTY completion respects reader inspection, Never and queued output provenance', {skip: !shellAdapter('fish').resolveExecutable(process.env) && 'fish unavailable', timeout: 30000}, async () => {
  const f = await realApp('fish');
  try {
    for (const guard of ['detached', 'selected'] as const) {
      f.app['historyViewport'].latest();
      const inspect = () => {
        if (guard === 'detached') {
          // Scroll to the very top: anywhere near the bottom lets a later render clamp
          // (`resolve()` re-attaches FOLLOW once the offset reaches its maximum) undo the detach
          // when the PTY delivers a small tail chunk during the run, flipping the completion decision.
          const rows = f.app['output'].wrapped(80);
          if (rows.length > 30) f.app['historyViewport'].scrollLines(rows.length, 10, -rows.length);
        } else f.app['selection'] = beginSelection(0, 1);
      };
      f.client.on('data', inspect);
      // `sleep` keeps the completing read separate from the output read: in one coalesced read the
      // completion (and its holdOpen decision) would be processed before this listener could inspect.
      const record = await f.run('seq 1 450; sleep 1');
      f.client.off('data', inspect);
      assert.equal(record.expanded, true, guard);
      assert.equal(serializeCopyPayload(record), sequence(450), guard);
      f.app['selection'] = undefined;
    }
    f.app['historyViewport'].latest();
    f.app['output'].setOutputFolding('never');
    assert.equal((await f.run('seq 1 450')).expanded, true);
    f.app['output'].setOutputFolding('smart');
    for (const outputDisplay of ['inline', 'fold'] as const) {
      f.app['promptConfiguration'].queue.outputDisplay = outputDisplay;
      const done = once(f.client, 'prompt');
      f.client.queue({op: 'add', text: 'seq 1 450'});
      await done;
      const record = f.app['output'].recent(1)!;
      assert.equal(record.queued, true);
      assert.equal(record.expanded, outputDisplay === 'inline');
      assert.equal(serializeCopyPayload(record), sequence(450));
    }
    for (const command of ['seq 1 450; false', 'seq 1 450; exit 130']) {
      // A subshell returns the interruption status without ending the persistent shell.
      const text = command.includes('exit 130') ? `sh -c '${command}'` : command;
      const done = once(f.client, 'prompt');
      f.client.queue({op: 'add', text});
      await done;
      const record = f.app['output'].recent(1)!;
      assert.equal(record.queued, true);
      assert.equal(record.expanded, true, `${record.exitCode}: failure/interruption stays visible`);
      assert.equal(serializeCopyPayload(record), sequence(450));
    }
  } finally { f.dispose(); }
});

for (const presentation of ['normal', 'chat'] as const) test(`Smart boundary, Unicode/tab/no-newline copies, resize and restoration (${presentation})`, () => {
  const uniqueLine = (index: number): string => {
    let value = index + 1, text = '';
    while (value) { text = String.fromCharCode(97 + (value % 26)) + text; value = Math.floor(value / 26); }
    return `item ${text}`;
  };
  const variants = [
    ...[0, 10, 119, 120, 121, 450, 10000].map(count => ({text: count ? Array.from({length: count}, (_, index) => uniqueLine(index)).join('\n') + '\n' : '', count, fold: count >= 120})),
    {text: Array.from({length: 450}, (_, index) => `猫\t😀 ${index}`).join('\n') + '\n', count: 450, fold: true},
    {text: sequence(450).slice(0, -1), count: 450, fold: true},
  ];
  for (const variant of variants) {
    const f = executionFrameFixture();
    try {
      f.app['promptConfiguration'].transcriptPresentation = presentation;
      f.app['output'].presenter.setLayout(presentation);
      f.app['output'].setOutputFolding('smart');
      f.begin('cat fixture', variant.text); f.complete();
      const record = f.app['output'].recent(1)!;
      assert.equal(record.expanded, !variant.fold, `${variant.count} lines`);
      assert.equal(serializeCopyPayload(record), variant.text);
      for (const width of [32, 50, 80, 120]) {
        const rows = f.app['output'].wrapped(width);
        assert.ok(rows.length > 0);
        assert.equal(record.expanded, !variant.fold, 'resize preserves disclosure choice');
        assert.equal(serializeCopyPayload(record), variant.text, 'resize preserves exact output');
      }
      if (variant.fold) f.app['output'].toggleExpanded(0);
      const restored = new OutputBuffer();
      restored.restoreTranscript(JSON.parse(JSON.stringify(f.app['output'].transcript())));
      assert.equal(serializeCopyPayload(restored.recent(1)!), variant.text);
      assert.equal(restored.recent(1)!.expanded, true, 'explicit expansion survives persisted transcript');
    } finally { f.dispose(); }
  }
});

for (const shell of ['zsh', 'bash', 'fish'] as const) test(`real ${shell} queued composer lifecycle applies saved inline/fold preference at completion`, {
  skip: !shellAdapter(shell).resolveExecutable(process.env) && `${shell} unavailable`, timeout: 30000,
}, async t => {
  const f = await realApp(shell);
  try {
    const complete = f.app['output'].complete.bind(f.app['output']);
    const decisions: Array<{command?: string; folding: string; options: Parameters<OutputBuffer['complete']>[1]; detached: boolean; selected: boolean}> = [];
    f.app['output'].complete = (exitCode, options) => {
      decisions.push({command: f.app['running']?.command, folding: f.app['output']['outputFolding'], options,
        detached: f.app['historyViewport'].detached, selected: Boolean(f.app['selection'])});
      return complete(exitCode, options);
    };
    for (const outputDisplay of ['inline', 'fold'] as const) {
      const route = outputDisplay === 'inline' ? '/settings queue' : '/queue settings';
      f.app['editor'].replaceText(route);
      await f.app['submit'](false, true);
      const panel = f.app['rowPanel']!;
      assert.ok(panel, `${route} opens the shared Queue settings panel`);
      const visible = panel.rowIds.map(id => SETTINGS_ROWS.find(row => row.id === id)!)
        .filter(row => row && (row.when?.(f.app['promptConfiguration']) ?? true));
      const index = visible.findIndex(row => row.id === 'queueOutputDisplay');
      assert.ok(index >= 0);
      while (panel.selected !== index) f.app['handleKey']({kind: 'down'});
      if (f.app['promptConfiguration'].queue.outputDisplay !== outputDisplay) f.app['handleKey']({kind: 'right'});
      assert.equal(f.app['promptConfiguration'].queue.outputDisplay, outputDisplay, 'the actual settings row applies live');
      assert.equal(loadPromptConfiguration().queue.outputDisplay, outputDisplay, 'the actual settings row persists immediately');
      f.app['handleKey']({kind: 'escape'}); f.app['handleKey']({kind: 'escape'});
      assert.equal(f.app['rowPanel'], undefined);
      assert.equal(f.app['settingsPanelState'], undefined);
      assert.equal(loadPromptConfiguration().queue.outputDisplay, outputDisplay, 'Esc closes the live settings editor without undoing the chosen value');
      const started = once(f.client, 'exec');
      // The composer Enter is held while the ownership look runs; its release races an 800ms timer
      // (OWNERSHIP_LOOK_MS) when the probe stalls under load. Keep the foreground alive well past that
      // bound so the replayed Enter deterministically routes into the queue instead of landing idle after it ends.
      const foregroundDone = f.run('sleep 1.5');
      await started;
      f.app['editor'].replaceText('seq 1 450');
      f.app['handleKey']({kind: 'enter'});
      const deadline = Date.now() + 10000;
      // enqueue() clears the editor synchronously but the entry itself arrives with the session's queueState
      // event; under load the two observables can separate by a task tick, so wait for both (still bounded).
      while ((f.app['editor'].text !== '' || f.app['queueState'].entries.length < 1) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(f.app['editor'].text, '', 'composer Enter submits one entry to the queue after its ownership check');
      assert.equal(f.app['queueState'].entries.length, 1);
      await foregroundDone;
      await once(f.client, 'prompt', {signal: AbortSignal.timeout(10000)});
      const record = f.app['output'].recent(1)!;
      assert.equal(record.command, 'seq 1 450'); assert.equal(record.queued, true);
      assert.equal(record.expanded, outputDisplay === 'inline');
      assert.equal(serializeCopyPayload(record), sequence(450));
      const decision = decisions.at(-1)!;
      assert.deepEqual(decision, {command: 'seq 1 450', folding: 'smart', options: {holdOpen: false, queued: true, foldQueued: outputDisplay === 'fold', interrupted: false}, detached: false, selected: false});
      t.diagnostic(JSON.stringify({shell, route, savedOutputDisplay: loadPromptConfiguration().queue.outputDisplay, decision, expanded: record.expanded, outputLines: record.endId - record.outputStartId}));
      f.app['handleKey']({kind: 'toggleDetails'});
      assert.equal(record.expanded, outputDisplay === 'fold', 'Ctrl+O reverses either initial presentation');
      f.app['handleKey']({kind: 'toggleDetails'});
      assert.equal(record.expanded, outputDisplay === 'inline');
    }
  } finally { f.dispose(); }
});
