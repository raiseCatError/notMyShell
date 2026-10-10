import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * Input awareness through the real composer, PTY and session service, with harmless fixtures only: the shells'
 * own `read`, and tests/fixtures/askyn.py, which asks yes/no questions the way e2fsck does (single key, no echo,
 * Enter takes the default) and repairs nothing.
 */
const ASKYN = resolve('tests/fixtures/askyn.py');
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const python = spawnSync('python3', ['-c', 'import termios'], {encoding: 'utf8'}).status === 0;
const supported = process.platform === 'darwin' || process.platform === 'linux';
/**
 * What each platform can know (docs/design/input-awareness.md): Linux's kernel confirms an ordinary line read (◆),
 * macOS can only infer it (◇ Probably). The foreground program is named as the platform reports it.
 */
const LINE_WAIT = process.platform === 'linux' ? '◆ Waiting for input' : '◇ Probably waiting for input';
const PYTHON = process.platform === 'linux' ? 'python3' : 'Python';

type Shell = 'zsh' | 'bash' | 'fish';

async function start(shell: Shell, options: {size?: {cols: number; rows: number}; env?: Record<string, string>; args?: string[]; sandbox?: LiveSandbox} = {}) {
  const sandbox = options.sandbox ?? new LiveSandbox({provider: 'none', shellBackend: shell, themeBridge: {enabled: true, targets: {pager: {mode: 'follow'}}}},
    shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
  const started = Date.now();
  const frontend = sandbox.launch(options.args ?? [], options.size ?? {cols: 100, rows: 30}, options.env ?? {});
  await frontend.waitFor(/Vespyr|notMyShell|zsh|bash|fish/u);
  await until(() => existsSync(join(sandbox.config, 'nmsh', 'theme-bridge', `environment.${shell}`)) || frontend.output.length > 0 && Date.now() - started > 8000, 20_000, 'the managed shell');
  await frontend.run('echo READY', /READY/u);
  return {sandbox, frontend};
}

/** Text the frontend drew after `from`, without escapes. */
const drawn = (frontend: Frontend, from: number) => strip(frontend.output.slice(from));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

for (const shell of ['zsh', 'bash'] as const) {
  const available = supported && (shell === 'zsh' || bash);
  test(`live ${shell}: read prompts: a line (likely), a hidden line and a single key reach the program natively`, {skip: available ? false : `${shell} not installed`, timeout: 120_000}, async () => {
    const {sandbox, frontend} = await start(shell);
    try {
      // An ordinary line: the evidence is a question left open while the shell idles, so NMSh says "probably".
      let mark = frontend.mark;
      frontend.pty.write(`${shell === 'zsh' ? "read 'x?Continue? [y/N] '" : "read -p 'Continue? [y/N] ' x"}; echo got=$x\r`);
      await frontend.waitFor(new RegExp(`${LINE_WAIT} · (?:zsh|bash)[\\s\\S]*Continue\\? \\[y/N\\]`, 'u'), mark);
      // A considered answer (waits under a second are not worth a completion fact).
      await pause(1200);
      frontend.pty.write('y\r');
      await frontend.waitFor(/got=y[\s\S]*Completed · [\d.]+s · [\d.]+s waiting for input/u, mark);

      // A hidden line: keys go straight to the shell's read; nothing typed is drawn by NMSh.
      mark = frontend.mark;
      frontend.pty.write(`${shell === 'zsh' ? "read -s 'p?Password: '" : "read -s -p 'Password: ' p"}; echo; echo len=\${#p}\r`);
      await frontend.waitFor(/◆ Waiting for input[\s\S]*Hidden input for (?:zsh|bash) · nothing you type is shown/u, mark);
      const typed = frontend.mark;
      frontend.pty.write('hunter2');
      await pause(300);
      frontend.pty.write('\r');
      await frontend.waitFor(/len=7/u, mark);
      assert.doesNotMatch(drawn(frontend, typed), /hunter2|•{3}/u, 'the secret is never drawn, not even as dots');

      // A single key: answered without Enter, and no stray Enter reaches the shell afterwards.
      mark = frontend.mark;
      frontend.pty.write(`${shell === 'zsh' ? "read -k1 'k?Key: '" : "read -n1 -p 'Key: ' k"}; echo; echo key=$k\r`);
      await frontend.waitFor(/◆ Waiting for input[\s\S]*Keys go straight to (?:zsh|bash)/u, mark);
      frontend.pty.write('z');
      await frontend.waitFor(/key=z[\s\S]*Completed/u, mark);
      await frontend.run('echo AFTER', /AFTER/u);
    } finally { await sandbox.dispose(); }
  });
}

/**
 * Answer the terminal queries a program sends through NMSh (primary device attributes, cursor position), as a real
 * terminal does. Fish's reader waits for these answers; the test PTY alone never sends them.
 */
function answerQueries(frontend: Frontend): () => void {
  let seen = frontend.mark;
  const timer = setInterval(() => {
    const fresh = frontend.output.slice(seen);
    seen = frontend.output.length;
    for (const match of fresh.matchAll(/\u001b\[(0?c|6n)/gu)) frontend.pty.write(match[1] === '6n' ? '\u001b[1;1R' : '\u001b[?62;22c');
  }, 20);
  return () => clearInterval(timer);
}

test('live fish: read is fish\'s own line editor: handed the terminal, answered natively, never claimed as waiting', {skip: supported && fish ? false : 'fish not installed', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('fish');
  const stop = answerQueries(frontend);
  try {
    let mark = frontend.mark;
    frontend.pty.write(`read -P 'Name: ' x; echo got=$x\r`);
    // Fish's reader turns on bracketed paste: NMSh hands it the terminal, as for any interactive program.
    await until(() => frontend.output.slice(mark).includes('Name: '), 15_000, 'fish draws its own prompt');
    frontend.pty.write('abc\r');
    await frontend.waitFor(/got=abc[\s\S]*Completed/u, mark);
    mark = frontend.mark;
    frontend.pty.write(`read -s -P 'Password: ' p; echo len=(string length -- $p)\r`);
    await until(() => frontend.output.slice(mark).includes('Password: '), 15_000, 'fish draws its hidden prompt');
    frontend.pty.write('hunter2\r');
    // This command's own completion: a bare "Completed" could match the previous command's row.
    await frontend.waitFor(/len=7[\s\S]*Completed/u, mark);
    assert.doesNotMatch(frontend.output, /Waiting for input/u, 'a program that owns the terminal is not reported as waiting');
    // The next command follows at once (tests/typingAfterRead.test.ts covers this across shells).
    await frontend.run('echo AFTER-READ', /AFTER-READ/u);
    // External programs under fish get the same awareness as under zsh.
    if (python) {
      mark = frontend.mark;
      frontend.pty.write(`python3 ${ASKYN} 'Fix<y>? '\r`);
      await frontend.waitFor(/◆ Waiting for input[\s\S]*Fix<y>\?/u, mark);
      frontend.pty.write('n');
      await frontend.waitFor(/ANSWERS=no[\s\S]*Completed/u, mark);
    }
  } finally { stop(); await sandbox.dispose(); }
});

test('live: an e2fsck-style yes/no session: each key answers one question, Enter only when pressed; timing stays truthful', {skip: supported && python ? false : 'python3 with termios not available', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    const started = Date.now();
    frontend.pty.write(`python3 ${ASKYN} 'Padding at end of inode bitmap is not set. Fix<y>? ' 'Inode 12 ref count is 2, should be 1. Fix<y>? ' 'Free blocks count wrong. Fix<y>? '\r`);
    await frontend.waitFor(new RegExp(`◆ Waiting for input · ${PYTHON}[\\s\\S]*Padding at end of inode bitmap is not set\\. Fix<y>\\?  ·  each key goes straight to ${PYTHON}`, 'u'), mark);
    assert.match(drawn(frontend, mark), new RegExp(`Keys go straight to ${PYTHON}`, 'u'), 'the composer says where typing goes');
    await pause(1200);
    frontend.pty.write('n');
    await frontend.waitFor(/Inode 12 ref count is 2, should be 1\. Fix<y>\?  ·  each key/u, mark);
    const third = frontend.mark;
    frontend.pty.write('\r');
    // A fast typist answers the moment the question appears, before NMSh knows how it reads: the key still reaches it.
    await until(() => frontend.output.slice(third).includes('Free blocks count wrong'), 15_000, 'the third question');
    frontend.pty.write('y');
    await frontend.waitFor(/ANSWERS=no,yes,yes[\s\S]*Completed · [\d.]+s · [\d.]+s waiting for input \(3 prompts\)/u, mark);
    const completed = /Completed · ([\d.]+)s · ([\d.]+)s waiting for input \(3 prompts\)/u.exec(drawn(frontend, mark));
    assert.ok(completed, drawn(frontend, mark).slice(-400));
    const [total, waited] = [Number(completed[1]), Number(completed[2])];
    assert.ok(waited <= total && total <= (Date.now() - started) / 1000 + 0.5, `waited ${waited}s within ${total}s`);
    assert.ok(waited >= 1, 'the deliberate pause is counted as waiting');
    // Nothing leaked to the shell: the composer is empty and the next command runs normally.
    await frontend.run('echo NEXT', /NEXT/u);

    // Ctrl+C at a waiting prompt interrupts the program, exactly as in a terminal.
    const interrupt = frontend.mark;
    frontend.pty.write(`python3 ${ASKYN} 'Fix<y>? '\r`);
    await frontend.waitFor(/◆ Waiting for input/u, interrupt);
    frontend.pty.write('\u0003');
    await frontend.waitFor(/Interrupted|exit 130|KeyboardInterrupt/u, interrupt);
    await frontend.run('echo STILL-HERE', /STILL-HERE/u);
  } finally { await sandbox.dispose(); }
});

test('live: no false positives: sleep, a streaming build, a status left open, a full-screen pager', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    await frontend.run('sleep 3', /Completed/u);
    await frontend.run('for i in 1 2 3 4 5 6; do echo compiling unit $i; sleep 0.5; done', /compiling unit 6[\s\S]*Completed/u);
    await frontend.run(`printf 'Downloading...'; sleep 3; echo ' done'`, /done[\s\S]*Completed/u);
    writeFileSync(join(sandbox.home, 'notes.txt'), 'line one\nline two\n');
    const pager = frontend.mark;
    frontend.pty.write('less notes.txt\r');
    await until(() => frontend.output.slice(pager).includes('line two'), 15_000, 'less draws');
    await pause(2000);
    frontend.pty.write('q');
    await frontend.waitFor(/Completed/u, pager);
    assert.doesNotMatch(drawn(frontend, mark), /Waiting for input|waiting for input/u);
  } finally { await sandbox.dispose(); }
});

