import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openPicker, pickerInput, pickerSelection, runPicker} from '../src/pickers/Picker.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {resolveCommand} from '../src/providers/providers.js';

const candidates = [{id: 'secret-id', label: 'git\nstatus\u001b[31m', value: 'git status', description: '/work'},
  {id: 'other', label: 'echo hello', value: 'echo hello'}];

test('picker transport strips controls and accepts exactly one supplied row', () => {
  const input = pickerInput(candidates);
  assert.doesNotMatch(input.replace(/\n|\t/gu, ''), /[\u0000-\u001f\u007f-\u009f]/u);
  assert.deepEqual(pickerSelection(input.split('\n')[1]! + '\n', candidates), {kind: 'selected', candidate: candidates[1]});
  for (const output of ['99\tfake\n', '0\tarbitrary command\n', input, '', '01\techo hello\n'])
    assert.equal(pickerSelection(output, candidates).kind, 'fallback');
});

test('native defaults, explicit provider choices and missing providers fall back without handoff', async () => {
  assert.equal(normalizePromptConfiguration({}).picker, 'native');
  assert.equal(normalizePromptConfiguration({picker: 'fzf'}).picker, 'fzf');
  assert.equal(normalizePromptConfiguration({picker: 'television'}).picker, 'television');
  assert.equal(normalizePromptConfiguration({picker: 'invalid'}).picker, 'native');
  let native = 0;
  const handoff = async () => { throw new Error('must not hand off'); };
  await openPicker('native', candidates, () => native++, handoff);
  const result = await openPicker('television', candidates, () => native++, handoff, {PATH: ''});
  assert.equal(result?.kind, 'fallback');
  assert.equal(native, 2);
});

test('external pickers receive inert rows, isolated configuration, bounded cancellation and known selection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-picker-test-'));
  const binary = join(directory, 'picker');
  try {
    await writeFile(binary, `#!${process.execPath}\nlet text='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>text+=s);process.stdin.on('end',()=>{\nif(Object.keys(process.env).some(k=>k.startsWith('FZF_')||k.startsWith('TV_')))process.exit(2);\nif(process.argv.includes('--config-file') && process.env.XDG_CONFIG_HOME===process.env.ORIGINAL_CONFIG)process.exit(2);\nprocess.stdout.write(text.split('\\n')[1]+'\\n');});\n`, {mode: 0o700});
    const environment = {...process.env, FZF_DEFAULT_OPTS: '--bind=enter:execute(touch unsafe)', TV_CONFIG: 'unsafe',
      ORIGINAL_CONFIG: '/unsafe', XDG_CONFIG_HOME: '/unsafe'};
    for (const provider of ['fzf', 'television'] as const)
      assert.deepEqual(await runPicker(binary, provider, candidates, new AbortController().signal, environment),
        {kind: 'selected', candidate: candidates[1]});
    await writeFile(binary, `#!${process.execPath}\nprocess.stdin.resume();setInterval(()=>{},1000);\n`, {mode: 0o700});
    const controller = new AbortController();
    const pending = runPicker(binary, 'fzf', candidates, controller.signal);
    setTimeout(() => controller.abort(), 50);
    assert.equal((await pending).kind, 'cancelled');
    assert.equal((await runPicker(binary, 'fzf', candidates, new AbortController().signal, process.env, 50)).kind, 'fallback');
    assert.equal((await runPicker('/missing/picker', 'fzf', candidates, new AbortController().signal)).kind, 'fallback');
    assert.equal((await runPicker(binary, 'fzf', [{id: 'large', label: 'x'.repeat(17 * 1024 * 1024), value: ''}], new AbortController().signal)).kind, 'fallback');
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('picker terminal ownership restores renderer, raw input and listeners on accept, cancel, resize and error', async () => {
  const app = new TerminalApp();
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const raw = process.stdin.setRawMode;
  const pause = process.stdin.pause;
  const resume = process.stdin.resume;
  const events: string[] = [];
  Object.defineProperty(process.stdin, 'isTTY', {value: true, configurable: true});
  Object.defineProperty(process.stdout, 'isTTY', {value: true, configurable: true});
  process.stdin.setRawMode = ((value: boolean) => { events.push(`raw:${value}`); return process.stdin; });
  process.stdin.pause = (() => process.stdin);
  process.stdin.resume = (() => process.stdin);
  app['renderer'].enter = () => { events.push('enter'); };
  app['renderer'].leave = () => { events.push('leave'); };
  app['renderer'].invalidate = () => {};
  Object.defineProperty(app, 'render', {value: () => {}});
  const signals = process.listenerCount('SIGWINCH');
  try {
    for (const kind of ['selected', 'cancelled', 'resize', 'error'] as const) {
      events.length = 0;
      const result = await app['pickerHandoff'](async signal => {
        assert.equal(app['externalPassthrough'], true);
        if (kind === 'resize') { process.emit('SIGWINCH'); assert.equal(signal.aborted, true); }
        if (kind === 'error') throw new Error('provider failed');
        return kind === 'selected' ? {kind, candidate: candidates[0]!} : {kind: 'cancelled'};
      });
      assert.equal(result.kind, kind === 'error' ? 'fallback' : kind === 'resize' ? 'cancelled' : kind);
      assert.deepEqual(events, ['raw:false', 'leave', 'enter', 'raw:true']);
      assert.equal(app['externalPassthrough'], false);
      assert.equal(process.listenerCount('SIGWINCH'), signals);
      process.stdin.off('data', app['onInput']);
    }
  } finally {
    if (stdinTTY) Object.defineProperty(process.stdin, 'isTTY', stdinTTY); else delete (process.stdin as {isTTY?: boolean}).isTTY;
    if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY); else delete (process.stdout as {isTTY?: boolean}).isTTY;
    process.stdin.setRawMode = raw; process.stdin.pause = pause; process.stdin.resume = resume;
    app['stop'](0); app['session'].kill();
  }
});

test('history picker restores only the editor and cancelled selection preserves the buffer', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  const submitted: string[] = [];
  app['session'].submit = ((text: string) => submitted.push(text)) as never;
  try {
    app['editor'].insert('draft');
    await app['openHistoryPicker']('');
    assert.equal(app['editor'].text, '/history ');
    assert.deepEqual(submitted, []);
  } finally { app['stop'](0); app['session'].kill(); }
});

test('installed fzf preserves the original supplied row through display transforms', async t => {
  const fzf = resolveCommand('fzf');
  if (!fzf) { t.skip('fzf is optional'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-fzf-test-'));
  const wrapper = join(directory, 'filtered-fzf');
  try {
    // Noninteractive filter mode verifies the installed binary's transport, not physical terminal behavior.
    await writeFile(wrapper, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const child=spawn(${JSON.stringify(fzf)}, [...process.argv.slice(2), '--filter=echo'], {stdio:'inherit',env:process.env});child.on('exit',code=>process.exit(code??2));\n`, {mode: 0o700});
    assert.deepEqual(await runPicker(wrapper, 'fzf', candidates, new AbortController().signal), {kind: 'selected', candidate: candidates[1]});
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('history picker ignores a query result if typing or command execution moved on', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  let complete!: (entries: never[]) => void;
  app['promptConfiguration'].picker = 'fzf';
  app['historyService'].search = () => new Promise(resolve => { complete = resolve; });
  try {
    app['editor'].insert('draft');
    const pending = app['openHistoryPicker']('');
    app['editor'].insert(' changed');
    complete([]); await pending;
    assert.equal(app['editor'].text, 'draft changed');
    assert.equal(app['externalPassthrough'], false);
  } finally { app['stop'](0); app['session'].kill(); }
});
