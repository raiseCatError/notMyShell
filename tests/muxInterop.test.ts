import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import nodePty from 'node-pty';
import {detectTerminalHost} from '../src/host/terminalHost.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';
import {inForeground, uniqueSleep} from './helpers/processState.js';

/**
 * Automated contract coverage for selected tmux/screen interoperability paths
 * described in docs/architecture/multiplexer-interop.md (which also marks what
 * is only manual or expected). Real tmux and screen are used where installed;
 * otherwise these skip, so CI never depends on them.
 */

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const TSX = import.meta.resolve('tsx');
/**
 * NMSh under test runs from the sandbox home, never this checkout: its prompt
 * runs git status, and a frontend killed mid-status would leave .git/index.lock
 * behind in the repository.
 */
const nmshCommand = (home: string) => `cd ${quote(home)} && exec ${quote(process.execPath)} --import=${quote(TSX)} ${quote(ENTRY)}`;
const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const hasScreen = spawnSync('screen', ['-v']).status !== null && spawnSync('which', ['screen']).status === 0;
const quote = (value: string) => `'${value.replace(/'/gu, `'\\''`)}'`;

/**
 * The test runner's environment minus any multiplexer it may itself run in, so
 * an outer tmux, screen or Zellij cannot leak into the one under test. Nothing
 * else is changed: the tests should see an ordinary user environment.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = {...process.env};
  for (const name of Object.keys(env)) if (/^(TMUX|TMUX_PANE|STY|WINDOW|ZELLIJ.*)$/u.test(name)) delete env[name];
  return env;
}

/** NMSh running inside a private tmux server, driven with send-keys and read with capture-pane. */
class TmuxPane {
  readonly socket = `nmsh-mux-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  constructor(private readonly sandbox: LiveSandbox, columns = 100, rows = 30) {
    const env = Object.entries(sandbox.env).filter(([name, value]) => value !== undefined && /^(HOME|XDG_CONFIG_HOME|TMPDIR|TMP|TEMP|NMSH_[A-Z_]+|PATH)$/u.test(name))
      .map(([name, value]) => `${name}=${quote(value!)}`).join(' ');
    this.tmux('new-session', '-d', '-x', String(columns), '-y', String(rows), '-s', 'p',
      `env ${env} sh -c ${quote(nmshCommand(sandbox.home))}`);
  }
  tmux(...args: string[]): string {
    return spawnSync('tmux', ['-L', this.socket, '-f', '/dev/null', ...args], {encoding: 'utf8', env: cleanEnv()}).stdout;
  }
  /** Whether this tmux server still exists. */
  alive(): boolean {
    return spawnSync('tmux', ['-L', this.socket, '-f', '/dev/null', 'list-sessions'], {env: cleanEnv()}).status === 0;
  }
  screen(): string { return this.tmux('capture-pane', '-p', '-t', 'p'); }
  keys(...keys: string[]): void { this.tmux('send-keys', '-t', 'p', ...keys); }
  async waitFor(pattern: RegExp, what = String(pattern)): Promise<void> {
    await until(() => pattern.test(this.screen()), 20000, () => `${what}; screen:\n${this.screen()}`);
  }
  async run(command: string, expect: RegExp): Promise<void> {
    const completedCount = async () => (await this.sandbox.transcripts().list())
      .flatMap(session => session.transcript.records).filter(record => record.command === command).length;
    const completed = await completedCount();
    this.keys(command, 'Enter');
    await this.waitFor(expect);
    // Echoed command text can match before a TUI has returned terminal ownership.
    await until(async () => await completedCount() > completed, 20000, `completed journal for ${command}`);
  }
  kill(): void { this.tmux('kill-server'); }
}

