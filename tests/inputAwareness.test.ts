import assert from 'node:assert/strict';
import test from 'node:test';
import {OpenLine, promptShaped, promptText} from '../src/session/openLine.js';
import {parseCpuTime, parseForeground, parseStty, parseSyscall, type TerminalSample} from '../src/session/terminalProbe.js';
import {InputWatch} from '../src/session/InputWatch.js';
import {directInput, waitedSoFar, type InputState} from '../src/session/inputState.js';
import {decodeMessage, encodeMessage, inputStateFrom, inputStateMessage, parseClientFeatures, parseFeatures, type SessionInfo} from '../src/session/SessionProtocol.js';
import {describeNotice, noticeVisibleMs, SessionNoticeTracker} from '../src/session/SessionNotices.js';
import {liveStatusParts} from '../src/session/liveStatus.js';
import {LIVE_ROW_LABELS, liveRowState} from '../src/sessions/ResumeBrowser.js';
import {directKeyBytes} from '../src/terminal/keyBytes.js';
import {completionWaitFact, inputActivityRows, inputComposerHint, waitedDetail} from '../src/status/inputStatus.js';
import {foreground, UI_COLORS} from '../src/ui/palette.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(patch).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(patch)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { return run(); } finally {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

// ------------------------------------------------------------------ open line

test('a shell reader owns input until the command returns, without claiming a wait', () => {
  const watch = new InputWatch();
  watch.onExec('read -s -P Password: value', 10);
  watch.onReader();
  assert.equal(watch.ownsTerminal, true);
  assert.equal(watch.state.terminalOwner, true);
  assert.equal(watch.state.request, undefined);
  const decoded = decodeMessage(encodeMessage(inputStateMessage(watch.state)).trimEnd());
  assert.ok(decoded.ok);
  assert.deepEqual(inputStateFrom(decoded.message as ReturnType<typeof inputStateMessage>), watch.state);
  watch.onPrompt(20);
  assert.equal(watch.state.terminalOwner, undefined);
  watch.onExec('sleep 1', 30);
  assert.equal(watch.ownsTerminal, false);
  watch.dispose();
});

test('open line: a prompt left without a newline is open; a finished line, a rewrite or cursor drawing is not', () => {
  const line = new OpenLine();
  line.push('Pass 1: Checking inodes\r\nPadding at end of inode bitmap is not set. Fix<y>? ');
  assert.equal(line.line, 'Padding at end of inode bitmap is not set. Fix<y>? ');
  assert.equal(line.open, true);
  line.push('yes\r\n\r\n');
  assert.equal(line.open, false, 'the echoed answer ends the line');

  line.push('[=====>      ] 45%');
  line.push('\r[=======>    ] 61%');
  assert.equal(line.open, false, 'a carriage-return progress bar rewrites its line');
  line.push('\r\n');
  line.push('\u001b[2K\u001b[1Gstatus: building');
  assert.equal(line.open, false, 'a line drawn with cursor addressing is not prompt evidence');
  line.push('\n');
  line.push('\u001b[32mContinue?\u001b[0m [y/N] ');
  assert.equal(line.line, 'Continue? [y/N] ', 'colors are not text');
  assert.equal(line.open, true);
});

test('open line: escape sequences and CRLF split across reads; backspace edits; OSC titles are not text', () => {
  const line = new OpenLine();
  line.push('Name: \u001b');
  line.push(']0;my title\u0007');
  assert.equal(line.line, 'Name: ');
  line.push('ab\b');
  assert.equal(line.line, 'Name: a');
  line.push('\r');
  assert.equal(line.line, '', 'a lone carriage return may be a rewrite or the start of CRLF');
  line.push('\n');
  assert.equal(line.open, false);
  assert.equal(line.unreliable, false, 'CRLF split across reads is a newline, not a rewrite');
});

test('prompt shape: question and entry endings count; statuses and ellipses do not', () => {
  for (const prompt of ['Fix<y>? ', 'Password:', 'Continue? [Y/n] ', 'Overwrite (yes/no)', '>>> ', 'Choose 1-3 »']) assert.equal(promptShaped(prompt), true, prompt);
  for (const status of ['Downloading...', 'Compiling crate…', 'building 45%', '']) assert.equal(promptShaped(status), false, status);
  assert.equal(promptText('  Fix<y>?  '), 'Fix<y>?');
  assert.equal(promptText('\u0007'), undefined);
  assert.equal(promptText('x'.repeat(300))!.length, 120);
});

// ------------------------------------------------------------------ probe parsers

