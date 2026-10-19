import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import pty from 'node-pty';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FISH_MARK_FUNCTION} from '../src/shell/adapters/FishAdapter.js';

/**
 * #443, by fault injection instead of timing. Fish 3 does not retry a terminal write that a signal interrupts: the
 * kernel returns EINTR (ERESTARTSYS without SA_RESTART, as #443's strace showed for SIGWINCH), Fish prints "write:
 * Interrupted system call" and the bytes are gone. Here a preloaded shim makes a terminal write() fail with exactly that
 * error, a set number of times, when it contains a given text; nothing depends on when a signal lands. Only terminal
 * writes fail, as with the real signal: a few bytes into a pipe never wait, so nothing interrupts them.
 *
 * Linux only (LD_PRELOAD), with a C compiler and Fish; CI's Ubuntu runner has Fish 3.7.0. Fish runs in a real terminal.
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
  if (remaining > 0 && match && *match && isatty(fd) && memmem(buffer, length, match, strlen(match))) { remaining -= 1; errno = EINTR; return -1; }
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

/**
 * Run a Fish script with NMSh's marker function in a terminal; in every process, the first `fails` terminal writes
 * containing `match` fail with EINTR. Resolves with everything the terminal received, once the script says it ended.
 */
function run(script: string, match: string, fails: number, mark = FISH_MARK_FUNCTION): Promise<string> {
  const shim = build();
  return new Promise((resolve, reject) => {
    const child = pty.spawn(fish!, ['--no-config', '-c', `${mark}\n${script}\necho QA-END`], {cols: 200, rows: 20,
      env: {...process.env, LD_PRELOAD: shim, QA_EINTR_MATCH: match, QA_EINTR_FAILS: String(fails)} as Record<string, string>});
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`fish did not finish: ${JSON.stringify(output)}`)); }, 20_000);
    child.onData(data => {
      output += data;
      if (output.includes('QA-END')) { clearTimeout(timer); child.kill(); resolve(output); }
    });
  });
}
const count = (text: string, part: string) => text.split(part).length - 1;
const MARK = `__nmsh_mark '\\e]777;nmsh;QA;mark\\a'; echo QA-AFTER`;
const MARKER = '\u001b]777;nmsh;QA;mark\u0007';

test('the shim is faithful: an interrupted terminal write in Fish fails as #443\'s trace did', {skip}, async () => {
  const output = await run('echo QA-OUTPUT', 'QA-OUTPUT', 1);
  if (major < 4) {
    // Fish 3's own output is lost, with the error #443 showed. NMSh cannot retry a person's command for them: the
    // documented limit (Linux, Fish 3), whose cause is NMSh resizing the terminal while a command runs.
    assert.equal(output.includes('QA-OUTPUT\r\n'), false, 'Fish 3 drops the interrupted write');
    assert.match(output, /Interrupted system call/u);
  } else assert.match(output, /QA-OUTPUT/u, 'Fish 4 retries an interrupted write');
});

for (const fails of [1, 2, 50]) {
  test(`a marker whose terminal write is interrupted ${fails === 50 ? 'again and again' : fails === 1 ? 'once' : 'twice in a row (resizes come in bursts)'} arrives exactly once, with no error shown`, {skip}, async () => {
    const output = await run(MARK, ']777;nmsh;QA;', fails);
    assert.equal(count(output, MARKER), 1);
    assert.match(output, /QA-AFTER/u, 'the command goes on');
    assert.doesNotMatch(output, /Interrupted/u, 'no error reaches the person');
  });
}

/** #445's helper (v0.22 candidate 68c1cbb7): one retry with the builtin. */
const RETRY_ONCE = `function __nmsh_mark
  printf $argv 2>/dev/null; or printf $argv
end`;

test('the harness tells them apart: on Fish 3, #445\'s single retry shows the error and loses a marker interrupted twice', {skip: skip || (major >= 4 ? 'Fish 4 retries by itself' : false)}, async () => {
  const once = await run(MARK, ']777;nmsh;QA;', 1, RETRY_ONCE);
  assert.equal(count(once, MARKER), 1, 'one retry is enough for one interruption');
  assert.match(once, /Interrupted system call/u, 'but Fish 3 still prints the error into the transcript');
  const twice = await run(MARK, ']777;nmsh;QA;', 2, RETRY_ONCE);
  assert.equal(count(twice, MARKER), 0, 'and two interruptions in a row lose the marker');
});
