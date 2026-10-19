import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FISH_MARK_FUNCTION} from '../src/shell/adapters/FishAdapter.js';

/**
 * #443, by fault injection instead of timing. Fish 3 does not retry a terminal write that a signal interrupts: the
 * kernel returns EINTR (ERESTARTSYS without SA_RESTART, as #443's strace showed for SIGWINCH), Fish prints "write:
 * Interrupted system call" and the bytes are gone. Here a preloaded shim makes write() fail with exactly that error, a
 * set number of times, for a write that contains a given text; nothing depends on when a signal lands.
 *
 * Linux only (LD_PRELOAD), with a C compiler and Fish; CI's Ubuntu runner has Fish 3.7.0.
 */
const fish = ['/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish'].find(existsSync);
const cc = ['/usr/bin/cc', '/usr/bin/gcc', '/usr/bin/clang'].find(existsSync);
const major = fish ? Number(/version (\d+)/u.exec(spawnSync(fish, ['--version'], {encoding: 'utf8'}).stdout ?? '')?.[1]) : NaN;
const skip = process.platform !== 'linux' ? 'needs LD_PRELOAD (Linux)' : !fish ? 'fish not installed' : !cc ? 'no C compiler' : false;

const SHIM = String.raw`
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static ssize_t (*real_write)(int, const void *, size_t);
static int remaining = -1;
ssize_t write(int fd, const void *buffer, size_t length) {
  if (!real_write) real_write = (ssize_t (*)(int, const void *, size_t))dlsym(RTLD_NEXT, "write");
  if (remaining < 0) { const char *fails = getenv("QA_EINTR_FAILS"); remaining = fails ? atoi(fails) : 0; }
  const char *match = getenv("QA_EINTR_MATCH");
  if (remaining > 0 && match && *match && memmem(buffer, length, match, strlen(match))) { remaining -= 1; errno = EINTR; return -1; }
  return real_write(fd, buffer, length);
}
`;

let root: string | undefined;
let shim: string | undefined;
function build(): string {
  if (shim) return shim;
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'nmsh-eintr-'));
  writeFileSync(join(root, 'shim.c'), SHIM);
  shim = join(root, 'shim.so');
  const built = spawnSync(cc!, ['-shared', '-fPIC', '-o', shim, join(root, 'shim.c'), '-ldl'], {encoding: 'utf8'});
  assert.equal(built.status, 0, built.stderr);
  return shim;
}
test.after(() => { if (root) rmSync(root, {recursive: true, force: true}); });

/** Run a Fish script with NMSh's marker function; the first `fails` writes containing `match` fail with EINTR. */
function run(script: string, match: string, fails: number) {
  const result = spawnSync(fish!, ['--no-config', '-c', `${FISH_MARK_FUNCTION}\n${script}`], {encoding: 'utf8', timeout: 20_000,
    env: {...process.env, LD_PRELOAD: build(), QA_EINTR_MATCH: match, QA_EINTR_FAILS: String(fails)}});
  assert.equal(result.error, undefined, 'fish ran and ended');
  return {stdout: result.stdout, stderr: result.stderr};
}
const count = (text: string, part: string) => text.split(part).length - 1;
const MARK = `__nmsh_mark '\\e]777;nmsh;QA;mark\\a'; echo QA-AFTER`;
const MARKER = '\u001b]777;nmsh;QA;mark\u0007';

test('the shim is faithful: an interrupted write in Fish fails as #443\'s trace did', {skip}, () => {
  const {stdout, stderr} = run('echo QA-OUTPUT', 'QA-OUTPUT', 1);
  if (major < 4) {
    // Fish 3's own output is lost, with the error #443 showed. NMSh cannot retry a person's command for them: the
    // documented limit (Linux, Fish 3), whose cause is NMSh resizing the terminal while a command runs.
    assert.equal(stdout.includes('QA-OUTPUT'), false, 'Fish 3 drops the interrupted write');
    assert.match(stderr, /Interrupted system call/u);
  } else assert.match(stdout, /QA-OUTPUT/u, 'Fish 4 retries an interrupted write');
});

test('a marker whose write is interrupted once arrives exactly once', {skip}, () => {
  const {stdout, stderr} = run(MARK, ']777;nmsh;QA;', 1);
  assert.equal(count(stdout, MARKER), 1);
  assert.match(stdout, /QA-AFTER/u);
  assert.doesNotMatch(stderr, /Interrupted/u, 'no error reaches the person');
});

test('a marker whose write is interrupted twice in a row still arrives exactly once (resizes come in bursts)', {skip}, () => {
  const {stdout, stderr} = run(MARK, ']777;nmsh;QA;', 2);
  assert.equal(count(stdout, MARKER), 1);
  assert.match(stdout, /QA-AFTER/u);
  assert.doesNotMatch(stderr, /Interrupted/u, 'no error reaches the person');
});

test('a marker that cannot be written is given up after a bounded number of attempts: no error text, no hang', {skip}, () => {
  const {stdout, stderr} = run(MARK, ']777;nmsh;QA;', 50);
  assert.equal(count(stdout, MARKER), major < 4 ? 0 : 1);
  assert.match(stdout, /QA-AFTER/u, 'the command goes on');
  assert.doesNotMatch(stderr, /Interrupted/u, 'no error reaches the person');
});