test('NMSh inside tmux: environment, resize, job control, fullscreen, paste; killing the tmux server detaches the live session',
  {skip: hasTmux ? false : 'tmux is not installed'}, async () => {
    const sandbox = new LiveSandbox();
    const pane = new TmuxPane(sandbox);
    try {
      await pane.waitFor(/❯/, 'composer');
      await pane.run('echo "IN=$TERM/$TERM_PROGRAM/${TMUX:+tmux}/$NMSH_SESSION_MODE"', /IN=tmux-256color\/tmux\/tmux\/service/);

      // The pane minus NMSh's composer rows (their count depends on the prompt), and it follows tmux resizes.
      const size = async () => {
        const mark = `SIZE${Math.random().toString(36).slice(2, 7)}`;
        await pane.run(`echo ${mark}-$(stty size | tr " " x)`, new RegExp(`${mark}-\\d+x\\d+`));
        const [, rows, columns] = new RegExp(`${mark}-(\\d+)x(\\d+)`).exec(pane.screen())!;
        return {rows: Number(rows), columns: Number(columns)};
      };
      const before = await size();
      assert.equal(before.columns, 100);
      assert.ok(before.rows >= 20 && before.rows < 30, `rows ${before.rows}`);
      pane.tmux('resize-window', '-t', 'p', '-x', '120', '-y', '40');
      await until(async () => (await size()).columns === 120, 20000, 'resize reached the shell');
      const after = await size();
      assert.ok(after.rows >= before.rows + 8 && after.rows < 40, `rows ${before.rows} -> ${after.rows}`);

      const duration = uniqueSleep(175);
      pane.keys(`sleep ${duration}`, 'Enter');
      await until(() => inForeground(duration), 20000, 'sleep in the foreground');
      pane.keys('C-z');
      await pane.run('jobs', /suspended\s+sleep/);
      await pane.run('kill %1; echo JOB-GONE', /JOB-GONE/);

      pane.keys('seq 1 500 | less', 'Enter');
      await pane.waitFor(/^:\s*$/mu, 'less prompt');
      pane.keys('q');
      await pane.run('echo BACK-FROM-LESS', /BACK-FROM-LESS/);

      // Bracketed paste through tmux stays a paste in the composer: nothing runs.
      pane.tmux('set-buffer', 'echo PASTED-ONE\necho PASTED-TWO');
      pane.tmux('paste-buffer', '-p', '-t', 'p');
      await pane.waitFor(/❯ echo PASTED-ONE\s*\n\s+echo PASTED-TWO/u, 'multi-line paste in the composer');
      assert.doesNotMatch(pane.screen(), /^PASTED-ONE$/mu, 'the pasted lines did not run');
      pane.keys('C-u');

      const [live] = await sandbox.sessions();
      assert.equal(live?.state, 'attached');
      pane.kill();
      await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached after the tmux server was killed');
      assert.equal((await sandbox.sessions())[0]!.id, live!.id, 'the same live session, restorable');
    } finally {
      pane.kill();
      await sandbox.dispose();
    }
  });

test('a live session keeps the environment it was created in: made in tmux, reattached outside it',
  {skip: hasTmux ? false : 'tmux is not installed'}, async () => {
    const sandbox = new LiveSandbox();
    const pane = new TmuxPane(sandbox);
    try {
      await pane.waitFor(/❯/, 'composer');
      await pane.run('echo READY', /READY/);
      const [live] = await sandbox.sessions();
      pane.kill();
      await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached');
      assert.equal(pane.alive(), false, 'the tmux server that TMUX refers to is gone');

      const outside = sandbox.launch(['--attach', live!.id]);
      await outside.waitFor(/Reattached live session/);
      await outside.run('echo "ENV=$TERM/$TERM_PROGRAM/${TMUX:+stale-tmux}"', /ENV=tmux-256color\/tmux\/stale-tmux/);
    } finally {
      pane.kill();
      await sandbox.dispose();
    }
  });

test('GNU screen inside NMSh passes through and returns to the composer', {skip: hasScreen ? false : 'screen is not installed'}, async () => {
  const sandbox = new LiveSandbox();
  const inner = `nmsh-inner-${process.pid}`;
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    // Only passthrough and the return are pinned here. screen 4.00 keeps its window at the size it started
    // with (the composer-reduced height); see the matrix. NMSh itself resizes the PTY, as a plain
    // alternate-screen program shows below.
    app.pty.write(`screen -q -S ${inner} zsh -f -c 'echo SCREEN-INNER; sleep 1'\r`);
    await app.waitFor(/SCREEN-INNER/, mark);
    await until(() => app.output.indexOf('\u001b[?1049l', mark) !== -1, 20000, 'screen left the alternate screen');
    assert.ok(app.output.indexOf('\u001b[?1049h', mark) !== -1, 'screen used the alternate screen, so NMSh passed it through');
    await app.waitFor(/❯/, app.output.indexOf('\u001b[?1049l', mark));
    await app.run('echo AFTER-SCREEN', /AFTER-SCREEN/);
  } finally {
    // screen detaches instead of exiting when its terminal goes away; end it explicitly.
    spawnSync('screen', ['-S', inner, '-X', 'quit'], {env: cleanEnv()});
    await sandbox.dispose();
  }
});

