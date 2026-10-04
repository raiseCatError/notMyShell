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

import {selectOpener} from '../src/host/desktop.js';
import {selectClipboardBackend} from '../src/clipboard/clipboard.js';

test('Linux open helper: xdg-open first, wslview as the WSL fallback, nothing when absent; never mandatory', () => {
  const only = (...names: string[]) => (name: string) => names.includes(name) ? `/usr/bin/${name}` : undefined;
  assert.equal(selectOpener('linux', only('xdg-open', 'wslview')), '/usr/bin/xdg-open');
  assert.equal(selectOpener('linux', only('wslview')), '/usr/bin/wslview');
  assert.equal(selectOpener('linux', only()), undefined);
  assert.equal(selectOpener('darwin', only()), '/usr/bin/open');
  assert.equal(selectOpener('win32', only('xdg-open')), undefined, 'native Windows is not supported');
});

test('Linux clipboard fallback order: wl-copy, then xclip, then xsel; nothing is mandatory', () => {
  const only = (...names: string[]) => (name: string) => names.includes(name) ? `/bin/${name}` : undefined;
  const both = {WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0'};
  assert.equal(selectClipboardBackend({platform: 'linux', env: both, resolve: only('wl-copy', 'xclip', 'xsel')})?.command, '/bin/wl-copy');
  assert.equal(selectClipboardBackend({platform: 'linux', env: both, resolve: only('xclip', 'xsel')})?.command, '/bin/xclip', 'wl-copy missing under XWayland falls back');
  assert.equal(selectClipboardBackend({platform: 'linux', env: both, resolve: only('xsel')})?.command, '/bin/xsel');
  assert.equal(selectClipboardBackend({platform: 'linux', env: {WAYLAND_DISPLAY: 'wayland-0'}, resolve: only('xclip')}), undefined, 'no X11 session: no xclip');
  assert.equal(selectClipboardBackend({platform: 'linux', env: {}, resolve: only('wl-copy', 'xclip')}), undefined, 'headless: unavailable, commands unaffected');
});
