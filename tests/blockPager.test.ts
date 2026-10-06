import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {choosePager, pagerArgv, pagerDocument, pagerProcessEnvironment, pagerText, runPager} from '../src/output/BlockPager.js';
import {workspaceRoots} from '../src/context/services.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {BLOCK_ACTIONS} from '../src/ui/BlockActions.js';

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-pager-')));
  const bin = join(root, 'bin');
  mkdirSync(bin, {mode: 0o755});
  return {root, bin, done: () => rmSync(root, {recursive: true, force: true})};
}

/** A stand-in pager: records its argv, a few environment values and exactly what arrived on stdin. */
function fakePager(bin: string, name: string, record: string, behavior = ''): string {
  const path = join(bin, name);
  writeFileSync(path, `#!${process.execPath}
const fs = require('node:fs');
${behavior}
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', () => fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({argv: process.argv.slice(2), stdin: Buffer.concat(chunks).toString('utf8'),
  lessopen: process.env.LESSOPEN ?? null, termcap: process.env.LESS_TERMCAP_md ?? null})));
`, {mode: 0o755});
  return path;
}

test('pager choice: a plain PAGER as typed argv, never through a shell; else less, else more', async () => {
  assert.deepEqual(pagerArgv('less -R'), ['less', '-R']);
  assert.deepEqual(pagerArgv('/usr/bin/less -FRX'), ['/usr/bin/less', '-FRX']);
  for (const shellish of ['less -R | cat', '$(touch x)', 'less; rm -rf ~', '"less" -R', 'less `id`', 'bin/less', 'cat', '/bin/cat -v', '']) {
    assert.equal(pagerArgv(shellish), undefined, shellish);
  }
  const box = sandbox();
  try {
    const record = join(box.root, 'record.json');
    fakePager(box.bin, 'less', record);
    fakePager(box.bin, 'mypager', record);
    const env = {PATH: box.bin};
    assert.deepEqual(await choosePager(env, []), {binary: join(box.bin, 'less'), args: [], name: 'less'});
    assert.deepEqual(await choosePager({...env, PAGER: 'mypager --plain'}, []), {binary: join(box.bin, 'mypager'), args: ['--plain'], name: 'mypager'});
    assert.equal((await choosePager({...env, PAGER: 'cat'}, []))?.name, 'less', 'NMSh shells set PAGER=cat; that never pages');
    assert.equal((await choosePager({...env, PAGER: 'mypager | sh'}, []))?.name, 'less', 'a PAGER that needs a shell is not run');
    assert.equal((await choosePager({...env, PAGER: join(box.bin, 'mypager')}, []))?.binary, join(box.bin, 'mypager'));
    // A pager inside the current workspace is never run, even when it shadows a trusted one.
    const workspace = join(box.root, 'repo');
    mkdirSync(join(workspace, 'bin'), {recursive: true});
    fakePager(join(workspace, 'bin'), 'less', record);
    assert.equal(await choosePager({PATH: join(workspace, 'bin')}, [workspace]), undefined, 'the workspace less is refused and there is no other pager');
    fakePager(box.bin, 'more', record);
    assert.equal((await choosePager({PATH: `${join(workspace, 'bin')}:${box.bin}`}, [workspace]))?.binary, join(box.bin, 'more'));
    assert.equal(await choosePager({PATH: 'bin:.'}, []), undefined, 'relative PATH entries are never searched');
  } finally { box.done(); }
});

test('workspace roots: the cwd and repository, never a directory holding the home directory', () => {
  const box = sandbox();
  try {
    const home = join(box.root, 'home');
    const app = join(home, 'src', 'app');
    mkdirSync(join(app, 'lib'), {recursive: true});
    assert.deepEqual(workspaceRoots(join(app, 'lib'), app, home), [join(app, 'lib'), app]);
    assert.deepEqual(workspaceRoots(home, undefined, home), [], 'the home directory holds the user\'s own tools (~/.cargo/bin, ~/.local/bin)');
    assert.deepEqual(workspaceRoots(box.root, undefined, home), [], 'nor does any directory above it');
    assert.deepEqual(workspaceRoots('/', undefined, home), [], 'the filesystem root is not a workspace');
    const outside = join(box.root, 'checkout');
    mkdirSync(outside);
    assert.deepEqual(workspaceRoots(outside, outside, home), [outside], 'a checkout outside home is a workspace too');
    assert.deepEqual(workspaceRoots('relative', undefined, home), []);
  } finally { box.done(); }
});