test('a program that switches to the alternate screen gets the full terminal in passthrough', async () => {
  const sandbox = new LiveSandbox();
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(`printf '\\e[?1049h'; until [ "$(stty size)" = "30 100" ]; do sleep 0.05; done; echo FULL-SIZE; printf '\\e[?1049l'\r`);
    await app.waitFor(/FULL-SIZE/, mark);
    await app.run('echo BACK-AT-COMPOSER', /BACK-AT-COMPOSER/);
  } finally {
    await sandbox.dispose();
  }
});

test('closing just the tmux pane (server still running) detaches the live session', {skip: hasTmux ? false : 'tmux is not installed'}, async () => {
  const sandbox = new LiveSandbox();
  const pane = new TmuxPane(sandbox);
  try {
    pane.tmux('new-session', '-d', '-s', 'keep', 'sleep 600'); // keeps the server alive after the pane goes
    await pane.waitFor(/❯/, 'composer');
    await pane.run('echo READY', /READY/);
    const [live] = await sandbox.sessions();
    assert.equal(live?.state, 'attached');
    pane.tmux('kill-pane', '-t', 'p');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached after kill-pane');
    assert.equal((await sandbox.sessions())[0]!.id, live!.id);
    assert.equal(pane.alive(), true, 'only the pane closed; the tmux server is still running');
  } finally {
    pane.kill();
    await sandbox.dispose();
  }
});