test('live: a waiting session is visible from another window, survives detach, and is answered after reattach', {skip: supported && python ? false : 'python3 with termios not available', timeout: 150_000}, async () => {
  const {sandbox, frontend: first} = await start('zsh');
  try {
    const mark = first.mark;
    first.pty.write(`python3 ${ASKYN} 'First question. Fix<y>? ' 'Second question. Fix<y>? '\r`);
    await first.waitFor(/◆ Waiting for input/u, mark);
    const [session] = await sandbox.sessions();
    assert.equal(session!.inputConfidence, 'confirmed');
    assert.equal(session!.inputMode, 'key');
    assert.equal(session!.inputPrompt, 'First question. Fix<y>?');

    // Another window: one notice once the wait has lasted, and /sessions says it in words.
    const other = sandbox.launch(['--new']);
    await other.waitFor(/❯/u);
    await other.waitFor(/is waiting for input · .* · \/resume/u, 0, 30_000);
    const list = other.mark;
    other.pty.write('/sessions\r');
    await other.waitFor(/Waiting for input[\s\S]*First question/u, list);
    other.pty.write('\u001b');

    // The window goes away; the question keeps waiting, detached.
    first.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions()).find(item => item.id === session!.id)?.state === 'detached', 15_000, 'detached');
    assert.equal((await sandbox.sessions()).find(item => item.id === session!.id)?.inputSince, session!.inputSince, 'the same wait, not a new one');
    const back = sandbox.launch(['--attach', session!.id]);
    await back.waitFor(/◆ Waiting for input[\s\S]*First question\. Fix<y>\?/u, 0, 30_000);
    const answered = back.mark;
    back.pty.write('y');
    await back.waitFor(/Second question\. Fix<y>\?  ·  each key/u, answered);
    back.pty.write('n');
    await back.waitFor(/ANSWERS=yes,no[\s\S]*Completed[\s\S]*waiting for input \(2 prompts\)/u);
  } finally { await sandbox.dispose(); }
});

