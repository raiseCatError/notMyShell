import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {socketPathFor} from '../src/session/runtimeDir.js';
import {serializeCopyPayload} from '../src/output/OutputBuffer.js';
import type {TranscriptSession} from '../src/sessions/TranscriptStore.js';
import {LiveSandbox, processAlive, strip, until, type Frontend} from './helpers/liveFrontend.js';
import {spoolPathFor} from '../src/session/runtimeDir.js';
import {readSpool} from '../src/session/StreamBacklog.js';

/**
 * Output produced while no frontend is attached is kept by the service and
 * rebuilt into the one transcript/journal on reattach, exactly once.
 */

async function detached(sandbox: LiveSandbox) {
  await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
  return (await sandbox.sessions())[0]!;
}

/** Wait until a frontend journal checkpoint satisfies check, so a kill now loses nothing it showed. */
async function journaled(sandbox: LiveSandbox, check: (session: TranscriptSession) => boolean) {
  await until(async () => {
    const store = sandbox.transcripts();
    try {
      for (const summary of await store.listSummaries()) if (check(await store.load(summary.id))) return true;
    } catch { /* not written yet */ }
    return false;
  }, 15000, 'journal checkpoint');
}

const journaledRunning = (sandbox: LiveSandbox, text: string) =>
  journaled(sandbox, session => session.live?.running?.command.includes(text) === true);

async function idle(sandbox: LiveSandbox) {
  await until(async () => {
    const [session] = await sandbox.sessions();
    return session !== undefined && session.running === undefined;
  }, 30000, 'shell idle');
}

async function finishAndLoad(sandbox: LiveSandbox, frontend: Frontend) {
  frontend.pty.write('exit\r');
  await frontend.waitExit();
  await until(async () => (await sandbox.sessions()).length === 0, 15000, 'session end');
  const store = sandbox.transcripts();
  const summaries = await store.listSummaries();
  assert.equal(summaries.length, 1, 'reattach continues the same journal instead of starting another');
  return store.load(summaries[0]!.id);
}