test('NMSh inside GNU screen: renders, sees STY, follows a resize, and suspends a job', {skip: hasScreen ? false : 'screen is not installed'}, async () => {
  const sandbox = new LiveSandbox();
  const name = `nmsh-outer-${process.pid}`;
  const env = {...cleanEnv(), ...sandbox.env, TERM: 'xterm-256color'} as Record<string, string>;
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const pty = nodePty.spawn('screen', ['-q', '-S', name, 'zsh', '-f', '-c',
    nmshCommand(sandbox.home)], {cwd: sandbox.home, cols: 100, rows: 30, env});
  const frontend = sandbox.trackFrontend(pty);
  let output = '';
  pty.onData(data => { output += data; });
  const plain = (from: number) => output.slice(from).replace(/\u001b\[[0-9;?>]*[A-Za-z]|\u001b[()][A-Z0-9]|\u001b[=>]/gu, ' ');
  const waitFor = (pattern: RegExp, from: number) => until(() => pattern.test(plain(from)), 20000, () => `${pattern}:\n${plain(from).slice(-800)}`);
  const run = async (command: string, expect: RegExp) => { const mark = output.length; pty.write(`${command}\r`); await waitFor(expect, mark); };
  try {
    await waitFor(/❯/, 0);
    await run('echo "STY-${STY:+set}"', /STY-set/);
    await run('echo SIZE-$(stty size | tr " " x)', /SIZE-\d+x100/);
    pty.resize(120, 40);
    await until(async () => { const mark = output.length; pty.write('echo SIZE-$(stty size | tr " " x)\r');
      try { await until(() => /SIZE-\d+x120/u.test(plain(mark)), 2000); return true; } catch { return false; } }, 20000, 'resize reached the shell');
    const duration = uniqueSleep(176);
    pty.write(`sleep ${duration}\r`);
    await until(() => inForeground(duration), 20000, 'sleep in the foreground');
    pty.write('\u001a');
    await run('jobs', /suspended\s+sleep/);
    await run('kill %1; echo JOB-GONE', /JOB-GONE/);
  } finally {
    pty.kill();
    spawnSync('screen', ['-S', name, '-X', 'quit'], {env: cleanEnv()});
    await frontend.waitExit();
    await sandbox.dispose();
  }
});

test('window-launch host detection inside a multiplexer uses inherited evidence (documented behavior)', () => {
  // tmux inherits GHOSTTY_RESOURCES_DIR from the Ghostty that started it: "Open all" opens Ghostty windows outside tmux.
  assert.equal(detectTerminalHost({TERM_PROGRAM: 'tmux', TMUX: '/tmp/tmux-501/default,1,0', GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app/x'}, 'darwin').name, 'Ghostty');
  // Without that evidence a multiplexer is a host NMSh cannot open windows in, so it names the attach commands instead.
  const plainTmux = detectTerminalHost({TERM_PROGRAM: 'tmux', TMUX: '/tmp/tmux-501/default,1,0'}, 'darwin');
  assert.equal(plainTmux.newWindow, undefined);
  const screen = detectTerminalHost({TERM: 'screen', STY: '123.pts-0.host'}, 'linux');
  assert.equal(screen.newWindow, undefined);
  const zellij = detectTerminalHost({ZELLIJ: '0', TERM_PROGRAM: ''}, 'linux');
  assert.equal(zellij.newWindow, undefined);
});

test('mouse-enabled tmux client detach/reattach preserves one attached NMSh and interactive ownership',
  {skip: hasTmux ? false : 'tmux is not installed'}, async () => {
    const sandbox = new LiveSandbox();
    const pane = new TmuxPane(sandbox);
    const fixture = fileURLToPath(new URL('./fixtures/compatibility.mjs', import.meta.url));
    const attach = () => sandbox.trackFrontend(nodePty.spawn('tmux',
      ['-L', pane.socket, '-f', '/dev/null', 'attach-session', '-t', 'p'], {
        cwd: sandbox.home, cols: 100, rows: 30,
        env: {...cleanEnv(), ...sandbox.env, TMUX: ''} as Record<string, string>,
      }));
    try {
      pane.tmux('set-option', '-g', 'mouse', 'on');
      assert.equal(pane.tmux('show-option', '-gv', 'mouse').trim(), 'on');
      await pane.waitFor(/❯/);
      const first = attach();
      await first.waitFor(/❯/);
      const [live] = await sandbox.sessions();
      first.pty.write('\u0002d');
      await first.waitExit();
      assert.equal((await sandbox.sessions())[0]!.id, live!.id);
      assert.equal((await sandbox.sessions())[0]!.state, 'attached', 'tmux owns the surviving frontend');
      const second = attach();
      await second.waitFor(/❯/);
      const mark = second.mark;
      second.pty.write(`${quote(process.execPath)} ${quote(fixture)} fullscreen\r`);
      await second.waitFor(/INTERACTIVE-READY-fullscreen/, mark);
      second.pty.resize(82, 28);
      await second.waitFor(/INTERACTIVE-SIZE-27x82/, mark); // tmux reserves its status row.
      second.pty.write('q');
      await second.waitFor(/INTERACTIVE-EXIT-0/, mark);
      await pane.run('echo AFTER-TMUX-CLIENT', /AFTER-TMUX-CLIENT/);
      assert.equal((await sandbox.sessions())[0]!.id, live!.id);
    } finally { pane.kill(); await sandbox.dispose(); }
  });

test('real tmux: a foreground program SIGKILLed with terminal modes enabled leaves the pane in NMSh\'s mode state',
  {skip: hasTmux ? false : 'tmux is not installed'}, async () => {
    const sandbox = new LiveSandbox();
    const pane = new TmuxPane(sandbox);
    const flags = () => pane.tmux('display-message', '-p', '-t', 'p',
      '#{alternate_on}|#{mouse_any_flag}|#{mouse_standard_flag}|#{mouse_button_flag}|#{mouse_all_flag}|#{mouse_sgr_flag}|#{mouse_utf8_flag}|#{keypad_flag}|#{keypad_cursor_flag}').trim();
    try {
      await pane.waitFor(/❯/, 'composer');
      const baseline = flags();
      const script = join(sandbox.home, 'leak.cjs');
      // Alternate screen, every mouse protocol, application keypad/cursor keys, then death with no cleanup.
      writeFileSync(script, `process.stdout.write('\\u001b[?1049h\\u001b[?1000h\\u001b[?1002h\\u001b[?1003h\\u001b[?1005h\\u001b[?1006h\\u001b[?1h\\u001b=LEAK-READY\\n');\nsetTimeout(() => process.kill(process.pid, 'SIGKILL'), 3000);\nsetInterval(() => {}, 1000);\n`);
      pane.keys(`node ${quote(script)}`, 'Enter');
      await until(() => flags() !== baseline, 20000, () => `fixture modes active in tmux; got ${flags()}`);
      // The program dies without cleanup; NMSh regains the terminal and must reconcile it.
      await until(() => flags() === baseline, 20000, () => `tmux pane modes after kill; got ${flags()}, want ${baseline}`);
      await pane.run('echo AFTER-KILL', /AFTER-KILL/);
      assert.equal(flags(), baseline, 'tmux pane modes equal NMSh\'s own state from before the program ran');
    } finally { pane.kill(); await sandbox.dispose(); }
  });
