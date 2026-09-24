import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChildProcess, SpawnOptions} from 'node:child_process';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {decodeKeys, KeyDecoder} from '../src/terminal/keys.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PROMPT_CONFIGURATION,
  loadPromptConfiguration,
  normalizeNotificationSettings,
  normalizePromptConfiguration,
  type NotificationSettings,
} from '../src/prompt/configuration.js';
import {
  createNotificationService,
  formatCommandNotification,
  MacNotificationService,
  OSASCRIPT_PATH,
  osascriptArguments,
  shouldNotify,
  summarizeCommand,
  type CommandNotification,
  type CompletedCommand,
  type SpawnFunction,
} from '../src/notifications/commandNotifications.js';
import {parseSlashCommand, slashCommands, slashSuggestions} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';
import {adjustSettingsRow, renderSettingsPanel, visibleSettingsRows, SETTINGS_ROWS, settingsRowValue, stepPreset, NOTIFICATION_THRESHOLD_STEPS} from '../src/ui/SettingsPanel.js';

const settings = (patch: Partial<NotificationSettings> = {}): NotificationSettings => ({...DEFAULT_NOTIFICATION_SETTINGS, ...patch});
const done = (patch: Partial<CompletedCommand> = {}): CompletedCommand =>
  ({command: 'npm test', elapsedMs: 120_000, exitCode: 0, interrupted: false, ...patch});

// ── Config ──────────────────────────────────────────────────────────────

test('notification settings default to On, 60s, success/failure On, Suppress when focused', () => {
  assert.deepEqual(DEFAULT_PROMPT_CONFIGURATION.notifications,
    {enabled: true, thresholdSeconds: 60, onSuccess: true, onFailure: true, whenFocused: 'suppress'});
  assert.deepEqual(normalizePromptConfiguration({}).notifications, DEFAULT_NOTIFICATION_SETTINGS);
  // Existing configs without the key keep onboarding complete and gain defaults.
  const existing = normalizePromptConfiguration({onboardingComplete: true, glyphChoiceComplete: true});
  assert.equal(existing.onboardingComplete, true);
  assert.deepEqual(existing.notifications, DEFAULT_NOTIFICATION_SETTINGS);
});

test('saved notification values survive normalization and invalid values normalize safely', () => {
  const saved = {enabled: false, thresholdSeconds: 300, onSuccess: false, onFailure: true, whenFocused: 'notify'};
  assert.deepEqual(normalizeNotificationSettings(saved), saved);
  assert.deepEqual(normalizePromptConfiguration({notifications: saved, modules: []}).notifications, saved);
  assert.deepEqual(normalizeNotificationSettings({enabled: 'yes', thresholdSeconds: -5, onSuccess: 1, onFailure: null, whenFocused: 'loud'}),
    DEFAULT_NOTIFICATION_SETTINGS);
  assert.equal(normalizeNotificationSettings({thresholdSeconds: Number.NaN}).thresholdSeconds, 60);
  assert.equal(normalizeNotificationSettings({thresholdSeconds: 45.4}).thresholdSeconds, 45);
  assert.equal(normalizeNotificationSettings({thresholdSeconds: 1e12}).thresholdSeconds, 86_400);
  assert.deepEqual(normalizeNotificationSettings('nope'), DEFAULT_NOTIFICATION_SETTINGS);
});

// ── Filter ──────────────────────────────────────────────────────────────

test('threshold: 59.9s does not notify at 60s, 60s does, custom thresholds apply', () => {
  assert.equal(shouldNotify(done({elapsedMs: 59_900}), settings(), 'blurred'), false);
  assert.equal(shouldNotify(done({elapsedMs: 60_000}), settings(), 'blurred'), true);
  assert.equal(shouldNotify(done({elapsedMs: 6_000}), settings({thresholdSeconds: 5}), 'blurred'), true);
  assert.equal(shouldNotify(done({elapsedMs: 100_000}), settings({thresholdSeconds: 120}), 'blurred'), false);
});

