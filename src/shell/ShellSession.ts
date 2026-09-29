import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn, type IPty } from 'node-pty';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellProtocolDecoder, type ShellMarker } from './ShellProtocol.js';

interface SessionEvents {
  data: [string];
  prompt: [ShellMarker];
  exec: [string];
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
  /** Set once the shell has exited or its PTY is closed; resizes after that are no-ops. */
  private exited = false;

  constructor(cwd: string, columns: number, rows: number, home = process.env.HOME || '', env: NodeJS.ProcessEnv = process.env) {
    super();
    const token = randomBytes(12).toString('hex');
    this.protocol = new ShellProtocolDecoder(token);

    // Create a temporary ZDOTDIR for bootstrap
    const zdotdir = mkdtempSync(join(tmpdir(), 'nmsh-zdotdir-'));

    // Proxy .zshenv
    writeFileSync(join(zdotdir, '.zshenv'), `
if [[ -f "${home}/.zshenv" ]]; then
  ZDOTDIR="${home}" source "${home}/.zshenv"
fi
`);

    // Proxy .zprofile
    writeFileSync(join(zdotdir, '.zprofile'), `
if [[ -f "${home}/.zprofile" ]]; then
  ZDOTDIR="${home}" source "${home}/.zprofile"
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
if [[ "\$TERM" == "xterm-ghostty" ]]; then
  export TERM="xterm-256color"
fi

if [[ -f "${home}/.zshrc" ]]; then
  ZDOTDIR="${home}" source "${home}/.zshrc"
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
  printf '\\e]777;nmsh;${token};exec;%s\\a' "\${1//[[:cntrl:]]/ }"
}

# Compose with whatever the user's config/plugins already installed instead
# of clobbering precmd_functions/preexec_functions: tools like zoxide and
# Atuin register non-UI hooks (directory tracking, history sync) into these
# arrays, and overwriting them silently drops that behavior.
autoload -Uz add-zsh-hook
add-zsh-hook precmd nmsh_precmd
add-zsh-hook preexec nmsh_preexec

# Background cleanup handled by Node.js
`);

    this.zdotdir = zdotdir;

    this.pty = spawn('/bin/zsh', ['-i'], {
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

    this.pty.onData(data => this.receive(data));
    this.pty.onExit(event => {
      this.exited = true;
      this.cleanup();
      this.emit('exit', event);
    });
  }

  private cleanup(): void {
    if (this.zdotdir) {
      try {
        rmSync(this.zdotdir, { recursive: true, force: true });
      } catch (e) {
        // Ignore errors during cleanup
      }
      this.zdotdir = '';
    }
  }

  get pid(): number {
    return this.pty.pid;
  }

  /** Name of the terminal's foreground process, read on demand; undefined if the platform cannot tell. */
  get foregroundProcess(): string | undefined {
    try { return this.pty.process || undefined; } catch { return undefined; }
  }

  submit(command: string): void {
    this.pty.write(`${command}\r`);
  }

  write(data: string): void {
    this.pty.write(data);
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
    this.cleanup();
    this.pty.kill();
  }

  private receive(data: string): void {
    for (const event of this.protocol.push(data)) {
      if (event.kind === 'data') {
        if (this.ready) this.emit('data', event.data);
      } else if (event.kind === 'exec') {
        if (this.ready) this.emit('exec', event.command);
      } else if (!this.ready) {
        this.ready = true;
        this.emit('prompt', event.marker);
      } else {
        this.emit('prompt', event.marker);
      }
    }
  }
}
