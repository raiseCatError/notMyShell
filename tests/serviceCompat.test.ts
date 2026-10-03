import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {createServer, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionService} from '../src/session/SessionService.js';
import {OLDER_SERVICE_SWITCH, SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {decodeMessage, encodeMessage, FrameDecoder, parseFeatures, PROTOCOL_VERSION, SERVICE_FEATURES, type ClientMessage} from '../src/session/SessionProtocol.js';
import {socketPathFor} from '../src/session/runtimeDir.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {shellAdapter, shellInstall} from '../src/shell/adapters/registry.js';
import {createShellPanel, shellPanelKey} from '../src/shell/ShellPanel.js';
import {createOrdinaryShellEnvironment} from '../src/shell/ShellHandoff.js';
import {stripAnsi} from '../src/util/text.js';

const scratch = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-compat-'))); chmodSync(dir, 0o700); return dir; };

/** A service as an earlier build spoke it: same protocol version, a welcome with no features, no switch-shell. */
async function oldService(runtimeDir: string): Promise<{received: ClientMessage[]; close: () => Promise<void>}> {
  const received: ClientMessage[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    const decoder = new FrameDecoder();
    socket.on('data', chunk => {
      for (const result of decoder.push(String(chunk))) {
        if (!result.ok) continue;
        const message = result.message as ClientMessage;
        received.push(message);
        if (message.type === 'hello') socket.write(encodeMessage({type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd', startupSafety: 1}));
        if (message.type === 'create') socket.write(encodeMessage({type: 'created', sessionId: 'old-1', pid: 4242}));
        if (message.type === 'switch-shell') socket.write(encodeMessage({type: 'error', code: 'unsupported', message: 'unknown message type switch-shell'}));
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>(resolve => server.listen(socketPathFor(runtimeDir), resolve));
  return {received, close: () => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => server.close(() => resolve())); }};
}

test('old service + new frontend: missing capability known at connect; switch-shell is never sent; the session keeps working', async () => {
  const runtimeDir = scratch();
  const old = await oldService(runtimeDir);
  try {
    const client = await SocketSessionClient.connect({socketPath: socketPathFor(runtimeDir), cwd: '/', columns: 80, rows: 24, env: {}, shell: 'fish'});
    assert.equal(client.features.has('shell-switch'), false, 'known before any /shell');
    assert.equal(client.shell, 'zsh', 'an older service started zsh; the frontend knows');
    await assert.rejects(client.switchShell('fish', '/'), (error: Error) => error.message === OLDER_SERVICE_SWITCH);
    assert.equal(old.received.some(message => message.type === 'switch-shell'), false, 'no unsupported message on the wire');
    client.write('echo still fine\r');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(old.received.some(message => message.type === 'input'), 'compatible operations keep working');
    client.detach();
  } finally { await old.close(); }
  // The old service ended naturally (no sessions): the current service starts in its place.
  const current = new SessionService({runtimeDir, startupIdleMs: 60_000, build: 'test-build'});
  await current.start();
  try {
    const client = await SocketSessionClient.connect({socketPath: current.socketPath, cwd: '/', columns: 80, rows: 24, env: {HOME: runtimeDir, PATH: process.env.PATH ?? ''}});
    assert.deepEqual([...client.features].sort(), [...SERVICE_FEATURES].sort());
    assert.equal(client.serviceBuild, 'test-build');
    client.kill();
  } finally { await current.close(); rmSync(runtimeDir, {recursive: true, force: true}); }
});

test('handoffs: startup, background jobs and full-screen programs block /zsh /fish /bash and /exit through one path', () => {
  const blockers: Array<[string, (instance: TerminalApp) => void, RegExp]> = [
    ['startup', instance => { instance['startupPending'] = true; }, /the shell is still starting/u],
    ['jobs', instance => { instance['shellJobs'] = 2; }, /2 background or stopped jobs would end with the session/u],
    ['passthrough', instance => { instance['passthrough'] = true; }, /a full-screen program owns the terminal/u],
  ];
  for (const [name, block, reason] of blockers) {
    for (const [shell, command] of [['zsh', '/zsh'], ['fish', '/fish'], ['bash', '/bash'], ['zsh', '/exit']] as const) {
      if (!shellAdapter(shell).resolveExecutable(process.env)) continue;
      const instance = app();
      try {
        block(instance);
        instance['leaveForOrdinaryShell'](shell, command);
        assert.equal(instance.shellHandoff, undefined, `${name} blocks ${command}`);
        assert.equal(instance['stopped'], false);
        assert.match(transcript(instance), reason);
      } finally { instance['startupPending'] = false; instance['passthrough'] = false; instance['stop'](0); instance['session'].kill(); }
    }
  }
});

test('protocol: features are optional both ways; unknown feature names are ignored', () => {
  const withFeatures = decodeMessage(JSON.stringify({v: PROTOCOL_VERSION, type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd', features: 'shell-switch,future-x', build: '0.7.0 abc'}));
  assert.ok(withFeatures.ok && withFeatures.message.type === 'welcome');
  assert.deepEqual([...parseFeatures(withFeatures.ok && withFeatures.message.type === 'welcome' ? withFeatures.message.features : '')], ['shell-switch']);
  const older = decodeMessage(JSON.stringify({v: PROTOCOL_VERSION, type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd'}));
  assert.ok(older.ok, 'an older welcome still decodes');
  assert.deepEqual([...parseFeatures(undefined)], []);
});

function app(): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 120, rows: 40})});
  Object.defineProperty(instance, 'render', {value: () => {}});
  instance['startupPending'] = false;
  return instance;
}
const transcript = (instance: TerminalApp) => instance['output'].wrapped(200).map((row: {plain: string}) => row.plain).join('\n');

test('frontend on an older service: /shell explains up front, /status shows it, nothing is sent', async () => {
  const instance = app();
  try {
    Object.defineProperty(instance['session'], 'features', {value: new Set()});
    instance['sessionMode'] = 'service';
    let sent = false;
    instance['session'].switchShell = (async () => { sent = true; return {shell: 'fish', pid: 1}; }) as never;
    await instance['switchShell']('bash', '/shell bash');
    assert.equal(sent, false);
    assert.match(transcript(instance), /older NMSh build without shell switching/u);
    const status = instance['statusSections']().flat().map((row: {label: string; value: string}) => `${row.label}: ${row.value}`).join('\n');
    assert.match(status, /Shell switching: unavailable \(older service; ends with its sessions\)/u);
    assert.match(status, /Session service: connected · older build/u);
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('handoffs: /zsh /fish /bash target that shell; /exit uses the configured default (not $SHELL); busy and missing keep NMSh open', () => {
  const available = (id: 'zsh' | 'fish' | 'bash') => Boolean(shellAdapter(id).resolveExecutable(process.env));
  for (const shell of ['zsh', 'fish', 'bash'] as const) {
    if (!available(shell)) continue;
    const instance = app();
    try {
      instance['leaveForOrdinaryShell'](shell, `/${shell}`);
      assert.equal(instance.shellHandoff?.shell, shell);
      assert.equal(instance.shellHandoff?.executable, shellAdapter(shell).resolveExecutable(process.env));
      assert.ok(instance['stopped'], 'NMSh hands over and stops');
    } finally { instance['stop'](0); instance['session'].kill(); }
  }
  const exit = app();
  const shellEnv = process.env.SHELL;
  try {
    process.env.SHELL = '/bin/bash';
    exit['configuration'] = {...exit['configuration'], shellBackend: 'zsh'};
    exit['leaveForOrdinaryShell'](exit['promptConfiguration'].shellBackend, '/exit');
    assert.equal(exit.shellHandoff?.shell, 'zsh', '$SHELL is ignored; the configured default wins');
  } finally { if (shellEnv === undefined) delete process.env.SHELL; else process.env.SHELL = shellEnv; exit['stop'](0); exit['session'].kill(); }

  const busy = app();
  try {
    busy['running'] = {command: 'sleep 9', startedAt: Date.now(), interrupted: false, cleared: false, startId: 0, cwd: '/'} as never;
    busy['leaveForOrdinaryShell']('zsh', '/exit');
    assert.equal(busy.shellHandoff, undefined);
    assert.equal(busy['stopped'], false);
    assert.match(transcript(busy), /Not leaving NMSh: "sleep 9" is still running/u);
  } finally { busy['running'] = undefined; busy['stop'](0); busy['session'].kill(); }

  const missing = app();
  const path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-nmsh';
    missing['leaveForOrdinaryShell']('fish', '/exit');
    assert.equal(missing.shellHandoff, undefined, 'no silent fallback to another shell');
    assert.equal(missing['stopped'], false);
    assert.match(transcript(missing), /Your default shell \(Fish\) is not available[\s\S]*No other shell was started/u);
  } finally { process.env.PATH = path; missing['stop'](0); missing['session'].kill(); }
  assert.deepEqual(createOrdinaryShellEnvironment({NMSH_ACTIVE: '1', NMSH_SESSION_MODE: 'service', PATH: '/bin'}), {PATH: '/bin'});
});

test('/shell install: explicit, previewed, starts on No; Yes yields an argv brew recipe; guidance without Homebrew', () => {
  assert.deepEqual(shellInstall('fish', '/opt/homebrew/bin/brew', 'darwin'), {kind: 'recipe', command: '/opt/homebrew/bin/brew', args: ['install', 'fish'], label: 'brew install fish'});
  assert.equal(shellInstall('bash', undefined, 'linux').kind, 'guidance');
  const shells = [{adapter: shellAdapter('zsh'), executable: '/bin/zsh'}, {adapter: shellAdapter('fish'), reason: 'Fish is not installed'}];
  const panel = createShellPanel(shells, 'zsh', 'zsh');
  panel.installFor = id => shellInstall(id, '/usr/bin/brew', 'darwin');
  panel.selected = 1;
  assert.equal(shellPanelKey(panel, {kind: 'enter'}), undefined);
  assert.equal(panel.confirm?.choice, 'no', 'the preview starts on No');
  assert.equal(shellPanelKey(panel, {kind: 'enter'}), undefined, 'Enter on No installs nothing');
  assert.equal(panel.confirm, undefined);
  shellPanelKey(panel, {kind: 'text', value: 'i'});
  shellPanelKey(panel, {kind: 'text', value: 'y'});
  assert.deepEqual(shellPanelKey(panel, {kind: 'enter'}), {kind: 'install', shell: 'fish', install: {kind: 'recipe', command: '/usr/bin/brew', args: ['install', 'fish'], label: 'brew install fish'}});
  const guided = createShellPanel(shells, 'zsh', 'zsh');
  guided.installFor = id => shellInstall(id, undefined, 'linux');
  guided.selected = 1;
  shellPanelKey(guided, {kind: 'enter'});
  assert.equal(guided.confirm, undefined);
  assert.match(guided.message ?? '', /package manager/u);
});

test('/shell preview text names exactly what will run and what will not', async () => {
  const {renderShellPanel} = await import('../src/shell/ShellPanel.js');
  const panel = createShellPanel([{adapter: shellAdapter('fish'), reason: 'missing'}], 'zsh', 'zsh');
  panel.confirm = {shell: 'fish', install: {kind: 'recipe', command: 'brew', args: ['install', 'fish'], label: 'brew install fish'}, choice: 'no'};
  const text = stripAnsi(renderShellPanel(panel, 120).join('\n'));
  assert.match(text, /Install Fish\?[\s\S]*brew install fish[\s\S]*does NOT change your login shell, run chsh, modify shell startup files, or use sudo[\s\S]*\[ No \]/u);
});