test('success/failure toggles and the master switch', () => {
  assert.equal(shouldNotify(done(), settings(), 'blurred'), true);
  assert.equal(shouldNotify(done(), settings({onSuccess: false}), 'blurred'), false);
  assert.equal(shouldNotify(done({exitCode: 1}), settings(), 'blurred'), true);
  assert.equal(shouldNotify(done({exitCode: 1}), settings({onFailure: false}), 'blurred'), false);
  assert.equal(shouldNotify(done({exitCode: 1}), settings({onSuccess: false}), 'blurred'), true);
  assert.equal(shouldNotify(done({exitCode: 0, interrupted: true}), settings({onFailure: false}), 'blurred'), false);
  assert.equal(shouldNotify(done(), settings({enabled: false}), 'blurred'), false);
  assert.equal(shouldNotify(done({exitCode: 2}), settings({enabled: false}), 'unknown'), false);
});

test('focus policy: focused+Suppress silent; blurred, unknown, and Notify deliver', () => {
  assert.equal(shouldNotify(done(), settings(), 'focused'), false);
  assert.equal(shouldNotify(done(), settings(), 'blurred'), true);
  assert.equal(shouldNotify(done(), settings(), 'unknown'), true);
  assert.equal(shouldNotify(done(), settings({whenFocused: 'notify'}), 'focused'), true);
});

// ── Content ─────────────────────────────────────────────────────────────

test('notification copy: success, failure with exit code, interrupted', () => {
  assert.deepEqual(formatCommandNotification(done({command: 'npm run build', elapsedMs: 134_000})),
    {title: 'notMyShell', subtitle: 'Command finished · 2m 14s', body: 'npm run build'});
  assert.deepEqual(formatCommandNotification(done({elapsedMs: 134_000, exitCode: 1})),
    {title: 'notMyShell', subtitle: 'Command failed · 2m 14s · exit 1', body: 'npm test'});
  assert.equal(formatCommandNotification(done({elapsedMs: 3_723_000, exitCode: 130, interrupted: true})).subtitle,
    'Command interrupted · 1h 2m');
  assert.equal(formatCommandNotification(done({elapsedMs: 7_000})).subtitle, 'Command finished · 7.0s');
});

test('command summary strips ANSI and newlines and is bounded', () => {
  assert.equal(summarizeCommand('\u001B[31mnpm\u001B[0m   run\n  build\t--watch'), 'npm run build --watch');
  assert.equal(summarizeCommand('for f in *; do\n  echo "$f"\ndone'), 'for f in *; do echo "$f" done');
  const long = summarizeCommand(`echo ${'x'.repeat(500)}`);
  assert.equal(Array.from(long).length, 80);
  assert.ok(long.endsWith('…'));
  assert.equal(summarizeCommand('a\u0007b\u0000c'), 'a b c');
});

// ── Backend ─────────────────────────────────────────────────────────────

type SpawnCall = {command: string; args: readonly string[]; options: SpawnOptions};

/** A stand-in child that closes with `exit` (and optional stderr), or fails to spawn. */
function fakeSpawn(calls: SpawnCall[], outcome: {exit?: number; stderr?: string; signal?: NodeJS.Signals; fail?: 'throw' | 'error'} = {}): SpawnFunction {
  return (command, args, options) => {
    if (outcome.fail === 'throw') throw new Error('spawn EACCES');
    calls.push({command, args, options});
    const child = new EventEmitter() as ChildProcess;
    const stderr = new PassThrough();
    Object.assign(child, {stderr, unref: () => { throw new Error('the child must not be unref\'d'); }});
    setImmediate(() => {
      if (outcome.fail === 'error') { child.emit('error', new Error('spawn /usr/bin/osascript ENOENT')); return; }
      if (outcome.stderr) stderr.write(outcome.stderr);
      stderr.end();
      setImmediate(() => child.emit('close', outcome.signal ? null : outcome.exit ?? 0, outcome.signal ?? null));
    });
    return child;
  };
}

