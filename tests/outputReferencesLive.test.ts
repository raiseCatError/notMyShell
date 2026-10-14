import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until, type Frontend} from './helpers/liveFrontend.js';

test('live: failure keys and reference copies use restored command records and preserve a narrow composer draft', {
  skip: !['darwin', 'linux'].includes(process.platform), timeout: 120_000,
}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  try {
    const bin = join(sandbox.root, 'fake-bin');
    const clipboard = join(sandbox.root, 'clipboard');
    mkdirSync(bin);
    writeFileSync(clipboard, 'UNCHANGED');
    for (const name of ['pbcopy', 'wl-copy', 'xclip']) {
      const path = join(bin, name);
      // Publish complete clipboard bytes in one rename; truncation is not completion.
      writeFileSync(path, `#!/bin/sh\ntemporary="${clipboard}.pending.$$"\ntrap 'rm -f "$temporary"' EXIT\ncat > "$temporary" && mv "$temporary" "${clipboard}"\n`);
      chmodSync(path, 0o755);
    }
    const env = {PATH: `${bin}:${process.env.PATH}`, NO_COLOR: '1', NMSH_ICONS: 'safe',
      ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})};
    const first = sandbox.launch([], {cols: 100, rows: 30}, env);
    await first.waitFor(/notMyShell|zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined),
      20_000, 'authenticated initial prompt');
    await first.run(`printf 'OLDER-%s\\n' FAILURE; false`, /OLDER-FAILURE/u);
    await first.run(`printf 'error:%s\\n' HARMLESS`, /error:HARMLESS/u);
    await first.run(`printf 'src/%s.ts:42:7\\nhttps://example.com/%s\\n' latest docs; false`, /src\/latest.ts:42:7/u);
    await first.run(`printf 'LAST-%s\\n' SUCCESS`, /LAST-SUCCESS/u);
    const [session] = await sandbox.sessions();
    assert.ok(session);
    first.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions()).find(item => item.id === session.id)?.state === 'detached',
      15_000, 'detached shell');
    const back = sandbox.launch(['--attach', session.id], {cols: 50, rows: 24}, env);
    await back.waitFor(/LAST-SUCCESS/u);
    assert.equal(readFileSync(clipboard, 'utf8'), 'UNCHANGED', 'restoring output does not copy anything');
    back.pty.write('echo DRAFT-UNCHANGED');

    async function palette(target: Frontend, query: string, expect: RegExp) {
      const mark = target.mark;
      target.pty.write('\u001bOP');
      await target.waitFor(/Command palette/u, mark);
      target.pty.write(query);
      await target.waitFor(expect, mark);
      target.pty.write('\r');
    }
    async function copyOutput(key: string, expected: string) {
      writeFileSync(clipboard, 'UNCHANGED');
      back.pty.write(key);
      await palette(back, 'copy output', /Copy output/u);
      await until(() => readFileSync(clipboard, 'utf8') !== 'UNCHANGED', 15_000, 'selected failure clipboard bytes');
      assert.equal(readFileSync(clipboard, 'utf8'), expected);
    }
    // Successful output containing "error" is skipped. Navigation chooses records, not matching output rows.
    await copyOutput('\u001b[19~', 'src/latest.ts:42:7\nhttps://example.com/docs');
    await copyOutput('\u001b[19~', 'OLDER-FAILURE');
    await copyOutput('\u001b[19;2~', 'src/latest.ts:42:7\nhttps://example.com/docs');

    await palette(back, 'files links', /Files, links and more/u);
    const mark = back.mark;
    back.pty.write('copy src');
    await back.waitFor(/Copy src\/latest.ts:42:7/u, mark);
    writeFileSync(clipboard, 'UNCHANGED');
    back.pty.write('\r');
    await until(() => readFileSync(clipboard, 'utf8') !== 'UNCHANGED', 15_000, 'explicit file reference copy');
    assert.equal(readFileSync(clipboard, 'utf8'), 'src/latest.ts:42:7');
    assert.doesNotMatch(back.output, /\u001b\[38;[25];/u, 'NO_COLOR stays plain');

    // Enter belongs to the focused historical block until Esc returns to the composer.
    // Assert that opening its menu cannot execute the preserved draft.
    const focusMark = back.mark;
    back.pty.write('\r');
    await back.waitFor(/Command palette/u, focusMark);
    assert.equal((await sandbox.transcripts().list()).flatMap(item => item.transcript.records)
      .some(record => record.command === 'echo DRAFT-UNCHANGED'), false);
    back.pty.write('\u001b[27u'); // close the block menu
    back.pty.write('\u001b[27u'); // return focus to the composer
    back.pty.write('\r');
    await until(async () => (await sandbox.transcripts().list()).some(item =>
      item.transcript.records.some(record => record.command === 'echo DRAFT-UNCHANGED')),
    15_000, 'the original composer draft executes only on its explicit Enter');
    const records = (await sandbox.transcripts().list()).flatMap(item => item.transcript.records);
    assert.equal(records.filter(record => record.command === 'echo DRAFT-UNCHANGED').length, 1);
    assert.equal(records.some(record => record.command.includes('copy output') || record.command === 'copy src'), false,
      'action searches never became shell commands');
    assert.equal(existsSync(join(sandbox.config, 'nmsh', 'pins.json')), false, 'navigation never saved commands');
  } finally { await sandbox.dispose(); }
});
