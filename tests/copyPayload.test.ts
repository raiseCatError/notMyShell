import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {blockCopyPayload} from '../src/ui/BlockActions.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/**
 * /copy and /copy N copy the command's own output from the record's output field: never NMSh's lifecycle row
 * ("✔ Completed · 21.6s · 15:42"), folding or decoration, which are stored or drawn separately. A command whose own
 * output looks like a status line keeps it.
 */
function run(buffer: OutputBuffer, command: string, output: string, exitCode: number, lifecycle: string) {
  buffer.beginCommand(command, [`❯ ${command}`]);
  buffer.write(output);
  const record = buffer.complete(exitCode)!;
  buffer.setCompletionLifecycle(lifecycle);
  return record;
}

test('/copy: a successful command copies its output only, never the completion row', () => {
  const buffer = new OutputBuffer();
  run(buffer, 'tar -xvf a.tar', 'x one.txt\r\nx two.txt\r\n', 0, '✔ Completed · 21.6s · 15:42');
  assert.equal(buffer.recentShell(1)!.lifecycleText, '✔ Completed · 21.6s · 15:42', 'the row is still recorded for display');
  assert.equal(serializeCopyPayload(buffer.recentShell(1)!), 'x one.txt\nx two.txt');
});

test('/copy: a failed command keeps its stderr and exit code on the record, without the failure row', () => {
  const buffer = new OutputBuffer();
  const record = run(buffer, 'make', 'cc -c main.c\r\nmain.c:3: error: expected ;\r\n', 2, '✖ Failed · exit 2 · 0.4s · 15:43');
  assert.equal(record.exitCode, 2);
  assert.equal(serializeCopyPayload(record), 'cc -c main.c\nmain.c:3: error: expected ;');
});

test('/copy: multiline output keeps blank lines, indentation and inner spacing', () => {
  const buffer = new OutputBuffer();
  // A tab is cursor movement on a terminal screen; NMSh's screen model copies it as the spaces it moved over.
  const record = run(buffer, 'cat notes', 'title\r\n\r\n    indented  two  spaces\r\n\ttabbed\r\nlast\r\n', 0, '✔ Completed · 0s');
  assert.equal(serializeCopyPayload(record), 'title\n\n    indented  two  spaces\n        tabbed\nlast');
});

test('/copy: output that merely looks like a status line is the command\'s and is kept', () => {
  const buffer = new OutputBuffer();
  const record = run(buffer, 'printf', 'step 1\r\n✔ Completed · 21.6s · 15:42\r\nCompleted · 7 ms\r\n', 0, '✔ Completed · 0.1s · 15:44');
  assert.equal(serializeCopyPayload(record), 'step 1\n✔ Completed · 21.6s · 15:42\nCompleted · 7 ms');
});

test('/copy N and block actions agree; folded output and long transcripts copy in full, also after restore', () => {
  const buffer = new OutputBuffer();
  const long = Array.from({length: 400}, (_, index) => `line ${index + 1}`).join('\r\n') + '\r\n';
  const folded = run(buffer, 'seq 400', long, 0, '✔ Completed · 1.2s');
  for (let index = 0; index < 60; index++) run(buffer, `echo ${index}`, `out ${index}\r\n`, 0, `✔ Completed · ${index}ms`);
  assert.equal(folded.expanded, false, 'the long output is folded on screen');
  const expected = Array.from({length: 400}, (_, index) => `line ${index + 1}`).join('\n');
  assert.equal(serializeCopyPayload(buffer.recentShell(61)!), expected, 'a folded block copies every line');
  assert.equal(serializeCopyPayload(buffer.recentShell(1)!), 'out 59');
  assert.equal(serializeCopyPayload(buffer.recentShell(2)!), 'out 58');
  assert.equal(blockCopyPayload(buffer.recentShell(1)!, 'copyOutput'), serializeCopyPayload(buffer.recentShell(1)!), 'Copy output and /copy share one source');
  const restored = new OutputBuffer();
  restored.restoreTranscript(buffer.transcript());
  assert.equal(serializeCopyPayload(restored.recentShell(61)!), expected);
  assert.equal(serializeCopyPayload(restored.recentShell(1)!), 'out 59');
});

test('live: /copy and /copy N put exactly the command output on the clipboard, through the real composer', {timeout: 90_000}, async () => {
  // A stand-in pbcopy/xclip first on PATH records what NMSh copies; the person's clipboard is never touched.
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'}, {});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const clip = join(sandbox.root, 'clipboard.txt');
  for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ncat > ${JSON.stringify(clip)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const copied = async (command: string) => {
    if (existsSync(clip)) writeFileSync(clip, '');
    frontend.pty.write(`${command}\r`);
    await until(() => existsSync(clip) && readFileSync(clip, 'utf8').length > 0, 15_000, `the clipboard after ${command}`);
    return readFileSync(clip, 'utf8');
  };
  // Linux picks a tool only with a display: a placeholder DISPLAY selects the stand-in xclip (CI has no display).
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await until(() => existsSync(join(sandbox.config, 'nmsh', 'theme-bridge')) || frontend.output.length > 2000, 20_000, 'startup');
    await frontend.run('echo READY', /READY/u);
    await frontend.run(`printf 'alpha\\n\\n  beta  gamma\\n✔ Completed · 21.6s · 15:42\\n'`, /beta {2}gamma/u);
    await frontend.run(`sh -c 'echo to-stderr >&2; exit 3'`, /to-stderr/u);
    assert.equal(await copied('/copy'), 'to-stderr');
    assert.equal(await copied('/copy 2'), 'alpha\n\n  beta  gamma\n✔ Completed · 21.6s · 15:42', 'the look-alike line is the command\'s own');
    assert.doesNotMatch(await copied('/copy 3'), /Completed/u, 'echo READY copies as READY alone');
    // A silent command: nothing is copied and the clipboard keeps what it held.
    await frontend.run('true', /❯/u);
    writeFileSync(clip, 'KEEP');
    const mark = frontend.mark;
    frontend.pty.write('/copy\r');
    // A brief note above the composer, never a transcript line.
    await frontend.waitFor(/Nothing to copy: true printed no output; the clipboard is unchanged/u, mark);
    assert.equal(readFileSync(clip, 'utf8'), 'KEEP');
  } finally { await sandbox.dispose(); }
});

test('NMSh lines added while a command runs are shown in its block but are never its output or its /copy payload', () => {
  const output = new OutputBuffer();
  output.beginCommand('true', ['❯ true']);
  // A /copy that finished while the next command had already started, then an Ask aside.
  output.addFrontendInteraction('/copy 3', 'Copied response 3 to clipboard · 5 characters · 1 line');
  output.addAskInteraction('what is this', [{role: 'ask', text: 'an aside'}]);
  const silent = output.complete(0)!;
  assert.equal(silent.output, '', 'true printed nothing');
  assert.ok(output.wrapped(80).some(row => row.plain.includes('Copied response 3')), 'the confirmation stays where it was shown');

  output.beginCommand('printf', ['❯ printf']);
  output.write('one\r\n');
  output.addFrontendInteraction('/notices', 'Nothing new.');
  output.write('two\r\n');
  const record = output.complete(0)!;
  assert.equal(serializeCopyPayload(record), 'one\ntwo');

  const restored = new OutputBuffer();
  restored.restoreTranscript(output.transcript());
  assert.deepEqual(restored.view().completed.map(item => item.command), ['printf', 'true'], 'both records survive a restore');
});
