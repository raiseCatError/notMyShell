import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import type {Readable, Writable} from 'node:stream';
import type {BrowserAvailability, BrowserEngine, BrowserPage, BrowserStats, OpenOptions} from '../types.js';
import {CdpClient} from './cdp.js';
import {locateBrowser, realLocatorHost, type LocatorHost} from './chrome.js';
import {ChromePage} from './page.js';

/**
 * The single Chromium process tree behind every page. It starts on the first `open`, talks over a pipe (no network port), runs with a
 * minimal environment and its own profile, and stops when the last page has been closed for `idleMs`, on `shutdown()`, or when NMSh
 * exits. If the browser dies on its own every page is closed and the next `open` starts a fresh one.
 */
export interface BrowserEngineOptions {
  profileDir: string;
  /** How long the browser stays up after its last page closes (default 60 s). */
  idleMs?: number;
  /** Use this browser instead of searching (an absolute path). */
  executable?: string;
  env?: NodeJS.ProcessEnv;
  /** Test seam: how the browser is found. */
  locator?: LocatorHost;
}

export const DEFAULT_IDLE_MS = 60_000;
const CLOSE_GRACE_MS = 2000;
const STARTUP_TIMEOUT_MS = 30_000;

export function chromeArguments(profileDir: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
  const args = [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-update',
    '--disable-background-networking', '--disable-sync', '--disable-breakpad', '--disable-default-apps', '--mute-audio',
    '--renderer-process-limit=2', '--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions',
    '--force-color-profile=srgb', '--deny-permission-prompts',
    // Never touch the person's keychain / wallet for the throwaway profile's cookie encryption.
    platform === 'darwin' ? '--use-mock-keychain' : '--password-store=basic'
  ];
  if (env.NMSH_BROWSER_NO_SANDBOX === '1') args.push('--no-sandbox');
  return args;
}

/** The only environment the browser sees: no tokens, no NMSh variables. */
export function chromeEnvironment(profileDir: string, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {HOME: profileDir};
  for (const name of ['PATH', 'LANG', 'TMPDIR'] as const) if (source[name] !== undefined) env[name] = source[name];
  return env;
}

interface Running {
  process: ChildProcess;
  cdp: CdpClient;
  startedAt: number;
  exited: Promise<void>;
  stopping: boolean;
}

export class ChromeEngine implements BrowserEngine {
  private readonly env: NodeJS.ProcessEnv;
  private readonly idleMs: number;
  private readonly locator: LocatorHost;
  private readonly open_ = new Map<string, ChromePage>();
  private running: Running | undefined;
  private launching: Promise<Running> | undefined;
  private stopping: Promise<void> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private found: BrowserAvailability | undefined;
  private counter = 0;
  private executable: string | undefined;

  constructor(private readonly options: BrowserEngineOptions) {
    this.env = options.env ?? process.env;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.locator = options.locator ?? {...realLocatorHost, env: this.env};
  }

  async available(): Promise<BrowserAvailability> {
    if (this.found?.ok) return this.found;
    this.found = await locateBrowser(this.locator, this.options.executable);
    return this.found;
  }

  pages(): readonly BrowserPage[] {
    return [...this.open_.values()];
  }

  stats(): BrowserStats {
    const running = this.running && !this.running.stopping ? this.running : undefined;
    return {
      running: running !== undefined,
      pages: this.open_.size,
      ...(running?.process.pid !== undefined ? {pid: running.process.pid} : {}),
      ...(running ? {startedAt: running.startedAt} : {}),
      ...(this.executable ? {executable: this.executable} : {})
    };
  }

  async open(options: OpenOptions): Promise<BrowserPage> {
    this.cancelIdle();
    if (this.stopping) await this.stopping;
    const running = await this.start();
    this.cancelIdle();
    const page = await ChromePage.open({
      cdp: running.cdp,
      released: released => {
        this.open_.delete(released.id);
        if (this.open_.size === 0) this.armIdle();
      }
    }, `page-${++this.counter}`, options);
    if (page.isClosed) throw new Error('The browser closed while the page was opening.');
    this.open_.set(page.id, page);
    return page;
  }

  private armIdle(): void {
    this.cancelIdle();
    if (!this.running) return;
    this.idleTimer = setTimeout(() => { void this.shutdown(); }, this.idleMs);
    this.idleTimer.unref();
  }

