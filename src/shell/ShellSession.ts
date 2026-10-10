import {shellAdapter} from './adapters/registry.js';
import type {ShellAdapter, ShellId} from './adapters/ShellAdapter.js';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {QueryOrder} from './QueryOrder.js';
import { spawn, type IPty } from 'node-pty';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import {MAX_SHELL_KNOWLEDGE_BYTES} from './ShellKnowledge.js';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {bridgeEnvPath} from '../themeBridge/environment.js';
import {PENDING_INPUT_LIMIT, sanitizeStartupOutput, STARTUP_RAW_LIMIT, utf8Tail} from './startupOutput.js';
import { ShellProtocolDecoder, type ShellMarker } from './ShellProtocol.js';

interface SessionEvents {
  data: [string];
  prompt: [ShellMarker];
  /** Sanitized, bounded tail of what the shell printed before its first prompt; emitted (coalesced) while startup is pending. */
  startup: [string];
  inputRejected: [string, boolean];
  exec: [string, number?];
  exit: [{ exitCode: number; signal?: number }];
}

/** node-pty's error for an ioctl on a PTY whose descriptor is already closed. */
export function isClosedPtyError(error: unknown): boolean {
  return error instanceof Error && /\bEBADF\b/u.test(error.message);
}

export class ShellSession extends EventEmitter<SessionEvents> {
  private readonly pty: IPty;
  private readonly protocol: ShellProtocolDecoder;
  private zdotdir: string;
  private ready = false;
  /** Raw pre-ready output, bounded; the shell may be blocked on a prompt in the user's startup files. */
  private startupRaw = '';
  private startupTimer?: NodeJS.Timeout;
  /** Input held until the shell is ready, so type-ahead can never answer a prompt in a startup file. */
  private pendingInput = '';
  /** Set once the shell has exited or its PTY is closed; resizes after that are no-ops. */
  private exited = false;

  /** The backend this session runs. */
  readonly adapter: ShellAdapter;
  /** Fish-style editor chrome: bytes between readiness and the next exec are the shell's own line editor. */
  private atPrompt = true;
  /** The next output chunk is the first after an exec marker. */
  private commandStart = false;
  /** The shell's executable name, to tell the shell's own builtins from programs it starts. */
  private shellName = '';
  /** Input waits behind a device-attributes answer the program is waiting on (see QueryOrder). */
  private readonly order = new QueryOrder(data => { if (!this.exited) this.pty.write(data); });
  /** The last composer submission, used when a shell cannot report a command's text (Bash, unrecorded lines). */
  private lastSubmitted = '';

