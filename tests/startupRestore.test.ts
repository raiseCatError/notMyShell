import test from 'node:test';
import assert from 'node:assert/strict';
import {planLaunch} from '../src/session/liveSessions.js';
import {createMultiPicker, multiPickerKey, renderMultiPicker, renderSinglePrompt, singlePromptKey} from '../src/session/StartupPicker.js';
import {restoreAtStartup, type StartupRestoreDeps} from '../src/session/startupRestore.js';
import {GHOSTTY_NEW_WINDOW_SCRIPT, detectTerminalHost, openWindows, shellQuote, type TerminalHost} from '../src/host/terminalHost.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import type {SessionInfo} from '../src/session/SessionProtocol.js';
import type {Key} from '../src/terminal/keys.js';

const info = (id: string, state: SessionInfo['state'], extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({id, pid: 100, state, cwd: `/w/${id}`, createdAt: 1_000, ...extra});
const text = (value: string): Key => ({kind: 'text', value});
const key = (kind: string): Key => ({kind} as Key);

test('settings default to Ask/Ask and reject unknown values', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.liveSessionStartup, 'ask');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.liveSessionMultiple, 'ask');
  const loaded = normalizePromptConfiguration({liveSessionStartup: 'never', liveSessionMultiple: 'open-all'});
  assert.equal(loaded.liveSessionStartup, 'never');
  assert.equal(loaded.liveSessionMultiple, 'open-all');
  const bogus = normalizePromptConfiguration({liveSessionStartup: 'kill', liveSessionMultiple: 'kill-all'});
  assert.equal(bogus.liveSessionStartup, 'ask');
  assert.equal(bogus.liveSessionMultiple, 'ask');
});

test('launch plan follows the two settings; attached sessions are never candidates', () => {
  const one = [info('a', 'attached'), info('b', 'detached')];
  const two = [info('old', 'detached', {createdAt: 1}), info('a', 'attached'), info('new', 'detached', {createdAt: 9})];
  assert.deepEqual(planLaunch([]), {kind: 'new'});
  assert.deepEqual(planLaunch([info('a', 'attached')]), {kind: 'new'});
  assert.deepEqual(planLaunch(one), {kind: 'ask', session: info('b', 'detached')}, 'Ask is the default: no silent attach');
  assert.deepEqual(planLaunch(one, {startup: 'always', multiple: 'ask'}), {kind: 'attach', sessions: [info('b', 'detached')]});
  assert.deepEqual(planLaunch(one, {startup: 'never', multiple: 'open-all'}), {kind: 'new'});
  assert.deepEqual(planLaunch(two, {startup: 'never', multiple: 'open-all'}), {kind: 'new'});
  const pick = planLaunch(two);
  assert.deepEqual(pick.kind === 'pick' && pick.sessions.map(session => session.id), ['new', 'old']);
  const all = planLaunch(two, {startup: 'ask', multiple: 'open-all'});
  assert.deepEqual(all.kind === 'attach' && all.sessions.map(session => session.id), ['new', 'old']);
  assert.equal(planLaunch(two, {startup: 'always', multiple: 'ask'}).kind, 'pick');
});

test('one-session prompt: identifying details, and R/Enter, N/Esc, A, D; no destructive key', () => {
  const session = info('a', 'detached', {cwd: '/w/project', running: 'vim notes.md', runningSince: 1_000});
  const lines = renderSinglePrompt(session, 100, 181_000).join('\n');
  assert.match(lines, /1 detached live session/);
  assert.match(lines, /\/w\/project/);
  assert.match(lines, /running vim notes\.md · 3m/);
  assert.doesNotMatch(lines, /kill/i);
  assert.equal(singlePromptKey(key('enter')), 'resume');
  assert.equal(singlePromptKey(text('r')), 'resume');
  assert.equal(singlePromptKey(text('N')), 'not-now');
  assert.equal(singlePromptKey(key('escape')), 'not-now');
  assert.equal(singlePromptKey(key('interrupt')), 'not-now');
  assert.equal(singlePromptKey(text('a')), 'always');
  assert.equal(singlePromptKey(text('d')), 'never');
  assert.equal(singlePromptKey(text('k')), undefined);
  assert.equal(singlePromptKey(key('down')), undefined);
});

