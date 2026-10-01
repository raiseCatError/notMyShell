import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcess} from 'node:child_process';
import {createNotificationService, MacNotificationService, OSASCRIPT_PATH, osascriptArguments, shouldNotify,
  formatCommandNotification, type CommandNotification} from '../src/notifications/commandNotifications.js';
import {DEFAULT_NOTIFICATION_SETTINGS, normalizeNotificationSettings, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {SETTINGS_ROWS, adjustSettingsRow, resetSettingsRow, settingsRowChanged, settingsRowValue} from '../src/ui/SettingsPanel.js';
import {decodeKeys, KeyDecoder} from '../src/terminal/keys.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

const completed = {command: 'SECRET=value echo hi', elapsedMs: 60000, exitCode: 0, interrupted: false};
test('notification defaults, normalized real durations, toggles and focus policies', () => {
  const defaults = DEFAULT_NOTIFICATION_SETTINGS;
  assert.deepEqual(normalizeNotificationSettings(null), {enabled: true, thresholdSeconds: 60, onSuccess: true, onFailure: true, whenFocused: 'suppress'});
  for (const bad of [-1, 0, Infinity, NaN, '60']) assert.equal(normalizeNotificationSettings({thresholdSeconds: bad}).thresholdSeconds, 60);
  assert.equal(normalizeNotificationSettings({thresholdSeconds: 999999}).thresholdSeconds, 86400);
  assert.equal(normalizeNotificationSettings({thresholdSeconds: 72.6}).thresholdSeconds, 73);
  for (const focus of ['unknown', 'blurred', 'focused'] as const) assert.equal(shouldNotify(completed, defaults, focus), focus !== 'focused');
  assert.ok(shouldNotify(completed, {...defaults, whenFocused: 'notify'}, 'focused'));
  assert.ok(!shouldNotify(completed, {...defaults, enabled: false}, 'unknown'));
  assert.ok(!shouldNotify(completed, {...defaults, onSuccess: false}, 'unknown'));
  assert.ok(!shouldNotify({...completed, exitCode: 7}, {...defaults, onFailure: false}, 'unknown'));
  assert.ok(!shouldNotify({...completed, interrupted: true}, {...defaults, onFailure: false}, 'unknown'));
  assert.ok(!shouldNotify({...completed, elapsedMs: 59999}, defaults, 'unknown'));
  assert.ok(!shouldNotify({...completed, command: '/help'}, defaults, 'unknown'));
  assert.ok(!shouldNotify({...completed, elapsedMs: NaN}, defaults, 'unknown'));
  assert.ok(!JSON.stringify(formatCommandNotification(completed)).includes('SECRET'));
});
test('five settings persist, preserve custom seconds, step and reset independently', () => {
  let config = normalizePromptConfiguration({notifications: {thresholdSeconds: 73}});
  const threshold = SETTINGS_ROWS.find(row => row.id === 'notifyAfter')!;
  assert.equal(settingsRowValue(threshold, config), '1m 13s');
  assert.ok(settingsRowChanged(threshold, config));
  config = adjustSettingsRow(threshold, config, 1)!;
  assert.equal(config.notifications.thresholdSeconds, 120);
  config = resetSettingsRow(threshold, config)!;
  assert.equal(config.notifications.thresholdSeconds, 60);
  for (const id of ['notifications', 'notifyOnSuccess', 'notifyOnFailure', 'notifyWhenFocused']) {
    const row = SETTINGS_ROWS.find(row => row.id === id)!;
    config = adjustSettingsRow(row, config, 1)!;
    assert.ok(settingsRowChanged(row, config));
    config = resetSettingsRow(row, config)!;
    assert.ok(!settingsRowChanged(row, config));
  }
  assert.deepEqual(normalizePromptConfiguration({...config, modules: []}).notifications, config.notifications);
});
test('focus reports decode fragmented input and renderer owns reporting through every handoff', () => {
  assert.deepEqual(decodeKeys('\u001b[I\u001b[O').map(key => key.kind), ['focusIn', 'focusOut']);
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001b['), []);
  assert.equal(decoder.push('I')[0]?.kind, 'focusIn');
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => writes.push(data));
  renderer.enter(); assert.ok(writes.at(-1)!.includes('\u001b[?1004h'));
  renderer.suspendForPassthrough(); assert.ok(writes.at(-1)!.includes('\u001b[?1004l'));
  renderer.resumeAfterPassthrough(); assert.ok(writes.at(-1)!.includes('\u001b[?1004h'));
  renderer.leave(); assert.ok(writes.at(-1)!.includes('\u001b[?1004l'));
});
test('macOS backend is argv-only and errors, exits, timeouts and unsupported hosts are harmless', async () => {
  const notification: CommandNotification = {title: 'notMyShell', subtitle: 'finished', body: '"; $(touch nope) `nope`\n'};
  assert.ok(osascriptArguments(notification).includes(notification.body));
  assert.equal((await createNotificationService('linux').notify(notification)).ok, false);
  assert.equal((await new MacNotificationService(() => { throw new Error('spawn failed'); }).notify(notification)).ok, false);
  for (const [code, signal, ok] of [[0, null, true], [7, null, false], [null, 'SIGTERM', false]] as const) {
    const service = new MacNotificationService((path, args, options) => {
      assert.equal(path, OSASCRIPT_PATH); assert.equal(options.shell, false);
      assert.ok(args.includes(notification.body)); assert.deepEqual(options.stdio, ['ignore', 'ignore', 'pipe']);
      const child = Object.assign(new EventEmitter(), {stderr: new PassThrough()});
      queueMicrotask(() => child.emit('close', code, signal));
      return child as unknown as ChildProcess;
    });
    assert.equal((await service.notify(notification)).ok, ok);
  }
  const service = new MacNotificationService(() => {
    const child = Object.assign(new EventEmitter(), {stderr: new PassThrough()});
    queueMicrotask(() => child.emit('error', new Error('unavailable')));
    return child as unknown as ChildProcess;
  });
  assert.equal((await service.notify(notification)).ok, false);
});
function app() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'refreshContext', {value: async () => {}});
  app['promptConfiguration'].notifications = {...DEFAULT_NOTIFICATION_SETTINGS};
  return app;
}
function dispose(app: TerminalApp) { app['stop'](0); app['session'].kill(); }
test('live completion notifies exactly once; replay, slash, render/resize/resume never deliver', () => {
  const instance = app(); const delivered: CommandNotification[] = [];
  Object.defineProperty(instance, 'notificationService', {value: {notify: async (value: CommandNotification) => { delivered.push(value); return {ok: true}; }}});
  try {
    instance['onShellExec'](completed.command, 0);
    instance['onShellPrompt'](0, '/', 60000);
    instance['onShellPrompt'](0, '/', 60001);
    instance['onResize']();
    assert.equal(delivered.length, 1);
    assert.ok(!JSON.stringify(delivered).includes('SECRET'));
    assert.ok(!JSON.stringify(instance['output'].transcript()).includes('Your shell command has completed'));
    instance['replaying'] = true;
    instance['onShellExec']('echo replay', 0);
    instance['onShellPrompt'](0, '/', 60000);
    instance['replaying'] = false;
    instance['handleKey']({kind: 'focusIn'});
    instance['onShellExec']('echo focused', 0);
    instance['onShellPrompt'](0, '/', 60000);
    assert.equal(delivered.length, 1);
    instance['paletteState'] = {items: [], query: '', selectedIndex: 0, viewportStart: 0};
    instance['handleKey']({kind: 'focusOut'});
    assert.equal(instance['terminalFocus'], 'blurred');
    instance['paletteState'] = undefined;
    instance['onShellExec']('echo failed', 0);
    instance['onShellPrompt'](7, '/', 60000);
    assert.equal(delivered.length, 2);
    instance['editor'].insert('/help'); void instance['submit']();
    assert.equal(delivered.length, 2);
  } finally { dispose(instance); }
});
test('backend rejection and throw cannot prevent shell completion; passthrough and suspend restore modes', t => {
  const instance = app(); const writes: string[] = [];
  Object.defineProperty(instance, 'renderer', {value: new TerminalRenderer(data => writes.push(data))});
  try {
    instance['renderer'].enter();
    instance['terminalFocus'] = 'focused';
    instance['onActiveModeChange']('PASSTHROUGH');
    assert.equal(instance['terminalFocus'], 'unknown');
    assert.ok(writes.at(-1)!.includes('\u001b[?1004l'));
    Object.defineProperty(instance, 'notificationService', {value: {notify: () => { throw new Error('delivery'); }}, configurable: true});
    instance['onShellExec']('echo hi', 0);
    assert.doesNotThrow(() => instance['onShellPrompt'](0, '/', 60000));
    assert.equal(instance['running'], undefined);
    assert.ok(writes.at(-1)!.includes('\u001b[?1004h'));
    Object.defineProperty(instance, 'notificationService', {value: {notify: () => Promise.reject(new Error('delivery'))}});
    instance['onShellExec']('echo hi', 0);
    assert.doesNotThrow(() => instance['onShellPrompt'](0, '/', 60000));
    t.mock.method(process, 'kill', () => true);
    instance['onSuspend']();
    assert.ok(writes.at(-1)!.includes('\u001b[?1004l'));
    instance['onContinue']();
    assert.ok(writes.at(-1)!.includes('\u001b[?1004h'));
    assert.equal(instance['terminalFocus'], 'unknown');
  } finally { t.mock.restoreAll(); dispose(instance); }
});
