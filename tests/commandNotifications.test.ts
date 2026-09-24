import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChildProcess} from 'node:child_process';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {decodeKeys, KeyDecoder} from '../src/terminal/keys.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PROMPT_CONFIGURATION,
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
import {adjustSettingsRow, SETTINGS_ROWS, settingsRowValue, stepPreset, NOTIFICATION_THRESHOLD_STEPS} from '../src/ui/SettingsPanel.js';

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

function fakeSpawn(calls: Array<{command: string; args: readonly string[]; shell: unknown}>, fail?: 'throw' | 'error'): SpawnFunction {
  return (command, args, options) => {
    if (fail === 'throw') throw new Error('spawn EACCES');
    calls.push({command, args, shell: options.shell});
    const child = new EventEmitter() as ChildProcess;
    (child as unknown as {unref: () => void}).unref = () => {};
    if (fail === 'error') queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    return child;
  };
}

test('macOS backend passes strings as argv to osascript with the shell disabled', () => {
  const calls: Array<{command: string; args: readonly string[]; shell: unknown}> = [];
  const note: CommandNotification = {title: 'notMyShell', subtitle: 'Command failed · 1m 0s · exit 1', body: `echo "a'b" $(rm -rf ~) \\ -e`};
  new MacNotificationService(fakeSpawn(calls)).notify(note);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, OSASCRIPT_PATH);
  assert.equal(calls[0]!.shell, false);
  const args = calls[0]!.args;
  assert.deepEqual(args.slice(-3), [note.title, note.subtitle, note.body]);
  // The script source never contains notification text.
  const script = args.slice(0, -3).filter((_, index) => index % 2 === 1).join('\n');
  assert.ok(!script.includes('rm -rf') && !script.includes('notMyShell'));
  assert.match(script, /^on run argv\n.*item 3 of argv.*item 1 of argv.*item 2 of argv.*\nend run$/u);
  assert.deepEqual(osascriptArguments(note), args);
});

test('backend spawn failures and child errors never throw', async () => {
  const note = formatCommandNotification(done());
  assert.doesNotThrow(() => new MacNotificationService(fakeSpawn([], 'throw')).notify(note));
  assert.doesNotThrow(() => new MacNotificationService(fakeSpawn([], 'error')).notify(note));
  await new Promise(resolve => setImmediate(resolve));
});

test('non-darwin platforms are unsupported and never spawn osascript', () => {
  const calls: Array<{command: string; args: readonly string[]; shell: unknown}> = [];
  for (const platform of ['linux', 'win32', 'freebsd'] as const) {
    const service = createNotificationService(platform, fakeSpawn(calls));
    assert.equal(service.supported, false);
    service.notify(formatCommandNotification(done()));
  }
  assert.equal(calls.length, 0);
  assert.equal(createNotificationService('darwin', fakeSpawn(calls)).supported, true);
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
  app['notifications' as never] = {supported: true, notify: (note: CommandNotification) => sent.push(note)} as never;
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