test('multi picker: move, Space toggles, A selects all then clears, Enter resumes selected in order, Esc none', () => {
  const sessions = [info('s1', 'detached'), info('s2', 'detached', {running: 'npm test'}), info('s3', 'detached')];
  const state = createMultiPicker(sessions);
  assert.match(renderMultiPicker(state, 100, 61_000).join('\n'), /3 detached live sessions[\s\S]*› \[ \] \/w\/s1[\s\S]*npm test/);
  assert.equal(multiPickerKey(state, key('down')), undefined);
  multiPickerKey(state, text(' '));
  multiPickerKey(state, key('down'));
  multiPickerKey(state, text(' '));
  multiPickerKey(state, text(' ')); // toggled back off
  assert.match(renderMultiPicker(state, 100, 61_000).join('\n'), /\[x\] \/w\/s2[\s\S]*Enter resume 1/);
  multiPickerKey(state, key('up'));
  multiPickerKey(state, key('up'));
  multiPickerKey(state, text(' '));
  assert.deepEqual(multiPickerKey({...state, selected: new Set(state.selected)}, key('enter')), ['s1', 's2']);
  multiPickerKey(state, text('a'));
  assert.equal(state.selected.size, 3);
  multiPickerKey(state, text('A'));
  assert.equal(state.selected.size, 0, 'A again clears everything');
  assert.deepEqual(multiPickerKey(state, key('enter')), [], 'Enter with nothing selected resumes none');
  multiPickerKey(state, text('a'));
  assert.deepEqual(multiPickerKey(state, key('escape')), [], 'Esc resumes none even with a selection');
  assert.equal(multiPickerKey(state, text('k')), undefined, 'no destructive key');
});

test('host detection only offers new windows where the host supports it', () => {
  const ghosttyMac = detectTerminalHost({TERM_PROGRAM: 'ghostty'}, 'darwin');
  assert.deepEqual(ghosttyMac.newWindow?.(['/n/node', '/n/i.js', '--attach', 'x']),
    {command: 'osascript', args: [...GHOSTTY_NEW_WINDOW_SCRIPT.flatMap(line => ['-e', line]), '/n/node', '/n/i.js', '--attach', 'x']});
  assert.deepEqual(detectTerminalHost({TERM_PROGRAM: 'ghostty'}, 'linux').newWindow?.(['nmsh']), {command: 'ghostty', args: ['-e', 'nmsh']});
  const terminal = detectTerminalHost({TERM_PROGRAM: 'Apple_Terminal'}, 'darwin').newWindow?.(['/a b/node', "it's"]);
  assert.equal(terminal?.command, 'osascript');
  assert.equal(terminal?.args[1], `tell application "Terminal" to do script "'/a b/node' 'it'\\\\''s'"`);
  assert.equal(detectTerminalHost({KITTY_WINDOW_ID: '1', TERM_PROGRAM: ''}, 'linux').newWindow?.(['x'])?.command, 'kitten');
  assert.equal(detectTerminalHost({TERM_PROGRAM: 'vscode'}, 'darwin').newWindow, undefined);
  assert.equal(detectTerminalHost({TERM_PROGRAM: 'zed'}, 'darwin').newWindow, undefined);
  assert.equal(detectTerminalHost({}, 'darwin').newWindow, undefined);
  assert.equal(shellQuote('/plain/path'), '/plain/path');
  assert.equal(shellQuote('a b'), "'a b'");
});

test('Ghostty on macOS opens windows in the running app through its AppleScript API, with data only in argv', async () => {
  const script = GHOSTTY_NEW_WINDOW_SCRIPT.join('\n');
  assert.match(script, /^on run argv$/m);
  assert.match(script, /quoted form of \(word_ as text\)/, 'each word is shell-quoted by AppleScript');
  assert.match(script, /tell application "Ghostty"\nset cfg to new surface configuration\nset command of cfg to commandLine\nnew window with configuration cfg/);
  assert.doesNotMatch(script, /open -na|Ghostty\.app/, 'never a separate app instance');

  const host = detectTerminalHost({TERM_PROGRAM: 'ghostty'}, 'darwin');
  const hostile = ['/Apps/My "NMSh"/node', "it's; rm -rf ~", '--attach', 'id"\ntell application "Finder" to quit'];
  const launch = host.newWindow!(hostile);
  const scriptArgs = launch.args.slice(0, GHOSTTY_NEW_WINDOW_SCRIPT.length * 2);
  assert.deepEqual(launch.args.slice(scriptArgs.length), hostile, 'values are passed through untouched as argv');
  for (const value of hostile) assert.ok(!scriptArgs.some(arg => arg.includes(value)), 'no value is interpolated into the script');

  const calls: string[][] = [];
  const ok = await openWindows(host, [['node', 'nmsh', '--attach', 's2']], async (command, args) => { calls.push([command, ...args]); return true; });
  assert.deepEqual(ok, []);
  assert.equal(calls[0]![0], 'osascript');
  assert.deepEqual(calls[0]!.slice(-4), ['node', 'nmsh', '--attach', 's2']);

  // AppleScript disabled, Automation denied, or Ghostty refusing: osascript exits non-zero.
  const denied = await openWindows(host, [['node', 'nmsh', '--attach', 's2']], async () => false);
  assert.deepEqual(denied, [['node', 'nmsh', '--attach', 's2']], 'the session is reported back, not lost');
});