test('stty: BSD and GNU layouts; flags are whole words', () => {
  const bsd = 'speed 9600 baud; 24 rows; 80 columns;\nlflags: -icanon isig iexten -echo echoe echok echoke -echonl echoctl\n';
  assert.deepEqual(parseStty(bsd), {canonical: false, echo: false, signals: true});
  const gnu = 'speed 38400 baud; rows 24; columns 80; line = 0;\n-ignbrk -brkint\nisig icanon iexten -echo echoe echok -echonl -noflsh\n';
  assert.deepEqual(parseStty(gnu), {canonical: true, echo: false, signals: true});
  assert.equal(parseStty('lflags: echoe echok'), undefined, 'echoe is not echo');
});

test('ps: only the terminal\'s foreground group; CPU time in both formats', () => {
  const ps = ' 4101  4101  4120 Ss    0:00.21 /bin/zsh\n 4120  4120  4120 S+    0:01.50 /opt/homebrew/sbin/e2fsck\n 4122  4121  4120 S     0:00.00 helper\n';
  assert.deepEqual(parseForeground(ps), [{pid: 4120, state: 'S+', cpuMs: 1500, command: 'e2fsck'}]);
  assert.equal(parseCpuTime('1-02:03:04'), ((26 * 60 + 3) * 60 + 4) * 1000);
  assert.equal(parseCpuTime('00:00:07'), 7000);
  assert.equal(parseCpuTime('bad'), undefined);
});

test('Linux syscall report: a read of a descriptor, a poll/select wait, something else, or running', () => {
  assert.deepEqual(parseSyscall('0 0x0 0x7ffd 0x1 0x0 0x0 0x0 0x7ffd 0x7f', 'x64'), {kind: 'read', fd: 0});
  assert.deepEqual(parseSyscall('63 0x3 0xffff 0x1 0 0 0 0xff 0xff', 'arm64'), {kind: 'read', fd: 3});
  assert.deepEqual(parseSyscall('7 0x7ffd 0x1 0xffffffff 0 0 0 0x1 0x2', 'x64'), {kind: 'wait'});
  assert.deepEqual(parseSyscall('230 0x0 0x0 0x7ffd 0 0 0 0x1 0x2', 'x64'), {kind: 'other'}, 'clock_nanosleep: sleeping, not reading');
  // A timed read (zsh `read -t`, bash `read -t`) waits in select/pselect6/ppoll: a wait, never a confirmed read.
  for (const nr of [23, 270, 271]) assert.deepEqual(parseSyscall(`${nr} 0x1 0x7ffd 0x0 0x0 0x7ffd 0x0 0x1 0x2`, 'x64'), {kind: 'wait'});
  assert.deepEqual(parseSyscall('73 0x7ffd 0x1 0x7ffd 0x0 0x8 0x0 0x1 0x2', 'arm64'), {kind: 'wait'}, 'ppoll');
  assert.equal(parseSyscall('running', 'x64'), undefined);
  assert.equal(parseSyscall('-1 0x7ffd 0x1', 'x64'), undefined);
});

// ------------------------------------------------------------------ the watch

/** A watch driven by hand: a clock, a timer queue and a probe answering with whatever the test sets. */
function harness(command = 'e2fsck -f disk.img') {
  let now = 1_000_000;
  const timers: Array<{at: number; run: () => void}> = [];
  let sample: TerminalSample | undefined = {foreground: []};
  const changes: InputState[] = [];
  const watch = new InputWatch({probe: async () => sample, tty: () => '/dev/ttys999', now: () => now,
    setTimer: (run, ms) => { const timer = {at: now + ms, run}; timers.push(timer); return () => { timers.splice(timers.indexOf(timer), 1); }; }});
  watch.on('change', state => changes.push(state));
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift();
      now = next.at;
      next.run();
      // The probe resolves on a microtask.
      for (let index = 0; index < 5; index++) await Promise.resolve();
    }
    now = until;
  };
  watch.onExec(command, now);
  return {watch, changes, advance, set: (next: TerminalSample | undefined) => { sample = next; }, at: () => now, setNow: (value: number) => { now = value; }};
}

const fg = (state = 'S+', cpuMs = 100, command = 'e2fsck') => [{pid: 4120, state, cpuMs, command}];
const keyModes = {canonical: false, echo: false, signals: true};
const lineModes = {canonical: true, echo: true, signals: true};
const hiddenModes = {canonical: true, echo: false, signals: true};

