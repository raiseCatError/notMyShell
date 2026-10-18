import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * The reviewed queue summary through the real composer, PTY, session service and journal: a chain settles, its
 * artifact is reviewed in the redacted form, stored once, and the saved summary survives detach and reattach.
 * Harmless commands only (sleep, printf, sh -c exit N, a made-up token) inside the sandbox.
 */
const supported = process.platform === 'darwin' || process.platform === 'linux';

async function start() {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 100, rows: 30});
  try {
    await frontend.waitFor(/notMyShell|zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 20_000, 'the shell authenticated prompt');
    await frontend.run('echo READY', /READY/u);
  } catch (error) {
    try { await sandbox.dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'startup and cleanup failed'); }
    throw error;
  }
  return {sandbox, frontend};
}

const artifacts = async (sandbox: LiveSandbox) =>
  (await sandbox.transcripts().list()).flatMap(journal => journal.transcript.queueSummaries ?? []);

function extractReviewRegion(output: string): string {
  // Replace cursor positioning sequences with newlines to preserve terminal rows, then strip ANSI
  const withBreaks = output.replace(/\u001B\[\d+;\d+H/gu, '\n');
  const rows = strip(withBreaks).split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const start = rows.findLastIndex(row => row.includes('Save this Queue Summary?'));
  if (start === -1) return '';
  const end = rows.findIndex((row, idx) => idx >= start && row.includes('Enter saves this summary'));
  return (end === -1 ? rows.slice(start) : rows.slice(start, end + 1)).join('\n');
}

test('live: a settled chain is reviewed and saved as a typed summary the journal carries, once', {skip: supported ? false : 'unsupported platform', timeout: 150_000}, async () => {
  const {sandbox, frontend} = await start();
  try {
    const mark = frontend.mark;
    // One chain: a foreground command, then two queued ones; the last fails and its text carries a made-up token.
    frontend.pty.write('sleep 3\r');
    await frontend.waitFor(/Running sleep 3/u, mark);
    frontend.pty.write(`printf 'OUT-%s\\n' FIRST\r`);
    frontend.pty.write(`sh -c 'exit 4' --token=abc123\r`);
    await frontend.waitFor(/Queue · 3 commands/u, mark);
    await frontend.waitFor(/OUT-FIRST[\s\S]*from queue/u, mark, 30_000);
    await frontend.waitFor(/Queue finished · 3 commands/u, mark, 30_000);

    const review = frontend.mark;
    frontend.pty.write('/queue save-summary\r');
    await frontend.waitFor(/Save this Queue Summary\?/u, review, 20_000);
    await frontend.waitFor(/Enter saves this summary · Esc cancels/u, review);
    const rawSlice = frontend.output.slice(review);
    const region = extractReviewRegion(rawSlice);
    assert.ok(region.length > 0, 'the review container was rendered');
    assert.match(region, /--token=\[REDACTED\]/u, 'the review shows the redacted command text it would store');
    assert.doesNotMatch(region, /--token=abc123/u, 'the raw secret never reaches the review');
    assert.match(region, /3 executed · 2 succeeded · 1 failed/u, 'the review carries the observed facts');

    frontend.pty.write('\r');
    await frontend.waitFor(/Queue Summary · 3 executed/u, review, 20_000);
    await until(async () => (await artifacts(sandbox)).some(summary => summary.id === 'chain-1'), 20_000, 'the saved summary reaches the journal');
    const [summary] = await artifacts(sandbox);
    assert.equal(summary?.origin, 'reviewed');
    assert.equal(summary?.status, 'finished');
    assert.deepEqual([summary?.counts.succeeded, summary?.counts.failed], [2, 1], 'the roll-up is the observed truth');
    assert.deepEqual(summary?.entries.map(entry => entry.exitCode), [0, 0, 4], 'every settled result keeps its real exit code');
    const stored = JSON.stringify(summary);
    assert.doesNotMatch(stored, /abc123/u, 'the raw token is never journaled');
    assert.match(stored, /--token=\[REDACTED\]/u, 'the reviewed redaction is what was stored');
    assert.doesNotMatch(stored, /OUT-FIRST/u, 'shell output is never journaled into a summary');
    assert.ok(summary!.entries.every(entry => entry.durationMs !== undefined), 'observed durations only');

    // Raw transcript output remains unchanged in the journal
    const journals = await sandbox.transcripts().list();
    const tokenRecord = journals.flatMap(j => j.transcript.records).find(r => r.command.includes('token'));
    assert.ok(tokenRecord, 'the raw command record is preserved in the transcript journal');
    assert.match(tokenRecord.command, /--token=abc123/u, 'the original raw command in transcript is unchanged');

    // Detach and reattach: the summary is still there, exactly once, without duplicating or leaking secrets.
    const [session] = await sandbox.sessions();
    frontend.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions()).find(item => item.id === session!.id)?.state === 'detached', 15_000, 'detached');
    const back = sandbox.launch(['--attach', session!.id]);
    await back.waitFor(/Queue Summary · 3 executed[^\n]*/u, 0, 40_000);
    const reattachedArtifacts = await artifacts(sandbox);
    assert.equal(reattachedArtifacts.filter(s => s.id === 'chain-1').length, 1, 'reattach never duplicates an artifact');
    assert.doesNotMatch(JSON.stringify(reattachedArtifacts), /abc123/u, 'restored summaries never contain the original secret');
    assert.match(JSON.stringify(reattachedArtifacts), /--token=\[REDACTED\]/u);
  } finally { await sandbox.dispose(); }
});
