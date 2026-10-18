import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AnsiOutputParser, plainLine} from '../src/output/AnsiOutputParser.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {ShellSession} from '../src/shell/ShellSession.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/**
 * #388: programs that redraw several of their own rows in place (multi-line progress) update those rows instead of
 * leaving a copy per frame, and can never reach rows outside their live region.
 */
const plain = (parser: AnsiOutputParser) => parser.allLines().map(line => plainLine(line));
const ESC = '\u001b';
const up = (rows: number) => `${ESC}[${rows}A`;
const clearLine = `${ESC}[2K`;

test('the #388 fixture: a one-row redraw with cursor-up and erase-line leaves one line, not one per frame', () => {
  const parser = new AnsiOutputParser();
  for (let step = 0; step <= 10; step += 1) parser.write(`${step ? `${up(1)}${clearLine}` : ''}Downloading ${step * 10}%\r\n`);
  assert.deepEqual(plain(parser), ['Downloading 100%']);
  // Carriage-return rewriting, the existing control, still works.
  parser.write('10%\r20%\r100%\r\n');
  assert.deepEqual(plain(parser), ['Downloading 100%', '100%']);
});

test('a two-row progress display interleaved with log lines keeps every log line and only the final progress rows', () => {
  const parser = new AnsiOutputParser();
  const frame = (a: number, b: number) => `${clearLine}layer a ${a}%\r\n${clearLine}layer b ${b}%\r\n`;
  parser.write(frame(0, 0));
  for (let step = 1; step <= 5; step += 1) {
    if (step === 3) parser.write(`${up(2)}${ESC}[Jpulled base image\r\n`);
    else parser.write(up(2));
    parser.write(frame(step * 20, step * 10));
  }
  assert.deepEqual(plain(parser), ['pulled base image', 'layer a 100%', 'layer b 50%']);
});

test('the cursor never leaves the live region: NMSh lines, earlier commands and rows beyond a screen height stay untouched', () => {
  const parser = new AnsiOutputParser();
  parser.addLine('$ previous');
  parser.write('previous output\r\n');
  parser.addLine('$ current');
  parser.write('own 1\r\nown 2\r\n');
  parser.write(`${up(50)}X`);
  assert.deepEqual(plain(parser), ['$ previous', 'previous output', '$ current', 'Xwn 1', 'own 2'], 'clamped at the first own row');

  const tall = new AnsiOutputParser();
  tall.setScreenRows(3);
  for (let line = 0; line < 10; line += 1) tall.write(`line ${line}\r\n`);
  tall.write(`${up(9)}X\r\n`);
  assert.deepEqual(plain(tall).slice(6), ['line 6', 'line 7', 'Xine 8', 'line 9'], 'no further up than a screen height');
});

test('an NMSh line written mid-redraw fences the rows above it: later frames continue below it', () => {
  const parser = new AnsiOutputParser();
  parser.write('progress 1\r\n');
  parser.addLine('· copied');
  for (let step = 2; step <= 4; step += 1) parser.write(`${up(1)}${clearLine}progress ${step}\r\n`);
  assert.deepEqual(plain(parser), ['progress 1', '· copied', 'progress 4']);
});

test('save/restore, next/previous line, reverse index and partial erases act within the region', () => {
  const parser = new AnsiOutputParser();
  parser.write(`${ESC}7first\r\nsecond\r\n${ESC}8${ESC}[1mF${ESC}[m\r\n`);
  assert.deepEqual(plain(parser), ['First', 'second']);
  parser.write(`${ESC}[2Fx${ESC}[1Ey\r\n`);
  assert.deepEqual(plain(parser), ['xirst', 'yecond']);
  parser.write(`${ESC}Mz`);
  assert.deepEqual(plain(parser), ['xirst', 'zecond']);
  parser.write(`${ESC}[s${up(1)}${ESC}[3G${ESC}[1K${ESC}[u!`);
  assert.deepEqual(plain(parser), ['   st', 'z!cond']);
  parser.write(`${up(1)}\r${ESC}[J`);
  assert.deepEqual(plain(parser), [], 'erase below removes the program\'s rows under the cursor');
});

test('sequences split across reads still redraw in place', () => {
  const parser = new AnsiOutputParser();
  parser.write('one\r\n');
  for (const chunk of [`${ESC}`, '[', '1', 'A', `${ESC}[2`, 'Ktwo\r', '\n']) parser.write(chunk);
  assert.deepEqual(plain(parser), ['two']);
});

test('absolute row positioning is not mapped: it appends as before instead of guessing which row is meant', () => {
  const parser = new AnsiOutputParser();
  parser.write('a\r\nb\r\n');
  parser.write(`${ESC}[1;1Hc\r\n`);
  assert.deepEqual(plain(parser), ['a', 'b', 'c']);
});