test('watch: single-key input with a prompt left open is confirmed at once, from when the prompt was written', async () => {
  const h = harness();
  h.watch.onOutput('Pass 1\r\nPadding at end of inode bitmap is not set. Fix<y>? ', h.at());
  const written = h.at();
  h.set({modes: keyModes, foreground: fg()});
  await h.advance(200);
  const request = h.watch.state.request!;
  assert.equal(request.confidence, 'confirmed');
  assert.equal(request.mode, 'key');
  assert.equal(request.prompt, 'Padding at end of inode bitmap is not set. Fix<y>?');
  assert.equal(request.program, 'e2fsck');
  assert.equal(request.since, written);
  assert.equal(directInput(request), true, 'keys go straight to the program');
  // One key answers; the wait is closed at that moment.
  await h.advance(17_800);
  h.watch.onInput('y', h.at());
  assert.equal(h.watch.state.request, undefined);
  assert.equal(h.watch.state.timing.waitedMs, 18_000);
  assert.equal(h.watch.state.timing.waits, 1);
});

test('watch: raw mode with no prompt left (a quiet docker -it server, a spinner between frames) is never a request', async () => {
  const h = harness('docker run -it image');
  h.watch.onOutput('listening on :8080\r\n', h.at());
  h.set({modes: {canonical: false, echo: false, signals: false}, foreground: fg('S+', 100, 'docker')});
  await h.advance(30_000);
  assert.equal(h.watch.state.request, undefined);
});

test('watch: a hidden line (echo off, line input on) is confirmed even with no prompt text', async () => {
  const h = harness('read -s secret');
  h.set({modes: hiddenModes, foreground: fg('Ss+', 10, 'zsh')});
  await h.advance(500);
  assert.equal(h.watch.state.request?.mode, 'hidden');
  assert.equal(h.watch.state.request?.confidence, 'confirmed');
  // Typing inside a hidden line does not end the wait; Enter does.
  h.watch.onInput('hunter', h.at());
  assert.ok(h.watch.state.request, 'still waiting while the line is typed');
  h.watch.onInput('2\r', h.at());
  assert.equal(h.watch.state.request, undefined);
});

test('watch: ordinary line input is only "likely", and only after the group is seen idle twice with a question open', async () => {
  const h = harness('rm -i notes.txt');
  h.watch.onOutput('remove notes.txt? ', h.at());
  h.set({modes: lineModes, foreground: fg('S+', 100, 'rm')});
  await h.advance(200);
  assert.equal(h.watch.state.request, undefined, 'one sample cannot tell idle from busy');
  await h.advance(1000);
  assert.equal(h.watch.state.request?.confidence, 'likely');
  assert.equal(h.watch.state.request?.mode, 'line');
  assert.equal(directInput(h.watch.state.request), false, 'a likely request keeps the composer\'s line editor');
  // Enter submits the line and ends the wait.
  h.watch.onInput('y\r', h.at());
  assert.equal(h.watch.state.request, undefined);
});

/** The shell itself in the terminal's foreground group: the session leader (ps state `s`) runs a builtin. */
const shellFg = (state = 'Ss+', cpuMs = 10) => [{pid: 4000, state, cpuMs, command: 'zsh'}];

test('watch: the shell holding the terminal with line input off (read -k 1, read -n 1, no prompt) reads keys: confirmed at once', async () => {
  const h = harness('read -k 1 x; echo got:$x');
  h.set({modes: keyModes, foreground: shellFg()});
  await h.advance(450);
  assert.equal(h.watch.state.request?.confidence, 'confirmed');
  assert.equal(h.watch.state.request?.mode, 'key');
  assert.equal(directInput(h.watch.state.request), true);
  // The same line settings with another program in the foreground and no prompt stay what they were: not a request.
  const other = harness('docker run -it image');
  other.set({modes: keyModes, foreground: fg('S+', 100, 'docker')});
  await other.advance(30_000);
  assert.equal(other.watch.state.request, undefined);
});

test('watch: the shell holding the terminal with line input (read -r reply, no prompt) is likely after two idle samples, the second soon after', async () => {
  const h = harness("read -r QA_REPLY; printf 'ANSWER=%s\\n' \"$QA_REPLY\"");
  h.set({modes: lineModes, foreground: shellFg()});
  await h.advance(450);
  assert.equal(h.watch.state.request, undefined, 'one sample cannot tell a read from a loop between commands');
  await h.advance(120);
  assert.equal(h.watch.state.request?.confidence, 'likely');
  assert.equal(h.watch.state.request?.mode, 'line');
  assert.equal(directInput(h.watch.state.request), false, 'a line read keeps the composer\'s editor; Enter sends it');
  h.watch.onInput('hello\r', h.at());
  assert.equal(h.watch.state.request, undefined, 'the answer ends the wait');
});

