import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CommandClassifier} from '../src/output/Classifier.js';
import {AlternateScreenTracker} from '../src/session/TerminalModes.js';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * Interactive terminal UIs that draw inline (no alternate screen), such as
 * agent CLIs, must get the terminal from NMSh, whatever their command is
 * called. The evidence is the terminal input modes they turn on.
 */

test('input modes, not names or output volume, make a command interactive', () => {
  const run = (chunks: string[]) => {
    const classifier = new CommandClassifier(Date.now() - 5000);
    for (const chunk of chunks) classifier.pushChunk(chunk);
    return classifier.mode;
  };
  assert.equal(run(['Do you trust this folder?\r\n', '\u001b[?2004h\u001b[?25l❯ Yes\r\n  No\r\n']), 'PASSTHROUGH', 'bracketed paste');
  assert.equal(run(['\u001b[?1000h\u001b[?1006h']), 'PASSTHROUGH', 'mouse reporting');
  assert.equal(run(['\u001b[?1004h']), 'PASSTHROUGH', 'focus events');
  assert.equal(run(['\u001b[>1u']), 'PASSTHROUGH', 'kitty keyboard push');
  assert.equal(run(['\u001b[?20', '04h']), 'PASSTHROUGH', 'split across reads');
  assert.equal(run(['\u001b[?1049h']), 'PASSTHROUGH', 'alternate screen still works');
  // Batch output, including progress bars that hide the cursor and move it, never qualifies.
  const progress = Array.from({length: 30}, (_, index) => `\u001b[?25l\r[${'#'.repeat(index)}] ${index}%\u001b[1A\u001b[2K\u001b[?25h`);
  assert.notEqual(run([...progress, 'done\r\n']), 'PASSTHROUGH');
  assert.notEqual(run([Array.from({length: 200}, (_, index) => `line ${index}\n`).join('')]), 'PASSTHROUGH');
  assert.notEqual(run(['\u001b[?1h\u001b=']), 'PASSTHROUGH', 'cursor-key mode alone (pagers, readline) is not evidence');
  assert.notEqual(run(['\u001b[?2004l']), 'PASSTHROUGH', 'turning a mode off is not evidence');
});

test('the mode tracker records interactive input modes and replays them, including kitty keyboard flags', () => {
  const tracker = new AlternateScreenTracker();
  tracker.observeModes('\u001b[>1u');
  tracker.observeModes('\u001b[?2004h\u001b[?25l');
  assert.equal(tracker.interactive, true);
  assert.equal(tracker.active, false);
  assert.equal(tracker.ownsTerminal, true);
  assert.equal(tracker.restoreSequence(), '\u001b[?2004h\u001b[?25l\u001b[>1u');
  assert.equal(tracker.push('inline UI output'), '', 'an interactive UI is not transcript text');
  tracker.observeModes('\u001b[<u');
  assert.equal(tracker.restoreSequence(), '\u001b[?2004h\u001b[?25l', 'a pop removes the kitty flags');
  tracker.reset();
  assert.equal(tracker.interactive, false);
  assert.equal(tracker.push('ordinary output'), 'ordinary output');
});

