import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {removeDirectoryNow} from '../src/util/removeDirectory.js';

// The configured-completion helper's private directory (#417 CI): its shells may write a pid file and its own cleanup
// may `rm -rf` the directory while NMSh removes it. Plain rmSync then threw ENOTEMPTY (macOS) or returned with the
// directory still present (Linux) in roughly one round in ten.
test('a directory another process is writing into and removing is gone when removeDirectoryNow returns', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-rmnow-')));
  try {
    for (let round = 0; round < 120; round += 1) {
      const root = mkdtempSync(join(base, 'r-'));
      for (let index = 0; index < 40; index += 1) writeFileSync(join(root, `f${index}`), 'x');
      const helper = spawn('/bin/sh', ['-c', `i=0; while [ $i -lt 10 ]; do : > '${root}/w'$i 2>/dev/null; i=$((i+1)); done; rm -rf '${root}'`]);
      await new Promise(resolve => setTimeout(resolve, round % 5));
      removeDirectoryNow(root);
      assert.equal(existsSync(root), false, `round ${round}: the directory is gone`);
      if (helper.exitCode === null && helper.signalCode === null) await once(helper, 'close');
    }
    assert.deepEqual(readdirSync(base), [], 'no renamed copy is left behind');
  } finally { rmSync(base, {recursive: true, force: true}); }
});

test('removeDirectoryNow: a missing directory is fine; nothing outside it is touched', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-rmnow-')));
  try {
    writeFileSync(join(base, 'keep'), 'x');
    removeDirectoryNow(join(base, 'missing'));
    assert.deepEqual(readdirSync(base), ['keep']);
  } finally { rmSync(base, {recursive: true, force: true}); }
});