test('watch: a loop\'s shell between commands, or a shell computing, is not a request', async () => {
  // The follow-up sample sees the loop's next command in the foreground.
  const loop = harness('for i in 1 2 3; do sleep 1; done');
  loop.set({modes: lineModes, foreground: shellFg()});
  await loop.advance(450);
  loop.set({modes: lineModes, foreground: fg('S+', 1, 'sleep')});
  await loop.advance(30_000);
  assert.equal(loop.watch.state.request, undefined);
  assert.ok(loop.changes.every(state => !state.request), 'never reported, not even for a moment');
  // A builtin loop computing in the shell: on a CPU, or using it across samples.
  const busy = harness('while :; do :; done');
  let cpu = 10;
  for (let index = 0; index < 20; index++) {
    cpu += 400;
    busy.set({modes: lineModes, foreground: shellFg(index % 2 ? 'Rs+' : 'Ss+', cpu)});
    await busy.advance(500);
  }
  assert.equal(busy.watch.state.request, undefined);
});

test('watch: lookNow samples at once, outside the backed-off schedule; nothing running means nothing to look at', async () => {
  const h = harness('sleep 70; read -k 1 x');
  h.set({modes: lineModes, foreground: fg('S+', 1, 'sleep')});
  // Long quiet: the schedule has backed off to one look every ten seconds.
  await h.advance(90_000);
  h.set({modes: keyModes, foreground: shellFg()});
  let probes = 0;
  const looked = h.watch.lookNow().then(() => { probes += 1; });
  for (let index = 0; index < 5; index++) await Promise.resolve();
  await looked;
  assert.equal(probes, 1);
  assert.equal(h.watch.state.request?.mode, 'key', 'seen at once, not at the next scheduled look');
  // A line read needs its second sample: lookNow takes it after the short follow-up.
  const line = harness('sleep 70; read reply');
  line.set({modes: lineModes, foreground: fg('S+', 1, 'sleep')});
  await line.advance(90_000);
  line.set({modes: lineModes, foreground: shellFg()});
  const second = line.watch.lookNow();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  await line.advance(100);
  await second;
  assert.equal(line.watch.state.request?.confidence, 'likely');
  // At the prompt there is no command: lookNow returns without a sample.
  line.watch.onPrompt(line.at());
  await line.watch.lookNow();
  assert.equal(line.watch.state.request, undefined);
});

test('watch (#426): a first sample that catches the shell still on a CPU is not proof it computes; the follow-up decides', async () => {
  // A loaded machine: the shell wrote its exec marker and is about to block in `read`, but is still runnable when the
  // first look samples it. With nothing earlier to compare, one sample cannot say it computes.
  const h = harness("read -r QA_REPLY; printf 'ANSWER=%s\\n' \"$QA_REPLY\"");
  h.set({modes: lineModes, foreground: shellFg('Rs+', 10)});
  const looked = h.watch.lookNow();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  h.set({modes: lineModes, foreground: shellFg('Ss+', 10)});
  await h.advance(100);
  await looked;
  assert.equal(h.watch.state.request?.confidence, 'likely', 'blocked and idle in the follow-up: a line read');
  assert.equal(h.watch.state.request?.mode, 'line');

  // The same with line input off (`read -k 1`): confirmed key input once the follow-up sees it blocked.
  const key = harness('read -k 1 x; echo got:$x');
  key.set({modes: keyModes, foreground: shellFg('Rs+', 10)});
  const keyLooked = key.watch.lookNow();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  key.set({modes: keyModes, foreground: shellFg('Ss+', 10)});
  await key.advance(100);
  await keyLooked;
  assert.equal(key.watch.state.request?.mode, 'key');
  assert.equal(key.watch.state.request?.confidence, 'confirmed');

  // A shell that is computing stays not waiting: on a CPU in both samples, and using it in between.
  const busy = harness('while :; do :; done');
  busy.set({modes: lineModes, foreground: shellFg('Rs+', 10)});
  const busyLooked = busy.watch.lookNow();
  for (let index = 0; index < 5; index++) await Promise.resolve();
  busy.set({modes: lineModes, foreground: shellFg('Rs+', 90)});
  await busy.advance(100);
  await busyLooked;
  assert.equal(busy.watch.state.request, undefined);
  assert.ok(busy.changes.every(state => !state.request), 'never reported, not even for a moment');

  // Another program on a CPU with no prompt and ordinary line settings: still nothing, and the look ends after its one
  // sample (it settles without the follow-up timer running).
  const other = harness('make');
  other.set({modes: lineModes, foreground: fg('R+', 10, 'make')});
  let otherDone = false;
  const otherLooked = other.watch.lookNow().then(() => { otherDone = true; });
  await new Promise(done => setImmediate(done));
  assert.equal(otherDone, true, 'no follow-up was asked for');
  await otherLooked;
  assert.equal(other.watch.state.request, undefined);
});

