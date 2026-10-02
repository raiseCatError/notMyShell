import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFeedback, copyStats} from '../src/clipboard/clipboard.js';

test('counts characters and lines without a trailing-newline off-by-one', () => {
  assert.deepEqual(copyStats('hello\n'), {characters: 6, lines: 1});
  assert.deepEqual(copyStats('first\nsecond\n'), {characters: 13, lines: 2});
  assert.deepEqual(copyStats(''), {characters: 0, lines: 0});
  assert.deepEqual(copyStats('🐈'), {characters: 1, lines: 1});
});

test('uses singular and plural copy feedback', () => {
  assert.equal(copyFeedback({characters: 1, lines: 1}), 'Copied to clipboard · 1 character · 1 line');
  assert.equal(copyFeedback({characters: 2, lines: 2}), 'Copied to clipboard · 2 characters · 2 lines');
  assert.equal(copyFeedback({characters: 847, lines: 9}, 2), 'Copied response 2 to clipboard · 847 characters · 9 lines');
});

import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLIPBOARD_MAX_BYTES, ClipboardUnavailableError, selectClipboardBackend, writeClipboard} from '../src/clipboard/clipboard.js';

const installed = (...names: string[]) => (name: string) => names.includes(name) ? `/usr/bin/${name}` : undefined;

test('backend selection follows platform and session environment', () => {
  assert.deepEqual(selectClipboardBackend({platform: 'darwin', env: {}}), {command: 'pbcopy', args: []});
  assert.deepEqual(selectClipboardBackend({platform: 'linux', env: {WAYLAND_DISPLAY: 'w0', DISPLAY: ':0'}, resolve: installed('wl-copy', 'xclip')}), {command: '/usr/bin/wl-copy', args: []});
  assert.deepEqual(selectClipboardBackend({platform: 'linux', env: {DISPLAY: ':0'}, resolve: installed('xclip', 'xsel')}), {command: '/usr/bin/xclip', args: ['-selection', 'clipboard']});
  assert.deepEqual(selectClipboardBackend({platform: 'linux', env: {DISPLAY: ':0'}, resolve: installed('xsel')}), {command: '/usr/bin/xsel', args: ['--clipboard', '--input']});
  assert.deepEqual(selectClipboardBackend({platform: 'linux', env: {WAYLAND_DISPLAY: 'w0', DISPLAY: ':0'}, resolve: installed('xclip')})?.command, '/usr/bin/xclip');
  assert.equal(selectClipboardBackend({platform: 'linux', env: {}, resolve: installed('wl-copy', 'xclip')}), undefined, 'headless session');
  assert.equal(selectClipboardBackend({platform: 'linux', env: {DISPLAY: ':0'}, resolve: installed()}), undefined);
  assert.equal(selectClipboardBackend({platform: 'win32', env: {}}), undefined);
});

test('unavailable, oversized, failing and hung backends reject without side effects', async () => {
  await assert.rejects(writeClipboard('x', {platform: 'linux', env: {}, resolve: installed()}), (error: Error) => error instanceof ClipboardUnavailableError && /wl-copy/.test(error.message));
  await assert.rejects(writeClipboard('x'.repeat(CLIPBOARD_MAX_BYTES + 1), {platform: 'linux', env: {DISPLAY: ':0'}, resolve: installed('xclip')}), ClipboardUnavailableError);
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-clip-'));
  try {
    const script = (name: string, body: string) => { const path = join(dir, name); writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o700); return path; };
    const fail = script('fail', 'cat >/dev/null; exit 3'), hang = script('hang', 'sleep 30');
    await assert.rejects(writeClipboard('x', {platform: 'linux', env: {DISPLAY: ':0'}, resolve: () => fail}), /exited with code 3/);
    const started = Date.now();
    await assert.rejects(writeClipboard('x', {platform: 'linux', env: {DISPLAY: ':0'}, resolve: () => hang, timeoutMs: 150}), /timed out/);
    assert.ok(Date.now() - started < 5000);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('payload reaches the backend on stdin via argv, including a forking selection owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-clip-'));
  try {
    const out = join(dir, 'out'), argv = join(dir, 'argv');
    const path = join(dir, 'xclip');
    // Mimic xclip/wl-copy: a background child inherits the pipes and outlives the parent.
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argv}'\ncat > '${out}'\n(sleep 2 &)\n`);
    chmodSync(path, 0o700);
    const payload = 'héllo; $(touch pwned)\n🐈';
    const started = Date.now();
    await writeClipboard(payload, {platform: 'linux', env: {DISPLAY: ':0'}, resolve: name => name === 'xclip' ? path : undefined});
    assert.ok(Date.now() - started < 1500, 'does not wait for the background owner');
    assert.equal(readFileSync(out, 'utf8'), payload);
    assert.equal(readFileSync(argv, 'utf8'), '-selection\nclipboard\n');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
