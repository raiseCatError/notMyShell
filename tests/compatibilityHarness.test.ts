import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

const fixture = fileURLToPath(new URL('./fixtures/compatibility.mjs', import.meta.url));
const quote = (text: string) => `'${text.replace(/'/gu, `'\\''`)}'`;
const command = (mode: string) => `${quote(process.execPath)} ${quote(fixture)} ${mode}`;

for (const mode of ['finite', 'noisy']) test(`${mode} fixture has bounded output, lifecycle, folding and copy ownership`, () => {
  const result = spawnSync(process.execPath, [fixture, mode], {encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024});
  assert.equal(result.error, undefined);
  assert.equal(result.status, mode === 'finite' ? 7 : 0);
  const buffer = new OutputBuffer();
  buffer.beginCommand(command(mode), [command(mode)], undefined, {cwd: process.cwd()});
  buffer.write(result.stdout);
  buffer.write(result.stderr);
  const record = buffer.complete(result.status!)!;
  assert.equal(record.exitCode, result.status);
  const copy = serializeCopyPayload(record);
  assert.ok(copy.includes(mode === 'finite' ? 'FINITE-STDERR' : 'NOISY-END'));
  assert.equal(record.expanded, mode === 'finite');
  const before = JSON.stringify(buffer.transcript());
  for (const width of [12, 40, 100]) {
    const rows = buffer.wrapped(width);
    assert.ok(rows.every(row => row.plain.length <= width));
    if (mode === 'noisy') assert.ok(rows.some(row => row.isFoldHint));
  }
  assert.equal(JSON.stringify(buffer.transcript()), before);
  assert.equal(copy.includes(']8;'), false);
});

test('finite and noisy fixtures run through a real NMSh persistent shell and journal', async () => {
  const sandbox = new LiveSandbox();
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    await app.run(command('finite'), /FINITE-STDERR/);
    await app.run('echo RESULT-$?', /RESULT-7/);
    app.pty.resize(40, 20);
    await app.run(command('noisy'), /NOISY-END/);
    await app.run('echo AFTER-NOISY', /AFTER-NOISY/);
    await until(async () => (await sandbox.transcripts().list()).some(session => session.transcript.records.some(record => record.command === command('noisy'))));
    const records = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
    const finite = records.find(record => record.command === command('finite'))!;
    assert.equal(finite.exitCode, 7);
    assert.match(finite.output, /FINITE-STDOUT[\s\S]*FINITE-STDERR/u);
    const noisy = records.find(record => record.command === command('noisy'))!;
    assert.equal(noisy.output.split('building unit').length - 1, 1000);
    assert.match(noisy.output, /NOISY-END/u);
  } finally { await sandbox.dispose(); }
});

test('streaming fixture stays live across resize, terminates and restores the composer', async () => {
  const sandbox = new LiveSandbox();
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(command('streaming') + '\r');
    await app.waitFor(/STREAM-5/, mark);
    app.pty.resize(60, 24);
    await app.waitFor(/STREAM-6/, mark);
    assert.equal(app.output.slice(mark).includes('\u001b[?2004l'), false, 'streaming never owns the terminal');
    app.pty.write('\u0003');
    await app.waitFor(/STREAM-STOP/, mark);
    await app.run('echo AFTER-STREAM', /AFTER-STREAM/);
    await until(async () => (await sandbox.transcripts().list()).some(session => session.transcript.records.some(record => record.command === command('streaming'))));
    const record = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).find(record => record.command === command('streaming'))!;
    assert.equal(record.mode, 'LIVE');
    assert.equal(record.expanded, true);
    assert.equal(record.exitCode, 130);
  } finally { await sandbox.dispose(); }
});

for (const mode of ['inline', 'fullscreen', 'agent', 'nested']) test(`${mode} fixture owns raw keys, paste, mouse and resize; clean exit restores NMSh`, async () => {
  const sandbox = new LiveSandbox();
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(command(mode) + '\r');
    await app.waitFor(new RegExp(`INTERACTIVE-READY-${mode === 'nested' ? 'agent' : mode}`), mark);
    await until(() => app.output.slice(mark).includes('\u001b[?2004l'));
    app.pty.resize(72, 26);
    await app.waitFor(/INTERACTIVE-SIZE-26x72/, mark);
    app.pty.write('\u001b[200~one\ntwo\u001b[201~');
    await app.waitFor(/INTERACTIVE-PASTE-one\|two/, mark);
    app.pty.write('\u001b[<0;4;5M');
    await app.waitFor(/INTERACTIVE-MOUSE/, mark);
    app.pty.write('\u001b[97;1u');
    await app.waitFor(/INTERACTIVE-KEY/, mark);
    app.pty.write(mode === 'agent' ? '\u0003' : 'q');
    await app.waitFor(new RegExp(`INTERACTIVE-EXIT-${mode === 'agent' ? 130 : 0}`), mark);
    // Exit output precedes precmd; terminal echo can match run() before NMSh
    // has regained ownership. Wait for the restoration assertion itself.
    await until(() => {
      const output = app.output.slice(mark);
      return output.lastIndexOf('\u001b[?2004h') > output.indexOf('INTERACTIVE-EXIT');
    }, 15000, 'NMSh paste restoration');
    await app.run('echo AFTER-INTERACTIVE', /AFTER-INTERACTIVE/);
    const output = app.output.slice(mark);
    assert.ok(output.includes('\u001b[<u'), 'program keyboard push is popped');
    assert.ok(output.includes('\u001b[?1000l') && output.includes('\u001b[?1006l'));
    if (mode === 'fullscreen') assert.ok(output.includes('\u001b[?1049l'));
    assert.ok(output.lastIndexOf('\u001b[?2004h') > output.indexOf('INTERACTIVE-EXIT'), 'NMSh owns paste again');
  } finally { await sandbox.dispose(); }
});

test('canonical inline input and subsequent raw/canonical shell state are restored', async () => {
  const sandbox = new LiveSandbox();
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    await app.run('stty -g', /[0-9a-f]+:[0-9a-f]+/u);
    app.pty.write(command('canonical') + '\r');
    await app.waitFor(/CANONICAL-READY/);
    app.pty.write('answer\r');
    await app.waitFor(/CANONICAL-answer/);
    await app.run('stty -g', /[0-9a-f]+:[0-9a-f]+/u);
    await until(async () => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).filter(record => record.command === 'stty -g').length === 2);
    const modes = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).filter(record => record.command === 'stty -g');
    assert.equal(modes[1]!.output, modes[0]!.output, 'canonical fixture restores the original shell termios');
    await app.run('echo CANONICAL-RETURNED', /CANONICAL-RETURNED/);
  } finally { await sandbox.dispose(); }
});