test('watch: no false positives for builds, sleep, network waits, progress bars, statuses or log streams', async () => {
  // A build that printed a colon-ended status and is computing.
  const build = harness('make');
  build.watch.onOutput('Linking target:', build.at());
  let cpu = 0;
  for (let index = 0; index < 10; index++) {
    cpu += 900;
    build.set({modes: lineModes, foreground: fg('S+', cpu, 'ld')});
    await build.advance(1000);
  }
  assert.equal(build.watch.state.request, undefined, 'busy CPU across samples');
  const running = harness('cargo build');
  running.watch.onOutput('Compiling serde:', running.at());
  running.set({modes: lineModes, foreground: fg('R+', 100, 'rustc')});
  await running.advance(10_000);
  assert.equal(running.watch.state.request, undefined, 'a process on a CPU is not waiting');
  // sleep and a network wait: idle, but no question was left open.
  for (const [command, output] of [['sleep 600', ''], ['curl https://example.com', '  % Total    % Received\r\n'], ['tail -f log', 'GET /index 200\r\n']]) {
    const quiet = harness(command!);
    if (output) quiet.watch.onOutput(output, quiet.at());
    quiet.set({modes: lineModes, foreground: fg('S+', 5, 'x')});
    await quiet.advance(60_000);
    assert.equal(quiet.watch.state.request, undefined, command);
  }
  // A stalled progress bar and a status line left open.
  const stalled = harness('npm install');
  stalled.watch.onOutput('[====>     ] 45%', stalled.at());
  stalled.watch.onOutput('\r[=====>    ] 47%:', stalled.at());
  stalled.set({modes: lineModes, foreground: fg('S+', 5, 'node')});
  await stalled.advance(30_000);
  assert.equal(stalled.watch.state.request, undefined, 'a rewritten line is not a question');
  const status = harness('fetch');
  status.watch.onOutput('Downloading...', status.at());
  status.set({modes: lineModes, foreground: fg('S+', 5, 'fetch')});
  await status.advance(30_000);
  assert.equal(status.watch.state.request, undefined, 'an ellipsis is a status');
});

test('watch: programs that own the terminal (full screen, bracketed paste, known full-screen commands) are never reported', async () => {
  for (const [command, output] of [['htop', '\u001b[?1049hsomething?'], ['python3', '\u001b[?2004h>>> '], ['vim notes', 'Swap file exists. [O]pen? ']]) {
    const h = harness(command!);
    h.watch.onOutput(output!, h.at());
    h.set({modes: keyModes, foreground: fg('S+', 5, 'x')});
    await h.advance(5000);
    assert.equal(h.watch.state.request, undefined, command);
    assert.equal(h.watch.ownsTerminal, true, command);
  }
});

test('watch: the kernel\'s report decides when it exists (Linux): reading confirms, blocked elsewhere vetoes', async () => {
  const reading = harness('./menu.sh');
  reading.watch.onOutput('1) start\r\n2) stop\r\nChoice:\r\n', reading.at());
  reading.set({modes: lineModes, foreground: fg('S+', 5, 'bash'), readingTerminal: true});
  await reading.advance(500);
  assert.equal(reading.watch.state.request?.confidence, 'confirmed', 'a prompt that ended with a newline is still a read');
  assert.equal(reading.watch.state.request?.mode, 'line');
  const elsewhere = harness('ssh-keygen');
  elsewhere.watch.onOutput('Enter passphrase: ', elsewhere.at());
  elsewhere.set({modes: hiddenModes, foreground: fg('S+', 5, 'ssh-keygen'), readingTerminal: false});
  await elsewhere.advance(5000);
  assert.equal(elsewhere.watch.state.request, undefined);
});

test('watch: several questions in one command accumulate waiting time; completion closes an open wait', async () => {
  const h = harness();
  h.set({modes: keyModes, foreground: fg()});
  h.watch.onOutput('Fix one<y>? ', h.at());
  await h.advance(2000);
  h.watch.onInput('y', h.at());
  h.watch.onOutput('yes\r\n\r\nFix two<y>? ', h.at());
  await h.advance(3000);
  assert.equal(h.watch.state.request?.prompt, 'Fix two<y>?');
  assert.equal(waitedSoFar(h.watch.state, h.at()), 5000);
  h.watch.onPrompt(h.at());
  assert.deepEqual(h.watch.state.timing, {waitedMs: 5000, waits: 2});
  assert.equal(h.watch.state.request, undefined);
  // Ctrl+C ends a wait as an answer does.
  const interrupted = harness('read x');
  interrupted.set({modes: hiddenModes, foreground: fg('S+', 5, 'zsh')});
  await interrupted.advance(600);
  interrupted.watch.onInput('\u0003', interrupted.at());
  assert.equal(interrupted.watch.state.request, undefined);
});