test('macOS backend runs /usr/bin/osascript with an argv-only AppleScript program and no shell', async () => {
  const calls: SpawnCall[] = [];
  const note: CommandNotification = {title: 'notMyShell', subtitle: 'Command failed · 1m 0s · exit 1', body: `echo "a'b" $(rm -rf ~) \\ -e`};
  assert.deepEqual(await new MacNotificationService(fakeSpawn(calls)).notify(note), {ok: true});
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, OSASCRIPT_PATH);
  assert.equal(calls[0]!.options.shell, false);
  assert.equal(calls[0]!.options.detached, undefined, 'an attached child');
  assert.deepEqual(calls[0]!.options.stdio, ['ignore', 'ignore', 'pipe']);
  const args = calls[0]!.args;
  assert.deepEqual(args, [
    '-e', 'on run argv',
    '-e', 'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)',
    '-e', 'end run',
    note.title, note.subtitle, note.body,
  ]);
  assert.deepEqual(osascriptArguments(note), args);
});

test('hostile command text only ever appears as the final argv item', () => {
  for (const body of ['-la', '--help', '-e display dialog "x"', `it's "quoted"`, 'line1\nline2', '日本語 ✓ 🚀', '$(whoami) `id` ; rm -rf /']) {
    const args = osascriptArguments({title: 'notMyShell', subtitle: 's', body});
    assert.equal(args.at(-1), body);
    assert.equal(args.at(-3), 'notMyShell', 'the title is the first non-option argument');
    assert.equal(args.filter(arg => arg === body).length, 1);
  }
  // The summary a real notification carries is already one line.
  assert.equal(formatCommandNotification(done({command: '-x\n"a"'})).body, '-x "a"');
});

test('backend failures resolve with a reason and never throw', async () => {
  const note = formatCommandNotification(done());
  assert.deepEqual(await new MacNotificationService(fakeSpawn([], {fail: 'throw'})).notify(note),
    {ok: false, reason: 'spawn', message: 'Error: spawn EACCES'});
  assert.deepEqual(await new MacNotificationService(fakeSpawn([], {fail: 'error'})).notify(note),
    {ok: false, reason: 'spawn', message: 'spawn /usr/bin/osascript ENOENT'});
  assert.deepEqual(await new MacNotificationService(fakeSpawn([], {exit: 1, stderr: '0:12: syntax error: A identifier can’t go after this “"”. (-2740)\n'})).notify(note),
    {ok: false, reason: 'exit', exitCode: 1, message: '0:12: syntax error: A identifier can’t go after this “"”. (-2740)'});
  assert.deepEqual(await new MacNotificationService(fakeSpawn([], {signal: 'SIGTERM'})).notify(note),
    {ok: false, reason: 'timeout', exitCode: null, message: 'SIGTERM'});
});

test('notify returns immediately; delivery settles later', async () => {
  let settled = false;
  const pending = new MacNotificationService(fakeSpawn([])).notify(formatCommandNotification(done()));
  void pending.then(() => { settled = true; });
  assert.equal(settled, false);
  await pending;
  assert.equal(settled, true);
});

test('non-darwin platforms are unsupported and never spawn osascript', async () => {
  const calls: SpawnCall[] = [];
  for (const platform of ['linux', 'win32', 'freebsd'] as const) {
    const service = createNotificationService(platform, fakeSpawn(calls));
    assert.equal(service.supported, false);
    assert.deepEqual(await service.notify(formatCommandNotification(done())), {ok: false, reason: 'unsupported'});
  }
  assert.equal(calls.length, 0);
  assert.equal(createNotificationService('darwin', fakeSpawn(calls)).supported, true);
});

