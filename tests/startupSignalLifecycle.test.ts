import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {LiveSandbox, processAlive, until} from './helpers/liveFrontend.js';

for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
  test(`real startup ${signal} reaps a blocked semantic helper while preserving the service shell`, {timeout: 60_000}, async () => {
    const sandbox = new LiveSandbox();
    const configGate = join(sandbox.home, 'config-gate');
    const journalGate = join(sandbox.home, 'journal-gate');
    const marker = join(sandbox.home, 'semantic-pid');
    let primary: unknown;
    try {
      writeFileSync(join(sandbox.home, '.zshrc'),
        `if [[ ! -t 0 ]]; then print -r -- $$ > '${marker}'; fi\nwhile [ ! -f '${configGate}' ]; do sleep 0.05; done\n`);
      const frontend = sandbox.launch([], {cols: 100, rows: 30}, {NMSH_TEST_JOURNAL_GATE: journalGate},
        resolve('tests/fixtures/heldStartupJournal.ts'));
      await frontend.waitFor(/TEST-STARTUP-JOURNAL-WAIT/);
      await until(() => existsSync(marker) && /^\d+\s*$/u.test(readFileSync(marker, 'utf8')), 15000, 'owned semantic PID marker');
      const semanticPid = Number(readFileSync(marker, 'utf8').trim());
      assert.ok(Number.isSafeInteger(semanticPid) && semanticPid > 1 && processAlive(semanticPid));
      await until(async () => (await sandbox.sessions()).length === 1, 15000, 'managed shell listed');
      const {id, pid} = (await sandbox.sessions())[0]!;
      assert.notEqual(semanticPid, pid, 'the detached helper and managed shell have different owners');
      frontend.pty.kill(signal);
      await until(() => !processAlive(semanticPid), 10000,
        () => `semantic helper ${semanticPid} to end after ${signal}; frontend exit=${frontend.exitCode}, signal=${frontend.exitSignal}`);
      assert.equal(frontend.exitCode, undefined, 'shutdown still waits for the held journal');
      await until(async () => (await sandbox.sessions()).some(session => session.id === id && session.state === 'detached'), 15000, 'shell detached');
      assert.ok(processAlive(pid), 'normal frontend termination preserves the real service shell');
      writeFileSync(journalGate, '');
      assert.equal(await frontend.waitExit(), 0);
      assert.equal(frontend.exitSignal ?? 0, 0, 'normal shutdown has no unhandled exit signal');
      assert.ok(processAlive(pid));
    } catch (error) { primary = error; throw error; }
    finally {
      const errors: unknown[] = [];
      for (const gate of [configGate, journalGate]) {
        try { writeFileSync(gate, ''); } catch (error) { errors.push(error); }
      }
      try { await sandbox.dispose(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(primary === undefined ? errors : [primary, ...errors], 'startup signal fixture cleanup failed');
    }
  });
}
