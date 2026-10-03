import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {nmshConfigDirectory} from '../src/configuration/paths.js';
import {resolveZsh} from '../src/shell/zshExecutable.js';
import {defaultRuntimeDir} from '../src/session/runtimeDir.js';
import {resolveHostCapabilities} from '../src/host/capabilities.js';
import {createNotificationService} from '../src/notifications/commandNotifications.js';

test('zsh discovery accepts executable symlinks and Unicode/spaces; rejects missing and non-executable shells', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-platform-'));
  try {
    const bin = join(root, '工具 bin'); mkdirSync(bin);
    const shell = join(root, 'actual zsh'); writeFileSync(shell, '#!/bin/sh\n'); chmodSync(shell, 0o755);
    symlinkSync(shell, join(bin, 'zsh'));
    assert.equal(resolveZsh({PATH: bin}, []), join(bin, 'zsh'));
    chmodSync(shell, 0o644);
    assert.throws(() => resolveZsh({PATH: bin}, []), /requires.*zsh.*install/iu);
    assert.throws(() => resolveZsh({PATH: '/missing'}, []), /requires.*zsh/iu);
    assert.throws(() => resolveZsh({}, []), /requires.*zsh/iu);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Linux runtime prefers private absolute XDG runtime; unsafe, relative, symlink and long paths fall back', () => {
  const root = mkdtempSync('/tmp/nr-'); chmodSync(root, 0o700);
  try {
    const selected = defaultRuntimeDir({XDG_RUNTIME_DIR: root}, 'linux');
    assert.equal(selected, join(root, 'nmsh'));
    chmodSync(root, 0o755);
    assert.notEqual(defaultRuntimeDir({XDG_RUNTIME_DIR: root}, 'linux'), selected);
    chmodSync(root, 0o700);
    const link = join(root, 'link'); symlinkSync(root, link);
    assert.notEqual(defaultRuntimeDir({XDG_RUNTIME_DIR: link}, 'linux'), join(link, 'nmsh'));
    assert.notEqual(defaultRuntimeDir({XDG_RUNTIME_DIR: 'relative'}, 'linux'), 'relative/nmsh');
    assert.notEqual(defaultRuntimeDir({XDG_RUNTIME_DIR: '/' + 'x'.repeat(110)}, 'linux'), '/' + 'x'.repeat(110) + '/nmsh');
    assert.equal(defaultRuntimeDir({NMSH_RUNTIME_DIR: '/explicit', XDG_RUNTIME_DIR: root}, 'linux'), '/explicit');
    assert.notEqual(defaultRuntimeDir({XDG_RUNTIME_DIR: root}, 'darwin'), selected);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Linux host fixtures retain passive capabilities and optional notifications are a no-op', async () => {
  for (const env of [{TERM_PROGRAM: 'gnome-terminal'}, {TERM_PROGRAM: 'konsole'}, {TERM_PROGRAM: 'Alacritty'}, {}]) {
    assert.equal(resolveHostCapabilities(env).kittyKeyboard, false);
    assert.equal(resolveHostCapabilities(env).graphicsProtocol, 'none');
  }
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'kitty'}).kittyKeyboard, true);
  assert.equal(resolveHostCapabilities({TERM_PROGRAM: 'WezTerm'}).truecolor, true);
  const service = createNotificationService('linux');
  assert.equal(service.supported, false);
  assert.deepEqual(await service.notify({title: 'NMSh', subtitle: 'Complete', body: 'Complete'}), {ok: false, reason: 'unsupported'});
});

test('configuration ignores relative XDG paths and uses the OS home when HOME is missing', () => {
  assert.equal(nmshConfigDirectory({HOME: '/home/工具 user', XDG_CONFIG_HOME: 'relative'}, 'linux'), '/home/工具 user/.config/nmsh');
  assert.equal(nmshConfigDirectory({}, 'linux'), join(homedir(), '.config', 'nmsh'));
  assert.equal(nmshConfigDirectory({HOME: 'relative'}, 'linux'), join(homedir(), '.config', 'nmsh'));
  assert.equal(nmshConfigDirectory({HOME: '/home/user', XDG_CONFIG_HOME: '/mnt/config dir'}, 'linux'), '/mnt/config dir/nmsh');
});