test('a denied Ghostty launch leaves the session detached and names its attach command', async () => {
  const live = [info('s1', 'detached', {createdAt: 2}), info('s2', 'detached', {createdAt: 1})];
  const result = await restoreAtStartup(live, deps({policy: {startup: 'ask', multiple: 'open-all'},
    host: detectTerminalHost({TERM_PROGRAM: 'ghostty'}, 'darwin'), spawner: async command => command !== 'osascript'}));
  assert.equal(result.target, 's1');
  assert.match(result.notice ?? '', /could not be opened in new Ghostty windows; they keep running[\s\S]*nmsh --attach s2/);
});

test('openWindows reports every command it could not open, without real GUI windows', async () => {
  const calls: string[][] = [];
  const host: TerminalHost = {name: 'Fake', newWindow: argv => ({command: 'launch', args: [...argv]})};
  const failed = await openWindows(host, [['a'], ['b'], ['c']], async (command, args) => { calls.push([command, ...args]); return args[0] !== 'b'; });
  assert.deepEqual(calls, [['launch', 'a'], ['launch', 'b'], ['launch', 'c']]);
  assert.deepEqual(failed, [['b']]);
  assert.deepEqual(await openWindows({name: 'None'}, [['a']], async () => { throw new Error('never called'); }), [['a']]);
});

function deps(overrides: Partial<StartupRestoreDeps> = {}) {
  const saved: string[] = [];
  const spawned: string[][] = [];
  const result: StartupRestoreDeps & {saved: string[]; spawned: string[][]} = {
    saved, spawned,
    policy: {startup: 'ask', multiple: 'ask'},
    saveStartup: startup => saved.push(startup),
    askOne: async () => { throw new Error('unexpected prompt'); },
    pick: async () => { throw new Error('unexpected picker'); },
    host: {name: 'Ghostty', newWindow: argv => ({command: 'open', args: [...argv]})},
    selfCommand: ['node', '/nmsh/index.js'],
    spawner: async (_command, args) => { spawned.push(args); return true; },
    ...overrides,
  };
  return result;
}

test('one detached session: Resume, Not now, Always and Never; Never ends nothing', async () => {
  const live = [info('only', 'detached')];
  assert.deepEqual(await restoreAtStartup(live, deps({askOne: async () => 'resume'})), {target: 'only'});
  assert.deepEqual(await restoreAtStartup(live, deps({askOne: async () => 'not-now'})), {});
  const always = deps({askOne: async () => 'always'});
  assert.deepEqual(await restoreAtStartup(live, always), {target: 'only'});
  assert.deepEqual(always.saved, ['always']);
  const never = deps({askOne: async () => 'never'});
  assert.deepEqual(await restoreAtStartup(live, never), {});
  assert.deepEqual(never.saved, ['never']);
  assert.deepEqual(never.spawned, []);
  // With the settings saved, later launches do not ask.
  assert.deepEqual(await restoreAtStartup(live, deps({policy: {startup: 'always', multiple: 'ask'}})), {target: 'only'});
  assert.deepEqual(await restoreAtStartup(live, deps({policy: {startup: 'never', multiple: 'ask'}})), {});
  assert.deepEqual(await restoreAtStartup([], deps()), {});
});

test('several sessions: this window takes the first chosen, others open in new host windows', async () => {
  const live = [info('s1', 'detached', {createdAt: 3}), info('s2', 'detached', {createdAt: 2}), info('s3', 'detached', {createdAt: 1}), info('busy', 'attached')];
  const picked = deps({pick: async sessions => { assert.deepEqual(sessions.map(s => s.id), ['s1', 's2', 's3']); return ['s1', 's3']; }});
  assert.deepEqual(await restoreAtStartup(live, picked), {target: 's1'});
  assert.deepEqual(picked.spawned, [['node', '/nmsh/index.js', '--attach', 's3']], 'only the selected, never the attached one');

  assert.deepEqual(await restoreAtStartup(live, deps({pick: async () => []})), {}, 'Esc / none: start fresh');

  const all = deps({policy: {startup: 'ask', multiple: 'open-all'}});
  assert.deepEqual(await restoreAtStartup(live, all), {target: 's1'});
  assert.deepEqual(all.spawned.map(args => args.at(-1)), ['s2', 's3']);
});

test('hosts that cannot open windows lose nothing: one attaches here, the rest are named with their attach command', async () => {
  const live = [info('s1', 'detached', {createdAt: 2}), info('s2', 'detached', {createdAt: 1})];
  const unsupported = await restoreAtStartup(live, deps({policy: {startup: 'ask', multiple: 'open-all'}, host: {name: 'VS Code'}}));
  assert.equal(unsupported.target, 's1');
  assert.match(unsupported.notice ?? '', /1 more selected live session need their own windows, which NMSh cannot open in VS Code; they keep running/);
  assert.match(unsupported.notice ?? '', /nmsh --attach s2/);

  const failing = await restoreAtStartup(live, deps({policy: {startup: 'ask', multiple: 'open-all'}, spawner: async () => false}));
  assert.match(failing.notice ?? '', /could not be opened in new Ghostty windows[\s\S]*nmsh --attach s2/);
});
