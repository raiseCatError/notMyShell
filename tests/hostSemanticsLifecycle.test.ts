import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSemantics, osc133, osc7} from '../src/host/semanticMarks.js';
import {HostTitle, osc2, sanitizeTitle, titleSupport} from '../src/host/terminalTitle.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

const A = osc133('A'), B = osc133('B'), C = osc133('C');

function lifecycle() {
  const written: string[] = [];
  const flags = {owned: true, attached: true, replaying: false};
  const host = new HostSemantics({marks: true, cwd: true}, data => { written.push(data); }, () => flags.owned, 'host', {attached: () => flags.attached, replaying: () => flags.replaying});
  return {host, written, flags};
}

test('the command start is written at once, ahead of a program that takes the screen', () => {
  const {host, written, flags} = lifecycle();
  host.prompt('/w', 0);
  written.length = 0;
  flags.owned = false; // the command is a fullscreen program: NMSh no longer owns the screen…
  host.exec();
  assert.deepEqual(written, [C], '…but the host learns at once that a command runs (close confirmation, prompt navigation)');
  host.prompt('/w', 0);
  assert.equal(written.length, 1, 'prompt-time markers still wait for the screen');
  flags.owned = true;
  host.flush();
  assert.deepEqual(written, [C, `${osc133('D', 0)}${A}${B}`]);
});

test('after a program owned the screen (ssh, a nested shell), the directory is reported again', () => {
  const {host, written} = lifecycle();
  host.prompt('/w', 0);
  assert.ok(written.join('').includes(osc7('/w', 'host')!));
  host.exec();
  host.foreignScreen();
  written.length = 0;
  host.prompt('/w', 0);
  assert.ok(written.join('').includes(osc7('/w', 'host')!), 'same cwd, but the host may have been told another one');
  written.length = 0;
  host.exec(); host.prompt('/w', 0);
  assert.ok(!written.join('').includes(']7;'), 'otherwise unchanged directories are not repeated');
});

test('a reattach replay writes no history, then one coherent current state', () => {
  const {host, written, flags} = lifecycle();
  flags.replaying = true;
  for (const cwd of ['/a', '/b', '/c']) { host.prompt(cwd, 0); host.exec(); }
  host.prompt('/d', 1);
  host.exec();
  host.flush();
  assert.deepEqual(written, [], 'nothing historical reaches the host');
  flags.replaying = false;
  host.flush();
  assert.deepEqual(written, [`${osc7('/d', 'host')}${A}${B}${C}`], 'the current directory and the still-running command, once');
  written.length = 0;
  host.flush();
  assert.deepEqual(written, []);
});

test('titles: opt-in, sanitized, written only while NMSh owns the screen, re-asserted after programs, restored on exit', () => {
  const written: string[] = [];
  let owned = true;
  const title = new HostTitle({enabled: true, stack: true}, data => { written.push(data); }, () => owned);
  title.set(undefined);
  assert.deepEqual(written, [], 'Off writes nothing');
  title.set('notMyShell — Mango');
  assert.deepEqual(written, ['\u001b[22;2t', osc2('notMyShell — Mango')], 'the host title is pushed before the first write');
  title.set('notMyShell — Mango');
  assert.equal(written.length, 2, 'unchanged titles are not rewritten');
  owned = false;
  title.set('vim · notMyShell');
  assert.equal(written.length, 2, 'a program owning the screen owns the title');
  title.foreign();
  owned = true;
  title.set('notMyShell — Mango');
  assert.equal(written.at(-1), osc2('notMyShell — Mango'), 're-asserted after the program');
  title.end();
  assert.equal(written.at(-1), '\u001b[23;2t', 'the pushed title is restored on exit');
  const hostile = sanitizeTitle('repo\u001b]0;pwned\u0007\u202eexe\u009c' + 'x'.repeat(200));
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/u.test(hostile), 'no controls, terminators or bidi from directory names');
  assert.ok(hostile.length <= 81);
  assert.deepEqual(titleSupport({TERM: 'dumb'}), {enabled: false, stack: false});
  assert.deepEqual(titleSupport({NMSH_TITLE: '0', TERM_PROGRAM: 'ghostty'}), {enabled: false, stack: false});
  assert.equal(titleSupport({TERM_PROGRAM: 'ghostty'}).stack, false, 'no stack assumed where it is not known');
  const off: string[] = [];
  const plain = new HostTitle({enabled: true, stack: false}, data => { off.push(data); }, () => true);
  plain.set('x'); plain.set(undefined);
  assert.deepEqual(off, [osc2('x'), osc2('')], 'turning the setting Off clears NMSh\'s own title');
});

test('app: the title follows project, session and the running command, and never touches the screen in passthrough', () => {
  const app = new TerminalApp();
  try {
    const writes: string[] = [];
    app['hostTitle'] = new (app['hostTitle'].constructor as typeof HostTitle)({enabled: true, stack: false}, data => { writes.push(data); }, () => !app['passthrough']);
    app['promptConfiguration'].terminalTitle = 'project';
    app['context'] = {cwd: '/work/web', project: 'web'};
    assert.equal(app['desiredTitle'](), 'web');
    app['running'] = {command: 'npm test', startedAt: 0} as never;
    assert.equal(app['desiredTitle'](), 'npm · web', 'a transcript-mode command shows in the title');
    app['passthrough'] = true;
    assert.equal(app['desiredTitle'](), 'web', 'a passthrough program sets its own; NMSh shows only identity when it is back');
    app['hostTitle'].set(app['desiredTitle']());
    assert.deepEqual(writes, [], 'nothing is written while the program owns the screen');
    app['passthrough'] = false;
    app['promptConfiguration'].terminalTitle = 'off';
    assert.equal(app['desiredTitle'](), undefined);
  } finally { app['stop'](0); app['session'].kill(); }
});

test('settings export carries the Context Rail and the terminal title with the prompt and sessions', async () => {
  const {exportSettings} = await import('../src/configuration/portability.js');
  const {DEFAULT_PROMPT_CONFIGURATION} = await import('../src/prompt/configuration.js');
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.contextRail.rows = 2;
  config.terminalTitle = 'session';
  const document = JSON.stringify(exportSettings(config, ['prompt', 'sessions'], {version: '0.18.0', now: new Date(0)}));
  assert.match(document, /"contextRail":\{[^}]*"rows":2/u);
  assert.match(document, /"terminalTitle":"session"/u);
});
