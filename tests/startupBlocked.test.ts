import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {ShellSession} from '../src/shell/ShellSession.js';
import {sanitizeStartupOutput, STARTUP_TAIL_CHARS, PENDING_INPUT_LIMIT} from '../src/shell/startupOutput.js';

function homeWith(zshrc: string): {home: string; done: () => void} {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-startup-'));
  writeFileSync(join(home, '.zshrc'), zshrc);
  return {home, done: () => rmSync(home, {recursive: true, force: true})};
}
const open = (home: string) => new ShellSession(home, 80, 24, home, {...process.env, HOME: home});

test('clean startup is ready immediately and keeps early input in order without loss', async () => {
  const fixture = homeWith('');
  const session = open(fixture.home);
  try {
    let output = '';
    session.on('data', data => { output += data; });
    session.submit('echo EARLY-ONE');
    session.write('echo EARLY-TWO\r');
    await once(session, 'prompt', {signal: AbortSignal.timeout(8000)});
    const deadline = Date.now() + 8000;
    while (!/EARLY-ONE[\s\S]*EARLY-TWO/u.test(output.replace(/echo EARLY-\w+/gu, '')) && Date.now() < deadline) await sleep(50);
    assert.match(output.replace(/echo EARLY-\w+/gu, ''), /EARLY-ONE[\s\S]*EARLY-TWO/u);
    assert.equal(session.startupTail(), undefined, 'no startup state once ready');
  } finally { session.kill(); fixture.done(); }
});

test('an interactive startup read is never answered by queued or typed input, and its prompt is visible', async () => {
  const fixture = homeWith('read -k1 "?Continue? [y/n] "\nprint -r -- "ANSWERED:$REPLY"\n');
  const session = open(fixture.home);
  try {
    let prompts = 0;
    session.on('prompt', () => { prompts += 1; });
    let leaked = '';
    session.on('data', data => { leaked += data; });
    const events: string[] = [];
    session.on('startup', tail => events.push(tail));
    session.submit('echo SUBMITTED');
    session.write('y');
    session.write('n');
    await sleep(1500);
    assert.equal(prompts, 0, 'startup is still blocked; nothing answered the read');
    assert.match(session.startupTail() ?? '', /Continue\? \[y\/n\]/u);
    assert.ok(events.some(tail => /Continue\? \[y\/n\]/u.test(tail)), 'startup output is announced');
    assert.doesNotMatch(leaked, /ANSWERED|SUBMITTED/u);
    const exited = once(session, 'exit', {signal: AbortSignal.timeout(8000)});
    session.kill();
    await exited;
  } finally { session.kill(); fixture.done(); }
});