  constructor(cwd: string, columns: number, rows: number, home = process.env.HOME || '', env: NodeJS.ProcessEnv = process.env,
    shell: ShellId | ShellAdapter = 'zsh') {
    super();
    this.adapter = typeof shell === 'string' ? shellAdapter(shell) : shell;
    const token = randomBytes(12).toString('hex');
    this.protocol = new ShellProtocolDecoder(token);

    // A private per-session bootstrap directory (zsh keeps its historical ZDOTDIR name).
    const stateDir = mkdtempSync(join(tmpdir(), this.adapter.id === 'zsh' ? 'nmsh-zdotdir-' : 'nmsh-shell-'));
    this.zdotdir = stateDir;
    let launch;
    try {
      launch = this.adapter.launch({home, env, token, stateDir, knowledgePath: join(stateDir, '.nmsh-knowledge'), bridgeEnvPath: bridgeEnvPath(this.adapter.id, env)});
    } catch (error) {
      this.cleanup();
      throw error;
    }

    try {
      this.shellName = basename(launch.executable);
      this.pty = spawn(launch.executable, launch.args, {
        name: env.TERM || 'xterm-256color',
        cols: Math.max(2, columns),
        rows: Math.max(2, rows),
        cwd,
        env: {
          ...env,
          ...launch.env,
          TERM: env.TERM || 'xterm-256color',
          PAGER: 'cat',
          GIT_PAGER: 'cat',
        } as Record<string, string>,
      });
    } catch (error) {
      this.cleanup();
      throw error;
    }

    this.pty.onData(data => this.receive(data));
    this.pty.onExit(event => {
      this.exited = true;
      this.pendingInput = '';
      this.order.dispose();
      if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = undefined; }
      this.cleanup();
      this.emit('exit', event);
    });
  }

  private cleanup(): void {
    if (this.zdotdir) {
      try {
        rmSync(this.zdotdir, {recursive: true, force: true, maxRetries: 5, retryDelay: 10});
        this.zdotdir = '';
      } catch (e) {
        // Retain ownership so the shell's exit event can retry a concurrent write.
      }
    }
  }

  get pid(): number {
    return this.pty.pid;
  }

  /** Name of the terminal's foreground process, read on demand; undefined if the platform cannot tell. */
  get foregroundProcess(): string | undefined {
    try { return this.pty.process || undefined; } catch { return undefined; }
  }

  /** Whether the first prompt has been reached. */
  get isReady(): boolean { return this.ready; }

  /** Sanitized recent startup output while the shell has not reached its first prompt; undefined once ready. */
  startupTail(): string | undefined {
    return this.ready ? undefined : sanitizeStartupOutput(this.startupRaw);
  }

  pendingInputBytes(): number { return Buffer.byteLength(this.pendingInput, 'utf8'); }

  submit(command: string): void {
    this.send(`${command}\r`, true);
  }

  /** Text of the last submitted command line (for shells whose exec marker cannot carry it). */
  get lastSubmission(): string { return this.lastSubmitted; }

  write(data: string, submission = false): void {
    // An explicit interrupt is the one pre-ready input that acts immediately.
    if (data === '\u0003') this.interrupt(); else this.send(data, submission);
  }

  /**
   * Before the first prompt the shell may be reading from the terminal on behalf of the user's startup files
   * (for example `read -k1` in .zshrc), where a queued command or keystroke would silently become the answer.
   * Hold it, bounded, and release it in order once the shell reports ready.
   */
  private send(data: string, submission = false): void {
    if (submission) this.lastSubmitted = data.replace(/\r$/u, '');
    if (this.ready) { this.order.input(data); return; }
    if (this.pendingInputBytes() + Buffer.byteLength(data, 'utf8') <= PENDING_INPUT_LIMIT) this.pendingInput += data;
    else this.emit('inputRejected', data, submission);
  }

  interrupt(): void {
    this.pty.write('\u0003');
  }

  endInput(): void {
    this.pty.write('\u0004');
  }

  /**
   * Resize the PTY. A resize can legitimately race the shell's teardown: a
   * frontend may send one just before it hears of the exit, and node-pty closes
   * the PTY's descriptor before it reports the exit. Once the shell is gone
   * there is nothing to resize, so that case is ignored; any other failure
   * still throws.
   */
  resize(columns: number, rows: number): void {
    if (this.exited) return;
    try {
      this.pty.resize(Math.max(2, columns), Math.max(2, rows));
    } catch (error) {
      if (!isClosedPtyError(error)) throw error;
      this.exited = true;
    }
  }

  kill(): void {
    // node-pty reports the exit later; nothing may be written to a PTY NMSh already closed (a late Fish query reply would fail with EIO).
    this.exited = true;
    this.pendingInput = '';
    this.order.dispose();
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = undefined; }
    try { this.pty.kill(); } finally { this.cleanup(); }
  }

  private receive(data: string): void {
    // Before readiness nothing answers the shell's startup queries, so input is never held for them.
    if (this.ready) this.order.observeOutput(data);
    for (const event of this.protocol.push(data)) {
      if (event.kind === 'data') {
        if (!this.ready) this.captureStartup(event.data);
        else if (this.adapter.editorChrome === 'prompt-to-exec' && this.atPrompt) this.answerChrome(event.data);
        else {
          const data = this.answerEditor(this.commandStart && this.adapter.scrubCommandStart ? this.adapter.scrubCommandStart(event.data) : event.data);
          if (data) { this.commandStart = false; this.emit('data', data); }
        }
      } else if (event.kind === 'exec') {
        this.atPrompt = false;
        this.commandStart = true;
        // Bash cannot report the text of a line it chose not to record; the submitted text stands in.
        if (this.ready) this.emit('exec', event.command || (this.adapter.id === 'zsh' ? '' : this.lastSubmitted), event.historyAllowed);
      } else if (!this.ready) {
        this.atPrompt = true;
        this.ready = true;
        this.startupRaw = '';
        if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = undefined; }
        this.emit('prompt', this.withKnowledge(event.marker));
        const pending = this.pendingInput;
        this.pendingInput = '';
        if (pending && !this.exited) this.pty.write(pending);
      } else {
        this.atPrompt = true;
        this.emit('prompt', this.withKnowledge(event.marker));
      }
    }
  }

  /**
   * The shell's own editor running for a command (Fish's `read`) asks what it asks at the prompt. It is answered here,
   * as at the prompt, and its queries are not passed on: a round trip through the host terminal is slow enough
   * that keys typed meanwhile reach fish while it waits for the answer, and fish drops them.
   */
  private answerEditor(data: string): string {
    const queries = this.adapter.editorQueries;
    if (!queries || !this.adapter.answerQueries || !data.match(queries) || !this.shellInForeground()) return data;
    const reply = this.adapter.answerQueries(data);
    if (reply && !this.exited) this.order.answer(reply);
    return data.replace(queries, '');
  }

  /** The terminal's foreground process is the shell itself (a builtin), not a program it started. */
  private shellInForeground(): boolean {
    try { return basename(this.pty.process) === this.shellName; } catch { return false; }
  }

  /** Line-editor chrome is never output; only queries it waits on get a (minimal) reply. */
  private answerChrome(data: string): void {
    const reply = this.adapter.answerQueries?.(data);
    if (reply && !this.exited) this.order.answer(reply);
  }

  private captureStartup(data: string): void {
    this.startupRaw = utf8Tail(this.startupRaw + data, STARTUP_RAW_LIMIT);
    if (this.startupTimer || this.listenerCount('startup') === 0) return;
    // Coalesce bursts: a chatty startup file must not become a flood of frontend messages.
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      const tail = this.startupTail();
      if (tail !== undefined) this.emit('startup', tail);
    }, 100);
    this.startupTimer.unref?.();
  }

  private withKnowledge(marker: ShellMarker): ShellMarker {
    try {
      const path = join(this.zdotdir, '.nmsh-knowledge');
      if (statSync(path).size <= MAX_SHELL_KNOWLEDGE_BYTES) return {...marker, knowledge: readFileSync(path, 'utf8')};
    } catch { /* Older/unavailable metadata leaves isolated classification usable. */ }
    return marker;
  }
}
