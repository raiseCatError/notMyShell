import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

const supported = process.platform === 'darwin' || process.platform === 'linux';
const entry = fileURLToPath(new URL('./fixtures/ownershipRaceEntry.mjs', import.meta.url));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

for (const reactionMs of [0, 300]) {
  test(`controlled real PTY: echo-only immediate read after ${reactionMs}ms needs explicit recovery, never command approval`, {skip: !supported, timeout: 60_000}, async t => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
    const gate = join(sandbox.home, 'ownership-gate');
    const frontend = sandbox.launch([], {cols: 120, rows: 36}, {NMSH_TEST_OWNERSHIP_GATE: gate}, entry);
    const trace = () => existsSync(gate + '.jsonl') ? readFileSync(gate + '.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as {event: string; bytes?: number}) : [];
    try {
      // As in the existing live fixture: do not let an admin poll close an empty service before create/attach.
      await frontend.waitFor(/zsh/u);
      await until(async () => (await sandbox.sessions()).some(s => s.lastExit !== undefined), 30_000, () => 'authenticated prompt: ' + strip(frontend.output).slice(-1000));
      await frontend.run('echo READY', /READY/u);
      const command = `read -r QA_RACE; printf 'RECOVERED=%s\\n' "$QA_RACE"`;
      const before = trace().length;
      const mark = frontend.mark;
      frontend.pty.write(command + '\r');
      await pause(reactionMs);
      frontend.pty.write('hello\r');
      // Old source reaches the queue instead. Do not wait for a lucky later inference or resend an answer.
      await until(async () => /Can.t tell whether read is reading your typing/u.test(strip(frontend.output.slice(mark)))
        || (await sandbox.sessions())[0]?.queued === 1, 5000, 'ownership hold or old-source approval enqueue');
      assert.equal((await sandbox.sessions())[0]?.queued ?? 0, 0, 'echo-only Enter must not become an approval entry');
      assert.match(strip(frontend.output.slice(mark)), /Can.t tell whether read is reading your typing/u);
      assert.ok(trace().some(e => e.event === 'sample'), 'the control exercised real probe observations');
      writeFileSync(gate + '.release', '');
      await until(async () => (await sandbox.sessions())[0]?.inputMode === 'line', 10_000, 'genuine waiting-reader evidence after releasing the observation control');
      assert.equal(trace().slice(before).filter(e => e.event === 'pty-write').reduce((sum, e) => sum + e.bytes!, 0), Buffer.byteLength(command + '\r'), 'only the submitted command reached the PTY before confirmation');
      assert.equal((await sandbox.sessions())[0]?.running, command, 'late likely/confirmed evidence cannot auto-answer the quarantine');
      frontend.pty.write('\u0013');
      await frontend.waitFor(/RECOVERED=hello/u, mark, 10_000);
      await until(async () => await frontend.completions(command) === 1, 15_000, 'one durable read completion');
      const records = (await sandbox.transcripts().list()).flatMap(s => s.transcript.records);
      assert.equal(records.find(r => r.command === command)?.output.match(/RECOVERED=hello/gu)?.length, 1);
      assert.equal(records.some(r => r.command === 'hello'), false);
      assert.equal((await sandbox.sessions())[0]?.queued ?? 0, 0);
      await frontend.run('echo AFTER', /AFTER/u);
    } catch (error) {
      if (error instanceof Error) error.message += '; metadata=' + JSON.stringify(trace());
      throw error;
    } finally { t.diagnostic(JSON.stringify({reactionMs, trace: trace()})); await sandbox.dispose(); }
  });
}
