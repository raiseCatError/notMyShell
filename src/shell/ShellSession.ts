import {shellQuote} from '../host/terminalHost.js';
import {resolveZsh} from './zshExecutable.js';
import {BOOTSTRAP_TERM_COMPATIBILITY} from '../host/integration.js';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn, type IPty } from 'node-pty';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import {MAX_SHELL_KNOWLEDGE_BYTES, shellKnowledgeBootstrap} from './ShellKnowledge.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {PENDING_INPUT_LIMIT, sanitizeStartupOutput, STARTUP_RAW_LIMIT} from './startupOutput.js';
import { ShellProtocolDecoder, type ShellMarker } from './ShellProtocol.js';

interface SessionEvents {
  data: [string];
  prompt: [ShellMarker];
  /** Sanitized, bounded tail of what the shell printed before its first prompt; emitted (coalesced) while startup is pending. */
  startup: [string];
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

  constructor(cwd: string, columns: number, rows: number, home = process.env.HOME || '', env: NodeJS.ProcessEnv = process.env) {
    super();
    const shell = resolveZsh(env);
    const token = randomBytes(12).toString('hex');
    this.protocol = new ShellProtocolDecoder(token);

    // Create a temporary ZDOTDIR for bootstrap
    const zdotdir = mkdtempSync(join(tmpdir(), 'nmsh-zdotdir-'));

    // Proxy .zshenv
    writeFileSync(join(zdotdir, '.zshenv'), `
if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshenv'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zshenv'))}
fi
`);

    // Proxy .zprofile
    writeFileSync(join(zdotdir, '.zprofile'), `
if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zprofile'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zprofile'))}
fi
`);

    // Proxy .zshrc
    writeFileSync(join(zdotdir, '.zshrc'), `
# Prevent UI plugins from fighting during bootstrap
unsetopt zle
export POWERLEVEL9K_DISABLE_PROMPT=true
export XDG_CACHE_HOME="\${XDG_CACHE_HOME:-\$HOME/.cache}/nmsh-disabled"

# Suppress fastfetch via TERM
local nmsh_orig_term=\$TERM
${BOOTSTRAP_TERM_COMPATIBILITY}

if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshrc'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zshrc'))}
fi

export TERM=\$nmsh_orig_term

# NMSh specific setup
export NMSH_ACTIVE=1
unsetopt zle prompt_cr prompt_sp

# Hooks run right after a job stops or ends, sometimes before zsh has taken the
# terminal back. As an ordinary job, stty could then be stopped by SIGTTOU and
# left in the user's job table ("suspended (tty output) stty -echo"). Run it
# outside job control and immune to SIGTTOU so the mode change is simply applied.
function nmsh_tty_echo {
  setopt localoptions localtraps nomonitor
  trap '' TTOU
  stty \$1 2>/dev/null
}

function nmsh_precmd {
  local nmsh_status=$?
  nmsh_capture_knowledge
  # Reblank every cycle: a plugin's own precmd (starship, a prompt theme, ...)
  # may run before us in precmd_functions and repaint PROMPT/RPROMPT. NMSh
  # owns prompt rendering, so it always has the last word here.
  PROMPT=''
  RPROMPT=''
  PS2=''
  # Themes such as Powerlevel10k move their own hook to the end of
  # precmd_functions every cycle; move ours back after it so the next cycle
  # still blanks last. Their prompt-spacing options must not return either.
  precmd_functions=(\${precmd_functions:#nmsh_precmd} nmsh_precmd)
  unsetopt prompt_cr prompt_sp
  nmsh_tty_echo -echo
  printf '\\e]777;nmsh;${token};%d;%s\\a' "\$nmsh_status" "\$PWD"
}

function nmsh_preexec {
  nmsh_tty_echo echo
  local nmsh_history_allowed=1
  [[ \$1 == [[:space:]]* ]] && nmsh_history_allowed=0
  [[ -n \$HISTORY_IGNORE && \$1 == \${~HISTORY_IGNORE} ]] && nmsh_history_allowed=0
  printf '\\e]777;nmsh;${token};exec2;%d;%s\\a' "\$nmsh_history_allowed" "\${1//[[:cntrl:]]/ }"
}

# Compose with whatever the user's config/plugins already installed instead
# of clobbering precmd_functions/preexec_functions: tools like zoxide and
# Atuin register non-UI hooks (directory tracking, history sync) into these
# arrays, and overwriting them silently drops that behavior.
${shellKnowledgeBootstrap(join(zdotdir, '.nmsh-knowledge'))}
autoload -Uz add-zsh-hook
add-zsh-hook precmd nmsh_precmd
add-zsh-hook preexec nmsh_preexec

# Background cleanup handled by Node.js
`);

    this.zdotdir = zdotdir;

    try {
      this.pty = spawn(shell, ['-i'], {
        name: env.TERM || 'xterm-256color',
        cols: Math.max(2, columns),
        rows: Math.max(2, rows),
        cwd,
        env: {
          ...env,
          ZDOTDIR: zdotdir,
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

  pendingInputBytes(): number { return this.pendingInput.length; }

  submit(command: string): void {
    this.send(`${command}\r`);
  }

  write(data: string): void {
    // An explicit interrupt is the one pre-ready input that acts immediately.
    if (data === '\u0003') this.interrupt(); else this.send(data);
  }

  /**
   * Before the first prompt the shell may be reading from the terminal on behalf of the user's startup files
   * (for example `read -k1` in .zshrc), where a queued command or keystroke would silently become the answer.
   * Hold it, bounded, and release it in order once the shell reports ready.
   */
  private send(data: string): void {
    if (this.ready) { this.pty.write(data); return; }
    if (this.pendingInput.length + data.length <= PENDING_INPUT_LIMIT) this.pendingInput += data;
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
    this.pendingInput = '';
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = undefined; }
    try { this.pty.kill(); } finally { this.cleanup(); }
  }

  private receive(data: string): void {
    for (const event of this.protocol.push(data)) {
      if (event.kind === 'data') {
        if (this.ready) this.emit('data', event.data);
        else this.captureStartup(event.data);
      } else if (event.kind === 'exec') {
        if (this.ready) this.emit('exec', event.command, event.historyAllowed);
      } else if (!this.ready) {
        this.ready = true;
        this.startupRaw = '';
        if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = undefined; }
        this.emit('prompt', this.withKnowledge(event.marker));
        const pending = this.pendingInput;
        this.pendingInput = '';
        if (pending && !this.exited) this.pty.write(pending);
      } else {
        this.emit('prompt', this.withKnowledge(event.marker));
      }
    }
  }

  private captureStartup(data: string): void {
    this.startupRaw = (this.startupRaw + data).slice(-STARTUP_RAW_LIMIT);
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
