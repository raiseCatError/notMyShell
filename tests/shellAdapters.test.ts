import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {connect, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShellSession} from '../src/shell/ShellSession.js';
import {shellAdapter, shellAvailability} from '../src/shell/adapters/registry.js';
import {fishQuote, isShellId, knowledgeJobCount, posixQuote, SHELL_IDS, type ShellId} from '../src/shell/adapters/ShellAdapter.js';
import {parseFishCompletions, parseFishHistory, fishAdapter} from '../src/shell/adapters/FishAdapter.js';
import {parseBashHistory, bashAdapter} from '../src/shell/adapters/BashAdapter.js';
import {zshAdapter} from '../src/shell/adapters/ZshAdapter.js';
import {parseShellKnowledge, classifyShellFailure} from '../src/shell/ShellKnowledge.js';
import {PathClassifier} from '../src/shell/PathClassifier.js';
import {SessionService} from '../src/session/SessionService.js';
import {FrameDecoder, encodeMessage, PROTOCOL_VERSION, type ServerMessage} from '../src/session/SessionProtocol.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {createShellPanel, shellPanelKey} from '../src/shell/ShellPanel.js';
import type {ShellMarker} from '../src/shell/ShellProtocol.js';

const available = (id: ShellId) => Boolean(shellAdapter(id).resolveExecutable(process.env));
const scratch = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) { if (Date.now() > deadline) throw new Error('condition not reached'); await new Promise(resolve => setTimeout(resolve, 25)); }
}

test('adapter contract: ids, quoting, capabilities declared honestly, nothing installed', () => {
  assert.deepEqual(SHELL_IDS, ['zsh', 'fish', 'bash']);
  assert.equal(isShellId('nu'), false);
  for (const id of SHELL_IDS) {
    const adapter = shellAdapter(id);
    assert.equal(adapter.id, id);
    assert.ok(adapter.capabilities.privateHistory.length > 10);
    assert.ok(adapter.builtins.has('cd'));
  }
  assert.equal(bashAdapter.capabilities.completionDescriptions, false, 'Bash completion has no descriptions; not faked');
  assert.equal(fishAdapter.editorChrome, 'prompt-to-exec');
  assert.equal(zshAdapter.editorChrome, 'none');
  assert.equal(posixQuote("it's"), `'it'\\''s'`);
  assert.equal(fishQuote("a\\b'c"), `'a\\\\b\\'c'`);
  assert.equal(knowledgeJobCount('alias x\njobs 2\ncomplete\n'), 2);
  assert.equal(knowledgeJobCount('complete\n'), undefined);
  const none = shellAvailability({PATH: '/nonexistent'});
  assert.match(none.find(item => item.adapter.id === 'fish')!.reason!, /Select it in \/shell to see how to install it/u);
  assert.deepEqual(parseSlashCommand('/shell fish'), {kind: 'shell', shell: 'fish'});
  assert.deepEqual(parseSlashCommand('/shell'), {kind: 'shell'});
  assert.equal(parseSlashCommand('/shell nu')?.kind, 'unknown');
  assert.equal(normalizePromptConfiguration({shellBackend: 'nu'}).shellBackend, 'zsh');
  assert.equal(normalizePromptConfiguration({shellBackend: 'fish'}).shellBackend, 'fish');
});

