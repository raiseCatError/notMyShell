import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * Expanded /copy through the real composer, PTY and clipboard tool boundary: a stand-in pbcopy/xclip/wl-copy first on
 * PATH records exactly what NMSh copies, so the person's clipboard is never touched.
 */
const supported = process.platform === 'darwin' || process.platform === 'linux';

function withClipboard(config: Record<string, unknown> = {}, env: Record<string, string> = {}, size = {cols: 100, rows: 30}) {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh', ...config}, {});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const clip = join(sandbox.root, 'clipboard.txt');
  for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ncat > ${JSON.stringify(clip)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const launchEnv = {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {}), ...env};
  const launch = (args: string[] = []) => sandbox.launch(args, size, launchEnv);
  const frontend = launch();
  const reset = () => writeFileSync(clip, '');
  const read = () => existsSync(clip) ? readFileSync(clip, 'utf8') : '';
  /** Type a command and return what reached the clipboard. */
  const copied = async (target: Frontend, command: string) => {
    reset();
    target.pty.write(`${command}\r`);
    await until(() => read().length > 0, 15_000, `the clipboard after ${command}`);
    return read();
  };
  return {sandbox, frontend, launch, copied, reset, read};
}

async function ready(frontend: Frontend) {
  await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
  await frontend.run('echo READY', /READY/u);
}

/** Four commands, oldest first: alpha, a failure, a silent one, omega. /copy 1 is omega. */
async function history(frontend: Frontend) {
  await frontend.run(`printf 'alpha\\n  two\\n'`, /two/u);
  await frontend.run(`sh -c 'echo boom >&2; exit 3'`, /boom/u);
  await frontend.run('true', /Completed/u);
  await frontend.run('echo omega', /omega/u);
}

test('live: /copy and /cp select by number, count, range and list, oldest first; --status adds each command\'s own status', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend, copied, reset, read} = withClipboard();
  try {
    await ready(frontend);
    await history(frontend);
    assert.equal(await copied(frontend, '/copy'), 'omega');
    assert.equal(await copied(frontend, '/copy -3'), 'boom\nomega', 'the silent command adds nothing');
    assert.equal(await copied(frontend, '/cp -3'), 'boom\nomega', '/cp is /copy');
    assert.equal(await copied(frontend, '/copy 2-4'), 'alpha\n  two\nboom');
    assert.equal(await copied(frontend, '/cp 4,1'), 'alpha\n  two\nomega', 'a list copies in the order the commands ran');
    assert.equal(await copied(frontend, '/cp latest'), 'omega');
    const withStatus = await copied(frontend, '/cp -3 --status');
    assert.match(withStatus, /^boom\n✘ Command failed · exit 3 · [^\n]+\n✔ Completed · [^\n]+\nomega\n✔ Completed · [^\n]+$/u,
      `each status follows its own output; the silent one copies its status alone: ${JSON.stringify(withStatus)}`);
    // A status-free copy never carries NMSh's rows, even though they are recorded.
    assert.doesNotMatch(await copied(frontend, '/copy 1-4'), /Completed|failed/u);
    // A missing output refuses the whole copy, and the clipboard keeps what it held.
    reset();
    writeFileSync(join(sandbox.root, 'clipboard.txt'), 'KEEP');
    const mark = frontend.mark;
    frontend.pty.write('/copy 1,9\r');
    await frontend.waitFor(/No completed command output at 9: there are only \d+ completed commands\. Nothing was copied\./u, mark);
    frontend.pty.write('/copy 2\r');
    await frontend.waitFor(/Nothing to copy: true printed no output; the clipboard is unchanged/u, mark);
    frontend.pty.write('/copy -3 --state\r');
    await frontend.waitFor(/Unknown option --state/u, mark);
    assert.equal(read(), 'KEEP');
    // With the status asked for, the silent command's status alone is copied.
    assert.match(await copied(frontend, '/copy 2 --status'), /^✔ Completed · /u);
    // Feedback is a brief note above the composer, never a transcript line.
    const before = frontend.mark;
    await copied(frontend, '/copy -2');
    await frontend.waitFor(/Copied 2 outputs · \d+ characters · \d+ lines?/u, before);
    const records = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
    assert.equal(records.some(record => /Copied/u.test(record.output)), false, 'no copy note entered any command\'s output');
  } finally { await sandbox.dispose(); }
});