test('a real osascript invocation compiles and receives argv (macOS only)', {skip: process.platform !== 'darwin'}, async () => {
  // Same program shape, but returning argv instead of posting, so the test never notifies.
  const {execFileSync} = await import('node:child_process');
  const args = osascriptArguments({title: 'notMyShell', subtitle: 'Command finished · 6.0s', body: `-la "it's" ✓`})
    .map(arg => arg.startsWith('display notification') ? 'return (item 1 of argv) & "|" & (item 2 of argv) & "|" & (item 3 of argv)' : arg);
  assert.equal(execFileSync(OSASCRIPT_PATH, args, {encoding: 'utf8'}).trim(), `notMyShell|Command finished · 6.0s|-la "it's" ✓`);
});

// ── Focus decoding and lifecycle ────────────────────────────────────────

test('focus reports decode to focus keys and never become text', () => {
  assert.deepEqual(decodeKeys('\u001B[I'), [{kind: 'focusIn'}]);
  assert.deepEqual(decodeKeys('\u001B[O'), [{kind: 'focusOut'}]);
  assert.deepEqual(decodeKeys('a\u001B[Ob\u001B[Ic'),
    [{kind: 'text', value: 'a'}, {kind: 'focusOut'}, {kind: 'text', value: 'b'}, {kind: 'focusIn'}, {kind: 'text', value: 'c'}]);
  // Split across reads, the partial CSI waits for its final byte rather than becoming Escape.
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B['), []);
  assert.deepEqual(decoder.push('O'), [{kind: 'focusOut'}]);
  // Neighbors are unchanged: SS3 arrows, Kitty Escape, SGR mouse, Shift+mouse.
  assert.deepEqual(decodeKeys('\u001BOA'), [{kind: 'up'}]);
  assert.deepEqual(decodeKeys('\u001B[27u'), [{kind: 'escape'}]);
  assert.deepEqual(decodeKeys('\u001B[<35;4;5M'), [{kind: 'mouseMove', x: 4, y: 5}]);
  assert.deepEqual(decodeKeys('\u001B[<4;4;5M'), []);
});

test('renderer enables focus reporting on entry and disables it for passthrough and exit', () => {
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => writes.push(data));
  renderer.enter();
  assert.match(writes.at(-1)!, /\?1004h/u);
  renderer.suspendForPassthrough();
  assert.match(writes.at(-1)!, /\?1004l/u);
  assert.doesNotMatch(writes.at(-1)!, /\?1004h/u);
  renderer.resumeAfterPassthrough();
  assert.match(writes.at(-1)!, /\?1004h/u);
  renderer.leave();
  assert.match(writes.at(-1)!, /\?1004l.*\?1049l/u);
  assert.doesNotMatch(writes.at(-1)!, /\?1004h/u);
});

// ── App integration ─────────────────────────────────────────────────────

async function withApp(run: (app: TerminalApp, sent: CommandNotification[]) => void | Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-notifications-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  const sent: CommandNotification[] = [];
  app['notifications' as never] = {supported: true, notify: async (note: CommandNotification) => { sent.push(note); return {ok: true}; }} as never;
  app['render'] = () => {};
  app['refreshContext'] = async () => {};
  app['session'].write = () => {};
  try {
    await run(app, sent);
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
}

function startLongCommand(app: TerminalApp, command = 'sleep 90', ageMs = 90_000): void {
  const startId = app['output'].beginCommand(command, command, () => {}, {cwd: '/tmp', project: 'tmp'});
  app['running'] = {command, startedAt: Date.now() - ageMs, interrupted: false, cleared: false, startId};
}

test('focus keys update terminal focus without touching the composer or the shell', async () => {
  await withApp(app => {
    const written: string[] = [];
    app['session'].write = (data: string) => { written.push(data); };
    app['editor'].insert('ls');
    assert.equal(app['terminalFocus'], 'unknown');
    app['onInput']('\u001B[I');
    assert.equal(app['terminalFocus'], 'focused');
    app['onInput']('\u001B[O');
    assert.equal(app['terminalFocus'], 'blurred');
    startLongCommand(app);
    app['onInput']('\u001B[I');
    assert.equal(app['terminalFocus'], 'focused');
    assert.equal(app['editor'].text, 'ls');
    assert.deepEqual(written, []);
  });
});

test('a live completion notifies exactly once; redraw, resize, and later prompts do not', async () => {
  await withApp(async (app, sent) => {
    app['terminalFocus'] = 'blurred';
    startLongCommand(app, 'npm test');
    app['onShellPrompt'](1, '/tmp');
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.subtitle, /^Command failed · 1m 30s · exit 1$/u);
    assert.equal(sent[0]!.body, 'npm test');
    // No notification text enters the transcript.
    assert.ok(!JSON.stringify(app['output'].transcript()).includes('Command failed · 1m 30s'));
    const render = TerminalApp.prototype['render' as never] as () => void;
    app['render'] = render.bind(app);
    app['render']();
    app['onResize']();
    app['onShellPrompt'](0, '/tmp');
    assert.equal(sent.length, 1);
  });
});

