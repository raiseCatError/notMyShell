import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * Queue Mode under #514's ownership race, on a real PTY: a prompt-less `read` that NMSh cannot recognize yet (the
 * fixture holds back only the evidence, never the shell) gets an immediate reply and Enter. An echoing terminal is no
 * evidence of a reader, and Queue Mode queues lines without approval, so the reply reaches the queue as a command.
 * Once the read is seen, that entry waits for approval: when the read gives up and its command succeeds, the reply has
 * not run, and never runs by itself.
 */
const supported = process.platform === 'darwin' || process.platform === 'linux';
const entry = fileURLToPath(new URL('./fixtures/ownershipRaceEntry.mjs', import.meta.url));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

for (const reactionMs of [0, 300]) {
  test(`live zsh, Queue Mode: a reply entered ${reactionMs}ms into a read NMSh could not see yet never runs as a command`, {skip: !supported, timeout: 90_000}, async t => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh', queue: {queueMode: true}});
    const gate = join(sandbox.home, 'ownership-gate');
    const frontend = sandbox.launch([], {cols: 120, rows: 36}, {NMSH_TEST_OWNERSHIP_GATE: gate}, entry);
    const trace = () => existsSync(gate + '.jsonl') ? readFileSync(gate + '.jsonl', 'utf8').trim().split('\n').filter(Boolean) : [];
    try {
      await frontend.waitFor(/zsh/u);
      await until(async () => (await sandbox.sessions()).some(s => s.lastExit !== undefined), 30_000, () => 'authenticated prompt: ' + strip(frontend.output).slice(-1000));
      await frontend.run('echo READY', /READY/u);
      const command = `read -t 8 -r QA_RACE; printf 'TIMED=%s\\n' "$QA_RACE"`;
      const mark = frontend.mark;
      frontend.pty.write(command + '\r');
      await pause(reactionMs);
      frontend.pty.write('hello\r');
      await until(async () => (await sandbox.sessions())[0]?.queued === 1, 5000, 'Queue Mode queued the unrecognized reply');
      assert.ok(trace().some(line => line.includes('"sample"')), 'the control exercised real probe observations');
      writeFileSync(gate + '.release', '');
      await until(async () => (await sandbox.sessions())[0]?.inputMode === 'line', 10_000, 'the read is seen once the evidence is released');
      // The read gives up and the command succeeds: nothing stops the queue except the hold on the possible reply.
      await frontend.waitFor(/TIMED=/u, mark, 15_000);
      await until(async () => await frontend.completions(command) === 1, 15_000, 'the read command completed');
      assert.doesNotMatch(strip(frontend.output.slice(mark)), /TIMED=hello/u, 'the reply never reached the read either');
      await pause(1500);
      const records = (await sandbox.transcripts().list()).flatMap(s => s.transcript.records);
      assert.equal(records.some(r => r.command.trim() === 'hello'), false, 'the reply never ran as a command');
      assert.equal((await sandbox.sessions())[0]?.queued, 1, 'it waits in the queue');
      assert.match(strip(frontend.output.slice(mark)), /waits? for your approval/u, 'and says why');
      // In Queue Mode the next line goes behind it; nothing releases the held reply but the person.
      frontend.pty.write('echo AFTER\r');
      await until(async () => (await sandbox.sessions())[0]?.queued === 2, 5000, 'the next line queued behind the held reply');
      await pause(1500);
      const after = (await sandbox.transcripts().list()).flatMap(s => s.transcript.records).map(r => r.command.trim());
      assert.equal(after.includes('hello') || after.includes('echo AFTER'), false, 'neither ran by itself');
    } finally { t.diagnostic(JSON.stringify({reactionMs, trace: trace().length})); await sandbox.dispose(); }
  });
}