test('history, completion and knowledge parsers for Fish and Bash', async () => {
  assert.deepEqual(parseFishHistory('- cmd: echo a\\nb\n  when: 1700000000\n  paths:\n    - x\n- cmd:  secret\n  when: 1\n- cmd: c\\\\d\n'),
    [{command: 'echo a\nb', at: 1_700_000_000_000}, {command: 'c\\d'}]);
  assert.deepEqual(parseBashHistory('#1700000000\nls -la\n echo private\nmake\n'), [{command: 'ls -la', at: 1_700_000_000_000}, {command: 'make'}]);
  const context = {buffer: 'git ch', cwd: '/', cursor: 6};
  const parsed = parseFishCompletions('checkout\tSwitch branches\ncherry-pick\nbad\u001bvalue\tx\n', context, {start: 4, end: 6});
  assert.deepEqual(parsed.map(item => [item.value, item.description, item.insertion]), [['checkout', 'Switch branches', 'git checkout'], ['cherry-pick', '', 'git cherry-pick']]);
  const names = parseShellKnowledge('jobs 0\nfunction ll\nalias gco\nbuiltin cd\nbuiltin ll\ncomplete\n');
  assert.deepEqual([...names], [['ll', 'function'], ['gco', 'alias'], ['cd', 'builtin']], 'alias > function > builtin precedence');
  assert.equal(classifyShellFailure('nosuch', 127, 'fish: Unknown command: nosuch\n'), 'command-not-found');
  assert.equal(classifyShellFailure('nosuch', 127, 'bash: nosuch: command not found\n'), 'command-not-found');
  assert.equal(classifyShellFailure('nosuch', 127, 'zsh: command not found: nosuch\n'), 'command-not-found', 'zsh unchanged');
  const classifier = new PathClassifier(fishAdapter, {PATH: '/usr/bin:/bin'});
  classifier.applyShellKnowledge('function ll\nalias gco\ncomplete\n');
  assert.equal(await classifier.classifyCommand('ll'), 'function');
  assert.equal(await classifier.classifyCommand('gco'), 'alias');
  assert.equal(await classifier.classifyCommand('string'), 'builtin');
  assert.equal(await classifier.classifyCommand('ls'), 'executable');
  assert.equal(await classifier.classifyCommand('definitely-not-a-command-xyz'), 'unknown');
});

interface Lifecycle { markers: ShellMarker[]; execs: Array<[string, number | undefined]>; output: string; shell: ShellSession; home: string }