test('focus, thresholds, and settings are read at completion time', async () => {
  await withApp(async (app, sent) => {
    app['terminalFocus'] = 'focused';
    startLongCommand(app);
    app['onShellPrompt'](0, '/tmp');
    assert.equal(sent.length, 0, 'focused + Suppress');

    startLongCommand(app, 'sleep 30', 30_000);
    app['terminalFocus'] = 'unknown';
    app['onShellPrompt'](0, '/tmp');
    assert.equal(sent.length, 0, 'below the threshold');

    startLongCommand(app);
    app['promptConfiguration'] = {...app['promptConfiguration'], notifications: settings({enabled: false})};
    app['onShellPrompt'](0, '/tmp');
    assert.equal(sent.length, 0, 'turned off while running');

    startLongCommand(app);
    app['promptConfiguration'] = {...app['promptConfiguration'], notifications: settings({whenFocused: 'notify'})};
    app['terminalFocus'] = 'focused';
    app['onShellPrompt'](0, '/tmp');
    assert.equal(sent.length, 1, 'focused + Notify');
  });
});

test('slash commands, prompts without a running command, and passthrough entry never notify', async () => {
  await withApp(async (app, sent) => {
    app['editor'].insert('/version');
    await app['submit']();
    assert.equal(app['running'], undefined);
    app['onShellPrompt'](0, '/tmp');
    assert.equal(sent.length, 0);
  });
});

async function runFullscreen(app: TerminalApp, written: string[], exitCode = 0): Promise<void> {
  app['renderer']['write' as never] = ((data: string) => { written.push(data); }) as never;
  app['renderer']['active' as never] = true as never;
  app['session'].submit = () => {};
  app['editor'].insert('vim notes.txt');
  await app['submit']();
  assert.equal(app['passthrough'], true);
  assert.match(written.join(''), /\?1004l/u);
  app['running']!.startedAt = Date.now() - 120_000;
  app['onShellPrompt'](exitCode, '/tmp');
  assert.equal(app['passthrough'], false);
  assert.match(written.at(-1)!, /\?1004h/u);
}

test('passthrough preserves focused, blurred, and unknown focus across suspend and resume', async () => {
  for (const focus of ['focused', 'blurred', 'unknown'] as const) {
    await withApp(async app => {
      app['terminalFocus'] = focus;
      await runFullscreen(app, []);
      assert.equal(app['terminalFocus'], focus, focus);
      // A real report after resume still updates the preserved state.
      app['onInput']('\u001B[O');
      assert.equal(app['terminalFocus'], 'blurred');
      app['onInput']('\u001B[I');
      assert.equal(app['terminalFocus'], 'focused');
    });
  }
});