test('live: Interactive Picker mode: bare /copy opens the picker; it says whether statuses are included; explicit forms still copy at once', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend, copied} = withClipboard({copy: {mode: 'picker', includeStatus: false}});
  try {
    await ready(frontend);
    await history(frontend);
    // Explicit forms behave the same in both modes.
    assert.equal(await copied(frontend, '/copy 1'), 'omega');
    let mark = frontend.mark;
    frontend.pty.write('/copy\r');
    await frontend.waitFor(/Copy output[\s\S]*Completion status: not included \(s\)[\s\S]*echo omega/u, mark);
    // Choose omega and the failure (Space moves on after each choice), include statuses, copy.
    frontend.pty.write(' ');
    frontend.pty.write('\u001b[B');
    frontend.pty.write(' ');
    frontend.pty.write('s');
    await frontend.waitFor(/Completion status: included after each output/u, mark);
    const clip = await copied(frontend, '');
    assert.match(clip, /^boom\n✘ Command failed · exit 3[^\n]*\nomega\n✔ Completed/u, JSON.stringify(clip));
    // /copy ui opens the picker in Quick Copy mode too; search narrows it; Esc cancels without copying.
    mark = frontend.mark;
    frontend.pty.write('/cp ui\r');
    await frontend.waitFor(/Copy output/u, mark);
    frontend.pty.write('/alpha');
    await frontend.waitFor(/Search: alpha[\s\S]*1 of \d+/u, mark);
    frontend.pty.write('\u001b');
    frontend.pty.write('\u001b');
    frontend.pty.write('\u001b');
    await frontend.run('echo AFTER-PICKER', /AFTER-PICKER/u);
  } finally { await sandbox.dispose(); }
});

test('live: /copy settings changes the default and the status setting; they persist to the next launch', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  // The next launch starts fresh instead of offering the killed window's detached session.
  const {sandbox, frontend, launch, copied} = withClipboard({liveSessionStartup: 'never'});
  try {
    await ready(frontend);
    await frontend.run('echo PERSIST', /PERSIST/u);
    const mark = frontend.mark;
    frontend.pty.write('/copy settings\r');
    await frontend.waitFor(/Copy[\s\S]*\/copy without a number[\s\S]*Quick Copy[\s\S]*Include completion status +Off/u, mark);
    frontend.pty.write('\u001b[B');
    frontend.pty.write(' ');
    await until(() => {
      try { return JSON.parse(readFileSync(join(sandbox.config, 'nmsh', 'config.json'), 'utf8')).copy?.includeStatus === true; } catch { return false; }
    }, 10_000, 'the setting saved');
    frontend.pty.write('\u001b');
    assert.match(await copied(frontend, '/copy'), /^PERSIST\n✔ Completed · /u, 'the setting applies at once');
    assert.equal(await copied(frontend, '/copy --no-status'), 'PERSIST', '--no-status overrides it once');
    frontend.pty.kill('SIGKILL');
    const next = launch();
    await ready(next);
    assert.match(await copied(next, '/copy'), /^READY\n✔ Completed · /u, 'persisted across launches');
  } finally { await sandbox.dispose(); }
});

test('live: after detach and reattach, /copy reaches the commands of the restored transcript', {skip: supported ? false : 'unsupported platform', timeout: 150_000}, async () => {
  const {sandbox, frontend, launch, copied} = withClipboard();
  try {
    await ready(frontend);
    await history(frontend);
    const [session] = await sandbox.sessions();
    frontend.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions()).find(item => item.id === session!.id)?.state === 'detached', 15_000, 'detached');
    const back = launch(['--attach', session!.id]);
    await back.waitFor(/omega/u, 0, 30_000);
    await back.waitFor(/❯/u);
    assert.equal(await copied(back, '/copy -3'), 'boom\nomega');
    assert.match(await copied(back, '/cp 1 --status'), /^omega\n✔ Completed · /u);
  } finally { await sandbox.dispose(); }
});

test('live: narrow, NO_COLOR and Safe glyphs keep the picker and copy notes legible', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend, copied} = withClipboard({}, {NO_COLOR: '1', NMSH_ICONS: 'safe'}, {cols: 40, rows: 20});
  try {
    await ready(frontend);
    await history(frontend);
    const mark = frontend.mark;
    frontend.pty.write('/copy ui\r');
    await frontend.waitFor(/Copy output[\s\S]*Completion status: not/u, mark);
    const painted = frontend.output.slice(mark);
    assert.doesNotMatch(painted, /\u001b\[38;[25];/u, 'no color under NO_COLOR');
    assert.doesNotMatch(strip(painted), /›|✓|✔/u, 'Safe glyphs only');
    frontend.pty.write('\u001b');
    const after = frontend.mark;
    await copied(frontend, '/copy -2');
    await frontend.waitFor(/\+ Copied 2 outputs/u, after);
  } finally { await sandbox.dispose(); }
});