test('watch: output after the prompt ends the wait; a probe begun before newer output is discarded', async () => {
  const h = harness('slow');
  h.watch.onOutput('Continue? [y/N] ', h.at());
  let resolve!: (sample: TerminalSample) => void;
  const pending = new Promise<TerminalSample>(done => { resolve = done; });
  const watch = new InputWatch({probe: () => pending, tty: () => '/dev/ttys1', now: () => h.at(),
    setTimer: (run, ms) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer); }});
  watch.onExec('slow', h.at());
  watch.onOutput('Continue? [y/N] ', h.at());
  await new Promise(done => setTimeout(done, 200));
  watch.onOutput('\r\nmoving on\r\n', h.at());
  resolve({modes: keyModes, foreground: fg()});
  await new Promise(done => setTimeout(done, 10));
  assert.equal(watch.state.request, undefined, 'the sample described the terminal before the newer output');
  watch.dispose();
  // An established wait ends when the program writes again.
  h.set({modes: keyModes, foreground: fg()});
  await h.advance(200);
  assert.ok(h.watch.state.request);
  h.watch.onOutput('Timed out, assuming no\r\n', h.at() + 1000);
  assert.equal(h.watch.state.request, undefined);
  assert.equal(h.watch.state.timing.waits, 1);
});

test('watch: evidence that disappears without input or output (a timed-out read) ends the wait at that look', async () => {
  const h = harness('read -t 5 -k1');
  h.watch.onOutput('Key? ', h.at());
  h.set({modes: keyModes, foreground: fg('S+', 5, 'zsh')});
  await h.advance(200);
  assert.ok(h.watch.state.request);
  h.set({modes: lineModes, foreground: [{pid: 9, state: 'S+', cpuMs: 5, command: 'sleep'}]});
  await h.advance(1000);
  // Line input with a question still open and an idle group is the likely rule, not the old confirmed one.
  assert.notEqual(h.watch.state.request?.confidence, 'confirmed');
});

test('watch: a prompt whose evidence lapses for a moment (a resize waking the program) is one prompt, its time counted once', async () => {
  const h = harness('python3 askyn.py');
  const asked = h.at();
  h.watch.onOutput('First question. Fix<y>? ', asked);
  h.set({modes: keyModes, foreground: fg('S+', 10, 'python3')});
  await h.advance(5000);
  assert.equal(h.watch.state.request?.since, asked);
  // Reattaching resizes the PTY: the program wakes for SIGWINCH and one look sees it running.
  h.set({modes: keyModes, foreground: fg('R+', 40, 'python3')});
  await h.advance(3000);
  assert.equal(h.watch.state.request, undefined);
  assert.ok(h.watch.state.timing.waitedMs > 0, 'closing counted the time so far');
  h.set({modes: keyModes, foreground: fg('S+', 40, 'python3')});
  await h.advance(3000);
  const reopened = h.watch.state.request;
  assert.ok(reopened);
  assert.equal(reopened.since, asked, 'the same prompt: it keeps its own start (what other windows and /sessions show)');
  assert.equal(h.watch.state.timing.waitedMs, 0, 'resuming took that back: the open wait counts it once, when it ends');
  h.watch.onInput('y', h.at());
  h.watch.onOutput('yes\r\nSecond question. Fix<y>? ', h.at());
  h.set({modes: keyModes, foreground: fg('S+', 41, 'python3')});
  await h.advance(300);
  h.watch.onInput('n', h.at());
  const elapsed = h.at() - asked;
  const {waitedMs, waits} = h.watch.state.timing;
  assert.equal(waits, 2, 'two questions, two prompts');
  assert.ok(waitedMs <= elapsed, `waiting (${waitedMs} ms) never exceeds the time since the first question (${elapsed} ms)`);
});

// ------------------------------------------------------------------ protocol, notices, surfaces