test('long fullscreen commands: focused stays suppressed, blurred and unknown notify after exit', async () => {
  for (const [focus, expected] of [['focused', 0], ['blurred', 1], ['unknown', 1]] as const) {
    await withApp(async (app, sent) => {
      app['terminalFocus'] = focus;
      const written: string[] = [];
      app['renderer']['write' as never] = ((data: string) => { written.push(data); }) as never;
      app['renderer']['active' as never] = true as never;
      app['session'].submit = () => {};
      app['editor'].insert('vim notes.txt');
      await app['submit']();
      assert.equal(sent.length, 0, 'nothing while the command is running');
      app['running']!.startedAt = Date.now() - 120_000;
      app['onShellPrompt'](0, '/tmp');
      assert.equal(sent.length, expected, focus);
    });
  }
});

test('the Powerlevel10k wizard handoff preserves each focus state and still toggles focus reporting', async () => {
  const stdin = process.stdin as unknown as Record<string, unknown>;
  const stdout = process.stdout as unknown as Record<string, unknown>;
  const saved = {stdinTTY: stdin.isTTY, stdoutTTY: stdout.isTTY, setRawMode: stdin.setRawMode};
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdin.setRawMode = () => process.stdin;
  try {
    for (const focus of ['focused', 'blurred', 'unknown'] as const) {
      await withApp(async app => {
        const written: string[] = [];
        app['renderer']['write' as never] = ((data: string) => { written.push(data); }) as never;
        app['renderer']['active' as never] = true as never;
        app['terminalFocus'] = focus;
        // Not installed: the wizard rejects immediately, after the full handoff and restore.
        await assert.rejects(app['runPowerlevel10kWizard']({installed: false} as never));
        assert.match(written.join(''), /\?1004l[\s\S]*\?1004h/u);
        assert.equal(app['terminalFocus'], focus, focus);
      });
    }
  } finally {
    stdin.isTTY = saved.stdinTTY;
    stdout.isTTY = saved.stdoutTTY;
    stdin.setRawMode = saved.setRawMode;
  }
});

test('threshold 5s through the live completion path: 4.9s no, 5.0s and 6.0s yes, one call each', async () => {
  await withApp(async (app, sent) => {
    app['promptConfiguration'] = {...app['promptConfiguration'], notifications: settings({thresholdSeconds: 5})};
    for (const [ageMs, expected] of [[4_900, 0], [5_000, 1], [6_000, 2]] as const) {
      startLongCommand(app, `sleep ${ageMs / 1000}`, ageMs);
      app['onShellPrompt'](0, '/tmp');
      assert.equal(sent.length, expected, `${ageMs}ms`);
    }
    assert.deepEqual(sent.map(note => note.subtitle), ['Command finished · 5.0s', 'Command finished · 6.0s']);
  });
});

// ── Settings UI ─────────────────────────────────────────────────────────

test('Config exposes command notification rows with On/Off, stepped threshold, and focus policy', () => {
  const byId = (id: string) => SETTINGS_ROWS.find(row => row.id === id)!;
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.deepEqual(['notifications', 'notifyAfter', 'notifyOnSuccess', 'notifyOnFailure', 'notifyWhenFocused'].map(id => settingsRowValue(byId(id), config)),
    ['On', '60s', 'On', 'On', 'Suppress']);
  assert.equal(adjustSettingsRow(byId('notifications'), config, 1)!.notifications.enabled, false);
  assert.equal(adjustSettingsRow(byId('notifyWhenFocused'), config, 1)!.notifications.whenFocused, 'notify');
  assert.equal(adjustSettingsRow(byId('notifyAfter'), config, 1)!.notifications.thresholdSeconds, 120);
  assert.equal(adjustSettingsRow(byId('notifyAfter'), config, -1)!.notifications.thresholdSeconds, 30);
  const custom = {...config, notifications: settings({thresholdSeconds: 45})};
  assert.equal(settingsRowValue(byId('notifyAfter'), custom), '45s');
  assert.equal(settingsRowValue(byId('notifyAfter'), {...config, notifications: settings({thresholdSeconds: 90})}), '1m 30s');
  assert.equal(adjustSettingsRow(byId('notifyAfter'), custom, 1)!.notifications.thresholdSeconds, 60);
  assert.equal(stepPreset(NOTIFICATION_THRESHOLD_STEPS, 3600, 1), 5);
  assert.equal(stepPreset(NOTIFICATION_THRESHOLD_STEPS, 5, -1), 3600);
});