  private cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private start(): Promise<Running> {
    if (this.running && !this.running.stopping) return Promise.resolve(this.running);
    this.launching ??= this.launch().finally(() => { this.launching = undefined; });
    return this.launching;
  }

  private async launch(): Promise<Running> {
    const availability = await this.available();
    if (!availability.ok) throw new Error(availability.reason);
    const profileDir = this.options.profileDir;
    fs.mkdirSync(profileDir, {recursive: true, mode: 0o700});
    try { fs.chmodSync(profileDir, 0o700); } catch { /* not ours to change */ }

    const child = spawn(availability.executable, chromeArguments(profileDir, this.env), {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      env: chromeEnvironment(profileDir, this.env),
      windowsHide: true
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
    const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
    const spawnError = new Promise<never>((_, reject) => child.once('error', error => reject(new Error(`The browser could not be started: ${error.message}`))));
    const earlyExit = new Promise<never>((_, reject) => child.once('exit', (code, signal) => reject(new Error(
      `The browser stopped right after starting (${signal ?? `exit ${code}`}). ${stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`.trim()))));
    spawnError.catch(() => undefined);
    earlyExit.catch(() => undefined);

    const cdp = new CdpClient(child.stdio[3] as Writable, child.stdio[4] as Readable);
    const running: Running = {process: child, cdp, startedAt: Date.now(), exited, stopping: false};
    const killNow = (): void => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    process.on('exit', killNow);
    const onGone = (crashed: boolean): void => {
      process.off('exit', killNow);
      cdp.close('The browser stopped.');
      if (this.running === running) this.running = undefined;
      for (const page of [...this.open_.values()]) page.browserGone(crashed && !running.stopping);
      this.open_.clear();
      if (this.running === undefined) this.cancelIdle();
    };
    void exited.then(() => onGone(true));
    cdp.onClose(() => { if (!running.stopping) killNow(); });
    // Every new page target starts paused. A window opened by a page (it has an opener) is closed before it can request anything;
    // the pages NMSH creates itself are resumed at once.
    cdp.onEvent(event => {
      if (event.method !== 'Target.attachedToTarget' || event.sessionId !== undefined) return;
      const info = event.params.targetInfo;
      if (info?.type === 'page' && info.openerId) void cdp.send('Target.closeTarget', {targetId: info.targetId}).catch(() => undefined);
      else if (event.params.waitingForDebugger) void cdp.send('Runtime.runIfWaitingForDebugger', {}, {sessionId: event.params.sessionId}).catch(() => undefined);
    });

    try {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The browser did not start in time.')), STARTUP_TIMEOUT_MS);
        timer.unref();
      });
      try {
        await Promise.race([
          (async () => {
            await cdp.send('Target.setDiscoverTargets', {discover: true});
            await cdp.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{type: 'page'}, {exclude: true}]});
            await cdp.send('Browser.setDownloadBehavior', {behavior: 'deny', eventsEnabled: true});
          })(),
          spawnError, earlyExit, timeout
        ]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      running.stopping = true;
      killNow();
      await exited;
      throw error;
    }
    this.running = running;
    this.executable = availability.executable;
    return running;
  }

  shutdown(): Promise<void> {
    this.stopping ??= this.stop().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }

  private async stop(): Promise<void> {
    this.cancelIdle();
    if (this.launching) await this.launching.catch(() => undefined);
    const running = this.running;
    if (!running) return;
    running.stopping = true;
    for (const page of [...this.open_.values()]) page.browserGone(false);
    this.open_.clear();
    const exitedIn = (ms: number): Promise<boolean> => new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), ms);
      timer.unref();
      void running.exited.then(() => { clearTimeout(timer); resolve(true); });
    });
    await running.cdp.send('Browser.close', {}, {timeoutMs: CLOSE_GRACE_MS}).catch(() => undefined);
    if (await exitedIn(CLOSE_GRACE_MS)) return;
    try { running.process.kill('SIGTERM'); } catch { /* gone */ }
    if (await exitedIn(CLOSE_GRACE_MS)) return;
    try { running.process.kill('SIGKILL'); } catch { /* gone */ }
    await running.exited;
  }
}