/** An indicatif-style display: it moves up by the terminal rows it drew (it measures wrapping), erases below, redraws. */
function wrappedProgress(columns: number, frames = 10): string {
  const bar = (n: number) => `Downloading big-archive-name.tar.gz [${'='.repeat(n)}${' '.repeat(frames - n)}] ${n * 10}%`;
  const rowsOf = (text: string) => Math.max(1, Math.ceil(text.length / columns));
  let out = 'LOG kept line one\r\nLOG kept line two\r\n';
  let drawn = 0;
  for (let n = 0; n <= frames; n += 1) {
    if (drawn) out += `\r${up(drawn)}${ESC}[J`;
    const frame = [bar(n), `eta ${frames - n}s`];
    out += `${frame.join('\r\n')}\r\n`;
    drawn = frame.reduce((sum, line) => sum + rowsOf(line), 0);
  }
  return `${out}LOG done\r\n`;
}

test('rows are the terminal\'s rows: a display that moves over its own wrapped line never erases earlier output', () => {
  const parser = new AnsiOutputParser();
  parser.setScreenRows(24);
  parser.setScreenColumns(40);
  parser.write(wrappedProgress(40));
  assert.deepEqual(plain(parser), ['LOG kept line one', 'LOG kept line two', 'Downloading big-archive-name.tar.gz [==========] 100%', 'eta 0s', 'LOG done']);
  // The same bytes at a width where nothing wraps behave the same.
  const wide = new AnsiOutputParser();
  wide.setScreenRows(24);
  wide.setScreenColumns(120);
  wide.write(wrappedProgress(120));
  assert.deepEqual(plain(wide), plain(parser));
});

test('on a wrapped line, carriage return, erase-line and line feed act on the cursor\'s row, as on the screen', () => {
  const parser = new AnsiOutputParser();
  parser.setScreenColumns(10);
  parser.write('0123456789abcdefghij');          // two rows, cursor at the end (pending wrap)
  parser.write('\rABC');                         // back to the start of the second row
  assert.deepEqual(plain(parser), ['0123456789ABCdefghij']);
  parser.write(`${up(1)}${ESC}[2K`);              // up to the first row and clear that row only
  assert.deepEqual(plain(parser), ['          ABCdefghij']);
  parser.write('\r\nxy');                         // line feed from the first row goes to the line's second row
  assert.deepEqual(plain(parser), ['          xyCdefghij']);
  parser.write(`\r${ESC}[K`);                      // erase to the end of the second row: the row stays, blank
  parser.write(`${up(1)}first\r\nnext\r\n`);
  // The second row is still the same (wrapped) line, as on the screen: drawn at 10 columns it reads "first" / "next".
  assert.deepEqual(plain(parser), ['first     next']);
});

test('a resize re-wraps: the rows a program counts at the new width are the ones it reaches', () => {
  const parser = new AnsiOutputParser();
  parser.setScreenColumns(40);
  parser.write('kept\r\n');
  parser.write(`${'x'.repeat(30)}\r\n`);
  parser.setScreenColumns(20);                    // the 30-column line now takes two rows
  parser.write(`${up(2)}${ESC}[J${'y'.repeat(5)}\r\n`);
  assert.deepEqual(plain(parser), ['kept', 'yyyyy']);
});

test('a status row below a scroll region the program set is not stored; NMSh lines and log rows are', () => {
  const parser = new AnsiOutputParser();
  parser.setScreenRows(24);
  parser.setScreenColumns(80);
  const status = (percent: number) => `${ESC}7${ESC}[24;0f${ESC}[42mProgress: [${percent}%]${ESC}[0m${ESC}8`;
  parser.write(`\r\n${ESC}7${ESC}[0;23r${ESC}8${up(1)}`);
  for (let step = 1; step <= 3; step += 1) parser.write(`Unpacking package-${step}\r\n${status(step * 30)}`);
  parser.addLine('NMSh note while the status row is reserved');
  parser.write(`Setting up package-3\r\n${ESC}7${ESC}[0;24r${ESC}8${ESC}[J`);
  const lines = plain(parser);
  assert.equal(lines.some(line => /Progress/u.test(line)), false, 'the status row never enters the transcript');
  assert.deepEqual(lines.filter(line => line), ['Unpacking package-1', 'Unpacking package-2', 'Unpacking package-3', 'NMSh note while the status row is reserved', 'Setting up package-3']);
  // Without a region, an absolute move is not mapped: the text stays where the cursor is.
  const plainParser = new AnsiOutputParser();
  plainParser.write(`a\r\n${ESC}[5;1Hb\r\n`);
  assert.deepEqual(plain(plainParser), ['a', 'b']);
});

test('a resumed command keeps redrawing its own rows, and a command-line recolor never moves its cursor', () => {
  const buffer = new OutputBuffer();
  const startId = buffer.beginCommand('pull', ['$ pull']);
  buffer.write('layer 1%\r\n');
  buffer.updateCommandHighlight(startId, ['$ pull']);
  buffer.write(`${up(1)}${clearLine}layer 50%\r\n`);
  const transcript = buffer.transcript();
  const restored = new OutputBuffer();
  restored.restoreTranscript(transcript);
  restored.resumeActive('pull', startId, startId + 1);
  restored.write(`${up(1)}${clearLine}layer 100%\r\n`);
  const record = restored.complete(0)!;
  assert.equal(record.output, 'layer 100%');
});