test('live: narrow, NO_COLOR and Safe glyphs keep the request legible', {skip: supported && python ? false : 'python3 with termios not available', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh', {size: {cols: 44, rows: 20}, env: {NO_COLOR: '1', NMSH_ICONS: 'safe'}});
  try {
    const mark = frontend.mark;
    frontend.pty.write(`python3 ${ASKYN} 'Fix<y>? '\r`);
    await frontend.waitFor(/! Waiting for input[\s\S]*Fix<y>\?/u, mark);
    const painted = frontend.output.slice(mark);
    assert.doesNotMatch(painted.slice(painted.lastIndexOf('Waiting for input') - 40), /\u001b\[38;[25];/u, 'no color under NO_COLOR');
    assert.doesNotMatch(drawn(frontend, mark), /◆|◇/u, 'Safe glyphs only');
    frontend.pty.write('y');
    await frontend.waitFor(/ANSWERS=yes/u, mark);
  } finally { await sandbox.dispose(); }
});

test('live: a reply typed for a command that finishes first is discarded, never run as a shell command', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const marker = join(sandbox.home, 'must-not-exist');
    const mark = frontend.mark;
    frontend.pty.write(`read -t 4 'x?Quick? ' || echo TIMED-OUT\r`);
    // A timed read waits in poll/select, not read(), so even Linux's kernel evidence leaves it "probably".
    await frontend.waitFor(/[◆◇] (?:Probably w|W)aiting for input/u, mark);
    frontend.pty.write(`touch ${marker}`);
    await frontend.waitFor(/reply was discarded, not run/u, mark, 20_000);
    frontend.pty.write('\r');
    await pause(1500);
    assert.equal(existsSync(marker), false);
    await frontend.run('echo CLEAN', /CLEAN/u);
  } finally { await sandbox.dispose(); }
});