async function startShell(id: ShellId): Promise<Lifecycle> {
  const home = scratch(`nmsh-adapter-${id}-`);
  mkdirSync(join(home, 'work'));
  const shell = new ShellSession(home, 100, 30, home, {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'}, id);
  const state: Lifecycle = {markers: [], execs: [], output: '', shell, home};
  shell.on('prompt', marker => state.markers.push(marker));
  shell.on('exec', (command, allowed) => state.execs.push([command, allowed]));
  shell.on('data', data => { state.output += data; });
  await once(shell, 'prompt');
  return state;
}

async function run(state: Lifecycle, command: string): Promise<ShellMarker> {
  const next = once(state.shell, 'prompt');
  state.shell.submit(command);
  const [marker] = await next as [ShellMarker];
  return marker;
}

for (const id of SHELL_IDS) {
  test(`${id}: real lifecycle — status, cwd, exec text, privacy flag, live names, jobs, raw output, no editor echo`, {skip: !available(id) && `${id} is not installed`, timeout: 60_000}, async () => {
    const state = await startShell(id);
    try {
      assert.equal((await run(state, "printf 'out-%d\\n' 42")).exitCode, 0);
      assert.match(state.output, /out-42/u);
      assert.doesNotMatch(state.output, /printf/u, 'the command line itself is never echoed into output');
      assert.doesNotMatch(state.output, /⏎/u, 'no shell missing-newline indicator');
      assert.deepEqual(state.execs[0], ["printf 'out-%d\\n' 42", 1]);
      const failed = await run(state, 'cd work && false');
      assert.equal(failed.exitCode, 1);
      assert.equal(failed.cwd, join(state.home, 'work'), 'cwd follows the real shell');
      const define = id === 'fish' ? 'function nmsh_live_fn; echo body-secret; end' : 'nmsh_live_fn() { echo body-secret; }';
      const marker = await run(state, define);
      assert.equal(parseShellKnowledge(marker.knowledge ?? '').get('nmsh_live_fn'), 'function');
      assert.doesNotMatch(marker.knowledge ?? '', /body-secret/u, 'names only, never bodies');
      const before = state.output.length;
      await run(state, `printf '\\033[?1049hFULL\\033[?1049l'`);
      assert.ok(state.output.slice(before).includes('\u001b[?1049hFULL\u001b[?1049l'), 'TUI bytes pass through raw');
      assert.doesNotMatch(state.output.slice(before), /\u001b\[\?2004l/u, 'editor mode chrome never reaches output');
      const background = await run(state, 'sleep 30 &');
      assert.equal(knowledgeJobCount(background.knowledge), 1, 'background jobs are reported');
      // Reap the killed job before the next prompt so the count cannot race the signal.
      await run(state, 'kill %1; wait');
      assert.equal(knowledgeJobCount(state.markers.at(-1)!.knowledge), 0);
      // Interrupt a foreground command through the PTY.
      const interrupted = once(state.shell, 'prompt');
      state.shell.submit('sleep 20');
      await until(() => state.execs.some(([command]) => command === 'sleep 20'));
      await new Promise(resolve => setTimeout(resolve, 200));
      state.shell.interrupt();
      const [stopped] = await interrupted as [ShellMarker];
      assert.notEqual(stopped.exitCode, 0);
    } finally { state.shell.kill(); rmSync(state.home, {recursive: true, force: true}); }
  });
}

test('fish: a leading space is private, and Fish completion feeds structured candidates', {skip: !available('fish') && 'fish is not installed', timeout: 60_000}, async () => {
  const state = await startShell('fish');
  try {
    await run(state, ' echo private-thing');
    assert.deepEqual(state.execs.at(-1), [' echo private-thing', 0]);
    const source = fishAdapter.completionSource();
    const results = await source.query({buffer: 'set --er', cwd: state.home, cursor: 8}, new AbortController().signal);
    assert.ok(results.some(item => item.value === '--erase' && item.description.length > 0), 'Fish descriptions come through');
    const commands = await source.query({buffer: 'stri', cwd: state.home, cursor: 4}, new AbortController().signal);
    assert.ok(commands.some(item => item.value === 'string' && item.kind === 'command'));
  } finally { state.shell.kill(); rmSync(state.home, {recursive: true, force: true}); }
});

test('bash: unrecorded lines are reported as not recorded; completion degrades honestly to names', {skip: !available('bash') && 'bash >= 4.4 is not installed', timeout: 60_000}, async () => {
  const state = await startShell('bash');
  try {
    await run(state, 'HISTCONTROL=ignorespace');
    await run(state, ' echo private-thing');
    assert.deepEqual(state.execs.at(-1), [' echo private-thing', 0], 'submitted text stands in; Bash did not record it');
    writeFileSync(join(state.home, 'alpha-file.txt'), '');
    const source = bashAdapter.completionSource();
    const files = await source.query({buffer: 'cat alpha', cwd: state.home, cursor: 9}, new AbortController().signal);
    assert.deepEqual(files.map(item => item.value), ['alpha-file.txt']);
    assert.equal(files[0]!.description, '');
    const commands = await source.query({buffer: 'ech', cwd: state.home, cursor: 3}, new AbortController().signal);
    assert.ok(commands.some(item => item.value === 'echo'));
  } finally { state.shell.kill(); rmSync(state.home, {recursive: true, force: true}); }
});

test('shell panel: unavailable shells are listed, not switchable; blocked sessions explain why; D sets the default only', () => {
  const shells = shellAvailability({PATH: '/nonexistent'}).map(item => (item.adapter.id === 'zsh' ? {...item, executable: '/bin/zsh', reason: undefined} : item));
  const state = createShellPanel(shells, 'zsh', 'zsh');
  shellPanelKey(state, {kind: 'down'});
  assert.equal(shellPanelKey(state, {kind: 'enter'}), undefined);
  assert.match(state.message ?? '', /not installed/u);
  const ready = createShellPanel(shellAvailability(process.env), 'zsh', 'zsh', 'Running: sleep');
  ready.selected = ready.shells.findIndex(item => item.executable && item.adapter.id !== 'zsh');
  if (ready.selected >= 0) {
    assert.equal(shellPanelKey(ready, {kind: 'enter'}), undefined, 'a blocked session never switches');
    assert.equal(ready.message, 'Running: sleep');
    assert.deepEqual(shellPanelKey(ready, {kind: 'text', value: 'd'}), {kind: 'default', shell: ready.shells[ready.selected]!.adapter.id});
  }
});

class Peer {
  readonly messages: ServerMessage[] = [];
  readonly socket: Socket;
  private readonly decoder = new FrameDecoder();
  constructor(path: string) {
    this.socket = connect(path);
    this.socket.setEncoding('utf8');
    this.socket.on('data', chunk => { for (const r of this.decoder.push(String(chunk))) if (r.ok) this.messages.push(r.message as ServerMessage); });
    this.socket.on('error', () => {});
    this.send({type: 'hello', version: PROTOCOL_VERSION, client: 'test'});
  }
  send(message: Parameters<typeof encodeMessage>[0]): void { this.socket.write(encodeMessage(message)); }
  mark(): number { return this.messages.length; }
  async next(predicate: (message: ServerMessage) => boolean, from = 0, timeoutMs = 20000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.slice(from).find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`message not received; got ${this.messages.slice(from).map(m => m.type).join(',')}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

test('hot swap in the service: zsh → fish → bash → zsh keeps session identity and cwd, ends old shells, guards jobs/running/unavailable, survives reattach',
  {skip: !(available('fish') && available('bash')) && 'fish and bash are both needed', timeout: 120_000}, async () => {
    const runtimeDir = scratch('nmsh-swap-'); chmodSync(runtimeDir, 0o700);
    const home = scratch('nmsh-swaph-');
    mkdirSync(join(home, 'project'));
    const service = new SessionService({runtimeDir, startupIdleMs: 60_000});
    await service.start();
    const keeper = new Peer(service.socketPath);
    let peer = new Peer(service.socketPath);
    try {
      const env = {HOME: home, PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', XDG_CONFIG_HOME: join(home, '.c'), XDG_DATA_HOME: join(home, '.d')};
      peer.send({type: 'create', cwd: home, env, columns: 80, rows: 24});
      const created = await peer.next(m => m.type === 'created');
      assert.equal(created.type === 'created' && created.shell, 'zsh', 'absent shell means zsh');
      const sessionId = created.type === 'created' ? created.sessionId : '';
      await peer.next(m => m.type === 'prompt');
      const prompt = async (command: string) => {
        const mark = peer.mark();
        peer.send({type: 'input', data: `${command}\r`, submission: 1});
        return peer.next(m => m.type === 'prompt', mark);
      };
      await prompt('cd project');
      const pids = [created.type === 'created' ? created.pid : 0];
      let cwd = join(home, 'project');

      // Guard: a background job would be ended by switching.
      await prompt('sleep 60 &');
      let mark = peer.mark();
      peer.send({type: 'switch-shell', shell: 'fish', cwd});
      const jobs = await peer.next(m => m.type === 'error', mark);
      assert.equal(jobs.type === 'error' && jobs.code, 'jobs');
      await prompt('kill %1; wait');
      await prompt('true');

      // Guard: a running command.
      mark = peer.mark();
      peer.send({type: 'input', data: 'sleep 5\r', submission: 1});
      await peer.next(m => m.type === 'exec', mark);
      mark = peer.mark();
      peer.send({type: 'switch-shell', shell: 'fish', cwd});
      const busy = await peer.next(m => m.type === 'error', mark);
      assert.equal(busy.type === 'error' && busy.code, 'busy');
      peer.send({type: 'input', data: '\u0003'});
      await peer.next(m => m.type === 'prompt', mark);

      for (const target of ['fish', 'bash', 'zsh'] as const) {
        mark = peer.mark();
        peer.send({type: 'switch-shell', shell: target, cwd});
        const switched = await peer.next(m => m.type === 'shell-switched' || m.type === 'error', mark);
        assert.equal(switched.type, 'shell-switched', JSON.stringify(switched));
        if (switched.type !== 'shell-switched') return;
        const ready = await peer.next(m => m.type === 'prompt', mark);
        assert.equal(ready.type === 'prompt' && ready.cwd, cwd, `${target} starts in the preserved cwd`);
        await until(() => !alive(pids.at(-1)!), 5000);
        pids.push(switched.pid);
        const listed = (await (async () => { const m = keeper.mark(); keeper.send({type: 'list'}); return keeper.next(x => x.type === 'sessions', m); })());
        const info = listed.type === 'sessions' ? listed.sessions.find(item => item.id === sessionId) : undefined;
        assert.equal(info?.shell, target, 'same session id, new backend');
        assert.equal(info?.pid, switched.pid);
        const out = await prompt(`echo running-in-${target}`);
        assert.equal(out.type === 'prompt' && out.exitCode, 0);
        assert.ok(peer.messages.some(m => m.type === 'output' && m.data.includes(`running-in-${target}`)));
        if (target === 'bash') {
          // Reattach after a switch: the backend and stream continue.
          peer.socket.destroy();
          await until(() => true);
          await new Promise(resolve => setTimeout(resolve, 100));
          peer = new Peer(service.socketPath);
          peer.send({type: 'attach', sessionId, columns: 80, rows: 24});
          const attached = await peer.next(m => m.type === 'attached');
          assert.equal(attached.type === 'attached' && attached.shell, 'bash');
          await peer.next(m => m.type === 'replayed');
          const again = await prompt('echo after-reattach');
          assert.equal(again.type === 'prompt' && again.exitCode, 0);
        }
        cwd = join(home, 'project');
      }

      // Unavailable shell: the session's own PATH has no fish.
      peer.socket.destroy();
      await new Promise(resolve => setTimeout(resolve, 100));
      const isolated = new Peer(service.socketPath);
      isolated.send({type: 'create', cwd: home, env: {...env, PATH: '/usr/bin/zsh-only-path-xyz'}, columns: 80, rows: 24, shell: 'zsh'});
      await isolated.next(m => m.type === 'prompt');
      mark = isolated.mark();
      isolated.send({type: 'switch-shell', shell: 'fish', cwd: home});
      const unavailable = await isolated.next(m => m.type === 'error', mark);
      assert.equal(unavailable.type === 'error' && unavailable.code, 'unavailable');
      assert.match(unavailable.type === 'error' ? unavailable.message : '', /in \/shell to see how to install/u);
      isolated.send({type: 'terminate'});
      for (const pid of pids.slice(0, -1)) assert.equal(alive(pid), false, 'no orphan shell survives a switch');
    } finally {
      keeper.socket.destroy(); peer.socket.destroy();
      await service.close();
      rmSync(runtimeDir, {recursive: true, force: true});
      rmSync(home, {recursive: true, force: true});
    }
  });

test('zsh regression: the bootstrap keeps ZLE off, blanks prompts each cycle and composes hooks', () => {
  const dir = scratch('nmsh-zshboot-');
  try {
    const launch = zshAdapter.launch({home: '/h', env: {PATH: process.env.PATH}, token: 'T0K', stateDir: dir, knowledgePath: join(dir, '.nmsh-knowledge')});
    assert.deepEqual(launch.args, ['-i']);
    assert.deepEqual(launch.env, {ZDOTDIR: dir});
    const rc = readFileSync(join(dir, '.zshrc'), 'utf8');
    for (const invariant of ['unsetopt zle', "PROMPT=''", "RPROMPT=''", 'add-zsh-hook precmd nmsh_precmd', 'add-zsh-hook preexec nmsh_preexec',
      'export POWERLEVEL9K_DISABLE_PROMPT=true', '\\e]777;nmsh;T0K;exec2;', 'ZDOTDIR=/h source /h/.zshrc']) assert.ok(rc.includes(invariant), invariant);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