test('ten thousand frames of a three-row display stay three rows and parse in bounded time', () => {
  const buffer = new OutputBuffer();
  buffer.beginCommand('build', ['$ build']);
  const started = performance.now();
  for (let step = 0; step < 10_000; step += 1) {
    buffer.write(`${step ? up(3) : ''}${clearLine}a ${step}\r\n${clearLine}b ${step}\r\n${clearLine}c ${step}\r\n`);
  }
  const elapsed = performance.now() - started;
  const record = buffer.complete(0)!;
  assert.equal(record.output, 'a 9999\nb 9999\nc 9999');
  assert.equal(record.endId - record.outputStartId, 3);
  assert.ok(elapsed < 5000, `took ${Math.round(elapsed)}ms`);
});

test('a real PTY at 40 columns: a display that counts its wrapped rows keeps the log lines above it', {timeout: 60_000}, async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-wrapped-')));
  const shell = new ShellSession(home, 40, 30, home, {...process.env, HOME: home});
  let output = '';
  try {
    await once(shell, 'prompt');
    shell.on('data', data => { output += data; });
    const done = once(shell, 'prompt');
    // The program measures its rows with the PTY's own width, as progress libraries do.
    const script = 'const c=process.stdout.columns,r=t=>Math.max(1,Math.ceil(t.length/c));let d=0;process.stdout.write("LOG one\\nLOG two\\n");'
      + 'for(let n=0;n<=10;n++){if(d)process.stdout.write("\\r\\x1b["+d+"A\\x1b[J");const f=["Downloading big-archive-name.tar.gz ["+"=".repeat(n)+" ".repeat(10-n)+"]","eta "+(10-n)+"s"];'
      + 'process.stdout.write(f.join("\\n")+"\\n");d=f.reduce((s,l)=>s+r(l),0)}process.stdout.write("LOG done\\n")';
    shell.submit(`${JSON.stringify(process.execPath)} -e '${script}'`);
    await done;
    const parser = new AnsiOutputParser();
    parser.setScreenRows(30);
    parser.setScreenColumns(40);
    parser.write(output);
    const lines = plain(parser);
    assert.ok(lines.includes('LOG one') && lines.includes('LOG two') && lines.includes('LOG done'), lines.join('\n'));
    assert.deepEqual(lines.filter(line => line.startsWith('Downloading')), ['Downloading big-archive-name.tar.gz [==========]']);
  } finally {
    shell.kill();
    rmSync(home, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});

test('a real PTY: the #388 fixture run by zsh leaves one progress line', {timeout: 60_000}, async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-redraw-')));
  const shell = new ShellSession(home, 100, 30, home, {...process.env, HOME: home});
  let output = '';
  try {
    await once(shell, 'prompt');
    shell.on('data', data => { output += data; });
    const done = once(shell, 'prompt');
    const script = 'for (let i=0;i<=10;i++){process.stdout.write((i?"\\x1b[1A\\x1b[2K":"")+"Downloading "+i*10+"%\\n")}';
    shell.submit(`${JSON.stringify(process.execPath)} -e '${script}'`);
    await done;
    const parser = new AnsiOutputParser();
    parser.setScreenRows(30);
    parser.write(output);
    assert.deepEqual(plain(parser).filter(line => line.includes('Downloading')), ['Downloading 100%']);
  } finally {
    shell.kill();
    rmSync(home, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});

test('live: through the real frontend at 40 columns, the wrapped display redraws in place and the log lines stay in the transcript', {timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 40, rows: 30});
  try {
    await frontend.waitFor(/❯/u);
    await frontend.run('echo READY', /READY/u);
    const script = 'const c=process.stdout.columns,r=t=>Math.max(1,Math.ceil(t.length/c));let d=0;process.stdout.write("LOG one\\nLOG two\\n");'
      + 'for(let n=0;n<=10;n++){if(d)process.stdout.write("\\r\\x1b["+d+"A\\x1b[J");const f=["Downloading big-archive-name.tar.gz ["+"=".repeat(n)+" ".repeat(10-n)+"]","eta "+(10-n)+"s"];'
      + 'process.stdout.write(f.join("\\n")+"\\n");d=f.reduce((s,l)=>s+r(l),0)}process.stdout.write("LOG done\\n")';
    await frontend.run(`${JSON.stringify(process.execPath)} -e '${script}'`, /LOG done/u);
    await until(async () => (await sandbox.transcripts().list()).some(session => JSON.stringify(session.transcript).includes('LOG done')), 15_000, 'the journal');
    const sessions = await sandbox.transcripts().list();
    const lines = sessions.flatMap(session => (session.transcript.lines as Array<Array<{text?: string} | null>>).map(line => line.map(cell => cell?.text ?? ' ').join('').trimEnd()));
    assert.ok(lines.includes('LOG one') && lines.includes('LOG two'), lines.join('\n'));
    assert.equal(lines.filter(line => line.startsWith('Downloading')).length, 1, 'one final progress row, not one per frame');
  } finally { await sandbox.dispose(); }
});
