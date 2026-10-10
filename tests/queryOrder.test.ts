import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {QueryOrder} from '../src/shell/QueryOrder.js';
import {ShellSession} from '../src/shell/ShellSession.js';

const DA1 = '\u001b[?62;22c';

function order(holdMs = 500) {
  const written: string[] = [];
  return {written, order: new QueryOrder(data => written.push(data), holdMs)};
}

test('keys typed after a device-attributes query wait behind the answer, then follow it in order', () => {
  const {written, order: queries} = order();
  queries.input('before');
  queries.observeOutput('prompt\u001b]11;?\u001b\\\u001b[6n\u001b[0c');
  assert.equal(queries.holding, true);
  queries.input('hunter2\r');
  queries.input('echo next\r');
  assert.deepEqual(written, ['before'], 'nothing overtakes the answer');
  // The host answers the cursor position and the device attributes; keys typed in the same burst still follow them.
  queries.input(`\u001b[1;1Rmore${DA1}tail`);
  assert.deepEqual(written, ['before', `\u001b[1;1R${DA1}`, 'hunter2\recho next\rmoretail']);
  assert.equal(queries.holding, false);
  queries.input('x');
  assert.deepEqual(written.at(-1), 'x', 'once answered, input flows directly');
});

test('an answer split across reads is still recognised; NMSh\'s own answer releases held keys', () => {
  const {written, order: queries} = order();
  queries.observeOutput('\u001b[');
  queries.observeOutput('c');
  assert.equal(queries.holding, true, 'a query split across output chunks is seen');
  queries.input('k');
  queries.input('\u001b[?62;');
  queries.input('22c');
  assert.deepEqual(written, [DA1, 'k']);
  queries.observeOutput('\u001b[c');
  queries.input('typed');
  queries.answer(DA1);
  assert.deepEqual(written.slice(2), [DA1, 'typed']);
});

test('a host that never answers cannot stall typing, and bulk input is never held', async () => {
  const {written, order: queries} = order(30);
  queries.observeOutput('\u001b[0c');
  queries.input('typed');
  assert.deepEqual(written, []);
  await new Promise(done => setTimeout(done, 60));
  assert.deepEqual(written, ['typed']);
  queries.observeOutput('\u001b[c');
  queries.input('x'.repeat(70 * 1024));
  assert.equal(written.length, 2, 'beyond the limit the held input is delivered at once');
  assert.equal(queries.holding, false);
  queries.dispose();
});

test('other answers alone, DA2 and ordinary escapes never release or reorder a hold', () => {
  const {written, order: queries} = order();
  queries.observeOutput('\u001b[0c');
  queries.input('\u001b[>1;10;0c');
  queries.input('\u001b[A');
  assert.deepEqual(written, []);
  queries.input(DA1);
  assert.deepEqual(written, [`\u001b[>1;10;0c${DA1}`, '\u001b[A']);
});

const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);

test('fish\'s read is answered like its prompt: its queries never reach the host, and it reads at once', {skip: fish ? false : 'fish not installed', timeout: 30_000}, async () => {
  const home = mkdtempSync('/tmp/nt-qo-');
  const shell = new ShellSession(home, 100, 30, home, {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, 'data'),
    PATH: `${fish!.replace(/\/fish$/u, '')}:${process.env.PATH}`, TERM: 'xterm-256color'}, 'fish');
  let output = '';
  shell.on('data', data => { output += data; });
  try {
    await once(shell, 'prompt');
    for (const secret of ['', '-s ']) {
      output = '';
      shell.submit(`read ${secret}-P 'Name: ' x; echo got=$x`);
      const started = Date.now();
      while (!output.includes('Name: ') && Date.now() - started < 10_000) await new Promise(done => setTimeout(done, 5));
      assert.ok(output.includes('Name: '), `fish ${secret}read drew its prompt`);
      // Nothing answers on the host side here; before, fish waited for the host's answer and dropped keys meanwhile.
      const prompt = once(shell, 'prompt');
      shell.write('abc\r');
      await prompt;
      assert.match(output, /got=abc/u);
      assert.doesNotMatch(output, /\u001b\[0?c|\u001b\[6n|\u001b\]11;\?/u, 'fish\'s editor queries are answered by NMSh, never passed to the host');
      assert.ok(Date.now() - started < 3000, `read answered promptly (${Date.now() - started} ms)`);
    }
  } finally {
    shell.kill();
    rmSync(home, {recursive: true, force: true});
  }
});