/** An inline picker like an agent's trust prompt: bracketed paste on, no alternate screen, raw keys. */
function installFakeAgent(sandbox: LiveSandbox): string {
  const bin = join(sandbox.home, 'bin');
  mkdirSync(bin, {recursive: true});
  writeFileSync(join(bin, 'fake-agent.mjs'), `
process.stdout.write('\\u001b[?2004h\\u001b[?25lDo you trust this folder?\\r\\n');
let selected = 0;
const options = ['Yes, I trust it', 'No, exit'];
const draw = first => {
  if (!first) process.stdout.write('\\u001b[2A');
  for (let index = 0; index < options.length; index += 1) process.stdout.write('\\u001b[2K' + (index === selected ? '❯ ' : '  ') + options[index] + '\\r\\n');
};
draw(true);
process.stdin.setRawMode(true);
// Keys arrive as a byte stream: several can come in one read.
process.stdin.on('data', data => {
  let input = data.toString();
  while (input.length > 0) {
    if (input.startsWith('\\u001b[B') || input.startsWith('\\u001bOB')) { selected = 1; draw(false); input = input.slice(3); }
    else if (input.startsWith('\\u001b[A') || input.startsWith('\\u001bOA')) { selected = 0; draw(false); input = input.slice(3); }
    else if (input.startsWith('\\r')) {
      process.stdout.write('\\u001b[?2004l\\u001b[?25hPICKED-' + selected + '\\r\\n');
      process.exit(0);
    } else input = input.slice(1);
  }
});
`);
  // A differently named wrapper, like a per-account alias for an agent CLI.
  writeFileSync(join(bin, 'agent-account2'), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, 'fake-agent.mjs')}" "$@"\n`);
  chmodSync(join(bin, 'agent-account2'), 0o755);
  return bin;
}

async function startedWith(sandbox: LiveSandbox, bin: string): Promise<Frontend> {
  const app = sandbox.launch();
  await app.waitFor(/❯/);
  await app.run(`export PATH="${bin}:$PATH"; echo PATH-SET`, /PATH-SET/);
  return app;
}

test('a wrapper that launches an inline interactive UI gets the terminal: keys reach it, then NMSh returns', async () => {
  const sandbox = new LiveSandbox();
  try {
    const bin = installFakeAgent(sandbox);
    const app = await startedWith(sandbox, bin);
    const mark = app.mark;
    app.pty.write('agent-account2\r');
    await app.waitFor(/Do you trust this folder\?[\s\S]*No, exit/, mark);
    // Passthrough began: NMSh handed over the terminal (its own bracketed paste off) and replayed the app's modes.
    await until(() => app.output.indexOf('\u001b[?2004l', mark) !== -1, 15000, 'passthrough');
    const handedOver = app.output.indexOf('\u001b[?2004l', mark);
    assert.ok(app.output.indexOf('\u001b[?2004h', handedOver) !== -1, 'the app\'s bracketed paste reached the terminal');
    app.pty.write('\u001b[B');
    await app.waitFor(/❯ No, exit/, handedOver);
    app.pty.write('\r');
    await app.waitFor(/PICKED-1/, mark);
    assert.doesNotMatch(strip(app.output.slice(mark)), /\d;2m|\[\?2004h/, 'no control sequences leak as text');
    await app.run('echo BACK-IN-NMSH', /BACK-IN-NMSH/);
  } finally {
    await sandbox.dispose();
  }
});

test('an interactive UI that was detached is handed the terminal again on reattach', async () => {
  const sandbox = new LiveSandbox();
  try {
    const bin = installFakeAgent(sandbox);
    const first = await startedWith(sandbox, bin);
    const mark = first.mark;
    first.pty.write('agent-account2\r');
    await first.waitFor(/Do you trust this folder\?/, mark);
    await until(async () => (await sandbox.sessions())[0]?.running?.includes('agent-account2') === true, 15000, 'running');
    const [{id}] = await sandbox.sessions() as [{id: string}];
    first.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');

    // Observe the exact visible handoff inside the frontend process. Keys can
    // arrive as soon as these modes are written, before another JS callback.
    const handoff = join(sandbox.home, 'handoff.json');
    const probe = join(sandbox.home, 'handoff.mjs');
    writeFileSync(probe, `
import {writeFileSync} from 'node:fs';
const write = process.stdout.write.bind(process.stdout);
let observed = false;
process.stdout.write = (chunk, ...args) => {
  if (!observed && typeof chunk === 'string' && chunk.includes('\\u001b[?2004l') && chunk.includes('\\u001b[?2004h')) {
    observed = true;
    writeFileSync(${JSON.stringify(handoff)}, JSON.stringify({raw: process.stdin.isRaw === true, listening: process.stdin.listenerCount('data') > 0}));
  }
  return write(chunk, ...args);
};
`);
    const second = sandbox.launch(['--attach', id], {cols: 100, rows: 30}, {NODE_OPTIONS: `--import=${probe}`});
    await until(async () => (await sandbox.sessions())[0]?.state === 'attached', 15000, 'reattached');
    // Handed straight to the program, with its bracketed paste restored.
    await until(() => second.output.includes('\u001b[?2004l'), 15000, 'passthrough on reattach');
    assert.ok(second.output.indexOf('\u001b[?2004h', second.output.indexOf('\u001b[?2004l')) !== -1);
    await until(() => existsSync(handoff), 15000, 'input state at handoff');
    assert.deepEqual(JSON.parse(readFileSync(handoff, 'utf8')), {raw: true, listening: true},
      'visible passthrough ownership must follow raw input setup');
    second.pty.write('\u001b[B\r');
    await second.waitFor(/PICKED-1/);
    await second.run('echo AFTER-REATTACH', /AFTER-REATTACH/);
  } finally {
    await sandbox.dispose();
  }
});

test('an ordinary long-running command with progress output stays in NMSh and keeps the composer', async () => {
  const sandbox = new LiveSandbox();
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(`for i in 1 2 3 4 5 6; do printf '\\e[?25l\\r[%s] working' "$i"; sleep 0.4; done; printf '\\e[?25h\\nPROGRESS-%s\\n' DONE\r`);
    await app.waitFor(/PROGRESS-DONE/, mark); // assembled at run time, so the echoed command cannot match
    assert.equal(app.output.indexOf('\u001b[?2004l', mark), -1, 'never handed over the terminal');
    await app.run('echo STILL-NMSH', /STILL-NMSH/);
  } finally {
    await sandbox.dispose();
  }
});

