import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClipboardUnavailableError, readClipboard, selectClipboardReadBackend} from '../src/clipboard/clipboard.js';

const installed = (...names: string[]) => (name: string) => names.includes(name) ? `/usr/bin/${name}` : undefined;

test('the read tool follows platform and session, like the write tool', () => {
  assert.deepEqual(selectClipboardReadBackend({platform: 'darwin', env: {}}), {command: 'pbpaste', args: []});
  assert.deepEqual(selectClipboardReadBackend({platform: 'linux', env: {WAYLAND_DISPLAY: 'w0', DISPLAY: ':0'}, resolve: installed('wl-paste', 'xclip')}), {command: '/usr/bin/wl-paste', args: ['--no-newline']});
  assert.deepEqual(selectClipboardReadBackend({platform: 'linux', env: {DISPLAY: ':0'}, resolve: installed('xclip')}), {command: '/usr/bin/xclip', args: ['-selection', 'clipboard', '-o']});
  assert.deepEqual(selectClipboardReadBackend({platform: 'linux', env: {DISPLAY: ':0'}, resolve: installed('xsel')}), {command: '/usr/bin/xsel', args: ['--clipboard', '--output']});
  assert.equal(selectClipboardReadBackend({platform: 'linux', env: {}, resolve: installed('xclip')}), undefined);
  assert.equal(selectClipboardReadBackend({platform: 'win32', env: {}}), undefined);
});

function fake(body: string): {options: Parameters<typeof readClipboard>[0]; cleanup: () => void} {
  const directory = mkdtempSync(join(tmpdir(), 'nmsh-paste-'));
  const script = join(directory, 'xclip');
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  chmodSync(script, 0o755);
  return {options: {platform: 'linux', env: {DISPLAY: ':0'}, resolve: name => name === 'xclip' ? script : undefined, timeoutMs: 1500}, cleanup: () => rmSync(directory, {recursive: true, force: true})};
}

test('reads exactly what the tool prints: newlines, quotes and non-ASCII intact', async () => {
  const {options, cleanup} = fake('printf \'%s\' "line one\n  rm -rf \\"x\\"\nüñí 🐈"');
  try { assert.equal(await readClipboard(options), 'line one\n  rm -rf "x"\nüñí 🐈'); } finally { cleanup(); }
});

test('an empty clipboard reads as an empty string', async () => {
  const {options, cleanup} = fake('exit 0');
  try { assert.equal(await readClipboard(options), ''); } finally { cleanup(); }
});

test('a tool that fails, hangs or prints too much is an error, never partial text', async () => {
  const failing = fake('echo secret; exit 1');
  try { await assert.rejects(readClipboard(failing.options), /exited with code 1/u); } finally { failing.cleanup(); }
  const hanging = fake('sleep 30');
  try { await assert.rejects(readClipboard({...hanging.options, timeoutMs: 200}), /timed out/u); } finally { hanging.cleanup(); }
  const huge = fake('head -c 3000000 /dev/zero | tr "\\0" "a"');
  try { await assert.rejects(readClipboard(huge.options), (error: unknown) => error instanceof ClipboardUnavailableError && /more than 1 MiB/u.test(error.message)); } finally { huge.cleanup(); }
});

test('no clipboard tool is a clear, non-fatal error', async () => {
  await assert.rejects(readClipboard({platform: 'linux', env: {}, resolve: () => undefined}), /install wl-paste/u);
  await assert.rejects(readClipboard({platform: 'win32', env: {}}), /unsupported platform/u);
});