test('startup output capture is bounded and carries no terminal control sequences', async () => {
  const filler = 'x'.repeat(100);
  const fixture = homeWith(`for i in {1..2000}; do print -r -- "${filler} $i"; done\nprint -n $'\\e[2J\\e[?1049h\\e]0;evil-title\\a\\e[31mred\\e[0m\\r\\x07 final-line '\nread -k1 "?Blocked> "\n`);
  const session = open(fixture.home);
  try {
    await sleep(2000);
    const tail = session.startupTail() ?? '';
    assert.ok(tail.length <= STARTUP_TAIL_CHARS, `tail ${tail.length}`);
    assert.match(tail, /final-line/u);
    assert.match(tail, /Blocked>/u);
    assert.doesNotMatch(tail, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
    assert.doesNotMatch(tail, /evil-title|\[2J|\[31m/u);
  } finally { session.kill(); fixture.done(); }
});

test('startup queue accepts exact UTF-8 boundary and explicitly rejects oversized and cumulative overflow', async () => {
  const fixture = homeWith('read -k1 "?Wait> "\n');
  const session = open(fixture.home);
  try {
    const rejected: string[] = [];
    session.on('inputRejected', data => rejected.push(data));
    const oversized = 'x'.repeat(PENDING_INPUT_LIMIT + 1);
    session.write(oversized);
    assert.deepEqual(rejected, [oversized], 'oversized input must be explicitly rejected');
    assert.equal(session.pendingInputBytes(), 0);
    session.write('界'.repeat(100));
    session.write('x'.repeat(PENDING_INPUT_LIMIT - 300));
    assert.equal(session.pendingInputBytes(), PENDING_INPUT_LIMIT);
    session.write('y');
    assert.equal(rejected.at(-1), 'y');
    assert.equal(session.pendingInputBytes(), PENDING_INPUT_LIMIT, 'accepted writes remain intact');
    session.kill();
    assert.equal(session.pendingInputBytes(), 0);
  } finally { session.kill(); fixture.done(); }
});

test('sanitized startup tail has a true UTF-8 bound without splitting code points', () => {
  const tail = sanitizeStartupOutput('界🐈'.repeat(2048));
  assert.ok(Buffer.byteLength(tail, 'utf8') <= 2048);
  assert.ok(tail.endsWith('界🐈'));
  assert.doesNotMatch(tail, /[\uD800-\uDFFF]/u);
});

test('sanitizer strips escapes and controls, normalises line ends and keeps the newest text', () => {
  assert.equal(sanitizeStartupOutput('a\u001b[2Jb\u001b]0;t\u0007c\r\nd\re\u0000f'), 'abc\nd\nef');
  assert.equal(sanitizeStartupOutput('x'.repeat(STARTUP_TAIL_CHARS * 3)).length, STARTUP_TAIL_CHARS);
  assert.equal(sanitizeStartupOutput('\u001b[31'), '');
});

import {existsSync} from 'node:fs';
import {LiveSandbox, until, processAlive, strip} from './helpers/liveFrontend.js';

const NOTICE = {NMSH_STARTUP_NOTICE_MS: '300'};
const zshrc = (sandbox: LiveSandbox, body: string) => writeFileSync(join(sandbox.home, '.zshrc'), body);

test('frontend: a blocked startup read shows an explicit state with its prompt, swallows no answer, and Ctrl+C aborts', async () => {
  const sandbox = new LiveSandbox({}, NOTICE);
  try {
    const answered = join(sandbox.home, 'answered');
    // NMSh's background zsh helpers source the same .zshrc without a terminal; only the real shell may block.
    zshrc(sandbox, `if [[ -t 0 ]]; then\n  read -k1 "?Continue? [y/n] "\n  print -r -- "$REPLY" > ${answered}\nfi\n`);
    const app = sandbox.launch();
    await app.waitFor(/Shell startup is still running/);
    await app.waitFor(/Continue\? \[y\/n\]/);
    const blockedAt = app.mark;
    await until(async () => (await sandbox.sessions()).length === 1, 15000, 'live session listed');
    const [{pid}] = await sandbox.sessions();
    app.pty.write('y');
    app.pty.write('hello\r');
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(existsSync(answered), false, 'typed input did not answer the startup prompt');
    assert.doesNotMatch(strip(app.output.slice(blockedAt)), /❯/, 'no ready-looking composer while startup is blocked');
    app.pty.write('\u0003');
    assert.equal(await app.waitExit(), 130);
    await until(async () => (await sandbox.sessions()).length === 0, 15000, 'aborted session ended');
    await until(() => !processAlive(pid), 15000, 'zsh exited');
    assert.equal(existsSync(answered), false);
    assert.match(strip(app.output), /startup aborted/);
  } finally { await sandbox.dispose(); }
});

test('frontend: slow startup shows the state, keeps typed text, then becomes an ordinary ready composer', async () => {
  const sandbox = new LiveSandbox({}, NOTICE);
  try {
    const gate = join(sandbox.home, 'gate');
    zshrc(sandbox, `while [ ! -f ${gate} ]; do sleep 0.05; done\n`);
    const app = sandbox.launch();
    await app.waitFor(/Shell startup is still running/);
    app.pty.write('echo KEPT-$((20+22))');
    app.pty.write('\r'); // held: Enter does nothing while startup is pending
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.doesNotMatch(strip(app.output), /KEPT-42/);
    writeFileSync(gate, '');
    await app.waitFor(/❯ echo KEPT-\$\(\(20\+22\)\)/, app.output.indexOf('Shell startup'));
    app.pty.write('\r');
    await app.waitFor(/KEPT-42/, app.output.indexOf('Shell startup'));
    app.pty.write('\u0004');
    await app.waitExit();
  } finally { await sandbox.dispose(); }
});

test('frontend: clean startup never shows the startup state', async () => {
  const sandbox = new LiveSandbox();
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    assert.doesNotMatch(strip(app.output), /Shell startup is still running/);
    app.pty.write('\u0004');
    await app.waitExit();
  } finally { await sandbox.dispose(); }
});

test('frontend: a command submitted early during a slow bootstrap still runs exactly once', async () => {
  const sandbox = new LiveSandbox({}, {NMSH_STARTUP_NOTICE_MS: '20000'});
  try {
    zshrc(sandbox, 'sleep 2\n');
    const app = sandbox.launch();
    await app.waitFor(/❯/); // the composer is up while the shell is still bootstrapping
    await app.run('echo EARLY-$((40+2))', /EARLY-42/);
    await app.run('echo LATER', /LATER/);
    assert.equal((strip(app.output).match(/EARLY-42/gu) ?? []).length, 1, 'the early command ran exactly once');
    app.pty.write('\u0004');
    await app.waitExit();
  } finally { await sandbox.dispose(); }
});

test('service: detach and reattach during a blocked startup keep the state, the held input and the prompt text', async () => {
  const sandbox = new LiveSandbox({}, {NMSH_STARTUP_NOTICE_MS: '1500'});
  try {
    const gate = join(sandbox.home, 'gate');
    zshrc(sandbox, `print -n "Waiting for gate> "\nwhile [ ! -f ${gate} ]; do sleep 0.05; done\n`);
    const first = sandbox.launch();
    await first.waitFor(/❯/);
    await until(async () => (await sandbox.sessions()).length === 1, 15000, 'live session listed');
    const {id, pid} = (await sandbox.sessions())[0]!;
    first.pty.write('echo HELD-$((1+1))\r'); // submitted before notice, held by service queue
    await first.waitFor(/Shell startup is still running/);
    await until(async () => (await sandbox.transcripts().list()).some(j => j.live?.running?.command === 'echo HELD-$((1+1))'), 15000, 'submission checkpoint');
    first.pty.kill('SIGHUP');
    await first.waitExit();
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
    assert.ok(processAlive(pid));
    const second = sandbox.launch(['--attach', id]);
    await second.waitFor(/Shell startup is still running/);
    await second.waitFor(/Waiting for gate>/);
    writeFileSync(gate, '');
    await second.waitFor(/HELD-2/, second.output.indexOf('Shell startup'));
    await until(async () => (await sandbox.transcripts().list()).flatMap(j => j.transcript.records).filter(r => r.command === 'echo HELD-$((1+1))').length === 1, 15000, 'held command completed exactly once');
    await second.run('echo BACK-FROM-BLOCKED', /BACK-FROM-BLOCKED/);
    assert.equal((strip(second.output).match(/HELD-2/gu) ?? []).length, 1);
    second.pty.write('\u0004');
    await second.waitExit();
    await until(async () => (await sandbox.sessions()).length === 0, 15000, 'session ended');
  } finally { await sandbox.dispose(); }
});

test('service: shutting down the shell during a blocked startup leaves no session or process behind', async () => {
  const sandbox = new LiveSandbox({}, NOTICE);
  try {
    zshrc(sandbox, '[[ -t 0 ]] && read -k1 "?Blocked> "\n');
    const app = sandbox.launch();
    await app.waitFor(/Blocked>/);
    await until(async () => (await sandbox.sessions()).length === 1, 15000, 'live session listed');
    const {pid} = (await sandbox.sessions())[0]!;
    app.pty.write('\u0003');
    await app.waitExit();
    await until(async () => (await sandbox.sessions()).length === 0, 15000, 'service session removed');
    await until(() => !processAlive(pid), 15000, 'zsh gone');
  } finally { await sandbox.dispose(); }
});

for (const command of ['less', 'vim']) {
  test(`frontend: early ${command} cannot steal ownership from SIGINT-ignoring startup`, async () => {
    const sandbox = new LiveSandbox({}, {NMSH_STARTUP_NOTICE_MS: '1500'});
    try {
      const answered = join(sandbox.home, 'answered');
      zshrc(sandbox, `if [[ -t 0 ]]; then trap '' INT; read -k1 "?Blocked> "; print "$REPLY" > ${answered}; fi\n`);
      const app = sandbox.launch();
      await app.waitFor(/❯/);
      app.pty.write(`${command}\r`);
      await app.waitFor(/Shell startup is still running/);
      assert.equal(existsSync(answered), false);
      const [{pid}] = await sandbox.sessions();
      app.pty.write('q');
      app.pty.write('\u0003');
      assert.equal(await app.waitExit(), 130);
      await until(async () => (await sandbox.sessions()).length === 0, 15000, 'aborted session removed');
      await until(() => !processAlive(pid), 15000, 'shell exited');
      assert.equal(existsSync(answered), false);
    } finally { await sandbox.dispose(); }
  });
}

import {TerminalApp} from '../src/app/TerminalApp.js';
import {InProcessSessionClient} from '../src/session/InProcessSessionClient.js';

test('frontend restores an oversized submitted command and clears awaitingExec on rejection', async () => {
  const fixture = homeWith('read -k1 "?Blocked> "\n');
  const shell = open(fixture.home);
  const client = new InProcessSessionClient({cwd: fixture.home, columns: 80, rows: 24}, () => shell);
  const app = new TerminalApp({client, mode: 'in-process'});
  Object.defineProperty(app, 'render', {value: () => {}});
  const command = 'echo ' + 'x'.repeat(65536);
  try {
    app['editor'].insert(command);
    await app['submit']();
    assert.equal(app['editor'].text, command, 'entire rejected command restored');
    assert.equal(app['running'], undefined, 'no awaitingExec deadlock');
    assert.equal(app['passthrough'], false);
    assert.equal(shell.pendingInputBytes(), 0);
    assert.match(app['output'].view().lines.map(line => line.map(cell => cell?.text ?? '').join('')).join('\n'), /Input was not sent/);
  } finally { app['stop'](0); app['session'].kill(); shell.kill(); fixture.done(); }
});