test('workspace roots follow symlinks: a workspace reached through a link still refuses its own executables', async () => {
  const box = sandbox();
  try {
    const home = join(box.root, 'home');
    const repo = join(home, 'evil');
    mkdirSync(join(repo, 'bin'), {recursive: true});
    fakePager(join(repo, 'bin'), 'less', join(box.root, 'ran.json'));
    const link = join(box.root, 'link');
    symlinkSync(repo, link);
    const roots = workspaceRoots(link, link, home);
    assert.deepEqual(roots, [link, repo]);
    assert.equal(await choosePager({PATH: join(repo, 'bin')}, roots), undefined, 'the real path of the linked workspace is refused');
    assert.deepEqual(workspaceRoots(home, undefined, home), []);
    const homeLink = join(box.root, 'home-link');
    symlinkSync(home, homeLink);
    assert.deepEqual(workspaceRoots(join(homeLink, 'evil'), undefined, homeLink), [join(homeLink, 'evil'), repo], 'a linked home is the same home');
  } finally { box.done(); }
});

test('pager text: control characters become visible, tabs and lines stay, the command comes first', () => {
  assert.equal(pagerText('a\u001b]0;pwned\u0007b'), 'a^[]0;pwned^Gb');
  assert.equal(pagerText('csi\u009b31m\u007f'), 'csi<9B>31m^?');
  assert.equal(pagerText('x\ty\r\nz\rw'), 'x\ty\nz^Mw');
  assert.equal(pagerDocument('echo "$(id)"', 'out\nmore'), 'echo "$(id)"\nout\nmore\n');
  assert.equal(pagerDocument('true', ''), 'true\n');
});

test('the block reaches the pager only on stdin: no shell, no interpolation, no input preprocessor', async () => {
  const box = sandbox();
  try {
    const record = join(box.root, 'record.json');
    const pwned = join(box.root, 'pwned');
    const pager = {binary: fakePager(box.bin, 'less', record), args: ['-X'], name: 'less'};
    const command = `echo "$(touch ${pwned})" \`touch ${pwned}\``;
    const output = `'; touch ${pwned}; '\n\u001b]8;;file:///etc/passwd\u0007link\u001b]8;;\u0007\n${'x'.repeat(200_000)}`;
    const env = pagerProcessEnvironment({PATH: box.bin, LESSOPEN: `|- touch ${pwned} %s`, LESSCLOSE: 'x'}, {LESS_TERMCAP_md: '\u001b[1m'});
    assert.deepEqual(await runPager(pager, pagerDocument(command, output), env), {ok: true});
    const seen = JSON.parse(readFileSync(record, 'utf8')) as {argv: string[]; stdin: string; lessopen: string | null; termcap: string | null};
    assert.deepEqual(seen.argv, ['-X']);
    assert.equal(seen.stdin, pagerDocument(command, output), 'the complete text, exactly');
    assert.ok(!/[\u001b\u0007]/u.test(seen.stdin), 'no escape sequence reaches the pager or the terminal');
    assert.equal(seen.lessopen, null, 'LESSOPEN would run on the block text');
    assert.equal(seen.termcap, '\u001b[1m', 'Theme Bridge pager colors apply to the pager NMSh opens');
    assert.equal(existsSync(pwned), false, 'nothing in the command or output was executed');
  } finally { box.done(); }
});