test('protocol: input-state round-trips; unknown values are dropped, never guessed; hello features gate new values', () => {
  const state: InputState = {request: {since: 5, confidence: 'confirmed', mode: 'hidden', prompt: 'Password:', program: 'sudo'}, timing: {waitedMs: 1200.4, waits: 1}};
  const decoded = decodeMessage(encodeMessage(inputStateMessage(state)).trimEnd());
  assert.ok(decoded.ok);
  assert.deepEqual(inputStateFrom(decoded.message as never), {request: state.request, timing: {waitedMs: 1200, waits: 1}});
  assert.deepEqual(inputStateFrom({type: 'input-state', since: 5, confidence: 'certain', mode: 'line', waitedMs: 0, waits: 0}), {timing: {waitedMs: 0, waits: 0}});
  const hello = decodeMessage(encodeMessage({type: 'hello', version: 2, client: 'nmsh', features: 'input-state,future'}).trimEnd());
  assert.ok(hello.ok && hello.message.type === 'hello');
  assert.deepEqual([...parseClientFeatures((hello.message as {features?: string}).features)], ['input-state']);
  assert.deepEqual([...parseClientFeatures(undefined)], [], 'an older frontend says nothing and gets nothing new');
  // On-demand looks: a numbered request and its answer; only between peers that both listed 'input-look'.
  for (const message of [{type: 'input-look', id: 7}, {type: 'input-looked', id: 7}] as const) {
    const look = decodeMessage(encodeMessage(message).trimEnd());
    assert.ok(look.ok);
    assert.deepEqual(look.message, message);
  }
  assert.equal(decodeMessage(encodeMessage({type: 'input-look', id: 'x'} as never).trimEnd()).ok, false);
  assert.deepEqual([...parseClientFeatures('input-state,input-look')], ['input-state', 'input-look']);
  assert.ok(parseFeatures('queue,input-look').has('input-look'));
  assert.equal(parseFeatures('queue').has('input-look'), false, 'an older service is never asked to look');
  const prompt = decodeMessage(encodeMessage({type: 'prompt', exitCode: 0, cwd: '/', seq: 1, at: 2, inputWaitMs: 18000, inputWaits: 2}).trimEnd());
  assert.ok(prompt.ok && prompt.message.type === 'prompt' && (prompt.message as {inputWaitMs?: number}).inputWaitMs === 18000);
});

test('notices: one sticky input notice per wait, withdrawn when answered, worded by confidence', () => {
  const tracker = new SessionNoticeTracker('s1');
  tracker.onExec('e2fsck -f disk.img', 100);
  tracker.onInputNeeded(200, 'confirmed', 'e2fsck');
  const notice = tracker.notice!;
  assert.equal(notice.kind, 'input');
  assert.equal(noticeVisibleMs(notice), undefined, 'sticky until answered or focused');
  assert.match(describeNotice(notice, 'Mango', 60_200).text, /^Mango · e2fsck is waiting for input · 1m · \/resume$/u);
  tracker.onInputNeeded(200, 'confirmed');
  assert.equal(tracker.notice, notice, 'the same wait is never raised twice');
  tracker.onInputResolved();
  assert.equal(tracker.notice, undefined);
  tracker.onInputNeeded(300, 'likely');
  assert.match(describeNotice(tracker.notice!, 'Mango', 400).text, /may be waiting for input/u);
  tracker.clear(500);
  tracker.onInputNeeded(450, 'confirmed');
  assert.equal(tracker.notice, undefined, 'a wait someone already saw by focusing the session is not news');
});

test('/sessions and /resume read the service\'s state; nothing is re-guessed from quiet output', () => {
  const base: SessionInfo = {id: 'a', pid: 1, state: 'detached', cwd: '/tmp', createdAt: 0, running: 'e2fsck -f disk.img', runningSince: 0, lastOutputAt: 0};
  const waiting = {...base, inputSince: 10_000, inputConfidence: 'confirmed', inputMode: 'key', inputPrompt: 'Fix<y>?'};
  assert.equal(liveRowState(waiting, 70_000), 'input');
  assert.equal(LIVE_ROW_LABELS.input, 'Waiting for input');
  assert.equal(liveRowState({...waiting, inputConfidence: 'likely'}, 70_000), 'inputLikely');
  assert.match(liveStatusParts(waiting, 70_000).join(' · '), /waiting for input 1m · “Fix<y>\?”/u);
  assert.match(liveStatusParts(base, 70_000).join(' · '), /quiet/u, 'quiet output alone stays "quiet"');
  assert.equal(liveRowState(base, 70_000), 'running');
});

test('direct keys: the bytes a plain terminal sends; NMSh gestures and pointer events send nothing', () => {
  assert.equal(directKeyBytes({kind: 'text', value: 'y'}), 'y');
  assert.equal(directKeyBytes({kind: 'enter'}), '\r');
  assert.equal(directKeyBytes({kind: 'backspace'}), '\u007f');
  assert.equal(directKeyBytes({kind: 'deleteLineBefore'}), '\u0015');
  assert.equal(directKeyBytes({kind: 'up'}), '\u001b[A');
  assert.equal(directKeyBytes({kind: 'paste', value: 'secret'}), 'secret');
  for (const kind of ['selectAll', 'historySearch', 'palette', 'mouseClick', 'focusIn', 'toggleDetails'] as const) assert.equal(directKeyBytes({kind} as never), undefined, kind);
});

