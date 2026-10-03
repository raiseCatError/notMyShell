import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNotificationService, LinuxNotificationService, notifySendArguments, UnsupportedNotificationService} from '../src/notifications/commandNotifications.js';
import {nmshConfigDirectory} from '../src/configuration/paths.js';

test('Linux notifications: notify-send only when installed and a desktop session exists; argv only, -- before text', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'nmsh-notify-'));
  try {
    writeFileSync(join(bin, 'notify-send'), '#!/bin/sh\n'); chmodSync(join(bin, 'notify-send'), 0o755);
    assert.ok(createNotificationService('linux', undefined, {PATH: bin}) instanceof UnsupportedNotificationService, 'no desktop session: unsupported');
    assert.ok(createNotificationService('linux', undefined, {PATH: '/nonexistent', DISPLAY: ':0'}) instanceof UnsupportedNotificationService, 'not installed: unsupported');
    const calls: Array<[string, readonly string[]]> = [];
    const fakeSpawn = ((command: string, args: readonly string[]) => {
      calls.push([command, args]);
      const child = Object.assign(new EventEmitter(), {stderr: null});
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    }) as never;
    const service = createNotificationService('linux', fakeSpawn, {PATH: bin, WAYLAND_DISPLAY: 'wayland-0'});
    assert.ok(service instanceof LinuxNotificationService);
    assert.deepEqual(await service.notify({title: 'NMSh', subtitle: '-rf Command failed', body: '$(rm -rf ~)'}), {ok: true});
    assert.deepEqual(calls[0], [join(bin, 'notify-send'), ['--app-name=NMSh', '--', 'NMSh: -rf Command failed', '$(rm -rf ~)']]);
    assert.deepEqual(notifySendArguments({title: 'a', subtitle: 'b', body: 'c'}).slice(0, 2), ['--app-name=NMSh', '--']);
  } finally { rmSync(bin, {recursive: true, force: true}); }
});

test('Linux config paths follow XDG and ignore relative XDG values', () => {
  assert.equal(nmshConfigDirectory({HOME: '/home/u', XDG_CONFIG_HOME: '/x/cfg'}, 'linux'), '/x/cfg/nmsh');
  assert.equal(nmshConfigDirectory({HOME: '/home/u', XDG_CONFIG_HOME: 'relative'}, 'linux'), '/home/u/.config/nmsh');
  assert.equal(nmshConfigDirectory({HOME: '/home/u'}, 'linux'), '/home/u/.config/nmsh');
});
