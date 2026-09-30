import {connect} from 'node:net';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import nodePty, {type IPty} from 'node-pty';
import {listLiveSessions} from '../../src/session/connectSession.js';
import {TranscriptStore} from '../../src/sessions/TranscriptStore.js';

const TSX = import.meta.resolve('tsx');
const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

export const strip = (value: string) => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[=>()][0-9A-B]?/g, '');

export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 15000, what: string | (() => string) = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${typeof what === 'function' ? what() : what}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** An isolated HOME/config/runtime shared by every frontend of one test. */
export class LiveSandbox {
  readonly root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-live-')));
  readonly home = join(this.root, 'h');
  readonly config = join(this.root, 'c');
  readonly runtime = join(this.root, 'r');
  private readonly frontends: Frontend[] = [];

  constructor(config: Record<string, unknown> = {}, private readonly extraEnv: Record<string, string> = {}) {
    mkdirSync(this.home);
    mkdirSync(join(this.config, 'nmsh'), {recursive: true});
    mkdirSync(this.runtime, {mode: 0o700});
    chmodSync(this.runtime, 0o700);
    writeFileSync(join(this.config, 'nmsh', 'config.json'),
      JSON.stringify({onboardingComplete: true, glyphChoiceComplete: true, updateChecks: false, ...config}));
  }

  get env(): NodeJS.ProcessEnv {
    return {...process.env, HOME: this.home, XDG_CONFIG_HOME: this.config, NMSH_RUNTIME_DIR: this.runtime,
      TERM: 'xterm-256color', NMSH_SESSION_SERVICE: '1', NMSH_ACTIVE: '',
      // A host NMSh cannot open windows in, so tests never launch real terminal windows.
      TERM_PROGRAM: 'nmsh-test', GHOSTTY_RESOURCES_DIR: '', KITTY_WINDOW_ID: '', ...this.extraEnv};
  }

  sessions() { return listLiveSessions({runtimeDir: this.runtime}); }

  /** The journals frontends in this sandbox wrote. */
  transcripts() { return new TranscriptStore(join(this.config, 'nmsh', 'sessions')); }

  launch(args: string[] = [], size = {cols: 100, rows: 30}): Frontend {
    // Run outside the repository: a SIGKILLed frontend must never leave git
    // state (index.lock from a prompt's git status) behind in the checkout.
    const frontend = new Frontend(nodePty.spawn(process.execPath, [`--import=${TSX}`, ENTRY, ...args],
      {cwd: this.home, ...size, env: this.env as Record<string, string>}));
    this.frontends.push(frontend);
    return frontend;
  }

  private async anyServiceListening(): Promise<boolean> {
    if (!existsSync(this.runtime)) return false;
    const sockets = readdirSync(this.runtime).filter(name => name.endsWith('.sock')).map(name => join(this.runtime, name));
    const live = await Promise.all(sockets.map(path => new Promise<boolean>(resolve => {
      const probe = connect(path);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', () => resolve(false));
    })));
    return live.includes(true);
  }

  /** Kill every frontend and every live shell so the service exits too. */
  async dispose(): Promise<void> {
    for (const frontend of this.frontends) frontend.pty.kill('SIGKILL');
    try {
      for (const session of await this.sessions()) { try { process.kill(session.pid, 'SIGKILL'); } catch {} }
      await until(async () => (await this.sessions()).length === 0, 10000, 'sessions to end');
      // Wait for the service to exit so it is not still writing into the sandbox
      // while it is removed. A SIGKILLed service leaves a stale socket file, so
      // the condition is "nothing accepts connections", not "no socket files".
      await until(async () => !(await this.anyServiceListening()), 10000, 'service exit');
    } finally {
      rmSync(this.root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
  }
}

export class Frontend {
  output = '';
  exitCode: number | undefined;
  readonly exited: Promise<number>;

  constructor(readonly pty: IPty) {
    pty.onData(data => { this.output += data; });
    this.exited = new Promise(resolve => pty.onExit(event => { this.exitCode = event.exitCode; resolve(event.exitCode); }));
  }

  get mark(): number { return this.output.length; }

  async waitFor(pattern: RegExp, from = 0, timeoutMs = 20000): Promise<void> {
    await until(() => pattern.test(strip(this.output.slice(from))), timeoutMs,
      () => `${pattern}; got:\n${strip(this.output.slice(from)).slice(-1500)}`);
  }

  async run(command: string, expect: RegExp): Promise<void> {
    const mark = this.mark;
    this.pty.write(`${command}\r`);
    await this.waitFor(expect, mark);
  }

  async waitExit(timeoutMs = 15000): Promise<number> {
    return Promise.race([this.exited, new Promise<number>((_, reject) => setTimeout(() => reject(new Error('frontend did not exit')), timeoutMs))]);
  }
}