// ── /notification and /notifications ───────────────────────────────────

test('/notification and /notifications parse identically and are registered for help and autocomplete', () => {
  assert.deepEqual(parseSlashCommand('/notification'), {kind: 'notifications'});
  assert.deepEqual(parseSlashCommand('/notifications'), {kind: 'notifications'});
  assert.deepEqual(parseSlashCommand('/notifications  '), {kind: 'notifications'});
  assert.equal(parseSlashCommand('/notificationsx')?.kind, 'unknown');
  const names = slashSuggestions('/noti').map(command => command.name);
  assert.deepEqual(names.sort(), ['/notification', '/notifications']);
  assert.ok(slashCommands.some(command => command.name === '/notification'));
});

test('both aliases open the same notification-only panel without touching the shell or notifying', async () => {
  for (const alias of ['/notification', '/notifications']) {
    await withApp(async (app, sent) => {
      const submitted: string[] = [];
      app['session'].submit = (command: string) => { submitted.push(command); };
      const before = structuredClone(app['promptConfiguration']);
      app['editor'].insert(alias);
      await app['submit']();
      const state = app['settingsPanelState']!;
      assert.equal(state.scope, 'notifications', alias);
      assert.equal(state.contentIndex, 0);
      assert.deepEqual(visibleSettingsRows(state).map(row => row.label),
        ['Notifications', 'Notify after', 'On success', 'On failure', 'When focused']);
      assert.deepEqual(app['promptConfiguration'], before, 'opening changes nothing');
      const text = renderSettingsPanel(state, 80, 30, {configuration: app['promptConfiguration']}).map(stripAnsi).join('\n');
      assert.match(text, /Command notifications/u);
      assert.match(text, /Notify after\s+60s/u);
      assert.match(text, /When focused\s+Suppress/u);
      assert.doesNotMatch(text, /Settings.*Status.*Config|Glyph style|History divider|Search settings/u);
      assert.equal(app['running'], undefined);
      assert.deepEqual(submitted, []);
      app['onShellPrompt'](0, '/tmp');
      assert.equal(sent.length, 0);
    });
  }
});

test('the notification panel edits the same persisted values Config shows; arrows never leave it', async () => {
  await withApp(async app => {
    app['editor'].insert('/notifications');
    await app['submit']();
    const state = app['settingsPanelState']!;
    app['handleKey']({kind: 'up'});
    assert.notEqual(state.focus, 'tabs');
    app['handleKey']({kind: 'text', value: '/'});
    assert.equal(state.searchFocused, undefined);
    app['handleKey']({kind: 'down'});
    app['handleKey']({kind: 'left'});
    assert.equal(app['promptConfiguration'].notifications.thresholdSeconds, 30);
    assert.equal(state.scope, 'notifications', '←/→ edit instead of switching views');
    for (let index = 0; index < 3; index += 1) app['handleKey']({kind: 'down'});
    app['handleKey']({kind: 'text', value: ' '});
    assert.equal(app['promptConfiguration'].notifications.whenFocused, 'notify');
    assert.deepEqual(loadPromptConfiguration(join(process.env.XDG_CONFIG_HOME!, 'nmsh', 'config.json')).notifications,
      app['promptConfiguration'].notifications);
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState'], undefined);
    // /settings shows the same values in Config, with its tabs and search intact.
    app['editor'].insert('/settings');
    await app['submit']();
    const config = app['settingsPanelState']!;
    assert.equal(config.scope, undefined);
    const text = renderSettingsPanel(config, 100, 60, {configuration: app['promptConfiguration']}).map(stripAnsi).join('\n');
    assert.match(text, /Search settings/u);
    assert.match(text, /Notify after\s+30s/u);
    assert.match(text, /When focused\s+Notify/u);
  });
});
