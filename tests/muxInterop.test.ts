import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {detectTerminalHost} from '../src/host/terminalHost.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';
import {inForeground, uniqueSleep} from './helpers/processState.js';

/**
 * The multiplexer interoperability contract from docs/architecture/multiplexer-interop.md.
 * Real tmux and screen are used where installed; otherwise these skip, so CI never depends on them.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));
const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const hasScreen = spawnSync('screen', ['-v']).status !== null && spawnSync('which', ['screen']).status === 0;
const quote = (value: string) => `'${value.replace(/'/gu, `'\\''`)}'`;

/** NMSh running inside a private tmux server, driven with send-keys and read with capture-pane. */
class TmuxPane {
  readonly socket = `nmsh-mux-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  constructor(private readonly sandbox: LiveSandbox, columns = 100, rows = 30) {
    const env = Object.entries(sandbox.env).filter(([name, value]) => value !== undefined && /^(HOME|XDG_CONFIG_HOME|NMSH_[A-Z_]+|PATH)$/u.test(name))
      .map(([name, value]) => `${name}=${quote(value!)}`).join(' ');
    this.tmux('new-session', '-d', '-x', String(columns), '-y', String(rows), '-s', 'p',
      `cd ${quote(REPO)} && env ${env} ${quote(process.execPath)} --import=tsx src/index.ts`);
  }
  tmux(...args: string[]): string {
    return spawnSync('tmux', ['-L', this.socket, '-f', '/dev/null', ...args], {encoding: 'utf8'}).stdout;
  }
  screen(): string { return this.tmux('capture-pane', '-p', '-t', 'p'); }
  keys(...keys: string[]): void { this.tmux('send-keys', '-t', 'p', ...keys); }
  async waitFor(pattern: RegExp, what = String(pattern)): Promise<void> {
    await until(() => pattern.test(this.screen()), 20000, () => `${what}; screen:\n${this.screen()}`);
  }
  async run(command: string, expect: RegExp): Promise<void> {
    this.keys(command, 'Enter');
    await this.waitFor(expect);
  }
  kill(): void { this.tmux('kill-server'); }
}

test('NMSh inside tmux: environment, resize, job control, fullscreen, paste; closing the pane detaches the live session',
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
      await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'detached after the pane closed');
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
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    const mark = app.mark;
    app.pty.write(`screen -q -S nmsh-inner-${process.pid} zsh -f -c 'echo SCREEN-INNER; sleep 1'\r`);
    await app.waitFor(/SCREEN-INNER/, mark);
    await until(() => app.output.indexOf('\u001b[?1049l', mark) !== -1, 20000, 'screen left the alternate screen');
    assert.ok(app.output.indexOf('\u001b[?1049h', mark) !== -1, 'screen used the alternate screen, so NMSh passed it through');
    await app.waitFor(/❯/, app.output.indexOf('\u001b[?1049l', mark));
    await app.run('echo AFTER-SCREEN', /AFTER-SCREEN/);
  } finally {
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