test('a pager that quits early, fails or is cancelled ends cleanly', async () => {
  const box = sandbox();
  try {
    const early = {binary: fakePager(box.bin, 'quick', join(box.root, 'quick.json'), 'process.exit(0);'), args: [], name: 'quick'};
    assert.deepEqual(await runPager(early, 'y\n'.repeat(2_000_000), {PATH: box.bin}), {ok: true}, 'a closed pipe is not an error');
    const failing = {binary: fakePager(box.bin, 'broken', join(box.root, 'broken.json'), 'process.exit(3);'), args: [], name: 'broken'};
    assert.deepEqual(await runPager(failing, 'x\n', {PATH: box.bin}), {ok: false, reason: 'broken exited with 3'});
    const slow = {binary: fakePager(box.bin, 'slow', join(box.root, 'slow.json'), 'setTimeout(() => {}, 60_000);'), args: [], name: 'slow'};
    const controller = new AbortController();
    const running = runPager(slow, 'x\n', {PATH: box.bin}, controller.signal);
    setTimeout(() => controller.abort(), 50);
    assert.deepEqual(await running, {ok: false, reason: 'cancelled'});
    assert.deepEqual(await runPager({binary: join(box.bin, 'missing'), args: [], name: 'missing'}, 'x', {}), {ok: false, reason: `missing could not start: spawn ${join(box.bin, 'missing')} ENOENT`});
  } finally { box.done(); }
});

test('app: Open in pager hands the host terminal over and back, with the stored block on stdin', async () => {
  assert.ok(BLOCK_ACTIONS.some(action => action.id === 'pager'));
  const box = sandbox();
  const app = new TerminalApp();
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const raw = process.stdin.setRawMode, pause = process.stdin.pause, resume = process.stdin.resume;
  const pager = process.env.PAGER;
  const events: string[] = [];
  Object.defineProperty(app, 'render', {value: () => {}});
  try {
    const output = app['output'];
    output.beginCommand('printf hostile', ['printf hostile']);
    output.write('first\n\u001b]0;title\u0007second\n');
    output.complete(0);
    const record = output.recent(1)!;
    // Without a terminal of its own, NMSh says so instead of taking one.
    await app['runBlockAction'](record.startId, 'pager');
    assert.match(output.wrapped(120).map(row => row.plain).join('\n'), /Open in pager\n.*needs a free interactive terminal/u);
    Object.defineProperty(process.stdin, 'isTTY', {value: true, configurable: true});
    Object.defineProperty(process.stdout, 'isTTY', {value: true, configurable: true});
    process.stdin.setRawMode = ((value: boolean) => { events.push(`raw:${value}`); return process.stdin; });
    process.stdin.pause = (() => process.stdin);
    process.stdin.resume = (() => process.stdin);
    app['renderer'].enter = () => { events.push('enter'); };
    app['renderer'].leave = () => { events.push('leave'); };
    app['renderer'].invalidate = () => {};
    const seen = join(box.root, 'seen.json');
    process.env.PAGER = fakePager(box.bin, 'mypager', seen);
    app['promptConfiguration'].themeBridge = {...app['promptConfiguration'].themeBridge, enabled: true, policy: 'follow'};
    await app['runBlockAction'](record.startId, 'pager');
    const result = JSON.parse(readFileSync(seen, 'utf8')) as {stdin: string; termcap: string | null};
    assert.equal(result.stdin, pagerDocument(record.command, record.output));
    assert.ok(result.termcap, 'Apply themes: Follow NMSh colors the pager NMSh opens');
    assert.deepEqual(events, ['raw:false', 'leave', 'enter', 'raw:true']);
    assert.equal(app['externalPassthrough'], false);
    process.stdin.off('data', app['onInput']);
  } finally {
    if (pager === undefined) delete process.env.PAGER; else process.env.PAGER = pager;
    if (stdinTTY) Object.defineProperty(process.stdin, 'isTTY', stdinTTY); else delete (process.stdin as {isTTY?: boolean}).isTTY;
    if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY); else delete (process.stdout as {isTTY?: boolean}).isTTY;
    process.stdin.setRawMode = raw; process.stdin.pause = pause; process.stdin.resume = resume;
    app['stop'](0); app['session'].kill();
    box.done();
  }
});