test('a fullscreen program found from its output owns the terminal outright: NMSh writes nothing over it and keeps none of its paint', async () => {
  // Shaped on agy's real stream: ordinary text, then (in the same write) the alternate screen, modifyOtherKeys,
  // truecolor paint, and a spinner that returns to column 1 until a key arrives.
  const sandbox = new LiveSandbox();
  const script = join(sandbox.home, 'paint.mjs');
  writeFileSync(script, `
process.stdin.setRawMode(true);
process.stdout.write('BEFORE_OWN\\r\\n\\u001b[?1049h\\u001b[?25l\\u001b[>4;2m\\u001b[>1u\\u001b[H\\u001b[2J\\u001b[38;2;0;1;2mPAINT_MARK\\u001b[m\\r\\n');
const frames = ['\\r-', '\\r|', '\\r/'];
let frame = 0;
const timer = setInterval(() => process.stdout.write(frames[frame++ % frames.length]), 40);
process.stdin.on('data', data => {
  if (!String(data).includes('q')) return;
  clearInterval(timer);
  process.stdout.write('\\u001b[>4m\\u001b[<1u\\u001b[?1049l\\u001b[?25h');
  process.exit(0);
});
`);
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(`node ${script}\r`);
    await until(() => app.output.includes('PAINT_MARK', mark), 15000, 'the program painted');
    const handover = app.output.lastIndexOf('\u001b[2J\u001b[H', app.output.indexOf('PAINT_MARK', mark));
    assert.ok(handover > mark, 'NMSh handed the terminal over before the paint reached it');
    await new Promise(resolve => setTimeout(resolve, 600));
    const owned = app.output.slice(app.output.indexOf('PAINT_MARK', mark) + 'PAINT_MARK'.length);
    // Everything written while the program owns the terminal is the program's own spinner.
    assert.equal(owned.replace(/^\u001b\[m/u, '').replace(/[\r\n|/-]/gu, ''), '', 'NMSh wrote nothing while the program owned the terminal');
    const back = app.mark;
    app.pty.write('q');
    await app.waitFor(/❯/, back);
    await app.run('echo BACK_IN_NMSH', /BACK_IN_NMSH/);
    const reclaimed = strip(app.output.slice(back));
    assert.match(reclaimed, /BEFORE_OWN/u, 'ordinary output before the takeover stays in the transcript');
    assert.doesNotMatch(reclaimed, /PAINT_MARK|NaN|;2m|\[>/u, 'none of the program\'s paint or controls come back as transcript text');
    assert.doesNotMatch(app.output.slice(back), /NaN/u, 'no unreadable style is written');
  } finally {
    await sandbox.dispose();
  }
});

test('a program that asks the terminal before taking the screen gets the terminal\'s answers, as from a plain shell', async () => {
  // agy's shape: queries in their own first write, a wait for the answers, then the alternate screen.
  const sandbox = new LiveSandbox();
  const script = join(sandbox.home, 'ask.mjs');
  writeFileSync(script, `
process.stdin.setRawMode(true);
let got = '';
process.stdin.on('data', data => { got += data; });
process.stdout.write('\\u001b[?2026$p\\u001b]11;?\\u0007');
setTimeout(() => {
  process.stdout.write('\\u001b[?1049h\\u001b[H\\u001b[2JANSWERS=' + JSON.stringify(got) + '\\r\\n');
  setTimeout(() => { process.stdout.write('\\u001b[?1049l'); process.exit(0); }, 400);
}, 700);
`);
  try {
    const app = sandbox.launch();
    app.pty.onData(data => {
      if (data.includes('\u001b[?2026$p')) app.pty.write('\u001b[?2026;2$y');
      if (data.includes('\u001b]11;?')) app.pty.write('\u001b]11;rgb:1e1e/1e1e/2e2e\u001b\\');
    });
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(`node ${script}\r`);
    await app.waitFor(/ANSWERS=/, mark);
    assert.match(strip(app.output.slice(mark)), /ANSWERS="\\u001b\[\?2026;2\$y\\u001b\]11;rgb:1e1e\/1e1e\/2e2e\\u001b\\\\"/u, 'both answers reached the program');
    await app.waitFor(/❯/, app.output.indexOf('ANSWERS=', mark));
    await app.run('echo BACK_$((6*7))', /BACK_42/);
    assert.doesNotMatch(strip(app.output.slice(app.output.indexOf('\u001b[?1049l', app.output.indexOf('ANSWERS=', mark)))), /2026;2|rgb:1e1e|ANSWERS/u, 'no answer reached the composer or transcript');
  } finally {
    await sandbox.dispose();
  }
});

test('a program\'s bare line feeds reach the terminal untouched while it owns it, as from a plain shell', async () => {
  // A raw-mode TUI moves down a row in the same column with a bare LF (agy's inline redraws, `\n\n\b`).
  // Node's raw mode keeps ONLCR on NMSh's terminal, which turned each into CR LF: the cursor jumped to
  // column 1 and the next characters overwrote the start of the line.
  const sandbox = new LiveSandbox();
  // cfmakeraw, as TUIs use (OPOST off); Node's own raw mode would keep ONLCR.
  const script = join(sandbox.home, 'lf.py');
  writeFileSync(script, `import os, termios, time, tty
saved = termios.tcgetattr(0)
tty.setraw(0)
os.write(1, b'\\x1b[?1049h\\x1b[HSTART_MARK\\n\\nDOWN_TWO\\x1b[?1049l')
time.sleep(0.3)
termios.tcsetattr(0, termios.TCSADRAIN, saved)
`);
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(`python3 -I ${script}\r`);
    await app.waitFor(/DOWN_TWO/, mark);
    const at = app.output.indexOf('START_MARK', mark);
    assert.equal(app.output.slice(at, at + 'START_MARK\n\nDOWN_TWO'.length), 'START_MARK\n\nDOWN_TWO', 'the LFs are not rewritten as CR LF');
    await app.waitFor(/❯/, at);
    // NMSh's own terminal settings are back once it owns the terminal again.
    await app.run('echo BACK_$((6*7))', /BACK_42/);
  } finally {
    await sandbox.dispose();
  }
});