test('a command started attached completes detached with its output, exit code and duration', async () => {
  const sandbox = new LiveSandbox();
  try {
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    await first.run('echo BEFORE-DETACH', /BEFORE-DETACH/);
    const gate = join(sandbox.home, 'gate');
    first.pty.write(`while [ ! -f ${gate} ]; do sleep 0.05; done; printf 'DETACHED-\\033[31mRED\\033[0m-OUT\\n'; (exit 3)\r`);
    await journaledRunning(sandbox, 'DETACHED-');
    const {id} = (await sandbox.sessions())[0]!;
    first.pty.kill('SIGKILL');
    await detached(sandbox);
    writeFileSync(gate, '');
    await idle(sandbox);

    const second = sandbox.launch(['--attach', id]);
    await second.waitFor(/1 command completed while detached/);
    await second.waitFor(/DETACHED-RED-OUT/);
    assert.match(second.output, /\u001b\[[0-9;]*m/, 'styled output is presented');
    await second.run('echo AFTER-REATTACH', /AFTER-REATTACH/);

    const journal = await finishAndLoad(sandbox, second);
    const commands = journal.transcript.records.map(record => record.command).reverse();
    assert.equal(commands[0], 'echo BEFORE-DETACH');
    assert.match(commands[1] ?? '', /DETACHED-/);
    assert.equal(commands[2], 'echo AFTER-REATTACH');
    const detachedRecord = journal.transcript.records.find(record => record.command.includes('DETACHED-'))!;
    assert.equal(detachedRecord.exitCode, 3);
    assert.match(detachedRecord.lifecycleText, /\d/, 'lifecycle row carries the real duration');
    assert.match(serializeCopyPayload(detachedRecord), /DETACHED-RED-OUT/);
    assert.doesNotMatch(detachedRecord.output, /DETACHED-RED-OUT[\s\S]*DETACHED-RED-OUT/, 'replayed exactly once');
    assert.ok(journal.endedAt, 'exit ends the journal');
    assert.equal(journal.live?.running, undefined);
  } finally {
    await sandbox.dispose();
  }
});

test('several commands, a failure and a cd while no frontend is attached', async () => {
  const sandbox = new LiveSandbox();
  try {
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    await first.run('echo START', /START/);
    await journaled(sandbox, session => session.transcript.records.some(record => record.command === 'echo START'));
    const {id} = (await sandbox.sessions())[0]!;
    first.pty.kill('SIGKILL');
    await detached(sandbox);

    // A raw client drives the shell without journaling or acknowledging anything.
    const raw = await SocketSessionClient.connect({socketPath: socketPathFor(sandbox.runtime), cwd: sandbox.home,
      columns: 80, rows: 24, env: {}, attach: id});
    let prompts = 0;
    raw.on('prompt', () => { prompts += 1; });
    raw.start();
    for (const command of ['echo ONE', 'false', `cd ${sandbox.home}`, 'echo TWO']) {
      const before = prompts;
      raw.submit(command);
      await until(() => prompts > before, 15000, command);
    }
    raw.detach();
    await detached(sandbox);

    const second = sandbox.launch(['--attach', id]);
    await second.waitFor(/4 commands completed while detached/);
    await second.run('pwd', new RegExp(sandbox.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const journal = await finishAndLoad(sandbox, second);
    const records = [...journal.transcript.records].reverse();
    assert.deepEqual(records.map(record => [record.command, record.exitCode]).slice(0, 5),
      [['echo START', 0], ['echo ONE', 0], ['false', 1], [`cd ${sandbox.home}`, 0], ['echo TWO', 0]]);
    assert.equal(journal.finalCwd, sandbox.home);
  } finally {
    await sandbox.dispose();
  }
});

test('high-volume detached output: complete within limits, factual marker beyond them', async () => {
  // Small limits exercise both the spool and truncation paths without writing
  // hundreds of megabytes of transcript.
  const sandbox = new LiveSandbox({}, {NMSH_BACKLOG_MEMORY_BYTES: '8192', NMSH_BACKLOG_SPOOL_BYTES: '65536'});
  try {
    for (const [lines, truncated] of [[8000, false], [40000, true]] as const) {
      const first = sandbox.launch();
      await first.waitFor(/❯/);
      const gate = join(sandbox.home, `gate-${lines}`);
      first.pty.write(`while [ ! -f ${gate} ]; do sleep 0.05; done; seq 1 ${lines}; echo VOLUME-END\r`);
      await journaledRunning(sandbox, `seq 1 ${lines}`);
      const {id} = (await sandbox.sessions()).at(-1)!;
      first.pty.kill('SIGKILL');
      await until(async () => (await sandbox.sessions()).at(-1)?.state === 'detached', 15000, 'detached');
      writeFileSync(gate, '');
      await until(async () => (await sandbox.sessions()).at(-1)?.running === undefined, 60000, 'volume done');

      const second = sandbox.launch(['--attach', id]);
      await second.waitFor(/1 command completed while detached/, 0, 60000);
      if (truncated) await second.waitFor(/exceeded the retention limit and was not kept/);
      else assert.doesNotMatch(strip(second.output), /retention limit/);
      second.pty.write('exit\r');
      await second.waitExit();
      await until(async () => (await sandbox.sessions()).length === 0, 15000, 'session end');
      const store = sandbox.transcripts();
      const newest = await store.load((await store.listSummaries())[0]!.id);
      const record = newest.transcript.records.find(entry => entry.command.includes(`seq 1 ${lines}`))!;
      assert.equal(record.exitCode, 0);
      if (!truncated) {
        assert.equal(record.expanded, false, 'the fold policy applies to output completed while detached');
        assert.match(record.output, /^1$/m);
        assert.match(record.output, new RegExp(`^${lines}$`, 'm'));
      }
      assert.match(record.output, /VOLUME-END/, 'the tail after truncation is kept');
    }
  } finally {
    await sandbox.dispose();
  }
});

test('fullscreen output while detached is repainted, not replayed into the transcript', async () => {
  const sandbox = new LiveSandbox();
  try {
    const fixture = join(sandbox.home, 'alt.zsh');
    const stop = join(sandbox.home, 'stop');
    writeFileSync(fixture, [
      `printf '\\e[?1049h'`,
      `while [ ! -f ${stop} ]; do printf 'ALTSCREEN-FRAME\\n'; sleep 0.05; done`,
      `printf '\\e[?1049l'`,
      `echo AFTER-ALT`,
    ].join('\n'));
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    first.pty.write(`zsh ${fixture}\r`);
    await first.waitFor(/ALTSCREEN-FRAME/);
    const {id} = (await sandbox.sessions())[0]!;
    first.pty.kill('SIGKILL');
    await detached(sandbox);
    writeFileSync(stop, '');
    await idle(sandbox);

    const second = sandbox.launch(['--attach', id]);
    await second.waitFor(/AFTER-ALT/);
    assert.doesNotMatch(strip(second.output), /ALTSCREEN-FRAME/);
    const journal = await finishAndLoad(sandbox, second);
    const record = journal.transcript.records.find(entry => entry.command.includes('alt.zsh'))!;
    assert.doesNotMatch(record.output, /ALTSCREEN-FRAME/);
    assert.match(record.output, /AFTER-ALT/);
  } finally {
    await sandbox.dispose();
  }
});

test('service killed mid-output while detached leaves a spool of complete records', async () => {
  const sandbox = new LiveSandbox({}, {NMSH_BACKLOG_MEMORY_BYTES: '4096'});
  try {
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    const gate = join(sandbox.home, 'gate');
    first.pty.write(`while [ ! -f ${gate} ]; do sleep 0.05; done; while true; do echo STREAMING-LINE; done\r`);
    await journaledRunning(sandbox, 'STREAMING-LINE');
    const {id, pid} = (await sandbox.sessions())[0]!;
    first.pty.kill('SIGKILL');
    await detached(sandbox);
    writeFileSync(gate, '');
    const spool = spoolPathFor(sandbox.runtime, id);
    await until(() => existsSync(spool) && statSync(spool).size > 64 * 1024, 20000, 'spool growth');
    const service = execFileSync('lsof', ['-t', socketPathFor(sandbox.runtime)], {encoding: 'utf8'}).split('\n')
      .map(Number).filter(servicePid => servicePid > 0 && servicePid !== process.pid);
    assert.ok(service.length > 0);
    for (const servicePid of service) process.kill(servicePid, 'SIGKILL');
    await until(() => !processAlive(pid), 15000, 'shell to die with its PTY owner');

    const contents = readSpool(spool);
    assert.ok(contents.events.length > 0);
    const seqs = contents.events.map(event => event.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'records are ordered');
    assert.ok(contents.events.some(event => event.kind === 'output' && event.data.includes('STREAMING-LINE')));
    // The frontend may die between saving its journal and acking it; replay
    // then dedups by the journal's own seq, so an ack is optional here.
    if (contents.ackedSeq > 0) assert.ok(contents.journalId, 'an ack records which journal it covers');
  } finally {
    await sandbox.dispose().catch(() => {});
  }
});