test('presentation: distinct from Running in words and glyphs; fits narrow widths; NO_COLOR and Safe glyphs keep it legible', () => {
  const state = {request: {since: 82_000, confidence: 'confirmed' as const, mode: 'key' as const, prompt: 'Padding at end of inode bitmap is not set. Fix<y>?', program: 'e2fsck'},
    timing: {waitedMs: 0, waits: 0}};
  withEnv({NO_COLOR: undefined, NMSH_ICONS: undefined, TERM: 'xterm-256color'}, () => {
    const [first, second] = inputActivityRows(state, 'e2fsck -f disk.img', 0, 100_000, 100);
    assert.equal(stripAnsi(first), '◆ Waiting for input · e2fsck · 18.0s · 1m 40s total');
    assert.equal(stripAnsi(second), '  Padding at end of inode bitmap is not set. Fix<y>?', 'the question as written; how to answer is the composer\'s');
    // Its own hue: never the running shimmer's lavender or the accent.
    assert.ok(first.startsWith(foreground(UI_COLORS.attention)), 'the attention color leads the row');
    for (const other of [UI_COLORS.accent, UI_COLORS.workingBase, UI_COLORS.workingPeak]) assert.notDeepEqual(UI_COLORS.attention, other);
    // No question on the line (`read -r reply`): the second row says what the program reads, never empty.
    const bare = inputActivityRows({...state, request: {since: 82_000, confidence: 'likely', mode: 'line', program: 'zsh'}}, 'read -r reply', 0, 100_000, 100).map(stripAnsi);
    assert.equal(bare[0], '◇ Probably waiting for input · zsh · 18.0s · 1m 40s total');
    assert.equal(bare[1], '  zsh is probably reading a line');
    assert.equal(stripAnsi(inputActivityRows({...state, request: {since: 82_000, confidence: 'confirmed', mode: 'hidden', program: 'bash'}}, 'read -s', 0, 100_000, 100)[1]),
      '  bash is reading hidden input');
    for (const columns of [20, 32, 48]) {
      for (const row of inputActivityRows(state, 'e2fsck -f disk.img', 0, 100_000, columns)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
    }
    const narrow = inputActivityRows(state, 'e2fsck', 0, 100_000, 32).map(stripAnsi);
    assert.match(narrow[0], /^◆ Waiting for input · 18\.0s$/u, 'the wait and its time survive; detail goes first');
    assert.match(narrow[1], /^ {2}Padding at end/u, 'the question keeps its row');
    assert.equal(displayWidth(narrow[1]), 32, 'without the hint, the question takes the whole row');
  });
  withEnv({NO_COLOR: '1', NMSH_ICONS: 'safe'}, () => {
    const [first, second] = inputActivityRows({...state, request: {...state.request, confidence: 'likely', mode: 'line'}}, 'rm -i x', 82_000, 100_000, 80);
    assert.doesNotMatch(first + second, /\u001b\[38;/u, 'no color under NO_COLOR');
    assert.match(first, /\u001b\[1m/u, 'weight still marks it');
    assert.match(stripAnsi(first), /^\? Probably waiting for input · e2fsck · 18\.0s$/u);
    assert.equal(stripAnsi(inputActivityRows(state, 'e2fsck', 0, 100_000, 80)[0]).charAt(0), '!');
  });
  // One instruction in the composer per kind of read; hidden input never shows what is typed.
  assert.equal(inputComposerHint({...state.request, mode: 'hidden'}, 'sudo', true), 'Hidden input · nothing you type is shown · Enter sends it to sudo · Ctrl+Q queues a command');
  assert.equal(inputComposerHint(state.request, 'e2fsck', true), 'Press a key · it goes straight to e2fsck · Ctrl+Q queues a command');
  assert.equal(inputComposerHint({...state.request, confidence: 'likely', mode: 'line'}, 'bash', false), 'Type your answer · Enter sends it to bash');
  assert.equal(completionWaitFact({waitedMs: 18_000, waits: 1}), ' · 18.0s waiting for input');
  assert.equal(completionWaitFact({waitedMs: 65_000, waits: 3}), ' · 1m 5s waiting for input (3 prompts)');
  assert.equal(completionWaitFact({waitedMs: 300, waits: 1}), '', 'an instant answer is not worth a fact');
  assert.equal(waitedDetail({timing: {waitedMs: 18_000, waits: 1}}, 0), ' · waited 18.0s');
  // The wait (session clock) is never shown longer than the run (this frontend's clock), e.g. after a reattach.
  assert.match(stripAnsi(inputActivityRows(state, 'e2fsck', 91_000, 100_000, 100)[0]), /· 9\.0s$/u);
  assert.equal(waitedDetail({timing: {waitedMs: 10_500, waits: 1}}, 0, 9000), ' · waited 9.0s');
  assert.equal(waitedDetail(undefined, 0), '');
});
